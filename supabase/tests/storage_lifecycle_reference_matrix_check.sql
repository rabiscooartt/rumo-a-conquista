-- Matriz das trocas de referência × gatilhos REAIS do projeto (revisão 3.5).
-- Rodar como postgres numa réplica que tenha os gatilhos reais de games, achievements e
-- achievement_progress (achievement_progress_prepare/history, set_updated_at, games_history_prepare,
-- games_history, games_backlog_order_sync, trg_games_manual_total_time) e a migração aplicada.
-- Prova, para as oito referências permitidas, que a troca só muda a coluna da imagem (e o
-- updated_at de manutenção onde há set_updated_at), sem datas falsas nem eventos de histórico;
-- que as trocas não suportadas são recusadas sem efeito; e que um erro no meio desfaz tudo.
-- SOMENTE PARA BANCO LOCAL DE TESTE: termina em rollback.
begin;

create function pg_temp._expect_error(p_sql text, p_code text, p_label text) returns void language plpgsql as $f$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate <> p_code then
      raise exception 'FALHA %: esperado erro %, veio % (%)', p_label, p_code, sqlstate, sqlerrm;
    end if;
    raise notice 'ok: % → recusado (%)', p_label, sqlstate;
    return;
  end;
  raise exception 'FALHA %: deveria ter sido recusado', p_label;
end;
$f$;

-- ---------- Dados (gatilhos de usuário desligados só para montar os casos "sem data" do real) ----------
alter table public.games disable trigger user;
alter table public.achievement_progress disable trigger user;
insert into public.games (slug, title, status, completed_at, started_at, image, card_image, review, review_created_at, review_updated_at,
                          final_badge, emblem, trophies, manual_total_played_minutes) values
  ('jogo-m', 'Jogo M', 'completed', '2026-09-01T00:00:00Z', '2026-08-01T00:00:00Z',
   'https://x.supabase.co/storage/v1/object/public/site-banners/m.png',
   'https://x.supabase.co/storage/v1/object/public/site-banners/m-card.png',
   '{"texto": "review boa", "imagem": "https://x.supabase.co/storage/v1/object/public/achievement-art/m-review.png"}',
   '2026-09-02T00:00:00Z', '2026-09-03T00:00:00Z',
   '{"image": "https://x.supabase.co/storage/v1/object/public/achievement-art/m-badge.png"}',
   '{"image": "https://x.supabase.co/storage/v1/object/public/achievement-art/m-emblem.png"}',
   '{"items": [{"icon": "https://x.supabase.co/storage/v1/object/public/achievement-art/m-trophy.png"}]}', 600),
  -- Como os 2 jogos reais concluídos sem completed_at.
  ('jogo-m-sem-data', 'Jogo M sem data', 'completed', null, null,
   'https://x.supabase.co/storage/v1/object/public/site-banners/m2.png', '', null, null, null, null, null, null, null);
insert into public.achievements (id, game_slug, legacy_id, title, image, official_image) values
  ('00000000-0000-0000-0000-00000000c001', 'jogo-m', 'm1', 'M1',
   'https://x.supabase.co/storage/v1/object/public/achievement-art/m1.png',
   'https://x.supabase.co/storage/v1/object/public/achievement-art/m1-oficial.png'),
  ('00000000-0000-0000-0000-00000000c002', 'jogo-m', 'm2', 'M2', '', null),
  ('00000000-0000-0000-0000-00000000c003', 'jogo-m', 'm3', 'M3', '', null);
insert into public.achievement_progress (id, achievement_id, status, earned_at, image_override) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'completed', '2026-09-01',
   'https://x.supabase.co/storage/v1/object/public/achievement-art/p1.png'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c002', 'locked', null,
   'https://x.supabase.co/storage/v1/object/public/achievement-art/p2.png'),
  -- Como o registro real concluído sem earned_at.
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c003', 'completed', null,
   'https://x.supabase.co/storage/v1/object/public/achievement-art/p3.png');
alter table public.games enable trigger user;
alter table public.achievement_progress enable trigger user;

-- Os gatilhos reais estão presentes e ativos (sem eles a matriz não prova nada).
do $$
declare missing text;
begin
  select pg_catalog.string_agg(t.name, ', ') into missing
  from (values ('achievement_progress_prepare_trigger'), ('achievement_progress_history_trigger'), ('achievement_progress_set_updated_at'),
               ('achievements_set_updated_at'), ('games_history_prepare_trigger'), ('games_history_trigger'),
               ('games_backlog_order_sync'), ('trg_games_manual_total_time')) as t (name)
  where not exists (select 1 from pg_catalog.pg_trigger as g where g.tgname = t.name and g.tgenabled <> 'D');
  assert missing is null, 'FALHA: réplica sem os gatilhos reais: ' || missing;
end;
$$;

create temporary table _events as select * from public.journey_history_events;
create temporary table _games as select * from public.games where slug like 'jogo-m%';
create temporary table _ach as select * from public.achievements where game_slug = 'jogo-m';
create temporary table _prog as select * from public.achievement_progress where id::text like '00000000-0000-0000-0000-00000000d00%';

-- ---------- 1. As oito referências permitidas (service_role, como o backend) ----------
set local role service_role;
do $$
declare
  u constant text := 'https://x.supabase.co/storage/v1/object/public/';
  h constant text := '.0123456789abcdef.webp';
begin
  perform public.storage_lifecycle_replace_reference('m-1', 'achievements', '00000000-0000-0000-0000-00000000c001', 'image',
    u || 'achievement-art/m1.png', u || 'achievement-art/m1' || h, 'matriz', 'webp');
  perform public.storage_lifecycle_replace_reference('m-2', 'achievements', '00000000-0000-0000-0000-00000000c001', 'official_image',
    u || 'achievement-art/m1-oficial.png', u || 'achievement-art/m1-oficial' || h, 'matriz', 'webp');
  perform public.storage_lifecycle_replace_reference('m-3', 'achievement_progress', '00000000-0000-0000-0000-00000000d001', 'image_override',
    u || 'achievement-art/p1.png', u || 'achievement-art/p1' || h, 'matriz', 'webp');
  perform public.storage_lifecycle_replace_reference('m-3b', 'achievement_progress', '00000000-0000-0000-0000-00000000d002', 'image_override',
    u || 'achievement-art/p2.png', u || 'achievement-art/p2' || h, 'matriz', 'webp');
  perform public.storage_lifecycle_replace_reference('m-4', 'games', 'jogo-m', 'image',
    u || 'site-banners/m.png', u || 'site-banners/m' || h, 'matriz', 'webp');
  perform public.storage_lifecycle_replace_reference('m-4b', 'games', 'jogo-m-sem-data', 'image',
    u || 'site-banners/m2.png', u || 'site-banners/m2' || h, 'matriz', 'webp');
  perform public.storage_lifecycle_replace_reference('m-5', 'games', 'jogo-m', 'card_image',
    u || 'site-banners/m-card.png', u || 'site-banners/m-card' || h, 'matriz', 'webp');
  perform public.storage_lifecycle_replace_json_reference('m-6', 'games', 'jogo-m', 'final_badge', '{image}',
    u || 'achievement-art/m-badge.png', u || 'achievement-art/m-badge' || h, 'matriz', 'webp');
  perform public.storage_lifecycle_replace_json_reference('m-7', 'games', 'jogo-m', 'emblem', '{image}',
    u || 'achievement-art/m-emblem.png', u || 'achievement-art/m-emblem' || h, 'matriz', 'webp');
  perform public.storage_lifecycle_replace_json_reference('m-8', 'games', 'jogo-m', 'trophies', '{items,0,icon}',
    u || 'achievement-art/m-trophy.png', u || 'achievement-art/m-trophy' || h, 'matriz', 'webp');
  raise notice 'ok: as oito referências (10 trocas, incluindo progresso bloqueado e jogo concluído sem data) foram aplicadas';
end;
$$;
reset role;

do $$
declare
  diff text;
begin
  -- Nenhum evento de histórico novo, alterado ou removido.
  assert not exists (select * from public.journey_history_events except select * from _events)
     and not exists (select * from _events except select * from public.journey_history_events),
    'FALHA: trocas visuais alteraram journey_history_events';

  -- games: só as colunas de imagem mudaram (datas de conclusão, início e review intactas).
  select pg_catalog.string_agg(g.slug, ', ') into diff
  from public.games as g join _games as s on s.slug = g.slug
  where (pg_catalog.to_jsonb(g) - array['image', 'card_image', 'final_badge', 'emblem', 'trophies'])
        is distinct from (pg_catalog.to_jsonb(s) - array['image', 'card_image', 'final_badge', 'emblem', 'trophies']);
  assert diff is null, 'FALHA: colunas além da imagem mudaram em games: ' || diff;
  assert (select completed_at is null from public.games where slug = 'jogo-m-sem-data'),
    'FALHA: troca de imagem não pode inventar completed_at em jogo concluído sem data';
  assert (select image like '%.webp' and card_image like '%.webp' and final_badge ->> 'image' like '%.webp'
                 and emblem ->> 'image' like '%.webp' and trophies #>> '{items,0,icon}' like '%.webp'
          from public.games where slug = 'jogo-m'),
    'FALHA: as referências de games deveriam apontar para a nova imagem';

  -- achievements e achievement_progress: só imagem e updated_at (set_updated_at, manutenção).
  select pg_catalog.string_agg(a.id::text, ', ') into diff
  from public.achievements as a join _ach as s on s.id = a.id
  where (pg_catalog.to_jsonb(a) - array['image', 'official_image', 'updated_at'])
        is distinct from (pg_catalog.to_jsonb(s) - array['image', 'official_image', 'updated_at']);
  assert diff is null, 'FALHA: colunas além da imagem mudaram em achievements: ' || diff;
  select pg_catalog.string_agg(p.id::text, ', ') into diff
  from public.achievement_progress as p join _prog as s on s.id = p.id
  where (pg_catalog.to_jsonb(p) - array['image_override', 'updated_at'])
        is distinct from (pg_catalog.to_jsonb(s) - array['image_override', 'updated_at']);
  assert diff is null, 'FALHA: earned_at/status/outras colunas mudaram em achievement_progress: ' || diff;

  assert (select count(*) from public.storage_operation_log as done
          where done.phase = 'succeeded' and done.operation_id in (
            select i.operation_id from public.storage_operation_log as i where i.idempotency_key like 'm-%')) = 10,
    'FALHA: as dez trocas deveriam estar auditadas como concluídas';
  raise notice 'ok: só as colunas de imagem mudaram (mais updated_at de manutenção); nenhuma data inventada; histórico idêntico; 10 trocas auditadas';
end;
$$;

-- ---------- 2. Trocas não suportadas: recusadas, sem nenhum efeito ----------
create temporary table _events2 as select * from public.journey_history_events;
create temporary table _games2 as select * from public.games where slug like 'jogo-m%';
create temporary table _prog2 as select * from public.achievement_progress where id::text like '00000000-0000-0000-0000-00000000d00%';
create temporary table _log2 as select count(*) as n from public.storage_operation_log;

set local role service_role;
select pg_temp._expect_error($q$select public.storage_lifecycle_replace_reference('x-1', 'achievement_progress', '00000000-0000-0000-0000-00000000d003', 'image_override',
  'https://x.supabase.co/storage/v1/object/public/achievement-art/p3.png', 'https://x.supabase.co/storage/v1/object/public/achievement-art/p3.0123456789abcdef.webp', 'matriz', 'webp')$q$,
  '55000', 'progresso concluído sem earned_at');
select pg_temp._expect_error($q$select public.storage_lifecycle_replace_json_reference('x-2', 'games', 'jogo-m', 'review', '{imagem}',
  'https://x.supabase.co/storage/v1/object/public/achievement-art/m-review.png', 'https://x.supabase.co/storage/v1/object/public/achievement-art/m-review.0123456789abcdef.webp', 'matriz', 'webp')$q$,
  '0A000', 'imagem dentro de games.review');
select pg_temp._expect_error($q$select public.storage_lifecycle_replace_reference('x-3', 'games', 'jogo-m', 'review',
  'x', 'https://x.supabase.co/storage/v1/object/public/achievement-art/r.0123456789abcdef.webp', 'matriz', 'webp')$q$,
  '22023', 'games.review como coluna de texto');
select pg_temp._expect_error($q$select public.storage_lifecycle_replace_reference('x-4', 'games', 'jogo-m', 'title',
  'Jogo M', 'https://x.supabase.co/storage/v1/object/public/site-banners/t.0123456789abcdef.webp', 'matriz', 'webp')$q$,
  '22023', 'coluna fora da lista (games.title)');
select pg_temp._expect_error($q$select public.storage_lifecycle_replace_reference('x-5', 'achievement_progress', '00000000-0000-0000-0000-00000000d001', 'earned_at',
  '2026-09-01', 'https://x.supabase.co/storage/v1/object/public/achievement-art/e.0123456789abcdef.webp', 'matriz', 'webp')$q$,
  '22023', 'coluna fora da lista (achievement_progress.earned_at)');
select pg_temp._expect_error($q$select public.storage_lifecycle_replace_json_reference('x-6', 'games', 'jogo-m', 'image', '{x}',
  'a', 'https://x.supabase.co/storage/v1/object/public/site-banners/t.0123456789abcdef.webp', 'matriz', 'webp')$q$,
  '22023', 'games.image pela função JSON');
select pg_temp._expect_error($q$select public.storage_lifecycle_replace_json_reference('x-7', 'games', 'jogo-m', 'trophies', '{items,5,icon}',
  'https://x.supabase.co/storage/v1/object/public/achievement-art/m-trophy.0123456789abcdef.webp', 'https://x.supabase.co/storage/v1/object/public/achievement-art/n.0123456789abcdef.webp', 'matriz', 'webp')$q$,
  '22023', 'caminho JSON inexistente em trophies');
select pg_temp._expect_error($q$select public.storage_lifecycle_replace_reference('x-8', 'games', 'jogo-m', 'image',
  'https://x.supabase.co/storage/v1/object/public/site-banners/m.png', 'https://x.supabase.co/storage/v1/object/public/site-banners/m2.0123456789abcdef.webp', 'matriz', 'webp')$q$,
  '40001', 'valor esperado desatualizado');
reset role;

do $$
begin
  assert not exists (select * from public.journey_history_events except select * from _events2)
     and not exists (select * from _events2 except select * from public.journey_history_events), 'FALHA: recusas alteraram o histórico';
  assert not exists (select * from public.games where slug like 'jogo-m%' except select * from _games2)
     and not exists (select * from public.achievement_progress where id::text like '00000000-0000-0000-0000-00000000d00%' except select * from _prog2),
    'FALHA: recusas alteraram linhas (inclusive updated_at)';
  assert (select earned_at is null and image_override like '%/p3.png' from public.achievement_progress where id = '00000000-0000-0000-0000-00000000d003'),
    'FALHA: o progresso sem data deveria continuar sem data e com a imagem original';
  assert (select review_updated_at = '2026-09-03T00:00:00Z' and review ->> 'imagem' like '%/m-review.png' from public.games where slug = 'jogo-m'),
    'FALHA: review e review_updated_at deveriam continuar intactos';
  assert (select count(*) from public.storage_operation_log) = (select n from _log2), 'FALHA: recusas não deixam registro de auditoria';
  raise notice 'ok: 8 recusas sem efeito: histórico, linhas (até updated_at), review e auditoria intactos';
end;
$$;

-- ---------- 3. Atomicidade: erro DEPOIS do UPDATE (gatilho de teste) desfaz a troca e a auditoria ----------
create function public._lifecycle_test_fail() returns trigger language plpgsql as $f$
begin
  if new.image like '%falha-forcada%' then
    raise exception 'falha forçada pelo teste' using errcode = 'P0001';
  end if;
  return new;
end;
$f$;
-- Nome "zzz_" para rodar por último, depois dos gatilhos reais AFTER (incluindo os de histórico).
create trigger zzz_lifecycle_test_fail after update on public.games for each row execute function public._lifecycle_test_fail();
create function public._lifecycle_test_fail_progress() returns trigger language plpgsql as $f$
begin
  if new.image_override like '%falha-forcada%' then raise exception 'falha forçada pelo teste' using errcode = 'P0001'; end if;
  return new;
end;
$f$;
create trigger zzz_lifecycle_test_fail after update on public.achievement_progress for each row execute function public._lifecycle_test_fail_progress();
create temporary table _games3 as select * from public.games where slug like 'jogo-m%';
create temporary table _prog3 as select * from public.achievement_progress where id::text like '00000000-0000-0000-0000-00000000d00%';
create temporary table _log3 as select count(*) as n from public.storage_operation_log;

set local role service_role;
select pg_temp._expect_error($q$select public.storage_lifecycle_replace_reference('a-1', 'games', 'jogo-m', 'image',
  'https://x.supabase.co/storage/v1/object/public/site-banners/m.0123456789abcdef.webp',
  'https://x.supabase.co/storage/v1/object/public/site-banners/falha-forcada.0123456789abcdef.webp', 'matriz', 'webp')$q$,
  'P0001', 'erro depois do UPDATE em games');
select pg_temp._expect_error($q$select public.storage_lifecycle_replace_reference('a-2', 'achievement_progress', '00000000-0000-0000-0000-00000000d001', 'image_override',
  'https://x.supabase.co/storage/v1/object/public/achievement-art/p1.0123456789abcdef.webp',
  'https://x.supabase.co/storage/v1/object/public/achievement-art/falha-forcada.0123456789abcdef.webp', 'matriz', 'webp')$q$,
  'P0001', 'erro depois do UPDATE em achievement_progress');
reset role;

do $$
begin
  assert not exists (select * from public.games where slug like 'jogo-m%' except select * from _games3)
     and not exists (select * from public.achievement_progress where id::text like '00000000-0000-0000-0000-00000000d00%' except select * from _prog3),
    'FALHA: erro no meio deveria desfazer a troca';
  assert (select count(*) from public.storage_operation_log) = (select n from _log3)
     and not exists (select 1 from public.storage_operation_log where idempotency_key in ('a-1', 'a-2')),
    'FALHA: erro no meio não pode deixar intenção ou conclusão na auditoria';
  assert not exists (select * from public.journey_history_events except select * from _events2), 'FALHA: erro no meio alterou o histórico';
end;
$$;

-- A mesma chave de idempotência continua utilizável depois da falha (nada ficou "meio feito").
drop trigger zzz_lifecycle_test_fail on public.games;
set local role service_role;
do $$
declare r jsonb;
begin
  r := public.storage_lifecycle_replace_reference('a-1', 'games', 'jogo-m', 'image',
    'https://x.supabase.co/storage/v1/object/public/site-banners/m.0123456789abcdef.webp',
    'https://x.supabase.co/storage/v1/object/public/site-banners/m-v2.0123456789abcdef.webp', 'matriz', 'webp');
  assert r ->> 'status' = 'applied', 'FALHA: a chave a-1 deveria aplicar depois da falha: ' || r::text;
  r := public.storage_lifecycle_replace_reference('a-1', 'games', 'jogo-m', 'image',
    'https://x.supabase.co/storage/v1/object/public/site-banners/m.0123456789abcdef.webp',
    'https://x.supabase.co/storage/v1/object/public/site-banners/m-v2.0123456789abcdef.webp', 'matriz', 'webp');
  assert r ->> 'status' <> 'applied' or (r ->> 'replayed')::boolean, 'FALHA: repetir a chave a-1 não pode aplicar de novo: ' || r::text;
  raise notice 'ok: atomicidade — erro depois do UPDATE desfaz troca e auditoria; a chave volta a funcionar; repetir não reaplica (%)', r ->> 'status';
end;
$$;
reset role;
do $$
begin
  assert not exists (select * from public.journey_history_events except select * from _events2), 'FALHA: a troca repetida alterou o histórico';
end;
$$;

rollback;

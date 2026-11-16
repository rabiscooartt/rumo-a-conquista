-- Etapa 3.4 — compatibilidade com os gatilhos reais de games e achievement_progress.
-- Recria, só dentro desta transação, a lógica lida no projeto em 15/11/2026:
--   achievement_progress_prepare_trigger (concluído sem earned_at → earned_at = hoje)
--   achievement_progress_history_trigger (earned_at/status mudou → evento achievement_unlocked)
--   games_history_prepare_trigger        (review mudou → review_updated_at = agora)
--   games_history_trigger                (review mudou → evento review_updated)
-- e prova que as trocas do ciclo de vida não produzem esses efeitos colaterais.
-- SOMENTE PARA BANCO LOCAL DE TESTE: termina em rollback. Rodar como superusuário.
begin;

create function public._lifecycle_expect_error(p_sql text, p_code text, p_label text)
returns void language plpgsql as $f$
begin
  begin
    execute p_sql;
  exception when others then
    if p_code is not null and sqlstate <> p_code then
      raise exception 'FALHA %: esperado erro %, veio % (%)', p_label, p_code, sqlstate, sqlerrm;
    end if;
    raise notice 'ok: % → recusado (%)', p_label, sqlstate;
    return;
  end;
  raise exception 'FALHA %: deveria ter sido recusado', p_label;
end;
$f$;
grant execute on function public._lifecycle_expect_error(text, text, text) to service_role;

create table public._t_events (owner_key text, event_type text, event_date date, source_table text, source_id text,
  unique (owner_key, source_table, source_id, event_type));
grant select on public._t_events to service_role;

create function public._t_is_meaningful_review(p jsonb) returns boolean language sql immutable as $f$
  select p is not null and p <> 'null'::jsonb and (coalesce(trim(p->>'texto'), '') <> '' or coalesce(trim(p->>'resumo'), '') <> '');
$f$;

create function public._t_progress_prepare() returns trigger language plpgsql security definer set search_path = public as $f$
begin if new.status = 'completed' and new.earned_at is null then new.earned_at := now(); end if; return new; end;
$f$;
create function public._t_progress_history() returns trigger language plpgsql security definer set search_path = public as $f$
begin
  if new.status = 'completed' and new.earned_at is not null
     and (tg_op = 'INSERT' or old.status is distinct from new.status or old.earned_at is distinct from new.earned_at) then
    insert into public._t_events values ('default', 'achievement_unlocked', new.earned_at, 'achievement_progress', new.id::text)
    on conflict (owner_key, source_table, source_id, event_type) do update set event_date = excluded.event_date;
  end if;
  return new;
end;
$f$;
create function public._t_games_prepare() returns trigger language plpgsql security definer set search_path = public as $f$
begin
  if public._t_is_meaningful_review(new.review) and tg_op = 'UPDATE' and old.review is distinct from new.review then
    new.review_updated_at := now();
  end if;
  return new;
end;
$f$;
create function public._t_games_history() returns trigger language plpgsql security definer set search_path = public as $f$
begin
  if tg_op = 'UPDATE' and public._t_is_meaningful_review(new.review) and public._t_is_meaningful_review(old.review)
     and old.review is distinct from new.review and new.review_updated_at is not null then
    insert into public._t_events values ('default', 'review_updated', new.review_updated_at::date, 'games', new.slug || ':' || new.review_updated_at::text)
    on conflict do nothing;
  end if;
  return new;
end;
$f$;

-- Dados: conquista concluída SEM data (como o registro real), concluída com data e bloqueada.
insert into public.achievements (id, game_slug, legacy_id, title, image) values
  ('00000000-0000-0000-0000-0000000bbbb1', 'jogo-t', 't1', 'T1', ''),
  ('00000000-0000-0000-0000-0000000bbbb2', 'jogo-t', 't2', 'T2', ''),
  ('00000000-0000-0000-0000-0000000bbbb3', 'jogo-t', 't3', 'T3', '');
-- Gatilhos já existentes (banco real/réplica) desligados só para montar o registro sem data.
alter table public.achievement_progress disable trigger user;
insert into public.achievement_progress (id, achievement_id, status, earned_at, image_override) values
  ('00000000-0000-0000-0000-00000000aaa1', '00000000-0000-0000-0000-0000000bbbb1', 'completed', null, 'https://x.supabase.co/storage/v1/object/public/achievement-art/a1.png'),
  ('00000000-0000-0000-0000-00000000aaa2', '00000000-0000-0000-0000-0000000bbbb2', 'completed', '2026-10-01', 'https://x.supabase.co/storage/v1/object/public/achievement-art/a2.png'),
  ('00000000-0000-0000-0000-00000000aaa3', '00000000-0000-0000-0000-0000000bbbb3', 'locked', null, 'https://x.supabase.co/storage/v1/object/public/achievement-art/a3.png');
alter table public.achievement_progress enable trigger user;
insert into public.games (slug, title, status, image, review, review_updated_at, final_badge) values
  ('jogo-t', 'Jogo T', 'completed', 'https://x.supabase.co/storage/v1/object/public/site-banners/t.png',
   '{"texto": "ótimo", "imagem": "https://x.supabase.co/storage/v1/object/public/achievement-art/review.png"}', '2026-10-01T00:00:00Z',
   '{"image": "https://x.supabase.co/storage/v1/object/public/achievement-art/badge.png"}');

-- Gatilhos ligados DEPOIS dos dados (assim o registro sem data continua sem data, como no real).
create trigger _t_progress_prepare before insert or update on public.achievement_progress for each row execute function public._t_progress_prepare();
create trigger _t_progress_history after insert or update on public.achievement_progress for each row execute function public._t_progress_history();
create trigger _t_games_prepare before insert or update on public.games for each row execute function public._t_games_prepare();
create trigger _t_games_history after insert or update on public.games for each row execute function public._t_games_history();

-- Controle: os gatilhos replicados reproduzem o efeito colateral numa alteração comum.
savepoint controle;
update public.achievement_progress set image_override = image_override where id = '00000000-0000-0000-0000-00000000aaa1';
do $$
begin
  assert (select earned_at from public.achievement_progress where id = '00000000-0000-0000-0000-00000000aaa1') = current_date
     and exists (select 1 from public._t_events where event_type = 'achievement_unlocked'),
    'FALHA: o controle deveria reproduzir o efeito colateral do gatilho real';
  raise notice 'ok: [controle] alteração comum em progresso concluído sem data grava earned_at = hoje e o evento de desbloqueio';
end;
$$;
rollback to savepoint controle;

set local role service_role;
-- 1. Progresso concluído sem earned_at: recusado, sem efeito colateral.
select public._lifecycle_expect_error($q$select public.storage_lifecycle_replace_reference('t-1', 'achievement_progress', '00000000-0000-0000-0000-00000000aaa1', 'image_override',
  'https://x.supabase.co/storage/v1/object/public/achievement-art/a1.png', 'https://x.supabase.co/storage/v1/object/public/achievement-art/a1.0123456789abcdef.webp', 'teste', 'webp')$q$,
  '55000', 'troca de imagem em progresso concluído sem earned_at');
-- 2. Concluído com data e bloqueado: trocas normais, sem novo evento.
do $$
begin
  perform public.storage_lifecycle_replace_reference('t-2', 'achievement_progress', '00000000-0000-0000-0000-00000000aaa2', 'image_override',
    'https://x.supabase.co/storage/v1/object/public/achievement-art/a2.png', 'https://x.supabase.co/storage/v1/object/public/achievement-art/a2.0123456789abcdef.webp', 'teste', 'webp');
  perform public.storage_lifecycle_replace_reference('t-3', 'achievement_progress', '00000000-0000-0000-0000-00000000aaa3', 'image_override',
    'https://x.supabase.co/storage/v1/object/public/achievement-art/a3.png', 'https://x.supabase.co/storage/v1/object/public/achievement-art/a3.0123456789abcdef.webp', 'teste', 'webp');
  raise notice 'ok: trocas em progresso concluído com data e em progresso bloqueado continuam permitidas';
end;
$$;
-- 3. Imagem dentro de games.review: bloqueada.
select public._lifecycle_expect_error($q$select public.storage_lifecycle_replace_json_reference('t-4', 'games', 'jogo-t', 'review', '{imagem}',
  'https://x.supabase.co/storage/v1/object/public/achievement-art/review.png', 'https://x.supabase.co/storage/v1/object/public/achievement-art/review.0123456789abcdef.webp', 'teste', 'webp')$q$,
  '0A000', 'troca de imagem dentro de games.review');
-- 4. Outras colunas de games: permitidas e sem tocar na review.
do $$
begin
  perform public.storage_lifecycle_replace_json_reference('t-5', 'games', 'jogo-t', 'final_badge', '{image}',
    'https://x.supabase.co/storage/v1/object/public/achievement-art/badge.png', 'https://x.supabase.co/storage/v1/object/public/achievement-art/badge.0123456789abcdef.webp', 'teste', 'webp');
  perform public.storage_lifecycle_replace_reference('t-6', 'games', 'jogo-t', 'image',
    'https://x.supabase.co/storage/v1/object/public/site-banners/t.png', 'https://x.supabase.co/storage/v1/object/public/site-banners/t.0123456789abcdef.webp', 'teste', 'webp');
  raise notice 'ok: trocas em games.final_badge e games.image continuam permitidas';
end;
$$;
reset role;

do $$
begin
  assert (select earned_at is null and image_override = 'https://x.supabase.co/storage/v1/object/public/achievement-art/a1.png'
          from public.achievement_progress where id = '00000000-0000-0000-0000-00000000aaa1'),
    'FALHA: progresso sem data deveria continuar intacto (sem earned_at e com a imagem antiga)';
  assert (select earned_at from public.achievement_progress where id = '00000000-0000-0000-0000-00000000aaa2') = '2026-10-01',
    'FALHA: earned_at existente não pode mudar';
  assert not exists (select 1 from public._t_events), 'FALHA: nenhuma troca deveria gerar evento de histórico';
  assert (select review_updated_at from public.games where slug = 'jogo-t') = '2026-10-01T00:00:00Z'
     and (select review ->> 'imagem' from public.games where slug = 'jogo-t') = 'https://x.supabase.co/storage/v1/object/public/achievement-art/review.png',
    'FALHA: review e review_updated_at deveriam continuar intactos';
  assert not exists (select 1 from public.storage_operation_log where idempotency_key in ('t-1', 't-4')),
    'FALHA: tentativas recusadas não deixam registro';
  assert (select count(*) from public.storage_operation_log as done
          where done.phase = 'succeeded' and done.operation_id in (
            select intent.operation_id from public.storage_operation_log as intent where intent.idempotency_key in ('t-2', 't-3', 't-5', 't-6'))) = 4,
    'FALHA: as quatro trocas permitidas deveriam estar auditadas';
  assert not has_column_privilege('storage_lifecycle_owner', 'public.games', 'review', 'UPDATE')
     and not has_column_privilege('storage_lifecycle_owner', 'public.achievement_progress', 'earned_at', 'UPDATE')
     and not has_column_privilege('storage_lifecycle_owner', 'public.achievement_progress', 'status', 'UPDATE'),
    'FALHA: o proprietário não pode alterar review, earned_at nem status';
  raise notice 'ok: recusas sem efeito colateral; nenhum evento; review e earned_at intactos; proprietário sem UPDATE em review/earned_at/status';
end;
$$;

-- 5. Edição normal da review (como o site faz) continua com os gatilhos funcionando.
update public.games set review = '{"texto": "ótimo, revisado", "imagem": "https://x.supabase.co/storage/v1/object/public/achievement-art/review.png"}'
where slug = 'jogo-t';
do $$
begin
  assert (select review_updated_at > '2026-10-01T00:00:00Z' from public.games where slug = 'jogo-t')
     and exists (select 1 from public._t_events where event_type = 'review_updated'),
    'FALHA: edição normal da review deveria continuar atualizando a data e gerando o evento';
  raise notice 'ok: edição normal da review continua acionando review_updated_at e o evento review_updated';
end;
$$;

rollback;

-- Proteções da revisão 3.1: evidência por objeto, proteção manual, referências em JSON,
-- validação de novas referências, search_path/privilégios e cadeia de hash com ponta travada.
-- SOMENTE PARA BANCO LOCAL DE TESTE: cria linhas fictícias e termina em rollback.
-- Espera os papéis anon, authenticated e service_role e as tabelas achievements e games
-- (no banco local: final_badge jsonb, trophies json, review jsonb e emblem como TEXTO,
-- para conferir a recusa de tipo não suportado).
begin;

create function public._lifecycle_expect_error(p_sql text, p_code text, p_label text)
returns void
language plpgsql
as $$
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
$$;
grant execute on function public._lifecycle_expect_error(text, text, text) to anon, authenticated, service_role;

create function public._ev_scan(p_id text, p_at text, p_count integer, p_complete boolean default true)
returns jsonb language sql immutable as $$
  select jsonb_build_object('scan_id', p_id, 'completed_at', p_at, 'complete', p_complete,
    'inventory_status', case when p_complete then 'complete' else 'partial' end,
    'image_objects', p_count, 'image_bytes', p_count * 1000);
$$;

create function public._ev_obj(p_path text, p_state text, p_refs integer default 0)
returns jsonb language sql immutable as $$
  select jsonb_build_object('bucket', 'game-images', 'path', p_path, 'state', p_state, 'size', 1000,
    'mimetype', 'image/png', 'reference_count', p_refs,
    'protected_reason', case when p_state = 'protected' then 'lista de proteção' end);
$$;

create function public._ev(p_path text)
returns jsonb language sql stable as $$
  select public.storage_lifecycle_evidence('game-images', p_path);
$$;
grant execute on function public._ev(text) to service_role;

-- ------------------------------------------------------------------ segurança das funções
do $$
declare
  problem text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into problem
  from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname ~ '^storage_(lifecycle|operation_log|object_lifecycle)'
    and not coalesce(p.proconfig @> array['search_path=""'], false);
  assert problem is null, 'FALHA: funções sem search_path vazio: ' || coalesce(problem, '');

  select string_agg(p.oid::regprocedure::text, ', ') into problem
  from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname ~ '^storage_(lifecycle|operation_log|object_lifecycle)'
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  assert problem is null, 'FALHA: funções executáveis pelo navegador: ' || coalesce(problem, '');

  assert not has_function_privilege('service_role', 'public.storage_lifecycle_append_log(uuid, text, text, text, text, text, text, text, text, text, text, text, text, jsonb)', 'EXECUTE'),
    'FALHA: service_role não deveria gravar auditoria diretamente';
  assert not has_function_privilege('service_role', 'public.storage_lifecycle_lock_key(text, text)', 'EXECUTE'), 'FALHA: lock_key é interna';
  assert not has_function_privilege('service_role', 'public.storage_lifecycle_validate_new_reference(text)', 'EXECUTE'), 'FALHA: validação é interna';
  assert (select count(*) from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prosecdef and p.proname ~ '^storage_') = 14,
    'FALHA: funções do backend deveriam ser SECURITY DEFINER';
  assert not exists (
    select 1 from pg_class as c join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('storage_lifecycle_scan_objects', 'storage_operation_log_head') and not c.relrowsecurity
  ), 'FALHA: RLS deveria estar ligado nas tabelas novas';
  assert not has_table_privilege('service_role', 'public.storage_operation_log_head', 'SELECT'), 'FALHA: ponta da cadeia é interna';
  assert not has_table_privilege('service_role', 'public.storage_lifecycle_scan_objects', 'INSERT'), 'FALHA: service_role só lê a evidência';
  raise notice 'ok: search_path vazio em todas as funções, EXECUTE só para o backend, internas fechadas, RLS nas tabelas novas';
end;
$$;

set local role anon;
select public._lifecycle_expect_error('select * from public.storage_lifecycle_scan_objects', '42501', 'anon lê evidência');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_evidence('a', 'b')$q$, '42501', 'anon consulta elegibilidade');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_set_manual_protection('k', 'a', 'b', true, 'x', 'x')$q$, '42501', 'anon protege objeto');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_replace_json_reference('k', 'games', 'g', 'final_badge', '{image}', null, null, 'x', 'x')$q$, '42501', 'anon troca referência JSON');
reset role;
set local role authenticated;
select public._lifecycle_expect_error('select * from public.storage_operation_log_head', '42501', 'authenticated lê ponta da cadeia');
reset role;

-- ------------------------------------------------------------------ evidência por varredura
set local role service_role;
do $$
begin
  perform public.storage_lifecycle_register_scan(public._ev_scan('scan-20260801T000000Z', '2026-08-01T00:00:00Z', 5), 'teste');
  perform public.storage_lifecycle_sync_scan('scan-20260801T000000Z', jsonb_build_array(
    public._ev_obj('x.png', 'observing'), public._ev_obj('y.png', 'observing'), public._ev_obj('m.png', 'observing'),
    public._ev_obj('n.png', 'observing'), public._ev_obj('z.png', 'observing')), 'teste');
  perform public.storage_lifecycle_register_scan(public._ev_scan('scan-20260820T000000Z', '2026-08-20T00:00:00Z', 5), 'teste');
  perform public.storage_lifecycle_sync_scan('scan-20260820T000000Z', jsonb_build_array(
    public._ev_obj('x.png', 'observing'), public._ev_obj('y.png', 'referenced', 1), public._ev_obj('m.png', 'observing'),
    public._ev_obj('n.png', 'observing'), public._ev_obj('z.png', 'observing')), 'teste');
  perform public.storage_lifecycle_register_scan(public._ev_scan('scan-20260905T000000Z', '2026-09-05T00:00:00Z', 5), 'teste');
  perform public.storage_lifecycle_sync_scan('scan-20260905T000000Z', jsonb_build_array(
    public._ev_obj('x.png', 'observing'), public._ev_obj('y.png', 'observing'), public._ev_obj('m.png', 'observing'),
    public._ev_obj('n.png', 'observing'), public._ev_obj('z.png', 'observing')), 'teste');
  perform public.storage_lifecycle_register_scan(public._ev_scan('scan-20260910T000000Z', '2026-09-10T00:00:00Z', 4), 'teste');
  assert (select count(*) from public.storage_lifecycle_scan_objects) = 15, 'FALHA: evidência deveria ter 5 linhas por varredura sincronizada';
  raise notice 'ok: cada varredura sincronizada grava a evidência de todos os objetos';
end;
$$;
do $$
declare
  r jsonb;
begin
  r := public.storage_lifecycle_sync_scan('scan-20260910T000000Z', jsonb_build_array(
    public._ev_obj('x.png', 'candidate'), public._ev_obj('y.png', 'candidate'), public._ev_obj('m.png', 'candidate'), public._ev_obj('n.png', 'candidate')), 'teste');
  assert (r ->> 'missing')::int = 1, 'FALHA: z.png deveria constar como ausente';
  -- 3.3: y.png (referência reaparecida em 20/08) pedido como candidato vira observing; o resto do lote segue.
  assert (r ->> 'overrides')::int = 1 and (select state from public.storage_object_lifecycle where object_path = 'y.png') = 'observing'
     and (select requested_state from public.storage_lifecycle_scan_objects where scan_id = 'scan-20260910T000000Z' and object_path = 'y.png') = 'candidate',
    'FALHA: y.png deveria ser corrigido para observing, com o pedido original guardado: ' || r::text;
  raise notice 'ok: referência reaparecida dentro da janela (y.png) → corrigido para observing, pedido original guardado na evidência';
  assert (public._ev('x.png') ->> 'eligible')::boolean and (public._ev('x.png') ->> 'scans')::int = 4 and (public._ev('x.png') ->> 'span_days')::numeric = 40,
    'FALHA: x.png deveria ter 4 varreduras e 40 dias de evidência: ' || public._ev('x.png')::text;
  assert not (public._ev('y.png') ->> 'eligible')::boolean and public._ev('y.png') ->> 'stopped_at' like '%scan-20260820T000000Z%',
    'FALHA: y.png deveria parar na varredura com referência: ' || public._ev('y.png')::text;
  assert not (public._ev('z.png') ->> 'eligible')::boolean and public._ev('z.png') ->> 'stopped_at' like 'ausente%',
    'FALHA: z.png ausente da última varredura não pode ser elegível: ' || public._ev('z.png')::text;
  raise notice 'ok: prova por objeto — 2+ varreduras válidas, 30+ dias; referência reaparecida e ausência interrompem';
end;
$$;

-- Evidência é somente inclusão (nem o proprietário dedicado, assumido por um administrador, altera).
reset role;
set local role storage_lifecycle_owner;
select public._lifecycle_expect_error($q$update public.storage_lifecycle_scan_objects set reference_count = 0$q$, '42501', 'dono altera evidência');
select public._lifecycle_expect_error($q$delete from public.storage_lifecycle_scan_objects$q$, '42501', 'dono apaga evidência');
select public._lifecycle_expect_error($q$truncate public.storage_lifecycle_scan_objects$q$, '42501', 'dono esvazia evidência');
select public._lifecycle_expect_error($q$delete from public.storage_operation_log_head$q$, '42501', 'dono apaga ponta da cadeia');
reset role;
select set_config('app.storage_lifecycle_writer', 'on', true);
select public._lifecycle_expect_error($q$update public.storage_operation_log_head set last_entry_hash = null$q$, '42501', 'superusuário altera ponta da cadeia sem assumir o proprietário (variável de sessão ignorada)');
set local role service_role;
select public._lifecycle_expect_error($q$insert into public.storage_lifecycle_scan_objects (scan_id, bucket, object_path, state, reference_count)
  values ('scan-20260910T000000Z', 'game-images', 'w.png', 'observing', 0)$q$, '42501', 'backend grava evidência direto');

-- ------------------------------------------------------------------ proteção manual
do $$
declare
  r jsonb;
begin
  r := public.storage_lifecycle_set_manual_protection('mp-1', 'game-images', 'm.png', true, 'teste', 'arte em revisão');
  assert r ->> 'status' = 'applied', 'FALHA: proteção manual deveria ser aplicada';
  assert (select (state, manual_protection) = ('protected', true) from public.storage_object_lifecycle where object_path = 'm.png'),
    'FALHA: m.png deveria ficar protegido';
  assert public._ev('m.png') ->> 'reason' = 'proteção manual ativa', 'FALHA: proteção manual deveria impedir a elegibilidade';
  r := public.storage_lifecycle_set_manual_protection('mp-1', 'game-images', 'm.png', true, 'teste', 'arte em revisão');
  assert r ->> 'status' = 'already_applied', 'FALHA: repetir a chave deveria ser idempotente';

  perform public.storage_lifecycle_set_manual_protection('np-1', 'game-images', 'n.png', true, 'teste', 'conferir');
  perform public.storage_lifecycle_set_manual_protection('np-2', 'game-images', 'n.png', false, 'teste', 'conferido');
  assert (select (state, manual_protection) = ('unverified', false) from public.storage_object_lifecycle where object_path = 'n.png'),
    'FALHA: proteção removida deveria deixar n.png unverified';
  assert public._ev('n.png') ->> 'reason' = 'proteção manual removida dentro do período de evidência',
    'FALHA: remoção de proteção dentro da janela deveria impedir: ' || public._ev('n.png')::text;
  raise notice 'ok: proteção manual impede elegibilidade, é idempotente e, removida, reinicia a janela';
end;
$$;
select public._lifecycle_expect_error($q$select public.storage_lifecycle_set_manual_protection('mp-1', 'game-images', 'x.png', true, 'teste', 'x')$q$, '23505', 'mesma chave de proteção para outro objeto');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_begin_operation('arq-m', 'archive_copy', 'game-images', 'm.png', 'teste', 'arquivar')$q$, '23514', 'arquivar objeto com proteção manual');

-- ------------------------------------------------------------------ varredura incompleta mais recente
do $$
begin
  perform public.storage_lifecycle_register_scan(public._ev_scan('scan-20260912T000000Z', '2026-09-12T00:00:00Z', 4, false), 'teste');
  assert public._ev('x.png') ->> 'reason' = 'a varredura mais recente está incompleta ou invalidada', 'FALHA: última varredura incompleta deveria bloquear';
  raise notice 'ok: varredura mais recente incompleta bloqueia toda elegibilidade';
end;
$$;
select public._lifecycle_expect_error($q$select public.storage_lifecycle_begin_operation('arq-x-0', 'archive_copy', 'game-images', 'x.png', 'teste', 'arquivar')$q$, '23514', 'arquivar com a última varredura incompleta');
do $$
declare
  r jsonb;
begin
  perform public.storage_lifecycle_register_scan(public._ev_scan('scan-20260915T000000Z', '2026-09-15T00:00:00Z', 4), 'teste');
  -- O classificador não conhece a proteção manual (m.png como candidate): a proteção prevalece.
  perform public.storage_lifecycle_sync_scan('scan-20260915T000000Z', jsonb_build_array(
    public._ev_obj('x.png', 'candidate'), public._ev_obj('y.png', 'observing'), public._ev_obj('m.png', 'candidate'), public._ev_obj('n.png', 'observing')), 'teste');
  assert (select state from public.storage_object_lifecycle where object_path = 'm.png') = 'protected', 'FALHA: proteção manual deveria prevalecer na sincronização';
  assert (select manual_protection from public.storage_lifecycle_scan_objects where scan_id = 'scan-20260915T000000Z' and object_path = 'm.png'),
    'FALHA: evidência deveria registrar a proteção manual';
  assert (public._ev('x.png') ->> 'eligible')::boolean, 'FALHA: varredura incompleta intermediária não deveria contar contra x.png';
  raise notice 'ok: varredura incompleta intermediária não é evidência; proteção manual prevalece sobre a classificação';

  perform public.storage_lifecycle_set_manual_protection('mp-2', 'game-images', 'm.png', false, 'teste', 'revisão concluída');
  assert not (public._ev('m.png') ->> 'eligible')::boolean, 'FALHA: m.png protegido na última varredura não pode ser elegível';
  raise notice 'ok: varreduras com proteção manual interrompem a sequência mesmo depois da remoção';
end;
$$;

-- ------------------------------------------------------------------ referências em JSON
reset role;
insert into public.games (slug, image, final_badge, trophies, review, emblem) values (
  'jogo-json', '/images/capa.jpg',
  '{"icon": "maestria", "image": "https://x.supabase.co/storage/v1/object/public/achievement-art/a.png?v=1"}',
  '{"items": [{"icon": "/images/l.png"}, {"icon": "https://x.supabase.co/storage/v1/object/public/site-banners/b%20c.png"}]}',
  '{"cover": "https://x.supabase.co/storage/v1/object/public/game-images/achievements/c.png", "score": 9}',
  '{"image": "https://x.supabase.co/storage/v1/object/public/achievement-art/e.png"}'
);
insert into public.achievements (id, image) values ('00000000-0000-0000-0000-0000000000aa', '/images/conquista.png');
set local role service_role;

select public._lifecycle_expect_error($q$select public.storage_lifecycle_replace_json_reference('j-0', 'games', 'jogo-json', 'image', '{x}', null, null, 'teste', 'x')$q$, '22023', 'coluna fora da lista JSON');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_replace_json_reference('j-0', 'games', 'jogo-json', 'emblem', '{image}', null, null, 'teste', 'x')$q$, '22023', 'coluna JSON guardada como texto');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_replace_json_reference('j-0', 'games', 'jogo-json', 'final_badge', '{nada}', null, 'x', 'teste', 'x')$q$, '22023', 'caminho JSON inexistente');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_replace_json_reference('j-0', 'games', 'jogo-json', 'trophies', '{items}', null, 'x', 'teste', 'x')$q$, '22023', 'caminho JSON que não é texto');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_replace_json_reference('j-0', 'games', 'jogo-json', 'final_badge', '{""}', null, 'x', 'teste', 'x')$q$, '22023', 'caminho JSON com nível vazio');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_replace_json_reference('j-0', 'games', 'jogo-json', 'final_badge', '{image}', 'outro-valor', 'x', 'teste', 'x')$q$, '40001', 'valor JSON esperado diferente do atual');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_replace_json_reference('j-0', 'games', 'jogo-json', 'final_badge', '{image}',
  'https://x.supabase.co/storage/v1/object/public/achievement-art/a.png?v=1', 'https://x.supabase.co/storage/v1/object/public/achievement-art/../x.png', 'teste', 'x')$q$, '22023', 'nova referência JSON com ..');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_replace_json_reference('j-0', 'games', 'jogo-json', 'final_badge', '{image}',
  'https://x.supabase.co/storage/v1/object/public/achievement-art/a.png?v=1', 'https://x.supabase.co/storage/v1/object/public/achievement-art/a b.png', 'teste', 'x')$q$, '22023', 'nova referência JSON com espaço cru');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_replace_json_reference('j-0', 'games', 'jogo-json', 'final_badge', '{image}',
  'https://x.supabase.co/storage/v1/object/public/achievement-art/a.png?v=1', 'https://x.supabase.co/storage/v1/object/public/achievement-art/novo.webp', '  ', 'x')$q$, '23514', 'troca JSON com falha na auditoria');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_replace_reference('t-0', 'achievements', '00000000-0000-0000-0000-0000000000aa', 'image',
  '/images/conquista.png', 'https://x.supabase.co/storage/v1/object/public/achievement-art/%zz.png', 'teste', 'x')$q$, '22023', 'nova referência de texto com codificação inválida');

-- Nova referência para objeto em arquivamento é recusada.
do $$
begin
  perform public.storage_lifecycle_begin_operation('arq-x', 'archive_copy', 'game-images', 'x.png', 'teste', 'arquivar candidato');
end;
$$;
select public._lifecycle_expect_error($q$select public.storage_lifecycle_replace_json_reference('j-0', 'games', 'jogo-json', 'final_badge', '{image}',
  'https://x.supabase.co/storage/v1/object/public/achievement-art/a.png?v=1', 'https://x.supabase.co/storage/v1/object/public/game-images/x.png', 'teste', 'x')$q$, '23514', 'nova referência JSON para objeto em arquivamento');
do $$
begin
  perform public.storage_lifecycle_finish_operation((select operation_id from public.storage_operation_log where idempotency_key = 'arq-x'), 'failed', 'teste',
    jsonb_build_object('error', 'teste: cópia não feita'));
end;
$$;

reset role;
do $$
begin
  assert (select final_badge ->> 'image' from public.games where slug = 'jogo-json') = 'https://x.supabase.co/storage/v1/object/public/achievement-art/a.png?v=1',
    'FALHA: falhas não deveriam alterar o JSON';
  assert not exists (select 1 from public.storage_operation_log where idempotency_key = 'j-0'), 'FALHA: falhas não deveriam deixar intenção';
  raise notice 'ok: tentativas inválidas de troca em JSON não alteram nada nem deixam registro';
end;
$$;
set local role service_role;
do $$
declare
  r jsonb;
  intent_details jsonb;
begin
  r := public.storage_lifecycle_replace_json_reference('j-1', 'games', 'jogo-json', 'final_badge', '{image}',
    'https://x.supabase.co/storage/v1/object/public/achievement-art/a.png?v=1', 'https://x.supabase.co/storage/v1/object/public/achievement-art/a.0123456789abcdef.webp', 'teste', 'trocar por WebP');
  assert r ->> 'status' = 'applied', 'FALHA: troca em final_badge deveria funcionar';
  select details into intent_details from public.storage_operation_log where idempotency_key = 'j-1';
  assert intent_details ->> 'old_object' = 'achievement-art/a.png', 'FALHA: objeto anterior normalizado';
  assert intent_details ->> 'new_object' = 'achievement-art/a.0123456789abcdef.webp', 'FALHA: objeto novo normalizado';
  assert (intent_details ->> 'old_document')::jsonb ->> 'image' = 'https://x.supabase.co/storage/v1/object/public/achievement-art/a.png?v=1',
    'FALHA: documento anterior inteiro deveria estar na intenção';
  assert intent_details ->> 'old_document_sha256' ~ '^[0-9a-f]{64}$', 'FALHA: hash do documento anterior';

  r := public.storage_lifecycle_replace_json_reference('j-1', 'games', 'jogo-json', 'final_badge', '{image}',
    'https://x.supabase.co/storage/v1/object/public/achievement-art/a.png?v=1', 'https://x.supabase.co/storage/v1/object/public/achievement-art/a.0123456789abcdef.webp', 'teste', 'trocar por WebP');
  assert r ->> 'status' = 'already_applied', 'FALHA: repetir a chave JSON deveria ser idempotente';
  assert (select count(*) from public.storage_operation_log where idempotency_key = 'j-1') = 1, 'FALHA: repetição não grava outra intenção';
  raise notice 'ok: troca em final_badge registra valor e documento anteriores; repetição idempotente';
end;
$$;
select public._lifecycle_expect_error($q$select public.storage_lifecycle_replace_json_reference('j-2', 'games', 'jogo-json', 'trophies', '{items,1,icon}',
  'https://x.supabase.co/storage/v1/object/public/site-banners/b%20c.png', 'https://x.supabase.co/storage/v1/object/public/site-banners/b c.0123456789abcdef.webp', 'teste', 'x')$q$,
  '22023', 'espaço cru em caminho aninhado');
do $$
declare
  r jsonb;
begin
  r := public.storage_lifecycle_replace_json_reference('j-2', 'games', 'jogo-json', 'trophies', '{items,1,icon}',
    'https://x.supabase.co/storage/v1/object/public/site-banners/b%20c.png', 'https://x.supabase.co/storage/v1/object/public/site-banners/b%20c.0123456789abcdef.webp', 'teste', 'trocar ícone');
  assert (select details ->> 'old_object' from public.storage_operation_log where idempotency_key = 'j-2') = 'site-banners/b c.png',
    'FALHA: %20 deveria ser decodificado no objeto anterior';
  -- 3.4: a remoção (JSON null) é testada em trophies; games.review agora é bloqueado (abaixo).
  r := public.storage_lifecycle_replace_json_reference('j-3', 'games', 'jogo-json', 'trophies', '{items,0,icon}',
    '/images/l.png', null, 'teste', 'remover ícone');
  raise notice 'ok: troca em JSON aninhado (json) e remoção (JSON null) em trophies';
end;
$$;
select public._lifecycle_expect_error($q$select public.storage_lifecycle_replace_json_reference('j-4', 'games', 'jogo-json', 'review', '{cover}',
  'https://x.supabase.co/storage/v1/object/public/game-images/achievements/c.png', null, 'teste', 'remover capa')$q$, '0A000', 'troca de imagem dentro de games.review (bloqueada)');
reset role;
do $$
begin
  assert (select final_badge from public.games where slug = 'jogo-json') =
    '{"icon": "maestria", "image": "https://x.supabase.co/storage/v1/object/public/achievement-art/a.0123456789abcdef.webp"}'::jsonb,
    'FALHA: final_badge deveria manter as outras chaves';
  assert (select trophies::jsonb #>> '{items,1,icon}' from public.games where slug = 'jogo-json') =
    'https://x.supabase.co/storage/v1/object/public/site-banners/b%20c.0123456789abcdef.webp', 'FALHA: ícone aninhado trocado';
  assert (select pg_typeof(trophies)::text from public.games where slug = 'jogo-json') = 'json', 'FALHA: coluna json continua json';
  assert (select jsonb_typeof(trophies::jsonb #> '{items,0,icon}') from public.games where slug = 'jogo-json') = 'null',
    'FALHA: ícone removido deveria virar JSON null';
  assert (select review ->> 'cover' from public.games where slug = 'jogo-json') = 'https://x.supabase.co/storage/v1/object/public/game-images/achievements/c.png'
     and (select review ->> 'score' from public.games where slug = 'jogo-json') = '9'
     and not exists (select 1 from public.storage_operation_log where idempotency_key = 'j-4'), 'FALHA: review intacta e sem registro da tentativa bloqueada';
  assert (select count(*) from public.storage_operation_log where operation = 'json_reference_replace' and phase = 'succeeded') = 3,
    'FALHA: três trocas JSON concluídas';
  raise notice 'ok: documentos JSON alterados só no caminho pedido, com intenção e resultado';
end;
$$;

-- ------------------------------------------------------------------ invalidação dentro da janela
set local role service_role;
do $$
declare
  r jsonb;
begin
  -- x.png voltou a candidate (arquivamento falhou); sua prova começa em 01/08.
  assert (public._ev('x.png') ->> 'first_scan') = 'scan-20260801T000000Z', 'FALHA: prova de x.png deveria começar em 01/08';

  -- Invalidar a varredura mais recente: candidatos perdem a prova e voltam a observing.
  r := public.storage_lifecycle_invalidate_scan('scan-20260915T000000Z', 'teste: falha descoberta depois', 'teste');
  assert (r ->> 'candidates_downgraded')::int = 1, 'FALHA: x.png deveria ser rebaixado: ' || r::text;
  assert (select state from public.storage_object_lifecycle where object_path = 'x.png') = 'observing', 'FALHA: x.png deveria voltar a observing';
  assert public._ev('x.png') ->> 'reason' = 'a varredura mais recente está incompleta ou invalidada', 'FALHA: última invalidada bloqueia';
  raise notice 'ok: invalidar a varredura mais recente rebaixa o candidato para observing';

  -- Nova varredura válida (16/09): a prova volta a existir, ainda contando 01/08.
  perform public.storage_lifecycle_register_scan(public._ev_scan('scan-20260916T000000Z', '2026-09-16T00:00:00Z', 4), 'teste');
  perform public.storage_lifecycle_sync_scan('scan-20260916T000000Z', jsonb_build_array(
    public._ev_obj('x.png', 'observing'), public._ev_obj('y.png', 'observing'), public._ev_obj('m.png', 'observing'), public._ev_obj('n.png', 'observing')), 'teste');
  assert (public._ev('x.png') ->> 'eligible')::boolean, 'FALHA: x.png deveria ter prova de 01/08 a 16/09: ' || public._ev('x.png')::text;

  -- Invalidar 01/08, dentro da janela: sobram 20/08 → 16/09 (27 dias) e a observação recomeça.
  r := public.storage_lifecycle_invalidate_scan('scan-20260801T000000Z', 'teste: inventário incompleto descoberto depois', 'teste');
  assert (r ->> 'objects_reset')::int >= 1, 'FALHA: observação iniciada em 01/08 deveria ser reiniciada';
  assert (select state from public.storage_object_lifecycle where object_path = 'x.png') = 'unverified', 'FALHA: x.png deveria ficar unverified';
  assert public._ev('x.png') ->> 'reason' = 'intervalo entre as varreduras menor que o prazo de segurança',
    'FALHA: sem 01/08 restam 27 dias: ' || public._ev('x.png')::text;
  raise notice 'ok: invalidar uma varredura da janela retira a prova (27 dias < 30)';
end;
$$;
select public._lifecycle_expect_error($q$select public.storage_lifecycle_begin_operation('arq-x-2', 'archive_copy', 'game-images', 'x.png', 'teste', 'arquivar')$q$, '23514', 'arquivar depois de perder a prova');
reset role;

-- ------------------------------------------------------------------ cadeia de hash com ponta travada
do $$
begin
  assert (select count(*) from public.storage_operation_log_verify()) = 0, 'FALHA: cadeia íntegra';
  assert (select last_entry_hash from public.storage_operation_log_head) = (select entry_hash from public.storage_operation_log order by id desc limit 1),
    'FALHA: a ponta deveria ser o último registro';
  raise notice 'ok: cadeia íntegra e ponta igual ao último registro (% registros)', (select count(*) from public.storage_operation_log);
end;
$$;
alter table public.storage_operation_log disable trigger storage_operation_log_no_change;
delete from public.storage_operation_log where id = (select min(id) + 3 from public.storage_operation_log);
alter table public.storage_operation_log enable trigger storage_operation_log_no_change;
do $$
begin
  assert exists (select 1 from public.storage_operation_log_verify() where problem like 'a cadeia percorre%'),
    'FALHA: remoção de um registro deveria quebrar o percurso da cadeia';
  raise notice 'ok: remoção de registro por fora das regras é detectada pela cadeia';
end;
$$;

rollback;

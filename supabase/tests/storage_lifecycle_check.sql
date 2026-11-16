-- Confere a estrutura do ciclo de vida das imagens (migração 20261114_create_storage_image_lifecycle).
-- SOMENTE PARA BANCO LOCAL DE TESTE: cria linhas fictícias e termina em rollback.
-- Espera os papéis anon, authenticated e service_role e as tabelas achievements e games.
-- Qualquer falha interrompe com "FALHA ..."; cada verificação aprovada emite "ok: ...".
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

create function public._lifecycle_scan(p_id text, p_at text, p_count integer, p_complete boolean default true)
returns jsonb language sql immutable as $$
  select jsonb_build_object('scan_id', p_id, 'completed_at', p_at, 'complete', p_complete,
    'inventory_status', case when p_complete then 'complete' else 'partial' end,
    'image_objects', p_count, 'image_bytes', p_count * 1000, 'report_sha256', repeat('f', 64));
$$;

create function public._lifecycle_obj(p_path text, p_state text, p_refs integer default 0, p_sha text default null)
returns jsonb language sql immutable as $$
  select jsonb_build_object('bucket', 'achievement-art', 'path', p_path, 'state', p_state, 'size', 1000,
    'mimetype', 'image/png', 'sha256', p_sha, 'reference_count', p_refs,
    'protected_reason', case when p_state = 'protected' then 'arte correta do Mouse' end);
$$;

-- ------------------------------------------------------------------ estrutura e acesso
do $$
begin
  assert (select bool_and(relrowsecurity) from pg_class where relname in ('storage_lifecycle_scans', 'storage_object_lifecycle', 'storage_operation_log')),
    'FALHA: RLS deveria estar ligado nas três tabelas';
  assert not exists (select 1 from pg_policies where tablename in ('storage_lifecycle_scans', 'storage_object_lifecycle', 'storage_operation_log')),
    'FALHA: não deveria haver política (nenhum acesso por RLS)';
  assert not exists (
    select 1 from information_schema.role_table_grants
    where table_name in ('storage_lifecycle_scans', 'storage_object_lifecycle', 'storage_operation_log', 'storage_lifecycle_pending_operations')
      and grantee in ('anon', 'authenticated', 'PUBLIC')
  ), 'FALHA: anon/authenticated não deveriam ter privilégio nas tabelas';
  assert not exists (
    select 1 from information_schema.role_table_grants
    where table_name in ('storage_lifecycle_scans', 'storage_object_lifecycle', 'storage_operation_log')
      and grantee = 'service_role' and privilege_type <> 'SELECT'
  ), 'FALHA: service_role deveria ter só SELECT nas tabelas';
  raise notice 'ok: RLS ligado, sem políticas, sem privilégios públicos, service_role só lê';
end;
$$;

set local role anon;
select public._lifecycle_expect_error('select * from public.storage_operation_log', '42501', 'anon lê auditoria');
select public._lifecycle_expect_error('select * from public.storage_object_lifecycle', '42501', 'anon lê estado dos objetos');
select public._lifecycle_expect_error('select * from public.storage_lifecycle_scans', '42501', 'anon lê varreduras');
select public._lifecycle_expect_error('select * from public.storage_lifecycle_pending_operations', '42501', 'anon lê pendências');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_register_scan(public._lifecycle_scan('scan-20260801T000000Z', '2026-08-01T00:00:00Z', 0), 'anon')$q$, '42501', 'anon registra varredura');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_begin_operation('k', 'archive_copy', 'a', 'b', 'anon', 'x')$q$, '42501', 'anon inicia operação');
select public._lifecycle_expect_error($q$insert into public.storage_operation_log (operation_id, phase, operation, actor, entry_hash) values (gen_random_uuid(), 'failed', 'scan_sync', 'x', 'x')$q$, '42501', 'anon grava auditoria');
reset role;

set local role authenticated;
select public._lifecycle_expect_error('select * from public.storage_operation_log', '42501', 'authenticated lê auditoria');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_replace_reference('k', 'games', 'x', 'image', null, null, 'u', 'x')$q$, '42501', 'authenticated troca referência');
select public._lifecycle_expect_error('select * from public.storage_operation_log_verify()', '42501', 'authenticated confere cadeia');
reset role;

-- ------------------------------------------------------------------ varreduras (como backend)
set local role service_role;
do $$
declare
  r jsonb;
begin
  r := public.storage_lifecycle_register_scan(public._lifecycle_scan('scan-20260901T000000Z', '2026-09-01T00:00:00Z', 4), 'teste');
  assert r ->> 'status' = 'registered', 'FALHA: registro de varredura válida';
  r := public.storage_lifecycle_register_scan(public._lifecycle_scan('scan-20260901T000000Z', '2026-09-01T00:00:00Z', 4), 'teste');
  assert r ->> 'status' = 'already_registered', 'FALHA: registro repetido deveria ser idempotente';
  assert (select count(*) from public.storage_operation_log where operation = 'scan_register') = 2, 'FALHA: registro repetido não deveria gravar nova auditoria';
  raise notice 'ok: varredura válida registrada; repetição idempotente sem nova auditoria';
end;
$$;
select public._lifecycle_expect_error($q$select public.storage_lifecycle_register_scan(public._lifecycle_scan('scan-20260901T000000Z', '2026-09-01T00:00:00Z', 5), 'teste')$q$, '23505', 'mesma varredura com dados diferentes');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_register_scan(jsonb_set(public._lifecycle_scan('scan-20260902T000000Z', '2026-09-02T00:00:00Z', 1), '{inventory_status}', '"partial"'), 'teste')$q$, '23514', 'varredura completa com inventário parcial');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_register_scan(public._lifecycle_scan('varredura-1', '2026-09-02T00:00:00Z', 1), 'teste')$q$, '23514', 'identificador fora do formato');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_register_scan(public._lifecycle_scan('scan-20260903T000000Z', '2026-09-03T00:00:00Z', 1), '  ')$q$, '23514', 'responsável vazio');

-- Primeira sincronização (s1).
select public._lifecycle_expect_error($q$select public.storage_lifecycle_sync_scan('scan-20260901T000000Z', jsonb_build_array(public._lifecycle_obj('a.png', 'referenced', 2)), 'teste')$q$, '22023', 'lista incompleta de objetos');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_sync_scan('scan-20260901T000000Z', jsonb_build_array(
  public._lifecycle_obj('a.png', 'apagado', 2), public._lifecycle_obj('b.png', 'observing'), public._lifecycle_obj('p.png', 'protected'), public._lifecycle_obj('s.png', 'superseded')), 'teste')$q$, '22023', 'estado inválido');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_sync_scan('scan-20260901T000000Z', jsonb_build_array(
  public._lifecycle_obj('../a.png', 'referenced', 2), public._lifecycle_obj('b.png', 'observing'), public._lifecycle_obj('p.png', 'protected'), public._lifecycle_obj('s.png', 'superseded')), 'teste')$q$, '22023', 'caminho com ..');

do $$
declare
  r jsonb;
begin
  r := public.storage_lifecycle_sync_scan('scan-20260901T000000Z', jsonb_build_array(
    public._lifecycle_obj('a.png', 'referenced', 2), public._lifecycle_obj('b.png', 'candidate', 0, repeat('a', 64)),
    public._lifecycle_obj('p.png', 'protected'), public._lifecycle_obj('s.png', 'superseded')), 'teste');
  assert (r ->> 'inserted')::int = 4, 'FALHA: deveria inserir 4 objetos';
  -- 3.3: objeto novo pedido como candidato é corrigido só para ele (antes recusava o lote).
  assert (r ->> 'overrides')::int = 1 and (select state from public.storage_object_lifecycle where object_path = 'b.png') = 'observing'
     and exists (select 1 from public.storage_operation_log where operation = 'classification_override' and object_path = 'b.png'
                 and state_before = 'candidate' and state_after = 'observing' and phase = 'intent'),
    'FALHA: objeto novo como candidato deveria virar observing com diagnóstico: ' || r::text;
  raise notice 'ok: objeto novo já como candidato → corrigido para observing, com diagnóstico, sem bloquear o lote';
  r := public.storage_lifecycle_sync_scan('scan-20260901T000000Z', '[]'::jsonb, 'teste');
  assert r ->> 'status' = 'already_synced', 'FALHA: sincronização repetida deveria ser idempotente';
  assert (select observing_since from public.storage_object_lifecycle where object_path = 'b.png') = '2026-09-01T00:00:00Z',
    'FALHA: observação de b.png deveria começar em s1';
  assert (select safety_deadline from public.storage_object_lifecycle where object_path = 'b.png') = '2026-10-01T00:00:00Z',
    'FALHA: prazo de segurança deveria ser s1 + 30 dias';
  raise notice 'ok: s1 sincronizada (4 objetos), repetição idempotente, prazo calculado';

  -- s2: b.png vira candidato (duas varreduras, prazo vencido).
  perform public.storage_lifecycle_register_scan(public._lifecycle_scan('scan-20261015T000000Z', '2026-10-15T00:00:00Z', 4), 'teste');
end;
$$;
do $$
begin
  perform public.storage_lifecycle_sync_scan('scan-20261015T000000Z', jsonb_build_array(
    public._lifecycle_obj('a.png', 'referenced', 2), public._lifecycle_obj('b.png', 'candidate', 0, repeat('a', 64)),
    public._lifecycle_obj('p.png', 'referenced', 1), public._lifecycle_obj('s.png', 'superseded')), 'teste');
  -- 3.3: o classificador tentou tirar a proteção de p.png; o banco mantém e registra.
  assert (select state from public.storage_object_lifecycle where object_path = 'p.png') = 'protected'
     and exists (select 1 from public.storage_operation_log where operation = 'classification_override' and object_path = 'p.png' and state_after = 'protected'),
    'FALHA: objeto protegido deveria continuar protegido, com diagnóstico';
  raise notice 'ok: objeto protegido perde proteção por sincronização → proteção mantida, com diagnóstico';
  assert (select state from public.storage_object_lifecycle where object_path = 'b.png') = 'candidate', 'FALHA: b.png deveria ser candidato em s2';
  assert (select count(*) from public.storage_operation_log where operation = 'state_change' and object_path = 'b.png' and phase = 'succeeded') = 1,
    'FALHA: mudança de estado deveria ser auditada';
  assert (select count(*) from public.storage_operation_log where operation = 'state_change' and object_path = 'a.png') = 0,
    'FALHA: objeto sem mudança de estado não deveria gerar auditoria por varredura';
  raise notice 'ok: s2 torna b.png candidato e audita só a mudança de estado';

  -- s3: a.png perde as referências e passa a ser observado a partir de s3.
  perform public.storage_lifecycle_register_scan(public._lifecycle_scan('scan-20261110T000000Z', '2026-11-10T00:00:00Z', 4), 'teste');
  perform public.storage_lifecycle_sync_scan('scan-20261110T000000Z', jsonb_build_array(
    public._lifecycle_obj('a.png', 'observing', 0), public._lifecycle_obj('b.png', 'candidate', 0, repeat('a', 64)),
    public._lifecycle_obj('p.png', 'protected'), public._lifecycle_obj('s.png', 'superseded')), 'teste');
  perform public.storage_lifecycle_register_scan(public._lifecycle_scan('scan-20261112T000000Z', '2026-11-12T00:00:00Z', 4), 'teste');
  perform public.storage_lifecycle_register_scan(public._lifecycle_scan('scan-20260801T000000Z', '2026-08-01T00:00:00Z', 4), 'teste');
  perform public.storage_lifecycle_register_scan(public._lifecycle_scan('scan-20261111T000000Z', '2026-11-11T00:00:00Z', 4, false), 'teste');
end;
$$;
select public._lifecycle_expect_error($q$select public.storage_lifecycle_sync_scan('scan-20260801T000000Z', jsonb_build_array(
  public._lifecycle_obj('a.png', 'referenced', 1), public._lifecycle_obj('b.png', 'observing'), public._lifecycle_obj('p.png', 'protected'), public._lifecycle_obj('s.png', 'superseded')), 'teste')$q$, '55000', 'varredura antiga aplicada fora de ordem');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_sync_scan('scan-20261111T000000Z', '[]'::jsonb, 'teste')$q$, '22023', 'varredura incompleta usada como evidência');
do $$
begin
  perform public.storage_lifecycle_sync_scan('scan-20261112T000000Z', jsonb_build_array(
    public._lifecycle_obj('a.png', 'candidate', 0), public._lifecycle_obj('b.png', 'candidate', 0, repeat('a', 64)),
    public._lifecycle_obj('p.png', 'protected'), public._lifecycle_obj('s.png', 'superseded')), 'teste');
  -- 3.3: a.png pedido como candidato antes do prazo vira observing (antes recusava o lote).
  assert (select state from public.storage_object_lifecycle where object_path = 'a.png') = 'observing'
     and (select state from public.storage_object_lifecycle where object_path = 'b.png') = 'candidate'
     and exists (select 1 from public.storage_operation_log where operation = 'classification_override' and object_path = 'a.png'
                 and scan_id = 'scan-20261112T000000Z' and reason like 'candidato sem prova: intervalo%'),
    'FALHA: candidato antes do prazo deveria virar observing, com diagnóstico, sem afetar b.png';
  raise notice 'ok: candidato antes do prazo de 30 dias → corrigido para observing; b.png (com prova) continua candidato';
  assert (select observing_since_scan_id from public.storage_object_lifecycle where object_path = 'a.png') = 'scan-20261110T000000Z',
    'FALHA: observação de a.png deveria continuar desde s3';
  raise notice 'ok: observação continua entre varreduras válidas';
end;
$$;

-- ------------------------------------------------------------------ escrita direta bloqueada
select public._lifecycle_expect_error($q$update public.storage_object_lifecycle set state = 'candidate' where object_path = 'a.png'$q$, '42501', 'backend altera estado direto');
select public._lifecycle_expect_error($q$insert into public.storage_operation_log (operation_id, phase, operation, actor, entry_hash) values (gen_random_uuid(), 'failed', 'scan_sync', 'x', 'x')$q$, '42501', 'backend grava auditoria direto');
select public._lifecycle_expect_error($q$delete from public.storage_operation_log$q$, '42501', 'backend apaga auditoria');
reset role;

-- Mesmo o proprietário dedicado (assumido por um administrador) não altera nem apaga auditoria.
set local role storage_lifecycle_owner;
select public._lifecycle_expect_error($q$update public.storage_operation_log set reason = 'alterado'$q$, '42501', 'dono altera auditoria');
select public._lifecycle_expect_error($q$delete from public.storage_operation_log$q$, '42501', 'dono apaga auditoria');
select public._lifecycle_expect_error($q$truncate public.storage_operation_log$q$, '42501', 'dono esvazia auditoria');
select public._lifecycle_expect_error($q$update public.storage_lifecycle_scans set complete = false$q$, '42501', 'dono altera varredura');
select public._lifecycle_expect_error($q$delete from public.storage_lifecycle_scans$q$, '42501', 'dono apaga varredura');
select public._lifecycle_expect_error($q$delete from public.storage_object_lifecycle$q$, '42501', 'dono apaga estado de objeto');
select public._lifecycle_expect_error($q$update public.storage_object_lifecycle set archive_state = 'deleted' where object_path = 'b.png'$q$, '23514', 'pular de none para deleted');
select public._lifecycle_expect_error($q$update public.storage_object_lifecycle set object_path = 'outro.png' where object_path = 'b.png'$q$, '23514', 'trocar identidade do objeto');
reset role;
-- Superusuário sem assumir o proprietário: a antiga variável de sessão não libera mais nada.
select set_config('app.storage_lifecycle_writer', 'on', true);
select public._lifecycle_expect_error($q$insert into public.storage_object_lifecycle (bucket, object_path, state, first_seen_at, first_seen_scan_id, last_seen_at, last_seen_scan_id)
  values ('achievement-art', 'x.png', 'referenced', now(), 'scan-20260901T000000Z', now(), 'scan-20260901T000000Z')$q$, '42501', 'dono insere objeto sem passar pelas funções');

-- ------------------------------------------------------------------ arquivamento, remoção e restauração
set local role service_role;
select public._lifecycle_expect_error($q$select public.storage_lifecycle_begin_operation('arq-a', 'archive_copy', 'achievement-art', 'a.png', 'teste', 'arquivar')$q$, '23514', 'arquivar objeto ainda em observação');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_begin_operation('arq-p', 'archive_copy', 'achievement-art', 'p.png', 'teste', 'arquivar')$q$, '23514', 'arquivar objeto protegido');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_begin_operation('del-b', 'delete_object', 'achievement-art', 'b.png', 'teste', 'remover')$q$, '23514', 'remover original sem arquivar antes');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_begin_operation('arq-b', 'archive_copy', 'achievement-art', 'b.png', 'teste', '  ')$q$, '23514', 'operação sem motivo');
do $$
declare
  r jsonb;
  op uuid;
begin
  r := public.storage_lifecycle_begin_operation('arq-b', 'archive_copy', 'achievement-art', 'b.png', 'teste', 'arquivar candidato');
  assert r ->> 'status' = 'started', 'FALHA: arquivamento deveria iniciar';
  op := (r ->> 'operation_id')::uuid;
  r := public.storage_lifecycle_begin_operation('arq-b', 'archive_copy', 'achievement-art', 'b.png', 'teste', 'arquivar candidato');
  assert r ->> 'status' = 'pending' and (r ->> 'operation_id')::uuid = op, 'FALHA: repetir a chave deveria devolver a operação pendente';
  assert (select count(*) from public.storage_lifecycle_pending_operations) = 1, 'FALHA: deveria haver 1 operação pendente (retomada)';
  assert (select archive_state from public.storage_object_lifecycle where object_path = 'b.png') = 'archiving', 'FALHA: deveria estar archiving';
  raise notice 'ok: arquivamento iniciado com intenção registrada; chave repetida devolve a pendência';
end;
$$;
select public._lifecycle_expect_error($q$select public.storage_lifecycle_begin_operation('arq-b-2', 'archive_copy', 'achievement-art', 'b.png', 'teste', 'de novo')$q$, '55000', 'segunda operação com outra pendente');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_begin_operation('arq-b', 'delete_object', 'achievement-art', 'b.png', 'teste', 'x')$q$, '23505', 'mesma chave para outra operação');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_finish_operation((select operation_id from public.storage_lifecycle_pending_operations), 'succeeded', 'teste', '{}'::jsonb)$q$, '22023', 'arquivamento concluído sem local da cópia');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_finish_operation((select operation_id from public.storage_lifecycle_pending_operations), 'succeeded', 'teste',
  jsonb_build_object('archive_bucket', 'image-archive', 'archive_path', 'b.png', 'archive_sha256', repeat('b', 64), 'restore', jsonb_build_object('content_type', 'image/png')))$q$, '23514', 'cópia arquivada com hash diferente');
do $$
declare
  op uuid := (select operation_id from public.storage_lifecycle_pending_operations);
  r jsonb;
begin
  r := public.storage_lifecycle_finish_operation(op, 'succeeded', 'teste',
    jsonb_build_object('archive_bucket', 'image-archive', 'archive_path', 'achievement-art/b.png', 'archive_sha256', repeat('a', 64),
      'restore', jsonb_build_object('content_type', 'image/png', 'cache_control', '31536000')));
  assert r ->> 'archive_state' = 'archived', 'FALHA: deveria ficar archived';
  r := public.storage_lifecycle_finish_operation(op, 'succeeded', 'teste', '{}'::jsonb);
  assert r ->> 'status' = 'already_finished', 'FALHA: concluir de novo deveria ser idempotente';
  assert (select count(*) from public.storage_lifecycle_pending_operations) = 0, 'FALHA: não deveria sobrar pendência';
  raise notice 'ok: arquivamento concluído com hash conferido; conclusão repetida idempotente';
end;
$$;
select public._lifecycle_expect_error($q$select public.storage_lifecycle_finish_operation((select operation_id from public.storage_operation_log where idempotency_key = 'arq-b'), 'failed', 'teste')$q$, '23505', 'trocar o resultado de operação concluída');
do $$
declare
  r jsonb;
begin
  r := public.storage_lifecycle_begin_operation('del-b', 'delete_object', 'achievement-art', 'b.png', 'teste', 'remover original arquivado');
  perform public.storage_lifecycle_finish_operation((r ->> 'operation_id')::uuid, 'succeeded', 'teste');
  assert (select archive_state from public.storage_object_lifecycle where object_path = 'b.png') = 'deleted', 'FALHA: deveria ficar deleted';
  assert (select archive_path from public.storage_object_lifecycle where object_path = 'b.png') = 'achievement-art/b.png', 'FALHA: local da cópia deveria ficar guardado';
  raise notice 'ok: original removido só depois de arquivado; dados de restauração preservados';
end;
$$;
select public._lifecycle_expect_error($q$select public.storage_lifecycle_begin_operation('arq-b-3', 'archive_copy', 'achievement-art', 'b.png', 'teste', 'x')$q$, '23514', 'arquivar objeto já removido');
reset role;
insert into public.games (slug, image) values ('jogo-removido', '/images/x.jpg');
set local role service_role;
select public._lifecycle_expect_error($q$select public.storage_lifecycle_replace_reference('ref-0', 'games', 'jogo-removido', 'image', '/images/x.jpg',
  'https://x.supabase.co/storage/v1/object/public/achievement-art/b.png', 'teste', 'apontar para removido')$q$, '23514', 'nova referência para objeto removido');

-- Objeto ausente: s5 sem s.png (b.png removido não conta).
do $$
declare
  r jsonb;
begin
  perform public.storage_lifecycle_register_scan(public._lifecycle_scan('scan-20261113T000000Z', '2026-11-13T00:00:00Z', 2), 'teste');
  r := public.storage_lifecycle_sync_scan('scan-20261113T000000Z', jsonb_build_array(
    public._lifecycle_obj('a.png', 'observing', 0), public._lifecycle_obj('p.png', 'protected')), 'teste');
  assert (r ->> 'missing')::int = 1, 'FALHA: s.png deveria ser registrado como ausente';
  assert exists (select 1 from public.storage_object_lifecycle where object_path = 's.png'), 'FALHA: ausência não apaga a linha';
  raise notice 'ok: objeto ausente registrado sem apagar nada';
end;
$$;

select public._lifecycle_expect_error($q$select public.storage_lifecycle_finish_operation(
  (public.storage_lifecycle_begin_operation('rest-b', 'restore_object', 'achievement-art', 'b.png', 'teste', 'restaurar') ->> 'operation_id')::uuid,
  'succeeded', 'teste', jsonb_build_object('restored_sha256', repeat('c', 64)))$q$, '23514', 'restauração com hash diferente');
do $$
declare
  r jsonb;
begin
  r := public.storage_lifecycle_begin_operation('rest-b', 'restore_object', 'achievement-art', 'b.png', 'teste', 'restaurar');
  perform public.storage_lifecycle_finish_operation((r ->> 'operation_id')::uuid, 'succeeded', 'teste', jsonb_build_object('restored_sha256', repeat('a', 64)));
  assert (select (archive_state, state) = ('none', 'unverified') from public.storage_object_lifecycle where object_path = 'b.png'),
    'FALHA: restaurado deveria voltar a none/unverified';
  raise notice 'ok: restauração conferida pelo hash; objeto volta sem estado de evidência';
end;
$$;

-- ------------------------------------------------------------------ invalidação de varredura
do $$
declare
  r jsonb;
begin
  r := public.storage_lifecycle_invalidate_scan('scan-20261110T000000Z', 'teste de invalidação', 'teste');
  assert (r ->> 'objects_reset')::int = 1, 'FALHA: a.png (observado desde s3) deveria ser reiniciado';
  assert not public.storage_lifecycle_scan_is_valid('scan-20261110T000000Z'), 'FALHA: varredura invalidada não vale como evidência';
  assert (select (state, observing_since) is not distinct from ('unverified'::text, null::timestamptz) from public.storage_object_lifecycle where object_path = 'a.png'),
    'FALHA: a.png deveria ficar unverified sem início de observação';
  assert exists (select 1 from public.storage_lifecycle_scans where scan_id = 'scan-20261110T000000Z' and complete),
    'FALHA: o registro original da varredura deveria continuar intacto';
  r := public.storage_lifecycle_invalidate_scan('scan-20261110T000000Z', 'de novo', 'teste');
  assert r ->> 'status' = 'already_invalidated', 'FALHA: invalidação repetida deveria ser idempotente';
  raise notice 'ok: invalidação append-only reinicia a observação e preserva o registro original';
end;
$$;

-- ------------------------------------------------------------------ troca de referência atômica
reset role;
insert into public.achievements (id, image) values ('00000000-0000-0000-0000-000000000001', 'https://x.supabase.co/storage/v1/object/public/achievement-art/a.png?v=2');
insert into public.games (slug, image) values ('jogo-teste', '/images/local.jpg');
set local role service_role;
select public._lifecycle_expect_error($q$select public.storage_lifecycle_replace_reference('ref-1', 'achievements', '00000000-0000-0000-0000-000000000001', 'title', null, 'x', 'teste', 'x')$q$, '22023', 'coluna fora da lista permitida');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_replace_reference('ref-1', 'achievements', '00000000-0000-0000-0000-000000000001', 'image', 'valor-antigo-errado', 'nova', 'teste', 'trocar')$q$, '40001', 'valor esperado diferente do atual');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_replace_reference('ref-1', 'achievements', '00000000-0000-0000-0000-000000000001', 'image',
  'https://x.supabase.co/storage/v1/object/public/achievement-art/a.png?v=2', 'nova', '', 'trocar')$q$, '23514', 'troca com falha na auditoria (responsável vazio)');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_replace_reference('ref-2', 'achievements', '00000000-0000-0000-0000-000000000001', 'image',
  'https://x.supabase.co/storage/v1/object/public/achievement-art/a.png?v=2', null, 'teste', 'remover')$q$, '23502', 'remoção que viola NOT NULL');
reset role;
do $$
begin
  assert (select image from public.achievements where id = '00000000-0000-0000-0000-000000000001') = 'https://x.supabase.co/storage/v1/object/public/achievement-art/a.png?v=2',
    'FALHA: referência não deveria mudar quando a operação falha';
  assert not exists (select 1 from public.storage_operation_log where idempotency_key in ('ref-1', 'ref-2')),
    'FALHA: operação desfeita não deveria deixar intenção órfã';
  raise notice 'ok: falha na auditoria ou na alteração desfaz tudo (referência e registro)';
end;
$$;
set local role service_role;
do $$
declare
  r jsonb;
begin
  r := public.storage_lifecycle_replace_reference('ref-3', 'achievements', '00000000-0000-0000-0000-000000000001', 'image',
    'https://x.supabase.co/storage/v1/object/public/achievement-art/a.png?v=2', 'https://x.supabase.co/storage/v1/object/public/achievement-art/a.1234567890abcdef.webp', 'teste', 'trocar por WebP');
  assert r ->> 'status' = 'applied', 'FALHA: troca válida deveria ser aplicada';
  assert (select details ->> 'old_value' from public.storage_operation_log where idempotency_key = 'ref-3') = 'https://x.supabase.co/storage/v1/object/public/achievement-art/a.png?v=2',
    'FALHA: valor anterior deveria estar na intenção';
  assert (select details ->> 'old_object' from public.storage_operation_log where idempotency_key = 'ref-3') = 'achievement-art/a.png',
    'FALHA: objeto anterior deveria ser normalizado (sem ?v=)';
  assert (select min(phase) || ',' || max(phase) from public.storage_operation_log where operation_id = (r ->> 'operation_id')::uuid) = 'intent,succeeded',
    'FALHA: troca deveria ter intenção e resultado';
  r := public.storage_lifecycle_replace_reference('ref-3', 'achievements', '00000000-0000-0000-0000-000000000001', 'image',
    'https://x.supabase.co/storage/v1/object/public/achievement-art/a.png?v=2', 'https://x.supabase.co/storage/v1/object/public/achievement-art/a.1234567890abcdef.webp', 'teste', 'trocar por WebP');
  assert r ->> 'status' = 'already_applied', 'FALHA: repetir a chave deveria ser idempotente';
  assert (select count(*) from public.storage_operation_log where idempotency_key = 'ref-3') = 1, 'FALHA: repetição não deveria gravar outra intenção';
  r := public.storage_lifecycle_replace_reference('ref-4', 'games', 'jogo-teste', 'image', '/images/local.jpg', '/images/outra.jpg', 'teste', 'trocar capa');
  assert r ->> 'status' = 'applied', 'FALHA: troca em games deveria funcionar';
  raise notice 'ok: troca registra o valor anterior antes de alterar, é idempotente e normaliza a chave';
end;
$$;
reset role;

-- ------------------------------------------------------------------ consistência e integridade
do $$
declare
  problems integer;
begin
  assert not exists (
    select 1 from public.storage_operation_log as result
    where result.phase <> 'intent'
      and not exists (select 1 from public.storage_operation_log as intent where intent.operation_id = result.operation_id and intent.phase = 'intent')
  ), 'FALHA: todo resultado deveria ter intenção';
  assert not exists (
    select 1 from public.storage_object_lifecycle as obj
    where obj.last_operation_id is not null
      and not exists (select 1 from public.storage_operation_log as log where log.operation_id = obj.last_operation_id)
  ), 'FALHA: toda última operação de objeto deveria existir na auditoria';
  assert not exists (
    select 1 from public.storage_object_lifecycle as obj
    where obj.archive_state <> 'none'
      and not exists (select 1 from public.storage_operation_log as log where log.bucket = obj.bucket and log.object_path = obj.object_path and log.operation = 'archive_copy' and log.phase = 'succeeded')
  ), 'FALHA: objeto com arquivamento deveria ter arquivamento concluído na auditoria';
  assert (select count(*) from public.storage_lifecycle_pending_operations) = 0, 'FALHA: não deveria sobrar pendência';
  select count(*) into problems from public.storage_operation_log_verify();
  assert problems = 0, 'FALHA: cadeia de hash deveria estar íntegra';
  raise notice 'ok: objetos e operações consistentes; cadeia de hash íntegra (% registros)', (select count(*) from public.storage_operation_log);
end;
$$;

-- Adulteração por fora (desligando o gatilho como superusuário) é detectada pela cadeia.
alter table public.storage_operation_log disable trigger storage_operation_log_no_change;
update public.storage_operation_log set reason = 'adulterado' where idempotency_key = 'ref-3';
alter table public.storage_operation_log enable trigger storage_operation_log_no_change;
do $$
begin
  assert (select count(*) from public.storage_operation_log_verify()) = 1, 'FALHA: adulteração deveria ser detectada';
  raise notice 'ok: adulteração fora das regras é detectada pela cadeia de hash';
end;
$$;

rollback;

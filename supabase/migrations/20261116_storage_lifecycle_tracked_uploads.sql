-- Ciclo de vida das imagens — envios rastreados e lotes de troca de referência (Etapa 4.1).
-- Complementa 20261114_create_storage_image_lifecycle.sql (precisa dela aplicada). Rollback:
-- supabase/rollbacks/20261116_storage_lifecycle_tracked_uploads_rollback.sql
--
-- O que acrescenta (nada é removido nem reescrito):
--   1. Dois tipos de operação na auditoria: object_upload e reference_batch.
--   2. Objetos que nascem de um envio rastreado: sem varredura de origem, sempre "unverified"
--      até uma varredura classificá-los (nunca candidatos, nunca referências inventadas).
--   3. storage_lifecycle_begin_upload / storage_lifecycle_finish_upload: intenção ANTES do envio
--      ao Storage e confirmação DEPOIS da verificação do objeto enviado (SHA-256 completo).
--   4. storage_lifecycle_begin_reference_batch / storage_lifecycle_finish_reference_batch:
--      agrupa as trocas de uma solicitação (cada uma continua sendo storage_lifecycle_replace_reference,
--      com chave própria). O lote só termina quando TODAS as trocas tiverem sucesso; até lá fica
--      pendente (storage_lifecycle_pending_operations) e pode ser retomado.
--
-- Mesmas garantias da migração principal: funções do proprietário dedicado, search_path vazio,
-- trava global de escrita antes de qualquer outra (storage_lifecycle_lock_key), auditoria
-- encadeada por hash (storage_lifecycle_append_log), executáveis só pelo service_role.
begin;

do $$
begin
  if pg_catalog.to_regclass('public.storage_operation_log') is null
     or pg_catalog.to_regprocedure('public.storage_lifecycle_replace_reference(text, text, text, text, text, text, text, text)') is null
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'storage_lifecycle_owner') then
    raise exception 'A migração principal 20261114_create_storage_image_lifecycle não está aplicada.';
  end if;
  if exists (select 1 from pg_catalog.pg_proc as p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('storage_lifecycle_begin_upload', 'storage_lifecycle_finish_upload',
                               'storage_lifecycle_begin_reference_batch', 'storage_lifecycle_finish_reference_batch')) then
    raise exception 'Funções de envio rastreado já existem: migração aplicada antes ou nomes ocupados.';
  end if;
end;
$$;

grant storage_lifecycle_owner to current_user;
set local role storage_lifecycle_owner;

-- 1. Tipos de operação --------------------------------------------------------------------------
alter table public.storage_operation_log drop constraint storage_operation_log_operation;
alter table public.storage_operation_log add constraint storage_operation_log_operation check (operation in (
  'scan_register', 'scan_invalidate', 'scan_sync', 'state_change', 'object_missing', 'classification_override',
  'manual_protect', 'manual_unprotect',
  'archive_copy', 'archive_cancel', 'delete_object', 'restore_object',
  'reference_replace', 'json_reference_replace',
  'object_upload', 'reference_batch'
));
alter table public.storage_operation_log drop constraint storage_operation_log_object_ops;
alter table public.storage_operation_log add constraint storage_operation_log_object_ops check (
  operation not in ('state_change', 'object_missing', 'classification_override', 'manual_protect', 'manual_unprotect',
                    'archive_copy', 'archive_cancel', 'delete_object', 'restore_object', 'object_upload') or bucket is not null
);

-- 2. Objetos nascidos de envio rastreado ---------------------------------------------------------
alter table public.storage_object_lifecycle alter column first_seen_scan_id drop not null;
alter table public.storage_object_lifecycle alter column last_seen_scan_id drop not null;
alter table public.storage_object_lifecycle add column registered_by_upload uuid;
comment on column public.storage_object_lifecycle.registered_by_upload is
  'Operação object_upload que registrou o objeto antes de qualquer varredura. Sem varredura, o objeto fica unverified.';
alter table public.storage_object_lifecycle add constraint storage_object_lifecycle_origin check (
  first_seen_scan_id is not null or registered_by_upload is not null
);
alter table public.storage_object_lifecycle add constraint storage_object_lifecycle_unscanned_unverified check (
  last_seen_scan_id is not null or (state = 'unverified' and registered_by_upload is not null and reference_count = 0)
);

-- 3. Envio rastreado ----------------------------------------------------------------------------
-- Registra a intenção ANTES do envio. O nome do arquivo precisa derivar do conteúdo
-- (<base>.<16 primeiros hex do SHA-256>.webp). Recusa caminho já conhecido com OUTRO SHA-256
-- completo (colisão de prefixo) e objeto em arquivamento. Repetir a chave devolve a operação.
create function public.storage_lifecycle_begin_upload(
  p_idempotency_key text, p_bucket text, p_object_path text, p_sha256 text, p_size bigint, p_mimetype text,
  p_actor text, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.storage_operation_log%rowtype;
  result_row public.storage_operation_log%rowtype;
  target public.storage_object_lifecycle%rowtype;
  target_exists boolean;
  op uuid := pg_catalog.gen_random_uuid();
begin
  if coalesce(pg_catalog.btrim(p_idempotency_key), '') = '' then
    raise exception 'Chave de idempotência obrigatória.' using errcode = '22023';
  end if;
  if not (p_bucket = any (public.storage_lifecycle_known_buckets())) then
    raise exception 'Bucket % fora do ciclo de vida.', p_bucket using errcode = '22023';
  end if;
  if p_object_path is null or p_object_path = '' or p_object_path ~ '^/' or p_object_path ~ '(^|/)\.{1,2}(/|$)'
     or p_object_path ~ '//' or pg_catalog.length(p_object_path) > 1024 then
    raise exception 'Caminho inválido: %', pg_catalog.left(coalesce(p_object_path, ''), 200) using errcode = '22023';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'SHA-256 completo (64 hex) obrigatório.' using errcode = '22023';
  end if;
  if p_object_path !~ ('\.' || pg_catalog.left(p_sha256, 16) || '\.webp$') then
    raise exception 'O nome do arquivo não deriva do SHA-256 informado.' using errcode = '22023';
  end if;
  if p_size is null or p_size <= 0 or coalesce(p_mimetype, '') !~ '^image/' then
    raise exception 'Tamanho e tipo de imagem obrigatórios.' using errcode = '22023';
  end if;

  perform public.storage_lifecycle_lock_key('key', p_idempotency_key);
  perform public.storage_lifecycle_lock_key('object', p_bucket || '/' || p_object_path);

  select * into existing from public.storage_operation_log as log where log.idempotency_key = p_idempotency_key and log.phase = 'intent';
  if found then
    if (existing.operation, existing.bucket, existing.object_path, existing.details ->> 'sha256')
       is distinct from ('object_upload'::text, p_bucket, p_object_path, p_sha256) then
      raise exception 'A chave % já pertence a outra operação.', p_idempotency_key using errcode = '23505';
    end if;
    select * into result_row from public.storage_operation_log as log where log.operation_id = existing.operation_id and log.phase <> 'intent';
    return pg_catalog.jsonb_build_object('status', coalesce(result_row.phase, 'pending'), 'operation_id', existing.operation_id,
      'result_details', result_row.details);
  end if;

  if exists (
    select 1 from public.storage_operation_log as intent
    where intent.operation = 'object_upload' and intent.phase = 'intent' and intent.bucket = p_bucket and intent.object_path = p_object_path
      and not exists (select 1 from public.storage_operation_log as done where done.operation_id = intent.operation_id and done.phase <> 'intent')
  ) then
    raise exception 'Já existe envio pendente para %/%; retome-o antes de outro.', p_bucket, p_object_path using errcode = '55000';
  end if;

  select * into target from public.storage_object_lifecycle as obj where obj.bucket = p_bucket and obj.object_path = p_object_path for update;
  target_exists := found;
  if target_exists and target.archive_state <> 'none' then
    raise exception 'Objeto %/% está em %.', p_bucket, p_object_path, target.archive_state using errcode = '23514';
  end if;
  if target_exists and target.sha256 is not null and target.sha256 <> p_sha256 then
    raise exception 'Colisão de prefixo: %/% já está registrado com outro SHA-256; nada foi alterado.', p_bucket, p_object_path
      using errcode = '23505', hint = 'storage_lifecycle: upload_hash_mismatch';
  end if;

  perform public.storage_lifecycle_append_log(op, 'intent', 'object_upload', p_idempotency_key, p_bucket, p_object_path, null, p_actor,
    coalesce(nullif(pg_catalog.btrim(p_reason), ''), 'envio rastreado'), target.state, coalesce(target.state, 'unverified'), null, null,
    pg_catalog.jsonb_build_object('sha256', p_sha256, 'size', p_size, 'mimetype', p_mimetype,
      'known_object', target_exists, 'known_sha256', target.sha256));
  return pg_catalog.jsonb_build_object('status', 'started', 'operation_id', op,
    'known_object', target_exists, 'known_sha256', target.sha256, 'known_state', target.state);
end;
$$;

-- Confirma (ou registra a falha de) um envio. Sucesso exige a evidência da verificação feita
-- pelo backend: o mesmo SHA-256 completo e o mesmo tamanho da intenção, por um método aceito:
--   uploaded_verified   o arquivo foi enviado agora e conferido no Storage (tamanho + SHA-256);
--   storage_metadata    o arquivo já existia e os metadados gravados no envio têm o mesmo SHA-256;
--   registered_identity o arquivo já existia e o banco já tinha o mesmo SHA-256 registrado.
-- Objeto novo entra como unverified, sem referências; objeto conhecido não muda de estado.
create function public.storage_lifecycle_finish_upload(p_operation_id uuid, p_result text, p_actor text, p_evidence jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent public.storage_operation_log%rowtype;
  result_row public.storage_operation_log%rowtype;
  target public.storage_object_lifecycle%rowtype;
  target_exists boolean;
  method text := p_evidence ->> 'method';
begin
  if p_result not in ('succeeded', 'failed') then
    raise exception 'Resultado inválido: %', p_result using errcode = '22023';
  end if;
  select * into intent from public.storage_operation_log as log where log.operation_id = p_operation_id and log.phase = 'intent';
  if not found or intent.operation <> 'object_upload' then
    raise exception 'Operação de envio % não encontrada.', p_operation_id using errcode = '22023';
  end if;
  perform public.storage_lifecycle_lock_key('key', intent.idempotency_key);
  perform public.storage_lifecycle_lock_key('object', intent.bucket || '/' || intent.object_path);

  select * into result_row from public.storage_operation_log as log where log.operation_id = p_operation_id and log.phase <> 'intent';
  if found then
    return pg_catalog.jsonb_build_object('status', 'already_finished', 'result', result_row.phase, 'operation_id', p_operation_id);
  end if;

  if p_result = 'failed' then
    perform public.storage_lifecycle_append_log(p_operation_id, 'failed', 'object_upload', null, intent.bucket, intent.object_path, null,
      p_actor, null, intent.state_before, intent.state_before, null, null, coalesce(p_evidence, '{}'::jsonb));
    return pg_catalog.jsonb_build_object('status', 'failed', 'operation_id', p_operation_id);
  end if;

  if method is null or method not in ('uploaded_verified', 'storage_metadata', 'registered_identity')
     or p_evidence ->> 'sha256' is distinct from intent.details ->> 'sha256'
     or (p_evidence ->> 'size') is distinct from (intent.details ->> 'size') then
    raise exception 'Evidência insuficiente para confirmar o envio % (método, SHA-256 completo e tamanho precisam conferir).', p_operation_id
      using errcode = '22023', hint = 'storage_lifecycle: upload_unverified';
  end if;

  select * into target from public.storage_object_lifecycle as obj
  where obj.bucket = intent.bucket and obj.object_path = intent.object_path for update;
  target_exists := found;
  if target_exists and target.sha256 is not null and target.sha256 <> intent.details ->> 'sha256' then
    raise exception 'Colisão de prefixo detectada na confirmação de %/%.', intent.bucket, intent.object_path
      using errcode = '23505', hint = 'storage_lifecycle: upload_hash_mismatch';
  end if;
  if method = 'registered_identity' and (not target_exists or target.sha256 is distinct from intent.details ->> 'sha256') then
    raise exception 'Identidade registrada não confere para %/%.', intent.bucket, intent.object_path using errcode = '22023';
  end if;
  if target_exists and target.archive_state <> 'none' then
    raise exception 'Objeto %/% está em %.', intent.bucket, intent.object_path, target.archive_state using errcode = '23514';
  end if;

  if not target_exists then
    insert into public.storage_object_lifecycle (
      bucket, object_path, state, size_bytes, mimetype, sha256, first_seen_at, first_seen_scan_id, last_seen_at, last_seen_scan_id,
      reference_count, registered_by_upload, last_operation_id
    ) values (
      intent.bucket, intent.object_path, 'unverified', (intent.details ->> 'size')::bigint, intent.details ->> 'mimetype',
      -- Data da INTENÇÃO: o arquivo não pode existir no Storage antes dela, então nenhuma varredura
      -- que o encontre termina antes desta data (mantém last_seen_at >= first_seen_at).
      intent.details ->> 'sha256', intent.occurred_at, null, intent.occurred_at, null, 0, p_operation_id, p_operation_id
    );
  elsif target.sha256 is null then
    -- Já conhecido por varredura, sem hash: a evidência verificada do envio permite registrá-lo.
    update public.storage_object_lifecycle as obj set sha256 = intent.details ->> 'sha256', last_operation_id = p_operation_id
    where obj.bucket = intent.bucket and obj.object_path = intent.object_path;
  end if;

  perform public.storage_lifecycle_append_log(p_operation_id, 'succeeded', 'object_upload', null, intent.bucket, intent.object_path, null,
    p_actor, null, target.state, coalesce(target.state, 'unverified'), null, null,
    p_evidence || pg_catalog.jsonb_build_object('registered', not target_exists));
  return pg_catalog.jsonb_build_object('status', 'succeeded', 'operation_id', p_operation_id, 'registered', not target_exists,
    'state', coalesce(target.state, 'unverified'));
end;
$$;

-- 4. Lotes de troca de referência ---------------------------------------------------------------
-- Itens: [{key, table, row_key, column, old_value, new_value}]. A identidade do lote é a lista
-- (key, table, row_key, column, new_value); old_value fica registrado como valor anterior.
-- Repetir a chave devolve os itens ORIGINAIS (com os valores anteriores da primeira vez).
create function public.storage_lifecycle_begin_reference_batch(p_idempotency_key text, p_actor text, p_reason text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.storage_operation_log%rowtype;
  result_phase text;
  item jsonb;
  op uuid := pg_catalog.gen_random_uuid();
  identity_new jsonb;
  identity_old jsonb;
begin
  if coalesce(pg_catalog.btrim(p_idempotency_key), '') = '' then
    raise exception 'Chave de idempotência obrigatória.' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_items) is distinct from 'array' or pg_catalog.jsonb_array_length(p_items) = 0
     or pg_catalog.jsonb_array_length(p_items) > 500 then
    raise exception 'Lote vazio, inválido ou grande demais.' using errcode = '22023';
  end if;
  for item in select value from pg_catalog.jsonb_array_elements(p_items) loop
    if pg_catalog.jsonb_typeof(item -> 'key') is distinct from 'string' or coalesce(pg_catalog.btrim(item ->> 'key'), '') = ''
       or coalesce(item ->> 'row_key', '') = '' or pg_catalog.jsonb_typeof(item -> 'new_value') is distinct from 'string'
       or not ((item ->> 'table', item ->> 'column') in (('achievements', 'image'), ('achievements', 'official_image'),
                                                          ('achievement_progress', 'image_override'), ('games', 'image'), ('games', 'card_image'))) then
      raise exception 'Item de lote inválido: %', pg_catalog.left(item::text, 300) using errcode = '22023';
    end if;
  end loop;
  if (select pg_catalog.count(distinct value ->> 'key') from pg_catalog.jsonb_array_elements(p_items)) <> pg_catalog.jsonb_array_length(p_items) then
    raise exception 'Chaves repetidas no lote.' using errcode = '22023';
  end if;

  perform public.storage_lifecycle_lock_key('key', p_idempotency_key);
  select * into existing from public.storage_operation_log as log where log.idempotency_key = p_idempotency_key and log.phase = 'intent';
  if found then
    select pg_catalog.jsonb_agg(value - 'old_value' order by value ->> 'key') into identity_old from pg_catalog.jsonb_array_elements(existing.details -> 'items');
    select pg_catalog.jsonb_agg(value - 'old_value' order by value ->> 'key') into identity_new from pg_catalog.jsonb_array_elements(p_items);
    if existing.operation <> 'reference_batch' or identity_old is distinct from identity_new then
      raise exception 'A chave % já pertence a outro lote.', p_idempotency_key using errcode = '23505';
    end if;
    select log.phase into result_phase from public.storage_operation_log as log where log.operation_id = existing.operation_id and log.phase <> 'intent';
    return pg_catalog.jsonb_build_object('status', coalesce(result_phase, 'pending'), 'operation_id', existing.operation_id,
      'items', existing.details -> 'items');
  end if;

  perform public.storage_lifecycle_append_log(op, 'intent', 'reference_batch', p_idempotency_key, null, null, null, p_actor,
    coalesce(nullif(pg_catalog.btrim(p_reason), ''), 'lote de troca de referências'), null, null, null, null,
    pg_catalog.jsonb_build_object('items', p_items, 'count', pg_catalog.jsonb_array_length(p_items)));
  return pg_catalog.jsonb_build_object('status', 'started', 'operation_id', op, 'items', p_items);
end;
$$;

-- Conclui o lote SÓ se cada item tiver a sua troca (reference_replace, mesma chave e mesmo valor
-- novo) concluída com sucesso. Senão recusa (55000) e o lote continua pendente para retomada.
create function public.storage_lifecycle_finish_reference_batch(p_operation_id uuid, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent public.storage_operation_log%rowtype;
  result_phase text;
  missing integer;
  total integer;
begin
  select * into intent from public.storage_operation_log as log where log.operation_id = p_operation_id and log.phase = 'intent';
  if not found or intent.operation <> 'reference_batch' then
    raise exception 'Lote % não encontrado.', p_operation_id using errcode = '22023';
  end if;
  perform public.storage_lifecycle_lock_key('key', intent.idempotency_key);
  select log.phase into result_phase from public.storage_operation_log as log where log.operation_id = p_operation_id and log.phase <> 'intent';
  if found then
    return pg_catalog.jsonb_build_object('status', 'already_finished', 'result', result_phase, 'operation_id', p_operation_id);
  end if;

  total := pg_catalog.jsonb_array_length(intent.details -> 'items');
  select pg_catalog.count(*) into missing
  from pg_catalog.jsonb_array_elements(intent.details -> 'items') as item
  where not exists (
    select 1 from public.storage_operation_log as replace_intent
    join public.storage_operation_log as replace_done on replace_done.operation_id = replace_intent.operation_id and replace_done.phase = 'succeeded'
    where replace_intent.phase = 'intent' and replace_intent.operation = 'reference_replace'
      and replace_intent.idempotency_key = item.value ->> 'key'
      and replace_intent.details ->> 'new_value' = item.value ->> 'new_value'
  );
  if missing > 0 then
    raise exception 'Lote incompleto: % de % troca(s) ainda não concluída(s); o lote continua pendente.', missing, total
      using errcode = '55000', hint = 'storage_lifecycle: reference_batch_incomplete';
  end if;

  perform public.storage_lifecycle_append_log(p_operation_id, 'succeeded', 'reference_batch', null, null, null, null, p_actor, null,
    null, null, null, null, pg_catalog.jsonb_build_object('completed', total));
  return pg_catalog.jsonb_build_object('status', 'succeeded', 'operation_id', p_operation_id, 'completed', total);
end;
$$;

revoke all on function public.storage_lifecycle_begin_upload(text, text, text, text, bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.storage_lifecycle_finish_upload(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.storage_lifecycle_begin_reference_batch(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.storage_lifecycle_finish_reference_batch(uuid, text) from public, anon, authenticated;
grant execute on function public.storage_lifecycle_begin_upload(text, text, text, text, bigint, text, text, text) to service_role;
grant execute on function public.storage_lifecycle_finish_upload(uuid, text, text, jsonb) to service_role;
grant execute on function public.storage_lifecycle_begin_reference_batch(text, text, text, jsonb) to service_role;
grant execute on function public.storage_lifecycle_finish_reference_batch(uuid, text) to service_role;

reset role;
revoke storage_lifecycle_owner from current_user;

-- Autoverificação.
do $$
declare
  problem text;
begin
  select pg_catalog.string_agg(p.oid::regprocedure::text, ', ') into problem
  from pg_catalog.pg_proc as p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('storage_lifecycle_begin_upload', 'storage_lifecycle_finish_upload',
                      'storage_lifecycle_begin_reference_batch', 'storage_lifecycle_finish_reference_batch')
    and (p.proowner <> 'storage_lifecycle_owner'::regrole or not p.prosecdef
         or not coalesce(p.proconfig @> array['search_path=""'], false)
         or pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
         or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
         or not pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'));
  if problem is not null then
    raise exception 'Funções novas com dono, segurança ou privilégios incorretos: %', problem;
  end if;
  if (select pg_catalog.count(*) from pg_catalog.pg_proc as p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('storage_lifecycle_begin_upload', 'storage_lifecycle_finish_upload',
                        'storage_lifecycle_begin_reference_batch', 'storage_lifecycle_finish_reference_batch')) <> 4 then
    raise exception 'Esperadas 4 funções novas.';
  end if;
  if pg_catalog.pg_has_role(current_user, 'storage_lifecycle_owner', 'USAGE') and not (select rolsuper from pg_catalog.pg_roles where rolname = current_user) then
    raise exception 'quem aplicou a migração não pode herdar storage_lifecycle_owner depois dela.';
  end if;
  if pg_catalog.has_table_privilege('service_role', 'public.storage_object_lifecycle', 'INSERT,UPDATE,DELETE')
     or pg_catalog.has_table_privilege('anon', 'public.storage_object_lifecycle', 'SELECT') then
    raise exception 'Privilégios de tabela alterados indevidamente.';
  end if;
end;
$$;

commit;

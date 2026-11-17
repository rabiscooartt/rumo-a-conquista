-- Ciclo de vida das imagens — ativação rastreada de ponteiros (Etapa 4.2).
-- Complementa 20261114 e 20261116 (precisa das duas aplicadas). Rollback:
-- supabase/rollbacks/20261117_storage_lifecycle_pointer_activation_rollback.sql
--
-- Banners e avatar escolhem a imagem ativa por um ponteiro JSON no Storage
-- (site-profile/active/<ponteiro>.json). Esta migração acrescenta:
--   1. O tipo de operação pointer_activate na auditoria.
--   2. storage_lifecycle_begin_pointer_activation: registra a intenção ANTES de gravar o ponteiro,
--      com o arquivo anterior e o novo. Uma ativação pendente para o MESMO ponteiro e o MESMO arquivo
--      é retomada (mesma operação); para outro arquivo, é recusada (55000) até ser resolvida.
--      A chave de idempotência é gerada aqui (pointer:<ponteiro>:<operação>): reativar um arquivo
--      usado antes (A → B → A) é uma ativação nova, nunca confundida com a antiga.
--   3. storage_lifecycle_finish_pointer_activation: só confirma com a RELEITURA do ponteiro
--      apontando para o arquivo esperado; falha só com a releitura mostrando o arquivo anterior.
-- O estado do objeto NÃO muda aqui (arquivo enviado continua unverified até uma varredura);
-- nada é apagado, movido ou arquivado. Mesmas garantias das migrações anteriores.
begin;

do $$
begin
  if pg_catalog.to_regprocedure('public.storage_lifecycle_begin_upload(text, text, text, text, bigint, text, text, text)') is null then
    raise exception 'A migração 20261116_storage_lifecycle_tracked_uploads não está aplicada.';
  end if;
  if exists (select 1 from pg_catalog.pg_proc as p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('storage_lifecycle_begin_pointer_activation', 'storage_lifecycle_finish_pointer_activation')) then
    raise exception 'Funções de ativação de ponteiro já existem: migração aplicada antes ou nomes ocupados.';
  end if;
end;
$$;

grant storage_lifecycle_owner to current_user;
set local role storage_lifecycle_owner;

alter table public.storage_operation_log drop constraint storage_operation_log_operation;
alter table public.storage_operation_log add constraint storage_operation_log_operation check (operation in (
  'scan_register', 'scan_invalidate', 'scan_sync', 'state_change', 'object_missing', 'classification_override',
  'manual_protect', 'manual_unprotect',
  'archive_copy', 'archive_cancel', 'delete_object', 'restore_object',
  'reference_replace', 'json_reference_replace',
  'object_upload', 'reference_batch',
  'pointer_activate'
));
alter table public.storage_operation_log drop constraint storage_operation_log_object_ops;
alter table public.storage_operation_log add constraint storage_operation_log_object_ops check (
  operation not in ('state_change', 'object_missing', 'classification_override', 'manual_protect', 'manual_unprotect',
                    'archive_copy', 'archive_cancel', 'delete_object', 'restore_object', 'object_upload', 'pointer_activate')
  or bucket is not null
);

-- p_object_path: caminho do arquivo novo no bucket; o ponteiro guarda só o nome (último segmento).
create function public.storage_lifecycle_begin_pointer_activation(
  p_pointer text, p_bucket text, p_object_path text, p_previous_file text, p_actor text, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pending public.storage_operation_log%rowtype;
  target public.storage_object_lifecycle%rowtype;
  file_name text := pg_catalog.regexp_replace(coalesce(p_object_path, ''), '^.*/', '');
  op uuid := pg_catalog.gen_random_uuid();
begin
  if p_pointer is null or p_pointer !~ '^[a-z0-9-]{1,80}$' then
    raise exception 'Nome de ponteiro inválido.' using errcode = '22023';
  end if;
  if not (p_bucket = any (public.storage_lifecycle_known_buckets())) or file_name = '' then
    raise exception 'Bucket ou arquivo inválido para o ponteiro %.', p_pointer using errcode = '22023';
  end if;
  if p_previous_file is not null and p_previous_file !~ '^[^/]{1,255}$' then
    raise exception 'Arquivo anterior inválido.' using errcode = '22023';
  end if;

  perform public.storage_lifecycle_lock_key('pointer', p_pointer);

  select intent.* into pending from public.storage_operation_log as intent
  where intent.operation = 'pointer_activate' and intent.phase = 'intent' and intent.details ->> 'pointer' = p_pointer
    and not exists (select 1 from public.storage_operation_log as done where done.operation_id = intent.operation_id and done.phase <> 'intent')
  order by intent.id desc limit 1;
  if found then
    if (pending.bucket, pending.object_path) is distinct from (p_bucket, p_object_path) then
      raise exception 'Já existe ativação pendente do ponteiro % para outro arquivo; resolva-a antes.', p_pointer
        using errcode = '55000', hint = 'storage_lifecycle: pointer_activation_pending';
    end if;
    return pg_catalog.jsonb_build_object('status', 'pending', 'operation_id', pending.operation_id,
      'previous_file', pending.details ->> 'previous_file', 'pointer_file', pending.details ->> 'pointer_file');
  end if;

  -- Sem pendência e o ponteiro já aponta para este arquivo: não há troca a registrar.
  if p_previous_file is not distinct from file_name then
    return pg_catalog.jsonb_build_object('status', 'already_active', 'pointer_file', file_name);
  end if;

  -- Só ativa arquivo conhecido, com identidade (SHA-256) registrada e sem arquivamento.
  select * into target from public.storage_object_lifecycle as obj where obj.bucket = p_bucket and obj.object_path = p_object_path;
  if not found or target.sha256 is null then
    raise exception 'O arquivo %/% não está registrado com SHA-256 no ciclo de vida; envie-o pelo envio rastreado antes.', p_bucket, p_object_path
      using errcode = '22023', hint = 'storage_lifecycle: pointer_target_unregistered';
  end if;
  if target.archive_state <> 'none' then
    raise exception 'O arquivo %/% está em %.', p_bucket, p_object_path, target.archive_state using errcode = '23514';
  end if;

  perform public.storage_lifecycle_append_log(op, 'intent', 'pointer_activate', 'pointer:' || p_pointer || ':' || op::text,
    p_bucket, p_object_path, null, p_actor, coalesce(nullif(pg_catalog.btrim(p_reason), ''), 'ativação de imagem'),
    target.state, target.state, null, null,
    pg_catalog.jsonb_build_object('pointer', p_pointer, 'pointer_file', file_name, 'previous_file', p_previous_file,
      'sha256', target.sha256));
  return pg_catalog.jsonb_build_object('status', 'started', 'operation_id', op, 'pointer_file', file_name, 'previous_file', p_previous_file);
end;
$$;

-- Confirma pela releitura do ponteiro: succeeded exige read_back_file = arquivo novo;
-- failed exige read_back_file = arquivo anterior (o ponteiro não mudou). Qualquer outra
-- releitura deixa a operação pendente (o chamador não decide sem prova).
create function public.storage_lifecycle_finish_pointer_activation(p_operation_id uuid, p_result text, p_actor text, p_evidence jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent public.storage_operation_log%rowtype;
  result_phase text;
  read_back text := p_evidence ->> 'read_back_file';
begin
  if p_result not in ('succeeded', 'failed') then
    raise exception 'Resultado inválido: %', p_result using errcode = '22023';
  end if;
  select * into intent from public.storage_operation_log as log where log.operation_id = p_operation_id and log.phase = 'intent';
  if not found or intent.operation <> 'pointer_activate' then
    raise exception 'Ativação % não encontrada.', p_operation_id using errcode = '22023';
  end if;
  perform public.storage_lifecycle_lock_key('pointer', intent.details ->> 'pointer');
  select log.phase into result_phase from public.storage_operation_log as log where log.operation_id = p_operation_id and log.phase <> 'intent';
  if found then
    return pg_catalog.jsonb_build_object('status', 'already_finished', 'result', result_phase, 'operation_id', p_operation_id);
  end if;

  if p_evidence ->> 'method' is distinct from 'pointer_read_back'
     or (p_result = 'succeeded' and read_back is distinct from intent.details ->> 'pointer_file')
     or (p_result = 'failed' and read_back is distinct from intent.details ->> 'previous_file') then
    raise exception 'Releitura do ponteiro não comprova o resultado % da ativação %.', p_result, p_operation_id
      using errcode = '22023', hint = 'storage_lifecycle: pointer_unverified';
  end if;

  perform public.storage_lifecycle_append_log(p_operation_id, p_result, 'pointer_activate', null, intent.bucket, intent.object_path, null,
    p_actor, null, intent.state_before, intent.state_after, null, null, p_evidence);
  return pg_catalog.jsonb_build_object('status', p_result, 'operation_id', p_operation_id);
end;
$$;

revoke all on function public.storage_lifecycle_begin_pointer_activation(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.storage_lifecycle_finish_pointer_activation(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.storage_lifecycle_begin_pointer_activation(text, text, text, text, text, text) to service_role;
grant execute on function public.storage_lifecycle_finish_pointer_activation(uuid, text, text, jsonb) to service_role;

reset role;
revoke storage_lifecycle_owner from current_user;

do $$
declare
  problem text;
begin
  select pg_catalog.string_agg(p.oid::regprocedure::text, ', ') into problem
  from pg_catalog.pg_proc as p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('storage_lifecycle_begin_pointer_activation', 'storage_lifecycle_finish_pointer_activation')
    and (p.proowner <> 'storage_lifecycle_owner'::regrole or not p.prosecdef
         or not coalesce(p.proconfig @> array['search_path=""'], false)
         or pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
         or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
         or not pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'));
  if problem is not null then
    raise exception 'Funções novas com dono, segurança ou privilégios incorretos: %', problem;
  end if;
  if (select pg_catalog.count(*) from pg_catalog.pg_proc as p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('storage_lifecycle_begin_pointer_activation', 'storage_lifecycle_finish_pointer_activation')) <> 2 then
    raise exception 'Esperadas 2 funções novas.';
  end if;
  if pg_catalog.pg_has_role(current_user, 'storage_lifecycle_owner', 'USAGE') and not (select rolsuper from pg_catalog.pg_roles where rolname = current_user) then
    raise exception 'quem aplicou a migração não pode herdar storage_lifecycle_owner depois dela.';
  end if;
end;
$$;

commit;

-- Desfaz supabase/migrations/20261116_storage_lifecycle_tracked_uploads.sql.
-- Só desfaz a ESTRUTURA enquanto ela não foi usada: se já houver envio ou lote rastreado na
-- auditoria, ou objeto registrado por envio, recusa e explica (nada é apagado da auditoria nem
-- do inventário; para esse caso use o rollback principal, que preserva o histórico).
-- Não mexe na migração principal, nos dados da varredura nem nas proteções.
begin;

do $$
declare
  used_ops integer;
  upload_objects integer;
begin
  if pg_catalog.to_regprocedure('public.storage_lifecycle_begin_upload(text, text, text, text, bigint, text, text, text)') is null then
    raise exception 'A migração 20261116 não está aplicada; nada a desfazer.';
  end if;
  select pg_catalog.count(*) into used_ops from public.storage_operation_log where operation in ('object_upload', 'reference_batch');
  select pg_catalog.count(*) into upload_objects from public.storage_object_lifecycle
  where registered_by_upload is not null or first_seen_scan_id is null or last_seen_scan_id is null;
  if used_ops > 0 or upload_objects > 0 then
    raise exception 'Rollback recusado: % registro(s) de envio/lote na auditoria e % objeto(s) registrados por envio. Desfazer apagaria histórico; nada foi alterado.',
      used_ops, upload_objects
      using hint = 'Use supabase/rollbacks/20261114_create_storage_image_lifecycle_rollback.sql (preserva o histórico) se for preciso remover tudo.';
  end if;
end;
$$;

grant storage_lifecycle_owner to current_user;
set local role storage_lifecycle_owner;

drop function public.storage_lifecycle_finish_reference_batch(uuid, text);
drop function public.storage_lifecycle_begin_reference_batch(text, text, text, jsonb);
drop function public.storage_lifecycle_finish_upload(uuid, text, text, jsonb);
drop function public.storage_lifecycle_begin_upload(text, text, text, text, bigint, text, text, text);

alter table public.storage_object_lifecycle drop constraint storage_object_lifecycle_unscanned_unverified;
alter table public.storage_object_lifecycle drop constraint storage_object_lifecycle_origin;
alter table public.storage_object_lifecycle drop column registered_by_upload;
alter table public.storage_object_lifecycle alter column first_seen_scan_id set not null;
alter table public.storage_object_lifecycle alter column last_seen_scan_id set not null;

alter table public.storage_operation_log drop constraint storage_operation_log_object_ops;
alter table public.storage_operation_log add constraint storage_operation_log_object_ops check (
  operation not in ('state_change', 'object_missing', 'classification_override', 'manual_protect', 'manual_unprotect',
                    'archive_copy', 'archive_cancel', 'delete_object', 'restore_object') or bucket is not null
);
alter table public.storage_operation_log drop constraint storage_operation_log_operation;
alter table public.storage_operation_log add constraint storage_operation_log_operation check (operation in (
  'scan_register', 'scan_invalidate', 'scan_sync', 'state_change', 'object_missing', 'classification_override',
  'manual_protect', 'manual_unprotect',
  'archive_copy', 'archive_cancel', 'delete_object', 'restore_object',
  'reference_replace', 'json_reference_replace'
));

reset role;
revoke storage_lifecycle_owner from current_user;
commit;

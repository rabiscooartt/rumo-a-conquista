-- Desfaz supabase/migrations/20261117_storage_lifecycle_pointer_activation.sql enquanto ela não foi
-- usada. Com qualquer ativação registrada, recusa e explica (não apaga auditoria).
begin;

do $$
declare
  used integer;
begin
  if pg_catalog.to_regprocedure('public.storage_lifecycle_begin_pointer_activation(text, text, text, text, text, text)') is null then
    raise exception 'A migração 20261117 não está aplicada; nada a desfazer.';
  end if;
  select pg_catalog.count(*) into used from public.storage_operation_log where operation = 'pointer_activate';
  if used > 0 then
    raise exception 'Rollback recusado: % registro(s) de ativação de ponteiro na auditoria. Desfazer apagaria histórico; nada foi alterado.', used
      using hint = 'Use o rollback principal (preserva o histórico) se for preciso remover tudo.';
  end if;
end;
$$;

grant storage_lifecycle_owner to current_user;
set local role storage_lifecycle_owner;

drop function public.storage_lifecycle_finish_pointer_activation(uuid, text, text, jsonb);
drop function public.storage_lifecycle_begin_pointer_activation(text, text, text, text, text, text);

alter table public.storage_operation_log drop constraint storage_operation_log_object_ops;
alter table public.storage_operation_log add constraint storage_operation_log_object_ops check (
  operation not in ('state_change', 'object_missing', 'classification_override', 'manual_protect', 'manual_unprotect',
                    'archive_copy', 'archive_cancel', 'delete_object', 'restore_object', 'object_upload') or bucket is not null
);
alter table public.storage_operation_log drop constraint storage_operation_log_operation;
alter table public.storage_operation_log add constraint storage_operation_log_operation check (operation in (
  'scan_register', 'scan_invalidate', 'scan_sync', 'state_change', 'object_missing', 'classification_override',
  'manual_protect', 'manual_unprotect',
  'archive_copy', 'archive_cancel', 'delete_object', 'restore_object',
  'reference_replace', 'json_reference_replace',
  'object_upload', 'reference_batch'
));

reset role;
revoke storage_lifecycle_owner from current_user;
commit;

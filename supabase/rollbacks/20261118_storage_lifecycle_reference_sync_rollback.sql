-- Desfaz supabase/migrations/20261118_storage_lifecycle_reference_sync.sql enquanto ela não foi
-- usada. Com qualquer salvamento registrado, recusa e explica (não apaga auditoria).
begin;

do $$
declare
  used integer;
begin
  if pg_catalog.to_regprocedure('public.storage_lifecycle_begin_reference_sync(text, text, integer, integer, text, text, jsonb)') is null then
    raise exception 'A migração 20261118 não está aplicada; nada a desfazer.';
  end if;
  select pg_catalog.count(*) into used from public.storage_operation_log where operation = 'reference_sync';
  if used > 0 then
    raise exception 'Rollback recusado: % registro(s) de reference_sync na auditoria. Desfazer apagaria histórico; nada foi alterado.', used
      using hint = 'Use o rollback principal (preserva o histórico) se for preciso remover tudo.';
  end if;
end;
$$;

grant storage_lifecycle_owner to current_user;
set local role storage_lifecycle_owner;

drop function public.storage_lifecycle_finish_reference_sync(uuid, text, text);
drop function public.storage_lifecycle_begin_reference_sync(text, text, integer, integer, text, text, jsonb);
drop function public.storage_lifecycle_reference_sync_read(jsonb);

alter table public.storage_operation_log drop constraint storage_operation_log_operation;
alter table public.storage_operation_log add constraint storage_operation_log_operation check (operation in (
  'scan_register', 'scan_invalidate', 'scan_sync', 'state_change', 'object_missing', 'classification_override',
  'manual_protect', 'manual_unprotect',
  'archive_copy', 'archive_cancel', 'delete_object', 'restore_object',
  'reference_replace', 'json_reference_replace',
  'object_upload', 'reference_batch',
  'pointer_activate'
));

reset role;
revoke storage_lifecycle_owner from current_user;

revoke select (game_slug, legacy_id) on public.achievements from storage_lifecycle_owner;
revoke select (achievement_id, owner_key) on public.achievement_progress from storage_lifecycle_owner;
revoke select (review) on public.games from storage_lifecycle_owner;
commit;

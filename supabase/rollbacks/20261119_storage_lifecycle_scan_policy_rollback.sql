-- Desfaz supabase/migrations/20261119_storage_lifecycle_scan_policy.sql enquanto ela não foi usada.
-- Com qualquer atestação registrada, recusa e explica (não apaga histórico). Restaura a prova de
-- elegibilidade EXATAMENTE como na migração 20261114.
begin;

do $$
declare
  used integer;
begin
  if pg_catalog.to_regclass('public.storage_lifecycle_scan_attestations') is null then
    raise exception 'A migração 20261119 não está aplicada; nada a desfazer.';
  end if;
  select pg_catalog.count(*) into used from public.storage_lifecycle_scan_attestations;
  if used > 0 or exists (select 1 from public.storage_operation_log where operation in ('scan_attest', 'scan_run')) then
    raise exception 'Rollback recusado: há atestações ou execuções oficiais de varredura registradas. Desfazer apagaria histórico; nada foi alterado.'
      using hint = 'Use o rollback principal (preserva o histórico) se for preciso remover tudo.';
  end if;
end;
$$;

grant storage_lifecycle_owner to current_user;
set local role storage_lifecycle_owner;

create or replace function public.storage_lifecycle_evidence(p_bucket text, p_object_path text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target public.storage_object_lifecycle%rowtype;
  latest public.storage_lifecycle_scans%rowtype;
  scan public.storage_lifecycle_scans%rowtype;
  first_scan public.storage_lifecycle_scans%rowtype;
  seen public.storage_lifecycle_scan_objects%rowtype;
  streak integer := 0;
  stop_reason text;
  last_unprotect timestamptz;
  verdict jsonb;
begin
  select * into target from public.storage_object_lifecycle as obj where obj.bucket = p_bucket and obj.object_path = p_object_path;
  if not found then
    return pg_catalog.jsonb_build_object('eligible', false, 'reason', 'objeto fora do ciclo de vida');
  end if;
  if target.manual_protection then
    return pg_catalog.jsonb_build_object('eligible', false, 'reason', 'proteção manual ativa');
  end if;
  if target.state = 'protected' then
    return pg_catalog.jsonb_build_object('eligible', false, 'reason', 'objeto protegido');
  end if;

  select * into latest from public.storage_lifecycle_scans as s order by s.completed_at desc, s.scan_id desc limit 1;
  if not found then
    return pg_catalog.jsonb_build_object('eligible', false, 'reason', 'nenhuma varredura registrada');
  end if;
  if not public.storage_lifecycle_scan_is_valid(latest.scan_id) then
    return pg_catalog.jsonb_build_object('eligible', false, 'reason', 'a varredura mais recente está incompleta ou invalidada', 'latest_scan', latest.scan_id);
  end if;

  for scan in select * from public.storage_lifecycle_scans as s order by s.completed_at desc, s.scan_id desc loop
    if not public.storage_lifecycle_scan_is_valid(scan.scan_id) then
      continue;
    end if;
    select * into seen from public.storage_lifecycle_scan_objects as so
    where so.scan_id = scan.scan_id and so.bucket = p_bucket and so.object_path = p_object_path;
    if not found then
      stop_reason := 'ausente da varredura ' || scan.scan_id;
      exit;
    end if;
    if seen.reference_count > 0 or seen.manual_protection or seen.state in ('protected', 'active', 'referenced') then
      stop_reason := 'referenciado ou protegido na varredura ' || scan.scan_id;
      exit;
    end if;
    streak := streak + 1;
    first_scan := scan;
  end loop;

  verdict := pg_catalog.jsonb_build_object('latest_scan', latest.scan_id, 'first_scan', first_scan.scan_id, 'scans', streak,
    'span_days', case when streak > 0 then pg_catalog.round((extract(epoch from latest.completed_at - first_scan.completed_at) / 86400)::numeric, 2) end,
    'required_days', target.safety_period_days, 'stopped_at', stop_reason);

  if streak < 2 then
    return verdict || pg_catalog.jsonb_build_object('eligible', false, 'reason', 'menos de duas varreduras completas e válidas sem referência');
  end if;
  if latest.completed_at - first_scan.completed_at < pg_catalog.make_interval(days => target.safety_period_days) then
    return verdict || pg_catalog.jsonb_build_object('eligible', false, 'reason', 'intervalo entre as varreduras menor que o prazo de segurança');
  end if;
  select pg_catalog.max(log.occurred_at) into last_unprotect from public.storage_operation_log as log
  where log.operation = 'manual_unprotect' and log.phase = 'succeeded' and log.bucket = p_bucket and log.object_path = p_object_path;
  if last_unprotect is not null and last_unprotect > first_scan.completed_at then
    return verdict || pg_catalog.jsonb_build_object('eligible', false, 'reason', 'proteção manual removida dentro do período de evidência');
  end if;
  return verdict || pg_catalog.jsonb_build_object('eligible', true, 'reason', null);
end;
$$;

drop function public.storage_lifecycle_finish_scan_run(text, text, text, jsonb);
drop function public.storage_lifecycle_attest_scan(text, integer, jsonb, text, text);
drop function public.storage_lifecycle_begin_scan_run(text, text);
drop function public.storage_lifecycle_scan_meets_policy(text);
drop function public.storage_lifecycle_scan_policy_current();
drop table public.storage_lifecycle_scan_attestations;
drop table public.storage_lifecycle_scan_policies;

alter table public.storage_operation_log drop constraint storage_operation_log_scan_ops;
alter table public.storage_operation_log add constraint storage_operation_log_scan_ops check (
  operation not in ('scan_register', 'scan_invalidate', 'scan_sync') or scan_id is not null
);
alter table public.storage_operation_log drop constraint storage_operation_log_operation;
alter table public.storage_operation_log add constraint storage_operation_log_operation check (operation in (
  'scan_register', 'scan_invalidate', 'scan_sync', 'state_change', 'object_missing', 'classification_override',
  'manual_protect', 'manual_unprotect',
  'archive_copy', 'archive_cancel', 'delete_object', 'restore_object',
  'reference_replace', 'json_reference_replace',
  'object_upload', 'reference_batch',
  'pointer_activate',
  'reference_sync'
));

reset role;
revoke storage_lifecycle_owner from current_user;
commit;

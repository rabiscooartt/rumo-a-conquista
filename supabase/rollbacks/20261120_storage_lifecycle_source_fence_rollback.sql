-- Desfaz supabase/migrations/20261120_storage_lifecycle_source_fence.sql enquanto a cerca não foi
-- usada por uma execução oficial. Com qualquer marcador registrado, recusa e explica (o diário e os
-- marcadores são o que sustenta as provas dessas execuções). Restaura as funções anteriores com os
-- mesmos nomes, privilégios e corpo (as versões *_base voltam a ser as públicas).
-- Precisa rodar ANTES de qualquer rollback de 20261119 ou anterior.
begin;

do $$
begin
  if pg_catalog.to_regclass('public.storage_lifecycle_scan_fences') is null then
    raise exception 'A migração 20261120 não está aplicada; nada a desfazer.';
  end if;
  if exists (select 1 from public.storage_lifecycle_scan_fences) then
    raise exception 'Rollback recusado: há execuções oficiais de varredura com cerca registrada. Desfazer apagaria a base das provas; nada foi alterado.';
  end if;
  if exists (select 1 from public.storage_object_lifecycle where archive_state in ('archiving', 'deleting', 'restoring')) then
    raise exception 'Rollback recusado: há operação de arquivamento, remoção ou restauração em andamento.';
  end if;
end;
$$;

-- Gatilhos primeiro (criados por quem aplicou a migração, dono das tabelas).
drop trigger storage_lifecycle_source_guard on public.games;
drop trigger storage_lifecycle_source_journal on public.games;
drop trigger storage_lifecycle_source_truncate on public.games;
drop trigger storage_lifecycle_source_guard on public.achievements;
drop trigger storage_lifecycle_source_journal on public.achievements;
drop trigger storage_lifecycle_source_truncate on public.achievements;
drop trigger storage_lifecycle_source_guard on public.achievement_progress;
drop trigger storage_lifecycle_source_journal on public.achievement_progress;
drop trigger storage_lifecycle_source_truncate on public.achievement_progress;
drop trigger storage_lifecycle_source_guard on public.journey_entries;
drop trigger storage_lifecycle_source_journal on public.journey_entries;
drop trigger storage_lifecycle_source_truncate on public.journey_entries;
drop trigger storage_lifecycle_source_guard on public.journey_history_events;
drop trigger storage_lifecycle_source_journal on public.journey_history_events;
drop trigger storage_lifecycle_source_truncate on public.journey_history_events;
do $$
begin
  if pg_catalog.to_regclass('storage.objects') is not null then
    execute 'drop trigger if exists storage_lifecycle_source_guard on storage.objects';
  end if;
end;
$$;

grant storage_lifecycle_owner to current_user;
set local role storage_lifecycle_owner;

drop function public.storage_lifecycle_begin_operation(text, text, text, text, text, text, jsonb);
drop function public.storage_lifecycle_evidence(text, text);
drop function public.storage_lifecycle_finish_scan_run(text, text, text, jsonb);
drop function public.storage_lifecycle_sync_scan(text, jsonb, text);
drop function public.storage_lifecycle_begin_scan_run(text, text);
alter function public.storage_lifecycle_begin_operation_base(text, text, text, text, text, text, jsonb) rename to storage_lifecycle_begin_operation;
alter function public.storage_lifecycle_evidence_base(text, text) rename to storage_lifecycle_evidence;
alter function public.storage_lifecycle_finish_scan_run_base(text, text, text, jsonb) rename to storage_lifecycle_finish_scan_run;
alter function public.storage_lifecycle_sync_scan_base(text, jsonb, text) rename to storage_lifecycle_sync_scan;
alter function public.storage_lifecycle_begin_scan_run_base(text, text) rename to storage_lifecycle_begin_scan_run;
grant execute on function public.storage_lifecycle_begin_operation(text, text, text, text, text, text, jsonb) to service_role;
grant execute on function public.storage_lifecycle_evidence(text, text) to service_role;
grant execute on function public.storage_lifecycle_finish_scan_run(text, text, text, jsonb) to service_role;
grant execute on function public.storage_lifecycle_sync_scan(text, jsonb, text) to service_role;
grant execute on function public.storage_lifecycle_begin_scan_run(text, text) to service_role;

-- Ordem de travas da 20261114 (sem a cerca).
create or replace function public.storage_lifecycle_lock_key(p_namespace text, p_key text)
returns void
language sql
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('storage_lifecycle:writer', 0));
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_namespace || ':' || coalesce(p_key, ''), 0));
$$;

drop function public.storage_lifecycle_object_in_use(text, text);
drop function public.storage_lifecycle_scan_fence_check(text);
drop function public.storage_lifecycle_storage_source_guard();
drop function public.storage_lifecycle_storage_source_kind(text, text);
drop function public.storage_lifecycle_source_truncate();
drop function public.storage_lifecycle_source_journal();
drop function public.storage_lifecycle_source_guard();
drop function public.storage_lifecycle_convention_prefix(text, jsonb);
drop function public.storage_lifecycle_convention_signature(text, jsonb);
drop function public.storage_lifecycle_extract_keys(jsonb);
drop function public.storage_lifecycle_fence_exclusive(integer);
drop function public.storage_lifecycle_fence_shared();
drop function public.storage_lifecycle_fence_key();
drop table public.storage_lifecycle_scan_fences;
drop table public.storage_lifecycle_source_changes;

reset role;

-- Leitura da linha inteira (conferência viva) sai; voltam só as colunas da 20261114.
revoke select on public.games, public.achievements, public.achievement_progress, public.journey_entries, public.journey_history_events
  from storage_lifecycle_owner;
grant select (id, image, official_image) on public.achievements to storage_lifecycle_owner;
grant select (id, image_override, status, earned_at) on public.achievement_progress to storage_lifecycle_owner;
grant select (slug, image, card_image, final_badge, emblem, trophies) on public.games to storage_lifecycle_owner;

revoke storage_lifecycle_owner from current_user;

do $$
begin
  if pg_catalog.to_regclass('public.storage_lifecycle_source_changes') is not null
     or exists (select 1 from pg_catalog.pg_proc as p where p.pronamespace = 'public'::regnamespace and p.proname like 'storage_lifecycle\_%\_base')
     or exists (select 1 from pg_catalog.pg_trigger as g where g.tgname like 'storage_lifecycle_source_%')
     or not pg_catalog.has_function_privilege('service_role', 'public.storage_lifecycle_evidence(text, text)', 'EXECUTE')
     or pg_catalog.has_table_privilege('storage_lifecycle_owner', 'public.journey_entries', 'SELECT') then
    raise exception 'Rollback incompleto; nada foi desfeito.';
  end if;
end;
$$;

commit;

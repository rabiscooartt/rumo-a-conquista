-- Pré-verificação SOMENTE LEITURA da migração 20261119_storage_lifecycle_scan_policy.
-- Uma linha por verificação: ok = true é o esperado. Nada é alterado.
with checks as (
  select 'migração 20261118 aplicada (begin_reference_sync existe)' as verificacao,
         pg_catalog.to_regprocedure('public.storage_lifecycle_begin_reference_sync(text, text, integer, integer, text, text, jsonb)') is not null as ok,
         '' as detail
  union all
  select 'tabelas e funções da política ainda não existem',
         pg_catalog.to_regclass('public.storage_lifecycle_scan_policies') is null
           and pg_catalog.to_regclass('public.storage_lifecycle_scan_attestations') is null
           and not exists (select 1 from pg_catalog.pg_proc as p where p.pronamespace = 'public'::regnamespace
                           and p.proname in ('storage_lifecycle_attest_scan', 'storage_lifecycle_scan_meets_policy', 'storage_lifecycle_scan_policy_current',
                                           'storage_lifecycle_begin_scan_run', 'storage_lifecycle_finish_scan_run')),
         ''
  union all
  select 'prova de elegibilidade ainda é a da 20261114 (sem política)',
         pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.storage_lifecycle_evidence(text, text)'::regprocedure), 'scan_meets_policy') = 0,
         ''
  union all
  select 'restrição de operações atual = lista da 20261118 (sem scan_attest)',
         pg_catalog.pg_get_constraintdef(c.oid) like '%reference_sync%' and pg_catalog.pg_get_constraintdef(c.oid) not like '%scan_attest%' and pg_catalog.pg_get_constraintdef(c.oid) not like '%scan_run%',
         ''
  from pg_catalog.pg_constraint as c where c.conname = 'storage_operation_log_operation' and c.conrelid = 'public.storage_operation_log'::regclass
  union all
  select 'função de guarda de inclusão e de bloqueio existem (padrão somente inclusão)',
         pg_catalog.to_regprocedure('public.storage_lifecycle_insert_guard()') is not null and pg_catalog.to_regprocedure('public.storage_lifecycle_block_change()') is not null,
         ''
  union all
  select 'varreduras registradas (ficarão só como histórico)',
         true,
         (select pg_catalog.string_agg(s.scan_id || case when s.complete then ' completa' else ' incompleta' end, ', ' order by s.completed_at) from public.storage_lifecycle_scans as s)
  union all
  select 'nenhum objeto em arquivamento, arquivado ou removido',
         not exists (select 1 from public.storage_object_lifecycle where archive_state <> 'none'),
         ''
  union all
  select 'nenhuma operação pendente no ciclo de vida',
         (select pg_catalog.count(*) from public.storage_lifecycle_pending_operations) = 0,
         (select pg_catalog.count(*)::text from public.storage_lifecycle_pending_operations)
  union all
  select 'cadeia de auditoria íntegra',
         (select pg_catalog.count(*) from public.storage_operation_log_verify()) = 0,
         (select pg_catalog.count(*)::text || ' registros' from public.storage_operation_log)
)
select verificacao, ok, detail from checks;

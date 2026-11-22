-- Pré-verificação SOMENTE LEITURA da migração 20261120_storage_lifecycle_source_fence.
-- Uma linha por verificação: ok = true é o esperado. Nada é alterado.
with checks as (
  select 'migração 20261119 aplicada (finish_scan_run existe)' as verificacao,
         pg_catalog.to_regprocedure('public.storage_lifecycle_finish_scan_run(text, text, text, jsonb)') is not null as ok,
         '' as detail
  union all
  select 'diário, marcadores e funções *_base ainda não existem',
         pg_catalog.to_regclass('public.storage_lifecycle_source_changes') is null
           and pg_catalog.to_regclass('public.storage_lifecycle_scan_fences') is null
           and not exists (select 1 from pg_catalog.pg_proc as p where p.pronamespace = 'public'::regnamespace and p.proname like 'storage_lifecycle\_%\_base'),
         ''
  union all
  select 'tabelas-fonte existem (games, achievements, achievement_progress, journey_entries, journey_history_events)',
         pg_catalog.to_regclass('public.games') is not null and pg_catalog.to_regclass('public.achievements') is not null
           and pg_catalog.to_regclass('public.achievement_progress') is not null and pg_catalog.to_regclass('public.journey_entries') is not null
           and pg_catalog.to_regclass('public.journey_history_events') is not null,
         ''
  union all
  select 'quem aplica é dono das tabelas-fonte (cria gatilhos e repassa SELECT ao proprietário)',
         not exists (select 1 from pg_catalog.pg_class as c
                     where c.oid in ('public.games'::regclass, 'public.achievements'::regclass, 'public.achievement_progress'::regclass,
                                     'public.journey_entries'::regclass, 'public.journey_history_events'::regclass)
                       and not pg_catalog.pg_has_role(current_user, c.relowner, 'USAGE')),
         (select pg_catalog.string_agg(c.relname || '=' || pg_catalog.pg_get_userbyid(c.relowner), ', ') from pg_catalog.pg_class as c
          where c.oid in ('public.games'::regclass, 'public.achievements'::regclass, 'public.achievement_progress'::regclass,
                          'public.journey_entries'::regclass, 'public.journey_history_events'::regclass))
  union all
  select 'nenhum gatilho com os nomes novos nas tabelas-fonte',
         not exists (select 1 from pg_catalog.pg_trigger as g where g.tgname like 'storage_lifecycle_source_%'),
         ''
  union all
  select 'storage.objects existe (projeto Supabase)', pg_catalog.to_regclass('storage.objects') is not null, ''
  union all
  select 'storage.objects: privilégio TRIGGER para quem aplica',
         coalesce(pg_catalog.has_table_privilege(current_user, pg_catalog.to_regclass('storage.objects'), 'TRIGGER'), true),
         ''
  union all
  select 'storage.objects: colunas bucket_id, name e version',
         pg_catalog.to_regclass('storage.objects') is null or (select pg_catalog.count(*) = 3 from information_schema.columns
           where table_schema = 'storage' and table_name = 'objects' and column_name in ('bucket_id', 'name', 'version')),
         ''
  union all
  select 'nenhuma operação de arquivamento, remoção ou restauração em andamento',
         not exists (select 1 from public.storage_object_lifecycle where archive_state in ('archiving', 'deleting', 'restoring')),
         ''
  union all
  select 'execuções oficiais pendentes (abertas sem cerca: precisam ser encerradas como falha depois)',
         true,
         (select pg_catalog.count(*)::text from public.storage_operation_log as run
          where run.operation = 'scan_run' and run.phase = 'intent'
            and not exists (select 1 from public.storage_operation_log as done where done.operation_id = run.operation_id and done.phase <> 'intent'))
  union all
  select 'isolamento padrão READ COMMITTED (a cerca relê depois da trava)',
         pg_catalog.current_setting('default_transaction_isolation') = 'read committed',
         pg_catalog.current_setting('default_transaction_isolation')
)
select * from checks;

-- Pré-verificação SOMENTE LEITURA da migração 20261118_storage_lifecycle_reference_sync.
-- Uma linha por verificação: ok = true é o esperado. Nada é alterado.
with
checks as (
  select 'migração 20261117 aplicada (begin_pointer_activation existe)' as verificacao,
         pg_catalog.to_regprocedure('public.storage_lifecycle_begin_pointer_activation(text, text, text, text, text, text)') is not null as ok,
         '' as detail
  union all
  select 'nomes das funções novas livres',
         not exists (select 1 from pg_catalog.pg_proc as p where p.pronamespace = 'public'::regnamespace
                     and p.proname in ('storage_lifecycle_begin_reference_sync', 'storage_lifecycle_finish_reference_sync', 'storage_lifecycle_reference_sync_read')),
         ''
  union all
  select 'papel storage_lifecycle_owner existe, sem login e com bypassrls',
         exists (select 1 from pg_catalog.pg_roles where rolname = 'storage_lifecycle_owner' and not rolcanlogin and rolbypassrls),
         ''
  union all
  select 'restrição de operações atual = lista da 20261117 (pointer_activate é a última)',
         pg_catalog.pg_get_constraintdef(c.oid) like '%pointer_activate%' and pg_catalog.pg_get_constraintdef(c.oid) not like '%reference_sync%',
         pg_catalog.left(pg_catalog.pg_get_constraintdef(c.oid), 400)
  from pg_catalog.pg_constraint as c where c.conname = 'storage_operation_log_operation' and c.conrelid = 'public.storage_operation_log'::regclass
  union all
  select 'achievements tem índice único (game_slug, legacy_id) — usado no upsert e na releitura',
         exists (select 1 from pg_catalog.pg_index as i where i.indrelid = 'public.achievements'::regclass and i.indisunique
                 and (select pg_catalog.array_agg(a.attname::text order by a.attname) from pg_catalog.pg_attribute as a
                      where a.attrelid = i.indrelid and a.attnum = any (i.indkey)) = array['game_slug', 'legacy_id']),
         ''
  union all
  select 'achievement_progress tem índice único (owner_key, achievement_id)',
         exists (select 1 from pg_catalog.pg_index as i where i.indrelid = 'public.achievement_progress'::regclass and i.indisunique
                 and (select pg_catalog.array_agg(a.attname::text order by a.attname) from pg_catalog.pg_attribute as a
                      where a.attrelid = i.indrelid and a.attnum = any (i.indkey)) = array['achievement_id', 'owner_key']),
         ''
  union all
  select 'colunas JSON de games são jsonb (final_badge, emblem, trophies, review)',
         (select pg_catalog.count(*) from information_schema.columns where table_schema = 'public' and table_name = 'games'
            and column_name in ('final_badge', 'emblem', 'trophies', 'review') and data_type = 'jsonb') = 4,
         (select pg_catalog.string_agg(column_name || ':' || data_type, ', ') from information_schema.columns
          where table_schema = 'public' and table_name = 'games' and column_name in ('final_badge', 'emblem', 'trophies', 'review'))
  union all
  select 'colunas de imagem e chaves existem (achievements, achievement_progress, games)',
         (select pg_catalog.count(*) from information_schema.columns where table_schema = 'public' and (table_name, column_name) in (
            ('achievements', 'game_slug'), ('achievements', 'legacy_id'), ('achievements', 'image'), ('achievements', 'official_image'),
            ('achievement_progress', 'achievement_id'), ('achievement_progress', 'owner_key'), ('achievement_progress', 'image_override'),
            ('games', 'slug'), ('games', 'image'), ('games', 'card_image'))) = 10,
         ''
  union all
  select 'dono ainda NÃO lê as colunas novas (a migração concede)',
         not pg_catalog.has_column_privilege('storage_lifecycle_owner', 'public.achievements', 'legacy_id', 'SELECT')
           or not pg_catalog.has_column_privilege('storage_lifecycle_owner', 'public.games', 'review', 'SELECT'),
         ''
  union all
  select 'dono nunca escreve em games.review',
         not pg_catalog.has_column_privilege('storage_lifecycle_owner', 'public.games', 'review', 'UPDATE'),
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

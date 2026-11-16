-- Pré-verificação SOMENTE LEITURA da migração 20261117_storage_lifecycle_pointer_activation.sql.
-- Transação READ ONLY e rollback no fim. Uma consulta: uma linha por verificação e a última,
-- PRONTO_PARA_APLICAR, só true se todas passarem. Rodar como quem aplicará (postgres).
begin transaction read only;

with
owner_role as (select oid, rolcanlogin, rolinherit, rolbypassrls, rolsuper from pg_catalog.pg_roles where rolname = 'storage_lifecycle_owner'),
constraint_defs as (
  select con.conname, pg_catalog.pg_get_constraintdef(con.oid) as def
  from pg_catalog.pg_constraint as con where con.conrelid = pg_catalog.to_regclass('public.storage_operation_log')
),
checks (ordem, verificacao, ok, detalhe) as (
  select 1, 'migração 20261116 aplicada (begin/finish_upload e lote presentes, do proprietário dedicado)',
    (select pg_catalog.count(*) = 4 and pg_catalog.bool_and(p.proowner = (select oid from owner_role)) from pg_catalog.pg_proc as p
     where p.pronamespace = 'public'::regnamespace and p.proname in ('storage_lifecycle_begin_upload', 'storage_lifecycle_finish_upload',
       'storage_lifecycle_begin_reference_batch', 'storage_lifecycle_finish_reference_batch')),
    'funções da 20261116'
  union all
  select 2, 'restrição de tipos de operação: versão da 20261116 (com object_upload, sem pointer_activate)',
    coalesce((select def ~ 'object_upload' and def ~ 'reference_batch' and def !~ 'pointer_activate' from constraint_defs where conname = 'storage_operation_log_operation'), false),
    coalesce((select pg_catalog.left(def, 120) from constraint_defs where conname = 'storage_operation_log_operation'), 'AUSENTE')
  union all
  select 3, 'restrição de operações com objeto: versão da 20261116',
    coalesce((select def ~ 'object_upload' and def !~ 'pointer_activate' from constraint_defs where conname = 'storage_operation_log_object_ops'), false),
    'storage_operation_log_object_ops'
  union all
  select 4, 'nomes das funções novas livres',
    not exists (select 1 from pg_catalog.pg_proc as p where p.pronamespace = 'public'::regnamespace
                and p.proname in ('storage_lifecycle_begin_pointer_activation', 'storage_lifecycle_finish_pointer_activation')),
    'begin/finish_pointer_activation'
  union all
  select 5, 'proprietário dedicado intacto (sem login, sem herança, BYPASSRLS)',
    coalesce((select not rolcanlogin and not rolinherit and rolbypassrls and not rolsuper from owner_role), false), 'storage_lifecycle_owner'
  union all
  select 6, 'quem aplica tem ADMIN sobre o proprietário e ninguém herda nem assume',
    ((select r.rolsuper from pg_catalog.pg_roles as r where r.rolname = current_user)
      or exists (select 1 from pg_catalog.pg_auth_members as m where m.roleid = (select oid from owner_role) and m.member = current_user::regrole and m.admin_option))
    and not exists (select 1 from pg_catalog.pg_auth_members as m where m.roleid = (select oid from owner_role) and (m.inherit_option or m.set_option)),
    current_user::text
  union all
  select 7, 'buckets dos ponteiros (site-banners, site-profile) no ciclo de vida',
    coalesce((select p.prosrc ~ 'site-banners' and p.prosrc ~ 'site-profile' from pg_catalog.pg_proc as p
              where p.oid = pg_catalog.to_regprocedure('public.storage_lifecycle_known_buckets()')), false), 'storage_lifecycle_known_buckets()'
  union all
  select 8, 'nenhuma operação pendente',
    (select pg_catalog.count(*) = 0 from public.storage_lifecycle_pending_operations),
    (select pg_catalog.count(*)::text || ' pendente(s)' from public.storage_lifecycle_pending_operations)
  union all
  select 9, 'cabeça da cadeia de auditoria apontando para o último registro',
    coalesce((select h.last_entry_id is not distinct from (select pg_catalog.max(id) from public.storage_operation_log)
              and h.last_entry_hash is not distinct from (select l.entry_hash from public.storage_operation_log as l order by l.id desc limit 1)
              from public.storage_operation_log_head as h where h.singleton), false),
    (select pg_catalog.count(*)::text || ' registro(s)' from public.storage_operation_log)
  union all
  select 10, 'navegador sem acesso a funções storage_*',
    not exists (select 1 from pg_catalog.pg_proc as p where p.pronamespace = 'public'::regnamespace and p.proname ~ '^storage_'
                and (pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
    'anon/authenticated'
  union all
  select 11, 'gatilho de evento do PostgREST ativo',
    exists (select 1 from pg_catalog.pg_event_trigger where evtname = 'pgrst_ddl_watch' and evtenabled <> 'D'), 'pgrst_ddl_watch'
)
select ordem, verificacao, coalesce(ok, false) as ok, detalhe from checks
union all
select 99, 'PRONTO_PARA_APLICAR', pg_catalog.bool_and(coalesce(ok, false)),
       coalesce(pg_catalog.string_agg(ordem::text, ', ' order by ordem) filter (where not coalesce(ok, false)), 'nenhuma divergência')
from checks
order by 1;

rollback;

-- Pré-verificação SOMENTE LEITURA da migração complementar
-- supabase/migrations/20261116_storage_lifecycle_tracked_uploads.sql.
-- Transação READ ONLY (o Postgres recusa qualquer escrita) e rollback no fim. Uma única consulta:
-- uma linha por verificação (ok = true/false, com detalhe) e a última linha, PRONTO_PARA_APLICAR,
-- só é true se TODAS passarem. Qualquer false é divergência: não aplicar.
-- Rodar como o papel que aplicará a migração (postgres no Supabase).
begin transaction read only;

with
owner_role as (select oid, rolname, rolcanlogin, rolinherit, rolbypassrls, rolsuper from pg_catalog.pg_roles where rolname = 'storage_lifecycle_owner'),
main_tables as (
  select c.relname, c.relkind, pg_catalog.pg_get_userbyid(c.relowner) as dono, c.relrowsecurity as rls
  from pg_catalog.pg_class as c
  where c.relnamespace = 'public'::regnamespace
    and c.relname in ('storage_lifecycle_scans', 'storage_lifecycle_scan_objects', 'storage_object_lifecycle',
                      'storage_operation_log', 'storage_operation_log_head', 'storage_lifecycle_pending_operations')
),
required_functions as (
  select f.sig, pg_catalog.to_regprocedure(f.sig) as oid from (values
    ('public.storage_lifecycle_replace_reference(text, text, text, text, text, text, text, text)'),
    ('public.storage_lifecycle_replace_json_reference(text, text, text, text, text[], text, text, text, text)'),
    ('public.storage_lifecycle_append_log(uuid, text, text, text, text, text, text, text, text, text, text, text, text, jsonb)'),
    ('public.storage_lifecycle_lock_key(text, text)'),
    ('public.storage_lifecycle_known_buckets()'),
    ('public.storage_lifecycle_object_key(text, text[])'),
    ('public.storage_lifecycle_sync_scan(text, jsonb, text)'),
    ('public.storage_lifecycle_set_manual_protection(text, text, text, boolean, text, text)'),
    ('public.storage_operation_log_verify()'),
    ('public.storage_operation_log_canonical(public.storage_operation_log)')
  ) as f (sig)
),
constraint_defs as (
  select con.conname, pg_catalog.pg_get_constraintdef(con.oid) as def
  from pg_catalog.pg_constraint as con
  where con.conrelid in (pg_catalog.to_regclass('public.storage_operation_log'), pg_catalog.to_regclass('public.storage_object_lifecycle'))
),
checks (ordem, verificacao, ok, detalhe) as (
  select 1, 'estrutura principal: 5 tabelas + view, dono storage_lifecycle_owner, RLS nas tabelas',
    (select pg_catalog.count(*) = 6 and pg_catalog.bool_and(dono = 'storage_lifecycle_owner') and pg_catalog.bool_and(rls or relkind = 'v') from main_tables),
    (select pg_catalog.string_agg(relname || ':' || dono, ', ' order by relname) from main_tables)
  union all
  select 2, 'funções da migração principal com as assinaturas esperadas e o proprietário dedicado',
    (select pg_catalog.bool_and(oid is not null) and pg_catalog.bool_and((select p.proowner = (select o.oid from owner_role as o) from pg_catalog.pg_proc as p where p.oid = rf.oid)) from required_functions as rf),
    (select coalesce(pg_catalog.string_agg(sig, '; ') filter (where oid is null), 'todas presentes') from required_functions)
  union all
  select 3, 'achievement-art entre os buckets do ciclo de vida',
    coalesce((select p.prosrc ~ 'achievement-art' from pg_catalog.pg_proc as p where p.oid = pg_catalog.to_regprocedure('public.storage_lifecycle_known_buckets()')), false),
    'storage_lifecycle_known_buckets()'
  union all
  select 4, 'restrição de tipos de operação: versão da migração principal (sem object_upload/reference_batch)',
    coalesce((select def ~ 'json_reference_replace' and def !~ 'object_upload' and def !~ 'reference_batch' from constraint_defs where conname = 'storage_operation_log_operation'), false),
    coalesce((select pg_catalog.left(def, 160) from constraint_defs where conname = 'storage_operation_log_operation'), 'AUSENTE')
  union all
  select 5, 'restrição de operações com objeto: versão da migração principal',
    coalesce((select def ~ 'restore_object' and def !~ 'object_upload' from constraint_defs where conname = 'storage_operation_log_object_ops'), false),
    coalesce((select pg_catalog.left(def, 160) from constraint_defs where conname = 'storage_operation_log_object_ops'), 'AUSENTE')
  union all
  select 6, 'objetos: first/last_seen_scan_id NOT NULL, sem registered_by_upload, sem as restrições novas',
    (select pg_catalog.count(*) filter (where a.attname in ('first_seen_scan_id', 'last_seen_scan_id') and a.attnotnull) = 2
            and pg_catalog.count(*) filter (where a.attname = 'registered_by_upload') = 0
       from pg_catalog.pg_attribute as a where a.attrelid = pg_catalog.to_regclass('public.storage_object_lifecycle') and a.attnum > 0 and not a.attisdropped)
    and not exists (select 1 from constraint_defs where conname in ('storage_object_lifecycle_origin', 'storage_object_lifecycle_unscanned_unverified')),
    'colunas e restrições de storage_object_lifecycle'
  union all
  select 7, 'nomes das funções novas livres',
    not exists (select 1 from pg_catalog.pg_proc as p where p.pronamespace = 'public'::regnamespace
                and p.proname in ('storage_lifecycle_begin_upload', 'storage_lifecycle_finish_upload',
                                  'storage_lifecycle_begin_reference_batch', 'storage_lifecycle_finish_reference_batch')),
    'begin/finish_upload, begin/finish_reference_batch'
  union all
  select 8, 'proprietário dedicado: sem login, sem herança, BYPASSRLS, não superusuário',
    coalesce((select not rolcanlogin and not rolinherit and rolbypassrls and not rolsuper from owner_role), false),
    coalesce((select 'login=' || rolcanlogin || ' inherit=' || rolinherit || ' bypassrls=' || rolbypassrls from owner_role), 'AUSENTE')
  union all
  select 9, 'quem aplica pode assumir o proprietário durante a migração (ADMIN sobre ele ou superusuário)',
    (select r.rolsuper from pg_catalog.pg_roles as r where r.rolname = current_user)
    or exists (select 1 from pg_catalog.pg_auth_members as m where m.roleid = (select oid from owner_role) and m.member = current_user::regrole and m.admin_option),
    current_user::text
  union all
  select 10, 'ninguém herda nem assume o proprietário hoje (membros só com ADMIN, sem INHERIT/SET)',
    not exists (select 1 from pg_catalog.pg_auth_members as m where m.roleid = (select oid from owner_role) and (m.inherit_option or m.set_option)),
    coalesce((select pg_catalog.string_agg(m.member::regrole::text || ' admin=' || m.admin_option || ' inherit=' || m.inherit_option || ' set=' || m.set_option, '; ')
              from pg_catalog.pg_auth_members as m where m.roleid = (select oid from owner_role)), 'sem membros')
  union all
  select 11, 'service_role: só SELECT nas tabelas do ciclo de vida (nada na cabeça da cadeia) e EXECUTE nas funções de interface',
    (select pg_catalog.bool_and(case when relname = 'storage_operation_log_head' then not pg_catalog.has_table_privilege('service_role', ('public.' || relname)::regclass, 'SELECT')
                                     else pg_catalog.has_table_privilege('service_role', ('public.' || relname)::regclass, 'SELECT') end
                                and not pg_catalog.has_table_privilege('service_role', ('public.' || relname)::regclass, 'INSERT,UPDATE,DELETE,TRUNCATE')) from main_tables)
    and pg_catalog.has_function_privilege('service_role', pg_catalog.to_regprocedure('public.storage_lifecycle_replace_reference(text, text, text, text, text, text, text, text)'), 'EXECUTE')
    and pg_catalog.has_function_privilege('service_role', pg_catalog.to_regprocedure('public.storage_operation_log_verify()'), 'EXECUTE'),
    'tabelas, view e funções de interface'
  union all
  select 12, 'navegador (anon/authenticated) sem acesso às tabelas e funções storage_*',
    not exists (select 1 from main_tables as t where pg_catalog.has_table_privilege('anon', ('public.' || t.relname)::regclass, 'SELECT')
                                                 or pg_catalog.has_table_privilege('authenticated', ('public.' || t.relname)::regclass, 'SELECT'))
    and not exists (select 1 from pg_catalog.pg_proc as p where p.pronamespace = 'public'::regnamespace and p.proname ~ '^storage_'
                    and (pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
    'anon/authenticated'
  union all
  select 13, 'nenhuma operação pendente no ciclo de vida',
    (select pg_catalog.count(*) = 0 from public.storage_lifecycle_pending_operations),
    (select pg_catalog.count(*)::text || ' pendente(s)' from public.storage_lifecycle_pending_operations)
  union all
  select 14, 'auditoria sem tipos novos e cabeça da cadeia apontando para o último registro',
    not exists (select 1 from public.storage_operation_log where operation in ('object_upload', 'reference_batch'))
    and (select h.last_entry_id is not distinct from (select pg_catalog.max(id) from public.storage_operation_log)
                and h.last_entry_hash is not distinct from (select l.entry_hash from public.storage_operation_log as l order by l.id desc limit 1)
         from public.storage_operation_log_head as h where h.singleton),
    (select pg_catalog.count(*)::text || ' registro(s) de auditoria' from public.storage_operation_log)
  union all
  select 15, 'objetos atuais compatíveis com as restrições novas (todos com varredura de origem e da última vez)',
    not exists (select 1 from public.storage_object_lifecycle where first_seen_scan_id is null or last_seen_scan_id is null),
    (select pg_catalog.count(*)::text || ' objeto(s) no ciclo de vida' from public.storage_object_lifecycle)
  union all
  select 16, 'gatilho de evento do PostgREST ativo (as funções novas aparecem na API sem reiniciar)',
    exists (select 1 from pg_catalog.pg_event_trigger where evtname = 'pgrst_ddl_watch' and evtenabled <> 'D'),
    'pgrst_ddl_watch'
  union all
  select 17, 'versão do PostgreSQL ≥ 15 e sha256/gen_random_uuid disponíveis',
    pg_catalog.current_setting('server_version_num')::integer >= 150000
    and pg_catalog.to_regprocedure('pg_catalog.sha256(bytea)') is not null and pg_catalog.to_regprocedure('pg_catalog.gen_random_uuid()') is not null,
    pg_catalog.current_setting('server_version')
)
select ordem, verificacao, coalesce(ok, false) as ok, detalhe from checks
union all
select 99, 'PRONTO_PARA_APLICAR', pg_catalog.bool_and(coalesce(ok, false)),
       coalesce(pg_catalog.string_agg(ordem::text, ', ' order by ordem) filter (where not coalesce(ok, false)), 'nenhuma divergência')
from checks
order by 1;

rollback;

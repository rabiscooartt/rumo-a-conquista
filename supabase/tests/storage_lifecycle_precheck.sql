-- Pré-verificação SOMENTE LEITURA para a migração 20261114_create_storage_image_lifecycle.
-- Roda numa transação READ ONLY: o próprio Postgres recusa qualquer escrita. Termina em rollback.
-- Não cria, altera nem remove nada. Cada consulta devolve uma tabela para conferência.
begin transaction read only;

-- 1. Versão: a migração exige PostgreSQL 15 ou superior (views security_invoker).
select pg_catalog.version() as versao,
       pg_catalog.current_setting('server_version_num')::integer as versao_num,
       pg_catalog.current_setting('server_version_num')::integer >= 150000 as pg15_ou_superior;

-- 2. Recursos usados pela migração (todos nativos, sem extensão).
select required.nome, exists (
         select 1 from pg_catalog.pg_proc as p
         where p.proname = required.nome and p.pronamespace = 'pg_catalog'::regnamespace
       ) as disponivel
from (values ('gen_random_uuid'), ('sha256'), ('make_interval'), ('hashtextextended'), ('pg_advisory_xact_lock'),
             ('jsonb_set'), ('convert_from'), ('convert_to'), ('format_type'), ('to_regclass')) as required (nome)
order by 1;

-- 3. Papéis esperados e suas propriedades (service_role precisa ignorar RLS; o dono das funções
--    não pode ser anon/authenticated).
select r.rolname as papel, r.rolsuper as superusuario, r.rolbypassrls as ignora_rls, r.rolcanlogin as pode_entrar
from pg_catalog.pg_roles as r
where r.rolname in ('anon', 'authenticated', 'service_role', 'postgres', 'supabase_admin')
order by 1;
-- 3b. Proprietário dedicado (revisão 3.3): quem roda a migração precisa criar papéis e ter
--     BYPASSRLS (para criar storage_lifecycle_owner com BYPASSRLS), e o nome precisa estar livre.
select r.rolname as quem_roda_a_migracao, r.rolsuper as superusuario, r.rolcreaterole as cria_papeis, r.rolbypassrls as ignora_rls,
       (r.rolsuper or (r.rolcreaterole and r.rolbypassrls)) as pode_criar_proprietario,
       exists (select 1 from pg_catalog.pg_roles as o where o.rolname = 'storage_lifecycle_owner') as proprietario_ja_existe
from pg_catalog.pg_roles as r
where r.rolname = current_user;
select current_user as usuario_atual, session_user as usuario_sessao,
       pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') as pode_criar_em_public,
       pg_catalog.has_table_privilege(current_user, 'public.games', 'SELECT,UPDATE') as acessa_games,
       pg_catalog.now() as horario_do_servidor;

-- 4. Nomes livres: tudo aqui deve vir vazio (a migração falha se algo já existir).
select c.relname as objeto_existente, c.relkind as tipo
from pg_catalog.pg_class as c join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname ~ '^storage_(lifecycle|operation_log|object_lifecycle)';
select p.oid::regprocedure as funcao_existente
from pg_catalog.pg_proc as p join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname ~ '^storage_(lifecycle|operation_log|object_lifecycle)';

-- 5. Colunas que as funções de troca de referência usam (tipos esperados: texto e json/jsonb).
select c.table_name as tabela, c.column_name as coluna, c.data_type as tipo, c.is_nullable as aceita_nulo
from information_schema.columns as c
where c.table_schema = 'public' and (
     (c.table_name = 'achievements' and c.column_name in ('id', 'image', 'official_image'))
  or (c.table_name = 'achievement_progress' and c.column_name in ('id', 'image_override', 'status', 'earned_at'))
  or (c.table_name = 'journey_entries' and c.column_name in ('id', 'tags'))
  or (c.table_name = 'journey_history_events' and c.column_name in ('id', 'metadata'))
  or (c.table_name = 'games' and c.column_name in ('slug', 'image', 'card_image', 'final_badge', 'emblem', 'trophies', 'review'))
)
order by 1, 2;

-- 6. Todas as colunas json/jsonb/texto[] do esquema public (para achar outras referências de imagem).
select c.table_name as tabela, c.column_name as coluna, c.data_type as tipo
from information_schema.columns as c
where c.table_schema = 'public' and c.data_type in ('json', 'jsonb', 'ARRAY')
order by 1, 2;

-- 7. Gatilhos nas tabelas que terão referências trocadas pelas novas funções.
select t.event_object_table as tabela, t.trigger_name as gatilho, t.action_timing as momento,
       pg_catalog.string_agg(t.event_manipulation, ', ') as eventos
from information_schema.triggers as t
where t.event_object_schema = 'public' and t.event_object_table in ('games', 'achievements', 'achievement_progress')
group by 1, 2, 3
order by 1, 2;

-- 8. Quem pode criar objetos no esquema public (relevante para search_path; as funções novas
--    usam search_path vazio e nomes qualificados).
select r.rolname as papel, pg_catalog.has_schema_privilege(r.rolname, 'public', 'CREATE') as pode_criar,
       pg_catalog.has_schema_privilege(r.rolname, 'public', 'USAGE') as pode_usar
from pg_catalog.pg_roles as r
where r.rolname in ('anon', 'authenticated', 'service_role')
order by 1;

-- 9. Privilégios padrão no esquema public (o que tabelas/funções novas recebem automaticamente;
--    a migração revoga explicitamente e confere no fim).
select d.defaclrole::regrole as dono, d.defaclobjtype as tipo_objeto, d.defaclacl as privilegios
from pg_catalog.pg_default_acl as d
where d.defaclnamespace = 'public'::regnamespace
order by 1, 2;

-- 10. Isolamento padrão (as funções contam com READ COMMITTED para esperar e reler sob trava).
select pg_catalog.current_setting('default_transaction_isolation') as isolamento_padrao,
       pg_catalog.current_setting('server_encoding') as codificacao,
       d.datcollate as collate, d.datctype as ctype
from pg_catalog.pg_database as d
where d.datname = pg_catalog.current_database();

-- 11. Gatilhos de evento que possam alterar objetos criados (ex.: concessões automáticas).
select e.evtname as gatilho_evento, e.evtevent as evento, e.evtenabled as ativo
from pg_catalog.pg_event_trigger as e
order by 1;

-- 12. Funções dos gatilhos das tabelas alteradas pela troca de referências (revisão 3.4).
--     Função não SECURITY DEFINER roda com os privilégios de storage_lifecycle_owner: conferir o que ela grava.
select c.relname as tabela, t.tgname as gatilho, pg_catalog.pg_get_triggerdef(t.oid) as definicao,
       p.oid::regprocedure as funcao, pg_catalog.pg_get_userbyid(p.proowner) as dono, p.prosecdef as security_definer, p.proconfig as config
from pg_catalog.pg_trigger as t
join pg_catalog.pg_class as c on c.oid = t.tgrelid
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
join pg_catalog.pg_proc as p on p.oid = t.tgfoid
where n.nspname = 'public' and c.relname in ('games', 'achievements', 'achievement_progress') and not t.tgisinternal
order by 1, 2;

-- 13. Donos e opção de repasse: quem roda a migração precisa repassar os privilégios de coluna e o
--     CREATE em public ao proprietário dedicado.
select c.relname as tabela, pg_catalog.pg_get_userbyid(c.relowner) as dono,
       pg_catalog.has_table_privilege(current_user, c.oid, 'SELECT WITH GRANT OPTION') as select_com_repasse,
       pg_catalog.has_table_privilege(current_user, c.oid, 'UPDATE WITH GRANT OPTION') as update_com_repasse
from pg_catalog.pg_class as c join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('games', 'achievements', 'achievement_progress')
order by 1;
select pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE WITH GRANT OPTION') as public_create_com_repasse,
       pg_catalog.has_schema_privilege(current_user, 'public', 'USAGE WITH GRANT OPTION') as public_usage_com_repasse;

-- 14. Progressos concluídos sem earned_at: a troca de imagem neles é RECUSADA pela migração.
select pg_catalog.count(*) as progresso_concluido_sem_earned_at
from public.achievement_progress where status = 'completed' and earned_at is null;

-- 15. Jogos concluídos sem completed_at (revisão 3.5): a troca de imagem NÃO pode preencher a data.
--     Informativo; supabase/tests/storage_lifecycle_reference_matrix_check.sql prova que não preenche.
select pg_catalog.count(*) as jogo_concluido_sem_completed_at
from public.games where status = 'completed' and completed_at is null;

-- (As permissões da Jornada são outra frente: supabase/tests/journey_permissions_precheck.sql.)

rollback;

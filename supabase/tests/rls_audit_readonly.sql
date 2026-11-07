-- Auditoria de RLS e privilégios — SOMENTE LEITURA.
-- Rode no SQL Editor do Supabase. Nenhuma linha aqui altera dados, políticas ou permissões.

-- 1. Tabelas públicas: RLS ligado (relrowsecurity) e forçado (relforcerowsecurity).
select c.relname as tabela, c.relrowsecurity as rls_ativo, c.relforcerowsecurity as rls_forcado
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;

-- 2. Políticas das tabelas públicas (quem pode fazer o quê).
select tablename as tabela, policyname as politica, roles as papeis, cmd as operacao,
       qual as condicao_leitura, with_check as condicao_escrita
from pg_policies
where schemaname = 'public'
order by 1, 2;

-- 3. Privilégios concedidos aos papéis do navegador (anon e authenticated).
--    Com RLS desligado, um INSERT/UPDATE/DELETE listado aqui significa escrita liberada pela chave pública.
select table_name as tabela, grantee as papel,
       string_agg(privilege_type, ', ' order by privilege_type) as privilegios
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by 1, 2
order by 1, 2;

-- 4. Buckets e políticas do Storage.
select id as bucket, public as publico, file_size_limit as limite_bytes, allowed_mime_types as tipos
from storage.buckets
order by 1;

select policyname as politica, roles as papeis, cmd as operacao, qual as condicao_leitura, with_check as condicao_escrita
from pg_policies
where schemaname = 'storage'
order by 1;

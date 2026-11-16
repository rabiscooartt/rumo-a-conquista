-- Desfaz supabase/migrations/20261114_create_storage_image_lifecycle.sql SEM APAGAR DADOS.
--
-- Nunca apaga histórico de operações, evidência de varreduras, referências de restauração nem
-- metadados de arquivos arquivados (archive_bucket/archive_path/archive_sha256/restore_metadata:
-- sem eles, um original já removido do Storage não pode ser restaurado).
--
--   * Tabelas vazias: tudo é removido (funções, tabelas, view e o papel proprietário).
--   * Tabelas com qualquer linha: o rollback RECUSA, a menos que a sessão confirme a preservação:
--
--       set app.storage_lifecycle_rollback_confirm = 'preservar-historico';
--
--     Com a confirmação, as tabelas (com todas as linhas, índices e chaves) são MOVIDAS para um
--     schema novo storage_lifecycle_preserved_<data-hora>, sem acesso para anon, authenticated ou
--     service_role; só então funções, view e papel são removidos. Apagar esse schema depois é uma
--     decisão separada e explícita do administrador, fora deste arquivo.
--
-- Tudo numa transação: se algo falhar, nada muda. Não altera dados de achievements,
-- achievement_progress, games nem do Storage (só retira os privilégios de coluna que a migração
-- deu ao proprietário dedicado).

begin;

-- As tabelas pertencem a storage_lifecycle_owner: quem roda o rollback precisa administrar esse
-- papel (como o postgres que rodou a migração) e passa a participar dele só nesta transação.
grant storage_lifecycle_owner to current_user;

do $$
declare
  tables constant text[] := array['storage_operation_log', 'storage_operation_log_head', 'storage_object_lifecycle',
                                  'storage_lifecycle_scan_objects', 'storage_lifecycle_scans'];
  operations bigint;
  evidence bigint;
  scans bigint;
  objects bigint;
  archived bigint;
  preserved_schema text;
  table_name text;
  trigger_name text;
begin
  select count(*) into operations from public.storage_operation_log;
  select count(*) into evidence from public.storage_lifecycle_scan_objects;
  select count(*) into scans from public.storage_lifecycle_scans;
  select count(*) into objects from public.storage_object_lifecycle;
  select count(*) into archived from public.storage_object_lifecycle
  where archive_state <> 'none' or archive_path is not null or restore_metadata <> '{}'::jsonb;

  if operations + evidence + scans + objects = 0 then
    raise notice 'Rollback: tabelas vazias; nada a preservar.';
    return;
  end if;

  if coalesce(current_setting('app.storage_lifecycle_rollback_confirm', true), '') <> 'preservar-historico' then
    raise exception using errcode = '55000', message = format(
      'Rollback recusado: há dados que não podem ser apagados (auditoria %s, evidência %s, varreduras %s, objetos %s, com arquivamento/restauração %s). '
      || 'Para remover a estrutura PRESERVANDO os dados num schema separado, rode antes: set app.storage_lifecycle_rollback_confirm = ''preservar-historico'';',
      operations, evidence, scans, objects, archived);
  end if;

  preserved_schema := 'storage_lifecycle_preserved_' || to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDD_HH24MISS');
  execute format('create schema %I', preserved_schema);
  execute format('revoke all on schema %I from public', preserved_schema);
  execute format('comment on schema %I is %L', preserved_schema, format(
    'Dados preservados pelo rollback do ciclo de vida das imagens em %s: auditoria %s, evidência %s, varreduras %s, objetos %s (com arquivamento/restauração: %s). Apagar é decisão explícita.',
    now(), operations, evidence, scans, objects, archived));

  foreach table_name in array tables loop
    -- Os gatilhos dependem das funções que serão removidas; as linhas ficam intactas.
    for trigger_name in
      select t.tgname from pg_trigger as t where t.tgrelid = format('public.%I', table_name)::regclass and not t.tgisinternal
    loop
      execute format('drop trigger %I on public.%I', trigger_name, table_name);
    end loop;
    execute format('alter table public.%I set schema %I', table_name, preserved_schema);
    execute format('revoke all on table %I.%I from public, anon, authenticated, service_role', preserved_schema, table_name);
  end loop;

  raise notice 'Rollback: dados preservados em % (auditoria %, evidência %, varreduras %, objetos %, com arquivamento/restauração %).',
    preserved_schema, operations, evidence, scans, objects, archived;
end;
$$;

drop view if exists public.storage_lifecycle_pending_operations;

-- A função canônica depende do tipo da tabela de auditoria (onde quer que ela esteja agora).
do $$
declare
  fn regprocedure;
begin
  for fn in select p.oid::regprocedure from pg_proc as p where p.proname = 'storage_operation_log_canonical' and p.pronamespace = 'public'::regnamespace loop
    execute format('drop function %s', fn);
  end loop;
end;
$$;

-- O que ainda está em public está vazio (o bloco acima recusa ou move as tabelas com dados).
drop table if exists public.storage_operation_log;
drop table if exists public.storage_operation_log_head;
drop table if exists public.storage_object_lifecycle;
drop table if exists public.storage_lifecycle_scan_objects;
drop table if exists public.storage_lifecycle_scans;

-- Demais funções do ciclo de vida em public.
do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure from pg_proc as p
    where p.pronamespace = 'public'::regnamespace and p.proname ~ '^storage_(lifecycle|operation_log|object_lifecycle)'
  loop
    execute format('drop function %s', fn);
  end loop;
end;
$$;

-- Tabelas preservadas passam para quem roda o rollback; privilégios do proprietário e o papel saem.
reassign owned by storage_lifecycle_owner to current_user;
drop owned by storage_lifecycle_owner;
revoke storage_lifecycle_owner from current_user;
drop role storage_lifecycle_owner;

commit;

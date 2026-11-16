-- Etapa 3.3 — matriz de permissões por papel: cada operação é TENTADA de verdade por cada papel
-- (numa subtransação desfeita em seguida) e o resultado é comparado com o esperado.
--
-- Papéis: anon · authenticated · service_role (backend) · admin = superusuário SEM assumir o
-- proprietário · dono = administrador que assumiu storage_lifecycle_owner (limite de confiança).
-- Resultados: ok = executa · P = negado por privilégio · G = negado pela guarda (papel/append-only)
--             R = barrado por regra (constraint, prova, sincronização em andamento, transição)
-- SOMENTE PARA BANCO LOCAL DE TESTE: termina em rollback. Precisa rodar como superusuário.
begin;

create function public._perm_try(p_role text, p_sql text)
returns text
language plpgsql
as $$
begin
  begin
    execute pg_catalog.format('set local role %I', p_role);
    execute p_sql;
    raise exception using errcode = 'P0001', message = '__ok__';
  exception when others then
    if sqlerrm = '__ok__' then return 'ok'; end if;
    if sqlstate = '42501' and (sqlerrm like 'permission denied%' or sqlerrm like 'must be%') then return 'P'; end if;
    if sqlstate = '42501' then return 'G'; end if;
    return 'R';
  end;
end;
$$;

-- Dados reais criados pelas funções (como o backend faria).
set local role service_role;
do $$
begin
  perform public.storage_lifecycle_register_scan('{"scan_id":"scan-20260901T000000Z","completed_at":"2026-09-01T00:00:00Z","complete":true,"inventory_status":"complete","image_objects":1,"image_bytes":1}', 'teste');
  perform public.storage_lifecycle_sync_scan('scan-20260901T000000Z',
    '[{"bucket":"game-images","path":"a.png","state":"observing","reference_count":0,"size":1,"mimetype":"image/png"}]', 'teste');
  perform public.storage_lifecycle_register_scan('{"scan_id":"scan-20260910T000000Z","completed_at":"2026-09-10T00:00:00Z","complete":true,"inventory_status":"complete","image_objects":1,"image_bytes":1}', 'teste');
  perform public.storage_lifecycle_sync_scan('scan-20260910T000000Z',
    '[{"bucket":"game-images","path":"a.png","state":"observing","reference_count":0,"size":1,"mimetype":"image/png"}]', 'teste');
end;
$$;
reset role;

do $$
declare
  roles constant text[] := array['anon', 'authenticated', 'service_role', 'postgres', 'storage_lifecycle_owner'];
  labels constant text[] := array['anon', 'authenticated', 'service_role', 'admin', 'dono'];
  -- {operação, SQL, resultado esperado por papel na ordem acima}
  matrix constant text[][] := array[
    ['ler varreduras', 'select count(*) from public.storage_lifecycle_scans', 'P P ok ok ok'],
    ['ler evidência', 'select count(*) from public.storage_lifecycle_scan_objects', 'P P ok ok ok'],
    ['ler estado dos objetos', 'select count(*) from public.storage_object_lifecycle', 'P P ok ok ok'],
    ['ler auditoria', 'select count(*) from public.storage_operation_log', 'P P ok ok ok'],
    ['ler ponta da cadeia', 'select count(*) from public.storage_operation_log_head', 'P P P ok ok'],
    ['ler pendências', 'select count(*) from public.storage_lifecycle_pending_operations', 'P P ok ok ok'],
    ['inserir varredura direto', $q$insert into public.storage_lifecycle_scans (scan_id, completed_at, complete, inventory_status, image_objects, image_bytes, registered_by) values ('scan-20260102T000000Z', '2026-01-02', true, 'complete', 0, 0, 'x')$q$, 'P P P G ok'],
    ['inserir evidência direto', $q$insert into public.storage_lifecycle_scan_objects (scan_id, bucket, object_path, state, requested_state, reference_count, sync_operation_id) values ('scan-20260910T000000Z', 'game-images', 'falso.png', 'observing', 'observing', 0, gen_random_uuid())$q$, 'P P P G R'],
    ['inserir objeto direto', $q$insert into public.storage_object_lifecycle (bucket, object_path, state, first_seen_at, first_seen_scan_id, last_seen_at, last_seen_scan_id) values ('game-images', 'falso.png', 'referenced', now(), 'scan-20260910T000000Z', now(), 'scan-20260910T000000Z')$q$, 'P P P G ok'],
    ['inserir auditoria direto', $q$insert into public.storage_operation_log (operation_id, phase, operation, idempotency_key, scan_id, actor, reason, entry_hash) values (gen_random_uuid(), 'intent', 'scan_sync', 'falso', 'scan-20260910T000000Z', 'x', 'x', 'x')$q$, 'P P P G ok'],
    ['inserir ponta da cadeia', $q$insert into public.storage_operation_log_head (singleton) values (true)$q$, 'P P P G R'],
    ['alterar varredura', $q$update public.storage_lifecycle_scans set registered_by = registered_by$q$, 'P P P G G'],
    ['alterar evidência', $q$update public.storage_lifecycle_scan_objects set reference_count = reference_count$q$, 'P P P G G'],
    ['alterar estado (sem efeito)', $q$update public.storage_object_lifecycle set mimetype = mimetype$q$, 'P P P G ok'],
    ['marcar candidate sem prova', $q$update public.storage_object_lifecycle set state = 'candidate'$q$, 'P P P G R'],
    ['arquivar sem prova', $q$update public.storage_object_lifecycle set archive_state = 'archiving'$q$, 'P P P G R'],
    ['alterar auditoria', $q$update public.storage_operation_log set reason = reason$q$, 'P P P G G'],
    ['alterar ponta da cadeia', $q$update public.storage_operation_log_head set last_entry_hash = last_entry_hash$q$, 'P P P G ok'],
    ['apagar varredura', 'delete from public.storage_lifecycle_scans', 'P P P G G'],
    ['apagar evidência', 'delete from public.storage_lifecycle_scan_objects', 'P P P G G'],
    ['apagar objeto', 'delete from public.storage_object_lifecycle', 'P P P G G'],
    ['apagar auditoria', 'delete from public.storage_operation_log', 'P P P G G'],
    ['apagar ponta da cadeia', 'delete from public.storage_operation_log_head', 'P P P G G'],
    ['esvaziar (truncate) em cascata', 'truncate public.storage_lifecycle_scans cascade', 'P P P G G'],
    ['ligar variável antiga + inserir evidência', $q$select set_config('app.storage_lifecycle_writer', 'on', true); insert into public.storage_lifecycle_scan_objects (scan_id, bucket, object_path, state, requested_state, reference_count, sync_operation_id) values ('scan-20260910T000000Z', 'game-images', 'falso.png', 'observing', 'observing', 0, gen_random_uuid())$q$, 'P P P G R'],
    -- SET ROLE dentro desta função é conferido contra o usuário da SESSÃO (aqui, superusuário);
    -- por isso a linha confere a participação no papel. O teste com sessão de login real (como o
    -- authenticator do Supabase) está na bateria do PostgreSQL 17.
    ['ser membro do proprietário (poder assumi-lo)', $q$do $x$ begin if not pg_has_role(current_user, 'storage_lifecycle_owner', 'MEMBER') then raise exception using errcode = '42501', message = 'permission denied to set role'; end if; end $x$ $q$, 'P P P ok ok'],
    ['executar função do backend', $q$select public.storage_lifecycle_evidence('game-images', 'a.png')$q$, 'P P ok ok ok'],
    ['executar sincronização', $q$select public.storage_lifecycle_sync_scan('scan-20260910T000000Z', '[]'::jsonb, 'x')$q$, 'P P ok ok ok'],
    ['executar função interna (gravar auditoria)', $q$select public.storage_lifecycle_append_log(gen_random_uuid(), 'intent', 'scan_sync', 'k-interna', null, null, 'scan-20260910T000000Z', 'x', 'x', null, null, null, null, '{}'::jsonb)$q$, 'P P P ok ok'],
    ['executar função interna (resumo da evidência)', $q$select * from public.storage_lifecycle_evidence_digest('scan-20260910T000000Z')$q$, 'P P P ok ok'],
    ['executar função interna (validar referência)', $q$select public.storage_lifecycle_validate_new_reference('x')$q$, 'P P P ok ok']
  ];
  row_index integer;
  role_index integer;
  expected text[];
  outcome text;
  line text;
  failures text := '';
begin
  raise notice 'matriz: operação | anon | authenticated | service_role | admin | dono';
  for row_index in 1 .. array_length(matrix, 1) loop
    expected := string_to_array(matrix[row_index][3], ' ');
    line := rpad(matrix[row_index][1], 46);
    for role_index in 1 .. array_length(roles, 1) loop
      outcome := public._perm_try(roles[role_index], matrix[row_index][2]);
      line := line || ' | ' || rpad(outcome, 2);
      if outcome <> expected[role_index] then
        failures := failures || format(E'\n  %s / %s: esperado %s, veio %s', matrix[row_index][1], labels[role_index], expected[role_index], outcome);
      end if;
    end loop;
    raise notice 'matriz: %', line;
  end loop;
  if failures <> '' then
    raise exception 'FALHA na matriz de permissões:%', failures;
  end if;
  raise notice 'ok: matriz de permissões conferida (% operações × % papéis)', array_length(matrix, 1), array_length(roles, 1);
end;
$$;

-- Papéis da aplicação não são membros do proprietário; quem roda a migração também não fica.
do $$
begin
  assert not pg_has_role('anon', 'storage_lifecycle_owner', 'MEMBER')
     and not pg_has_role('authenticated', 'storage_lifecycle_owner', 'MEMBER')
     and not pg_has_role('service_role', 'storage_lifecycle_owner', 'MEMBER'), 'FALHA: papel da aplicação é membro do proprietário';
  assert (select rolcanlogin from pg_roles where rolname = 'storage_lifecycle_owner') = false, 'FALHA: proprietário não pode ter login';
  assert not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname ~ '^storage_(lifecycle|operation_log|object_lifecycle)' and c.relkind in ('r', 'v')
      and c.relowner <> 'storage_lifecycle_owner'::regrole
  ), 'FALHA: tabela fora do proprietário dedicado';
  assert not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname ~ '^storage_' and p.proowner <> 'storage_lifecycle_owner'::regrole
  ), 'FALHA: função fora do proprietário dedicado';
  raise notice 'ok: proprietário dedicado sem login, dono de todas as tabelas e funções; nenhum papel da aplicação é membro';
end;
$$;

-- Limite de confiança: o que o administrador que assume o proprietário consegue, e o que a
-- verificação detecta.
set local role storage_lifecycle_owner;
insert into public.storage_lifecycle_scans (scan_id, completed_at, complete, inventory_status, image_objects, image_bytes, registered_by)
values ('scan-20260701T000000Z', '2026-07-01', true, 'complete', 1, 1, 'administrador');
reset role;
do $$
begin
  assert exists (select 1 from public.storage_operation_log_verify() where problem like 'varredura scan-20260701T000000Z sem registro auditado%'),
    'FALHA: varredura inserida por fora deveria ser apontada pela verificação';
  raise notice 'ok: [limite] administrador como proprietário insere varredura por fora → executa, mas a verificação aponta';
end;
$$;
set local role storage_lifecycle_owner;
select public._perm_try('storage_lifecycle_owner', $q$insert into public.storage_lifecycle_scan_objects (scan_id, bucket, object_path, state, requested_state, reference_count, sync_operation_id)
  values ('scan-20260701T000000Z', 'game-images', 'a.png', 'observing', 'observing', 0, gen_random_uuid())$q$) as evidencia_sem_sincronizacao;
update public.storage_operation_log_head set last_entry_hash = repeat('0', 64);
reset role;
do $$
begin
  assert exists (select 1 from public.storage_operation_log_verify() where problem = 'a ponta registrada não é o fim da cadeia'),
    'FALHA: ponta adulterada deveria ser detectada';
  raise notice 'ok: [limite] administrador como proprietário altera a ponta da cadeia → executa, mas a verificação aponta';
end;
$$;

-- Evidência adulterada por quem desliga gatilhos (superusuário) também é detectada.
alter table public.storage_lifecycle_scan_objects disable trigger storage_lifecycle_scan_objects_no_change;
update public.storage_lifecycle_scan_objects set reference_count = 0, state = 'observing' where scan_id = 'scan-20260901T000000Z';
update public.storage_lifecycle_scan_objects set requested_state = 'candidate' where scan_id = 'scan-20260910T000000Z';
alter table public.storage_lifecycle_scan_objects enable trigger storage_lifecycle_scan_objects_no_change;
do $$
begin
  assert exists (select 1 from public.storage_operation_log_verify() where problem = 'evidência da varredura scan-20260910T000000Z não confere com a sincronização auditada'),
    'FALHA: evidência adulterada deveria ser detectada';
  raise notice 'ok: [limite] superusuário desliga gatilho e altera evidência → a verificação aponta a varredura adulterada';
end;
$$;

rollback;

-- Ciclo de vida das imagens — política versionada de varredura na PROVA de elegibilidade (Etapa 5.3).
-- Complementa 20261114, 20261116, 20261117 e 20261118 (precisa de todas). Rollback:
-- supabase/rollbacks/20261119_storage_lifecycle_scan_policy_rollback.sql
--
-- Até aqui, qualquer varredura completa e não invalidada contava como prova
-- (storage_lifecycle_evidence). A varredura de 15/11/2026 é anterior à fonte "convention" (imagens
-- exibidas por convenção de nome) e, sem esta migração, formaria par com uma varredura nova.
-- Esta migração faz o BANCO exigir uma política de varredura versionada — a proteção não depende mais
-- de usar o executor certo (a guarda dos gatilhos, a sincronização e o início do arquivamento chamam
-- storage_lifecycle_evidence):
--   1. storage_lifecycle_scan_policies: versões da política (fontes obrigatórias), com o momento em
--      que cada uma foi instalada. Versão 2 = as 10 fontes, inclusive "convention".
--   2. storage_lifecycle_scan_attestations: atestação, por varredura, de que o relatório (SHA-256
--      registrado) foi produzido com uma versão da política e com todas as fontes completas.
--      Somente inclusão; nunca alterada nem apagada.
--   3. Execução oficial (storage_lifecycle_begin_scan_run / finish_scan_run): aberta ANTES da coleta,
--      com a versão vigente; encerrada como sucesso só com a varredura registrada, atestada,
--      sincronizada e com uma linha de evidência por imagem. Simulações não abrem execução.
--      storage_lifecycle_attest_scan atesta só varreduras com execução oficial aberta antes do relatório,
--      pela versão vigente, completas, válidas, com o mesmo SHA-256 de relatório e com um MANIFESTO de
--      todas as fontes (status, contagem, resumo SHA-256), guardado junto; registradas DEPOIS da
--      instalação da versão (varreduras anteriores à política nunca são atestadas).
--   4. storage_lifecycle_evidence passa a contar só varreduras que atendem à versão vigente
--      (storage_lifecycle_scan_meets_policy). As demais continuam no histórico, sem valer como prova.
-- Nenhum objeto, referência, varredura ou registro de auditoria existente é alterado ou apagado.
begin;

do $$
begin
  if pg_catalog.to_regprocedure('public.storage_lifecycle_begin_reference_sync(text, text, integer, integer, text, text, jsonb)') is null then
    raise exception 'A migração 20261118_storage_lifecycle_reference_sync não está aplicada.';
  end if;
  if pg_catalog.to_regclass('public.storage_lifecycle_scan_policies') is not null
     or pg_catalog.to_regclass('public.storage_lifecycle_scan_attestations') is not null
     or exists (select 1 from pg_catalog.pg_proc as p where p.pronamespace = 'public'::regnamespace
                and p.proname in ('storage_lifecycle_attest_scan', 'storage_lifecycle_scan_meets_policy', 'storage_lifecycle_scan_policy_current',
                                'storage_lifecycle_begin_scan_run', 'storage_lifecycle_finish_scan_run')) then
    raise exception 'Objetos da política de varredura já existem: migração aplicada antes ou nomes ocupados.';
  end if;
end;
$$;

grant storage_lifecycle_owner to current_user;
set local role storage_lifecycle_owner;

-- 1. Versões da política --------------------------------------------------------------------------
create table public.storage_lifecycle_scan_policies (
  policy_version integer primary key constraint storage_lifecycle_scan_policies_version check (policy_version >= 1),
  required_sources text[] not null constraint storage_lifecycle_scan_policies_sources check (pg_catalog.cardinality(required_sources) >= 1),
  description text not null,
  introduced_at timestamptz not null default pg_catalog.now()
);
comment on table public.storage_lifecycle_scan_policies is
  'Versões da política de varredura. A maior é a vigente; só varreduras atestadas por ela valem como prova de elegibilidade. Somente inclusão.';

-- 2. Atestações por varredura ---------------------------------------------------------------------
create table public.storage_lifecycle_scan_attestations (
  scan_id text primary key references public.storage_lifecycle_scans (scan_id),
  policy_version integer not null references public.storage_lifecycle_scan_policies (policy_version),
  sources text[] not null,
  manifest jsonb not null constraint storage_lifecycle_scan_attestations_manifest check (pg_catalog.jsonb_typeof(manifest) = 'array'),
  manifest_sha256 text not null constraint storage_lifecycle_scan_attestations_manifest_sha check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  run_operation_id uuid not null unique,
  report_sha256 text not null constraint storage_lifecycle_scan_attestations_sha check (report_sha256 ~ '^[0-9a-f]{64}$'),
  attested_at timestamptz not null default pg_catalog.now(),
  attested_by text not null constraint storage_lifecycle_scan_attestations_actor check (pg_catalog.btrim(attested_by) <> '' and pg_catalog.length(attested_by) <= 200)
);
comment on table public.storage_lifecycle_scan_attestations is
  'Atestação de que a varredura foi produzida com a política indicada e com todas as fontes completas. Somente inclusão.';

create trigger storage_lifecycle_scan_policies_insert_guard before insert on public.storage_lifecycle_scan_policies
  for each row execute function public.storage_lifecycle_insert_guard();
create trigger storage_lifecycle_scan_policies_no_change before update or delete on public.storage_lifecycle_scan_policies
  for each row execute function public.storage_lifecycle_block_change();
create trigger storage_lifecycle_scan_policies_no_truncate before truncate on public.storage_lifecycle_scan_policies
  for each statement execute function public.storage_lifecycle_block_change();
create trigger storage_lifecycle_scan_attestations_insert_guard before insert on public.storage_lifecycle_scan_attestations
  for each row execute function public.storage_lifecycle_insert_guard();
create trigger storage_lifecycle_scan_attestations_no_change before update or delete on public.storage_lifecycle_scan_attestations
  for each row execute function public.storage_lifecycle_block_change();
create trigger storage_lifecycle_scan_attestations_no_truncate before truncate on public.storage_lifecycle_scan_attestations
  for each statement execute function public.storage_lifecycle_block_change();

alter table public.storage_lifecycle_scan_policies enable row level security;
alter table public.storage_lifecycle_scan_attestations enable row level security;
revoke all on table public.storage_lifecycle_scan_policies from public, anon, authenticated, service_role;
revoke all on table public.storage_lifecycle_scan_attestations from public, anon, authenticated, service_role;
grant select on table public.storage_lifecycle_scan_policies to service_role;
grant select on table public.storage_lifecycle_scan_attestations to service_role;

-- Auditoria: novo tipo de operação (exige scan_id, como as demais operações de varredura).
alter table public.storage_operation_log drop constraint storage_operation_log_operation;
alter table public.storage_operation_log add constraint storage_operation_log_operation check (operation in (
  'scan_register', 'scan_invalidate', 'scan_sync', 'state_change', 'object_missing', 'classification_override',
  'manual_protect', 'manual_unprotect',
  'archive_copy', 'archive_cancel', 'delete_object', 'restore_object',
  'reference_replace', 'json_reference_replace',
  'object_upload', 'reference_batch',
  'pointer_activate',
  'reference_sync',
  'scan_attest', 'scan_run'
));
alter table public.storage_operation_log drop constraint storage_operation_log_scan_ops;
alter table public.storage_operation_log add constraint storage_operation_log_scan_ops check (
  operation not in ('scan_register', 'scan_invalidate', 'scan_sync', 'scan_attest') or scan_id is not null
);

-- Versão 2: as 10 fontes de referência, inclusive "convention" (lib/images/lifecycle/references.ts).
insert into public.storage_lifecycle_scan_policies (policy_version, required_sources, description) values
  (2, array['achievements', 'achievement_progress', 'games', 'journey_entries', 'journey_history_events',
            'pointers', 'drafts', 'variant_map', 'protection', 'convention'],
   'Fontes completas, inclusive imagens exibidas por convenção de nome (fonte convention).');

-- 3. Funções --------------------------------------------------------------------------------------
create function public.storage_lifecycle_scan_policy_current()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('policy_version', p.policy_version, 'required_sources', pg_catalog.to_jsonb(p.required_sources),
    'introduced_at', p.introduced_at)
  from public.storage_lifecycle_scan_policies as p order by p.policy_version desc limit 1;
$$;

-- Execução oficial de uma varredura (idempotência pela chave scan_run:<scan_id>). Precisa começar
-- ANTES da coleta: registra a versão vigente da política. Simulações nunca abrem execução, e uma
-- varredura já registrada sem execução aberta antes não pode ser "promovida" a oficial.
create function public.storage_lifecycle_begin_scan_run(p_scan_id text, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.storage_operation_log%rowtype;
  result_phase text;
  policy public.storage_lifecycle_scan_policies%rowtype;
  op uuid := pg_catalog.gen_random_uuid();
begin
  if p_scan_id is null or p_scan_id !~ '^scan-[0-9]{8}T[0-9]{6}Z$' then
    raise exception 'Identificador de varredura inválido.' using errcode = '22023';
  end if;
  perform public.storage_lifecycle_lock_key('scan', p_scan_id);
  select * into existing from public.storage_operation_log as log where log.idempotency_key = 'scan_run:' || p_scan_id and log.phase = 'intent';
  if found then
    select log.phase into result_phase from public.storage_operation_log as log where log.operation_id = existing.operation_id and log.phase <> 'intent';
    return pg_catalog.jsonb_build_object('status', coalesce(result_phase, 'pending'), 'operation_id', existing.operation_id,
      'policy_version', (existing.details ->> 'policy_version')::integer, 'started_at', existing.occurred_at);
  end if;
  if exists (select 1 from public.storage_lifecycle_scans as s where s.scan_id = p_scan_id) then
    raise exception 'Varredura % já registrada sem execução oficial aberta antes: não pode virar oficial.', p_scan_id
      using errcode = '23514', hint = 'storage_lifecycle: scan_run_after_register';
  end if;
  -- Uma execução oficial por vez: a anterior precisa ser concluída ou encerrada como falha.
  if exists (
    select 1 from public.storage_operation_log as other
    where other.operation = 'scan_run' and other.phase = 'intent'
      and not exists (select 1 from public.storage_operation_log as done where done.operation_id = other.operation_id and done.phase <> 'intent')
  ) then
    raise exception 'Outra execução oficial de varredura está pendente; conclua-a ou encerre-a como falha antes.'
      using errcode = '55000', hint = 'storage_lifecycle: scan_run_other_pending';
  end if;
  select * into policy from public.storage_lifecycle_scan_policies as p order by p.policy_version desc limit 1;
  perform public.storage_lifecycle_append_log(op, 'intent', 'scan_run', 'scan_run:' || p_scan_id, null, null, null, p_actor,
    'varredura oficial (política v' || policy.policy_version::text || ')', null, null, null, null,
    pg_catalog.jsonb_build_object('scan_id', p_scan_id, 'policy_version', policy.policy_version));
  return pg_catalog.jsonb_build_object('status', 'started', 'operation_id', op, 'policy_version', policy.policy_version, 'started_at', pg_catalog.now());
end;
$$;

-- Atende à política VIGENTE: execução oficial aberta pela versão vigente e CONCLUÍDA com sucesso
-- (finish_scan_run conferiu registro, atestação, sincronização e evidência); atestada por essa versão
-- com manifesto de todas as fontes; completa, válida e com o mesmo SHA-256 de relatório registrado.
-- Única exceção: dentro da própria sincronização desta varredura (transação única, ainda em
-- andamento), para a classificação daquele momento. Execução pendente ou com falha nunca vale.
create function public.storage_lifecycle_scan_meets_policy(p_scan_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.storage_lifecycle_scans as s
    join public.storage_lifecycle_scan_attestations as a on a.scan_id = s.scan_id
    join public.storage_lifecycle_scan_policies as p on p.policy_version = a.policy_version
    join public.storage_operation_log as run on run.operation_id = a.run_operation_id and run.phase = 'intent' and run.operation = 'scan_run'
    where s.scan_id = p_scan_id
      and s.complete and s.inventory_status = 'complete'
      and s.report_sha256 is not null and a.report_sha256 = s.report_sha256
      and p.policy_version = (select pg_catalog.max(x.policy_version) from public.storage_lifecycle_scan_policies as x)
      and (run.details ->> 'policy_version')::integer = p.policy_version
      and run.details ->> 'scan_id' = s.scan_id
      and a.sources @> p.required_sources
      and (
        exists (select 1 from public.storage_operation_log as done where done.operation_id = run.operation_id and done.phase = 'succeeded')
        or (
          not exists (select 1 from public.storage_operation_log as done where done.operation_id = run.operation_id and done.phase <> 'intent')
          and exists (
            select 1 from public.storage_operation_log as sync
            where sync.operation = 'scan_sync' and sync.phase = 'intent' and sync.scan_id = s.scan_id
              and sync.occurred_at >= a.attested_at
              and not exists (select 1 from public.storage_operation_log as done where done.operation_id = sync.operation_id and done.phase <> 'intent')
          )
        )
      )
      and public.storage_lifecycle_scan_is_valid(s.scan_id)
  );
$$;

-- Atestação: exige a execução oficial desta varredura, aberta pela versão vigente ANTES da conclusão
-- do relatório, e um MANIFESTO com cada fonte da política (status complete, contagem e resumo SHA-256).
-- As fontes vêm do manifesto, que fica guardado junto com o SHA-256 dele.
create function public.storage_lifecycle_attest_scan(
  p_scan_id text, p_policy_version integer, p_manifest jsonb, p_report_sha256 text, p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  scan public.storage_lifecycle_scans%rowtype;
  policy public.storage_lifecycle_scan_policies%rowtype;
  existing public.storage_lifecycle_scan_attestations%rowtype;
  run public.storage_operation_log%rowtype;
  item jsonb;
  sources text[];
  manifest_sha text;
  op uuid := pg_catalog.gen_random_uuid();
begin
  if p_scan_id is null or p_scan_id !~ '^scan-[0-9]{8}T[0-9]{6}Z$' then
    raise exception 'Identificador de varredura inválido.' using errcode = '22023';
  end if;
  perform public.storage_lifecycle_lock_key('scan', p_scan_id);

  select * into scan from public.storage_lifecycle_scans as s where s.scan_id = p_scan_id;
  if not found then
    raise exception 'Varredura % não registrada.', p_scan_id using errcode = '22023';
  end if;
  select * into policy from public.storage_lifecycle_scan_policies as p order by p.policy_version desc limit 1;
  if p_policy_version is distinct from policy.policy_version then
    raise exception 'A atestação precisa usar a política vigente (v%), não v%.', policy.policy_version, p_policy_version
      using errcode = '22023', hint = 'storage_lifecycle: scan_policy_version';
  end if;

  -- Varredura registrada ANTES da instalação da versão vigente foi produzida sem ela: nunca é atestada
  -- (vale também para quem já tinha atestação de uma versão anterior).
  if scan.registered_at < policy.introduced_at then
    raise exception 'Varredura % foi registrada antes da política v% (%); fica só como histórico.', p_scan_id, policy.policy_version, policy.introduced_at
      using errcode = '23514', hint = 'storage_lifecycle: scan_predates_policy';
  end if;

  -- Execução oficial: aberta antes da conclusão do relatório, pela versão vigente, não encerrada.
  select * into run from public.storage_operation_log as log where log.idempotency_key = 'scan_run:' || p_scan_id and log.phase = 'intent';
  if not found then
    raise exception 'Varredura % sem execução oficial aberta (simulação ou chamada direta): não pode ser atestada.', p_scan_id
      using errcode = '23514', hint = 'storage_lifecycle: scan_run_missing';
  end if;
  if exists (select 1 from public.storage_operation_log as done where done.operation_id = run.operation_id and done.phase <> 'intent') then
    raise exception 'A execução oficial de % já foi encerrada; nada foi alterado.', p_scan_id using errcode = '55000', hint = 'storage_lifecycle: scan_run_closed';
  end if;
  if (run.details ->> 'policy_version')::integer is distinct from policy.policy_version then
    raise exception 'A execução de % começou com a política v%, a vigente é v%: versões diferentes nunca se misturam.', p_scan_id,
      run.details ->> 'policy_version', policy.policy_version using errcode = '23514', hint = 'storage_lifecycle: scan_run_policy_changed';
  end if;
  if run.occurred_at > scan.completed_at then
    raise exception 'O relatório de % terminou antes da abertura da execução oficial: foi produzido fora dela.', p_scan_id
      using errcode = '23514', hint = 'storage_lifecycle: scan_report_before_run';
  end if;

  -- Manifesto: uma entrada por fonte, todas completas, com contagem e resumo.
  if pg_catalog.jsonb_typeof(p_manifest) is distinct from 'array' then
    raise exception 'Manifesto de fontes ausente.' using errcode = '23514', hint = 'storage_lifecycle: scan_sources_missing';
  end if;
  for item in select value from pg_catalog.jsonb_array_elements(p_manifest) loop
    if pg_catalog.jsonb_typeof(item -> 'source') is distinct from 'string' or item ->> 'status' is distinct from 'complete'
       or pg_catalog.jsonb_typeof(item -> 'references') is distinct from 'number' or (item ->> 'references')::numeric < 0
       or (item ->> 'references')::numeric <> pg_catalog.trunc((item ->> 'references')::numeric)
       or coalesce(item ->> 'digest', '') !~ '^[0-9a-f]{64}$' then
      raise exception 'Fonte incompleta ou inválida no manifesto: %', pg_catalog.left(item::text, 200)
        using errcode = '23514', hint = 'storage_lifecycle: scan_sources_missing';
    end if;
  end loop;
  select pg_catalog.array_agg(value ->> 'source' order by value ->> 'source') into sources from pg_catalog.jsonb_array_elements(p_manifest);
  if sources is null or pg_catalog.cardinality(sources) <> (select pg_catalog.count(distinct x) from pg_catalog.unnest(sources) as x)
     or not (sources @> policy.required_sources) then
    raise exception 'Fontes ausentes ou repetidas para a política v%: exigidas %.', policy.policy_version, policy.required_sources
      using errcode = '23514', hint = 'storage_lifecycle: scan_sources_missing';
  end if;
  manifest_sha := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_manifest::text, 'UTF8')), 'hex');

  select * into existing from public.storage_lifecycle_scan_attestations as a where a.scan_id = p_scan_id;
  if found then
    if (existing.policy_version, existing.report_sha256, existing.manifest_sha256) is distinct from (p_policy_version, p_report_sha256, manifest_sha) then
      raise exception 'A varredura % já foi atestada com outros dados; nada foi alterado.', p_scan_id using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object('status', 'already_attested', 'scan_id', p_scan_id, 'policy_version', existing.policy_version);
  end if;

  if not scan.complete or scan.inventory_status <> 'complete' then
    raise exception 'Varredura % incompleta: não pode ser atestada.', p_scan_id using errcode = '23514', hint = 'storage_lifecycle: scan_incomplete';
  end if;
  if not public.storage_lifecycle_scan_is_valid(p_scan_id) then
    raise exception 'Varredura % invalidada: não pode ser atestada.', p_scan_id using errcode = '23514', hint = 'storage_lifecycle: scan_invalid';
  end if;
  if scan.report_sha256 is null or p_report_sha256 is distinct from scan.report_sha256 then
    raise exception 'SHA-256 do relatório não confere com o registrado na varredura %.', p_scan_id
      using errcode = '23514', hint = 'storage_lifecycle: scan_report_mismatch';
  end if;

  perform public.storage_lifecycle_append_log(op, 'intent', 'scan_attest', 'scan_attest:' || p_scan_id, null, null, p_scan_id, p_actor,
    'atestação da política de varredura v' || policy.policy_version::text, null, null, null, null,
    pg_catalog.jsonb_build_object('policy_version', policy.policy_version, 'sources', pg_catalog.to_jsonb(sources), 'report_sha256', p_report_sha256,
      'manifest_sha256', manifest_sha, 'run_operation_id', run.operation_id));
  insert into public.storage_lifecycle_scan_attestations (scan_id, policy_version, sources, manifest, manifest_sha256, run_operation_id, report_sha256, attested_by)
  values (p_scan_id, policy.policy_version, sources, p_manifest, manifest_sha, run.operation_id, p_report_sha256, p_actor);
  perform public.storage_lifecycle_append_log(op, 'succeeded', 'scan_attest', null, null, null, p_scan_id, p_actor, null,
    null, null, null, null, pg_catalog.jsonb_build_object('policy_version', policy.policy_version));
  return pg_catalog.jsonb_build_object('status', 'attested', 'scan_id', p_scan_id, 'policy_version', policy.policy_version, 'operation_id', op,
    'manifest_sha256', manifest_sha);
end;
$$;

-- Encerramento da execução oficial. "succeeded" só com a varredura registrada, atestada, sincronizada
-- (sincronização auditada concluída) e com uma linha de evidência por imagem do relatório. "failed"
-- a qualquer momento: a varredura nunca vale como prova. Repetir devolve o resultado já gravado.
create function public.storage_lifecycle_finish_scan_run(p_scan_id text, p_result text, p_actor text, p_details jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.storage_operation_log%rowtype;
  result_phase text;
  scan public.storage_lifecycle_scans%rowtype;
  attestation public.storage_lifecycle_scan_attestations%rowtype;
  evidence_rows integer;
begin
  if p_result not in ('succeeded', 'failed') then
    raise exception 'Resultado inválido: %', p_result using errcode = '22023';
  end if;
  perform public.storage_lifecycle_lock_key('scan', p_scan_id);
  select * into run from public.storage_operation_log as log where log.idempotency_key = 'scan_run:' || p_scan_id and log.phase = 'intent';
  if not found then
    raise exception 'Varredura % sem execução oficial.', p_scan_id using errcode = '22023';
  end if;
  select log.phase into result_phase from public.storage_operation_log as log where log.operation_id = run.operation_id and log.phase <> 'intent';
  if found then
    return pg_catalog.jsonb_build_object('status', 'already_finished', 'result', result_phase, 'operation_id', run.operation_id);
  end if;

  if p_result = 'succeeded' then
    select * into scan from public.storage_lifecycle_scans as s where s.scan_id = p_scan_id;
    if not found then
      raise exception 'Varredura % não registrada.', p_scan_id using errcode = '55000', hint = 'storage_lifecycle: scan_run_incomplete';
    end if;
    select * into attestation from public.storage_lifecycle_scan_attestations as a where a.scan_id = p_scan_id and a.run_operation_id = run.operation_id;
    if not found or attestation.report_sha256 is distinct from scan.report_sha256 then
      raise exception 'Varredura % sem atestação desta execução.', p_scan_id using errcode = '55000', hint = 'storage_lifecycle: scan_run_incomplete';
    end if;
    -- A sincronização precisa vir DEPOIS da atestação: só assim a classificação dela usou esta prova.
    if not exists (
      select 1 from public.storage_operation_log as sync
      join public.storage_operation_log as done on done.operation_id = sync.operation_id and done.phase = 'succeeded'
      where sync.operation = 'scan_sync' and sync.phase = 'intent' and sync.scan_id = p_scan_id and sync.occurred_at >= attestation.attested_at
    ) then
      raise exception 'Varredura % sem sincronização concluída depois da atestação.', p_scan_id using errcode = '55000', hint = 'storage_lifecycle: scan_run_incomplete';
    end if;
    select pg_catalog.count(*) into evidence_rows from public.storage_lifecycle_scan_objects as so where so.scan_id = p_scan_id;
    if evidence_rows <> scan.image_objects then
      raise exception 'Varredura % com % linha(s) de evidência para % imagem(ns) do relatório.', p_scan_id, evidence_rows, scan.image_objects
        using errcode = '55000', hint = 'storage_lifecycle: scan_run_incomplete';
    end if;
  end if;

  perform public.storage_lifecycle_append_log(run.operation_id, p_result, 'scan_run', null, null, null, null, p_actor, null,
    null, null, null, null, coalesce(p_details, '{}'::jsonb) || pg_catalog.jsonb_build_object('scan_id', p_scan_id));
  return pg_catalog.jsonb_build_object('status', p_result, 'operation_id', run.operation_id);
end;
$$;

-- 4. Prova de elegibilidade: igual à anterior, mas só conta varreduras que atendem à política vigente.
create or replace function public.storage_lifecycle_evidence(p_bucket text, p_object_path text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target public.storage_object_lifecycle%rowtype;
  latest public.storage_lifecycle_scans%rowtype;
  scan public.storage_lifecycle_scans%rowtype;
  first_scan public.storage_lifecycle_scans%rowtype;
  seen public.storage_lifecycle_scan_objects%rowtype;
  streak integer := 0;
  stop_reason text;
  last_unprotect timestamptz;
  verdict jsonb;
  policy_version integer := (select pg_catalog.max(p.policy_version) from public.storage_lifecycle_scan_policies as p);
begin
  select * into target from public.storage_object_lifecycle as obj where obj.bucket = p_bucket and obj.object_path = p_object_path;
  if not found then
    return pg_catalog.jsonb_build_object('eligible', false, 'reason', 'objeto fora do ciclo de vida');
  end if;
  if target.manual_protection then
    return pg_catalog.jsonb_build_object('eligible', false, 'reason', 'proteção manual ativa');
  end if;
  if target.state = 'protected' then
    return pg_catalog.jsonb_build_object('eligible', false, 'reason', 'objeto protegido');
  end if;

  select * into latest from public.storage_lifecycle_scans as s order by s.completed_at desc, s.scan_id desc limit 1;
  if not found then
    return pg_catalog.jsonb_build_object('eligible', false, 'reason', 'nenhuma varredura registrada');
  end if;
  if not public.storage_lifecycle_scan_is_valid(latest.scan_id) then
    return pg_catalog.jsonb_build_object('eligible', false, 'reason', 'a varredura mais recente está incompleta ou invalidada', 'latest_scan', latest.scan_id);
  end if;
  if not public.storage_lifecycle_scan_meets_policy(latest.scan_id) then
    return pg_catalog.jsonb_build_object('eligible', false, 'reason', 'a varredura mais recente não atende à política de varredura vigente',
      'latest_scan', latest.scan_id, 'policy_version', policy_version);
  end if;

  for scan in select * from public.storage_lifecycle_scans as s order by s.completed_at desc, s.scan_id desc loop
    -- Só varreduras que atendem à política vigente contam; as demais ficam no histórico.
    if not public.storage_lifecycle_scan_meets_policy(scan.scan_id) then
      continue;
    end if;
    select * into seen from public.storage_lifecycle_scan_objects as so
    where so.scan_id = scan.scan_id and so.bucket = p_bucket and so.object_path = p_object_path;
    if not found then
      stop_reason := 'ausente da varredura ' || scan.scan_id;
      exit;
    end if;
    if seen.reference_count > 0 or seen.manual_protection or seen.state in ('protected', 'active', 'referenced') then
      stop_reason := 'referenciado ou protegido na varredura ' || scan.scan_id;
      exit;
    end if;
    streak := streak + 1;
    first_scan := scan;
  end loop;

  verdict := pg_catalog.jsonb_build_object('latest_scan', latest.scan_id, 'first_scan', first_scan.scan_id, 'scans', streak,
    'span_days', case when streak > 0 then pg_catalog.round((extract(epoch from latest.completed_at - first_scan.completed_at) / 86400)::numeric, 2) end,
    'required_days', target.safety_period_days, 'stopped_at', stop_reason, 'policy_version', policy_version);

  if streak < 2 then
    return verdict || pg_catalog.jsonb_build_object('eligible', false, 'reason', 'menos de duas varreduras completas e válidas sem referência');
  end if;
  if latest.completed_at - first_scan.completed_at < pg_catalog.make_interval(days => target.safety_period_days) then
    return verdict || pg_catalog.jsonb_build_object('eligible', false, 'reason', 'intervalo entre as varreduras menor que o prazo de segurança');
  end if;
  select pg_catalog.max(log.occurred_at) into last_unprotect from public.storage_operation_log as log
  where log.operation = 'manual_unprotect' and log.phase = 'succeeded' and log.bucket = p_bucket and log.object_path = p_object_path;
  if last_unprotect is not null and last_unprotect > first_scan.completed_at then
    return verdict || pg_catalog.jsonb_build_object('eligible', false, 'reason', 'proteção manual removida dentro do período de evidência');
  end if;
  return verdict || pg_catalog.jsonb_build_object('eligible', true, 'reason', null);
end;
$$;

revoke all on function public.storage_lifecycle_scan_policy_current() from public, anon, authenticated;
revoke all on function public.storage_lifecycle_scan_meets_policy(text) from public, anon, authenticated;
revoke all on function public.storage_lifecycle_attest_scan(text, integer, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.storage_lifecycle_begin_scan_run(text, text) from public, anon, authenticated;
revoke all on function public.storage_lifecycle_finish_scan_run(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.storage_lifecycle_scan_policy_current() to service_role;
grant execute on function public.storage_lifecycle_scan_meets_policy(text) to service_role;
grant execute on function public.storage_lifecycle_attest_scan(text, integer, jsonb, text, text) to service_role;
grant execute on function public.storage_lifecycle_begin_scan_run(text, text) to service_role;
grant execute on function public.storage_lifecycle_finish_scan_run(text, text, text, jsonb) to service_role;

reset role;
revoke storage_lifecycle_owner from current_user;

do $$
declare
  problem text;
begin
  select pg_catalog.string_agg(p.oid::regprocedure::text, ', ') into problem
  from pg_catalog.pg_proc as p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('storage_lifecycle_scan_policy_current', 'storage_lifecycle_scan_meets_policy', 'storage_lifecycle_attest_scan', 'storage_lifecycle_evidence',
                      'storage_lifecycle_begin_scan_run', 'storage_lifecycle_finish_scan_run')
    and (p.proowner <> 'storage_lifecycle_owner'::regrole or not p.prosecdef
         or not coalesce(p.proconfig @> array['search_path=""'], false)
         or pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
         or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
         or not pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'));
  if problem is not null then
    raise exception 'Funções com dono, segurança ou privilégios incorretos: %', problem;
  end if;
  if pg_catalog.has_table_privilege('service_role', 'public.storage_lifecycle_scan_attestations', 'INSERT')
     or pg_catalog.has_table_privilege('anon', 'public.storage_lifecycle_scan_attestations', 'SELECT') then
    raise exception 'Privilégios incorretos na tabela de atestações.';
  end if;
  if (select pg_catalog.count(*) from public.storage_lifecycle_scan_policies) <> 1 then
    raise exception 'Esperada exatamente a política v2.';
  end if;
  -- Nenhuma varredura existente atende à política nova: todas ficam só como histórico.
  if exists (select 1 from public.storage_lifecycle_scans as s where public.storage_lifecycle_scan_meets_policy(s.scan_id)) then
    raise exception 'Alguma varredura anterior passou a atender à política; nada foi aplicado.';
  end if;
  if pg_catalog.pg_has_role(current_user, 'storage_lifecycle_owner', 'USAGE') and not (select rolsuper from pg_catalog.pg_roles where rolname = current_user) then
    raise exception 'quem aplicou a migração não pode herdar storage_lifecycle_owner depois dela.';
  end if;
end;
$$;

commit;

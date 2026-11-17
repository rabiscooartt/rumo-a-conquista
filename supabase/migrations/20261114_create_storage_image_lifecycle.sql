-- Ciclo de vida das imagens do Storage — estrutura persistente (Etapa 3, revisão 3.3).
--
-- Proprietário dedicado: tabelas, gatilhos e funções pertencem ao papel storage_lifecycle_owner
-- (sem login, sem membros depois da migração). Só ele escreve nas tabelas, e só o faz dentro
-- das funções SECURITY DEFINER abaixo; a guarda de escrita confere o papel corrente
-- (current_user), não uma variável de sessão que o chamador possa ligar.
--
-- LIMITE DE CONFIANÇA: um administrador privilegiado do projeto (superusuário, ou papel com
-- CREATEROLE/ADMIN sobre storage_lifecycle_owner, como o postgres do Supabase) pode assumir esse
-- papel, alterar privilégios, desligar gatilhos ou remover objetos. Contra esse nível de acesso
-- não há proteção absoluta: a cadeia de hash e storage_operation_log_verify() tornam a
-- adulteração DETECTÁVEL (auditoria, varreduras e evidência), não impossível.
--
-- Tabelas, todas fechadas para o navegador (anon/authenticated) e escritas SOMENTE pelas
-- funções deste arquivo, executáveis apenas pelo backend (service_role):
--
--   storage_lifecycle_scans          resumo de cada varredura (somente inclusão)
--   storage_lifecycle_scan_objects   evidência por objeto e por varredura (somente inclusão)
--   storage_object_lifecycle         estado atual de cada objeto (alterado só pelas funções)
--   storage_operation_log            auditoria append-only, encadeada por hash
--   storage_operation_log_head       ponta da cadeia de hash (uma linha; serializa a cadeia)
--
-- O report.json local continua sendo o detalhe completo (referências, locais, motivos). No banco
-- fica só o necessário para PROVAR a elegibilidade: por varredura, cada objeto, seu estado e a
-- quantidade de referências (storage_lifecycle_scan_objects).
--
-- Todas as funções usam search_path vazio e nomes qualificados. Nenhuma linha de dados
-- existente é alterada por esta migração.
--
-- Transacional: qualquer erro desfaz tudo. Usa "create" sem "if not exists" de propósito: se algo
-- com o mesmo nome já existir, a migração falha inteira em vez de misturar estruturas. Termina
-- com uma autoverificação de RLS, privilégios e search_path; se ela falhar, nada fica gravado.

begin;

-- ---------------------------------------------------------------------------------------------
-- 0. Proprietário dedicado
-- ---------------------------------------------------------------------------------------------
-- NOLOGIN: ninguém se conecta como ele. BYPASSRLS: as funções de troca de referência precisam
-- ler e alterar achievements/achievement_progress/games, que têm RLS. Privilégios nessas
-- tabelas só por coluna (as colunas de imagem e as chaves).
create role storage_lifecycle_owner nologin noinherit bypassrls;
comment on role storage_lifecycle_owner is
  'Dono exclusivo do ciclo de vida das imagens (storage_lifecycle_*). Sem login e sem membros: só as funções SECURITY DEFINER agem como ele.';
grant usage, create on schema public to storage_lifecycle_owner;
grant select (id, image, official_image), update (image, official_image) on public.achievements to storage_lifecycle_owner;
-- status e earned_at só para leitura: a troca de imagem é recusada em progresso concluído sem data.
grant select (id, image_override, status, earned_at), update (image_override) on public.achievement_progress to storage_lifecycle_owner;
-- review fica de fora (troca de imagem nela é bloqueada; ver storage_lifecycle_replace_json_reference).
grant select (slug, image, card_image, final_badge, emblem, trophies),
      update (image, card_image, final_badge, emblem, trophies) on public.games to storage_lifecycle_owner;

-- Participação temporária só para criar os objetos já com o dono certo (revogada no fim).
grant storage_lifecycle_owner to current_user;
set local role storage_lifecycle_owner;

-- ---------------------------------------------------------------------------------------------
-- 1. Varreduras
-- ---------------------------------------------------------------------------------------------
create table public.storage_lifecycle_scans (
  scan_id text primary key
    constraint storage_lifecycle_scans_id_format check (scan_id ~ '^scan-[0-9]{8}T[0-9]{6}Z$'),
  completed_at timestamptz not null,
  complete boolean not null,
  inventory_status text not null
    constraint storage_lifecycle_scans_inventory_status check (inventory_status in ('complete', 'partial')),
  image_objects integer not null constraint storage_lifecycle_scans_objects_nonneg check (image_objects >= 0),
  image_bytes bigint not null constraint storage_lifecycle_scans_bytes_nonneg check (image_bytes >= 0),
  report_sha256 text constraint storage_lifecycle_scans_report_sha check (report_sha256 ~ '^[0-9a-f]{64}$'),
  registered_at timestamptz not null default now(),
  registered_by text not null constraint storage_lifecycle_scans_actor check (btrim(registered_by) <> '' and length(registered_by) <= 200),
  constraint storage_lifecycle_scans_complete_inventory check (not complete or inventory_status = 'complete')
);

create index storage_lifecycle_scans_completed_idx on public.storage_lifecycle_scans (completed_at desc, scan_id desc);

comment on table public.storage_lifecycle_scans is
  'Resumo de cada varredura do ciclo de vida das imagens. Somente inclusão. A invalidação é registrada em storage_operation_log (operation = scan_invalidate), nunca alterando esta linha.';
comment on column public.storage_lifecycle_scans.scan_id is 'Mesmo identificador da pasta local .image-report/lifecycle/<scan_id>/.';
comment on column public.storage_lifecycle_scans.complete is 'Inventário e todas as fontes completos. Só varredura completa e não invalidada vale como evidência.';
comment on column public.storage_lifecycle_scans.image_objects is 'Quantidade de imagens inventariadas; a sincronização exige exatamente essa quantidade.';
comment on column public.storage_lifecycle_scans.report_sha256 is 'SHA-256 do report.json local: liga o resumo ao detalhe sem copiá-lo para o banco.';

-- ---------------------------------------------------------------------------------------------
-- 2. Evidência por objeto e por varredura
-- ---------------------------------------------------------------------------------------------
create table public.storage_lifecycle_scan_objects (
  scan_id text not null references public.storage_lifecycle_scans (scan_id),
  bucket text not null constraint storage_lifecycle_scan_objects_bucket check (bucket ~ '^[a-z0-9][a-z0-9._-]{1,62}$'),
  object_path text not null constraint storage_lifecycle_scan_objects_path check (
    object_path <> '' and object_path !~ '^/' and object_path !~ '(^|/)\.{1,2}(/|$)' and object_path !~ '//' and length(object_path) <= 1024
  ),
  state text not null constraint storage_lifecycle_scan_objects_state check (
    state in ('protected', 'active', 'referenced', 'unverified', 'duplicate', 'observing', 'candidate', 'superseded')
  ),
  requested_state text not null constraint storage_lifecycle_scan_objects_requested_state check (
    requested_state in ('protected', 'active', 'referenced', 'unverified', 'duplicate', 'observing', 'candidate', 'superseded')
  ),
  reference_count integer not null constraint storage_lifecycle_scan_objects_refs check (reference_count >= 0),
  manual_protection boolean not null default false,
  size_bytes bigint constraint storage_lifecycle_scan_objects_size check (size_bytes >= 0),
  sha256 text constraint storage_lifecycle_scan_objects_sha check (sha256 ~ '^[0-9a-f]{64}$'),
  sync_operation_id uuid not null,
  recorded_at timestamptz not null default now(),
  primary key (scan_id, bucket, object_path)
);

create index storage_lifecycle_scan_objects_object_idx on public.storage_lifecycle_scan_objects (bucket, object_path, scan_id);

comment on table public.storage_lifecycle_scan_objects is
  'Prova de elegibilidade: uma linha por objeto em cada varredura sincronizada. Somente inclusão. O motivo e o local de cada referência ficam no report.json local.';
comment on column public.storage_lifecycle_scan_objects.state is 'Estado efetivo naquela varredura, depois das correções do banco (proteção prevalece; candidato sem prova vira observing).';
comment on column public.storage_lifecycle_scan_objects.requested_state is 'Estado enviado pelo classificador (preliminar). Diferença para state = correção registrada como classification_override.';
comment on column public.storage_lifecycle_scan_objects.sync_operation_id is 'Sincronização auditada que gravou a linha. Só é aceita enquanto essa sincronização está em andamento; o resumo (SHA-256) das linhas entra no resultado dela.';
comment on column public.storage_lifecycle_scan_objects.reference_count is 'Referências encontradas naquela varredura. Qualquer valor acima de zero interrompe a sequência de evidência.';

-- ---------------------------------------------------------------------------------------------
-- 3. Estado atual de cada objeto
-- ---------------------------------------------------------------------------------------------
create table public.storage_object_lifecycle (
  bucket text not null constraint storage_object_lifecycle_bucket_format check (bucket ~ '^[a-z0-9][a-z0-9._-]{1,62}$'),
  object_path text not null constraint storage_object_lifecycle_path_format check (
    object_path <> '' and object_path !~ '^/' and object_path !~ '(^|/)\.{1,2}(/|$)' and object_path !~ '//' and length(object_path) <= 1024
  ),
  state text not null constraint storage_object_lifecycle_state check (
    state in ('protected', 'active', 'referenced', 'unverified', 'duplicate', 'observing', 'candidate', 'superseded')
  ),
  size_bytes bigint constraint storage_object_lifecycle_size check (size_bytes >= 0),
  mimetype text,
  sha256 text constraint storage_object_lifecycle_sha check (sha256 ~ '^[0-9a-f]{64}$'),
  first_seen_at timestamptz not null,
  first_seen_scan_id text not null references public.storage_lifecycle_scans (scan_id),
  last_seen_at timestamptz not null,
  last_seen_scan_id text not null references public.storage_lifecycle_scans (scan_id),
  reference_count integer not null default 0 constraint storage_object_lifecycle_refs check (reference_count >= 0),
  last_referenced_at timestamptz,
  last_referenced_scan_id text references public.storage_lifecycle_scans (scan_id),
  observing_since timestamptz,
  observing_since_scan_id text references public.storage_lifecycle_scans (scan_id),
  safety_period_days integer not null default 30 constraint storage_object_lifecycle_safety check (safety_period_days between 30 and 365),
  safety_deadline timestamptz,
  protected_reason text,
  manual_protection boolean not null default false,
  manual_protection_reason text,
  duplicate_of text,
  archive_state text not null default 'none' constraint storage_object_lifecycle_archive_state check (
    archive_state in ('none', 'archiving', 'archived', 'deleting', 'deleted', 'restoring')
  ),
  archive_bucket text,
  archive_path text,
  archive_sha256 text constraint storage_object_lifecycle_archive_sha check (archive_sha256 ~ '^[0-9a-f]{64}$'),
  archived_at timestamptz,
  restore_metadata jsonb not null default '{}'::jsonb constraint storage_object_lifecycle_restore_meta check (
    jsonb_typeof(restore_metadata) = 'object' and pg_column_size(restore_metadata) <= 16384
  ),
  last_operation_id uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (bucket, object_path),
  constraint storage_object_lifecycle_seen_order check (last_seen_at >= first_seen_at),
  constraint storage_object_lifecycle_protected_reason check (state <> 'protected' or coalesce(btrim(protected_reason), '') <> ''),
  constraint storage_object_lifecycle_manual_protection check (
    not manual_protection or (state = 'protected' and coalesce(btrim(manual_protection_reason), '') <> '')
  ),
  constraint storage_object_lifecycle_referenced_not_observing check (reference_count = 0 or observing_since is null),
  constraint storage_object_lifecycle_observing_needs_start check (
    state not in ('observing', 'candidate') or (observing_since is not null and observing_since_scan_id is not null and reference_count = 0)
  ),
  constraint storage_object_lifecycle_candidate_two_scans check (state <> 'candidate' or observing_since_scan_id <> last_seen_scan_id),
  constraint storage_object_lifecycle_archive_location check (
    archive_state in ('none', 'archiving') or (archive_bucket is not null and archive_path is not null and archive_sha256 is not null and archived_at is not null)
  ),
  constraint storage_object_lifecycle_archive_elsewhere check (
    archive_bucket is null or (archive_bucket, archive_path) is distinct from (bucket, object_path)
  )
);

create index storage_object_lifecycle_state_idx on public.storage_object_lifecycle (state, archive_state);
create index storage_object_lifecycle_deadline_idx on public.storage_object_lifecycle (safety_deadline) where safety_deadline is not null;
create index storage_object_lifecycle_sha_idx on public.storage_object_lifecycle (sha256) where sha256 is not null;

comment on table public.storage_object_lifecycle is
  'Estado atual de cada objeto de imagem do Storage. Escrito só por funções storage_lifecycle_*; linhas nunca são apagadas (objeto removido fica com archive_state = deleted).';
comment on column public.storage_object_lifecycle.state is 'Classificação da última varredura sincronizada (mesmos estados de lib/images/lifecycle/classify.ts). candidate só é aceito se storage_lifecycle_evidence confirmar.';
comment on column public.storage_object_lifecycle.observing_since is 'Informativo: início da observação sem referência. A prova é storage_lifecycle_evidence, calculada de storage_lifecycle_scan_objects.';
comment on column public.storage_object_lifecycle.safety_period_days is 'Intervalo mínimo entre a primeira e a última varredura da sequência sem referência (30 a 365 dias).';
comment on column public.storage_object_lifecycle.safety_deadline is 'Informativo: observing_since + safety_period_days, calculado pelo gatilho.';
comment on column public.storage_object_lifecycle.protected_reason is 'Obrigatório no estado protected. Objeto protegido não perde a proteção por sincronização.';
comment on column public.storage_object_lifecycle.manual_protection is 'Proteção manual (storage_lifecycle_set_manual_protection). Prevalece sobre a classificação da varredura.';
comment on column public.storage_object_lifecycle.archive_state is 'none → archiving → archived → deleting → deleted → restoring → none. Transições validadas pelo gatilho.';
comment on column public.storage_object_lifecycle.restore_metadata is 'Dados para restaurar o original: content_type, cache_control, tamanho e o que mais a operação de arquivamento registrar.';
comment on column public.storage_object_lifecycle.row_version is 'Incrementado a cada alteração (controle de concorrência).';

-- ---------------------------------------------------------------------------------------------
-- 4. Auditoria append-only
-- ---------------------------------------------------------------------------------------------
create table public.storage_operation_log (
  id bigint generated always as identity primary key,
  operation_id uuid not null,
  phase text not null constraint storage_operation_log_phase check (phase in ('intent', 'succeeded', 'failed')),
  operation text not null constraint storage_operation_log_operation check (operation in (
    'scan_register', 'scan_invalidate', 'scan_sync', 'state_change', 'object_missing', 'classification_override',
    'manual_protect', 'manual_unprotect',
    'archive_copy', 'archive_cancel', 'delete_object', 'restore_object',
    'reference_replace', 'json_reference_replace'
  )),
  idempotency_key text constraint storage_operation_log_key_size check (length(idempotency_key) <= 300),
  bucket text,
  object_path text,
  scan_id text references public.storage_lifecycle_scans (scan_id),
  actor text not null constraint storage_operation_log_actor check (btrim(actor) <> '' and length(actor) <= 200),
  reason text constraint storage_operation_log_reason_size check (length(reason) <= 2000),
  occurred_at timestamptz not null default now(),
  state_before text,
  state_after text,
  archive_state_before text,
  archive_state_after text,
  details jsonb not null default '{}'::jsonb constraint storage_operation_log_details check (
    jsonb_typeof(details) = 'object' and pg_column_size(details) <= 65536
  ),
  prev_hash text,
  entry_hash text not null,
  constraint storage_operation_log_intent_fields check (
    (phase = 'intent') = (idempotency_key is not null) and (phase <> 'intent' or coalesce(btrim(reason), '') <> '')
  ),
  constraint storage_operation_log_object_pair check ((bucket is null) = (object_path is null)),
  constraint storage_operation_log_object_ops check (
    operation not in ('state_change', 'object_missing', 'classification_override', 'manual_protect', 'manual_unprotect',
                      'archive_copy', 'archive_cancel', 'delete_object', 'restore_object') or bucket is not null
  ),
  constraint storage_operation_log_scan_ops check (operation not in ('scan_register', 'scan_invalidate', 'scan_sync') or scan_id is not null)
);

-- Idempotência: uma intenção por chave e no máximo um resultado por operação.
create unique index storage_operation_log_intent_key_idx on public.storage_operation_log (idempotency_key) where phase = 'intent';
create unique index storage_operation_log_intent_op_idx on public.storage_operation_log (operation_id) where phase = 'intent';
create unique index storage_operation_log_result_op_idx on public.storage_operation_log (operation_id) where phase <> 'intent';
-- Cadeia sem bifurcação: cada hash tem no máximo um sucessor e só existe um início.
create unique index storage_operation_log_prev_hash_idx on public.storage_operation_log (prev_hash) where prev_hash is not null;
create unique index storage_operation_log_chain_start_idx on public.storage_operation_log ((true)) where prev_hash is null;
create unique index storage_operation_log_entry_hash_idx on public.storage_operation_log (entry_hash);
create index storage_operation_log_object_idx on public.storage_operation_log (bucket, object_path, occurred_at);
create index storage_operation_log_scan_idx on public.storage_operation_log (scan_id) where scan_id is not null;

comment on table public.storage_operation_log is
  'Auditoria do ciclo de vida das imagens. Somente inclusão: UPDATE, DELETE e TRUNCATE são bloqueados por gatilho. Cada operação tem uma linha intent (antes) e no máximo uma linha de resultado.';
comment on column public.storage_operation_log.operation_id is 'Agrupa a intenção e o resultado de uma operação.';
comment on column public.storage_operation_log.phase is 'intent: registrado antes da ação. succeeded/failed: resultado. Intenção sem resultado = operação pendente (retomada).';
comment on column public.storage_operation_log.idempotency_key is 'Só na intenção. Repetir a mesma chave devolve a operação existente em vez de criar outra.';
comment on column public.storage_operation_log.actor is 'Responsável pela operação (ex.: script ou rota administrativa e quem a acionou).';
comment on column public.storage_operation_log.occurred_at is 'Definido pelo banco (now()); o valor enviado é ignorado.';
comment on column public.storage_operation_log.details is 'Metadados técnicos (valor e documento anteriores, hashes, local do arquivo, contagens). Até 64 KB.';
comment on column public.storage_operation_log.entry_hash is 'SHA-256 do registro anterior + este registro. Alteração fora do banco quebra a cadeia (storage_operation_log_verify).';

create table public.storage_operation_log_head (
  singleton boolean primary key default true constraint storage_operation_log_head_singleton check (singleton),
  last_entry_id bigint,
  last_entry_hash text,
  updated_at timestamptz not null default now()
);

comment on table public.storage_operation_log_head is
  'Ponta da cadeia de hash. A linha é travada (FOR UPDATE) a cada registro: a cadeia é serializada sem varrer a tabela. Escrita só pelo gatilho da auditoria.';

-- ---------------------------------------------------------------------------------------------
-- 5. Gatilhos de proteção
-- ---------------------------------------------------------------------------------------------
-- Só o proprietário dedicado escreve. Dentro das funções SECURITY DEFINER o papel corrente é
-- storage_lifecycle_owner; qualquer outro papel (inclusive superusuário que não o assuma) é
-- recusado. Não depende de variável de sessão: o chamador não consegue "ligar" a escrita.
create function public.storage_lifecycle_require_writer()
returns void
language plpgsql
set search_path = ''
as $$
begin
  if current_user::text <> 'storage_lifecycle_owner' then
    raise exception 'Ciclo de vida das imagens: escrita permitida só pelas funções storage_lifecycle_* (papel atual: %).', current_user
      using errcode = '42501';
  end if;
end;
$$;

create function public.storage_lifecycle_block_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%: registros somente inclusão (% bloqueado).', tg_table_name, tg_op using errcode = '42501';
end;
$$;

create function public.storage_lifecycle_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.storage_lifecycle_require_writer();
  if tg_table_name = 'storage_lifecycle_scans' then
    new.registered_at := pg_catalog.now();
  elsif tg_table_name = 'storage_lifecycle_scan_objects' then
    -- Evidência só dentro de uma sincronização auditada desta varredura, ainda em andamento.
    if not exists (
      select 1 from public.storage_operation_log as intent
      where intent.operation_id = new.sync_operation_id and intent.phase = 'intent'
        and intent.operation = 'scan_sync' and intent.scan_id = new.scan_id
        and not exists (select 1 from public.storage_operation_log as done where done.operation_id = intent.operation_id and done.phase <> 'intent')
    ) then
      raise exception 'Evidência sem sincronização auditada em andamento para a varredura %.', new.scan_id using errcode = '23514';
    end if;
    new.recorded_at := pg_catalog.now();
  end if;
  return new;
end;
$$;

create function public.storage_operation_log_head_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.storage_lifecycle_require_writer();
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger storage_lifecycle_scans_insert_guard before insert on public.storage_lifecycle_scans
  for each row execute function public.storage_lifecycle_insert_guard();
create trigger storage_lifecycle_scans_no_change before update or delete on public.storage_lifecycle_scans
  for each row execute function public.storage_lifecycle_block_change();
create trigger storage_lifecycle_scans_no_truncate before truncate on public.storage_lifecycle_scans
  for each statement execute function public.storage_lifecycle_block_change();

create trigger storage_lifecycle_scan_objects_insert_guard before insert on public.storage_lifecycle_scan_objects
  for each row execute function public.storage_lifecycle_insert_guard();
create trigger storage_lifecycle_scan_objects_no_change before update or delete on public.storage_lifecycle_scan_objects
  for each row execute function public.storage_lifecycle_block_change();
create trigger storage_lifecycle_scan_objects_no_truncate before truncate on public.storage_lifecycle_scan_objects
  for each statement execute function public.storage_lifecycle_block_change();

create trigger storage_operation_log_head_write_guard before insert or update on public.storage_operation_log_head
  for each row execute function public.storage_operation_log_head_guard();
create trigger storage_operation_log_head_no_delete before delete on public.storage_operation_log_head
  for each row execute function public.storage_lifecycle_block_change();
create trigger storage_operation_log_head_no_truncate before truncate on public.storage_operation_log_head
  for each statement execute function public.storage_lifecycle_block_change();

-- Conteúdo canônico de uma linha da auditoria (independe do fuso horário da sessão).
create function public.storage_operation_log_canonical(entry public.storage_operation_log)
returns text
language sql
immutable
set search_path = ''
as $$
  select (
    (pg_catalog.to_jsonb(entry) - 'entry_hash' - 'prev_hash' - 'occurred_at')
    || pg_catalog.jsonb_build_object('occurred_at_utc', pg_catalog.to_char(entry.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
  )::text;
$$;

create function public.storage_operation_log_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  intent public.storage_operation_log%rowtype;
  previous text;
begin
  perform public.storage_lifecycle_require_writer();
  new.occurred_at := pg_catalog.now();

  if new.phase <> 'intent' then
    select * into intent from public.storage_operation_log as log where log.operation_id = new.operation_id and log.phase = 'intent';
    if not found then
      raise exception 'Resultado sem intenção registrada (operação %).', new.operation_id using errcode = '23514';
    end if;
    if (intent.operation, intent.bucket, intent.object_path, intent.scan_id)
       is distinct from (new.operation, new.bucket, new.object_path, new.scan_id) then
      raise exception 'O resultado não corresponde à intenção da operação %.', new.operation_id using errcode = '23514';
    end if;
  end if;

  -- Trava a ponta da cadeia: o próximo registro só calcula o hash depois que este terminar.
  -- Em READ COMMITTED a leitura depois da trava vê a ponta mais nova; em REPEATABLE READ ou
  -- SERIALIZABLE o FOR UPDATE de uma linha alterada por outra transação falha (sem bifurcar).
  select head.last_entry_hash into previous from public.storage_operation_log_head as head where head.singleton for update;
  if not found then
    raise exception 'Ponta da cadeia de auditoria ausente.' using errcode = '55000';
  end if;
  new.prev_hash := previous;
  new.entry_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    coalesce(previous, '') || '|' || public.storage_operation_log_canonical(new), 'UTF8')), 'hex');
  update public.storage_operation_log_head set last_entry_id = new.id, last_entry_hash = new.entry_hash where singleton;
  return new;
end;
$$;

create trigger storage_operation_log_insert_guard before insert on public.storage_operation_log
  for each row execute function public.storage_operation_log_before_insert();
create trigger storage_operation_log_no_change before update or delete on public.storage_operation_log
  for each row execute function public.storage_lifecycle_block_change();
create trigger storage_operation_log_no_truncate before truncate on public.storage_operation_log
  for each statement execute function public.storage_lifecycle_block_change();

create function public.storage_lifecycle_archive_transition_ok(from_state text, to_state text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select from_state = to_state or (from_state, to_state) in (
    ('none', 'archiving'), ('archiving', 'archived'), ('archiving', 'none'),
    ('archived', 'deleting'), ('archived', 'none'),
    ('deleting', 'deleted'), ('deleting', 'archived'),
    ('deleted', 'restoring'), ('restoring', 'none'), ('restoring', 'deleted')
  );
$$;

-- ---------------------------------------------------------------------------------------------
-- 6. Normalização (mesma regra de objectKeyFromReference em lib/images/lifecycle/references.ts;
--    casos compartilhados em tests/fixtures/storage-object-keys.json)
-- ---------------------------------------------------------------------------------------------
-- Decodifica %xx como bytes UTF-8. % malformado ou UTF-8 inválido → null (como decodeURIComponent).
create function public.storage_lifecycle_url_decode(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  bytes bytea := ''::bytea;
  position_now integer := 1;
  total integer := pg_catalog.length(p_value);
  piece text;
begin
  if p_value is null then
    return null;
  end if;
  while position_now <= total loop
    piece := pg_catalog.substr(p_value, position_now, 1);
    if piece = '%' then
      if pg_catalog.substr(p_value, position_now + 1, 2) !~ '^[0-9A-Fa-f]{2}$' then
        return null;
      end if;
      bytes := bytes || pg_catalog.decode(pg_catalog.substr(p_value, position_now + 1, 2), 'hex');
      position_now := position_now + 3;
    else
      bytes := bytes || pg_catalog.convert_to(piece, 'UTF8');
      position_now := position_now + 1;
    end if;
  end loop;
  begin
    return pg_catalog.convert_from(bytes, 'UTF8');
  exception when others then
    return null;
  end;
end;
$$;

-- Buckets aceitos como chave direta ("<bucket>/<caminho>"): os mesmos de IMAGE_BUCKETS.
create function public.storage_lifecycle_known_buckets()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['achievement-art', 'site-banners', 'site-profile', 'game-images']::text[];
$$;

-- URL pública/assinada/autenticada/de transformação (com ou sem ?v=, #, %xx) ou chave direta de
-- bucket conhecido → "bucket/caminho". Caminho local, outro domínio, texto depois do caminho,
-- espaço cru, segmento vazio/./.., caractere de controle ou codificação inválida → null.
create function public.storage_lifecycle_object_key(p_reference text, p_known_buckets text[] default null)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  -- Mesmo conjunto de espaços do \s e do trim() do JavaScript.
  spaces text := pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(11) || pg_catalog.chr(12) || pg_catalog.chr(13)
    || pg_catalog.chr(32) || pg_catalog.chr(160) || pg_catalog.chr(5760) || pg_catalog.chr(8192) || '-' || pg_catalog.chr(8202)
    || pg_catalog.chr(8232) || pg_catalog.chr(8233) || pg_catalog.chr(8239) || pg_catalog.chr(8287) || pg_catalog.chr(12288)
    || pg_catalog.chr(65279);
  controls text := '[' || pg_catalog.chr(1) || '-' || pg_catalog.chr(31) || pg_catalog.chr(127) || ']';
  value text;
  candidate text;
  decoded text;
  segments text[];
  segment text;
begin
  if p_reference is null then
    return null;
  end if;
  value := pg_catalog.regexp_replace(p_reference, '^[' || spaces || ']+|[' || spaces || ']+$', '', 'g');
  if value = '' then
    return null;
  end if;

  candidate := pg_catalog.substring(value,
    '/storage/v1/(?:object|render/image)/(?:public|sign|authenticated)/([^?#"''' || spaces || ']+)(?:[?#].*)?$');

  if candidate is null and p_known_buckets is not null and value !~* '^[a-z]+://' and pg_catalog.left(value, 1) <> '/' then
    if pg_catalog.split_part(value, '/', 1) = any (p_known_buckets) then
      candidate := pg_catalog.substring(value, '^[^?#]*');
    end if;
  end if;
  if candidate is null then
    return null;
  end if;

  decoded := public.storage_lifecycle_url_decode(candidate);
  if decoded is null or decoded ~ controls then
    return null;
  end if;
  segments := pg_catalog.string_to_array(decoded, '/');
  if coalesce(pg_catalog.array_length(segments, 1), 0) < 2 then
    return null;
  end if;
  foreach segment in array segments loop
    if segment in ('', '.', '..') then
      return null;
    end if;
  end loop;
  return decoded;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 7. Funções internas
-- ---------------------------------------------------------------------------------------------
create function public.storage_lifecycle_append_log(
  p_operation_id uuid, p_phase text, p_operation text, p_idempotency_key text,
  p_bucket text, p_object_path text, p_scan_id text, p_actor text, p_reason text,
  p_state_before text, p_state_after text, p_archive_before text, p_archive_after text, p_details jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id bigint;
begin
  insert into public.storage_operation_log (
    operation_id, phase, operation, idempotency_key, bucket, object_path, scan_id, actor, reason,
    state_before, state_after, archive_state_before, archive_state_after, details
  ) values (
    p_operation_id, p_phase, p_operation, p_idempotency_key, p_bucket, p_object_path, p_scan_id, p_actor, p_reason,
    p_state_before, p_state_after, p_archive_before, p_archive_after, coalesce(p_details, '{}'::jsonb)
  ) returning id into new_id;
  return new_id;
end;
$$;

-- Ordem única de travas, chamada no início de toda função de escrita, antes de qualquer trava de
-- linha: 1) trava global de escrita do ciclo de vida; 2) trava da chave (idempotência).
-- Sem a trava global, a sincronização (ponta da cadeia → objetos) e a conclusão de arquivamento
-- (objeto → ponta da cadeia) travavam em ordens opostas e entravam em deadlock (teste 3.2).
-- O volume é administrativo e pequeno: serializar todas as escritas custa pouco.
create function public.storage_lifecycle_lock_key(p_namespace text, p_key text)
returns void
language sql
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('storage_lifecycle:writer', 0));
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_namespace || ':' || coalesce(p_key, ''), 0));
$$;

-- Varredura vale como evidência: completa e sem invalidação registrada. Basta a INTENÇÃO de
-- invalidar (falha fechada): dentro da própria invalidação a varredura já deixa de valer.
create function public.storage_lifecycle_scan_is_valid(p_scan_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.storage_lifecycle_scans as scan
    where scan.scan_id = p_scan_id and scan.complete
      and not exists (
        select 1 from public.storage_operation_log as log
        where log.operation = 'scan_invalidate' and log.scan_id = scan.scan_id
      )
  );
$$;

-- Prova, para um objeto, que ele ficou sem referência em pelo menos duas varreduras completas e
-- válidas consecutivas, separadas por safety_period_days (mínimo 30), terminando na varredura mais
-- recente registrada. Varredura incompleta ou invalidada não conta como evidência; se a mais
-- recente for uma delas, nada é elegível. Referência que reaparece, ausência numa varredura,
-- proteção (da lista ou manual) e remoção de proteção manual dentro da janela interrompem.
create function public.storage_lifecycle_evidence(p_bucket text, p_object_path text)
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

  for scan in select * from public.storage_lifecycle_scans as s order by s.completed_at desc, s.scan_id desc loop
    if not public.storage_lifecycle_scan_is_valid(scan.scan_id) then
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
    'required_days', target.safety_period_days, 'stopped_at', stop_reason);

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

-- Nova referência: texto que menciona o Storage precisa ser interpretável e não pode apontar
-- para objeto em arquivamento, arquivado ou removido. Devolve a chave normalizada (ou null).
create function public.storage_lifecycle_validate_new_reference(p_value text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  object_key text := public.storage_lifecycle_object_key(p_value, public.storage_lifecycle_known_buckets());
  target_bucket text;
  target_state text;
begin
  if object_key is null then
    if p_value ~* '/storage/v1/' then
      raise exception 'Referência ao Storage inválida ou ininterpretável: %', pg_catalog.left(p_value, 200) using errcode = '22023';
    end if;
    return null;
  end if;
  target_bucket := pg_catalog.split_part(object_key, '/', 1);
  select obj.archive_state into target_state from public.storage_object_lifecycle as obj
  where obj.bucket = target_bucket and obj.object_path = pg_catalog.substr(object_key, pg_catalog.length(target_bucket) + 2);
  if found and target_state <> 'none' then
    raise exception 'A nova referência aponta para objeto em % (%).', target_state, object_key using errcode = '23514';
  end if;
  return object_key;
end;
$$;

create function public.storage_object_lifecycle_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  evidence jsonb;
begin
  perform public.storage_lifecycle_require_writer();

  if tg_op = 'INSERT' then
    if new.archive_state <> 'none' then
      raise exception 'Objeto novo começa sem arquivamento.' using errcode = '23514';
    end if;
    new.created_at := pg_catalog.now();
    new.row_version := 1;
  else
    if (new.bucket, new.object_path, new.first_seen_at, new.first_seen_scan_id, new.created_at)
       is distinct from (old.bucket, old.object_path, old.first_seen_at, old.first_seen_scan_id, old.created_at) then
      raise exception 'Identidade e primeira identificação do objeto não mudam.' using errcode = '23514';
    end if;
    if not public.storage_lifecycle_archive_transition_ok(old.archive_state, new.archive_state) then
      raise exception 'Transição de arquivamento inválida: % → %.', old.archive_state, new.archive_state using errcode = '23514';
    end if;
    -- Proteção só sai por storage_lifecycle_set_manual_protection: a alteração precisa apontar
    -- (last_operation_id) para uma intenção manual_unprotect deste objeto na auditoria.
    if old.state = 'protected' and new.state <> 'protected' and not exists (
      select 1 from public.storage_operation_log as log
      where log.operation_id = new.last_operation_id and log.phase = 'intent' and log.operation = 'manual_unprotect'
        and log.bucket = new.bucket and log.object_path = new.object_path
    ) then
      raise exception 'Objeto protegido não perde a proteção por esta via (%/%).', new.bucket, new.object_path using errcode = '23514';
    end if;
    new.row_version := old.row_version + 1;
  end if;

  new.safety_deadline := case
    when new.observing_since is null then null
    else new.observing_since + pg_catalog.make_interval(days => new.safety_period_days)
  end;

  -- candidate só com prova (calculada quando o estado muda ou chega varredura nova).
  if new.state = 'candidate' and (tg_op = 'INSERT' or old.state <> 'candidate' or new.last_seen_scan_id <> old.last_seen_scan_id) then
    evidence := public.storage_lifecycle_evidence(new.bucket, new.object_path);
    if tg_op = 'INSERT' or not coalesce((evidence ->> 'eligible')::boolean, false) then
      raise exception 'Candidato sem prova de duas varreduras válidas sem referência (%/%): %.', new.bucket, new.object_path,
        coalesce(evidence ->> 'reason', 'objeto novo') using errcode = '23514';
    end if;
  end if;

  -- Arquivar e remover o original: só sem referência, sem proteção e com a prova vigente.
  if tg_op = 'UPDATE' and (
       (old.archive_state = 'none' and new.archive_state = 'archiving')
    or (old.archive_state = 'archived' and new.archive_state = 'deleting')
  ) then
    evidence := public.storage_lifecycle_evidence(new.bucket, new.object_path);
    if new.state not in ('candidate', 'superseded') or new.reference_count > 0 or new.manual_protection
       or not coalesce((evidence ->> 'eligible')::boolean, false) then
      raise exception 'Objeto não elegível para % (estado %, referências %): %.',
        new.archive_state, new.state, new.reference_count, coalesce(evidence ->> 'reason', 'sem prova') using errcode = '23514';
    end if;
  end if;

  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger storage_object_lifecycle_write_guard before insert or update on public.storage_object_lifecycle
  for each row execute function public.storage_object_lifecycle_guard();
create trigger storage_object_lifecycle_no_delete before delete on public.storage_object_lifecycle
  for each row execute function public.storage_lifecycle_block_change();
create trigger storage_object_lifecycle_no_truncate before truncate on public.storage_object_lifecycle
  for each statement execute function public.storage_lifecycle_block_change();

-- ---------------------------------------------------------------------------------------------
-- 8. Funções do backend (service_role)
-- ---------------------------------------------------------------------------------------------

-- Registra o resumo de uma varredura. Repetir com os mesmos dados não cria nada novo.
create function public.storage_lifecycle_register_scan(p_scan jsonb, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.storage_lifecycle_scans%rowtype;
  scan_key text := p_scan ->> 'scan_id';
  op uuid := pg_catalog.gen_random_uuid();
begin
  if scan_key is null then
    raise exception 'scan_id é obrigatório.' using errcode = '22023';
  end if;
  perform public.storage_lifecycle_lock_key('scan', scan_key);
  -- A prova de 30 dias usa a data das varreduras: data futura fabricaria o prazo.
  if (p_scan ->> 'completed_at')::timestamptz > pg_catalog.now() + interval '5 minutes' then
    raise exception 'Varredura % com data no futuro (%).', scan_key, p_scan ->> 'completed_at' using errcode = '22023';
  end if;
  select * into existing from public.storage_lifecycle_scans as s where s.scan_id = scan_key;
  if found then
    if (existing.completed_at, existing.complete, existing.inventory_status, existing.image_objects, existing.image_bytes, existing.report_sha256)
       is distinct from ((p_scan ->> 'completed_at')::timestamptz, (p_scan ->> 'complete')::boolean, p_scan ->> 'inventory_status',
                         (p_scan ->> 'image_objects')::integer, (p_scan ->> 'image_bytes')::bigint, p_scan ->> 'report_sha256') then
      raise exception 'A varredura % já foi registrada com outros dados.', scan_key using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object('status', 'already_registered', 'scan_id', scan_key);
  end if;

  insert into public.storage_lifecycle_scans (scan_id, completed_at, complete, inventory_status, image_objects, image_bytes, report_sha256, registered_by)
  values (scan_key, (p_scan ->> 'completed_at')::timestamptz, (p_scan ->> 'complete')::boolean, p_scan ->> 'inventory_status',
          (p_scan ->> 'image_objects')::integer, (p_scan ->> 'image_bytes')::bigint, p_scan ->> 'report_sha256', p_actor);

  perform public.storage_lifecycle_append_log(op, 'intent', 'scan_register', 'scan_register:' || scan_key, null, null, scan_key, p_actor,
    'registrar resumo da varredura', null, null, null, null, p_scan);
  perform public.storage_lifecycle_append_log(op, 'succeeded', 'scan_register', null, null, null, scan_key, p_actor,
    null, null, null, null, null, '{}'::jsonb);
  return pg_catalog.jsonb_build_object('status', 'registered', 'scan_id', scan_key, 'operation_id', op);
end;
$$;

-- Invalida uma varredura como evidência (append-only). Objetos cuja observação começou nela
-- voltam a "unverified"; candidatos que perderem a prova voltam a "observing".
create function public.storage_lifecycle_invalidate_scan(p_scan_id text, p_reason text, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  op uuid := pg_catalog.gen_random_uuid();
  reset_count integer;
  downgraded integer := 0;
  item public.storage_object_lifecycle%rowtype;
begin
  perform public.storage_lifecycle_lock_key('sync', 'global');
  if not exists (select 1 from public.storage_lifecycle_scans as s where s.scan_id = p_scan_id) then
    raise exception 'Varredura % não registrada.', p_scan_id using errcode = '22023';
  end if;
  if exists (select 1 from public.storage_operation_log as log where log.operation = 'scan_invalidate' and log.scan_id = p_scan_id and log.phase = 'succeeded') then
    return pg_catalog.jsonb_build_object('status', 'already_invalidated', 'scan_id', p_scan_id);
  end if;
  if exists (select 1 from public.storage_object_lifecycle as obj where obj.observing_since_scan_id = p_scan_id and obj.archive_state <> 'none') then
    raise exception 'Há arquivamento em andamento baseado na varredura %; resolva antes de invalidar.', p_scan_id using errcode = '55000';
  end if;

  perform public.storage_lifecycle_append_log(op, 'intent', 'scan_invalidate', 'scan_invalidate:' || p_scan_id, null, null, p_scan_id, p_actor,
    p_reason, null, null, null, null, '{}'::jsonb);

  update public.storage_object_lifecycle as obj
  set state = 'unverified', observing_since = null, observing_since_scan_id = null, last_operation_id = op
  where obj.observing_since_scan_id = p_scan_id and obj.state <> 'protected';
  get diagnostics reset_count = row_count;

  -- A invalidação já está registrada (intenção acima): a prova agora ignora esta varredura.
  for item in select * from public.storage_object_lifecycle as obj where obj.state = 'candidate' and obj.archive_state = 'none' for update loop
    if not coalesce((public.storage_lifecycle_evidence(item.bucket, item.object_path) ->> 'eligible')::boolean, false) then
      update public.storage_object_lifecycle as obj set state = 'observing', last_operation_id = op
      where obj.bucket = item.bucket and obj.object_path = item.object_path;
      downgraded := downgraded + 1;
    end if;
  end loop;

  perform public.storage_lifecycle_append_log(op, 'succeeded', 'scan_invalidate', null, null, null, p_scan_id, p_actor,
    null, null, null, null, null, pg_catalog.jsonb_build_object('objects_reset', reset_count, 'candidates_downgraded', downgraded));
  return pg_catalog.jsonb_build_object('status', 'invalidated', 'scan_id', p_scan_id, 'objects_reset', reset_count,
    'candidates_downgraded', downgraded, 'operation_id', op);
end;
$$;

-- Aplica uma varredura completa e válida: grava a evidência por objeto e atualiza o estado atual.
-- p_objects: [{bucket, path, state, size, mimetype, sha256, reference_count, protected_reason, duplicate_of}]
--
-- O estado enviado é PRELIMINAR (classificador local). O banco é a autoridade:
--   * lote malformado (objeto sem bucket/caminho, estado desconhecido, contagem errada, objeto
--     repetido) → recusa inteira, nada é gravado;
--   * classificação inválida de UM objeto → corrigida só para ele, com diagnóstico
--     (classification_override), sem bloquear o resto do inventário:
--       proteção (manual ou da lista) prevalece; candidato sem prova vira observing; estado sem
--       referência com referências > 0 vira referenced; objeto em remoção/removido/restaurando
--       que reaparece fica unverified na evidência e seu estado atual não é tocado.
-- Na evidência, "candidate" é registrado como "observing" (candidato é decisão, não observação);
-- o pedido original fica em requested_state. O SHA-256 de todas as linhas de evidência da
-- varredura entra no resultado auditado (cadeia de hash).
create function public.storage_lifecycle_sync_scan(p_scan_id text, p_objects jsonb, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  scan public.storage_lifecycle_scans%rowtype;
  item jsonb;
  item_index integer := 0;
  current_row public.storage_object_lifecycle%rowtype;
  row_exists boolean;
  op uuid := pg_catalog.gen_random_uuid();
  item_bucket text;
  item_path text;
  requested text;
  applied text;
  override_reason text;
  evidence jsonb;
  item_refs integer;
  is_manual boolean;
  is_conflict boolean;
  is_unreferenced boolean;
  start_at timestamptz;
  start_scan text;
  inserted integer := 0;
  updated integer := 0;
  changed integer := 0;
  missing integer := 0;
  override_count integer := 0;
  overrides jsonb := '[]'::jsonb;
  evidence_rows integer;
  evidence_sha text;
  valid_states constant text[] := array['protected', 'active', 'referenced', 'unverified', 'duplicate', 'observing', 'candidate', 'superseded'];
begin
  perform public.storage_lifecycle_lock_key('sync', 'global');
  select * into scan from public.storage_lifecycle_scans as s where s.scan_id = p_scan_id;
  if not found then
    raise exception 'Varredura % não registrada.', p_scan_id using errcode = '22023';
  end if;
  if not public.storage_lifecycle_scan_is_valid(p_scan_id) then
    raise exception 'Varredura % incompleta ou invalidada: não vale como evidência.', p_scan_id using errcode = '22023';
  end if;
  if exists (select 1 from public.storage_operation_log as log where log.operation = 'scan_sync' and log.scan_id = p_scan_id and log.phase = 'succeeded') then
    return pg_catalog.jsonb_build_object('status', 'already_synced', 'scan_id', p_scan_id);
  end if;
  if exists (
    select 1 from public.storage_operation_log as log
    join public.storage_lifecycle_scans as other on other.scan_id = log.scan_id
    where log.operation = 'scan_sync' and log.phase = 'succeeded' and other.completed_at >= scan.completed_at
  ) then
    raise exception 'Já existe varredura igual ou mais recente sincronizada; % não pode ser aplicada fora de ordem.', p_scan_id using errcode = '55000';
  end if;
  if pg_catalog.jsonb_typeof(p_objects) is distinct from 'array' or pg_catalog.jsonb_array_length(p_objects) <> scan.image_objects then
    raise exception 'A lista de objetos não confere com a varredura % (esperado %).', p_scan_id, scan.image_objects using errcode = '22023';
  end if;

  -- Lote malformado: recusa inteira antes de gravar qualquer coisa.
  for item in select value from pg_catalog.jsonb_array_elements(p_objects) loop
    item_index := item_index + 1;
    if pg_catalog.jsonb_typeof(item) is distinct from 'object'
       or pg_catalog.jsonb_typeof(item -> 'bucket') is distinct from 'string'
       or pg_catalog.jsonb_typeof(item -> 'path') is distinct from 'string'
       or (item ->> 'bucket') !~ '^[a-z0-9][a-z0-9._-]{1,62}$'
       or (item ->> 'path') = '' or (item ->> 'path') ~ '^/' or (item ->> 'path') ~ '(^|/)\.{1,2}(/|$)' or (item ->> 'path') ~ '//'
       or pg_catalog.length(item ->> 'path') > 1024
       or not ((item ->> 'state') = any (valid_states))
       or (item ? 'reference_count' and (pg_catalog.jsonb_typeof(item -> 'reference_count') is distinct from 'number' or (item ->> 'reference_count')::numeric < 0
            or (item ->> 'reference_count')::numeric <> pg_catalog.trunc((item ->> 'reference_count')::numeric))) then
      raise exception 'Objeto % do lote malformado (bucket, path, state ou reference_count): %', item_index, pg_catalog.left(item::text, 300)
        using errcode = '22023';
    end if;
  end loop;

  perform public.storage_lifecycle_append_log(op, 'intent', 'scan_sync', 'scan_sync:' || p_scan_id, null, null, p_scan_id, p_actor,
    'sincronizar estado a partir da varredura', null, null, null, null, pg_catalog.jsonb_build_object('objects', scan.image_objects));

  for item in select value from pg_catalog.jsonb_array_elements(p_objects) loop
    item_bucket := item ->> 'bucket';
    item_path := item ->> 'path';
    requested := item ->> 'state';
    item_refs := coalesce((item ->> 'reference_count')::integer, 0);
    applied := requested;
    override_reason := null;
    evidence := null;

    select * into current_row from public.storage_object_lifecycle as obj
    where obj.bucket = item_bucket and obj.object_path = item_path for update;
    row_exists := found;
    is_manual := row_exists and current_row.manual_protection;
    is_conflict := row_exists and current_row.archive_state in ('deleting', 'deleted', 'restoring');

    if is_conflict then
      applied := 'unverified';
      override_reason := 'objeto aparece na varredura, mas está em ' || current_row.archive_state || '; estado atual preservado';
    elsif is_manual and requested <> 'protected' then
      applied := 'protected';
      override_reason := 'proteção manual prevalece sobre a classificação';
    elsif row_exists and current_row.state = 'protected' and requested <> 'protected' then
      applied := 'protected';
      override_reason := 'objeto protegido só deixa a proteção por storage_lifecycle_set_manual_protection';
    elsif item_refs > 0 and requested in ('observing', 'candidate', 'superseded', 'duplicate') then
      applied := 'referenced';
      override_reason := pg_catalog.format('estado %s com %s referência(s)', requested, item_refs);
    end if;

    insert into public.storage_lifecycle_scan_objects (
      scan_id, bucket, object_path, state, requested_state, reference_count, manual_protection, size_bytes, sha256, sync_operation_id
    ) values (
      p_scan_id, item_bucket, item_path, case when applied = 'candidate' then 'observing' else applied end, requested,
      item_refs, is_manual, (item ->> 'size')::bigint, item ->> 'sha256', op
    );

    -- Candidato só com prova; a prova já inclui a linha de evidência desta varredura.
    if applied = 'candidate' then
      evidence := public.storage_lifecycle_evidence(item_bucket, item_path);
      if not coalesce((evidence ->> 'eligible')::boolean, false) then
        applied := 'observing';
        override_reason := 'candidato sem prova: ' || coalesce(evidence ->> 'reason', 'objeto visto pela primeira vez');
      end if;
    end if;

    if override_reason is not null then
      override_count := override_count + 1;
      if pg_catalog.jsonb_array_length(overrides) < 50 then
        overrides := overrides || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'object', item_bucket || '/' || item_path, 'requested', requested, 'applied', applied, 'reason', override_reason));
      end if;
      declare
        override_op uuid := pg_catalog.gen_random_uuid();
      begin
        perform public.storage_lifecycle_append_log(override_op, 'intent', 'classification_override',
          'classification_override:' || p_scan_id || ':' || item_bucket || '/' || item_path,
          item_bucket, item_path, p_scan_id, p_actor, override_reason, requested, applied, null, null,
          pg_catalog.jsonb_build_object('sync_operation_id', op, 'reference_count', item_refs, 'evidence', evidence));
        perform public.storage_lifecycle_append_log(override_op, 'succeeded', 'classification_override', null,
          item_bucket, item_path, p_scan_id, p_actor, null, requested, applied, null, null, '{}'::jsonb);
      end;
    end if;

    if is_conflict then
      continue;
    end if;

    is_unreferenced := item_refs = 0 and applied in ('observing', 'candidate', 'superseded', 'duplicate', 'unverified');

    if not row_exists then
      insert into public.storage_object_lifecycle (
        bucket, object_path, state, size_bytes, mimetype, sha256, first_seen_at, first_seen_scan_id, last_seen_at, last_seen_scan_id,
        reference_count, last_referenced_at, last_referenced_scan_id, observing_since, observing_since_scan_id,
        protected_reason, duplicate_of, last_operation_id
      ) values (
        item_bucket, item_path, applied, (item ->> 'size')::bigint, item ->> 'mimetype', item ->> 'sha256',
        scan.completed_at, p_scan_id, scan.completed_at, p_scan_id,
        item_refs,
        case when item_refs > 0 or applied in ('active', 'referenced') then scan.completed_at end,
        case when item_refs > 0 or applied in ('active', 'referenced') then p_scan_id end,
        case when is_unreferenced then scan.completed_at end,
        case when is_unreferenced then p_scan_id end,
        case when applied = 'protected' then coalesce(nullif(pg_catalog.btrim(item ->> 'protected_reason'), ''), 'lista de proteção') end,
        item ->> 'duplicate_of', op
      );
      inserted := inserted + 1;
      continue;
    end if;

    if is_unreferenced and current_row.observing_since is not null and public.storage_lifecycle_scan_is_valid(current_row.observing_since_scan_id) then
      start_at := current_row.observing_since;
      start_scan := current_row.observing_since_scan_id;
    elsif is_unreferenced then
      start_at := scan.completed_at;
      start_scan := p_scan_id;
    else
      start_at := null;
      start_scan := null;
    end if;

    update public.storage_object_lifecycle as obj set
      state = applied,
      size_bytes = (item ->> 'size')::bigint,
      mimetype = item ->> 'mimetype',
      sha256 = coalesce(item ->> 'sha256', current_row.sha256),
      last_seen_at = scan.completed_at,
      last_seen_scan_id = p_scan_id,
      reference_count = item_refs,
      last_referenced_at = case when item_refs > 0 or applied in ('active', 'referenced') then scan.completed_at else current_row.last_referenced_at end,
      last_referenced_scan_id = case when item_refs > 0 or applied in ('active', 'referenced') then p_scan_id else current_row.last_referenced_scan_id end,
      observing_since = start_at,
      observing_since_scan_id = start_scan,
      protected_reason = case
        when applied <> 'protected' then null
        when current_row.state = 'protected' then current_row.protected_reason
        else coalesce(nullif(pg_catalog.btrim(item ->> 'protected_reason'), ''), 'lista de proteção')
      end,
      duplicate_of = item ->> 'duplicate_of',
      last_operation_id = op
    where obj.bucket = item_bucket and obj.object_path = item_path;
    updated := updated + 1;

    if current_row.state <> applied then
      changed := changed + 1;
      declare
        change_op uuid := pg_catalog.gen_random_uuid();
      begin
        perform public.storage_lifecycle_append_log(change_op, 'intent', 'state_change', 'state_change:' || p_scan_id || ':' || item_bucket || '/' || item_path,
          item_bucket, item_path, p_scan_id, p_actor, 'classificação da varredura', current_row.state, applied, null, null,
          pg_catalog.jsonb_build_object('sync_operation_id', op, 'reference_count', item_refs, 'requested_state', requested));
        perform public.storage_lifecycle_append_log(change_op, 'succeeded', 'state_change', null,
          item_bucket, item_path, p_scan_id, p_actor, null, current_row.state, applied, null, null, '{}'::jsonb);
      end;
    end if;
  end loop;

  -- Objetos conhecidos que não apareceram: só registro (nada é apagado nem reclassificado).
  for current_row in
    select * from public.storage_object_lifecycle as obj
    where obj.archive_state in ('none', 'archiving', 'archived') and obj.last_seen_scan_id <> p_scan_id
  loop
    missing := missing + 1;
    declare
      missing_op uuid := pg_catalog.gen_random_uuid();
    begin
      perform public.storage_lifecycle_append_log(missing_op, 'intent', 'object_missing', 'object_missing:' || p_scan_id || ':' || current_row.bucket || '/' || current_row.object_path,
        current_row.bucket, current_row.object_path, p_scan_id, p_actor, 'objeto conhecido ausente da varredura', current_row.state, current_row.state,
        current_row.archive_state, current_row.archive_state, pg_catalog.jsonb_build_object('last_seen_scan_id', current_row.last_seen_scan_id));
      perform public.storage_lifecycle_append_log(missing_op, 'succeeded', 'object_missing', null,
        current_row.bucket, current_row.object_path, p_scan_id, p_actor, null, current_row.state, current_row.state,
        current_row.archive_state, current_row.archive_state, '{}'::jsonb);
    end;
  end loop;

  select digest.rows_count, digest.sha into evidence_rows, evidence_sha from public.storage_lifecycle_evidence_digest(p_scan_id) as digest;

  perform public.storage_lifecycle_append_log(op, 'succeeded', 'scan_sync', null, null, null, p_scan_id, p_actor, null, null, null, null, null,
    pg_catalog.jsonb_build_object('inserted', inserted, 'updated', updated, 'state_changes', changed, 'missing', missing,
      'overrides', override_count, 'evidence_rows', evidence_rows, 'evidence_sha256', evidence_sha));
  return pg_catalog.jsonb_build_object('status', 'synced', 'scan_id', p_scan_id, 'operation_id', op,
    'inserted', inserted, 'updated', updated, 'state_changes', changed, 'missing', missing,
    'overrides', override_count, 'override_details', overrides, 'evidence_rows', evidence_rows, 'evidence_sha256', evidence_sha);
end;
$$;

-- Resumo canônico (SHA-256) das linhas de evidência de uma varredura. Gravado no resultado da
-- sincronização; storage_operation_log_verify recalcula e compara.
create function public.storage_lifecycle_evidence_digest(p_scan_id text)
returns table (rows_count integer, sha text)
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.count(*)::integer,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(pg_catalog.string_agg(
           so.bucket || '/' || so.object_path || '|' || so.state || '|' || so.requested_state || '|' || so.reference_count::text
             || '|' || so.manual_protection::text || '|' || coalesce(so.sha256, '') || '|' || so.sync_operation_id::text,
           pg_catalog.chr(10) order by so.bucket, so.object_path), ''), 'UTF8')), 'hex')
  from public.storage_lifecycle_scan_objects as so
  where so.scan_id = p_scan_id;
$$;

-- Liga ou desliga a proteção manual de um objeto, com auditoria. Ligada, prevalece sobre a
-- varredura; desligada, o objeto volta a "unverified" e a janela de evidência recomeça (a prova
-- exige que a remoção seja anterior à primeira varredura da sequência).
create function public.storage_lifecycle_set_manual_protection(
  p_idempotency_key text, p_bucket text, p_object_path text, p_protect boolean, p_actor text, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.storage_operation_log%rowtype;
  target public.storage_object_lifecycle%rowtype;
  operation_name text := case when p_protect then 'manual_protect' else 'manual_unprotect' end;
  op uuid := pg_catalog.gen_random_uuid();
begin
  if p_protect is null or coalesce(pg_catalog.btrim(p_idempotency_key), '') = '' then
    raise exception 'Chave de idempotência e p_protect são obrigatórios.' using errcode = '22023';
  end if;
  perform public.storage_lifecycle_lock_key('key', p_idempotency_key);
  select * into existing from public.storage_operation_log as log where log.idempotency_key = p_idempotency_key and log.phase = 'intent';
  if found then
    if (existing.operation, existing.bucket, existing.object_path) is distinct from (operation_name, p_bucket, p_object_path) then
      raise exception 'A chave % já pertence a outra operação.', p_idempotency_key using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object('status', 'already_applied', 'operation_id', existing.operation_id);
  end if;

  select * into target from public.storage_object_lifecycle as obj where obj.bucket = p_bucket and obj.object_path = p_object_path for update;
  if not found then
    raise exception 'Objeto %/% não está no ciclo de vida.', p_bucket, p_object_path using errcode = '22023';
  end if;
  -- Proteger: só se ainda não houver proteção manual. Desproteger: libera a proteção manual e
  -- também a da lista (que volta na próxima varredura se o objeto continuar na lista).
  if (p_protect and target.manual_protection) or (not p_protect and target.state <> 'protected') then
    return pg_catalog.jsonb_build_object('status', case when p_protect then 'already_protected' else 'not_protected' end);
  end if;

  perform public.storage_lifecycle_append_log(op, 'intent', operation_name, p_idempotency_key, p_bucket, p_object_path, null, p_actor, p_reason,
    target.state, case when p_protect then 'protected' else 'unverified' end, target.archive_state, target.archive_state,
    pg_catalog.jsonb_build_object('previous_protected_reason', target.protected_reason));

  update public.storage_object_lifecycle as obj set
    manual_protection = p_protect,
    manual_protection_reason = case when p_protect then p_reason end,
    state = case when p_protect then 'protected' else 'unverified' end,
    protected_reason = case when p_protect then 'proteção manual: ' || p_reason end,
    observing_since = null,
    observing_since_scan_id = null,
    last_operation_id = op
  where obj.bucket = p_bucket and obj.object_path = p_object_path;

  perform public.storage_lifecycle_append_log(op, 'succeeded', operation_name, null, p_bucket, p_object_path, null, p_actor, null,
    target.state, case when p_protect then 'protected' else 'unverified' end, target.archive_state, target.archive_state, '{}'::jsonb);
  return pg_catalog.jsonb_build_object('status', 'applied', 'operation_id', op, 'manual_protection', p_protect);
end;
$$;

-- Inicia uma operação de Storage (arquivar, cancelar arquivamento, remover original, restaurar).
-- Registra a intenção ANTES da ação e muda archive_state na mesma transação. A ação no Storage
-- acontece fora do banco; o resultado é gravado por storage_lifecycle_finish_operation.
create function public.storage_lifecycle_begin_operation(
  p_idempotency_key text, p_operation text, p_bucket text, p_object_path text, p_actor text, p_reason text, p_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.storage_operation_log%rowtype;
  result_phase text;
  target public.storage_object_lifecycle%rowtype;
  next_archive text;
  op uuid := pg_catalog.gen_random_uuid();
begin
  if p_operation not in ('archive_copy', 'archive_cancel', 'delete_object', 'restore_object') then
    raise exception 'Operação % não é de Storage.', p_operation using errcode = '22023';
  end if;
  if coalesce(pg_catalog.btrim(p_idempotency_key), '') = '' then
    raise exception 'Chave de idempotência obrigatória.' using errcode = '22023';
  end if;
  -- Mesma chave chamada ao mesmo tempo: a segunda espera e devolve a operação da primeira.
  perform public.storage_lifecycle_lock_key('key', p_idempotency_key);

  select * into existing from public.storage_operation_log as log where log.idempotency_key = p_idempotency_key and log.phase = 'intent';
  if found then
    if (existing.operation, existing.bucket, existing.object_path) is distinct from (p_operation, p_bucket, p_object_path) then
      raise exception 'A chave % já pertence a outra operação.', p_idempotency_key using errcode = '23505';
    end if;
    select log.phase into result_phase from public.storage_operation_log as log where log.operation_id = existing.operation_id and log.phase <> 'intent';
    return pg_catalog.jsonb_build_object('status', case when result_phase is null then 'pending' else 'finished' end,
      'operation_id', existing.operation_id, 'result', result_phase);
  end if;

  select * into target from public.storage_object_lifecycle as obj where obj.bucket = p_bucket and obj.object_path = p_object_path for update;
  if not found then
    raise exception 'Objeto %/% não está no ciclo de vida.', p_bucket, p_object_path using errcode = '22023';
  end if;
  if exists (
    select 1 from public.storage_operation_log as intent
    where intent.bucket = p_bucket and intent.object_path = p_object_path and intent.phase = 'intent'
      and intent.operation in ('archive_copy', 'archive_cancel', 'delete_object', 'restore_object')
      and not exists (select 1 from public.storage_operation_log as done where done.operation_id = intent.operation_id and done.phase <> 'intent')
  ) then
    raise exception 'Já existe operação pendente para %/%.', p_bucket, p_object_path using errcode = '55000';
  end if;

  next_archive := case p_operation
    when 'archive_copy' then case when target.archive_state = 'none' then 'archiving' end
    when 'archive_cancel' then case when target.archive_state = 'archived' then 'archived' end
    when 'delete_object' then case when target.archive_state = 'archived' then 'deleting' end
    when 'restore_object' then case when target.archive_state = 'deleted' then 'restoring' end
  end;
  if next_archive is null then
    raise exception 'Operação % não permitida com archive_state = %.', p_operation, target.archive_state using errcode = '23514';
  end if;

  perform public.storage_lifecycle_append_log(op, 'intent', p_operation, p_idempotency_key, p_bucket, p_object_path, null, p_actor, p_reason,
    target.state, target.state, target.archive_state, next_archive,
    coalesce(p_details, '{}'::jsonb) || pg_catalog.jsonb_build_object('row_version', target.row_version, 'sha256', target.sha256, 'size_bytes', target.size_bytes,
      'evidence', public.storage_lifecycle_evidence(p_bucket, p_object_path)));

  update public.storage_object_lifecycle as obj set archive_state = next_archive, last_operation_id = op
  where obj.bucket = p_bucket and obj.object_path = p_object_path;

  return pg_catalog.jsonb_build_object('status', 'started', 'operation_id', op, 'archive_state', next_archive);
end;
$$;

-- Grava o resultado de uma operação iniciada. Repetir com o mesmo resultado não muda nada.
create function public.storage_lifecycle_finish_operation(p_operation_id uuid, p_result text, p_actor text, p_details jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent public.storage_operation_log%rowtype;
  previous_result text;
  target public.storage_object_lifecycle%rowtype;
  details jsonb := coalesce(p_details, '{}'::jsonb);
  next_archive text;
begin
  if p_result not in ('succeeded', 'failed') then
    raise exception 'Resultado deve ser succeeded ou failed.' using errcode = '22023';
  end if;
  perform public.storage_lifecycle_lock_key('operation', p_operation_id::text);
  select * into intent from public.storage_operation_log as log where log.operation_id = p_operation_id and log.phase = 'intent';
  if not found or intent.operation not in ('archive_copy', 'archive_cancel', 'delete_object', 'restore_object') then
    raise exception 'Operação de Storage % não encontrada.', p_operation_id using errcode = '22023';
  end if;
  select log.phase into previous_result from public.storage_operation_log as log where log.operation_id = p_operation_id and log.phase <> 'intent';
  if previous_result is not null then
    if previous_result <> p_result then
      raise exception 'A operação % já terminou como %.', p_operation_id, previous_result using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object('status', 'already_finished', 'operation_id', p_operation_id, 'result', previous_result);
  end if;

  select * into target from public.storage_object_lifecycle as obj where obj.bucket = intent.bucket and obj.object_path = intent.object_path for update;

  if p_result = 'succeeded' and intent.operation = 'archive_copy' then
    if details ->> 'archive_bucket' is null or details ->> 'archive_path' is null or details ->> 'archive_sha256' is null
       or pg_catalog.jsonb_typeof(details -> 'restore') is distinct from 'object' or details -> 'restore' ->> 'content_type' is null then
      raise exception 'Arquivamento exige archive_bucket, archive_path, archive_sha256 e restore.content_type.' using errcode = '22023';
    end if;
    if target.sha256 is not null and target.sha256 <> details ->> 'archive_sha256' then
      raise exception 'A cópia arquivada não confere com o SHA-256 do original.' using errcode = '23514';
    end if;
  end if;
  if p_result = 'succeeded' and intent.operation = 'restore_object' and details ->> 'restored_sha256' is distinct from target.archive_sha256 then
    raise exception 'O arquivo restaurado não confere com o SHA-256 arquivado.' using errcode = '23514';
  end if;

  next_archive := case
    when intent.operation = 'archive_copy' then case p_result when 'succeeded' then 'archived' else 'none' end
    when intent.operation = 'archive_cancel' then case p_result when 'succeeded' then 'none' else 'archived' end
    when intent.operation = 'delete_object' then case p_result when 'succeeded' then 'deleted' else 'archived' end
    when intent.operation = 'restore_object' then case p_result when 'succeeded' then 'none' else 'deleted' end
  end;

  -- Resultado primeiro: se a auditoria falhar, o estado do objeto não muda.
  perform public.storage_lifecycle_append_log(p_operation_id, p_result, intent.operation, null, intent.bucket, intent.object_path, null, p_actor, null,
    target.state, case when intent.operation = 'restore_object' and p_result = 'succeeded' then 'unverified' else target.state end,
    target.archive_state, next_archive, details);

  update public.storage_object_lifecycle as obj set
    archive_state = next_archive,
    archive_bucket = case when intent.operation = 'archive_copy' and p_result = 'succeeded' then details ->> 'archive_bucket' else obj.archive_bucket end,
    archive_path = case when intent.operation = 'archive_copy' and p_result = 'succeeded' then details ->> 'archive_path' else obj.archive_path end,
    archive_sha256 = case when intent.operation = 'archive_copy' and p_result = 'succeeded' then details ->> 'archive_sha256' else obj.archive_sha256 end,
    archived_at = case when intent.operation = 'archive_copy' and p_result = 'succeeded' then pg_catalog.now() else obj.archived_at end,
    restore_metadata = case when intent.operation = 'archive_copy' and p_result = 'succeeded' then details -> 'restore' else obj.restore_metadata end,
    state = case when intent.operation = 'restore_object' and p_result = 'succeeded' then 'unverified' else obj.state end,
    observing_since = case when intent.operation = 'restore_object' and p_result = 'succeeded' then null else obj.observing_since end,
    observing_since_scan_id = case when intent.operation = 'restore_object' and p_result = 'succeeded' then null else obj.observing_since_scan_id end,
    last_operation_id = p_operation_id
  where obj.bucket = intent.bucket and obj.object_path = intent.object_path;

  return pg_catalog.jsonb_build_object('status', 'finished', 'operation_id', p_operation_id, 'result', p_result, 'archive_state', next_archive);
end;
$$;

-- Troca ou remove uma referência de imagem numa coluna de TEXTO permitida, registrando o valor
-- anterior ANTES da alteração e na mesma transação: se a auditoria falhar, a referência não muda.
-- p_expected_value precisa ser o valor atual (evita sobrescrever alteração concorrente).
create function public.storage_lifecycle_replace_reference(
  p_idempotency_key text, p_table text, p_row_key text, p_column text,
  p_expected_value text, p_new_value text, p_actor text, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  key_column text;
  existing public.storage_operation_log%rowtype;
  result_phase text;
  current_value text;
  row_count_seen integer;
  old_object text;
  new_object text;
  op uuid := pg_catalog.gen_random_uuid();
begin
  key_column := case
    when p_table = 'achievements' and p_column in ('image', 'official_image') then 'id'
    when p_table = 'achievement_progress' and p_column = 'image_override' then 'id'
    when p_table = 'games' and p_column in ('image', 'card_image') then 'slug'
  end;
  if key_column is null then
    raise exception 'Coluna %.% não está na lista permitida.', p_table, p_column using errcode = '22023';
  end if;
  if coalesce(pg_catalog.btrim(p_idempotency_key), '') = '' then
    raise exception 'Chave de idempotência obrigatória.' using errcode = '22023';
  end if;
  perform public.storage_lifecycle_lock_key('key', p_idempotency_key);

  select * into existing from public.storage_operation_log as log where log.idempotency_key = p_idempotency_key and log.phase = 'intent';
  if found then
    if (existing.operation, existing.details ->> 'table', existing.details ->> 'row_key', existing.details ->> 'column', existing.details ->> 'new_value')
       is distinct from ('reference_replace'::text, p_table, p_row_key, p_column, p_new_value) then
      raise exception 'A chave % já pertence a outra operação.', p_idempotency_key using errcode = '23505';
    end if;
    select log.phase into result_phase from public.storage_operation_log as log where log.operation_id = existing.operation_id and log.phase <> 'intent';
    return pg_catalog.jsonb_build_object('status', 'already_applied', 'operation_id', existing.operation_id, 'result', result_phase);
  end if;

  execute pg_catalog.format('select %I::text from public.%I where %I::text = $1 for update', p_column, p_table, key_column)
    into current_value using p_row_key;
  -- EXECUTE não atualiza FOUND; a contagem vem de GET DIAGNOSTICS.
  get diagnostics row_count_seen = row_count;
  if row_count_seen = 0 then
    raise exception 'Linha %.% = % não encontrada.', p_table, key_column, p_row_key using errcode = '22023';
  end if;
  if current_value is distinct from p_expected_value then
    raise exception 'O valor atual de %.% mudou; nada foi alterado.', p_table, p_column using errcode = '40001';
  end if;

  -- Gatilho real achievement_progress_prepare_trigger: num progresso concluído sem earned_at,
  -- QUALQUER alteração da linha grava earned_at = hoje e o histórico regrava o desbloqueio com essa
  -- data falsa. A troca de imagem é recusada, sem tocar na linha (a linha já está travada acima).
  if p_table = 'achievement_progress' and exists (
    select 1 from public.achievement_progress as progress
    where progress.id::text = p_row_key and progress.status = 'completed' and progress.earned_at is null
  ) then
    raise exception 'Progresso % está concluído sem earned_at: a troca de imagem acionaria o gatilho que grava a data de hoje como desbloqueio. Corrija earned_at antes; nada foi alterado.', p_row_key
      using errcode = '55000', hint = 'storage_lifecycle: progress_completed_without_earned_at';
  end if;

  old_object := public.storage_lifecycle_object_key(current_value, public.storage_lifecycle_known_buckets());
  new_object := public.storage_lifecycle_validate_new_reference(p_new_value);

  perform public.storage_lifecycle_append_log(op, 'intent', 'reference_replace', p_idempotency_key, null, null, null, p_actor, p_reason,
    null, null, null, null,
    pg_catalog.jsonb_build_object('table', p_table, 'row_key', p_row_key, 'column', p_column,
      'old_value', current_value, 'new_value', p_new_value, 'old_object', old_object, 'new_object', new_object));

  execute pg_catalog.format('update public.%I set %I = $1 where %I::text = $2', p_table, p_column, key_column) using p_new_value, p_row_key;

  perform public.storage_lifecycle_append_log(op, 'succeeded', 'reference_replace', null, null, null, null, p_actor, null,
    null, null, null, null, '{}'::jsonb);
  return pg_catalog.jsonb_build_object('status', 'applied', 'operation_id', op, 'old_value', current_value, 'new_value', p_new_value);
end;
$$;

-- Troca ou remove uma referência de imagem DENTRO de uma coluna JSON permitida (games.final_badge,
-- emblem, trophies), num caminho exato (ex.: '{image}', '{items,2,icon}'). Registra o valor
-- anterior e o documento inteiro anterior antes de alterar, na mesma transação.
-- O caminho precisa existir e apontar para um texto. p_new_value null grava JSON null.
--
-- games.review fica BLOQUEADO: os gatilhos reais games_history_prepare_trigger e games_history_trigger
-- tratam qualquer mudança no JSON como edição de conteúdo (review_updated_at = agora e evento
-- review_updated). Uma troca só visual não pode passar por eles sem alterar esses gatilhos globais.
create function public.storage_lifecycle_replace_json_reference(
  p_idempotency_key text, p_table text, p_row_key text, p_column text, p_json_path text[],
  p_expected_value text, p_new_value text, p_actor text, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  key_column text;
  column_type text;
  existing public.storage_operation_log%rowtype;
  result_phase text;
  document jsonb;
  document_text text;
  row_count_seen integer;
  target jsonb;
  current_value text;
  updated_document jsonb;
  old_object text;
  new_object text;
  path_item text;
  op uuid := pg_catalog.gen_random_uuid();
begin
  if p_table = 'games' and p_column = 'review' then
    raise exception 'Imagens dentro de games.review não podem ser trocadas por esta função: a alteração seria registrada como edição da review (review_updated_at e evento review_updated). Nada foi alterado.'
      using errcode = '0A000', hint = 'storage_lifecycle: review_image_change_blocked';
  end if;
  key_column := case
    when p_table = 'games' and p_column in ('final_badge', 'emblem', 'trophies') then 'slug'
  end;
  if key_column is null then
    raise exception 'Coluna JSON %.% não está na lista permitida.', p_table, p_column using errcode = '22023';
  end if;
  if coalesce(pg_catalog.btrim(p_idempotency_key), '') = '' then
    raise exception 'Chave de idempotência obrigatória.' using errcode = '22023';
  end if;
  if p_json_path is null or coalesce(pg_catalog.array_length(p_json_path, 1), 0) not between 1 and 20 then
    raise exception 'Caminho JSON obrigatório (1 a 20 níveis).' using errcode = '22023';
  end if;
  foreach path_item in array p_json_path loop
    if path_item is null or path_item = '' or pg_catalog.length(path_item) > 200 then
      raise exception 'Caminho JSON com nível vazio ou inválido.' using errcode = '22023';
    end if;
  end loop;

  select pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) into column_type
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = pg_catalog.to_regclass('public.' || pg_catalog.quote_ident(p_table))
    and attribute.attname = p_column and not attribute.attisdropped and attribute.attnum > 0;
  if column_type is null or column_type not in ('jsonb', 'json') then
    raise exception 'Coluna %.% tem tipo % (só json/jsonb são aceitos).', p_table, p_column, coalesce(column_type, 'inexistente') using errcode = '22023';
  end if;

  perform public.storage_lifecycle_lock_key('key', p_idempotency_key);
  select * into existing from public.storage_operation_log as log where log.idempotency_key = p_idempotency_key and log.phase = 'intent';
  if found then
    if (existing.operation, existing.details ->> 'table', existing.details ->> 'row_key', existing.details ->> 'column',
        existing.details -> 'json_path', existing.details ->> 'new_value')
       is distinct from ('json_reference_replace'::text, p_table, p_row_key, p_column, pg_catalog.to_jsonb(p_json_path), p_new_value) then
      raise exception 'A chave % já pertence a outra operação.', p_idempotency_key using errcode = '23505';
    end if;
    select log.phase into result_phase from public.storage_operation_log as log where log.operation_id = existing.operation_id and log.phase <> 'intent';
    return pg_catalog.jsonb_build_object('status', 'already_applied', 'operation_id', existing.operation_id, 'result', result_phase);
  end if;

  execute pg_catalog.format('select %I::text from public.%I where %I::text = $1 for update', p_column, p_table, key_column)
    into document_text using p_row_key;
  get diagnostics row_count_seen = row_count;
  if row_count_seen = 0 then
    raise exception 'Linha %.% = % não encontrada.', p_table, key_column, p_row_key using errcode = '22023';
  end if;
  if document_text is null then
    raise exception 'A coluna %.% está vazia nesta linha.', p_table, p_column using errcode = '22023';
  end if;
  if pg_catalog.octet_length(document_text) > 49152 then
    raise exception 'Documento grande demais para auditar com segurança (% bytes).', pg_catalog.octet_length(document_text) using errcode = '54000';
  end if;
  document := document_text::jsonb;

  target := document #> p_json_path;
  if target is null then
    raise exception 'O caminho % não existe em %.%.', p_json_path, p_table, p_column using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(target) <> 'string' then
    raise exception 'O caminho % não aponta para um texto (é %).', p_json_path, pg_catalog.jsonb_typeof(target) using errcode = '22023';
  end if;
  current_value := target #>> '{}';
  if current_value is distinct from p_expected_value then
    raise exception 'O valor atual em % mudou; nada foi alterado.', p_json_path using errcode = '40001';
  end if;

  old_object := public.storage_lifecycle_object_key(current_value, public.storage_lifecycle_known_buckets());
  new_object := public.storage_lifecycle_validate_new_reference(p_new_value);
  updated_document := pg_catalog.jsonb_set(document, p_json_path, coalesce(pg_catalog.to_jsonb(p_new_value), 'null'::jsonb), false);

  perform public.storage_lifecycle_append_log(op, 'intent', 'json_reference_replace', p_idempotency_key, null, null, null, p_actor, p_reason,
    null, null, null, null,
    pg_catalog.jsonb_build_object('table', p_table, 'row_key', p_row_key, 'column', p_column, 'column_type', column_type,
      'json_path', pg_catalog.to_jsonb(p_json_path), 'old_value', current_value, 'new_value', p_new_value,
      'old_object', old_object, 'new_object', new_object, 'old_document', document_text,
      'old_document_sha256', pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(document_text, 'UTF8')), 'hex')));

  -- column_type vem da lista fechada acima (json ou jsonb).
  execute pg_catalog.format('update public.%I set %I = $1::%s where %I::text = $2', p_table, p_column, column_type, key_column)
    using updated_document::text, p_row_key;

  perform public.storage_lifecycle_append_log(op, 'succeeded', 'json_reference_replace', null, null, null, null, p_actor, null,
    null, null, null, null, pg_catalog.jsonb_build_object('new_document_sha256',
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(updated_document::text, 'UTF8')), 'hex')));
  return pg_catalog.jsonb_build_object('status', 'applied', 'operation_id', op, 'old_value', current_value, 'new_value', p_new_value);
end;
$$;

-- Confere a cadeia inteira (hash de cada linha, percurso do início ao fim, ponta registrada), as
-- varreduras contra os registros auditados e a evidência contra o resumo de cada sincronização.
-- Devolve as linhas com problema (vazio = íntegra).
create function public.storage_operation_log_verify()
returns table (id bigint, problem text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  entry public.storage_operation_log%rowtype;
  expected text;
  total bigint;
  visited bigint := 0;
  tail text;
  head_hash text;
  scan_row public.storage_lifecycle_scans%rowtype;
  evidence_rows integer;
  evidence_sha text;
begin
  for entry in select * from public.storage_operation_log as log order by log.id loop
    expected := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      coalesce(entry.prev_hash, '') || '|' || public.storage_operation_log_canonical(entry), 'UTF8')), 'hex');
    if expected <> entry.entry_hash then
      id := entry.id; problem := 'hash não confere'; return next;
    end if;
  end loop;

  select pg_catalog.count(*) into total from public.storage_operation_log;
  select * into entry from public.storage_operation_log as log where log.prev_hash is null;
  while found loop
    visited := visited + 1;
    tail := entry.entry_hash;
    select * into entry from public.storage_operation_log as log where log.prev_hash = tail;
  end loop;
  if visited <> total then
    id := null; problem := pg_catalog.format('a cadeia percorre %s de %s registros', visited, total); return next;
  end if;
  select head.last_entry_hash into head_hash from public.storage_operation_log_head as head where head.singleton;
  if head_hash is distinct from tail then
    id := null; problem := 'a ponta registrada não é o fim da cadeia'; return next;
  end if;

  -- Varreduras: cada uma precisa da intenção de registro auditada, com os mesmos dados.
  for scan_row in select * from public.storage_lifecycle_scans as s order by s.scan_id loop
    select * into entry from public.storage_operation_log as log
    where log.operation = 'scan_register' and log.phase = 'intent' and log.scan_id = scan_row.scan_id;
    if not found or ((entry.details ->> 'completed_at')::timestamptz, (entry.details ->> 'complete')::boolean,
                     (entry.details ->> 'image_objects')::integer, entry.details ->> 'inventory_status')
                    is distinct from (scan_row.completed_at, scan_row.complete, scan_row.image_objects, scan_row.inventory_status) then
      id := entry.id; problem := 'varredura ' || scan_row.scan_id || ' sem registro auditado correspondente'; return next;
    end if;
  end loop;

  -- Evidência: o resumo de cada varredura sincronizada precisa bater com o resultado auditado, e
  -- toda linha de evidência precisa pertencer a uma sincronização concluída.
  for entry in select * from public.storage_operation_log as log where log.operation = 'scan_sync' and log.phase = 'succeeded' order by log.id loop
    select digest.rows_count, digest.sha into evidence_rows, evidence_sha from public.storage_lifecycle_evidence_digest(entry.scan_id) as digest;
    if (evidence_rows, evidence_sha) is distinct from ((entry.details ->> 'evidence_rows')::integer, entry.details ->> 'evidence_sha256') then
      id := entry.id; problem := 'evidência da varredura ' || entry.scan_id || ' não confere com a sincronização auditada'; return next;
    end if;
  end loop;
  for scan_row in
    select distinct s.* from public.storage_lifecycle_scans as s
    join public.storage_lifecycle_scan_objects as so on so.scan_id = s.scan_id
    where not exists (
      select 1 from public.storage_operation_log as done
      where done.operation = 'scan_sync' and done.phase = 'succeeded' and done.scan_id = so.scan_id and done.operation_id = so.sync_operation_id
    )
  loop
    id := null; problem := 'evidência da varredura ' || scan_row.scan_id || ' sem sincronização concluída'; return next;
  end loop;
end;
$$;

-- Operações iniciadas e sem resultado: ponto de retomada depois de uma falha.
create view public.storage_lifecycle_pending_operations
with (security_invoker = true) as
select intent.operation_id, intent.operation, intent.bucket, intent.object_path, intent.actor, intent.reason,
       intent.occurred_at as started_at, intent.archive_state_before, intent.archive_state_after, intent.details
from public.storage_operation_log as intent
where intent.phase = 'intent'
  and not exists (select 1 from public.storage_operation_log as done where done.operation_id = intent.operation_id and done.phase <> 'intent');

comment on view public.storage_lifecycle_pending_operations is
  'Intenções sem resultado. Antes de repetir, confira no Storage o que já aconteceu e feche com storage_lifecycle_finish_operation.';

-- Ponta inicial da cadeia (vazia).
insert into public.storage_operation_log_head (singleton) values (true);

-- ---------------------------------------------------------------------------------------------
-- 9. RLS e permissões
-- ---------------------------------------------------------------------------------------------
-- RLS ligado e nenhuma política: anon e authenticated não leem nem escrevem nada. O service_role
-- (backend) ignora RLS, mas só recebe SELECT; toda escrita passa pelas funções acima.
alter table public.storage_lifecycle_scans enable row level security;
alter table public.storage_lifecycle_scan_objects enable row level security;
alter table public.storage_object_lifecycle enable row level security;
alter table public.storage_operation_log enable row level security;
alter table public.storage_operation_log_head enable row level security;

revoke all on table public.storage_lifecycle_scans from public, anon, authenticated, service_role;
revoke all on table public.storage_lifecycle_scan_objects from public, anon, authenticated, service_role;
revoke all on table public.storage_object_lifecycle from public, anon, authenticated, service_role;
revoke all on table public.storage_operation_log from public, anon, authenticated, service_role;
revoke all on table public.storage_operation_log_head from public, anon, authenticated, service_role;
revoke all on table public.storage_lifecycle_pending_operations from public, anon, authenticated, service_role;
grant select on table public.storage_lifecycle_scans to service_role;
grant select on table public.storage_lifecycle_scan_objects to service_role;
grant select on table public.storage_object_lifecycle to service_role;
grant select on table public.storage_operation_log to service_role;
grant select on table public.storage_lifecycle_pending_operations to service_role;

-- Internas: ninguém além do dono executa.
revoke all on function public.storage_lifecycle_require_writer() from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_block_change() from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_insert_guard() from public, anon, authenticated, service_role;
revoke all on function public.storage_operation_log_head_guard() from public, anon, authenticated, service_role;
revoke all on function public.storage_operation_log_canonical(public.storage_operation_log) from public, anon, authenticated, service_role;
revoke all on function public.storage_operation_log_before_insert() from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_archive_transition_ok(text, text) from public, anon, authenticated, service_role;
revoke all on function public.storage_object_lifecycle_guard() from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_append_log(uuid, text, text, text, text, text, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_lock_key(text, text) from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_evidence_digest(text) from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_validate_new_reference(text) from public, anon, authenticated, service_role;

-- Backend: só service_role.
revoke all on function public.storage_lifecycle_url_decode(text) from public, anon, authenticated;
revoke all on function public.storage_lifecycle_known_buckets() from public, anon, authenticated;
revoke all on function public.storage_lifecycle_object_key(text, text[]) from public, anon, authenticated;
revoke all on function public.storage_lifecycle_scan_is_valid(text) from public, anon, authenticated;
revoke all on function public.storage_lifecycle_evidence(text, text) from public, anon, authenticated;
revoke all on function public.storage_lifecycle_register_scan(jsonb, text) from public, anon, authenticated;
revoke all on function public.storage_lifecycle_invalidate_scan(text, text, text) from public, anon, authenticated;
revoke all on function public.storage_lifecycle_sync_scan(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.storage_lifecycle_set_manual_protection(text, text, text, boolean, text, text) from public, anon, authenticated;
revoke all on function public.storage_lifecycle_begin_operation(text, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.storage_lifecycle_finish_operation(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.storage_lifecycle_replace_reference(text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.storage_lifecycle_replace_json_reference(text, text, text, text, text[], text, text, text, text) from public, anon, authenticated;
revoke all on function public.storage_operation_log_verify() from public, anon, authenticated;

grant execute on function public.storage_lifecycle_url_decode(text) to service_role;
grant execute on function public.storage_lifecycle_known_buckets() to service_role;
grant execute on function public.storage_lifecycle_object_key(text, text[]) to service_role;
grant execute on function public.storage_lifecycle_scan_is_valid(text) to service_role;
grant execute on function public.storage_lifecycle_evidence(text, text) to service_role;
grant execute on function public.storage_lifecycle_register_scan(jsonb, text) to service_role;
grant execute on function public.storage_lifecycle_invalidate_scan(text, text, text) to service_role;
grant execute on function public.storage_lifecycle_sync_scan(text, jsonb, text) to service_role;
grant execute on function public.storage_lifecycle_set_manual_protection(text, text, text, boolean, text, text) to service_role;
grant execute on function public.storage_lifecycle_begin_operation(text, text, text, text, text, text, jsonb) to service_role;
grant execute on function public.storage_lifecycle_finish_operation(uuid, text, text, jsonb) to service_role;
grant execute on function public.storage_lifecycle_replace_reference(text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.storage_lifecycle_replace_json_reference(text, text, text, text, text[], text, text, text, text) to service_role;
grant execute on function public.storage_operation_log_verify() to service_role;

-- Volta ao papel de quem roda a migração e encerra a participação temporária no proprietário.
reset role;
revoke storage_lifecycle_owner from current_user;

-- ---------------------------------------------------------------------------------------------
-- 10. Autoverificação (falha desfaz a migração inteira)
-- ---------------------------------------------------------------------------------------------
do $$
declare
  problem text;
begin
  select pg_catalog.string_agg(c.relname, ', ') into problem
  from pg_catalog.pg_class as c join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname ~ '^storage_(lifecycle|operation_log|object_lifecycle)' and c.relkind in ('r', 'v')
    and c.relowner <> 'storage_lifecycle_owner'::regrole;
  if problem is not null then
    raise exception 'Objetos sem o proprietário dedicado: %', problem;
  end if;
  select pg_catalog.string_agg(p.oid::regprocedure::text, ', ') into problem
  from pg_catalog.pg_proc as p join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname ~ '^storage_(lifecycle|operation_log|object_lifecycle)'
    and p.proowner <> 'storage_lifecycle_owner'::regrole;
  if problem is not null then
    raise exception 'Funções sem o proprietário dedicado: %', problem;
  end if;
  if pg_catalog.pg_has_role('anon', 'storage_lifecycle_owner', 'MEMBER')
     or pg_catalog.pg_has_role('authenticated', 'storage_lifecycle_owner', 'MEMBER')
     or pg_catalog.pg_has_role('service_role', 'storage_lifecycle_owner', 'MEMBER') then
    raise exception 'Papéis da aplicação não podem ser membros de storage_lifecycle_owner.';
  end if;

  select pg_catalog.string_agg(p.oid::regprocedure::text, ', ') into problem
  from pg_catalog.pg_proc as p join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname ~ '^storage_(lifecycle|operation_log|object_lifecycle)'
    and (pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if problem is not null then
    raise exception 'Funções executáveis pelo navegador: %', problem;
  end if;

  select pg_catalog.string_agg(p.oid::regprocedure::text, ', ') into problem
  from pg_catalog.pg_proc as p join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname ~ '^storage_(lifecycle|operation_log|object_lifecycle)'
    and not coalesce(p.proconfig @> array['search_path=""'], false);
  if problem is not null then
    raise exception 'Funções sem search_path vazio: %', problem;
  end if;

  select pg_catalog.string_agg(c.relname, ', ') into problem
  from pg_catalog.pg_class as c join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname ~ '^storage_(lifecycle|operation_log|object_lifecycle)'
    and (not c.relrowsecurity
      or pg_catalog.has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or pg_catalog.has_table_privilege('service_role', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'));
  if problem is not null then
    raise exception 'Tabelas sem RLS ou com privilégio indevido: %', problem;
  end if;
end;
$$;

commit;

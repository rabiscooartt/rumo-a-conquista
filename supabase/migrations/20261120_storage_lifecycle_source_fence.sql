-- Ciclo de vida das imagens — diário das fontes, cerca transacional e estado durável na remoção.
-- Complementa 20261114 a 20261119 (precisa de todas). Rollback:
-- supabase/rollbacks/20261120_storage_lifecycle_source_fence_rollback.sql
-- Pré-verificação (somente leitura): supabase/tests/storage_lifecycle_source_fence_precheck.sql
--
-- Problema corrigido: a prova de elegibilidade vinha só das varreduras. Um salvamento confirmado (ou
-- ainda em andamento) depois da coleta não era visto, e uma imagem voltando a ser usada podia ser
-- arquivada e removida. Três camadas, todas no banco:
--
--   1. DIÁRIO (storage_lifecycle_source_changes): gatilhos em games, achievements,
--      achievement_progress, journey_entries e journey_history_events gravam as chaves do Storage que
--      entram e saem de cada linha (e o prefixo da convenção de nomes das conquistas). Pegam todos os
--      gravadores: rotas, painel do Supabase, scripts. No Storage, gatilho em storage.objects só nos
--      caminhos-fonte (ponteiros site-profile/active/* e os 2 buckets de rascunho): o conteúdo não é
--      visível ali, então a alteração vale para todos os objetos (escopo "*").
--   2. CERCA: todo gravador de fonte segura a trava COMPARTILHADA da cerca até o COMMIT. Abertura,
--      sincronização e conclusão da varredura oficial, e a autorização de arquivar/remover, pegam a
--      trava EXCLUSIVA por tentativas curtas (20 ms, até 3 s, sem entrar na fila; esgotado → 55P03,
--      retomável). Com a exclusiva, nenhuma gravação está em andamento: o marcador do diário registrado
--      na abertura (storage_lifecycle_scan_fences) é exato. Sincronização e conclusão recusam com
--      scan_sources_changed (23514) se houver evento depois do marcador; a execução vira "failed".
--   3. ESTADO DURÁVEL: a prova (storage_lifecycle_evidence) recusa objeto tocado depois do marcador
--      da última varredura; o gatilho das fontes recusa referência NOVA a objeto fora de "none"; a
--      autorização confere o uso real no banco sob a trava exclusiva; remover o original exige uma
--      varredura oficial aberta DEPOIS do arquivamento; gravação de ponteiro/rascunho é recusada
--      enquanto houver remoção em andamento.
--
-- As funções públicas mantêm nome e assinatura: as versões anteriores viram *_base (sem acesso do
-- service_role) e as novas as envolvem. Nenhuma linha de dados existente é alterada.
begin;

do $$
begin
  if pg_catalog.to_regprocedure('public.storage_lifecycle_finish_scan_run(text, text, text, jsonb)') is null then
    raise exception 'A migração 20261119_storage_lifecycle_scan_policy não está aplicada.';
  end if;
  if pg_catalog.to_regclass('public.storage_lifecycle_source_changes') is not null
     or pg_catalog.to_regclass('public.storage_lifecycle_scan_fences') is not null
     or exists (select 1 from pg_catalog.pg_proc as p where p.pronamespace = 'public'::regnamespace
                and (p.proname like 'storage_lifecycle\_%\_base' or p.proname in ('storage_lifecycle_fence_exclusive', 'storage_lifecycle_extract_keys'))) then
    raise exception 'Objetos da cerca de fontes já existem: migração aplicada antes ou nomes ocupados.';
  end if;
end;
$$;

-- A conferência viva do uso (autorização de arquivar/remover) lê as linhas inteiras das fontes.
grant select on public.games, public.achievements, public.achievement_progress, public.journey_entries, public.journey_history_events
  to storage_lifecycle_owner;

grant storage_lifecycle_owner to current_user;
set local role storage_lifecycle_owner;

-- 1. Diário das fontes e marcadores das execuções --------------------------------------------------
create table public.storage_lifecycle_source_changes (
  seq bigint generated always as identity primary key,
  occurred_at timestamptz not null default pg_catalog.clock_timestamp(),
  transaction_id xid8 not null default pg_catalog.pg_current_xact_id(),
  source text not null constraint storage_lifecycle_source_changes_source check (source in (
    'games', 'achievements', 'achievement_progress', 'journey_entries', 'journey_history_events', 'pointers', 'drafts')),
  operation text not null constraint storage_lifecycle_source_changes_op check (operation in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  row_key text,
  object_keys text[] not null default '{}',
  prefixes text[] not null default '{}',
  scopes text[] not null default '{}',
  constraint storage_lifecycle_source_changes_effect check (
    pg_catalog.cardinality(object_keys) + pg_catalog.cardinality(prefixes) + pg_catalog.cardinality(scopes) > 0)
);
create index storage_lifecycle_source_changes_keys_idx on public.storage_lifecycle_source_changes using gin (object_keys);
comment on table public.storage_lifecycle_source_changes is
  'Diário das fontes de referência de imagens (somente inclusão, preenchido só por gatilhos). object_keys: chaves que entraram ou saíram; prefixes: convenção de nomes; scopes: "*" = conteúdo opaco (ponteiro, rascunho, TRUNCATE).';

create table public.storage_lifecycle_scan_fences (
  scan_id text primary key constraint storage_lifecycle_scan_fences_id check (scan_id ~ '^scan-[0-9]{8}T[0-9]{6}Z$'),
  run_operation_id uuid not null unique,
  source_change_seq bigint not null constraint storage_lifecycle_scan_fences_seq check (source_change_seq >= 0),
  recorded_at timestamptz not null default pg_catalog.now()
);
comment on table public.storage_lifecycle_scan_fences is
  'Marcador do diário na abertura de cada execução oficial (com a trava exclusiva da cerca). Somente inclusão.';

create trigger storage_lifecycle_source_changes_insert_guard before insert on public.storage_lifecycle_source_changes
  for each row execute function public.storage_lifecycle_insert_guard();
create trigger storage_lifecycle_source_changes_no_change before update or delete on public.storage_lifecycle_source_changes
  for each row execute function public.storage_lifecycle_block_change();
create trigger storage_lifecycle_source_changes_no_truncate before truncate on public.storage_lifecycle_source_changes
  for each statement execute function public.storage_lifecycle_block_change();
create trigger storage_lifecycle_scan_fences_insert_guard before insert on public.storage_lifecycle_scan_fences
  for each row execute function public.storage_lifecycle_insert_guard();
create trigger storage_lifecycle_scan_fences_no_change before update or delete on public.storage_lifecycle_scan_fences
  for each row execute function public.storage_lifecycle_block_change();
create trigger storage_lifecycle_scan_fences_no_truncate before truncate on public.storage_lifecycle_scan_fences
  for each statement execute function public.storage_lifecycle_block_change();

alter table public.storage_lifecycle_source_changes enable row level security;
alter table public.storage_lifecycle_scan_fences enable row level security;
revoke all on table public.storage_lifecycle_source_changes from public, anon, authenticated, service_role;
revoke all on table public.storage_lifecycle_scan_fences from public, anon, authenticated, service_role;
grant select on table public.storage_lifecycle_source_changes to service_role;
grant select on table public.storage_lifecycle_scan_fences to service_role;

-- 2. Cerca -----------------------------------------------------------------------------------------
create function public.storage_lifecycle_fence_key()
returns bigint
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.hashtextextended('storage_lifecycle:source_fence', 0);
$$;

-- Gravadores: trava compartilhada até o COMMIT (não bloqueia outros gravadores).
create function public.storage_lifecycle_fence_shared()
returns void
language sql
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock_shared(public.storage_lifecycle_fence_key());
$$;

-- Verificações: trava exclusiva por tentativas curtas. Nunca entra na fila, então nunca segura um
-- salvamento atrás dela; esgotado o prazo, 55P03 (retomável).
create function public.storage_lifecycle_fence_exclusive(p_timeout_ms integer default 3000)
returns void
language plpgsql
set search_path = ''
as $$
declare
  deadline timestamptz := pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => greatest(coalesce(p_timeout_ms, 0), 0) / 1000.0);
begin
  loop
    exit when pg_catalog.pg_try_advisory_xact_lock(public.storage_lifecycle_fence_key());
    if pg_catalog.clock_timestamp() >= deadline then
      raise exception 'Gravação em andamento numa fonte de referências de imagem; tente de novo em instantes.'
        using errcode = '55P03', hint = 'storage_lifecycle: source_write_in_progress';
    end if;
    perform pg_catalog.pg_sleep(0.02);
  end loop;
end;
$$;

-- Ordem única de travas: cerca (compartilhada) → global de escrita → chave. Quem segura a exclusiva
-- também passa por aqui (a mesma transação não conflita consigo). Sem isso, uma função do ciclo de
-- vida que grava numa fonte (troca de referência) pegaria a cerca DEPOIS da trava global, na ordem
-- oposta à das verificações.
create or replace function public.storage_lifecycle_lock_key(p_namespace text, p_key text)
returns void
language sql
set search_path = ''
as $$
  select public.storage_lifecycle_fence_shared();
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('storage_lifecycle:writer', 0));
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_namespace || ':' || coalesce(p_key, ''), 0));
$$;

-- 3. Extração de chaves -----------------------------------------------------------------------------
-- Todas as chaves do Storage em qualquer texto de um documento JSON (mesma normalização das fontes).
create function public.storage_lifecycle_extract_keys(p_value jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(distinct found.object_key order by found.object_key) filter (where found.object_key is not null), '{}'::text[])
  from (
    select public.storage_lifecycle_object_key(item #>> '{}', public.storage_lifecycle_known_buckets()) as object_key
    from pg_catalog.jsonb_path_query(coalesce(p_value, 'null'::jsonb), 'strict $.**') as item
    where pg_catalog.jsonb_typeof(item) = 'string'
  ) as found;
$$;

-- Assinatura da convenção de nomes (lib/achievementImageCandidates.ts): jogo e título da conquista,
-- ou jogo e selo final (título da Maestria). Mudou → o prefixo do jogo entra no diário.
create function public.storage_lifecycle_convention_signature(p_source text, p_row jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_row is null then null
    when p_source = 'achievements' then coalesce(p_row ->> 'game_slug', '') || '|' || coalesce(p_row ->> 'title', '')
    when p_source = 'games' then coalesce(p_row ->> 'slug', '') || '|' || coalesce((p_row -> 'final_badge')::text, '')
  end;
$$;

create function public.storage_lifecycle_convention_prefix(p_source text, p_row jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when coalesce(slug, '') = '' then null else 'achievement-art/games/' || slug || '/achievements/' end
  from (select case p_source when 'achievements' then p_row ->> 'game_slug' when 'games' then p_row ->> 'slug' end as slug) as s;
$$;

-- 4. Gatilhos das fontes ----------------------------------------------------------------------------
-- ANTES: trava compartilhada (até o COMMIT) e recusa de referência NOVA a objeto em arquivamento,
-- arquivado, em remoção, removido ou em restauração — para qualquer gravador. Troca de convenção é
-- recusada enquanto um objeto do prefixo do jogo estiver em remoção.
create function public.storage_lifecycle_source_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb := case when tg_op <> 'INSERT' then pg_catalog.to_jsonb(old) end;
  new_row jsonb := case when tg_op <> 'DELETE' then pg_catalog.to_jsonb(new) end;
  added text[];
  object_key text;
  target_bucket text;
  target_state text;
  prefix text;
begin
  perform public.storage_lifecycle_fence_shared();
  if tg_op <> 'DELETE' then
    added := array(
      select pg_catalog.unnest(public.storage_lifecycle_extract_keys(new_row))
      except
      select pg_catalog.unnest(public.storage_lifecycle_extract_keys(old_row)));
    foreach object_key in array added loop
      target_bucket := pg_catalog.split_part(object_key, '/', 1);
      select obj.archive_state into target_state from public.storage_object_lifecycle as obj
      where obj.bucket = target_bucket and obj.object_path = pg_catalog.substr(object_key, pg_catalog.length(target_bucket) + 2);
      if found and target_state <> 'none' then
        raise exception 'Referência nova a objeto em % (%): recusada.', target_state, object_key
          using errcode = '23514', hint = 'storage_lifecycle: reference_to_archived';
      end if;
    end loop;
  end if;
  if tg_table_name in ('achievements', 'games')
     and public.storage_lifecycle_convention_signature(tg_table_name, old_row) is distinct from public.storage_lifecycle_convention_signature(tg_table_name, new_row) then
    foreach prefix in array pg_catalog.array_remove(array[public.storage_lifecycle_convention_prefix(tg_table_name, old_row),
                                                          public.storage_lifecycle_convention_prefix(tg_table_name, new_row)], null) loop
      if exists (select 1 from public.storage_object_lifecycle as obj
                 where obj.archive_state = 'deleting' and pg_catalog.starts_with(obj.bucket || '/' || obj.object_path, prefix)) then
        raise exception 'Remoção em andamento em %: alteração de conquista recusada; tente de novo em instantes.', prefix
          using errcode = '23514', hint = 'storage_lifecycle: source_write_during_delete';
      end if;
    end loop;
  end if;
  return coalesce(new, old);
end;
$$;

-- DEPOIS: grava no diário as chaves que entraram ou saíram (e o prefixo da convenção que mudou).
-- Linha sem mudança de referência não gera evento.
create function public.storage_lifecycle_source_journal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb := case when tg_op <> 'INSERT' then pg_catalog.to_jsonb(old) end;
  new_row jsonb := case when tg_op <> 'DELETE' then pg_catalog.to_jsonb(new) end;
  old_keys text[] := public.storage_lifecycle_extract_keys(old_row);
  new_keys text[] := public.storage_lifecycle_extract_keys(new_row);
  changed text[];
  prefixes text[] := '{}';
begin
  changed := array(
    select d.k from (select pg_catalog.unnest(old_keys) except select pg_catalog.unnest(new_keys)) as d (k)
    union
    select a.k from (select pg_catalog.unnest(new_keys) except select pg_catalog.unnest(old_keys)) as a (k)
    order by 1);
  if tg_table_name in ('achievements', 'games')
     and public.storage_lifecycle_convention_signature(tg_table_name, old_row) is distinct from public.storage_lifecycle_convention_signature(tg_table_name, new_row) then
    prefixes := array(select distinct p from pg_catalog.unnest(array[public.storage_lifecycle_convention_prefix(tg_table_name, old_row),
                                                                               public.storage_lifecycle_convention_prefix(tg_table_name, new_row)]) as p
                                 where p is not null order by 1);
  end if;
  if pg_catalog.cardinality(changed) > 0 or pg_catalog.cardinality(prefixes) > 0 then
    insert into public.storage_lifecycle_source_changes (source, operation, row_key, object_keys, prefixes)
    values (tg_table_name, tg_op,
            pg_catalog.left(coalesce(new_row ->> 'id', old_row ->> 'id', new_row ->> 'slug', old_row ->> 'slug'), 300),
            changed, prefixes);
  end if;
  return null;
end;
$$;

-- TRUNCATE de uma fonte: evento com escopo total (só remove referências, mas a prova recomeça).
create function public.storage_lifecycle_source_truncate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.storage_lifecycle_fence_shared();
  insert into public.storage_lifecycle_source_changes (source, operation, scopes) values (tg_table_name, 'TRUNCATE', array['*']);
  return null;
end;
$$;

-- Storage: caminhos-fonte. Ponteiros (site-profile/active/*) e rascunhos.
create function public.storage_lifecycle_storage_source_kind(p_bucket text, p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_bucket = 'site-profile' and pg_catalog.starts_with(coalesce(p_name, ''), 'active/') then 'pointers'
    when p_bucket in ('achievement-preparation-drafts', 'game-review-drafts') then 'drafts'
  end;
$$;

-- Gatilho em storage.objects (upload, upsert, update, move, copy e remove pela API do Storage).
-- Fora dos caminhos-fonte: sai sem trava e sem custo. Recusar desfaz a transação do Storage: a versão
-- nova nunca fica visível (validado no projeto isolado de teste).
create function public.storage_lifecycle_storage_source_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  kind_new text := case when tg_op <> 'DELETE' then public.storage_lifecycle_storage_source_kind(new.bucket_id, new.name) end;
  kind_old text := case when tg_op <> 'INSERT' then public.storage_lifecycle_storage_source_kind(old.bucket_id, old.name) end;
begin
  if kind_new is null and kind_old is null then
    return coalesce(new, old);
  end if;
  perform public.storage_lifecycle_fence_shared();
  if exists (select 1 from public.storage_object_lifecycle as obj where obj.archive_state = 'deleting') then
    raise exception 'Remoção de imagem em andamento: gravação de % recusada; tente de novo em instantes.', coalesce(kind_new, kind_old)
      using errcode = '23514', hint = 'storage_lifecycle: source_write_during_delete';
  end if;
  insert into public.storage_lifecycle_source_changes (source, operation, row_key, scopes)
  values (coalesce(kind_new, kind_old), tg_op,
          pg_catalog.left(case when tg_op <> 'DELETE' then new.bucket_id || '/' || new.name else old.bucket_id || '/' || old.name end, 300),
          array['*']);
  return coalesce(new, old);
end;
$$;

-- 5. Varredura oficial com cerca ---------------------------------------------------------------------
alter function public.storage_lifecycle_begin_scan_run(text, text) rename to storage_lifecycle_begin_scan_run_base;
alter function public.storage_lifecycle_sync_scan(text, jsonb, text) rename to storage_lifecycle_sync_scan_base;
alter function public.storage_lifecycle_finish_scan_run(text, text, text, jsonb) rename to storage_lifecycle_finish_scan_run_base;
alter function public.storage_lifecycle_evidence(text, text) rename to storage_lifecycle_evidence_base;
alter function public.storage_lifecycle_begin_operation(text, text, text, text, text, text, jsonb) rename to storage_lifecycle_begin_operation_base;

-- Abertura: trava exclusiva, execução aberta e marcador do diário na mesma transação.
create function public.storage_lifecycle_begin_scan_run(p_scan_id text, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  marker bigint;
begin
  perform public.storage_lifecycle_fence_exclusive();
  result := public.storage_lifecycle_begin_scan_run_base(p_scan_id, p_actor);
  if result ->> 'status' = 'started' then
    select coalesce(pg_catalog.max(c.seq), 0) into marker from public.storage_lifecycle_source_changes as c;
    insert into public.storage_lifecycle_scan_fences (scan_id, run_operation_id, source_change_seq)
    values (p_scan_id, (result ->> 'operation_id')::uuid, marker);
  end if;
  select f.source_change_seq into marker from public.storage_lifecycle_scan_fences as f where f.scan_id = p_scan_id;
  return result || pg_catalog.jsonb_build_object('source_change_seq', marker);
end;
$$;

-- Cerca de uma execução oficial (chamada com a trava exclusiva): nenhum evento depois do marcador.
-- Varredura sem execução oficial (histórico, nunca é prova) não tem cerca.
create function public.storage_lifecycle_scan_fence_check(p_scan_id text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  fence public.storage_lifecycle_scan_fences%rowtype;
  changed integer;
  sample text;
begin
  if not exists (select 1 from public.storage_operation_log as log where log.idempotency_key = 'scan_run:' || p_scan_id and log.phase = 'intent') then
    return;
  end if;
  select * into fence from public.storage_lifecycle_scan_fences as f where f.scan_id = p_scan_id;
  if not found then
    raise exception 'A execução oficial de % foi aberta sem cerca de fontes (antes da migração 20261120): encerre-a como falha e comece outra.', p_scan_id
      using errcode = '23514', hint = 'storage_lifecycle: scan_run_without_fence';
  end if;
  select pg_catalog.count(*) into changed from public.storage_lifecycle_source_changes as c where c.seq > fence.source_change_seq;
  if changed > 0 then
    select pg_catalog.string_agg(x.source || ':' || coalesce(x.row_key, '-'), ', ') into sample
    from (select c.source, c.row_key from public.storage_lifecycle_source_changes as c where c.seq > fence.source_change_seq order by c.seq limit 5) as x;
    raise exception 'Fontes de referência alteradas durante a varredura % (% alteração(ões); ex.: %): ela não vale como prova. Comece uma varredura nova.',
      p_scan_id, changed, sample using errcode = '23514', hint = 'storage_lifecycle: scan_sources_changed';
  end if;
end;
$$;

create function public.storage_lifecycle_sync_scan(p_scan_id text, p_objects jsonb, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.storage_operation_log as log where log.operation = 'scan_sync' and log.scan_id = p_scan_id and log.phase = 'succeeded') then
    perform public.storage_lifecycle_fence_exclusive();
    perform public.storage_lifecycle_scan_fence_check(p_scan_id);
  end if;
  return public.storage_lifecycle_sync_scan_base(p_scan_id, p_objects, p_actor);
end;
$$;

create function public.storage_lifecycle_finish_scan_run(p_scan_id text, p_result text, p_actor text, p_details jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_result = 'succeeded' and exists (
    select 1 from public.storage_operation_log as run
    where run.idempotency_key = 'scan_run:' || p_scan_id and run.phase = 'intent'
      and not exists (select 1 from public.storage_operation_log as done where done.operation_id = run.operation_id and done.phase <> 'intent')
  ) then
    perform public.storage_lifecycle_fence_exclusive();
    perform public.storage_lifecycle_scan_fence_check(p_scan_id);
  end if;
  return public.storage_lifecycle_finish_scan_run_base(p_scan_id, p_result, p_actor, p_details);
end;
$$;

-- 6. Prova de elegibilidade -------------------------------------------------------------------------
-- A anterior (política vigente, duas varreduras, 30 dias) e mais: nenhum evento do diário depois do
-- marcador da varredura mais recente tocou o objeto, um prefixo que o contém ou todos os objetos.
create function public.storage_lifecycle_evidence(p_bucket text, p_object_path text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  verdict jsonb := public.storage_lifecycle_evidence_base(p_bucket, p_object_path);
  fence public.storage_lifecycle_scan_fences%rowtype;
  object_key text := p_bucket || '/' || p_object_path;
  touched integer;
begin
  if not coalesce((verdict ->> 'eligible')::boolean, false) then
    return verdict;
  end if;
  select * into fence from public.storage_lifecycle_scan_fences as f where f.scan_id = verdict ->> 'latest_scan';
  if not found then
    return verdict || pg_catalog.jsonb_build_object('eligible', false,
      'reason', 'a varredura mais recente não tem cerca de fontes (execução aberta antes da migração 20261120)');
  end if;
  select pg_catalog.count(*) into touched from public.storage_lifecycle_source_changes as c
  where c.seq > fence.source_change_seq
    and (object_key = any (c.object_keys) or '*' = any (c.scopes)
         or exists (select 1 from pg_catalog.unnest(c.prefixes) as p where pg_catalog.starts_with(object_key, p)));
  if touched > 0 then
    return verdict || pg_catalog.jsonb_build_object('eligible', false,
      'reason', 'uso alterado depois da varredura ' || (verdict ->> 'latest_scan') || ' (' || touched || ' alteração(ões) nas fontes)',
      'source_change_seq', fence.source_change_seq, 'source_changes_after_scan', touched);
  end if;
  return verdict || pg_catalog.jsonb_build_object('source_change_seq', fence.source_change_seq);
end;
$$;

-- 7. Autorização de arquivar e remover ---------------------------------------------------------------
-- Uso real AGORA, em todas as linhas das fontes do banco (chamada com a trava exclusiva).
create function public.storage_lifecycle_object_in_use(p_bucket text, p_object_path text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  object_key text[] := array[p_bucket || '/' || p_object_path];
begin
  if exists (select 1 from public.games as t where public.storage_lifecycle_extract_keys(pg_catalog.to_jsonb(t)) @> object_key) then return 'games'; end if;
  if exists (select 1 from public.achievements as t where public.storage_lifecycle_extract_keys(pg_catalog.to_jsonb(t)) @> object_key) then return 'achievements'; end if;
  if exists (select 1 from public.achievement_progress as t where public.storage_lifecycle_extract_keys(pg_catalog.to_jsonb(t)) @> object_key) then return 'achievement_progress'; end if;
  if exists (select 1 from public.journey_entries as t where public.storage_lifecycle_extract_keys(pg_catalog.to_jsonb(t)) @> object_key) then return 'journey_entries'; end if;
  if exists (select 1 from public.journey_history_events as t where public.storage_lifecycle_extract_keys(pg_catalog.to_jsonb(t)) @> object_key) then return 'journey_history_events'; end if;
  return null;
end;
$$;

-- Arquivar e remover: trava exclusiva (nenhuma gravação em andamento), conferência viva do uso e,
-- para remover o original, uma varredura oficial aberta DEPOIS do arquivamento. A mudança de estado
-- (archiving/deleting) acontece na mesma transação; daí em diante o gatilho das fontes recusa
-- referência nova. Repetição com a mesma chave devolve a operação existente sem nova conferência.
create function public.storage_lifecycle_begin_operation(
  p_idempotency_key text, p_operation text, p_bucket text, p_object_path text, p_actor text, p_reason text, p_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.storage_object_lifecycle%rowtype;
  fence public.storage_lifecycle_scan_fences%rowtype;
  verdict jsonb;
  in_use text;
begin
  if p_operation in ('archive_copy', 'delete_object') and coalesce(pg_catalog.btrim(p_idempotency_key), '') <> ''
     and not exists (select 1 from public.storage_operation_log as log where log.idempotency_key = p_idempotency_key and log.phase = 'intent') then
    perform public.storage_lifecycle_fence_exclusive();
    in_use := public.storage_lifecycle_object_in_use(p_bucket, p_object_path);
    if in_use is not null then
      raise exception 'Objeto %/% está em uso agora na fonte % do banco: nada foi alterado.', p_bucket, p_object_path, in_use
        using errcode = '23514', hint = 'storage_lifecycle: object_in_use';
    end if;
    if p_operation = 'delete_object' then
      select * into target from public.storage_object_lifecycle as obj where obj.bucket = p_bucket and obj.object_path = p_object_path;
      verdict := public.storage_lifecycle_evidence(p_bucket, p_object_path);
      -- Objeto inexistente ou não elegível: a função anterior recusa com o motivo dela.
      if target.bucket is not null and target.archive_state = 'archived' and coalesce((verdict ->> 'eligible')::boolean, false) then
        select * into fence from public.storage_lifecycle_scan_fences as f where f.scan_id = verdict ->> 'latest_scan';
        if not found or target.archived_at is null or fence.recorded_at <= target.archived_at then
          raise exception 'Remover o original de %/% exige uma varredura oficial aberta depois do arquivamento (%).', p_bucket, p_object_path, target.archived_at
            using errcode = '23514', hint = 'storage_lifecycle: delete_needs_scan_after_archive';
        end if;
      end if;
    end if;
  end if;
  return public.storage_lifecycle_begin_operation_base(p_idempotency_key, p_operation, p_bucket, p_object_path, p_actor, p_reason, p_details);
end;
$$;

-- 8. Privilégios ---------------------------------------------------------------------------------------
revoke all on function public.storage_lifecycle_fence_key() from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_fence_shared() from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_fence_exclusive(integer) from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_extract_keys(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_convention_signature(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_convention_prefix(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_source_guard() from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_source_journal() from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_source_truncate() from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_storage_source_kind(text, text) from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_storage_source_guard() from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_scan_fence_check(text) from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_object_in_use(text, text) from public, anon, authenticated, service_role;
-- Versões anteriores: só pelas novas (o service_role não contorna a cerca).
revoke all on function public.storage_lifecycle_begin_scan_run_base(text, text) from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_sync_scan_base(text, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_finish_scan_run_base(text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_evidence_base(text, text) from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_begin_operation_base(text, text, text, text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_begin_scan_run(text, text) from public, anon, authenticated;
revoke all on function public.storage_lifecycle_sync_scan(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.storage_lifecycle_finish_scan_run(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.storage_lifecycle_evidence(text, text) from public, anon, authenticated;
revoke all on function public.storage_lifecycle_begin_operation(text, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.storage_lifecycle_begin_scan_run(text, text) to service_role;
grant execute on function public.storage_lifecycle_sync_scan(text, jsonb, text) to service_role;
grant execute on function public.storage_lifecycle_finish_scan_run(text, text, text, jsonb) to service_role;
grant execute on function public.storage_lifecycle_evidence(text, text) to service_role;
grant execute on function public.storage_lifecycle_begin_operation(text, text, text, text, text, text, jsonb) to service_role;

reset role;

-- 9. Gatilhos (criados por quem aplica a migração, dono das tabelas; a função é do proprietário) ---
create trigger storage_lifecycle_source_guard before insert or update or delete on public.games
  for each row execute function public.storage_lifecycle_source_guard();
create trigger storage_lifecycle_source_journal after insert or update or delete on public.games
  for each row execute function public.storage_lifecycle_source_journal();
create trigger storage_lifecycle_source_truncate before truncate on public.games
  for each statement execute function public.storage_lifecycle_source_truncate();
create trigger storage_lifecycle_source_guard before insert or update or delete on public.achievements
  for each row execute function public.storage_lifecycle_source_guard();
create trigger storage_lifecycle_source_journal after insert or update or delete on public.achievements
  for each row execute function public.storage_lifecycle_source_journal();
create trigger storage_lifecycle_source_truncate before truncate on public.achievements
  for each statement execute function public.storage_lifecycle_source_truncate();
create trigger storage_lifecycle_source_guard before insert or update or delete on public.achievement_progress
  for each row execute function public.storage_lifecycle_source_guard();
create trigger storage_lifecycle_source_journal after insert or update or delete on public.achievement_progress
  for each row execute function public.storage_lifecycle_source_journal();
create trigger storage_lifecycle_source_truncate before truncate on public.achievement_progress
  for each statement execute function public.storage_lifecycle_source_truncate();
create trigger storage_lifecycle_source_guard before insert or update or delete on public.journey_entries
  for each row execute function public.storage_lifecycle_source_guard();
create trigger storage_lifecycle_source_journal after insert or update or delete on public.journey_entries
  for each row execute function public.storage_lifecycle_source_journal();
create trigger storage_lifecycle_source_truncate before truncate on public.journey_entries
  for each statement execute function public.storage_lifecycle_source_truncate();
create trigger storage_lifecycle_source_guard before insert or update or delete on public.journey_history_events
  for each row execute function public.storage_lifecycle_source_guard();
create trigger storage_lifecycle_source_journal after insert or update or delete on public.journey_history_events
  for each row execute function public.storage_lifecycle_source_journal();
create trigger storage_lifecycle_source_truncate before truncate on public.journey_history_events
  for each statement execute function public.storage_lifecycle_source_truncate();

-- Storage (Supabase): obrigatório quando o schema storage existe; bancos sem Storage (testes locais
-- das outras camadas) ficam sem ele, e a autoverificação abaixo confere essa regra.
do $$
begin
  if pg_catalog.to_regclass('storage.objects') is not null then
    execute 'create trigger storage_lifecycle_source_guard before insert or update or delete on storage.objects
      for each row execute function public.storage_lifecycle_storage_source_guard()';
  end if;
end;
$$;

revoke storage_lifecycle_owner from current_user;

-- 10. Autoverificação: se algo não confere, nada é aplicado ------------------------------------------
do $$
declare
  problem text;
  missing text;
begin
  select pg_catalog.string_agg(p.oid::regprocedure::text, ', ') into problem
  from pg_catalog.pg_proc as p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('storage_lifecycle_begin_scan_run', 'storage_lifecycle_sync_scan', 'storage_lifecycle_finish_scan_run',
                      'storage_lifecycle_evidence', 'storage_lifecycle_begin_operation')
    and (p.proowner <> 'storage_lifecycle_owner'::regrole or not p.prosecdef
         or not coalesce(p.proconfig @> array['search_path=""'], false)
         or pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
         or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
         or not pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'));
  if problem is not null then
    raise exception 'Funções públicas com dono, segurança ou privilégios incorretos: %', problem;
  end if;
  select pg_catalog.string_agg(p.oid::regprocedure::text, ', ') into problem
  from pg_catalog.pg_proc as p
  where p.pronamespace = 'public'::regnamespace
    and (p.proname like 'storage_lifecycle\_%\_base'
         or p.proname in ('storage_lifecycle_fence_exclusive', 'storage_lifecycle_fence_shared', 'storage_lifecycle_extract_keys',
                          'storage_lifecycle_source_guard', 'storage_lifecycle_source_journal', 'storage_lifecycle_source_truncate',
                          'storage_lifecycle_storage_source_guard', 'storage_lifecycle_scan_fence_check', 'storage_lifecycle_object_in_use'))
    and (p.proowner <> 'storage_lifecycle_owner'::regrole or not coalesce(p.proconfig @> array['search_path=""'], false)
         or pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
         or pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
         or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if problem is not null then
    raise exception 'Funções internas expostas ou com dono incorreto: %', problem;
  end if;
  if pg_catalog.has_table_privilege('service_role', 'public.storage_lifecycle_source_changes', 'INSERT')
     or pg_catalog.has_table_privilege('service_role', 'public.storage_lifecycle_scan_fences', 'INSERT')
     or pg_catalog.has_table_privilege('anon', 'public.storage_lifecycle_source_changes', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'public.storage_lifecycle_scan_fences', 'SELECT') then
    raise exception 'Privilégios incorretos no diário ou nos marcadores.';
  end if;
  select pg_catalog.string_agg(t.tbl || '.' || t.trg, ', ') into missing
  from (select tbl, trg from pg_catalog.unnest(array['games', 'achievements', 'achievement_progress', 'journey_entries', 'journey_history_events']) as tbl
        cross join pg_catalog.unnest(array['storage_lifecycle_source_guard', 'storage_lifecycle_source_journal', 'storage_lifecycle_source_truncate']) as trg) as t
  where not exists (select 1 from pg_catalog.pg_trigger as g where g.tgrelid = ('public.' || t.tbl)::regclass and g.tgname = t.trg and g.tgenabled = 'O');
  if missing is not null then
    raise exception 'Gatilhos de fonte ausentes ou desligados: %', missing;
  end if;
  if pg_catalog.to_regclass('storage.objects') is not null and not exists (
    select 1 from pg_catalog.pg_trigger as g where g.tgrelid = pg_catalog.to_regclass('storage.objects') and g.tgname = 'storage_lifecycle_source_guard' and g.tgenabled = 'O'
  ) then
    raise exception 'Gatilho de fonte em storage.objects ausente.';
  end if;
  if pg_catalog.pg_has_role(current_user, 'storage_lifecycle_owner', 'USAGE') and not (select rolsuper from pg_catalog.pg_roles where rolname = current_user) then
    raise exception 'quem aplicou a migração não pode herdar storage_lifecycle_owner depois dela.';
  end if;
end;
$$;

commit;

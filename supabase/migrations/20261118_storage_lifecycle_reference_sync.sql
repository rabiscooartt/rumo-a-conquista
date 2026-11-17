-- Ciclo de vida das imagens — auditoria dos salvamentos em massa (Etapa 5.1).
-- Complementa 20261114, 20261116 e 20261117 (precisa das três aplicadas). Rollback:
-- supabase/rollbacks/20261118_storage_lifecycle_reference_sync_rollback.sql
--
-- Os salvamentos administrativos de jogos (jogo completo, sincronizações, Maestria Final, Emblema,
-- conquistas, review) gravam várias linhas de uma vez: criam e apagam conquistas, reestruturam JSON
-- e trocam referências de imagem junto com outros campos. As funções existentes
-- (storage_lifecycle_replace_reference / replace_json_reference) fazem a própria escrita, uma
-- referência por vez e só em linhas e caminhos que já existem; não cobrem esses salvamentos sem mudar
-- o comportamento deles. Esta migração acrescenta, SEM escrever em nenhuma tabela do site:
--   1. O tipo de operação reference_sync na auditoria.
--   2. storage_lifecycle_begin_reference_sync: registra, ANTES da gravação, a intenção com cada
--      referência de imagem que vai mudar (local exato, valor anterior e novo). Uma por escopo
--      (jogo): pendência do MESMO pedido é retomada; de outro pedido, recusada (55000).
--   3. storage_lifecycle_finish_reference_sync: confirma SÓ com a releitura feita pelo próprio banco
--      mostrando todos os valores novos. Falha só com a releitura mostrando todos os anteriores
--      (nada foi gravado). Qualquer mistura deixa a operação pendente — nunca confirma sem prova.
-- O estado dos objetos do Storage NÃO muda aqui; nada é apagado, movido ou arquivado.
-- games.review entra só como AUDITORIA (leitura): a função não grava a review, então os gatilhos de
-- histórico da review não são acionados por ela; a troca continua bloqueada em replace_json_reference.
begin;

do $$
begin
  if pg_catalog.to_regprocedure('public.storage_lifecycle_begin_pointer_activation(text, text, text, text, text, text)') is null then
    raise exception 'A migração 20261117_storage_lifecycle_pointer_activation não está aplicada.';
  end if;
  if exists (select 1 from pg_catalog.pg_proc as p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('storage_lifecycle_begin_reference_sync', 'storage_lifecycle_finish_reference_sync',
                               'storage_lifecycle_reference_sync_read')) then
    raise exception 'Funções de reference_sync já existem: migração aplicada antes ou nomes ocupados.';
  end if;
end;
$$;

-- Releitura pelo banco: o dono do ciclo de vida passa a LER (só SELECT, por coluna) as chaves que
-- localizam cada referência e a review. Nenhum UPDATE novo; review continua sem escrita.
grant select (game_slug, legacy_id) on public.achievements to storage_lifecycle_owner;
grant select (achievement_id, owner_key) on public.achievement_progress to storage_lifecycle_owner;
grant select (review) on public.games to storage_lifecycle_owner;

grant storage_lifecycle_owner to current_user;
set local role storage_lifecycle_owner;

alter table public.storage_operation_log drop constraint storage_operation_log_operation;
alter table public.storage_operation_log add constraint storage_operation_log_operation check (operation in (
  'scan_register', 'scan_invalidate', 'scan_sync', 'state_change', 'object_missing', 'classification_override',
  'manual_protect', 'manual_unprotect',
  'archive_copy', 'archive_cancel', 'delete_object', 'restore_object',
  'reference_replace', 'json_reference_replace',
  'object_upload', 'reference_batch',
  'pointer_activate',
  'reference_sync'
));

-- Lê o valor atual de um item (local exato). Devolve null quando a linha, o caminho ou o valor não
-- existem; '' conta como ausente. Só tabelas, colunas e chaves da lista fixa; nada dinâmico vem do item.
create function public.storage_lifecycle_reference_sync_read(p_item jsonb)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t text := p_item ->> 'table';
  c text := p_item ->> 'column';
  r jsonb := p_item -> 'row';
  p text[];
  v text;
begin
  if pg_catalog.jsonb_typeof(p_item -> 'path') = 'array' then
    select pg_catalog.array_agg(value order by ordinality) into p from pg_catalog.jsonb_array_elements_text(p_item -> 'path') with ordinality;
  end if;
  if t = 'games' then
    select case c
      when 'image' then g.image
      when 'card_image' then g.card_image
      when 'final_badge' then g.final_badge #>> p
      when 'emblem' then g.emblem #>> p
      when 'trophies' then g.trophies #>> p
      when 'review' then g.review #>> p
    end into v
    from public.games as g where g.slug = r ->> 'slug';
  elsif t = 'achievements' then
    select case c when 'image' then a.image when 'official_image' then a.official_image end into v
    from public.achievements as a where a.game_slug = r ->> 'game_slug' and a.legacy_id = r ->> 'legacy_id';
  elsif t = 'achievement_progress' then
    select progress.image_override into v
    from public.achievement_progress as progress
    join public.achievements as a on a.id = progress.achievement_id
    where a.game_slug = r ->> 'game_slug' and a.legacy_id = r ->> 'legacy_id' and progress.owner_key = r ->> 'owner_key';
  else
    raise exception 'Tabela % fora da lista.', t using errcode = '22023';
  end if;
  return nullif(v, '');
end;
$$;

-- p_scope: 'game:<slug>'. p_base_key: 'refsync:<64 hex>' (SHA-256 do estado desejado do pedido) e
-- p_chunk/p_chunks dividem pedidos grandes (até 150 itens por operação).
-- Item: {"table","column","row":{...},"path":[...]|null,"old":texto|null,"new":texto|null}.
create function public.storage_lifecycle_begin_reference_sync(
  p_scope text, p_base_key text, p_chunk integer, p_chunks integer, p_actor text, p_reason text, p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  slug text := pg_catalog.substr(p_scope, 6);
  pending public.storage_operation_log%rowtype;
  item jsonb;
  t text;
  c text;
  enriched jsonb := '[]'::jsonb;
  resumable jsonb := '[]'::jsonb;
  attempt integer;
  op uuid := pg_catalog.gen_random_uuid();
begin
  if p_scope is null or p_scope !~ '^game:[^\s/]{1,200}$' then
    raise exception 'Escopo inválido.' using errcode = '22023';
  end if;
  if p_base_key is null or p_base_key !~ '^refsync:[0-9a-f]{64}$' then
    raise exception 'Chave-base inválida.' using errcode = '22023';
  end if;
  if p_chunks is null or p_chunks < 1 or p_chunks > 50 or p_chunk is null or p_chunk < 1 or p_chunk > p_chunks then
    raise exception 'Parte % de % inválida.', p_chunk, p_chunks using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_items) is distinct from 'array' or pg_catalog.jsonb_array_length(p_items) > 150 then
    raise exception 'Itens ausentes ou demais (máximo 150 por parte).' using errcode = '22023';
  end if;

  for item in select value from pg_catalog.jsonb_array_elements(p_items) loop
    t := item ->> 'table';
    c := item ->> 'column';
    if pg_catalog.jsonb_typeof(item -> 'row') is distinct from 'object'
       or coalesce(pg_catalog.jsonb_typeof(item -> 'old'), 'ausente') not in ('string', 'null')
       or coalesce(pg_catalog.jsonb_typeof(item -> 'new'), 'ausente') not in ('string', 'null')
       or coalesce(pg_catalog.jsonb_typeof(item -> 'path'), 'ausente') not in ('array', 'null')
       or nullif(item ->> 'old', '') is not distinct from nullif(item ->> 'new', '')
       or not (
         (t = 'games' and c in ('image', 'card_image') and pg_catalog.jsonb_typeof(item -> 'path') = 'null'
            and item -> 'row' ->> 'slug' = slug and (item -> 'row') - 'slug' = '{}'::jsonb)
         or (t = 'games' and c in ('final_badge', 'emblem', 'trophies', 'review') and pg_catalog.jsonb_typeof(item -> 'path') = 'array'
            and pg_catalog.jsonb_array_length(item -> 'path') between 1 and 20
            and not exists (select 1 from pg_catalog.jsonb_array_elements(item -> 'path') as part where pg_catalog.jsonb_typeof(part.value) <> 'string')
            and item -> 'row' ->> 'slug' = slug and (item -> 'row') - 'slug' = '{}'::jsonb)
         or (t = 'achievements' and c in ('image', 'official_image') and pg_catalog.jsonb_typeof(item -> 'path') = 'null'
            and item -> 'row' ->> 'game_slug' = slug and coalesce(item -> 'row' ->> 'legacy_id', '') <> ''
            and (item -> 'row') - 'game_slug' - 'legacy_id' = '{}'::jsonb)
         or (t = 'achievement_progress' and c = 'image_override' and pg_catalog.jsonb_typeof(item -> 'path') = 'null'
            and item -> 'row' ->> 'game_slug' = slug and coalesce(item -> 'row' ->> 'legacy_id', '') <> ''
            and coalesce(item -> 'row' ->> 'owner_key', '') <> ''
            and (item -> 'row') - 'game_slug' - 'legacy_id' - 'owner_key' = '{}'::jsonb)
       ) then
      raise exception 'Item inválido: %', pg_catalog.left(item::text, 300) using errcode = '22023';
    end if;
    -- Referência nova ao Storage precisa ser interpretável e não apontar para objeto arquivado.
    enriched := enriched || pg_catalog.jsonb_build_array(item || pg_catalog.jsonb_build_object(
      'old_object', public.storage_lifecycle_object_key(item ->> 'old', public.storage_lifecycle_known_buckets()),
      'new_object', public.storage_lifecycle_validate_new_reference(item ->> 'new')));
  end loop;
  if (select pg_catalog.count(distinct pg_catalog.jsonb_build_array(value -> 'table', value -> 'column', value -> 'row', value -> 'path'))
      from pg_catalog.jsonb_array_elements(p_items)) <> pg_catalog.jsonb_array_length(p_items) then
    raise exception 'Local repetido no pedido.' using errcode = '22023';
  end if;

  perform public.storage_lifecycle_lock_key('refsync', p_scope);

  -- Pendência no mesmo escopo: o MESMO pedido (mesma chave-base) é retomado com os itens ORIGINAIS
  -- de todas as suas partes pendentes (resumable); outro pedido é recusado até ser resolvido.
  for pending in
    select intent.* from public.storage_operation_log as intent
    where intent.operation = 'reference_sync' and intent.phase = 'intent' and intent.details ->> 'scope' = p_scope
      and not exists (select 1 from public.storage_operation_log as done where done.operation_id = intent.operation_id and done.phase <> 'intent')
    order by intent.id
  loop
    if pending.details ->> 'base_key' is distinct from p_base_key then
      raise exception 'Outro salvamento deste jogo (%) está pendente desde %; repita aquele salvamento ou rode a reconciliação antes.',
        p_scope, pending.occurred_at using errcode = '55000', hint = 'storage_lifecycle: reference_sync_pending';
    end if;
    resumable := resumable || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'operation_id', pending.operation_id, 'chunk', (pending.details ->> 'chunk')::integer, 'items', pending.details -> 'items'));
  end loop;
  select value into item from pg_catalog.jsonb_array_elements(resumable) where (value ->> 'chunk')::integer = p_chunk limit 1;
  if item is not null then
    return pg_catalog.jsonb_build_object('status', 'pending', 'operation_id', item ->> 'operation_id', 'items', item -> 'items',
      'resumable', resumable);
  end if;

  if pg_catalog.jsonb_array_length(p_items) = 0 then
    return pg_catalog.jsonb_build_object('status', 'nothing', 'resumable', resumable);
  end if;

  select pg_catalog.count(*) + 1 into attempt from public.storage_operation_log as log
  where log.operation = 'reference_sync' and log.phase = 'intent' and log.details ->> 'base_key' = p_base_key
    and (log.details ->> 'chunk')::integer = p_chunk;
  perform public.storage_lifecycle_append_log(op, 'intent', 'reference_sync',
    p_base_key || ':' || p_chunk::text || ':' || attempt::text, null, null, null, p_actor,
    coalesce(nullif(pg_catalog.btrim(p_reason), ''), 'salvamento administrativo com imagens'), null, null, null, null,
    pg_catalog.jsonb_build_object('scope', p_scope, 'base_key', p_base_key, 'chunk', p_chunk, 'chunks', p_chunks,
      'attempt', attempt, 'count', pg_catalog.jsonb_array_length(enriched), 'items', enriched));
  return pg_catalog.jsonb_build_object('status', 'started', 'operation_id', op, 'items', enriched);
end;
$$;

-- p_mode: 'verify' (logo após gravar), 'settle' (gravação falhou ou retomada: aceita também
-- "nada gravado") ou 'close_unconfirmed' (só reconciliação, operação com 30 min ou mais: encerra
-- como failed registrando os valores reais, para destravar o escopo sem confirmar nada).
create function public.storage_lifecycle_finish_reference_sync(p_operation_id uuid, p_actor text, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent public.storage_operation_log%rowtype;
  result_phase text;
  total integer;
  as_new integer := 0;
  as_old integer := 0;
  actual jsonb := '[]'::jsonb;
  item jsonb;
  current_value text;
begin
  if p_mode not in ('verify', 'settle', 'close_unconfirmed') then
    raise exception 'Modo inválido: %', p_mode using errcode = '22023';
  end if;
  select * into intent from public.storage_operation_log as log where log.operation_id = p_operation_id and log.phase = 'intent';
  if not found or intent.operation <> 'reference_sync' then
    raise exception 'Salvamento % não encontrado.', p_operation_id using errcode = '22023';
  end if;
  perform public.storage_lifecycle_lock_key('refsync', intent.details ->> 'scope');
  select log.phase into result_phase from public.storage_operation_log as log where log.operation_id = p_operation_id and log.phase <> 'intent';
  if found then
    return pg_catalog.jsonb_build_object('status', 'already_finished', 'result', result_phase, 'operation_id', p_operation_id);
  end if;

  total := pg_catalog.jsonb_array_length(intent.details -> 'items');
  for item in select value from pg_catalog.jsonb_array_elements(intent.details -> 'items') loop
    current_value := public.storage_lifecycle_reference_sync_read(item);
    if current_value is not distinct from nullif(item ->> 'new', '') then as_new := as_new + 1; end if;
    if current_value is not distinct from nullif(item ->> 'old', '') then as_old := as_old + 1; end if;
    actual := actual || pg_catalog.jsonb_build_array(current_value);
  end loop;

  if as_new = total then
    perform public.storage_lifecycle_append_log(p_operation_id, 'succeeded', 'reference_sync', null, null, null, null, p_actor, null,
      null, null, null, null, pg_catalog.jsonb_build_object('method', 'db_read_back', 'verified', total));
    return pg_catalog.jsonb_build_object('status', 'succeeded', 'operation_id', p_operation_id, 'verified', total);
  end if;
  if p_mode in ('settle', 'close_unconfirmed') and as_old = total then
    perform public.storage_lifecycle_append_log(p_operation_id, 'failed', 'reference_sync', null, null, null, null, p_actor, null,
      null, null, null, null, pg_catalog.jsonb_build_object('method', 'db_read_back', 'reason', 'not_applied', 'unchanged', total));
    return pg_catalog.jsonb_build_object('status', 'failed', 'operation_id', p_operation_id, 'reason', 'not_applied');
  end if;
  if p_mode = 'close_unconfirmed' then
    if intent.occurred_at > pg_catalog.now() - interval '30 minutes' then
      raise exception 'Salvamento % tem menos de 30 minutos; pode estar em andamento.', p_operation_id
        using errcode = '55000', hint = 'storage_lifecycle: reference_sync_too_recent';
    end if;
    perform public.storage_lifecycle_append_log(p_operation_id, 'failed', 'reference_sync', null, null, null, null, p_actor, null,
      null, null, null, null, pg_catalog.jsonb_build_object('method', 'db_read_back', 'reason', 'unconfirmed',
        'as_new', as_new, 'as_old', as_old, 'total', total, 'actual', actual));
    return pg_catalog.jsonb_build_object('status', 'failed', 'operation_id', p_operation_id, 'reason', 'unconfirmed',
      'as_new', as_new, 'as_old', as_old, 'total', total);
  end if;
  raise exception 'Releitura não comprova o salvamento %: % de % valores novos, % anteriores; continua pendente.',
    p_operation_id, as_new, total, as_old using errcode = '55000', hint = 'storage_lifecycle: reference_sync_unverified';
end;
$$;

revoke all on function public.storage_lifecycle_reference_sync_read(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.storage_lifecycle_begin_reference_sync(text, text, integer, integer, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.storage_lifecycle_finish_reference_sync(uuid, text, text) from public, anon, authenticated;
grant execute on function public.storage_lifecycle_begin_reference_sync(text, text, integer, integer, text, text, jsonb) to service_role;
grant execute on function public.storage_lifecycle_finish_reference_sync(uuid, text, text) to service_role;

reset role;
revoke storage_lifecycle_owner from current_user;

do $$
declare
  problem text;
begin
  select pg_catalog.string_agg(p.oid::regprocedure::text, ', ') into problem
  from pg_catalog.pg_proc as p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('storage_lifecycle_begin_reference_sync', 'storage_lifecycle_finish_reference_sync', 'storage_lifecycle_reference_sync_read')
    and (p.proowner <> 'storage_lifecycle_owner'::regrole or not p.prosecdef
         or not coalesce(p.proconfig @> array['search_path=""'], false)
         or pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
         or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
         or (p.proname = 'storage_lifecycle_reference_sync_read') = pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'));
  if problem is not null then
    raise exception 'Funções novas com dono, segurança ou privilégios incorretos: %', problem;
  end if;
  if (select pg_catalog.count(*) from pg_catalog.pg_proc as p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('storage_lifecycle_begin_reference_sync', 'storage_lifecycle_finish_reference_sync', 'storage_lifecycle_reference_sync_read')) <> 3 then
    raise exception 'Esperadas 3 funções novas.';
  end if;
  if not (pg_catalog.has_column_privilege('storage_lifecycle_owner', 'public.achievements', 'legacy_id', 'SELECT')
          and pg_catalog.has_column_privilege('storage_lifecycle_owner', 'public.achievement_progress', 'owner_key', 'SELECT')
          and pg_catalog.has_column_privilege('storage_lifecycle_owner', 'public.games', 'review', 'SELECT'))
     or pg_catalog.has_column_privilege('storage_lifecycle_owner', 'public.games', 'review', 'UPDATE') then
    raise exception 'Privilégios de leitura do dono do ciclo de vida incorretos.';
  end if;
  if pg_catalog.pg_has_role(current_user, 'storage_lifecycle_owner', 'USAGE') and not (select rolsuper from pg_catalog.pg_roles where rolname = current_user) then
    raise exception 'quem aplicou a migração não pode herdar storage_lifecycle_owner depois dela.';
  end if;
end;
$$;

commit;

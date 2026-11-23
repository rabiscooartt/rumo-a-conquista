// Varredura oficial nos testes de integração (migração 20261119): execução aberta ANTES do relatório,
// registro, atestação com manifesto, sincronização e conclusão — a mesma sequência do fluxo real.
//
// "Viagem no tempo" (SÓ NOS TESTES, como superusuário do cluster descartável): o banco exige que a
// execução comece antes da conclusão do relatório (run.occurred_at <= completed_at) e usa o relógio
// dele. Para simular varreduras com 30+ dias de intervalo, a abertura da execução é recuada para logo
// antes do completed_at e a cadeia de hashes da auditoria é recalculada (storage_operation_log_verify
// continua íntegra). Nada disso existe nas migrações nem em produção.
import pg from "pg";

export const SOURCES = ["achievements", "achievement_progress", "games", "journey_entries", "journey_history_events",
  "pointers", "drafts", "variant_map", "protection", "convention"];
export const manifestFor = (sources = SOURCES, digest = "d".repeat(64)) =>
  sources.map((source) => ({ source, status: "complete", references: 0, digest }));

export const TIME_TRAVEL_SQL = `
create schema if not exists test_support;
create or replace function test_support.backdate_scan_run(p_scan_id text, p_at timestamptz)
returns void
language plpgsql
set search_path = ''
as $$
declare
  entry public.storage_operation_log%rowtype;
  previous text := null;
  last_id bigint;
  next_hash text;
begin
  perform pg_catalog.set_config('session_replication_role', 'replica', true);
  update public.storage_operation_log set occurred_at = p_at where idempotency_key = 'scan_run:' || p_scan_id and phase = 'intent';
  if not found then
    raise exception 'execução oficial de % inexistente', p_scan_id;
  end if;
  for entry in select * from public.storage_operation_log as log order by log.id loop
    next_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      coalesce(previous, '') || '|' || public.storage_operation_log_canonical(entry), 'UTF8')), 'hex');
    update public.storage_operation_log set prev_hash = previous, entry_hash = next_hash where id = entry.id;
    previous := next_hash;
    last_id := entry.id;
  end loop;
  update public.storage_operation_log_head set last_entry_id = last_id, last_entry_hash = previous where singleton;
  perform pg_catalog.set_config('session_replication_role', 'origin', true);
end;
$$;
revoke all on schema test_support from public;`;

/** Instala a viagem no tempo no banco indicado (conexão de superusuário própria). */
export async function installTimeTravel({ base, adminUser = process.env.PG_ADMIN_USER ?? "supabase_admin", database }) {
  const client = new pg.Client({ ...base, user: adminUser, database });
  await client.connect();
  await client.query(TIME_TRAVEL_SQL);
  return {
    backdate: async (scanId, at) => { await client.query("select test_support.backdate_scan_run($1, $2)", [scanId, at]); },
    end: () => client.end(),
  };
}

/**
 * Varredura oficial completa: begin_scan_run → (recuo da abertura) → register → attest (manifesto) →
 * sync → finish_scan_run. Com finish: false, para antes da conclusão (execução pendente).
 */
export async function officialScan({ rpc, backdate, payload, objects, actor = "teste", manifest = manifestFor(), finish = true, sync = true }) {
  const full = { report_sha256: "a".repeat(64), ...payload };
  const run = await rpc("storage_lifecycle_begin_scan_run", { p_scan_id: full.scan_id, p_actor: actor });
  await backdate(full.scan_id, new Date(Date.parse(full.completed_at) - 60_000).toISOString());
  await rpc("storage_lifecycle_register_scan", { p_scan: full, p_actor: actor });
  const attest = await rpc("storage_lifecycle_attest_scan", { p_scan_id: full.scan_id, p_policy_version: 2, p_manifest: manifest, p_report_sha256: full.report_sha256, p_actor: actor });
  if (sync) await rpc("storage_lifecycle_sync_scan", { p_scan_id: full.scan_id, p_objects: objects, p_actor: actor });
  const done = finish ? await rpc("storage_lifecycle_finish_scan_run", { p_scan_id: full.scan_id, p_result: "succeeded", p_actor: actor, p_details: {} }) : null;
  return { run, attest, done };
}

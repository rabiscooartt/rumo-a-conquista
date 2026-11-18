// Fluxo completo das varreduras OFICIAIS (lib/images/lifecycle/officialScan.ts) contra PostgreSQL 17
// isolado com as migrações reais até 20261119, como service_role. A coleta é simulada (mesmo formato
// da coleta real); o banco é real: execução, registro, atestação com manifesto, sincronização,
// conclusão, prova de elegibilidade e cadeia de auditoria. Respostas perdidas, retomadas, fonte
// ausente, simulação sem escrita e duas varreduras oficiais com 39 dias. Nada acessa o Supabase.
import pg from "pg";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const repo = process.env.REPO;
const replica = process.argv[2];
const read = (p) => readFileSync(`${repo}/${p}`, "utf8");
const imp = (p) => import(pathToFileURL(`${repo}/${p}`).href);
const { runOfficialScan, officialScanApi, checkpointFile, HISTORY_FILE } = await imp("lib/images/lifecycle/officialScan.ts");
const { REFERENCE_SOURCES, DEFAULT_PROTECTED_OBJECTS, referencesFromProtectionList } = await imp("lib/images/lifecycle/references.ts");
const { installTimeTravel } = await imp("tests/integration/support/officialRun.mjs");
const base = { host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 55433) };
const ADMIN = process.env.PG_ADMIN_USER ?? "supabase_admin";
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${String(detail).slice(0, 220)}` : ""}`); };

const admin = new pg.Client({ ...base, user: ADMIN, database: "postgres" });
await admin.connect();
await admin.query(`create role postgres login createrole bypassrls inherit; create role anon nologin; create role authenticated nologin;
  create role service_role nologin bypassrls; create role authenticator login noinherit;
  grant anon to authenticator with inherit false; grant authenticated to authenticator with inherit false; grant service_role to authenticator with inherit false;
  grant anon, authenticated, service_role, authenticator to postgres with admin option;`);
await admin.query("create database rumo owner postgres");
{
  const a = new pg.Client({ ...base, user: ADMIN, database: "rumo" });
  await a.connect();
  await a.query(`grant usage on schema public to postgres, anon, authenticated, service_role;
    alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;`);
  await a.end();
}
const db = new pg.Client({ ...base, user: "postgres", database: "rumo" });
await db.connect();
await db.query(readFileSync(replica, "utf8"));
for (const m of ["20261102_add_games_backlog_order", "20261114_create_storage_image_lifecycle", "20261116_storage_lifecycle_tracked_uploads",
  "20261117_storage_lifecycle_pointer_activation", "20261118_storage_lifecycle_reference_sync"]) await db.query(read(`supabase/migrations/${m}.sql`));
const svcClient = new pg.Client({ ...base, user: "authenticator", database: "rumo" });
await svcClient.connect();
await svcClient.query("set role service_role");

// RPC como service_role, com falhas injetadas: "before" (nada chega ao banco) ou "after" (o banco
// grava e a resposta se perde).
const faults = [];
const calls = {};
const rawRpc = async (fn, args) => {
  const names = Object.keys(args);
  const values = names.map((n) => (args[n] !== null && typeof args[n] === "object" ? JSON.stringify(args[n]) : args[n]));
  return (await svcClient.query(`select public.${fn}(${names.map((n, j) => `${n} => $${j + 1}`).join(", ")}) as r`, values)).rows[0].r;
};
const rpc = async (fn, args) => {
  calls[fn] = (calls[fn] ?? 0) + 1;
  const i = faults.findIndex((f) => f.fn === fn);
  const fault = i >= 0 ? faults.splice(i, 1)[0] : null;
  if (fault?.when === "before") throw Object.assign(new Error(`conexão perdida antes de ${fn}`), { code: "08006" });
  const value = await rawRpc(fn, args);
  if (fault?.when === "after") throw Object.assign(new Error(`resposta de ${fn} perdida`), { code: "08006" });
  return value;
};
const q = async (sql, params = []) => (await svcClient.query(sql, params)).rows;
const readState = async () => {
  const pending = await q("select operation, details from public.storage_lifecycle_pending_operations");
  return {
    scans: await q("select scan_id, completed_at, complete, inventory_status, image_objects, image_bytes, report_sha256 from public.storage_lifecycle_scans"),
    objects: await q("select bucket, object_path, state, manual_protection, manual_protection_reason, archive_state, reference_count, observing_since, observing_since_scan_id, last_seen_scan_id from public.storage_object_lifecycle order by bucket, object_path"),
    scanObjectRows: Number((await q("select count(*) n from public.storage_lifecycle_scan_objects"))[0].n),
    logRows: Number((await q("select count(*) n from public.storage_operation_log"))[0].n),
    syncedScanIds: (await q("select scan_id from public.storage_operation_log where operation = 'scan_sync' and phase = 'succeeded'")).map((r) => r.scan_id),
    pendingOperations: pending.length,
    pendingRunScanIds: pending.filter((r) => r.operation === "scan_run").map((r) => r.details.scan_id),
  };
};
const verifyChain = async () => q("select * from public.storage_operation_log_verify()");
const countScanObjects = async (id) => Number((await q("select count(*) n from public.storage_lifecycle_scan_objects where scan_id = $1", [id]))[0].n);

// Relógio simulado: cada varredura acontece numa data do passado. A abertura da execução é recuada
// (só nos testes) para logo antes do relógio simulado: o banco continua exigindo abertura <= relatório.
let clock = Date.parse("2026-09-01T10:00:00Z");
const now = () => new Date((clock += 1000));
const travel = await installTimeTravel({ base, database: "rumo" });
const baseApi = officialScanApi(rpc, { readState, verifyChain }, countScanObjects);
const api = {
  ...baseApi,
  beginRun: async (scanId, actor) => {
    const r = await baseApi.beginRun(scanId, actor);
    // Abertura ainda não recuada (inclusive quando a resposta da abertura se perdeu): recua agora.
    if ((r.status === "started" || r.status === "pending") && Date.parse(r.started_at) > clock) {
      await travel.backdate(scanId, new Date(clock - 500).toISOString());
      return { ...r, started_at: new Date(clock - 500).toISOString() };
    }
    return r;
  },
};

// Coleta simulada: 4 artes protegidas do Mouse, "a" referenciada, "b" sem referência.
const KEY = { a: "achievement-art/games/jogo-o/achievements/a.webp", b: "achievement-art/games/jogo-o/achievements/b.webp" };
const ALL = [...DEFAULT_PROTECTED_OBJECTS, KEY.a, KEY.b];
const collectFixture = (failSource) => async () => {
  const objects = ALL.map((key) => ({ bucket: "achievement-art", path: key.slice("achievement-art/".length), size: 100, mimetype: "image/webp", isImage: true }));
  const sources = REFERENCE_SOURCES.filter((s) => s !== "protection").map((source) => ({
    source, status: source === failSource ? "failed" : "complete",
    references: source === "achievements" ? [{ objectKey: KEY.a, source, location: "achievements:1.image", raw: KEY.a }] : [],
    ...(source === failSource ? { error: "falha simulada" } : {}),
  }));
  sources.push(referencesFromProtectionList());
  return {
    sources,
    collected: {
      existingBuckets: ["achievement-art"], inventory: { status: "complete", objects }, nonImageObjects: [], allImageObjects: objects, sources: [],
      pointerReadings: [], tableCounts: { achievements: 1 }, issues: [],
      counters: { listCalls: 1, listedEntries: objects.length, tablePages: 1, tableRows: 1, jsonFilesDownloaded: 0, jsonBytesDownloaded: 0, imageDownloads: 0, approxMetadataBytes: 0 },
    },
  };
};
const files = new Map();
const store = {
  exists: (p) => files.has(p),
  read: (p) => { if (!files.has(p)) throw new Error(`sem ${p}`); return files.get(p); },
  writeNew: (p, text) => { if (files.has(p)) throw new Error(`EEXIST ${p}`); files.set(p, text); },
  append: (p, text) => files.set(p, (files.get(p) ?? "") + text),
};
const events = [];
const official = (o = {}) => runOfficialScan({
  mode: o.mode ?? "apply", resumeScanId: o.resume, actor: "teste-oficial", now, api, store, collect: collectFixture(o.failSource),
  protectedObjects: DEFAULT_PROTECTED_OBJECTS, log: (e) => events.push(`${e.kind}: ${e.message}`),
});
const logCount = async () => Number((await q("select count(*) n from public.storage_operation_log"))[0].n);
const intents = async (op, id) => Number((await q(`select count(*) n from public.storage_operation_log where operation = $1 and phase = 'intent'
  and (scan_id = $2 or idempotency_key = $1 || ':' || $2)`, [op, id]))[0].n);
const evidence = (key) => rawRpc("storage_lifecycle_evidence", { p_bucket: "achievement-art", p_object_path: key.slice("achievement-art/".length) });
const stateOf = async (key) => (await q("select state from public.storage_object_lifecycle where bucket = 'achievement-art' and object_path = $1", [key.slice("achievement-art/".length)]))[0]?.state;
// jsonb reordena as chaves dos objetos: compara entrada por entrada, na ordem do manifesto.
const canon = (list) => list.map((m) => [m.source, m.status, m.references, m.digest]);
const seq = async (items, fn) => { const out = []; for (const x of items) out.push(await fn(x)); return out; };
const steps = (id) => files.get(checkpointFile(id)).trim().split("\n").map((l) => JSON.parse(l).step);

// ---------- 0. Varredura antiga (como a de 15/11), antes da migração 20261119 ----------
const oldObjects = ALL.map((key) => ({
  bucket: "achievement-art", path: key.slice("achievement-art/".length), size: 100, mimetype: "image/webp",
  state: key === KEY.a ? "referenced" : key === KEY.b ? "observing" : "protected", reference_count: key === KEY.a ? 1 : 0,
  ...(DEFAULT_PROTECTED_OBJECTS.includes(key) ? { protected_reason: "lista de proteção" } : {}),
}));
await rawRpc("storage_lifecycle_register_scan", { p_scan: { scan_id: "scan-20260801T000000Z", completed_at: "2026-08-01T00:00:00Z", complete: true, inventory_status: "complete", image_objects: ALL.length, image_bytes: 100 * ALL.length, report_sha256: "a".repeat(64) }, p_actor: "teste" });
await rawRpc("storage_lifecycle_sync_scan", { p_scan_id: "scan-20260801T000000Z", p_objects: oldObjects, p_actor: "teste" });
files.set(HISTORY_FILE, JSON.stringify({ scanId: "scan-20260801T000000Z", completedAt: "2026-08-01T00:00:00.000Z", complete: true, unreferenced: [KEY.b], present: ALL }) + "\n");
await db.query(read("supabase/migrations/20261119_storage_lifecycle_scan_policy.sql"));

// ---------- 1. Simulação: nada gravado ----------
{
  const logBefore = await logCount();
  const filesBefore = JSON.stringify([...files]);
  const r = await official({ mode: "dry-run" });
  check("O1. simulação (dry-run): plano pronto, nenhuma escrita no banco (auditoria igual), nenhum arquivo nem linha de histórico, nenhuma execução aberta",
    r.ok && r.writes === 0 && (await logCount()) === logBefore && JSON.stringify([...files]) === filesBefore && (await intents("scan_run", r.scanId)) === 0, r.reason ?? r.plan?.counts?.objects);
}

// ---------- 2. Primeira varredura oficial com respostas perdidas em todas as etapas ----------
let S1;
{
  faults.push({ fn: "storage_lifecycle_begin_scan_run", when: "after" }, { fn: "storage_lifecycle_register_scan", when: "after" },
    { fn: "storage_lifecycle_attest_scan", when: "after" }, { fn: "storage_lifecycle_sync_scan", when: "after" },
    { fn: "storage_lifecycle_finish_scan_run", when: "after" });
  const first = await official();
  S1 = first.scanId;
  const stops = [first];
  for (let i = 0; i < 6 && !stops.at(-1).ok; i += 1) stops.push(await official({ resume: S1 }));
  const last = stops.at(-1);
  check("O2. respostas perdidas depois de gravar (execução, registro, atestação, sincronização, conclusão): cada retomada continua do ponto certo e conclui",
    last.ok && stops.length === 6 && stops.slice(0, -1).every((s) => !s.ok && !s.runFailed), stops.map((s) => s.ok ? "ok" : `${s.stage}: ${String(s.reason).slice(0, 60)}`).join(" → "));
  const counts = await seq(["scan_run", "scan_register", "scan_attest", "scan_sync"], (op) => intents(op, S1));
  check("O3. nada duplicado: uma intenção de execução, registro, atestação e sincronização; relatório e histórico únicos",
    counts.every((c) => c === 1) && files.get(HISTORY_FILE).trim().split("\n").length === 2
      && steps(S1).filter((s) => s === "persisted").length === 1, counts.join("/"));
  const meets = await rawRpc("storage_lifecycle_scan_meets_policy", { p_scan_id: S1 });
  const ev = await evidence(KEY.b);
  const run = (await q("select phase from public.storage_operation_log where operation = 'scan_run' and phase <> 'intent' and details ->> 'scan_id' = $1", [S1]))[0]?.phase;
  check("O4. primeira oficial concluída: atende à política; antiga + 1 oficial NÃO formam prova (só 1 conta); nada elegível",
    meets === true && run === "succeeded" && ev.eligible === false && ev.scans === 1 && (await stateOf(KEY.b)) === "observing", JSON.stringify(ev).slice(0, 160));
  const report = JSON.parse(files.get(`${S1}/report.json`));
  const row = (await q("select report_sha256 from public.storage_lifecycle_scans where scan_id = $1", [S1]))[0];
  const att = (await q("select manifest, run_operation_id from public.storage_lifecycle_scan_attestations where scan_id = $1", [S1]))[0];
  const runOp = (await q("select operation_id from public.storage_operation_log where idempotency_key = $1 and phase = 'intent'", [`scan_run:${S1}`]))[0].operation_id;
  check("O5. relatório e estado persistido correspondem: SHA-256 registrado = arquivo; manifesto atestado = manifesto do relatório; execução do relatório = execução da atestação",
    row.report_sha256 === last.reportSha256 && JSON.stringify(canon(att.manifest)) === JSON.stringify(canon(report.manifest)) && att.run_operation_id === runOp && report.runOperationId === runOp,
    `${row.report_sha256 === last.reportSha256}/${att.run_operation_id === runOp}`);
}

// ---------- 3. Fonte ausente: execução encerrada como falha ----------
{
  clock = Date.parse("2026-09-20T10:00:00Z");
  const before = await logCount();
  const r = await official({ failSource: "convention" });
  const run = (await q("select phase from public.storage_operation_log where operation = 'scan_run' and phase <> 'intent' and details ->> 'scan_id' = $1", [r.scanId]))[0]?.phase;
  const registered = (await q("select count(*)::int n from public.storage_lifecycle_scans where scan_id = $1", [r.scanId]))[0].n;
  check("O6. fonte convention ausente: recusa definitiva, execução encerrada como falha no banco, nada registrado, nenhuma linha no histórico",
    !r.ok && r.runFailed === true && run === "failed" && registered === 0 && (await logCount()) === before + 2 && files.get(HISTORY_FILE).trim().split("\n").length === 2, r.reason);
  const again = await official({ resume: r.scanId });
  check("O7. execução encerrada como falha não é retomada", !again.ok && /encerrada como falha/.test(again.reason), again.reason);
}

// ---------- 4. Interrupções antes de gravar e segunda varredura oficial (39 dias) ----------
{
  clock = Date.parse("2026-10-10T10:00:00Z");
  faults.push({ fn: "storage_lifecycle_register_scan", when: "before" }, { fn: "storage_lifecycle_attest_scan", when: "before" },
    { fn: "storage_lifecycle_sync_scan", when: "before" }, { fn: "storage_lifecycle_finish_scan_run", when: "before" });
  const first = await official();
  const S2 = first.scanId;
  const stops = [first];
  for (let i = 0; i < 6 && !stops.at(-1).ok; i += 1) stops.push(await official({ resume: S2 }));
  const counts = await seq(["scan_run", "scan_register", "scan_attest", "scan_sync"], (op) => intents(op, S2));
  check("O8. conexão perdida antes de cada escrita: retomadas concluem; uma intenção por etapa",
    stops.at(-1).ok && stops.length === 5 && counts.every((c) => c === 1), `${stops.map((s) => s.ok ? "ok" : `${s.stage}: ${String(s.reason).slice(0, 60)}`).join(" → ")} | ${counts.join("/")}`);
  const ev = await evidence(KEY.b);
  const report = JSON.parse(files.get(`${S2}/report.json`));
  check("O9. duas oficiais da mesma política com 39 dias: b vira candidate (a classificação local pediu e o banco confirmou com a prova); a referenciada não",
    ev.eligible === true && ev.first_scan === S1 && ev.latest_scan === S2 && ev.policy_version === 2 && (await stateOf(KEY.b)) === "candidate"
      && report.objects.find((o) => o.objectKey === KEY.b).state === "candidate" && (await stateOf(KEY.a)) === "referenced",
    JSON.stringify(ev).slice(0, 180));
  const pending = (await readState()).pendingOperations;
  const chain = (await verifyChain()).length;
  check("O10. nenhuma pendência; cadeia de auditoria íntegra", pending === 0 && chain === 0, `${pending}/${chain}`);
}

// ---------- 5. Execução pendente abandonada não vale e não bloqueia para sempre ----------
{
  clock = Date.parse("2026-10-20T10:00:00Z");
  faults.push({ fn: "storage_lifecycle_attest_scan", when: "before" });
  const r = await official();
  const blocked = await official();
  const { abandonOfficialScan } = await imp("lib/images/lifecycle/officialScan.ts");
  const ab = await abandonOfficialScan({ scanId: r.scanId, reason: "teste: execução abandonada", actor: "teste", api, store, now });
  const meets = await rawRpc("storage_lifecycle_scan_meets_policy", { p_scan_id: r.scanId });
  const ev = await evidence(KEY.b);
  check("O11. execução pendente bloqueia outra (uma por vez); abandonada = falha; registrada sem atestação não vale e torna a mais recente inválida como prova (nada elegível)",
    !r.ok && !blocked.ok && /scan_run_other_pending|outra varredura/.test(blocked.reason) && ab.status === "failed" && meets === false && ev.eligible === false,
    `${blocked.reason?.slice(0, 80)} | ${ab.status} | ${ev.reason}`);
}

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} verificações passaram`);
await travel.end(); await svcClient.end(); await db.end(); await admin.end();
process.exit(ok === results.length ? 0 : 1);

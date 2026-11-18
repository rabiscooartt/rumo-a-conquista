// Fluxo das varreduras oficiais (lib/images/lifecycle/officialScan.ts) contra um banco simulado com as
// mesmas regras da migração 20261119 (execução, atestação com manifesto, conclusão). A semântica real
// do banco é exercida na suíte de integração "official-scan".
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkpointFile, HISTORY_FILE, runOfficialScan, sha256Text, type OfficialScanApi, type ScanStore } from "../../lib/images/lifecycle/officialScan.ts";
import { DEFAULT_PROTECTED_OBJECTS, REFERENCE_SOURCES, referencesFromProtectionList, type SourceResult } from "../../lib/images/lifecycle/references.ts";
import { SCAN_POLICY_SOURCES } from "../../lib/images/lifecycle/scanPolicy.ts";
import type { CollectedSources } from "../../lib/images/lifecycle/collect.ts";

const KEYS = { a: "achievement-art/games/x/achievements/a.webp", b: "achievement-art/games/x/achievements/b.webp" };
const ALL = [...DEFAULT_PROTECTED_OBJECTS, KEYS.a, KEYS.b];

function collectedFixture(opts: { failSource?: string } = {}) {
  const objects = ALL.map((key) => ({ bucket: "achievement-art", path: key.slice("achievement-art/".length), size: 100, mimetype: "image/webp", isImage: true }));
  const sources: SourceResult[] = REFERENCE_SOURCES.filter((s) => s !== "protection").map((source) => ({
    source,
    status: source === opts.failSource ? "failed" : "complete",
    references: source === "achievements" ? [{ objectKey: KEYS.a, source, location: "achievements:1.image", raw: KEYS.a }] : [],
    ...(source === opts.failSource ? { error: "falha simulada" } : {}),
  }));
  sources.push(referencesFromProtectionList());
  const collected = {
    existingBuckets: ["achievement-art"], inventory: { status: "complete", objects }, nonImageObjects: [], allImageObjects: objects,
    sources: [], pointerReadings: [], tableCounts: { achievements: 1 }, issues: [],
    counters: { listCalls: 1, listedEntries: objects.length, tablePages: 1, tableRows: 1, jsonFilesDownloaded: 0, jsonBytesDownloaded: 0, imageDownloads: 0, approxMetadataBytes: 0 },
  } as unknown as CollectedSources;
  return { collected, sources };
}

const Err = class extends Error {
  code: string; hint?: string;
  constructor(message: string, code: string, hint?: string) { super(message); this.code = code; this.hint = hint; }
};

/** Banco simulado com as regras da migração 20261119. */
function fakeDb() {
  const db = {
    policy: 2,
    sources: [...SCAN_POLICY_SOURCES] as string[],
    runs: new Map<string, { op: string; policy: number; status: "pending" | "succeeded" | "failed"; startedAt: string }>(),
    scans: new Map<string, Record<string, unknown>>(),
    attestations: new Map<string, { policy: number; sha: string; manifest: string }>(),
    synced: new Set<string>(),
    invalidated: new Set<string>(),
    rows: new Map<string, { state: string; reference_count: number; last_seen_scan_id: string; manual_protection: boolean; archive_state: string }>(),
    evidence: new Map<string, number>(),
    calls: [] as string[],
    fail: new Map<string, Error>(),
    clock: Date.parse("2026-12-01T10:00:00Z"),
  };
  const hit = (fn: string) => {
    db.calls.push(fn);
    const error = db.fail.get(fn);
    if (error) { db.fail.delete(fn); throw error; }
  };
  const runOf = (scanId: string) => db.runs.get(scanId);
  const api: OfficialScanApi = {
    async policyCurrent() { hit("policy"); return { policy_version: db.policy, required_sources: db.sources }; },
    async beginRun(scanId) {
      hit("begin");
      const run = runOf(scanId);
      if (run) return { status: run.status, operation_id: run.op, policy_version: run.policy, started_at: run.startedAt };
      if (db.scans.has(scanId)) throw new Err("registrada sem execução", "23514", "storage_lifecycle: scan_run_after_register");
      if ([...db.runs.values()].some((r) => r.status === "pending")) throw new Err("outra pendente", "55000", "storage_lifecycle: scan_run_other_pending");
      const created = { op: `op-${scanId}`, policy: db.policy, status: "pending" as const, startedAt: new Date(db.clock).toISOString() };
      db.runs.set(scanId, created);
      return { status: "started", operation_id: created.op, policy_version: created.policy, started_at: created.startedAt };
    },
    async finishRun(scanId, result) {
      hit(`finish:${result}`);
      const run = runOf(scanId);
      if (!run) throw new Err("sem execução", "22023");
      if (run.status !== "pending") return { status: "already_finished", result: run.status };
      if (result === "succeeded") {
        const scan = db.scans.get(scanId);
        if (!scan || !db.attestations.has(scanId) || !db.synced.has(scanId) || db.evidence.get(scanId) !== scan.image_objects) {
          throw new Err("incompleta", "55000", "storage_lifecycle: scan_run_incomplete");
        }
      }
      run.status = result;
      return { status: result };
    },
    async registerScan(payload) {
      hit("register");
      const existing = db.scans.get(payload.scan_id);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(payload)) throw new Err("outros dados", "23505");
        return { status: "already_registered" };
      }
      db.scans.set(payload.scan_id, { ...payload });
      return { status: "registered" };
    },
    async attestScan(scanId, version, manifest, sha) {
      hit("attest");
      const run = runOf(scanId);
      if (!run) throw new Err("sem execução", "23514", "storage_lifecycle: scan_run_missing");
      if (version !== db.policy) throw new Err("versão", "22023", "storage_lifecycle: scan_policy_version");
      if (run.status !== "pending") throw new Err("encerrada", "55000", "storage_lifecycle: scan_run_closed");
      if (run.policy !== db.policy) throw new Err("política mudou", "23514", "storage_lifecycle: scan_run_policy_changed");
      const names = manifest.map((m) => m.source);
      if (!db.sources.every((s) => names.includes(s)) || manifest.some((m) => m.status !== "complete")) throw new Err("fontes", "23514", "storage_lifecycle: scan_sources_missing");
      const existing = db.attestations.get(scanId);
      if (existing) {
        if (existing.sha !== sha || existing.manifest !== JSON.stringify(manifest)) throw new Err("outros dados", "23505");
        return { status: "already_attested" };
      }
      if (db.scans.get(scanId)?.report_sha256 !== sha) throw new Err("sha", "23514", "storage_lifecycle: scan_report_mismatch");
      db.attestations.set(scanId, { policy: version, sha, manifest: JSON.stringify(manifest) });
      return { status: "attested", manifest_sha256: "f".repeat(64) };
    },
    async syncScan(scanId, objects) {
      hit("sync");
      if (db.synced.has(scanId)) return { status: "already_synced" };
      let inserted = 0, updated = 0, missing = 0;
      const seen = new Set<string>();
      for (const o of objects) {
        const key = `${o.bucket}/${o.path}`;
        seen.add(key);
        const row = db.rows.get(key);
        if (row) updated += 1; else inserted += 1;
        const state = row?.manual_protection ? "protected" : o.state === "candidate" ? "observing" : o.state;
        db.rows.set(key, { state, reference_count: o.reference_count, last_seen_scan_id: scanId, manual_protection: row?.manual_protection ?? false, archive_state: "none" });
      }
      for (const [key, row] of db.rows) if (!seen.has(key) && row.archive_state === "none") missing += 1;
      db.synced.add(scanId);
      db.evidence.set(scanId, objects.length);
      return { status: "synced", inserted, updated, missing, evidence_rows: objects.length, overrides: 0, state_changes: 0 };
    },
    async invalidateScan(scanId) { hit("invalidate"); db.invalidated.add(scanId); return { status: "invalidated" }; },
    async readState() {
      hit("read");
      return {
        scans: [...db.scans.values()].map((s) => ({ ...s, complete: true, inventory_status: "complete" })) as never,
        objects: [...db.rows].map(([key, r]) => ({ bucket: "achievement-art", object_path: key.slice("achievement-art/".length), observing_since: null, observing_since_scan_id: null, ...r })) as never,
        scanObjectRows: [...db.evidence.values()].reduce((a, b) => a + b, 0),
        logRows: 0,
        syncedScanIds: [...db.synced],
        pendingOperations: [...db.runs.values()].filter((r) => r.status === "pending").length,
        pendingRunScanIds: [...db.runs].filter(([, r]) => r.status === "pending").map(([id]) => id),
      };
    },
    async scanObjectCount(scanId) { hit("count"); return db.evidence.get(scanId) ?? 0; },
    async meetsPolicy(scanId) {
      hit("meets");
      const run = runOf(scanId);
      const a = db.attestations.get(scanId);
      return !!run && run.status === "succeeded" && run.policy === db.policy && !!a && a.policy === db.policy && !db.invalidated.has(scanId);
    },
    async verifyChain() { hit("verify"); return []; },
  };
  return { db, api };
}

function memoryStore(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const store: ScanStore = {
    exists: (p) => files.has(p),
    read: (p) => { if (!files.has(p)) throw new Error(`sem ${p}`); return files.get(p)!; },
    writeNew: (p, text) => { if (files.has(p)) throw new Error(`EEXIST ${p}`); files.set(p, text); },
    append: (p, text) => files.set(p, (files.get(p) ?? "") + text),
  };
  return { files, store };
}

function harness(opts: { store?: ReturnType<typeof memoryStore>; failSource?: string } = {}) {
  const { db, api } = fakeDb();
  const mem = opts.store ?? memoryStore();
  let collects = 0;
  const events: string[] = [];
  const run = (input: { mode?: "apply" | "dry-run"; resumeScanId?: string; failSource?: string; collectError?: Error } = {}) => runOfficialScan({
    mode: input.mode ?? "apply", resumeScanId: input.resumeScanId, actor: "teste", api, store: mem.store,
    now: () => new Date((db.clock += 1000)),
    collect: async () => { collects += 1; if (input.collectError) throw input.collectError; return collectedFixture({ failSource: input.failSource ?? opts.failSource }); },
    protectedObjects: DEFAULT_PROTECTED_OBJECTS, log: (e) => events.push(`${e.kind}: ${e.message}`),
  });
  return { db, mem, run, events, collects: () => collects };
}
const steps = (mem: ReturnType<typeof memoryStore>, scanId: string) =>
  mem.files.get(checkpointFile(scanId))!.trim().split("\n").map((l) => JSON.parse(l).step);
const WRITE_CALLS = ["begin", "register", "attest", "sync", "finish:succeeded"];

test("fluxo completo: execução → coleta → relatório → registro → atestação → sincronização → conclusão → conferência", async () => {
  const h = harness();
  const r = await h.run();
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(h.db.calls.filter((c) => WRITE_CALLS.includes(c)), WRITE_CALLS);
  assert.deepEqual(steps(h.mem, r.scanId), ["begin_requested", "run_started", "persisted", "registered", "attested", "synced", "finished", "verified"]);
  const report = h.mem.files.get(`${r.scanId}/report.json`)!;
  assert.equal(sha256Text(report), r.reportSha256);
  assert.equal(h.db.scans.get(r.scanId)!.report_sha256, r.reportSha256);
  const parsed = JSON.parse(report);
  assert.equal(parsed.official, true);
  assert.equal(parsed.policyVersion, 2);
  assert.equal(parsed.runOperationId, `op-${r.scanId}`);
  assert.deepEqual(parsed.manifest.map((m: { source: string }) => m.source), [...SCAN_POLICY_SOURCES].sort());
  assert.equal(h.mem.files.get(`${r.scanId}/manifest.json`), JSON.stringify(parsed.manifest, null, 2) + "\n");
  const history = h.mem.files.get(HISTORY_FILE)!.trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(history.length, 1);
  assert.equal(history[0].official, true);
  assert.equal(history[0].policyVersion, 2);
  assert.equal(h.db.runs.get(r.scanId)!.status, "succeeded");
  assert.equal(await (await fakeDbApiOf(h)).meetsPolicy(r.scanId), true);
  // Repetir com --scan-id não faz nada.
  const before = h.db.calls.length;
  const again = await h.run({ resumeScanId: r.scanId });
  assert.equal(again.ok, true);
  assert.equal(again.writes, 0);
  assert.equal(h.db.calls.length - before, 1, "só a leitura da política");
});
// Acesso à API do harness para consultas pontuais.
async function fakeDbApiOf(h: ReturnType<typeof harness>) {
  return { meetsPolicy: async (id: string) => h.db.runs.get(id)?.status === "succeeded" && h.db.attestations.get(id)?.policy === h.db.policy && !h.db.invalidated.has(id) };
}

for (const failing of ["register", "attest", "sync", "finish:succeeded", "count", "verify", "read"] as const) {
  test(`interrupção em ${failing}: para sem encerrar a execução; a retomada conclui sem duplicar nada`, async () => {
    const h = harness();
    h.db.fail.set(failing, new Error("rede caiu"));
    const first = await h.run();
    assert.equal(first.ok, false);
    assert.equal(first.runFailed, undefined);
    assert.match(first.reason!, /retomável|rede caiu/);
    assert.equal(h.db.runs.get(first.scanId)!.status, failing === "count" || failing === "verify" ? "succeeded" : "pending");
    const resumed = await h.run({ resumeScanId: first.scanId });
    assert.equal(resumed.ok, true, resumed.reason);
    assert.equal(resumed.reportSha256, first.reportSha256, "mesmo relatório (não coletou de novo)");
    assert.equal(h.collects(), 1);
    assert.equal(h.db.scans.size, 1);
    assert.equal(h.db.attestations.size, 1);
    assert.equal(h.db.synced.size, 1);
    assert.equal(h.mem.files.get(HISTORY_FILE)!.trim().split("\n").length, 1, "uma linha no histórico");
    const s = steps(h.mem, first.scanId);
    for (const step of ["persisted", "registered", "attested", "synced", "finished", "verified"]) assert.equal(s.filter((x) => x === step).length, 1, step);
  });
}

test("interrupção na coleta: nada gravado; a retomada coleta de novo dentro da mesma execução", async () => {
  const h = harness();
  const first = await h.run({ collectError: new Error("timeout") });
  assert.equal(first.ok, false);
  assert.equal(h.mem.files.has(`${first.scanId}/report.json`), false);
  assert.equal(h.mem.files.has(HISTORY_FILE), false);
  const resumed = await h.run({ resumeScanId: first.scanId });
  assert.equal(resumed.ok, true, resumed.reason);
  assert.equal(h.collects(), 2);
  assert.equal(h.db.runs.size, 1);
});

test("fonte ausente ou incompleta: execução encerrada como falha; nada registrado, nada no histórico; não retoma", async () => {
  const h = harness();
  const r = await h.run({ failSource: "convention" });
  assert.equal(r.ok, false);
  assert.equal(r.runFailed, true);
  assert.match(r.reason!, /convention/);
  assert.equal(h.db.runs.get(r.scanId)!.status, "failed");
  assert.equal(h.db.scans.size, 0);
  assert.equal(h.mem.files.has(HISTORY_FILE), false);
  assert.equal(h.mem.files.has(`${r.scanId}/report.json`), false);
  const again = await h.run({ resumeScanId: r.scanId });
  assert.equal(again.ok, false);
  assert.match(again.reason!, /encerrada como falha/);
  assert.equal(h.db.scans.size, 0);
});

test("política mudou durante a execução: encerrada como falha antes da atestação; versões nunca se misturam", async () => {
  const h = harness();
  h.db.fail.set("register", new Error("rede caiu"));
  const first = await h.run();
  h.db.policy = 3;
  const resumed = await h.run({ resumeScanId: first.scanId });
  assert.equal(resumed.ok, false);
  assert.equal(resumed.runFailed, true);
  assert.match(resumed.reason!, /política mudou/);
  assert.equal(h.db.attestations.size, 0);
});

test("política do banco diferente da do código: nenhuma execução é aberta", async () => {
  const h = harness();
  h.db.policy = 3;
  const r = await h.run();
  assert.equal(r.ok, false);
  assert.equal(h.db.runs.size, 0);
  assert.equal(h.db.calls.includes("begin"), false);
});

test("simulação (dry-run): sem execução, sem escrita no banco, sem arquivos e sem histórico", async () => {
  const h = harness();
  const r = await h.run({ mode: "dry-run" });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.writes, 0);
  assert.deepEqual(h.db.calls.filter((c) => WRITE_CALLS.includes(c) || c === "invalidate"), []);
  assert.equal(h.mem.files.size, 0);
  assert.equal(h.db.runs.size, 0);
  assert.ok(r.plan!.counts.objects === ALL.length);
});

test("retomada sem pontos de controle é recusada (não abre execução para um identificador qualquer)", async () => {
  const h = harness();
  const r = await h.run({ resumeScanId: "scan-20261201T000000Z" });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /nada para retomar/);
  assert.equal(h.db.runs.size, 0);
});

test("outra execução oficial pendente: a nova não começa", async () => {
  const h = harness();
  h.db.fail.set("register", new Error("rede caiu"));
  await h.run();
  const second = await h.run();
  assert.equal(second.ok, false);
  assert.match(second.reason!, /scan_run_other_pending/);
  assert.equal(h.db.runs.size, 1);
});

test("histórico antigo (sem política) e oficial não confirmado pelo banco não viram evidência", async () => {
  const old = { scanId: "scan-20261115T163906Z", completedAt: "2026-11-15T16:39:06.000Z", complete: true, unreferenced: [KEYS.b], present: ALL };
  const fake = { ...old, scanId: "scan-20261020T000000Z", completedAt: "2026-10-20T00:00:00.000Z", official: true, policyVersion: 2 };
  const mem = memoryStore({ [HISTORY_FILE]: JSON.stringify(fake) + "\n" + JSON.stringify(old) + "\n" });
  const h = harness({ store: mem });
  const r = await h.run();
  assert.equal(r.ok, true, r.reason);
  const report = JSON.parse(mem.files.get(`${r.scanId}/report.json`)!);
  assert.deepEqual(report.validations.validPriorScans, []);
  assert.ok(report.validations.historyWarnings.some((w: string) => w.includes("scan-20261115T163906Z") && w.includes("scan-20261020T000000Z")));
  assert.equal(report.objects.find((o: { objectKey: string }) => o.objectKey === KEYS.b).state, "observing");
});

test("arquivos parciais sem ponto de controle de gravação: falha definitiva (nunca viram oficiais)", async () => {
  const h = harness();
  h.db.fail.set("register", new Error("rede caiu"));
  const first = await h.run();
  // Simula uma gravação interrompida: apaga o ponto de controle "persisted" e mantém um arquivo.
  const lines = h.mem.files.get(checkpointFile(first.scanId))!.trim().split("\n").filter((l) => !l.includes('"persisted"'));
  h.mem.files.set(checkpointFile(first.scanId), lines.join("\n") + "\n");
  const resumed = await h.run({ resumeScanId: first.scanId });
  assert.equal(resumed.ok, false);
  assert.equal(resumed.runFailed, true);
  assert.match(resumed.reason!, /interrompida no meio/);
});

test("relatório alterado depois de gravado: falha definitiva antes de registrar", async () => {
  const h = harness();
  h.db.fail.set("register", new Error("rede caiu"));
  const first = await h.run();
  h.mem.files.set(`${first.scanId}/report.json`, h.mem.files.get(`${first.scanId}/report.json`)!.replace('"official": true', '"official": true '));
  const resumed = await h.run({ resumeScanId: first.scanId });
  assert.equal(resumed.ok, false);
  assert.equal(resumed.runFailed, true);
  assert.match(resumed.reason!, /mudou depois de gravado/);
  assert.equal(h.db.scans.size, 0);
});

test("recusa definitiva do banco na atestação: execução encerrada como falha", async () => {
  const h = harness();
  h.db.fail.set("attest", new Err("fontes", "23514", "storage_lifecycle: scan_sources_missing"));
  const r = await h.run();
  assert.equal(r.ok, false);
  assert.equal(r.runFailed, true);
  assert.equal(h.db.runs.get(r.scanId)!.status, "failed");
  assert.equal(h.db.synced.size, 0);
});

test("conferência final diverge: a varredura é invalidada (nunca vale como prova)", async () => {
  const h = harness();
  // A contagem de evidência lida na conferência vem com uma linha a menos que o relatório.
  const orig = h.db.evidence.get.bind(h.db.evidence);
  h.db.evidence.get = (k: string) => { const v = orig(k); return h.db.calls.at(-1) === "count" ? (v ?? 0) - 1 : v; };
  const first = await h.run();
  assert.equal(first.ok, false);
  assert.match(first.reason!, /linha\(s\) de evidência/);
  assert.equal(h.db.invalidated.has(first.scanId), true);
  assert.equal(steps(h.mem, first.scanId).at(-1), "invalidated");
});

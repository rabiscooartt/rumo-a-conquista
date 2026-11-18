// Etapa 4 — núcleo do modo de escrita, com uma API SIMULADA em memória (nada acessa rede ou banco).
// O fluxo real contra as funções SQL, com falhas e retomada, é testado no PostgreSQL 17 local.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { MOUSE_MANUAL_PROTECTIONS, protectionKey, runInitialSync, type LifecycleApi, type RunEvent } from "../../lib/images/lifecycle/syncRun.ts";
import { DEFAULT_PROTECTED_OBJECTS } from "../../lib/images/lifecycle/references.ts";
import { parseHistory } from "../../lib/images/lifecycle/history.ts";

test("as quatro proteções manuais são exatamente a lista do Mouse e têm justificativa explícita", () => {
  assert.deepEqual(MOUSE_MANUAL_PROTECTIONS.map((p) => p.objectKey).sort(), [...DEFAULT_PROTECTED_OBJECTS].sort());
  for (const p of MOUSE_MANUAL_PROTECTIONS) assert.match(p.reason, /^Arte correta da conquista ".+" de Mouse: P\.I\. for Hire/);
  assert.equal(protectionKey("scan-20261115T163906Z", DEFAULT_PROTECTED_OBJECTS[0]),
    `manual-protect:scan-20261115T163906Z:${DEFAULT_PROTECTED_OBJECTS[0]}`);
});

const DIR = ".image-report/lifecycle/scan-20261115T163906Z";
const real = existsSync(`${DIR}/report.json`);
function withConvention<T extends { sourceStatus: unknown[] }>(report: T): T {
  report.sourceStatus.push({ source: "convention", status: "complete", error: null, unparsed: 0 });
  return report;
}
function inputs() {
  const bytes = readFileSync(`${DIR}/report.json`);
  return {
    scanId: "scan-20261115T163906Z",
    // Relatório real anterior à fonte "convention": aqui ela entra como completa só para exercitar o fluxo
    // de sincronização (a recusa do relatório original está em imageLifecycleSyncPlan.test.mts).
    report: withConvention(JSON.parse(bytes.toString("utf8"))),
    reportSha256: createHash("sha256").update(bytes).digest("hex"),
    scanRecord: JSON.parse(readFileSync(`${DIR}/scan-record.json`, "utf8")),
    history: parseHistory(readFileSync(".image-report/lifecycle/history.jsonl", "utf8")),
    protectedObjects: DEFAULT_PROTECTED_OBJECTS,
    protections: MOUSE_MANUAL_PROTECTIONS,
    actor: "teste",
    now: () => new Date("2026-11-15T20:00:00Z"),
  };
}
function emptyApi(writes: string[]): LifecycleApi {
  return {
    readState: async () => ({ scans: [], objects: [], scanObjectRows: 0, logRows: 0, syncedScanIds: [], pendingOperations: 0 }),
    registerScan: async () => { writes.push("register"); return { status: "registered" }; },
    syncScan: async () => { writes.push("sync"); return { status: "synced" }; },
    setManualProtection: async () => { writes.push("protect"); return { status: "applied" }; },
    verifyChain: async () => [],
  };
}

test("dry-run anuncia as 6 operações na ordem e não escreve", { skip: !real }, async () => {
  const writes: string[] = [];
  const events: RunEvent[] = [];
  const r = await runInitialSync({ ...inputs(), mode: "dry-run", api: emptyApi(writes), log: (e) => events.push(e) });
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(writes, []);
  assert.deepEqual(events.filter((e) => e.kind === "planned").map((e) => (e as { step: string }).step.split(" ")[0]),
    ["register_scan", "sync_scan", "set_manual_protection", "set_manual_protection", "set_manual_protection", "set_manual_protection"]);
});

test("apply sem SHA aprovado, com SHA diferente ou com proteções sem justificativa: para antes de escrever", { skip: !real }, async () => {
  for (const extra of [
    { expectedReportSha256: undefined },
    { expectedReportSha256: "0".repeat(64) },
    { protections: MOUSE_MANUAL_PROTECTIONS.map((p, i) => (i === 0 ? { ...p, reason: "" } : p)) },
    { protections: MOUSE_MANUAL_PROTECTIONS.slice(1) },
  ]) {
    const writes: string[] = [];
    const base = inputs();
    const r = await runInitialSync({ ...base, expectedReportSha256: base.reportSha256, mode: "apply", api: emptyApi(writes), log: () => {}, ...extra });
    assert.equal(r.ok, false);
    assert.deepEqual(writes, [], JSON.stringify(Object.keys(extra)));
  }
});

test("apply para quando a função devolve resultado diferente da previsão", { skip: !real }, async () => {
  const writes: string[] = [];
  const api = emptyApi(writes);
  const state = { registered: false };
  api.readState = async () => ({
    scans: state.registered ? [{ scan_id: "scan-20261115T163906Z", completed_at: "2026-11-15T16:39:06.297Z", complete: true, inventory_status: "complete", image_objects: 46, image_bytes: 107782698, report_sha256: inputs().reportSha256 }] : [],
    objects: [], scanObjectRows: 0, logRows: state.registered ? 2 : 0, syncedScanIds: [], pendingOperations: 0,
  });
  api.registerScan = async () => { writes.push("register"); state.registered = true; return { status: "registered" }; };
  api.syncScan = async () => { writes.push("sync"); return { status: "synced", inserted: 45, updated: 0, overrides: 0, missing: 0, state_changes: 0, evidence_rows: 45 }; };
  const base = inputs();
  const r = await runInitialSync({ ...base, expectedReportSha256: base.reportSha256, mode: "apply", api, log: () => {} });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /diferente da previsão/);
  assert.deepEqual(writes, ["register", "sync"], "nenhuma proteção depois de um resultado inesperado");
});

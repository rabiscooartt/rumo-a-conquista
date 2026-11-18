// Etapa 4 — plano da sincronização inicial. Usa o relatório REAL da baseline quando existir
// (.image-report está fora do Git); os demais casos usam um relatório mínimo montado aqui.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { buildSyncPlan, splitObjectKey, type RemoteLifecycleState, type ScanReport, type ScanRecordFile } from "../../lib/images/lifecycle/syncPlan.ts";
import { parseHistory } from "../../lib/images/lifecycle/history.ts";
import { DEFAULT_PROTECTED_OBJECTS } from "../../lib/images/lifecycle/references.ts";

const EMPTY: RemoteLifecycleState = { scans: [], objects: [], scanObjectRows: 0, logRows: 0, syncedScanIds: [], pendingOperations: 0 };
const NOW = new Date("2026-11-15T20:00:00Z");
const SCAN = "scan-20261115T163906Z";
const AT = "2026-11-15T16:39:06.297Z";
const ART = "achievement-art/games/mouse-p-i-for-hire/achievements";
const SOURCES = ["achievements", "achievement_progress", "games", "journey_entries", "journey_history_events", "pointers", "drafts", "variant_map", "protection", "convention"]
  .map((source) => ({ source, status: "complete", error: null, unparsed: 0 }));

function ref(objectKey: string, source: string) {
  return { objectKey, source, location: `${source}:x` };
}
function fixture() {
  const objects = [
    { objectKey: `${ART}/01.png`, state: "referenced", size: 100, mimetype: "image/png", references: [ref(`${ART}/01.png`, "achievements"), ref(`${ART}/01.png`, "variant_map")] },
    ...DEFAULT_PROTECTED_OBJECTS.map((k) => ({ objectKey: k, state: "protected", size: 10, mimetype: "image/png", references: [ref(k, "protection")] })),
    { objectKey: `${ART}/34.png`, state: "observing", size: 7, mimetype: "image/png", references: [] },
    { objectKey: "site-banners/banners/reviews/background", state: "superseded", size: 5, mimetype: "image/png", references: [] },
    { objectKey: "site-banners/banners/reviews/background.0123456789abcdef.webp", state: "active", size: 3, mimetype: "image/webp", references: [] },
  ];
  const report: ScanReport = {
    scanId: SCAN, at: AT, existingBuckets: ["achievement-art", "site-banners"], evidenceComplete: true, blockers: [], issues: [], danglingReferences: [],
    byBucket: { "achievement-art": { images: 6, imageBytes: 147 }, "site-banners": { images: 2, imageBytes: 8 } },
    byState: { referenced: { count: 1, bytes: 100 }, protected: { count: 4, bytes: 40 }, observing: { count: 1, bytes: 7 }, superseded: { count: 1, bytes: 5 }, active: { count: 1, bytes: 3 } },
    sourceStatus: SOURCES.map((s) => ({ ...s })),
    validations: { inventoryComplete: true, allTablesRead: true, protectedOk: true, missingProtected: [], failuresTreatedAsAbsence: false },
    objects,
  };
  const record: ScanRecordFile = {
    scanId: SCAN, completedAt: AT, complete: true, inventoryStatus: "complete", imageObjects: objects.length,
    present: objects.map((o) => o.objectKey), unreferenced: objects.filter((o) => o.references.length === 0 && o.state !== "active").map((o) => o.objectKey),
  };
  const history = parseHistory(JSON.stringify({ scanId: SCAN, completedAt: AT, complete: true, unreferenced: [], present: [] }) + "\n");
  return { report, record, history };
}
const plan = (over: Partial<Parameters<typeof buildSyncPlan>[0]> = {}) => {
  const { report, record, history } = fixture();
  return buildSyncPlan({ scanId: SCAN, report, reportSha256: "a".repeat(64), scanRecord: record, history, remote: EMPTY, protectedObjects: DEFAULT_PROTECTED_OBJECTS, now: NOW, ...over });
};

test("plano válido: só inserções, sem hash de imagem, sem candidatos, proteções mantidas", () => {
  const p = plan();
  assert.equal(p.ready, true, p.blockers.join("; "));
  assert.equal(p.register?.action, "register");
  assert.equal(p.sync?.action, "sync");
  assert.deepEqual([p.counts.insert, p.counts.update, p.counts.preserve, p.counts.candidates, p.counts.overrides], [8, 0, 0, 0, 0]);
  assert.equal(p.counts.logRowsExpected, 4);
  assert.ok(p.sync!.objects.every((o) => !("sha256" in o)), "nenhum sha256 inventado");
  const protectedRows = p.sync!.objects.filter((o) => o.state === "protected");
  assert.equal(protectedRows.length, 4);
  assert.ok(protectedRows.every((o) => o.reference_count === 0 && o.protected_reason?.startsWith("lista de proteção")));
  assert.equal(p.sync!.objects.find((o) => o.path.endsWith("01.png"))!.reference_count, 2);
  const observing = p.predicted.find((o) => o.objectKey.endsWith("34.png"))!;
  assert.equal(observing.observingSinceScan, SCAN);
  assert.deepEqual(p.register!.payload, { scan_id: SCAN, completed_at: AT, complete: true, inventory_status: "complete", image_objects: 8, image_bytes: 155, report_sha256: "a".repeat(64) });
});

test("divergências do relatório bloqueiam a simulação", () => {
  const cases: [string, (f: ReturnType<typeof fixture>) => void, RegExp][] = [
    ["candidato", (f) => { f.report.objects[5].state = "candidate"; f.report.byState.candidate = { count: 1, bytes: 7 }; f.report.byState.observing.count = 0; }, /candidato/],
    ["fonte incompleta", (f) => { f.report.sourceStatus[3] = { ...f.report.sourceStatus[3], status: "failed", error: "x" }; }, /journey_entries incompleta/],
    ["fonte ausente", (f) => { f.report.sourceStatus = f.report.sourceStatus.filter((s) => s.source !== "journey_history_events"); }, /journey_history_events ausente/],
    ["evidência incompleta", (f) => { f.report.evidenceComplete = false; }, /evidência incompleta/],
    ["objeto a menos", (f) => { f.report.objects.pop(); }, /present|contagem/],
    ["proteção faltando", (f) => { f.report.objects[1].state = "referenced"; f.report.objects[1].references = [ref(f.report.objects[1].objectKey, "drafts")]; }, /protegidos|proteção/],
    ["observing com referência", (f) => { f.report.objects[5].references = [ref(f.report.objects[5].objectKey, "drafts")]; }, /observing com 1/],
    ["tamanho ausente", (f) => { f.report.objects[0].size = null; }, /tamanho/],
    ["data futura", (f) => { f.report.at = "2027-01-01T00:00:00.000Z"; f.record.completedAt = f.report.at; }, /futuro|histórico/],
  ];
  for (const [label, mutate, expected] of cases) {
    const f = fixture();
    mutate(f);
    const p = buildSyncPlan({ scanId: SCAN, report: f.report, reportSha256: "a".repeat(64), scanRecord: f.record, history: f.history, remote: EMPTY, protectedObjects: DEFAULT_PROTECTED_OBJECTS, now: NOW });
    assert.equal(p.ready, false, `${label} deveria bloquear`);
    assert.ok(p.blockers.some((b) => expected.test(b)), `${label}: ${p.blockers.join(" | ")}`);
  }
});

test("histórico: varredura invalidada ou ausente bloqueia", () => {
  const { history } = fixture();
  const invalid = parseHistory(JSON.stringify({ scanId: SCAN, completedAt: AT, complete: true, unreferenced: [], present: [] }) + "\n"
    + JSON.stringify({ type: "invalidation", scanId: SCAN, reason: "teste", at: AT }) + "\n");
  assert.match(plan({ history: invalid }).blockers.join(" "), /invalidada/);
  assert.match(plan({ history: parseHistory("") }).blockers.join(" "), /não é uma varredura válida/);
  { const ok = plan({ history }); assert.equal(ok.ready, true, ok.blockers.join("; ")); }
});

test("estado remoto: já registrada igual → idempotente; dados diferentes, pendências ou ordem → bloqueia", () => {
  const base = plan();
  const registered = { ...base.register!.payload };
  const same: RemoteLifecycleState = { ...EMPTY, scans: [{ ...registered, completed_at: AT }] };
  const p1 = plan({ remote: same });
  assert.equal(p1.ready, true, p1.blockers.join("; "));
  assert.equal(p1.register?.action, "already_registered");
  assert.equal(p1.counts.logRowsExpected, 2);

  const synced: RemoteLifecycleState = { ...same, syncedScanIds: [SCAN], objects: base.sync!.objects.map((o) => ({ bucket: o.bucket, object_path: o.path, state: o.state, manual_protection: false, archive_state: "none", reference_count: o.reference_count, observing_since: null, observing_since_scan_id: null, last_seen_scan_id: SCAN })) };
  const p2 = plan({ remote: synced });
  assert.equal(p2.ready, true, p2.blockers.join("; "));
  assert.deepEqual([p2.sync?.action, p2.counts.preserve, p2.counts.insert, p2.counts.logRowsExpected], ["already_synced", 8, 0, 0]);

  assert.match(plan({ remote: { ...EMPTY, scans: [{ ...registered, report_sha256: "b".repeat(64) }] } }).blockers.join(" "), /outros dados/);
  assert.match(plan({ remote: { ...EMPTY, pendingOperations: 1 } }).blockers.join(" "), /pendente/);
  assert.match(plan({ remote: { ...EMPTY, scans: [{ ...registered, scan_id: "scan-20261120T000000Z", completed_at: "2026-11-20T00:00:00Z" }], syncedScanIds: ["scan-20261120T000000Z"] } }).blockers.join(" "), /fora de ordem/);
  assert.match(plan({ remote: { ...EMPTY, scanObjectRows: 3 } }).blockers.join(" "), /sem nenhuma varredura/);
});

test("chaves de objeto: bucket e caminho seguem as mesmas regras do banco", () => {
  assert.deepEqual(splitObjectKey("site-banners/banners/home/background"), { bucket: "site-banners", path: "banners/home/background" });
  for (const bad of ["semcaminho", "/x/y.png", "a/../b.png", "B/x.png", "x//y.png"]) assert.equal(splitObjectKey(bad), null, bad);
});

const REAL = ".image-report/lifecycle/scan-20261115T163906Z";
// A baseline real é anterior à fonte "convention" (referências implícitas por nome): sincronizá-la
// de novo seria aceitar uma varredura que não olhou a convenção. O plano precisa recusar.
test("baseline real scan-20261115T163906Z (anterior à fonte convention): plano recusado por fonte ausente", { skip: !existsSync(`${REAL}/report.json`) }, () => {
  const bytes = readFileSync(`${REAL}/report.json`);
  const p = buildSyncPlan({
    scanId: SCAN,
    report: JSON.parse(bytes.toString("utf8")),
    reportSha256: createHash("sha256").update(bytes).digest("hex"),
    scanRecord: JSON.parse(readFileSync(`${REAL}/scan-record.json`, "utf8")),
    history: parseHistory(readFileSync(".image-report/lifecycle/history.jsonl", "utf8")),
    remote: EMPTY, protectedObjects: DEFAULT_PROTECTED_OBJECTS, now: NOW,
  });
  assert.equal(p.ready, false);
  assert.ok(p.blockers.some((b) => /fonte convention ausente/.test(b)), p.blockers.join("; "));
  assert.equal(p.counts.objects, 46);
  assert.deepEqual(p.counts.byState, { referenced: 32, protected: 4, observing: 4, superseded: 2, active: 4 });
});

test("modo incremental (varredura oficial seguinte): candidato vai ao banco; histórico precisa marcar oficial e versão; execução própria não é pendência, a de outra varredura bloqueia", () => {
  const { report, record } = fixture();
  const candidate = { ...report, objects: report.objects.map((o) => (o.objectKey === `${ART}/34.png` ? { ...o, state: "candidate" } : o)),
    byState: { ...report.byState, observing: { count: 0, bytes: 0 }, candidate: { count: 1, bytes: 7 } } };
  delete (candidate.byState as Record<string, unknown>).observing;
  const official = { ...record, official: true, policyVersion: 2 };
  const historyOf = (entry: Record<string, unknown>) => parseHistory(JSON.stringify({ scanId: SCAN, completedAt: AT, complete: true, unreferenced: [], present: [], ...entry }) + "\n");
  const base = { report: candidate, scanRecord: official, history: historyOf({ official: true, policyVersion: 2 }), mode: "incremental" as const, policyVersion: 2 };
  const ok = plan({ ...base, remote: { ...EMPTY, pendingOperations: 1, pendingRunScanIds: [SCAN] } });
  assert.equal(ok.ready, true, ok.blockers.join("; "));
  assert.equal(ok.predicted.find((p) => p.objectKey === `${ART}/34.png`)!.applied, "candidate");
  assert.equal(plan({ report: candidate }).ready, false, "na carga inicial, candidato continua proibido");
  const notOfficial = plan({ ...base, history: historyOf({}) });
  assert.ok(notOfficial.blockers.some((b) => /oficial da política v2/.test(b)));
  const otherVersion = plan({ ...base, scanRecord: { ...official, policyVersion: 1 } });
  assert.ok(otherVersion.blockers.some((b) => /scan-record\.json não marca/.test(b)));
  const otherRun = plan({ ...base, remote: { ...EMPTY, pendingOperations: 2, pendingRunScanIds: [SCAN, "scan-20261116T000000Z"] } });
  assert.ok(otherRun.blockers.some((b) => /outra varredura: scan-20261116T000000Z/.test(b)));
  assert.ok(otherRun.blockers.some((b) => /1 operação\(ões\) pendente/.test(b)));
});

// Prova de elegibilidade no TypeScript: mesmos casos aplicados ao banco pelo executor local.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, tsEvidenceFor } from "../fixtures/lifecycleEligibilityCases.mts";
import { classifyImages, type InventorySnapshot } from "../../lib/images/lifecycle/classify.ts";
import { effectiveHistory, parseHistory } from "../../lib/images/lifecycle/history.ts";
import { referencesFromProtectionList, referencesFromVariantMap, type SourceResult } from "../../lib/images/lifecycle/references.ts";

test("casos de elegibilidade: mesmo veredito e motivo esperados para o banco", () => {
  for (const item of fixture.cases) {
    for (const [path, [eligible, reason]] of Object.entries(item.expected)) {
      const evidence = tsEvidenceFor(item, fixture.bucket, path, new Date().toISOString());
      assert.equal(evidence.eligible, eligible, `${item.name} / ${path}: ${JSON.stringify(evidence)}`);
      assert.equal(evidence.reason, reason, `${item.name} / ${path}`);
    }
  }
});

const KEY = "game-images/achievements/x.png";
const inventory: InventorySnapshot = { status: "complete", failedPrefixes: [], objects: [{ bucket: "game-images", path: "achievements/x.png", size: 1, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }] };
const sources = (): SourceResult[] => [
  ...["achievements", "achievement_progress", "games", "journey_entries", "journey_history_events", "pointers", "drafts", "convention"].map((source) => ({ source, status: "complete", references: [] }) as unknown as SourceResult),
  referencesFromVariantMap({}),
  referencesFromProtectionList(),
];
const old = (scanId: string, completedAt: string, extra: object = {}) => ({ scanId, completedAt, complete: true, unreferenced: [KEY], present: [KEY], ...extra });

test("classificador: candidato só com prova; marcado como preliminar", () => {
  const report = classifyImages(inventory, sources(), { now: new Date("2026-09-01T00:00:00Z"), history: [old("scan-20260701T000000Z", "2026-07-01T00:00:00Z")] });
  assert.equal(report.preliminary, true);
  assert.equal(report.objects[0].state, "candidate");
  assert.equal(report.objects[0].evidence?.eligible, true);
  assert.match(report.objects[0].reasons[0], /^preliminar: .*confirmação pelo banco$/);
  assert.deepEqual(report.scanRecord.present, [KEY], "o registro novo guarda quem estava presente");
});

test("classificador: proteção manual prevalece sobre tudo", () => {
  const report = classifyImages(inventory, sources(), {
    now: new Date("2026-09-01T00:00:00Z"),
    history: [old("scan-20260701T000000Z", "2026-07-01T00:00:00Z")],
    manualProtections: { [KEY]: "em revisão" },
  });
  assert.equal(report.objects[0].state, "protected");
  assert.equal(report.scanRecord.unreferenced.includes(KEY), false, "protegido não conta como sem referência");
});

test("classificador: proteção manual removida dentro da janela impede a prova", () => {
  const report = classifyImages(inventory, sources(), {
    now: new Date("2026-09-01T00:00:00Z"),
    history: [old("scan-20260701T000000Z", "2026-07-01T00:00:00Z")],
    manualUnprotectedAt: { [KEY]: "2026-08-01T00:00:00Z" },
  });
  assert.equal(report.objects[0].state, "observing");
  assert.match(report.objects[0].reasons[0], /proteção manual removida/);
});

test("classificador: histórico com linha ilegível não dá prova a ninguém", () => {
  const text = [JSON.stringify(old("scan-20260701T000000Z", "2026-07-01T00:00:00Z")), "{quebrado"].join("\n");
  const { history } = effectiveHistory(parseHistory(text));
  const report = classifyImages(inventory, sources(), { now: new Date("2026-09-01T00:00:00Z"), history });
  assert.equal(report.objects[0].state, "observing");
  assert.equal(report.objects[0].evidence?.reason, "menos de duas varreduras completas e válidas sem referência");
});

test("classificador: varredura invalidada no histórico não conta", () => {
  const text = [JSON.stringify(old("scan-20260701T000000Z", "2026-07-01T00:00:00Z")),
    JSON.stringify({ type: "invalidation", scanId: "scan-20260701T000000Z", reason: "teste", at: "2026-08-01T00:00:00Z" })].join("\n");
  const { history } = effectiveHistory(parseHistory(text));
  const report = classifyImages(inventory, sources(), { now: new Date("2026-09-01T00:00:00Z"), history });
  assert.equal(report.objects[0].state, "observing");
});

test("classificador: registro antigo sem lista de presença continua aceito", () => {
  const legacy = { scanId: "scan-20260701T000000Z", completedAt: "2026-07-01T00:00:00Z", complete: true, unreferenced: [KEY] };
  const report = classifyImages(inventory, sources(), { now: new Date("2026-09-01T00:00:00Z"), history: [legacy] });
  assert.equal(report.objects[0].state, "candidate");
});

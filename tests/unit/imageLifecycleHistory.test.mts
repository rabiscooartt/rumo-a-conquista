// Histórico append-only e invalidação de varreduras como baseline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInvalidation, effectiveHistory, parseHistory } from "../../lib/images/lifecycle/history.ts";
import { classifyImages, type InventorySnapshot } from "../../lib/images/lifecycle/classify.ts";
import { referencesFromProtectionList, referencesFromVariantMap, type SourceResult } from "../../lib/images/lifecycle/references.ts";

const KEY = "achievement-art/games/x/achievements/99-sobra.png";
const scanLine = (scanId: string, completedAt: string, unreferenced = [KEY]) => JSON.stringify({ scanId, completedAt, complete: true, unreferenced });
const invalidation = (scanId: string) => JSON.stringify({ type: "invalidation", scanId, reason: "não contemplou o bucket game-images", at: "2026-11-14T23:00:00Z" });

const inventory: InventorySnapshot = { status: "complete", failedPrefixes: [], objects: [{ bucket: "achievement-art", path: "games/x/achievements/99-sobra.png", size: 10, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }] };
const sources = (): SourceResult[] => [
  ...["achievements", "achievement_progress", "games", "journey_entries", "journey_history_events", "pointers", "drafts"].map((source) => ({ source, status: "complete", references: [] }) as unknown as SourceResult),
  referencesFromVariantMap({}),
  referencesFromProtectionList(),
];

test("linhas antigas sem type são varreduras; invalidação é lida à parte", () => {
  const parsed = parseHistory([scanLine("a", "2026-10-01T00:00:00Z"), invalidation("a"), ""].join("\n"));
  assert.equal(parsed.scans.length, 1);
  assert.equal(parsed.invalidations.length, 1);
  assert.equal(parsed.unreadableLines, 0);
});

test("varredura invalidada não vale como evidência: nada vira candidato por ela", () => {
  const text = [scanLine("a", "2026-10-01T00:00:00Z"), invalidation("a")].join("\n");
  const { history, warnings } = effectiveHistory(parseHistory(text));
  assert.equal(history[0].complete, false);
  assert.equal(warnings.length, 1);
  const report = classifyImages(inventory, sources(), { now: new Date("2026-12-31T00:00:00Z"), history });
  assert.notEqual(report.objects[0].state, "candidate");

  // Controle: sem a invalidação, a mesma varredura antiga leva a candidato.
  const control = classifyImages(inventory, sources(), { now: new Date("2026-12-31T00:00:00Z"), history: effectiveHistory(parseHistory(scanLine("a", "2026-10-01T00:00:00Z"))).history });
  assert.equal(control.objects[0].state, "candidate");
});

test("o registro original continua no histórico (append-only)", () => {
  const original = scanLine("a", "2026-10-01T00:00:00Z");
  const parsed = parseHistory(original);
  const entry = buildInvalidation(parsed, "a", " não contemplou o bucket game-images ", new Date("2026-11-14T23:00:00Z"));
  const after = parseHistory(`${original}\n${JSON.stringify(entry)}\n`);
  assert.deepEqual(after.scans, parsed.scans);
  assert.equal(entry.reason, "não contemplou o bucket game-images");
});

test("invalidação recusa varredura inexistente, repetida ou sem motivo", () => {
  const parsed = parseHistory([scanLine("a", "2026-10-01T00:00:00Z"), invalidation("a")].join("\n"));
  assert.throws(() => buildInvalidation(parsed, "zzz", "motivo", new Date()));
  assert.throws(() => buildInvalidation(parsed, "a", "motivo", new Date()));
  assert.throws(() => buildInvalidation(parseHistory(scanLine("b", "2026-10-01T00:00:00Z")), "b", "   ", new Date()));
});

test("linha ilegível no histórico: nenhuma varredura anterior conta (falha fechada)", () => {
  const { history, warnings } = effectiveHistory(parseHistory([scanLine("a", "2026-10-01T00:00:00Z"), "{quebrado"].join("\n")));
  assert.equal(history.length, 0);
  assert.equal(warnings.length, 1);
});

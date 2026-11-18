// Política versionada de varredura: lista de fontes do TypeScript = lista da migração 20261119;
// atestação só com relatório completo e com todas as fontes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { attestableSources, attestScan, buildSourceManifest, evidenceMeetsPolicy, SCAN_POLICY_SOURCES, SCAN_POLICY_VERSION } from "../../lib/images/lifecycle/scanPolicy.ts";
import { REFERENCE_SOURCES, type SourceResult } from "../../lib/images/lifecycle/references.ts";
import { REQUIRED_SOURCES } from "../../lib/images/lifecycle/syncPlan.ts";

test("versão e fontes iguais às da migração 20261119 (e às exigidas pela classificação e pela sincronização)", () => {
  const sql = readFileSync("supabase/migrations/20261119_storage_lifecycle_scan_policy.sql", "utf8");
  const m = sql.match(/insert into public\.storage_lifecycle_scan_policies[^;]*?\(\s*(\d+),\s*array\[([^\]]+)\]/);
  assert.ok(m, "política inserida pela migração");
  assert.equal(Number(m[1]), SCAN_POLICY_VERSION);
  const sqlSources = [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
  assert.deepEqual(sqlSources, [...SCAN_POLICY_SOURCES].sort());
  assert.deepEqual([...REFERENCE_SOURCES].sort(), sqlSources);
  assert.deepEqual([...REQUIRED_SOURCES].sort(), sqlSources);
});

const complete = (extra: Record<string, unknown> = {}) => SCAN_POLICY_SOURCES.map((source) => ({ source, status: "complete", error: null, unparsed: 0, ...extra }));

test("atestação exige relatório completo e todas as fontes da política", () => {
  assert.deepEqual(attestableSources(complete()), [...SCAN_POLICY_SOURCES].sort());
  assert.throws(() => attestableSources(complete().filter((s) => s.source !== "convention")), /sem a\(s\) fonte\(s\) exigida\(s\).*convention/);
  const partial = complete();
  partial[3] = { ...partial[3], status: "partial" };
  assert.throws(() => attestableSources(partial), /incompleta/);
  const unparsed = complete();
  unparsed[0] = { ...unparsed[0], unparsed: 2 };
  assert.throws(() => attestableSources(unparsed), /incompleta/);
});

const sourceResults = () => SCAN_POLICY_SOURCES.map((source, i) => ({
  source, status: "complete" as const,
  references: Array.from({ length: i }, (_, n) => ({ objectKey: `achievement-art/x/${source}-${n}.webp`, source, location: `${source}:${n}`, raw: "r" })),
})) as SourceResult[];

test("manifesto: uma entrada por fonte, ordenada, com contagem e resumo estável; incompleta, ausente ou repetida é recusada", () => {
  const manifest = buildSourceManifest(sourceResults());
  assert.deepEqual(manifest.map((m) => m.source), [...SCAN_POLICY_SOURCES].sort());
  assert.ok(manifest.every((m) => m.status === "complete" && /^[0-9a-f]{64}$/.test(m.digest)));
  assert.equal(manifest.find((m) => m.source === SCAN_POLICY_SOURCES[3])!.references, 3);
  const reversed = sourceResults().map((s) => ({ ...s, references: [...s.references].reverse() })).reverse();
  assert.deepEqual(buildSourceManifest(reversed), manifest, "a ordem da coleta não muda o manifesto");
  const changed = sourceResults();
  changed[4].references[0] = { ...changed[4].references[0], location: "outro" };
  assert.notDeepEqual(buildSourceManifest(changed), manifest, "qualquer referência diferente muda o resumo");
  const partial = sourceResults();
  partial[2] = { ...partial[2], status: "partial" };
  assert.throws(() => buildSourceManifest(partial), /incompleta/);
  assert.throws(() => buildSourceManifest(sourceResults().filter((s) => s.source !== "convention")), /convention/);
  assert.throws(() => buildSourceManifest([...sourceResults(), sourceResults()[0]]), /repetida/);
});

test("attestScan envia a versão vigente e o manifesto; manifesto sem fonte não chega ao banco", async () => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const rpc = async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { status: "attested" }; };
  const manifest = buildSourceManifest(sourceResults());
  await attestScan({ rpc, scanId: "scan-20261201T000000Z", reportSha256: "a".repeat(64), manifest, actor: "t" });
  assert.equal(calls[0].fn, "storage_lifecycle_attest_scan");
  assert.equal(calls[0].args.p_policy_version, SCAN_POLICY_VERSION);
  assert.deepEqual(calls[0].args.p_manifest, manifest);
  assert.equal("p_sources" in calls[0].args, false);
  await assert.rejects(attestScan({ rpc, scanId: "x", reportSha256: "a", manifest: manifest.slice(1), actor: "t" }));
  assert.equal(calls.length, 1);
});

test("prova só vale com eligible e policy_version vigente", () => {
  assert.equal(evidenceMeetsPolicy({ eligible: true, policy_version: SCAN_POLICY_VERSION }), true);
  assert.equal(evidenceMeetsPolicy({ eligible: true }), false);
  assert.equal(evidenceMeetsPolicy({ eligible: true, policy_version: 1 }), false);
  assert.equal(evidenceMeetsPolicy({ eligible: false, policy_version: SCAN_POLICY_VERSION }), false);
});

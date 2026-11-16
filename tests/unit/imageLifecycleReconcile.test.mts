// Reconciliação: decisões por evidência, com dependências SIMULADAS (sem rede nem banco).
import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcilePending, type PendingOperation, type ReconcileDeps } from "../../lib/images/lifecycle/reconcile.ts";

const NOW = new Date("2026-11-16T22:00:00Z");
const OLD = "2026-11-16T20:00:00Z";
const SHA = "a".repeat(64);
const op = (operation: string, details: Record<string, unknown>, extra: Partial<PendingOperation> = {}): PendingOperation => ({
  operation_id: `${operation}-${Math.random().toString(16).slice(2, 8)}`, operation, bucket: "site-banners", object_path: "banners/home/background.aaaaaaaaaaaaaaaa.webp",
  started_at: OLD, details, ...extra,
});
function deps(pending: PendingOperation[], over: Partial<ReconcileDeps> = {}): ReconcileDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    listPending: async () => pending,
    storageInfo: async () => ({ status: "not_found" }),
    readPointer: async () => ({ state: "absent" }),
    replaceStatuses: async () => [],
    rpc: async (fn, args) => { calls.push(`${fn}:${String(args.p_result ?? "")}`); return { status: "ok" }; },
    ...over,
  };
}
const run = (d: ReconcileDeps, mode: "dry-run" | "apply" = "apply", minAgeMinutes = 30) => reconcilePending({ deps: d, mode, actor: "teste", now: NOW, minAgeMinutes });

test("envio: arquivo ausente → falha; mesmo SHA e tamanho → concluído; sem metadados, outro SHA ou erro → pendente", async () => {
  const cases: [Parameters<ReconcileDeps["storageInfo"]> extends never ? never : Awaited<ReturnType<ReconcileDeps["storageInfo"]>>, string][] = [
    [{ status: "not_found" }, "failed"],
    [{ status: "found", size: 10, contentType: "image/webp", metadata: { sha256: SHA } }, "succeeded"],
    [{ status: "found", size: 10, contentType: "image/webp", metadata: {} }, "keep_pending"],
    [{ status: "found", size: 10, contentType: "image/webp", metadata: { sha256: "b".repeat(64) } }, "keep_pending"],
    [{ status: "found", size: 11, contentType: "image/webp", metadata: { sha256: SHA } }, "keep_pending"],
    [{ status: "error", message: "rede" }, "keep_pending"],
  ];
  for (const [info, expected] of cases) {
    const d = deps([op("object_upload", { sha256: SHA, size: 10 })], { storageInfo: async () => info });
    const r = await run(d);
    assert.equal(r.decisions[0].decision, expected, JSON.stringify(info));
    assert.equal(d.calls.length, expected === "keep_pending" ? 0 : 1, "só resultados comprovados chegam ao banco");
  }
});

test("ponteiro: releitura decide; terceiro arquivo ou ilegível → pendente", async () => {
  const details = { pointer: "banner-home", pointer_file: "novo.webp", previous_file: "antigo.webp" };
  for (const [read, expected] of [
    [{ state: "present", file: "novo.webp" }, "succeeded"],
    [{ state: "present", file: "antigo.webp" }, "failed"],
    [{ state: "present", file: "outro.webp" }, "keep_pending"],
    [{ state: "unreadable", reason: "500" }, "keep_pending"],
  ] as const) {
    const d = deps([op("pointer_activate", details)], { readPointer: async () => read });
    assert.equal((await run(d)).decisions[0].decision, expected);
  }
  const firstActivation = deps([op("pointer_activate", { ...details, previous_file: null })], { readPointer: async () => ({ state: "absent" }) });
  assert.equal((await run(firstActivation)).decisions[0].decision, "failed", "sem ponteiro e sem anterior: a ativação não aconteceu");
});

test("lote: só conclui com todas as trocas bem-sucedidas e com o mesmo valor novo", async () => {
  const items = [{ key: "k1", new_value: "u1" }, { key: "k2", new_value: "u2" }];
  const all = deps([op("reference_batch", { items }, { bucket: null, object_path: null })], {
    replaceStatuses: async () => [{ key: "k1", newValue: "u1", result: "succeeded" }, { key: "k2", newValue: "u2", result: "succeeded" }],
  });
  const r1 = await run(all);
  assert.equal(r1.decisions[0].decision, "finish_batch");
  assert.deepEqual(all.calls, ["storage_lifecycle_finish_reference_batch:"]);
  const partial = deps([op("reference_batch", { items }, { bucket: null, object_path: null })], {
    replaceStatuses: async () => [{ key: "k1", newValue: "u1", result: "succeeded" }, { key: "k2", newValue: "OUTRO", result: "succeeded" }],
  });
  assert.equal((await run(partial)).decisions[0].decision, "keep_pending");
  assert.equal(partial.calls.length, 0);
});

test("recentes ficam de fora; arquivamento nunca é resolvido; simulação não escreve; erro do banco é contado", async () => {
  const recent = deps([op("object_upload", { sha256: SHA, size: 10 }, { started_at: "2026-11-16T21:50:00Z" })]);
  assert.equal((await run(recent)).decisions[0].decision, "too_recent");
  const archive = deps([op("archive_copy", {})]);
  assert.equal((await run(archive)).decisions[0].decision, "keep_pending");
  const dry = deps([op("object_upload", { sha256: SHA, size: 10 })]);
  const r = await run(dry, "dry-run");
  assert.equal(r.decisions[0].decision, "failed");
  assert.equal(dry.calls.length, 0);
  const failing = deps([op("object_upload", { sha256: SHA, size: 10 })], { rpc: async () => { throw Object.assign(new Error("evidência"), { code: "22023" }); } });
  const rf = await run(failing);
  assert.equal(rf.errors, 1);
  assert.deepEqual(rf.decisions[0].applied, { error: "evidência", code: "22023" });
});

// Executor de arquivamento (Etapa 5.2): plano por estado, barreira técnica da simulação e retomada.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planArchive, readOnlyDeps, readOnlyFetch, runArchive, resumePending, WriteBlockedError, type InventoryRow,
} from "../../lib/images/lifecycle/archiveRunner.ts";
import type { ArchiveDeps } from "../../lib/images/lifecycle/archive.ts";

const row = (state: string, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  bucket: "achievement-art", object_path: `${state}.png`, state, archive_state: "none", sha256: "a".repeat(64), size_bytes: 10,
  mimetype: "image/png", archive_bucket: null, archive_path: null, archive_sha256: null, restore_metadata: null,
  manual_protection: false, reference_count: 0, ...extra,
});

test("plano: só candidate/superseded com prova; cada estado com o seu motivo (sem confundir)", () => {
  const rows = ["unverified", "observing", "superseded", "candidate", "active", "referenced", "protected"].map((s) => row(s));
  rows.push(row("superseded", { object_path: "sem-prova.png" }));
  rows.push(row("superseded", { object_path: "protegido.png", manual_protection: true }));
  rows.push(row("superseded", { object_path: "com-ref.png", reference_count: 2 }));
  rows.push(row("superseded", { object_path: "arquivado.png", archive_state: "archived" }));
  const evidence = new Map([
    ["achievement-art/superseded.png", { eligible: true }], ["achievement-art/candidate.png", { eligible: true }],
    ["achievement-art/sem-prova.png", { eligible: false, reason: "só uma varredura" }],
    // prova "elegível" para estados que NÃO podem ser arquivados: o plano ignora a prova
    ["achievement-art/unverified.png", { eligible: true }], ["achievement-art/observing.png", { eligible: true }],
  ]);
  const plan = Object.fromEntries(planArchive(rows, evidence).map((e) => [e.path, e]));
  assert.deepEqual(Object.values(plan).filter((e) => e.eligible).map((e) => e.path).sort(), ["candidate.png", "superseded.png"]);
  assert.match(plan["unverified.png"].reason, /^unverified:/);
  assert.match(plan["observing.png"].reason, /^observing:/);
  assert.match(plan["sem-prova.png"].reason, /sem prova vigente: só uma varredura/);
  assert.equal(plan["protegido.png"].reason, "proteção manual");
  assert.equal(plan["com-ref.png"].reason, "referenciado (2)");
  assert.equal(plan["arquivado.png"].reason, "já em archived");
});

function fakeDeps() {
  const writes: string[] = [];
  const deps: ArchiveDeps = {
    rpc: async (fn) => { writes.push(`rpc:${fn}`); return { status: "started", operation_id: "op" }; },
    readObject: async () => ({ ...row("superseded") }),
    storage: {
      download: async () => new Uint8Array(10),
      info: async () => ({ size: 10, contentType: "image/png", metadata: null }),
      upload: async (b, p) => { writes.push(`upload:${b}/${p}`); return "created"; },
      remove: async (b, p) => { writes.push(`remove:${b}/${p}`); },
    },
  };
  return { deps, writes };
}

test("simulação: RPC de escrita, upload e remoção são barrados antes de acontecer", async () => {
  const { deps, writes } = fakeDeps();
  const ro = readOnlyDeps(deps);
  await assert.rejects(ro.rpc("storage_lifecycle_begin_operation", {}), WriteBlockedError);
  await assert.rejects(ro.storage.upload("b", "p", new Uint8Array(1), { contentType: "x", cacheControl: "1", metadata: {} }), WriteBlockedError);
  await assert.rejects(ro.storage.remove("b", "p"), WriteBlockedError);
  await ro.rpc("storage_lifecycle_evidence", {});
  assert.deepEqual(writes, ["rpc:storage_lifecycle_evidence"]);
});

test("simulação do executor: confere o original sem nenhuma escrita", async () => {
  const { deps, writes } = fakeDeps();
  const plan = planArchive([row("superseded")], new Map([["achievement-art/superseded.png", { eligible: true }]]));
  const out = await runArchive({ deps, mode: "dry-run", targets: ["achievement-art/superseded.png", "achievement-art/outro.png"], plan, actor: "t", reason: "r" });
  assert.deepEqual(out.map((r) => r.status), ["seria_arquivado", "fora_do_inventario"]);
  assert.deepEqual(writes, []);
  const resumed = await resumePending({ deps, mode: "dry-run", actor: "t", reason: "r",
    pending: [{ operation_id: "x", operation: "archive_copy", bucket: "achievement-art", object_path: "a.png" }, { operation_id: "y", operation: "delete_object", bucket: "achievement-art", object_path: "b.png" }] });
  assert.deepEqual(resumed.map((r) => r.status), ["seria_retomado (archive_copy)", "pendente"]);
  assert.deepEqual(writes, []);
});

test("alvo não elegível não é tocado nem no modo de escrita", async () => {
  const { deps, writes } = fakeDeps();
  const plan = planArchive([row("observing")], new Map());
  const out = await runArchive({ deps, mode: "apply", targets: ["achievement-art/observing.png"], plan, actor: "t", reason: "r" });
  assert.equal(out[0].status, "nao_elegivel");
  assert.deepEqual(writes, []);
});

test("fetch da simulação: só leituras saem; escritas são recusadas sem envio", async () => {
  const sent: string[] = [];
  const base = (async (input: RequestInfo | URL, init?: RequestInit) => { sent.push(`${init?.method ?? "GET"} ${String(input)}`); return new Response("[]"); }) as typeof fetch;
  const guarded = readOnlyFetch(base);
  const host = "http://127.0.0.1:1";
  await guarded(`${host}/rest/v1/storage_object_lifecycle?select=*`);
  await guarded(`${host}/storage/v1/object/list/achievement-art`, { method: "POST" });
  await guarded(`${host}/rest/v1/rpc/storage_lifecycle_evidence`, { method: "POST" });
  for (const [path, method] of [["/rest/v1/rpc/storage_lifecycle_begin_operation", "POST"], ["/storage/v1/object/image-archive/x.png", "POST"],
    ["/storage/v1/object/achievement-art", "DELETE"], ["/rest/v1/games?slug=eq.x", "PATCH"], ["/storage/v1/bucket", "POST"], ["/storage/v1/object/a/b", "PUT"]]) {
    await assert.rejects(guarded(`${host}${path}`, { method }), WriteBlockedError, `${method} ${path}`);
  }
  assert.equal(sent.length, 3);
});

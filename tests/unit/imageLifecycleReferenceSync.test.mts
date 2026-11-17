// Auditoria dos salvamentos em massa (Etapa 5.1): plano → estado desejado → diferença → intenção →
// gravação → confirmação pela releitura. Aqui só a lógica pura e a orquestração (rpc simulado).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyWritePlan, auditedGameSave, diffGameScope, referenceSyncBaseKey, ReferenceSyncPendingError,
  REFERENCE_SYNC_CHUNK, type GameScopeState,
} from "../../lib/images/lifecycle/referenceSync.ts";
import { lifecycleErrorResponse, SAVE_RECONCILE_HINT } from "../../lib/images/lifecycle/httpErrors.ts";

const URL = (path: string) => `https://abc.supabase.co/storage/v1/object/public/achievement-art/${path}`;
const before: GameScopeState = {
  slug: "jogo",
  game: {
    image: URL("games/jogo/banner.webp"), card_image: "/images/local.jpg",
    final_badge: { title: "Maestria", image: URL("games/jogo/maestria.webp") },
    emblem: null, trophies: [{ icon: URL("games/jogo/t0.webp") }], review: { texto: "sem imagens" },
  },
  achievements: [
    { id: "a1", legacy_id: "l1", image: URL("games/jogo/achievements/1.webp"), official_image: null },
    { id: "a2", legacy_id: "l2", image: URL("games/jogo/achievements/2.webp"), official_image: null },
  ],
  progress: [
    { achievement_id: "a1", owner_key: "default", image_override: URL("games/jogo/achievements/1.webp") },
    { achievement_id: "a2", owner_key: "outro", image_override: null },
  ],
};

test("sem alteração de imagem: nenhuma diferença (campos não-imagem não entram)", () => {
  const desired = applyWritePlan(before, {
    game: { image: before.game!.image, final_badge: { title: "Outro título", image: URL("games/jogo/maestria.webp") } },
    upsertAchievements: [{ legacy_id: "l1", image: URL("games/jogo/achievements/1.webp") }],
  });
  assert.deepEqual(diffGameScope(before, desired), []);
});

test("uma referência alterada: local exato, valor anterior e novo", () => {
  const desired = applyWritePlan(before, { game: { image: URL("games/jogo/banner-2.webp") } });
  assert.deepEqual(diffGameScope(before, desired), [{
    table: "games", column: "image", row: { slug: "jogo" }, path: null,
    old: URL("games/jogo/banner.webp"), new: URL("games/jogo/banner-2.webp"),
  }]);
});

test("múltiplas: JSON por caminho, conquista nova, removida e progresso por legacy_id", () => {
  const desired = applyWritePlan(before, {
    game: { trophies: [{ icon: URL("games/jogo/t0-b.webp") }, { icon: URL("games/jogo/t1.webp") }] },
    deleteAchievementIds: ["a2"],
    upsertAchievements: [{ legacy_id: "l3", image: URL("games/jogo/achievements/3.webp"), official_image: null }],
    upsertProgress: [{ legacy_id: "l3", owner_key: "default", image_override: URL("games/jogo/achievements/3.webp") }],
  });
  const items = diffGameScope(before, desired);
  const where = items.map((i) => `${i.table}.${i.column}${i.path ? `[${i.path.join(".")}]` : ""}:${JSON.stringify(i.row)}:${i.old ? "x" : "∅"}→${i.new ? "x" : "∅"}`);
  assert.deepEqual(where.sort(), [
    `achievement_progress.image_override:{"owner_key":"default","game_slug":"jogo","legacy_id":"l3"}:∅→x`,
    `achievements.image:{"game_slug":"jogo","legacy_id":"l2"}:x→∅`,
    `achievements.image:{"game_slug":"jogo","legacy_id":"l3"}:∅→x`,
    `games.trophies[0.icon]:{"slug":"jogo"}:x→x`,
    `games.trophies[1.icon]:{"slug":"jogo"}:∅→x`,
  ].sort());
});

test("troca para caminho local ou URL externa entra (sai do Storage); entre locais não entra", () => {
  const desired = applyWritePlan(before, { game: { image: "/images/novo.jpg", card_image: "/images/outro.jpg" } });
  const items = diffGameScope(before, desired);
  assert.deepEqual(items.map((i) => [i.column, i.new]), [["image", "/images/novo.jpg"]]);
});

test("referência ao Storage inválida entra na diferença para o banco recusar", () => {
  const bad = "https://abc.supabase.co/storage/v1/object/public/achievement-art/../x.webp";
  const items = diffGameScope(before, applyWritePlan(before, { game: { image: bad } }));
  assert.equal(items.length, 1);
  assert.equal(items[0].new, bad);
});

test("chave-base: depende só do estado desejado das referências", () => {
  const a = applyWritePlan(before, { game: { image: URL("games/jogo/b2.webp") } });
  const b = applyWritePlan(before, { game: { image: URL("games/jogo/b2.webp"), final_badge: { title: "x", image: URL("games/jogo/maestria.webp") } } });
  assert.equal(referenceSyncBaseKey(a), referenceSyncBaseKey(b));
  assert.match(referenceSyncBaseKey(a), /^refsync:[0-9a-f]{64}$/);
  assert.notEqual(referenceSyncBaseKey(a), referenceSyncBaseKey(before));
});

type Call = { fn: string; args: Record<string, unknown> };
function fakeRpc(handler: (call: Call) => Record<string, unknown>) {
  const calls: Call[] = [];
  return { calls, rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return handler({ fn, args }); } };
}
const readScope = async () => structuredClone(before);

test("orquestração: intenção antes, gravação, confirmação depois", async () => {
  const order: string[] = [];
  const { rpc, calls } = fakeRpc(({ fn }) => {
    order.push(fn);
    return fn.includes("begin") ? { status: "started", operation_id: "op1", items: [1] } : { status: "succeeded" };
  });
  const out = await auditedGameSave({ rpc, client: null, slug: "jogo", actor: "admin:t", reason: "teste", readScope,
    plan: { game: { image: URL("games/jogo/b2.webp") } }, write: async () => { order.push("write"); return 7; } });
  assert.deepEqual(order, ["storage_lifecycle_begin_reference_sync", "write", "storage_lifecycle_finish_reference_sync"]);
  assert.equal(out.result, 7);
  assert.equal(calls[1].args.p_mode, "verify");
  assert.deepEqual(out.audit, { items: 1, operations: ["op1"], status: "succeeded" });
});

test("sem diferença: begin só confere pendências; nada a confirmar", async () => {
  const { rpc, calls } = fakeRpc(() => ({ status: "nothing", resumable: [] }));
  const out = await auditedGameSave({ rpc, client: null, slug: "jogo", actor: "admin:t", reason: "teste", readScope,
    plan: {}, write: async () => "ok" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.p_items, []);
  assert.equal(out.audit.status, "nothing");
});

test("falha na gravação: settle e o erro original volta (nada gravado = falha registrada pelo banco)", async () => {
  const { rpc, calls } = fakeRpc(({ fn }) => (fn.includes("begin") ? { status: "started", operation_id: "op1", items: [1] } : { status: "failed" }));
  await assert.rejects(auditedGameSave({ rpc, client: null, slug: "jogo", actor: "a", reason: "r", readScope,
    plan: { game: { image: URL("x/y.webp") } }, write: async () => { throw new Error("gravação recusada"); } }), /gravação recusada/);
  assert.equal(calls[1].args.p_mode, "settle");
});

test("confirmação sem prova: ReferenceSyncPendingError (502, pending)", async () => {
  const { rpc } = fakeRpc(({ fn }) => {
    if (fn.includes("begin")) return { status: "started", operation_id: "op1", items: [1] };
    throw Object.assign(new Error("Releitura não comprova"), { code: "55000", hint: "storage_lifecycle: reference_sync_unverified" });
  });
  const error = await auditedGameSave({ rpc, client: null, slug: "jogo", actor: "a", reason: "r", readScope,
    plan: { game: { image: URL("x/y.webp") } }, write: async () => 1 }).catch((e) => e);
  assert.ok(error instanceof ReferenceSyncPendingError);
  const response = lifecycleErrorResponse(error);
  assert.deepEqual([response?.status, response?.body.pending], [502, true]);
  assert.ok(response?.body.error.endsWith(SAVE_RECONCILE_HINT));
});

test("retomada: partes pendentes do mesmo pedido (resumable) também são confirmadas", async () => {
  const { rpc, calls } = fakeRpc(({ fn }) => (fn.includes("begin")
    ? { status: "nothing", resumable: [{ operation_id: "antiga", chunk: 1, items: [1, 2] }] }
    : { status: "succeeded" }));
  const out = await auditedGameSave({ rpc, client: null, slug: "jogo", actor: "a", reason: "r", readScope, plan: {}, write: async () => 1 });
  assert.equal(calls.at(-1)?.args.p_operation_id, "antiga");
  assert.deepEqual(out.audit.operations, ["antiga"]);
});

test("pedido grande é dividido em partes de até 150 itens", async () => {
  const many = { ...structuredClone(before), achievements: [], progress: [] } as GameScopeState;
  const plan = { upsertAchievements: Array.from({ length: 200 }, (_, i) => ({ legacy_id: `n${i}`, image: URL(`games/jogo/achievements/n${i}.webp`) })) };
  const { rpc, calls } = fakeRpc(({ args }) => ({ status: "started", operation_id: `op${args.p_chunk}`, items: args.p_items as unknown[] }));
  await auditedGameSave({ rpc, client: null, slug: "jogo", actor: "a", reason: "r", readScope: async () => many, plan, write: async () => 1 });
  const begins = calls.filter((c) => c.fn.includes("begin"));
  assert.deepEqual(begins.map((c) => [c.args.p_chunk, c.args.p_chunks, (c.args.p_items as unknown[]).length]), [[1, 2, REFERENCE_SYNC_CHUNK], [2, 2, 200 - REFERENCE_SYNC_CHUNK]]);
});

test("respostas HTTP: outro salvamento pendente (409) e referência inválida (400)", () => {
  const conflict = lifecycleErrorResponse(Object.assign(new Error("pendente"), { code: "55000", hint: "storage_lifecycle: reference_sync_pending" }));
  assert.equal(conflict?.status, 409);
  assert.match(conflict!.body.error, /Outro salvamento deste jogo/);
  const invalid = lifecycleErrorResponse(Object.assign(new Error("Referência ao Storage inválida ou ininterpretável: x"), { code: "22023" }));
  assert.deepEqual([invalid?.status, invalid?.body.pending], [400, false]);
  // A mensagem antiga de 55000 (envio de imagem) continua para as outras rotas.
  assert.match(lifecycleErrorResponse(Object.assign(new Error("x"), { code: "55000" }))!.body.error, /MESMA imagem/);
});

// Endpoint do site para o agente (lib/agentSync): autenticação, validação, vínculo com o catálogo,
// idempotência, datas e integridade. Supabase SIMULADO em memória com as mesmas regras das tabelas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { earnedDateFor, handleAgentAchievementUnlock, parseUnlockRequest } from "../../lib/agentSync/achievementUnlock.ts";
import { memoryStore, sampleDb, TOKEN, type MemoryDb } from "../fixtures/agentSiteMemoryStore.mts";

type SiteBody = { result: string; error: string; earnedAt: string | null; achievement: { id: string } };
const NOW = Date.parse("2026-11-25T02:30:00Z"); // 24/11 23:30 em São Paulo

function req(body: unknown, token: string | null = TOKEN) {
  return new Request("http://site/api/agent/achievements", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const unlock = (over: Record<string, unknown> = {}) => ({
  eventId: randomUUID(),
  provider: "steam",
  gameSlug: "hollow-knight",
  externalId: "FALSE_KNIGHT",
  name: "False Knight",
  unlockedAt: "2026-11-25T02:00:00Z",
  timestampKind: "source",
  detectedLive: true,
  ...over,
});

async function call(db: MemoryDb, body: unknown, options: { token?: string | null; expected?: string; hooks?: Parameters<typeof memoryStore>[1] } = {}) {
  const store = memoryStore(db, options.hooks);
  let invalidated = 0;
  const response = await handleAgentAchievementUnlock(req(body, options.token === undefined ? TOKEN : options.token), {
    store,
    expectedToken: options.expected ?? TOKEN,
    invalidate: () => (invalidated += 1),
    now: () => NOW,
  });
  return { status: response.status, body: (await response.json()) as SiteBody, invalidated, store };
}

test("segurança: sem configuração, sem token e token errado", async () => {
  const db = sampleDb();
  assert.equal((await call(db, unlock(), { expected: "" })).status, 503);
  assert.equal((await call(db, unlock(), { expected: "curto" })).body.result, "not_configured");
  assert.equal((await call(db, unlock(), { token: null })).status, 401);
  assert.equal((await call(db, unlock(), { token: "x".repeat(40) })).status, 401);
  assert.equal(db.progress.size, 0, "nada gravado sem autenticação");
});

test("validação do corpo", async () => {
  const db = sampleDb();
  assert.equal((await call(db, "{not json")).status, 400);
  for (const bad of [
    { eventId: "1" },
    { provider: "xbox" },
    { gameSlug: "Hollow Knight" },
    { externalId: "" },
    { timestampKind: "agora" },
    { unlockedAt: "2027-01-01T00:00:00Z" },
    { unlockedAt: "1999-01-01T00:00:00Z" },
    { unlockedAt: null, timestampKind: "source" },
  ]) {
    const r = await call(db, unlock(bad));
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.result, "invalid");
  }
  assert.equal((await call(db, "x".repeat(20_000))).status, 413);
  assert.equal(db.progress.size, 0);
});

test("desbloqueio válido grava conclusão com a data da fonte no fuso do site", async () => {
  const db = sampleDb();
  const r = await call(db, unlock());
  assert.equal(r.status, 200);
  assert.equal(r.body.result, "unlocked");
  assert.equal(r.body.achievement.id, "hk-1");
  assert.equal(r.body.earnedAt, "2026-11-24", "02:00Z = 23:00 do dia 24 em São Paulo");
  assert.equal(r.invalidated, 1);
  const id = db.achievements[0].id;
  assert.deepEqual(db.progress.get(id), { status: "completed", earned_at: "2026-11-24" });
});

test("idempotência: repetir (mesmo ou outro evento) não regrava nem troca a data", async () => {
  const db = sampleDb();
  await call(db, unlock());
  const again = await call(db, unlock({ unlockedAt: "2026-11-25T02:10:00Z" }));
  assert.equal(again.status, 200);
  assert.equal(again.body.result, "already_completed");
  assert.equal(again.body.earnedAt, "2026-11-24");
  assert.equal(again.invalidated, 0);
  // Conquista já concluída pelo Admin antes do agente: preservada.
  db.progress.set(db.achievements[1].id, { status: "completed", earned_at: "2025-05-05" });
  const admin = await call(db, unlock({ externalId: "HORNET_1" }));
  assert.equal(admin.body.result, "already_completed");
  assert.equal(db.progress.get(db.achievements[1].id)?.earned_at, "2025-05-05");
  // Corrida perdida para outra gravação: responde como já concluída, sem erro.
  const race = await call(sampleDb(), unlock(), { hooks: { loseRace: true } });
  assert.equal(race.body.result, "already_completed");
});

test("progresso existente em andamento é concluído mantendo a data já registrada", async () => {
  const db = sampleDb();
  db.progress.set(db.achievements[0].id, { status: "progress", earned_at: "2026-10-10" });
  const r = await call(db, unlock());
  assert.equal(r.body.result, "unlocked");
  assert.equal(db.progress.get(db.achievements[0].id)?.earned_at, "2026-10-10");
});

test("datas: detecção ao vivo usa o dia da detecção; detecção tardia sem data da fonte não inventa data", () => {
  const base = { eventId: randomUUID(), provider: "steam" as const, gameSlug: "x", externalId: "A", name: null };
  assert.equal(earnedDateFor({ ...base, unlockedAt: "2026-11-24T12:00:00Z", timestampKind: "detected", detectedLive: true }), "2026-11-24");
  assert.equal(earnedDateFor({ ...base, unlockedAt: "2026-11-24T12:00:00Z", timestampKind: "detected", detectedLive: false }), null);
  assert.equal(parseUnlockRequest({ ...unlock(), unlockedAt: null, timestampKind: "detected" }, NOW).ok, true);
});

test("integridade: jogo inexistente, conquista sem vínculo, jogo errado e vínculo ambíguo", async () => {
  const db = sampleDb();
  const unknownGame = await call(db, unlock({ gameSlug: "nao-existe" }));
  assert.deepEqual([unknownGame.status, unknownGame.body.result], [422, "unknown_game"]);
  assert.equal((await call(db, unlock({ gameSlug: "apagado" }))).body.result, "unknown_game");

  const unmatched = await call(db, unlock({ externalId: "SEM_VINCULO" }));
  assert.deepEqual([unmatched.status, unmatched.body.result], [422, "unmatched"]);
  assert.match(unmatched.body.error, /Vincule-a no site/);

  const wrongGame = await call(db, unlock({ gameSlug: "hades", externalId: "FALSE_KNIGHT" }));
  assert.deepEqual([wrongGame.status, wrongGame.body.result], [409, "game_mismatch"]);
  assert.match(wrongGame.body.error, /hollow-knight/);

  const ambiguous = await call(db, unlock({ gameSlug: "hades", externalId: "DUP" }));
  assert.deepEqual([ambiguous.status, ambiguous.body.result], [409, "ambiguous"]);

  // Conquista CUSTOM não tem vínculo Steam: o provedor steam não a alcança.
  assert.equal((await call(db, unlock({ externalId: "hk-custom" }))).body.result, "unmatched");
  assert.equal(db.progress.size, 0, "nenhuma das recusas grava progresso");
  assert.equal(db.achievements.length, 6, "o endpoint nunca cria conquistas");
});

test("provedor site (operador): identificador canônico do próprio site, inclusive CUSTOM", async () => {
  const db = sampleDb();
  const r = await call(db, unlock({ provider: "site", externalId: "hk-custom", timestampKind: "detected", detectedLive: true }));
  assert.equal(r.body.result, "unlocked");
  assert.equal(r.body.earnedAt, "2026-11-24");
  const byUuid = await call(db, unlock({ provider: "site", gameSlug: "hades", externalId: db.achievements[3].id }));
  assert.equal(byUuid.body.achievement.id, "hd-1");
  assert.equal((await call(db, unlock({ provider: "site", gameSlug: "hades", externalId: "hk-1" }))).body.result, "game_mismatch");
});

test("banco indisponível responde 503 sem gravar", async () => {
  const db = sampleDb();
  for (const failOn of ["gameExists", "getProgress", "completeProgress"]) {
    const r = await call(db, unlock(), { hooks: { failOn } });
    assert.deepEqual([r.status, r.body.result], [503, "temporarily_unavailable"], failOn);
  }
  assert.equal(db.progress.size, 0);
});

// Fase 3 no agente: formato binário da Steam, provedor steam-local, detecção por diferença,
// sincronização com o site (handler real em servidor HTTP local, banco simulado), retry e recuperação.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBinaryKeyValues, KeyValuesError } from "../../agent/src/modules/achievements/keyvalues.ts";
import { SteamLocalProvider } from "../../agent/src/modules/achievements/providers/steamLocal.ts";
import { ProviderUnavailableError } from "../../agent/src/modules/achievements/providers/types.ts";
import { AchievementWatcher, ACHIEVEMENT_UNLOCKED } from "../../agent/src/modules/achievements/watcher.ts";
import { createSiteSyncHandler } from "../../agent/src/modules/achievements/siteSync.ts";
import { achievementsModule, operatorUnlockEvent } from "../../agent/src/modules/achievements/index.ts";
import { gamesModule } from "../../agent/src/modules/games/index.ts";
import { DeferEventError, PermanentEventError } from "../../agent/src/events/processor.ts";
import { EventStore, type AgentEvent } from "../../agent/src/events/eventStore.ts";
import { openDatabase } from "../../agent/src/store/database.ts";
import { silentLogger } from "../../agent/src/logger.ts";
import { loadConfig } from "../../agent/src/config.ts";
import { Agent } from "../../agent/src/core/agent.ts";
import { handleAgentAchievementUnlock } from "../../lib/agentSync/achievementUnlock.ts";
import { memoryStore, sampleDb, TOKEN, type MemoryDb } from "../fixtures/agentSiteMemoryStore.mts";

// ---------- Escritor do formato KeyValues binário (só para gerar arquivos de teste) ----------
type Kv = { [key: string]: string | number | Kv };
function writeKv(value: Kv): Buffer {
  const parts: Buffer[] = [];
  const cstr = (s: string) => Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);
  const obj = (o: Kv) => {
    for (const [key, item] of Object.entries(o)) {
      if (typeof item === "string") parts.push(Buffer.from([1]), cstr(key), cstr(item));
      else if (typeof item === "number") {
        const b = Buffer.alloc(4);
        b.writeInt32LE(item | 0);
        parts.push(Buffer.from([2]), cstr(key), b);
      } else {
        parts.push(Buffer.from([0]), cstr(key));
        obj(item);
        parts.push(Buffer.from([8]));
      }
    }
  };
  obj(value);
  parts.push(Buffer.from([8]));
  return Buffer.concat(parts);
}

const APP = "367520";
const ACH = [
  { name: "FALSE_KNIGHT", en: "False Knight", pt: "Falso Cavaleiro" },
  { name: "HORNET_1", en: "Protected", pt: null },
  { name: "MASTERY", en: "Mastery", pt: null },
];

function steamFixture(t: { after: (fn: () => void) => void }) {
  const steam = mkdtempSync(join(tmpdir(), "agent-steam-"));
  t.after(() => setTimeout(() => rmSync(steam, { recursive: true, force: true }), 50).unref());
  const stats = join(steam, "appcache", "stats");
  mkdirSync(stats, { recursive: true });
  mkdirSync(join(steam, "steamapps"), { recursive: true });
  writeFileSync(join(steam, "steamapps", `appmanifest_${APP}.acf`), `"AppState"
{
	"appid"		"${APP}"
	"name"		"Hollow Knight"
}
`);
  const bits: Kv = {};
  ACH.forEach((a, i) => {
    const name: Kv = { english: a.en, token: `T${i}` };
    if (a.pt) name.brazilian = a.pt;
    bits[String(i)] = { name: a.name, display: { name, desc: { english: `desc ${a.en}` }, hidden: 0 } };
  });
  writeFileSync(join(stats, `UserGameStatsSchema_${APP}.bin`), writeKv({ [APP]: { stats: { "1": { bits, type: 4 } } } }));
  let tick = 0;
  const setUser = (unlocked: Record<number, number | null>, account = "111") => {
    let data = 0;
    const times: Kv = {};
    for (const [bit, at] of Object.entries(unlocked)) {
      data |= 1 << Number(bit);
      if (at !== null) times[bit] = Math.floor(at / 1000);
    }
    const file = join(stats, `UserGameStats_${account}_${APP}.bin`);
    writeFileSync(file, writeKv({ cache: { "1": { data, AchievementTimes: times }, crc: 1, PendingChanges: 0 } }));
    tick += 1;
    const when = new Date(Date.now() + tick * 1000);
    utimesSync(file, when, when); // garante mudança de impressão digital
    return file;
  };
  return { steam, stats, setUser, provider: new SteamLocalProvider(() => steam) };
}

test("KeyValues binário: leitura e erros", () => {
  const parsed = parseBinaryKeyValues(writeKv({ a: { b: "x", n: -1 } }));
  assert.deepEqual(parsed, { a: { b: "x", n: -1 } });
  assert.throws(() => parseBinaryKeyValues(Buffer.from([2, 0x61, 0, 1])), KeyValuesError);
  assert.throws(() => parseBinaryKeyValues(Buffer.from([9, 0x61, 0])), /não suportado/);
});

test("provedor steam-local: ids estáveis, desbloqueio, horário da fonte, nomes e contas", async (t) => {
  const fx = steamFixture(t);
  assert.equal(fx.provider.sourceKeyFor("steam:367520"), "steam:367520");
  assert.equal(fx.provider.sourceKeyFor("exe:jogo.exe"), null);
  assert.equal(await fx.provider.read("steam:999"), null, "jogo sem esquema de conquistas");

  let snap = (await fx.provider.read(`steam:${APP}`))!;
  assert.deepEqual(snap.achievements.map((a) => [a.externalId, a.unlocked]), [["FALSE_KNIGHT", false], ["HORNET_1", false], ["MASTERY", false]]);
  assert.equal(snap.achievements[0].name, "Falso Cavaleiro", "prefere português quando a Steam fornece");
  assert.equal(snap.achievements[1].name, "Protected");

  const unlockedAt = Date.parse("2026-11-20T10:00:00Z");
  fx.setUser({ 0: unlockedAt, 2: null });
  snap = (await fx.provider.read(`steam:${APP}`))!;
  assert.equal(snap.achievements[0].unlockedAt, unlockedAt);
  assert.equal(snap.achievements[2].unlocked, true);
  assert.equal(snap.achievements[2].unlockedAt, null, "sem horário na fonte: não inventa");

  // Outra conta mais recente no mesmo computador: vale a mais recente.
  fx.setUser({ 1: unlockedAt }, "222");
  snap = (await fx.provider.read(`steam:${APP}`))!;
  assert.deepEqual(snap.achievements.filter((a) => a.unlocked).map((a) => a.externalId), ["HORNET_1"]);

  writeFileSync(join(fx.stats, `UserGameStats_333_${APP}.bin`), Buffer.from([0, 0x63, 0, 2, 1]));
  utimesSync(join(fx.stats, `UserGameStats_333_${APP}.bin`), new Date(Date.now() + 60_000), new Date(Date.now() + 60_000));
  await assert.rejects(fx.provider.read(`steam:${APP}`), ProviderUnavailableError);
});

function watcherSetup(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "agent-watch-"));
  const path = join(dir, "agent.db");
  t.after(() => setTimeout(() => rmSync(dir, { recursive: true, force: true }), 50).unref());
  let clock = Date.parse("2026-11-24T20:00:00Z");
  const open = () => {
    const db = openDatabase(path);
    const store = new EventStore(db, { maxAttempts: 5, retryBaseMs: 10, retryMaxMs: 10, now: () => clock });
    const watcher = new AchievementWatcher({ db, record: (e) => store.record(e), log: silentLogger, now: () => clock });
    return { db, store, watcher };
  };
  return { open, advance: (ms: number) => (clock += ms), now: () => clock };
}

test("detecção por diferença: linha de base, ao vivo, offline, repetição, reinício e re-bloqueio", async (t) => {
  const fx = steamFixture(t);
  const w = watcherSetup(t);
  let { db, store, watcher } = w.open();
  const key = `steam:${APP}`;
  const session = { live: true, sessionId: "s1", sessionStartedAt: w.now(), gameSlug: "hollow-knight" };

  // Histórico antigo + uma conquista feita na sessão antes da primeira leitura.
  fx.setUser({ 1: Date.parse("2020-01-01T00:00:00Z"), 0: w.now() + 30_000 });
  w.advance(60_000);
  let out = await watcher.read(fx.provider, key, session);
  assert.equal(out.baseline, true);
  assert.deepEqual(out.emitted, ["FALSE_KNIGHT"], "só o que foi conquistado ao vivo; o histórico de 2020 não vira evento");

  // Releituras sem mudança: nada (impressão digital igual) e, forçando, nada também.
  assert.equal((await watcher.read(fx.provider, key, session)).skipped, "unchanged");
  assert.deepEqual((await watcher.read(fx.provider, key, { ...session, force: true })).emitted, []);

  // Novo desbloqueio durante a sessão.
  fx.setUser({ 1: Date.parse("2020-01-01T00:00:00Z"), 0: w.now() - 1000, 2: null });
  out = await watcher.read(fx.provider, key, session);
  assert.deepEqual(out.emitted, ["MASTERY"]);
  const mastery = store.list({ type: ACHIEVEMENT_UNLOCKED }).find((e) => (e.payload as { externalId: string }).externalId === "MASTERY")!;
  const payload = mastery.payload as Record<string, unknown>;
  assert.equal(payload.timestampKind, "detected", "a fonte não deu horário: marca como horário da detecção");
  assert.equal(payload.detectedLive, true);
  assert.equal(payload.gameSlug, "hollow-knight");
  assert.equal(mastery.dedupeKey, `achievement:steam-local:${key}:MASTERY`);

  // Reinício do agente: a mesma leitura não duplica.
  db.close();
  ({ db, store, watcher } = w.open());
  assert.deepEqual((await watcher.read(fx.provider, key, { ...session, force: true })).emitted, []);

  // Re-bloqueio (reset de estatísticas) e novo desbloqueio: continua um único evento.
  fx.setUser({});
  await watcher.read(fx.provider, key, session);
  fx.setUser({ 0: w.now() });
  assert.deepEqual((await watcher.read(fx.provider, key, session)).emitted, []);
  assert.equal(store.list({ type: ACHIEVEMENT_UNLOCKED }).length, 2);

  // Conquista feita com o agente parado é reconciliada depois (leitura fora de sessão).
  fx.setUser({ 0: w.now(), 1: Date.parse("2026-11-24T18:00:00Z") });
  out = await watcher.read(fx.provider, key, { live: false, sessionId: null, sessionStartedAt: null, gameSlug: null });
  assert.deepEqual(out.emitted, ["HORNET_1"]);
  const hornet = store.list({ type: ACHIEVEMENT_UNLOCKED })[0].payload as Record<string, unknown>;
  assert.deepEqual([hornet.timestampKind, hornet.detectedLive, hornet.unlockedAt], ["source", false, "2026-11-24T18:00:00.000Z"]);

  // Fonte ilegível: erro registrado, nenhum estado perdido.
  writeFileSync(join(fx.stats, `UserGameStats_999_${APP}.bin`), Buffer.from([7]));
  utimesSync(join(fx.stats, `UserGameStats_999_${APP}.bin`), new Date(Date.now() + 99_000), new Date(Date.now() + 99_000));
  out = await watcher.read(fx.provider, key, session);
  assert.match(out.error ?? "", /ilegível/);
  assert.match(watcher.knownSources()[0].lastError ?? "", /ilegível/);
  assert.equal(watcher.sourceSummary("steam-local", key).unlocked, 2);
  db.close();
});

function event(payload: Record<string, unknown>, over: Partial<AgentEvent> = {}): AgentEvent {
  return {
    seq: 1, id: "5b0b3c1e-1111-4c4c-8888-123456789abc", dedupeKey: "k", type: ACHIEVEMENT_UNLOCKED, source: "steam-local",
    payload: { provider: "steam", sourceKey: `steam:${APP}`, externalId: "FALSE_KNIGHT", unlockedAt: "2026-11-24T20:00:00Z", timestampKind: "source", detectedLive: true, gameSlug: null, ...payload },
    isTest: false, status: "processing", attempts: 1, maxAttempts: 5, nextAttemptAt: 0, lockedAt: 0, lastError: null, result: null,
    occurredAt: 0, createdAt: 0, updatedAt: 0, completedAt: null, ...over,
  };
}
const handlerCtx = { signal: new AbortController().signal, attempt: 1, log: silentLogger };

test("handler de sincronização: respostas do site viram concluído, falha definitiva, adiamento ou retry", async () => {
  let reply: { status: number; body: unknown } | Error = { status: 200, body: { result: "unlocked", achievement: { id: "hk-1" } } };
  const sent: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  }) as unknown as typeof fetch;
  let connected = true;
  let token = TOKEN;
  let slug: string | null = null;
  const handler = createSiteSyncHandler({
    siteUrl: "http://site",
    token: () => token,
    site: { isConnected: () => connected },
    slugForKey: () => slug,
    fetchImpl,
  });

  await assert.rejects(handler(event({}), handlerCtx), PermanentEventError, "sem jogo associado");
  slug = "hollow-knight"; // associado depois: o retry funciona
  assert.equal((await handler(event({}), handlerCtx)).result, "unlocked");
  assert.equal(sent[0].gameSlug, "hollow-knight");
  assert.equal(sent[0].eventId, "5b0b3c1e-1111-4c4c-8888-123456789abc");

  reply = { status: 200, body: { result: "already_completed" } };
  assert.equal((await handler(event({}), handlerCtx)).result, "already_completed");
  for (const [status, result] of [[422, "unmatched"], [409, "game_mismatch"], [400, "invalid"]] as const) {
    reply = { status, body: { result, error: "x" } };
    await assert.rejects(handler(event({}), handlerCtx), PermanentEventError, result);
  }
  reply = { status: 401, body: { result: "unauthorized" } };
  await assert.rejects(handler(event({}), handlerCtx), DeferEventError);
  reply = { status: 404, body: "" };
  await assert.rejects(handler(event({}), handlerCtx), DeferEventError, "endpoint ainda não publicado");
  reply = { status: 503, body: { result: "temporarily_unavailable" } };
  await assert.rejects(handler(event({}), handlerCtx), (e: Error) => !(e instanceof DeferEventError) && !(e instanceof PermanentEventError));
  reply = new Error("ECONNRESET");
  await assert.rejects(handler(event({}), handlerCtx), /Falha de rede/);

  connected = false;
  await assert.rejects(handler(event({}), handlerCtx), DeferEventError, "site offline");
  connected = true;
  token = "";
  await assert.rejects(handler(event({}), handlerCtx), DeferEventError, "sem token");
  const before = sent.length;
  assert.equal((await handler(event({}, { isTest: true }), handlerCtx)).result, "skipped_test");
  assert.equal(sent.length, before, "evento de teste nunca vai ao site");
});

async function siteServer(t: { after: (fn: () => void) => void }, db: MemoryDb) {
  let up = true;
  const server: Server = createServer(async (req, res) => {
    if (!up) {
      res.writeHead(502);
      return res.end("bad gateway");
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    if (req.method === "HEAD" || req.url === "/") {
      res.writeHead(200);
      return res.end();
    }
    const request = new Request(`http://127.0.0.1${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: Buffer.concat(chunks),
    });
    const response = await handleAgentAchievementUnlock(request, { store: memoryStore(db), expectedToken: TOKEN });
    res.writeHead(response.status, { "content-type": "application/json" });
    res.end(await response.text());
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, setUp: (v: boolean) => (up = v) };
}

test("ponta a ponta: jogo em sessão → desbloqueio no cache da Steam → evento → site registra; falha de rede e reinício", { timeout: 60_000 }, async (t) => {
  const fx = steamFixture(t);
  const db = sampleDb();
  const site = await siteServer(t, db);
  const dir = mkdtempSync(join(tmpdir(), "agent-e2e-"));
  t.after(() => setTimeout(() => rmSync(dir, { recursive: true, force: true }), 50).unref());

  const makeAgent = () => {
    const config = loadConfig({
      dataDir: dir,
      env: { RUMO_AGENT_OBS_ENABLED: "false", RUMO_AGENT_CONTROL_PORT: "0", RUMO_AGENT_SITE_URL: site.url, RUMO_AGENT_SITE_TOKEN: TOKEN },
    });
    Object.assign(config.games, { pollMs: 50, startConfirmMs: 100, endGraceMs: 60_000 });
    Object.assign(config.achievements, { pollMs: 50 });
    // Muitas tentativas: com o site fora, o evento não pode esgotar antes de o teste observar.
    Object.assign(config.events, { pollIntervalMs: 30, retryBaseMs: 100, retryMaxMs: 200, maxAttempts: 100 });
    const signals = { listProcesses: async () => [], steamRunningAppId: async () => Number(APP), steamPath: async () => fx.steam, windowTitle: async () => null };
    const catalogFetch = (async () => new Response(JSON.stringify({ games: [{ slug: "hollow-knight", title: "Hollow Knight" }] }), { status: 200 })) as unknown as typeof fetch;
    return new Agent({
      config,
      log: silentLogger,
      modules: [gamesModule({ signals, fetchImpl: catalogFetch }), achievementsModule({ providers: [fx.provider] })],
    });
  };
  const wait = async (cond: () => boolean, ms = 30_000) => {
    const deadline = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > deadline) throw new Error("timeout");
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  const progressOf = (externalId: string) => db.progress.get(db.achievements.find((a) => a.external_id === externalId)!.id);

  fx.setUser({ 1: Date.parse("2019-05-05T00:00:00Z") }); // histórico antigo: não deve ir ao site
  let agent = makeAgent();
  await agent.start();
  const first = agent;
  t.after(() => first.stop("fim"));
  const unlocked = () => agent.events.list({ type: ACHIEVEMENT_UNLOCKED });
  // Sessão aberta (Steam app mapeado automaticamente para hollow-knight) e linha de base feita.
  await wait(() => readFileSync(join(dir, "agent.lock"), "utf8").length > 0 && agent.status().modules.some((m) => m.name === "games"));
  await wait(() => agent.status().modules.find((m) => m.name === "achievements")!.health?.detail?.fontesConhecidas === 1);

  const at = Date.now();
  fx.setUser({ 1: Date.parse("2019-05-05T00:00:00Z"), 0: at });
  await wait(() => progressOf("FALSE_KNIGHT")?.status === "completed");
  await wait(() => unlocked()[0]?.status === "completed"); // confirmação do site recebida pelo agente
  assert.equal(unlocked().length, 1, "um evento, apenas a conquista nova");
  assert.equal(progressOf("HORNET_1"), undefined, "o histórico de 2019 não foi enviado");
  assert.equal(unlocked()[0].status, "completed");
  assert.equal((unlocked()[0].result as { result: string }).result, "unlocked");

  // Site fora do ar: o desbloqueio fica guardado e é reenviado; o agente reinicia no meio.
  site.setUp(false);
  fx.setUser({ 1: Date.parse("2019-05-05T00:00:00Z"), 0: at, 2: Date.now() });
  await wait(() => unlocked().some((e) => (e.payload as { externalId: string }).externalId === "MASTERY" && e.attempts >= 1 && e.status !== "completed" && e.status !== "failed"));
  await agent.stop("reinício no meio do teste");
  agent = makeAgent();
  await agent.start();
  t.after(() => agent.stop("fim"));
  site.setUp(true);
  // O site sem a conquista vinculada: MASTERY não tem external_id no catálogo → falha definitiva com diagnóstico.
  await wait(() => unlocked().some((e) => (e.payload as { externalId: string }).externalId === "MASTERY" && e.status === "failed"));
  const mastery = unlocked().find((e) => (e.payload as { externalId: string }).externalId === "MASTERY")!;
  assert.match(mastery.lastError ?? "", /unmatched/);
  // Vínculo criado no site → retry manual → registrado.
  db.achievements.push({ id: "00000000-0000-4000-8000-000000000001", legacy_id: "hk-m", title: "Maestria", game_slug: "hollow-knight", source: "steam", external_id: "MASTERY" });
  assert.equal(agent.events.requeue(mastery.id), true);
  await wait(() => progressOf("MASTERY")?.status === "completed");
  assert.equal(unlocked().length, 2, "nenhuma duplicata depois de falha, reinício e retry");
});

test("desbloqueio pelo operador: id canônico do site, deduplicado, eventos de teste isolados", () => {
  const a = operatorUnlockEvent({ slug: "hollow-knight", achievementId: "hk-custom" });
  assert.equal(a.dedupeKey, "achievement:operator:site:hollow-knight:hk-custom");
  assert.equal((a.payload as { provider: string }).provider, "site");
  assert.equal(operatorUnlockEvent({ slug: "x", achievementId: "y", isTest: true }).isTest, true);
  assert.throws(() => operatorUnlockEvent({ slug: "Com Espaço", achievementId: "y" }), /slug/);
  assert.throws(() => operatorUnlockEvent({ slug: "x", achievementId: "" }), /id da conquista/);
});

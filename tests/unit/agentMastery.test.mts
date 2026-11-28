// Fase 4.5 — Maestria: detecção de 100% pelo critério do site, persistência, sequência protegida
// na fila de alertas, apresentação especial no overlay, recuperação e teste isolado.
// Tudo em pastas temporárias e servidores locais (site simulado com o endpoint real do agente).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../agent/src/store/database.ts";
import { EventStore, type AgentEvent, type NewEvent } from "../../agent/src/events/eventStore.ts";
import { DeferEventError } from "../../agent/src/events/processor.ts";
import { StateStore } from "../../agent/src/store/stateStore.ts";
import { AlertStore, PROTECTED_PRIORITY, type Alert } from "../../agent/src/modules/alerts/alertStore.ts";
import { AlertEngine, MASTERY_MAX_ATTEMPTS, PresenterUnavailableError, type AlertPresenter } from "../../agent/src/modules/alerts/engine.ts";
import { alertsModule } from "../../agent/src/modules/alerts/index.ts";
import { achievementsModule } from "../../agent/src/modules/achievements/index.ts";
import { SiteAchievementsCache, type SiteAchievement, type SiteGameMeta } from "../../agent/src/modules/achievements/siteAchievements.ts";
import { evaluateMastery } from "../../agent/src/modules/mastery/criteria.ts";
import { createMasteryCheckHandler, masteryModule, MASTERY_ACHIEVED, MASTERY_CHECK } from "../../agent/src/modules/mastery/index.ts";
import { overlayModule } from "../../agent/src/modules/overlay/index.ts";
import { toPresentation } from "../../agent/src/modules/overlay/hub.ts";
import { OVERLAY_HTML, OVERLAY_JS } from "../../agent/src/modules/overlay/page.ts";
import { dockModule } from "../../agent/src/modules/dock/index.ts";
import { buildDockState } from "../../agent/src/modules/dock/state.ts";
import { DOCK_JS } from "../../agent/src/modules/dock/page.ts";
import { handleAgentAchievementUnlock } from "../../lib/agentSync/achievementUnlock.ts";
import { memoryStore, sampleDb, TOKEN, type MemoryDb } from "../fixtures/agentSiteMemoryStore.mts";
import { silentLogger } from "../../agent/src/logger.ts";
import { loadConfig } from "../../agent/src/config.ts";
import { Agent } from "../../agent/src/core/agent.ts";

const tmp = (t: { after: (fn: () => void) => void }, prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* pasta temporária */ } }, 50).unref());
  return dir;
};

const ach = (id: string, title: string, completed: boolean, isCustom = false): SiteAchievement => ({
  id, title, description: null, image: null, rank: null, isCustom, completed,
});
const meta = (journeyIds: string[] = []): SiteGameMeta => ({ title: "Hollow Knight", journeyIds, finalBadge: null });

test("critério: 100% só com todas as elegíveis (oficiais e CUSTOM), títulos repetidos contam uma vez, Jornada de Estreia", () => {
  const full = [ach("a", "Falso Cavaleiro", true), ach("b", "Hornet", true), ach("c", "Sem dano", true, true)];
  const r = evaluateMastery(full, meta());
  assert.deepEqual([r.complete, r.eligible, r.completed, r.official, r.custom], [true, 3, 3, 2, 1]);

  const incomplete = evaluateMastery([...full.slice(0, 2), ach("c", "Sem dano", false, true)], meta());
  assert.deepEqual([incomplete.complete, incomplete.completed, incomplete.missing], [false, 2, ["Sem dano"]], "CUSTOM pendente impede a Maestria");

  // Mesmo título (acentos/caixa/espaços) conta uma vez, como no site.
  const dup = evaluateMastery([ach("a", "Hornet", true), ach("b", "  hórnet ", false)], meta());
  assert.deepEqual([dup.eligible, dup.complete], [1, true]);

  assert.equal(evaluateMastery([], meta()).complete, false, "sem conquistas elegíveis não há Maestria");

  // Jornada de Estreia concluída conta as escolhidas (por id ou pelo título em slug).
  const journey = evaluateMastery([ach("a", "Falso Cavaleiro", true), ach("b", "Hornet", false)], meta(["hollow-knight-hornet"]));
  assert.equal(journey.complete, true);
  // Estado anterior ao desbloqueio: a conquista volta a "não concluída", a Jornada continua valendo.
  assert.equal(evaluateMastery(full, meta(), { assumeLocked: "b" }).complete, false);
  assert.equal(evaluateMastery([ach("a", "X", true), ach("b", "Hornet", true)], meta(["b"]), { assumeLocked: "b" }).complete, true);
});

test("catálogo: conquistas ocultas ficam fora; dados do jogo (Jornada concluída, Maestria Final) são lidos do site", async () => {
  const state = new Map<string, unknown>();
  const body = {
    games: [
      { slug: "hk", title: "Hollow Knight", firstJourney: { status: "completed", achievementIds: ["x"] }, finalBadge: { title: "Lenda", image: "https://cdn/m.png" } },
      { slug: "hd", title: "Hades", firstJourney: { status: "in_progress", achievementIds: ["y"] }, finalBadge: { image: "/local.png" } },
    ],
    achievementsBySlug: {
      hk: [
        { legacy_id: "a", title: "A", is_custom: false, achievement_progress: [{ status: "completed" }] },
        { legacy_id: "h", title: "Oculta", is_hidden: true, achievement_progress: [] },
      ],
    },
  };
  const cache = new SiteAchievementsCache({
    siteUrl: "http://site",
    state: { get: (k) => state.get(k) as never, set: (k, v) => void state.set(k, v) },
    log: silentLogger,
    fetchImpl: (async () => new Response(JSON.stringify(body))) as typeof fetch,
  });
  assert.equal(await cache.ensureFresh(true), true);
  assert.deepEqual(cache.forGame("hk").map((a) => a.id), ["a"]);
  assert.deepEqual(cache.game("hk"), { title: "Hollow Knight", journeyIds: ["x"], finalBadge: { title: "Lenda", image: "https://cdn/m.png" } });
  assert.deepEqual(cache.game("hd")?.journeyIds, [], "Jornada em andamento não conta");
  assert.equal(cache.game("hd")?.finalBadge?.image, null, "só imagem https");
  assert.equal(cache.game("fora"), null);
});

function fakeCache(initial: { ok?: boolean; games: Record<string, SiteGameMeta>; achievements: Record<string, SiteAchievement[]> }) {
  const data = { ok: true, ...initial };
  return {
    data,
    cache: {
      ensureFresh: async () => data.ok,
      forGame: (slug: string) => data.achievements[slug] ?? [],
      game: (slug: string) => data.games[slug] ?? null,
    },
  };
}

const checkEvent = (achievementId: string, slug = "hk"): AgentEvent =>
  ({ id: "chk-" + achievementId, type: MASTERY_CHECK, payload: { gameSlug: slug, achievementId, unlockEventId: "u-" + achievementId, detectedLive: true, detectedAt: null } }) as unknown as AgentEvent;

test("verificação: só decide com o catálogo atualizado; falsos positivos (já 100%, fora do catálogo, oculta, cópia atrasada) não disparam", async () => {
  const recorded: NewEvent[] = [];
  const fake = fakeCache({
    games: { hk: meta() },
    achievements: { hk: [ach("a", "A", true), ach("b", "B", true), ach("c", "C", true, true)] },
  });
  const seen = new Set<string>();
  const handler = createMasteryCheckHandler({
    cache: () => fake.cache as never,
    record: (event) => {
      recorded.push(event);
      const created = !seen.has(event.dedupeKey!);
      seen.add(event.dedupeKey!);
      return { event: { id: "m-" + recorded.length } as AgentEvent, created };
    },
  });

  fake.data.ok = false;
  await assert.rejects(handler(checkEvent("c")), (e) => e instanceof DeferEventError, "catálogo indisponível: adia, não decide");
  fake.data.ok = true;

  const r = await handler(checkEvent("c"));
  assert.equal(r.result, "mastery");
  assert.equal(recorded[0].type, MASTERY_ACHIEVED);
  assert.equal(recorded[0].dedupeKey, "mastery:hk", "uma Maestria por jogo");
  assert.deepEqual(
    [(recorded[0].payload as { eligible: number }).eligible, (recorded[0].payload as { custom: number }).custom],
    [3, 1],
  );
  // Verificação repetida (outra conquista recém-confirmada do mesmo jogo): mesma chave, sem duplicata.
  const again = await handler(checkEvent("c"));
  assert.equal(again.result === "mastery" && again.created, false);

  // Incompleto.
  fake.data.achievements.hk[1] = ach("b", "B", false);
  assert.equal((await handler(checkEvent("c"))).result, "incomplete");
  // Cópia do site atrasada (a conquista que disparou ainda não aparece concluída): nova tentativa.
  await assert.rejects(handler(checkEvent("b")), /ainda não mostra/);
  // Já estava 100% antes deste desbloqueio (coberto pela Jornada): não é uma nova Maestria.
  fake.data.achievements.hk[1] = ach("b", "B", true);
  fake.data.games.hk = meta(["c"]);
  assert.equal((await handler(checkEvent("c"))).result, "already_mastered");
  // Fora do catálogo, conquista oculta/desconhecida, jogo sem conquistas.
  assert.equal((await handler(checkEvent("c", "fora"))).result, "unknown_game");
  fake.data.games.hk = meta();
  assert.equal((await handler(checkEvent("oculta"))).result, "not_eligible");
  assert.equal(recorded.length, 2, "nenhuma Maestria extra registrada");
});

function queueSetup(t: { after: (fn: () => void) => void }) {
  const dir = tmp(t, "agent-mastery-q-");
  const path = join(dir, "agent.db");
  let clock = Date.parse("2026-11-26T20:00:00Z");
  const open = () => {
    const db = openDatabase(path);
    const events = new EventStore(db, { maxAttempts: 5, retryBaseMs: 10, retryMaxMs: 10, now: () => clock });
    const alerts = new AlertStore(db, { maxAttempts: 3, retryBaseMs: 1_000, retryMaxMs: 10_000, now: () => clock });
    const state = new StateStore(db);
    const engine = new AlertEngine({
      db,
      store: alerts,
      log: silentLogger,
      cursor: { get: () => state.get<number>("cursor"), set: (v) => state.set("cursor", v) },
      engine: { staleAfterMs: 10 * 60_000, ttlMs: 30 * 60_000, presentTimeoutMs: 300, pollMs: 20, now: () => clock },
    });
    return { db, events, alerts, engine };
  };
  return { open, advance: (ms: number) => (clock += ms) };
}

const masteryEvent = (slug: string, over: Record<string, unknown> = {}, isTest = false): NewEvent => ({
  type: MASTERY_ACHIEVED,
  dedupeKey: isTest ? `test:${slug}:${Math.random()}` : `mastery:${slug}`,
  isTest,
  payload: { gameSlug: slug, gameTitle: "Hollow Knight", eligible: 3, official: 2, custom: 1, badgeTitle: null, badgeImage: null, detectedLive: true, achievedAt: "x", ...over },
});

test("fila: Maestria entra com prioridade protegida, sem prazo, deduplicada; não percebida ao vivo fica registrada sem apresentar", (t) => {
  const q = queueSetup(t);
  const { db, events, alerts, engine } = q.open();
  t.after(() => db.close());
  engine.initCursor();
  events.record(masteryEvent("hk"));
  events.record(masteryEvent("hk")); // mesmo fato: deduplicado já no evento
  events.record(masteryEvent("old", { detectedLive: false }));
  events.record(masteryEvent("tst", {}, true));
  engine.ingest();
  engine.ingest();
  const list = alerts.list();
  assert.equal(list.length, 3);
  const hk = list.find((a) => a.gameSlug === "hk")!;
  assert.deepEqual([hk.kind, hk.priority, hk.expiresAt, hk.maxAttempts, hk.status], ["mastery", PROTECTED_PRIORITY, null, MASTERY_MAX_ATTEMPTS, "pending"]);
  assert.equal(list.find((a) => a.gameSlug === "old")!.status, "expired");
  assert.equal(list.find((a) => a.gameSlug === "tst")!.isTest, true);
  assert.equal(alerts.protectedWaiting(), 1, "teste não conta como Maestria real");
  // Nunca expira por prazo, mesmo muito tempo depois (overlay fechado não perde a Maestria).
  q.advance(48 * 3600_000);
  assert.equal(alerts.claimNext()!.id, hk.id);
});

test("sequência protegida: não interrompe a apresentação em curso, segura os comuns enquanto espera e libera a fila no fim", (t) => {
  const q = queueSetup(t);
  const { db, alerts } = q.open();
  t.after(() => db.close());
  const normal1 = alerts.insert({ kind: "achievement", dedupeKey: "n1", payload: {} }).alert;
  const current = alerts.claimNext()!;
  assert.equal(current.id, normal1.id);
  const mastery = alerts.insert({ kind: "mastery", dedupeKey: "m", payload: {}, priority: PROTECTED_PRIORITY, maxAttempts: 2 }).alert;
  const normal2 = alerts.insert({ kind: "achievement", dedupeKey: "n2", payload: {} }).alert;
  assert.equal(alerts.claimNext(), null, "a Maestria não interrompe a apresentação em curso");
  alerts.complete(current.id, current.attempts);

  // 1ª tentativa da Maestria falha: em retry_wait ela segura os comuns.
  const m1 = alerts.claimNext()!;
  assert.equal(m1.id, mastery.id, "Maestria logo depois da apresentação em curso");
  assert.equal(alerts.fail(m1.id, m1.attempts, { message: "overlay caiu" }), "retry_wait");
  assert.equal(alerts.claimNext(), null, "comum não fura a sequência protegida");
  // Overlay indisponível: adia sem gastar tentativa e continua segurando.
  q.advance(60_000);
  const m2 = alerts.claimNext()!;
  assert.equal(alerts.fail(m2.id, m2.attempts, { message: "sem overlay", deferMs: 5_000 }), "retry_wait");
  assert.equal(alerts.get(mastery.id)!.attempts, 1);
  assert.equal(alerts.claimNext(), null);
  q.advance(5_000);
  const m3 = alerts.claimNext()!;
  alerts.complete(m3.id, m3.attempts);
  assert.equal(alerts.get(mastery.id)!.status, "completed");
  assert.equal(alerts.claimNext()!.id, normal2.id, "fila normal volta depois da Maestria");

  // Falha definitiva (tentativas esgotadas) não prende a fila para sempre.
  const n2 = alerts.get(normal2.id)!;
  alerts.complete(n2.id, n2.attempts);
  const stuck = alerts.insert({ kind: "mastery", dedupeKey: "m-bad", payload: {}, priority: PROTECTED_PRIORITY, maxAttempts: 2 }).alert;
  const normal3 = alerts.insert({ kind: "achievement", dedupeKey: "n3", payload: {} }).alert;
  for (let i = 0; i < 2; i += 1) {
    q.advance(60_000);
    const s = alerts.claimNext()!;
    assert.equal(s.id, stuck.id);
    alerts.fail(s.id, s.attempts, { message: "erro" });
  }
  assert.equal(alerts.get(stuck.id)!.status, "failed");
  assert.equal(alerts.claimNext()!.id, normal3.id, "fila destravada");
  // Reapresentável manualmente.
  assert.equal(alerts.requeue(stuck.id, null), true);
});

test("recuperação: Maestria em apresentação quando o agente cai volta à fila na frente dos comuns", (t) => {
  const q = queueSetup(t);
  const first = q.open();
  first.alerts.insert({ kind: "mastery", dedupeKey: "m", payload: {}, priority: PROTECTED_PRIORITY, maxAttempts: MASTERY_MAX_ATTEMPTS });
  first.alerts.insert({ kind: "achievement", dedupeKey: "n", payload: {} });
  const claimed = first.alerts.claimNext()!;
  first.db.close(); // agente caiu no meio, sem concluir

  const second = q.open();
  t.after(() => second.db.close());
  assert.deepEqual(second.alerts.recoverInterrupted(), { recovered: 1, failed: 0 });
  const back = second.alerts.claimNext()!;
  assert.equal(back.id, claimed.id);
  assert.equal(back.status, "processing");
  assert.equal(second.alerts.complete(back.id, back.attempts), true);
  assert.equal(second.alerts.list({ status: "completed" }).length, 1, "concluída uma única vez");
});

test("motor: Maestria espera o overlay (indisponível não gasta tentativa) e só conclui após a apresentação", async (t) => {
  const q = queueSetup(t);
  const { db, events, alerts, engine } = q.open();
  t.after(() => db.close());
  engine.initCursor();
  events.record(masteryEvent("hk"));
  engine.ingest();
  let available = false;
  const seen: string[] = [];
  const presenter: AlertPresenter = {
    id: "fake",
    async present(alert, ctx) {
      if (!available) throw new PresenterUnavailableError("sem overlay", 1_000);
      ctx.started();
      seen.push(alert.kind);
    },
  };
  engine.setPresenter(presenter);
  await engine.stop();
  await engine.processNext();
  const waiting = alerts.list()[0];
  assert.deepEqual([waiting.status, waiting.attempts], ["retry_wait", 0]);
  available = true;
  q.advance(1_000);
  await engine.processNext();
  assert.deepEqual(seen, ["mastery"]);
  assert.equal(alerts.list()[0].status, "completed");
});

test("overlay e dock: apresentação própria da Maestria, só texto, e estado compacto no dock", () => {
  const alert = { kind: "mastery", title: "Hollow Knight", isTest: false, payload: { gameTitle: "Hollow Knight", eligible: 63, official: 60, custom: 3, badgeTitle: "Lenda", badgeImage: "javascript:alert(1)" } } as unknown as Alert;
  assert.deepEqual(toPresentation(alert), { kind: "mastery", gameTitle: "Hollow Knight", total: 63, official: 60, custom: 3, badgeTitle: "Lenda", image: null, isTest: false });
  assert.match(OVERLAY_HTML, /id="mastery"/);
  assert.match(OVERLAY_JS, /presentation\.kind === "mastery"/);
  assert.doesNotMatch(OVERLAY_JS, /innerHTML|insertAdjacentHTML|eval\(/);
  assert.match(DOCK_JS, /\/modules\/mastery\/test/);

  const base = {
    now: 0, version: "x", uptimeSeconds: 1, games: null,
    obs: { state: "connected", detail: {} }, site: { state: "connected", detail: {} },
    sync: { tokenConfigured: true, counts: {}, lastError: null },
  } as unknown as Parameters<typeof buildDockState>[0];
  const counts = { pending: 1, processing: 0, retry_wait: 0, completed: 0, failed: 0, expired: 0 };
  assert.equal(buildDockState({ ...base, alerts: { presenter: "overlay", current: "a", currentKind: "mastery", currentTitle: "HK", counts } }).alerts.label, "Apresentando Maestria");
  const waiting = buildDockState({ ...base, alerts: { presenter: null, current: null, masteryWaiting: 1, counts } }).alerts;
  assert.deepEqual([waiting.label, waiting.level], ["Maestria na fila", "warn"]);
});

// ── Integração: site simulado (endpoint real + catálogo gerado do banco), agente real, overlay via SSE ──

type SseEvent = { event: string; data: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

function sseClient(url: string) {
  const controller = new AbortController();
  const queue: SseEvent[] = [];
  const waiters: Array<(e: SseEvent) => void> = [];
  const done = (async () => {
    const response = await fetch(url, { signal: controller.signal });
    const reader = response.body!.getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += Buffer.from(value).toString("utf8");
      let index: number;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (!event || !data) continue;
        const item = { event, data: JSON.parse(data) };
        const waiter = waiters.shift();
        if (waiter) waiter(item);
        else queue.push(item);
      }
    }
  })().catch(() => undefined);
  return {
    next(name: string, ms = 6_000): Promise<SseEvent> {
      const found = queue.findIndex((e) => e.event === name);
      if (found >= 0) return Promise.resolve(queue.splice(found, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.indexOf(take);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`sem evento ${name}`));
        }, ms);
        const take = (e: SseEvent) => {
          if (e.event !== name) {
            queue.push(e);
            waiters.push(take);
            return;
          }
          clearTimeout(timer);
          resolve(e);
        };
        waiters.push(take);
      });
    },
    close() {
      controller.abort();
      return done;
    },
  };
}

/** Catálogo público como o site o publica, gerado do banco simulado (o progresso reflete as gravações). */
function catalogFrom(db: MemoryDb) {
  const achievementsBySlug: Record<string, unknown[]> = {};
  for (const a of db.achievements) {
    const progress = db.progress.get(a.id);
    (achievementsBySlug[a.game_slug] ??= []).push({
      legacy_id: a.legacy_id, id: a.id, title: a.title, is_custom: a.is_custom === true, is_hidden: false,
      achievement_progress: progress ? [{ status: progress.status }] : [],
    });
  }
  // Conquista oculta: fora do progresso público, nunca impede a Maestria.
  (achievementsBySlug["hollow-knight"] ??= []).push({ legacy_id: "hk-oculta", title: "Oculta", is_hidden: true, achievement_progress: [] });
  return {
    ok: true,
    games: [
      { slug: "hollow-knight", title: "Hollow Knight", finalBadge: { title: "Lenda de Hallownest", image: "https://cdn.example/hk-maestria.png" } },
      { slug: "hades", title: "Hades" },
    ],
    achievementsBySlug,
  };
}

async function e2eSetup(t: { after: (fn: () => void) => void }) {
  const dir = tmp(t, "agent-mastery-e2e-");
  const db = sampleDb();
  const siteState = { catalogDown: false, siteWrites: 0 };
  const site = createServer(async (req, res) => {
    if (req.url?.startsWith("/api/games/catalog")) {
      if (siteState.catalogDown) {
        res.writeHead(500);
        return res.end("{}");
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(catalogFrom(db)));
    }
    if (req.url === "/api/agent/achievements") {
      siteState.siteWrites += 1;
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const response = await handleAgentAchievementUnlock(
        new Request("http://site/api/agent/achievements", { method: "POST", headers: req.headers as Record<string, string>, body: Buffer.concat(chunks) }),
        { store: memoryStore(db), expectedToken: TOKEN },
      );
      res.writeHead(response.status, { "content-type": "application/json" });
      return res.end(await response.text());
    }
    res.end();
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  t.after(() => site.close());
  const siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  const make = () => {
    const config = loadConfig({
      dataDir: dir,
      env: {
        RUMO_AGENT_OBS_ENABLED: "false", RUMO_AGENT_GAMES_ENABLED: "false", RUMO_AGENT_ACHIEVEMENTS_ENABLED: "false",
        RUMO_AGENT_CONTROL_PORT: "0", RUMO_AGENT_SITE_URL: siteUrl, RUMO_AGENT_SITE_TOKEN: TOKEN,
      },
    });
    Object.assign(config.events, { pollIntervalMs: 20 });
    return new Agent({
      config,
      log: silentLogger,
      modules: [
        achievementsModule({ providers: [] }),
        masteryModule(),
        alertsModule({ settings: { pollMs: 20, retryBaseMs: 50, retryMaxMs: 100, presentTimeoutMs: 10_000 } }),
        overlayModule({ timing: { enterMs: 20, holdMs: 60, exitMs: 20 }, masteryTiming: { enterMs: 30, holdMs: 4_000, exitMs: 30 }, startTimeoutMs: 3_000 }),
        dockModule(),
      ],
    });
  };
  const agent = make();
  await agent.start();
  t.after(() => agent.stop("fim"));
  const base = `http://127.0.0.1:${agent.controlPort}`;
  const token = readFileSync(join(dir, "control-token"), "utf8");
  const wait = async (cond: () => boolean | Promise<boolean>, ms = 8_000) => {
    const deadline = Date.now() + ms;
    while (!(await cond())) {
      if (Date.now() > deadline) throw new Error("timeout");
      await new Promise((r) => setTimeout(r, 15));
    }
  };
  // O envio ao site espera a conexão (senão é adiado): começa com o site já "Online".
  await wait(async () => (await (await fetch(`${base}/modules/dock/state`)).json()).site.level === "ok");
  return {
    db, siteState, agent, make, base, token, wait,
    unlock: (slug: string, id: string, b = base) =>
      fetch(`${b}/modules/achievements/unlock`, { method: "POST", headers: { "x-agent-token": token }, body: JSON.stringify({ slug, achievementId: id }) }),
    ack: (nonce: string, phase: string, b = base) =>
      fetch(`${b}/modules/overlay/ack`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nonce, phase }) }),
    alerts: async (b = base) => ((await (await fetch(`${b}/modules/alerts/list?limit=50`)).json()).alerts as Alert[]),
  };
}

test("integração: último desbloqueio → site → verificação → Maestria protegida no overlay → reinício no meio → fila normal volta", { timeout: 45_000 }, async (t) => {
  const s = await e2eSetup(t);
  const id = (legacy: string) => s.db.achievements.find((a) => a.legacy_id === legacy)!.id;
  // Já concluídas no site: uma oficial e a CUSTOM. Falta só "hk-2".
  s.db.progress.set(id("hk-1"), { status: "completed", earned_at: "2026-11-01" });
  s.db.progress.set(id("hk-custom"), { status: "completed", earned_at: "2026-11-02" });

  // Sem 100%: desbloqueio de outro jogo não dispara Maestria (Hades segue incompleto).
  await s.unlock("hades", "hd-1");
  await s.wait(() => s.agent.events.list({ type: MASTERY_CHECK }).some((e) => e.status === "completed"));
  assert.equal((s.agent.events.list({ type: MASTERY_CHECK })[0].result as { result: string }).result, "incomplete");
  assert.equal(s.agent.events.list({ type: MASTERY_ACHIEVED }).length, 0);

  const overlay = sseClient(`${s.base}/modules/overlay/events`);
  await overlay.next("hello");
  // Alerta comum do Hades (fila normal) é apresentado.
  const hd = await overlay.next("present");
  assert.equal(hd.data.presentation.kind, "achievement");
  await s.ack(hd.data.nonce, "started");
  await s.ack(hd.data.nonce, "ended");

  // Último desbloqueio do Hollow Knight: alerta comum primeiro, a Maestria logo depois.
  await s.unlock("hollow-knight", "hk-2");
  const last = await overlay.next("present");
  assert.equal(last.data.presentation.kind, "achievement");
  await s.ack(last.data.nonce, "started");
  // Enquanto a conquista está na tela, a Maestria é detectada (sem interromper a apresentação).
  await s.wait(() => s.agent.events.list({ type: MASTERY_ACHIEVED }).length === 1);
  // Um desbloqueio comum chega depois da Maestria: precisa esperar a sequência protegida.
  s.db.achievements.push({ id: "hd-x", legacy_id: "hd-4", title: "Outra", game_slug: "hades", source: "manual", external_id: null });
  const hd4 = await (await s.unlock("hades", "hd-4")).json();
  await s.wait(() => s.agent.events.get(hd4.event.id)!.status === "completed");
  assert.equal((await s.alerts()).find((a) => a.kind === "achievement" && a.status === "processing")?.id !== undefined, true, "a conquista segue na tela");
  await s.ack(last.data.nonce, "ended");

  const m = await overlay.next("present");
  assert.equal(m.data.presentation.kind, "mastery", "Maestria antes do comum que chegou depois");
  assert.deepEqual(
    [m.data.presentation.gameTitle, m.data.presentation.total, m.data.presentation.official, m.data.presentation.custom, m.data.presentation.badgeTitle, m.data.presentation.image, m.data.presentation.isTest],
    ["Hollow Knight", 3, 2, 1, "Lenda de Hallownest", "https://cdn.example/hk-maestria.png", false],
  );
  assert.equal(m.data.timing.holdMs, 4_000, "tempos próprios da Maestria");
  await s.ack(m.data.nonce, "started");
  const dockMid = await (await fetch(`${s.base}/modules/dock/state`)).json();
  assert.equal(dockMid.alerts.label, "Apresentando Maestria");

  // Agente cai no meio da apresentação: nada é concluído indevidamente.
  await s.agent.stop("reinício no meio da Maestria");
  await overlay.close();
  const agent2 = s.make();
  await agent2.start();
  t.after(() => agent2.stop("fim"));
  const base2 = `http://127.0.0.1:${agent2.controlPort}`;
  const overlay2 = sseClient(`${base2}/modules/overlay/events`);
  t.after(() => overlay2.close());
  await overlay2.next("hello");
  const again = await overlay2.next("present");
  assert.equal(again.data.presentation.kind, "mastery", "Maestria recuperada antes dos comuns");
  assert.notEqual(again.data.nonce, m.data.nonce);
  await s.ack(again.data.nonce, "started", base2);
  await s.ack(again.data.nonce, "ended", base2);

  // Fila normal volta a funcionar.
  const after = await overlay2.next("present");
  assert.equal(after.data.presentation.kind, "achievement");
  await s.ack(after.data.nonce, "started", base2);
  await s.ack(after.data.nonce, "ended", base2);

  const list = await s.alerts(base2);
  const masteries = list.filter((a) => a.kind === "mastery");
  const outra = list.find((a) => a.subjectId === "hd-4")!;
  assert.equal(outra.status, "completed");
  assert.ok(outra.completedAt! >= masteries[0].completedAt!, "o comum só depois da Maestria");
  assert.equal(masteries.length, 1, "uma única Maestria");
  assert.equal(masteries[0].status, "completed");
  assert.equal(agent2.events.list({ type: MASTERY_ACHIEVED }).length, 1);

  // Reenvio do mesmo desbloqueio: deduplicado no agente; nada novo no site nem outra Maestria.
  const writes = s.siteState.siteWrites;
  assert.equal((await (await s.unlock("hollow-knight", "hk-2", base2)).json()).created, false);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(agent2.events.list({ type: MASTERY_ACHIEVED }).length, 1);
  assert.equal(s.siteState.siteWrites, writes);
});

test("teste isolado de Maestria: mesma fila e overlay, selo de teste, nada no site, sem ocupar a vaga real; mesma origem", { timeout: 30_000 }, async (t) => {
  const s = await e2eSetup(t);
  const overlay = sseClient(`${s.base}/modules/overlay/events`);
  t.after(() => overlay.close());
  await overlay.next("hello");
  const writesBefore = s.siteState.siteWrites;
  const progressBefore = s.db.progress.size;

  const r = await fetch(`${s.base}/modules/mastery/test`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "hollow-knight" }) });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.equal(body.event.isTest, true);
  assert.match(body.event.dedupeKey, /^test:/);
  const p = await overlay.next("present");
  assert.deepEqual([p.data.presentation.kind, p.data.presentation.isTest, p.data.presentation.gameTitle], ["mastery", true, "Hollow Knight"]);
  await s.ack(p.data.nonce, "started");
  await s.ack(p.data.nonce, "ended");
  await s.wait(async () => (await s.alerts())[0]?.status === "completed");
  assert.equal((await s.alerts())[0].isTest, true);

  assert.equal(s.siteState.siteWrites, writesBefore, "nada enviado ao site");
  assert.equal(s.db.progress.size, progressBefore, "progresso intacto");
  assert.equal(s.agent.events.list({ type: MASTERY_CHECK }).length, 0, "nenhuma verificação real");
  const status = await (await fetch(`${s.base}/modules/alerts/status`)).json();
  assert.equal(status.counts.completed, 0, "contagens reais não incluem o teste");

  assert.equal((await fetch(`${s.base}/modules/mastery/test`, { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" })).status, 403);
  assert.equal((await fetch(`${s.base}/modules/mastery/test`, { method: "POST", body: JSON.stringify({ slug: "fora" }) })).status, 404);
  // Teste visual direto do overlay (sem fila), com token.
  const visual = fetch(`${s.base}/modules/overlay/test`, { method: "POST", headers: { "x-agent-token": s.token }, body: JSON.stringify({ kind: "mastery" }) });
  const v = await overlay.next("present");
  assert.equal(v.data.presentation.kind, "mastery");
  await s.ack(v.data.nonce, "started");
  await s.ack(v.data.nonce, "ended");
  assert.equal((await visual).status, 200);
});

test("catálogo indisponível: verificação adiada sem decidir; nenhuma Maestria por dados ausentes", { timeout: 30_000 }, async (t) => {
  const s = await e2eSetup(t);
  s.db.progress.set(s.db.achievements.find((a) => a.legacy_id === "hk-1")!.id, { status: "completed", earned_at: null });
  s.db.progress.set(s.db.achievements.find((a) => a.legacy_id === "hk-custom")!.id, { status: "completed", earned_at: null });
  s.siteState.catalogDown = true;
  await s.unlock("hollow-knight", "hk-2");
  await s.wait(() => s.agent.events.list({ type: MASTERY_CHECK }).some((e) => e.status === "retry_wait"));
  const check = s.agent.events.list({ type: MASTERY_CHECK })[0];
  assert.equal(check.attempts, 0, "adiamento não gasta tentativa");
  assert.match(check.lastError ?? "", /indisponível/);
  assert.equal(s.agent.events.list({ type: MASTERY_ACHIEVED }).length, 0);
});

test("sequência protegida: a conquista que completou o jogo abre a sequência; a Maestria vem logo depois dela", (t) => {
  const q = queueSetup(t);
  const { db, alerts } = q.open();
  t.after(() => db.close());
  const older = alerts.insert({ kind: "achievement", dedupeKey: "antes", payload: {} }).alert;
  const trigger = alerts.insert({ kind: "achievement", dedupeKey: "gatilho", sourceEventId: "ev-gatilho", payload: {} }).alert;
  const mastery = alerts.insert({ kind: "mastery", dedupeKey: "m", payload: { triggerEventId: "ev-gatilho" }, priority: PROTECTED_PRIORITY }).alert;
  const order: string[] = [];
  for (let a = alerts.claimNext(); a; a = alerts.claimNext()) {
    order.push(a.id);
    alerts.complete(a.id, a.attempts);
  }
  assert.deepEqual(order, [trigger.id, mastery.id, older.id], "gatilho → Maestria → demais comuns");
});

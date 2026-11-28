// Fase 4.4 — controles operacionais: correção manual do jogo da sessão e desbloqueio CUSTOM,
// integrados a eventos, fila de alertas e site. Tudo em pastas temporárias e servidores locais.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../agent/src/store/database.ts";
import { EventStore } from "../../agent/src/events/eventStore.ts";
import { GameRepository } from "../../agent/src/modules/games/repository.ts";
import { SessionManager } from "../../agent/src/modules/games/sessions.ts";
import type { ResolvedGame } from "../../agent/src/modules/games/detector.ts";
import { gamesModule } from "../../agent/src/modules/games/index.ts";
import { achievementsModule, operatorUnlockEvent } from "../../agent/src/modules/achievements/index.ts";
import { alertsModule } from "../../agent/src/modules/alerts/index.ts";
import { dockModule } from "../../agent/src/modules/dock/index.ts";
import { DOCK_JS } from "../../agent/src/modules/dock/page.ts";
import { createSiteSyncHandler } from "../../agent/src/modules/achievements/siteSync.ts";
import { handleAgentAchievementUnlock } from "../../lib/agentSync/achievementUnlock.ts";
import { memoryStore, sampleDb, TOKEN } from "../fixtures/agentSiteMemoryStore.mts";
import { silentLogger } from "../../agent/src/logger.ts";
import { loadConfig } from "../../agent/src/config.ts";
import { Agent } from "../../agent/src/core/agent.ts";
import type { Alert } from "../../agent/src/modules/alerts/alertStore.ts";

const tmp = (t: { after: (fn: () => void) => void }, prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* pasta temporária */ } }, 50).unref());
  return dir;
};

const detected = (key: string, slug: string | null): ResolvedGame => ({
  key, source: "process", label: key, pid: 1, exe: "x.exe",
  identity: slug ? `game:${slug}` : key, slug, title: slug ?? key,
  resolvedBy: slug ? "auto" : "unresolved", mappingKey: key,
});

test("correção da sessão: prevalece sobre a detecção, não duplica sessão, persiste no reinício e não toca em sessões encerradas", (t) => {
  const path = join(tmp(t, "agent-ctl-"), "agent.db");
  const open = () => {
    const db = openDatabase(path);
    const repo = new GameRepository(db);
    const events = new EventStore(db, { maxAttempts: 3, retryBaseMs: 10, retryMaxMs: 10 });
    const manager = new SessionManager({ repo, record: (e) => events.record(e), log: silentLogger, options: { startConfirmMs: 0, endGraceMs: 45_000, resumeMaxGapMs: 600_000, touchIntervalMs: 0 } });
    return { db, repo, events, manager };
  };
  let { db, repo, manager } = open();
  // Sessão antiga encerrada, com outro jogo.
  manager.observe(detected("exe:antigo.exe", "hades"), 10_000);
  manager.observe(null, 100_000);
  const closedBefore = repo.sessions(5)[0];
  assert.equal(closedBefore.endedAt, 10_000);

  assert.equal(manager.correct({ slug: "hades", title: "Hades", now: 1 }), null, "sem sessão ativa não há o que corrigir");
  manager.observe(detected("exe:jogo.exe", "metro-last-light"), 200_000); // detectado errado
  const session = manager.current()!;
  manager.correct({ slug: "hollow-knight", title: "Hollow Knight", now: 200_500 });
  // A detecção continua dizendo "metro": a escolha manual vale.
  for (let at = 201_000; at < 260_000; at += 5_000) manager.observe(detected("exe:jogo.exe", "metro-last-light"), at);
  assert.equal(manager.current()!.id, session.id, "mesma sessão, nada duplicado");
  assert.equal(manager.current()!.slug, "hollow-knight");
  assert.equal(repo.sessions(10).filter((s) => s.endedAt === null).length, 1);
  db.close();

  ({ db, repo, manager } = open());
  manager.restore(262_000);
  manager.observe(detected("exe:jogo.exe", "metro-last-light"), 262_000);
  const restored = manager.current()!;
  assert.deepEqual([restored.id, restored.slug, restored.manualSlug], [session.id, "hollow-knight", "hollow-knight"], "correção sobrevive ao reinício");
  assert.deepEqual((restored.detail.corrections as Array<{ from: string; to: string }>).map((c) => [c.from, c.to]), [["metro-last-light", "hollow-knight"]]);
  assert.deepEqual(repo.session(closedBefore.id), closedBefore, "sessão encerrada intacta");

  // Outro jogo detectado de fato encerra a sessão corrigida normalmente.
  manager.observe(detected("exe:outro.exe", "hades"), 270_000);
  assert.equal(repo.session(session.id)!.endReason, "switched");
  assert.equal(repo.session(session.id)!.slug, "hollow-knight", "o encerramento leva o jogo corrigido");
  db.close();
});

const SITE_CATALOG = {
  games: [
    { slug: "hollow-knight", title: "Hollow Knight" },
    { slug: "metro-last-light", title: "Metro: Last Light" },
  ],
  achievementsBySlug: {
    "hollow-knight": [
      { id: "u1", legacy_id: "hk-custom", title: "Custom", description: "Feita na live", image: "https://cdn.example/hk.png", rank: "Ouro", is_custom: true, is_hidden: false, achievement_progress: [{ status: "locked" }] },
      { id: "u2", legacy_id: "hk-1", title: "Falso Cavaleiro", description: "", image: "", is_custom: false, is_hidden: false, achievement_progress: [{ status: "completed" }] },
      { id: "u3", legacy_id: "hk-hidden", title: "Escondida", is_custom: true, is_hidden: true },
    ],
  },
};

async function agentSetup(t: { after: (fn: () => void) => void }) {
  const dir = tmp(t, "agent-ctl-e2e-");
  const db = sampleDb();
  const site = createServer(async (req, res) => {
    if (req.url?.startsWith("/api/games/catalog")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(SITE_CATALOG));
    }
    if (req.url === "/api/agent/achievements") {
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
  const processes: { name: string; pid: number }[] = [];
  const config = loadConfig({
    dataDir: dir,
    env: { RUMO_AGENT_OBS_ENABLED: "false", RUMO_AGENT_ACHIEVEMENTS_ENABLED: "false", RUMO_AGENT_CONTROL_PORT: "0", RUMO_AGENT_SITE_URL: siteUrl, RUMO_AGENT_SITE_TOKEN: TOKEN },
  });
  Object.assign(config.games, { pollMs: 30, startConfirmMs: 60 });
  Object.assign(config.events, { pollIntervalMs: 20 });
  const signals = { listProcesses: async () => processes, steamRunningAppId: async () => 0, steamPath: async () => null, windowTitle: async () => null };
  const agent = new Agent({
    config,
    log: silentLogger,
    modules: [gamesModule({ signals }), achievementsModule({ providers: [] }), alertsModule({ settings: { pollMs: 20 } }), dockModule()],
  });
  await agent.start();
  t.after(() => agent.stop("fim"));
  const base = `http://127.0.0.1:${agent.controlPort}`;
  const token = readFileSync(join(dir, "control-token"), "utf8");
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const wait = async (cond: () => boolean | Promise<boolean>) => {
    const deadline = Date.now() + 8_000;
    while (!(await cond())) {
      if (Date.now() > deadline) throw new Error("timeout");
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  return { db, agent, base, token, post, wait, processes };
}

test("dock/API: corrigir jogo da sessão (mesma origem, sem token), lembrar o executável e validar entradas", { timeout: 30_000 }, async (t) => {
  const s = await agentSetup(t);
  assert.equal((await s.post("/modules/games/session/correct", { slug: "hollow-knight" })).status, 409, "sem sessão ativa");

  s.processes.push({ name: "Desconhecido.exe", pid: 5 });
  await s.post("/modules/games/mappings", { key: "exe:Desconhecido.exe", slug: "metro-last-light" }, { "x-agent-token": s.token });
  await s.wait(async () => (await (await fetch(`${s.base}/modules/games/status`)).json()).activeSession?.slug === "metro-last-light");

  assert.equal((await s.post("/modules/games/session/correct", { slug: "nao-existe" })).status, 404);
  assert.equal((await s.post("/modules/games/session/correct", { slug: "hollow-knight" }, { origin: "https://evil.example" })).status, 403);
  const ok = await s.post("/modules/games/session/correct", { slug: "hollow-knight", remember: true });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.deepEqual([body.session.slug, body.remembered], ["hollow-knight", "exe:desconhecido.exe"]);

  await new Promise((r) => setTimeout(r, 200)); // várias varreduras depois
  const status = await (await fetch(`${s.base}/modules/games/status`)).json();
  assert.equal(status.activeSession.slug, "hollow-knight", "a detecção não reverteu a escolha");
  const sessions = (await (await fetch(`${s.base}/modules/games/sessions`)).json()).sessions;
  assert.equal(sessions.length, 1, "sem sessão duplicada");
  const mapping = (await (await fetch(`${s.base}/modules/games/mappings`)).json()).mappings.find((m: { detectionKey: string }) => m.detectionKey === "exe:desconhecido.exe");
  assert.deepEqual([mapping.slug, mapping.origin], ["hollow-knight", "manual"]);
  const dock = await (await fetch(`${s.base}/modules/dock/state`)).json();
  assert.equal(dock.game.title, "Hollow Knight");
  const controls = await (await fetch(`${s.base}/modules/dock/controls`)).json();
  assert.deepEqual(controls.games.map((g: { slug: string }) => g.slug), ["hollow-knight", "metro-last-light"]);
});

test("CUSTOM: escolhida do site ou pelo nome → evento → site → alerta; duplicata, teste isolado e validações", { timeout: 30_000 }, async (t) => {
  const s = await agentSetup(t);
  await s.wait(async () => (await (await fetch(`${s.base}/modules/dock/controls`)).json()).games.length === 2);

  const list = await (await fetch(`${s.base}/modules/achievements/site?slug=hollow-knight`)).json();
  assert.deepEqual(list.achievements.map((a: { id: string }) => a.id), ["hk-custom", "hk-1"], "CUSTOM primeiro; ocultas ficam de fora");

  // Escolhida da lista publicada: id canônico, nome/descrição/imagem reais.
  const picked = await s.post("/modules/achievements/custom", { slug: "hollow-knight", achievementId: "hk-custom" });
  assert.equal(picked.status, 201);
  const pickedBody = await picked.json();
  assert.equal(pickedBody.resolvedAs, "site");
  assert.deepEqual(
    [pickedBody.event.payload.provider, pickedBody.event.payload.name, pickedBody.event.payload.image, pickedBody.event.payload.isCustom],
    ["site", "Custom", "https://cdn.example/hk.png", true],
  );
  assert.equal((await (await s.post("/modules/achievements/custom", { slug: "hollow-knight", achievementId: "hk-custom" })).json()).created, false, "duplicata");
  // Pelo nome de uma CUSTOM que já existe: vira o id canônico e também é duplicata.
  const byName = await (await s.post("/modules/achievements/custom", { slug: "hollow-knight", name: "  custom " })).json();
  assert.equal(byName.created, false);

  await s.wait(() => s.agent.events.list({ type: "achievement.unlocked" })[0]?.status === "completed");
  const hk = s.db.achievements.find((a) => a.legacy_id === "hk-custom")!;
  assert.equal(s.db.progress.get(hk.id)?.status, "completed", "registrado no site pelo fluxo existente");

  // Alerta na fila com os dados reais.
  await s.wait(async () => ((await (await fetch(`${s.base}/modules/alerts/list`)).json()).alerts as Alert[]).length === 1);
  const alert = ((await (await fetch(`${s.base}/modules/alerts/list`)).json()).alerts as Alert[])[0];
  assert.deepEqual([alert.title, alert.payload.image, alert.payload.isCustom, alert.payload.gameTitle], ["Custom", "https://cdn.example/hk.png", true, "Hollow Knight"]);

  // CUSTOM nova (não publicada): provedor "custom"; o site não cria, responde unmatched com orientação.
  const fresh = await (await s.post("/modules/achievements/custom", { slug: "hollow-knight", name: "Sem dano no chefe", description: "Na live" })).json();
  assert.deepEqual([fresh.created, fresh.resolvedAs, fresh.event.payload.provider], [true, "custom", "custom"]);
  await s.wait(() => s.agent.events.get(fresh.event.id)!.status === "failed");
  assert.match(s.agent.events.get(fresh.event.id)!.lastError ?? "", /Crie-a no site/);
  assert.equal(s.db.achievements.length, 6, "o site não ganhou conquista inventada");

  // Teste: alerta com selo, nada no site, e não ocupa a vaga do desbloqueio real.
  const test1 = await (await s.post("/modules/achievements/custom", { slug: "hollow-knight", name: "Sem dano no chefe", isTest: true })).json();
  const test2 = await (await s.post("/modules/achievements/custom", { slug: "hollow-knight", name: "Sem dano no chefe", isTest: true })).json();
  assert.ok(test1.created && test2.created && test1.event.dedupeKey !== fresh.event.dedupeKey);
  await s.wait(() => s.agent.events.get(test1.event.id)!.status === "completed");
  assert.equal((s.agent.events.get(test1.event.id)!.result as { result: string }).result, "skipped_test");

  // Validações.
  assert.equal((await s.post("/modules/achievements/custom", { slug: "jogo-fora", name: "X" })).status, 404);
  assert.equal((await s.post("/modules/achievements/custom", { slug: "hollow-knight", achievementId: "nao-existe" })).status, 404);
  assert.equal((await s.post("/modules/achievements/custom", { slug: "hollow-knight" })).status, 400);
  assert.equal((await s.post("/modules/achievements/custom", { slug: "hollow-knight", name: "X".repeat(121) })).status, 400);
  assert.equal((await s.post("/modules/achievements/custom", { slug: "hollow-knight", name: "Y" }, { origin: "https://evil.example" })).status, 403);
});

test("site: provedor custom casa só CUSTOM do jogo pelo título exato, nunca cria", async () => {
  const db = sampleDb();
  const call = async (body: Record<string, unknown>) =>
    (await handleAgentAchievementUnlock(
      new Request("http://s/api/agent/achievements", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ eventId: randomUUID(), provider: "custom", gameSlug: "hollow-knight", name: null, unlockedAt: new Date().toISOString(), timestampKind: "detected", detectedLive: true, ...body }),
      }),
      { store: memoryStore(db), expectedToken: TOKEN },
    ).then((r) => r.json())) as { result: string };
  assert.equal((await call({ externalId: "CUSTOM" })).result, "unlocked", "título normalizado");
  assert.equal((await call({ externalId: "Custom" })).result, "already_completed");
  assert.equal((await call({ externalId: "Falso Cavaleiro" })).result, "unmatched", "não alcança conquista oficial");
  assert.equal((await call({ externalId: "Inexistente" })).result, "unmatched");
  assert.equal(db.achievements.length, 6);
});

test("dock: script dos controles só escreve texto e não conhece credenciais; sync aceita provedor custom", async () => {
  assert.doesNotThrow(() => new Function(DOCK_JS));
  assert.doesNotMatch(DOCK_JS, /innerHTML|insertAdjacentHTML|document\.write|token/i);
  assert.match(DOCK_JS, /\/modules\/games\/session\/correct/);
  const sent: unknown[] = [];
  const handler = createSiteSyncHandler({
    siteUrl: "http://s",
    token: () => TOKEN,
    site: null,
    slugForKey: () => null,
    fetchImpl: (async (_u: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ result: "unlocked" }), { status: 200 });
    }) as unknown as typeof fetch,
  });
  const event = operatorUnlockEvent({ slug: "hollow-knight", name: "Nova" });
  const result = await handler(
    { ...event, seq: 1, id: randomUUID(), status: "processing", attempts: 1, maxAttempts: 3, nextAttemptAt: 0, lockedAt: 0, lastError: null, result: null, occurredAt: 0, createdAt: 0, updatedAt: 0, completedAt: null } as never,
    { signal: new AbortController().signal, attempt: 1, log: silentLogger },
  );
  assert.equal(result.result, "unlocked");
  assert.equal((sent[0] as { provider: string }).provider, "custom");
});

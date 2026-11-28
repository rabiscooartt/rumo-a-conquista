// Fase 4.6 — clips automáticos locais pelo buffer de replay do OBS. OBS simulado (grava arquivos
// numa pasta temporária), SQLite real em pasta temporária, agente real para a integração.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../agent/src/store/database.ts";
import { EventStore, type NewEvent } from "../../agent/src/events/eventStore.ts";
import { StateStore } from "../../agent/src/store/stateStore.ts";
import { ClipStore } from "../../agent/src/modules/clips/clipStore.ts";
import { ClipEngine, CLIPS_FOLDER, type ClipSettings, type ReplayBackend } from "../../agent/src/modules/clips/engine.ts";
import { clipsModule } from "../../agent/src/modules/clips/index.ts";
import { achievementsModule } from "../../agent/src/modules/achievements/index.ts";
import { masteryModule } from "../../agent/src/modules/mastery/index.ts";
import { alertsModule } from "../../agent/src/modules/alerts/index.ts";
import { dockModule } from "../../agent/src/modules/dock/index.ts";
import { buildDockState } from "../../agent/src/modules/dock/state.ts";
import { DOCK_JS } from "../../agent/src/modules/dock/page.ts";
import { silentLogger } from "../../agent/src/logger.ts";
import { loadConfig } from "../../agent/src/config.ts";
import { Agent } from "../../agent/src/core/agent.ts";

const tmp = (t: { after: (fn: () => void) => void }, prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* temporária */ } }, 100).unref());
  return dir;
};
const wait = async (cond: () => boolean | Promise<boolean>, ms = 8_000) => {
  const deadline = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > deadline) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 15));
  }
};

/** OBS simulado: SaveReplayBuffer grava um arquivo novo (em duas etapas, como um arquivo crescendo). */
function fakeObs(recordDir: string) {
  const obs = {
    connected: true,
    available: true,
    active: true,
    seconds: 270 as number | null,
    last: null as string | null,
    saves: 0,
    failSave: false,
    backend: null as unknown as ReplayBackend,
  };
  obs.backend = {
    connected: () => obs.connected,
    status: async () => ({ available: obs.available, active: obs.available && obs.active }),
    bufferSeconds: async () => obs.seconds,
    recordDirectory: async () => recordDir,
    lastReplay: async () => obs.last,
    async save() {
      if (!obs.connected) throw new Error("OBS não está conectado");
      if (obs.failSave) throw new Error("falha simulada ao salvar");
      obs.saves += 1;
      const path = join(recordDir, `Replay ${obs.saves}.mp4`);
      writeFileSync(path, "a".repeat(500));
      obs.last = path;
      setTimeout(() => writeFileSync(path, "a".repeat(1000)), 20);
    },
  };
  return obs;
}

function engineSetup(t: { after: (fn: () => void) => void }, over: Partial<ClipSettings> = {}) {
  const root = tmp(t, "agent-clips-");
  const recordDir = join(root, "obs");
  mkdirSync(recordDir);
  const path = join(root, "agent.db");
  const settings: ClipSettings = { dir: null, preSeconds: 240, postSeconds: 0.05, minFreeBytes: 0, retryMs: 30, saveTimeoutMs: 1_000, settleMs: 30, pollMs: 20, ...over };
  const obs = fakeObs(recordDir);
  const open = () => {
    const db = openDatabase(path);
    const events = new EventStore(db, { maxAttempts: 5, retryBaseMs: 10, retryMaxMs: 10 });
    const store = new ClipStore(db);
    const state = new StateStore(db);
    const engine = new ClipEngine({ db, store, backend: obs.backend, log: silentLogger, settings: () => settings, cursor: { get: () => state.get<number>("c"), set: (v) => state.set("c", v) } });
    return { db, events, store, engine };
  };
  return { root, recordDir, obs, open, settings };
}

const unlock = (id: string, over: Record<string, unknown> = {}, isTest = false): NewEvent => ({
  type: "achievement.unlocked",
  dedupeKey: `achievement:op:site:hollow-knight:${id}`,
  isTest,
  payload: { provider: "site", sourceKey: "site:hollow-knight", gameSlug: "hollow-knight", externalId: id, name: `Conquista ${id}`, detectedAt: new Date().toISOString(), detectedLive: true, ...over },
});

test("ingestão: desbloqueio ao vivo vira clip agendado (evento + pós); offline, teste e repetição não; Maestria entra no clip do gatilho", (t) => {
  const s = engineSetup(t, { postSeconds: 30 });
  const { db, events, store, engine } = s.open();
  t.after(() => db.close());
  engine.initCursor();
  const live = events.record(unlock("a")).event;
  events.record(unlock("b", { detectedLive: false }));
  events.record(unlock("c", {}, true));
  events.record({ type: "mastery.achieved", dedupeKey: "mastery:hollow-knight", payload: { gameSlug: "hollow-knight", gameTitle: "Hollow Knight", eligible: 3, triggerEventId: live.id, detectedLive: true } });
  events.record({ type: "mastery.achieved", dedupeKey: "mastery:hades", payload: { gameSlug: "hades", gameTitle: "Hades", eligible: 2, triggerEventId: "sem-clip", detectedLive: true } });
  engine.ingest();
  engine.ingest();
  const clips = store.list();
  assert.equal(clips.length, 2, "um clip para o desbloqueio ao vivo e um para a Maestria sem gatilho");
  const a = clips.find((c) => c.sourceEventId === live.id)!;
  assert.equal(a.dueAt - a.eventAt, 30_000, "salva 30 s depois do evento");
  assert.deepEqual(a.payload.mastery, { gameTitle: "Hollow Knight", eligible: 3 }, "Maestria registrada no clip da conquista");
  assert.equal(clips.find((c) => c.kind === "mastery")!.gameSlug, "hades");
});

test("captura: salva o buffer, espera o arquivo terminar, move para <pasta>/<mês>/<jogo>/ com ficha .json; sem duplicata", async (t) => {
  const s = engineSetup(t);
  const { db, events, store, engine } = s.open();
  t.after(() => db.close());
  engine.initCursor();
  events.record(unlock("a"));
  engine.ingest();
  await new Promise((r) => setTimeout(r, 80));
  await engine.bufferInfo(true);
  const clip = (await engine.processNext())!;
  assert.equal(clip.status, "completed", clip.lastError ?? "");
  assert.equal(s.obs.saves, 1);
  assert.ok(clip.filePath!.startsWith(join(s.recordDir, CLIPS_FOLDER)), "padrão: dentro da pasta de gravação do OBS");
  assert.match(clip.filePath!, /[\\/]\d{4}-\d{2}[\\/]hollow-knight[\\/]\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_conquista_conquista-a_[0-9a-f]{8}\.mp4$/);
  assert.equal(readFileSync(clip.filePath!, "utf8").length, 1000, "arquivo completo (esperou terminar de escrever)");
  assert.equal(existsSync(s.obs.last!), false, "o replay original não fica para trás");
  const meta = JSON.parse(readFileSync(`${clip.filePath}.json`, "utf8"));
  assert.equal(meta.jogo, "hollow-knight");
  assert.equal(clip.sizeBytes, 1000);
  // Reingestão e nova rodada não geram outro clip.
  engine.ingest();
  assert.equal(await engine.processNext(), null);
  assert.equal(store.list().length, 1);
});

test("falhas: buffer desabilitado/desligado, OBS fora (adia e expira fora da janela), destino inválido, sem espaço — o replay nunca se perde", async (t) => {
  const s = engineSetup(t);
  const { db, store, engine } = s.open();
  t.after(() => db.close());
  await engine.bufferInfo(true);
  const add = (key: string, eventAt = Date.now()) => store.insert({ kind: "achievement", dedupeKey: key, gameSlug: "hk", title: key, payload: {}, eventAt, dueAt: eventAt }).clip;

  s.obs.available = false;
  const a = add("a");
  assert.equal((await engine.processNext())!.status, "failed");
  assert.match(store.get(a.id)!.lastError!, /desabilitado/);
  s.obs.available = true;
  s.obs.active = false;
  const b = add("b");
  await engine.processNext();
  assert.match(store.get(b.id)!.lastError!, /desligado/);
  s.obs.active = true;

  // OBS fora: adia dentro da janela; fora dela, expira (nunca salva um vídeo de outro momento).
  s.obs.connected = false;
  const c = add("c");
  assert.equal((await engine.processNext())!.status, "pending");
  assert.match(store.get(c.id)!.lastError!, /desconectado/);
  const old = add("old", Date.now() - 300_000);
  await new Promise((r) => setTimeout(r, 40));
  await engine.processNext(); // c (adiado) ou old
  await engine.processNext();
  assert.equal(store.get(old.id)!.status, "expired");
  s.obs.connected = true;
  await wait(async () => (await engine.processNext(), store.get(c.id)!.status === "completed"));

  // Destino inválido (um arquivo no lugar da pasta): falha definitiva, replay preservado e informado.
  writeFileSync(join(s.root, "arquivo"), "x");
  s.settings.dir = join(s.root, "arquivo");
  const d = add("d");
  await engine.processNext();
  assert.equal(store.get(d.id)!.status, "failed");
  const kept = /ficou em (.+)$/.exec(store.get(d.id)!.lastError!)![1];
  assert.ok(existsSync(kept), "o replay continua no disco");
  // Sem espaço livre suficiente.
  s.settings.dir = join(s.root, "clips");
  s.settings.minFreeBytes = Number.MAX_SAFE_INTEGER;
  const e = add("e");
  await engine.processNext();
  assert.match(store.get(e.id)!.lastError!, /Espaço insuficiente/);
  // Erro no OBS ao salvar: adia (não derruba nada).
  s.settings.minFreeBytes = 0;
  s.obs.failSave = true;
  const f = add("f");
  assert.equal((await engine.processNext())!.status, "pending");
  assert.match(store.get(f.id)!.lastError!, /falha simulada/);
});

test("recuperação: agente cai com o replay já salvo → retoma só a mudança de pasta; sem replay e fora da janela → expirado", async (t) => {
  const s = engineSetup(t);
  const first = s.open();
  await first.engine.bufferInfo(true);
  const a = first.store.insert({ kind: "achievement", dedupeKey: "a", gameSlug: "hk", title: "a", payload: {}, eventAt: Date.now(), dueAt: Date.now() }).clip;
  const b = first.store.insert({ kind: "achievement", dedupeKey: "b", gameSlug: "hk", title: "b", payload: {}, eventAt: Date.now() - 900_000, dueAt: Date.now() }).clip;
  first.store.claimDue();
  const saved = join(s.recordDir, "Replay salvo.mp4");
  writeFileSync(saved, "z".repeat(700));
  first.store.setObsPath(a.id, saved);
  first.db.close(); // caiu entre salvar e mover

  const second = s.open();
  t.after(() => second.db.close());
  second.store.claimDue(); // b também ficou "saving"
  second.db.prepare("UPDATE clips SET status = 'saving' WHERE id = ?").run(b.id);
  second.db.prepare("UPDATE clips SET status = 'saving' WHERE id = ?").run(a.id);
  await second.engine.bufferInfo(true);
  second.engine.recover();
  assert.equal(second.store.get(b.id)!.status, "expired");
  await wait(async () => (await second.engine.processNext(), second.store.get(a.id)!.status === "completed"));
  assert.equal(s.obs.saves, 0, "não salvou o buffer de novo");
  assert.equal(readFileSync(second.store.get(a.id)!.filePath!, "utf8").length, 700);
});

test("dock: estado compacto do buffer e dos clips", () => {
  const base = {
    now: 0, version: "x", uptimeSeconds: 1, games: null,
    obs: { state: "connected", detail: {} }, site: { state: "connected", detail: {} },
    sync: { tokenConfigured: true, counts: {}, lastError: null },
  } as unknown as Parameters<typeof buildDockState>[0];
  const counts = { pending: 0, saving: 0, completed: 2, failed: 0, expired: 0 };
  const clips = { enabled: true, obs: true, bufferAvailable: true, bufferActive: true, bufferSeconds: 270, preSeconds: 240, postSeconds: 30, dir: "G:/Clips", counts, last: null, lastError: null };
  const item = (over: Record<string, unknown>) => buildDockState({ ...base, clips: { ...clips, ...over } as never }).clips;
  assert.deepEqual([item({}).level, item({}).label, item({}).detail], ["ok", "Buffer ativo", "270s · G:/Clips"]);
  assert.equal(item({ bufferAvailable: false }).label, "Buffer desabilitado");
  assert.equal(item({ bufferActive: false }).label, "Buffer desligado");
  assert.equal(item({ bufferSeconds: 20 }).label, "Buffer curto");
  assert.equal(item({ counts: { ...counts, failed: 1 }, lastError: "sem espaço" }).detail, "sem espaço");
  assert.equal(item({ enabled: false }).level, "idle");
  assert.match(DOCK_JS, /\/modules\/clips\/test/);
});

test("integração: clip independe dos alertas e da Maestria; teste isolado sem evento; falha de clip não afeta alertas", { timeout: 30_000 }, async (t) => {
  const root = tmp(t, "agent-clips-e2e-");
  const recordDir = join(root, "obs");
  mkdirSync(recordDir);
  const obs = fakeObs(recordDir);
  const site = createServer((_req, res) => res.end());
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  t.after(() => site.close());
  const config = loadConfig({
    dataDir: join(root, "data"),
    env: {
      RUMO_AGENT_OBS_ENABLED: "false", RUMO_AGENT_GAMES_ENABLED: "false", RUMO_AGENT_ACHIEVEMENTS_ENABLED: "false",
      RUMO_AGENT_CONTROL_PORT: "0", RUMO_AGENT_SITE_URL: `http://127.0.0.1:${(site.address() as AddressInfo).port}`,
    },
    overrides: { clipPostSeconds: 0 },
  });
  Object.assign(config.events, { pollIntervalMs: 20 });
  const agent = new Agent({
    config,
    log: silentLogger,
    modules: [
      achievementsModule({ providers: [] }),
      masteryModule(),
      clipsModule({ backend: () => obs.backend, settings: { pollMs: 20, settleMs: 30, retryMs: 50, statusMs: 50, testPostMs: 50 } }),
      alertsModule({ settings: { pollMs: 20 } }),
      dockModule(),
    ],
  });
  await agent.start();
  t.after(() => agent.stop("fim"));
  const base = `http://127.0.0.1:${agent.controlPort}`;
  const token = readFileSync(join(root, "data", "control-token"), "utf8");
  const unlockApi = (id: string) =>
    fetch(`${base}/modules/achievements/unlock`, { method: "POST", headers: { "x-agent-token": token }, body: JSON.stringify({ slug: "hollow-knight", achievementId: id }) });
  const clips = async () => (await (await fetch(`${base}/modules/clips/list`)).json()).clips as Array<{ status: string; isTest: boolean; filePath: string | null; kind: string }>;
  const alerts = async () => (await (await fetch(`${base}/modules/alerts/list`)).json()).alerts as Array<{ status: string }>;

  // Sem overlay (alerta parado na fila) o clip sai do mesmo jeito.
  await unlockApi("hk-1");
  await wait(async () => (await clips())[0]?.status === "completed");
  assert.equal((await alerts())[0].status, "pending", "o alerta segue esperando o overlay; o clip não esperou");

  // Falha do clip (OBS falhando ao salvar) não afeta a fila de alertas.
  obs.failSave = true;
  await unlockApi("hk-2");
  await wait(async () => (await alerts()).length === 2);
  await wait(async () => (await clips()).length === 2);
  assert.equal((await clips())[0].status, "pending");
  obs.failSave = false;
  await wait(async () => (await clips())[0].status === "completed");

  // Teste isolado: replay real na subpasta testes, sem evento nem conquista; contagens reais intactas.
  const eventsBefore = agent.events.list({}).length;
  const r = await fetch(`${base}/modules/clips/test`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(r.status, 201);
  await wait(async () => (await clips())[0].isTest && (await clips())[0].status === "completed");
  const testClip = (await clips())[0];
  assert.ok(testClip.filePath!.includes(join(CLIPS_FOLDER, "testes")));
  assert.equal(agent.events.list({}).length, eventsBefore, "nenhum evento criado");
  const status = await (await fetch(`${base}/modules/clips/status`)).json();
  assert.equal(status.counts.completed, 2, "teste fora das contagens reais");
  assert.equal(readdirSync(recordDir).filter((f) => f.endsWith(".mp4")).length, 0, "nada largado na pasta do OBS");

  // Buffer desligado: o teste recusa com a orientação; origem externa recusada.
  obs.active = false;
  const off = await fetch(`${base}/modules/clips/test`, { method: "POST", body: "{}" });
  assert.equal(off.status, 409);
  assert.match((await off.json()).error, /desligado/);
  assert.equal((await fetch(`${base}/modules/clips/test`, { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" })).status, 403);
  const dock = await (await fetch(`${base}/modules/dock/state`)).json();
  await wait(async () => (await (await fetch(`${base}/modules/dock/state`)).json()).clips.label === "Buffer desligado");
  void dock;
});

test("configuração: padrões 240 s antes, 30 s depois, 2 GB livres; validações", (t) => {
  const dir = tmp(t, "agent-clips-cfg-");
  const c = loadConfig({ dataDir: dir, env: {} });
  assert.deepEqual(c.clips, { enabled: true, dir: null, preSeconds: 240, postSeconds: 30, minFreeBytes: 2048 * 1024 * 1024 });
  assert.equal(loadConfig({ dataDir: dir, env: { RUMO_AGENT_CLIPS_DIR: "D:/Clips" } }).clips.dir, "D:/Clips");
  assert.throws(() => loadConfig({ dataDir: dir, env: {}, overrides: { clipPostSeconds: -1 } }), /clipPostSeconds/);
  assert.throws(() => loadConfig({ dataDir: dir, env: {}, overrides: { clipPreSeconds: 1.5 } }), /clipPreSeconds/);
});

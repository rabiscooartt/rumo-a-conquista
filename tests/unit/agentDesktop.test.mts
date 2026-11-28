// Parte A do plano de captura híbrida — aplicativo de desktop: momentos (atalho), configurações
// preservando segredos e supervisor do agente. Tudo em pastas temporárias e portas livres.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../../agent/src/config.ts";
import { Agent } from "../../agent/src/core/agent.ts";
import { silentLogger } from "../../agent/src/logger.ts";
import { momentsModule, MOMENT_DEBOUNCE_MS } from "../../agent/src/modules/moments/index.ts";
import { CONFIG_FIELDS, readAgentConfig, validateSettings, writeAgentConfig } from "../../desktop/src/settings-store.js";
import { AgentSupervisor } from "../../desktop/src/supervisor.js";

const tmp = (t: { after: (fn: () => void) => void }, prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* temporária */ } }, 200).unref());
  return dir;
};
const wait = async (cond: () => boolean | Promise<boolean>, ms = 15_000) => {
  const deadline = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > deadline) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
};

test("momentos: atalho registra instante e jogo, pede o clip, ignora toque duplo e exige token", { timeout: 30_000 }, async (t) => {
  const dir = tmp(t, "agent-moments-");
  const site = createServer((_req, res) => res.end());
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  t.after(() => site.close());
  const config = loadConfig({
    dataDir: dir,
    env: { RUMO_AGENT_OBS_ENABLED: "false", RUMO_AGENT_GAMES_ENABLED: "false", RUMO_AGENT_ACHIEVEMENTS_ENABLED: "false", RUMO_AGENT_CONTROL_PORT: "0", RUMO_AGENT_SITE_URL: `http://127.0.0.1:${(site.address() as AddressInfo).port}` },
  });
  let clock = Date.parse("2026-11-27T21:00:00Z");
  const clipRequests: unknown[] = [];
  const fakeServices = {
    name: "fakes",
    start(ctx: { services: { provide: (n: string, s: unknown) => void } }) {
      ctx.services.provide("games", { activeSession: () => ({ id: "s1", slug: "the-surge", title: "The Surge", detectionKey: "exe:TheSurge.exe" }) });
      ctx.services.provide("clips", { summary: () => null, requestMoment: (input: unknown) => (clipRequests.push(input), { id: "clip-1" }) });
    },
  };
  const agent = new Agent({ config, log: silentLogger, modules: [fakeServices as never, momentsModule({ now: () => clock })] });
  await agent.start();
  t.after(() => agent.stop("fim"));
  const base = `http://127.0.0.1:${agent.controlPort}`;
  const token = readFileSync(join(dir, "control-token"), "utf8");
  const mark = (headers: Record<string, string> = { "x-agent-token": token }) =>
    fetch(`${base}/modules/moments/mark`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ source: "atalho" }) });

  assert.equal((await mark({})).status, 401, "sem token (página web) não marca");
  const first = await mark();
  assert.equal(first.status, 201);
  const body = await first.json();
  assert.deepEqual([body.moment.gameSlug, body.moment.gameTitle, body.moment.sessionId, body.moment.clipId, body.moment.source], ["the-surge", "The Surge", "s1", "clip-1", "atalho"]);
  assert.deepEqual(clipRequests[0], { momentId: body.moment.id, markedAt: clock, gameSlug: "the-surge", title: "Momento The Surge" });

  clock += MOMENT_DEBOUNCE_MS - 1;
  assert.equal((await mark()).status, 200, "toque duplo em menos de 3 s é ignorado");
  clock += 2;
  assert.equal((await mark()).status, 201);
  const list = await (await fetch(`${base}/modules/moments/list`)).json();
  assert.equal(list.pending, 2);
  assert.equal(clipRequests.length, 2);
});

test("configurações: grava só os campos da janela, preserva segredos e valida", (t) => {
  const dir = tmp(t, "desktop-settings-");
  const secrets = { obsPassword: "segredo-obs", siteAgentToken: "x".repeat(40), siteUrl: "https://exemplo.com", clipPreSeconds: 240 };
  writeFileSync(join(dir, "config.json"), JSON.stringify(secrets));
  const current = readAgentConfig(dir);
  assert.equal("obsPassword" in current, false, "segredos nunca vão para a janela");
  assert.equal(current.controlPort, 47821);

  assert.equal(writeAgentConfig(dir, { ...current }), false, "sem mudança, não grava");
  assert.equal(writeAgentConfig(dir, { ...current, clipPostSeconds: 45, clipsDir: "D:/Clips" }), true);
  const saved = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
  assert.deepEqual([saved.obsPassword, saved.siteAgentToken, saved.siteUrl, saved.clipPostSeconds, saved.clipsDir], [secrets.obsPassword, secrets.siteAgentToken, secrets.siteUrl, 45, "D:/Clips"]);
  writeAgentConfig(dir, { ...readAgentConfig(dir), clipsDir: "" });
  assert.equal("clipsDir" in JSON.parse(readFileSync(join(dir, "config.json"), "utf8")), false, "pasta vazia volta ao padrão");
  // O agente aceita o que a janela grava.
  assert.equal(loadConfig({ dataDir: dir, env: {} }).clips.postSeconds, 45);

  const ok = { agent: Object.fromEntries(CONFIG_FIELDS.map((f) => [f.key, f.default])), desktop: { hotkey: "Pause" } };
  assert.deepEqual(validateSettings(ok), []);
  assert.equal(validateSettings({ ...ok, agent: { ...ok.agent, alertDisplaySeconds: 50 } }).length, 1);
  assert.equal(validateSettings({ ...ok, desktop: { hotkey: "Control+Alt+<script>" } }).length, 1);
  assert.deepEqual(validateSettings({ ...ok, desktop: { hotkey: "" } }), [], "vazio desativa o atalho");
});

test("supervisor: inicia o agente real, reinicia se cair, conecta sem assumir quando já existe e encerra limpo", { timeout: 90_000 }, async (t) => {
  const dir = tmp(t, "desktop-supervisor-");
  writeFileSync(join(dir, "config.json"), JSON.stringify({ controlPort: 0, obsEnabled: false, gamesEnabled: false, achievementsEnabled: false, clipsEnabled: false, siteUrl: "https://exemplo.com" }));
  const make = () =>
    new AgentSupervisor({ agentDir: resolve("agent"), dataDir: dir, nodeExecutable: process.execPath, restartDelaysMs: [200] });
  const sup = make();
  t.after(() => sup.stop({ force: true }));
  await sup.ensure();
  await wait(() => sup.state === "running");
  const firstPid = sup.liveLock().pid;
  assert.equal((await sup.request("GET", "/status")).agent.state, "running");

  // Outro aplicativo (ou o CLI) encontra o agente já rodando: só se conecta.
  const other = make();
  await other.ensure();
  assert.equal(other.state, "attached");
  await other.stop();
  assert.ok(sup.liveLock(), "quem só se conectou não derruba o agente");

  // O agente cai: o supervisor reinicia.
  sup.child!.kill();
  await wait(() => sup.state === "running" && sup.liveLock()?.pid !== firstPid);

  await sup.stop();
  assert.equal(sup.state, "stopped");
  await wait(() => !sup.liveLock());
});

test("atalho: qualquer tecla do teclado vira o código do Windows (inclusive Pause, que o Electron não aceita)", async () => {
  const { parseHotkey } = await import("../../desktop/src/hotkey.js");
  assert.deepEqual(parseHotkey("Pause"), { mods: 0, vk: 0x13 }, "Pause sozinha");
  assert.deepEqual(parseHotkey("Control+Alt+F9"), { mods: 0x3, vk: 0x78 });
  assert.deepEqual(parseHotkey("Shift+PrintScreen"), { mods: 0x4, vk: 0x2c });
  assert.deepEqual(parseHotkey("num5"), { mods: 0, vk: 0x65 });
  assert.deepEqual(parseHotkey("m"), { mods: 0, vk: 0x4d });
  assert.equal(parseHotkey("Control+Batata"), null);
  assert.equal(parseHotkey("Hiper+A"), null);
  assert.equal(parseHotkey(""), null);
});

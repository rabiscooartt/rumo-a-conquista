// Fase 4.1 — dock do OBS: resumo de estado (níveis verde/âmbar/vermelho/cinza) e rotas servidas
// pela API local do agente (página, script, estado), sem token e só leitura.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDockState, type DockInput } from "../../agent/src/modules/dock/state.ts";
import { DOCK_JS } from "../../agent/src/modules/dock/page.ts";
import { dockModule } from "../../agent/src/modules/dock/index.ts";
import { gamesModule, type GamesStatus } from "../../agent/src/modules/games/index.ts";
import type { ConnectionStatus } from "../../agent/src/connections/managedConnection.ts";
import type { ResolvedGame } from "../../agent/src/modules/games/detector.ts";
import { loadConfig } from "../../agent/src/config.ts";
import { Agent } from "../../agent/src/core/agent.ts";
import { silentLogger } from "../../agent/src/logger.ts";

const conn = (state: ConnectionStatus["state"], over: Partial<ConnectionStatus> = {}): ConnectionStatus => ({
  name: "x", state, since: 0, lastConnectedAt: null, lastError: null, consecutiveFailures: 0, nextRetryAt: null, detail: {}, ...over,
});
const resolved = (slug: string | null): ResolvedGame => ({
  key: "steam:1", source: "steam", label: "Hades", pid: null, exe: null, identity: slug ? `game:${slug}` : "steam:1",
  slug, title: "Hades", resolvedBy: slug ? "auto" : "unresolved", mappingKey: "steam:1",
});
const games = (over: Partial<GamesStatus> = {}): GamesStatus => ({
  enabled: true, current: null, lastScanAt: null, lastScanError: null, pendingStart: null, activeSession: null, warnings: [], ...over,
});
const session = (slug: string | null) => ({
  id: "s1", identity: slug ? `game:${slug}` : "steam:1", detectionKey: "steam:1", source: "steam", slug, title: "Hades",
  startedAt: Date.parse("2026-11-24T20:00:00Z"), lastSeenAt: 0, endedAt: null, endReason: null, detail: {},
});
const input = (over: Partial<DockInput> = {}): DockInput => ({
  now: Date.parse("2026-11-24T21:00:00Z"),
  version: "0.1.0",
  uptimeSeconds: 60,
  games: games(),
  obs: conn("connected", { detail: { obsVersion: "33.0.3" } }),
  site: conn("connected"),
  sync: { tokenConfigured: true, counts: {}, lastError: null },
  ...over,
});

test("tudo normal: verde, com versão do OBS comprovada", () => {
  const s = buildDockState(input({ games: games({ current: resolved("hades"), activeSession: session("hades") }) }));
  assert.equal(s.overall, "ok");
  assert.deepEqual([s.game.title, s.game.sessionLabel, s.game.level], ["Hades", "Sessão ativa", "ok"]);
  assert.equal(s.game.sessionStartedAt, "2026-11-24T20:00:00.000Z");
  assert.deepEqual([s.obs.level, s.obs.label, s.obs.detail], ["ok", "Conectado", "OBS 33.0.3"]);
  assert.deepEqual([s.site.label, s.sync.label], ["Online", "Em dia"]);
});

test("estados do jogo: sem jogo, confirmando, fora do catálogo, fora de vista, falha e desativado", () => {
  assert.deepEqual(pick(buildDockState(input()).game), ["idle", null, "Nenhum jogo em execução"]);
  const pending = buildDockState(input({ games: games({ current: resolved("hades"), pendingStart: { identity: "game:hades", firstSeenAt: 0 } }) })).game;
  assert.deepEqual(pick(pending), ["warn", "Hades", "Confirmando sessão…"]);
  const outside = buildDockState(input({ games: games({ current: resolved(null), activeSession: session(null) }) })).game;
  assert.equal(outside.level, "warn");
  assert.match(outside.detail ?? "", /fora do catálogo/);
  const away = buildDockState(input({ games: games({ activeSession: session("hades") }) })).game;
  assert.deepEqual(pick(away), ["warn", "Hades", "Sessão ativa (jogo fora de vista)"]);
  assert.equal(buildDockState(input({ games: games({ lastScanError: "tasklist falhou" }) })).game.level, "error");
  assert.equal(buildDockState(input({ games: games({ enabled: false }) })).game.level, "idle");
  assert.equal(buildDockState(input({ games: null })).game.sessionLabel, "Identificação desativada");
});
const pick = (g: { level: string; title: string | null; sessionLabel: string }) => [g.level, g.title, g.sessionLabel];

test("conexões: desativada é cinza e não piora o geral; reconexão é âmbar e vira vermelho após falhas seguidas", () => {
  let s = buildDockState(input({ obs: conn("disabled") }));
  assert.deepEqual([s.obs.level, s.overall], ["idle", "ok"]);
  s = buildDockState(input({ obs: conn("reconnecting", { consecutiveFailures: 1, lastError: "OBS inacessível" }) }));
  assert.deepEqual([s.obs.level, s.obs.label, s.obs.detail, s.overall], ["warn", "Reconectando…", "OBS inacessível", "warn"]);
  s = buildDockState(input({ obs: conn("reconnecting", { consecutiveFailures: 3 }) }));
  assert.deepEqual([s.obs.level, s.obs.label, s.overall], ["error", "Sem conexão", "error"]);
  s = buildDockState(input({ obs: conn("connected"), site: conn("connecting") }));
  assert.equal(s.obs.detail, null, "sem versão comprovada, não inventa detalhe");
  assert.deepEqual([s.site.level, s.site.label], ["warn", "Conectando…"]);
});

test("sincronização: sem token, fila com site fora, fila com site online e falhas", () => {
  assert.equal(buildDockState(input({ sync: { tokenConfigured: false, counts: {}, lastError: null } })).sync.label, "Não configurada");
  const offline = buildDockState(input({ site: conn("reconnecting", { consecutiveFailures: 1 }), sync: { tokenConfigured: true, counts: { retry_wait: 2, pending: 1 }, lastError: null } }));
  assert.deepEqual([offline.sync.level, offline.sync.label], ["warn", "3 aguardando"]);
  const sending = buildDockState(input({ sync: { tokenConfigured: true, counts: { processing: 1 }, lastError: null } }));
  assert.deepEqual([sending.sync.level, sending.sync.label], ["ok", "Enviando 1"]);
  const failed = buildDockState(input({ sync: { tokenConfigured: true, counts: { failed: 2, completed: 9 }, lastError: "Site recusou (unmatched)" } }));
  assert.deepEqual([failed.sync.level, failed.sync.label, failed.sync.detail], ["warn", "2 com falha", "Site recusou (unmatched)"]);
});

test("script do dock é JavaScript válido e só escreve texto (nunca HTML)", () => {
  assert.doesNotThrow(() => new Function(DOCK_JS));
  assert.doesNotMatch(DOCK_JS, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
  assert.doesNotMatch(DOCK_JS, /token|x-agent-token/i, "o dock não usa nem conhece o token");
  assert.match(DOCK_JS, /fetch\("\.\/state"/);
});

test("rotas do dock no agente: página, recursos, estado real do jogo/sessão e segurança", { timeout: 30_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "agent-dock-"));
  t.after(() => setTimeout(() => rmSync(dir, { recursive: true, force: true }), 50).unref());
  const site = createServer((_req, res) => res.end());
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  t.after(() => site.close());
  const config = loadConfig({
    dataDir: dir,
    env: { RUMO_AGENT_OBS_ENABLED: "false", RUMO_AGENT_CONTROL_PORT: "0", RUMO_AGENT_SITE_URL: `http://127.0.0.1:${(site.address() as AddressInfo).port}` },
  });
  Object.assign(config.games, { pollMs: 40, startConfirmMs: 80 });
  const procs: { name: string; pid: number }[] = [];
  const signals = { listProcesses: async () => procs, steamRunningAppId: async () => 0, steamPath: async () => null, windowTitle: async () => null };
  const catalog = (async () => new Response(JSON.stringify({ games: [{ slug: "hades", title: "Hades" }] }), { status: 200 })) as unknown as typeof fetch;
  const agent = new Agent({ config, log: silentLogger, modules: [gamesModule({ signals, fetchImpl: catalog }), dockModule()] });
  await agent.start();
  t.after(() => agent.stop("fim"));
  const base = `http://127.0.0.1:${agent.controlPort}/modules/dock`;
  const token = readFileSync(join(dir, "control-token"), "utf8");

  const redirect = await fetch(base, { redirect: "manual" });
  assert.deepEqual([redirect.status, redirect.headers.get("location")], [302, "/modules/dock/"]);
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /text\/html/);
  assert.match(page.headers.get("content-security-policy") ?? "", /script-src 'self'/);
  const html = await page.text();
  assert.match(html, /RUMO À CONQUISTA/);
  assert.ok(!html.includes(token), "o token local nunca vai para o HTML");
  assert.match((await fetch(`${base}/dock.js`)).headers.get("content-type") ?? "", /javascript/);
  assert.match((await fetch(`${base}/dock.css`)).headers.get("content-type") ?? "", /text\/css/);
  assert.equal((await fetch(`${base}/state`, { method: "POST" })).status, 404, "dock só lê");

  const state = async () => (await (await fetch(`${base}/state`)).json()) as ReturnType<typeof buildDockState>;
  let s = await state();
  assert.equal(s.game.sessionLabel, "Nenhum jogo em execução");
  assert.deepEqual([s.obs.level, s.sync.label], ["idle", "Não configurada"]);

  // Mapeia um executável e "abre o jogo": o estado do dock acompanha sozinho.
  await fetch(`http://127.0.0.1:${agent.controlPort}/modules/games/mappings`, {
    method: "POST",
    headers: { "x-agent-token": token },
    body: JSON.stringify({ key: "exe:Hades.exe", slug: "hades" }),
  });
  procs.push({ name: "Hades.exe", pid: 7 });
  const deadline = Date.now() + 10_000;
  while ((s = await state()).game.sessionLabel !== "Sessão ativa") {
    if (Date.now() > deadline) throw new Error(`sessão não apareceu no dock: ${JSON.stringify(s.game)}`);
    await new Promise((r) => setTimeout(r, 40));
  }
  assert.deepEqual([s.game.title, s.game.slug, s.game.level], ["Hades", "hades", "ok"]);
  assert.equal(s.agent.label, "Em execução");
});

test("linha de alertas: sem apresentador é cinza; apresentando e fila são verdes; falha é âmbar", () => {
  const counts = (over: Record<string, number> = {}) => ({ pending: 0, processing: 0, retry_wait: 0, completed: 0, failed: 0, expired: 0, ...over });
  let s = buildDockState(input({ alerts: { presenter: null, current: null, counts: counts({ pending: 2 }) } }));
  assert.deepEqual([s.alerts.level, s.alerts.label, s.overall], ["idle", "2 na fila", "ok"]);
  s = buildDockState(input({ alerts: { presenter: "overlay", current: "a1", counts: counts({ processing: 1, pending: 1 }) } }));
  assert.deepEqual([s.alerts.level, s.alerts.label, s.alerts.detail], ["ok", "Apresentando", "1 na fila"]);
  s = buildDockState(input({ alerts: { presenter: "overlay", current: null, counts: counts() } }));
  assert.deepEqual([s.alerts.level, s.alerts.label], ["ok", "Fila vazia"]);
  s = buildDockState(input({ alerts: { presenter: "overlay", current: null, counts: counts({ failed: 1 }) } }));
  assert.deepEqual([s.alerts.level, s.alerts.label, s.overall], ["warn", "1 com falha", "warn"]);
  assert.equal(buildDockState(input()).alerts.label, "—");
});

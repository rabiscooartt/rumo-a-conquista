// Ciclo de vida do agente: início/encerramento controlados, API local, instância única
// e recuperação após queda real do processo (kill sem encerramento controlado).
// O "site" é um servidor HTTP local e o OBS fica desativado: nenhum acesso externo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../agent/src/config.ts";
import { Agent } from "../../agent/src/core/agent.ts";
import { AlreadyRunningError, readLiveLock } from "../../agent/src/core/instanceLock.ts";
import { defaultModules } from "../../agent/src/modules/index.ts";
import { createLogger, type LogRecord } from "../../agent/src/logger.ts";
import { openDatabase } from "../../agent/src/store/database.ts";
import { StateStore } from "../../agent/src/store/stateStore.ts";
import { EventStore } from "../../agent/src/events/eventStore.ts";

const MAIN = fileURLToPath(new URL("../../agent/src/main.ts", import.meta.url));

async function fakeSite(t: { after: (fn: () => void) => void }) {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function tempDir(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "agent-life-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

async function waitFor<T>(fn: () => T | Promise<T>, timeoutMs = 15_000): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await fn();
      if (value) return value as NonNullable<T>;
    } catch {
      // ainda não pronto
    }
    if (Date.now() > deadline) throw new Error("Tempo esgotado esperando condição");
    await new Promise((r) => setTimeout(r, 100));
  }
}

test("agente em processo: inicia, expõe API local protegida, deduplica, encerra limpo", async (t) => {
  const dir = tempDir(t);
  const siteUrl = await fakeSite(t);
  const env = { RUMO_AGENT_SITE_URL: siteUrl, RUMO_AGENT_OBS_ENABLED: "false", RUMO_AGENT_CONTROL_PORT: "0", RUMO_AGENT_GAMES_ENABLED: "false" };
  const config = loadConfig({ dataDir: dir, env });
  const records: LogRecord[] = [];
  const log = createLogger({ level: "debug", sinks: [(r) => records.push(r)] });
  const agent = new Agent({ config, log, modules: defaultModules() });
  await agent.start();
  t.after(() => agent.stop("fim do teste"));

  const base = `http://127.0.0.1:${agent.controlPort}`;
  const token = readFileSync(join(dir, "control-token"), "utf8");

  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.version, "0.1.0");

  // Segunda instância na mesma pasta é recusada.
  const second = new Agent({ config, log, modules: [] });
  await assert.rejects(second.start(), AlreadyRunningError);

  // Escrita sem token é recusada; Host estranho também (DNS rebinding).
  const body = JSON.stringify({ type: "agent.diagnostic", payload: { message: "olá" }, dedupeKey: "diag-1", isTest: true });
  assert.equal((await fetch(`${base}/events`, { method: "POST", body })).status, 401);
  // fetch não permite trocar o Host; http.request permite.
  const rebindingStatus = await new Promise<number>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: agent.controlPort!, path: "/health", headers: { host: "evil.example" } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(rebindingStatus, 403);

  const headers = { "x-agent-token": token, "content-type": "application/json" };
  const created = await fetch(`${base}/events`, { method: "POST", headers, body });
  assert.equal(created.status, 201);
  const { event } = await created.json();
  const duplicate = await fetch(`${base}/events`, { method: "POST", headers, body });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).created, false);

  const done = await waitFor(async () => {
    const r = await (await fetch(`${base}/events/${event.id}`)).json();
    return r.event.status === "completed" ? r : null;
  });
  assert.equal(done.event.isTest, true);
  assert.equal(done.attempts.length, 1);

  // Falha definitiva + retry manual pela API.
  const bad = await (
    await fetch(`${base}/events`, { method: "POST", headers, body: JSON.stringify({ type: "agent.diagnostic", payload: { permanentFailure: true } }) })
  ).json();
  await waitFor(async () => (await (await fetch(`${base}/events/${bad.event.id}`)).json()).event.status === "failed");
  assert.equal((await fetch(`${base}/events/${bad.event.id}/retry`, { method: "POST", headers })).status, 200);

  const status = await (await fetch(`${base}/status`)).json();
  assert.equal(status.agent.state, "running");
  assert.equal(status.connections.find((c: { name: string }) => c.name === "obs").state, "disabled");
  await waitFor(async () => (await (await fetch(`${base}/status`)).json()).connections.find((c: { name: string }) => c.name === "site").state === "connected");
  assert.deepEqual(status.processor.handledTypes, ["achievement.unlocked", "agent.diagnostic", "mastery.achieved", "mastery.check"]);
  assert.equal(status.modules[0].state, "running");

  await agent.stop("teste");
  assert.equal(agent.lifecycleState(), "stopped");
  assert.equal(existsSync(join(dir, "agent.lock")), false);
  const db = openDatabase(config.dbPath);
  assert.equal(new StateStore(db).get<{ state: string }>("run.current")!.state, "stopped");
  db.close();
  assert.ok(records.some((r) => r.msg === "Agente encerrado"));
  assert.ok(!JSON.stringify(records).includes(token), "o token local nunca aparece nos logs");
});

test("processo real: evento sobrevive a queda abrupta e é concluído no reinício", { timeout: 90_000 }, async (t) => {
  const dir = tempDir(t);
  const siteUrl = await fakeSite(t);
  const env = {
    ...process.env,
    RUMO_AGENT_DATA_DIR: dir,
    RUMO_AGENT_SITE_URL: siteUrl,
    RUMO_AGENT_OBS_ENABLED: "false",
    RUMO_AGENT_CONTROL_PORT: "0",
    RUMO_AGENT_GAMES_ENABLED: "false",
  };
  const children: ChildProcess[] = [];
  t.after(() => children.forEach((c) => c.exitCode === null && c.kill("SIGKILL")));
  const startAgent = () => {
    const child = spawn(process.execPath, [MAIN, "start"], { env, stdio: "ignore" });
    children.push(child);
    return child;
  };
  const cli = (...args: string[]) =>
    new Promise<{ code: number | null; out: string }>((resolve) => {
      const child = spawn(process.execPath, [MAIN, ...args], { env });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("exit", (code) => resolve({ code, out }));
    });
  const lockPath = join(dir, "agent.lock");

  // 1ª execução: evento lento começa a ser processado e o processo é morto no meio.
  const first = startAgent();
  const lock = await waitFor(() => {
    const info = readLiveLock(lockPath);
    return info?.controlPort ? info : null;
  });
  const emitted = await cli("emit", "agent.diagnostic", JSON.stringify({ delayMs: 5_000 }), "--dedupe", "queda-1");
  assert.equal(emitted.code, 0, emitted.out);
  const base = `http://127.0.0.1:${lock.controlPort}`;
  await waitFor(async () => (await (await fetch(`${base}/events?status=processing`)).json()).events.length === 1);
  first.kill("SIGKILL");
  await new Promise((resolve) => first.once("exit", resolve));

  // Enquanto parado: o evento está gravado como processing e um novo evento entra direto na base.
  let db = openDatabase(join(dir, "agent.db"));
  let store = new EventStore(db, { maxAttempts: 8, retryBaseMs: 10, retryMaxMs: 10 });
  const interrupted = store.list({ status: "processing" });
  assert.equal(interrupted.length, 1);
  db.close();
  const offline = await cli("emit", "agent.diagnostic", JSON.stringify({ message: "registrado offline" }));
  assert.match(offline.out, /direto na base/);
  const offlineStatus = await cli("status");
  assert.equal(offlineStatus.code, 4);
  assert.match(offlineStatus.out, /sem encerramento controlado/);

  // 2ª execução: recupera o interrompido e processa o que ficou pendente.
  startAgent();
  const lock2 = await waitFor(() => {
    const info = readLiveLock(lockPath);
    return info?.controlPort && info.pid !== lock.pid ? info : null;
  });
  const status = await waitFor(async () => {
    const s = await (await fetch(`http://127.0.0.1:${lock2.controlPort}/status`)).json();
    return s.events.byStatus.completed === 2 ? s : null;
  }, 30_000);
  assert.equal(status.previousRun.cleanShutdown, false);
  assert.deepEqual(status.recoveryAtStartup, { recovered: 1, failed: 0 });

  // Duplicata do evento interrompido continua barrada após o reinício.
  const dup = await cli("emit", "agent.diagnostic", "{}", "--dedupe", "queda-1");
  assert.match(dup.out, /Duplicado/);

  // Encerramento controlado pelo CLI.
  const stopped = await cli("stop");
  assert.equal(stopped.code, 0, stopped.out);
  db = openDatabase(join(dir, "agent.db"));
  store = new EventStore(db, { maxAttempts: 8, retryBaseMs: 10, retryMaxMs: 10 });
  const recovered = store.list({ type: "agent.diagnostic" }).find((e) => e.dedupeKey === "queda-1")!;
  assert.equal(recovered.status, "completed");
  assert.deepEqual(store.attempts(recovered.id).map((a) => a.outcome), ["interrupted", "completed"]);
  assert.equal(new StateStore(db).get<{ state: string }>("run.current")!.state, "stopped");
  db.close();
});

// Conexões do agente: protocolo obs-websocket v5 (com socket simulado), conectividade
// com o site (servidor HTTP local) e reconexão automática.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { ObsDriver, obsAuthString, type ObsSocket } from "../../agent/src/connections/obsConnection.ts";
import { ManagedConnection, type ConnectionDriver } from "../../agent/src/connections/managedConnection.ts";
import { SiteDriver } from "../../agent/src/connections/siteConnection.ts";
import { silentLogger } from "../../agent/src/logger.ts";

type Listener = (event: unknown) => void;

/** Simula o servidor obs-websocket v5 do lado do OBS. */
class FakeObs implements ObsSocket {
  readyState = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mensagens livres do protocolo simulado
  sent: Record<string, any>[] = [];
  private listeners: Record<string, Listener[]> = {};
  private readonly password: string | null;
  constructor(password: string | null) {
    this.password = password;
    setTimeout(() => {
      this.readyState = 1;
      const hello: Record<string, unknown> = { obsWebSocketVersion: "5.5.0", rpcVersion: 1 };
      if (password !== null) hello.authentication = { challenge: "desafio", salt: "sal" };
      this.emit("message", { data: JSON.stringify({ op: 0, d: hello }) });
    }, 1);
  }
  addEventListener(type: string, listener: Listener) {
    (this.listeners[type] ??= []).push(listener);
  }
  emit(type: string, event: unknown) {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }
  send(data: string) {
    const message = JSON.parse(data);
    this.sent.push(message);
    if (message.op === 1) {
      if (this.password !== null && message.d.authentication !== obsAuthString(this.password, "sal", "desafio")) {
        return this.close(4009);
      }
      setTimeout(() => this.emit("message", { data: JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }) }), 1);
    }
    if (message.op === 6) {
      const ok = message.d.requestType === "GetVersion";
      const d = {
        requestType: message.d.requestType,
        requestId: message.d.requestId,
        requestStatus: ok ? { result: true, code: 100 } : { result: false, code: 204, comment: "Tipo desconhecido" },
        responseData: ok ? { obsVersion: "31.0.0" } : undefined,
      };
      setTimeout(() => this.emit("message", { data: JSON.stringify({ op: 7, d }) }), 1);
    }
  }
  close(code = 1000) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    setTimeout(() => this.emit("close", { code }), 1);
  }
}

test("autenticação v5 segue a fórmula do protocolo", () => {
  const secret = createHash("sha256").update("senha" + "sal").digest("base64");
  const expected = createHash("sha256").update(secret + "desafio").digest("base64");
  assert.equal(obsAuthString("senha", "sal", "desafio"), expected);
});

test("OBS: handshake com senha, identificação da versão e requisição", async () => {
  let socket!: FakeObs;
  const driver = new ObsDriver({ url: "ws://127.0.0.1:4455", password: "senha", socketFactory: () => (socket = new FakeObs("senha")) });
  let lost: unknown = null;
  await driver.open({ lost: (error) => (lost = error) }, new AbortController().signal);
  assert.equal(socket.sent[0].op, 1);
  assert.equal(socket.sent[0].d.eventSubscriptions, 0);
  assert.deepEqual(driver.detail(), { url: "ws://127.0.0.1:4455", obsVersion: "31.0.0", obsWebSocketVersion: "5.5.0", rpcVersion: 1 });
  await assert.rejects(driver.request("Inexistente"), /Tipo desconhecido/);
  socket.close(1001);
  await new Promise((r) => setTimeout(r, 10));
  assert.match(String((lost as Error).message), /OBS/);
});

test("OBS: senha errada e senha ausente falham com mensagem clara", async () => {
  const wrong = new ObsDriver({ url: "ws://x", password: "errada", socketFactory: () => new FakeObs("senha") });
  await assert.rejects(wrong.open({ lost: () => undefined }, new AbortController().signal), /senha do OBS incorreta/);
  const missing = new ObsDriver({ url: "ws://x", password: "", socketFactory: () => new FakeObs("senha") });
  await assert.rejects(missing.open({ lost: () => undefined }, new AbortController().signal), /nenhuma foi configurada/);
});

test("OBS sem autenticação conecta sem senha", async () => {
  const driver = new ObsDriver({ url: "ws://x", password: "", socketFactory: () => new FakeObs(null) });
  await driver.open({ lost: () => undefined }, new AbortController().signal);
  assert.equal(driver.detail().obsVersion, "31.0.0");
  driver.close();
});

test("OBS real fechado: falha de conexão identificável (WebSocket nativo)", async () => {
  const driver = new ObsDriver({ url: "ws://127.0.0.1:1", password: "", handshakeTimeoutMs: 3_000 });
  await assert.rejects(driver.open({ lost: () => undefined }, new AbortController().signal), /OBS/);
});

test("site: conectividade real via HTTP e falha em 5xx", async (t) => {
  let status = 200;
  const server = createServer((req, res) => {
    res.writeHead(status);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const driver = new SiteDriver({ url, probeIntervalMs: 60_000, probeTimeoutMs: 2_000 });
  await driver.probe();
  assert.equal(driver.detail().lastHttpStatus, 200);
  status = 503;
  await assert.rejects(driver.probe(), /HTTP 503/);
});

test("conexão gerenciada reconecta sozinha após falhas e após queda", async () => {
  let opens = 0;
  let handle: { lost(error: unknown): void } | null = null;
  const driver: ConnectionDriver = {
    async open(h) {
      opens += 1;
      if (opens <= 2) throw new Error(`indisponível ${opens}`);
      handle = h;
    },
    close() {},
  };
  const conn = new ManagedConnection("teste", driver, silentLogger, {
    enabled: true,
    policy: { baseDelayMs: 5, maxDelayMs: 20 },
  });
  const states: string[] = [];
  conn.onChange((s) => states.push(s.state));
  conn.start();
  const waitFor = async (cond: () => boolean) => {
    const deadline = Date.now() + 2_000;
    while (!cond()) {
      if (Date.now() > deadline) throw new Error("timeout");
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  await waitFor(() => conn.isConnected());
  assert.equal(opens, 3);
  handle!.lost(new Error("caiu"));
  assert.equal(conn.snapshot().state, "reconnecting");
  await waitFor(() => conn.isConnected());
  assert.equal(opens, 4);
  await conn.stop();
  assert.equal(conn.snapshot().state, "stopped");
  assert.ok(states.includes("reconnecting"));
});

test("conexão desativada não tenta conectar", async () => {
  let opened = false;
  const conn = new ManagedConnection("obs", { open: async () => void (opened = true), close() {} }, silentLogger, { enabled: false });
  conn.start();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(opened, false);
  assert.equal(conn.snapshot().state, "disabled");
});

// Fase 4.3 — apresentador "overlay": Browser Source conectada por SSE, confirmações com nonce,
// integração com a fila da Fase 4.2, reconexão, recuperação e teste isolado. Agente em pasta temporária.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../agent/src/config.ts";
import { Agent } from "../../agent/src/core/agent.ts";
import { silentLogger } from "../../agent/src/logger.ts";
import { achievementsModule } from "../../agent/src/modules/achievements/index.ts";
import { alertsModule } from "../../agent/src/modules/alerts/index.ts";
import { overlayModule } from "../../agent/src/modules/overlay/index.ts";
import { dockModule } from "../../agent/src/modules/dock/index.ts";
import { OVERLAY_JS } from "../../agent/src/modules/overlay/page.ts";
import type { Alert } from "../../agent/src/modules/alerts/alertStore.ts";

type SseEvent = { event: string; data: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Faz o papel da Browser Source: conecta em /events e entrega os eventos recebidos. */
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
    next(name: string, ms = 5_000): Promise<SseEvent> {
      const found = queue.findIndex((e) => e.event === name);
      if (found >= 0) return Promise.resolve(queue.splice(found, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          // A espera vencida sai da fila de espera: não pode "engolir" o próximo evento.
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

async function setup(t: { after: (fn: () => void) => void }, options: { holdMs?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "agent-overlay-"));
  t.after(() => setTimeout(() => rmSync(dir, { recursive: true, force: true }), 50).unref());
  const site = createServer((_req, res) => res.end());
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  t.after(() => site.close());
  const make = () => {
    const config = loadConfig({
      dataDir: dir,
      env: {
        RUMO_AGENT_OBS_ENABLED: "false",
        RUMO_AGENT_GAMES_ENABLED: "false",
        RUMO_AGENT_ACHIEVEMENTS_ENABLED: "false",
        RUMO_AGENT_CONTROL_PORT: "0",
        RUMO_AGENT_SITE_URL: `http://127.0.0.1:${(site.address() as AddressInfo).port}`,
      },
    });
    Object.assign(config.events, { pollIntervalMs: 20 });
    return new Agent({
      config,
      log: silentLogger,
      modules: [
        achievementsModule({ providers: [] }),
        alertsModule({ settings: { pollMs: 20, retryBaseMs: 50, retryMaxMs: 100, presentTimeoutMs: 3_000 } }),
        overlayModule({ timing: { enterMs: 20, holdMs: options.holdMs ?? 60, exitMs: 20 }, startTimeoutMs: 400 }),
        dockModule(),
      ],
    });
  };
  const agent = make();
  await agent.start();
  t.after(() => agent.stop("fim"));
  const base = `http://127.0.0.1:${agent.controlPort}`;
  const token = readFileSync(join(dir, "control-token"), "utf8");
  const api = {
    base,
    token,
    agent,
    make,
    unlock: (id: string, b = base) =>
      fetch(`${b}/modules/achievements/unlock`, {
        method: "POST",
        headers: { "x-agent-token": token },
        body: JSON.stringify({ slug: "hades", achievementId: id }),
      }),
    ack: (nonce: string, phase: string, headers: Record<string, string> = {}, b = base) =>
      fetch(`${b}/modules/overlay/ack`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ nonce, phase }) }),
    alerts: async (b = base) => ((await (await fetch(`${b}/modules/alerts/list`)).json()).alerts as Alert[]),
    summary: async (b = base) => (await (await fetch(`${b}/modules/alerts/status`)).json()) as { presenter: string | null },
    wait: async (cond: () => boolean | Promise<boolean>, ms = 8_000) => {
      const deadline = Date.now() + ms;
      while (!(await cond())) {
        if (Date.now() > deadline) throw new Error("timeout");
        await new Promise((r) => setTimeout(r, 15));
      }
    },
  };
  return api;
}

test("página da Browser Source: sem token, CSP restrita, script só escreve texto", async (t) => {
  const s = await setup(t);
  const page = await fetch(`${s.base}/modules/overlay/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy") ?? "", /connect-src 'self'/);
  const html = await page.text();
  assert.ok(!html.includes(s.token));
  assert.doesNotMatch(OVERLAY_JS, /innerHTML|insertAdjacentHTML|document\.write|token/i);
  assert.doesNotThrow(() => new Function(OVERLAY_JS));
  assert.equal((await fetch(`${s.base}/modules/overlay`, { redirect: "manual" })).headers.get("location"), "/modules/overlay/");
});

test("fila → overlay: registra apresentador ao conectar, apresenta em ordem, só conclui após o fim confirmado", async (t) => {
  const s = await setup(t);
  assert.equal((await s.summary()).presenter, null, "sem overlay conectado não há apresentador");
  const overlay = sseClient(`${s.base}/modules/overlay/events`);
  t.after(() => overlay.close());
  assert.deepEqual((await overlay.next("hello")).data.timing, { enterMs: 20, holdMs: 60, exitMs: 20 });
  await s.wait(async () => (await s.summary()).presenter === "overlay");

  await s.unlock("primeira");
  await s.unlock("segunda");
  const first = await overlay.next("present");
  assert.equal(first.data.presentation.kind, "achievement");
  assert.equal(first.data.presentation.isTest, false);

  // Confirmações: nonce errado e origem externa são recusados.
  assert.equal((await s.ack("nonce-inventado", "ended")).status, 409);
  assert.equal((await s.ack(first.data.nonce, "ended", { origin: "https://site-malicioso.example" })).status, 403);

  assert.equal((await s.ack(first.data.nonce, "started")).status, 200);
  let list = await s.alerts();
  const processing = list.find((a) => a.status === "processing")!;
  assert.equal(processing.subjectId, "primeira");
  assert.equal(processing.completedAt, null, "começou, mas não terminou: não pode estar concluído");
  await assert.rejects(overlay.next("present", 150), /sem evento/, "nada de segunda apresentação simultânea");

  assert.equal((await s.ack(first.data.nonce, "ended")).status, 200);
  const second = await overlay.next("present");
  assert.notEqual(second.data.nonce, first.data.nonce);
  assert.equal((await s.ack(first.data.nonce, "ended")).status, 409, "confirmação antiga não afeta a apresentação nova");
  await s.ack(second.data.nonce, "started");
  await s.ack(second.data.nonce, "ended");
  await s.wait(async () => (await s.alerts()).every((a) => a.status === "completed"));
  list = await s.alerts();
  assert.deepEqual(list.reverse().map((a) => a.subjectId), ["primeira", "segunda"]);
  assert.deepEqual(list.map((a) => [a.attempts, Boolean(a.startedAt), Boolean(a.completedAt), (a.completedAt ?? 0) >= (a.startedAt ?? 0), a.lastError]), [[1, true, true, true, null], [1, true, true, true, null]]);
});

test("reconexão e falhas: overlay que cai no meio ou não responde gera nova tentativa; nada concluído sem apresentação", async (t) => {
  const s = await setup(t);
  let overlay = sseClient(`${s.base}/modules/overlay/events`);
  await overlay.next("hello");
  await s.unlock("instavel");
  const first = await overlay.next("present");
  await s.ack(first.data.nonce, "started");
  await overlay.close(); // Browser Source recarregada / OBS fechou no meio
  await s.wait(async () => (await s.summary()).presenter === null);
  let alert = (await s.alerts())[0];
  assert.equal(alert.status, "retry_wait");
  assert.match(alert.lastError ?? "", /desconectou/);

  overlay = sseClient(`${s.base}/modules/overlay/events`);
  t.after(() => overlay.close());
  await overlay.next("hello");
  // Overlay conectado mas mudo: sem "started" dentro do prazo → nova tentativa.
  const silent = await overlay.next("present");
  await s.wait(async () => (await s.alerts())[0].attempts === 2 && (await s.alerts())[0].status === "retry_wait");
  assert.equal((await s.ack(silent.data.nonce, "started")).status, 409, "tentativa antiga não ressuscita");
  const third = await overlay.next("present");
  await s.ack(third.data.nonce, "started");
  await s.ack(third.data.nonce, "ended");
  await s.wait(async () => (await s.alerts())[0].status === "completed");
  alert = (await s.alerts())[0];
  assert.equal(alert.attempts, 3);
});

test("recuperação: agente reinicia no meio da apresentação; o alerta volta e é apresentado uma única vez", async (t) => {
  const s = await setup(t, { holdMs: 5_000 });
  const overlay = sseClient(`${s.base}/modules/overlay/events`);
  await overlay.next("hello");
  await s.unlock("reinicio");
  const first = await overlay.next("present");
  await s.ack(first.data.nonce, "started");
  await s.agent.stop("reinício no meio");
  await overlay.close();

  const agent2 = s.make();
  await agent2.start();
  t.after(() => agent2.stop("fim"));
  const base2 = `http://127.0.0.1:${agent2.controlPort}`;
  const overlay2 = sseClient(`${base2}/modules/overlay/events`);
  t.after(() => overlay2.close());
  await overlay2.next("hello");
  const again = await overlay2.next("present");
  assert.notEqual(again.data.nonce, first.data.nonce);
  await s.ack(again.data.nonce, "started", {}, base2);
  await s.ack(again.data.nonce, "ended", {}, base2);
  await s.wait(async () => (await s.alerts(base2))[0].status === "completed");
  const list = await s.alerts(base2);
  assert.equal(list.length, 1, "nenhuma duplicata");
});

test("teste isolado: mesmo caminho visual, exige token, não toca na fila, eventos nem conquistas", async (t) => {
  const s = await setup(t);
  const noOverlay = await fetch(`${s.base}/modules/overlay/test`, { method: "POST", headers: { "x-agent-token": s.token } });
  assert.equal(noOverlay.status, 409, "sem overlay conectado, o teste avisa");
  assert.equal((await fetch(`${s.base}/modules/overlay/test`, { method: "POST" })).status, 401);

  const overlay = sseClient(`${s.base}/modules/overlay/events`);
  t.after(() => overlay.close());
  await overlay.next("hello");
  const running = fetch(`${s.base}/modules/overlay/test`, { method: "POST", headers: { "x-agent-token": s.token } });
  const shown = await overlay.next("present");
  assert.equal(shown.data.presentation.isTest, true);
  assert.match(shown.data.presentation.description, /Nenhuma conquista foi desbloqueada/);
  await s.ack(shown.data.nonce, "started");
  await s.ack(shown.data.nonce, "ended");
  const result = await (await running).json();
  assert.equal(result.ok, true);
  assert.ok(result.totalMs >= result.startedAfterMs);

  assert.equal((await s.alerts()).length, 0, "fila de alertas intacta");
  const events = (await (await fetch(`${s.base}/events`)).json()).events;
  assert.equal(events.length, 0, "nenhum evento (nem conquista, nem sincronização)");
  const dock = await (await fetch(`${s.base}/modules/dock/state`)).json();
  assert.deepEqual([dock.alerts.label, dock.alerts.detail], ["Fila vazia", "Overlay conectado"]);
});

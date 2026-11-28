// Fase 4.2 — fila persistente e motor de alertas de conquistas (SQLite real em pasta temporária).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../agent/src/store/database.ts";
import { EventStore } from "../../agent/src/events/eventStore.ts";
import { StateStore } from "../../agent/src/store/stateStore.ts";
import { AlertStore, type Alert } from "../../agent/src/modules/alerts/alertStore.ts";
import { AlertEngine, PresenterUnavailableError, type AlertPresenter } from "../../agent/src/modules/alerts/engine.ts";
import { alertsModule, type AlertsService } from "../../agent/src/modules/alerts/index.ts";
import { achievementsModule } from "../../agent/src/modules/achievements/index.ts";
import { dockModule } from "../../agent/src/modules/dock/index.ts";
import { buildDockState } from "../../agent/src/modules/dock/state.ts";
import type { AgentModule } from "../../agent/src/core/module.ts";
import { silentLogger } from "../../agent/src/logger.ts";
import { loadConfig } from "../../agent/src/config.ts";
import { Agent } from "../../agent/src/core/agent.ts";

function setup(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "agent-alerts-"));
  t.after(() => setTimeout(() => rmSync(dir, { recursive: true, force: true }), 50).unref());
  const path = join(dir, "agent.db");
  let clock = Date.parse("2026-11-25T20:00:00Z");
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
      gameTitle: (slug) => (slug === "hades" ? "Hades" : null),
      engine: { staleAfterMs: 10 * 60_000, ttlMs: 30 * 60_000, presentTimeoutMs: 200, pollMs: 20, now: () => clock },
    });
    return { db, events, alerts, engine };
  };
  return { open, advance: (ms: number) => (clock += ms), now: () => clock, dir };
}

const unlock = (externalId: string, over: Record<string, unknown> = {}, now = Date.parse("2026-11-25T20:00:00Z")) => ({
  type: "achievement.unlocked",
  dedupeKey: `achievement:steam-local:steam:1:${externalId}`,
  payload: {
    provider: "steam",
    sourceKey: "steam:1",
    gameSlug: "hades",
    externalId,
    name: `Nome ${externalId}`,
    description: null,
    unlockedAt: new Date(now).toISOString(),
    timestampKind: "source",
    detectedAt: new Date(now).toISOString(),
    detectedLive: true,
    sessionId: "s1",
    ...over,
  },
});

test("fila: deduplicação, ordem, um por vez e conclusão só pela tentativa que reservou", (t) => {
  const { db, alerts } = setup(t).open();
  t.after(() => db.close());
  const a = alerts.insert({ kind: "achievement", dedupeKey: "k1", payload: {} });
  assert.equal(alerts.insert({ kind: "achievement", dedupeKey: "k1", payload: { outro: 1 } }).created, false);
  alerts.insert({ kind: "achievement", dedupeKey: "k2", payload: {} });
  const urgent = alerts.insert({ kind: "mastery", dedupeKey: "k3", payload: {}, priority: 10 });

  const first = alerts.claimNext()!;
  assert.equal(first.id, urgent.alert.id, "prioridade maior primeiro (preparado para Maestria)");
  assert.equal(alerts.claimNext(), null, "nunca dois em processamento");
  assert.equal(alerts.complete(first.id, 99), false, "tentativa errada não conclui");
  assert.equal(alerts.complete(first.id, first.attempts), true);
  assert.equal(alerts.complete(first.id, first.attempts), false, "conclusão repetida não conta");
  assert.equal(alerts.claimNext()!.id, a.alert.id, "depois, ordem de chegada");
  assert.equal(alerts.get(first.id)!.status, "completed");
  assert.ok(alerts.get(first.id)!.completedAt);
});

test("fila: retry com backoff, adiamento, falha definitiva, expiração e reprocessamento", (t) => {
  const env = setup(t);
  const { db, alerts } = env.open();
  t.after(() => db.close());
  const { alert } = alerts.insert({ kind: "achievement", dedupeKey: "k", payload: {}, expiresAt: env.now() + 60_000 });

  let claimed = alerts.claimNext()!;
  assert.equal(alerts.fail(claimed.id, 1, { message: "overlay quebrou" }), "retry_wait");
  assert.equal(alerts.claimNext(), null, "respeita o backoff");
  env.advance(1_000);
  claimed = alerts.claimNext()!;
  assert.equal(alerts.fail(claimed.id, 2, { message: "overlay fechado", deferMs: 5_000 }), "retry_wait");
  assert.equal(alerts.get(alert.id)!.attempts, 1, "adiamento não gasta tentativa");
  env.advance(5_000);
  claimed = alerts.claimNext()!;
  assert.equal(alerts.fail(claimed.id, 2, { message: "x" }), "retry_wait");
  env.advance(2_000);
  claimed = alerts.claimNext()!;
  assert.equal(alerts.fail(claimed.id, 3, { message: "y" }), "failed", "sem ciclo infinito: esgota em maxAttempts");
  assert.equal(alerts.requeue(alert.id, env.now() + 60_000), true);
  assert.equal(alerts.get(alert.id)!.status, "pending");

  const late = alerts.insert({ kind: "achievement", dedupeKey: "late", payload: {}, expiresAt: env.now() + 1_000 });
  alerts.claimNext(); // reserva o reenfileirado
  env.advance(2_000);
  assert.equal(alerts.claimNext(), null);
  assert.equal(alerts.get(late.alert.id)!.status, "expired", "pendente vencido expira em vez de aparecer fora de hora");
  assert.equal(alerts.requeue(late.alert.id, null), true);
  assert.equal(alerts.requeue(late.alert.id, null), false, "só failed/expired");
});

test("motor: ingestão em ordem a partir do cursor, elegibilidade, antigos, teste e idempotência", (t) => {
  const env = setup(t);
  const { db, events, alerts, engine } = env.open();
  t.after(() => db.close());
  events.record(unlock("HISTORICO"));
  engine.initCursor(); // instalado agora: histórico não vira alerta
  events.record(unlock("A"));
  events.record(unlock("RECONCILIADA", { detectedLive: false }));
  events.record(unlock("B"));
  events.record({ ...unlock("TESTE"), isTest: true });
  events.record(unlock("ANTIGA", { detectedAt: new Date(env.now() - 11 * 60_000).toISOString() }));
  events.record(unlock("A")); // duplicata do evento: nem chega a existir

  const stats = engine.ingest();
  assert.deepEqual([stats.read, stats.created, stats.skipped, stats.expired], [5, 3, 1, 1]);
  const list = alerts.list({ limit: 10 }).reverse();
  assert.deepEqual(list.map((a) => [a.subjectId, a.status]), [["A", "pending"], ["B", "pending"], ["TESTE", "pending"], ["ANTIGA", "expired"]]);
  assert.equal(list[2].isTest, true);
  assert.deepEqual(list[0].payload.gameTitle, "Hades");
  assert.equal(list[0].dedupeKey, `alert:achievement:${list[0].sourceEventId}`);
  assert.deepEqual(engine.ingest(), { created: 0, skipped: 0, expired: 0, read: 0 }, "releitura não duplica");
});

test("motor: falha no meio da ingestão desfaz tudo (sem perda nem duplicata)", (t) => {
  const env = setup(t);
  const { db, events, alerts, engine } = env.open();
  t.after(() => db.close());
  engine.initCursor();
  events.record(unlock("A"));
  events.record(unlock("B"));
  const original = alerts.insert.bind(alerts);
  let calls = 0;
  alerts.insert = (input) => {
    calls += 1;
    if (calls === 2) throw new Error("disco cheio");
    return original(input);
  };
  assert.throws(() => engine.ingest(), /disco cheio/);
  assert.equal(alerts.list().length, 0, "o primeiro alerta também foi desfeito");
  alerts.insert = original;
  assert.equal(engine.ingest().created, 2);
  assert.deepEqual(alerts.list().reverse().map((a) => a.subjectId), ["A", "B"]);
});

function presenter(behavior: (alert: Alert, n: number) => Promise<void>): AlertPresenter & { shown: string[] } {
  const shown: string[] = [];
  let n = 0;
  return {
    id: "teste",
    shown,
    async present(alert) {
      n += 1;
      await behavior(alert, n);
      shown.push(String(alert.subjectId));
    },
  };
}

test("motor: apresenta em ordem, só conclui depois da apresentação, retry, indisponível e timeout", async (t) => {
  const env = setup(t);
  const { db, events, alerts, engine } = env.open();
  t.after(() => db.close());
  engine.initCursor();
  for (const id of ["A", "B", "C"]) events.record(unlock(id));
  engine.ingest();
  assert.equal(await engine.processNext(), null, "sem apresentador, nada é processado");
  assert.equal(alerts.counts().pending, 3);

  let release: () => void = () => undefined;
  const p = presenter((alert, n) => {
    if (n === 1) return new Promise<void>((r) => (release = r));
    if (alert.subjectId === "B" && n === 2) return Promise.reject(new Error("animação falhou"));
    if (alert.subjectId === "C" && n === 3) return Promise.reject(new PresenterUnavailableError("overlay fechado", 1));
    return Promise.resolve();
  });
  engine.setPresenter(p);
  const running = engine.processNext();
  await new Promise((r) => setTimeout(r, 10));
  const a = alerts.list({ status: "processing" })[0];
  assert.equal(a.subjectId, "A");
  assert.equal(a.completedAt, null, "não conclui antes de a apresentação terminar");
  release();
  assert.equal((await running)!.status, "completed");

  assert.equal((await engine.processNext())!.status, "retry_wait", "B falhou: nova tentativa agendada");
  assert.equal((await engine.processNext())!.status, "retry_wait", "C: apresentador indisponível");
  assert.equal(alerts.list().find((x) => x.subjectId === "C")!.attempts, 0);
  env.advance(5_000);
  await engine.processNext();
  await engine.processNext();
  assert.deepEqual(p.shown, ["A", "B", "C"], "ordem preservada mesmo com falhas");

  // Apresentador que trava: timeout aborta e reagenda.
  events.record(unlock("D"));
  engine.ingest();
  engine.setPresenter({ id: "travado", present: () => new Promise(() => undefined) });
  const stuck = await engine.processNext();
  assert.equal(stuck!.status, "retry_wait");
  assert.match(stuck!.lastError ?? "", /excedeu 200 ms/);
});

test("recuperação: alerta em apresentação quando o agente cai volta para a fila; esgotado vira failed", (t) => {
  const env = setup(t);
  let { db, alerts } = env.open();
  alerts.insert({ kind: "achievement", dedupeKey: "k1", payload: {} });
  const claimed = alerts.claimNext()!;
  db.close(); // queda no meio da apresentação
  ({ db, alerts } = env.open());
  assert.deepEqual(alerts.recoverInterrupted(), { recovered: 1, failed: 0 });
  assert.equal(alerts.get(claimed.id)!.status, "retry_wait");
  assert.equal(alerts.claimNext()!.id, claimed.id, "reapresentado depois do reinício");
  db.close();
});

test("integração: desbloqueio pelo fluxo de conquistas → alerta → apresentador → dock; reinício no meio", { timeout: 30_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "agent-alerts-e2e-"));
  t.after(() => setTimeout(() => rmSync(dir, { recursive: true, force: true }), 50).unref());
  const site = createServer((_req, res) => res.end());
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  t.after(() => site.close());
  const shown: string[] = [];
  let hold = true;
  const presenterModule = (): AgentModule => ({
    name: "presenter-teste",
    start(ctx) {
      ctx.services.get<AlertsService>("alerts")!.setPresenter({
        id: "presenter-teste",
        async present(alert, { signal }) {
          while (hold) {
            if (signal.aborted) throw signal.reason;
            await new Promise((r) => setTimeout(r, 10));
          }
          shown.push(String(alert.subjectId));
        },
      });
    },
  });
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
      modules: [achievementsModule({ providers: [] }), alertsModule({ settings: { pollMs: 20 } }), presenterModule(), dockModule()],
    });
  };
  const wait = async (cond: () => boolean | Promise<boolean>) => {
    const deadline = Date.now() + 10_000;
    while (!(await cond())) {
      if (Date.now() > deadline) throw new Error("timeout");
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  let agent = make();
  await agent.start();
  const first = agent;
  t.after(() => first.stop("fim"));
  let base = `http://127.0.0.1:${agent.controlPort}`;
  const token = readFileSync(join(dir, "control-token"), "utf8");
  const unlockVia = (id: string, base: string) =>
    fetch(`${base}/modules/achievements/unlock`, {
      method: "POST",
      headers: { "x-agent-token": token },
      // Desbloqueio real (pasta temporária): só o real deduplica; testes nunca ocupam a vaga dele.
      body: JSON.stringify({ slug: "hades", achievementId: id }),
    });
  await unlockVia("primeira", base);
  await unlockVia("primeira", base); // duplicata
  await unlockVia("segunda", base);
  await wait(async () => (await (await fetch(`${base}/modules/alerts/list?status=processing`)).json()).alerts.length === 1);
  const dock = (await (await fetch(`${base}/modules/dock/state`)).json()) as ReturnType<typeof buildDockState>;
  assert.equal(dock.alerts.label, "Apresentando");

  // Reinício com a "primeira" em apresentação.
  await agent.stop("reinício");
  hold = false;
  agent = make();
  await agent.start();
  t.after(() => agent.stop("fim"));
  base = `http://127.0.0.1:${agent.controlPort}`;
  await wait(() => shown.length === 2);
  assert.deepEqual(shown, ["primeira", "segunda"], "ordem mantida depois do reinício, sem duplicata");
  const listAll = async () => (await (await fetch(`${base}/modules/alerts/list`)).json()).alerts as Alert[];
  await wait(async () => (await listAll()).every((x) => x.status === "completed"));
  const all = await listAll();
  assert.equal(all.length, 2);
  assert.ok(all.every((a) => a.status === "completed" && !a.isTest));
  assert.equal(all.find((a) => a.subjectId === "primeira")!.attempts, 2, "a apresentação interrompida contou como tentativa");
});

// Processador de eventos do agente: handlers, retry, timeout, falha permanente e encerramento.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../agent/src/store/database.ts";
import { EventStore } from "../../agent/src/events/eventStore.ts";
import { DeferEventError, EventProcessor, PermanentEventError } from "../../agent/src/events/processor.ts";
import { silentLogger } from "../../agent/src/logger.ts";

function setup(t: { after: (fn: () => void) => void }, options: { timeoutMs?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "agent-proc-"));
  const db = openDatabase(join(dir, "agent.db"));
  let clock = 5_000_000;
  const store = new EventStore(db, { maxAttempts: 3, retryBaseMs: 1_000, retryMaxMs: 10_000, now: () => clock });
  const processor = new EventProcessor(store, silentLogger, {
    pollIntervalMs: 20,
    handlerTimeoutMs: options.timeoutMs ?? 1_000,
  });
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, processor, advance: (ms: number) => (clock += ms) };
}

test("processa com o handler e conclui", async (t) => {
  const { store, processor } = setup(t);
  const seen: string[] = [];
  processor.register("x.one", (event) => {
    seen.push(event.id);
    return { echo: event.payload };
  });
  const { event } = store.record({ type: "x.one", payload: { n: 1 } });
  assert.equal(await processor.drain(), 1);
  assert.deepEqual(seen, [event.id]);
  assert.deepEqual(store.get(event.id)!.result, { echo: { n: 1 } });
  assert.equal(processor.stats().completed, 1);
});

test("erro transitório gera retry e depois conclui", async (t) => {
  const { store, processor, advance } = setup(t);
  processor.register("x.one", (_event, { attempt }) => {
    if (attempt < 2) throw new Error("instável");
    return "ok";
  });
  const { event } = store.record({ type: "x.one" });
  await processor.drain();
  assert.equal(store.get(event.id)!.status, "retry_wait");
  advance(1_000);
  await processor.drain();
  assert.equal(store.get(event.id)!.status, "completed");
  assert.equal(processor.stats().retried, 1);
});

test("timeout do handler aborta o sinal e conta como falha", async (t) => {
  const { store, processor } = setup(t, { timeoutMs: 50 });
  let aborted = false;
  processor.register("x.slow", (_event, { signal }) => {
    signal.addEventListener("abort", () => (aborted = true));
    return new Promise(() => undefined);
  });
  const { event } = store.record({ type: "x.slow" });
  await processor.drain();
  assert.equal(aborted, true);
  const current = store.get(event.id)!;
  assert.equal(current.status, "retry_wait");
  assert.match(current.lastError ?? "", /HandlerTimeoutError/);
});

test("falha permanente e adiamento são respeitados", async (t) => {
  const { store, processor } = setup(t);
  processor.register("x.bad", () => {
    throw new PermanentEventError("payload inválido");
  });
  processor.register("x.wait", () => {
    throw new DeferEventError("site offline", 30_000);
  });
  const bad = store.record({ type: "x.bad" }).event;
  const wait = store.record({ type: "x.wait" }).event;
  await processor.drain();
  assert.equal(store.get(bad.id)!.status, "failed");
  assert.equal(store.get(wait.id)!.status, "retry_wait");
  assert.equal(store.get(wait.id)!.attempts, 0);
  assert.equal(processor.stats().failed, 1);
  assert.equal(processor.stats().deferred, 1);
});

test("eventos sem handler permanecem na fila", async (t) => {
  const { store, processor } = setup(t);
  processor.register("x.one", () => "ok");
  const orphan = store.record({ type: "future.module" }).event;
  await processor.drain();
  assert.equal(store.get(orphan.id)!.status, "pending");
});

test("loop contínuo processa eventos registrados depois do start e stop aguarda o evento em andamento", async (t) => {
  const { store, processor } = setup(t);
  let release: () => void = () => undefined;
  processor.register("x.one", () => new Promise<void>((resolve) => (release = resolve)));
  processor.start();
  const { event } = store.record({ type: "x.one" });
  processor.kick();
  while (store.get(event.id)!.status !== "processing") await new Promise((r) => setTimeout(r, 5));
  const stopping = processor.stop(2_000);
  release();
  assert.deepEqual(await stopping, { drained: true });
  assert.equal(store.get(event.id)!.status, "completed");
});

test("stop com prazo estourado deixa o evento para recuperação", async (t) => {
  const { store, processor } = setup(t);
  processor.register("x.one", () => new Promise(() => undefined));
  processor.start();
  const { event } = store.record({ type: "x.one" });
  processor.kick();
  while (store.get(event.id)!.status !== "processing") await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(await processor.stop(50), { drained: false });
  assert.equal(store.get(event.id)!.status, "processing");
  assert.deepEqual(store.recoverInterrupted(), { recovered: 1, failed: 0 });
});

test("não permite dois handlers para o mesmo tipo", (t) => {
  const { processor } = setup(t);
  processor.register("x.one", () => undefined);
  assert.throws(() => processor.register("x.one", () => undefined), /Já existe handler/);
});

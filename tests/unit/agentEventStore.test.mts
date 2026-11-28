// Fila persistente de eventos do agente: registro, deduplicação, estados, retry e recuperação.
// Usa SQLite real em pasta temporária (nenhum acesso à rede).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../agent/src/store/database.ts";
import { EventStore, EventValidationError, retryDelayMs } from "../../agent/src/events/eventStore.ts";
import { StateStore } from "../../agent/src/store/stateStore.ts";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "agent-store-"));
  const path = join(dir, "agent.db");
  let clock = 1_000_000;
  const open = () => {
    const db = openDatabase(path);
    const store = new EventStore(db, { maxAttempts: 3, retryBaseMs: 1_000, retryMaxMs: 10_000, now: () => clock });
    return { db, store };
  };
  return {
    open,
    advance: (ms: number) => (clock += ms),
    now: () => clock,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("registra com id único e deduplica pela chave natural", (t) => {
  const env = setup();
  t.after(env.cleanup);
  const { db, store } = env.open();
  const first = store.record({ type: "achievement.unlocked", payload: { a: 1 }, dedupeKey: "steam:440:X" });
  const again = store.record({ type: "achievement.unlocked", payload: { a: 2 }, dedupeKey: "steam:440:X" });
  const other = store.record({ type: "achievement.unlocked" });
  assert.equal(first.created, true);
  assert.equal(again.created, false);
  assert.equal(again.event.id, first.event.id);
  assert.deepEqual(again.event.payload, { a: 1 }, "o duplicado não sobrescreve o original");
  assert.notEqual(other.event.id, first.event.id);
  assert.equal(other.event.dedupeKey, `id:${other.event.id}`);
  // Reenvio com o mesmo id também é duplicado.
  assert.equal(store.record({ type: "achievement.unlocked", id: other.event.id }).created, false);
  assert.equal(store.stats().total, 2);
  db.close();
});

test("rejeita tipo e payload inválidos", (t) => {
  const env = setup();
  t.after(env.cleanup);
  const { db, store } = env.open();
  assert.throws(() => store.record({ type: "Semponto" }), EventValidationError);
  assert.throws(() => store.record({ type: "a.B" }), EventValidationError);
  assert.throws(() => store.record({ type: "a.b", payload: "x".repeat(300 * 1024) }), EventValidationError);
  assert.equal(store.stats().total, 0);
  db.close();
});

test("eventos persistem após fechar e reabrir a base", (t) => {
  const env = setup();
  t.after(env.cleanup);
  let { db, store } = env.open();
  const { event } = store.record({ type: "agent.diagnostic", payload: { m: "x" }, isTest: true });
  db.close();
  ({ db, store } = env.open());
  const reloaded = store.get(event.id);
  assert.ok(reloaded);
  assert.equal(reloaded.status, "pending");
  assert.equal(reloaded.isTest, true);
  assert.deepEqual(reloaded.payload, { m: "x" });
  db.close();
});

test("claim respeita ordem de chegada e apenas tipos com handler", (t) => {
  const env = setup();
  t.after(env.cleanup);
  const { db, store } = env.open();
  const a = store.record({ type: "x.one" }).event;
  store.record({ type: "y.other" });
  const b = store.record({ type: "x.one" }).event;
  assert.equal(store.claimNext(["x.one"])?.id, a.id);
  assert.equal(store.claimNext(["x.one"])?.id, b.id);
  assert.equal(store.claimNext(["x.one"]), null);
  assert.equal(store.claimNext([]), null);
  assert.equal(store.stats().backlogByType["y.other"], 1);
  db.close();
});

test("conclusão grava resultado e histórico de tentativa", (t) => {
  const env = setup();
  t.after(env.cleanup);
  const { db, store } = env.open();
  const { event } = store.record({ type: "x.one" });
  const claimed = store.claimNext(["x.one"])!;
  assert.equal(claimed.status, "processing");
  assert.equal(claimed.attempts, 1);
  assert.equal(store.complete(event.id, 1, { ok: true }), true);
  assert.equal(store.complete(event.id, 1, { ok: true }), false, "conclusão repetida é ignorada");
  const done = store.get(event.id)!;
  assert.equal(done.status, "completed");
  assert.deepEqual(done.result, { ok: true });
  assert.deepEqual(store.attempts(event.id).map((a) => a.outcome), ["completed"]);
  db.close();
});

test("falhas: retry com backoff, adiamento sem gastar tentativa e falha definitiva ao esgotar", (t) => {
  const env = setup();
  t.after(env.cleanup);
  const { db, store } = env.open();
  const { event } = store.record({ type: "x.one" });

  store.claimNext(["x.one"]);
  assert.equal(store.fail(event.id, 1, { message: "boom" }), "retry_wait");
  let current = store.get(event.id)!;
  assert.equal(current.nextAttemptAt, env.now() + retryDelayMs(1, 1_000, 10_000));
  assert.equal(store.claimNext(["x.one"]), null, "não reprocessa antes do prazo");

  env.advance(1_000);
  store.claimNext(["x.one"]);
  assert.equal(store.fail(event.id, 2, { message: "site offline", deferMs: 5_000 }), "retry_wait");
  current = store.get(event.id)!;
  assert.equal(current.attempts, 1, "adiamento não consome tentativa");

  env.advance(5_000);
  store.claimNext(["x.one"]);
  env.advance(0);
  assert.equal(store.fail(event.id, 2, { message: "boom2" }), "retry_wait");
  env.advance(2_000);
  store.claimNext(["x.one"]);
  assert.equal(store.fail(event.id, 3, { message: "boom3" }), "failed");
  current = store.get(event.id)!;
  assert.equal(current.status, "failed");
  assert.equal(current.lastError, "boom3");
  assert.deepEqual(store.attempts(event.id).map((a) => a.outcome), ["retry", "deferred", "retry", "failed"]);

  assert.equal(store.requeue(event.id), true);
  assert.equal(store.get(event.id)!.status, "pending");
  assert.equal(store.requeue(event.id), false, "só reenfileira o que está em failed");
  db.close();
});

test("falha permanente vai direto para failed", (t) => {
  const env = setup();
  t.after(env.cleanup);
  const { db, store } = env.open();
  const { event } = store.record({ type: "x.one" });
  store.claimNext(["x.one"]);
  assert.equal(store.fail(event.id, 1, { message: "dados inválidos", permanent: true }), "failed");
  db.close();
});

test("recupera eventos interrompidos em processing após queda", (t) => {
  const env = setup();
  t.after(env.cleanup);
  let { db, store } = env.open();
  const a = store.record({ type: "x.one" }).event;
  const b = store.record({ type: "x.one", maxAttempts: 1 }).event;
  store.claimNext(["x.one"]);
  store.claimNext(["x.one"]);
  db.close(); // "queda" com os dois em processing

  ({ db, store } = env.open());
  assert.deepEqual(store.recoverInterrupted(), { recovered: 1, failed: 1 });
  assert.equal(store.get(a.id)!.status, "retry_wait");
  assert.equal(store.get(b.id)!.status, "failed", "evento sem tentativas restantes não entra em ciclo infinito");
  assert.equal(store.attempts(a.id).at(-1)!.outcome, "interrupted");
  assert.equal(store.claimNext(["x.one"])!.id, a.id);
  db.close();
});

test("estado operacional chave/valor persiste", (t) => {
  const env = setup();
  t.after(env.cleanup);
  let { db } = env.open();
  new StateStore(db).set("run.current", { state: "running", n: 1 });
  db.close();
  ({ db } = env.open());
  assert.deepEqual(new StateStore(db).get("run.current"), { state: "running", n: 1 });
  db.close();
});

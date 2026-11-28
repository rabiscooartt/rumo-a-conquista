// Parte B do plano de captura híbrida — revisão dos momentos e checklist. Site simulado com o
// endpoint real do agente e catálogo gerado do banco; OBS simulado para os clips. Pastas temporárias.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../agent/src/config.ts";
import { Agent } from "../../agent/src/core/agent.ts";
import { silentLogger } from "../../agent/src/logger.ts";
import { achievementsModule } from "../../agent/src/modules/achievements/index.ts";
import { alertsModule } from "../../agent/src/modules/alerts/index.ts";
import { clipsModule } from "../../agent/src/modules/clips/index.ts";
import type { ReplayBackend } from "../../agent/src/modules/clips/engine.ts";
import { momentsModule } from "../../agent/src/modules/moments/index.ts";
import { REVIEW_JS } from "../../agent/src/modules/moments/page.ts";
import { DOCK_JS } from "../../agent/src/modules/dock/page.ts";
import { handleAgentAchievementUnlock, siteDate } from "../../lib/agentSync/achievementUnlock.ts";
import { memoryStore, sampleDb, TOKEN, type MemoryDb } from "../fixtures/agentSiteMemoryStore.mts";

const tmp = (t: { after: (fn: () => void) => void }, prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* temporária */ } }, 200).unref());
  return dir;
};

function catalogFrom(db: MemoryDb) {
  const achievementsBySlug: Record<string, unknown[]> = {};
  for (const a of db.achievements) {
    const progress = db.progress.get(a.id);
    (achievementsBySlug[a.game_slug] ??= []).push({
      legacy_id: a.legacy_id, id: a.id, title: a.title, description: `Descrição ${a.title}`, is_custom: a.is_custom === true,
      achievement_progress: progress ? [{ status: progress.status }] : [],
    });
  }
  return { ok: true, games: [{ slug: "hollow-knight", title: "Hollow Knight" }, { slug: "hades", title: "Hades" }], achievementsBySlug };
}

async function setup(t: { after: (fn: () => void) => void }) {
  const root = tmp(t, "agent-review-");
  const db = sampleDb();
  const site = createServer(async (req, res) => {
    if (req.url?.startsWith("/api/games/catalog")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(catalogFrom(db)));
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

  // OBS simulado: o buffer salva um "vídeo" de 1000 bytes.
  const recordDir = join(root, "obs");
  mkdirSync(recordDir);
  let saves = 0;
  let last: string | null = null;
  const backend: ReplayBackend = {
    connected: () => true,
    status: async () => ({ available: true, active: true }),
    bufferSeconds: async () => 270,
    recordDirectory: async () => recordDir,
    lastReplay: async () => last,
    async save() {
      saves += 1;
      last = join(recordDir, `Replay ${saves}.mp4`);
      writeFileSync(last, Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256)));
    },
  };
  const session = { id: "s1", slug: "hollow-knight", title: "Hollow Knight", detectionKey: "exe:hk.exe" };
  const fakeGames = {
    name: "fake-games",
    start(ctx: { services: { provide: (n: string, s: unknown) => void } }) {
      ctx.services.provide("games", {
        activeSession: () => session,
        titleForSlug: (s: string) => ({ "hollow-knight": "Hollow Knight", hades: "Hades" })[s] ?? null,
        catalogGames: () => [{ slug: "hollow-knight", title: "Hollow Knight" }, { slug: "hades", title: "Hades" }],
        slugForKey: () => null,
      });
    },
  };
  const config = loadConfig({
    dataDir: join(root, "data"),
    env: {
      RUMO_AGENT_OBS_ENABLED: "false", RUMO_AGENT_GAMES_ENABLED: "false", RUMO_AGENT_ACHIEVEMENTS_ENABLED: "false", RUMO_AGENT_CONTROL_PORT: "0",
      RUMO_AGENT_SITE_URL: `http://127.0.0.1:${(site.address() as AddressInfo).port}`, RUMO_AGENT_SITE_TOKEN: TOKEN,
    },
    overrides: { clipPostSeconds: 0 },
  });
  Object.assign(config.events, { pollIntervalMs: 20 });
  const agent = new Agent({
    config,
    log: silentLogger,
    modules: [
      fakeGames as never,
      achievementsModule({ providers: [] }),
      clipsModule({ backend: () => backend, settings: { pollMs: 20, settleMs: 20, statusMs: 50 } }),
      momentsModule(),
      alertsModule({ settings: { pollMs: 20 } }),
    ],
  });
  await agent.start();
  t.after(() => agent.stop("fim"));
  const base = `http://127.0.0.1:${agent.controlPort}`;
  const token = readFileSync(join(root, "data", "control-token"), "utf8");
  const wait = async (cond: () => boolean | Promise<boolean>, ms = 10_000) => {
    const deadline = Date.now() + ms;
    while (!(await cond())) {
      if (Date.now() > deadline) throw new Error("timeout");
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  // Envio ao site só depois da conexão (senão é adiado).
  await wait(async () => (await (await fetch(`${base}/status`)).json()).connections.find((c: { name: string }) => c.name === "site").state === "connected");
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const mark = async (clockGap = 3_100) => {
    await new Promise((r) => setTimeout(r, clockGap)); // respeita o intervalo contra toque duplo
    return (await (await post("/modules/moments/mark", { source: "atalho" }, { "x-agent-token": token })).json()).moment as { id: string; markedAt: number; clipId: string | null };
  };
  const progressOf = (legacy: string) => db.progress.get(db.achievements.find((a) => a.legacy_id === legacy)!.id);
  return { db, agent, base, post, mark, wait, progressOf };
}

test("revisão: sugere as pendentes do jogo, registra com a data do momento ou sem data, sem alerta, e não revisa duas vezes", { timeout: 60_000 }, async (t) => {
  const s = await setup(t);
  s.db.progress.set(s.db.achievements.find((a) => a.legacy_id === "hk-custom")!.id, { status: "completed", earned_at: "2026-11-01" });

  const m1 = await s.mark(0);
  await s.wait(async () => (await (await fetch(`${s.base}/modules/clips/list`)).json()).clips.some((c: { status: string }) => c.status === "completed"));
  const review = await (await fetch(`${s.base}/modules/moments/review`)).json();
  assert.equal(review.pending.length, 1);
  assert.equal(review.pending[0].clip.status, "completed", "o clip do momento aparece para assistir");
  assert.deepEqual(review.suggestions["hollow-knight"].map((a: { id: string }) => a.id), ["hk-1", "hk-2"], "só as pendentes (a CUSTOM já feita fica de fora)");

  // Data do momento.
  const r1 = await s.post("/modules/moments/resolve", { momentId: m1.id, achievementId: "hk-1", dateMode: "moment" });
  assert.equal(r1.status, 200);
  const b1 = await r1.json();
  assert.deepEqual([b1.moment.status, b1.moment.achievementTitle, b1.moment.dateMode], ["resolved", "Falso Cavaleiro", "moment"]);
  assert.deepEqual([b1.event.payload.unlockedAt, b1.event.payload.timestampKind, b1.event.payload.detectedLive], [new Date(m1.markedAt).toISOString(), "source", false]);
  await s.wait(() => s.progressOf("hk-1")?.status === "completed");
  assert.equal(s.progressOf("hk-1")!.earned_at, siteDate(new Date(m1.markedAt).toISOString()), "o site recebe o dia do momento");
  assert.equal((await s.post("/modules/moments/resolve", { momentId: m1.id, achievementId: "hk-1" })).status, 409, "não revisa duas vezes");

  // Sem data.
  const m2 = await s.mark();
  const b2 = await (await s.post("/modules/moments/resolve", { momentId: m2.id, achievementId: "hk-2", dateMode: "undated" })).json();
  assert.equal(b2.event.payload.unlockedAt, null);
  await s.wait(() => s.progressOf("hk-2")?.status === "completed");
  assert.equal(s.progressOf("hk-2")!.earned_at, null, "concluída sem data no site");

  // Nada disso vira alerta na live (desbloqueios revisados depois não são "ao vivo").
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await (await fetch(`${s.base}/modules/alerts/list`)).json()).alerts.length, 0);

  // Ficha do clip anotada com a conquista escolhida.
  const clip = (await (await fetch(`${s.base}/modules/clips/list`)).json()).clips.find((c: { id: string }) => c.id === m1.clipId);
  assert.equal(JSON.parse(readFileSync(`${clip.filePath}.json`, "utf8")).conquista, "Falso Cavaleiro");

  // Validações e mesma origem.
  const m3 = await s.mark();
  assert.equal((await s.post("/modules/moments/resolve", { momentId: m3.id, achievementId: "nao-existe" })).status, 404);
  assert.equal((await s.post("/modules/moments/resolve", { momentId: "x", achievementId: "hk-1" })).status, 404);
  assert.equal((await s.post("/modules/moments/resolve", { momentId: m3.id, achievementId: "hk-1" }, { origin: "https://evil.example" })).status, 403);
});

test("revisão: descartar (opcionalmente apagando o clip), vídeo com avanço/retrocesso e checklist sem duplicar", { timeout: 60_000 }, async (t) => {
  const s = await setup(t);
  const m = await s.mark(0);
  await s.wait(async () => (await (await fetch(`${s.base}/modules/clips/list`)).json()).clips[0]?.status === "completed");
  const clip = (await (await fetch(`${s.base}/modules/clips/list`)).json()).clips[0];

  // Vídeo para assistir na revisão: inteiro e por trechos (Range).
  const full = await fetch(`${s.base}/modules/clips/video?id=${clip.id}`);
  assert.deepEqual([full.status, full.headers.get("content-type"), (await full.arrayBuffer()).byteLength], [200, "video/mp4", 1000]);
  const part = await fetch(`${s.base}/modules/clips/video?id=${clip.id}`, { headers: { range: "bytes=100-199" } });
  assert.deepEqual([part.status, part.headers.get("content-range")], [206, "bytes 100-199/1000"]);
  assert.equal(new Uint8Array(await part.arrayBuffer())[0], 100);
  assert.equal((await fetch(`${s.base}/modules/clips/video?id=inexistente`)).status, 404);

  // Descartar apagando o clip.
  const d = await (await s.post("/modules/moments/discard", { momentId: m.id, deleteClip: true })).json();
  assert.deepEqual([d.moment.status, d.clipDeleted], ["discarded", true]);
  assert.equal(existsSync(clip.filePath), false);
  assert.equal(existsSync(`${clip.filePath}.json`), false);
  assert.equal((await (await fetch(`${s.base}/modules/moments/review`)).json()).pending.length, 0);

  // Checklist: conquistas feitas sem momento, com a data de hoje; repetir não duplica.
  const c1 = await s.post("/modules/moments/checklist", { slug: "hollow-knight", achievementIds: ["hk-1", "hk-custom"], dateMode: "today" });
  assert.equal(c1.status, 201);
  assert.deepEqual((await c1.json()).results.map((r: { created: boolean }) => r.created), [true, true]);
  await s.wait(() => s.progressOf("hk-1")?.status === "completed" && s.progressOf("hk-custom")?.status === "completed");
  assert.equal(s.progressOf("hk-1")!.earned_at, siteDate(new Date().toISOString()));
  const c2 = await (await s.post("/modules/moments/checklist", { slug: "hollow-knight", achievementIds: ["hk-1"], dateMode: "undated" })).json();
  assert.equal(c2.results[0].created, false, "já registrada: não duplica");
  const pend = await (await fetch(`${s.base}/modules/moments/achievements?slug=hollow-knight`)).json();
  assert.deepEqual(pend.pending.map((a: { id: string }) => a.id), ["hk-2"], "o checklist some com as feitas");
  assert.equal((await s.post("/modules/moments/checklist", { slug: "hollow-knight", achievementIds: [] })).status, 400);
  assert.equal((await s.post("/modules/moments/checklist", { slug: "jogo-fora", achievementIds: ["x"] })).status, 400);
});

test("tela de revisão: CSP restrita, só texto, link no dock", async (t) => {
  const s = await setup(t);
  const r = await fetch(`${s.base}/modules/moments/`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy") ?? "", /default-src 'none'.*media-src 'self'/);
  assert.doesNotMatch(REVIEW_JS, /innerHTML|insertAdjacentHTML|eval\(/);
  assert.match(DOCK_JS, /review-count/);
});

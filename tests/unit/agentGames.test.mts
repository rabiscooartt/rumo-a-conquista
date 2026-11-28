// Fase 2 — identificação de jogos e sessões: títulos, sinais do Windows, Steam, emuladores,
// resolução no catálogo, sessões persistentes e integração com o agente (sinais simulados).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchCatalog, normalizeTitle, type CatalogGame } from "../../agent/src/modules/games/titles.ts";
import { parseRegValue, parseTasklistCsv, type SystemSignals } from "../../agent/src/modules/games/signals.ts";
import { SteamLibrary } from "../../agent/src/modules/games/steamLibrary.ts";
import { contentFromWindowTitle, findEmulator } from "../../agent/src/modules/games/emulators.ts";
import { GameRepository } from "../../agent/src/modules/games/repository.ts";
import { CatalogCache } from "../../agent/src/modules/games/catalog.ts";
import { GameDetector, type ResolvedGame } from "../../agent/src/modules/games/detector.ts";
import { SessionManager } from "../../agent/src/modules/games/sessions.ts";
import { applyMapping, gamesModule } from "../../agent/src/modules/games/index.ts";
import { openDatabase } from "../../agent/src/store/database.ts";
import { EventStore, type NewEvent } from "../../agent/src/events/eventStore.ts";
import { StateStore } from "../../agent/src/store/stateStore.ts";
import { silentLogger } from "../../agent/src/logger.ts";
import { loadConfig } from "../../agent/src/config.ts";
import { Agent } from "../../agent/src/core/agent.ts";

const CATALOG: CatalogGame[] = [
  { slug: "hollow-knight", title: "Hollow Knight", platform: "Steam", status: "planned" },
  { slug: "song-of-nunu", title: "Song of Nunu: A League of Legends Stor", platform: "Steam", status: "planned" },
  { slug: "monster-hunter-world-iceborne", title: "Monster Hunter: World - Iceborne", platform: "Steam", status: "progress" },
  { slug: "howgarts-legacy", title: "Hogwarts Legacy", platform: "Steam", status: "completed" },
  { slug: "hades", title: "Hades", platform: "Steam", status: "planned" },
  { slug: "metro-last-light", title: "Metro: Last Light", platform: "Steam", status: "planned" },
  { slug: "tom-clancy-s-the-division", title: "Tom Clancy's The Division", platform: "Steam", status: "planned" },
];

function tempDir(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "agent-games-"));
  // Os hooks "after" rodam na ordem de registro; a base pode fechar depois. A limpeza é melhor esforço.
  t.after(() => setTimeout(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // pasta temporária
    }
  }, 50).unref());
  return dir;
}

function catalogWith(games: CatalogGame[], db: ReturnType<typeof openDatabase>) {
  const state = new StateStore(db);
  state.set("catalog", { fetchedAt: 1, games });
  return new CatalogCache({ siteUrl: "http://127.0.0.1:1", state, log: silentLogger });
}

test("casamento de títulos com o catálogo", () => {
  const m = (label: string) => matchCatalog(label, CATALOG)?.slug ?? null;
  assert.equal(normalizeTitle("Tom Clancy’s The Division™"), "tom clancy s the division");
  assert.equal(m("Hogwarts Legacy"), "howgarts-legacy");
  assert.equal(m("HOLLOW KNIGHT"), "hollow-knight");
  assert.equal(m("Monster Hunter: World"), "monster-hunter-world-iceborne", "subtítulo separado por ' - '");
  assert.equal(m("Song of Nunu: A League of Legends Story"), "song-of-nunu", "título truncado no catálogo");
  assert.equal(m("Tom Clancy's The Division"), "tom-clancy-s-the-division");
  assert.equal(m("Hades II"), null, "não confunde com Hades");
  assert.equal(m("Metro Exodus"), null, "não confunde por prefixo curto");
  assert.equal(m("Wallpaper Engine"), null);
});

test("parse de tasklist, reg query, VDF/ACF da Steam", (t) => {
  assert.deepEqual(parseTasklistCsv('"System Idle Process","0","Services","0","8 K"\r\n"HollowKnight.exe","4242","Console","1","900.000 K"\r\n'), [
    { name: "System Idle Process", pid: 0 },
    { name: "HollowKnight.exe", pid: 4242 },
  ]);
  const reg = "\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    RunningAppID    REG_DWORD    0x4ea9c\r\n";
  assert.equal(parseRegValue(reg, "RunningAppID"), "0x4ea9c");

  const steam = tempDir(t);
  const lib2 = join(steam, "lib2");
  mkdirSync(join(steam, "steamapps"), { recursive: true });
  mkdirSync(join(lib2, "steamapps"), { recursive: true });
  writeFileSync(
    join(steam, "steamapps", "libraryfolders.vdf"),
    `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam.replace(/\\/g, "\\\\")}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${lib2.replace(/\\/g, "\\\\")}"\n\t}\n}\n`,
  );
  writeFileSync(join(lib2, "steamapps", "appmanifest_367520.acf"), `"AppState"\n{\n\t"appid"\t\t"367520"\n\t"name"\t\t"Hollow Knight"\n\t"installdir"\t\t"Hollow Knight"\n}\n`);
  const library = new SteamLibrary(steam);
  assert.equal(library.libraryPaths().length, 2);
  assert.deepEqual(library.appInfo(367520), { appId: 367520, name: "Hollow Knight", installdir: "Hollow Knight" });
  assert.equal(library.appInfo(1), null);
});

test("emuladores: reconhecimento do executável e conteúdo pelo título da janela", () => {
  const pcsx2 = findEmulator("pcsx2-qt.exe")!;
  assert.equal(pcsx2.id, "pcsx2");
  assert.equal(findEmulator("duckstation-qt-x64-ReleaseLTCG.exe")?.id, "duckstation");
  assert.equal(findEmulator("notepad.exe"), null);
  assert.equal(contentFromWindowTitle("Shadow of the Colossus", pcsx2), "Shadow of the Colossus");
  assert.equal(contentFromWindowTitle("PCSX2 v2.2.0", pcsx2), null, "emulador no menu");
  const dolphin = findEmulator("Dolphin.exe")!;
  assert.equal(contentFromWindowTitle("Dolphin 2412 | JIT64 DC | Vulkan | HLE | The Legend of Zelda: Wind Waker (GZLE01)", dolphin), "The Legend of Zelda: Wind Waker");
  const retroarch = findEmulator("retroarch.exe")!;
  assert.equal(contentFromWindowTitle("RetroArch Snes9x 1.62.3 || Super Metroid (Japan, USA) || 60 fps", retroarch), "Super Metroid (Japan, USA)");
});

function fakeSignals(state: { appId: number | null; processes: { name: string; pid: number }[]; titles?: Record<number, string> }): SystemSignals {
  return {
    listProcesses: async () => state.processes,
    steamRunningAppId: async () => state.appId,
    steamPath: async () => null,
    windowTitle: async (pid) => state.titles?.[pid] ?? null,
  };
}

test("detector: Steam, executável mapeado, emulador, ignorados e prioridade", async (t) => {
  const db = openDatabase(join(tempDir(t), "agent.db"));
  t.after(() => db.close());
  const repo = new GameRepository(db);
  const catalog = catalogWith(CATALOG, db);
  const signals = { appId: 0 as number | null, processes: [] as { name: string; pid: number }[], titles: {} as Record<number, string> };
  const library = { appInfo: (id: number) => (id === 1245620 ? { appId: id, name: "Hogwarts Legacy", installdir: null } : null) };
  const detector = new GameDetector({ signals: fakeSignals(signals), repo, catalog, steamLibrary: () => library as unknown as SteamLibrary });

  assert.equal((await detector.scan()).current, null);

  signals.appId = 1245620;
  let scan = await detector.scan();
  assert.equal(scan.current?.slug, "howgarts-legacy");
  assert.equal(scan.current?.resolvedBy, "auto");
  assert.equal(repo.mapping("steam:1245620")?.origin, "auto", "casamento automático fica fixado");

  // Jogo externo: só é detectado depois de mapeado.
  signals.processes = [{ name: "HollowKnight.exe", pid: 10 }, { name: "pcsx2-qt.exe", pid: 20 }];
  signals.titles[20] = "Shadow of the Colossus";
  scan = await detector.scan();
  assert.deepEqual(scan.detections.map((d) => d.key), ["steam:1245620", "emulator:pcsx2"]);
  applyMapping(repo, catalog, { key: "exe:HollowKnight.exe", slug: "hollow-knight" });
  scan = await detector.scan();
  assert.deepEqual(scan.detections.map((d) => `${d.key}=${d.slug}`), ["steam:1245620=howgarts-legacy", "exe:hollowknight.exe=hollow-knight", "emulator:pcsx2=null"]);
  assert.equal(scan.detections[2].title, "Shadow of the Colossus");

  // Mapeamento manual tem prioridade e "ignore" remove a detecção.
  applyMapping(repo, catalog, { key: "steam:1245620", ignore: true });
  scan = await detector.scan();
  assert.equal(scan.current?.slug, "hollow-knight");
  assert.deepEqual(scan.ignored, ["steam:1245620"]);

  assert.throws(() => applyMapping(repo, catalog, { key: "steam:abc", slug: "x" }), /Chave inválida/);
  assert.throws(() => applyMapping(repo, catalog, { key: "steam:1", slug: "nao-existe" }), /não existe no catálogo/);
});

function sessionSetup(t: { after: (fn: () => void) => void }) {
  const dir = tempDir(t);
  const path = join(dir, "agent.db");
  const open = () => {
    const db = openDatabase(path);
    const repo = new GameRepository(db);
    const events = new EventStore(db, { maxAttempts: 3, retryBaseMs: 10, retryMaxMs: 10 });
    const manager = new SessionManager({
      repo,
      record: (event: NewEvent) => events.record(event),
      log: silentLogger,
      options: { startConfirmMs: 10_000, endGraceMs: 45_000, resumeMaxGapMs: 600_000, touchIntervalMs: 0 },
    });
    return { db, repo, events, manager };
  };
  return { open };
}

const game = (slug: string | null, key = `steam:${slug}`): ResolvedGame => ({
  key,
  source: key.startsWith("emulator") ? "emulator" : "steam",
  label: slug ?? key,
  pid: null,
  exe: null,
  identity: slug ? `game:${slug}` : key,
  slug,
  title: slug ?? key,
  resolvedBy: slug ? "auto" : "unresolved",
  mappingKey: key,
});

test("sessões: confirmação de início, tolerância no fim, troca de jogo e eventos atômicos", (t) => {
  const { db, repo, events, manager } = sessionSetup(t).open();
  t.after(() => db.close());
  const T = 1_000_000;

  manager.observe(game("hades"), T);
  manager.observe(null, T + 5_000); // apareceu só um instante: não abre sessão
  manager.observe(game("hades"), T + 6_000);
  assert.equal(manager.current(), null);
  manager.observe(game("hades"), T + 16_000);
  const first = manager.current()!;
  assert.equal(first.startedAt, T + 6_000, "início = primeira detecção confirmada");

  manager.observe(null, T + 30_000);
  manager.observe(game("hades"), T + 40_000); // reabriu o jogo dentro da tolerância: mesma sessão
  assert.equal(manager.current()?.id, first.id);

  manager.observe(game("metro-last-light"), T + 50_000);
  manager.observe(game("metro-last-light"), T + 60_000);
  const second = manager.current()!;
  assert.notEqual(second.id, first.id);
  assert.equal(repo.session(first.id)?.endReason, "switched");
  assert.equal(repo.session(first.id)?.endedAt, T + 40_000);

  manager.observe(null, T + 80_000);
  manager.observe(null, T + 104_999);
  assert.ok(manager.current());
  manager.observe(null, T + 105_000);
  assert.equal(manager.current(), null);
  const closed = repo.session(second.id)!;
  assert.equal(closed.endReason, "not_detected");
  assert.equal(closed.endedAt, T + 60_000, "fim = último momento visto");

  const list = events.list({ limit: 10 }).reverse();
  assert.deepEqual(list.map((e) => e.type), ["game.session.started", "game.session.ended", "game.session.started", "game.session.ended"]);
  const ended = list[3].payload as { durationSeconds: number; slug: string; endReason: string };
  assert.equal(ended.slug, "metro-last-light");
  assert.equal(ended.durationSeconds, 10);
  assert.equal(list[3].dedupeKey, `game-session:${second.id}:ended`);
  assert.ok(list.every((e) => e.status === "pending"), "eventos aguardam a sincronização (Fase 3)");
});

test("sessões: reclassificação ao mapear durante a sessão", (t) => {
  const { db, repo, manager } = sessionSetup(t).open();
  t.after(() => db.close());
  manager.observe(game(null, "exe:jogo.exe"), 0);
  manager.observe(game(null, "exe:jogo.exe"), 10_000);
  const session = manager.current()!;
  manager.observe({ ...game("hades", "exe:jogo.exe"), source: "process" }, 15_000);
  assert.equal(manager.current()?.id, session.id);
  assert.equal(repo.session(session.id)?.slug, "hades");
});

test("sessões: retomada após reinício e encerramento quando o agente ficou parado demais", (t) => {
  const setup = sessionSetup(t);
  let { db, manager, repo } = setup.open();
  manager.observe(game("hades"), 0);
  manager.observe(game("hades"), 10_000);
  manager.observe(game("hades"), 20_000);
  const id = manager.current()!.id;
  manager.flush(20_000);
  db.close(); // agente parou (ou caiu) com a sessão aberta

  ({ db, manager, repo } = setup.open());
  assert.equal(manager.restore(80_000)?.id, id);
  manager.observe(game("hades"), 80_000);
  assert.equal(manager.current()?.id, id, "mesmo jogo ainda rodando: sessão retomada");
  db.close();

  ({ db, manager, repo } = setup.open());
  assert.equal(manager.restore(80_000 + 600_001), null);
  const closed = repo.session(id)!;
  assert.equal(closed.endReason, "agent_offline");
  assert.equal(closed.endedAt, 80_000);
  assert.equal(repo.openSession(), null);
  db.close();
});

test("módulo games no agente: catálogo do site, sessão real pelo ciclo, rotas da API local", { timeout: 30_000 }, async (t) => {
  const dir = tempDir(t);
  const config = loadConfig({
    dataDir: dir,
    env: { RUMO_AGENT_OBS_ENABLED: "false", RUMO_AGENT_CONTROL_PORT: "0", RUMO_AGENT_GAMES_ENABLED: "true" },
  });
  config.site.url = "http://127.0.0.1:9"; // conexão do site não importa aqui
  Object.assign(config.games, { pollMs: 50, startConfirmMs: 100, endGraceMs: 200 });
  const signals = { appId: 0, processes: [] as { name: string; pid: number }[] };
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ ok: true, games: [...CATALOG, { slug: "apagado", title: "X", isDeleted: true }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  const agent = new Agent({
    config,
    log: silentLogger,
    modules: [gamesModule({ signals: fakeSignals(signals as never), fetchImpl })],
  });
  await agent.start();
  t.after(() => agent.stop("fim"));
  const base = `http://127.0.0.1:${agent.controlPort}/modules/games`;
  const token = readFileSync(join(dir, "control-token"), "utf8");
  const wait = async (cond: () => Promise<boolean>) => {
    const deadline = Date.now() + 10_000;
    while (!(await cond())) {
      if (Date.now() > deadline) throw new Error("timeout");
      await new Promise((r) => setTimeout(r, 30));
    }
  };

  const catalog = await (await fetch(`${base}/catalog`)).json();
  assert.equal(catalog.games.length, CATALOG.length, "jogos apagados ficam fora");

  // Mapeamento pela API exige token.
  const body = JSON.stringify({ key: "exe:HollowKnight.exe", slug: "hollow-knight" });
  assert.equal((await fetch(`${base}/mappings`, { method: "POST", body })).status, 401);
  const mapped = await fetch(`${base}/mappings`, { method: "POST", body, headers: { "x-agent-token": token } });
  assert.equal(mapped.status, 200);

  signals.processes = [{ name: "HollowKnight.exe", pid: 99 }];
  await wait(async () => (await (await fetch(`${base}/status`)).json()).activeSession?.slug === "hollow-knight");
  signals.processes = [];
  await wait(async () => (await (await fetch(`${base}/sessions`)).json()).sessions[0]?.endReason === "not_detected");

  const ended = agent.events.list({ type: "game.session.ended" });
  assert.equal(ended.length, 1);
  assert.equal((ended[0].payload as { slug: string }).slug, "hollow-knight");
  const status = agent.status();
  const games = status.modules.find((m) => m.name === "games")!;
  assert.equal(games.state, "running");
});

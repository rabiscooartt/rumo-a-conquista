// Coletor somente leitura (Etapa 2) com Storage e banco SIMULADOS. Nenhum acesso à rede.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectRemoteSources,
  DEFAULT_LIMITS,
  listBucketTree,
  newCounters,
  readAllRows,
  readDraftSources,
  readPointerSource,
  type LifecycleStorage,
  type SelectPage,
  type ScanIssue,
  type StoredObject,
} from "../../lib/images/lifecycle/collect.ts";
import { classifyImages } from "../../lib/images/lifecycle/classify.ts";
import { referencesFromProtectionList, referencesFromVariantMap, DEFAULT_PROTECTED_OBJECTS } from "../../lib/images/lifecycle/references.ts";
import { bannerImageTarget } from "../../lib/images/storedImages.ts";

const BASE = "https://exemplo.supabase.co/storage/v1/object/public";
const ART = "achievement-art/games/mouse-p-i-for-hire/achievements";

type FakeObject = { size: number; mimetype: string; body?: string; created?: string };

/** Storage em memória: listagem paginada como o Supabase; download de não-JSON FALHA o teste. */
function fakeStorage(files: Record<string, FakeObject>, options: { failList?: RegExp; failDownload?: RegExp; buckets?: string[] } = {}) {
  const downloads: string[] = [];
  const storage: LifecycleStorage = {
    async listBuckets() {
      const names = options.buckets ?? [...new Set(Object.keys(files).map((key) => key.split("/")[0]))];
      return { data: names.map((name) => ({ name })), error: null };
    },
    from(bucket) {
      return {
        async list(path, { limit, offset }) {
          const full = path ? `${bucket}/${path}` : bucket;
          if (options.failList?.test(full)) return { data: null, error: { message: "falha simulada" } };
          const prefix = `${full}/`;
          const entries = new Map<string, { name: string; id: string | null; metadata: { size: number; mimetype: string } | null; created_at?: string; updated_at?: string }>();
          for (const [key, file] of Object.entries(files)) {
            if (!key.startsWith(prefix)) continue;
            const [first, ...rest] = key.slice(prefix.length).split("/");
            if (rest.length > 0) entries.set(first, { name: first, id: null, metadata: null });
            else entries.set(first, { name: first, id: `id-${key}`, metadata: { size: file.size, mimetype: file.mimetype }, created_at: file.created ?? "2026-10-01T00:00:00Z", updated_at: file.created ?? "2026-10-01T00:00:00Z" });
          }
          const sorted = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
          return { data: sorted.slice(offset, offset + limit), error: null };
        },
        async download(path) {
          const key = `${bucket}/${path}`;
          downloads.push(key);
          if (!/\.json$/i.test(path)) throw new Error(`TESTE: download de não-JSON proibido (${key})`);
          if (options.failDownload?.test(key)) return { data: null, error: { message: "falha simulada" } };
          const file = files[key];
          return file ? { data: new Blob([file.body ?? ""]), error: null } : { data: null, error: { message: "Object not found" } };
        },
      };
    },
  };
  return { storage, downloads };
}

function fakeDb(tables: Record<string, Array<Record<string, unknown>>>, options: { failTable?: string; wrongCount?: string } = {}) {
  const calls: string[] = [];
  const selectPage: SelectPage = async (table, columns, orderBy, from, to) => {
    calls.push(`${table}:${from}-${to}:${columns}`);
    if (options.failTable === table) return { data: null, error: { message: "permissão negada" }, count: null };
    const rows = [...(tables[table] ?? [])].sort((a, b) => String(a[orderBy]).localeCompare(String(b[orderBy])));
    const count = options.wrongCount === table ? rows.length + 5 : rows.length;
    return { data: rows.slice(from, to + 1), error: null, count };
  };
  return { selectPage, calls };
}

const png = (size = 2_400_000): FakeObject => ({ size, mimetype: "image/png" });
const webp = (size = 25_000, created?: string): FakeObject => ({ size, mimetype: "image/webp", created });
const json = (body: unknown): FakeObject => ({ size: Buffer.byteLength(JSON.stringify(body)), mimetype: "application/json", body: JSON.stringify(body) });

test("listagem recursiva e paginada: subpastas e mais de 1000 arquivos por pasta", async () => {
  const files: Record<string, FakeObject> = {};
  for (let i = 0; i < 1203; i += 1) files[`achievement-art/games/a/achievements/${String(i).padStart(4, "0")}.png`] = png(10);
  files["achievement-art/games/b/achievements/x.webp"] = webp();
  const { storage } = fakeStorage(files);
  const counters = newCounters();
  const { objects, failedPrefixes } = await listBucketTree(storage, "achievement-art", counters);
  assert.equal(objects.length, 1204);
  assert.deepEqual(failedPrefixes, []);
  assert.ok(counters.listCalls >= 5, "duas páginas na pasta grande, mais as pastas intermediárias");
});

test("pasta que falha fica registrada; o resto continua", async () => {
  const { storage } = fakeStorage(
    { "achievement-art/games/a/achievements/1.png": png(), "achievement-art/games/b/achievements/2.png": png() },
    { failList: /^achievement-art\/games\/b\/achievements$/ }
  );
  const { objects, failedPrefixes } = await listBucketTree(storage, "achievement-art", newCounters());
  assert.deepEqual(objects.map((o) => o.path), ["games/a/achievements/1.png"]);
  assert.deepEqual(failedPrefixes, ["achievement-art/games/b/achievements"]);
});

test("SELECT paginado: lê tudo, confere a contagem exata e só as colunas necessárias", async () => {
  const rows = Array.from({ length: 2501 }, (_, i) => ({ id: `id-${String(i).padStart(5, "0")}`, image: "", official_image: null }));
  const { selectPage, calls } = fakeDb({ achievements: rows });
  const counters = newCounters();
  const result = await readAllRows(selectPage, "achievements", counters);
  assert.equal(result.error, undefined);
  assert.equal(result.rows.length, 2501);
  assert.equal(counters.tablePages, 3);
  assert.ok(calls.every((call) => call.endsWith(":id, image, official_image, game_slug, title")));

  const wrong = await readAllRows(fakeDb({ achievements: rows }, { wrongCount: "achievements" }).selectPage, "achievements", newCounters());
  assert.match(wrong.error!, /diferentes da contagem/);
  const failed = await readAllRows(fakeDb({}, { failTable: "games" }).selectPage, "games", newCounters());
  assert.match(failed.error!, /permissão negada/);
});

test("rascunhos: só JSON, limites de 2 MB e 10 MB, conteúdo descartado, ilegível = incompleto", async () => {
  const draft = { achievements: [{ title: "x", image: `${BASE}/${ART}/manual-x.png` }], notes: "texto privado" };
  const files: Record<string, FakeObject> = {
    "achievement-preparation-drafts/mouse.json": json(draft),
    "game-review-drafts/hades.json": json({ review: "ok" }),
  };
  const { storage, downloads } = fakeStorage(files);
  const issues: ScanIssue[] = [];
  const counters = newCounters();
  const ok = await readDraftSources(storage, new Set(["achievement-preparation-drafts", "game-review-drafts"]), counters, issues);
  assert.equal(ok.status, "complete");
  assert.deepEqual(ok.references.map((r) => [r.objectKey, r.location]), [[`${ART}/manual-x.png`, "drafts:achievement-preparation-drafts/mouse.json.achievements[0].image"]]);
  assert.equal(JSON.stringify(ok).includes("texto privado"), false, "conteúdo privado não é guardado");
  assert.ok(downloads.every((key) => key.endsWith(".json")));
  assert.equal(counters.imageDownloads, 0);

  // Arquivo grande demais: não baixado, fonte parcial.
  const big = fakeStorage({ "achievement-preparation-drafts/big.json": { size: DEFAULT_LIMITS.maxJsonBytes + 1, mimetype: "application/json", body: "{}" } });
  const bigResult = await readDraftSources(big.storage, new Set(["achievement-preparation-drafts", "game-review-drafts"]), newCounters(), []);
  assert.equal(bigResult.status, "partial");
  assert.deepEqual(big.downloads, []);

  // Soma acima de 10 MB: para de baixar, fonte parcial.
  const many: Record<string, FakeObject> = {};
  for (let i = 0; i < 6; i += 1) many[`achievement-preparation-drafts/d${i}.json`] = { size: 1_900_000, mimetype: "application/json", body: "{}" };
  const total = fakeStorage(many);
  const totalResult = await readDraftSources(total.storage, new Set(["achievement-preparation-drafts", "game-review-drafts"]), newCounters(), []);
  assert.equal(totalResult.status, "partial");
  assert.equal(total.downloads.length, 5);

  // JSON ilegível e bucket inexistente: incompleto, nunca vazio.
  const broken = fakeStorage({ "achievement-preparation-drafts/x.json": { size: 10, mimetype: "application/json", body: "{ quebrado" } });
  assert.equal((await readDraftSources(broken.storage, new Set(["achievement-preparation-drafts", "game-review-drafts"]), newCounters(), [])).status, "partial");
  assert.equal((await readDraftSources(storage, new Set(["achievement-preparation-drafts"]), newCounters(), [])).status, "partial");
});

test("ponteiros: ausente sem download, válido, inválido e listagem com falha", async () => {
  const targets = [bannerImageTarget("emblemas"), bannerImageTarget("home"), bannerImageTarget("reviews")];
  const files: Record<string, FakeObject> = {
    "site-profile/active/banner-emblemas.json": json({ file: "background.0446aacfba04d831.webp" }),
    "site-profile/active/banner-reviews.json": json({ file: "../segredo.webp" }),
  };
  const { storage, downloads } = fakeStorage(files);
  const pointerFiles = Object.keys(files).map((key): StoredObject => ({ bucket: "site-profile", path: key.slice("site-profile/".length), isImage: false }));
  const issues: ScanIssue[] = [];
  const { readings, source } = await readPointerSource(storage, targets, pointerFiles, newCounters(), issues);
  assert.deepEqual(readings.map((r) => [r.target.pointer, r.state]), [["banner-emblemas", "present"], ["banner-home", "absent"], ["banner-reviews", "invalid"]]);
  assert.equal(downloads.includes("site-profile/active/banner-home.json"), false, "ausente não é baixado");
  assert.equal(source.status, "partial");

  const failed = await readPointerSource(storage, targets, null, newCounters(), []);
  assert.ok(failed.readings.every((r) => r.state === "unreadable"));
  assert.equal(failed.source.status, "partial");
});

function realisticProject(extraFiles: Record<string, FakeObject> = {}) {
  const files: Record<string, FakeObject> = {
    [`${ART}/01-mestre.png`]: png(),
    [`${ART}/16-de-capa-a-capa.png`]: png(),
    [`${ART}/24-queijo-e-fumaca.png`]: png(),
    [`${ART}/27-nossos-irmaos-menores.png`]: png(),
    [`${ART}/29-tinsel-boulevard.png`]: png(),
    [`${ART}/32-ponta.png`]: png(),
    "site-banners/banners/emblemas/background": png(2_306_263),
    "site-banners/banners/emblemas/background.0446aacfba04d831.webp": webp(245_140, "2026-11-14T20:42:24Z"),
    "site-banners/banners/home/background": webp(50_252),
    "site-profile/profile/avatar": png(300_000),
    "site-profile/profile/settings.json": json({ x: 0 }),
    "achievement-preparation-drafts/mouse.json": json({ image: `${BASE}/${ART}/32-ponta.png` }),
    "game-review-drafts/hades.json": json({}),
    "game-images/achievements/cacada-suprema.png": png(3_344_717),
    "game-images/games/mh/.emptyFolderPlaceholder": { size: 0, mimetype: "application/octet-stream" },
    ...extraFiles,
  };
  const tables = {
    achievements: [{ id: "a1", game_slug: "mouse", title: "Mestre", image: `${BASE}/${ART}/01-mestre.png?v=1`, official_image: null }],
    achievement_progress: [{ id: "p1", image_override: `${BASE}/${ART}/01-mestre.png` }],
    games: [{ slug: "mouse", image: "/images/games/mouse/banner.jpg", final_badge: { image: `${BASE}/${ART}/maestria-sumiu.png` } }],
  };
  return { files, tables };
}

test("integração: inventário completo classificado; nenhuma imagem baixada; primeira varredura sem candidatos", async () => {
  const { files, tables } = realisticProject();
  const { storage, downloads } = fakeStorage(files);
  const collected = await collectRemoteSources(storage, fakeDb(tables).selectPage, undefined, {});
  assert.equal(collected.inventory.status, "complete");
  assert.ok(downloads.every((key) => key.endsWith(".json")));
  assert.equal(collected.counters.imageDownloads, 0);
  assert.equal(collected.nonImageObjects.map((o) => `${o.bucket}/${o.path}`).sort().join(), "game-images/games/mh/.emptyFolderPlaceholder,site-profile/profile/settings.json");

  const report = classifyImages(collected.inventory, [...collected.sources, referencesFromVariantMap({}), referencesFromProtectionList()], { now: new Date("2026-11-15T00:00:00Z") });
  const state = (key: string) => report.objects.find((o) => o.objectKey === key)?.state;
  assert.equal(report.evidenceComplete, true);
  assert.equal(state(`${ART}/01-mestre.png`), "referenced");
  assert.equal(state(`${ART}/32-ponta.png`), "referenced", "citado só no rascunho");
  assert.ok(state("game-images/achievements/cacada-suprema.png"), "game-images entra no inventário e é classificado");
  assert.equal(report.objects.some((o) => o.objectKey.endsWith(".emptyFolderPlaceholder")), false, "marcador de pasta não é imagem");
  for (const key of DEFAULT_PROTECTED_OBJECTS) assert.equal(state(key), "protected");
  assert.equal(state("site-banners/banners/emblemas/background.0446aacfba04d831.webp"), "active");
  assert.equal(state("site-banners/banners/emblemas/background"), "superseded");
  assert.equal(state("site-banners/banners/home/background"), "active");
  assert.equal(state("site-profile/profile/avatar"), "active");
  assert.equal(report.objects.filter((o) => o.state === "candidate").length, 0, "uma única varredura nunca gera candidato");
  assert.deepEqual(report.danglingReferences.map((r) => r.objectKey), [`${ART}/maestria-sumiu.png`]);
});

test("integração com falhas: tabela, bucket de rascunho ou pasta → evidência incompleta, sem candidatos", async () => {
  const { files, tables } = realisticProject();
  const history = [{ scanId: "old", completedAt: "2026-09-01T00:00:00Z", complete: true, unreferenced: [`${ART}/32-ponta.png`, "site-banners/banners/emblemas/background"] }];
  const scenarios = [
    { name: "tabela games", storage: fakeStorage(files).storage, db: fakeDb(tables, { failTable: "games" }) },
    { name: "contagem divergente", storage: fakeStorage(files).storage, db: fakeDb(tables, { wrongCount: "achievement_progress" }) },
    { name: "bucket de rascunho ausente", storage: fakeStorage(files, { buckets: ["achievement-art", "site-banners", "site-profile", "game-review-drafts"] }).storage, db: fakeDb(tables) },
    { name: "pasta de banners", storage: fakeStorage(files, { failList: /^site-banners\/banners$/ }).storage, db: fakeDb(tables) },
    { name: "pasta de ponteiros", storage: fakeStorage(files, { failList: /^site-profile$/ }).storage, db: fakeDb(tables) },
    {
      name: "bucket não previsto (ex.: outro-bucket)",
      storage: fakeStorage(files, { buckets: ["achievement-art", "site-banners", "site-profile", "achievement-preparation-drafts", "game-review-drafts", "game-images", "outro-bucket"] }).storage,
      db: fakeDb(tables),
    },
  ];
  for (const scenario of scenarios) {
    const collected = await collectRemoteSources(scenario.storage, scenario.db.selectPage, undefined, {});
    const report = classifyImages(collected.inventory, [...collected.sources, referencesFromVariantMap({}), referencesFromProtectionList()], { now: new Date("2026-11-15T00:00:00Z"), history });
    assert.equal(report.evidenceComplete, false, scenario.name);
    assert.equal(report.objects.filter((o) => o.state === "candidate").length, 0, scenario.name);
    assert.equal(report.scanRecord.complete, false, scenario.name);
    assert.ok(collected.issues.length > 0, scenario.name);
  }
});

test("game-images ausente do projeto também deixa o inventário parcial (falha fechada)", async () => {
  const { files, tables } = realisticProject();
  const buckets = ["achievement-art", "site-banners", "site-profile", "achievement-preparation-drafts", "game-review-drafts"];
  const collected = await collectRemoteSources(fakeStorage(files, { buckets }).storage, fakeDb(tables).selectPage, undefined, {});
  assert.equal(collected.inventory.status, "partial");
  assert.ok(collected.issues.some((i) => i.where === "game-images"));
});

test("fontes journey_*: referência aninhada em metadata e caminho relativo em tags contam como uso", async () => {
  const { files, tables } = realisticProject();
  const journeyTables = {
    ...tables,
    journey_entries: [{ id: "j1", tags: [{ capa: "achievement-art/games/mouse-p-i-for-hire/achievements/32-ponta.png?v=3" }] }],
    journey_history_events: [{ id: "h1", metadata: { title: "x", detalhes: { imagens: [`${BASE}/${ART}/01-mestre.png`] } } }],
  };
  const collected = await collectRemoteSources(fakeStorage(files).storage, fakeDb(journeyTables).selectPage, undefined, {});
  const byName = Object.fromEntries(collected.sources.map((s) => [s.source, s]));
  assert.equal(byName.journey_entries.status, "complete");
  assert.deepEqual(byName.journey_entries.references.map((r) => [r.objectKey, r.location]), [[`${ART}/32-ponta.png`, "journey_entries:j1.tags[0].capa"]]);
  assert.deepEqual(byName.journey_history_events.references.map((r) => r.location), ["journey_history_events:h1.metadata.detalhes.imagens[0]"]);
  assert.equal(collected.tableCounts.journey_entries, 1);
  assert.equal(collected.tableCounts.journey_history_events, 1);
});

test("fontes journey_*: falha de leitura ou valor ininterpretável deixa a evidência incompleta", async () => {
  const { files, tables } = realisticProject();
  for (const scenario of [
    { name: "tabela journey_history_events falhou", db: fakeDb(tables, { failTable: "journey_history_events" }) },
    { name: "contagem divergente em journey_entries", db: fakeDb(tables, { wrongCount: "journey_entries" }) },
    { name: "URL do Storage ininterpretável em tags", db: fakeDb({ ...tables, journey_entries: [{ id: "j1", tags: ["https://x.supabase.co/storage/v1/object/public/achievement-art/a b.png"] }] }) },
  ]) {
    const collected = await collectRemoteSources(fakeStorage(files).storage, scenario.db.selectPage, undefined, {});
    const report = classifyImages(collected.inventory, [...collected.sources, referencesFromVariantMap({}), referencesFromProtectionList()], { now: new Date("2026-11-15T00:00:00Z") });
    assert.equal(report.evidenceComplete, false, scenario.name);
    assert.ok(report.blockers.some((b) => b.includes("journey")), `${scenario.name}: ${report.blockers.join(" | ")}`);
  }
});

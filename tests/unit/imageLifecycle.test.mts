// Núcleo de identificação e classificação do ciclo de vida das imagens.
// Só dados simulados e relatórios locais: nenhum acesso a rede, banco ou Storage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  DEFAULT_PROTECTED_OBJECTS,
  objectKeyFromReference,
  referencesFromAchievements,
  referencesFromDrafts,
  referencesFromGames,
  referencesFromJourneyEntries,
  referencesFromJourneyHistory,
  referencesFromPointers,
  referencesFromProgress,
  referencesFromProtectionList,
  referencesFromVariantMap,
  type SourceResult,
} from "../../lib/images/lifecycle/references.ts";
import {
  classifyImages,
  type ClassificationReport,
  type InventorySnapshot,
  type ScanRecord,
  type StorageObjectInfo,
} from "../../lib/images/lifecycle/classify.ts";
import { AVATAR_IMAGE_TARGET, bannerImageTarget } from "../../lib/images/storedImages.ts";

const BASE = "https://exemplo.supabase.co/storage/v1/object/public";
const ART = "achievement-art/games/mouse-p-i-for-hire/achievements";
const NOW = new Date("2026-12-31T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const obj = (key: string, extra: Partial<StorageObjectInfo> = {}): StorageObjectInfo => {
  const [bucket, ...rest] = key.split("/");
  return { bucket, path: rest.join("/"), createdAt: daysAgo(60), updatedAt: daysAgo(60), ...extra };
};

/** As sete fontes completas e vazias; cada teste substitui as que interessam. */
function sources(overrides: Partial<Record<SourceResult["source"], SourceResult>> = {}): SourceResult[] {
  const all: Record<SourceResult["source"], SourceResult> = {
    achievements: referencesFromAchievements([]),
    achievement_progress: referencesFromProgress([]),
    games: referencesFromGames([]),
    journey_entries: referencesFromJourneyEntries([]),
    journey_history_events: referencesFromJourneyHistory([]),
    pointers: referencesFromPointers([]),
    drafts: referencesFromDrafts([]),
    variant_map: referencesFromVariantMap({}),
    protection: referencesFromProtectionList([]),
    ...overrides,
  };
  return Object.values(all);
}

const inventory = (objects: StorageObjectInfo[], extra: Partial<InventorySnapshot> = {}): InventorySnapshot => ({
  status: "complete",
  objects,
  ...extra,
});

/** Histórico com uma varredura completa antiga em que os objetos já estavam sem referência. */
const oldScan = (keys: string[], days = 40): ScanRecord => ({ scanId: "s1", completedAt: daysAgo(days), complete: true, unreferenced: keys });

const stateOf = (report: ClassificationReport, key: string) => report.objects.find((item) => item.objectKey === key)?.state;

/** Garantia transversal: nada ativo, referenciado, protegido ou não verificado vira candidato. */
function assertNoUnsafeCandidates(report: ClassificationReport) {
  for (const item of report.objects) {
    if (item.state !== "candidate") continue;
    assert.equal(item.references.length, 0, `${item.objectKey} tem referência e virou candidato`);
    assert.ok(report.evidenceComplete, `${item.objectKey} virou candidato com evidência incompleta`);
  }
}

test("normalização: URL pública, ?v=, assinada, de transformação, codificada e chave direta", () => {
  const key = `${ART}/01-mestre.png`;
  assert.equal(objectKeyFromReference(`${BASE}/${key}`), key);
  assert.equal(objectKeyFromReference(`${BASE}/${key}?v=1793662305750`), key);
  assert.equal(objectKeyFromReference(`https://x.supabase.co/storage/v1/object/sign/${key}?token=abc`), key);
  assert.equal(objectKeyFromReference(`https://x.supabase.co/storage/v1/render/image/public/${key}?width=64`), key);
  assert.equal(objectKeyFromReference(`${BASE}/${ART}/Arte%20com%20espa%C3%A7o.png`), `${ART}/Arte com espaço.png`);
  assert.equal(objectKeyFromReference(key, ["achievement-art"]), key);
  assert.equal(objectKeyFromReference("/images/games/hades/emblem.png"), null);
  assert.equal(objectKeyFromReference(`${BASE}/achievement-art/../segredo.png`), null);
});

test("1. referenciada diretamente em achievements.image", () => {
  const key = `${ART}/01-mestre.png`;
  const report = classifyImages(inventory([obj(key)]), sources({
    achievements: referencesFromAchievements([{ id: "a1", image: `${BASE}/${key}` }]),
  }), { now: NOW, history: [oldScan([key])] });
  assert.equal(stateOf(report, key), "referenced");
  assertNoUnsafeCandidates(report);
});

test("2. referenciada em achievement_progress.image_override", () => {
  const key = `${ART}/30-felicidade-do-quint.png`;
  const report = classifyImages(inventory([obj(key)]), sources({
    achievement_progress: referencesFromProgress([{ id: "p1", image_override: `${BASE}/${key}` }]),
  }), { now: NOW, history: [oldScan([key])] });
  assert.equal(stateOf(report, key), "referenced");
  assert.equal(report.objects[0].references[0].location, "achievement_progress:p1.image_override");
});

test("3. a mesma imagem com e sem ?v= é o mesmo objeto", () => {
  const key = `${ART}/01-mestre.png`;
  const report = classifyImages(inventory([obj(key)]), sources({
    achievements: referencesFromAchievements([{ id: "a1", image: `${BASE}/${key}?v=1793662305750` }]),
    achievement_progress: referencesFromProgress([{ id: "p1", image_override: `${BASE}/${key}` }]),
  }), { now: NOW, history: [oldScan([key])] });
  assert.equal(stateOf(report, key), "referenced");
  assert.equal(report.objects[0].references.length, 2);
});

test("4. referência dentro de JSON de jogos (final_badge, emblem, JSON em texto)", () => {
  const mastery = `${ART}/maestria-final.webp`;
  const emblem = "achievement-art/games/hades/achievements/emblema.png";
  const report = classifyImages(inventory([obj(mastery), obj(emblem)]), sources({
    games: referencesFromGames([
      { slug: "mouse", final_badge: { title: "Maestria", image: `${BASE}/${mastery}?v=2` } },
      { slug: "hades", emblem: JSON.stringify({ image: `${BASE}/${emblem}`, extras: [{ deep: "x" }] }) },
    ]),
  }), { now: NOW, history: [oldScan([mastery, emblem])] });
  assert.equal(stateOf(report, mastery), "referenced");
  assert.equal(stateOf(report, emblem), "referenced");
  assert.match(report.objects[0].references[0].location, /games:mouse\.final_badge\.image/);
});

test("5. imagem apontada por ponteiro ativo", () => {
  const target = bannerImageTarget("emblemas");
  const legacy = "site-banners/banners/emblemas/background";
  const pointed = "site-banners/banners/emblemas/background.0446aacfba04d831.webp";
  const newer = "site-banners/banners/emblemas/background.1111111111111111.webp";
  const report = classifyImages(
    inventory([obj(legacy, { updatedAt: daysAgo(50) }), obj(pointed, { createdAt: daysAgo(20) }), obj(newer, { createdAt: daysAgo(5) })]),
    sources({ pointers: referencesFromPointers([{ target, state: "present", file: "background.0446aacfba04d831.webp" }]) }),
    { now: NOW, history: [oldScan([legacy])] }
  );
  // O ponteiro vale mais que a data: o arquivo apontado é o ativo, não o mais novo.
  const pointedItem = report.objects.find((item) => item.objectKey === pointed)!;
  assert.equal(pointedItem.state, "active");
  assert.deepEqual(pointedItem.reasons, ["versão ativa pelo ponteiro"]);
  assert.equal(pointedItem.references[0].source, "pointers");
  assert.equal(stateOf(report, newer), "observing", "o mais novo sem ponteiro só está em observação");
  assertNoUnsafeCandidates(report);

  // Sem ponteiro, a versão mais recente da pasta é a ativa e nunca é candidata.
  const fallback = classifyImages(inventory([obj(legacy, { updatedAt: daysAgo(50) }), obj(pointed, { createdAt: daysAgo(20) })]), sources(), {
    now: NOW,
    history: [oldScan([legacy, pointed])],
  });
  assert.equal(stateOf(fallback, pointed), "active");
  assert.equal(stateOf(fallback, legacy), "candidate", "legado substituído e sem referência há mais que o prazo");
  assertNoUnsafeCandidates(fallback);
});

test("6. imagem citada em rascunho privado", () => {
  const key = `${ART}/manual-estreia-vitoriosa.png`;
  const report = classifyImages(inventory([obj(key)]), sources({
    drafts: referencesFromDrafts([{ bucket: "achievement-preparation-drafts", path: "mouse.json", content: JSON.stringify({ achievements: [{ image: `${BASE}/${key}` }] }) }]),
  }), { now: NOW, history: [oldScan([key])] });
  assert.equal(stateOf(report, key), "referenced");
});

test("7. imagem presente no mapa local de cópias", () => {
  const key = `${ART}/12-hora-do-b-a-n-g.png`;
  const report = classifyImages(inventory([obj(key)]), sources({
    variant_map: referencesFromVariantMap({ [`${BASE}/${key}`]: "/images/home/mouse-12.webp", "/images/local.png": "/images/home/local.webp" }),
  }), { now: NOW, history: [oldScan([key])] });
  assert.equal(stateOf(report, key), "referenced");
});

test("8. as quatro artes corretas do Mouse ficam protegidas mesmo sem referência", () => {
  const keys = [...DEFAULT_PROTECTED_OBJECTS];
  assert.deepEqual(keys.map((key) => key.split("/").pop()), [
    "16-de-capa-a-capa.png",
    "24-queijo-e-fumaca.png",
    "27-nossos-irmaos-menores.png",
    "29-tinsel-boulevard.png",
  ]);
  const report = classifyImages(inventory(keys.map((key) => obj(key))), sources({ protection: referencesFromProtectionList() }), {
    now: NOW,
    history: [oldScan(keys, 400)],
  });
  for (const key of keys) assert.equal(stateOf(report, key), "protected");
  assertNoUnsafeCandidates(report);
});

test("9. falha na leitura de qualquer fonte: nenhum candidato", () => {
  const key = `${ART}/26-ta-pegando-fogo-bicho.png`;
  const failures: Partial<Record<SourceResult["source"], SourceResult>>[] = [
    { achievements: referencesFromAchievements(null, "timeout") },
    { achievement_progress: referencesFromProgress(null, "401") },
    { games: referencesFromGames(null, "erro de rede") },
    { pointers: referencesFromPointers([{ target: bannerImageTarget("home"), state: "unreadable", error: "500" }]) },
    { drafts: referencesFromDrafts([{ bucket: "game-review-drafts", path: "x.json", content: "{ quebrado" }]) },
    { variant_map: referencesFromVariantMap(null, "arquivo ausente") },
    { protection: referencesFromProtectionList(["nao-e-uma-chave"]) },
  ];
  for (const override of failures) {
    const report = classifyImages(inventory([obj(key)]), sources(override), { now: NOW, history: [oldScan([key], 400)] });
    assert.equal(report.evidenceComplete, false, Object.keys(override)[0]);
    assert.equal(stateOf(report, key), "unverified", Object.keys(override)[0]);
    assert.equal(report.scanRecord.complete, false, "varredura incompleta não vale como evidência");
    assertNoUnsafeCandidates(report);
  }
  // Fonte simplesmente ausente também bloqueia.
  const missing = classifyImages(inventory([obj(key)]), sources().filter((source) => source.source !== "drafts"), { now: NOW, history: [oldScan([key], 400)] });
  assert.equal(stateOf(missing, key), "unverified");
  assert.ok(missing.blockers.includes("fonte ausente: drafts"));
});

test("10. inventário incompleto: nenhum candidato, nem fora da pasta que falhou", () => {
  const key = `${ART}/26-ta-pegando-fogo-bicho.png`;
  const other = "achievement-art/games/hades/achievements/x.png";
  const report = classifyImages(
    inventory([obj(key), obj(other)], { status: "partial", failedPrefixes: ["achievement-art/games/hades/achievements"] }),
    sources(),
    { now: NOW, history: [oldScan([key, other], 400)] }
  );
  assert.equal(report.evidenceComplete, false);
  assert.equal(stateOf(report, key), "unverified");
  assert.equal(stateOf(report, other), "unverified");
  assertNoUnsafeCandidates(report);
});

test("11. duplicatas com hash idêntico: identificadas, nunca candidatas", () => {
  const kept = `${ART}/01-mestre.webp`;
  const copyA = `${ART}/01-mestre-copia.webp`;
  const copyB = "achievement-art/games/outro/achievements/igual.webp";
  const report = classifyImages(
    inventory([obj(kept, { sha256: "aa" }), obj(copyA, { sha256: "aa" }), obj(copyB, { sha256: "aa" })]),
    sources({ achievements: referencesFromAchievements([{ id: "a1", image: `${BASE}/${kept}` }]) }),
    { now: NOW, history: [oldScan([copyA, copyB], 400)] }
  );
  assert.equal(stateOf(report, kept), "referenced");
  assert.equal(stateOf(report, copyA), "duplicate");
  assert.equal(stateOf(report, copyB), "duplicate");
  assert.deepEqual(report.duplicateGroups, [[copyB, copyA, kept].sort()]);
  assertNoUnsafeCandidates(report);
});

test("12. sem referência em apenas uma varredura: observando, não candidato", () => {
  const key = `${ART}/26-ta-pegando-fogo-bicho.png`;
  const first = classifyImages(inventory([obj(key)]), sources(), { now: NOW, history: [] });
  assert.equal(stateOf(first, key), "observing");
  assert.deepEqual(first.scanRecord.unreferenced, [key], "fica registrado para a próxima varredura");

  // Duas varreduras, mas antes do prazo: ainda não.
  const early = classifyImages(inventory([obj(key)]), sources(), { now: NOW, history: [oldScan([key], 10)] });
  assert.equal(stateOf(early, key), "observing");
  assertNoUnsafeCandidates(early);
});

test("13. sem referência em duas varreduras completas separadas pelo prazo: candidato", () => {
  const key = `${ART}/26-ta-pegando-fogo-bicho.png`;
  const report = classifyImages(inventory([obj(key)]), sources({ protection: referencesFromProtectionList() }), {
    now: NOW,
    history: [oldScan([key], 31), { scanId: "s2", completedAt: daysAgo(5), complete: true, unreferenced: [key] }],
    safetyPeriodDays: 30,
  });
  const item = report.objects[0];
  assert.equal(item.state, "candidate");
  assert.equal(item.unreferencedSince, daysAgo(31));
  assertNoUnsafeCandidates(report);

  // Varreduras incompletas não contam como evidência.
  const onlyIncomplete = classifyImages(inventory([obj(key)]), sources(), {
    now: NOW,
    history: [{ scanId: "s0", completedAt: daysAgo(90), complete: false, unreferenced: [key] }],
  });
  assert.equal(stateOf(onlyIncomplete, key), "observing");
});

test("14. referência que reaparece numa varredura posterior reinicia a contagem", () => {
  const key = `${ART}/26-ta-pegando-fogo-bicho.png`;
  const history: ScanRecord[] = [
    oldScan([key], 90),
    { scanId: "s2", completedAt: daysAgo(40), complete: true, unreferenced: [] }, // voltou a ser usada
    { scanId: "s3", completedAt: daysAgo(10), complete: true, unreferenced: [key] },
  ];
  const report = classifyImages(inventory([obj(key)]), sources(), { now: NOW, history });
  assert.equal(stateOf(report, key), "observing");
  assert.equal(report.objects[0].unreferencedSince, daysAgo(10));

  // E se a referência estiver presente agora, é referenciada, qualquer que seja o histórico.
  const now = classifyImages(inventory([obj(key)]), sources({
    achievements: referencesFromAchievements([{ id: "a9", image: `${BASE}/${key}` }]),
  }), { now: NOW, history: [oldScan([key], 400)] });
  assert.equal(stateOf(now, key), "referenced");
});

test("versão substituída e referência pendurada são informadas sem efeito", () => {
  const legacy = `${ART}/31-mortissima.png`;
  const webp = `${ART}/31-mortissima.0123456789abcdef.webp`;
  const report = classifyImages(
    inventory([obj(legacy, { updatedAt: daysAgo(60) }), obj(webp, { createdAt: daysAgo(2) })]),
    sources({ achievements: referencesFromAchievements([{ id: "a1", image: `${BASE}/${webp}` }, { id: "a2", image: `${BASE}/${ART}/sumiu.png` }]) }),
    { now: NOW }
  );
  assert.equal(stateOf(report, webp), "referenced");
  assert.equal(stateOf(report, legacy), "superseded");
  assert.deepEqual(report.danglingReferences.map((ref) => ref.objectKey), [`${ART}/sumiu.png`]);
});

test("avatar: versão mais recente da pasta é ativa; settings.json não é imagem", () => {
  const avatar = "site-profile/profile/avatar";
  const settings = "site-profile/profile/settings.json";
  const report = classifyImages(inventory([obj(avatar), obj(settings)]), sources(), { now: NOW });
  assert.equal(stateOf(report, avatar), "active");
  assert.equal(AVATAR_IMAGE_TARGET.baseName, "avatar");
});

test("relatórios locais reais: com fontes faltando, nenhuma imagem vira candidata", { skip: !existsSync(".image-report/storage-migration/db-refs.json") || !existsSync(".image-report/storage-migration/plan.json") }, () => {
  const refs = JSON.parse(readFileSync(".image-report/storage-migration/db-refs.json", "utf8"));
  const plan = JSON.parse(readFileSync(".image-report/storage-migration/plan.json", "utf8"));
  const base = String(plan.find((record: { oldUrl?: string }) => record.oldUrl)?.oldUrl).split("/storage/")[0];
  const real = (value: string | null) => (value ? value.replace("<BASE>", base) : value);

  const objects: StorageObjectInfo[] = plan.map((record: { bucket: string; path: string }) => ({ bucket: record.bucket, path: record.path }));
  const partialSources = [
    referencesFromAchievements(refs.achievements.map((row: { id: string; image: string }) => ({ ...row, image: real(row.image) }))),
    referencesFromProgress(refs.progress.map((row: { id: string; image_override: string | null }) => ({ ...row, image_override: real(row.image_override) }))),
    referencesFromVariantMap(JSON.parse(readFileSync("data/homeImageVariants.json", "utf8"))),
    referencesFromProtectionList(),
    // games, pointers e drafts não foram lidos localmente: a evidência fica incompleta.
  ];
  const report = classifyImages(inventory(objects), partialSources, { now: NOW, history: [oldScan(objects.map((o) => `${o.bucket}/${o.path}`), 400)] });

  assert.equal(report.evidenceComplete, false);
  assertNoUnsafeCandidates(report);
  assert.equal(report.objects.filter((item) => item.state === "candidate").length, 0);
  for (const key of DEFAULT_PROTECTED_OBJECTS) assert.equal(stateOf(report, key), "protected");
  // As 29 artes exibidas pelo Mouse estão referenciadas pelo banco e pelo mapa local.
  const shown = refs.progress.map((row: { image_override: string }) => `${real(row.image_override)}`.split("/storage/v1/object/public/")[1]?.split("?")[0]);
  for (const key of shown) assert.equal(stateOf(report, key), "referenced", key);
});

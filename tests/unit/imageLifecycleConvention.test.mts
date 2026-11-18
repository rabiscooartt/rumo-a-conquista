// Referências implícitas por convenção de nome (GameAchievementsPanel): a função compartilhada
// reproduz EXATAMENTE a lógica anterior do painel, e a varredura conta como uso todo objeto que o
// painel pode exibir assim — esse objeto nunca vira candidato ao arquivamento.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildAchievementImageCandidates, buildAutoImagePath, conventionObjectKeys, conventionStoragePaths, slugifyAchievementTitle,
} from "../../lib/achievementImageCandidates.ts";
import { referencesFromConvention, referencesFromProtectionList, referencesFromVariantMap, type SourceResult } from "../../lib/images/lifecycle/references.ts";
import { classifyImages, type InventorySnapshot } from "../../lib/images/lifecycle/classify.ts";

const SUPA = "https://abc.supabase.co";
const STORAGE = `${SUPA}/storage/v1/object/public/achievement-art`;

// ---------- Oráculo: cópia literal da lógica do painel ANTES da extração (commit 8ae45a8) ----------
function oNormalizeText(text?: string) {
  return (text ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function oSlugify(text: string) {
  return oNormalizeText(text).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function oBuildAutoImagePath(gameSlug: string, achievementTitle: string, index?: number) {
  if (!gameSlug || !achievementTitle) return "";
  const slug = oSlugify(achievementTitle);
  const numbered = typeof index === "number" ? `/images/games/${gameSlug}/achievements/${String(index + 1).padStart(2, "0")}-${slug}.png` : "";
  return numbered || `/images/games/${gameSlug}/achievements/${slug}.png`;
}
function oCandidates(gameSlug: string, achievement: { title?: string; image?: string }, state: { image?: string } | undefined, index: number | undefined, supabase: string | undefined) {
  const candidates: string[] = [];
  const explicit = state?.image?.trim() || achievement.image?.trim();
  if (explicit) candidates.push(explicit);
  const local = oBuildAutoImagePath(gameSlug, achievement.title as string, index);
  if (local) candidates.push(local);
  const supabaseBase = supabase?.trim().replace(/\/$/, "");
  if (supabaseBase && gameSlug && achievement.title) {
    const slug = oSlugify(achievement.title);
    const bucketBase = `${supabaseBase}/storage/v1/object/public/achievement-art/games/${gameSlug}/achievements/`;
    if (typeof index === "number") candidates.push(`${bucketBase}${String(index + 1).padStart(2, "0")}-${slug}.png`);
    candidates.push(`${bucketBase}${slug}.png`);
  }
  return Array.from(new Set(candidates));
}

const TITLES = ["Mestre dos Macetes", "Caçada Suprema", "Ação & Reação!", "  espaços  ", "1-Up", "Ñandú — Über", "", "---", "Maestria Final"];
const INDEXES = [undefined, 0, 1, 8, 9, 98, 99, 100, 137];

test("paridade: a função compartilhada devolve exatamente o mesmo que a lógica anterior do painel", () => {
  let cases = 0;
  for (const title of TITLES) {
    for (const index of INDEXES) {
      for (const [image, state] of [[undefined, undefined], ["https://x/explicita.webp", undefined], ["", { image: " /images/manual.png " }], [undefined, { image: "" }]] as const) {
        for (const supa of [SUPA, `${SUPA}/`, undefined, ""]) {
          for (const slug of ["mouse-p-i-for-hire", ""]) {
            const achievement = { title, image };
            assert.deepEqual(buildAchievementImageCandidates(slug, achievement, state, index, supa), oCandidates(slug, achievement, state, index, supa));
            cases += 1;
          }
        }
      }
    }
    assert.equal(slugifyAchievementTitle(title), oSlugify(title));
    for (const index of INDEXES) assert.equal(buildAutoImagePath("jogo", title, index), oBuildAutoImagePath("jogo", title, index));
  }
  assert.ok(cases > 2000);
});

test("o painel público usa a função compartilhada (não há cópia local da lógica)", () => {
  const panel = readFileSync("components/GameAchievementsPanel.tsx", "utf8");
  assert.match(panel, /from "@\/lib\/achievementImageCandidates"/);
  assert.doesNotMatch(panel, /function buildAchievementImageCandidates|function buildAutoImagePath|function slugify/);
  assert.doesNotMatch(panel, /storage\/v1\/object\/public\/achievement-art/);
});

test("imagem explícita existente: primeira tentativa; a convenção continua como alternativa se ela falhar", () => {
  const list = buildAchievementImageCandidates("mouse", { title: "Mestre", image: "https://x/arte.webp" }, undefined, 2, SUPA);
  assert.deepEqual(list, ["https://x/arte.webp", "/images/games/mouse/achievements/03-mestre.png", `${STORAGE}/games/mouse/achievements/03-mestre.png`, `${STORAGE}/games/mouse/achievements/mestre.png`]);
});

test("imagem explícita ausente: começa no arquivo local e cai no Storage por convenção", () => {
  const list = buildAchievementImageCandidates("mouse", { title: "Mestre", image: "  " }, { image: "" }, 0, SUPA);
  assert.deepEqual(list, ["/images/games/mouse/achievements/01-mestre.png", `${STORAGE}/games/mouse/achievements/01-mestre.png`, `${STORAGE}/games/mouse/achievements/mestre.png`]);
});

test("nomes com e sem numeração; só .png é previsto pela convenção (a explícita mantém a extensão dela)", () => {
  assert.deepEqual(conventionStoragePaths("mouse", "Caçada Suprema"), ["games/mouse/achievements/cacada-suprema.png"]);
  assert.deepEqual(conventionStoragePaths("mouse", "Caçada Suprema", 99), ["games/mouse/achievements/100-cacada-suprema.png", "games/mouse/achievements/cacada-suprema.png"]);
  const all = buildAchievementImageCandidates("mouse", { title: "X", image: "https://x/y.webp" }, undefined, 4, SUPA);
  assert.ok(all.slice(1).every((c) => c.endsWith(".png")));
  assert.equal(all[0], "https://x/y.webp");
  const keys = [...conventionObjectKeys("mouse", ["A B"], 3)].sort();
  assert.deepEqual(keys, ["achievement-art/games/mouse/achievements/01-a-b.png", "achievement-art/games/mouse/achievements/02-a-b.png", "achievement-art/games/mouse/achievements/03-a-b.png", "achievement-art/games/mouse/achievements/a-b.png"]);
});

const ART = "achievement-art/games/mouse/achievements";
const existing = new Set([`${ART}/16-de-capa-a-capa.png`, `${ART}/de-capa-a-capa.png`, `${ART}/99-de-capa-a-capa.png`, `${ART}/sobra-qualquer.png`, `${ART}/04-maestria-final.png`, `${ART}/02-arte-local.png`]);
const games = [{ slug: "mouse", final_badge: { title: "", image: "", description: "fim" } }];
const achievements = [
  { id: "1", game_slug: "mouse", title: "De Capa a Capa", image: "https://x/explicita.webp" },
  ...Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, game_slug: "mouse", title: `Outra ${i}`, image: "" })),
];

test("objetos por convenção já existentes no Storage viram referências (numeração até o total exibido)", () => {
  const source = referencesFromConvention({ games, achievements, legacyGames: { mouse: { achievementsList: [{ title: "Arte Local" }] } }, existingObjectKeys: existing });
  assert.equal(source.status, "complete");
  const keys = source.references.map((r) => r.objectKey).sort();
  // 16 e sem número: exibíveis; 99 > total exibido (21 conquistas + Maestria) não; Maestria sem título vira "Maestria Final";
  // título só dos dados locais também conta. Objeto fora da convenção nunca entra.
  assert.deepEqual(keys, [`${ART}/02-arte-local.png`, `${ART}/04-maestria-final.png`, `${ART}/16-de-capa-a-capa.png`, `${ART}/de-capa-a-capa.png`]);
  assert.ok(source.references.every((r) => r.source === "convention" && existing.has(r.objectKey)), "só objetos existentes (sem referências penduradas)");
});

test("falha ao resolver (jogos, conquistas, dados locais ou inventário) bloqueia a elegibilidade", () => {
  const base = { games, achievements, legacyGames: {}, existingObjectKeys: existing };
  for (const broken of [{ errors: ["permissão negada"] }, { games: null }, { achievements: null }, { legacyGames: null }, { existingObjectKeys: null }]) {
    assert.equal(referencesFromConvention({ ...base, ...broken } as never).status, "failed", JSON.stringify(Object.keys(broken)));
  }
  const semSlug = referencesFromConvention({ ...base, achievements: [{ id: "x", title: "Sem jogo" }] });
  assert.equal(semSlug.status, "partial");
});

// Cenário de candidato real (mesmo do teste de evidência): sem a convenção, o objeto vira candidato.
const KEY = `${ART}/16-de-capa-a-capa.png`;
const inventory: InventorySnapshot = { status: "complete", failedPrefixes: [], objects: [{ bucket: "achievement-art", path: "games/mouse/achievements/16-de-capa-a-capa.png", size: 1, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }] };
const empty = (source: string) => ({ source, status: "complete", references: [] }) as unknown as SourceResult;
const others = () => ["achievements", "achievement_progress", "games", "journey_entries", "journey_history_events", "pointers", "drafts"].map(empty)
  .concat([referencesFromVariantMap({}), referencesFromProtectionList([])]);
const history = [{ scanId: "scan-20260701T000000Z", completedAt: "2026-07-01T00:00:00Z", complete: true, unreferenced: [KEY], present: [KEY] }];
const run = (convention: SourceResult) => classifyImages(inventory, [...others(), convention], { now: new Date("2026-09-01T00:00:00Z"), history });

test("objeto exibido implicitamente nunca vira candidato; sem a convenção, viraria", () => {
  const withoutUse = run(referencesFromConvention({ games: [], achievements: [], legacyGames: {}, existingObjectKeys: new Set([KEY]) }));
  assert.equal(withoutUse.objects[0].state, "candidate", "controle: sem uso implícito, a prova de duas varreduras o tornaria candidato");
  const implicit = run(referencesFromConvention({ games, achievements, legacyGames: {}, existingObjectKeys: new Set([KEY]) }));
  assert.equal(implicit.objects[0].state, "referenced");
  assert.equal(implicit.scanRecord.unreferenced.includes(KEY), false, "não conta como sem referência para a próxima varredura");
  const failed = run(referencesFromConvention({ games: null, achievements, legacyGames: {}, existingObjectKeys: new Set([KEY]) }));
  assert.equal(failed.evidenceComplete, false);
  assert.notEqual(failed.objects[0].state, "candidate");
  assert.ok(failed.blockers.some((b) => /fonte convention failed/.test(b)));
});

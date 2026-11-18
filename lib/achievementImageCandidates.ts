// Resolução das imagens das conquistas na página pública (GameAchievementsPanel) — fonte ÚNICA.
// O painel e o inventário do ciclo de vida das imagens usam estas mesmas funções: qualquer objeto do
// Storage que o painel pode exibir por convenção de nome precisa contar como referência na varredura.
//
// Ordem das tentativas no painel (cada falha de carregamento passa para a seguinte):
//   1. imagem explícita (estado manual ou campo image da conquista), se houver;
//   2. arquivo local /images/games/<jogo>/achievements/<NN>-<slug>.png (com posição) ou <slug>.png;
//   3. Storage achievement-art/games/<jogo>/achievements/<NN>-<slug>.png (só com posição);
//   4. Storage achievement-art/games/<jogo>/achievements/<slug>.png.
// <NN> é a posição (1-based, 2 dígitos) da conquista na lista EXIBIDA — que depende da busca e da
// ordenação escolhidas pelo visitante. Por isso, no inventário, qualquer posição de 1 até o total
// exibido é possível.

export const ACHIEVEMENT_ART_BUCKET = "achievement-art";

function normalizeText(text?: string) {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Slug do título, igual ao do painel. */
export function slugifyAchievementTitle(text: string) {
  return normalizeText(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const numbered = (index: number, slug: string) => `${String(index + 1).padStart(2, "0")}-${slug}.png`;

/** Caminho local automático (public/images/...). */
export function buildAutoImagePath(gameSlug: string, achievementTitle: string, index?: number) {
  if (!gameSlug || !achievementTitle) {
    return "";
  }
  const slug = slugifyAchievementTitle(achievementTitle);
  const local =
    typeof index === "number"
      ? `/images/games/${gameSlug}/achievements/${numbered(index, slug)}`
      : "";
  return local || `/images/games/${gameSlug}/achievements/${slug}.png`;
}

/**
 * Caminhos (dentro do bucket achievement-art) que o painel tenta no Storage por convenção,
 * na mesma ordem do painel.
 */
export function conventionStoragePaths(gameSlug: string, achievementTitle: string | undefined, index?: number) {
  if (!gameSlug || !achievementTitle) return [];
  const slug = slugifyAchievementTitle(achievementTitle);
  const base = `games/${gameSlug}/achievements/`;
  const paths: string[] = [];
  if (typeof index === "number") paths.push(`${base}${numbered(index, slug)}`);
  paths.push(`${base}${slug}.png`);
  return paths;
}

/** Lista completa de tentativas do painel, na ordem. */
export function buildAchievementImageCandidates(
  gameSlug: string,
  achievement: { title?: string; image?: string },
  state?: { image?: string },
  index?: number,
  supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL
) {
  const candidates: string[] = [];
  const explicit = state?.image?.trim() || achievement.image?.trim();

  if (explicit) {
    candidates.push(explicit);
  }

  const local = buildAutoImagePath(gameSlug, achievement.title ?? "", index);
  if (local) candidates.push(local);

  const supabaseBase = supabaseUrl?.trim().replace(/\/$/, "");
  if (supabaseBase && gameSlug && achievement.title) {
    for (const path of conventionStoragePaths(gameSlug, achievement.title, index)) {
      candidates.push(`${supabaseBase}/storage/v1/object/public/${ACHIEVEMENT_ART_BUCKET}/${path}`);
    }
  }

  return Array.from(new Set(candidates));
}

/**
 * Todos os objetos ("achievement-art/<caminho>") que o painel PODE exibir por convenção para um jogo:
 * para cada título, o nome sem número e o numerado em qualquer posição de 1 até `displayedCount`.
 * Vale também quando há imagem explícita: se ela falhar ao carregar, o painel cai na convenção.
 */
export function conventionObjectKeys(gameSlug: string, titles: string[], displayedCount: number) {
  const keys = new Set<string>();
  const total = Math.max(displayedCount, titles.length);
  for (const title of titles) {
    keys.add(`${ACHIEVEMENT_ART_BUCKET}/${conventionStoragePaths(gameSlug, title)[0] ?? ""}`);
    for (let index = 0; index < total; index += 1) {
      for (const path of conventionStoragePaths(gameSlug, title, index)) keys.add(`${ACHIEVEMENT_ART_BUCKET}/${path}`);
    }
  }
  keys.delete(`${ACHIEVEMENT_ART_BUCKET}/`);
  return keys;
}

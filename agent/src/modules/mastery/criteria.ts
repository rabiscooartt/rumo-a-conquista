import type { SiteAchievement, SiteGameMeta } from "../achievements/siteAchievements.ts";

/*
 * Critério de conclusão integral — o mesmo do site (components/GameAchievementsPanel.tsx,
 * "masteryUnlocked"), aplicado aos dados do catálogo público:
 *  - elegíveis: conquistas publicadas (não ocultas) com título, sem repetir o mesmo título
 *    (chave: minúsculas, sem acentos, espaços normalizados), oficiais e CUSTOM;
 *  - concluída: progresso "completed" ou escolhida numa Jornada de Estreia concluída
 *    (id igual, ou id em slug terminando com o título em slug);
 *  - Maestria: há ao menos uma elegível e todas estão concluídas.
 * Nada é inventado: sem dados do jogo ou sem conquistas elegíveis, não há Maestria.
 */

const normalizeText = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
const titleKey = (title: string) => normalizeText(title).replace(/\s+/g, " ").trim();
const slugify = (text: string) =>
  normalizeText(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export type MasteryEvaluation = {
  eligible: number;
  completed: number;
  official: number;
  custom: number;
  complete: boolean;
  /** Até 5 títulos que faltam (diagnóstico). */
  missing: string[];
};

function journeySelected(achievement: SiteAchievement, journeyIds: string[]) {
  if (!journeyIds.length) return false;
  const key = achievement.id.trim() || `title:${normalizeText(achievement.title)}`;
  const slug = slugify(achievement.title);
  return journeyIds.some((id) => {
    if (id === key) return true;
    const normalized = slugify(id);
    return normalized === slug || normalized.endsWith("-" + slug);
  });
}

/**
 * Avalia a conclusão integral. `assumeLocked` trata uma conquista como ainda não concluída
 * (estado anterior ao desbloqueio que disparou a verificação); a Jornada continua valendo.
 */
export function evaluateMastery(
  achievements: SiteAchievement[],
  game: Pick<SiteGameMeta, "journeyIds">,
  options: { assumeLocked?: string } = {},
): MasteryEvaluation {
  const seen = new Set<string>();
  const eligible: SiteAchievement[] = [];
  for (const achievement of achievements) {
    const key = titleKey(achievement.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    eligible.push(achievement);
  }
  const missing: string[] = [];
  let completed = 0;
  for (const achievement of eligible) {
    const status = achievement.completed && achievement.id !== options.assumeLocked;
    if (status || journeySelected(achievement, game.journeyIds)) completed += 1;
    else if (missing.length < 5) missing.push(achievement.title);
  }
  const custom = eligible.filter((a) => a.isCustom).length;
  return {
    eligible: eligible.length,
    completed,
    official: eligible.length - custom,
    custom,
    complete: eligible.length > 0 && completed === eligible.length,
    missing,
  };
}

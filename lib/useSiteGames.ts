"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { games as baseGames } from "@/data/games";
import { loadAchievementsForGame } from "@/lib/achievements/repository";

export type FlexibleAchievementInput = {
  id?: string;
  title?: string;
  description?: string;
  trophy?: string;
  icon?: string;
  difficulty?: string;
  rank?: string;
  status?: string;
  earnedDate?: string;
  image?: string;
  source?: string;
  externalId?: string;
  officialImage?: string;
  isCustom?: boolean;
  isEmblem?: boolean;
  isExophase?: boolean;
  isHidden?: boolean;
  [key: string]: unknown;
};

export type GameEmblemInput = {
  title?: string;
  image?: string;
  description?: string;
  tags?: string[];
  unlockedAt?: string;
  /** Achievement required to unlock this emblem; stored in the emblem JSON. */
  unlockAchievement?: string;
  /** Timestamp when this emblem itself was last saved; used to rank recent references. */
  updatedAt?: string;
  /** True when the emblem settings were explicitly saved from Admin. */
  configured?: boolean;
};

export type FirstJourneyAchievementMeta = {
  episode?: string;
  date?: string;
  liveUrl?: string;
};

export type FirstJourneyState = {
  status: "not_started" | "in_progress" | "completed";
  completedAt?: string;
  achievementIds?: string[];
  achievementMeta?: Record<string, FirstJourneyAchievementMeta>;
};

export type SiteGame = {
  slug: string;
  title: string;
  subtitle?: string;
  status?: string;
  progress?: number;
  hours?: string | number;
  currentObjective?: string;
  objective?: string;
  image?: string;
  cardImage?: string;
  platform?: string;
  youtubePlaylistUrl?: string;
  youtubeFirstLiveUrl?: string;
  youtubeFirstLiveEpisode?: string;
  achievementsList?: FlexibleAchievementInput[];
  achievementsUnlocked?: number;
  achievementsTotal?: number;
  createdAt?: string;
  updatedAt?: string;
  manualTotalPlayedMinutes?: number | null;
  firstJourney?: FirstJourneyState;
  finalBadge?: {
    title: string;
    icon: string;
    image?: string;
    description?: string;
  };
  emblem?: GameEmblemInput;
  /** True when the emblem has been explicitly saved in the Admin editor. */
  emblemConfigured?: boolean;
  trophies?: {
    bronze?: number;
    silver?: number;
    gold?: number;
    Bronze?: number;
    Prata?: number;
    Ouro?: number;
    emblem?: number;
  };
  [key: string]: unknown;
};

export type GameFormInput = {
  slug: string;
  title: string;
  subtitle: string;
  status: string;
  progress: number;
  hours: string;
  currentObjective: string;
  image: string;
  cardImage: string;
  platform: string;
  emblemTitle?: string;
  emblemImage?: string;
  emblemDescription?: string;
  emblemTags?: string;
  emblemUnlockedAt?: string;
};

type AchievementProgressStats = {
  completed: number;
  total: number;
  percent: number;
};

type DatabaseGame = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  status: string | null;
  progress: number | null;
  hours: string | null;
  current_objective: string | null;
  image: string | null;
  card_image: string | null;
  platform: string | null;
  final_badge: unknown;
  emblem: unknown;
  trophies: unknown;
  is_hidden: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  manual_total_played_minutes: number | null;
  review?: unknown;
  youtubePlaylistUrl?: string;
  youtubeFirstLiveUrl?: string;
  youtubeFirstLiveEpisode?: string;
  first_journey?: FirstJourneyState;
  firstJourney?: FirstJourneyState;
  achievementsList?: FlexibleAchievementInput[];
};


export const GAMES_UPDATED_EVENT = "rumo-a-conquista-games-updated";
export const ACHIEVEMENTS_UPDATED_EVENT =
  "rumo-a-conquista-achievements-updated";

export function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractYoutubePlaylistUrl(review: unknown) {
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    return "";
  }

  const value = (review as Record<string, unknown>).__youtubePlaylistUrl;
  return readText(value, "").trim();
}

function extractYoutubeFirstLiveUrl(review: unknown) {
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    return "";
  }

  const value = (review as Record<string, unknown>).__youtubeFirstLiveUrl;
  return readText(value, "").trim();
}

function extractYoutubeFirstLiveEpisode(review: unknown) {
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    return "";
  }

  const value = (review as Record<string, unknown>).__youtubeFirstLiveEpisode;
  return readText(value, "").trim();
}

function readNumber(value: unknown, fallback = 0) {
  const number = Number(value);

  if (Number.isFinite(number)) {
    return number;
  }

  return fallback;
}

function readText(value: unknown, fallback = "") {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return fallback;
}


const SMALL_GAME_TITLE_WORDS = new Set([
  "a", "as", "o", "os", "um", "uma", "uns", "umas",
  "de", "da", "do", "das", "dos", "e", "em", "no", "na", "nos", "nas",
  "ao", "aos", "à", "às", "com", "sem", "por", "para", "pela", "pelo",
  "pelas", "pelos", "entre", "sobre", "sob",
  "the", "a", "an", "and", "but", "or", "nor", "of", "in", "on", "at",
  "by", "as", "via", "per"
]);

const STYLIZED_GAME_TITLE_WORDS: Record<string, string> = {
  "pi": "P.I",
  "gta": "GTA",
  "doom": "DOOM",
  "dmc": "DMC",
  "fps": "FPS",
  "rpg": "RPG",
  "mmorpg": "MMORPG",
  "dlc": "DLC",
  "vr": "VR",
  "ea": "EA",
  "fc": "FC",
  "mgs": "MGS"
};

/**
 * Formats newly entered game titles without rewriting existing catalog titles
 * or destroying deliberate mixed-case brand styling such as iRacing and NieR.
 */
export function formatGameTitle(value: string): string {
  const clean = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!clean) return "";

  const letters = clean.match(/\p{L}/gu) ?? [];
  const forceTitleCase =
    letters.length > 0 &&
    letters.every((letter) => letter === letter.toLocaleUpperCase("pt-BR"));
  const parts = clean.split(" ");
  let firstWordSeen = false;

  return parts.map((part, index) => {
    if (!/[\p{L}\p{N}]/u.test(part)) return part;

    const prefix = part.match(/^[^\p{L}\p{N}]*/u)?.[0] ?? "";
    const suffix = part.match(/[^\p{L}\p{N}]*$/u)?.[0] ?? "";
    const core = part.slice(prefix.length, part.length - suffix.length);
    if (!core) return part;

    const key = core.toLocaleLowerCase("pt-BR").replace(/[^\p{L}\p{N}]/gu, "");
    const previousPart = parts[index - 1] ?? "";
    const startsNewPhrase =
      !firstWordSeen ||
      /[-–—:]$/.test(previousPart);
    firstWordSeen = true;

    let formatted: string;
    if (STYLIZED_GAME_TITLE_WORDS[key]) {
      formatted = STYLIZED_GAME_TITLE_WORDS[key];
      if (suffix.startsWith(".") && !formatted.endsWith(".")) {
        formatted += ".";
      }
    } else if (
      /^(i|ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(core) &&
      (forceTitleCase || core === core.toLocaleLowerCase("pt-BR"))
    ) {
      formatted = core.toUpperCase();
    } else if (!startsNewPhrase && SMALL_GAME_TITLE_WORDS.has(key)) {
      formatted = core.toLocaleLowerCase("pt-BR");
    } else {
      const hasUpper = core !== core.toLocaleLowerCase("pt-BR");
      const hasLower = core !== core.toLocaleUpperCase("pt-BR");

      if (!forceTitleCase && hasUpper && hasLower) {
        // Keep official stylization already entered by the user.
        formatted = core;
      } else {
        const lower = core.toLocaleLowerCase("pt-BR");
        formatted = lower.replace(
          /(^|[-–—])(\p{L})/gu,
          (_match, separator: string, letter: string) =>
            separator + letter.toLocaleUpperCase("pt-BR")
        );
      }
    }

    return prefix + formatted + suffix;
  }).join(" ");
}

function normalizeText(value?: string) {
  return readText(value, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeStatus(status?: string) {
  const normalized = normalizeText(status || "progress");

  if (
    normalized === "completed" ||
    normalized === "finalizado" ||
    normalized === "concluido" ||
    normalized === "concluida"
  ) {
    return "completed";
  }

  if (
    normalized === "planned" ||
    normalized === "planejado" ||
    normalized === "backlog" ||
    normalized === "futuro" ||
    normalized === "future"
  ) {
    return "planned";
  }

  return "progress";
}

function readStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => readText(item, "").trim()).filter(Boolean);
  }

  return readText(value, "")
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeEmblem(value: unknown): GameEmblemInput | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const title = readText(record.title, "").trim();
  const image = readText(record.image, "").trim();
  const description = readText(record.description, "").trim();
  const tags = readStringArray(record.tags);
  const unlockedAt = readText(record.unlockedAt, "").trim();
  const unlockAchievement = readText(record.unlockAchievement, "").trim();
  const updatedAt = readText(record.updatedAt, "").trim();
  const configured = record.configured === true;

  if (!title && !image && !description && tags.length === 0 && !unlockedAt && !unlockAchievement && !updatedAt && !configured) {
    return undefined;
  }

  return {
    title,
    image,
    description,
    tags,
    unlockedAt,
    unlockAchievement,
    updatedAt,
    configured,
  };
}

function normalizeAchievementStatus(status?: string) {
  const normalized = normalizeText(status || "locked");

  if (
    normalized === "completed" ||
    normalized === "concluido" ||
    normalized === "concluida" ||
    normalized === "desbloqueado" ||
    normalized === "desbloqueada"
  ) {
    return "completed";
  }

  if (
    normalized === "progress" ||
    normalized === "emprogresso" ||
    normalized === "emandamento"
  ) {
    return "progress";
  }

  return "locked";
}

function normalizeRank(value?: string) {
  const text = readText(value, "Bronze");

  // "Diamante" era o nome legado da recompensa final. Hoje a recompensa
  // final é o Emblema e os únicos ranks das conquistas são Bronze/Prata/Ouro.
  if (text === "Ouro" || text === "Diamante" || text === "Extrema") return "Ouro";
  if (text === "Prata") return "Prata";

  return "Bronze";
}

function rankToTrophy(rank: string) {
  if (rank === "Ouro") return "🥇";
  if (rank === "Prata") return "🥈";

  return "🥉";
}

function normalizeAchievement(
  achievement: FlexibleAchievementInput,
  index: number,
  gameSlug: string
): FlexibleAchievementInput {
  const title = readText(
    achievement.title,
    `Conquista ${index + 1}`
  ).trim();

  const rawRank =
    readText(achievement.difficulty, "") ||
    readText(achievement.rank, "") ||
    "Bronze";
  const rawTrophy =
    readText(achievement.trophy, "") ||
    readText(achievement.icon, "");
  const titleNormalized = normalizeText(title);
  const isEmblem =
    Boolean(achievement.isEmblem) ||
    rawRank === "Diamante" ||
    rawRank === "Extrema" ||
    rawTrophy.includes("💎") ||
    titleNormalized.includes("maestriafinal");

  const rank = normalizeRank(rawRank);

  const trophy = isEmblem
    ? "🏆"
    : rawTrophy || rankToTrophy(rank);

  return {
    ...achievement,
    id:
      readText(achievement.id, "") ||
      `${gameSlug}-achievement-${index + 1}-${slugify(title)}`,
    title,
    description: readText(achievement.description, "").trim(),
    trophy,
    icon: trophy,
    difficulty: rank,
    rank,
    status: normalizeAchievementStatus(readText(achievement.status, "locked")),
    earnedDate: readText(achievement.earnedDate, ""),
    image: readText(achievement.image, "").trim(),
    isCustom: Boolean(achievement.isCustom ?? true),
    isEmblem,
  };
}

function calculateAchievementProgress(
  achievementsList: FlexibleAchievementInput[],
  fallbackProgress: unknown,
  firstJourney?: FirstJourneyState,
  hasConfiguredMastery = false
): AchievementProgressStats {
  const activeAchievements = achievementsList.filter((achievement) => {
    return readText(achievement.title, "").trim().length > 0;
  });

  const journeyIds =
    firstJourney?.status === "completed" &&
    Array.isArray(firstJourney.achievementIds)
      ? firstJourney.achievementIds.map((id) => String(id).trim()).filter(Boolean)
      : [];
  const journeyIdSet = new Set(journeyIds);
  const journeyLockActive = journeyIds.length > 0;

  const completedNormal = activeAchievements.filter((achievement) => {
    if (
      normalizeAchievementStatus(readText(achievement.status, "locked")) ===
      "completed"
    ) {
      return true;
    }

    if (!journeyLockActive) return false;

    const id = readText(achievement.id, "").trim();
    const title = readText(achievement.title, "").trim();
    const titleKey = slugify(title);
    const achievementKey = id || `title:${normalizeText(title)}`;

    return (
      journeyIdSet.has(achievementKey) ||
      journeyIds.some((journeyId) => {
        const normalizedId = slugify(journeyId);
        return normalizedId === titleKey || normalizedId.endsWith("-" + titleKey);
      })
    );
  }).length;

  const normalTotal = activeAchievements.length;
  const masteryUnlocked =
    hasConfiguredMastery &&
    normalTotal > 0 &&
    completedNormal === normalTotal;
  const total = normalTotal + (hasConfiguredMastery ? 1 : 0);
  const completed = completedNormal + (masteryUnlocked ? 1 : 0);

  if (total <= 0) {
    const manualProgress = Math.min(
      100,
      Math.max(0, Math.round(readNumber(fallbackProgress, 0)))
    );

    return {
      completed: manualProgress >= 100 ? 1 : 0,
      total: manualProgress > 0 ? 1 : 0,
      percent: manualProgress,
    };
  }

  return {
    completed,
    total,
    percent: Math.round((completed / total) * 100),
  };
}

function isCompletedAchievement(achievement: FlexibleAchievementInput) {
  return (
    normalizeAchievementStatus(readText(achievement.status, "locked")) ===
    "completed"
  );
}

function isMasteryAchievement(achievement: FlexibleAchievementInput) {
  const title = normalizeText(readText(achievement.title, ""));

  return (
    achievement.isEmblem === true ||
    title.includes("maestria") ||
    title.includes("mastery") ||
    title.includes("final")
  );
}

function getBestMasteryAchievement(
  achievementsList: FlexibleAchievementInput[]
) {
  const completedMastery = achievementsList.find(
    (achievement) =>
      isCompletedAchievement(achievement) && isMasteryAchievement(achievement)
  );

  if (completedMastery) {
    return completedMastery;
  }

  const anyMastery = achievementsList.find((achievement) =>
    isMasteryAchievement(achievement)
  );

  return anyMastery;
}

function createFinalBadgeFromAchievements(
  finalSlug: string,
  achievementsList: FlexibleAchievementInput[],
  fallback?: SiteGame["finalBadge"]
): SiteGame["finalBadge"] {
  // O Maestria Final explicitamente cadastrada no jogo é a fonte de verdade.
  // Isso permite guardar também sua descrição, usada pelo lote exclusivo de arte.
  if (fallback && typeof fallback === "object") {
    const description = readText(fallback.description, "").trim();

    return {
      title: readText(fallback.title, "Maestria Final"),
      icon: readText(fallback.icon, "💎"),
      image:
        readText(fallback.image, "") ||
        `/images/games/${finalSlug}/achievements/maestria-final.png`,
      ...(description ? { description } : {}),
    };
  }

  // Compatibilidade com jogos antigos que ainda não possuem Maestria Final
  // configurada explicitamente: tenta derivá-la de uma conquista equivalente.
  const masteryAchievement = getBestMasteryAchievement(achievementsList);

  if (masteryAchievement) {
    return {
      title: readText(masteryAchievement.title, "Maestria Final"),
      icon:
        masteryAchievement.isEmblem === true
          ? "🏆"
          : readText(masteryAchievement.icon, "") ||
            readText(masteryAchievement.trophy, "") ||
            rankToTrophy("Ouro"),
      image:
        readText(masteryAchievement.image, "") ||
        `/images/games/${finalSlug}/achievements/maestria-final.png`,
      ...(readText(masteryAchievement.description, "").trim()
        ? { description: readText(masteryAchievement.description, "").trim() }
        : {}),
    };
  }

  return {
    title: "Maestria Final",
    icon: "💎",
    image: `/images/games/${finalSlug}/achievements/maestria-final.png`,
  };
}

function normalizeGame(slug: string, game: Partial<SiteGame>): SiteGame {
  const finalSlug = readText(game.slug, slug);
  const title = readText(game.title, "Jogo sem nome");
  const subtitle = readText(game.subtitle, "");
  const rawStatus = normalizeStatus(readText(game.status, "progress"));
  const hours = game.hours ?? "0h";

  const currentObjective =
    readText(game.currentObjective, "") || readText(game.objective, "");

  const image =
    readText(game.image, "") || `/images/games/${finalSlug}/banner.jpg`;

  const cardImage =
    readText(game.cardImage, "") || `/images/games/${finalSlug}/cover.jpg`;

  const platform = readText(game.platform, "Steam").trim() || "Steam";
  const youtubePlaylistUrl =
    readText(game.youtubePlaylistUrl, "").trim() ||
    extractYoutubePlaylistUrl(game.review);
  const youtubeFirstLiveUrl =
    readText(game.youtubeFirstLiveUrl, "").trim() ||
    extractYoutubeFirstLiveUrl(game.review);
  const youtubeFirstLiveEpisode =
    readText(game.youtubeFirstLiveEpisode, "").trim() ||
    extractYoutubeFirstLiveEpisode(game.review);

  // A lista vinda do Supabase é a fonte oficial quando existe.
  // Jogos finalizados históricos, porém, podem ainda não ter suas conquistas
  // migradas para a tabela achievements. Nesses casos, preservamos a lista
  // legada de data/games.ts para que a Biblioteca continue mostrando o
  // contador real (ex.: 4/4 em Hogwarts Legacy), em vez de cair no fallback
  // artificial de 1/1 baseado apenas no progresso 100%.
  const suppliedAchievements = Array.isArray(game.achievementsList)
    ? game.achievementsList
    : [];

  const legacyGame = (
    baseGames as unknown as Record<string, Partial<SiteGame>>
  )[finalSlug];

  const achievementsSource =
    suppliedAchievements.length > 0
      ? suppliedAchievements
      : rawStatus === "completed" && Array.isArray(legacyGame?.achievementsList)
        ? legacyGame.achievementsList
        : [];

  const achievementsList = achievementsSource.map((achievement, index) =>
    normalizeAchievement(achievement, index, finalSlug)
  );

  const activeAchievementsForBadge = achievementsList.filter((achievement) => {
    return readText(achievement.title, "").trim().length > 0;
  });

  const finalBadge = createFinalBadgeFromAchievements(
    finalSlug,
    activeAchievementsForBadge,
    game.finalBadge
  );

  const emblem = normalizeEmblem(game.emblem);
  const firstJourney =
    game.firstJourney && typeof game.firstJourney === "object"
      ? (game.firstJourney as FirstJourneyState)
      : rawStatus === "completed"
        ? { status: "completed" as const }
        : { status: "not_started" as const };

  // Match the detail page: a finalized First Journey counts its selected
  // achievements as completed, and a configured final mastery adds one slot.
  const hasConfiguredMastery = Boolean(
    game.finalBadge &&
      typeof game.finalBadge === "object" &&
      (game.finalBadge.title || game.finalBadge.image || game.finalBadge.description)
  );
  const progressStats = calculateAchievementProgress(
    achievementsList,
    game.progress,
    firstJourney,
    hasConfiguredMastery
  );

  // Uma Jornada de Estreia ativa implica que o jogo já está em progresso.
  // Isso mantém Biblioteca, página do jogo e Admin coerentes.
  const status =
    firstJourney.status === "in_progress"
      ? "progress"
      : rawStatus;

  return {
    ...game,
    slug: finalSlug,
    title,
    subtitle,
    status,
    progress: progressStats.percent,
    hours,
    currentObjective,
    objective: currentObjective,
    image,
    cardImage,
    platform,
    youtubePlaylistUrl,
    youtubeFirstLiveUrl,
    youtubeFirstLiveEpisode,
    achievementsList,
    achievementsUnlocked: progressStats.completed,
    achievementsTotal: progressStats.total,
    finalBadge,
    emblem,
    firstJourney,
    createdAt: readText(game.createdAt, new Date().toISOString()),
    updatedAt: readText(game.updatedAt, ""),
  };
}

async function loadGamesFromSupabase(): Promise<Record<string, SiteGame>> {
  try {
    const includeHiddenAchievements =
      typeof window !== "undefined" &&
      window.location.pathname.startsWith("/admin");
    const endpoint = includeHiddenAchievements
      ? "/api/admin/games?includeHiddenAchievements=1"
      : "/api/admin/games";

    const response = await fetch(endpoint, {
      method: "GET",
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as {
      games?: DatabaseGame[];
      error?: string;
    } | null;

    if (!response.ok) {
      throw new Error(
        payload?.error || "Não foi possível carregar os jogos."
      );
    }

    const games: Record<string, SiteGame> = {};

    for (const game of payload?.games ?? []) {
      if (game.is_deleted) continue;

      const finalBadge =
        game.final_badge && typeof game.final_badge === "object"
          ? (game.final_badge as SiteGame["finalBadge"])
          : undefined;

      const emblem =
        game.emblem && typeof game.emblem === "object"
          ? (game.emblem as GameEmblemInput)
          : undefined;

      const trophies =
        game.trophies && typeof game.trophies === "object"
          ? (game.trophies as SiteGame["trophies"])
          : undefined;

      games[game.slug] = normalizeGame(game.slug, {
        slug: game.slug,
        title: game.title,
        subtitle: game.subtitle ?? "",
        status: game.status ?? "progress",
        progress: game.progress ?? 0,
        hours: game.hours ?? "0h",
        currentObjective: game.current_objective ?? "",
        image: game.image ?? "",
        manualTotalPlayedMinutes:
          game.manual_total_played_minutes ?? null,
        firstJourney:
          (game as DatabaseGame).firstJourney ??
          (game as DatabaseGame).first_journey,
        cardImage: game.card_image ?? "",
        platform: game.platform ?? "Steam",
        youtubePlaylistUrl: game.youtubePlaylistUrl ?? "",
        youtubeFirstLiveUrl: game.youtubeFirstLiveUrl ?? "",
        youtubeFirstLiveEpisode: game.youtubeFirstLiveEpisode ?? "",
        review: game.review,
        achievementsList: Array.isArray(game.achievementsList)
          ? game.achievementsList
          : [],
        finalBadge,
        emblem,
        // Only explicit saves made from Admin disable legacy date fallbacks.
        emblemConfigured: emblem?.configured === true,
        trophies,
        isHidden: game.is_hidden === true,
        isDeleted: Boolean(game.is_deleted),
        createdAt: game.created_at,
        updatedAt: game.updated_at,
      });
    }

    console.info(
      "[Games] Jogos carregados pela API:",
      Object.keys(games).length
    );

    return games;
  } catch (error) {
    console.error("[Games] Erro ao carregar jogos pela API:", error);
    return {};
  }
}


async function requestGameApi<T>(
  method: "POST" | "PUT" | "DELETE",
  body: unknown,
  endpoint = "/api/admin/games"
): Promise<T> {
  const response = await fetch(endpoint, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      payload?.error || "Não foi possível salvar o jogo."
    );
  }

  return payload as T;
}

async function saveGameToSupabase(
  game: SiteGame,
  options?: { isHidden?: boolean; isDeleted?: boolean }
) {
  return requestGameApi<{
    ok: boolean;
    game: DatabaseGame;
  }>("POST", {
    slug: game.slug,
    title: game.title,
    subtitle: game.subtitle,
    status: game.status,
    progress: game.progress,
    hours: game.hours,
    currentObjective: game.currentObjective,
    objective: game.objective,
    image: game.image,
    cardImage: game.cardImage,
    platform: game.platform,
    review: game.review,
    finalBadge: game.finalBadge,
    emblem: game.emblem,
    trophies: game.trophies,
    achievementsList: game.achievementsList,
    manualTotalPlayedMinutes:
      game.manualTotalPlayedMinutes ?? null,
    firstJourney: game.firstJourney,
    isHidden: options?.isHidden === true,
    isDeleted: options?.isDeleted === true,
  });
}

async function saveFinalMasteryToSupabase(
  slug: string,
  finalBadge: NonNullable<SiteGame["finalBadge"]>
) {
  return requestGameApi<{
    ok: boolean;
    finalBadge: SiteGame["finalBadge"];
    removedAchievementIds?: string[];
  }>("POST", {
    slug,
    finalBadge,
  }, "/api/admin/games/final-mastery");
}

async function changeGameVisibility(
  slug: string,
  action: "hide" | "delete" | "restore"
) {
  return requestGameApi<{
    ok: boolean;
    game: DatabaseGame;
  }>("DELETE", { slug, action });
}

function getGameSortTime(game: SiteGame) {
  const updatedAt = readText(game.updatedAt, "");
  const createdAt = readText(game.createdAt, "");

  const updatedTime = updatedAt ? new Date(updatedAt).getTime() : 0;
  const createdTime = createdAt ? new Date(createdAt).getTime() : 0;

  if (Number.isFinite(updatedTime) && updatedTime > 0) {
    return updatedTime;
  }

  if (Number.isFinite(createdTime) && createdTime > 0) {
    return createdTime;
  }

  return 0;
}

async function loadPublicFallbackGames(
  baseGamesMap: Record<string, SiteGame>
): Promise<Record<string, SiteGame>> {
  let publicCatalog: Array<Record<string, unknown>> = [];

  try {
    const response = await fetch("/api/games/catalog", { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as {
      games?: Array<Record<string, unknown>>;
    } | null;

    if (response.ok && Array.isArray(payload?.games)) {
      publicCatalog = payload.games;
    }
  } catch (error) {
    console.warn("[Games] Catálogo público indisponível; usando dados locais:", error);
  }

  const publicGamesBySlug = new Map<string, Record<string, unknown>>();
  for (const game of publicCatalog) {
    const slug = readText(game.slug, "").trim();
    if (slug) publicGamesBySlug.set(slug, game);
  }

  const slugs = Array.from(
    new Set([...Object.keys(baseGamesMap), ...publicGamesBySlug.keys()])
  );

  const entries = await Promise.all(
    slugs.map(async (slug) => {
      const baseGame = baseGamesMap[slug];
      const publicGame = publicGamesBySlug.get(slug);
      let achievements = (baseGame?.achievementsList ?? []) as FlexibleAchievementInput[];

      try {
        const result = await loadAchievementsForGame(
          slug,
          achievements as Parameters<typeof loadAchievementsForGame>[1]
        );
        achievements = result.achievements;
      } catch {
        // Preserve local achievements as a safe fallback if the public repository is unavailable.
      }

      const seed: Partial<SiteGame> = baseGame ?? {
        slug,
        title: readText(publicGame?.title, "Jogo sem nome"),
        status: "progress",
        progress: 0,
        hours: "0h",
        image: "",
        cardImage: "",
        platform: "Steam",
      };

      let merged: Partial<SiteGame> = {
        ...seed,
        slug,
        achievementsList: achievements,
      };

      if (publicGame) {
        const isObject = (value: unknown) =>
          Boolean(value && typeof value === "object" && !Array.isArray(value));

        merged = {
          ...seed,
          slug,
          title: readText(publicGame.title, seed.title || "Jogo sem nome"),
          subtitle: readText(publicGame.subtitle, seed.subtitle || ""),
          status: readText(publicGame.status, seed.status || "progress"),
          progress:
            typeof publicGame.progress === "number"
              ? publicGame.progress
              : seed.progress ?? 0,
          hours: readText(publicGame.hours, readText(seed.hours, "0h")),
          currentObjective: readText(
            publicGame.currentObjective,
            seed.currentObjective || ""
          ),
          objective: readText(
            publicGame.currentObjective ?? publicGame.objective,
            seed.objective || seed.currentObjective || ""
          ),
          image: readText(publicGame.image, "") || seed.image || "",
          cardImage: readText(publicGame.cardImage, "") || seed.cardImage || "",
          platform: readText(publicGame.platform, seed.platform || "Steam"),
          finalBadge: isObject(publicGame.finalBadge)
            ? (publicGame.finalBadge as SiteGame["finalBadge"])
            : seed.finalBadge,
          emblem: isObject(publicGame.emblem)
            ? (publicGame.emblem as GameEmblemInput)
            : seed.emblem,
          emblemConfigured: publicGame.emblemConfigured === true,
          trophies: isObject(publicGame.trophies)
            ? (publicGame.trophies as SiteGame["trophies"])
            : seed.trophies,
          review: publicGame.review ?? seed.review,
          firstJourney: isObject(publicGame.firstJourney)
            ? (publicGame.firstJourney as FirstJourneyState)
            : seed.firstJourney,
          manualTotalPlayedMinutes:
            typeof publicGame.manualTotalPlayedMinutes === "number"
              ? publicGame.manualTotalPlayedMinutes
              : seed.manualTotalPlayedMinutes,
          createdAt: readText(publicGame.createdAt, seed.createdAt || ""),
          updatedAt: readText(publicGame.updatedAt, seed.updatedAt || ""),
          isHidden: false,
          isDeleted: false,
          achievementsList: achievements,
        };
      }

      return [slug, normalizeGame(slug, merged)] as const;
    })
  );

  return Object.fromEntries(entries);
}

export function useSiteGames() {
  const [customGames, setCustomGames] = useState<Record<string, SiteGame>>({});
  const [hiddenGameSlugs, setHiddenGameSlugs] = useState<string[]>([]);
  const [deletedGameSlugs, setDeletedGameSlugs] = useState<string[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  const baseGamesMap = useMemo(() => {
    const entries = Object.entries(
      baseGames as unknown as Record<string, Partial<SiteGame>>
    );

    return entries.reduce<Record<string, SiteGame>>((acc, [slug, game]) => {
      acc[slug] = normalizeGame(slug, game);
      return acc;
    }, {});
  }, []);

  const loadGames = useCallback(async () => {
    try {
      const supabaseGames = await loadGamesFromSupabase();

      if (Object.keys(supabaseGames).length > 0) {
        setCustomGames(supabaseGames);
        setHiddenGameSlugs(
          Object.values(supabaseGames)
            .filter((game) => game.isHidden === true)
            .map((game) => game.slug)
        );
        setDeletedGameSlugs([]);
        setIsLoaded(true);
        return;
      }

      // Visitantes carregam o catálogo público do banco para que emblemas,
      // datas e jogos cadastrados no Admin também apareçam na aba Emblemas.
      const fallbackGames = await loadPublicFallbackGames(baseGamesMap);
      setCustomGames(fallbackGames);
      setHiddenGameSlugs(
        Object.values(fallbackGames)
          .filter((game) => game.isHidden === true)
          .map((game) => game.slug)
      );
      setDeletedGameSlugs([]);
      setIsLoaded(true);
      return;

      // Supabase é a fonte oficial. Mesmo que a resposta venha vazia,
      // não reativamos dados antigos do localStorage.
      setCustomGames(supabaseGames);
      setHiddenGameSlugs(
        Object.values(supabaseGames)
          .filter((game) => game.isHidden === true)
          .map((game) => game.slug)
      );
      setDeletedGameSlugs([]);
      setIsLoaded(true);
    } catch (error) {
      console.error("[Games] Falha ao sincronizar com a API:", error);

      // Mesmo quando a API administrativa falhar, usa o catálogo público
      // do banco e mantém o repositório público de conquistas como fallback.
      const fallbackGames = await loadPublicFallbackGames(baseGamesMap);
      setCustomGames(fallbackGames);
      setHiddenGameSlugs([]);
      setDeletedGameSlugs([]);
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadGames();

    const handleUpdate = () => {
      void loadGames();
    };

    window.addEventListener(GAMES_UPDATED_EVENT, handleUpdate);
    window.addEventListener(ACHIEVEMENTS_UPDATED_EVENT, handleUpdate);
    window.addEventListener("storage", handleUpdate);
    window.addEventListener("focus", handleUpdate);

    return () => {
      window.removeEventListener(GAMES_UPDATED_EVENT, handleUpdate);
      window.removeEventListener(ACHIEVEMENTS_UPDATED_EVENT, handleUpdate);
      window.removeEventListener("storage", handleUpdate);
      window.removeEventListener("focus", handleUpdate);
    };
  }, [loadGames]);

  function emitUpdate() {
    window.dispatchEvent(new Event(GAMES_UPDATED_EVENT));
  }

  const gamesMap = useMemo(() => {
    // Enquanto os dados oficiais ainda estão carregando, não mostramos a cópia
    // inicial de data/games.ts. Isso evita o efeito de "aparece uma versão,
    // depois corrige para outra" na Biblioteca e nas páginas públicas.
    if (!isLoaded) {
      return {};
    }

    const mergedGames: Record<string, SiteGame> = {
      ...customGames,
    };

    const blockedSlugs = Array.from(
      new Set([...hiddenGameSlugs, ...deletedGameSlugs])
    );

    blockedSlugs.forEach((slug) => {
      delete mergedGames[slug];
    });

    return Object.entries(mergedGames).reduce<Record<string, SiteGame>>(
      (acc, [slug, game]) => {
        acc[slug] = normalizeGame(slug, game);
        return acc;
      },
      {}
    );
  }, [customGames, hiddenGameSlugs, deletedGameSlugs, isLoaded]);

  const gamesList = useMemo(() => {
    return Object.values(gamesMap).sort((a, b) => {
      const dateA = getGameSortTime(a);
      const dateB = getGameSortTime(b);

      if (dateA !== dateB) {
        return dateB - dateA;
      }

      return a.title.localeCompare(b.title);
    });
  }, [gamesMap]);
const allGamesMap = useMemo(() => {
  if (!isLoaded) {
    return {};
  }

  const mergedGames: Record<string, SiteGame> = {
    ...customGames,
  };

  deletedGameSlugs.forEach((slug) => {
    delete mergedGames[slug];
  });

  return Object.entries(mergedGames).reduce<Record<string, SiteGame>>(
    (acc, [slug, game]) => {
      acc[slug] = normalizeGame(slug, game);
      return acc;
    },
    {}
  );
}, [customGames, deletedGameSlugs, isLoaded]);

const allGamesList = useMemo(() => {
  return Object.values(allGamesMap).sort((a, b) => {
    const dateA = getGameSortTime(a);
    const dateB = getGameSortTime(b);

    if (dateA !== dateB) {
      return dateB - dateA;
    }

    return a.title.localeCompare(b.title);
  });
}, [allGamesMap]);

const hiddenGamesList = useMemo(() => {
  return hiddenGameSlugs
    .filter((slug) => !deletedGameSlugs.includes(slug))
    .map((slug) => allGamesMap[slug])
    .filter((game): game is SiteGame => Boolean(game));
}, [allGamesMap, hiddenGameSlugs, deletedGameSlugs]);

  

  const hiddenBaseGames = useMemo(() => {
    return hiddenGameSlugs
      .filter((slug) => !deletedGameSlugs.includes(slug))
      .map((slug) => baseGamesMap[slug])
      .filter((game): game is SiteGame => Boolean(game));
  }, [baseGamesMap, hiddenGameSlugs, deletedGameSlugs]);

  async function addGame(input: GameFormInput) {
    const slug = slugify(input.slug || input.title);

    if (!slug) {
      alert("Digite um nome ou slug para o jogo.");
      return false;
    }

    const now = new Date().toISOString();

    const normalizedGame = normalizeGame(slug, {
      slug,
      title: formatGameTitle(input.title) || "Jogo sem nome",
      subtitle: input.subtitle.trim(),
      status: input.status,
      progress: Number(input.progress) || 0,
      hours: input.hours.trim() || "0h",
      currentObjective: input.currentObjective.trim(),
      objective: input.currentObjective.trim(),
      image: input.image.trim() || `/images/games/${slug}/banner.jpg`,
      cardImage: input.cardImage.trim() || `/images/games/${slug}/cover.jpg`,
      platform: input.platform.trim() || "Steam",
      emblem: normalizeEmblem({
        title: input.emblemTitle,
        image: input.emblemImage,
        description: input.emblemDescription,
        tags: input.emblemTags,
        unlockedAt: input.emblemUnlockedAt,
      }),
      achievementsList: [],
      createdAt: now,
      updatedAt: now,
    });

    try {
      await saveGameToSupabase(normalizedGame, {
        isHidden: false,
        isDeleted: false,
      });
    } catch (error) {
      console.error("[Games] Erro salvando jogo no Supabase:", error);
      alert(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar o jogo."
      );
      return false;
    }

    const nextCustomGames = {
      ...customGames,
      [slug]: normalizedGame,
    };

    const nextHiddenGameSlugs = hiddenGameSlugs.filter((item) => item !== slug);
    const nextDeletedGameSlugs = deletedGameSlugs.filter(
      (item) => item !== slug
    );

    setCustomGames(nextCustomGames);
    setHiddenGameSlugs(nextHiddenGameSlugs);
    setDeletedGameSlugs(nextDeletedGameSlugs);

    emitUpdate();

    return true;
  }

  async function updateFinalMastery(
    slug: string,
    finalBadge: NonNullable<SiteGame["finalBadge"]>
  ) {
    const currentGame =
      gamesMap[slug] || baseGamesMap[slug] || customGames[slug];

    if (!currentGame) {
      return false;
    }

    try {
      const result = await saveFinalMasteryToSupabase(slug, finalBadge);
      const removedIds = new Set(
        (result.removedAchievementIds ?? []).map((id) => String(id))
      );
      const nextAchievements = (currentGame.achievementsList ?? []).filter(
        (achievement) => !removedIds.has(String(achievement.id ?? ""))
      );
      const nextGame = normalizeGame(slug, {
        ...currentGame,
        finalBadge: result.finalBadge ?? finalBadge,
        achievementsList: nextAchievements,
        updatedAt: new Date().toISOString(),
      });

      setCustomGames((current) => ({
        ...current,
        [slug]: nextGame,
      }));

      emitUpdate();
      return true;
    } catch (error) {
      console.error("[Games] Erro atualizando Maestria Final:", error);
      alert(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar a Maestria Final."
      );
      return false;
    }
  }

  async function updateGame(slug: string, update: Partial<SiteGame>) {
    const currentGame =
      gamesMap[slug] || baseGamesMap[slug] || customGames[slug];

    if (!currentGame) {
      return false;
    }

    const normalizedUpdate =
      Object.prototype.hasOwnProperty.call(update, "title") &&
      typeof update.title === "string"
        ? {
            ...update,
            title: formatGameTitle(update.title) || currentGame.title,
          }
        : update;

    const nextGame = normalizeGame(slug, {
      ...currentGame,
      ...normalizedUpdate,
      ...(Object.prototype.hasOwnProperty.call(update, "emblem")
        ? { emblemConfigured: Boolean(update.emblem) }
        : {}),
      slug,
      updatedAt: new Date().toISOString(),
    });

    try {
      await saveGameToSupabase(nextGame, {
        isHidden: hiddenGameSlugs.includes(slug),
        isDeleted: false,
      });
    } catch (error) {
      console.error("[Games] Erro atualizando jogo no Supabase:", error);
      alert(
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar o jogo."
      );
      return false;
    }

    const nextCustomGames = {
      ...customGames,
      [slug]: nextGame,
    };

    setCustomGames(nextCustomGames);

    emitUpdate();

    return true;
  }

  async function removeGame(slug: string) {
    const currentGame =
      gamesMap[slug] || baseGamesMap[slug] || customGames[slug];

    if (!currentGame) {
      return false;
    }

    try {
      await changeGameVisibility(slug, "hide");
    } catch (error) {
      console.error("[Games] Erro ocultando jogo no Supabase:", error);
      alert(
        error instanceof Error
          ? error.message
          : "Não foi possível ocultar o jogo."
      );
      return false;
    }

    const nextHiddenGameSlugs = Array.from(
      new Set([...hiddenGameSlugs, slug])
    );

    setHiddenGameSlugs(nextHiddenGameSlugs);
    emitUpdate();

    return true;
  }

  async function deleteGamePermanently(slug: string): Promise<void> {
    const currentGame =
      gamesMap[slug] || baseGamesMap[slug] || customGames[slug];

    try {
      await changeGameVisibility(slug, "delete");
    } catch (error) {
      console.error("[Games] Erro excluindo jogo no Supabase:", error);
      alert(
        error instanceof Error
          ? error.message
          : "Não foi possível excluir o jogo."
      );
      return;
    }

    const nextCustomGames = { ...customGames };
    delete nextCustomGames[slug];

    const nextHiddenGameSlugs = hiddenGameSlugs.filter((item) => item !== slug);
    const nextDeletedGameSlugs = Array.from(
      new Set([...deletedGameSlugs, slug])
    );

    setCustomGames(nextCustomGames);
    setHiddenGameSlugs(nextHiddenGameSlugs);
    setDeletedGameSlugs(nextDeletedGameSlugs);
    emitUpdate();
  }

  async function restoreGame(slug: string) {
    try {
      await changeGameVisibility(slug, "restore");
    } catch (error) {
      console.error("[Games] Erro restaurando jogo no Supabase:", error);
      alert(
        error instanceof Error
          ? error.message
          : "Não foi possível restaurar o jogo."
      );
      return false;
    }

    const nextHiddenGameSlugs = hiddenGameSlugs.filter((item) => item !== slug);
    const nextDeletedGameSlugs = deletedGameSlugs.filter(
      (item) => item !== slug
    );


    setHiddenGameSlugs(nextHiddenGameSlugs);
    setDeletedGameSlugs(nextDeletedGameSlugs);
    emitUpdate();

    return true;
  }

  async function restoreAllGames() {
    const slugsToRestore = Array.from(
      new Set([...hiddenGameSlugs, ...deletedGameSlugs])
    );

    try {
      await Promise.all(
        slugsToRestore.map((slug) => changeGameVisibility(slug, "restore"))
      );
    } catch (error) {
      console.error("[Games] Erro restaurando jogos no Supabase:", error);
      alert(
        error instanceof Error
          ? error.message
          : "Não foi possível restaurar os jogos."
      );
      return false;
    }


    setHiddenGameSlugs([]);
    setDeletedGameSlugs([]);
    emitUpdate();

    return true;
  }

  function isCustomGame(slug: string) {
    return Boolean(customGames[slug]);
  }

  function isBaseGame(slug: string) {
    return Boolean(baseGamesMap[slug]);
  }

  return {
    isLoaded,
    gamesMap,
    gamesList,
    hiddenBaseGames,
    customGames,
    hiddenGameSlugs,
    deletedGameSlugs,
    addGame,
    updateGame,
    updateFinalMastery,
    removeGame,
    deleteGamePermanently,
    restoreGame,
    restoreAllGames,
    isCustomGame,
    isBaseGame,
  };
}
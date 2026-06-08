"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { games as baseGames } from "@/data/games";

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
  isCustom?: boolean;
  [key: string]: unknown;
};

export type GameEmblemInput = {
  title?: string;
  image?: string;
  description?: string;
  tags?: string[];
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
  achievementsList?: FlexibleAchievementInput[];
  achievementsUnlocked?: number;
  achievementsTotal?: number;
  createdAt?: string;
  updatedAt?: string;
  finalBadge?: {
    title: string;
    icon: string;
    image?: string;
  };
  emblem?: GameEmblemInput;
  trophies?: {
    bronze?: number;
    silver?: number;
    gold?: number;
    diamond?: number;
    Bronze?: number;
    Prata?: number;
    Ouro?: number;
    Diamante?: number;
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
  emblemTitle?: string;
  emblemImage?: string;
  emblemDescription?: string;
  emblemTags?: string;
};

type AchievementState = {
  rank: string;
  status: string;
  date: string;
  image: string;
};

type AchievementProgressStats = {
  completed: number;
  total: number;
  percent: number;
};

const CUSTOM_GAMES_KEY = "rumo-a-conquista-custom-games";
const HIDDEN_GAMES_KEY = "rumo-a-conquista-hidden-games";
const DELETED_GAMES_KEY = "rumo-a-conquista-deleted-games";

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

  if (!title && !image && !description && tags.length === 0) {
    return undefined;
  }

  return {
    title,
    image,
    description,
    tags,
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

  if (text === "Diamante") return "Diamante";
  if (text === "Ouro") return "Ouro";
  if (text === "Prata") return "Prata";

  return "Bronze";
}

function rankToTrophy(rank: string) {
  if (rank === "Diamante") return "💎";
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

  const rank = normalizeRank(
    readText(achievement.difficulty, "") ||
      readText(achievement.rank, "") ||
      "Bronze"
  );

  const trophy =
    readText(achievement.trophy, "") ||
    readText(achievement.icon, "") ||
    rankToTrophy(rank);

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
  };
}

function readAchievementStates(slug: string) {
  if (typeof window === "undefined") {
    return {};
  }

  const saved = localStorage.getItem(`rumo-a-conquista-achievements-${slug}`);

  if (!saved) {
    return {};
  }

  try {
    return JSON.parse(saved) as Record<string, AchievementState>;
  } catch {
    return {};
  }
}

function applySavedAchievementState(
  achievement: FlexibleAchievementInput,
  states: Record<string, AchievementState>
): FlexibleAchievementInput {
  const title = readText(achievement.title, "");
  const savedState = states[title];

  if (!savedState) {
    return achievement;
  }

  const rank = normalizeRank(
    readText(savedState.rank, readText(achievement.rank, "Bronze"))
  );

  const status = normalizeAchievementStatus(
    readText(savedState.status, readText(achievement.status, "locked"))
  );

  return {
    ...achievement,
    rank,
    difficulty: rank,
    status,
    earnedDate: readText(savedState.date, readText(achievement.earnedDate, "")),
    image: readText(savedState.image, readText(achievement.image, "")),
    trophy:
      readText(achievement.trophy, "") ||
      readText(achievement.icon, "") ||
      rankToTrophy(rank),
    icon:
      readText(achievement.icon, "") ||
      readText(achievement.trophy, "") ||
      rankToTrophy(rank),
  };
}

function writeAchievementStatesFromAchievements(
  slug: string,
  achievementsList: FlexibleAchievementInput[]
) {
  if (typeof window === "undefined") {
    return;
  }

  const currentStates = readAchievementStates(slug);

  const nextStates = achievementsList.reduce<Record<string, AchievementState>>(
    (acc, achievement, index) => {
      const normalizedAchievement = normalizeAchievement(
        achievement,
        index,
        slug
      );

      const title = readText(normalizedAchievement.title, "");

      if (!title) {
        return acc;
      }

      const oldState = currentStates[title];

      acc[title] = {
        rank: readText(
          normalizedAchievement.rank,
          readText(normalizedAchievement.difficulty, "Bronze")
        ),
        status: normalizeAchievementStatus(
          readText(normalizedAchievement.status, "locked")
        ),
        date: readText(normalizedAchievement.earnedDate, oldState?.date || ""),
        image: readText(normalizedAchievement.image, oldState?.image || ""),
      };

      return acc;
    },
    {}
  );

  localStorage.setItem(
    `rumo-a-conquista-achievements-${slug}`,
    JSON.stringify(nextStates)
  );
}

function getActiveAchievementsForGame(
  slug: string,
  achievementsList: FlexibleAchievementInput[]
) {
  const states = readAchievementStates(slug);

  return achievementsList
    .map((achievement, index) => {
      const normalized = normalizeAchievement(achievement, index, slug);
      return applySavedAchievementState(normalized, states);
    })
    .filter((achievement) => {
      const title = readText(achievement.title, "").trim();
      return Boolean(title);
    });
}

function calculateAchievementProgress(
  slug: string,
  achievementsList: FlexibleAchievementInput[],
  fallbackProgress: unknown
): AchievementProgressStats {
  const activeAchievements = getActiveAchievementsForGame(
    slug,
    achievementsList
  );

  const total = activeAchievements.length;

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

  const completed = activeAchievements.filter((achievement) => {
    return (
      normalizeAchievementStatus(readText(achievement.status, "locked")) ===
      "completed"
    );
  }).length;

  const percent = Math.round((completed / total) * 100);

  return {
    completed,
    total,
    percent,
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
  const rank = normalizeRank(
    readText(achievement.rank, readText(achievement.difficulty, "Bronze"))
  );

  return (
    rank === "Diamante" ||
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
  const masteryAchievement = getBestMasteryAchievement(achievementsList);

  if (masteryAchievement) {
    const rank = normalizeRank(
      readText(
        masteryAchievement.rank,
        readText(masteryAchievement.difficulty, "Diamante")
      )
    );

    return {
      title: readText(masteryAchievement.title, "Maestria Final"),
      icon:
        readText(masteryAchievement.icon, "") ||
        readText(masteryAchievement.trophy, "") ||
        rankToTrophy(rank),
      image: readText(masteryAchievement.image, ""),
    };
  }

  if (fallback && typeof fallback === "object") {
    return {
      title: readText(fallback.title, "Maestria Final"),
      icon: readText(fallback.icon, "💎"),
      image:
        readText(fallback.image, "") ||
        `/images/games/${finalSlug}/achievements/maestria-final.png`,
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
  const status = normalizeStatus(readText(game.status, "progress"));
  const hours = game.hours ?? "0h";

  const currentObjective =
    readText(game.currentObjective, "") || readText(game.objective, "");

  const image =
    readText(game.image, "") || `/images/games/${finalSlug}/banner.jpg`;

  const cardImage =
    readText(game.cardImage, "") || `/images/games/${finalSlug}/cover.jpg`;

  const baseAchievementsList = Array.isArray(game.achievementsList)
    ? game.achievementsList.map((achievement, index) =>
        normalizeAchievement(achievement, index, finalSlug)
      )
    : [];

  const states = readAchievementStates(finalSlug);

  const achievementsList = baseAchievementsList.map((achievement) =>
    applySavedAchievementState(achievement, states)
  );

  const activeAchievementsForBadge = getActiveAchievementsForGame(
    finalSlug,
    achievementsList
  );

  const progressStats = calculateAchievementProgress(
    finalSlug,
    achievementsList,
    game.progress
  );

  const finalBadge = createFinalBadgeFromAchievements(
    finalSlug,
    activeAchievementsForBadge,
    game.finalBadge
  );

  const emblem = normalizeEmblem(game.emblem);

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
    achievementsList,
    achievementsUnlocked: progressStats.completed,
    achievementsTotal: progressStats.total,
    finalBadge,
    emblem,
    createdAt: readText(game.createdAt, new Date().toISOString()),
    updatedAt: readText(game.updatedAt, ""),
  };
}

function normalizeCustomGames(
  games: Record<string, Partial<SiteGame>>
): Record<string, SiteGame> {
  return Object.entries(games).reduce<Record<string, SiteGame>>(
    (acc, [slug, game]) => {
      acc[slug] = normalizeGame(slug, game);
      return acc;
    },
    {}
  );
}

function readCustomGames() {
  if (typeof window === "undefined") {
    return {};
  }

  const saved = localStorage.getItem(CUSTOM_GAMES_KEY);

  if (!saved) {
    return {};
  }

  try {
    const parsed = JSON.parse(saved) as Record<string, Partial<SiteGame>>;
    return normalizeCustomGames(parsed);
  } catch {
    return {};
  }
}

function readHiddenGames() {
  if (typeof window === "undefined") {
    return [];
  }

  const saved = localStorage.getItem(HIDDEN_GAMES_KEY);

  if (!saved) {
    return [];
  }

  try {
    return JSON.parse(saved) as string[];
  } catch {
    return [];
  }
}

function readDeletedGames() {
  if (typeof window === "undefined") {
    return [];
  }

  const saved = localStorage.getItem(DELETED_GAMES_KEY);

  if (!saved) {
    return [];
  }

  try {
    return JSON.parse(saved) as string[];
  } catch {
    return [];
  }
}

function removeGameRelatedLocalStorage(slug: string) {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.removeItem(`rumo-a-conquista-achievements-${slug}`);
  localStorage.removeItem(`rumo-a-conquista-custom-achievements-${slug}`);
  localStorage.removeItem(`rumo-a-conquista-hidden-achievements-${slug}`);
}

function syncAchievementStatesToLocalStorage(game: SiteGame) {
  if (typeof window === "undefined") {
    return;
  }

  writeAchievementStatesFromAchievements(
    game.slug,
    game.achievementsList ?? []
  );

  window.dispatchEvent(new Event(ACHIEVEMENTS_UPDATED_EVENT));
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

  const loadGames = useCallback(() => {
    setCustomGames(readCustomGames());
    setHiddenGameSlugs(readHiddenGames());
    setDeletedGameSlugs(readDeletedGames());
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    loadGames();

    window.addEventListener(GAMES_UPDATED_EVENT, loadGames);
    window.addEventListener(ACHIEVEMENTS_UPDATED_EVENT, loadGames);
    window.addEventListener("storage", loadGames);
    window.addEventListener("focus", loadGames);

    return () => {
      window.removeEventListener(GAMES_UPDATED_EVENT, loadGames);
      window.removeEventListener(ACHIEVEMENTS_UPDATED_EVENT, loadGames);
      window.removeEventListener("storage", loadGames);
      window.removeEventListener("focus", loadGames);
    };
  }, [loadGames]);

  function emitUpdate() {
    window.dispatchEvent(new Event(GAMES_UPDATED_EVENT));
  }

  function persistCustomGames(nextCustomGames: Record<string, SiteGame>) {
    localStorage.setItem(CUSTOM_GAMES_KEY, JSON.stringify(nextCustomGames));
    setCustomGames(nextCustomGames);
    emitUpdate();
  }

  function persistHiddenGames(nextHiddenGameSlugs: string[]) {
    localStorage.setItem(HIDDEN_GAMES_KEY, JSON.stringify(nextHiddenGameSlugs));
    setHiddenGameSlugs(nextHiddenGameSlugs);
    emitUpdate();
  }

  const gamesMap = useMemo(() => {
    const mergedGames: Record<string, SiteGame> = {
      ...baseGamesMap,
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
  }, [baseGamesMap, customGames, hiddenGameSlugs, deletedGameSlugs]);

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
  const mergedGames: Record<string, SiteGame> = {
    ...baseGamesMap,
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
}, [baseGamesMap, customGames, deletedGameSlugs]);

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

  function addGame(input: GameFormInput) {
    const slug = slugify(input.slug || input.title);

    if (!slug) {
      alert("Digite um nome ou slug para o jogo.");
      return false;
    }

    const now = new Date().toISOString();

    const normalizedGame = normalizeGame(slug, {
      slug,
      title: input.title.trim() || "Jogo sem nome",
      subtitle: input.subtitle.trim(),
      status: input.status,
      progress: Number(input.progress) || 0,
      hours: input.hours.trim() || "0h",
      currentObjective: input.currentObjective.trim(),
      objective: input.currentObjective.trim(),
      image: input.image.trim() || `/images/games/${slug}/banner.jpg`,
      cardImage: input.cardImage.trim() || `/images/games/${slug}/cover.jpg`,
      emblem: normalizeEmblem({
        title: input.emblemTitle,
        image: input.emblemImage,
        description: input.emblemDescription,
        tags: input.emblemTags,
      }),
      achievementsList: [],
      createdAt: now,
      updatedAt: now,
    });

    const nextCustomGames = {
      ...customGames,
      [slug]: normalizedGame,
    };

    const nextHiddenGameSlugs = hiddenGameSlugs.filter((item) => item !== slug);
    const nextDeletedGameSlugs = deletedGameSlugs.filter(
      (item) => item !== slug
    );

    localStorage.setItem(CUSTOM_GAMES_KEY, JSON.stringify(nextCustomGames));
    localStorage.setItem(HIDDEN_GAMES_KEY, JSON.stringify(nextHiddenGameSlugs));
    localStorage.setItem(
      DELETED_GAMES_KEY,
      JSON.stringify(nextDeletedGameSlugs)
    );

    setCustomGames(nextCustomGames);
    setHiddenGameSlugs(nextHiddenGameSlugs);
    setDeletedGameSlugs(nextDeletedGameSlugs);

    syncAchievementStatesToLocalStorage(normalizedGame);
    emitUpdate();

    return true;
  }

  function updateGame(slug: string, update: Partial<SiteGame>) {
    const currentGame =
      gamesMap[slug] || baseGamesMap[slug] || customGames[slug];

    if (!currentGame) {
      return;
    }

    if (Array.isArray(update.achievementsList)) {
      writeAchievementStatesFromAchievements(slug, update.achievementsList);
    }

    const nextGame = normalizeGame(slug, {
      ...currentGame,
      ...update,
      slug,
      updatedAt: new Date().toISOString(),
    });

    const nextCustomGames = {
      ...customGames,
      [slug]: nextGame,
    };

    localStorage.setItem(CUSTOM_GAMES_KEY, JSON.stringify(nextCustomGames));
    setCustomGames(nextCustomGames);

    syncAchievementStatesToLocalStorage(nextGame);
    emitUpdate();
  }

  function removeGame(slug: string) {
    const isBaseGame = Boolean(baseGamesMap[slug]);
    const isCustomGame = Boolean(customGames[slug]);

    if (isBaseGame) {
      const nextHiddenGameSlugs = Array.from(
        new Set([...hiddenGameSlugs, slug])
      );

      persistHiddenGames(nextHiddenGameSlugs);
      return;
    }

    if (isCustomGame) {
      const nextCustomGames = { ...customGames };
      delete nextCustomGames[slug];

      persistCustomGames(nextCustomGames);
    }
  }

  function deleteGamePermanently(slug: string) {
    const nextCustomGames = { ...customGames };
    delete nextCustomGames[slug];

    const nextHiddenGameSlugs = hiddenGameSlugs.filter((item) => item !== slug);

    const nextDeletedGameSlugs = Array.from(
      new Set([...deletedGameSlugs, slug])
    );

    removeGameRelatedLocalStorage(slug);

    localStorage.setItem(CUSTOM_GAMES_KEY, JSON.stringify(nextCustomGames));
    localStorage.setItem(HIDDEN_GAMES_KEY, JSON.stringify(nextHiddenGameSlugs));
    localStorage.setItem(
      DELETED_GAMES_KEY,
      JSON.stringify(nextDeletedGameSlugs)
    );

    setCustomGames(nextCustomGames);
    setHiddenGameSlugs(nextHiddenGameSlugs);
    setDeletedGameSlugs(nextDeletedGameSlugs);

    emitUpdate();
  }

  function restoreGame(slug: string) {
    const nextHiddenGameSlugs = hiddenGameSlugs.filter((item) => item !== slug);
    const nextDeletedGameSlugs = deletedGameSlugs.filter(
      (item) => item !== slug
    );

    localStorage.setItem(HIDDEN_GAMES_KEY, JSON.stringify(nextHiddenGameSlugs));
    localStorage.setItem(
      DELETED_GAMES_KEY,
      JSON.stringify(nextDeletedGameSlugs)
    );

    setHiddenGameSlugs(nextHiddenGameSlugs);
    setDeletedGameSlugs(nextDeletedGameSlugs);

    emitUpdate();
  }

  function restoreAllGames() {
    persistHiddenGames([]);
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
    removeGame,
    deleteGamePermanently,
    restoreGame,
    restoreAllGames,
    isCustomGame,
    isBaseGame,
  };
}
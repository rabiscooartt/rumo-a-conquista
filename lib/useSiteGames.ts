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
  unlockedAt?: string;
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
  achievementsList?: FlexibleAchievementInput[];
  achievementsUnlocked?: number;
  achievementsTotal?: number;
  createdAt?: string;
  updatedAt?: string;
  manualTotalPlayedMinutes?: number | null;
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
  const unlockedAt = readText(record.unlockedAt, "").trim();

  if (!title && !image && !description && tags.length === 0 && !unlockedAt) {
    return undefined;
  }

  return {
    title,
    image,
    description,
    tags,
    unlockedAt,
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

function calculateAchievementProgress(
  achievementsList: FlexibleAchievementInput[],
  fallbackProgress: unknown
): AchievementProgressStats {
  const activeAchievements = achievementsList.filter((achievement) => {
    return readText(achievement.title, "").trim().length > 0;
  });

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

  const platform = readText(game.platform, "Steam").trim() || "Steam";

  // A lista de conquistas e o progresso vindo da API/Supabase são a fonte
  // oficial. Nenhum estado local do navegador é aplicado por cima desses dados.
  const achievementsList = Array.isArray(game.achievementsList)
    ? game.achievementsList.map((achievement, index) =>
        normalizeAchievement(achievement, index, finalSlug)
      )
    : [];

  const activeAchievementsForBadge = achievementsList.filter((achievement) => {
    return readText(achievement.title, "").trim().length > 0;
  });

  const progressStats = calculateAchievementProgress(
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
    platform,
    achievementsList,
    achievementsUnlocked: progressStats.completed,
    achievementsTotal: progressStats.total,
    finalBadge,
    emblem,
    createdAt: readText(game.createdAt, new Date().toISOString()),
    updatedAt: readText(game.updatedAt, ""),
  };
}

async function loadGamesFromSupabase(): Promise<Record<string, SiteGame>> {
  try {
    const response = await fetch("/api/admin/games", {
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
        cardImage: game.card_image ?? "",
        platform: game.platform ?? "Steam",
        achievementsList: Array.isArray(game.achievementsList)
          ? game.achievementsList
          : [],
        finalBadge,
        emblem,
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
  body: unknown
): Promise<T> {
  const response = await fetch("/api/admin/games", {
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
    finalBadge: game.finalBadge,
    emblem: game.emblem,
    trophies: game.trophies,
    manualTotalPlayedMinutes:
      game.manualTotalPlayedMinutes ?? null,
    isHidden: options?.isHidden === true,
    isDeleted: options?.isDeleted === true,
  });
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
      setCustomGames({});
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

  async function addGame(input: GameFormInput) {
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

  async function updateGame(slug: string, update: Partial<SiteGame>) {
    const currentGame =
      gamesMap[slug] || baseGamesMap[slug] || customGames[slug];

    if (!currentGame) {
      return false;
    }

    const nextGame = normalizeGame(slug, {
      ...currentGame,
      ...update,
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
    removeGame,
    deleteGamePermanently,
    restoreGame,
    restoreAllGames,
    isCustomGame,
    isBaseGame,
  };
}
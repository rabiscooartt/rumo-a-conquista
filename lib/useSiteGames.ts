"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { games as baseGames } from "@/data/games";
import { supabase } from "@/lib/supabase";

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
  review?: unknown;
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
  emblemUnlockedAt?: string;
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
  final_badge: unknown;
  emblem: unknown;
  trophies: unknown;
  review: unknown;
  is_hidden: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
};

type DatabaseAchievement = {
  id: string;
  game_slug: string;
  legacy_id: string;
  title: string;
  description: string;
  trophy: string;
  rank: string;
  image: string;
  source: string | null;
  external_id: string | null;
  official_image: string | null;
  sort_order: number;
  is_custom: boolean;
  is_hidden: boolean;
};

type DatabaseAchievementProgress = {
  achievement_id: string;
  owner_key: string;
  status: string;
  earned_at: string | null;
  rank_override: string | null;
  image_override: string | null;
};

const OWNER_KEY = "default";


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

function normalizeFinalBadge(
  value: unknown
): SiteGame["finalBadge"] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const title = readText(record.title, "").trim();
  const icon = readText(record.icon, "").trim();
  const image = readText(record.image, "").trim();

  if (!title && !icon && !image) {
    return undefined;
  }

  return {
    title: title || "Maestria Final",
    icon: icon || "ðŸ’Ž",
    image,
  };
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
  if (rank === "Diamante") return "ðŸ’Ž";
  if (rank === "Ouro") return "ðŸ¥‡";
  if (rank === "Prata") return "ðŸ¥ˆ";

  return "ðŸ¥‰";
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
    isCustom: Boolean(achievement.isCustom ?? false),
  };
}

function calculateAchievementProgress(
  slug: string,
  achievementsList: FlexibleAchievementInput[],
  fallbackProgress: unknown
): AchievementProgressStats {
 // A lista jÃ¡ chega normalizada.
// NÃ£o recarregamos mais os estados aqui.
const activeAchievements = achievementsList;

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
      icon: readText(fallback.icon, "ðŸ’Ž"),
      image:
        readText(fallback.image, "") ||
        `/images/games/${finalSlug}/achievements/maestria-final.png`,
    };
  }

  return {
    title: "Maestria Final",
    icon: "ðŸ’Ž",
    image: `/images/games/${finalSlug}/achievements/maestria-final.png`,
  };
}

function normalizeGame(
  slug: string,
  game: Partial<SiteGame>
): SiteGame {
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

  const achievementsList = baseAchievementsList;

  const progressStats = calculateAchievementProgress(
    finalSlug,
    achievementsList,
    game.progress
  );

  const finalBadge = createFinalBadgeFromAchievements(
    finalSlug,
    achievementsList,
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

async function loadGamesFromSupabase(): Promise<Record<string, SiteGame>> {
  const { data, error } = await supabase
    .from("games")
    .select(`
      id,
      slug,
      title,
      subtitle,
      status,
      progress,
      hours,
      current_objective,
      image,
      card_image,
      final_badge,
      emblem,
      trophies,
      review,
      is_hidden,
      is_deleted,
      created_at,
      updated_at
    `)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[Games] Erro ao carregar jogos do Supabase:", error);
    throw error;
  }

  const gameRows = (data ?? []) as DatabaseGame[];
  const gameSlugs = gameRows.map((game) => game.slug).filter(Boolean);
  const { data: achievements, error: achievementsError } = gameSlugs.length
    ? await supabase
        .from("achievements")
        .select(
          "id, game_slug, legacy_id, title, description, trophy, rank, image, source, external_id, official_image, sort_order, is_custom, is_hidden"
        )
        .in("game_slug", gameSlugs)
        .order("sort_order", { ascending: true })
    : { data: [], error: null };

  if (achievementsError) {
    console.error("[Games] Erro ao carregar conquistas do Supabase:", achievementsError);
    throw achievementsError;
  }

  const achievementRows = (achievements ?? []) as DatabaseAchievement[];
  const achievementIds = achievementRows.map((achievement) => achievement.id);
  const { data: progress, error: progressError } = achievementIds.length
    ? await supabase
        .from("achievement_progress")
        .select("achievement_id, owner_key, status, earned_at, rank_override, image_override")
        .eq("owner_key", OWNER_KEY)
        .in("achievement_id", achievementIds)
    : { data: [], error: null };

  if (progressError) {
    console.error("[Games] Erro ao carregar progresso do Supabase:", progressError);
    throw progressError;
  }

  const progressByAchievementId = new Map(
    ((progress ?? []) as DatabaseAchievementProgress[]).map((item) => [
      item.achievement_id,
      item,
    ])
  );
  const achievementsByGameSlug = new Map<string, FlexibleAchievementInput[]>();

  for (const achievement of achievementRows) {
    const progressRow = progressByAchievementId.get(achievement.id);
    const rank = progressRow?.rank_override ?? achievement.rank;
    const list = achievementsByGameSlug.get(achievement.game_slug) ?? [];
    list.push({
      id: achievement.legacy_id || achievement.id,
      title: achievement.title,
      description: achievement.description,
      trophy: achievement.trophy,
      icon: achievement.trophy,
      rank,
      difficulty: rank,
      status: progressRow?.status ?? "locked",
      earnedDate: progressRow?.earned_at ?? "",
      image: progressRow?.image_override || achievement.image || "",
      source: achievement.source ?? "manual",
      externalId: achievement.external_id ?? undefined,
      officialImage: achievement.official_image ?? undefined,
      isCustom: achievement.is_custom,
      isHidden: achievement.is_hidden,
    });
    achievementsByGameSlug.set(achievement.game_slug, list);
  }

  const games: Record<string, SiteGame> = {};

  for (const game of gameRows) {
    games[game.slug] = normalizeGame(game.slug, {
      slug: game.slug,
      title: game.title,
      subtitle: game.subtitle ?? "",
      status: game.status ?? "progress",
      progress: game.progress ?? 0,
      hours: game.hours ?? "0h",
      currentObjective: game.current_objective ?? "",
      image: game.image ?? "",
      cardImage: game.card_image ?? "",
      finalBadge: normalizeFinalBadge(game.final_badge),
      emblem: game.emblem ?? undefined,
      trophies: game.trophies ?? undefined,
      review: game.review ?? undefined,
      achievementsList: achievementsByGameSlug.get(game.slug) ?? [],
      isHidden: game.is_hidden,
      isDeleted: game.is_deleted,
      createdAt: game.created_at,
      updatedAt: game.updated_at,
    });
  }

  console.info("[Games] Jogos carregados do Supabase:", Object.keys(games).length);

  return games;
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
  const [serverGames, setServerGames] = useState<Record<string, SiteGame>>({});
  const [isUsingBaseFallback, setIsUsingBaseFallback] = useState(false);
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
      setServerGames(supabaseGames);
      setIsUsingBaseFallback(false);
    } catch (error) {
      // data/games.ts is only an emergency read fallback when Supabase is unavailable.
      // It never merges with or overwrites successful Supabase data.
      console.warn("[Games] Usando fallback base temporário:", error);
      setIsUsingBaseFallback(true);
    } finally {
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
    window.addEventListener("focus", handleUpdate);

    return () => {
      window.removeEventListener(GAMES_UPDATED_EVENT, handleUpdate);
      window.removeEventListener(ACHIEVEMENTS_UPDATED_EVENT, handleUpdate);
      window.removeEventListener("focus", handleUpdate);
    };
  }, [loadGames]);

  function emitUpdate() {
    window.dispatchEvent(new Event(GAMES_UPDATED_EVENT));
  }

  const gamesMap = useMemo(() => {
    const sourceGames = isUsingBaseFallback ? baseGamesMap : serverGames;

    return Object.entries(sourceGames).reduce<Record<string, SiteGame>>(
      (acc, [slug, game]) => {
        if (game.isHidden === true || game.isDeleted === true) return acc;
        acc[slug] = normalizeGame(slug, game);
        return acc;
      },
      {}
    );
  }, [baseGamesMap, isUsingBaseFallback, serverGames]);

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

  const hiddenBaseGames = useMemo(() => {
    const sourceGames = isUsingBaseFallback ? baseGamesMap : serverGames;

    return Object.values(sourceGames).filter(
      (game) => game.isHidden === true && game.isDeleted !== true
    );
  }, [baseGamesMap, isUsingBaseFallback, serverGames]);

  const hiddenGameSlugs = useMemo(
    () => hiddenBaseGames.map((game) => game.slug),
    [hiddenBaseGames]
  );

  const deletedGameSlugs = useMemo(() => {
    const sourceGames = isUsingBaseFallback ? baseGamesMap : serverGames;

    return Object.values(sourceGames)
      .filter((game) => game.isDeleted === true)
      .map((game) => game.slug);
  }, [baseGamesMap, isUsingBaseFallback, serverGames]);

  async function requestGameMutation(
    method: "POST" | "PUT" | "DELETE",
    payload: Record<string, unknown>
  ) {
    const response = await fetch("/api/admin/games", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      throw new Error(body?.error ?? "Não foi possível salvar o jogo.");
    }

    await loadGames();
    emitUpdate();
  }

  async function addGame(input: GameFormInput) {
    const slug = slugify(input.slug || input.title);

    if (!slug) {
      throw new Error("Digite um nome ou slug para o jogo.");
    }

    await requestGameMutation("POST", {
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
        unlockedAt: input.emblemUnlockedAt,
      }),
      achievementsList: [],
    });
  }

  async function updateGame(slug: string, update: Partial<SiteGame>) {
    const currentGame =
      gamesMap[slug] ||
      serverGames[slug] ||
      (isUsingBaseFallback ? baseGamesMap[slug] : undefined);

    if (!currentGame) {
      throw new Error("Jogo não encontrado.");
    }

    await requestGameMutation("PUT", { ...currentGame, ...update, slug });
  }

  async function removeGame(slug: string) {
    await requestGameMutation("DELETE", { slug, action: "hide" });
  }

  async function deleteGamePermanently(slug: string) {
    await requestGameMutation("DELETE", { slug, action: "delete" });
  }

  async function restoreGame(slug: string) {
    await requestGameMutation("DELETE", { slug, action: "restore" });
  }

  async function restoreAllGames() {
    await Promise.all(hiddenGameSlugs.map((slug) => restoreGame(slug)));
  }

  function isCustomGame(slug: string) {
    return Boolean(serverGames[slug]) && !Boolean(baseGamesMap[slug]);
  }

  function isBaseGame(slug: string) {
    return Boolean(baseGamesMap[slug]);
  }

  return {
    isLoaded,
    gamesMap,
    gamesList,
    hiddenBaseGames,
    customGames: serverGames,
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

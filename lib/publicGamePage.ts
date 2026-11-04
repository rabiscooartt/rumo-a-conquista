import "server-only";

import { unstable_cache } from "next/cache";
import { games as legacyGames } from "@/data/games";
import { HOME_CATALOG_CACHE_TAG } from "@/lib/homeInitialData";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import type { SiteGame } from "@/lib/useSiteGames";

const OWNER_KEY = "default";

type AchievementProgressRow = {
  achievement_id: string;
  owner_key: string;
  status: string;
  earned_at: string | null;
  rank_override: string | null;
  image_override: string | null;
};

type AchievementRow = {
  id: string;
  game_slug: string;
  legacy_id: string;
  title: string;
  description: string;
  trophy: string;
  rank: string;
  image: string;
  sort_order: number;
  is_custom: boolean;
  is_hidden: boolean;
  source: string | null;
  external_id: string | null;
  official_image: string | null;
  achievement_progress?: AchievementProgressRow[];
};

function readText(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function reviewText(review: unknown, key: string) {
  if (!isRecord(review)) return "";
  return readText(review[key]).trim();
}

function extractFirstJourney(review: unknown) {
  if (!isRecord(review) || !isRecord(review.__firstJourney)) return undefined;

  const record = review.__firstJourney;
  const status = record.status;
  if (status !== "not_started" && status !== "in_progress" && status !== "completed") {
    return undefined;
  }

  const achievementIds = Array.isArray(record.achievementIds)
    ? record.achievementIds.map((item) => String(item).trim()).filter(Boolean)
    : undefined;
  const achievementMeta = isRecord(record.achievementMeta)
    ? record.achievementMeta
    : undefined;

  return {
    status,
    completedAt:
      typeof record.completedAt === "string" && record.completedAt.trim()
        ? record.completedAt.trim()
        : undefined,
    ...(achievementIds ? { achievementIds } : {}),
    ...(achievementMeta ? { achievementMeta } : {}),
  } as NonNullable<SiteGame["firstJourney"]>;
}

function normalizeAchievement(
  achievement: AchievementRow,
  progress?: AchievementProgressRow
) {
  return {
    id: achievement.legacy_id || achievement.id,
    title: achievement.title,
    description: achievement.description,
    trophy: achievement.trophy,
    icon: achievement.trophy,
    rank: progress?.rank_override ?? achievement.rank,
    difficulty: progress?.rank_override ?? achievement.rank,
    status: progress?.status ?? "locked",
    earnedDate: progress?.earned_at ?? "",
    image: progress?.image_override || achievement.image || "",
    isCustom: achievement.is_custom,
    isHidden: achievement.is_hidden,
    source: achievement.source ?? "manual",
    externalId: achievement.external_id ?? undefined,
    officialImage: achievement.official_image ?? undefined,
  };
}

function normalizeLegacyAchievement(achievement: Record<string, unknown>) {
  return {
    id: readText(achievement.legacy_id) || readText(achievement.id),
    title: readText(achievement.title),
    description: readText(achievement.description),
    trophy: readText(achievement.trophy) || readText(achievement.icon),
    icon: readText(achievement.trophy) || readText(achievement.icon),
    rank: readText(achievement.rank) || readText(achievement.difficulty) || "Bronze",
    difficulty: readText(achievement.difficulty) || readText(achievement.rank) || "Bronze",
    status: readText(achievement.status, "locked"),
    earnedDate: readText(achievement.earnedDate),
    image: readText(achievement.image),
    isCustom: Boolean(achievement.is_custom ?? achievement.isCustom ?? true),
    isHidden: Boolean(achievement.is_hidden ?? achievement.isHidden ?? false),
    source: readText(achievement.source, "manual"),
    externalId: readText(achievement.external_id) || readText(achievement.externalId) || undefined,
    officialImage: readText(achievement.official_image) || readText(achievement.officialImage) || undefined,
  };
}

async function loadPublicGamePageUncached(slug: string): Promise<SiteGame | null> {
  const normalizedSlug = String(slug || "").trim();
  if (!normalizedSlug) return null;

  const client = createAdminSupabaseClient();
  const [
    { data: game, error: gameError },
    { data: achievementRows, error: achievementsError },
  ] = await Promise.all([
    client
      .from("games")
      .select(
        "slug, title, subtitle, status, progress, hours, current_objective, image, card_image, platform, genres, final_badge, emblem, trophies, review, manual_total_played_minutes, created_at, updated_at, is_hidden, is_deleted"
      )
      .eq("slug", normalizedSlug)
      .eq("is_deleted", false)
      .eq("is_hidden", false)
      .maybeSingle(),
    client
      .from("achievements")
      .select(
        "id, game_slug, legacy_id, title, description, trophy, rank, image, sort_order, is_custom, is_hidden, source, external_id, official_image, achievement_progress(achievement_id, owner_key, status, earned_at, rank_override, image_override)"
      )
      .eq("game_slug", normalizedSlug)
      .eq("is_hidden", false)
      .order("sort_order", { ascending: true }),
  ]);

  if (gameError) throw gameError;
  if (achievementsError) throw achievementsError;
  if (!game) return null;

  let effectiveReview: unknown = game.review;
  // The legacy Hogwarts fix is applied in memory only; a public read never writes to Supabase.
  if (normalizedSlug === "howgarts-legacy" && isRecord(effectiveReview)) {
    const currentTitle = readText(effectiveReview.titulo).toLowerCase();
    const currentText = readText(effectiveReview.texto).toLowerCase();
    const hasForeignCrisolReview =
      currentTitle.includes("crisol") ||
      currentText.includes("crisol mistura terror em primeira pessoa");
    const legacyRecord = (
      legacyGames as unknown as Record<string, { review?: unknown }>
    )[normalizedSlug];
    const originalReview = legacyRecord?.review;

    if (hasForeignCrisolReview && isRecord(originalReview)) {
      const privateMetadata = Object.fromEntries(
        Object.entries(effectiveReview).filter(([key]) => key.startsWith("__"))
      );
      effectiveReview = { ...originalReview, ...privateMetadata };
    }
  }

  const reviewRecord = isRecord(effectiveReview) ? effectiveReview : {};
  const achievementsExplicitlyCleared =
    reviewRecord.__achievementsListExplicitlyCleared === true;
  const rows = (achievementRows ?? []) as AchievementRow[];
  const legacyRecord = (
    legacyGames as unknown as Record<string, { achievementsList?: unknown[] }>
  )[normalizedSlug];
  const legacyAchievements =
    !achievementsExplicitlyCleared && rows.length === 0
      ? legacyRecord?.achievementsList ?? []
      : [];

  const achievementsList =
    rows.length > 0
      ? rows.map((achievement) =>
          normalizeAchievement(
            achievement,
            (achievement.achievement_progress ?? []).find(
              (progress) => progress.owner_key === OWNER_KEY
            )
          )
        )
      : legacyAchievements.map((achievement) =>
          normalizeLegacyAchievement(achievement as Record<string, unknown>)
        );

  return {
    slug: game.slug,
    title: readText(game.title, "Jogo sem nome"),
    subtitle: readText(game.subtitle),
    status: readText(game.status, "progress"),
    progress: Number(game.progress ?? 0),
    hours: readText(game.hours, "0h"),
    currentObjective: readText(game.current_objective),
    objective: readText(game.current_objective),
    image: readText(game.image),
    cardImage: readText(game.card_image),
    platform: readText(game.platform, "Steam"),
    genres: Array.isArray(game.genres) ? game.genres : [],
    createdAt: readText(game.created_at),
    updatedAt: readText(game.updated_at),
    finalBadge: isRecord(game.final_badge)
      ? (game.final_badge as SiteGame["finalBadge"])
      : undefined,
    emblem: isRecord(game.emblem)
      ? (game.emblem as SiteGame["emblem"])
      : undefined,
    trophies: isRecord(game.trophies)
      ? (game.trophies as SiteGame["trophies"])
      : undefined,
    review: effectiveReview,
    firstJourney: extractFirstJourney(effectiveReview),
    youtubePlaylistUrl: reviewText(effectiveReview, "__youtubePlaylistUrl"),
    youtubeFirstLiveUrl: reviewText(effectiveReview, "__youtubeFirstLiveUrl"),
    youtubeFirstLiveEpisode: reviewText(effectiveReview, "__youtubeFirstLiveEpisode"),
    manualTotalPlayedMinutes:
      typeof game.manual_total_played_minutes === "number"
        ? game.manual_total_played_minutes
        : null,
    achievementsList,
    achievementsSource: rows.length > 0 ? "supabase" : "base",
  } as SiteGame;
}

const getCachedPublicGamePage = unstable_cache(
  async (slug: string) => loadPublicGamePageUncached(slug),
  ["public-game-page"],
  { revalidate: 60, tags: [HOME_CATALOG_CACHE_TAG] }
);

export function loadPublicGamePage(slug: string) {
  return getCachedPublicGamePage(slug);
}

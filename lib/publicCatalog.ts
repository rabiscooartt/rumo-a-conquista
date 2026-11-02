import "server-only";

import { loadBacklogOrders } from "@/lib/backlogOrder";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

const OWNER_KEY = "default";

type ReviewRecord = Record<string, unknown>;

function readReviewRecord(value: unknown): ReviewRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as ReviewRecord;
}

function extractFirstJourney(review: unknown) {
  const record = readReviewRecord(review);
  const value = record?.__firstJourney;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const journey = value as Record<string, unknown>;
  const status = journey.status;
  if (status !== "not_started" && status !== "in_progress" && status !== "completed") {
    return undefined;
  }

  const achievementIds = Array.isArray(journey.achievementIds)
    ? journey.achievementIds.map((id) => String(id).trim()).filter(Boolean)
    : undefined;

  const achievementMeta =
    journey.achievementMeta &&
    typeof journey.achievementMeta === "object" &&
    !Array.isArray(journey.achievementMeta)
      ? journey.achievementMeta
      : undefined;

  return {
    status,
    ...(typeof journey.completedAt === "string" && journey.completedAt.trim()
      ? { completedAt: journey.completedAt.trim() }
      : {}),
    ...(achievementIds ? { achievementIds } : {}),
    ...(achievementMeta ? { achievementMeta } : {}),
  };
}

function reviewText(review: unknown, key: string) {
  const record = readReviewRecord(review);
  const value = record?.[key];
  return typeof value === "string" ? value.trim() : "";
}

async function loadAchievementsBySlug(
  client: ReturnType<typeof createAdminSupabaseClient>,
  slugs: string[]
) {
  const { data, error } = await client
    .from("achievements")
    .select(
      "game_slug, id, legacy_id, title, description, trophy, rank, image, source, external_id, official_image, sort_order, is_custom, is_hidden, achievement_progress(status, earned_at, rank_override, image_override)"
    )
    .in("game_slug", slugs)
    .eq("achievement_progress.owner_key", OWNER_KEY)
    .order("sort_order", { ascending: true });

  if (error) throw error;

  const achievementsBySlug: Record<string, unknown[]> = {};
  for (const achievement of data ?? []) {
    (achievementsBySlug[achievement.game_slug] ??= []).push(achievement);
  }

  return achievementsBySlug;
}

export async function loadPublicCatalog({
  includeAchievements = false,
}: { includeAchievements?: boolean } = {}) {
  const client = createAdminSupabaseClient();
  const { data, error } = await client
    .from("games")
    .select(
      "slug, title, subtitle, status, progress, hours, current_objective, image, card_image, platform, final_badge, emblem, trophies, review, manual_total_played_minutes, is_hidden, is_deleted, created_at, updated_at"
    )
    .eq("is_deleted", false)
    .eq("is_hidden", false)
    .order("updated_at", { ascending: false });

  if (error) throw error;

  const backlogOrders = await loadBacklogOrders(client);

  const games = (data ?? []).map((game) => ({
    slug: game.slug,
    title: game.title,
    subtitle: game.subtitle ?? "",
    status: game.status ?? "progress",
    backlogOrder: backlogOrders.get(game.slug) ?? null,
    progress: game.progress ?? 0,
    hours: game.hours ?? "0h",
    currentObjective: game.current_objective ?? "",
    objective: game.current_objective ?? "",
    image: game.image ?? "",
    cardImage: game.card_image ?? "",
    platform: game.platform ?? "Steam",
    finalBadge: game.final_badge ?? undefined,
    emblem: game.emblem ?? undefined,
    emblemConfigured: Boolean(
      game.emblem &&
        typeof game.emblem === "object" &&
        !Array.isArray(game.emblem)
    ),
    trophies: game.trophies ?? undefined,
    review: game.review ?? undefined,
    firstJourney: extractFirstJourney(game.review),
    youtubePlaylistUrl: reviewText(game.review, "__youtubePlaylistUrl"),
    youtubeFirstLiveUrl: reviewText(game.review, "__youtubeFirstLiveUrl"),
    youtubeFirstLiveEpisode: reviewText(game.review, "__youtubeFirstLiveEpisode"),
    manualTotalPlayedMinutes: game.manual_total_played_minutes ?? null,
    createdAt: game.created_at ?? undefined,
    updatedAt: game.updated_at ?? undefined,
    isHidden: false,
    isDeleted: false,
  }));

  const achievementsBySlug = includeAchievements
    ? await loadAchievementsBySlug(client, games.map((game) => game.slug))
    : undefined;

  return { games, ...(achievementsBySlug ? { achievementsBySlug } : {}) };
}

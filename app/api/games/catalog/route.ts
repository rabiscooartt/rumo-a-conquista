import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

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

export async function GET() {
  try {
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

    const games = (data ?? []).map((game) => ({
      slug: game.slug,
      title: game.title,
      subtitle: game.subtitle ?? "",
      status: game.status ?? "progress",
      progress: game.progress ?? 0,
      hours: game.hours ?? "0h",
      currentObjective: game.current_objective ?? "",
      objective: game.current_objective ?? "",
      image: game.image ?? "",
      cardImage: game.card_image ?? "",
      platform: game.platform ?? "Steam",
      finalBadge: game.final_badge ?? undefined,
      emblem: game.emblem ?? undefined,
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

    return NextResponse.json(
      { ok: true, games },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error) {
    console.error("[Public Game Catalog] Erro:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível carregar o catálogo público." },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}

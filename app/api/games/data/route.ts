import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

const OWNER_KEY = "default";

type DatabaseAchievementRow = {
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
};

type DatabaseAchievementProgressRow = {
  achievement_id: string;
  owner_key: string;
  status: string;
  earned_at: string | null;
  rank_override: string | null;
  image_override: string | null;
};

type DatabaseAchievementWithProgressRow = DatabaseAchievementRow & {
  achievement_progress?: DatabaseAchievementProgressRow[];
};

function readText(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function extractFirstJourney(review: unknown) {
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    return undefined;
  }

  const value = (review as Record<string, unknown>).__firstJourney;

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const status = record.status;

  if (
    status !== "not_started" &&
    status !== "in_progress" &&
    status !== "completed"
  ) {
    return undefined;
  }

  return {
    status,
    completedAt:
      typeof record.completedAt === "string" && record.completedAt.trim()
        ? record.completedAt.trim()
        : undefined,
  };
}

function normalizeAchievement(
  achievement: DatabaseAchievementRow,
  progress?: DatabaseAchievementProgressRow
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

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug")?.trim();

  if (!slug) {
    return NextResponse.json(
      { error: "O slug do jogo é obrigatório." },
      { status: 400 }
    );
  }

  try {
    const client = createAdminSupabaseClient();

    // O jogo e suas conquistas são independentes; carregamos os dois em
    // paralelo para cortar uma ida e volta desnecessária ao Supabase.
    const [{ data: game, error: gameError }, { data: achievements, error: achievementsError }] =
      await Promise.all([
        client
          .from("games")
          .select(
            "slug, title, subtitle, status, progress, hours, current_objective, image, card_image, platform, final_badge, emblem, trophies, review, manual_total_played_minutes, is_hidden, is_deleted"
          )
          .eq("slug", slug)
          .eq("is_deleted", false)
          .eq("is_hidden", false)
          .maybeSingle(),
        client
          .from("achievements")
          .select(
            "id, game_slug, legacy_id, title, description, trophy, rank, image, sort_order, is_custom, is_hidden, source, external_id, official_image, achievement_progress(achievement_id, owner_key, status, earned_at, rank_override, image_override)"
          )
          .eq("game_slug", slug)
          .eq("is_hidden", false)
          .order("sort_order", { ascending: true }),
      ]);

    if (gameError) throw gameError;
    if (achievementsError) throw achievementsError;

    if (!game) {
      return NextResponse.json(
        { error: "Jogo não encontrado." },
        { status: 404 }
      );
    }

    const achievementRows =
      (achievements ?? []) as unknown as DatabaseAchievementWithProgressRow[];

    return NextResponse.json(
      {
        ok: true,
        game: {
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
          manualTotalPlayedMinutes: game.manual_total_played_minutes ?? null,
          achievementsList: achievementRows.map((achievement) =>
            normalizeAchievement(
              achievement,
              (achievement.achievement_progress ?? []).find(
                (progress) => progress.owner_key === OWNER_KEY
              )
            )
          ),
        },
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30",
        },
      }
    );
  } catch (error) {
    console.error("[Public Game Data] Erro:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível carregar o jogo.",
      },
      { status: 500 }
    );
  }
}

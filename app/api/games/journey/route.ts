import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

type FirstJourneyAchievementMeta = {
  episode?: string;
  date?: string;
  liveUrl?: string;
};

type FirstJourneyState = {
  status: "not_started" | "in_progress" | "completed";
  completedAt?: string;
  achievementIds?: string[];
  achievementMeta?: Record<string, FirstJourneyAchievementMeta>;
};

function normalizeFirstJourney(value: unknown): FirstJourneyState | undefined {
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

  const achievementIds = Array.isArray(record.achievementIds)
    ? record.achievementIds
        .map((item) => String(item).trim())
        .filter(Boolean)
    : undefined;

  const achievementMeta =
    record.achievementMeta &&
    typeof record.achievementMeta === "object" &&
    !Array.isArray(record.achievementMeta)
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
  };
}

function extractFirstJourney(review: unknown): FirstJourneyState | undefined {
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    return undefined;
  }

  return normalizeFirstJourney(
    (review as Record<string, unknown>).__firstJourney
  );
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

    const { data, error } = await client
      .from("games")
      .select("review")
      .eq("slug", slug)
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json(
      {
        ok: true,
        firstJourney: extractFirstJourney(data?.review),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error("[Public Game Journey] Erro:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível carregar o estado da Jornada de Estreia.",
      },
      { status: 500 }
    );
  }
}

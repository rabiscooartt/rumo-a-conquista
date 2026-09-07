import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

const OWNER_KEY = "default";

type HistoryEvent = {
  event_type: string;
  event_date: string;
  game_slug: string | null;
  played_minutes: number | null;
  metadata: Record<string, unknown> | null;
};

function yearFromDate(value: string) {
  const year = Number(String(value || "").slice(0, 4));
  return Number.isFinite(year) ? year : 0;
}

function uniqueGameCount(events: HistoryEvent[], type: string) {
  return new Set(
    events
      .filter((event) => event.event_type === type && event.game_slug)
      .map((event) => event.game_slug as string)
  ).size;
}

function buildSummary(events: HistoryEvent[], year: number) {
  const yearEvents = events.filter((event) => yearFromDate(event.event_date) === year);
  const playEvents = yearEvents.filter((event) => event.event_type === "play_session");

  const playedMinutes = playEvents.reduce(
    (total, event) => total + Math.max(0, Number(event.played_minutes || 0)),
    0
  );

  const playedDays = new Set(playEvents.map((event) => event.event_date)).size;

  const gameMinutes = new Map<string, { title: string; minutes: number }>();

  for (const event of playEvents) {
    if (!event.game_slug) continue;

    const metadataTitle =
      event.metadata && typeof event.metadata.gameTitle === "string"
        ? event.metadata.gameTitle
        : event.game_slug;

    const current = gameMinutes.get(event.game_slug) ?? {
      title: metadataTitle,
      minutes: 0,
    };

    current.minutes += Math.max(0, Number(event.played_minutes || 0));
    if (!current.title && metadataTitle) current.title = metadataTitle;
    gameMinutes.set(event.game_slug, current);
  }

  const topGames = Array.from(gameMinutes.entries())
    .map(([slug, value]) => ({ slug, ...value }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 5);

  return {
    year,
    gamesRegistered: uniqueGameCount(yearEvents, "game_registered"),
    gamesStarted: uniqueGameCount(yearEvents, "game_started"),
    gamesCompleted: uniqueGameCount(yearEvents, "game_completed"),
    playedDays,
    playedMinutes,
    achievementsUnlocked: yearEvents.filter(
      (event) => event.event_type === "achievement_unlocked"
    ).length,
    reviewsCreated: yearEvents.filter(
      (event) => event.event_type === "review_created"
    ).length,
    reviewsUpdated: yearEvents.filter(
      (event) => event.event_type === "review_updated"
    ).length,
    topGames,
  };
}

export async function GET(request: NextRequest) {
  try {
    const client = createAdminSupabaseClient();
    const requestedYear = Number(request.nextUrl.searchParams.get("year"));
    const currentYear = new Date().getFullYear();
    const selectedYear = Number.isFinite(requestedYear) && requestedYear > 0
      ? requestedYear
      : currentYear;

    const { data, error } = await client
      .from("journey_history_events")
      .select("event_type,event_date,game_slug,played_minutes,metadata")
      .eq("owner_key", OWNER_KEY)
      .order("event_date", { ascending: true });

    if (error) throw error;

    const events = (data ?? []) as HistoryEvent[];
    const eventYears = events
      .map((event) => yearFromDate(event.event_date))
      .filter((year) => year > 0);

    const years = Array.from(
      new Set([currentYear, 2026, ...eventYears])
    ).sort((a, b) => b - a);

    return NextResponse.json({
      ok: true,
      years,
      summary: buildSummary(events, selectedYear),
    });
  } catch (error) {
    console.error("[Journey History API] Erro:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível carregar o histórico anual.",
      },
      { status: 500 }
    );
  }
}

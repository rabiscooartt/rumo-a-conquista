import { NextResponse } from "next/server";
import { games as staticGames } from "@/data/games";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

type StaticGame = {
  slug?: string;
  title?: string;
  subtitle?: string;
  status?: string;
  progress?: number;
  hours?: string | number;
  currentObjective?: string;
  objective?: string;
  nextMission?: string;
  image?: string;
  cardImage?: string;
  finalBadge?: unknown;
  emblem?: unknown;
  trophySummary?: unknown;
  trophies?: unknown;
  isHidden?: boolean;
  isDeleted?: boolean;
};

function text(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return fallback;
}

function number(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toRow(game: StaticGame) {
  const slug = text(game.slug);

  if (!slug) {
    throw new Error("Existe um jogo sem slug em data/games.ts.");
  }

  return {
    slug,
    title: text(game.title, "Jogo sem nome"),
    subtitle: text(game.subtitle),
    status: text(game.status, "progress"),
    progress: Math.min(100, Math.max(0, Math.round(number(game.progress)))),
    hours: text(game.hours, "0h"),
    current_objective: text(
      game.currentObjective ?? game.objective ?? game.nextMission
    ),
    image: text(game.image),
    card_image: text(game.cardImage),
    final_badge: game.finalBadge ?? null,
    emblem: game.emblem ?? null,
    trophies: game.trophies ?? game.trophySummary ?? null,
    is_hidden: game.isHidden === true,
    is_deleted: game.isDeleted === true,
    updated_at: new Date().toISOString(),
  };
}

/**
 * POST /api/admin/games/sync
 *
 * Importa os jogos existentes em data/games.ts para public.games.
 * O slug evita duplicações.
 */
export async function POST() {
  try {
    const sourceGames = Object.values(staticGames) as StaticGame[];

    if (!sourceGames.length) {
      return NextResponse.json(
        { error: "Nenhum jogo foi encontrado em data/games.ts." },
        { status: 400 }
      );
    }

    const rows = sourceGames.map(toRow);
    const client = createAdminSupabaseClient();

    const { data, error } = await client
      .from("games")
      .upsert(rows, { onConflict: "slug" })
      .select(
        `
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
        is_hidden,
        is_deleted,
        created_at,
        updated_at
        `
      );

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      synced: data?.length ?? 0,
      games: data ?? [],
    });
  } catch (error) {
    console.error("Erro sincronizando jogos estáticos:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível sincronizar os jogos.",
      },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

type GamePayload = {
  slug?: string;
  title?: string;
  subtitle?: string;
  status?: string;
  progress?: number;
  hours?: string | number;
  currentObjective?: string;
  objective?: string;
  image?: string;
  cardImage?: string;
  finalBadge?: unknown;
  emblem?: unknown;
  trophies?: unknown;
  isHidden?: boolean;
  isDeleted?: boolean;
};

const OWNER_KEY = "default";

function normalizeSlug(value?: string) {
  return value?.trim() || "";
}

function normalizeNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeText(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return fallback;
}

function buildGameData(game: GamePayload) {
  const slug = normalizeSlug(game.slug);
  const now = new Date().toISOString();

  return {
    slug,
    title: normalizeText(game.title, "Jogo sem nome"),
    subtitle: normalizeText(game.subtitle),
    status: normalizeText(game.status, "progress"),
    progress: Math.min(100, Math.max(0, normalizeNumber(game.progress, 0))),
    hours:
      typeof game.hours === "number"
        ? String(game.hours)
        : normalizeText(game.hours, "0h"),
    current_objective: normalizeText(
      game.currentObjective ?? game.objective
    ),
    image: normalizeText(game.image),
    card_image: normalizeText(game.cardImage),
    final_badge: game.finalBadge ?? null,
    emblem: game.emblem ?? null,
    trophies: game.trophies ?? null,
    is_hidden: game.isHidden === true,
    is_deleted: game.isDeleted === true,
    updated_at: now,
  };
}

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

function normalizeAchievementFromDatabase(
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

/**
 * GET
 *
 * Retorna os jogos ativos junto com suas conquistas e o progresso salvo
 * no Supabase. Assim o frontend não precisa depender do localStorage
 * para reconstruir achievementsList, achievementsUnlocked ou progress.
 */
export async function GET() {
  try {
    const client = createAdminSupabaseClient();

    const { data: games, error: gamesError } = await client
      .from("games")
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
      )
      .eq("is_deleted", false)
      .order("updated_at", { ascending: false });

    if (gamesError) throw gamesError;

    const gameRows = games ?? [];
    const gameSlugs = gameRows.map((game) => game.slug).filter(Boolean);

    if (gameSlugs.length === 0) {
      return NextResponse.json({ ok: true, games: [] });
    }

    const { data: achievements, error: achievementsError } = await client
      .from("achievements")
      .select(
        `
        id,
        game_slug,
        legacy_id,
        title,
        description,
        trophy,
        rank,
        image,
        sort_order,
        is_custom,
        is_hidden,
        source,
        external_id,
        official_image
        `
      )
      .in("game_slug", gameSlugs)
      .eq("is_hidden", false)
      .order("sort_order", { ascending: true });

    if (achievementsError) throw achievementsError;

    const achievementRows = (achievements ?? []) as DatabaseAchievementRow[];
    const achievementIds = achievementRows.map((achievement) => achievement.id);

    let progressRows: DatabaseAchievementProgressRow[] = [];

    if (achievementIds.length > 0) {
      const { data: progress, error: progressError } = await client
        .from("achievement_progress")
        .select(
          `
          achievement_id,
          owner_key,
          status,
          earned_at,
          rank_override,
          image_override
          `
        )
        .eq("owner_key", OWNER_KEY)
        .in("achievement_id", achievementIds);

      if (progressError) throw progressError;

      progressRows = (progress ?? []) as DatabaseAchievementProgressRow[];
    }

    const progressByAchievementId = new Map(
      progressRows.map((progress) => [progress.achievement_id, progress])
    );

    const achievementsByGameSlug = new Map<
      string,
      ReturnType<typeof normalizeAchievementFromDatabase>[]
    >();

    for (const achievement of achievementRows) {
      const current = achievementsByGameSlug.get(achievement.game_slug) ?? [];

      current.push(
        normalizeAchievementFromDatabase(
          achievement,
          progressByAchievementId.get(achievement.id)
        )
      );

      achievementsByGameSlug.set(achievement.game_slug, current);
    }

    const enrichedGames = gameRows.map((game) => ({
      ...game,
      achievementsList: achievementsByGameSlug.get(game.slug) ?? [],
    }));

    console.info(
      "[Games API] Jogos:",
      enrichedGames.length,
      "Conquistas:",
      achievementRows.length,
      "Progressos:",
      progressRows.length
    );

    return NextResponse.json({
      ok: true,
      games: enrichedGames,
    });
  } catch (error) {
    console.error("Erro carregando jogos:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível carregar os jogos.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as GamePayload;
    const slug = normalizeSlug(body.slug);

    if (!slug) {
      return NextResponse.json(
        { error: "O slug do jogo é obrigatório." },
        { status: 400 }
      );
    }

    const client = createAdminSupabaseClient();
    const game = buildGameData(body);

    const { data, error } = await client
      .from("games")
      .upsert(game, { onConflict: "slug" })
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
      )
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, game: data });
  } catch (error) {
    console.error("Erro criando jogo:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível criar o jogo.",
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as GamePayload;
    const slug = normalizeSlug(body.slug);

    if (!slug) {
      return NextResponse.json(
        { error: "O slug do jogo é obrigatório." },
        { status: 400 }
      );
    }

    const client = createAdminSupabaseClient();
    const updateData = buildGameData(body);
    delete (updateData as Partial<typeof updateData>).slug;

    const { data, error } = await client
      .from("games")
      .update(updateData)
      .eq("slug", slug)
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
      )
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, game: data });
  } catch (error) {
    console.error("Erro atualizando jogo:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível atualizar o jogo.",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      slug?: string;
      action?: "hide" | "delete" | "restore";
    };

    const slug = normalizeSlug(body.slug);

    if (!slug) {
      return NextResponse.json(
        { error: "O slug do jogo é obrigatório." },
        { status: 400 }
      );
    }

    const action = body.action ?? "delete";
    const client = createAdminSupabaseClient();

    let updateData: {
      is_hidden: boolean;
      is_deleted: boolean;
      updated_at: string;
    };

    switch (action) {
      case "hide":
        updateData = {
          is_hidden: true,
          is_deleted: false,
          updated_at: new Date().toISOString(),
        };
        break;

      case "restore":
        updateData = {
          is_hidden: false,
          is_deleted: false,
          updated_at: new Date().toISOString(),
        };
        break;

      case "delete":
      default:
        updateData = {
          is_hidden: false,
          is_deleted: true,
          updated_at: new Date().toISOString(),
        };
        break;
    }

    const { data, error } = await client
      .from("games")
      .update(updateData)
      .eq("slug", slug)
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
      )
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, game: data });
  } catch (error) {
    console.error("Erro alterando estado do jogo:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível alterar o jogo.",
      },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

type IncomingAchievement = {
  id?: string;
  title?: string;
  description?: string;
  trophy?: string;
  icon?: string;
  rank?: string;
  difficulty?: string;
  status?: string;
  earnedDate?: string;
  image?: string;
  isCustom?: boolean;
  isHidden?: boolean;
  hidden?: boolean;
  source?: string;
  externalId?: string;
  officialImage?: string;
};

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
  review?: unknown;
  achievementsList?: IncomingAchievement[];
  isHidden?: boolean;
  isDeleted?: boolean;
};

const OWNER_KEY = "default";
const VALID_RANKS = new Set(["Bronze", "Prata", "Ouro", "Diamante"]);
const VALID_STATUSES = new Set(["locked", "progress", "completed"]);

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

function normalizeRank(value?: string) {
  return value && VALID_RANKS.has(value) ? value : "Bronze";
}

function normalizeStatus(value?: string) {
  return value && VALID_STATUSES.has(value) ? value : "locked";
}

function legacyIdFor(achievement: IncomingAchievement, index: number) {
  return (
    achievement.id?.trim() ||
    `legacy-${index}-${achievement.title?.trim() || "sem-titulo"}`
  );
}

function buildGameData(game: GamePayload) {
  const slug = normalizeSlug(game.slug);
  const now = new Date().toISOString();

  return {
    slug,
    title: normalizeText(game.title, "Jogo sem nome"),
    subtitle: normalizeText(game.subtitle),
    status: normalizeText(game.status, "progress"),
    progress: Math.min(100, Math.max(0, Math.round(normalizeNumber(game.progress, 0)))),
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
    review: game.review ?? null,
    is_hidden: game.isHidden === true,
    is_deleted: game.isDeleted === true,
    updated_at: now,
  };
}

function buildAchievementDefinition(
  achievement: IncomingAchievement,
  index: number,
  gameSlug: string
) {
  const legacyId = legacyIdFor(achievement, index);
  const title = normalizeText(achievement.title, `Conquista ${index + 1}`);
  const rank = normalizeRank(achievement.rank || achievement.difficulty);
  const trophy = normalizeText(
    achievement.trophy ?? achievement.icon,
    ""
  );

  return {
    game_slug: gameSlug,
    legacy_id: legacyId,
    title,
    description: normalizeText(achievement.description),
    trophy,
    rank,
    image: normalizeText(achievement.image),
    source: normalizeText(achievement.source, "manual"),
    external_id: normalizeText(achievement.externalId) || null,
    official_image: normalizeText(achievement.officialImage) || null,
    sort_order: index,
    is_custom: achievement.isCustom === true,
    is_hidden: achievement.isHidden === true || achievement.hidden === true,
  };
}

function buildAchievementProgress(
  achievement: IncomingAchievement,
  index: number,
  idByLegacyId: Map<string, string>,
  existingProgressByAchievementId: Map<string, DatabaseAchievementProgressRow>
) {
  const achievementId = idByLegacyId.get(legacyIdFor(achievement, index)) ?? "";

  if (!achievementId) {
    return {
      achievement_id: "",
      owner_key: OWNER_KEY,
      status: "locked",
      earned_at: null,
      rank_override: null,
      image_override: null,
    };
  }

  const existing = existingProgressByAchievementId.get(achievementId);
  const hasStatus = typeof achievement.status === "string";
  const hasEarnedDate = typeof achievement.earnedDate === "string";
  const hasRank = typeof achievement.rank === "string" || typeof achievement.difficulty === "string";
  const hasImage = typeof achievement.image === "string";

  return {
    achievement_id: achievementId,
    owner_key: OWNER_KEY,
    status: hasStatus
      ? normalizeStatus(achievement.status)
      : existing?.status ?? "locked",
    earned_at: hasEarnedDate
      ? normalizeText(achievement.earnedDate) || null
      : existing?.earned_at ?? null,
    rank_override: hasRank
      ? normalizeRank(achievement.rank || achievement.difficulty)
      : existing?.rank_override ?? null,
    image_override: hasImage
      ? normalizeText(achievement.image) || null
      : existing?.image_override ?? null,
  };
}

async function syncAchievements(
  client: ReturnType<typeof createAdminSupabaseClient>,
  gameSlug: string,
  achievements: IncomingAchievement[] | undefined
) {
  // A missing achievementsList means "não alterar conquistas".
  // Isso evita que uma alteração simples no jogo apague ou resete o progresso.
  if (!Array.isArray(achievements)) {
    return { saved: [], progress: [] };
  }

  if (achievements.length === 0) {
    return { saved: [], progress: [] };
  }

  const definitions = achievements.map((achievement, index) =>
    buildAchievementDefinition(achievement, index, gameSlug)
  );

  const { data: saved, error: definitionsError } = await client
    .from("achievements")
    .upsert(definitions, { onConflict: "game_slug,legacy_id" })
    .select(
      "id, game_slug, legacy_id, title, description, trophy, rank, image, sort_order, is_custom, is_hidden, source, external_id, official_image"
    );

  if (definitionsError || !saved) {
    throw definitionsError || new Error("Não foi possível salvar as conquistas.");
  }

  const savedRows = saved as DatabaseAchievementRow[];
  const idByLegacyId = new Map(
    savedRows.map((achievement) => [achievement.legacy_id, achievement.id])
  );

  // Lê o progresso existente antes do upsert para que campos omitidos no payload
  // nunca sejam transformados em "locked" ou sobrescritos por valores artificiais.
  const { data: existingProgress, error: existingProgressError } = await client
    .from("achievement_progress")
    .select(
      "achievement_id, owner_key, status, earned_at, rank_override, image_override"
    )
    .eq("owner_key", OWNER_KEY)
    .in("achievement_id", savedRows.map((achievement) => achievement.id));

  if (existingProgressError) throw existingProgressError;

  const existingProgressByAchievementId = new Map(
    ((existingProgress ?? []) as DatabaseAchievementProgressRow[]).map((item) => [
      item.achievement_id,
      item,
    ])
  );

  const progress = achievements.map((achievement, index) =>
    buildAchievementProgress(
      achievement,
      index,
      idByLegacyId,
      existingProgressByAchievementId
    )
  );

  if (progress.some((item) => !item.achievement_id)) {
    throw new Error("Não foi possível vincular o progresso às conquistas.");
  }

  const { data: savedProgress, error: progressError } = await client
    .from("achievement_progress")
    .upsert(progress, { onConflict: "owner_key,achievement_id" })
    .select(
      "achievement_id, owner_key, status, earned_at, rank_override, image_override"
    );

  if (progressError) throw progressError;

  return {
    saved: savedRows,
    progress: (savedProgress ?? []) as DatabaseAchievementProgressRow[],
  };
}

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

async function fetchEnrichedGame(
  client: ReturnType<typeof createAdminSupabaseClient>,
  slug: string
) {
  const { data: game, error: gameError } = await client
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
      review,
      is_hidden,
      is_deleted,
      created_at,
      updated_at
      `
    )
    .eq("slug", slug)
    .single();

  if (gameError) throw gameError;

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
    .eq("game_slug", slug)
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

  return {
    ...game,
    achievementsList: achievementRows.map((achievement) =>
      normalizeAchievementFromDatabase(
        achievement,
        progressByAchievementId.get(achievement.id)
      )
    ),
  };
}

/**
 * GET
 *
 * Retorna todos os jogos nÃ£o excluÃ­dos junto com suas conquistas e o progresso
 * salvo no Supabase.
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
        review,
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
            : "NÃ£o foi possÃ­vel carregar os jogos.",
      },
      { status: 500 }
    );
  }
}

/**
 * POST
 *
 * Cria/atualiza o jogo e, quando achievementsList estiver presente,
 * sincroniza tambÃ©m as definiÃ§Ãµes e o progresso das conquistas.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as GamePayload;
    const slug = normalizeSlug(body.slug);

    if (!slug) {
      return NextResponse.json(
        { error: "O slug do jogo Ã© obrigatÃ³rio." },
        { status: 400 }
      );
    }

    const client = createAdminSupabaseClient();
    const game = buildGameData(body);

    const { error: gameError } = await client
      .from("games")
      .upsert(game, { onConflict: "slug" });

    if (gameError) throw gameError;

    await syncAchievements(client, slug, body.achievementsList);

    const enrichedGame = await fetchEnrichedGame(client, slug);

    return NextResponse.json({
      ok: true,
      game: enrichedGame,
    });
  } catch (error) {
    console.error("Erro criando/salvando jogo:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "NÃ£o foi possÃ­vel salvar o jogo.",
      },
      { status: 500 }
    );
  }
}

/**
 * PUT
 *
 * Atualiza o jogo e, quando achievementsList estiver presente,
 * sincroniza tambÃ©m as definiÃ§Ãµes e o progresso das conquistas.
 */
export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as GamePayload;
    const slug = normalizeSlug(body.slug);

    if (!slug) {
      return NextResponse.json(
        { error: "O slug do jogo Ã© obrigatÃ³rio." },
        { status: 400 }
      );
    }

    const client = createAdminSupabaseClient();
    const updateData = buildGameData(body);
    delete (updateData as Partial<typeof updateData>).slug;

    const { error: gameError } = await client
      .from("games")
      .update(updateData)
      .eq("slug", slug);

    if (gameError) throw gameError;

    await syncAchievements(client, slug, body.achievementsList);

    const enrichedGame = await fetchEnrichedGame(client, slug);

    return NextResponse.json({
      ok: true,
      game: enrichedGame,
    });
  } catch (error) {
    console.error("Erro atualizando jogo:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "NÃ£o foi possÃ­vel atualizar o jogo.",
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE
 *
 * NÃ£o apaga fisicamente o jogo.
 *
 * action:
 * - hide     â†’ oculta
 * - delete   â†’ marca como excluÃ­do
 * - restore  â†’ restaura
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      slug?: string;
      action?: "hide" | "delete" | "restore";
    };

    const slug = normalizeSlug(body.slug);

    if (!slug) {
      return NextResponse.json(
        { error: "O slug do jogo Ã© obrigatÃ³rio." },
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

    const { error: gameError } = await client
      .from("games")
      .update(updateData)
      .eq("slug", slug);

    if (gameError) throw gameError;

    const enrichedGame = await fetchEnrichedGame(client, slug);

    return NextResponse.json({
      ok: true,
      game: enrichedGame,
    });
  } catch (error) {
    console.error("Erro alterando estado do jogo:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "NÃ£o foi possÃ­vel alterar o jogo.",
      },
      { status: 500 }
    );
  }
}


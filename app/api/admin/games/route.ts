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
  source?: "manual" | "playstation" | "steam" | "xbox";
  externalId?: string;
  officialImage?: string;
  isCustom?: boolean;
  isHidden?: boolean;
  hidden?: boolean;
};

const OWNER_KEY = "default";
const VALID_RANKS = new Set(["Bronze", "Prata", "Ouro", "Diamante"]);
const VALID_STATUSES = new Set(["locked", "progress", "completed"]);

function normalizeText(value: unknown, fallback = "") {
  if (typeof value !== "string" && typeof value !== "number") return fallback;

  return String(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function normalizeTitle(value?: string) {
  return normalizeText(value)
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSlug(value?: string) {
  return value?.trim() || "";
}

function normalizeNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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

function buildGameData(game: GamePayload) {
  const slug = normalizeSlug(game.slug);

  return {
    slug,
    title: normalizeText(game.title, "Jogo sem nome"),
    subtitle: normalizeText(game.subtitle),
    status: normalizeText(game.status, "progress"),
    progress: Math.min(
      100,
      Math.max(0, Math.round(normalizeNumber(game.progress, 0)))
    ),
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
    updated_at: new Date().toISOString(),
  };
}

function buildAchievementDefinition(
  achievement: IncomingAchievement,
  index: number,
  gameSlug: string
) {
  const legacyId = legacyIdFor(achievement, index);
  const title = normalizeText(
    achievement.title,
    `Conquista ${index + 1}`
  );

  return {
    game_slug: gameSlug,
    legacy_id: legacyId,
    title,
    description: normalizeText(achievement.description),
    trophy: normalizeText(achievement.trophy ?? achievement.icon, ""),
    rank: normalizeRank(achievement.rank || achievement.difficulty),
    image: normalizeText(achievement.image),
    source: normalizeText(achievement.source, "manual"),
    external_id: normalizeText(achievement.externalId) || null,
    official_image: normalizeText(achievement.officialImage) || null,
    sort_order: index,
    is_custom: achievement.isCustom === true,
    is_hidden:
      achievement.isHidden === true || achievement.hidden === true,
  };
}

function buildAchievementProgress(
  achievement: IncomingAchievement,
  index: number,
  idByLegacyId: Map<string, string>
) {
  return {
    achievement_id:
      idByLegacyId.get(legacyIdFor(achievement, index)) ?? "",
    owner_key: OWNER_KEY,
    status: normalizeStatus(achievement.status),
    earned_at: normalizeText(achievement.earnedDate) || null,
    rank_override: normalizeRank(
      achievement.rank || achievement.difficulty
    ),
    image_override: normalizeText(achievement.image) || null,
  };
}

async function syncAchievements(
  client: ReturnType<typeof createAdminSupabaseClient>,
  gameSlug: string,
  achievements: IncomingAchievement[] | undefined
) {
  // No editor envia a lista completa. Uma chamada com lista vazia significa
  // que o jogo ficou sem conquistas e, portanto, os registros antigos devem sair.
  if (!Array.isArray(achievements)) {
    return { saved: [], progress: [] };
  }

  // Regra: um jogo pode ter somente uma conquista por nome normalizado.
  const uniqueIncoming: IncomingAchievement[] = [];
  const seenTitles = new Set<string>();

  for (const achievement of achievements) {
    const title = String(
      achievement.title?.trim() || "Conquista"
    ).trim();
    const titleKey = normalizeTitle(title);

    if (!titleKey || seenTitles.has(titleKey)) {
      continue;
    }

    seenTitles.add(titleKey);
    uniqueIncoming.push({
      ...achievement,
      title,
    });
  }

  // Primeiro buscamos os registros atuais para saber exatamente o que precisa
  // ser mantido, atualizado ou excluído.
  const { data: existingData, error: existingError } = await client
    .from("achievements")
    .select(
      "id, game_slug, legacy_id, title, description, trophy, rank, image, sort_order, is_custom, is_hidden, source, external_id, official_image"
    )
    .eq("game_slug", gameSlug)
    .order("sort_order", { ascending: true });

  if (existingError) throw existingError;

  const existingRows = (existingData ?? []) as DatabaseAchievementRow[];

  // Para cada nome, escolhemos o registro que o payload atual realmente
  // representa. Isso evita manter uma duplicata antiga só porque ela aparece
  // primeiro no banco.
  const existingByTitle = new Map<
    string,
    DatabaseAchievementRow[]
  >();

  for (const row of existingRows) {
    const key = normalizeTitle(row.title);
    if (!key) continue;

    const bucket = existingByTitle.get(key) ?? [];
    bucket.push(row);
    existingByTitle.set(key, bucket);
  }

  const incomingLegacyByTitle = new Map<string, string>();

  uniqueIncoming.forEach((achievement, index) => {
    incomingLegacyByTitle.set(
      normalizeTitle(achievement.title),
      legacyIdFor(achievement, index)
    );
  });

  const idsToDelete = new Set<string>();

  // Remove duplicatas físicas existentes. Mantemos a linha que corresponde ao
  // id/legacy_id enviado pelo editor; se não houver correspondência, mantemos
  // a primeira linha.
  for (const [titleKey, rows] of existingByTitle) {
    if (rows.length <= 1) continue;

    const desiredLegacyId = incomingLegacyByTitle.get(titleKey);
    const keeper =
      rows.find(
        (row) =>
          desiredLegacyId !== undefined &&
          row.legacy_id === desiredLegacyId
      ) ?? rows[0];

    for (const row of rows) {
      if (row.id !== keeper.id) {
        idsToDelete.add(row.id);
      }
    }
  }

  // Qualquer registro que não esteja mais presente no payload completo do
  // editor foi removido da lista atual. Para o editor de jogos isso vale para
  // conquistas customizadas e oficiais: se o usuário removeu, sai do banco.
  const incomingKeys = new Set(
    uniqueIncoming.map((achievement, index) =>
      legacyIdFor(achievement, index)
    )
  );

  for (const row of existingRows) {
    if (!incomingKeys.has(row.legacy_id)) {
      idsToDelete.add(row.id);
    }
  }

  if (idsToDelete.size > 0) {
    const ids = [...idsToDelete];

    const { error: progressDeleteError } = await client
      .from("achievement_progress")
      .delete()
      .in("achievement_id", ids);

    if (progressDeleteError) throw progressDeleteError;

    const { error: achievementsDeleteError } = await client
      .from("achievements")
      .delete()
      .in("id", ids);

    if (achievementsDeleteError) throw achievementsDeleteError;
  }

  // Agora salvamos somente o conjunto único e atualizado.
  const definitions = uniqueIncoming.map((achievement, index) =>
    buildAchievementDefinition(achievement, index, gameSlug)
  );

  if (definitions.length === 0) {
    return { saved: [], progress: [] };
  }

  const { data: saved, error: definitionsError } = await client
    .from("achievements")
    .upsert(definitions, {
      onConflict: "game_slug,legacy_id",
    })
    .select(
      "id, game_slug, legacy_id, title, description, trophy, rank, image, sort_order, is_custom, is_hidden, source, external_id, official_image"
    );

  if (definitionsError || !saved) {
    throw (
      definitionsError ||
      new Error("Não foi possível salvar as definições.")
    );
  }

  const savedRows = saved as DatabaseAchievementRow[];
  const idByLegacyId = new Map(
    savedRows.map((achievement) => [
      achievement.legacy_id,
      achievement.id,
    ])
  );

  const progress = uniqueIncoming.map((achievement, index) =>
    buildAchievementProgress(achievement, index, idByLegacyId)
  );

  if (progress.some((item) => !item.achievement_id)) {
    throw new Error(
      "Não foi possível vincular o progresso às conquistas."
    );
  }

  const { data: savedProgress, error: progressError } = await client
    .from("achievement_progress")
    .upsert(progress, {
      onConflict: "owner_key,achievement_id",
    })
    .select(
      "achievement_id, owner_key, status, earned_at, rank_override, image_override"
    );

  if (progressError) throw progressError;

  return {
    saved: savedRows,
    progress:
      (savedProgress ?? []) as DatabaseAchievementProgressRow[],
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
    image:
      progress?.image_override || achievement.image || "",
    isCustom: achievement.is_custom,
    isHidden: achievement.is_hidden,
    source: achievement.source ?? "manual",
    externalId: achievement.external_id ?? undefined,
    officialImage:
      achievement.official_image ?? undefined,
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

  const { data: achievements, error: achievementsError } =
    await client
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

  const achievementRows =
    (achievements ?? []) as DatabaseAchievementRow[];
  const achievementIds = achievementRows.map(
    (achievement) => achievement.id
  );

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
    progressRows =
      (progress ?? []) as DatabaseAchievementProgressRow[];
  }

  const progressByAchievementId = new Map(
    progressRows.map((progress) => [
      progress.achievement_id,
      progress,
    ])
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
 * Retorna todos os jogos não excluídos junto com suas conquistas e o progresso
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
    const gameSlugs = gameRows
      .map((game) => game.slug)
      .filter(Boolean);

    if (gameSlugs.length === 0) {
      return NextResponse.json({
        ok: true,
        games: [],
      });
    }

    const { data: achievements, error: achievementsError } =
      await client
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

    const achievementRows =
      (achievements ?? []) as DatabaseAchievementRow[];
    const achievementIds = achievementRows.map(
      (achievement) => achievement.id
    );

    let progressRows: DatabaseAchievementProgressRow[] = [];

    if (achievementIds.length > 0) {
      const { data: progress, error: progressError } =
        await client
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
      progressRows =
        (progress ?? []) as DatabaseAchievementProgressRow[];
    }

    const progressByAchievementId = new Map(
      progressRows.map((progress) => [
        progress.achievement_id,
        progress,
      ])
    );

    const achievementsByGameSlug = new Map<
      string,
      ReturnType<typeof normalizeAchievementFromDatabase>[]
    >();

    for (const achievement of achievementRows) {
      const current =
        achievementsByGameSlug.get(achievement.game_slug) ?? [];

      current.push(
        normalizeAchievementFromDatabase(
          achievement,
          progressByAchievementId.get(achievement.id)
        )
      );

      achievementsByGameSlug.set(
        achievement.game_slug,
        current
      );
    }

    const enrichedGames = gameRows.map((game) => ({
      ...game,
      achievementsList:
        achievementsByGameSlug.get(game.slug) ?? [],
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

/**
 * POST
 *
 * Cria/atualiza o jogo e, quando achievementsList estiver presente,
 * sincroniza também as definições e o progresso das conquistas.
 */
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

    const { error: gameError } = await client
      .from("games")
      .upsert(game, { onConflict: "slug" });

    if (gameError) throw gameError;

    await syncAchievements(client, slug, body.achievementsList);

    const enrichedGame = await fetchEnrichedGame(
      client,
      slug
    );

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
            : "Não foi possível salvar o jogo.",
      },
      { status: 500 }
    );
  }
}

/**
 * PUT
 *
 * Atualiza o jogo e, quando achievementsList estiver presente,
 * sincroniza também as definições e o progresso das conquistas.
 */
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

    const { error: gameError } = await client
      .from("games")
      .update(updateData)
      .eq("slug", slug);

    if (gameError) throw gameError;

    await syncAchievements(
      client,
      slug,
      body.achievementsList
    );

    const enrichedGame = await fetchEnrichedGame(
      client,
      slug
    );

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
            : "Não foi possível atualizar o jogo.",
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE
 *
 * Não apaga fisicamente o jogo.
 *
 * action:
 * - hide     → oculta
 * - delete   → marca como excluído
 * - restore  → restaura
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

    const { error: gameError } = await client
      .from("games")
      .update(updateData)
      .eq("slug", slug);

    if (gameError) throw gameError;

    const enrichedGame = await fetchEnrichedGame(
      client,
      slug
    );

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
            : "Não foi possível alterar o jogo.",
      },
      { status: 500 }
    );
  }
}

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

function normalizeSlug(value?: string) {
  return value?.trim() || "";
}

function normalizeNumber(value: unknown, fallback = 0) {
  const number = Number(value);

  if (Number.isFinite(number)) {
    return number;
  }

  return fallback;
}

function normalizeText(value: unknown, fallback = "") {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number") {
    return String(value);
  }

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
    progress: Math.min(
      100,
      Math.max(0, normalizeNumber(game.progress, 0))
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
    is_hidden: game.isHidden === true,
    is_deleted: game.isDeleted === true,
    updated_at: now,
  };
}

/**
 * GET
 *
 * Retorna todos os jogos ativos.
 *
 * O frontend pode usar esta rota para buscar a versão global
 * armazenada no Supabase.
 */
export async function GET() {
  try {
    const client = createAdminSupabaseClient();

    const { data, error } = await client
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

    if (error) {
      throw error;
    }

    return NextResponse.json({
      ok: true,
      games: data ?? [],
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
 * Cria um jogo novo.
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

    const { data, error } = await client
      .from("games")
      .upsert(game, {
        onConflict: "slug",
      })
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

    if (error) {
      throw error;
    }

    return NextResponse.json({
      ok: true,
      game: data,
    });
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

/**
 * PUT
 *
 * Atualiza um jogo existente.
 *
 * É esta operação que será usada pelo useSiteGames.ts
 * quando alterarmos um jogo pelo painel.
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

    if (error) {
      throw error;
    }

    return NextResponse.json({
      ok: true,
      game: data,
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

    if (error) {
      throw error;
    }

    return NextResponse.json({
      ok: true,
      game: data,
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
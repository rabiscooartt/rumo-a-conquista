import { NextRequest, NextResponse } from "next/server";
import { requireAdminActor } from "@/lib/admin-guard";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { invalidatePublicGameData } from "@/lib/publicDataCache";
import { supabaseLifecycleRpc } from "@/lib/images/lifecycle/tracked";
import { auditedGameSave } from "@/lib/images/lifecycle/referenceSync";
import { lifecycleErrorResponse } from "@/lib/images/lifecycle/httpErrors";

type FinalBadgePayload = {
  title?: unknown;
  icon?: unknown;
  image?: unknown;
  description?: unknown;
};

function cleanText(value: unknown, fallback = "") {
  if (typeof value !== "string" && typeof value !== "number") {
    return fallback;
  }

  return String(value).trim().replace(/\s+/g, " ");
}

export async function POST(request: NextRequest) {
  // O ator da auditoria de imagens vem da sessão validada aqui, nunca do navegador.
  const session = await requireAdminActor(request);
  if (session.denied) return session.denied;

  try {
    const body = (await request.json()) as {
      slug?: unknown;
      finalBadge?: FinalBadgePayload;
    };

    const slug = cleanText(body.slug);

    if (!slug) {
      return NextResponse.json(
        { error: "O slug do jogo é obrigatório." },
        { status: 400 }
      );
    }

    const rawBadge =
      body.finalBadge &&
      typeof body.finalBadge === "object" &&
      !Array.isArray(body.finalBadge)
        ? body.finalBadge
        : {};

    const finalBadge = {
      title: cleanText(rawBadge.title, "Maestria Final") || "Maestria Final",
      icon: cleanText(rawBadge.icon, "💎") || "💎",
      image: cleanText(rawBadge.image),
      description: cleanText(rawBadge.description),
    };

    const client = createAdminSupabaseClient();

    // Duplicatas calculadas ANTES de gravar (só leitura), para entrarem na intenção da auditoria.
    const { data: achievementRows, error: achievementQueryError } = await client
      .from("achievements")
      .select("id, title, description")
      .eq("game_slug", slug);

    if (achievementQueryError) throw achievementQueryError;

    const masteryTitle = cleanText(finalBadge.title, "Maestria Final");
    const masteryDescription = cleanText(finalBadge.description);

    const duplicateIds = (achievementRows ?? [])
      .filter((row) => {
        const rowTitle = cleanText(row.title);
        const rowDescription = cleanText(row.description);
        return (
          rowTitle === masteryTitle &&
          rowDescription === masteryDescription
        );
      })
      .map((row) => String(row.id))
      .filter(Boolean);

    const { result: data } = await auditedGameSave({
      rpc: supabaseLifecycleRpc(client), client, slug, actor: session.actor,
      reason: `Maestria Final salva (${slug})`,
      // .single() falha sem a linha do jogo: o plano só grava o jogo se ele existe.
      plan: (before) => ({ ...(before.game ? { game: { final_badge: finalBadge } } : {}), deleteAchievementIds: duplicateIds }),
      write: async () => {
        const { data: saved, error } = await client
          .from("games")
          .update({
            final_badge: finalBadge,
            updated_at: new Date().toISOString(),
          })
          .eq("slug", slug)
          .select("final_badge")
          .single();

        if (error) throw error;

        if (duplicateIds.length > 0) {
          const { error: progressDeleteError } = await client
            .from("achievement_progress")
            .delete()
            .in("achievement_id", duplicateIds);

          if (progressDeleteError) throw progressDeleteError;

          const { error: achievementDeleteError } = await client
            .from("achievements")
            .delete()
            .in("id", duplicateIds);

          if (achievementDeleteError) throw achievementDeleteError;
        }
        return saved;
      },
    });

    invalidatePublicGameData();

    return NextResponse.json({
      ok: true,
      finalBadge: data?.final_badge ?? finalBadge,
      removedAchievementIds: duplicateIds,
    });
  } catch (error) {
    const lifecycle = lifecycleErrorResponse(error);
    if (lifecycle) return NextResponse.json(lifecycle.body, { status: lifecycle.status });
    console.error("Erro salvando Maestria Final:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível salvar a Maestria Final.",
      },
      { status: 500 }
    );
  }
}

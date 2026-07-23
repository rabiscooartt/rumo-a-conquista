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
};

const validRanks = new Set(["Bronze", "Prata", "Ouro", "Diamante"]);
const validStatuses = new Set(["locked", "progress", "completed"]);

function rankFrom(value?: string) {
  return value && validRanks.has(value) ? value : "Bronze";
}

function statusFrom(value?: string) {
  return value && validStatuses.has(value) ? value : "locked";
}

function legacyIdFor(achievement: IncomingAchievement, index: number) {
  return achievement.id?.trim() || `legacy-${index}-${achievement.title?.trim() || "sem-titulo"}`;
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      gameSlug?: string;
      achievements?: IncomingAchievement[];
    };
    const gameSlug = body.gameSlug?.trim();

    if (!gameSlug || !Array.isArray(body.achievements)) {
      return NextResponse.json({ error: "Dados de conquistas inválidos." }, { status: 400 });
    }

    const client = createAdminSupabaseClient();
    const definitions = body.achievements.map((achievement, index) => ({
      game_slug: gameSlug,
      legacy_id: legacyIdFor(achievement, index),
      title: achievement.title?.trim() || `Conquista ${index + 1}`,
      description: achievement.description?.trim() || "",
      trophy: achievement.trophy?.trim() || achievement.icon?.trim() || "",
      rank: rankFrom(achievement.rank || achievement.difficulty),
      image: achievement.image?.trim() || "",
      sort_order: index,
      is_custom: achievement.isCustom === true,
      is_hidden: achievement.isHidden === true || achievement.hidden === true,
    }));

    const { data: saved, error: definitionsError } = await client
      .from("achievements")
      .upsert(definitions, { onConflict: "game_slug,legacy_id" })
      .select("id, legacy_id");

    if (definitionsError || !saved) {
      throw definitionsError || new Error("Não foi possível salvar as definições.");
    }

    const idByLegacyId = new Map(saved.map((item) => [item.legacy_id, item.id]));
    const progress = body.achievements.map((achievement, index) => ({
      achievement_id: idByLegacyId.get(legacyIdFor(achievement, index)),
      owner_key: "default",
      status: statusFrom(achievement.status),
      earned_at: achievement.earnedDate?.trim() || null,
      rank_override: rankFrom(achievement.rank || achievement.difficulty),
      image_override: achievement.image?.trim() || null,
    }));

    if (progress.some((item) => !item.achievement_id)) {
      throw new Error("Não foi possível vincular o progresso às conquistas.");
    }

    const { error: progressError } = await client
      .from("achievement_progress")
      .upsert(progress, { onConflict: "owner_key,achievement_id" });

    if (progressError) throw progressError;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Erro salvando conquistas:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado." },
      { status: 500 }
    );
  }
}

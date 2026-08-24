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

const validRanks = new Set(["Bronze", "Prata", "Ouro", "Diamante"]);
const validStatuses = new Set(["locked", "progress", "completed"]);

function rankFrom(value?: string) {
  return value && validRanks.has(value) ? value : "Bronze";
}

function statusFrom(value?: string) {
  return value && validStatuses.has(value) ? value : "locked";
}

function normalizeTitle(value?: string) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function legacyIdFor(achievement: IncomingAchievement, index: number) {
  return (
    achievement.id?.trim() ||
    `legacy-${index}-${achievement.title?.trim() || "sem-titulo"}`
  );
}

async function deleteAchievementIds(client: ReturnType<typeof createAdminSupabaseClient>, ids: string[]) {
  if (ids.length === 0) return;

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

    // Regra definitiva: dentro de um jogo, cada nome normalizado só pode existir uma vez.
    const uniqueIncoming: IncomingAchievement[] = [];
    const seenTitles = new Set<string>();

    for (const achievement of body.achievements) {
      const title = achievement.title?.trim() || "Conquista";
      const titleKey = normalizeTitle(title);
      if (!titleKey || seenTitles.has(titleKey)) continue;
      seenTitles.add(titleKey);
      uniqueIncoming.push({ ...achievement, title });
    }

    const client = createAdminSupabaseClient();

    const { data: existingRows, error: existingError } = await client
      .from("achievements")
      .select("id, legacy_id, title, is_custom, sort_order")
      .eq("game_slug", gameSlug)
      .order("sort_order", { ascending: true });

    if (existingError) throw existingError;

    const incomingLegacyIds = new Set(
      uniqueIncoming.map((achievement, index) => legacyIdFor(achievement, index))
    );

    const incomingLegacyByTitle = new Map<string, string>();
    uniqueIncoming.forEach((achievement, index) => {
      incomingLegacyByTitle.set(
        normalizeTitle(achievement.title),
        legacyIdFor(achievement, index)
      );
    });

    const existingByTitle = new Map<string, typeof existingRows>();
    for (const row of existingRows ?? []) {
      const key = normalizeTitle(row.title);
      if (!key) continue;
      const bucket = existingByTitle.get(key) ?? [];
      bucket.push(row);
      existingByTitle.set(key, bucket);
    }

    const idsToDelete = new Set<string>();

    // Remove duplicatas físicas: conserva o registro que está sendo enviado
    // para aquele nome e apaga os demais, sejam customizados ou antigos/importados.
    for (const [titleKey, rows] of existingByTitle) {
      if (rows.length <= 1) continue;

      const desiredLegacyId = incomingLegacyByTitle.get(titleKey);
      const keeper =
        rows.find((row) => desiredLegacyId && row.legacy_id === desiredLegacyId) ??
        rows[0];

      for (const row of rows) {
        if (row.id !== keeper.id) idsToDelete.add(row.id);
      }
    }

    // Conquistas customizadas que foram removidas no painel também saem do banco.
    for (const row of existingRows ?? []) {
      if (row.is_custom === true && !incomingLegacyIds.has(row.legacy_id)) {
        idsToDelete.add(row.id);
      }
    }

    await deleteAchievementIds(client, [...idsToDelete]);

    const definitions = uniqueIncoming.map((achievement, index) => ({
      game_slug: gameSlug,
      legacy_id: legacyIdFor(achievement, index),
      title: achievement.title?.trim() || `Conquista ${index + 1}`,
      description: achievement.description?.trim() || "",
      trophy: achievement.trophy?.trim() || achievement.icon?.trim() || "",
      rank: rankFrom(achievement.rank || achievement.difficulty),
      image: achievement.image?.trim() || "",
      source: achievement.source ?? "manual",
      external_id: achievement.externalId?.trim() || null,
      official_image: achievement.officialImage?.trim() || null,
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

    const progress = uniqueIncoming.map((achievement, index) => ({
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

    return NextResponse.json({
      ok: true,
      uniqueCount: uniqueIncoming.length,
      removedDuplicates: idsToDelete.size,
    });
  } catch (error) {
    console.error("Erro salvando conquistas:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado." },
      { status: 500 }
    );
  }
}

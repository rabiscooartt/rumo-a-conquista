import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

const OWNER_KEY = "default";

type IncomingRecord = {
  id?: unknown;
  name?: unknown;
  episode?: unknown;
  earnedDate?: unknown;
  status?: unknown;
};

function cleanText(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function normalizeDate(value: unknown): string {
  const raw = cleanText(value);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const dmy = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeEpisode(value: unknown): string {
  const match = cleanText(value).match(/\d+/);
  return match ? String(Number(match[0])) : "";
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const slug = cleanText(body.slug);
    const records = Array.isArray(body.records)
      ? body.records as IncomingRecord[]
      : [];

    if (!slug) {
      return NextResponse.json({ error: "Slug do jogo é obrigatório." }, { status: 400 });
    }
    if (!records.length || records.length > 200) {
      return NextResponse.json({ error: "Informe entre 1 e 200 registros para atualizar." }, { status: 400 });
    }

    const normalizedRecords = records.map((record) => ({
      id: cleanText(record.id),
      name: cleanText(record.name),
      episode: cleanText(record.episode),
      earnedDate: normalizeDate(record.earnedDate),
      status: cleanText(record.status),
    }));

    if (normalizedRecords.some((record) => !record.id)) {
      return NextResponse.json({ error: "Há registros sem identificador. Atualize a página e tente novamente." }, { status: 400 });
    }

    for (const record of normalizedRecords) {
      if (cleanText(record.earnedDate) && !/^\d{4}-\d{2}-\d{2}$/.test(record.earnedDate)) {
        return NextResponse.json({ error: `A data de ${record.name || record.id} é inválida.` }, { status: 400 });
      }
    }

    const client = createAdminSupabaseClient();
    const [
      { data: game, error: gameError },
      { data: achievementRows, error: achievementsError },
    ] = await Promise.all([
      client
        .from("games")
        .select("slug, review")
        .eq("slug", slug)
        .maybeSingle(),
      client
        .from("achievements")
        .select("id, legacy_id, title, game_slug")
        .eq("game_slug", slug),
    ]);

    if (gameError) throw gameError;
    if (achievementsError) throw achievementsError;
    if (!game) {
      return NextResponse.json({ error: "O jogo não foi encontrado no banco de dados." }, { status: 404 });
    }

    const rows = (achievementRows ?? []) as {
      id: string;
      legacy_id: string;
      title: string;
      game_slug: string;
    }[];
    const resolvedRecords = normalizedRecords.map((record) => {
      const row = rows.find((item) =>
        String(item.legacy_id || "").trim() === record.id ||
        String(item.id || "").trim() === record.id
      );
      return row ? { ...record, row } : null;
    });

    const missingIndex = resolvedRecords.findIndex((record) => !record);
    if (missingIndex >= 0) {
      return NextResponse.json({
        error: "Uma das conquistas não foi encontrada entre os registros publicados deste jogo. Atualize a página antes de salvar.",
        missingId: normalizedRecords[missingIndex]?.id,
      }, { status: 409 });
    }

    const validRecords = resolvedRecords as Array<{
      id: string;
      name: string;
      episode: string;
      earnedDate: string;
      status: string;
      row: { id: string; legacy_id: string; title: string; game_slug: string };
    }>;

    const progressIds = validRecords.map((record) => record.row.id);
    const { data: existingProgress, error: progressReadError } = await client
      .from("achievement_progress")
      .select("achievement_id, status")
      .eq("owner_key", OWNER_KEY)
      .in("achievement_id", progressIds);

    if (progressReadError) throw progressReadError;

    const progressByAchievementId = new Map(
      (existingProgress ?? []).map((progress) => [
        String(progress.achievement_id),
        String(progress.status ?? "locked"),
      ])
    );

    for (const record of validRecords) {
      const { data: updated, error: progressUpdateError } = await client
        .from("achievement_progress")
        .update({ earned_at: record.earnedDate || null })
        .eq("owner_key", OWNER_KEY)
        .eq("achievement_id", record.row.id)
        .select("achievement_id");

      if (progressUpdateError) throw progressUpdateError;

      if (!updated?.length && record.earnedDate) {
        const currentStatus = progressByAchievementId.get(record.row.id);
        const status = ["locked", "progress", "completed"].includes(currentStatus ?? "")
          ? currentStatus
          : ["locked", "progress", "completed"].includes(record.status)
            ? record.status
            : "completed";
        const { error: progressInsertError } = await client
          .from("achievement_progress")
          .insert({
            achievement_id: record.row.id,
            owner_key: OWNER_KEY,
            status,
            earned_at: record.earnedDate,
          });
        if (progressInsertError) throw progressInsertError;
      }
    }

    const review = asRecord(game.review);
    const firstJourney = asRecord(review.__firstJourney);
    const rawMeta = asRecord(firstJourney.achievementMeta);
    const achievementMeta: Record<string, Record<string, unknown>> = Object.fromEntries(
      Object.entries(rawMeta).map(([id, value]) => [id, { ...asRecord(value) }])
    );

    for (const record of validRecords) {
      const key = String(record.row.legacy_id || record.row.id).trim();
      const previous = { ...(achievementMeta[key] ?? {}) };
      const previousEpisode = cleanText(previous.episode);
      const previousUrl = cleanText(previous.liveUrl);

      if (record.episode) {
        previous.episode = record.episode;
        if (normalizeEpisode(previousEpisode) !== normalizeEpisode(record.episode)) {
          delete previous.liveUrl;
        } else if (previousUrl) {
          previous.liveUrl = previousUrl;
        }
      } else {
        delete previous.episode;
        delete previous.liveUrl;
      }

      if (record.earnedDate) {
        previous.date = record.earnedDate;
      } else {
        delete previous.date;
      }

      if (Object.keys(previous).length > 0) achievementMeta[key] = previous;
      else delete achievementMeta[key];
    }

    const status = ["not_started", "in_progress", "completed"].includes(String(firstJourney.status))
      ? String(firstJourney.status)
      : "not_started";
    const nextReview = {
      ...review,
      __firstJourney: {
        ...firstJourney,
        status,
        achievementIds: Array.isArray(firstJourney.achievementIds) ? firstJourney.achievementIds : [],
        achievementMeta,
      },
    };

    const { error: reviewUpdateError } = await client
      .from("games")
      .update({
        review: nextReview,
        updated_at: new Date().toISOString(),
      })
      .eq("slug", slug);

    if (reviewUpdateError) throw reviewUpdateError;

    return NextResponse.json({
      ok: true,
      updated: validRecords.length,
      records: validRecords.map((record) => ({
        id: record.id,
        name: record.name || record.row.title,
        episode: record.episode,
        earnedDate: record.earnedDate,
      })),
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Não foi possível atualizar os registros publicados.",
    }, { status: 500 });
  }
}

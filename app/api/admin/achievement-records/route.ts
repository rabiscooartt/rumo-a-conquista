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

function normalizeMetadataTitle(value: unknown): string {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isCompletedStatus(value: unknown): boolean {
  return ["completed", "concluido", "concluida", "desbloqueado", "desbloqueada"].includes(
    normalizeMetadataTitle(value)
  );
}

function clearAchievementMetadataForRow(
  metadata: Record<string, unknown>,
  row: { id: string; legacy_id: string; title: string }
) {
  const titleKey = "title:" + normalizeMetadataTitle(row.title);
  const candidates = new Set(
    [row.id, row.legacy_id, row.title, titleKey]
      .map((value) => cleanText(value))
      .filter(Boolean)
  );
  let changed = false;

  for (const [key, value] of Object.entries(metadata)) {
    const normalizedKey = key.startsWith("title:")
      ? "title:" + normalizeMetadataTitle(key.slice("title:".length))
      : key;
    if (!candidates.has(key) && !candidates.has(normalizedKey)) continue;

    const previous = asRecord(value);
    if (!Object.keys(previous).length) continue;
    const next = { ...previous };
    delete next.episode;
    delete next.date;
    delete next.liveUrl;

    if (Object.keys(next).length) metadata[key] = next;
    else delete metadata[key];
    changed = true;
  }

  return changed;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const slug = cleanText(body.slug);
    const action = cleanText(body.action);
    const records = Array.isArray(body.records)
      ? body.records as IncomingRecord[]
      : [];
    const finalMasteryRaw =
      body.finalMastery && typeof body.finalMastery === "object" && !Array.isArray(body.finalMastery)
        ? body.finalMastery as Record<string, unknown>
        : null;
    const finalMastery = finalMasteryRaw
      ? {
          episode: cleanText(finalMasteryRaw.episode),
          earnedDate: normalizeDate(finalMasteryRaw.earnedDate),
        }
      : null;

    if (!slug) {
      return NextResponse.json({ error: "Slug do jogo é obrigatório." }, { status: 400 });
    }

    if (action === "clear-completed") {
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
          .select("id, legacy_id, title")
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
      }[];
      const achievementIds = rows.map((row) => row.id).filter(Boolean);
      let progressRows: { achievement_id: string; status: string; earned_at: string | null }[] = [];

      if (achievementIds.length) {
        const { data, error: progressError } = await client
          .from("achievement_progress")
          .select("achievement_id, status, earned_at")
          .eq("owner_key", OWNER_KEY)
          .in("achievement_id", achievementIds);

        if (progressError) throw progressError;
        progressRows = (data ?? []) as typeof progressRows;
      }

      const progressById = new Map(progressRows.map((row) => [row.achievement_id, row]));
      const resetProgress = progressRows.filter(
        (row) => isCompletedStatus(row.status) || Boolean(cleanText(row.earned_at))
      );
      const completedCount = progressRows.filter((row) => isCompletedStatus(row.status)).length;
      const resetIds = [...new Set(resetProgress.map((row) => row.achievement_id))];

      if (resetIds.length) {
        const { error: resetError } = await client
          .from("achievement_progress")
          .update({ status: "locked", earned_at: null })
          .eq("owner_key", OWNER_KEY)
          .in("achievement_id", resetIds);

        if (resetError) throw resetError;
      }

      const review = asRecord(game.review);
      const firstJourney = asRecord(review.__firstJourney);
      const originalMetadata = asRecord(firstJourney.achievementMeta);
      const achievementMeta: Record<string, unknown> = { ...originalMetadata };
      let metadataChanged = false;

      for (const row of rows) {
        const progress = progressById.get(row.id);
        if (!progress || (!isCompletedStatus(progress.status) && !cleanText(progress.earned_at))) {
          continue;
        }
        metadataChanged =
          clearAchievementMetadataForRow(achievementMeta, row) || metadataChanged;
      }

      const masteryKey = slug + "-final-mastery";
      const masteryMetadata = asRecord(achievementMeta[masteryKey]);
      if (Object.keys(masteryMetadata).length) {
        const nextMasteryMetadata = { ...masteryMetadata };
        delete nextMasteryMetadata.episode;
        delete nextMasteryMetadata.date;
        delete nextMasteryMetadata.liveUrl;
        if (Object.keys(nextMasteryMetadata).length) achievementMeta[masteryKey] = nextMasteryMetadata;
        else delete achievementMeta[masteryKey];
        metadataChanged = true;
      }

      const journeyWasCompleted = normalizeMetadataTitle(firstJourney.status) === "completed";
      const hasJourney = Object.keys(firstJourney).length > 0;
      if (hasJourney && (metadataChanged || journeyWasCompleted)) {
        const nextJourney: Record<string, unknown> = {
          ...firstJourney,
          ...(Object.keys(achievementMeta).length ? { achievementMeta } : {}),
        };
        if (Object.keys(achievementMeta).length === 0) delete nextJourney.achievementMeta;
        if (journeyWasCompleted) {
          nextJourney.status = "in_progress";
          delete nextJourney.completedAt;
        }

        const nextReview = { ...review, __firstJourney: nextJourney };
        const { error: reviewUpdateError } = await client
          .from("games")
          .update({ review: nextReview, updated_at: new Date().toISOString() })
          .eq("slug", slug);

        if (reviewUpdateError) throw reviewUpdateError;
      }

      return NextResponse.json({
        ok: true,
        slug,
        clearedCount: completedCount,
        resetCount: resetIds.length,
        notesCleared: metadataChanged,
        firstJourneyReset: journeyWasCompleted,
      });
    }

    if ((!records.length && !finalMastery) || records.length > 200) {
      return NextResponse.json({ error: "Informe registros existentes ou os dados da Maestria Final para atualizar." }, { status: 400 });
    }
    if (
      finalMasteryRaw &&
      cleanText(finalMasteryRaw.earnedDate) &&
      !finalMastery?.earnedDate
    ) {
      return NextResponse.json({ error: "A data da Maestria Final é inválida." }, { status: 400 });
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

    for (let i = 0; i < normalizedRecords.length; i += 1) {
      const sourceDate = cleanText(records[i]?.earnedDate);
      const record = normalizedRecords[i];
      if (sourceDate && !record.earnedDate) {
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

    if (validRecords.length > 0) {
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

    if (finalMastery) {
      const key = `${slug}-final-mastery`;
      const previous = { ...(achievementMeta[key] ?? {}) };
      const previousEpisode = cleanText(previous.episode);

      if (finalMastery.episode) {
        previous.episode = finalMastery.episode;
        if (normalizeEpisode(previousEpisode) !== normalizeEpisode(finalMastery.episode)) {
          delete previous.liveUrl;
        }
      } else {
        delete previous.episode;
        delete previous.liveUrl;
      }

      if (finalMastery.earnedDate) {
        previous.date = finalMastery.earnedDate;
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
      updated: validRecords.length + (finalMastery ? 1 : 0),
      finalMastery: finalMastery
        ? { episode: finalMastery.episode, earnedDate: finalMastery.earnedDate }
        : undefined,
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

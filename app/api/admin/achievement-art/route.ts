import { revalidateTag } from "next/cache";
import { requireAdminActor } from "@/lib/admin-guard";
import { NextRequest, NextResponse } from "next/server";
import { HOME_CATALOG_CACHE_TAG } from "@/lib/homeInitialData";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { safeImageBaseName } from "@/lib/images/naming";
import {
  ImageValidationError,
  optimizationSummary,
  optimizeUploadedFile,
} from "@/lib/images/optimizeImage";
import { importAchievementArt, type AchievementArtDeps } from "@/lib/images/lifecycle/achievementArtImport";
import { supabaseLifecycleRpc, type TrackedBucketApi } from "@/lib/images/lifecycle/tracked";
import { lifecycleErrorResponse, RECONCILE_HINT, refusedMessage } from "@/lib/images/lifecycle/httpErrors";

export const runtime = "nodejs";

const BUCKET = "achievement-art";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/^\d+[-_\s]*/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function POST(request: NextRequest) {
  // O ator da auditoria vem da sessão validada aqui, nunca do navegador.
  const session = await requireAdminActor(request);
  if (session.denied) return session.denied;

  try {
    const formData = await request.formData();
    const gameSlug = String(formData.get("gameSlug") ?? "").trim();
    const files = formData.getAll("files").filter((value): value is File => value instanceof File);
    const expectedFilenames = JSON.parse(String(formData.get("expectedFilenames") ?? "[]")) as string[];

    if (!gameSlug) {
      return NextResponse.json({ error: "O slug do jogo é obrigatório." }, { status: 400 });
    }

    if (files.length === 0) {
      return NextResponse.json({ error: "Nenhuma imagem foi enviada." }, { status: 400 });
    }

    const client = createAdminSupabaseClient();

    const { data: achievements, error: achievementsError } = await client
      .from("achievements")
      .select("id, title, sort_order")
      .eq("game_slug", gameSlug);

    if (achievementsError) throw achievementsError;

    const achievementByFilename = new Map(
      (achievements ?? []).map((achievement) => [normalize(achievement.title), achievement])
    );
    const achievementBySortOrder = new Map(
      (achievements ?? [])
        .filter((achievement) => Number.isFinite(Number(achievement.sort_order)))
        .map((achievement) => [Number(achievement.sort_order), achievement])
    );

    const matches = files.map((file) => {
      const normalizedName = normalize(file.name);
      const direct = achievementByFilename.get(normalizedName);

      // As conquistas preparadas pelo Exophase usam a ordem original no nome
      // do arquivo (01-, 02-, ...). A tabela local pode ter títulos
      // normalizados/diferentes, então usamos a posição como fallback.
      const prefixMatch = file.name.match(/^(\d+)[-_\s]/);
      const sortOrder = prefixMatch ? Number(prefixMatch[1]) - 1 : null;
      const byOrder =
        sortOrder !== null ? achievementBySortOrder.get(sortOrder) : undefined;

      return {
        file,
        achievement: direct ?? byOrder,
      };
    });

    const unknown = matches.filter((item) => !item.achievement);
    if (unknown.length > 0) {
      return NextResponse.json(
        {
          error: "Existem imagens que não correspondem a nenhuma conquista.",
          files: unknown.map((item) => item.file.name),
        },
        { status: 400 }
      );
    }

    // A importação é incremental: cada lote pode conter somente as conquistas
    // que o usuário acabou de gerar. As imagens restantes podem ser enviadas depois.
    const { error: bucketError } = await client.storage.createBucket(BUCKET, {
      public: true,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
      fileSizeLimit: "10MB",
    });

    if (bucketError && !/already exists/i.test(bucketError.message)) {
      throw bucketError;
    }

    // Valida e converte todos os arquivos antes de gravar qualquer coisa: um arquivo inválido
    // no meio do lote não deixa conquistas atualizadas pela metade.
    const optimizedFiles = [];
    for (const item of matches) {
      try {
        optimizedFiles.push({ ...item, optimized: await optimizeUploadedFile(item.file, "achievement") });
      } catch (error) {
        if (error instanceof ImageValidationError) {
          return NextResponse.json(
            { error: `${item.file.name}: ${error.message}`, files: [item.file.name] },
            { status: error.status }
          );
        }
        throw error;
      }
    }

    // Envio rastreado e troca auditada das referências (ciclo de vida das imagens).
    const deps: AchievementArtDeps = {
      rpc: supabaseLifecycleRpc(client),
      bucketApi: client.storage.from(BUCKET) as unknown as TrackedBucketApi,
      async loadAchievements(slug, ids) {
        const { data, error } = await client.from("achievements").select("id, title, image").eq("game_slug", slug).in("id", ids);
        if (error) throw error;
        return (data ?? []).map((row) => ({ id: String(row.id), title: String(row.title), image: row.image ?? null }));
      },
      async loadAffectedProgress(ids) {
        const { data, error } = await client.from("achievement_progress")
          .select("id, achievement_id, status, earned_at, image_override").in("achievement_id", ids).not("image_override", "is", null);
        if (error) throw error;
        return (data ?? []).map((row) => ({
          id: String(row.id), achievement_id: String(row.achievement_id), status: String(row.status),
          earned_at: row.earned_at ?? null, image_override: row.image_override ?? null,
        }));
      },
      async loadObjects(keys) {
        if (keys.length === 0) return [];
        const paths = keys.map((key) => key.slice(key.indexOf("/") + 1));
        const { data, error } = await client.from("storage_object_lifecycle")
          .select("bucket, object_path, state, manual_protection").in("object_path", paths);
        if (error) throw error;
        return (data ?? []).filter((row) => keys.includes(`${row.bucket}/${row.object_path}`));
      },
      async loadBatchItems(batchKey) {
        const { data, error } = await client.from("storage_operation_log").select("details")
          .eq("idempotency_key", batchKey).eq("phase", "intent").eq("operation", "reference_batch").maybeSingle();
        if (error) throw error;
        const items = (data?.details as { items?: unknown } | null)?.items;
        return Array.isArray(items) ? (items as Awaited<ReturnType<AchievementArtDeps["loadBatchItems"]>>) : null;
      },
    };

    const outcome = await importAchievementArt({
      deps,
      gameSlug,
      actor: session.actor,
      items: optimizedFiles.map((item) => ({
        filename: item.file.name,
        achievementId: String(item.achievement!.id),
        baseName: safeImageBaseName(item.file.name, "conquista"),
        optimized: item.optimized,
      })),
    });
    const summaries = new Map(optimizedFiles.map((item) => [item.file.name, optimizationSummary(item.optimized)]));
    const saved = outcome.saved.map((item) => ({ ...item, optimization: summaries.get(item.filename) }));

    if (outcome.status !== "nothing_accepted") revalidateTag(HOME_CATALOG_CACHE_TAG, { expire: 0 });

    if (outcome.status === "completed") {
      return NextResponse.json({
        ok: true, bucket: BUCKET, gameSlug, saved, count: saved.length,
        refused: outcome.refused, previousObjects: outcome.previousObjects,
      });
    }
    if (outcome.status === "nothing_accepted") {
      return NextResponse.json(
        { error: refusedMessage(outcome.refused), refused: outcome.refused, files: outcome.refused.map((r) => r.filename) },
        { status: 409 }
      );
    }
    if (outcome.status === "upload_failed") {
      return NextResponse.json(
        {
          error: outcome.uploadFailure?.pending
            ? `${outcome.uploadFailure.message} ${RECONCILE_HINT}`
            : outcome.uploadFailure?.message ?? "Falha ao enviar as artes.",
          pending: outcome.uploadFailure?.pending ?? false,
          uploaded: outcome.uploads.map((u) => u.filename),
          refused: outcome.refused,
        },
        { status: 502 }
      );
    }
    // Parcial: parte das referências trocou e o resto continua como estava. Não é sucesso.
    const batch = outcome.batch!;
    return NextResponse.json(
      {
        error: `Parte das referências foi atualizada e parte não; nada será duplicado. ${RECONCILE_HINT}`,
        partial: true,
        pending: true,
        applied: batch.applied.length + batch.alreadyApplied.length,
        total: batch.items,
        failed: batch.status === "partial" ? batch.failed : null,
        refused: outcome.refused,
        saved,
      },
      { status: 500 }
    );
  } catch (error) {
    console.error("Erro importando artes das conquistas:", error);
    const lifecycle = lifecycleErrorResponse(error);
    if (lifecycle) return NextResponse.json(lifecycle.body, { status: lifecycle.status });

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível salvar as artes.",
      },
      { status: 500 }
    );
  }
}

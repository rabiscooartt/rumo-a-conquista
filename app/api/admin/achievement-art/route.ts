import { revalidateTag } from "next/cache";
import { rejectUnlessAdmin } from "@/lib/admin-guard";
import { NextRequest, NextResponse } from "next/server";
import { HOME_CATALOG_CACHE_TAG } from "@/lib/homeInitialData";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { safeImageBaseName } from "@/lib/images/naming";
import {
  ImageValidationError,
  optimizationSummary,
  optimizeUploadedFile,
} from "@/lib/images/optimizeImage";
import { uploadOptimizedImage } from "@/lib/images/storage";

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
  const denied = await rejectUnlessAdmin(request);
  if (denied) return denied;

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

    const saved: {
      filename: string;
      title: string;
      image: string;
      optimization: ReturnType<typeof optimizationSummary>;
    }[] = [];

    for (const item of optimizedFiles) {
      const achievement = item.achievement!;

      // Só a versão WebP de exibição vai para o Storage, com nome derivado do conteúdo
      // ("<nome>.<hash>.webp"): endereço novo a cada arte nova, sem "?v=" e sem sobrescrever.
      const stored = await uploadOptimizedImage(
        client.storage.from(BUCKET),
        `games/${gameSlug}/achievements`,
        safeImageBaseName(item.file.name, "conquista"),
        item.optimized
      );
      const image = stored.publicUrl;

      const { error: updateError } = await client
        .from("achievements")
        .update({ image })
        .eq("id", achievement.id)
        .eq("game_slug", gameSlug);

      if (updateError) throw updateError;

      // A imagem do progresso tem prioridade na exibição: sem isto, a arte antiga continuaria no site.
      const { error: progressError } = await client
        .from("achievement_progress")
        .update({ image_override: image })
        .eq("achievement_id", achievement.id)
        .not("image_override", "is", null);

      if (progressError) throw progressError;

      saved.push({
        filename: item.file.name,
        title: achievement.title,
        image,
        optimization: optimizationSummary(item.optimized),
      });
    }

    revalidateTag(HOME_CATALOG_CACHE_TAG, { expire: 0 });

    return NextResponse.json({
      ok: true,
      bucket: BUCKET,
      gameSlug,
      saved,
      count: saved.length,
    });
  } catch (error) {
    console.error("Erro importando artes das conquistas:", error);

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

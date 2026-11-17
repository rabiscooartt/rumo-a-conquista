import { NextResponse } from "next/server";
import { requireAdminActor } from "@/lib/admin-guard";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { safeImageBaseName } from "@/lib/images/naming";
import {
  ImageValidationError,
  optimizationSummary,
  optimizeUploadedFile,
} from "@/lib/images/optimizeImage";
import { supabaseLifecycleRpc, uploadTracked, type TrackedBucketApi } from "@/lib/images/lifecycle/tracked";
import { lifecycleErrorResponse } from "@/lib/images/lifecycle/httpErrors";

export const runtime = "nodejs";

const BUCKET = "achievement-art";
const MAX_FILE_SIZE = 4 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type ExpectedAchievement = {
  name?: string;
  filename?: string;
  rank?: string;
};

function safeSlug(value: string) {
  return /^[a-z0-9][a-z0-9-]{0,99}$/.test(value);
}

export async function POST(request: Request) {
  // O ator da auditoria vem da sessão validada aqui, nunca do navegador.
  const session = await requireAdminActor(request);
  if (session.denied) return session.denied;

  try {
    const formData = await request.formData();
    const gameSlug = String(formData.get("gameSlug") ?? "").trim();
    const rawExpected = String(formData.get("expectedAchievements") ?? "[]");
    const file = formData.get("files");

    if (!safeSlug(gameSlug)) {
      return NextResponse.json({ error: "Identificador do jogo inválido." }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Selecione uma imagem para a conquista manual." }, { status: 400 });
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: "Use uma imagem PNG, JPG ou WEBP." }, { status: 415 });
    }

    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "A imagem deve ter até 4 MB." }, { status: 413 });
    }

    let expected: ExpectedAchievement[];
    try {
      const parsed: unknown = JSON.parse(rawExpected);
      expected = Array.isArray(parsed) ? parsed : [];
    } catch {
      return NextResponse.json({ error: "Lista de imagens esperadas inválida." }, { status: 400 });
    }

    const normalizedFilename = file.name.trim();
    const match = expected.find(
      (item) => typeof item.filename === "string" && item.filename === normalizedFilename
    );
    if (!match || typeof match.name !== "string" || !match.name.trim()) {
      return NextResponse.json(
        { error: "O arquivo não corresponde a uma conquista manual desta preparação." },
        { status: 400 }
      );
    }

    // Valida a assinatura real e converte antes de tocar no Storage.
    const optimized = await optimizeUploadedFile(file, "achievement");

    const client = createAdminSupabaseClient();
    const { data: bucket } = await client.storage.getBucket(BUCKET);
    if (!bucket) {
      const { error: createError } = await client.storage.createBucket(BUCKET, {
        public: true,
        allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
        fileSizeLimit: "10MB",
      });
      if (createError && !/already exists|duplicate/i.test(createError.message)) {
        throw createError;
      }
    }

    // Envio rastreado (ciclo de vida): intenção antes do envio, WebP com nome derivado do SHA-256,
    // sem sobrescrever, conferido no Storage e confirmado no banco. A referência só entra depois,
    // pelo rascunho e pelo salvamento do jogo; até lá o objeto fica "unverified".
    const stored = await uploadTracked({
      rpc: supabaseLifecycleRpc(client),
      bucket: BUCKET,
      api: client.storage.from(BUCKET) as unknown as TrackedBucketApi,
      directory: "games/" + gameSlug + "/achievements",
      baseName: safeImageBaseName(normalizedFilename, "conquista"),
      image: optimized,
      actor: session.actor,
      reason: `arte de conquista manual preparada (${gameSlug})`,
    });
    const image = stored.publicUrl;

    return NextResponse.json({
      ok: true,
      gameSlug,
      count: 1,
      saved: [
        {
          filename: normalizedFilename,
          title: match.name.trim(),
          image,
          optimization: optimizationSummary(optimized),
        },
      ],
    });
  } catch (error) {
    if (error instanceof ImageValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    // Ciclo de vida: mensagens com o motivo e o que fazer (pendências, colisão, ativação em aberto).
    const lifecycle = lifecycleErrorResponse(error);
    if (lifecycle) return NextResponse.json(lifecycle.body, { status: lifecycle.status });
    console.error("[Manual Achievement Art Upload]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível salvar a arte da conquista manual." },
      { status: 500 }
    );
  }
}

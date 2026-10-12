import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

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

function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export async function POST(request: Request) {
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

    const filename = safeFilename(normalizedFilename);
    const path = "games/" + gameSlug + "/achievements/" + filename;
    const { error: uploadError } = await client.storage
      .from(BUCKET)
      .upload(path, file, {
        contentType: file.type,
        upsert: true,
        cacheControl: "31536000",
      });

    if (uploadError) throw uploadError;

    const { data: publicUrl } = client.storage.from(BUCKET).getPublicUrl(path);
    const image = publicUrl.publicUrl;

    return NextResponse.json({
      ok: true,
      gameSlug,
      count: 1,
      saved: [{ filename: normalizedFilename, title: match.name.trim(), image }],
    });
  } catch (error) {
    console.error("[Manual Achievement Art Upload]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível salvar a arte da conquista manual." },
      { status: 500 }
    );
  }
}

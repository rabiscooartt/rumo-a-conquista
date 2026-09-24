import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

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
      .select("id, title")
      .eq("game_slug", gameSlug);

    if (achievementsError) throw achievementsError;

    const achievementByFilename = new Map(
      (achievements ?? []).map((achievement) => [normalize(achievement.title), achievement])
    );

    const matches = files.map((file) => ({
      file,
      achievement: achievementByFilename.get(normalize(file.name)),
    }));

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

    const missing = (achievements ?? []).filter(
      (achievement) => !matches.some((item) => item.achievement?.id === achievement.id)
    );

    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: "Existem conquistas sem imagem no lote.",
          achievements: missing.map((achievement) => achievement.title),
        },
        { status: 400 }
      );
    }

    const { error: bucketError } = await client.storage.createBucket(BUCKET, {
      public: true,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
      fileSizeLimit: "10MB",
    });

    if (bucketError && !/already exists/i.test(bucketError.message)) {
      throw bucketError;
    }

    const saved: { filename: string; title: string; image: string }[] = [];

    for (const item of matches) {
      const achievement = item.achievement!;
      const safeFilename = item.file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const path = `games/${gameSlug}/achievements/${safeFilename}`;

      const { error: uploadError } = await client.storage
        .from(BUCKET)
        .upload(path, item.file, {
          contentType: item.file.type,
          upsert: true,
          cacheControl: "31536000",
        });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = client.storage
        .from(BUCKET)
        .getPublicUrl(path);

      const image = publicUrlData.publicUrl;

      const { error: updateError } = await client
        .from("achievements")
        .update({ image })
        .eq("id", achievement.id)
        .eq("game_slug", gameSlug);

      if (updateError) throw updateError;

      saved.push({
        filename: item.file.name,
        title: achievement.title,
        image,
      });
    }

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

import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const maxDuration = 120;

const BUCKET = "game-backgrounds";
const IMAGE_MODEL = "gpt-image-2.5-flare";

function safeText(value: unknown, maxLength = 220) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function safeSlug(value: unknown) {
  const slug = safeText(value, 100).toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : "";
}

function errorMessage(value: unknown, fallback: string) {
  if (value && typeof value === "object" && "message" in value) {
    const message = safeText((value as { message?: unknown }).message, 500);
    if (message) return message;
  }
  return fallback;
}

async function createSafetyIdentifier() {
  const bytes = new TextEncoder().encode("rumo-a-conquista-admin-image-generation");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!(await verifyAdminSession(token))) {
    return NextResponse.json(
      { error: "Entre no modo Admin para gerar o fundo do jogo." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "A chave da API de imagens não está configurada em Production." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const body = (await request.json().catch(() => null)) as { slug?: unknown } | null;
    const slug = safeSlug(body?.slug);
    if (!slug) {
      return NextResponse.json({ error: "Selecione um jogo válido." }, { status: 400 });
    }

    const client = createAdminSupabaseClient();
    const { data: game, error: gameError } = await client
      .from("games")
      .select("slug, title, subtitle")
      .eq("slug", slug)
      .single();

    if (gameError || !game) {
      return NextResponse.json({ error: "Não encontrei esse jogo no banco de dados." }, { status: 404 });
    }

    const title = safeText(game.title, 160);
    const subtitle = safeText(game.subtitle, 260);
    if (!title) {
      return NextResponse.json({ error: "O jogo precisa ter um nome antes de gerar o fundo." }, { status: 400 });
    }

    const prompt = [
      "Create an original, premium cinematic environment background for a dark gaming achievement website.",
      "The scene must be inspired by the world, atmosphere, genre and setting of the video game: " + title + ".",
      subtitle ? "Game context: " + subtitle + "." : "",
      "Create environmental key art, not a poster. Make the world recognizable through its setting, architecture, landscape, weather, materials and atmosphere.",
      "Composition for a wide 16:9 website hero panel: reserve the LEFT 45 percent as dark, low-detail negative space for white title and interface text. Place the main environmental focal point, silhouette, creature or landmark on the RIGHT third and right half.",
      "Keep the center-left quiet and uncluttered. Use cinematic depth, refined lighting, realistic material detail, layered atmosphere and sophisticated art direction.",
      "The overall image must remain readable under a dark overlay. Keep the left region notably darker than the right without adding a visible gradient band.",
      "Create an original interpretation. Do not reproduce exact promotional key art, named characters, logos, game title lettering, interface elements, trophy icons, badges, watermarks or borders.",
      "No text of any kind. No UI. No collage. No frames. Landscape composition, edge-to-edge."
    ].filter(Boolean).join(" ");

    const imageResponse = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(110000),
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt,
        n: 1,
        size: "1536x864",
        quality: "high",
        output_format: "jpeg",
        output_compression: 88,
        background: "opaque",
        moderation: "auto",
        safety_identifier: await createSafetyIdentifier(),
      }),
    });

    const imagePayload = (await imageResponse.json().catch(() => null)) as
      | { data?: Array<{ b64_json?: string }>; error?: { message?: string } }
      | null;

    if (!imageResponse.ok) {
      const providerMessage = safeText(imagePayload?.error?.message, 420);
      const message = providerMessage
        ? "A API de imagens não conseguiu gerar o fundo: " + providerMessage
        : "A API de imagens não conseguiu gerar o fundo. Verifique o acesso ao modelo e os créditos da conta.";
      return NextResponse.json(
        { error: message },
        { status: imageResponse.status === 429 ? 429 : 502, headers: { "Cache-Control": "no-store" } }
      );
    }

    const base64Image = imagePayload?.data?.[0]?.b64_json;
    if (!base64Image) {
      return NextResponse.json(
        { error: "A API concluiu a solicitação, mas não retornou a imagem." },
        { status: 502 }
      );
    }

    const imageBytes = Buffer.from(base64Image, "base64");
    if (imageBytes.length < 20_000) {
      return NextResponse.json({ error: "A imagem retornada está incompleta." }, { status: 502 });
    }

    const { error: bucketError } = await client.storage.createBucket(BUCKET, {
      public: true,
      allowedMimeTypes: ["image/jpeg"],
      fileSizeLimit: "15MB",
    });
    if (bucketError && !/already exists/i.test(bucketError.message)) {
      throw bucketError;
    }

    const filePath = "games/" + slug + "/hero-" + Date.now() + ".jpg";
    const { error: uploadError } = await client.storage
      .from(BUCKET)
      .upload(filePath, imageBytes, {
        contentType: "image/jpeg",
        upsert: true,
        cacheControl: "31536000",
      });
    if (uploadError) throw uploadError;

    const { data: publicUrlData } = client.storage.from(BUCKET).getPublicUrl(filePath);
    const publicUrl = publicUrlData.publicUrl;

    const { error: updateError } = await client
      .from("games")
      .update({ image: publicUrl })
      .eq("slug", slug);

    if (updateError) {
      await client.storage.from(BUCKET).remove([filePath]).catch(() => undefined);
      throw updateError;
    }

    return NextResponse.json(
      {
        ok: true,
        slug,
        title,
        image: publicUrl,
        storagePath: filePath,
        model: IMAGE_MODEL,
        size: "1536x864",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[Game Background] Falha ao gerar fundo:", error);
    return NextResponse.json(
      {
        error: errorMessage(error, "Não foi possível gerar e salvar o fundo deste jogo."),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

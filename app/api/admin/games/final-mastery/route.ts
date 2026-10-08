import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

type FinalBadgePayload = {
  title?: unknown;
  icon?: unknown;
  image?: unknown;
  description?: unknown;
};

function cleanText(value: unknown, fallback = "") {
  if (typeof value !== "string" && typeof value !== "number") {
    return fallback;
  }

  return String(value).trim().replace(/\s+/g, " ");
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      slug?: unknown;
      finalBadge?: FinalBadgePayload;
    };

    const slug = cleanText(body.slug);

    if (!slug) {
      return NextResponse.json(
        { error: "O slug do jogo é obrigatório." },
        { status: 400 }
      );
    }

    const rawBadge =
      body.finalBadge &&
      typeof body.finalBadge === "object" &&
      !Array.isArray(body.finalBadge)
        ? body.finalBadge
        : {};

    const finalBadge = {
      title: cleanText(rawBadge.title, "Maestria Final") || "Maestria Final",
      icon: cleanText(rawBadge.icon, "💎") || "💎",
      image: cleanText(rawBadge.image),
      description: cleanText(rawBadge.description),
    };

    const client = createAdminSupabaseClient();

    const { data, error } = await client
      .from("games")
      .update({
        final_badge: finalBadge,
        updated_at: new Date().toISOString(),
      })
      .eq("slug", slug)
      .select("final_badge")
      .single();

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      finalBadge: data?.final_badge ?? finalBadge,
    });
  } catch (error) {
    console.error("Erro salvando Maestria Final:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível salvar a Maestria Final.",
      },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

type Rank = "Bronze" | "Prata" | "Ouro";

type Incoming = {
  title?: string;
  rank?: Rank;
  sortOrder?: number;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      gameSlug?: string;
      achievements?: Incoming[];
    };

    const gameSlug = String(body.gameSlug ?? "").trim();
    const achievements = Array.isArray(body.achievements) ? body.achievements : [];

    if (!gameSlug) {
      return NextResponse.json({ error: "O slug do jogo é obrigatório." }, { status: 400 });
    }

    if (!achievements.length) {
      return NextResponse.json({ error: "Nenhuma raridade foi enviada." }, { status: 400 });
    }

    const client = createAdminSupabaseClient();

    const { data: rows, error } = await client
      .from("achievements")
      .select("id, title, sort_order")
      .eq("game_slug", gameSlug)
      .order("sort_order", { ascending: true });

    if (error) throw error;

    const byTitle = new Map(
      (rows ?? []).map((row) => [normalize(String(row.title ?? "")), row])
    );
    const byOrder = new Map(
      (rows ?? [])
        .filter((row) => Number.isFinite(Number(row.sort_order)))
        .map((row) => [Number(row.sort_order), row])
    );

    const updated: { title: string; rank: Rank }[] = [];
    const missing: string[] = [];

    for (const item of achievements) {
      const rank = item.rank;
      if (!rank || !["Bronze", "Prata", "Ouro"].includes(rank)) continue;

      const title = String(item.title ?? "").trim();
      const direct = title ? byTitle.get(normalize(title)) : undefined;
      const byOrder =
        item.sortOrder !== undefined
          ? byOrder.get(Number(item.sortOrder))
          : undefined;
      const row = direct ?? byOrder;

      if (!row) {
        missing.push(title || String(item.sortOrder ?? "?"));
        continue;
      }

      const { error: updateError } = await client
        .from("achievements")
        .update({ rank })
        .eq("id", row.id)
        .eq("game_slug", gameSlug);

      if (updateError) throw updateError;

      updated.push({ title: String(row.title), rank });
    }

    return NextResponse.json({
      ok: true,
      gameSlug,
      count: updated.length,
      updated,
      missing,
    });
  } catch (error) {
    console.error("Erro atualizando ranks das conquistas:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível atualizar os ranks.",
      },
      { status: 500 }
    );
  }
}

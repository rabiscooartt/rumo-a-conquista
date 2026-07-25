import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

type JourneyInput = {
  gameTitle?: string;
  gameSlug?: string;
  dayLabel?: string;
  status?: string;
  weekDay?: string;
  date?: string;
  title?: string;
  notes?: string;
  highlight?: string;
  threadsUrl?: string;
  tags?: unknown;
};

function normalizeTags(tags: unknown) {
  if (!Array.isArray(tags)) return [];

  return tags
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeInput(input: JourneyInput) {
  return {
    gameTitle: input.gameTitle?.trim() || "",
    gameSlug: input.gameSlug?.trim() || "",
    dayLabel: input.dayLabel?.trim() || "",
    status: input.status?.trim() || "",
    weekDay: input.weekDay?.trim() || "",
    date: input.date?.trim() || "",
    title: input.title?.trim() || "",
    notes: input.notes?.trim() || "",
    highlight: input.highlight?.trim() || "",
    threadsUrl: input.threadsUrl?.trim() || "",
    tags: normalizeTags(input.tags),
  };
}

function invalidInputResponse() {
  return NextResponse.json(
    { error: "Nome do jogo e anotações são obrigatórios." },
    { status: 400 }
  );
}

export async function POST(request: NextRequest) {
  try {
    const input = normalizeInput((await request.json()) as JourneyInput);

    if (!input.gameTitle || !input.notes) return invalidInputResponse();

    const now = new Date().toISOString();
    const { data, error } = await createAdminSupabaseClient()
      .from("journey_entries")
      .insert({ ...input, createdAt: now, updatedAt: now })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ entry: data }, { status: 201 });
  } catch (error) {
    console.error("Erro criando anotação da Jornada:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as { id?: string; entry?: JourneyInput };
    const entryId = body.id?.trim();
    const input = normalizeInput(body.entry || {});

    if (!entryId) {
      return NextResponse.json({ error: "Registro inválido." }, { status: 400 });
    }

    if (!input.gameTitle || !input.notes) return invalidInputResponse();

    const { data, error } = await createAdminSupabaseClient()
      .from("journey_entries")
      .update({ ...input, updatedAt: new Date().toISOString() })
      .eq("id", entryId)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ entry: data });
  } catch (error) {
    console.error("Erro atualizando anotação da Jornada:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as { id?: string; all?: boolean };
    const client = createAdminSupabaseClient();

    const query = body.all === true
      ? client.from("journey_entries").delete().neq("id", "")
      : client.from("journey_entries").delete().eq("id", body.id?.trim() || "");

    const { error } = await query;

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Erro removendo anotação da Jornada:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado." },
      { status: 500 }
    );
  }
}

import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import {
  HOME_BACKLOG_CACHE_TAG,
  normalizeBacklogQueue,
  writeBacklogQueue,
} from "@/lib/backlogQueue";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { items?: unknown };
    const items = normalizeBacklogQueue(body.items);

    if (!items) {
      return NextResponse.json({ error: "Fila inválida." }, { status: 400 });
    }

    await writeBacklogQueue(items);
    revalidateTag(HOME_BACKLOG_CACHE_TAG, { expire: 0 });

    return NextResponse.json({ ok: true, items });
  } catch (error) {
    console.error("[Backlog] Erro ao salvar a fila:", error);
    return NextResponse.json(
      { error: "Não foi possível salvar a fila." },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { readBacklogQueue } from "@/lib/backlogQueue";

export async function GET() {
  try {
    return NextResponse.json(
      { items: await readBacklogQueue() },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error) {
    console.error("[Backlog] Erro ao carregar a fila:", error);
    return NextResponse.json(
      { error: "Não foi possível carregar a fila." },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}

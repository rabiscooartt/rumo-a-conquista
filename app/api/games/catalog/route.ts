import { NextRequest, NextResponse } from "next/server";
import { loadPublicCatalog } from "@/lib/publicCatalog";

export async function GET(request: NextRequest) {
  try {
    const includeAchievements = request.nextUrl.searchParams.get("achievements") === "1";
    const catalog = await loadPublicCatalog({ includeAchievements });

    return NextResponse.json(
      { ok: true, ...catalog },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error) {
    console.error("[Public Game Catalog] Erro:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível carregar o catálogo público." },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}

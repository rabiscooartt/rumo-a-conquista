import { unstable_cache } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { HOME_CATALOG_CACHE_TAG } from "@/lib/homeInitialData";
import { loadPublicCatalog } from "@/lib/publicCatalog";

// Mesma etiqueta da Início: salvar um jogo no Admin limpa este cache na hora.
const getCachedCatalog = unstable_cache(
  (includeAchievements: boolean) => loadPublicCatalog({ includeAchievements }),
  ["public-catalog-route"],
  { revalidate: 60, tags: [HOME_CATALOG_CACHE_TAG] }
);

export async function GET(request: NextRequest) {
  try {
    const includeAchievements = request.nextUrl.searchParams.get("achievements") === "1";
    const catalog = await getCachedCatalog(includeAchievements);

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

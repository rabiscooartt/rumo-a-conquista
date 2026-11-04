import ReviewsClient, { type ReviewGame } from "@/app/reviews/ReviewsClient";
import { loadCachedPublicCatalog } from "@/lib/publicCatalogCache";

export default async function ReviewsPage() {
  const catalog = await loadCachedPublicCatalog(false).catch((error: unknown) => {
    console.error("[Reviews] Não foi possível carregar o catálogo no servidor:", error);
    return null;
  });

  return <ReviewsClient initialGames={(catalog?.games as ReviewGame[] | undefined) ?? null} />;
}

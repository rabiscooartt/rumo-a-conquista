import "server-only";

import { unstable_cache } from "next/cache";
import { HOME_CATALOG_CACHE_TAG } from "@/lib/homeInitialData";
import { loadPublicCatalog } from "@/lib/publicCatalog";

// Mesma etiqueta da Início: salvar um jogo no Admin limpa este cache na hora.
export const loadCachedPublicCatalog = unstable_cache(
  (includeAchievements: boolean) => loadPublicCatalog({ includeAchievements }),
  ["public-catalog-route"],
  { revalidate: 60, tags: [HOME_CATALOG_CACHE_TAG] }
);

import "server-only";

import { revalidateTag } from "next/cache";
import { HOME_CATALOG_CACHE_TAG } from "@/lib/homeInitialData";

/** Limpa os caches públicos de jogos e conquistas depois de uma gravação no Admin. */
export function invalidatePublicGameData() {
  revalidateTag(HOME_CATALOG_CACHE_TAG, { expire: 0 });
}

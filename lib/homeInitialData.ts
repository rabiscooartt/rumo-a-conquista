import "server-only";

import { unstable_cache } from "next/cache";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/lib/admin-auth";
import { loadStoredAvatar } from "@/lib/profileAvatarStorage";
import { loadPublicCatalog } from "@/lib/publicCatalog";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const HOME_AVATAR_CACHE_TAG = "home-avatar";
export const HOME_CATALOG_CACHE_TAG = "home-catalog";

const INITIAL_DATA_TIMEOUT_MS = 2500;
const HOME_CACHE_SECONDS = 60;

/** A Início só usa a nota; o restante da review não precisa ir no HTML. */
function keepHomeReviewFields(review: unknown) {
  if (!review || typeof review !== "object" || Array.isArray(review)) return undefined;

  const { nota, __achievementsListExplicitlyCleared } = review as Record<string, unknown>;
  return { nota, __achievementsListExplicitlyCleared };
}

const getCachedCatalog = unstable_cache(
  async () => {
    const catalog = await loadPublicCatalog({ includeAchievements: true });

    return {
      achievementsBySlug: catalog.achievementsBySlug ?? {},
      games: catalog.games.map((game) => ({
        ...game,
        review: keepHomeReviewFields(game.review),
      })),
      generatedAt: Date.now(),
    };
  },
  ["home-public-catalog"],
  { revalidate: HOME_CACHE_SECONDS, tags: [HOME_CATALOG_CACHE_TAG] }
);

const getCachedAvatar = unstable_cache(
  async () => ({ ...(await loadStoredAvatar()), generatedAt: Date.now() }),
  ["home-avatar"],
  { revalidate: HOME_CACHE_SECONDS, tags: [HOME_AVATAR_CACHE_TAG] }
);

// O navegador relê a Jornada ao abrir; esta cópia só evita mostrar a Biblioteca sem atividade.
const getCachedJourneyRows = unstable_cache(
  async () => {
    const { data, error } = await createAdminSupabaseClient()
      .from("journey_entries")
      .select("*")
      .order("date", { ascending: false });

    if (error) throw error;
    return (data ?? []) as Record<string, unknown>[];
  },
  ["library-journey-rows"],
  { revalidate: HOME_CACHE_SECONDS }
);

async function timedRead<T>(label: string, task: Promise<T>) {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), INITIAL_DATA_TIMEOUT_MS);
  });

  try {
    // Quem perde a corrida segue em segundo plano de propósito: ao terminar, preenche o cache.
    const result = await Promise.race([task, timeout]);
    if (result === "timeout") {
      console.warn(`[Home] ${label}: excedeu ${INITIAL_DATA_TIMEOUT_MS} ms`);
      return null;
    }

    return result;
  } catch (error) {
    console.error(`[Home] ${label}: falhou em ${Date.now() - startedAt} ms`, error);
    return null;
  } finally {
    clearTimeout(timer!);
  }
}

export async function loadLibraryInitialData() {
  const [catalog, journeyRows] = await Promise.all([
    timedRead("catálogo", getCachedCatalog()),
    timedRead("jornada", getCachedJourneyRows()),
  ]);

  return { catalog, journeyRows };
}

export async function loadHomeInitialData() {
  const [catalog, avatar, authenticated] = await Promise.all([
    timedRead("catálogo", getCachedCatalog()),
    timedRead("avatar", getCachedAvatar()),
    timedRead(
      "sessão",
      cookies().then((store) => verifyAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value))
    ),
  ]);

  return {
    catalog,
    avatar: avatar ? { ...avatar, authenticated: authenticated === true } : null,
  };
}

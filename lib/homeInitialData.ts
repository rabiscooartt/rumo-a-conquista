import "server-only";

import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/lib/admin-auth";
import { loadStoredAvatar } from "@/lib/profileAvatarStorage";
import { loadPublicCatalog } from "@/lib/publicCatalog";

const INITIAL_DATA_TIMEOUT_MS = 2500;

// Um limite curto mantém a página abrindo; o navegador assume a leitura se o servidor demorar.
function withTimeout<T>(task: Promise<T>) {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), INITIAL_DATA_TIMEOUT_MS);
  });

  return Promise.race([task.catch(() => null), timeout]).finally(() => clearTimeout(timer));
}

/** A Início só usa a nota; o restante da review não precisa ir no HTML. */
function keepHomeReviewFields(review: unknown) {
  if (!review || typeof review !== "object" || Array.isArray(review)) return undefined;

  const { nota, __achievementsListExplicitlyCleared } = review as Record<string, unknown>;
  return { nota, __achievementsListExplicitlyCleared };
}

export async function loadHomeInitialData() {
  const [catalog, avatar, authenticated] = await Promise.all([
    withTimeout(loadPublicCatalog({ includeAchievements: true })),
    withTimeout(loadStoredAvatar()),
    cookies().then((store) => verifyAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value)),
  ]);

  return {
    catalog: catalog?.achievementsBySlug
      ? {
          achievementsBySlug: catalog.achievementsBySlug,
          games: catalog.games.map((game) => ({
            ...game,
            review: keepHomeReviewFields(game.review),
          })),
        }
      : null,
    avatar: avatar ? { ...avatar, authenticated } : null,
  };
}

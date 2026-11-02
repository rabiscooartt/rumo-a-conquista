import "server-only";

import { unstable_cache } from "next/cache";
import { cookies } from "next/headers";
import { after } from "next/server";
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/lib/admin-auth";
import { HOME_BACKLOG_CACHE_TAG, readBacklogQueue } from "@/lib/backlogQueue";
import { loadStoredAvatar } from "@/lib/profileAvatarStorage";
import { loadPublicCatalog } from "@/lib/publicCatalog";

export const HOME_AVATAR_CACHE_TAG = "home-avatar";

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
  { revalidate: HOME_CACHE_SECONDS }
);

const getCachedAvatar = unstable_cache(
  async () => ({ ...(await loadStoredAvatar()), generatedAt: Date.now() }),
  ["home-avatar"],
  { revalidate: HOME_CACHE_SECONDS, tags: [HOME_AVATAR_CACHE_TAG] }
);

const getCachedBacklog = unstable_cache(
  async () => ({ items: await readBacklogQueue(), generatedAt: Date.now() }),
  ["home-backlog"],
  { revalidate: HOME_CACHE_SECONDS, tags: [HOME_BACKLOG_CACHE_TAG] }
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
    console.info(`[Home] ${label}: ${result === "timeout" ? "excedeu o limite" : "ok"} em ${Date.now() - startedAt} ms`);
    return result === "timeout" ? null : result;
  } catch (error) {
    console.error(`[Home] ${label}: falhou em ${Date.now() - startedAt} ms`, error);
    return null;
  } finally {
    clearTimeout(timer!);
  }
}

// TEMPORÁRIO: mede a leitura real, sem cache, depois da resposta. Remover após a validação na Preview.
function logUncachedTimings() {
  after(async () => {
    for (const [label, read] of [
      ["catálogo sem cache", () => loadPublicCatalog({ includeAchievements: true })],
      ["avatar sem cache", () => loadStoredAvatar()],
    ] as const) {
      const startedAt = Date.now();
      try {
        await read();
        console.info(`[Home] ${label}: ok em ${Date.now() - startedAt} ms`);
      } catch (error) {
        console.error(`[Home] ${label}: falhou em ${Date.now() - startedAt} ms`, error);
      }
    }
  });
}

export async function loadHomeInitialData() {
  const startedAt = Date.now();
  logUncachedTimings();

  const [catalog, avatar, backlog, authenticated] = await Promise.all([
    timedRead("catálogo", getCachedCatalog()),
    timedRead("avatar", getCachedAvatar()),
    timedRead("fila", getCachedBacklog()),
    timedRead(
      "sessão",
      cookies().then((store) => verifyAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value))
    ),
  ]);

  console.info(`[Home] dados iniciais prontos em ${Date.now() - startedAt} ms`);

  return {
    catalog,
    backlog,
    avatar: avatar ? { ...avatar, authenticated: authenticated === true } : null,
  };
}

import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";

const BUCKET = "site-profile";
const QUEUE_PATH = "backlog/queue.json";
const MAX_QUEUE_ITEMS = 200;

export const HOME_BACKLOG_CACHE_TAG = "home-backlog";

export type BacklogQueueItem = {
  id: string;
  slug: string;
  order: number;
};

export function normalizeBacklogQueue(value: unknown): BacklogQueueItem[] | null {
  if (!Array.isArray(value) || value.length > MAX_QUEUE_ITEMS) return null;

  const items: BacklogQueueItem[] = [];
  const seenSlugs = new Set<string>();

  for (const [index, entry] of value.entries()) {
    const record = (entry ?? {}) as Record<string, unknown>;
    const slug = typeof record.slug === "string" ? record.slug.trim() : "";
    if (!slug) return null;
    if (seenSlugs.has(slug)) continue;

    seenSlugs.add(slug);
    items.push({
      id: typeof record.id === "string" && record.id ? record.id : `backlog-${slug}`,
      slug,
      order: Number.isFinite(Number(record.order)) ? Number(record.order) : index + 1,
    });
  }

  return items.sort((a, b) => a.order - b.order);
}

/** Retorna null enquanto a fila nunca foi salva, para diferenciar de uma fila vazia. */
export async function readBacklogQueue(): Promise<BacklogQueueItem[] | null> {
  const client = createAdminSupabaseClient();
  const { data, error } = await client.storage.from(BUCKET).download(QUEUE_PATH);

  if (error) {
    const status = (error as { status?: number; statusCode?: string }).status;
    if (status === 400 || status === 404) return null;
    throw error;
  }

  return normalizeBacklogQueue(JSON.parse(await data.text()));
}

export async function writeBacklogQueue(items: BacklogQueueItem[]) {
  const client = createAdminSupabaseClient();
  const file = new Blob([JSON.stringify(items)], { type: "application/json" });
  const { error } = await client.storage.from(BUCKET).upload(QUEUE_PATH, file, {
    contentType: "application/json",
    upsert: true,
    cacheControl: "0",
  });

  if (error) throw error;
}

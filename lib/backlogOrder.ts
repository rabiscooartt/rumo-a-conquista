import "server-only";

import type { createAdminSupabaseClient } from "@/lib/supabase-admin";

const MISSING_COLUMN_CODE = "42703";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

/** Enquanto a migração não for aplicada, a fila fica vazia em vez de derrubar o catálogo. */
export async function loadBacklogOrders(client: AdminClient) {
  const { data, error } = await client
    .from("games")
    .select("slug, backlog_order")
    .not("backlog_order", "is", null);

  if (error) {
    if (error.code === MISSING_COLUMN_CODE) return new Map<string, number>();
    throw error;
  }

  return new Map<string, number>(
    (data ?? []).map((game) => [game.slug as string, game.backlog_order as number])
  );
}

export function readBacklogPosition(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

export async function saveBacklogPosition(client: AdminClient, slug: string, position: number) {
  const { error } = await client.rpc("set_game_backlog_position", {
    p_slug: slug,
    p_position: position,
  });

  if (error) throw error;
}

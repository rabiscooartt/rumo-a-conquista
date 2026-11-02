import "server-only";

import type { createAdminSupabaseClient } from "@/lib/supabase-admin";

const MISSING_COLUMN_CODE = "42703";
const MISSING_FUNCTION_CODE = "PGRST202";

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

/** Grava o jogo e sua posição em uma única transação no banco: ou tudo é salvo, ou nada muda. */
export async function saveGameWithBacklogPosition(
  client: AdminClient,
  game: Record<string, unknown>,
  position: number
) {
  const { error } = await client.rpc("save_game_with_backlog_position", {
    p_game: game,
    p_position: position,
  });

  if (error?.code === MISSING_FUNCTION_CODE) {
    throw new Error("A fila ainda não está disponível no banco. Nada foi salvo.");
  }
  if (error) throw error;
}

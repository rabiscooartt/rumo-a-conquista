import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import type { AchievementRow, AchievementSyncStore, ProgressRow } from "@/lib/agentSync/achievementUnlock";

const OWNER_KEY = "default";
const COLUMNS = "id, legacy_id, title, game_slug";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Implementação real sobre as tabelas existentes (service-role só no servidor). */
export function supabaseAchievementSyncStore(): AchievementSyncStore {
  const client = createAdminSupabaseClient();

  const rows = async (query: PromiseLike<{ data: unknown; error: unknown }>) => {
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as AchievementRow[];
  };

  return {
    async gameExists(slug) {
      const { data, error } = await client.from("games").select("slug, is_deleted").eq("slug", slug).maybeSingle();
      if (error) throw error;
      return Boolean(data) && (data as { is_deleted?: boolean }).is_deleted !== true;
    },
    async findBySiteId(slug, id) {
      const byLegacy = await rows(client.from("achievements").select(COLUMNS).eq("game_slug", slug).eq("legacy_id", id));
      if (byLegacy.length || !UUID.test(id)) return byLegacy;
      return rows(client.from("achievements").select(COLUMNS).eq("game_slug", slug).eq("id", id));
    },
    async findSiteIdElsewhere(id) {
      const byLegacy = await rows(client.from("achievements").select(COLUMNS).eq("legacy_id", id).limit(5));
      if (byLegacy.length || !UUID.test(id)) return byLegacy;
      return rows(client.from("achievements").select(COLUMNS).eq("id", id).limit(5));
    },
    findByExternal(slug, source, externalId) {
      return rows(client.from("achievements").select(COLUMNS).eq("game_slug", slug).eq("source", source).eq("external_id", externalId));
    },
    findExternalElsewhere(source, externalId) {
      return rows(client.from("achievements").select(COLUMNS).eq("source", source).eq("external_id", externalId).limit(5));
    },
    findCustom(slug) {
      return rows(client.from("achievements").select(COLUMNS).eq("game_slug", slug).eq("is_custom", true));
    },
    async getProgress(achievementId) {
      const { data, error } = await client
        .from("achievement_progress")
        .select("status, earned_at")
        .eq("owner_key", OWNER_KEY)
        .eq("achievement_id", achievementId)
        .maybeSingle();
      if (error) throw error;
      return (data as ProgressRow | null) ?? null;
    },
    async completeProgress(achievementId, earnedAt, hadRow) {
      if (hadRow) {
        // Condição no próprio UPDATE: nunca sobrescreve uma conclusão (nem a data) já gravada.
        const { data, error } = await client
          .from("achievement_progress")
          .update({ status: "completed", earned_at: earnedAt })
          .eq("owner_key", OWNER_KEY)
          .eq("achievement_id", achievementId)
          .neq("status", "completed")
          .select("achievement_id");
        if (error) throw error;
        return Boolean(data?.length);
      }
      const { error } = await client
        .from("achievement_progress")
        .insert({ achievement_id: achievementId, owner_key: OWNER_KEY, status: "completed", earned_at: earnedAt });
      if (error) {
        // 23505: outra gravação criou a linha entre a leitura e a inserção.
        if ((error as { code?: string }).code === "23505") return false;
        throw error;
      }
      return true;
    },
  };
}

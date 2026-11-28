// Banco simulado em memória para o endpoint do agente (mesmas regras das tabelas do site).
import { randomUUID } from "node:crypto";
import type { AchievementRow, AchievementSyncStore, ProgressRow } from "../../lib/agentSync/achievementUnlock.ts";

export type MemoryDb = {
  games: { slug: string; is_deleted?: boolean }[];
  achievements: (AchievementRow & { source: string | null; external_id: string | null; is_custom?: boolean })[];
  progress: Map<string, ProgressRow>;
};

export function memoryStore(db: MemoryDb, hooks: { failOn?: string; loseRace?: boolean } = {}): AchievementSyncStore & { writes: number } {
  const pick = ({ id, legacy_id, title, game_slug }: AchievementRow) => ({ id, legacy_id, title, game_slug });
  const guard = (op: string) => {
    if (hooks.failOn === op) throw new Error(`falha simulada em ${op}`);
  };
  const store = {
    writes: 0,
    async gameExists(slug: string) {
      guard("gameExists");
      return db.games.some((g) => g.slug === slug && !g.is_deleted);
    },
    async findBySiteId(slug: string, id: string) {
      return db.achievements.filter((a) => a.game_slug === slug && (a.legacy_id === id || a.id === id)).map(pick);
    },
    async findSiteIdElsewhere(id: string) {
      return db.achievements.filter((a) => a.legacy_id === id || a.id === id).map(pick);
    },
    async findByExternal(slug: string, source: string, externalId: string) {
      return db.achievements.filter((a) => a.game_slug === slug && a.source === source && a.external_id === externalId).map(pick);
    },
    async findExternalElsewhere(source: string, externalId: string) {
      return db.achievements.filter((a) => a.source === source && a.external_id === externalId).map(pick);
    },
    async findCustom(slug: string) {
      return db.achievements.filter((a) => a.game_slug === slug && a.is_custom === true).map(pick);
    },
    async getProgress(id: string) {
      guard("getProgress");
      return db.progress.get(id) ?? null;
    },
    async completeProgress(id: string, earnedAt: string | null) {
      guard("completeProgress");
      if (hooks.loseRace) {
        db.progress.set(id, { status: "completed", earned_at: "2026-01-01" });
        return false;
      }
      const current = db.progress.get(id);
      if (current?.status === "completed") return false;
      db.progress.set(id, { status: "completed", earned_at: earnedAt });
      store.writes += 1;
      return true;
    },
  };
  return store;
}

export function sampleDb(): MemoryDb {
  return {
    games: [{ slug: "hollow-knight" }, { slug: "hades" }, { slug: "apagado", is_deleted: true }],
    achievements: [
      { id: randomUUID(), legacy_id: "hk-1", title: "Falso Cavaleiro", game_slug: "hollow-knight", source: "steam", external_id: "FALSE_KNIGHT" },
      { id: randomUUID(), legacy_id: "hk-2", title: "Hornet", game_slug: "hollow-knight", source: "steam", external_id: "HORNET_1" },
      { id: randomUUID(), legacy_id: "hk-custom", title: "Custom", game_slug: "hollow-knight", source: "manual", external_id: null, is_custom: true },
      { id: randomUUID(), legacy_id: "hd-1", title: "Escape", game_slug: "hades", source: "steam", external_id: "ESCAPE" },
      { id: randomUUID(), legacy_id: "hd-2", title: "Dup A", game_slug: "hades", source: "steam", external_id: "DUP" },
      { id: randomUUID(), legacy_id: "hd-3", title: "Dup B", game_slug: "hades", source: "steam", external_id: "DUP" },
    ],
    progress: new Map(),
  };
}

export const TOKEN = "t".repeat(40);

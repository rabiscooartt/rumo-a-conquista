import type { NewEvent } from "../../events/eventStore.ts";
import type { Logger } from "../../logger.ts";
import { transaction, type SqlDatabase } from "../../store/database.ts";
import { ProviderUnavailableError, type AchievementProvider, type ProviderSnapshot } from "./providers/types.ts";

export const ACHIEVEMENT_UNLOCKED = "achievement.unlocked";
/** Tolerância entre o relógio da fonte e o início da sessão ao decidir o que foi conquistado ao vivo. */
const LIVE_TOLERANCE_MS = 60_000;

export type UnlockPayload = {
  /**
   * Como o site vincula: "steam" = achievements.source/external_id; "site" = identificador
   * canônico do próprio site; "custom" = conquista CUSTOM do jogo pelo título exato.
   */
  provider: "steam" | "site" | "custom";
  /** Distingue conquista CUSTOM de oficial quando a origem sabe (manual). */
  isCustom?: boolean;
  /** Imagem publicada pelo site, quando houver. */
  image?: string | null;
  agentProvider: string;
  sourceKey: string;
  gameSlug: string | null;
  externalId: string;
  name: string | null;
  description: string | null;
  unlockedAt: string | null;
  /** "source": horário informado pela fonte; "detected": momento em que o agente percebeu. */
  timestampKind: "source" | "detected";
  detectedAt: string;
  detectedLive: boolean;
  sessionId: string | null;
  evidence: Record<string, unknown>;
};

export type ReadContext = {
  live: boolean;
  sessionId: string | null;
  sessionStartedAt: number | null;
  gameSlug: string | null;
  force?: boolean;
};

export type ReadOutcome = {
  provider: string;
  sourceKey: string;
  skipped?: "unchanged" | "no-data";
  baseline?: boolean;
  total?: number;
  unlocked?: number;
  emitted: string[];
  error?: string;
};

export const unlockDedupeKey = (provider: string, sourceKey: string, externalId: string) =>
  `achievement:${provider}:${sourceKey}:${externalId}`;

/**
 * Detecção por diferença: compara o estado lido de uma fonte com o último estado gravado e gera
 * "achievement.unlocked" só para o que passou de bloqueada para desbloqueada.
 *
 *  - Primeira leitura de uma fonte = linha de base: o histórico antigo NÃO vira evento (não
 *    inunda o site com conquistas de anos atrás). Exceção: o que a fonte data de depois do início
 *    da sessão atual (conquistado ao vivo antes da primeira leitura).
 *  - Leituras seguintes, inclusive após períodos offline: todo novo desbloqueio vira evento.
 *  - Estado gravado e evento entram na mesma transação; a chave de deduplicação é estável
 *    (provedor + fonte + id da conquista), então nenhuma releitura, reinício ou repetição duplica.
 */
export class AchievementWatcher {
  private readonly db: SqlDatabase;
  private readonly record: (event: NewEvent) => { created: boolean; event: { id: string } };
  private readonly log: Logger;
  private readonly now: () => number;

  constructor(options: {
    db: SqlDatabase;
    record: (event: NewEvent) => { created: boolean; event: { id: string } };
    log: Logger;
    now?: () => number;
  }) {
    this.db = options.db;
    this.record = options.record;
    this.log = options.log;
    this.now = options.now ?? Date.now;
  }

  knownSources(): { provider: string; sourceKey: string; lastReadAt: number; lastError: string | null }[] {
    return this.db
      .prepare("SELECT provider, source_key, last_read_at, last_error FROM achievement_sources ORDER BY last_read_at DESC")
      .all()
      .map((row) => ({
        provider: String(row.provider),
        sourceKey: String(row.source_key),
        lastReadAt: Number(row.last_read_at),
        lastError: row.last_error === null ? null : String(row.last_error),
      }));
  }

  sourceSummary(provider: string, sourceKey: string) {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total, SUM(unlocked) AS unlocked, SUM(CASE WHEN event_id IS NOT NULL THEN 1 ELSE 0 END) AS emitted
         FROM achievement_states WHERE provider = ? AND source_key = ?`,
      )
      .get(provider, sourceKey);
    return { total: Number(row?.total ?? 0), unlocked: Number(row?.unlocked ?? 0), emitted: Number(row?.emitted ?? 0) };
  }

  private setSourceError(provider: string, sourceKey: string, message: string) {
    this.db
      .prepare("UPDATE achievement_sources SET last_error = ?, last_read_at = ? WHERE provider = ? AND source_key = ?")
      .run(message, this.now(), provider, sourceKey);
  }

  async read(provider: AchievementProvider, sourceKey: string, context: ReadContext): Promise<ReadOutcome> {
    const base: ReadOutcome = { provider: provider.id, sourceKey, emitted: [] };
    const source = this.db
      .prepare("SELECT baseline_at, last_fingerprint FROM achievement_sources WHERE provider = ? AND source_key = ?")
      .get(provider.id, sourceKey);
    let snapshot: ProviderSnapshot | null;
    let fingerprint: string | null;
    try {
      fingerprint = await provider.fingerprint(sourceKey);
      if (!context.force && source && fingerprint && fingerprint === source.last_fingerprint) return { ...base, skipped: "unchanged" };
      snapshot = await provider.read(sourceKey);
    } catch (error) {
      const message = (error as Error).message;
      if (source) this.setSourceError(provider.id, sourceKey, message);
      if (error instanceof ProviderUnavailableError) {
        this.log.warn("Fonte de conquistas indisponível; nova leitura depois", { provider: provider.id, sourceKey, error: message });
        return { ...base, error: message };
      }
      throw error;
    }
    if (!snapshot) return { ...base, skipped: "no-data" };

    const now = this.now();
    const baseline = !source;
    const emitted: string[] = [];
    transaction(this.db, () => {
      const select = this.db.prepare(
        "SELECT unlocked FROM achievement_states WHERE provider = ? AND source_key = ? AND external_id = ?",
      );
      const upsert = this.db.prepare(
        `INSERT INTO achievement_states (provider, source_key, external_id, name, unlocked, unlocked_at, first_seen_at, updated_at, event_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (provider, source_key, external_id) DO UPDATE SET
           name = excluded.name, unlocked = excluded.unlocked,
           unlocked_at = COALESCE(excluded.unlocked_at, achievement_states.unlocked_at),
           updated_at = excluded.updated_at,
           event_id = COALESCE(achievement_states.event_id, excluded.event_id)`,
      );
      for (const achievement of snapshot!.achievements) {
        const previous = select.get(provider.id, sourceKey, achievement.externalId);
        const newlyUnlocked = achievement.unlocked && Number(previous?.unlocked ?? 0) !== 1;
        let eventId: string | null = null;
        if (newlyUnlocked) {
          const liveBeforeFirstRead =
            context.live &&
            context.sessionStartedAt !== null &&
            achievement.unlockedAt !== null &&
            achievement.unlockedAt >= context.sessionStartedAt - LIVE_TOLERANCE_MS;
          if (!baseline || liveBeforeFirstRead) {
            const payload: UnlockPayload = {
              provider: provider.siteProvider,
              agentProvider: provider.id,
              sourceKey,
              gameSlug: context.gameSlug,
              externalId: achievement.externalId,
              name: achievement.name,
              description: achievement.description,
              unlockedAt: new Date(achievement.unlockedAt ?? now).toISOString(),
              timestampKind: achievement.unlockedAt !== null ? "source" : "detected",
              detectedAt: new Date(now).toISOString(),
              detectedLive: context.live,
              sessionId: context.sessionId,
              evidence: { ...snapshot!.evidence, ...(achievement.evidence ?? {}) },
            };
            const result = this.record({
              type: ACHIEVEMENT_UNLOCKED,
              dedupeKey: unlockDedupeKey(provider.id, sourceKey, achievement.externalId),
              occurredAt: achievement.unlockedAt ?? now,
              source: provider.id,
              payload,
            });
            eventId = result.event.id;
            if (result.created) emitted.push(achievement.externalId);
          }
        }
        upsert.run(
          provider.id,
          sourceKey,
          achievement.externalId,
          achievement.name,
          achievement.unlocked ? 1 : 0,
          achievement.unlockedAt,
          now,
          now,
          eventId,
        );
      }
      this.db
        .prepare(
          `INSERT INTO achievement_sources (provider, source_key, baseline_at, last_read_at, last_fingerprint, last_error)
           VALUES (?, ?, ?, ?, ?, NULL)
           ON CONFLICT (provider, source_key) DO UPDATE SET last_read_at = excluded.last_read_at,
             last_fingerprint = excluded.last_fingerprint, last_error = NULL`,
        )
        .run(provider.id, sourceKey, now, now, fingerprint);
    });

    const unlockedCount = snapshot.achievements.filter((a) => a.unlocked).length;
    if (baseline) {
      this.log.info("Linha de base de conquistas registrada", {
        provider: provider.id,
        sourceKey,
        total: snapshot.achievements.length,
        desbloqueadas: unlockedCount,
        aoVivo: emitted.length,
      });
    }
    for (const externalId of emitted) this.log.info("Conquista desbloqueada detectada", { provider: provider.id, sourceKey, externalId });
    return { ...base, baseline, total: snapshot.achievements.length, unlocked: unlockedCount, emitted };
  }
}

import type { SqlDatabase } from "../../store/database.ts";

export type GameMapping = {
  detectionKey: string;
  slug: string | null;
  title: string | null;
  ignored: boolean;
  origin: "manual" | "auto";
  updatedAt: number;
};

export type GameSession = {
  id: string;
  identity: string;
  detectionKey: string;
  source: string;
  slug: string | null;
  title: string;
  startedAt: number;
  lastSeenAt: number;
  endedAt: number | null;
  endReason: string | null;
  detail: Record<string, unknown>;
  /** Jogo escolhido manualmente para esta sessão; tem precedência sobre a detecção. */
  manualSlug?: string | null;
  correctedAt?: number | null;
};

const toMapping = (row: Record<string, unknown>): GameMapping => ({
  detectionKey: String(row.detection_key),
  slug: row.slug === null ? null : String(row.slug),
  title: row.title === null ? null : String(row.title),
  ignored: Number(row.ignored) === 1,
  origin: String(row.origin) as GameMapping["origin"],
  updatedAt: Number(row.updated_at),
});

const toSession = (row: Record<string, unknown>): GameSession => ({
  id: String(row.id),
  identity: String(row.identity),
  detectionKey: String(row.detection_key),
  source: String(row.source),
  slug: row.slug === null ? null : String(row.slug),
  title: String(row.title),
  startedAt: Number(row.started_at),
  lastSeenAt: Number(row.last_seen_at),
  endedAt: row.ended_at === null ? null : Number(row.ended_at),
  endReason: row.end_reason === null ? null : String(row.end_reason),
  detail: JSON.parse(String(row.detail ?? "{}")) as Record<string, unknown>,
  manualSlug: row.manual_slug === null || row.manual_slug === undefined ? null : String(row.manual_slug),
  correctedAt: row.corrected_at === null || row.corrected_at === undefined ? null : Number(row.corrected_at),
});

/** Persistência local de mapeamentos e sessões (usada pelo módulo e pelo CLI com o agente parado). */
export class GameRepository {
  readonly db: SqlDatabase;
  private readonly now: () => number;

  constructor(db: SqlDatabase, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
  }

  mapping(key: string): GameMapping | null {
    const row = this.db.prepare("SELECT * FROM game_mappings WHERE detection_key = ?").get(key);
    return row ? toMapping(row) : null;
  }

  mappings(): GameMapping[] {
    return this.db.prepare("SELECT * FROM game_mappings ORDER BY detection_key").all().map(toMapping);
  }

  setMapping(input: { detectionKey: string; slug: string | null; title: string | null; ignored?: boolean; origin: GameMapping["origin"] }) {
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO game_mappings (detection_key, slug, title, ignored, origin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (detection_key) DO UPDATE SET slug = excluded.slug, title = excluded.title,
           ignored = excluded.ignored, origin = excluded.origin, updated_at = excluded.updated_at`,
      )
      .run(input.detectionKey, input.slug, input.title, input.ignored ? 1 : 0, input.origin, now, now);
  }

  deleteMapping(key: string) {
    return Number(this.db.prepare("DELETE FROM game_mappings WHERE detection_key = ?").run(key).changes) === 1;
  }

  openSession(): GameSession | null {
    const row = this.db.prepare("SELECT * FROM game_sessions WHERE ended_at IS NULL").get();
    return row ? toSession(row) : null;
  }

  insertSession(session: GameSession) {
    this.db
      .prepare(
        `INSERT INTO game_sessions (id, identity, detection_key, source, slug, title, started_at, last_seen_at, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.identity,
        session.detectionKey,
        session.source,
        session.slug,
        session.title,
        session.startedAt,
        session.lastSeenAt,
        JSON.stringify(session.detail),
      );
  }

  touchSession(id: string, lastSeenAt: number) {
    this.db.prepare("UPDATE game_sessions SET last_seen_at = ? WHERE id = ? AND ended_at IS NULL").run(lastSeenAt, id);
  }

  reclassifySession(id: string, patch: { identity: string; slug: string | null; title: string }) {
    this.db
      .prepare("UPDATE game_sessions SET identity = ?, slug = ?, title = ? WHERE id = ? AND ended_at IS NULL")
      .run(patch.identity, patch.slug, patch.title, id);
  }

  /** Correção manual da sessão aberta (nunca de sessões encerradas). */
  correctSession(id: string, patch: { identity: string; slug: string; title: string; detail: Record<string, unknown>; at: number }) {
    const changes = this.db
      .prepare(
        `UPDATE game_sessions SET identity = ?, slug = ?, title = ?, manual_slug = ?, corrected_at = ?, detail = ?
         WHERE id = ? AND ended_at IS NULL`,
      )
      .run(patch.identity, patch.slug, patch.title, patch.slug, patch.at, JSON.stringify(patch.detail), id).changes;
    return Number(changes) === 1;
  }

  closeSession(id: string, endedAt: number, reason: string) {
    this.db
      .prepare("UPDATE game_sessions SET ended_at = ?, last_seen_at = MAX(last_seen_at, ?), end_reason = ? WHERE id = ? AND ended_at IS NULL")
      .run(endedAt, endedAt, reason, id);
  }

  session(id: string): GameSession | null {
    const row = this.db.prepare("SELECT * FROM game_sessions WHERE id = ?").get(id);
    return row ? toSession(row) : null;
  }

  sessions(limit = 20): GameSession[] {
    const safe = Math.min(Math.max(1, Math.trunc(limit)), 500);
    return this.db.prepare(`SELECT * FROM game_sessions ORDER BY started_at DESC LIMIT ${safe}`).all().map(toSession);
  }
}

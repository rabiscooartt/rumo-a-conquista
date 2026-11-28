import { randomUUID } from "node:crypto";
import { transaction, type SqlDatabase } from "../../store/database.ts";

/*
 * Fila persistente de clips, separada da fila de alertas (o clip nunca espera a apresentação).
 *
 *   pending ──due_at──▶ saving ──arquivo movido──▶ completed
 *      ▲                  │
 *      └──retry (dentro da janela do buffer)──┤
 *                         ├─falha definitiva / sem buffer / sem espaço──▶ failed
 *                         └─o momento já saiu do buffer──────────────────▶ expired
 */
export const CLIP_STATUSES = ["pending", "saving", "completed", "failed", "expired"] as const;
export type ClipStatus = (typeof CLIP_STATUSES)[number];

export type Clip = {
  seq: number;
  id: string;
  dedupeKey: string;
  sourceEventId: string | null;
  kind: string;
  gameSlug: string | null;
  title: string | null;
  payload: Record<string, unknown>;
  isTest: boolean;
  status: ClipStatus;
  eventAt: number;
  dueAt: number;
  attempts: number;
  obsPath: string | null;
  filePath: string | null;
  sizeBytes: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type NewClip = {
  kind: string;
  dedupeKey: string;
  sourceEventId?: string | null;
  gameSlug?: string | null;
  title?: string | null;
  payload: Record<string, unknown>;
  isTest?: boolean;
  eventAt: number;
  dueAt: number;
};

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function toClip(row: Record<string, unknown>): Clip {
  return {
    seq: Number(row.seq),
    id: String(row.id),
    dedupeKey: String(row.dedupe_key),
    sourceEventId: str(row.source_event_id),
    kind: String(row.kind),
    gameSlug: str(row.game_slug),
    title: str(row.title),
    payload: JSON.parse(String(row.payload)) as Record<string, unknown>,
    isTest: Number(row.is_test) === 1,
    status: String(row.status) as ClipStatus,
    eventAt: Number(row.event_at),
    dueAt: Number(row.due_at),
    attempts: Number(row.attempts),
    obsPath: str(row.obs_path),
    filePath: str(row.file_path),
    sizeBytes: num(row.size_bytes),
    lastError: str(row.last_error),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    completedAt: num(row.completed_at),
  };
}

export class ClipStore {
  private readonly db: SqlDatabase;
  private readonly now: () => number;

  constructor(db: SqlDatabase, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
  }

  /** Idempotente pela dedupeKey: o mesmo evento nunca gera dois clips. */
  insert(input: NewClip): { clip: Clip; created: boolean } {
    const now = this.now();
    return transaction(this.db, () => {
      const existing = this.db.prepare("SELECT * FROM clips WHERE dedupe_key = ?").get(input.dedupeKey);
      if (existing) return { clip: toClip(existing), created: false };
      const id = randomUUID();
      this.db
        .prepare(
          `INSERT INTO clips (id, dedupe_key, source_event_id, kind, game_slug, title, payload, is_test, status, event_at, due_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
        )
        .run(id, input.dedupeKey, input.sourceEventId ?? null, input.kind, input.gameSlug ?? null, input.title ?? null, JSON.stringify(input.payload), input.isTest ? 1 : 0, input.eventAt, input.dueAt, now, now);
      return { clip: this.get(id)!, created: true };
    });
  }

  get(id: string): Clip | null {
    const row = this.db.prepare("SELECT * FROM clips WHERE id = ?").get(id);
    return row ? toClip(row) : null;
  }

  bySourceEvent(eventId: string): Clip | null {
    const row = this.db.prepare("SELECT * FROM clips WHERE source_event_id = ? ORDER BY seq LIMIT 1").get(eventId);
    return row ? toClip(row) : null;
  }

  mergePayload(id: string, extra: Record<string, unknown>) {
    const clip = this.get(id);
    if (!clip) return;
    this.db.prepare("UPDATE clips SET payload = ?, updated_at = ? WHERE id = ?").run(JSON.stringify({ ...clip.payload, ...extra }), this.now(), id);
  }

  /** Reserva o próximo clip vencido (um por vez: o OBS salva um replay de cada vez). */
  claimDue(): Clip | null {
    const now = this.now();
    return transaction(this.db, () => {
      if (this.db.prepare("SELECT 1 FROM clips WHERE status = 'saving' LIMIT 1").get()) return null;
      const row = this.db.prepare("SELECT id FROM clips WHERE status = 'pending' AND due_at <= ? ORDER BY due_at, seq LIMIT 1").get(now);
      if (!row) return null;
      this.db.prepare("UPDATE clips SET status = 'saving', attempts = attempts + 1, updated_at = ? WHERE id = ?").run(now, String(row.id));
      return this.get(String(row.id));
    });
  }

  /** O OBS já gravou o replay: guardado antes de mover, para retomar sem salvar de novo. */
  setObsPath(id: string, obsPath: string) {
    this.db.prepare("UPDATE clips SET obs_path = ?, updated_at = ? WHERE id = ? AND status = 'saving'").run(obsPath, this.now(), id);
  }

  complete(id: string, filePath: string, sizeBytes: number) {
    const now = this.now();
    return Number(
      this.db
        .prepare("UPDATE clips SET status = 'completed', file_path = ?, size_bytes = ?, last_error = NULL, completed_at = ?, updated_at = ? WHERE id = ? AND status = 'saving'")
        .run(filePath, sizeBytes, now, now, id).changes,
    ) === 1;
  }

  /** Nova tentativa mais tarde (ex.: OBS desconectado), ainda dentro da janela do buffer. */
  retry(id: string, message: string, dueAt: number) {
    this.db.prepare("UPDATE clips SET status = 'pending', due_at = ?, last_error = ?, updated_at = ? WHERE id = ? AND status = 'saving'").run(dueAt, message.slice(0, 2000), this.now(), id);
  }

  finish(id: string, status: "failed" | "expired", message: string) {
    this.db.prepare("UPDATE clips SET status = ?, last_error = ?, updated_at = ? WHERE id = ? AND status IN ('pending','saving')").run(status, message.slice(0, 2000), this.now(), id);
  }

  /** Clips em "saving" quando o agente caiu. */
  interrupted(): Clip[] {
    return this.db.prepare("SELECT * FROM clips WHERE status = 'saving'").all().map(toClip);
  }

  pending(): Clip[] {
    return this.db.prepare("SELECT * FROM clips WHERE status = 'pending' ORDER BY due_at").all().map(toClip);
  }

  list(limit = 20): Clip[] {
    const n = Math.min(Math.max(1, Math.trunc(limit)), 500);
    return this.db.prepare(`SELECT * FROM clips ORDER BY seq DESC LIMIT ${n}`).all().map(toClip);
  }

  /** Contagens reais (testes fora). */
  counts(): Record<ClipStatus, number> {
    const out = Object.fromEntries(CLIP_STATUSES.map((s) => [s, 0])) as Record<ClipStatus, number>;
    for (const row of this.db.prepare("SELECT status, COUNT(*) AS n FROM clips WHERE is_test = 0 GROUP BY status").all()) {
      out[String(row.status) as ClipStatus] = Number(row.n);
    }
    return out;
  }

  lastCompleted(): Clip | null {
    const row = this.db.prepare("SELECT * FROM clips WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1").get();
    return row ? toClip(row) : null;
  }
}

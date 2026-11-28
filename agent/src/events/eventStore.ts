import { randomUUID } from "node:crypto";
import { transaction, type SqlDatabase, type SqlValue } from "../store/database.ts";

/*
 * Ciclo de vida de um evento:
 *
 *   pending ──claim──▶ processing ──ok──▶ completed
 *      ▲                    │
 *      │                    ├─erro (tentativas restantes)──▶ retry_wait ──(prazo)──▶ processing
 *      │                    ├─adiado (ex.: site offline)───▶ retry_wait (não consome tentativa)
 *      │                    └─erro permanente / esgotado──▶ failed
 *      └──────── requeue (manual) ◀─────────────────────────────┘
 *
 * Um evento em "processing" quando o agente cai é devolvido para retry_wait na
 * próxima inicialização (recoverInterrupted). A tentativa interrompida conta,
 * para que um evento que derruba o agente não entre em ciclo infinito.
 */
export const EVENT_STATUSES = ["pending", "processing", "retry_wait", "completed", "failed"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export type AgentEvent = {
  seq: number;
  id: string;
  dedupeKey: string;
  type: string;
  source: string;
  payload: unknown;
  isTest: boolean;
  status: EventStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: number;
  lockedAt: number | null;
  lastError: string | null;
  result: unknown;
  occurredAt: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type EventAttempt = {
  attempt: number;
  startedAt: number;
  finishedAt: number | null;
  outcome: "running" | "completed" | "retry" | "deferred" | "failed" | "interrupted";
  error: string | null;
};

export type NewEvent = {
  type: string;
  payload?: unknown;
  /** Quem gerou o evento (ex.: "steam", "obs", "cli"). */
  source?: string;
  /**
   * Chave natural do fato. Dois registros com a mesma chave são o mesmo evento
   * (ex.: "achievement:steam:440:TF_PLAY_GAME_EVERYCLASS"). Sem chave, vale o id.
   */
  dedupeKey?: string;
  /** Eventos de teste passam pelo mesmo mecanismo, mas módulos não os contam como progresso real. */
  isTest?: boolean;
  occurredAt?: number;
  maxAttempts?: number;
  id?: string;
};

export type RecordResult = { event: AgentEvent; created: boolean };

export type FailureInput = {
  message: string;
  /** Erro que não melhora com nova tentativa: vai direto para failed. */
  permanent?: boolean;
  /** Reagendar sem consumir tentativa (dependência externa indisponível). */
  deferMs?: number;
};

export type EventStats = {
  total: number;
  byStatus: Record<EventStatus, number>;
  backlogByType: Record<string, number>;
  oldestBacklogAt: number | null;
};

export class EventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventValidationError";
  }
}

export const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
export const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_ERROR_CHARS = 2_000;
const BACKLOG = "('pending','retry_wait','processing')";

export type EventStoreOptions = {
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  now?: () => number;
};

export function retryDelayMs(attempt: number, baseMs: number, maxMs: number) {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

function parseJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(String(value));
  } catch {
    return String(value);
  }
}

function toEvent(row: Record<string, unknown>): AgentEvent {
  const nullableNumber = (value: unknown) => (value === null || value === undefined ? null : Number(value));
  return {
    seq: Number(row.seq),
    id: String(row.id),
    dedupeKey: String(row.dedupe_key),
    type: String(row.type),
    source: String(row.source),
    payload: parseJson(row.payload),
    isTest: Number(row.is_test) === 1,
    status: String(row.status) as EventStatus,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    nextAttemptAt: Number(row.next_attempt_at),
    lockedAt: nullableNumber(row.locked_at),
    lastError: row.last_error === null ? null : String(row.last_error),
    result: parseJson(row.result),
    occurredAt: Number(row.occurred_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    completedAt: nullableNumber(row.completed_at),
  };
}

export class EventStore {
  private readonly db: SqlDatabase;
  private readonly options: Required<EventStoreOptions>;

  constructor(db: SqlDatabase, options: EventStoreOptions) {
    this.db = db;
    this.options = { now: Date.now, ...options };
  }

  private now() {
    return this.options.now();
  }

  /** Persiste o evento (idempotente pela dedupeKey) antes de qualquer processamento. */
  record(input: NewEvent): RecordResult {
    if (!input || typeof input.type !== "string" || !EVENT_TYPE_PATTERN.test(input.type)) {
      throw new EventValidationError(
        `Tipo de evento inválido: ${JSON.stringify(input?.type)} (use minúsculas separadas por ponto, ex.: "achievement.unlocked")`,
      );
    }
    const payload = JSON.stringify(input.payload ?? {});
    if (Buffer.byteLength(payload, "utf8") > MAX_PAYLOAD_BYTES) {
      throw new EventValidationError(`Payload acima de ${MAX_PAYLOAD_BYTES} bytes`);
    }
    const id = input.id?.trim() || randomUUID();
    const dedupeKey = input.dedupeKey?.trim() || `id:${id}`;
    if (dedupeKey.length > 500) throw new EventValidationError("dedupeKey acima de 500 caracteres");
    const maxAttempts = input.maxAttempts ?? this.options.maxAttempts;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new EventValidationError("maxAttempts inválido");
    const now = this.now();
    const occurredAt = Number.isFinite(input.occurredAt) ? Number(input.occurredAt) : now;

    return transaction(this.db, () => {
      const existing =
        this.db.prepare("SELECT * FROM events WHERE dedupe_key = ?").get(dedupeKey) ??
        this.db.prepare("SELECT * FROM events WHERE id = ?").get(id);
      if (existing) return { event: toEvent(existing), created: false };

      this.db
        .prepare(
          `INSERT INTO events (id, dedupe_key, type, source, payload, is_test, status, attempts, max_attempts,
             next_attempt_at, occurred_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?)`,
        )
        .run(id, dedupeKey, input.type, input.source?.trim() || "agent", payload, input.isTest ? 1 : 0, maxAttempts, now, occurredAt, now, now);
      return { event: this.mustGet(id), created: true };
    });
  }

  get(id: string): AgentEvent | null {
    const row = this.db.prepare("SELECT * FROM events WHERE id = ?").get(id);
    return row ? toEvent(row) : null;
  }

  private mustGet(id: string) {
    const event = this.get(id);
    if (!event) throw new Error(`Evento ${id} não encontrado`);
    return event;
  }

  attempts(id: string): EventAttempt[] {
    return this.db
      .prepare("SELECT attempt, started_at, finished_at, outcome, error FROM event_attempts WHERE event_id = ? ORDER BY id")
      .all(id)
      .map((row) => ({
        attempt: Number(row.attempt),
        startedAt: Number(row.started_at),
        finishedAt: row.finished_at === null ? null : Number(row.finished_at),
        outcome: String(row.outcome) as EventAttempt["outcome"],
        error: row.error === null ? null : String(row.error),
      }));
  }

  /** Reserva o próximo evento vencido de um dos tipos com handler, em ordem de chegada. */
  claimNext(types: readonly string[]): AgentEvent | null {
    if (!types.length) return null;
    const now = this.now();
    return transaction(this.db, () => {
      const placeholders = types.map(() => "?").join(",");
      const row = this.db
        .prepare(
          `SELECT id FROM events
           WHERE status IN ('pending','retry_wait') AND next_attempt_at <= ? AND type IN (${placeholders})
           ORDER BY seq LIMIT 1`,
        )
        .get(now, ...types);
      if (!row) return null;
      const id = String(row.id);
      this.db
        .prepare(
          `UPDATE events SET status = 'processing', attempts = attempts + 1, locked_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(now, now, id);
      const event = this.mustGet(id);
      this.db
        .prepare("INSERT INTO event_attempts (event_id, attempt, started_at, outcome) VALUES (?, ?, ?, 'running')")
        .run(id, event.attempts, now);
      return event;
    });
  }

  private closeAttempt(id: string, outcome: EventAttempt["outcome"], error: string | null, now: number) {
    this.db
      .prepare(
        `UPDATE event_attempts SET finished_at = ?, outcome = ?, error = ?
         WHERE id = (SELECT MAX(id) FROM event_attempts WHERE event_id = ?) AND outcome = 'running'`,
      )
      .run(now, outcome, error, id);
  }

  /** Conclui a tentativa em andamento. Retorna false se o evento não estava mais reservado nesta tentativa. */
  complete(id: string, attempt: number, result?: unknown): boolean {
    const now = this.now();
    return transaction(this.db, () => {
      const changes = this.db
        .prepare(
          `UPDATE events SET status = 'completed', result = ?, last_error = NULL, locked_at = NULL,
             completed_at = ?, updated_at = ?
           WHERE id = ? AND status = 'processing' AND attempts = ?`,
        )
        .run(result === undefined ? null : JSON.stringify(result), now, now, id, attempt).changes;
      if (Number(changes) !== 1) return false;
      this.closeAttempt(id, "completed", null, now);
      return true;
    });
  }

  /** Registra a falha da tentativa e decide: nova tentativa, adiamento ou falha definitiva. */
  fail(id: string, attempt: number, failure: FailureInput): EventStatus | null {
    const now = this.now();
    const message = (failure.message || "Erro sem mensagem").slice(0, MAX_ERROR_CHARS);
    return transaction(this.db, () => {
      const row = this.db.prepare("SELECT * FROM events WHERE id = ? AND status = 'processing' AND attempts = ?").get(id, attempt);
      if (!row) return null;
      const event = toEvent(row);
      let status: EventStatus;
      let attempts = event.attempts;
      let next = now;
      let outcome: EventAttempt["outcome"];
      if (failure.deferMs !== undefined && !failure.permanent) {
        status = "retry_wait";
        attempts -= 1;
        next = now + Math.max(0, failure.deferMs);
        outcome = "deferred";
      } else if (failure.permanent || event.attempts >= event.maxAttempts) {
        status = "failed";
        outcome = "failed";
      } else {
        status = "retry_wait";
        next = now + retryDelayMs(event.attempts, this.options.retryBaseMs, this.options.retryMaxMs);
        outcome = "retry";
      }
      this.db
        .prepare(
          `UPDATE events SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ?, locked_at = NULL, updated_at = ?
           WHERE id = ?`,
        )
        .run(status, attempts, next, message, now, id);
      this.closeAttempt(id, outcome, message, now);
      return status;
    });
  }

  /** Devolve à fila eventos que ficaram em "processing" por encerramento inesperado. */
  recoverInterrupted(): { recovered: number; failed: number } {
    const now = this.now();
    const reason = "Processamento interrompido por encerramento inesperado do agente";
    return transaction(this.db, () => {
      const rows = this.db.prepare("SELECT * FROM events WHERE status = 'processing'").all().map(toEvent);
      let recovered = 0;
      let failed = 0;
      for (const event of rows) {
        const exhausted = event.attempts >= event.maxAttempts;
        this.db
          .prepare(
            `UPDATE events SET status = ?, next_attempt_at = ?, locked_at = NULL, last_error = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(exhausted ? "failed" : "retry_wait", now, reason, now, event.id);
        this.closeAttempt(event.id, "interrupted", reason, now);
        if (exhausted) failed += 1;
        else recovered += 1;
      }
      return { recovered, failed };
    });
  }

  /** Reenfileira manualmente um evento que falhou definitivamente. */
  requeue(id: string): boolean {
    const now = this.now();
    const changes = this.db
      .prepare(
        `UPDATE events SET status = 'pending', attempts = 0, next_attempt_at = ?, locked_at = NULL, updated_at = ?
         WHERE id = ? AND status = 'failed'`,
      )
      .run(now, now, id).changes;
    return Number(changes) === 1;
  }

  list(filter: { status?: EventStatus; type?: string; limit?: number } = {}): AgentEvent[] {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (filter.status) {
      where.push("status = ?");
      params.push(filter.status);
    }
    if (filter.type) {
      where.push("type = ?");
      params.push(filter.type);
    }
    const limit = Math.min(Math.max(1, Math.trunc(filter.limit ?? 50)), 500);
    const sql = `SELECT * FROM events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY seq DESC LIMIT ${limit}`;
    return this.db.prepare(sql).all(...params).map(toEvent);
  }

  stats(): EventStats {
    const byStatus = Object.fromEntries(EVENT_STATUSES.map((status) => [status, 0])) as Record<EventStatus, number>;
    let total = 0;
    for (const row of this.db.prepare("SELECT status, COUNT(*) AS n FROM events GROUP BY status").all()) {
      byStatus[String(row.status) as EventStatus] = Number(row.n);
      total += Number(row.n);
    }
    const backlogByType: Record<string, number> = {};
    for (const row of this.db.prepare(`SELECT type, COUNT(*) AS n FROM events WHERE status IN ${BACKLOG} GROUP BY type`).all()) {
      backlogByType[String(row.type)] = Number(row.n);
    }
    const oldest = this.db.prepare(`SELECT MIN(created_at) AS t FROM events WHERE status IN ${BACKLOG}`).get()?.t;
    return { total, byStatus, backlogByType, oldestBacklogAt: oldest === null || oldest === undefined ? null : Number(oldest) };
  }
}

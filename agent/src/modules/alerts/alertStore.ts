import { randomUUID } from "node:crypto";
import { retryDelayMs } from "../../events/eventStore.ts";
import { transaction, type SqlDatabase, type SqlValue } from "../../store/database.ts";

/*
 * Fila persistente de alertas. O alerta é uma entidade própria (o que apresentar), separada do
 * evento que o originou (o que aconteceu); a ligação fica em source_event_id.
 *
 *   pending ──claim──▶ processing ──apresentado──▶ completed
 *      ▲                   │
 *      │                   ├─erro (tentativas restantes)──▶ retry_wait ──(prazo)──▶ processing
 *      │                   ├─apresentador indisponível────▶ retry_wait (sem gastar tentativa)
 *      │                   └─erro definitivo / esgotado───▶ failed
 *      │   pending/retry_wait vencidos (expires_at) ─────────▶ expired
 *      └──────── requeue (manual) ◀── failed | expired
 *
 * Ordem: maior prioridade primeiro e, dentro dela, ordem de chegada (seq).
 * Um alerta só é concluído pela tentativa que o reservou (attempts confere), nunca antes.
 *
 * Sequência protegida (Fase 4.5): enquanto um alerta com prioridade >= PROTECTED_PRIORITY
 * (Maestria) espera — inclusive em retry_wait, aguardando o prazo da próxima tentativa —,
 * nenhum alerta comum é reservado. A apresentação em curso nunca é interrompida (um por vez);
 * a protegida entra logo depois dela e os comuns só voltam quando ela termina (concluída,
 * falha definitiva ou expirada). Tentativas limitadas: a fila nunca fica presa para sempre.
 * Exceção: a conquista que disparou a Maestria (payload.triggerEventId), se ainda espera,
 * abre a sequência e aparece antes dela.
 */
export const PROTECTED_PRIORITY = 100;
export const ALERT_STATUSES = ["pending", "processing", "retry_wait", "completed", "failed", "expired"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export type Alert = {
  seq: number;
  id: string;
  kind: string;
  dedupeKey: string;
  sourceEventId: string | null;
  gameSlug: string | null;
  subjectId: string | null;
  title: string | null;
  payload: Record<string, unknown>;
  isTest: boolean;
  priority: number;
  status: AlertStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: number;
  expiresAt: number | null;
  lastError: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
};

export type NewAlert = {
  kind: string;
  dedupeKey: string;
  sourceEventId?: string | null;
  gameSlug?: string | null;
  subjectId?: string | null;
  title?: string | null;
  payload: Record<string, unknown>;
  isTest?: boolean;
  priority?: number;
  expiresAt?: number | null;
  /** Tentativas próprias (padrão: o da fila). */
  maxAttempts?: number;
  /** Cria já expirado (ex.: conquista antiga demais para ser apresentada agora). */
  expired?: boolean;
};

export type AlertFailure = { message: string; deferMs?: number; permanent?: boolean };

const nullableNumber = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const nullableString = (value: unknown) => (value === null || value === undefined ? null : String(value));

function toAlert(row: Record<string, unknown>): Alert {
  return {
    seq: Number(row.seq),
    id: String(row.id),
    kind: String(row.kind),
    dedupeKey: String(row.dedupe_key),
    sourceEventId: nullableString(row.source_event_id),
    gameSlug: nullableString(row.game_slug),
    subjectId: nullableString(row.subject_id),
    title: nullableString(row.title),
    payload: JSON.parse(String(row.payload)) as Record<string, unknown>,
    isTest: Number(row.is_test) === 1,
    priority: Number(row.priority),
    status: String(row.status) as AlertStatus,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    nextAttemptAt: Number(row.next_attempt_at),
    expiresAt: nullableNumber(row.expires_at),
    lastError: nullableString(row.last_error),
    createdAt: Number(row.created_at),
    startedAt: nullableNumber(row.started_at),
    completedAt: nullableNumber(row.completed_at),
    updatedAt: Number(row.updated_at),
  };
}

export type AlertStoreOptions = { maxAttempts: number; retryBaseMs: number; retryMaxMs: number; now?: () => number };

export class AlertStore {
  private readonly db: SqlDatabase;
  private readonly options: Required<AlertStoreOptions>;

  constructor(db: SqlDatabase, options: AlertStoreOptions) {
    this.db = db;
    this.options = { ...options, now: options.now ?? Date.now };
  }

  private now() {
    return this.options.now();
  }

  /** Idempotente pela dedupeKey: o mesmo fato nunca gera dois alertas. */
  insert(input: NewAlert): { alert: Alert; created: boolean } {
    const now = this.now();
    return transaction(this.db, () => {
      const existing = this.db.prepare("SELECT * FROM alerts WHERE dedupe_key = ?").get(input.dedupeKey);
      if (existing) return { alert: toAlert(existing), created: false };
      const id = randomUUID();
      this.db
        .prepare(
          `INSERT INTO alerts (id, kind, dedupe_key, source_event_id, game_slug, subject_id, title, payload, is_test, priority,
             status, attempts, max_attempts, next_attempt_at, expires_at, last_error, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.kind,
          input.dedupeKey,
          input.sourceEventId ?? null,
          input.gameSlug ?? null,
          input.subjectId ?? null,
          input.title ?? null,
          JSON.stringify(input.payload),
          input.isTest ? 1 : 0,
          input.priority ?? 0,
          input.expired ? "expired" : "pending",
          input.maxAttempts ?? this.options.maxAttempts,
          now,
          input.expiresAt ?? null,
          input.expired ? "Antigo demais para ser apresentado" : null,
          now,
          now,
        );
      return { alert: this.get(id)!, created: true };
    });
  }

  get(id: string): Alert | null {
    const row = this.db.prepare("SELECT * FROM alerts WHERE id = ?").get(id);
    return row ? toAlert(row) : null;
  }

  /** Expira o que passou do prazo e reserva o próximo alerta, um por vez. */
  claimNext(): Alert | null {
    const now = this.now();
    return transaction(this.db, () => {
      this.db
        .prepare(
          `UPDATE alerts SET status = 'expired', last_error = COALESCE(last_error, 'Prazo de apresentação vencido'), updated_at = ?
           WHERE status IN ('pending','retry_wait') AND expires_at IS NOT NULL AND expires_at <= ?`,
        )
        .run(now, now);
      // Nunca dois em apresentação ao mesmo tempo.
      if (this.db.prepare("SELECT 1 FROM alerts WHERE status = 'processing' LIMIT 1").get()) return null;
      // Sequência protegida: a protegida que espera a próxima tentativa segura os comuns.
      const head = this.db
        .prepare("SELECT id, priority, next_attempt_at, payload FROM alerts WHERE status IN ('pending','retry_wait') ORDER BY priority DESC, seq LIMIT 1")
        .get();
      let row: Record<string, unknown> | undefined;
      if (head && Number(head.priority) >= PROTECTED_PRIORITY) {
        // A conquista que disparou a Maestria abre a sequência: aparece antes dela.
        const trigger = (JSON.parse(String(head.payload)) as { triggerEventId?: unknown }).triggerEventId;
        const opener =
          typeof trigger === "string"
            ? this.db.prepare("SELECT id, next_attempt_at FROM alerts WHERE source_event_id = ? AND status IN ('pending','retry_wait') LIMIT 1").get(trigger)
            : undefined;
        const next = opener ?? head;
        if (Number(next.next_attempt_at) > now) return null;
        row = next;
      } else {
        row = this.db
          .prepare(
            `SELECT id FROM alerts WHERE status IN ('pending','retry_wait') AND next_attempt_at <= ?
             ORDER BY priority DESC, seq LIMIT 1`,
          )
          .get(now);
      }
      if (!row) return null;
      this.db
        .prepare("UPDATE alerts SET status = 'processing', attempts = attempts + 1, started_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, String(row.id));
      return this.get(String(row.id));
    });
  }

  /** O apresentador confirmou que a apresentação começou de fato (started_at = início real). */
  markStarted(id: string, attempt: number): boolean {
    const now = this.now();
    const changes = this.db
      .prepare("UPDATE alerts SET started_at = ?, updated_at = ? WHERE id = ? AND status = 'processing' AND attempts = ?")
      .run(now, now, id, attempt).changes;
    return Number(changes) === 1;
  }

  complete(id: string, attempt: number): boolean {
    const now = this.now();
    const changes = this.db
      .prepare(
        `UPDATE alerts SET status = 'completed', completed_at = ?, last_error = NULL, updated_at = ?
         WHERE id = ? AND status = 'processing' AND attempts = ?`,
      )
      .run(now, now, id, attempt).changes;
    return Number(changes) === 1;
  }

  fail(id: string, attempt: number, failure: AlertFailure): AlertStatus | null {
    const now = this.now();
    return transaction(this.db, () => {
      const row = this.db.prepare("SELECT * FROM alerts WHERE id = ? AND status = 'processing' AND attempts = ?").get(id, attempt);
      if (!row) return null;
      const alert = toAlert(row);
      let status: AlertStatus;
      let attempts = alert.attempts;
      let next = now;
      if (failure.deferMs !== undefined && !failure.permanent) {
        status = "retry_wait";
        attempts -= 1;
        next = now + Math.max(0, failure.deferMs);
      } else if (failure.permanent || alert.attempts >= alert.maxAttempts) {
        status = "failed";
      } else {
        status = "retry_wait";
        next = now + retryDelayMs(alert.attempts, this.options.retryBaseMs, this.options.retryMaxMs);
      }
      this.db
        .prepare("UPDATE alerts SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?")
        .run(status, attempts, next, failure.message.slice(0, 2000), now, id);
      return status;
    });
  }

  /** Alertas que estavam em apresentação quando o agente caiu voltam para a fila (a tentativa conta). */
  recoverInterrupted(): { recovered: number; failed: number } {
    const now = this.now();
    return transaction(this.db, () => {
      let recovered = 0;
      let failed = 0;
      for (const alert of this.db.prepare("SELECT * FROM alerts WHERE status = 'processing'").all().map(toAlert)) {
        const exhausted = alert.attempts >= alert.maxAttempts;
        this.db
          .prepare("UPDATE alerts SET status = ?, next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?")
          .run(exhausted ? "failed" : "retry_wait", now, "Apresentação interrompida por encerramento do agente", now, alert.id);
        if (exhausted) failed += 1;
        else recovered += 1;
      }
      return { recovered, failed };
    });
  }

  /** Reprocessamento controlado: só de failed/expired, com novo prazo opcional. */
  requeue(id: string, expiresAt: number | null): boolean {
    const now = this.now();
    const changes = this.db
      .prepare(
        `UPDATE alerts SET status = 'pending', attempts = 0, next_attempt_at = ?, expires_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('failed','expired')`,
      )
      .run(now, expiresAt, now, id).changes;
    return Number(changes) === 1;
  }

  list(filter: { status?: AlertStatus; limit?: number } = {}): Alert[] {
    const params: SqlValue[] = [];
    let where = "";
    if (filter.status) {
      where = "WHERE status = ?";
      params.push(filter.status);
    }
    const limit = Math.min(Math.max(1, Math.trunc(filter.limit ?? 20)), 500);
    return this.db.prepare(`SELECT * FROM alerts ${where} ORDER BY seq DESC LIMIT ${limit}`).all(...params).map(toAlert);
  }

  /** Alertas protegidos (Maestria) reais aguardando apresentação. */
  protectedWaiting(): number {
    return Number(
      this.db
        .prepare("SELECT COUNT(*) AS n FROM alerts WHERE status IN ('pending','retry_wait','processing') AND priority >= ? AND is_test = 0")
        .get(PROTECTED_PRIORITY)?.n ?? 0,
    );
  }

  counts(): Record<AlertStatus, number> {
    const out = Object.fromEntries(ALERT_STATUSES.map((s) => [s, 0])) as Record<AlertStatus, number>;
    for (const row of this.db.prepare("SELECT status, COUNT(*) AS n FROM alerts WHERE is_test = 0 GROUP BY status").all()) {
      out[String(row.status) as AlertStatus] = Number(row.n);
    }
    return out;
  }
}

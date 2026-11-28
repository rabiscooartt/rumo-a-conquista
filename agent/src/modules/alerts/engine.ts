import type { Logger } from "../../logger.ts";
import { transaction, type SqlDatabase } from "../../store/database.ts";
import { ACHIEVEMENT_UNLOCKED, type UnlockPayload } from "../achievements/watcher.ts";
import { MASTERY_ACHIEVED, type MasteryPayload } from "../mastery/index.ts";
import { PROTECTED_PRIORITY, type Alert, type AlertStore } from "./alertStore.ts";

export const ACHIEVEMENT_ALERT = "achievement";
export const MASTERY_ALERT = "mastery";
/** A Maestria tem mais tentativas que um alerta comum: perdê-la é pior que atrasá-la. */
export const MASTERY_MAX_ATTEMPTS = 5;

/**
 * Quem apresenta um alerta (overlay do OBS na Fase 4.3). present() só resolve quando a
 * apresentação terminou; o alerta só é concluído depois disso.
 */
export interface AlertPresenter {
  readonly id: string;
  /** started() deve ser chamado quando a apresentação aparece de fato. */
  present(alert: Alert, ctx: { signal: AbortSignal; started: () => void }): Promise<void>;
}

/** Apresentador momentaneamente indisponível (ex.: overlay fechado): reagenda sem gastar tentativa. */
export class PresenterUnavailableError extends Error {
  readonly delayMs: number;
  constructor(message: string, delayMs = 15_000) {
    super(message);
    this.name = "PresenterUnavailableError";
    this.delayMs = delayMs;
  }
}

export type EngineOptions = {
  /** Conquistas detectadas há mais tempo que isso viram alerta já expirado (não aparecem fora de hora). */
  staleAfterMs: number;
  /** Prazo para um alerta pendente ser apresentado. */
  ttlMs: number;
  presentTimeoutMs: number;
  pollMs: number;
  now?: () => number;
};

type IngestStats = { created: number; skipped: number; expired: number };
const INGEST_BATCH = 100;

/**
 * Motor de alertas de conquistas.
 *
 * Ingestão: lê os eventos "achievement.unlocked" já persistidos, em ordem (seq), a partir de um
 * cursor salvo no SQLite. Cada evento elegível vira um alerta, e o alerta + o avanço do cursor
 * são gravados na mesma transação: nada se perde nem duplica se o agente cair no meio.
 * Elegível = desbloqueio percebido ao vivo (detectedLive). Reconciliações de períodos offline
 * não interrompem a transmissão com alertas atrasados.
 *
 * Execução: um alerta por vez, na ordem da fila, só quando há um apresentador registrado.
 * Sem apresentador (Fase 4.2), os alertas ficam pendentes até o prazo (ttl).
 */
export class AlertEngine {
  private readonly db: SqlDatabase;
  private readonly store: AlertStore;
  private readonly log: Logger;
  private readonly options: Required<EngineOptions>;
  private readonly cursor: { get(): number | undefined; set(value: number): void };
  private readonly gameTitle: (slug: string | null) => string | null;
  private presenter: AlertPresenter | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = true;
  private current: { alert: Alert; controller: AbortController } | null = null;
  readonly totals: IngestStats & { completed: number; failed: number } = { created: 0, skipped: 0, expired: 0, completed: 0, failed: 0 };

  constructor(options: {
    db: SqlDatabase;
    store: AlertStore;
    log: Logger;
    cursor: { get(): number | undefined; set(value: number): void };
    gameTitle?: (slug: string | null) => string | null;
    engine: EngineOptions;
  }) {
    this.db = options.db;
    this.store = options.store;
    this.log = options.log;
    this.cursor = options.cursor;
    this.gameTitle = options.gameTitle ?? (() => null);
    this.options = { ...options.engine, now: options.engine.now ?? Date.now };
  }

  private now() {
    return this.options.now();
  }

  setPresenter(presenter: AlertPresenter | null) {
    this.presenter = presenter;
    this.log.info(presenter ? "Apresentador de alertas registrado" : "Apresentador de alertas removido", { presenter: presenter?.id ?? null });
    this.kick();
  }

  presenterId() {
    return this.presenter?.id ?? null;
  }

  currentAlertTitle() {
    return this.current?.alert.title ?? null;
  }

  currentAlertId() {
    return this.current?.alert.id ?? null;
  }

  /**
   * Na primeira execução o cursor começa no fim da fila de eventos: o histórico anterior
   * à instalação do motor não vira alerta.
   */
  initCursor() {
    if (this.cursor.get() !== undefined) return;
    const max = Number(this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM events").get()?.m ?? 0);
    this.cursor.set(max);
    this.log.info("Fila de alertas iniciada a partir do evento atual", { cursor: max });
  }

  /** Converte eventos novos em alertas. Retorna quantos eventos foram lidos. */
  ingest(batch = INGEST_BATCH): IngestStats & { read: number } {
    const stats: IngestStats & { read: number } = { created: 0, skipped: 0, expired: 0, read: 0 };
    transaction(this.db, () => {
      const from = this.cursor.get() ?? 0;
      const rows = this.db
        .prepare("SELECT seq, id, type, payload, is_test, occurred_at FROM events WHERE type IN (?, ?) AND seq > ? ORDER BY seq LIMIT ?")
        .all(ACHIEVEMENT_UNLOCKED, MASTERY_ACHIEVED, from, batch);
      let last = from;
      stats.read = rows.length;
      for (const row of rows) {
        last = Number(row.seq);
        if (String(row.type) === MASTERY_ACHIEVED) {
          this.ingestMastery(row, stats);
          continue;
        }
        const payload = JSON.parse(String(row.payload)) as Partial<UnlockPayload>;
        if (payload.detectedLive !== true || !payload.externalId) {
          stats.skipped += 1;
          continue;
        }
        const detectedAt = Date.parse(payload.detectedAt ?? "") || Number(row.occurred_at);
        const now = this.now();
        const stale = now - detectedAt > this.options.staleAfterMs;
        const result = this.store.insert({
          kind: ACHIEVEMENT_ALERT,
          dedupeKey: `alert:${ACHIEVEMENT_ALERT}:${row.id}`,
          sourceEventId: String(row.id),
          gameSlug: payload.gameSlug ?? null,
          subjectId: payload.externalId,
          title: payload.name ?? null,
          isTest: Number(row.is_test) === 1,
          expiresAt: now + this.options.ttlMs,
          expired: stale,
          payload: {
            gameSlug: payload.gameSlug ?? null,
            gameTitle: this.gameTitle(payload.gameSlug ?? null),
            achievementId: payload.externalId,
            name: payload.name ?? null,
            description: payload.description ?? null,
            image: payload.image ?? null,
            isCustom: payload.isCustom === true,
            provider: payload.provider ?? null,
            unlockedAt: payload.unlockedAt ?? null,
            timestampKind: payload.timestampKind ?? null,
            sessionId: payload.sessionId ?? null,
          },
        });
        if (!result.created) continue;
        if (stale) stats.expired += 1;
        else stats.created += 1;
        this.log.info(stale ? "Alerta criado já expirado (conquista antiga)" : "Alerta de conquista na fila", {
          alertId: result.alert.id,
          eventId: row.id,
          gameSlug: payload.gameSlug ?? null,
          achievementId: payload.externalId,
          teste: Number(row.is_test) === 1,
        });
      }
      if (last !== from) this.cursor.set(last);
    });
    this.totals.created += stats.created;
    this.totals.skipped += stats.skipped;
    this.totals.expired += stats.expired;
    return stats;
  }

  /**
   * Maestria: alerta protegido, prioridade máxima, sem prazo de validade (não se perde com o
   * overlay fechado). Só Maestrias percebidas ao vivo são apresentadas; as reconciliadas de
   * períodos offline ficam registradas como expiradas (reapresentáveis com "alerts retry").
   */
  private ingestMastery(row: Record<string, unknown>, stats: IngestStats) {
    const payload = JSON.parse(String(row.payload)) as Partial<MasteryPayload>;
    if (!payload.gameSlug) {
      stats.skipped += 1;
      return;
    }
    const live = payload.detectedLive === true;
    const result = this.store.insert({
      kind: MASTERY_ALERT,
      dedupeKey: `alert:${MASTERY_ALERT}:${row.id}`,
      sourceEventId: String(row.id),
      gameSlug: payload.gameSlug,
      subjectId: payload.gameSlug,
      title: payload.gameTitle ?? payload.gameSlug,
      isTest: Number(row.is_test) === 1,
      priority: PROTECTED_PRIORITY,
      maxAttempts: MASTERY_MAX_ATTEMPTS,
      expiresAt: null,
      expired: !live,
      payload: { ...payload },
    });
    if (!result.created) return;
    if (live) stats.created += 1;
    else stats.expired += 1;
    this.log.info(live ? "Maestria na fila (sequência protegida)" : "Maestria registrada sem apresentação (não percebida ao vivo)", {
      alertId: result.alert.id,
      eventId: row.id,
      gameSlug: payload.gameSlug,
      teste: Number(row.is_test) === 1,
    });
  }

  currentAlertKind() {
    return this.current?.alert.kind ?? null;
  }

  /** Apresenta o próximo alerta, se houver apresentador. Retorna o alerta tratado. */
  async processNext(): Promise<Alert | null> {
    const presenter = this.presenter;
    if (!presenter) return null;
    const alert = this.store.claimNext();
    if (!alert) return null;
    const controller = new AbortController();
    this.current = { alert, controller };
    let timeout: NodeJS.Timeout | null = null;
    try {
      await Promise.race([
        presenter.present(alert, {
          signal: controller.signal,
          started: () => {
            if (this.store.markStarted(alert.id, alert.attempts)) this.log.info("Apresentação iniciada", { alertId: alert.id });
          },
        }),
        new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason))),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            const error = new Error(`Apresentação excedeu ${this.options.presentTimeoutMs} ms`);
            controller.abort(error);
            reject(error);
          }, this.options.presentTimeoutMs);
        }),
      ]);
      if (this.store.complete(alert.id, alert.attempts)) {
        this.totals.completed += 1;
        this.log.info("Alerta apresentado", { alertId: alert.id, presenter: presenter.id });
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const status = this.store.fail(alert.id, alert.attempts, {
        message: `${err.name}: ${err.message}`,
        deferMs: err instanceof PresenterUnavailableError ? err.delayMs : undefined,
      });
      if (status === "failed") {
        this.totals.failed += 1;
        this.log.error("Alerta falhou definitivamente", { alertId: alert.id, error: err.message });
      } else {
        this.log.warn("Falha ao apresentar alerta; nova tentativa agendada", { alertId: alert.id, error: err.message });
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      this.current = null;
    }
    return this.store.get(alert.id);
  }

  private tick = async () => {
    this.timer = null;
    if (this.stopped || this.running) return;
    this.running = (async () => {
      try {
        // Ingere antes de cada apresentação: o que chegou durante a anterior (ex.: uma Maestria)
        // já disputa a próxima vaga pela prioridade, sem esperar a fila esvaziar.
        while (!this.stopped) {
          while (!this.stopped && this.ingest().read === INGEST_BATCH) {
            // ingere em lotes até esvaziar
          }
          if (this.stopped || !(await this.processNext())) break;
        }
      } catch (error) {
        this.log.error("Falha no ciclo do motor de alertas", { error });
      }
    })().finally(() => {
      this.running = null;
      if (!this.stopped) this.timer = setTimeout(this.tick, this.options.pollMs);
    });
  };

  start() {
    this.stopped = false;
    const recovered = this.store.recoverInterrupted();
    if (recovered.recovered || recovered.failed) this.log.warn("Alertas interrompidos recuperados", recovered);
    this.initCursor();
    this.kick();
  }

  kick() {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(this.tick, 0);
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.current?.controller.abort(new Error("Agente encerrando"));
    await this.running;
  }
}

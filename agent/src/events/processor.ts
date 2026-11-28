import type { Logger } from "../logger.ts";
import type { AgentEvent, EventStore } from "./eventStore.ts";

export type HandlerContext = {
  /** Abortado em timeout ou no encerramento do agente. */
  signal: AbortSignal;
  attempt: number;
  log: Logger;
};

export type EventHandler = (event: AgentEvent, ctx: HandlerContext) => unknown | Promise<unknown>;

/** Erro que não se resolve tentando de novo (dados inválidos, recurso inexistente). */
export class PermanentEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentEventError";
  }
}

/** Dependência indisponível (site offline, OBS fechado): reagenda sem gastar tentativa. */
export class DeferEventError extends Error {
  readonly delayMs: number;
  constructor(message: string, delayMs: number) {
    super(message);
    this.name = "DeferEventError";
    this.delayMs = delayMs;
  }
}

export class HandlerTimeoutError extends Error {
  constructor(ms: number) {
    super(`Handler excedeu ${ms} ms`);
    this.name = "HandlerTimeoutError";
  }
}

export type ProcessorOptions = {
  pollIntervalMs: number;
  handlerTimeoutMs: number;
};

export type ProcessorStats = {
  running: boolean;
  handledTypes: string[];
  currentEventId: string | null;
  completed: number;
  retried: number;
  deferred: number;
  failed: number;
  lastActivityAt: number | null;
  lastError: { at: number; eventId: string; type: string; message: string } | null;
};

type Registration = { handler: EventHandler; timeoutMs: number };

/**
 * Processa a fila persistida, um evento por vez, na ordem de chegada.
 * Só reserva eventos de tipos com handler registrado: eventos de módulos ainda
 * não carregados permanecem na fila (visíveis em /status) em vez de se perder.
 */
export class EventProcessor {
  private readonly store: EventStore;
  private readonly log: Logger;
  private readonly options: ProcessorOptions;
  private readonly handlers = new Map<string, Registration>();
  private running = false;
  private stopping = false;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private wakeRequested = false;
  private current: { event: AgentEvent; controller: AbortController } | null = null;
  private readonly counters: Omit<ProcessorStats, "running" | "handledTypes" | "currentEventId"> = {
    completed: 0,
    retried: 0,
    deferred: 0,
    failed: 0,
    lastActivityAt: null,
    lastError: null,
  };

  constructor(store: EventStore, log: Logger, options: ProcessorOptions) {
    this.store = store;
    this.log = log;
    this.options = options;
  }

  register(type: string, handler: EventHandler, options: { timeoutMs?: number } = {}) {
    if (this.handlers.has(type)) throw new Error(`Já existe handler para o tipo "${type}"`);
    this.handlers.set(type, { handler, timeoutMs: options.timeoutMs ?? this.options.handlerTimeoutMs });
    this.kick();
  }

  handledTypes() {
    return [...this.handlers.keys()].sort();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.stopping = false;
    this.schedule(0);
  }

  /** Pede processamento imediato (ex.: logo após registrar um evento). */
  kick() {
    if (!this.running) return;
    if (this.inFlight) this.wakeRequested = true;
    else this.schedule(0);
  }

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), ms);
  }

  private tick() {
    this.timer = null;
    if (!this.running || this.inFlight) return;
    this.inFlight = this.drain()
      .then(() => undefined)
      .catch((error) => this.log.error("Falha no ciclo de processamento", { error }))
      .finally(() => {
        this.inFlight = null;
        if (this.running) this.schedule(this.wakeRequested ? 0 : this.options.pollIntervalMs);
        this.wakeRequested = false;
      });
  }

  /** Processa todos os eventos vencidos. Exposto para testes e diagnósticos. */
  async drain(): Promise<number> {
    let processed = 0;
    const types = this.handledTypes();
    while (!this.stopping) {
      const event = this.store.claimNext(types);
      if (!event) break;
      await this.processOne(event);
      processed += 1;
    }
    return processed;
  }

  private async processOne(event: AgentEvent) {
    const registration = this.handlers.get(event.type);
    const log = this.log.child(event.type);
    if (!registration) {
      this.store.fail(event.id, event.attempts, { message: `Sem handler para ${event.type}`, deferMs: 60_000 });
      return;
    }
    const controller = new AbortController();
    this.current = { event, controller };
    let timeout: NodeJS.Timeout | null = null;
    const started = Date.now();
    log.debug("Processando evento", { id: event.id, attempt: event.attempts });
    try {
      const timedOut = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          const error = new HandlerTimeoutError(registration.timeoutMs);
          controller.abort(error);
          reject(error);
        }, registration.timeoutMs);
      });
      const result = await Promise.race([
        Promise.resolve().then(() => registration.handler(event, { signal: controller.signal, attempt: event.attempts, log })),
        timedOut,
      ]);
      if (this.store.complete(event.id, event.attempts, result)) {
        this.counters.completed += 1;
        log.info("Evento concluído", { id: event.id, attempt: event.attempts, ms: Date.now() - started });
      } else {
        log.warn("Conclusão ignorada: evento não estava mais reservado", { id: event.id });
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const failure =
        err instanceof DeferEventError
          ? { message: err.message, deferMs: err.delayMs }
          : { message: `${err.name}: ${err.message}`, permanent: err instanceof PermanentEventError };
      const status = this.store.fail(event.id, event.attempts, failure);
      this.counters.lastError = { at: Date.now(), eventId: event.id, type: event.type, message: failure.message };
      if (err instanceof DeferEventError) {
        this.counters.deferred += 1;
        log.info("Evento adiado", { id: event.id, motivo: err.message, delayMs: err.delayMs });
      } else if (status === "failed") {
        this.counters.failed += 1;
        log.error("Evento falhou definitivamente", { id: event.id, attempt: event.attempts, error: err });
      } else {
        this.counters.retried += 1;
        log.warn("Falha no evento; nova tentativa agendada", { id: event.id, attempt: event.attempts, error: err.message });
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      this.current = null;
      this.counters.lastActivityAt = Date.now();
    }
  }

  /**
   * Para de reservar eventos e aguarda o evento em andamento por até drainMs.
   * Se o prazo estourar, o handler é abortado; o que não fechar a tempo fica em
   * "processing" e é recuperado na próxima inicialização.
   */
  async stop(drainMs: number) {
    this.running = false;
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const pending = this.inFlight;
    if (!pending) return { drained: true };
    let timer: NodeJS.Timeout | null = null;
    const expired = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), drainMs);
    });
    const outcome = await Promise.race([pending.then(() => "done" as const), expired]);
    if (timer) clearTimeout(timer);
    if (outcome === "timeout") {
      this.current?.controller.abort(new Error("Agente encerrando"));
      this.log.warn("Encerramento antes do fim do evento em andamento; ele será recuperado no próximo início", {
        id: this.current?.event.id,
      });
      return { drained: false };
    }
    return { drained: true };
  }

  stats(): ProcessorStats {
    return {
      running: this.running,
      handledTypes: this.handledTypes(),
      currentEventId: this.current?.event.id ?? null,
      ...this.counters,
    };
  }
}

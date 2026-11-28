import type { Logger } from "../logger.ts";

export type ConnectionState = "disabled" | "idle" | "connecting" | "connected" | "reconnecting" | "stopped";

export type ConnectionStatus = {
  name: string;
  state: ConnectionState;
  since: number;
  lastConnectedAt: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  nextRetryAt: number | null;
  detail: Record<string, unknown>;
};

/** O que cada integração (site, OBS, futuras) precisa implementar. */
export interface ConnectionDriver {
  /** Resolve quando conectado; rejeita se não conseguiu. Deve chamar handle.lost() se cair depois. */
  open(handle: ConnectionHandle, signal: AbortSignal): Promise<void>;
  close(): void | Promise<void>;
  detail?(): Record<string, unknown>;
}

export type ConnectionHandle = { lost(error: unknown): void };

export type ReconnectPolicy = { baseDelayMs: number; maxDelayMs: number };

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Máquina de estados comum de conexão com reconexão automática (backoff exponencial).
 * Registra em log só as mudanças de estado, para não poluir quando um serviço fica
 * fora do ar por muito tempo (ex.: OBS fechado).
 */
export class ManagedConnection {
  readonly name: string;
  private readonly driver: ConnectionDriver;
  private readonly log: Logger;
  private readonly policy: ReconnectPolicy;
  private status: ConnectionStatus;
  private retryTimer: NodeJS.Timeout | null = null;
  private controller: AbortController | null = null;
  private generation = 0;
  private readonly listeners = new Set<(status: ConnectionStatus) => void>();

  constructor(name: string, driver: ConnectionDriver, log: Logger, options: { enabled: boolean; policy?: ReconnectPolicy }) {
    this.name = name;
    this.driver = driver;
    this.log = log;
    this.policy = options.policy ?? { baseDelayMs: 1_000, maxDelayMs: 60_000 };
    this.status = {
      name,
      state: options.enabled ? "idle" : "disabled",
      since: Date.now(),
      lastConnectedAt: null,
      lastError: null,
      consecutiveFailures: 0,
      nextRetryAt: null,
      detail: {},
    };
  }

  onChange(listener: (status: ConnectionStatus) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): ConnectionStatus {
    return { ...this.status, detail: { ...this.status.detail, ...(this.driver.detail?.() ?? {}) } };
  }

  isConnected() {
    return this.status.state === "connected";
  }

  private setState(state: ConnectionState, patch: Partial<ConnectionStatus> = {}) {
    const changed = state !== this.status.state;
    this.status = { ...this.status, ...patch, state, since: changed ? Date.now() : this.status.since };
    if (changed) for (const listener of this.listeners) listener(this.snapshot());
  }

  start() {
    if (this.status.state === "disabled") {
      this.log.info("Conexão desativada na configuração");
      return;
    }
    if (this.status.state !== "idle" && this.status.state !== "stopped") return;
    this.attempt();
  }

  private attempt() {
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.setState(this.status.consecutiveFailures ? "reconnecting" : "connecting", { nextRetryAt: null });
    const handle: ConnectionHandle = {
      lost: (error) => {
        if (generation !== this.generation || this.status.state !== "connected") return;
        this.log.warn("Conexão perdida", { error: errorMessage(error) });
        this.status.lastError = errorMessage(error);
        void Promise.resolve(this.driver.close()).catch(() => undefined);
        this.scheduleRetry(generation);
      },
    };
    this.driver
      .open(handle, controller.signal)
      .then(() => {
        if (generation !== this.generation) return;
        const recovered = this.status.consecutiveFailures > 0;
        this.setState("connected", { lastConnectedAt: Date.now(), consecutiveFailures: 0, lastError: null });
        this.log.info(recovered ? "Conexão restabelecida" : "Conectado", this.driver.detail?.() ?? {});
      })
      .catch((error) => {
        if (generation !== this.generation) return;
        const message = errorMessage(error);
        const failures = this.status.consecutiveFailures + 1;
        if (failures === 1 || message !== this.status.lastError) {
          this.log.warn("Falha ao conectar; nova tentativa automática", { error: message, tentativa: failures });
        } else {
          this.log.debug("Ainda sem conexão", { error: message, tentativa: failures });
        }
        this.status.lastError = message;
        this.status.consecutiveFailures = failures;
        void Promise.resolve(this.driver.close()).catch(() => undefined);
        this.scheduleRetry(generation);
      });
  }

  private scheduleRetry(generation: number) {
    if (generation !== this.generation) return;
    const failures = Math.max(1, this.status.consecutiveFailures);
    const delay = Math.min(this.policy.maxDelayMs, this.policy.baseDelayMs * 2 ** (failures - 1));
    this.setState("reconnecting", { nextRetryAt: Date.now() + delay });
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (generation === this.generation) this.attempt();
    }, delay);
  }

  /** Reconecta imediatamente (ex.: comando manual pelo dock no futuro). */
  reconnectNow() {
    if (this.status.state === "disabled" || this.status.state === "stopped") return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.controller?.abort();
    void Promise.resolve(this.driver.close()).catch(() => undefined);
    this.attempt();
  }

  async stop() {
    this.generation += 1;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.controller?.abort();
    await Promise.resolve(this.driver.close()).catch(() => undefined);
    if (this.status.state !== "disabled") this.setState("stopped", { nextRetryAt: null });
  }
}

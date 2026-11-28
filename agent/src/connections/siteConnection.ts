import { USER_AGENT } from "../version.ts";
import type { ConnectionDriver, ConnectionHandle } from "./managedConnection.ts";

export type SiteDriverOptions = {
  url: string;
  probeIntervalMs: number;
  probeTimeoutMs: number;
  fetchImpl?: typeof fetch;
};

/**
 * Conectividade real com o site (fonte central de dados).
 *
 * Fase 1: verifica periodicamente se o site responde (HEAD na raiz, sem tocar no
 * banco). A troca autenticada de dados exigirá um endpoint dedicado ao agente no
 * site, com token próprio e restrito — nunca service-role no cliente Windows.
 */
export class SiteDriver implements ConnectionDriver {
  private readonly options: SiteDriverOptions;
  private readonly fetchImpl: typeof fetch;
  private interval: NodeJS.Timeout | null = null;
  private last: { status: number | null; latencyMs: number | null; checkedAt: number | null } = {
    status: null,
    latencyMs: null,
    checkedAt: null,
  };

  constructor(options: SiteDriverOptions) {
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async probe(signal?: AbortSignal) {
    const started = Date.now();
    const timeout = AbortSignal.timeout(this.options.probeTimeoutMs);
    const response = await this.fetchImpl(`${this.options.url}/`, {
      method: "HEAD",
      redirect: "manual",
      headers: { "user-agent": USER_AGENT },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    this.last = { status: response.status, latencyMs: Date.now() - started, checkedAt: Date.now() };
    if (response.status >= 500) throw new Error(`Site respondeu HTTP ${response.status}`);
  }

  async open(handle: ConnectionHandle, signal: AbortSignal) {
    await this.probe(signal);
    this.interval = setInterval(() => {
      this.probe().catch((error) => {
        this.last.checkedAt = Date.now();
        handle.lost(error);
      });
    }, this.options.probeIntervalMs);
    this.interval.unref?.();
  }

  close() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  detail() {
    return {
      url: this.options.url,
      lastHttpStatus: this.last.status,
      lastLatencyMs: this.last.latencyMs,
      lastCheckedAt: this.last.checkedAt,
    };
  }
}

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "../../logger.ts";
import type { Alert } from "../alerts/alertStore.ts";
import { PresenterUnavailableError, type AlertPresenter } from "../alerts/engine.ts";

export type OverlayTiming = { enterMs: number; holdMs: number; exitMs: number };

/** Só o que o overlay precisa para desenhar; nada é inventado (campos ausentes ficam null). */
export type AchievementPresentation = {
  kind: "achievement";
  name: string | null;
  description: string | null;
  gameTitle: string | null;
  /** Imagem publicada pelo site (https), quando existir. */
  image: string | null;
  isCustom: boolean;
  isTest: boolean;
};

/** Maestria: conclusão integral do jogo (Fase 4.5). */
export type MasteryPresentation = {
  kind: "mastery";
  gameTitle: string;
  /** Conquistas elegíveis concluídas (todas); null quando desconhecido (teste sem catálogo). */
  total: number | null;
  official: number | null;
  custom: number | null;
  badgeTitle: string | null;
  /** Arte da Maestria Final publicada pelo site (https), quando existir. */
  image: string | null;
  isTest: boolean;
};

export type Presentation = AchievementPresentation | MasteryPresentation;

type Client = { id: string; res: ServerResponse; heartbeat: NodeJS.Timeout };
type Deferred = { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void };

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const count = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null);
const httpsImage = (value: unknown) => (typeof value === "string" && /^https:\/\//.test(value) ? value : null);

export function toPresentation(alert: Alert): Presentation {
  const p = alert.payload as Record<string, unknown>;
  if (alert.kind === "mastery") {
    return {
      kind: "mastery",
      gameTitle: text(p.gameTitle) ?? alert.title ?? "Jogo",
      total: count(p.eligible) || null,
      official: count(p.official),
      custom: count(p.custom),
      badgeTitle: text(p.badgeTitle),
      image: httpsImage(p.badgeImage),
      isTest: alert.isTest,
    };
  }
  return {
    kind: "achievement",
    name: text(p.name) ?? alert.title,
    description: text(p.description),
    gameTitle: text(p.gameTitle),
    image: httpsImage(p.image),
    isCustom: p.isCustom === true,
    isTest: alert.isTest,
  };
}

/**
 * Apresentador "overlay": a Browser Source do OBS conecta por SSE (GET /events) e recebe cada
 * apresentação; confirma "started" e "ended" por POST /ack com um nonce único da apresentação.
 *
 *  - Uma apresentação por vez (a fila da Fase 4.2 já garante; o hub também recusa sobreposição).
 *  - Confirmação com nonce antigo (tentativa anterior, overlay recarregado) é ignorada.
 *  - Sem overlay conectado o hub não é apresentador: a fila espera sem gastar tentativas.
 *  - Overlay que cai no meio da apresentação = falha da tentativa; a fila tenta de novo.
 *  - O alerta só é concluído quando o overlay confirma o fim da animação de saída.
 */
export class OverlayHub implements AlertPresenter {
  readonly id = "overlay";
  private readonly clients = new Map<string, Client>();
  private readonly log: Logger;
  private readonly timing: () => OverlayTiming;
  private readonly masteryTiming: () => OverlayTiming;
  private readonly onAvailability: (available: boolean) => void;
  private readonly startTimeoutMs: number;
  private active: { nonce: string; started: Deferred; ended: Deferred; label: string } | null = null;
  readonly stats = { presented: 0, failed: 0, tests: 0, lastPresentedAt: null as string | null };

  constructor(options: {
    log: Logger;
    timing: () => OverlayTiming;
    /** Tempos da apresentação de Maestria (anúncio = enterMs). Padrão: os mesmos dos alertas. */
    masteryTiming?: () => OverlayTiming;
    onAvailability: (available: boolean) => void;
    startTimeoutMs?: number;
  }) {
    this.log = options.log;
    this.timing = options.timing;
    this.masteryTiming = options.masteryTiming ?? options.timing;
    this.onAvailability = options.onAvailability;
    this.startTimeoutMs = options.startTimeoutMs ?? 5_000;
  }

  connectedClients() {
    return this.clients.size;
  }

  busy() {
    return this.active !== null;
  }

  private send(client: Client, event: string, data: unknown) {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  private broadcast(event: string, data: unknown) {
    for (const client of this.clients.values()) this.send(client, event, data);
  }

  /** Conexão SSE da Browser Source. */
  attach(req: IncomingMessage, res: ServerResponse) {
    const client: Client = {
      id: randomUUID(),
      res,
      heartbeat: setInterval(() => res.write(": ping\n\n"), 15_000),
    };
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-content-type-options": "nosniff",
    });
    res.write("retry: 2000\n\n");
    const wasEmpty = this.clients.size === 0;
    this.clients.set(client.id, client);
    this.send(client, "hello", { timing: this.timing() });
    this.log.info("Overlay conectado", { clientes: this.clients.size });
    if (wasEmpty) this.onAvailability(true);
    req.on("close", () => {
      clearInterval(client.heartbeat);
      this.clients.delete(client.id);
      this.log.info("Overlay desconectado", { clientes: this.clients.size });
      if (this.clients.size === 0) {
        this.active?.started.reject(new Error("Overlay desconectou durante a apresentação"));
        this.active?.ended.reject(new Error("Overlay desconectou durante a apresentação"));
        this.onAvailability(false);
      }
    });
  }

  /** Confirmação vinda da Browser Source. Retorna false para nonce desconhecido ou antigo. */
  ack(nonce: unknown, phase: unknown): boolean {
    const active = this.active;
    if (!active || typeof nonce !== "string" || nonce !== active.nonce) return false;
    if (phase === "started") active.started.resolve();
    else if (phase === "ended") active.ended.resolve();
    else return false;
    return true;
  }

  async present(alert: Alert, ctx: { signal: AbortSignal; started: () => void }) {
    if (this.clients.size === 0) throw new PresenterUnavailableError("Overlay desconectado", 5_000);
    await this.run(toPresentation(alert), alert.id, ctx);
    this.stats.presented += 1;
    this.stats.lastPresentedAt = new Date().toISOString();
  }

  /**
   * Teste isolado: usa exatamente o mesmo caminho (SSE, animação, confirmações), mas com uma
   * apresentação de exemplo que não existe na fila nem em nenhum dado.
   */
  async test(signal?: AbortSignal, kind: "achievement" | "mastery" = "achievement") {
    if (this.clients.size === 0) throw new PresenterUnavailableError("Nenhum overlay conectado");
    const begin = Date.now();
    let startedAt = 0;
    const presentation: Presentation =
      kind === "mastery"
        ? { kind: "mastery", gameTitle: "Rumo à Conquista", total: null, official: null, custom: null, badgeTitle: null, image: null, isTest: true }
        : {
            kind: "achievement",
            name: "Teste de apresentação",
            description: "Alerta de teste do Rumo à Conquista. Nenhuma conquista foi desbloqueada.",
            gameTitle: "Rumo à Conquista",
            image: null,
            isCustom: false,
            isTest: true,
          };
    await this.run(presentation, "teste", { signal: signal ?? new AbortController().signal, started: () => (startedAt = Date.now()) });
    this.stats.tests += 1;
    return { startedAfterMs: startedAt - begin, totalMs: Date.now() - begin, timing: this.timingFor(presentation) };
  }

  private timingFor(presentation: Presentation) {
    return presentation.kind === "mastery" ? this.masteryTiming() : this.timing();
  }

  private async run(presentation: Presentation, label: string, ctx: { signal: AbortSignal; started: () => void }) {
    if (this.active) throw new Error(`Overlay ocupado com outra apresentação (${this.active.label})`);
    const timing = this.timingFor(presentation);
    const active = { nonce: randomUUID(), started: deferred(), ended: deferred(), label };
    this.active = active;
    const timers: NodeJS.Timeout[] = [];
    const timeout = (target: Deferred, ms: number, message: string) => timers.push(setTimeout(() => target.reject(new Error(message)), ms));
    const onAbort = () => {
      const reason = ctx.signal.reason instanceof Error ? ctx.signal.reason : new Error("Apresentação cancelada");
      active.started.reject(reason);
      active.ended.reject(reason);
    };
    ctx.signal.addEventListener("abort", onAbort);
    try {
      this.broadcast("present", { nonce: active.nonce, presentation, timing });
      timeout(active.started, this.startTimeoutMs, `Overlay não confirmou o início em ${this.startTimeoutMs} ms`);
      await active.started.promise;
      ctx.started();
      const total = timing.enterMs + timing.holdMs + timing.exitMs;
      timeout(active.ended, total + this.startTimeoutMs, `Overlay não confirmou o fim em ${total + this.startTimeoutMs} ms`);
      await active.ended.promise;
    } catch (error) {
      this.broadcast("cancel", { nonce: active.nonce });
      this.stats.failed += 1;
      throw error;
    } finally {
      timers.forEach(clearTimeout);
      ctx.signal.removeEventListener("abort", onAbort);
      this.active = null;
    }
  }

  close() {
    for (const client of this.clients.values()) {
      clearInterval(client.heartbeat);
      client.res.end();
    }
    this.clients.clear();
  }
}

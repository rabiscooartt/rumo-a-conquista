import { HttpError } from "../../control/controlServer.ts";
import type { AgentModule } from "../../core/module.ts";
import type { GamesService } from "../games/index.ts";
import { ALERT_STATUSES, AlertStore, type AlertStatus } from "./alertStore.ts";
import { AlertEngine, type AlertPresenter, type EngineOptions } from "./engine.ts";

/** O que o módulo de alertas oferece aos outros (overlay da Fase 4.3 e dock). */
export type AlertsService = {
  /** Registra quem apresenta os alertas (um por vez). null remove. */
  setPresenter(presenter: AlertPresenter | null): void;
  summary(): AlertsSummary;
};

export type AlertsSummary = {
  presenter: string | null;
  current: string | null;
  currentTitle?: string | null;
  /** "achievement" | "mastery" quando há apresentação em curso. */
  currentKind?: string | null;
  /** Maestrias reais aguardando a sequência protegida. */
  masteryWaiting?: number;
  counts: Record<AlertStatus, number>;
};

export const ALERT_DEFAULTS: Omit<EngineOptions, "now"> & { maxAttempts: number; retryBaseMs: number; retryMaxMs: number } = {
  staleAfterMs: 10 * 60_000,
  ttlMs: 30 * 60_000,
  presentTimeoutMs: 60_000,
  pollMs: 1_000,
  maxAttempts: 3,
  retryBaseMs: 3_000,
  retryMaxMs: 60_000,
};

/**
 * Fase 4.2 — motor e fila de alertas de conquistas. Não apresenta nada sozinho: a apresentação
 * (overlay) chega na Fase 4.3 registrando um AlertPresenter neste serviço.
 */
export function alertsModule(options: { now?: () => number; settings?: Partial<typeof ALERT_DEFAULTS> } = {}): AgentModule {
  const settings = { ...ALERT_DEFAULTS, ...options.settings };
  let engine: AlertEngine | null = null;
  let store: AlertStore | null = null;

  const summary = (): AlertsSummary => ({
    presenter: engine?.presenterId() ?? null,
    current: engine?.currentAlertId() ?? null,
    currentTitle: engine?.currentAlertTitle() ?? null,
    currentKind: engine?.currentAlertKind() ?? null,
    masteryWaiting: store!.protectedWaiting(),
    counts: store!.counts(),
  });

  return {
    name: "alerts",
    start(ctx) {
      const games = ctx.services.get<GamesService>("games");
      store = new AlertStore(ctx.db, { ...settings, now: options.now });
      engine = new AlertEngine({
        db: ctx.db,
        store,
        log: ctx.log,
        cursor: { get: () => ctx.state.get<number>("cursor"), set: (value) => ctx.state.set("cursor", value) },
        gameTitle: (slug) => {
          const session = games?.activeSession();
          if (!slug) return null;
          return session?.slug === slug ? session.title : (games?.titleForSlug(slug) ?? null);
        },
        engine: { ...settings, now: options.now },
      });
      ctx.services.provide<AlertsService>("alerts", {
        setPresenter: (presenter) => engine!.setPresenter(presenter),
        summary,
      });

      ctx.control.route("GET", "/status", () => ({ body: { ...summary(), totals: engine!.totals } }));
      ctx.control.route("GET", "/list", ({ query }) => {
        const status = query.get("status") ?? undefined;
        if (status && !ALERT_STATUSES.includes(status as AlertStatus)) throw new HttpError(400, "status inválido");
        return { body: { alerts: store!.list({ status: status as AlertStatus | undefined, limit: Number(query.get("limit") ?? 20) || 20 }) } };
      });
      ctx.control.route("POST", "/retry", ({ body }) => {
        const id = String((body as { id?: unknown } | undefined)?.id ?? "");
        const ok = store!.requeue(id, (options.now ?? Date.now)() + settings.ttlMs);
        if (!ok) return { status: 409, body: { error: "Só alertas em failed ou expired podem ser reenfileirados" } };
        engine!.kick();
        return { body: { ok } };
      });

      engine.start();
    },
    async stop() {
      await engine?.stop();
    },
    health() {
      const s = summary();
      return { ok: s.counts.failed === 0, detail: { apresentador: s.presenter, fila: s.counts.pending + s.counts.retry_wait, falhas: s.counts.failed } };
    },
  };
}

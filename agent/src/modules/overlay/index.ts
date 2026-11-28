import { HttpError } from "../../control/controlServer.ts";
import type { AgentModule } from "../../core/module.ts";
import { PresenterUnavailableError } from "../alerts/engine.ts";
import type { AlertsService } from "../alerts/index.ts";
import { OverlayHub, type OverlayTiming } from "./hub.ts";
import { OVERLAY_CSP, OVERLAY_CSS, OVERLAY_HTML, OVERLAY_JS } from "./page.ts";

export const OVERLAY_DEFAULTS = { enterMs: 700, exitMs: 600 };
/** Maestria: anúncio (enter) + revelação, permanência mínima maior e saída mais lenta. */
export const MASTERY_TIMING = { enterMs: 2600, minHoldMs: 9000, exitMs: 1000 };

/**
 * Fase 4.3 — primeiro apresentador real: Browser Source do OBS servida pelo agente em
 *   http://127.0.0.1:47821/modules/overlay/
 * Registra-se como apresentador da fila de alertas enquanto houver um overlay conectado.
 */
export function overlayModule(
  options: { timing?: Partial<OverlayTiming>; masteryTiming?: Partial<OverlayTiming>; startTimeoutMs?: number } = {},
): AgentModule {
  let hub: OverlayHub | null = null;

  return {
    name: "overlay",
    start(ctx) {
      const alerts = ctx.services.get<AlertsService>("alerts");
      const timing = (): OverlayTiming => ({
        enterMs: OVERLAY_DEFAULTS.enterMs,
        exitMs: OVERLAY_DEFAULTS.exitMs,
        holdMs: ctx.config.alerts.displayMs,
        ...options.timing,
      });
      const masteryTiming = (): OverlayTiming => ({
        enterMs: MASTERY_TIMING.enterMs,
        exitMs: MASTERY_TIMING.exitMs,
        holdMs: Math.max(MASTERY_TIMING.minHoldMs, ctx.config.alerts.displayMs),
        ...options.masteryTiming,
      });
      hub = new OverlayHub({
        log: ctx.log,
        timing,
        masteryTiming,
        startTimeoutMs: options.startTimeoutMs,
        onAvailability: (available) => alerts?.setPresenter(available ? hub : null),
      });

      const page = { "content-security-policy": OVERLAY_CSP, "referrer-policy": "no-referrer" };
      ctx.control.route("GET", "", () => ({ status: 302, body: "", contentType: "text/plain", headers: { location: "/modules/overlay/" } }));
      ctx.control.route("GET", "/", () => ({ body: OVERLAY_HTML, contentType: "text/html; charset=utf-8", headers: page }));
      ctx.control.route("GET", "/overlay.css", () => ({ body: OVERLAY_CSS, contentType: "text/css; charset=utf-8" }));
      ctx.control.route("GET", "/overlay.js", () => ({ body: OVERLAY_JS, contentType: "text/javascript; charset=utf-8" }));
      ctx.control.route("GET", "/events", () => ({ body: null, raw: (req, res) => hub!.attach(req, res) }));
      // Sem token: a Browser Source não guarda segredo. Proteção: mesma origem + nonce da apresentação.
      ctx.control.route(
        "POST",
        "/ack",
        ({ body }) => {
          const input = (body ?? {}) as { nonce?: unknown; phase?: unknown };
          return hub!.ack(input.nonce, input.phase) ? { body: { ok: true } } : { status: 409, body: { ok: false, error: "Apresentação desconhecida ou já encerrada" } };
        },
        { requireToken: false },
      );
      ctx.control.route("GET", "/status", () => ({
        body: { clients: hub!.connectedClients(), busy: hub!.busy(), timing: timing(), masteryTiming: masteryTiming(), stats: hub!.stats },
      }));
      // Teste isolado (com token): mesmo caminho visual, sem fila, sem conquista, sem dados.
      ctx.control.route("POST", "/test", async ({ body }) => {
        const kind = (body as { kind?: unknown } | undefined)?.kind === "mastery" ? "mastery" : "achievement";
        try {
          return { body: { ok: true, kind, ...(await hub!.test(undefined, kind)) } };
        } catch (error) {
          if (error instanceof PresenterUnavailableError) throw new HttpError(409, error.message);
          if ((error as Error).message.startsWith("Overlay ocupado")) throw new HttpError(409, (error as Error).message);
          throw new HttpError(502, (error as Error).message);
        }
      });
    },
    stop() {
      hub?.close();
    },
    health() {
      return { ok: true, detail: { overlaysConectados: hub?.connectedClients() ?? 0, apresentando: hub?.busy() ?? false } };
    },
  };
}

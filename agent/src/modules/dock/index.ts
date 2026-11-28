import type { AgentModule, ModuleContext } from "../../core/module.ts";
import type { EventStatus } from "../../events/eventStore.ts";
import { AGENT_VERSION } from "../../version.ts";
import { ACHIEVEMENT_UNLOCKED } from "../achievements/watcher.ts";
import type { GamesService } from "../games/index.ts";
import type { AlertsService } from "../alerts/index.ts";
import type { ClipsService } from "../clips/index.ts";
import type { MomentsService } from "../moments/index.ts";
import { DOCK_CSP, DOCK_CSS, DOCK_HTML, DOCK_JS } from "./page.ts";
import { buildDockState } from "./state.ts";

/**
 * Fase 4.1 — dock informativo do OBS, servido pela API local do agente:
 *   http://127.0.0.1:47821/modules/dock/
 * Só leitura: nenhuma rota do dock altera o agente nem o OBS.
 */
export function dockModule(options: { now?: () => number } = {}): AgentModule {
  const now = options.now ?? Date.now;
  let ctx: ModuleContext | null = null;

  const syncCounts = () => {
    const counts: Partial<Record<EventStatus, number>> = {};
    const rows = ctx!.db
      .prepare("SELECT status, COUNT(*) AS n FROM events WHERE type = ? AND is_test = 0 GROUP BY status")
      .all(ACHIEVEMENT_UNLOCKED);
    for (const row of rows) counts[String(row.status) as EventStatus] = Number(row.n);
    const failed = ctx!.db
      .prepare("SELECT last_error FROM events WHERE type = ? AND status = 'failed' AND is_test = 0 ORDER BY updated_at DESC LIMIT 1")
      .get(ACHIEVEMENT_UNLOCKED);
    return { counts, lastError: failed?.last_error ? String(failed.last_error) : null };
  };

  const state = () => {
    const games = ctx!.services.get<GamesService>("games");
    const { counts, lastError } = syncCounts();
    return buildDockState({
      now: now(),
      version: AGENT_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      games: games ? games.status() : null,
      obs: ctx!.connections.obs.snapshot(),
      site: ctx!.connections.site.snapshot(),
      sync: { tokenConfigured: Boolean(ctx!.config.site.agentToken), counts, lastError },
      alerts: ctx!.services.get<AlertsService>("alerts")?.summary() ?? null,
      clips: ctx!.services.get<ClipsService>("clips")?.summary() ?? null,
      momentsPending: ctx!.services.get<MomentsService>("moments")?.pendingCount() ?? 0,
    });
  };

  return {
    name: "dock",
    start(context) {
      ctx = context;
      const page = { "content-security-policy": DOCK_CSP, "referrer-policy": "no-referrer" };
      // Sem a barra final os caminhos relativos (./state) apontariam para fora do dock.
      context.control.route("GET", "", () => ({ status: 302, body: "", contentType: "text/plain", headers: { location: "/modules/dock/" } }));
      context.control.route("GET", "/", () => ({ body: DOCK_HTML, contentType: "text/html; charset=utf-8", headers: page }));
      context.control.route("GET", "/dock.css", () => ({ body: DOCK_CSS, contentType: "text/css; charset=utf-8" }));
      context.control.route("GET", "/dock.js", () => ({ body: DOCK_JS, contentType: "text/javascript; charset=utf-8" }));
      context.control.route("GET", "/state", () => ({ body: state() }));
      // Dados para os controles do dock (só leitura; as ações ficam nos módulos games/achievements).
      context.control.route("GET", "/controls", () => ({ body: { games: ctx!.services.get<GamesService>("games")?.catalogGames() ?? [] } }));
    },
  };
}

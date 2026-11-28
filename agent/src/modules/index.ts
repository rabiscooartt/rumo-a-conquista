import type { AgentModule } from "../core/module.ts";
import { achievementsModule } from "./achievements/index.ts";
import { alertsModule } from "./alerts/index.ts";
import { diagnosticsModule } from "./diagnostics.ts";
import { dockModule } from "./dock/index.ts";
import { gamesModule } from "./games/index.ts";
import { masteryModule } from "./mastery/index.ts";
import { clipsModule } from "./clips/index.ts";
import { momentsModule } from "./moments/index.ts";
import { overlayModule } from "./overlay/index.ts";

/**
 * Módulos carregados pelo agente, na ordem de inicialização (o encerramento é inverso).
 * "achievements", "alerts" e "dock" usam o serviço "games"; "dock" também usa "alerts".
 * "mastery" usa o catálogo do site oferecido por "achievements" ("siteAchievements").
 * "clips" lê os mesmos eventos por um cursor próprio e não depende de "alerts".
 * Próximos blocos: comunidade.
 */
export function defaultModules(): AgentModule[] {
  return [diagnosticsModule(), gamesModule(), achievementsModule(), masteryModule(), clipsModule(), momentsModule(), alertsModule(), overlayModule(), dockModule()];
}

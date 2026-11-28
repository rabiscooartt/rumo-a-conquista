import type { AgentConfig } from "../config.ts";
import type { ManagedConnection } from "../connections/managedConnection.ts";
import type { ObsDriver } from "../connections/obsConnection.ts";
import type { EventStore, NewEvent, RecordResult } from "../events/eventStore.ts";
import type { EventHandler } from "../events/processor.ts";
import type { Logger } from "../logger.ts";
import type { StateStore } from "../store/stateStore.ts";
import type { SqlDatabase } from "../store/database.ts";
import type { RouteHandler } from "../control/controlServer.ts";

export type ModuleHealth = {
  ok: boolean;
  detail?: Record<string, unknown>;
};

/**
 * Contrato de todo módulo do agente (identificação de jogos, Steam, RetroAchievements,
 * emuladores, CUSTOM, sincronização, OBS/alertas, Maestria, clips, comunidade).
 *
 * Um módulo produz eventos com ctx.events.record() e consome os tipos que lhe cabem
 * com ctx.events.handle(). Toda saída para o mundo externo acontece dentro de um
 * handler, ou seja, depois de o evento estar persistido.
 */
export interface AgentModule {
  readonly name: string;
  start(ctx: ModuleContext): void | Promise<void>;
  stop?(): void | Promise<void>;
  health?(): ModuleHealth;
}

export type ModuleContext = {
  config: AgentConfig;
  log: Logger;
  /** Estado persistente com chaves prefixadas pelo nome do módulo. */
  state: {
    get<T>(key: string): T | undefined;
    set(key: string, value: unknown): void;
  };
  events: {
    record(event: NewEvent): RecordResult;
    handle(type: string, handler: EventHandler, options?: { timeoutMs?: number }): void;
    store: EventStore;
  };
  connections: {
    site: ManagedConnection;
    obs: ManagedConnection;
    obsDriver: ObsDriver;
  };
  /** Base local, para módulos com tabelas próprias (criadas nas migrações do núcleo). */
  db: SqlDatabase;
  /** Serviços que um módulo oferece aos outros (ex.: "games" expõe a sessão ativa). */
  services: {
    provide<T>(name: string, service: T): void;
    get<T>(name: string): T | undefined;
  };
  /** Rotas da API local do módulo, servidas em /modules/<nome><path>. */
  control: {
    route(method: "GET" | "POST", path: string, handler: RouteHandler, options?: { requireToken?: boolean }): void;
  };
};

export function scopedState(state: StateStore, moduleName: string): ModuleContext["state"] {
  return {
    get: (key) => state.get(`module.${moduleName}.${key}`),
    set: (key, value) => state.set(`module.${moduleName}.${key}`, value),
  };
}

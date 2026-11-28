import { join } from "node:path";
import { describeConfig, type AgentConfig } from "../config.ts";
import { ManagedConnection } from "../connections/managedConnection.ts";
import { ObsDriver } from "../connections/obsConnection.ts";
import { SiteDriver } from "../connections/siteConnection.ts";
import { ControlServer, loadOrCreateControlToken } from "../control/controlServer.ts";
import { EventStore, type NewEvent } from "../events/eventStore.ts";
import { EventProcessor } from "../events/processor.ts";
import type { Logger } from "../logger.ts";
import { openDatabase, SCHEMA_VERSION, type SqlDatabase } from "../store/database.ts";
import { StateStore } from "../store/stateStore.ts";
import { AGENT_NAME, AGENT_VERSION } from "../version.ts";
import { AlreadyRunningError, InstanceLock } from "./instanceLock.ts";
import { scopedState, type AgentModule, type ModuleContext } from "./module.ts";

export type AgentLifecycle = "created" | "starting" | "running" | "stopping" | "stopped" | "failed";

type ModuleRuntime = { module: AgentModule; state: "pending" | "running" | "failed" | "stopped"; error: string | null };

type RunInfo = {
  runId: number;
  previousRun: {
    cleanShutdown: boolean;
    stoppedAt: number | null;
    lastHeartbeatAt: number | null;
    stopReason: string | null;
  } | null;
  recovery: { recovered: number; failed: number };
};

export class Agent {
  readonly config: AgentConfig;
  private readonly log: Logger;
  private readonly modules: ModuleRuntime[];
  private lifecycle: AgentLifecycle = "created";
  private startedAt: number | null = null;
  private db: SqlDatabase | null = null;
  private state: StateStore | null = null;
  private store: EventStore | null = null;
  private processor: EventProcessor | null = null;
  private site: ManagedConnection | null = null;
  private obs: ManagedConnection | null = null;
  private obsDriver: ObsDriver | null = null;
  private control: ControlServer | null = null;
  private lock: InstanceLock;
  private heartbeat: NodeJS.Timeout | null = null;
  private stopPromise: Promise<void> | null = null;
  private readonly services = new Map<string, unknown>();
  private runInfo: RunInfo | null = null;
  private readonly onStopRequested: (reason: string) => void;

  constructor(options: {
    config: AgentConfig;
    log: Logger;
    modules: AgentModule[];
    /** Chamado quando a API local pede encerramento (o processo decide como sair). */
    onStopRequested?: (reason: string) => void;
  }) {
    this.config = options.config;
    this.log = options.log;
    this.modules = options.modules.map((module) => ({ module, state: "pending", error: null }));
    this.lock = new InstanceLock(join(this.config.dataDir, "agent.lock"));
    this.onStopRequested = options.onStopRequested ?? ((reason) => void this.stop(reason));
  }

  get events(): EventStore {
    if (!this.store) throw new Error("Agente não iniciado");
    return this.store;
  }

  get controlPort() {
    return this.control?.address() ?? null;
  }

  async start() {
    if (this.lifecycle !== "created") throw new Error(`Agente não pode iniciar no estado ${this.lifecycle}`);
    this.lifecycle = "starting";
    const log = this.log;
    log.info("Iniciando agente", { name: AGENT_NAME, version: AGENT_VERSION, pid: process.pid, node: process.version });
    log.info("Configuração", describeConfig(this.config));

    try {
      const { staleRecovered } = this.lock.acquire({
        pid: process.pid,
        version: AGENT_VERSION,
        startedAt: Date.now(),
        controlPort: null,
      });
      if (staleRecovered) log.warn("Lock de uma execução anterior encerrada sem limpeza foi recuperado");

      this.db = openDatabase(this.config.dbPath);
      this.state = new StateStore(this.db);
      this.store = new EventStore(this.db, {
        maxAttempts: this.config.events.maxAttempts,
        retryBaseMs: this.config.events.retryBaseMs,
        retryMaxMs: this.config.events.retryMaxMs,
      });
      log.info("Base local aberta", { path: this.config.dbPath, schema: SCHEMA_VERSION });

      this.runInfo = this.beginRun();
      this.processor = new EventProcessor(this.store, log.child("events"), {
        pollIntervalMs: this.config.events.pollIntervalMs,
        handlerTimeoutMs: this.config.events.handlerTimeoutMs,
      });

      this.site = new ManagedConnection(
        "site",
        new SiteDriver({
          url: this.config.site.url,
          probeIntervalMs: this.config.site.probeIntervalMs,
          probeTimeoutMs: this.config.site.probeTimeoutMs,
        }),
        log.child("site"),
        { enabled: true },
      );
      this.obsDriver = new ObsDriver({ url: this.config.obs.url, password: this.config.obs.password });
      this.obs = new ManagedConnection("obs", this.obsDriver, log.child("obs"), { enabled: this.config.obs.enabled });

      const token = loadOrCreateControlToken(join(this.config.dataDir, "control-token"));
      this.control = new ControlServer(this.controlApi(), token, log.child("control"));

      for (const runtime of this.modules) await this.startModule(runtime);

      const port = await this.control.listen(this.config.control.port, this.config.control.host);
      this.lock.update({ controlPort: port });
      log.info("API local disponível", { url: `http://127.0.0.1:${port}` });

      this.site.start();
      this.obs.start();
      this.processor.start();
      this.heartbeat = setInterval(() => this.beat(), this.config.heartbeatMs);
      this.beat();

      this.startedAt = Date.now();
      this.lifecycle = "running";
      const backlog = this.store.stats().backlogByType;
      const handled = new Set(this.processor.handledTypes());
      const orphan = Object.keys(backlog).filter((type) => !handled.has(type));
      if (orphan.length) log.warn("Há eventos na fila sem módulo carregado; eles aguardam preservados", { tipos: orphan });
      log.info("Agente em execução", { runId: this.runInfo.runId });
    } catch (error) {
      this.lifecycle = "failed";
      if (error instanceof AlreadyRunningError) log.warn("Início recusado: outra instância já está em execução", { ...error.info });
      else log.error("Falha ao iniciar o agente", { error });
      await this.teardown("falha na inicialização", false);
      throw error;
    }
  }

  private beginRun(): RunInfo {
    const state = this.state!;
    const previous = state.get<{ state: string; stoppedAt?: number; heartbeatAt?: number; stopReason?: string }>("run.current");
    let previousRun: RunInfo["previousRun"] = null;
    if (previous) {
      const clean = previous.state === "stopped";
      previousRun = {
        cleanShutdown: clean,
        stoppedAt: previous.stoppedAt ?? null,
        lastHeartbeatAt: previous.heartbeatAt ?? null,
        stopReason: previous.stopReason ?? null,
      };
      if (!clean) {
        this.log.warn("A execução anterior terminou sem encerramento controlado", {
          ultimoSinalDeVida: previous.heartbeatAt ? new Date(previous.heartbeatAt).toISOString() : null,
        });
        state.set("run.lastUncleanShutdown", { detectedAt: Date.now(), lastHeartbeatAt: previous.heartbeatAt ?? null });
      }
    }
    const recovery = this.store!.recoverInterrupted();
    if (recovery.recovered || recovery.failed) {
      this.log.warn("Eventos interrompidos foram recuperados", recovery);
    }
    const runId = (state.get<number>("run.count") ?? 0) + 1;
    state.set("run.count", runId);
    state.set("run.current", {
      runId,
      state: "running",
      pid: process.pid,
      version: AGENT_VERSION,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    });
    return { runId, previousRun, recovery };
  }

  private beat() {
    if (!this.state) return;
    try {
      const current = this.state.get<Record<string, unknown>>("run.current") ?? {};
      this.state.set("run.current", { ...current, heartbeatAt: Date.now() });
    } catch (error) {
      this.log.error("Falha ao registrar sinal de vida", { error });
    }
  }

  private moduleContext(module: AgentModule): ModuleContext {
    return {
      config: this.config,
      log: this.log.child(module.name),
      state: scopedState(this.state!, module.name),
      events: {
        record: (event) => this.recordEvent({ ...event, source: event.source ?? module.name }),
        handle: (type, handler, options) => this.processor!.register(type, handler, options),
        store: this.store!,
      },
      connections: { site: this.site!, obs: this.obs!, obsDriver: this.obsDriver! },
      db: this.db!,
      services: {
        provide: (name, service) => {
          if (this.services.has(name)) throw new Error(`Serviço "${name}" já registrado`);
          this.services.set(name, service);
        },
        get: <T,>(name: string) => this.services.get(name) as T | undefined,
      },
      control: {
        route: (method, path, handler, options) =>
          this.control!.addRoute(method, `/modules/${module.name}${path}`, handler, options?.requireToken),
      },
    };
  }

  private async startModule(runtime: ModuleRuntime) {
    try {
      await runtime.module.start(this.moduleContext(runtime.module));
      runtime.state = "running";
      this.log.info("Módulo iniciado", { module: runtime.module.name });
    } catch (error) {
      // Um módulo com defeito não derruba o núcleo: fica marcado como failed no /status.
      runtime.state = "failed";
      runtime.error = (error as Error).message;
      this.log.error("Módulo falhou ao iniciar", { module: runtime.module.name, error });
    }
  }

  /** Persiste o evento e só então sinaliza o processador. */
  recordEvent(input: NewEvent) {
    const result = this.events.record(input);
    if (result.created) {
      this.log.info("Evento registrado", { id: result.event.id, type: result.event.type, dedupeKey: result.event.dedupeKey });
      this.processor?.kick();
    } else {
      this.log.info("Evento duplicado ignorado", { id: result.event.id, type: result.event.type, dedupeKey: result.event.dedupeKey });
    }
    return result;
  }

  private controlApi() {
    return {
      health: () => ({
        ok: this.lifecycle === "running",
        name: AGENT_NAME,
        version: AGENT_VERSION,
        state: this.lifecycle,
        pid: process.pid,
      }),
      status: () => this.status(),
      listEvents: (filter: Parameters<EventStore["list"]>[0]) => this.events.list(filter),
      getEvent: (id: string) => {
        const event = this.events.get(id);
        return event ? { event, attempts: this.events.attempts(id) } : null;
      },
      recordEvent: (input: NewEvent) => this.recordEvent(input),
      retryEvent: (id: string) => {
        const ok = this.events.requeue(id);
        if (ok) {
          this.log.info("Evento reenfileirado manualmente", { id });
          this.processor?.kick();
        }
        return ok;
      },
      shutdown: (reason: string) => this.onStopRequested(reason),
    };
  }

  status() {
    const now = Date.now();
    return {
      agent: {
        name: AGENT_NAME,
        version: AGENT_VERSION,
        state: this.lifecycle,
        pid: process.pid,
        node: process.version,
        startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : null,
        uptimeSeconds: this.startedAt ? Math.round((now - this.startedAt) / 1000) : 0,
        runId: this.runInfo?.runId ?? null,
        dataDir: this.config.dataDir,
        controlPort: this.controlPort,
        memoryMb: Math.round(process.memoryUsage().rss / 1_048_576),
      },
      previousRun: this.runInfo?.previousRun ?? null,
      recoveryAtStartup: this.runInfo?.recovery ?? null,
      events: this.store?.stats() ?? null,
      processor: this.processor?.stats() ?? null,
      connections: [this.site?.snapshot(), this.obs?.snapshot()].filter(Boolean),
      modules: this.modules.map((runtime) => ({
        name: runtime.module.name,
        state: runtime.state,
        error: runtime.error,
        health: runtime.state === "running" ? (runtime.module.health?.() ?? { ok: true }) : null,
      })),
    };
  }

  lifecycleState() {
    return this.lifecycle;
  }

  /** Encerramento controlado e idempotente. */
  stop(reason = "pedido de encerramento"): Promise<void> {
    if (!this.stopPromise) {
      this.stopPromise = (async () => {
        if (this.lifecycle === "created" || this.lifecycle === "stopped") return;
        this.lifecycle = "stopping";
        this.log.info("Encerrando agente", { motivo: reason });
        await this.teardown(reason, true);
        this.lifecycle = "stopped";
        this.log.info("Agente encerrado", { motivo: reason });
      })();
    }
    return this.stopPromise;
  }

  private async teardown(reason: string, clean: boolean) {
    const step = async (name: string, fn: () => unknown) => {
      try {
        await fn();
      } catch (error) {
        this.log.error(`Falha ao encerrar ${name}`, { error });
      }
    };
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    await step("API local", () => this.control?.close());
    await step("processador", async () => {
      const result = await this.processor?.stop(this.config.events.shutdownDrainMs);
      if (result && !result.drained) clean = false;
    });
    for (const runtime of [...this.modules].reverse()) {
      if (runtime.state !== "running") continue;
      await step(`módulo ${runtime.module.name}`, async () => {
        await runtime.module.stop?.();
        runtime.state = "stopped";
      });
    }
    await step("conexão com o OBS", () => this.obs?.stop());
    await step("conexão com o site", () => this.site?.stop());
    await step("estado", () => {
      if (!this.state || !clean) return;
      const current = this.state.get<Record<string, unknown>>("run.current") ?? {};
      this.state.set("run.current", { ...current, state: "stopped", stoppedAt: Date.now(), stopReason: reason });
    });
    await step("base local", () => {
      this.db?.close();
      this.db = null;
    });
    await step("lock", () => this.lock.release());
  }
}

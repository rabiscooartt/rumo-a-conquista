import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigError, loadConfig, type AgentConfig } from "./config.ts";
import { TOKEN_HEADER } from "./control/controlServer.ts";
import { Agent } from "./core/agent.ts";
import { AlreadyRunningError, readLiveLock } from "./core/instanceLock.ts";
import { EVENT_STATUSES, EventStore, type AgentEvent, type EventStatus } from "./events/eventStore.ts";
import { consoleSink, createLogger, fileSink, pruneLogs } from "./logger.ts";
import { defaultModules } from "./modules/index.ts";
import { openDatabase, type SqlDatabase } from "./store/database.ts";
import { StateStore } from "./store/stateStore.ts";
import { CatalogCache, type CatalogSnapshot } from "./modules/games/catalog.ts";
import { applyMapping } from "./modules/games/index.ts";
import { operatorUnlockEvent } from "./modules/achievements/index.ts";
import { GameRepository, type GameSession } from "./modules/games/repository.ts";
import { AGENT_NAME, AGENT_VERSION } from "./version.ts";

const EXIT = { ok: 0, error: 1, usage: 2, alreadyRunning: 3, notRunning: 4 } as const;

const HELP = `${AGENT_NAME} ${AGENT_VERSION} — agente Windows do Rumo à Conquista

Uso: npm run agent -- <comando> [opções]

  start                       Inicia o agente (modo contínuo; Ctrl+C encerra de forma controlada)
  stop                        Pede encerramento controlado ao agente em execução
  status [--json]             Estado operacional (agente em execução ou último estado salvo)
  events [--status S] [--type T] [--limit N] [--json]
                              Lista eventos (S: ${EVENT_STATUSES.join(", ")})
  event <id>                  Detalhes de um evento e histórico de tentativas
  emit <tipo> [payloadJSON] [--dedupe CHAVE] [--test]
                              Registra um evento (ex.: emit agent.diagnostic '{"message":"oi"}')
  retry <id>                  Reenfileira um evento em failed
  games [status]              Jogo detectado agora, sessão ativa e catálogo
  games sessions [--limit N]  Sessões de jogo registradas
  games map <chave> <slug>    Associa uma detecção a um jogo do catálogo
                              (chave: steam:<appid>, exe:<nome.exe> ou emulator:<id>[|conteúdo])
  games ignore <chave>        Ignora uma detecção (ex.: app Steam que não é jogo)
  games unmap <chave>         Remove um mapeamento
  games mappings              Lista mapeamentos (manuais e automáticos)
  games correct <slug> [--remember]
                              Corrige o jogo da sessão ativa (prevalece sobre a detecção)
  games catalog [--refresh]   Jogos do catálogo do site em cache local
  achievements [status]       Fontes de conquistas, leituras recentes e envios ao site
  achievements scan           Relê agora a fonte do jogo em sessão e reconcilia as conhecidas
  achievements unlock <slug> <id-da-conquista-no-site> [--test]
  achievements custom <slug> (--id ID | --name "Nome" [--description "..."]) [--test]
                              Desbloqueio CUSTOM: escolhida da lista do site (--id) ou pelo nome
                              Desbloqueio informado pelo operador (jogos sem fonte automática)
  alerts [--status S] [--json]  Fila de alertas (pending, processing, retry_wait, completed, failed, expired)
  alerts retry <id>           Reenfileira um alerta em failed ou expired
  overlay [status]            Overlays conectados e apresentações feitas
  overlay test [--mastery]    Apresentação de teste isolada (sem fila, sem conquista, sem dados)
  mastery [status]            Verificações e Maestrias recentes
  mastery test [<slug>]       Maestria de TESTE pela fila protegida e pelo overlay (sem site, sem progresso)
  clips [status]              Buffer de replay do OBS, pasta e contagens de clips
  clips list                  Clips recentes (estado, arquivo, erro)
  clips test                  Clip de TESTE: salva um replay real na subpasta "testes" (sem evento)
  moments [list]              Momentos marcados pelo atalho (para revisão)
  moments mark [--note "..."] Marca um momento agora (o mesmo que o atalho do aplicativo)
  version                     Mostra a versão

Opções globais:
  --data-dir PASTA            Pasta de dados (padrão: %LOCALAPPDATA%\\RumoAConquista\\agent
                              ou RUMO_AGENT_DATA_DIR)
`;

type Args = { command: string; positional: string[]; flags: Record<string, string | true> };

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  const booleans = new Set(["json", "test", "help"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const [key, inline] = arg.slice(2).split("=", 2);
      if (inline !== undefined) flags[key] = inline;
      else if (booleans.has(key) || i + 1 >= argv.length || argv[i + 1].startsWith("--")) flags[key] = true;
      else flags[key] = argv[++i];
    } else {
      positional.push(arg);
    }
  }
  return { command: positional.shift() ?? "help", positional, flags };
}

function flag(args: Args, name: string) {
  const value = args.flags[name];
  return typeof value === "string" ? value : undefined;
}

function configFor(args: Args): AgentConfig {
  return loadConfig({ dataDir: flag(args, "data-dir") });
}

function readToken(config: AgentConfig) {
  const path = join(config.dataDir, "control-token");
  return existsSync(path) ? readFileSync(path, "utf8").trim() : "";
}

async function callAgent(config: AgentConfig, method: string, path: string, body?: unknown, timeoutMs = 10_000) {
  const lock = readLiveLock(join(config.dataDir, "agent.lock"));
  if (!lock?.controlPort) return null;
  const response = await fetch(`http://127.0.0.1:${lock.controlPort}${path}`, {
    method,
    headers: { "content-type": "application/json", [TOKEN_HEADER]: readToken(config) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok && response.status !== 409) throw new Error(String(json.error ?? `HTTP ${response.status}`));
  return { status: response.status, json };
}

/** Acesso direto à base quando o agente não está em execução (diagnóstico offline). */
function withOfflineStore<T>(config: AgentConfig, fn: (store: EventStore, state: StateStore, db: SqlDatabase) => T): T {
  const db = openDatabase(config.dbPath);
  let async = false;
  try {
    const store = new EventStore(db, {
      maxAttempts: config.events.maxAttempts,
      retryBaseMs: config.events.retryBaseMs,
      retryMaxMs: config.events.retryMaxMs,
    });
    const result = fn(store, new StateStore(db), db);
    if (result instanceof Promise) {
      // Operações assíncronas (ex.: atualizar o catálogo) mantêm a base aberta até terminar.
      async = true;
      return result.finally(() => db.close()) as T;
    }
    return result;
  } finally {
    if (!async) db.close();
  }
}

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
const iso = (value: unknown) => (typeof value === "number" ? new Date(value).toISOString() : (value ?? "—"));

type AgentStatus = ReturnType<Agent["status"]>;

function printStatusSummary(status: AgentStatus) {
  const agent = status.agent;
  console.log(`Agente ${agent.name} ${agent.version} — ${agent.state.toUpperCase()} (PID ${agent.pid}, ${agent.uptimeSeconds}s, run #${agent.runId})`);
  console.log(`  Dados: ${agent.dataDir}   API: http://127.0.0.1:${agent.controlPort}`);
  if (status.previousRun && !status.previousRun.cleanShutdown) {
    console.log(`  Atenção: a execução anterior terminou sem encerramento controlado.`);
  }
  const rec = status.recoveryAtStartup;
  if (rec && (rec.recovered || rec.failed)) console.log(`  Recuperados no início: ${rec.recovered} (falhas definitivas: ${rec.failed})`);
  const ev = status.events;
  if (ev) {
    console.log(`  Eventos: ${Object.entries(ev.byStatus).map(([k, v]) => `${k}=${v}`).join("  ")}`);
    if (Object.keys(ev.backlogByType).length) console.log(`  Fila por tipo: ${JSON.stringify(ev.backlogByType)}`);
  }
  const proc = status.processor;
  if (proc) {
    console.log(`  Processador: tipos=${proc.handledTypes.join(",") || "—"} concluídos=${proc.completed} retries=${proc.retried} falhas=${proc.failed}`);
    if (proc.lastError) console.log(`  Último erro: [${proc.lastError.type}] ${proc.lastError.message}`);
  }
  for (const conn of status.connections) {
    if (!conn) continue;
    const extra = conn.lastError ? ` — ${conn.lastError}` : "";
    console.log(`  Conexão ${conn.name}: ${conn.state}${extra}`);
  }
  for (const mod of status.modules) console.log(`  Módulo ${mod.name}: ${mod.state}${mod.error ? ` — ${mod.error}` : ""}`);
}

async function commandStart(args: Args) {
  const config = configFor(args);
  pruneLogs(config.logDir, config.logRetentionDays);
  const log = createLogger({ level: config.logLevel, sinks: [consoleSink, fileSink(config.logDir)] });
  let exiting = false;
  const exit = (code: number) => {
    if (exiting) return;
    exiting = true;
    process.exitCode = code;
    // Dá tempo ao stdout de esvaziar; nenhum timer do agente segura o processo após o stop.
    setTimeout(() => process.exit(code), 200).unref();
  };

  const agent = new Agent({
    config,
    log,
    modules: defaultModules(),
    onStopRequested: (reason) => void agent.stop(reason).then(() => exit(EXIT.ok)),
  });

  let signals = 0;
  const onSignal = (signal: NodeJS.Signals) => {
    signals += 1;
    if (signals > 1) {
      log.warn("Segundo sinal recebido: saída imediata (eventos em andamento serão recuperados no próximo início)");
      process.exit(EXIT.error);
    }
    void agent.stop(`sinal ${signal}`).then(() => exit(EXIT.ok));
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"] as NodeJS.Signals[]) process.on(signal, onSignal);

  process.on("uncaughtException", (error) => {
    log.error("Erro não tratado; encerrando de forma controlada", { error });
    void agent.stop("erro não tratado").finally(() => exit(EXIT.error));
  });
  process.on("unhandledRejection", (reason) => {
    log.error("Promise rejeitada sem tratamento", { error: reason instanceof Error ? reason : String(reason) });
  });

  try {
    await agent.start();
  } catch (error) {
    if (error instanceof AlreadyRunningError) {
      console.error(error.message);
      return exit(EXIT.alreadyRunning);
    }
    return exit(EXIT.error);
  }
}

async function commandStatus(args: Args, config: AgentConfig) {
  const remote = await callAgent(config, "GET", "/status").catch((error) => {
    console.error(`Agente parece em execução, mas a API local não respondeu: ${(error as Error).message}`);
    return null;
  });
  if (remote) {
    if (args.flags.json) print(remote.json);
    else printStatusSummary(remote.json as unknown as AgentStatus);
    return EXIT.ok;
  }
  const offline = withOfflineStore(config, (store, state) => ({
    running: false,
    dataDir: config.dataDir,
    lastRun: state.get("run.current") ?? null,
    lastUncleanShutdown: state.get("run.lastUncleanShutdown") ?? null,
    events: store.stats(),
  }));
  if (args.flags.json) print(offline);
  else {
    const last = offline.lastRun as Record<string, unknown> | null;
    console.log(`Agente NÃO está em execução. Dados: ${config.dataDir}`);
    if (last) {
      console.log(`  Última execução: run #${last.runId} v${last.version}, estado salvo "${last.state}", último sinal de vida ${iso(last.heartbeatAt)}`);
      if (last.state !== "stopped") console.log("  Ela terminou sem encerramento controlado; o próximo início fará a recuperação.");
    }
    console.log(`  Eventos: ${Object.entries(offline.events.byStatus).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  }
  return EXIT.notRunning;
}

async function commandEvents(args: Args, config: AgentConfig) {
  const status = flag(args, "status") as EventStatus | undefined;
  if (status && !EVENT_STATUSES.includes(status)) throw new Error(`status inválido: ${status}`);
  const type = flag(args, "type");
  const limit = Number(flag(args, "limit") ?? 20);
  const query = new URLSearchParams({ limit: String(limit), ...(status ? { status } : {}), ...(type ? { type } : {}) });
  const remote = await callAgent(config, "GET", `/events?${query}`);
  const events = (remote?.json.events as AgentEvent[] | undefined) ?? withOfflineStore(config, (store) => store.list({ status, type, limit }));
  if (args.flags.json) return print(events);
  if (!events.length) return console.log("Nenhum evento.");
  for (const e of events) {
    const error = e.lastError ? `  erro: ${e.lastError}` : "";
    console.log(`${iso(e.createdAt)}  ${e.status.padEnd(10)} ${e.type}  tentativas=${e.attempts}/${e.maxAttempts}${e.isTest ? "  [teste]" : ""}  id=${e.id}${error}`);
  }
}

async function commandEvent(args: Args, config: AgentConfig) {
  const id = args.positional[0];
  if (!id) throw new Error("Informe o id do evento");
  const remote = await callAgent(config, "GET", `/events/${encodeURIComponent(id)}`).catch(() => null);
  const found =
    remote?.json ??
    withOfflineStore(config, (store) => {
      const event = store.get(id);
      return event ? { event, attempts: store.attempts(id) } : null;
    });
  if (!found) {
    console.error("Evento não encontrado");
    return EXIT.error;
  }
  print(found);
}

async function commandEmit(args: Args, config: AgentConfig) {
  const [type, payloadText] = args.positional;
  if (!type) throw new Error("Informe o tipo do evento (ex.: agent.diagnostic)");
  let payload: unknown = {};
  if (payloadText) {
    try {
      payload = JSON.parse(payloadText);
    } catch {
      throw new Error("payload deve ser JSON válido");
    }
  }
  const input = { type, payload, dedupeKey: flag(args, "dedupe"), isTest: Boolean(args.flags.test), source: "cli" };
  const remote = await callAgent(config, "POST", "/events", input);
  const result = remote ? (remote.json as { created: boolean; event: { id: string; status: string } }) : withOfflineStore(config, (store) => store.record(input));
  const where = remote ? "pelo agente em execução" : "direto na base (agente parado; será processado no próximo início)";
  console.log(result.created ? `Evento registrado ${where}: ${result.event.id}` : `Duplicado: já existia o evento ${result.event.id} (${result.event.status})`);
}

async function commandRetry(args: Args, config: AgentConfig) {
  const id = args.positional[0];
  if (!id) throw new Error("Informe o id do evento");
  const remote = await callAgent(config, "POST", `/events/${encodeURIComponent(id)}/retry`);
  const ok = remote ? remote.status === 200 : withOfflineStore(config, (store) => store.requeue(id));
  console.log(ok ? "Evento reenfileirado." : "Só eventos em failed podem ser reenfileirados.");
  return ok ? EXIT.ok : EXIT.error;
}

function printSessions(sessions: GameSession[]) {
  if (!sessions.length) return console.log("Nenhuma sessão registrada.");
  for (const session of sessions) {
    const end = session.endedAt ?? session.lastSeenAt;
    const minutes = Math.round((end - session.startedAt) / 60_000);
    const state = session.endedAt ? `encerrada (${session.endReason})` : "ABERTA";
    console.log(`${iso(session.startedAt)}  ${String(minutes).padStart(4)} min  ${state.padEnd(24)} ${session.title}${session.slug ? ` [${session.slug}]` : " [sem jogo no catálogo]"}  ${session.detectionKey}`);
  }
}

async function commandGames(args: Args, config: AgentConfig) {
  const sub = args.positional[0] ?? "status";
  const remote = (method: string, path: string, body?: unknown) => callAgent(config, method, `/modules/games${path}`, body);
  const offline = <T>(fn: (repo: GameRepository, catalog: CatalogCache, state: StateStore) => T) =>
    withOfflineStore(config, (_store, state, db) => {
      const repo = new GameRepository(db);
      return fn(repo, new CatalogCache({ siteUrl: config.site.url, state, log: createLogger({ level: "error", sinks: [] }) }), state);
    });

  if (sub === "status") {
    const result = await remote("GET", "/status");
    if (!result) {
      console.log("Agente NÃO está em execução; mostrando a última sessão registrada.");
      return offline((repo) => printSessions(repo.sessions(1)));
    }
    if (args.flags.json) return print(result.json);
    type Game = { title: string; slug: string | null; key: string; resolvedBy: string };
    const st = result.json as unknown as {
      enabled: boolean;
      current: Game | null;
      detections: Game[];
      pendingStart: { identity: string } | null;
      activeSession: GameSession | null;
      catalog: { games: number; fetchedAt: number | null; lastError: string | null };
      warnings: string[];
      lastScanAt: string | null;
      lastScanMs: number | null;
    };
    if (!st.enabled) return console.log("Identificação de jogos desativada.");
    const cur = st.current;
    console.log(cur ? `Jogo detectado: ${cur.title}${cur.slug ? ` [${cur.slug}]` : " [sem jogo no catálogo]"} — ${cur.key} (${cur.resolvedBy})` : "Nenhum jogo detectado.");
    for (const d of st.detections.slice(1)) console.log(`  também em execução: ${d.title} — ${d.key}`);
    if (st.pendingStart) console.log(`  Aguardando confirmação para abrir sessão: ${st.pendingStart.identity}`);
    const s = st.activeSession;
    console.log(s ? `Sessão ativa: ${s.title} desde ${iso(s.startedAt)} (id ${s.id})` : "Nenhuma sessão ativa.");
    console.log(`Catálogo: ${st.catalog.games} jogos (atualizado ${iso(st.catalog.fetchedAt)})${st.catalog.lastError ? ` — erro: ${st.catalog.lastError}` : ""}`);
    if (st.warnings.length) console.log(`Avisos: ${st.warnings.join("; ")}`);
    console.log(`Última varredura: ${st.lastScanAt} (${st.lastScanMs} ms)`);
    return;
  }
  if (sub === "sessions") {
    const limit = Number(flag(args, "limit") ?? 20);
    const result = await remote("GET", `/sessions?limit=${limit}`);
    const sessions = (result?.json.sessions as GameSession[] | undefined) ?? offline((repo) => repo.sessions(limit));
    return args.flags.json ? print(sessions) : printSessions(sessions);
  }
  if (sub === "mappings") {
    const result = await remote("GET", "/mappings");
    const mappings = (result?.json.mappings as unknown[] | undefined) ?? offline((repo) => repo.mappings());
    return print(mappings);
  }
  if (sub === "catalog") {
    if (args.flags.refresh) {
      const result = await remote("POST", "/catalog/refresh");
      if (!result) await offline((_repo, catalog) => catalog.refresh());
    }
    const result = await remote("GET", "/catalog");
    const info = (result?.json as unknown as CatalogSnapshot | undefined) ?? offline((_r, _c, state) => state.get<CatalogSnapshot>("catalog") ?? { fetchedAt: null, games: [] });
    if (args.flags.json) return print(info);
    console.log(`Catálogo (${info.games.length} jogos, atualizado ${iso(info.fetchedAt)}):`);
    for (const g of info.games) console.log(`  ${g.slug.padEnd(36)} ${g.title}  (${g.platform ?? "?"}, ${g.status ?? "?"})`);
    return;
  }
  if (sub === "correct") {
    const slug = args.positional[1];
    if (!slug) throw new Error("Informe o slug do jogo correto");
    const result = await remote("POST", "/session/correct", { slug, remember: Boolean(args.flags.remember) });
    if (!result) throw new Error("O agente precisa estar em execução para corrigir a sessão ativa.");
    if (result.status !== 200) throw new Error(String(result.json.error ?? `HTTP ${result.status}`));
    const r = result.json as { session: { title: string; id: string }; remembered: string | null };
    console.log(`Sessão ${r.session.id} corrigida para ${r.session.title}${r.remembered ? ` (lembrado para ${r.remembered})` : ""}.`);
    return;
  }
  if (sub === "map" || sub === "ignore" || sub === "unmap") {
    const [, key, slug] = args.positional;
    if (!key) throw new Error("Informe a chave (steam:<appid>, exe:<nome.exe> ou emulator:<id>)");
    const input = { key, slug, ignore: sub === "ignore", remove: sub === "unmap" };
    const result = await remote("POST", "/mappings", input);
    const out = result ? result.json : offline((repo, catalog) => applyMapping(repo, catalog, input));
    return print(out);
  }
  throw new Error(`Subcomando desconhecido: games ${sub}`);
}

async function commandAchievements(args: Args, config: AgentConfig) {
  const sub = args.positional[0] ?? "status";
  const remote = (method: string, path: string, body?: unknown) => callAgent(config, method, `/modules/achievements${path}`, body);
  if (sub === "unlock") {
    const [, slug, achievementId] = args.positional;
    const input = { slug, achievementId, isTest: Boolean(args.flags.test) };
    const result = await remote("POST", "/unlock", input);
    const out = result
      ? (result.json as { created: boolean; event: { id: string; status: string } })
      : withOfflineStore(config, (store) => store.record(operatorUnlockEvent(input)));
    console.log(out.created ? `Desbloqueio registrado: ${out.event.id}${result ? "" : " (agente parado: será enviado no próximo início)"}` : `Já registrado antes: ${out.event.id} (${out.event.status})`);
    return;
  }
  if (sub === "custom") {
    const slug = args.positional[1];
    const input = { slug, achievementId: flag(args, "id"), name: flag(args, "name"), description: flag(args, "description"), isTest: Boolean(args.flags.test) };
    const result = await remote("POST", "/custom", input);
    if (!result) throw new Error("O agente precisa estar em execução para registrar a conquista CUSTOM.");
    if (result.status >= 400) throw new Error(String(result.json.error ?? `HTTP ${result.status}`));
    const r = result.json as { created: boolean; event: { id: string; status: string }; resolvedAs: string };
    console.log(r.created ? `Desbloqueio CUSTOM registrado (${r.resolvedAs}): ${r.event.id}` : `Já registrado antes: ${r.event.id} (${r.event.status})`);
    return;
  }
  if (sub === "scan") {
    const result = await remote("POST", "/scan");
    if (!result) throw new Error("O agente precisa estar em execução para ler as fontes.");
    return print(result.json);
  }
  if (sub === "status") {
    const result = await remote("GET", "/status");
    const events = withOfflineStore(config, (store) => store.list({ type: "achievement.unlocked", limit: Number(flag(args, "limit") ?? 15) }));
    if (args.flags.json) return print({ module: result?.json ?? null, events });
    if (result) {
      const st = result.json as { providers: string[]; tokenConfigured: boolean; sources: Array<Record<string, unknown>>; lastError: string | null };
      console.log(`Provedores: ${st.providers.join(", ")}   Token do site: ${st.tokenConfigured ? "configurado" : "NÃO configurado"}`);
      for (const src of st.sources) {
        console.log(`  ${src.provider} ${src.sourceKey}: ${src.unlocked}/${src.total} desbloqueadas, ${src.emitted} enviadas como evento, lida ${iso(src.lastReadAt)}${src.lastError ? ` — erro: ${src.lastError}` : ""}`);
      }
      if (st.lastError) console.log(`Último erro: ${st.lastError}`);
    } else {
      console.log("Agente NÃO está em execução; mostrando os eventos gravados.");
    }
    if (!events.length) return console.log("Nenhum desbloqueio registrado.");
    console.log("Desbloqueios:");
    for (const e of events) {
      const p = e.payload as { gameSlug?: string; externalId?: string; name?: string; timestampKind?: string; unlockedAt?: string };
      const err = e.lastError ? `  erro: ${e.lastError}` : "";
      console.log(`  ${e.status.padEnd(10)} ${p.gameSlug ?? "?"} / ${p.externalId}${p.name ? ` (${p.name})` : ""}  ${p.timestampKind === "source" ? "data da fonte" : "data da detecção"} ${p.unlockedAt}${e.isTest ? " [teste]" : ""}  id=${e.id}${err}`);
    }
    return;
  }
  throw new Error(`Subcomando desconhecido: achievements ${sub}`);
}

async function commandAlerts(args: Args, config: AgentConfig) {
  const sub = args.positional[0] ?? "list";
  if (sub === "retry") {
    const id = args.positional[1];
    if (!id) throw new Error("Informe o id do alerta");
    const result = await callAgent(config, "POST", "/modules/alerts/retry", { id });
    if (!result) throw new Error("O agente precisa estar em execução para reenfileirar alertas.");
    console.log(result.status === 200 ? "Alerta reenfileirado." : String(result.json.error));
    return result.status === 200 ? EXIT.ok : EXIT.error;
  }
  const status = flag(args, "status");
  const query = new URLSearchParams({ limit: String(flag(args, "limit") ?? 20), ...(status ? { status } : {}) });
  const [list, summary] = await Promise.all([
    callAgent(config, "GET", `/modules/alerts/list?${query}`),
    callAgent(config, "GET", "/modules/alerts/status"),
  ]);
  if (!list) throw new Error("O agente precisa estar em execução para consultar a fila de alertas.");
  if (args.flags.json) return print({ summary: summary?.json, alerts: list.json.alerts });
  const s = summary?.json as { presenter: string | null; counts: Record<string, number> } | undefined;
  if (s) console.log(`Apresentador: ${s.presenter ?? "nenhum"}   ${Object.entries(s.counts).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  const alerts = list.json.alerts as Array<{ id: string; status: string; gameSlug: string | null; subjectId: string | null; title: string | null; attempts: number; isTest: boolean; createdAt: number; lastError: string | null }>;
  if (!alerts.length) return console.log("Nenhum alerta.");
  for (const a of alerts) {
    console.log(`${iso(a.createdAt)}  ${a.status.padEnd(10)} ${a.gameSlug ?? "?"} / ${a.subjectId}${a.title ? ` (${a.title})` : ""}  tentativas=${a.attempts}${a.isTest ? " [teste]" : ""}  id=${a.id}${a.lastError ? `  erro: ${a.lastError}` : ""}`);
  }
}

async function commandOverlay(args: Args, config: AgentConfig) {
  const sub = args.positional[0] ?? "status";
  if (sub !== "status" && sub !== "test") throw new Error(`Subcomando desconhecido: overlay ${sub}`);
  const body = sub === "test" ? { kind: args.flags.mastery ? "mastery" : "achievement" } : undefined;
  const result = await callAgent(config, sub === "test" ? "POST" : "GET", `/modules/overlay/${sub}`, body, 30_000).catch((error: Error) => {
    console.error(error.message);
    return { status: 0, json: { error: error.message } as Record<string, unknown> };
  });
  if (!result) throw new Error("O agente precisa estar em execução.");
  if (result.status === 0) return EXIT.error;
  if (result.status !== 200) {
    console.error(String(result.json.error ?? `HTTP ${result.status}`));
    return EXIT.error;
  }
  if (args.flags.json || sub === "status") return print(result.json);
  const r = result.json as { startedAfterMs: number; totalMs: number };
  console.log(`Teste concluído: overlay confirmou o início em ${r.startedAfterMs} ms e o fim em ${r.totalMs} ms.`);
}

async function commandMastery(args: Args, config: AgentConfig) {
  const sub = args.positional[0] ?? "status";
  if (sub !== "status" && sub !== "test") throw new Error(`Subcomando desconhecido: mastery ${sub}`);
  const result = sub === "test"
    ? await callAgent(config, "POST", "/modules/mastery/test", { slug: args.positional[1] })
    : await callAgent(config, "GET", "/modules/mastery/status");
  if (!result) throw new Error("O agente precisa estar em execução.");
  if (result.status >= 400) {
    console.error(String(result.json.error ?? `HTTP ${result.status}`));
    return EXIT.error;
  }
  if (args.flags.json || sub === "status") return print(result.json);
  const r = result.json as { event: { id: string } };
  console.log(`Maestria de teste na fila protegida: ${r.event.id}. Acompanhe com: npm run agent -- alerts`);
}

async function commandClips(args: Args, config: AgentConfig) {
  const sub = args.positional[0] ?? "status";
  if (!["status", "list", "test"].includes(sub)) throw new Error(`Subcomando desconhecido: clips ${sub}`);
  const result =
    sub === "test"
      ? await callAgent(config, "POST", "/modules/clips/test", {})
      : await callAgent(config, "GET", sub === "list" ? "/modules/clips/list" : "/modules/clips/status?refresh=1");
  if (!result) throw new Error("O agente precisa estar em execução.");
  if (result.status >= 400) {
    console.error(String(result.json.error ?? `HTTP ${result.status}`));
    return EXIT.error;
  }
  if (args.flags.json || sub === "status") return print(result.json);
  if (sub === "test") {
    const r = result.json as { clip: { id: string }; dir: string | null };
    console.log(`Clip de teste agendado (${r.clip.id}); será salvo em ${r.dir ?? "?"} (subpasta testes). Acompanhe com: npm run agent -- clips list`);
    return;
  }
  const clips = result.json.clips as Array<{ id: string; status: string; kind: string; title: string | null; isTest: boolean; eventAt: number; filePath: string | null; lastError: string | null }>;
  if (!clips.length) return console.log("Nenhum clip.");
  for (const c of clips) {
    console.log(`${iso(c.eventAt)}  ${c.status.padEnd(9)} ${c.kind} ${c.title ?? ""}${c.isTest ? " [teste]" : ""}  ${c.filePath ?? c.lastError ?? ""}  id=${c.id}`);
  }
}

async function commandMoments(args: Args, config: AgentConfig) {
  const sub = args.positional[0] ?? "list";
  if (sub !== "list" && sub !== "mark") throw new Error(`Subcomando desconhecido: moments ${sub}`);
  const result =
    sub === "mark"
      ? await callAgent(config, "POST", "/modules/moments/mark", { source: "cli", note: flag(args, "note") })
      : await callAgent(config, "GET", "/modules/moments/list");
  if (!result) throw new Error("O agente precisa estar em execução.");
  if (result.status >= 400) {
    console.error(String(result.json.error ?? `HTTP ${result.status}`));
    return EXIT.error;
  }
  if (args.flags.json) return print(result.json);
  if (sub === "mark") {
    const r = result.json as { created: boolean; moment: { id: string; gameTitle: string | null } };
    console.log(r.created ? `Momento marcado (${r.moment.gameTitle ?? "sem jogo identificado"}): ${r.moment.id}` : "Momento já marcado há instantes (ignorado).");
    return;
  }
  const r = result.json as { pending: number; moments: Array<{ id: string; markedAt: number; gameTitle: string | null; status: string; clipId: string | null; note: string | null }> };
  if (!r.moments.length) return console.log("Nenhum momento marcado.");
  console.log(`${r.pending} para revisar`);
  for (const m of r.moments) console.log(`${iso(m.markedAt)}  ${m.status.padEnd(9)} ${m.gameTitle ?? "—"}${m.note ? ` "${m.note}"` : ""}  clip=${m.clipId ?? "—"}  id=${m.id}`);
}

async function commandStop(config: AgentConfig) {
  const lockPath = join(config.dataDir, "agent.lock");
  const lock = readLiveLock(lockPath);
  if (!lock) {
    console.log("Agente não está em execução.");
    return EXIT.notRunning;
  }
  await callAgent(config, "POST", "/shutdown");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (!readLiveLock(lockPath)) {
      console.log(`Agente (PID ${lock.pid}) encerrado.`);
      return EXIT.ok;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.error("O agente não encerrou em 30 s.");
  return EXIT.error;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.help || args.command === "help") return void console.log(HELP);
  if (args.command === "version") return void console.log(`${AGENT_NAME} ${AGENT_VERSION}`);
  if (args.command === "start") return commandStart(args);

  const config = configFor(args);
  let code: number | void;
  switch (args.command) {
    case "status":
      code = await commandStatus(args, config);
      break;
    case "events":
      code = await commandEvents(args, config);
      break;
    case "event":
      code = await commandEvent(args, config);
      break;
    case "emit":
      code = await commandEmit(args, config);
      break;
    case "retry":
      code = await commandRetry(args, config);
      break;
    case "games":
      code = await commandGames(args, config);
      break;
    case "achievements":
      code = await commandAchievements(args, config);
      break;
    case "alerts":
      code = await commandAlerts(args, config);
      break;
    case "overlay":
      code = await commandOverlay(args, config);
      break;
    case "mastery":
      code = await commandMastery(args, config);
      break;
    case "clips":
      code = await commandClips(args, config);
      break;
    case "moments":
      code = await commandMoments(args, config);
      break;
    case "stop":
      code = await commandStop(config);
      break;
    default:
      console.error(`Comando desconhecido: ${args.command}\n`);
      console.log(HELP);
      code = EXIT.usage;
  }
  process.exitCode = code ?? EXIT.ok;
}

main().catch((error) => {
  if (error instanceof ConfigError) console.error(error.message);
  else console.error(`Erro: ${(error as Error).message}`);
  process.exitCode = EXIT.error;
});

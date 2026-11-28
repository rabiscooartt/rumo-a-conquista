import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { LOG_LEVELS, type LogLevel } from "./logger.ts";

export const DEFAULT_CONTROL_PORT = 47821;
export const DEFAULT_SITE_URL = "https://rumo-a-conquista.vercel.app";
export const DEFAULT_OBS_URL = "ws://127.0.0.1:4455";

export type AgentConfig = {
  dataDir: string;
  logDir: string;
  dbPath: string;
  configPath: string;
  logLevel: LogLevel;
  logRetentionDays: number;
  heartbeatMs: number;
  control: { host: "127.0.0.1"; port: number };
  site: { url: string; probeIntervalMs: number; probeTimeoutMs: number; agentToken: string };
  obs: { enabled: boolean; url: string; password: string };
  events: {
    pollIntervalMs: number;
    maxAttempts: number;
    retryBaseMs: number;
    retryMaxMs: number;
    handlerTimeoutMs: number;
    shutdownDrainMs: number;
  };
  games: {
    enabled: boolean;
    pollMs: number;
    /** Tempo que um jogo precisa ficar detectado antes de abrir a sessão (evita aberturas falsas). */
    startConfirmMs: number;
    /** Tempo sem detecção antes de encerrar a sessão (tolera reinícios rápidos do jogo). */
    endGraceMs: number;
    /** Lacuna máxima (agente parado) para retomar a mesma sessão em vez de abrir outra. */
    resumeMaxGapMs: number;
    catalogRefreshMs: number;
    steamPath: string | null;
  };
  alerts: {
    /** Tempo em que o alerta fica visível (entre a entrada e a saída). */
    displayMs: number;
  };
  achievements: {
    enabled: boolean;
    /** Releitura da fonte do jogo em sessão. */
    pollMs: number;
    /** Reconciliação de todas as fontes já conhecidas (pega o que mudou com o agente parado). */
    reconcileMs: number;
  };
  clips: {
    enabled: boolean;
    /** Pasta dos clips; null = "Clips Rumo à Conquista" dentro da pasta de gravação do OBS. */
    dir: string | null;
    /** Trecho desejado antes do evento (o buffer de replay do OBS precisa cobrir pre + post). */
    preSeconds: number;
    /** Espera depois do evento antes de salvar o buffer (trecho posterior). */
    postSeconds: number;
    /** Espaço livre mínimo que precisa sobrar no destino depois de gravar o clip. */
    minFreeBytes: number;
  };
};

/** Formato do config.json (todos os campos são opcionais). */
export type FileConfig = {
  siteUrl?: string;
  siteProbeIntervalSeconds?: number;
  obsEnabled?: boolean;
  obsUrl?: string;
  obsPassword?: string;
  controlPort?: number;
  logLevel?: LogLevel;
  logRetentionDays?: number;
  eventMaxAttempts?: number;
  gamesEnabled?: boolean;
  gamePollSeconds?: number;
  steamPath?: string;
  /** Token do agente para POST /api/agent/achievements (o mesmo valor de AGENT_SYNC_TOKEN no site). */
  siteAgentToken?: string;
  achievementsEnabled?: boolean;
  /** Permanência do alerta na tela, em segundos (3 a 20). */
  alertDisplaySeconds?: number;
  /** Clips automáticos pelo buffer de replay do OBS (Fase 4.6). */
  clipsEnabled?: boolean;
  /** Pasta dos clips (padrão: "Clips Rumo à Conquista" na pasta de gravação do OBS). */
  clipsDir?: string;
  /** Segundos antes do evento (padrão 240). */
  clipPreSeconds?: number;
  /** Segundos depois do evento (padrão 30). */
  clipPostSeconds?: number;
  /** Espaço livre mínimo no destino, em MB (padrão 2048). */
  clipMinFreeMb?: number;
};

export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Configuração inválida: ${problems.join("; ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

type Env = Record<string, string | undefined>;

export function defaultDataDir(env: Env = process.env) {
  if (env.RUMO_AGENT_DATA_DIR) return env.RUMO_AGENT_DATA_DIR;
  const base = env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  return join(base, "RumoAConquista", "agent");
}

const TEMPLATE: FileConfig & { _ajuda: string } = {
  _ajuda:
    "Configuração do agente. Segredos (senha do OBS) podem ficar aqui ou em RUMO_AGENT_OBS_PASSWORD. " +
    "Nunca coloque chaves service-role do Supabase neste arquivo: o agente se recusa a iniciar.",
  siteUrl: DEFAULT_SITE_URL,
  siteProbeIntervalSeconds: 60,
  obsEnabled: true,
  obsUrl: DEFAULT_OBS_URL,
  obsPassword: "",
  controlPort: DEFAULT_CONTROL_PORT,
  logLevel: "info",
  logRetentionDays: 14,
  eventMaxAttempts: 8,
  gamesEnabled: true,
  gamePollSeconds: 5,
  siteAgentToken: "",
  achievementsEnabled: true,
  alertDisplaySeconds: 7,
  clipsEnabled: true,
  clipPreSeconds: 240,
  clipPostSeconds: 30,
  clipMinFreeMb: 2048,
};

function decodeJwtRole(value: string): string | null {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0].length < 10) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

/**
 * Limite de segurança: o cliente Windows nunca pode carregar credenciais privilegiadas
 * do Supabase (service-role JWT ou chave secreta sb_secret_*).
 */
export function findPrivilegedCredentials(values: Record<string, unknown>, origin: string): string[] {
  const found: string[] = [];
  const visit = (value: unknown, path: string) => {
    if (typeof value === "string") {
      if (/service[_-]?role/i.test(path)) found.push(`${origin}:${path}`);
      else if (value.startsWith("sb_secret_")) found.push(`${origin}:${path}`);
      else if (decodeJwtRole(value) === "service_role") found.push(`${origin}:${path}`);
    } else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) visit(item, path ? `${path}.${key}` : key);
    }
  };
  visit(values, "");
  return found;
}

function readFileConfig(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    writeFileSync(path, `${JSON.stringify(TEMPLATE, null, 2)}\n`, "utf8");
    return { ...TEMPLATE };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("não é um objeto JSON");
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new ConfigError([`config.json ilegível (${path}): ${(error as Error).message}`]);
  }
}

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function loadConfig(options: { env?: Env; dataDir?: string; overrides?: FileConfig } = {}): AgentConfig {
  const env = options.env ?? process.env;
  const dataDir = options.dataDir ?? defaultDataDir(env);
  mkdirSync(dataDir, { recursive: true });
  const configPath = join(dataDir, "config.json");
  const raw = readFileConfig(configPath);

  const agentEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("RUMO_AGENT_") && value) agentEnv[key] = value;
  }
  const privileged = [
    ...findPrivilegedCredentials(raw, "config.json"),
    ...findPrivilegedCredentials(agentEnv, "env"),
  ];
  if (privileged.length) {
    throw new ConfigError([
      `credencial privilegiada do Supabase encontrada (${privileged.join(", ")}); remova-a — o agente nunca usa service-role`,
    ]);
  }

  const file = { ...(raw as FileConfig), ...options.overrides };
  const problems: string[] = [];

  const pick = <T>(envKey: string, fileValue: T | undefined, fallback: T, parse: (v: string) => T): T => {
    const fromEnv = env[envKey];
    if (fromEnv !== undefined && fromEnv !== "") return parse(fromEnv);
    return fileValue ?? fallback;
  };

  const siteUrl = pick("RUMO_AGENT_SITE_URL", file.siteUrl, DEFAULT_SITE_URL, String).replace(/\/+$/, "");
  const obsUrl = pick("RUMO_AGENT_OBS_URL", file.obsUrl, DEFAULT_OBS_URL, String);
  const obsPassword = pick("RUMO_AGENT_OBS_PASSWORD", file.obsPassword, "", String);
  const obsEnabled = pick("RUMO_AGENT_OBS_ENABLED", file.obsEnabled, true, (v) => !/^(0|false|no|nao|não)$/i.test(v));
  const controlPort = pick("RUMO_AGENT_CONTROL_PORT", file.controlPort, DEFAULT_CONTROL_PORT, Number);
  const logLevel = pick("RUMO_AGENT_LOG_LEVEL", file.logLevel, "info", (v) => v as LogLevel);
  const probeSeconds = Number(file.siteProbeIntervalSeconds ?? 60);
  const retention = Number(file.logRetentionDays ?? 14);
  const maxAttempts = Number(file.eventMaxAttempts ?? 8);
  const gamesEnabled = pick("RUMO_AGENT_GAMES_ENABLED", file.gamesEnabled, true, (v) => !/^(0|false|no|nao|não)$/i.test(v));
  const gamePollSeconds = Number(file.gamePollSeconds ?? 5);
  const siteAgentToken = pick("RUMO_AGENT_SITE_TOKEN", file.siteAgentToken, "", String).trim();
  const achievementsEnabled = pick("RUMO_AGENT_ACHIEVEMENTS_ENABLED", file.achievementsEnabled, true, (v) => !/^(0|false|no|nao|não)$/i.test(v));

  try {
    const url = new URL(siteUrl);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalHost(url.hostname))) {
      problems.push("siteUrl deve usar https (http só é aceito para localhost)");
    }
  } catch {
    problems.push(`siteUrl inválida: ${siteUrl}`);
  }
  try {
    const url = new URL(obsUrl);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") problems.push("obsUrl deve começar com ws:// ou wss://");
  } catch {
    problems.push(`obsUrl inválida: ${obsUrl}`);
  }
  if (!Number.isInteger(controlPort) || controlPort < 0 || controlPort > 65535) {
    problems.push(`controlPort inválida: ${controlPort}`);
  }
  if (!LOG_LEVELS.includes(logLevel)) problems.push(`logLevel inválido: ${logLevel}`);
  if (!Number.isFinite(probeSeconds) || probeSeconds < 10) problems.push("siteProbeIntervalSeconds deve ser >= 10");
  if (!Number.isInteger(retention) || retention < 1) problems.push("logRetentionDays deve ser inteiro >= 1");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
    problems.push("eventMaxAttempts deve ser inteiro entre 1 e 100");
  }
  const alertDisplaySeconds = Number(file.alertDisplaySeconds ?? 7);
  if (!Number.isFinite(alertDisplaySeconds) || alertDisplaySeconds < 3 || alertDisplaySeconds > 20) {
    problems.push("alertDisplaySeconds deve estar entre 3 e 20");
  }
  const clipsEnabled = pick("RUMO_AGENT_CLIPS_ENABLED", file.clipsEnabled, true, (v) => !/^(0|false|no|nao|não)$/i.test(v));
  const clipsDir = pick("RUMO_AGENT_CLIPS_DIR", file.clipsDir, "", String).trim() || null;
  const clipPreSeconds = Number(file.clipPreSeconds ?? 240);
  const clipPostSeconds = Number(file.clipPostSeconds ?? 30);
  const clipMinFreeMb = Number(file.clipMinFreeMb ?? 2048);
  if (!Number.isInteger(clipPreSeconds) || clipPreSeconds < 0 || clipPreSeconds > 3600) problems.push("clipPreSeconds deve ser inteiro entre 0 e 3600");
  if (!Number.isInteger(clipPostSeconds) || clipPostSeconds < 0 || clipPostSeconds > 600) problems.push("clipPostSeconds deve ser inteiro entre 0 e 600");
  if (!Number.isFinite(clipMinFreeMb) || clipMinFreeMb < 0) problems.push("clipMinFreeMb deve ser >= 0");
  if (siteAgentToken && siteAgentToken.length < 32) problems.push("siteAgentToken deve ter pelo menos 32 caracteres");
  if (!Number.isFinite(gamePollSeconds) || gamePollSeconds < 2 || gamePollSeconds > 60) {
    problems.push("gamePollSeconds deve estar entre 2 e 60");
  }
  if (problems.length) throw new ConfigError(problems);

  return {
    dataDir,
    logDir: join(dataDir, "logs"),
    dbPath: join(dataDir, "agent.db"),
    configPath,
    logLevel,
    logRetentionDays: retention,
    heartbeatMs: 15_000,
    control: { host: "127.0.0.1", port: controlPort },
    site: { url: siteUrl, probeIntervalMs: probeSeconds * 1000, probeTimeoutMs: 10_000, agentToken: siteAgentToken },
    obs: { enabled: obsEnabled, url: obsUrl, password: obsPassword },
    events: {
      pollIntervalMs: 1_000,
      maxAttempts,
      retryBaseMs: 2_000,
      retryMaxMs: 5 * 60_000,
      handlerTimeoutMs: 30_000,
      shutdownDrainMs: 10_000,
    },
    games: {
      enabled: gamesEnabled,
      pollMs: gamePollSeconds * 1000,
      startConfirmMs: 10_000,
      endGraceMs: 45_000,
      resumeMaxGapMs: 10 * 60_000,
      catalogRefreshMs: 30 * 60_000,
      steamPath: file.steamPath?.trim() || null,
    },
    alerts: { displayMs: alertDisplaySeconds * 1000 },
    achievements: { enabled: achievementsEnabled, pollMs: 10_000, reconcileMs: 30 * 60_000 },
    clips: { enabled: clipsEnabled, dir: clipsDir, preSeconds: clipPreSeconds, postSeconds: clipPostSeconds, minFreeBytes: clipMinFreeMb * 1024 * 1024 },
  };
}

/** Versão da configuração segura para logs e para o endpoint /status. */
export function describeConfig(config: AgentConfig) {
  return {
    dataDir: config.dataDir,
    configPath: config.configPath,
    logLevel: config.logLevel,
    controlPort: config.control.port,
    siteUrl: config.site.url,
    siteAgentTokenConfigured: Boolean(config.site.agentToken),
    obs: { enabled: config.obs.enabled, url: config.obs.url, passwordConfigured: Boolean(config.obs.password) },
    events: config.events,
  };
}

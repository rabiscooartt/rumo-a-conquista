import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";
export const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_KEY = /pass(word)?|token|secret|authorization|api[_-]?key|service[_-]?role|challenge|salt/i;

export type LogRecord = {
  ts: string;
  level: LogLevel;
  scope: string;
  msg: string;
  data?: unknown;
};

export type LogSink = (record: LogRecord) => void;

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

/** Remove segredos e serializa erros antes de qualquer registro. */
export function redact(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    const out: Record<string, unknown> = { name: value.name, message: value.message };
    if (value.stack) out.stack = value.stack;
    if (value.cause !== undefined) out.cause = redact(value.cause, depth + 1);
    return out;
  }
  if (depth > 6) return "[profundidade máxima]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key) ? (item ? "[oculto]" : item) : redact(item, depth + 1);
    }
    return out;
  }
  return value;
}

export function consoleSink(record: LogRecord) {
  const line = `${record.ts} ${record.level.toUpperCase().padEnd(5)} [${record.scope}] ${record.msg}`;
  const extra = record.data === undefined ? "" : ` ${JSON.stringify(record.data)}`;
  const write = record.level === "error" || record.level === "warn" ? console.error : console.log;
  write(line + extra);
}

/** Arquivo JSONL por dia (data UTC): logs/agent-AAAA-MM-DD.log. */
export function fileSink(dir: string): LogSink {
  mkdirSync(dir, { recursive: true });
  let warned = false;
  return (record) => {
    try {
      appendFileSync(join(dir, `agent-${record.ts.slice(0, 10)}.log`), `${JSON.stringify(record)}\n`);
    } catch (error) {
      if (!warned) {
        warned = true;
        console.error(`[logger] Falha ao gravar log em ${dir}:`, (error as Error).message);
      }
    }
  };
}

export function pruneLogs(dir: string, retentionDays: number, now = Date.now()) {
  const cutoff = new Date(now - retentionDays * 86_400_000).toISOString().slice(0, 10);
  let removed = 0;
  try {
    for (const name of readdirSync(dir)) {
      const match = /^agent-(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
      if (match && match[1] < cutoff) {
        unlinkSync(join(dir, name));
        removed += 1;
      }
    }
  } catch {
    // Pasta inexistente ou ilegível: nada a limpar.
  }
  return removed;
}

export function createLogger(options: { level: LogLevel; sinks: LogSink[]; scope?: string }): Logger {
  const threshold = ORDER[options.level];
  const make = (scope: string): Logger => {
    const emit = (level: LogLevel, msg: string, data?: Record<string, unknown>) => {
      if (ORDER[level] < threshold) return;
      const record: LogRecord = { ts: new Date().toISOString(), level, scope, msg };
      if (data !== undefined) record.data = redact(data);
      for (const sink of options.sinks) sink(record);
    };
    return {
      debug: (msg, data) => emit("debug", msg, data),
      info: (msg, data) => emit("info", msg, data),
      warn: (msg, data) => emit("warn", msg, data),
      error: (msg, data) => emit("error", msg, data),
      child: (child) => make(`${scope}:${child}`),
    };
  };
  return make(options.scope ?? "agent");
}

export const silentLogger: Logger = createLogger({ level: "error", sinks: [] });

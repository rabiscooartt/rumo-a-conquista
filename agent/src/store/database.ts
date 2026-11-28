import { createRequire } from "node:module";

/*
 * Persistência local em SQLite usando o módulo nativo node:sqlite (Node >= 24):
 * sem dependências novas, transações reais e modo WAL com synchronous=FULL,
 * que sobrevive a encerramentos abruptos sem corromper a base.
 *
 * As interfaces abaixo descrevem só o que o agente usa; o carregamento via
 * createRequire evita depender dos tipos de node:sqlite (o projeto usa @types/node 20).
 */
export type SqlValue = string | number | bigint | null | Uint8Array;

export interface SqlStatement {
  run(...params: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: SqlValue[]): Record<string, unknown> | undefined;
  all(...params: SqlValue[]): Record<string, unknown>[];
}

export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  close(): void;
}

const require = createRequire(import.meta.url);

const MIGRATIONS: string[] = [
  // v1 — fila de eventos, histórico de tentativas e estado operacional.
  `
  CREATE TABLE events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    dedupe_key TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    source TEXT NOT NULL,
    payload TEXT NOT NULL,
    is_test INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('pending','processing','retry_wait','completed','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL,
    next_attempt_at INTEGER NOT NULL,
    locked_at INTEGER,
    last_error TEXT,
    result TEXT,
    occurred_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
  );
  CREATE INDEX events_due ON events (status, next_attempt_at, seq);
  CREATE INDEX events_type ON events (type, status);

  CREATE TABLE event_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL REFERENCES events (id),
    attempt INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    outcome TEXT NOT NULL CHECK (outcome IN ('running','completed','retry','deferred','failed','interrupted')),
    error TEXT
  );
  CREATE INDEX event_attempts_event ON event_attempts (event_id, id);

  CREATE TABLE agent_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  // v2 — Fase 2: mapeamento de jogos detectados para o catálogo e sessões de jogo.
  `
  CREATE TABLE game_mappings (
    detection_key TEXT PRIMARY KEY,
    slug TEXT,
    title TEXT,
    ignored INTEGER NOT NULL DEFAULT 0,
    origin TEXT NOT NULL CHECK (origin IN ('manual','auto')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE game_sessions (
    id TEXT PRIMARY KEY,
    identity TEXT NOT NULL,
    detection_key TEXT NOT NULL,
    source TEXT NOT NULL,
    slug TEXT,
    title TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    ended_at INTEGER,
    end_reason TEXT,
    detail TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX game_sessions_started ON game_sessions (started_at);
  CREATE UNIQUE INDEX game_sessions_single_open ON game_sessions ((ended_at IS NULL)) WHERE ended_at IS NULL;
  `,
  // v3 — Fase 3: último estado lido de cada fonte de conquistas (base da detecção por diferença).
  `
  CREATE TABLE achievement_sources (
    provider TEXT NOT NULL,
    source_key TEXT NOT NULL,
    baseline_at INTEGER NOT NULL,
    last_read_at INTEGER NOT NULL,
    last_fingerprint TEXT,
    last_error TEXT,
    PRIMARY KEY (provider, source_key)
  );

  CREATE TABLE achievement_states (
    provider TEXT NOT NULL,
    source_key TEXT NOT NULL,
    external_id TEXT NOT NULL,
    name TEXT,
    unlocked INTEGER NOT NULL,
    unlocked_at INTEGER,
    first_seen_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    event_id TEXT,
    PRIMARY KEY (provider, source_key, external_id)
  );
  `,
  // v4 — Fase 4.2: fila de alertas (entidade própria, separada do evento que a originou).
  `
  CREATE TABLE alerts (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    dedupe_key TEXT NOT NULL UNIQUE,
    source_event_id TEXT,
    game_slug TEXT,
    subject_id TEXT,
    title TEXT,
    payload TEXT NOT NULL,
    is_test INTEGER NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('pending','processing','retry_wait','completed','failed','expired')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL,
    next_attempt_at INTEGER NOT NULL,
    expires_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX alerts_queue ON alerts (status, priority DESC, seq);
  `,
  // v5 — Fase 4.4: correção manual do jogo da sessão (tem precedência sobre a detecção).
  `
  ALTER TABLE game_sessions ADD COLUMN manual_slug TEXT;
  ALTER TABLE game_sessions ADD COLUMN corrected_at INTEGER;
  `,
  // v6 — Fase 4.6: clips automáticos (buffer de replay do OBS), fila própria e independente dos alertas.
  `
  CREATE TABLE clips (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    dedupe_key TEXT NOT NULL UNIQUE,
    source_event_id TEXT,
    kind TEXT NOT NULL,
    game_slug TEXT,
    title TEXT,
    payload TEXT NOT NULL,
    is_test INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('pending','saving','completed','failed','expired')),
    event_at INTEGER NOT NULL,
    due_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    obs_path TEXT,
    file_path TEXT,
    size_bytes INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
  );
  CREATE INDEX clips_due ON clips (status, due_at, seq);
  `,
  // v7 — Parte A do plano de captura híbrida: momentos marcados pelo atalho (revisão na Parte B).
  `
  CREATE TABLE moments (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    marked_at INTEGER NOT NULL,
    source TEXT NOT NULL,
    session_id TEXT,
    game_slug TEXT,
    game_title TEXT,
    detection_key TEXT,
    clip_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','discarded')),
    note TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX moments_status ON moments (status, marked_at);
  `,
  // v8 — Parte B: resultado da revisão do momento (qual conquista, com que data, qual evento).
  `
  ALTER TABLE moments ADD COLUMN achievement_id TEXT;
  ALTER TABLE moments ADD COLUMN achievement_title TEXT;
  ALTER TABLE moments ADD COLUMN date_mode TEXT;
  ALTER TABLE moments ADD COLUMN event_id TEXT;
  ALTER TABLE moments ADD COLUMN resolved_at INTEGER;
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

const depth = new WeakMap<SqlDatabase, number>();

/**
 * Transação reentrante: a externa usa BEGIN IMMEDIATE; as internas viram SAVEPOINT.
 * Permite gravar, por exemplo, a sessão de jogo e o evento correspondente atomicamente.
 */
export function transaction<T>(db: SqlDatabase, fn: () => T): T {
  const level = depth.get(db) ?? 0;
  const savepoint = `sp_${level}`;
  db.exec(level === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
  depth.set(db, level + 1);
  try {
    const result = fn();
    db.exec(level === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    try {
      db.exec(level === 0 ? "ROLLBACK" : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
    } catch {
      // A transação já pode ter sido desfeita pelo SQLite.
    }
    throw error;
  } finally {
    depth.set(db, level);
  }
}

function migrate(db: SqlDatabase) {
  const current = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
  if (current > MIGRATIONS.length) {
    throw new Error(
      `A base local está na versão ${current}, mais nova que este agente (${MIGRATIONS.length}). Atualize o agente.`,
    );
  }
  for (let version = current; version < MIGRATIONS.length; version += 1) {
    transaction(db, () => {
      db.exec(MIGRATIONS[version]);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

export function openDatabase(path: string): SqlDatabase {
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (path: string) => SqlDatabase;
  };
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = FULL");
    db.exec("PRAGMA foreign_keys = ON");
    const integrity = db.prepare("PRAGMA quick_check").get()?.quick_check;
    if (integrity !== "ok") throw new Error(`Verificação de integridade da base falhou: ${String(integrity)}`);
    migrate(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

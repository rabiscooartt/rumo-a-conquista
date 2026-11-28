import type { SqlDatabase } from "./database.ts";

/** Estado operacional chave/valor (JSON) que sobrevive a reinícios. */
export class StateStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  get<T>(key: string): T | undefined {
    const row = this.db.prepare("SELECT value FROM agent_state WHERE key = ?").get(key);
    return row ? (JSON.parse(String(row.value)) as T) : undefined;
  }

  set(key: string, value: unknown) {
    this.db
      .prepare(
        `INSERT INTO agent_state (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value ?? null), Date.now());
  }

  delete(key: string) {
    this.db.prepare("DELETE FROM agent_state WHERE key = ?").run(key);
  }

  all(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const row of this.db.prepare("SELECT key, value FROM agent_state ORDER BY key").all()) {
      out[String(row.key)] = JSON.parse(String(row.value));
    }
    return out;
  }
}

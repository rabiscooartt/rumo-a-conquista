import type { Logger } from "../../logger.ts";
import { USER_AGENT } from "../../version.ts";
import type { CatalogGame } from "./titles.ts";

export type CatalogSnapshot = { fetchedAt: number | null; games: CatalogGame[] };

type StateLike = { get<T>(key: string): T | undefined; set(key: string, value: unknown): void };

/**
 * Catálogo de jogos do site (endpoint público /api/games/catalog, só leitura),
 * com cópia local para funcionar sem internet.
 */
export class CatalogCache {
  private readonly siteUrl: string;
  private readonly state: StateLike;
  private readonly log: Logger;
  private readonly fetchImpl: typeof fetch;
  private snapshot: CatalogSnapshot;
  private lastError: string | null = null;

  constructor(options: { siteUrl: string; state: StateLike; log: Logger; fetchImpl?: typeof fetch }) {
    this.siteUrl = options.siteUrl;
    this.state = options.state;
    this.log = options.log;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.snapshot = this.state.get<CatalogSnapshot>("catalog") ?? { fetchedAt: null, games: [] };
  }

  games() {
    return this.snapshot.games;
  }

  bySlug(slug: string) {
    return this.snapshot.games.find((game) => game.slug === slug) ?? null;
  }

  info() {
    return { games: this.snapshot.games.length, fetchedAt: this.snapshot.fetchedAt, lastError: this.lastError };
  }

  async refresh(timeoutMs = 15_000): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.siteUrl}/api/games/catalog`, {
        headers: { "user-agent": USER_AGENT, accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { games?: Array<Record<string, unknown>> };
      if (!Array.isArray(body.games)) throw new Error("resposta sem lista de jogos");
      const games: CatalogGame[] = body.games
        .filter((game) => typeof game.slug === "string" && typeof game.title === "string" && !game.isDeleted)
        .map((game) => ({
          slug: String(game.slug),
          title: String(game.title),
          platform: typeof game.platform === "string" ? game.platform : null,
          status: typeof game.status === "string" ? game.status : null,
        }));
      this.snapshot = { fetchedAt: Date.now(), games };
      this.state.set("catalog", this.snapshot);
      this.lastError = null;
      this.log.info("Catálogo do site atualizado", { jogos: games.length });
      return true;
    } catch (error) {
      this.lastError = (error as Error).message;
      this.log.warn("Não foi possível atualizar o catálogo; usando a cópia local", {
        error: this.lastError,
        jogosEmCache: this.snapshot.games.length,
      });
      return false;
    }
  }
}

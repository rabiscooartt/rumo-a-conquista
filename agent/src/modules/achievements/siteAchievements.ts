import type { Logger } from "../../logger.ts";
import { USER_AGENT } from "../../version.ts";
import { normalizeTitle } from "../games/titles.ts";

/** Conquista como o site a publica (catálogo público, só leitura). */
export type SiteAchievement = {
  /** Identificador canônico usado pelo site (legacy_id, ou o id). */
  id: string;
  title: string;
  description: string | null;
  image: string | null;
  rank: string | null;
  isCustom: boolean;
  completed: boolean;
};

/** Dados do jogo publicados pelo site que entram no critério de progresso (Maestria). */
export type SiteGameMeta = {
  title: string;
  /** Jornada de Estreia concluída: os ids escolhidos contam como concluídos no site. */
  journeyIds: string[];
  finalBadge: { title: string | null; image: string | null } | null;
};

type Snapshot = { fetchedAt: number | null; bySlug: Record<string, SiteAchievement[]>; games?: Record<string, SiteGameMeta> };
type StateLike = { get<T>(key: string): T | undefined; set(key: string, value: unknown): void };

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/**
 * Cópia local das conquistas publicadas pelo site (GET /api/games/catalog?achievements=1).
 * Serve à escolha manual de conquistas CUSTOM e dá nome/descrição/imagem reais ao alerta.
 */
export class SiteAchievementsCache {
  private readonly siteUrl: string;
  private readonly state: StateLike;
  private readonly log: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly ttlMs: number;
  private snapshot: Snapshot;

  constructor(options: { siteUrl: string; state: StateLike; log: Logger; fetchImpl?: typeof fetch; ttlMs?: number }) {
    this.siteUrl = options.siteUrl;
    this.state = options.state;
    this.log = options.log;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.ttlMs = options.ttlMs ?? 10 * 60_000;
    this.snapshot = this.state.get<Snapshot>("siteAchievements") ?? { fetchedAt: null, bySlug: {} };
  }

  info() {
    return { fetchedAt: this.snapshot.fetchedAt, games: Object.keys(this.snapshot.bySlug).length };
  }

  /** Atualiza se a cópia estiver velha; sem internet, segue com a cópia local. */
  async ensureFresh(force = false) {
    if (!force && this.snapshot.fetchedAt && Date.now() - this.snapshot.fetchedAt < this.ttlMs) return true;
    try {
      const response = await this.fetchImpl(`${this.siteUrl}/api/games/catalog?achievements=1`, {
        headers: { "user-agent": USER_AGENT, accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as {
        achievementsBySlug?: Record<string, Array<Record<string, unknown>>>;
        games?: Array<Record<string, unknown>>;
      };
      if (!body.achievementsBySlug || typeof body.achievementsBySlug !== "object") throw new Error("resposta sem conquistas");
      const bySlug: Record<string, SiteAchievement[]> = {};
      for (const [slug, rows] of Object.entries(body.achievementsBySlug)) {
        if (!Array.isArray(rows)) continue;
        bySlug[slug] = rows
          .filter((row) => text(row.legacy_id) ?? text(row.id))
          .filter((row) => row.is_hidden !== true)
          .map((row) => {
            const progress = Array.isArray(row.achievement_progress) ? (row.achievement_progress[0] as Record<string, unknown> | undefined) : undefined;
            const image = text(progress?.image_override) ?? text(row.image);
            return {
              id: (text(row.legacy_id) ?? text(row.id))!,
              title: text(row.title) ?? "",
              description: text(row.description),
              image: image && /^https:\/\//.test(image) ? image : null,
              rank: text(progress?.rank_override) ?? text(row.rank),
              isCustom: row.is_custom === true,
              completed: progress?.status === "completed",
            };
          })
          .filter((a) => a.title);
      }
      const games: Record<string, SiteGameMeta> = {};
      for (const game of Array.isArray(body.games) ? body.games : []) {
        const slug = text(game.slug);
        if (!slug) continue;
        const journey = (game.firstJourney ?? null) as { status?: unknown; achievementIds?: unknown } | null;
        const journeyIds =
          journey?.status === "completed" && Array.isArray(journey.achievementIds)
            ? journey.achievementIds.map((id) => String(id).trim()).filter(Boolean)
            : [];
        const badge = (game.finalBadge ?? null) as Record<string, unknown> | null;
        const badgeImage = text(badge?.image);
        games[slug] = {
          title: text(game.title) ?? slug,
          journeyIds,
          finalBadge: badge && typeof badge === "object" ? { title: text(badge.title), image: badgeImage && /^https:\/\//.test(badgeImage) ? badgeImage : null } : null,
        };
      }
      this.snapshot = { fetchedAt: Date.now(), bySlug, games };
      this.state.set("siteAchievements", this.snapshot);
      return true;
    } catch (error) {
      this.log.warn("Não foi possível atualizar as conquistas do site; usando a cópia local", { error: (error as Error).message });
      return false;
    }
  }

  /** Jogo publicado no catálogo (null = fora do catálogo ou cópia antiga sem dados de jogos). */
  game(slug: string): SiteGameMeta | null {
    return this.snapshot.games?.[slug] ?? null;
  }

  forGame(slug: string): SiteAchievement[] {
    return this.snapshot.bySlug[slug] ?? [];
  }

  byId(slug: string, id: string) {
    return this.forGame(slug).find((a) => a.id === id) ?? null;
  }

  customByTitle(slug: string, title: string) {
    const target = normalizeTitle(title);
    const matches = this.forGame(slug).filter((a) => a.isCustom && normalizeTitle(a.title) === target);
    return matches.length === 1 ? matches[0] : null;
  }
}

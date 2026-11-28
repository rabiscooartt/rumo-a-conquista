import { randomUUID } from "node:crypto";
import { HttpError } from "../../control/controlServer.ts";
import type { AgentModule } from "../../core/module.ts";
import { operatorUnlockEvent } from "../achievements/index.ts";
import type { SiteAchievementsCache } from "../achievements/siteAchievements.ts";
import type { ClipsService } from "../clips/index.ts";
import type { GamesService } from "../games/index.ts";
import { REVIEW_CSP, REVIEW_CSS, REVIEW_HTML, REVIEW_JS } from "./page.ts";

/*
 * Plano de captura híbrida.
 *  Parte A — "Marcar momento": o atalho global do aplicativo (ou o CLI) registra o instante, o jogo
 *            da sessão e pede o clip dos minutos anteriores. Nada vai ao site nessa hora.
 *  Parte B — Revisão: depois da live, cada momento vira uma conquista escolhida por você (com a data
 *            do momento ou sem data) ou é descartado; e o checklist registra as conquistas feitas sem
 *            momento marcado. Nada é liberado sem a sua confirmação, e a revisão não dispara alerta.
 */

export type Moment = {
  id: string;
  markedAt: number;
  source: string;
  sessionId: string | null;
  gameSlug: string | null;
  gameTitle: string | null;
  detectionKey: string | null;
  clipId: string | null;
  status: "pending" | "resolved" | "discarded";
  note: string | null;
  achievementId: string | null;
  achievementTitle: string | null;
  dateMode: "moment" | "undated" | null;
  eventId: string | null;
  resolvedAt: number | null;
};

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const toMoment = (r: Record<string, unknown>): Moment => ({
  id: String(r.id),
  markedAt: Number(r.marked_at),
  source: String(r.source),
  sessionId: str(r.session_id),
  gameSlug: str(r.game_slug),
  gameTitle: str(r.game_title),
  detectionKey: str(r.detection_key),
  clipId: str(r.clip_id),
  status: String(r.status) as Moment["status"],
  note: str(r.note),
  achievementId: str(r.achievement_id),
  achievementTitle: str(r.achievement_title),
  dateMode: str(r.date_mode) as Moment["dateMode"],
  eventId: str(r.event_id),
  resolvedAt: r.resolved_at === null || r.resolved_at === undefined ? null : Number(r.resolved_at),
});

/** Intervalo mínimo entre dois momentos (tecla presa ou apertada duas vezes não duplica). */
export const MOMENT_DEBOUNCE_MS = 3_000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;

export type MomentsService = { pendingCount(): number };

export function momentsModule(options: { now?: () => number } = {}): AgentModule {
  const now = options.now ?? Date.now;
  let pendingCount = () => 0;

  return {
    name: "moments",
    start(ctx) {
      const games = ctx.services.get<GamesService>("games");
      const clips = () => ctx.services.get<ClipsService>("clips");
      const site = () => ctx.services.get<SiteAchievementsCache>("siteAchievements");
      const get = (id: string) => {
        const row = ctx.db.prepare("SELECT * FROM moments WHERE id = ?").get(id);
        return row ? toMoment(row) : null;
      };
      pendingCount = () => Number(ctx.db.prepare("SELECT COUNT(*) AS n FROM moments WHERE status = 'pending'").get()?.n ?? 0);
      ctx.services.provide<MomentsService>("moments", { pendingCount: () => pendingCount() });

      const mark = (source: string, note: string | null) => {
        const at = now();
        const last = ctx.db.prepare("SELECT * FROM moments ORDER BY marked_at DESC LIMIT 1").get();
        if (last && at - Number(last.marked_at) < MOMENT_DEBOUNCE_MS) return { moment: toMoment(last), created: false };
        const session = games?.activeSession() ?? null;
        const id = randomUUID();
        ctx.db
          .prepare(
            `INSERT INTO moments (id, marked_at, source, session_id, game_slug, game_title, detection_key, note, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(id, at, source, session?.id ?? null, session?.slug ?? null, session?.title ?? null, session?.detectionKey ?? null, note, at, at);
        // O clip é independente: se os clips estiverem desligados ou falharem, o momento continua salvo.
        try {
          const clip = clips()?.requestMoment({ momentId: id, markedAt: at, gameSlug: session?.slug ?? null, title: session?.title ? `Momento ${session.title}` : "Momento" });
          if (clip) ctx.db.prepare("UPDATE moments SET clip_id = ?, updated_at = ? WHERE id = ?").run(clip.id, at, id);
        } catch (error) {
          ctx.log.warn("Momento salvo sem clip", { momentId: id, error: (error as Error).message });
        }
        ctx.log.info("Momento marcado", { momentId: id, jogo: session?.title ?? null, origem: source });
        return { moment: get(id)!, created: true };
      };

      const gameTitle = (slug: string) => games?.titleForSlug(slug) ?? site()?.game(slug)?.title ?? null;
      /** Algo foi registrado: a próxima leitura do catálogo do site é forçada. */
      let catalogDirty = false;
      /** Conquistas que o próprio agente já registrou (ainda que o site não tenha confirmado). */
      const registeredHere = (slug: string) => {
        const ids = new Set<string>();
        for (const row of ctx.db.prepare("SELECT payload FROM events WHERE type = 'achievement.unlocked' AND is_test = 0 AND status != 'failed'").all()) {
          const p = JSON.parse(String(row.payload)) as { gameSlug?: string; externalId?: string; provider?: string };
          if (p.gameSlug === slug && p.provider === "site" && p.externalId) ids.add(p.externalId);
        }
        return ids;
      };
      /** Conquistas ainda não feitas do jogo, na ordem do site (sugestões da revisão e do checklist). */
      const pendingAchievements = async (slug: string) => {
        const cache = site();
        if (!cache) return [];
        await cache.ensureFresh(catalogDirty);
        catalogDirty = false;
        const done = registeredHere(slug);
        return cache
          .forGame(slug)
          .filter((a) => !a.completed && !done.has(a.id))
          .map((a) => ({ id: a.id, title: a.title, description: a.description, isCustom: a.isCustom, image: a.image }));
      };
      const findAchievement = async (slug: string, achievementId: string) => {
        const cache = site();
        if (!cache) throw new HttpError(503, "Catálogo do site indisponível no agente");
        await cache.ensureFresh();
        const found = cache.byId(slug, achievementId);
        if (!found) throw new HttpError(404, "Conquista não encontrada entre as publicadas pelo site para este jogo");
        return found;
      };
      const unlock = (slug: string, a: { id: string; title: string; description: string | null; image: string | null; isCustom: boolean }, at: number | null, sessionId: string | null, evidence: Record<string, unknown>) => {
        catalogDirty = true;
        return ctx.events.record(
          operatorUnlockEvent({ slug, achievementId: a.id, name: a.title, description: a.description, image: a.image, isCustom: a.isCustom, sessionId, at, evidence }, now()),
        );
      };

      // ── Parte A: marcar (com token: o aplicativo de desktop lê o token local; páginas web não conseguem)
      ctx.control.route("POST", "/mark", ({ body }) => {
        const input = (body ?? {}) as { source?: unknown; note?: unknown };
        const source = typeof input.source === "string" && /^[a-z0-9-]{1,32}$/.test(input.source) ? input.source : "api";
        const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 200) : null;
        const result = mark(source, note);
        return { status: result.created ? 201 : 200, body: result };
      });
      ctx.control.route("GET", "/list", ({ query }) => {
        const status = query.get("status");
        const limit = Math.min(Math.max(1, Number(query.get("limit") ?? 50) || 50), 500);
        const rows = status
          ? ctx.db.prepare(`SELECT * FROM moments WHERE status = ? ORDER BY marked_at DESC LIMIT ${limit}`).all(status)
          : ctx.db.prepare(`SELECT * FROM moments ORDER BY marked_at DESC LIMIT ${limit}`).all();
        return { body: { pending: pendingCount(), moments: rows.map(toMoment) } };
      });

      // ── Parte B: revisão
      ctx.control.route("GET", "/review", async () => {
        const rows = ctx.db.prepare("SELECT * FROM moments WHERE status = 'pending' ORDER BY marked_at").all().map(toMoment);
        const suggestions: Record<string, unknown[]> = {};
        for (const slug of new Set(rows.map((m) => m.gameSlug).filter((s): s is string => Boolean(s)))) suggestions[slug] = await pendingAchievements(slug);
        const recent = ctx.db.prepare("SELECT * FROM moments WHERE status != 'pending' ORDER BY updated_at DESC LIMIT 10").all().map(toMoment);
        return {
          body: {
            pending: rows.map((m) => ({ ...m, clip: m.clipId ? (clips()?.clip(m.clipId) ?? null) : null })),
            suggestions,
            recent,
            games: games?.catalogGames() ?? [],
            currentGame: games?.activeSession()?.slug ?? null,
          },
        };
      });
      ctx.control.route("GET", "/achievements", async ({ query }) => {
        const slug = String(query.get("slug") ?? "");
        if (!SLUG.test(slug)) throw new HttpError(400, "slug do jogo inválido");
        return { body: { slug, title: gameTitle(slug), pending: await pendingAchievements(slug) } };
      });
      // Ações da tela de revisão: sem token, só da própria origem (como os controles do dock).
      ctx.control.route(
        "POST",
        "/resolve",
        async ({ body }) => {
          const input = (body ?? {}) as { momentId?: unknown; achievementId?: unknown; slug?: unknown; dateMode?: unknown };
          const moment = get(String(input.momentId ?? ""));
          if (!moment) throw new HttpError(404, "Momento não encontrado");
          if (moment.status !== "pending") throw new HttpError(409, "Este momento já foi revisado");
          const slug = moment.gameSlug ?? (typeof input.slug === "string" ? input.slug : "");
          if (!SLUG.test(slug) || !gameTitle(slug)) throw new HttpError(400, "Escolha o jogo do momento");
          const dateMode = input.dateMode === "undated" ? "undated" : "moment";
          const achievement = await findAchievement(slug, String(input.achievementId ?? ""));
          const result = unlock(slug, achievement, dateMode === "undated" ? null : moment.markedAt, moment.sessionId, { origin: "review", momentId: moment.id });
          const at = now();
          ctx.db
            .prepare(
              `UPDATE moments SET status = 'resolved', game_slug = ?, game_title = COALESCE(game_title, ?), achievement_id = ?, achievement_title = ?,
                 date_mode = ?, event_id = ?, resolved_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
            )
            .run(slug, gameTitle(slug), achievement.id, achievement.title, dateMode, result.event.id, at, at, moment.id);
          if (moment.clipId) {
            clips()?.annotate(moment.clipId, { conquista: achievement.title, conquistaId: achievement.id, jogo: slug, dataNoSite: dateMode === "undated" ? null : new Date(moment.markedAt).toISOString() });
          }
          ctx.log.info("Momento revisado", { momentId: moment.id, conquista: achievement.title, data: dateMode, novo: result.created });
          return { body: { moment: get(moment.id), event: result.event, alreadyRegistered: !result.created } };
        },
        { requireToken: false },
      );
      ctx.control.route(
        "POST",
        "/discard",
        ({ body }) => {
          const input = (body ?? {}) as { momentId?: unknown; deleteClip?: unknown };
          const moment = get(String(input.momentId ?? ""));
          if (!moment) throw new HttpError(404, "Momento não encontrado");
          if (moment.status !== "pending") throw new HttpError(409, "Este momento já foi revisado");
          const at = now();
          ctx.db.prepare("UPDATE moments SET status = 'discarded', resolved_at = ?, updated_at = ? WHERE id = ?").run(at, at, moment.id);
          const clipDeleted = input.deleteClip === true && moment.clipId ? (clips()?.deleteFile(moment.clipId) ?? false) : false;
          return { body: { moment: get(moment.id), clipDeleted } };
        },
        { requireToken: false },
      );
      // Checklist: conquistas feitas sem momento marcado (data de hoje ou sem data).
      ctx.control.route(
        "POST",
        "/checklist",
        async ({ body }) => {
          const input = (body ?? {}) as { slug?: unknown; achievementIds?: unknown; dateMode?: unknown };
          const slug = typeof input.slug === "string" ? input.slug : "";
          if (!SLUG.test(slug) || !gameTitle(slug)) throw new HttpError(400, "Escolha o jogo");
          const ids = Array.isArray(input.achievementIds) ? [...new Set(input.achievementIds.filter((v): v is string => typeof v === "string"))] : [];
          if (!ids.length || ids.length > 200) throw new HttpError(400, "Marque ao menos uma conquista");
          const dateMode = input.dateMode === "undated" ? "undated" : "today";
          const session = games?.activeSession();
          const results = [];
          for (const id of ids) {
            const achievement = await findAchievement(slug, id);
            const r = unlock(slug, achievement, dateMode === "undated" ? null : now(), session?.slug === slug ? session.id : null, { origin: "checklist" });
            results.push({ id, title: achievement.title, created: r.created, eventId: r.event.id });
          }
          ctx.log.info("Checklist registrado", { jogo: slug, conquistas: results.length, data: dateMode });
          return { status: 201, body: { results } };
        },
        { requireToken: false },
      );

      // Tela de revisão (mesma origem do agente; aberta pelo aplicativo ou pelo dock).
      const page = { "content-security-policy": REVIEW_CSP, "referrer-policy": "no-referrer" };
      ctx.control.route("GET", "", () => ({ status: 302, body: "", contentType: "text/plain", headers: { location: "/modules/moments/" } }));
      ctx.control.route("GET", "/", () => ({ body: REVIEW_HTML, contentType: "text/html; charset=utf-8", headers: page }));
      ctx.control.route("GET", "/review.css", () => ({ body: REVIEW_CSS, contentType: "text/css; charset=utf-8" }));
      ctx.control.route("GET", "/review.js", () => ({ body: REVIEW_JS, contentType: "text/javascript; charset=utf-8" }));
    },
    health() {
      return { ok: true, detail: { paraRevisar: pendingCount() } };
    },
  };
}


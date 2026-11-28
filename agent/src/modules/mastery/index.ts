import { randomUUID } from "node:crypto";
import { HttpError } from "../../control/controlServer.ts";
import type { AgentModule } from "../../core/module.ts";
import type { AgentEvent, NewEvent } from "../../events/eventStore.ts";
import { DeferEventError, PermanentEventError } from "../../events/processor.ts";
import type { SiteAchievementsCache } from "../achievements/siteAchievements.ts";
import type { GamesService } from "../games/index.ts";
import { evaluateMastery } from "./criteria.ts";

/*
 * Fase 4.5 — Maestria: conclusão integral das conquistas elegíveis de um jogo.
 *
 *   achievement.unlocked ──site confirma "unlocked"──▶ mastery.check (persistido)
 *   mastery.check ──catálogo do site atualizado, 100% agora e não antes──▶ mastery.achieved
 *   mastery.achieved ──fila de alertas (prioridade protegida)──▶ overlay (apresentação especial)
 *
 * O agente não grava nada no site: no site a Maestria Final é derivada do progresso.
 */
export const MASTERY_CHECK = "mastery.check";
export const MASTERY_ACHIEVED = "mastery.achieved";

export type MasteryCheckPayload = {
  gameSlug: string;
  /** Conquista (id canônico no site) cujo desbloqueio disparou a verificação. */
  achievementId: string;
  unlockEventId: string;
  detectedLive: boolean;
  detectedAt: string | null;
};

export type MasteryPayload = {
  gameSlug: string;
  gameTitle: string;
  eligible: number | null;
  official: number | null;
  custom: number | null;
  badgeTitle: string | null;
  badgeImage: string | null;
  triggerAchievementId: string | null;
  triggerEventId: string | null;
  detectedLive: boolean;
  achievedAt: string;
};

export type MasteryCheckResult =
  | { result: "mastery"; masteryEventId: string; created: boolean; eligible: number }
  | { result: "incomplete"; eligible: number; completed: number; missing: string[] }
  | { result: "already_mastered" | "unknown_game" | "not_eligible" | "no_eligible_achievements"; eligible?: number };

/** Verificação persistida, registrada depois que o site confirma um desbloqueio novo. */
export function masteryCheckEvent(unlock: AgentEvent, achievement: { id: string; gameSlug: string }): NewEvent {
  const payload = unlock.payload as { detectedLive?: unknown; detectedAt?: unknown };
  const check: MasteryCheckPayload = {
    gameSlug: achievement.gameSlug,
    achievementId: achievement.id,
    unlockEventId: unlock.id,
    detectedLive: payload?.detectedLive === true,
    detectedAt: typeof payload?.detectedAt === "string" ? payload.detectedAt : null,
  };
  return { type: MASTERY_CHECK, source: "mastery", dedupeKey: `mastery-check:${unlock.id}`, payload: check };
}

type CacheLike = Pick<SiteAchievementsCache, "ensureFresh" | "forGame" | "game">;

/**
 * Handler de mastery.check. Só conclui com o catálogo do site recém-lido:
 *  - catálogo indisponível → adiado (sem gastar tentativa; nada é decidido sem dados);
 *  - catálogo ainda sem o desbloqueio que disparou a verificação → nova tentativa (cópia atrasada);
 *  - jogo fora do catálogo ou sem conquistas elegíveis → sem Maestria;
 *  - 100% agora e já 100% antes desse desbloqueio → sem Maestria (já conquistada antes);
 *  - 100% agora e não antes → mastery.achieved, deduplicado por jogo (uma Maestria por jogo).
 */
export function createMasteryCheckHandler(options: { cache: () => CacheLike | undefined; record: (event: NewEvent) => { event: AgentEvent; created: boolean }; now?: () => number; offlineDeferMs?: number }) {
  return async (event: AgentEvent): Promise<MasteryCheckResult> => {
    const check = event.payload as Partial<MasteryCheckPayload>;
    if (!check?.gameSlug || !check.achievementId) throw new PermanentEventError("Verificação de Maestria sem jogo ou conquista");
    const cache = options.cache();
    if (!cache) throw new DeferEventError("Catálogo do site ainda não disponível no agente", options.offlineDeferMs ?? 60_000);
    if (!(await cache.ensureFresh(true))) throw new DeferEventError("Catálogo do site indisponível; a verificação será refeita", options.offlineDeferMs ?? 60_000);

    const game = cache.game(check.gameSlug);
    if (!game) return { result: "unknown_game" };
    const achievements = cache.forGame(check.gameSlug);
    const trigger = achievements.find((a) => a.id === check.achievementId);
    // Conquista oculta (fora do progresso público): o conjunto elegível não mudou.
    if (!trigger) return { result: "not_eligible" };
    if (!trigger.completed) throw new Error("Catálogo do site ainda não mostra o desbloqueio; nova leitura em instantes");

    const now = evaluateMastery(achievements, game);
    if (now.eligible === 0) return { result: "no_eligible_achievements" };
    if (!now.complete) return { result: "incomplete", eligible: now.eligible, completed: now.completed, missing: now.missing };
    const before = evaluateMastery(achievements, game, { assumeLocked: trigger.id });
    if (before.complete) return { result: "already_mastered", eligible: now.eligible };

    const payload: MasteryPayload = {
      gameSlug: check.gameSlug,
      gameTitle: game.title,
      eligible: now.eligible,
      official: now.official,
      custom: now.custom,
      badgeTitle: game.finalBadge?.title ?? null,
      badgeImage: game.finalBadge?.image ?? null,
      triggerAchievementId: trigger.id,
      triggerEventId: check.unlockEventId ?? null,
      detectedLive: check.detectedLive === true,
      achievedAt: new Date((options.now ?? Date.now)()).toISOString(),
    };
    const recorded = options.record({ type: MASTERY_ACHIEVED, source: "mastery", dedupeKey: `mastery:${check.gameSlug}`, payload });
    return { result: "mastery", masteryEventId: recorded.event.id, created: recorded.created, eligible: now.eligible };
  };
}

/** Maestria de teste: mesmo caminho da fila e do overlay, sem site, sem progresso, sem dado real. */
export function masteryTestEvent(input: { slug?: unknown }, lookup: { title: (slug: string) => string | null; cache?: CacheLike }, now = Date.now()): NewEvent {
  const slug = typeof input.slug === "string" ? input.slug.trim() : "";
  const title = slug ? lookup.title(slug) : null;
  if (slug && !title) throw new HttpError(404, `Jogo "${slug}" não está no catálogo do site`);
  const evaluation = slug && lookup.cache?.game(slug) ? evaluateMastery(lookup.cache.forGame(slug), lookup.cache.game(slug)!) : null;
  const badge = slug ? (lookup.cache?.game(slug)?.finalBadge ?? null) : null;
  const payload: MasteryPayload = {
    gameSlug: slug || "teste",
    gameTitle: title ?? "Rumo à Conquista",
    eligible: evaluation?.eligible || null,
    official: evaluation?.eligible ? evaluation.official : null,
    custom: evaluation?.eligible ? evaluation.custom : null,
    badgeTitle: badge?.title ?? null,
    badgeImage: badge?.image ?? null,
    triggerAchievementId: null,
    triggerEventId: null,
    detectedLive: true,
    achievedAt: new Date(now).toISOString(),
  };
  return { type: MASTERY_ACHIEVED, source: "mastery-test", dedupeKey: `test:${randomUUID()}`, isTest: true, payload };
}

export type MasteryService = { summary(): MasterySummary };
export type MasterySummary = {
  checksWaiting: number;
  last: { gameTitle: string; at: string; isTest: boolean } | null;
};

export function masteryModule(options: { now?: () => number } = {}): AgentModule {
  const now = options.now ?? Date.now;
  let summary: () => MasterySummary = () => ({ checksWaiting: 0, last: null });

  return {
    name: "mastery",
    start(ctx) {
      const cache = () => ctx.services.get<SiteAchievementsCache>("siteAchievements");
      const games = ctx.services.get<GamesService>("games");
      ctx.events.handle(MASTERY_CHECK, createMasteryCheckHandler({ cache, record: (event) => ctx.events.record(event), now }));
      // A Maestria em si não sai do agente: concluir o evento só registra que foi aceita.
      // A apresentação é da fila de alertas, que lê mastery.achieved pelo próprio cursor.
      ctx.events.handle(MASTERY_ACHIEVED, (event) => ({ result: event.isTest ? "test" : "recorded" }));

      const latest = () => {
        const row = ctx.db
          .prepare("SELECT payload, is_test, occurred_at FROM events WHERE type = ? ORDER BY seq DESC LIMIT 1")
          .get(MASTERY_ACHIEVED);
        if (!row) return null;
        const payload = JSON.parse(String(row.payload)) as Partial<MasteryPayload>;
        return { gameTitle: payload.gameTitle ?? String(payload.gameSlug ?? ""), at: new Date(Number(row.occurred_at)).toISOString(), isTest: Number(row.is_test) === 1 };
      };
      summary = () => ({
        checksWaiting: Number(
          ctx.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = ? AND status IN ('pending','processing','retry_wait')").get(MASTERY_CHECK)?.n ?? 0,
        ),
        last: latest(),
      });
      ctx.services.provide<MasteryService>("mastery", { summary });

      ctx.control.route("GET", "/status", () => {
        const list = ctx.db
          .prepare("SELECT id, type, status, is_test, payload, result, occurred_at FROM events WHERE type IN (?, ?) ORDER BY seq DESC LIMIT 20")
          .all(MASTERY_CHECK, MASTERY_ACHIEVED)
          .map((row) => ({
            id: String(row.id),
            type: String(row.type),
            status: String(row.status),
            isTest: Number(row.is_test) === 1,
            payload: JSON.parse(String(row.payload)) as unknown,
            result: row.result ? (JSON.parse(String(row.result)) as unknown) : null,
            occurredAt: new Date(Number(row.occurred_at)).toISOString(),
          }));
        return { body: { ...summary(), recent: list } };
      });
      // Teste isolado (dock/CLI). Sem token, só da própria origem, como os controles do dock.
      ctx.control.route(
        "POST",
        "/test",
        async ({ body }) => {
          const input = (body ?? {}) as { slug?: unknown };
          const siteCache = cache();
          if (siteCache && typeof input.slug === "string" && input.slug) await siteCache.ensureFresh();
          const result = ctx.events.record(masteryTestEvent(input, { title: (slug) => games?.titleForSlug(slug) ?? siteCache?.game(slug)?.title ?? null, cache: siteCache }, now()));
          return { status: 201, body: { created: result.created, event: result.event } };
        },
        { requireToken: false },
      );
    },
    health() {
      const s = summary();
      return { ok: true, detail: { verificacoesPendentes: s.checksWaiting, ultima: s.last?.gameTitle ?? null } };
    },
  };
}

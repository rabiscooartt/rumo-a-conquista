import { randomUUID } from "node:crypto";
import { HttpError } from "../../control/controlServer.ts";
import { normalizeTitle } from "../games/titles.ts";
import type { AgentModule, ModuleContext } from "../../core/module.ts";
import type { GamesService } from "../games/index.ts";
import { windowsSignals } from "../games/signals.ts";
import type { AchievementProvider } from "./providers/types.ts";
import { SteamLocalProvider } from "./providers/steamLocal.ts";
import { SiteAchievementsCache } from "./siteAchievements.ts";
import { masteryCheckEvent } from "../mastery/index.ts";
import { createSiteSyncHandler } from "./siteSync.ts";
import { ACHIEVEMENT_UNLOCKED, AchievementWatcher, unlockDedupeKey, type ReadOutcome, type UnlockPayload } from "./watcher.ts";

export type AchievementsModuleOptions = {
  providers?: AchievementProvider[];
  fetchImpl?: typeof fetch;
  now?: () => number;
};

const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;

export type ManualUnlockInput = {
  slug?: unknown;
  /** Identificador canônico no site (provider "site"). */
  achievementId?: unknown;
  /** Nome da conquista CUSTOM quando ela não foi escolhida da lista (provider "custom"). */
  name?: unknown;
  description?: unknown;
  image?: unknown;
  isCustom?: unknown;
  isTest?: unknown;
  sessionId?: unknown;
  /**
   * Revisão depois da live (Parte B): quando aconteceu. Número = data confiável (vai ao site como
   * data da conquista); null = sem data. Omitido = agora, percebido ao vivo (comportamento normal).
   */
  at?: number | null;
  /** Evidência extra registrada no evento (ex.: { origin: "review", momentId }). */
  evidence?: Record<string, unknown>;
};

const optionalText = (value: unknown, max: number) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, "texto inválido");
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(400, `texto acima de ${max} caracteres`);
  return trimmed || null;
};

/**
 * Desbloqueio informado pelo operador (jogos sem fonte automática): pelo id canônico do site ou,
 * para CUSTOM que ainda não foi escolhida da lista, pelo nome. Eventos de teste usam chave de
 * deduplicação própria: nunca ocupam a vaga do desbloqueio real.
 */
export function operatorUnlockEvent(input: ManualUnlockInput, now = Date.now()) {
  const slug = String(input.slug ?? "").trim();
  if (!SLUG.test(slug)) throw new HttpError(400, "slug do jogo inválido");
  const achievementId = optionalText(input.achievementId, 200);
  const name = optionalText(input.name, 120);
  if (!achievementId && (!name || name.length < 2)) throw new HttpError(400, "informe o id da conquista ou o nome da conquista CUSTOM");
  const provider: UnlockPayload["provider"] = achievementId ? "site" : "custom";
  const externalId = achievementId ?? name!;
  const sourceKey = `site:${slug}`;
  const isTest = input.isTest === true;
  const dedupeId = provider === "custom" ? `custom:${normalizeTitle(name!)}` : externalId;
  const payload: UnlockPayload = {
    provider,
    agentProvider: "operator",
    sourceKey,
    gameSlug: slug,
    externalId,
    name,
    description: optionalText(input.description, 500),
    image: optionalText(input.image, 2000),
    isCustom: provider === "custom" ? true : input.isCustom === true,
    // Revisão: data do momento (fonte confiável) ou sem data; nunca "ao vivo" (sem alerta tardio).
    unlockedAt: input.at === undefined ? new Date(now).toISOString() : input.at === null ? null : new Date(input.at).toISOString(),
    timestampKind: input.at === undefined || input.at === null ? "detected" : "source",
    detectedAt: new Date(now).toISOString(),
    detectedLive: input.at === undefined,
    sessionId: typeof input.sessionId === "string" ? input.sessionId : null,
    evidence: { origin: "operator", ...input.evidence },
  };
  return {
    type: ACHIEVEMENT_UNLOCKED,
    dedupeKey: isTest ? `test:${randomUUID()}` : unlockDedupeKey("operator", sourceKey, dedupeId),
    source: "operator",
    isTest,
    payload,
  };
}

/**
 * Fase 3 — detecção de conquistas e sincronização automática com o site.
 * Observa a fonte do jogo em sessão, reconcilia as fontes conhecidas periodicamente e envia
 * cada desbloqueio ao site pelo processador de eventos (persistido antes, com retry).
 */
export function achievementsModule(options: AchievementsModuleOptions = {}): AgentModule {
  const now = options.now ?? Date.now;
  let ctx: ModuleContext | null = null;
  let watcher: AchievementWatcher | null = null;
  let providers: AchievementProvider[] = [];
  let games: GamesService | undefined;
  let timer: NodeJS.Timeout | null = null;
  let reconcileTimer: NodeJS.Timeout | null = null;
  let running: Promise<unknown> | null = null;
  let stopped = false;
  let lastSessionKey: string | null = null;
  const recent: ReadOutcome[] = [];
  let lastError: string | null = null;

  const remember = (outcome: ReadOutcome) => {
    if (outcome.skipped === "unchanged") return;
    recent.unshift({ ...outcome, emitted: [...outcome.emitted] });
    recent.length = Math.min(recent.length, 20);
  };

  const readSource = async (detectionKey: string, live: boolean, force = false) => {
    if (!watcher) return [];
    const session = games?.activeSession() ?? null;
    const outcomes: ReadOutcome[] = [];
    for (const provider of providers) {
      const sourceKey = provider.sourceKeyFor(detectionKey);
      if (!sourceKey) continue;
      const outcome = await watcher.read(provider, sourceKey, {
        live,
        force,
        sessionId: live ? (session?.id ?? null) : null,
        sessionStartedAt: live ? (session?.startedAt ?? null) : null,
        gameSlug: games?.slugForKey(sourceKey) ?? null,
      });
      remember(outcome);
      outcomes.push(outcome);
    }
    return outcomes;
  };

  /** Relê a fonte do jogo em sessão; ao fim da sessão, lê mais uma vez (a Steam pode gravar ao fechar). */
  const tick = async () => {
    const session = games?.activeSession() ?? null;
    const key = session?.detectionKey ?? null;
    if (lastSessionKey && lastSessionKey !== key) await readSource(lastSessionKey, false);
    lastSessionKey = key;
    if (key) await readSource(key, true);
  };

  const reconcile = async (force = false) => {
    if (!watcher) return [];
    const outcomes: ReadOutcome[] = [];
    for (const source of watcher.knownSources()) {
      const provider = providers.find((item) => item.id === source.provider);
      if (!provider) continue;
      const active = games?.activeSession();
      const live = active?.detectionKey === source.sourceKey;
      outcomes.push(
        await watcher.read(provider, source.sourceKey, {
          live,
          force,
          sessionId: live ? active!.id : null,
          sessionStartedAt: live ? active!.startedAt : null,
          gameSlug: games?.slugForKey(source.sourceKey) ?? null,
        }),
      );
    }
    outcomes.forEach(remember);
    return outcomes;
  };

  const guarded = (fn: () => Promise<unknown>) => {
    if (running || stopped) return Promise.resolve();
    running = fn()
      .then(() => {
        lastError = null;
      })
      .catch((error) => {
        lastError = (error as Error).message;
        ctx?.log.error("Falha na leitura de conquistas", { error });
      })
      .finally(() => {
        running = null;
      });
    return running;
  };

  const loop = () => {
    if (stopped || !ctx) return;
    void guarded(tick).finally(() => {
      if (!stopped) timer = setTimeout(loop, ctx!.config.achievements.pollMs);
    });
  };

  return {
    name: "achievements",

    async start(context) {
      ctx = context;
      games = context.services.get<GamesService>("games");
      const config = context.config;

      const siteAchievements = new SiteAchievementsCache({
        siteUrl: config.site.url,
        state: context.state,
        log: context.log.child("site-achievements"),
        fetchImpl: options.fetchImpl,
      });
      context.services.provide<SiteAchievementsCache>("siteAchievements", siteAchievements);

      const sync = createSiteSyncHandler({
        siteUrl: config.site.url,
        token: () => config.site.agentToken,
        site: context.connections.site,
        slugForKey: (key) => games?.slugForKey(key) ?? null,
        fetchImpl: options.fetchImpl,
      });
      context.events.handle(ACHIEVEMENT_UNLOCKED, async (event, hctx) => {
        const outcome = await sync(event, hctx);
        // Fase 4.5: desbloqueio novo confirmado pelo site → verificação de Maestria persistida.
        // "already_completed" numa nova tentativa também conta: a anterior pode ter gravado no
        // site e caído antes de registrar a verificação.
        const confirmedNow = outcome.result === "unlocked" || (outcome.result === "already_completed" && hctx.attempt > 1);
        const summary = outcome.achievement as { id?: unknown; gameSlug?: unknown } | undefined;
        if (!event.isTest && confirmedNow && typeof summary?.id === "string" && typeof summary.gameSlug === "string") {
          context.events.record(masteryCheckEvent(event, { id: summary.id, gameSlug: summary.gameSlug }));
        }
        return outcome;
      });
      if (!config.site.agentToken) {
        context.log.warn("siteAgentToken não configurado: desbloqueios ficam guardados e serão enviados quando houver token");
      }

      if (options.providers) providers = options.providers;
      else {
        const steamPath = config.games.steamPath ?? (await windowsSignals().steamPath());
        providers = [new SteamLocalProvider(() => steamPath)];
      }
      watcher = new AchievementWatcher({ db: context.db, record: (event) => context.events.record(event), log: context.log, now });

      context.control.route("GET", "/status", () => ({
        body: {
          enabled: config.achievements.enabled,
          providers: providers.map((p) => p.id),
          tokenConfigured: Boolean(config.site.agentToken),
          sources: watcher!.knownSources().map((s) => ({ ...s, ...watcher!.sourceSummary(s.provider, s.sourceKey) })),
          recentReads: recent,
          lastError,
        },
      }));
      context.control.route("POST", "/scan", async () => {
        const session = games?.activeSession();
        const active = session ? await readSource(session.detectionKey, true, true) : [];
        const reconciled = await reconcile(true);
        return { body: { active, reconciled } };
      });
      // Conquistas publicadas pelo site para um jogo (CUSTOM primeiro), para escolha manual.
      context.control.route("GET", "/site", async ({ query }) => {
        const slug = String(query.get("slug") ?? "");
        await siteAchievements.ensureFresh(query.get("refresh") === "1");
        const list = siteAchievements.forGame(slug).slice().sort((a, b) => Number(b.isCustom) - Number(a.isCustom));
        return { body: { slug, ...siteAchievements.info(), achievements: list } };
      });
      // Desbloqueio CUSTOM pelo operador (dock/CLI). Sem token, só da própria origem (como o dock).
      context.control.route(
        "POST",
        "/custom",
        async ({ body }) => {
          const input = (body ?? {}) as { slug?: unknown; achievementId?: unknown; name?: unknown; description?: unknown; isTest?: unknown };
          const slug = String(input.slug ?? "").trim();
          if (!games?.titleForSlug(slug)) throw new HttpError(404, `Jogo "${slug}" não está no catálogo do site`);
          await siteAchievements.ensureFresh();
          const name = typeof input.name === "string" ? input.name : null;
          const chosen = typeof input.achievementId === "string" && input.achievementId
            ? siteAchievements.byId(slug, input.achievementId)
            : name ? siteAchievements.customByTitle(slug, name) : null;
          if (typeof input.achievementId === "string" && input.achievementId && !chosen && siteAchievements.forGame(slug).length) {
            throw new HttpError(404, "Conquista não encontrada entre as publicadas pelo site para este jogo");
          }
          const session = games?.activeSession();
          const event = operatorUnlockEvent(
            chosen
              ? { slug, achievementId: chosen.id, name: chosen.title, description: chosen.description, image: chosen.image, isCustom: chosen.isCustom, isTest: input.isTest, sessionId: session?.slug === slug ? session.id : null }
              : { slug, achievementId: input.achievementId, name, description: input.description, isTest: input.isTest, sessionId: session?.slug === slug ? session.id : null },
            now(),
          );
          const result = context.events.record(event);
          return {
            status: result.created ? 201 : 200,
            body: { created: result.created, event: result.event, resolvedAs: chosen ? "site" : event.payload.provider },
          };
        },
        { requireToken: false },
      );
      context.control.route("POST", "/unlock", ({ body }) => {
        const input = (body ?? {}) as { slug?: unknown; achievementId?: unknown; isTest?: unknown };
        return { body: context.events.record(operatorUnlockEvent(input, now())) };
      });

      if (!config.achievements.enabled) {
        context.log.info("Detecção de conquistas desativada na configuração (a sincronização continua ativa)");
        return;
      }
      void guarded(() => reconcile());
      reconcileTimer = setInterval(() => void guarded(() => reconcile()), config.achievements.reconcileMs);
      reconcileTimer.unref?.();
      loop();
    },

    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (reconcileTimer) clearInterval(reconcileTimer);
      await running;
    },

    health() {
      return {
        ok: !lastError,
        detail: {
          provedores: providers.map((p) => p.id),
          fontesConhecidas: watcher?.knownSources().length ?? 0,
          tokenConfigurado: Boolean(ctx?.config.site.agentToken),
          erro: lastError,
        },
      };
    },
  };
}

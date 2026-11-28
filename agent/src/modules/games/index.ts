import type { AgentModule, ModuleContext } from "../../core/module.ts";
import { HttpError } from "../../control/controlServer.ts";
import { CatalogCache } from "./catalog.ts";
import { GameDetector, type ResolvedGame, type ScanResult } from "./detector.ts";
import { GameRepository, type GameSession } from "./repository.ts";
import { SessionManager } from "./sessions.ts";
import { windowsSignals, type SystemSignals } from "./signals.ts";
import { SteamLibrary } from "./steamLibrary.ts";
import { normalizeTitle } from "./titles.ts";

/** O que o módulo de jogos oferece aos outros módulos (ex.: conquistas). */
export type GamesService = {
  activeSession(): GameSession | null;
  /** Slug do catálogo associado a uma chave de detecção (ex.: steam:<appid>), se houver. */
  slugForKey(detectionKey: string): string | null;
  /** Jogos do catálogo do site (cópia local), para escolha manual. */
  catalogGames(): { slug: string; title: string }[];
  /**
   * Correção manual do jogo da sessão ativa. remember = também associa a fonte detectada
   * ao jogo para as próximas sessões (mapeamento manual).
   */
  correctSession(input: { slug: string; remember?: boolean }): { session: GameSession; remembered: string | null };
  /** Título do jogo no catálogo do site (cópia local), se existir. */
  titleForSlug(slug: string): string | null;
  /** Estado atual da identificação (mesmo conteúdo de GET /modules/games/status). */
  status(): GamesStatus;
};

export type GamesStatus = {
  enabled: boolean;
  current: ResolvedGame | null;
  lastScanAt: string | null;
  lastScanError: string | null;
  pendingStart: { identity: string; firstSeenAt: number } | null;
  activeSession: GameSession | null;
  warnings: string[];
};

export type GamesModuleOptions = {
  signals?: SystemSignals;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

/** Chave de detecção aceita em mapeamentos manuais. */
export const MAPPING_KEY_PATTERN = /^(steam:\d+|exe:[^\s|\\/]+\.exe|emulator:[a-z0-9]+(\|[a-z0-9 ]+)?)$/;

export function normalizeMappingKey(key: string) {
  const trimmed = key.trim();
  return trimmed.startsWith("exe:") ? trimmed.toLowerCase() : trimmed;
}

/**
 * Fase 2 — identificação de jogos e sessões.
 * Fontes: Steam (RunningAppID no registro + manifestos locais), executáveis mapeados
 * (jogos externos) e emuladores conhecidos (título da janela). Resolve contra o catálogo
 * público do site e mantém sessões persistentes, emitindo game.session.started/ended.
 */
export function gamesModule(options: GamesModuleOptions = {}): AgentModule {
  const now = options.now ?? Date.now;
  let ctx: ModuleContext | null = null;
  let repo: GameRepository | null = null;
  let catalog: CatalogCache | null = null;
  let detector: GameDetector | null = null;
  let sessions: SessionManager | null = null;
  let timer: NodeJS.Timeout | null = null;
  let catalogTimer: NodeJS.Timeout | null = null;
  let scanning: Promise<void> | null = null;
  let stopped = false;
  let enabled = true;
  let steamLibrary: SteamLibrary | null = null;
  let lastScan: ScanResult | null = null;
  let lastScanError: string | null = null;
  let lastCurrentKey: string | null = null;
  let lastWarnings = "";

  const scan = async () => {
    if (!detector || !sessions || !ctx) return;
    try {
      const result = await detector.scan(now());
      if (stopped) return;
      lastScan = result;
      lastScanError = null;
      sessions.observe(result.current, result.at);
      const currentKey = result.current ? `${result.current.identity}` : null;
      if (currentKey !== lastCurrentKey) {
        lastCurrentKey = currentKey;
        if (result.current) {
          ctx.log.info("Jogo detectado", {
            jogo: result.current.title,
            slug: result.current.slug,
            chave: result.current.key,
            resolvidoPor: result.current.resolvedBy,
          });
        } else {
          ctx.log.info("Nenhum jogo detectado");
        }
      }
      const warnings = result.warnings.join("; ");
      if (warnings !== lastWarnings) {
        lastWarnings = warnings;
        if (warnings) ctx.log.warn("Aviso na detecção", { avisos: result.warnings });
      }
    } catch (error) {
      lastScanError = (error as Error).message;
      ctx.log.error("Falha na varredura de jogos", { error });
    }
  };

  const loop = () => {
    if (stopped || !ctx) return;
    scanning = scan().finally(() => {
      scanning = null;
      if (!stopped) timer = setTimeout(loop, ctx!.config.games.pollMs);
    });
  };

  const status = () => ({
    enabled,
    current: lastScan?.current ?? null,
    detections: lastScan?.detections ?? [],
    ignored: lastScan?.ignored ?? [],
    warnings: lastScan?.warnings ?? [],
    lastScanAt: lastScan ? new Date(lastScan.at).toISOString() : null,
    lastScanMs: lastScan?.durationMs ?? null,
    lastScanError,
    pendingStart: sessions?.pendingCandidate() ?? null,
    activeSession: sessions?.current() ?? null,
    catalog: catalog?.info() ?? null,
    steamPath: steamLibrary ? steamLibrary.libraryPaths() : null,
  });

  return {
    name: "games",

    async start(context) {
      ctx = context;
      repo = new GameRepository(context.db, now);
      catalog = new CatalogCache({
        siteUrl: context.config.site.url,
        state: context.state,
        log: context.log.child("catalog"),
        fetchImpl: options.fetchImpl,
      });
      registerRoutes(context, () => ({ repo: repo!, catalog: catalog!, status, rescan: scan }));
      const service: GamesService = {
        activeSession: () => sessions?.current() ?? null,
        status,
        titleForSlug: (slug) => catalog?.bySlug(slug)?.title ?? null,
        catalogGames: () => (catalog?.games() ?? []).map((g) => ({ slug: g.slug, title: g.title })),
        correctSession: ({ slug, remember }) => {
          const game = catalog?.bySlug(String(slug ?? "").trim());
          if (!game) throw new HttpError(404, `Jogo "${slug}" não está no catálogo do site`);
          const active = sessions?.current();
          if (!active) throw new HttpError(409, "Nenhuma sessão ativa para corrigir. Para o executável atual, use games map.");
          const session = sessions!.correct({ slug: game.slug, title: game.title, now: now() });
          if (!session) throw new HttpError(409, "A sessão foi encerrada antes da correção");
          let remembered: string | null = null;
          if (remember) {
            const content = typeof session.detail.content === "string" && session.detail.content ? session.detail.content : null;
            remembered = content && session.detectionKey.startsWith("emulator:") ? `${session.detectionKey}|${normalizeTitle(content)}` : session.detectionKey;
            repo!.setMapping({ detectionKey: remembered, slug: game.slug, title: game.title, origin: "manual" });
          }
          return { session, remembered };
        },
        slugForKey: (key) => {
          const active = sessions?.current();
          if (active?.detectionKey === key && active.slug) return active.slug;
          const mapping = repo?.mapping(key);
          return mapping && !mapping.ignored ? mapping.slug : null;
        },
      };
      context.services.provide("games", service);

      if (!context.config.games.enabled) {
        enabled = false;
        context.log.info("Identificação de jogos desativada na configuração");
        return;
      }

      const signals = options.signals ?? windowsSignals();
      const steamPath = context.config.games.steamPath ?? (await signals.steamPath());
      steamLibrary = steamPath ? new SteamLibrary(steamPath) : null;
      if (!steamPath) context.log.warn("Steam não encontrada; detecção Steam indisponível");

      await catalog.refresh(10_000);
      catalogTimer = setInterval(() => void catalog!.refresh(), context.config.games.catalogRefreshMs);
      catalogTimer.unref?.();

      detector = new GameDetector({ signals, repo, catalog, steamLibrary: () => steamLibrary });
      sessions = new SessionManager({
        repo,
        record: (event) => context.events.record(event),
        log: context.log.child("sessions"),
        options: {
          startConfirmMs: context.config.games.startConfirmMs,
          endGraceMs: context.config.games.endGraceMs,
          resumeMaxGapMs: context.config.games.resumeMaxGapMs,
        },
      });
      sessions.restore(now());
      loop();
    },

    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (catalogTimer) clearInterval(catalogTimer);
      await scanning;
      sessions?.flush(now());
    },

    health() {
      const s = status();
      return {
        ok: !s.lastScanError,
        detail: {
          enabled: s.enabled,
          jogoAtual: s.current ? { title: s.current.title, slug: s.current.slug, key: s.current.key, resolvedBy: s.current.resolvedBy } : null,
          sessao: s.activeSession
            ? { id: s.activeSession.id, title: s.activeSession.title, startedAt: new Date(s.activeSession.startedAt).toISOString() }
            : null,
          catalogo: s.catalog,
          ultimaVarredura: s.lastScanAt,
          ultimaVarreduraMs: s.lastScanMs,
          erro: s.lastScanError,
        },
      };
    },
  };
}

function registerRoutes(
  ctx: ModuleContext,
  deps: () => { repo: GameRepository; catalog: CatalogCache; status: () => unknown; rescan: () => Promise<void> },
) {
  ctx.control.route("GET", "/status", () => ({ body: deps().status() }));
  ctx.control.route("GET", "/sessions", ({ query }) => ({
    body: { sessions: deps().repo.sessions(Number(query.get("limit") ?? 20) || 20) },
  }));
  ctx.control.route("GET", "/mappings", () => ({ body: { mappings: deps().repo.mappings() } }));
  ctx.control.route("POST", "/session/correct", ({ body }) => {
    const input = (body ?? {}) as { slug?: string; remember?: boolean };
    const service = ctx.services.get<GamesService>("games")!;
    return { body: service.correctSession({ slug: String(input.slug ?? ""), remember: input.remember === true }) };
  }, { requireToken: false });
  ctx.control.route("GET", "/catalog", () => ({ body: { ...deps().catalog.info(), games: deps().catalog.games() } }));
  ctx.control.route("POST", "/catalog/refresh", async () => {
    const ok = await deps().catalog.refresh();
    return { status: ok ? 200 : 502, body: deps().catalog.info() };
  });
  ctx.control.route("POST", "/mappings", async ({ body }) => {
    const input = (body ?? {}) as { key?: string; slug?: string; ignore?: boolean; remove?: boolean };
    const result = applyMapping(deps().repo, deps().catalog, input);
    await deps().rescan();
    return { body: result };
  });
}

/** Regras de mapeamento manual (compartilhadas pela API e pelo CLI com o agente parado). */
export function applyMapping(
  repo: GameRepository,
  catalog: { bySlug(slug: string): { slug: string; title: string } | null; games(): unknown[] },
  input: { key?: string; slug?: string; ignore?: boolean; remove?: boolean },
) {
  const key = normalizeMappingKey(String(input.key ?? ""));
  if (!MAPPING_KEY_PATTERN.test(key)) {
    throw new HttpError(400, `Chave inválida: "${input.key}". Use steam:<appid>, exe:<nome.exe> ou emulator:<id>[|conteúdo]`);
  }
  if (input.remove) return { ok: repo.deleteMapping(key), key, action: "removed" };
  if (input.ignore) {
    repo.setMapping({ detectionKey: key, slug: null, title: null, ignored: true, origin: "manual" });
    return { ok: true, key, action: "ignored" };
  }
  const slug = String(input.slug ?? "").trim();
  if (!slug) throw new HttpError(400, "Informe o slug do jogo no catálogo do site");
  const game = catalog.bySlug(slug);
  if (!game && catalog.games().length) throw new HttpError(404, `Slug "${slug}" não existe no catálogo do site`);
  repo.setMapping({ detectionKey: key, slug, title: game?.title ?? null, origin: "manual" });
  return { ok: true, key, action: "mapped", slug, title: game?.title ?? null };
}

import { createReadStream, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { HttpError } from "../../control/controlServer.ts";
import { ObsRequestError } from "../../connections/obsConnection.ts";
import type { AgentModule, ModuleContext } from "../../core/module.ts";
import { ClipStore, CLIP_STATUSES, type ClipStatus } from "./clipStore.ts";
import { ClipEngine, type ClipSettings, type ReplayBackend } from "./engine.ts";

/** obs-websocket: "Replay buffer is not available" (desabilitado nas configurações de saída). */
const NOT_AVAILABLE = 604;

/**
 * Backend real: só pedidos de leitura ao OBS, mais SaveReplayBuffer. O agente não liga nem
 * desliga o buffer e não muda nenhuma configuração do OBS.
 */
export function obsReplayBackend(ctx: Pick<ModuleContext, "connections">): ReplayBackend {
  const request = (type: string, data?: Record<string, unknown>) => ctx.connections.obsDriver.request(type, data);
  return {
    connected: () => ctx.connections.obs.isConnected(),
    async status() {
      try {
        const r = await request("GetReplayBufferStatus");
        return { available: true, active: r.outputActive === true };
      } catch (error) {
        if (error instanceof ObsRequestError && error.code === NOT_AVAILABLE) return { available: false, active: false };
        throw error;
      }
    },
    async bufferSeconds() {
      const mode = await request("GetProfileParameter", { parameterCategory: "Output", parameterName: "Mode" });
      const category = mode.parameterValue === "Advanced" ? "AdvOut" : "SimpleOutput";
      const r = await request("GetProfileParameter", { parameterCategory: category, parameterName: "RecRBTime" });
      const value = Number(r.parameterValue ?? r.defaultParameterValue);
      return Number.isFinite(value) && value > 0 ? value : null;
    },
    async recordDirectory() {
      const r = await request("GetRecordDirectory");
      return typeof r.recordDirectory === "string" && r.recordDirectory ? r.recordDirectory : null;
    },
    async lastReplay() {
      const r = await request("GetLastReplayBufferReplay");
      return typeof r.savedReplayPath === "string" && r.savedReplayPath ? r.savedReplayPath : null;
    },
    async save() {
      await request("SaveReplayBuffer");
    },
  };
}

export type ClipsSummary = {
  enabled: boolean;
  obs: boolean;
  bufferAvailable: boolean;
  bufferActive: boolean;
  bufferSeconds: number | null;
  preSeconds: number;
  postSeconds: number;
  dir: string | null;
  counts: Record<ClipStatus, number>;
  last: { file: string; at: string } | null;
  lastError: string | null;
};
export type ClipsService = {
  summary(): ClipsSummary;
  /** Pede o clip de um momento marcado; null quando os clips estão desativados. */
  requestMoment(input: { momentId: string; markedAt: number; gameSlug: string | null; title: string | null }): { id: string } | null;
  /** Estado de um clip (para a revisão de momentos). */
  clip(id: string): { id: string; status: ClipStatus; filePath: string | null; lastError: string | null } | null;
  /** Acrescenta informações à ficha .json ao lado do vídeo (ex.: a conquista escolhida na revisão). */
  annotate(id: string, extra: Record<string, unknown>): boolean;
  /** Apaga o vídeo e a ficha de um clip (descartado na revisão). */
  deleteFile(id: string): boolean;
};

const VIDEO_TYPES: Record<string, string> = { ".mp4": "video/mp4", ".mkv": "video/x-matroska", ".mov": "video/quicktime", ".webm": "video/webm" };

export const CLIP_DEFAULTS = { retryMs: 10_000, saveTimeoutMs: 30_000, settleMs: 500, pollMs: 1_000, statusMs: 15_000, testPostMs: 5_000 };

/** Fase 4.6 — clips automáticos locais pelo buffer de replay do OBS. */
export function clipsModule(options: { backend?: (ctx: ModuleContext) => ReplayBackend; settings?: Partial<typeof CLIP_DEFAULTS>; now?: () => number } = {}): AgentModule {
  const tuning = { ...CLIP_DEFAULTS, ...options.settings };
  let engine: ClipEngine | null = null;
  let store: ClipStore | null = null;
  let statusTimer: NodeJS.Timeout | null = null;
  let buffer = { obs: false, available: false, active: false, seconds: null as number | null };
  let enabled = false;
  let config: ModuleContext["config"]["clips"] | null = null;

  const summary = (): ClipsSummary => {
    const last = store?.lastCompleted() ?? null;
    const failed = store?.list(1).find((c) => c.status === "failed" || c.status === "expired");
    return {
      enabled,
      obs: buffer.obs,
      bufferAvailable: buffer.available,
      bufferActive: buffer.active,
      bufferSeconds: buffer.seconds,
      preSeconds: config?.preSeconds ?? 0,
      postSeconds: config?.postSeconds ?? 0,
      dir: engine?.clipsDir() ?? null,
      counts: store?.counts() ?? (Object.fromEntries(CLIP_STATUSES.map((s) => [s, 0])) as Record<ClipStatus, number>),
      last: last?.filePath ? { file: last.filePath, at: new Date(last.completedAt ?? last.updatedAt).toISOString() } : null,
      lastError: failed?.lastError ?? null,
    };
  };

  return {
    name: "clips",
    start(ctx) {
      config = ctx.config.clips;
      enabled = config.enabled;
      store = new ClipStore(ctx.db, options.now);
      const settings = (): ClipSettings => ({
        dir: ctx.config.clips.dir,
        preSeconds: ctx.config.clips.preSeconds,
        postSeconds: ctx.config.clips.postSeconds,
        minFreeBytes: ctx.config.clips.minFreeBytes,
        retryMs: tuning.retryMs,
        saveTimeoutMs: tuning.saveTimeoutMs,
        settleMs: tuning.settleMs,
        pollMs: tuning.pollMs,
      });
      engine = new ClipEngine({
        db: ctx.db,
        store,
        backend: (options.backend ?? obsReplayBackend)(ctx),
        log: ctx.log,
        settings,
        cursor: { get: () => ctx.state.get<number>("cursor"), set: (v) => ctx.state.set("cursor", v) },
        now: options.now,
      });
      ctx.services.provide<ClipsService>("clips", {
        summary,
        requestMoment: (input) => {
          if (!enabled) return null;
          const { clip } = engine!.requestMoment(input);
          engine!.kick();
          return { id: clip.id };
        },
        clip: (id) => {
          const c = store!.get(id);
          return c ? { id: c.id, status: c.status, filePath: c.filePath, lastError: c.lastError } : null;
        },
        annotate: (id, extra) => {
          const c = store!.get(id);
          store?.mergePayload(id, extra);
          if (!c?.filePath || !existsSync(`${c.filePath}.json`)) return false;
          try {
            const meta = JSON.parse(readFileSync(`${c.filePath}.json`, "utf8")) as Record<string, unknown>;
            writeFileSync(`${c.filePath}.json`, JSON.stringify({ ...meta, ...extra }, null, 2));
            return true;
          } catch {
            return false;
          }
        },
        deleteFile: (id) => {
          const c = store!.get(id);
          if (!c?.filePath) return false;
          for (const f of [c.filePath, `${c.filePath}.json`]) if (existsSync(f)) unlinkSync(f);
          ctx.log.info("Clip apagado na revisão", { clipId: id });
          return true;
        },
      });

      const refresh = async (force = false) => {
        try {
          const info = await engine!.bufferInfo(force);
          buffer = { obs: info.obs, available: info.available, active: info.active, seconds: info.seconds };
        } catch (error) {
          buffer = { ...buffer, obs: false };
          ctx.log.debug("Estado do buffer de replay indisponível", { error: (error as Error).message });
        }
      };

      ctx.control.route("GET", "/status", async ({ query }) => {
        await refresh(query.get("refresh") === "1");
        return { body: summary() };
      });
      ctx.control.route("GET", "/list", ({ query }) => ({ body: { clips: store!.list(Number(query.get("limit") ?? 20) || 20) } }));
      // Estado de um clip (o aplicativo acompanha a gravação do momento para o indicador na tela).
      ctx.control.route("GET", "/item", ({ query }) => {
        const clip = store!.get(String(query.get("id") ?? ""));
        if (!clip) throw new HttpError(404, "Clip não encontrado");
        return { body: { id: clip.id, status: clip.status, dueAt: clip.dueAt, filePath: clip.filePath, lastError: clip.lastError, now: (options.now ?? Date.now)() } };
      });
      // Vídeo de um clip salvo, para assistir na revisão (mesmo agente; aceita Range para avançar/voltar).
      ctx.control.route("GET", "/video", ({ query }) => {
        const clip = store!.get(String(query.get("id") ?? ""));
        if (!clip?.filePath || clip.status !== "completed" || !existsSync(clip.filePath)) throw new HttpError(404, "Clip não encontrado");
        const path = clip.filePath;
        return {
          body: null,
          raw: (req, res) => {
            const size = statSync(path).size;
            const type = VIDEO_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
            const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
            if (range && (range[1] || range[2])) {
              const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
              const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
              if (start >= size || start > end) {
                res.writeHead(416, { "content-range": `bytes */${size}` });
                return res.end();
              }
              res.writeHead(206, { "content-type": type, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes", "cache-control": "no-store" });
              return void createReadStream(path, { start, end }).pipe(res);
            }
            res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes", "cache-control": "no-store" });
            createReadStream(path).pipe(res);
          },
        };
      });
      // Teste isolado (dock/CLI): salva um replay real na subpasta "testes", sem evento, conquista ou site.
      ctx.control.route(
        "POST",
        "/test",
        async () => {
          if (!enabled) throw new HttpError(409, "Clips desativados na configuração (clipsEnabled)");
          await refresh(true);
          if (!buffer.obs) throw new HttpError(409, "OBS desconectado");
          if (!buffer.available) throw new HttpError(409, "Buffer de replay desabilitado no OBS (Configurações > Saída > Buffer de replay)");
          if (!buffer.active) throw new HttpError(409, "Buffer de replay desligado: inicie-o no OBS (Controles > Iniciar buffer de replay)");
          const result = engine!.requestTest(tuning.testPostMs);
          engine!.kick();
          return { status: 201, body: { clip: result.clip, dir: engine!.clipsDir() } };
        },
        { requireToken: false },
      );

      if (!enabled) {
        ctx.log.info("Clips desativados na configuração (clipsEnabled=false)");
        return;
      }
      engine.start();
      void refresh(true);
      statusTimer = setInterval(() => void refresh(), tuning.statusMs);
      statusTimer.unref?.();
    },
    async stop() {
      if (statusTimer) clearInterval(statusTimer);
      await engine?.stop();
    },
    health() {
      const s = summary();
      return {
        ok: !s.enabled || s.bufferActive,
        detail: { ativo: s.enabled, buffer: s.bufferActive ? "ativo" : s.bufferAvailable ? "desligado" : "indisponível", pasta: s.dir, falhas: s.counts.failed },
      };
    },
  };
}

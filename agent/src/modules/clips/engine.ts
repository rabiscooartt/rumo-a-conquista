import { copyFileSync, existsSync, mkdirSync, renameSync, statSync, statfsSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import type { Logger } from "../../logger.ts";
import { transaction, type SqlDatabase } from "../../store/database.ts";
import { ACHIEVEMENT_UNLOCKED } from "../achievements/watcher.ts";
import { MASTERY_ACHIEVED } from "../mastery/index.ts";
import type { Clip, ClipStore } from "./clipStore.ts";

/**
 * Onde o vídeo vem: o buffer de replay do OBS (memória com os últimos N segundos).
 * A implementação real fala com o obs-websocket; os testes usam uma falsa.
 */
export interface ReplayBackend {
  /** OBS conectado agora. */
  connected(): boolean;
  /** available=false: buffer desabilitado nas configurações de saída do OBS. */
  status(): Promise<{ available: boolean; active: boolean }>;
  /** Duração máxima do buffer configurada no OBS (segundos), ou null se não der para ler. */
  bufferSeconds(): Promise<number | null>;
  recordDirectory(): Promise<string | null>;
  lastReplay(): Promise<string | null>;
  save(): Promise<void>;
}

/** Falha que não se resolve tentando de novo (sem buffer, sem espaço, destino inválido). */
export class ClipPermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClipPermanentError";
  }
}

export type ClipSettings = {
  dir: string | null;
  preSeconds: number;
  postSeconds: number;
  minFreeBytes: number;
  /** Intervalo entre tentativas quando o OBS está fora (dentro da janela do buffer). */
  retryMs: number;
  /** Espera pelo arquivo novo do replay depois do pedido de salvar. */
  saveTimeoutMs: number;
  /** Intervalo da checagem de tamanho estável do arquivo. */
  settleMs: number;
  pollMs: number;
};

export const CLIPS_FOLDER = "Clips Rumo à Conquista";
export const TEST_CLIP_KIND = "test";
export const MOMENT_CLIP_KIND = "moment";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slug = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "clip";
const two = (n: number) => String(n).padStart(2, "0");

/** Caminho previsível e sem colisão: <pasta>/<AAAA-MM>/<jogo>/<AAAA-MM-DD_HH-MM-SS>_<tipo>_<nome>_<id8>.<ext> */
export function clipFileName(clip: Clip, ext: string) {
  const d = new Date(clip.eventAt);
  const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}_${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`;
  const kind = clip.payload.mastery
    ? "conquista-maestria"
    : clip.kind === "mastery"
      ? "maestria"
      : clip.kind === TEST_CLIP_KIND
        ? "teste"
        : clip.kind === MOMENT_CLIP_KIND
          ? "momento"
          : "conquista";
  const sub = clip.isTest ? "testes" : join(`${d.getFullYear()}-${two(d.getMonth() + 1)}`, clip.gameSlug ? slug(clip.gameSlug) : "sem-jogo");
  return { sub, name: `${stamp}_${kind}_${slug(clip.title ?? clip.gameSlug ?? "clip")}_${clip.id.slice(0, 8)}${ext || ".mp4"}` };
}

/**
 * Motor de clips — independente da fila de alertas.
 *  - Ingestão por cursor dos eventos já persistidos: desbloqueios percebidos ao vivo e Maestrias
 *    (eventos de teste nunca viram clip real). Um clip por evento (dedupe).
 *  - Cada clip vence em evento + postSeconds; o agente pede ao OBS para salvar o buffer de
 *    replay, espera o arquivo novo terminar de ser escrito e o move para a pasta de clips,
 *    com um .json ao lado descrevendo o evento.
 *  - A janela útil é o tamanho do buffer: depois de evento + buffer, o momento já saiu da
 *    memória do OBS e o clip vira "expired" (nunca um vídeo errado).
 */
export class ClipEngine {
  private readonly db: SqlDatabase;
  private readonly store: ClipStore;
  private readonly backend: ReplayBackend;
  private readonly log: Logger;
  private readonly settings: () => ClipSettings;
  private readonly cursor: { get(): number | undefined; set(v: number): void };
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = true;
  private cachedBuffer: { seconds: number | null; dir: string | null; at: number } = { seconds: null, dir: null, at: 0 };

  constructor(options: {
    db: SqlDatabase;
    store: ClipStore;
    backend: ReplayBackend;
    log: Logger;
    settings: () => ClipSettings;
    cursor: { get(): number | undefined; set(v: number): void };
    now?: () => number;
  }) {
    this.db = options.db;
    this.store = options.store;
    this.backend = options.backend;
    this.log = options.log;
    this.settings = options.settings;
    this.cursor = options.cursor;
    this.now = options.now ?? Date.now;
  }

  /** Primeira execução: o histórico anterior ao módulo não vira clip. */
  initCursor() {
    if (this.cursor.get() !== undefined) return;
    const max = Number(this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM events").get()?.m ?? 0);
    this.cursor.set(max);
  }

  ingest(batch = 100): number {
    let read = 0;
    transaction(this.db, () => {
      const from = this.cursor.get() ?? 0;
      const rows = this.db
        .prepare("SELECT seq, id, type, payload, is_test, occurred_at FROM events WHERE type IN (?, ?) AND seq > ? ORDER BY seq LIMIT ?")
        .all(ACHIEVEMENT_UNLOCKED, MASTERY_ACHIEVED, from, batch);
      read = rows.length;
      let last = from;
      for (const row of rows) {
        last = Number(row.seq);
        if (Number(row.is_test) === 1) continue;
        const payload = JSON.parse(String(row.payload)) as Record<string, unknown>;
        if (payload.detectedLive !== true) continue;
        const post = this.settings().postSeconds * 1000;
        if (String(row.type) === MASTERY_ACHIEVED) {
          this.ingestMastery(row, payload, post);
          continue;
        }
        const eventAt = Date.parse(String(payload.detectedAt ?? "")) || Number(row.occurred_at);
        const result = this.store.insert({
          kind: "achievement",
          dedupeKey: `clip:${row.id}`,
          sourceEventId: String(row.id),
          gameSlug: typeof payload.gameSlug === "string" ? payload.gameSlug : null,
          title: typeof payload.name === "string" && payload.name ? payload.name : String(payload.externalId ?? "conquista"),
          payload: { achievementId: payload.externalId ?? null, provider: payload.provider ?? null, sessionId: payload.sessionId ?? null, isCustom: payload.isCustom === true },
          eventAt,
          dueAt: eventAt + post,
        });
        if (result.created) this.log.info("Clip agendado", { clipId: result.clip.id, eventId: row.id, salvaEm: new Date(result.clip.dueAt).toISOString() });
      }
      if (last !== from) this.cursor.set(last);
    });
    return read;
  }

  /** A Maestria entra no clip da conquista que a disparou; sem ele, vira um clip próprio. */
  private ingestMastery(row: Record<string, unknown>, payload: Record<string, unknown>, post: number) {
    const mastery = { gameTitle: payload.gameTitle ?? null, eligible: payload.eligible ?? null };
    const trigger = typeof payload.triggerEventId === "string" ? this.store.bySourceEvent(payload.triggerEventId) : null;
    if (trigger && (trigger.status === "pending" || trigger.status === "saving")) {
      this.store.mergePayload(trigger.id, { mastery });
      this.log.info("Maestria registrada no clip da conquista que a disparou", { clipId: trigger.id });
      return;
    }
    const eventAt = Number(row.occurred_at);
    this.store.insert({
      kind: "mastery",
      dedupeKey: `clip:${row.id}`,
      sourceEventId: String(row.id),
      gameSlug: typeof payload.gameSlug === "string" ? payload.gameSlug : null,
      title: `Maestria ${String(payload.gameTitle ?? payload.gameSlug ?? "")}`.trim(),
      payload: { mastery },
      eventAt,
      dueAt: eventAt + post,
    });
  }

  /** Clip de um momento marcado pelo atalho (Parte A/B): real, um por momento. */
  requestMoment(input: { momentId: string; markedAt: number; gameSlug: string | null; title: string | null }) {
    return this.store.insert({
      kind: MOMENT_CLIP_KIND,
      dedupeKey: `clip:moment:${input.momentId}`,
      sourceEventId: null,
      gameSlug: input.gameSlug,
      title: input.title ?? "Momento",
      payload: { momentId: input.momentId },
      eventAt: input.markedAt,
      dueAt: input.markedAt + this.settings().postSeconds * 1000,
    });
  }

  /** Clip de teste: mesmo caminho real (buffer, arquivo, pasta), sem evento, conquista ou site. */
  requestTest(postMs = 5_000) {
    const now = this.now();
    return this.store.insert({
      kind: TEST_CLIP_KIND,
      dedupeKey: `test:${now}:${Math.random().toString(36).slice(2)}`,
      title: "Teste de clip",
      isTest: true,
      payload: {},
      eventAt: now,
      dueAt: now + postMs,
    });
  }

  /** Estado do buffer (para dock/status), com cache curto para não martelar o OBS. */
  async bufferInfo(force = false) {
    if (!this.backend.connected()) return { obs: false, available: false, active: false, seconds: this.cachedBuffer.seconds, recordDirectory: this.cachedBuffer.dir };
    const status = await this.backend.status();
    if (force || this.now() - this.cachedBuffer.at > 60_000 || this.cachedBuffer.seconds === null) {
      this.cachedBuffer = {
        seconds: await this.backend.bufferSeconds().catch(() => null),
        dir: await this.backend.recordDirectory().catch(() => null),
        at: this.now(),
      };
    }
    return { obs: true, ...status, seconds: this.cachedBuffer.seconds, recordDirectory: this.cachedBuffer.dir };
  }

  /** Pasta efetiva (configurada, ou dentro da pasta de gravação do OBS). */
  clipsDir() {
    return this.settings().dir ?? (this.cachedBuffer.dir ? join(this.cachedBuffer.dir, CLIPS_FOLDER) : null);
  }

  private windowMs() {
    const s = this.settings();
    return (this.cachedBuffer.seconds ?? s.preSeconds + s.postSeconds) * 1000;
  }

  /** Retoma o que ficou no meio quando o agente caiu. */
  recover() {
    for (const clip of this.store.interrupted()) {
      if (clip.obsPath && existsSync(clip.obsPath)) {
        this.store.retry(clip.id, "Retomando: o replay já estava salvo, falta mover", this.now());
        continue;
      }
      if (this.now() - clip.eventAt < this.windowMs()) this.store.retry(clip.id, "Captura interrompida pelo encerramento do agente", this.now());
      else this.store.finish(clip.id, "expired", "Captura interrompida e o momento já saiu do buffer do OBS");
    }
  }

  async processNext(): Promise<Clip | null> {
    const clip = this.store.claimDue();
    if (!clip) return null;
    try {
      const { filePath, size } = await this.capture(clip);
      this.store.complete(clip.id, filePath, size);
      this.log.info("Clip salvo", { clipId: clip.id, arquivo: filePath, mb: Math.round(size / 1048576) });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const current = this.store.get(clip.id);
      if (err instanceof ClipPermanentError) {
        this.store.finish(clip.id, "failed", err.message);
        this.log.warn("Clip não gerado", { clipId: clip.id, motivo: err.message });
      } else if (current?.obsPath && existsSync(current.obsPath)) {
        this.store.retry(clip.id, err.message, this.now() + this.settings().retryMs);
      } else if (this.now() + this.settings().retryMs - clip.eventAt < this.windowMs()) {
        this.store.retry(clip.id, err.message, this.now() + this.settings().retryMs);
        this.log.warn("Clip adiado", { clipId: clip.id, motivo: err.message });
      } else {
        this.store.finish(clip.id, "expired", `${err.message}; o momento saiu do buffer do OBS`);
        this.log.warn("Clip perdido: o momento saiu do buffer", { clipId: clip.id, motivo: err.message });
      }
    }
    return this.store.get(clip.id);
  }

  private async capture(clip: Clip): Promise<{ filePath: string; size: number }> {
    let obsPath = clip.obsPath && existsSync(clip.obsPath) ? clip.obsPath : null;
    if (!obsPath) {
      if (!this.backend.connected()) throw new Error("OBS desconectado");
      const info = await this.bufferInfo();
      if (!info.available) throw new ClipPermanentError("Buffer de replay desabilitado no OBS (Configurações > Saída > Buffer de replay)");
      if (!info.active) throw new ClipPermanentError("Buffer de replay desligado no OBS no momento do evento");
      if (this.now() - clip.eventAt > this.windowMs()) throw new Error("Momento fora da janela do buffer");
      const before = await this.backend.lastReplay().catch(() => null);
      await this.backend.save();
      obsPath = await this.waitNewReplay(before);
      this.store.setObsPath(clip.id, obsPath);
    }
    await this.waitStable(obsPath);
    return this.moveToClips(clip, obsPath);
  }

  private async waitNewReplay(before: string | null) {
    const deadline = this.now() + this.settings().saveTimeoutMs;
    for (;;) {
      const path = await this.backend.lastReplay().catch(() => null);
      if (path && path !== before && existsSync(path)) return path;
      if (this.now() > deadline) throw new Error("O OBS não confirmou o arquivo do replay a tempo");
      await sleep(Math.min(250, this.settings().settleMs));
    }
  }

  /** Espera o OBS terminar de escrever (tamanho estável em duas leituras). */
  private async waitStable(path: string) {
    const deadline = this.now() + this.settings().saveTimeoutMs * 2;
    let last = -1;
    for (;;) {
      const size = statSync(path).size;
      if (size > 0 && size === last) return;
      if (this.now() > deadline) throw new Error("O arquivo do replay não parou de crescer a tempo");
      last = size;
      await sleep(this.settings().settleMs);
    }
  }

  private moveToClips(clip: Clip, obsPath: string) {
    const base = this.clipsDir();
    if (!base) throw new ClipPermanentError(`Pasta de clips desconhecida (OBS sem pasta de gravação); o replay ficou em ${obsPath}`);
    const { sub, name } = clipFileName(clip, extname(obsPath));
    const target = join(base, sub, name);
    try {
      mkdirSync(dirname(target), { recursive: true });
    } catch (error) {
      throw new ClipPermanentError(`Pasta de clips indisponível (${(error as Error).message}); o replay ficou em ${obsPath}`);
    }
    const size = statSync(obsPath).size;
    const free = (() => {
      const fsStat = statfsSync(dirname(target));
      return Number(fsStat.bavail) * Number(fsStat.bsize);
    })();
    const sameVolume = obsPath.slice(0, 2).toLowerCase() === target.slice(0, 2).toLowerCase();
    // Precisa sobrar o mínimo configurado depois do clip (mesmo volume: mover não ocupa espaço novo).
    if (free - (sameVolume ? 0 : size) < this.settings().minFreeBytes) {
      throw new ClipPermanentError(`Espaço insuficiente em ${base} (${Math.round(free / 1048576)} MB livres); o replay ficou em ${obsPath}`);
    }
    try {
      renameSync(obsPath, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw new ClipPermanentError(`Não foi possível mover o replay (${(error as Error).message}); ele ficou em ${obsPath}`);
      copyFileSync(obsPath, target);
      unlinkSync(obsPath);
    }
    const meta = {
      clipId: clip.id,
      tipo: clip.kind,
      teste: clip.isTest,
      jogo: clip.gameSlug,
      titulo: clip.title,
      evento: clip.sourceEventId,
      momentoDoEvento: new Date(clip.eventAt).toISOString(),
      salvoEm: new Date(this.now()).toISOString(),
      segundosDepois: Math.round((this.now() - clip.eventAt) / 1000),
      // Teto: o buffer só tem esse trecho se estava ligado há tempo suficiente antes do evento.
      segundosAntesNoMaximo: Math.max(0, Math.round((this.windowMs() - (this.now() - clip.eventAt)) / 1000)),
      ...clip.payload,
    };
    try {
      writeFileSync(`${target}.json`, JSON.stringify(meta, null, 2));
    } catch {
      // O vídeo é o que importa; a ficha é complementar.
    }
    return { filePath: target, size };
  }

  private tick = async () => {
    this.timer = null;
    if (this.stopped || this.running) return;
    this.running = (async () => {
      try {
        while (!this.stopped && this.ingest() === 100) {
          // lotes
        }
        while (!this.stopped && (await this.processNext())) {
          // um por vez
        }
      } catch (error) {
        this.log.error("Falha no ciclo de clips", { error });
      }
    })().finally(() => {
      this.running = null;
      if (!this.stopped) this.timer = setTimeout(this.tick, this.settings().pollMs);
    });
  };

  start() {
    this.stopped = false;
    this.initCursor();
    this.recover();
    this.kick();
  }

  kick() {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(this.tick, 0);
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }
}

import { randomUUID } from "node:crypto";
import type { NewEvent } from "../../events/eventStore.ts";
import type { Logger } from "../../logger.ts";
import { transaction } from "../../store/database.ts";
import type { ResolvedGame } from "./detector.ts";
import type { GameRepository, GameSession } from "./repository.ts";

export const SESSION_STARTED = "game.session.started";
export const SESSION_ENDED = "game.session.ended";

export type SessionOptions = {
  startConfirmMs: number;
  endGraceMs: number;
  resumeMaxGapMs: number;
  /** Intervalo mínimo entre gravações do "visto por último" (reduz escrita em disco). */
  touchIntervalMs?: number;
};

export type EndReason = "not_detected" | "switched" | "agent_offline";

/**
 * Sessões de jogo a partir das varreduras periódicas.
 *
 *  - abre uma sessão só depois de o jogo ficar detectado por startConfirmMs;
 *  - encerra quando o jogo some por endGraceMs (fim = último momento visto);
 *  - troca de jogo encerra a sessão anterior e abre a nova;
 *  - a sessão aberta fica gravada: após queda ou reinício do agente ela é retomada
 *    se o jogo continua rodando e a lacuna for curta; senão é encerrada no último momento visto;
 *  - cada abertura/encerramento grava a sessão e o evento na mesma transação.
 */
export class SessionManager {
  private readonly repo: GameRepository;
  private readonly record: (event: NewEvent) => unknown;
  private readonly log: Logger;
  private readonly options: Required<SessionOptions>;
  private active: GameSession | null = null;
  private candidate: { identity: string; firstSeenAt: number } | null = null;
  private lastTouchAt = 0;

  constructor(options: {
    repo: GameRepository;
    record: (event: NewEvent) => unknown;
    log: Logger;
    options: SessionOptions;
  }) {
    this.repo = options.repo;
    this.record = options.record;
    this.log = options.log;
    this.options = { touchIntervalMs: 15_000, ...options.options };
  }

  current() {
    return this.active;
  }

  pendingCandidate() {
    return this.candidate;
  }

  /** Recupera a sessão que ficou aberta na execução anterior. */
  restore(now: number) {
    const open = this.repo.openSession();
    if (!open) return null;
    if (now - open.lastSeenAt > this.options.resumeMaxGapMs) {
      this.end(open, open.lastSeenAt, "agent_offline");
      this.log.warn("Sessão aberta da execução anterior encerrada no último momento visto", {
        sessionId: open.id,
        jogo: open.title,
      });
      return null;
    }
    this.active = open;
    this.lastTouchAt = open.lastSeenAt;
    this.log.info("Sessão anterior recuperada; será retomada se o jogo continuar em execução", {
      sessionId: open.id,
      jogo: open.title,
    });
    return open;
  }

  /**
   * Corrige o jogo da sessão ativa. A escolha fica gravada (manual_slug) e prevalece sobre a
   * detecção enquanto o mesmo executável/fonte estiver em execução, inclusive após reinício.
   */
  correct(input: { slug: string; title: string; now: number }) {
    const active = this.active;
    if (!active) return null;
    const corrections = Array.isArray(active.detail.corrections) ? [...(active.detail.corrections as unknown[])] : [];
    corrections.push({ at: new Date(input.now).toISOString(), from: active.slug, to: input.slug });
    const detail = { ...active.detail, corrections };
    const patch = { identity: `game:${input.slug}`, slug: input.slug, title: input.title, detail, at: input.now };
    if (!this.repo.correctSession(active.id, patch)) return null;
    Object.assign(active, { identity: patch.identity, slug: input.slug, title: input.title, detail, manualSlug: input.slug, correctedAt: input.now });
    this.candidate = null;
    this.log.info("Jogo da sessão corrigido manualmente", { sessionId: active.id, de: corrections.at(-1), para: input.slug });
    return active;
  }

  /** A correção manual vale para a mesma fonte detectada: a detecção não a desfaz. */
  private applyManual(game: ResolvedGame | null): ResolvedGame | null {
    const active = this.active;
    if (!game || !active?.manualSlug || game.key !== active.detectionKey) return game;
    return { ...game, identity: active.identity, slug: active.manualSlug, title: active.title, resolvedBy: "manual" };
  }

  observe(detected: ResolvedGame | null, now: number) {
    const game = this.applyManual(detected);
    const active = this.active;

    if (game && active && game.identity === active.identity) {
      active.lastSeenAt = now;
      this.candidate = null;
      if (now - this.lastTouchAt >= this.options.touchIntervalMs) this.touch(now);
      return;
    }

    // Mesmo jogo reclassificado (ex.: mapeado durante a sessão): atualiza sem abrir outra.
    // Em emulador, só se a sessão ainda não tinha jogo resolvido (trocar de jogo no emulador abre outra sessão).
    if (game && active && game.key === active.detectionKey && (game.source !== "emulator" || active.slug === null)) {
      this.repo.reclassifySession(active.id, { identity: game.identity, slug: game.slug, title: game.title });
      this.log.info("Sessão reclassificada", { sessionId: active.id, de: active.title, para: game.title, slug: game.slug });
      Object.assign(active, { identity: game.identity, slug: game.slug, title: game.title, lastSeenAt: now });
      this.candidate = null;
      return;
    }

    if (game) {
      if (this.candidate?.identity !== game.identity) this.candidate = { identity: game.identity, firstSeenAt: now };
      if (now - this.candidate.firstSeenAt >= this.options.startConfirmMs) {
        if (active) this.end(active, active.lastSeenAt, "switched");
        this.start(game, this.candidate.firstSeenAt, now);
        this.candidate = null;
        return;
      }
    } else {
      this.candidate = null;
    }

    if (this.active && now - this.active.lastSeenAt >= this.options.endGraceMs) {
      this.end(this.active, this.active.lastSeenAt, "not_detected");
    }
  }

  /** Grava o último momento visto (chamado no encerramento do agente). A sessão continua aberta. */
  flush(now: number) {
    if (this.active && this.active.lastSeenAt >= this.lastTouchAt) this.touch(Math.min(now, this.active.lastSeenAt));
  }

  private touch(at: number) {
    if (!this.active) return;
    this.repo.touchSession(this.active.id, at);
    this.lastTouchAt = at;
  }

  private start(game: ResolvedGame, startedAt: number, now: number) {
    const session: GameSession = {
      id: randomUUID(),
      identity: game.identity,
      detectionKey: game.key,
      source: game.source,
      slug: game.slug,
      title: game.title,
      startedAt,
      lastSeenAt: now,
      endedAt: null,
      endReason: null,
      detail: {
        appId: game.appId ?? null,
        exe: game.exe,
        emulator: game.emulator ?? null,
        content: game.content ?? null,
        resolvedBy: game.resolvedBy,
      },
    };
    transaction(this.repo.db, () => {
      this.repo.insertSession(session);
      this.record({
        type: SESSION_STARTED,
        dedupeKey: `game-session:${session.id}:started`,
        occurredAt: startedAt,
        source: "games",
        payload: this.payload(session),
      });
    });
    this.active = session;
    this.lastTouchAt = now;
    this.log.info("Sessão de jogo iniciada", { sessionId: session.id, jogo: session.title, slug: session.slug, origem: session.source });
  }

  private end(session: GameSession, endedAt: number, reason: EndReason) {
    const closed: GameSession = { ...session, endedAt, endReason: reason, lastSeenAt: Math.max(session.lastSeenAt, endedAt) };
    transaction(this.repo.db, () => {
      this.repo.closeSession(session.id, endedAt, reason);
      this.record({
        type: SESSION_ENDED,
        dedupeKey: `game-session:${session.id}:ended`,
        occurredAt: endedAt,
        source: "games",
        payload: this.payload(closed),
      });
    });
    if (this.active?.id === session.id) this.active = null;
    this.log.info("Sessão de jogo encerrada", {
      sessionId: session.id,
      jogo: session.title,
      motivo: reason,
      minutos: Math.round((endedAt - session.startedAt) / 60_000),
    });
  }

  private payload(session: GameSession) {
    return {
      sessionId: session.id,
      slug: session.slug,
      title: session.title,
      source: session.source,
      detectionKey: session.detectionKey,
      startedAt: new Date(session.startedAt).toISOString(),
      endedAt: session.endedAt === null ? null : new Date(session.endedAt).toISOString(),
      durationSeconds: session.endedAt === null ? null : Math.max(0, Math.round((session.endedAt - session.startedAt) / 1000)),
      endReason: session.endReason,
      detail: session.detail,
    };
  }
}

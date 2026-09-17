"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import GameAchievementsPanel, {
  type AchievementInput,
  type ManualAchievementState,
} from "@/components/GameAchievementsPanel";
import GameReviewPanel, {
  createDefaultReview,
  type ManualReviewState,
  type ReviewInput,
} from "@/components/GameReviewPanel";

type FinalBadgeInput = {
  title?: string;
  icon?: string;
  image?: string;
};

type FinalBadgeData = {
  title: string;
  icon: string;
  image: string;
};

type GameEmblemInput = {
  title?: string;
  image?: string;
  description?: string;
  tags?: string[] | string;
};

type GameEmblemData = {
  title: string;
  image: string;
  description: string;
  tags: string[];
};

type EnhancedAchievement = AchievementInput & {
  manualState: ManualAchievementState;
};

type GameInput = {
  title: string;
  subtitle: string;
  image: string;
  cardImage?: string;
  achievements?: string | number;
  progress: number;
  mastery?: string;
  hours: string;
  status: string;
  nextMission?: string;
  currentObjective?: string;
  objective?: string;
  achievementsList: AchievementInput[];
  review: ReviewInput;
  finalBadge?: FinalBadgeInput;
  emblem?: GameEmblemInput;
};

type Props = {
  slug: string;
  game: GameInput;
};

const ACHIEVEMENTS_UPDATED_EVENT = "rumo-a-conquista-achievements-updated";
const REVIEW_UPDATED_EVENT = "rumo-a-conquista-review-updated";
const GAMES_UPDATED_EVENT = "rumo-a-conquista-games-updated";

function readText(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);

  return fallback;
}

function readStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => readText(item, "").trim()).filter(Boolean);
  }

  const text = readText(value, "");

  if (!text.trim()) {
    return [];
  }

  return text
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeText(text?: string) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

function normalizeGameStatus(status?: string) {
  const normalized = normalizeText(status);

  if (
    normalized === "completed" ||
    normalized === "finalizado" ||
    normalized === "concluido" ||
    normalized === "concluida"
  ) {
    return "completed";
  }

  if (
    normalized === "planned" ||
    normalized === "planejado" ||
    normalized === "backlog" ||
    normalized === "futuro"
  ) {
    return "planned";
  }

  return "progress";
}

function getStatusLabel(status?: string) {
  const normalizedStatus = normalizeGameStatus(status);

  if (normalizedStatus === "completed") return "Finalizado";
  if (normalizedStatus === "planned") return "Planejado";

  return "Em progresso";
}

function isCompletedGame(game: GameInput) {
  const status = normalizeGameStatus(game.status);
  const mastery = normalizeText(game.mastery);

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <Navbar />

      <section className="mx-auto w-full max-w-[1700px] px-4 py-6 md:px-6 lg:px-8">
        <div className="mb-5">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-white/45 transition hover:text-red-400"
          >
            ← Voltar
          </Link>
        </div>

        <div className="grid gap-5 xl:grid-cols-[250px_minmax(0,1fr)_270px]">
          {/* SIDEBAR ESQUERDA — CAPA E RESUMO DO JOGO */}
          <aside className="hidden xl:block">
            <div className="sticky top-24 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/90 shadow-xl">
              <div className="aspect-[3/4] w-full overflow-hidden bg-black">
                {coverImage ? (
                  <img
                    src={coverImage}
                    alt={game.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs font-black uppercase tracking-widest text-white/25">
                    Sem capa
                  </div>
                )}
              </div>

              <div className="p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${
                      isJourneyCompleted
                        ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300"
                        : "border-red-500/30 bg-red-500/10 text-red-300"
                    }`}
                  >
                    {isJourneyCompleted ? "Finalizado" : getStatusLabel(game.status)}
                  </span>
                </div>

                <h1 className="mt-3 text-xl font-black leading-tight tracking-tight text-white">
                  {game.title}
                </h1>

                <p className="mt-2 text-xs font-bold leading-relaxed text-white/40">
                  {game.subtitle}
                </p>

                <div className="mt-5 border-t border-white/10 pt-5">
                  <div className="flex items-end justify-between">
                    <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/30">
                      Progresso
                    </span>
                    <span
                      className={`text-lg font-black ${
                        isJourneyCompleted ? "text-emerald-300" : "text-red-400"
                      }`}
                    >
                      {progressPercent}%
                    </span>
                  </div>

                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full ${progressBarClass}`}
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-white/5 bg-white/[0.025] p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.12em] text-white/30">
                      Conquistas
                    </p>
                    <p className="mt-1 text-lg font-black text-white">
                      {completedCount}
                      <span className="text-white/25">/{totalAchievements}</span>
                    </p>
                  </div>

                  <div className="rounded-xl border border-white/5 bg-white/[0.025] p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.12em] text-white/30">
                      Horas
                    </p>
                    <p className="mt-1 text-lg font-black text-white">
                      {game.hours}
                    </p>
                  </div>
                </div>

                <div className="mt-2 rounded-xl border border-white/5 bg-white/[0.025] p-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.12em] text-white/30">
                    Maestria
                  </p>
                  <p className="mt-1 text-sm font-black text-white">
                    {dynamicMastery}
                  </p>
                </div>

                <nav className="mt-5 space-y-1 border-t border-white/10 pt-4">
                  <a
                    href="#game-header"
                    className="flex items-center gap-3 rounded-xl bg-red-500/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-red-300"
                  >
                    <span>▣</span>
                    Visão geral
                  </a>
                  <a
                    href="#achievements"
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-white/50 transition hover:bg-white/[0.04] hover:text-white"
                  >
                    <span>🏆</span>
                    Conquistas
                  </a>
                  <a
                    href="#first-run"
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-white/30 transition hover:bg-white/[0.04] hover:text-white"
                  >
                    <span>▶</span>
                    Primeira Run
                  </a>
                  <a
                    href="#mastery"
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-white/30 transition hover:bg-white/[0.04] hover:text-white"
                  >
                    <span>◆</span>
                    Maestria
                  </a>
                  <a
                    href="#review-section"
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-white/30 transition hover:bg-white/[0.04] hover:text-white"
                  >
                    <span>✦</span>
                    Review
                  </a>
                  <a
                    href="#gallery"
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-white/30 transition hover:bg-white/[0.04] hover:text-white"
                  >
                    <span>▦</span>
                    Galeria
                  </a>
                </nav>
              </div>
            </div>
          </aside>

          {/* CONTEÚDO CENTRAL — CONQUISTAS */}
          <div className="min-w-0">
            <section
              id="game-header"
              className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-xl"
            >
              <div className="flex min-h-[112px] items-center gap-4 p-5 md:p-6">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.22em] text-red-400">
                      Rumo à Conquista
                    </span>
                    <span className="text-white/15">•</span>
                    <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/30">
                      {dynamicStatus}
                    </span>
                  </div>

                  <h2 className="text-2xl font-black leading-none tracking-tight text-white md:text-3xl">
                    {game.title}
                  </h2>

                  <p className="mt-2 text-xs font-bold text-white/40 md:text-sm">
                    {game.subtitle}
                  </p>
                </div>

                <div className="hidden shrink-0 text-right sm:block">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/30">
                    Jornada
                  </p>
                  <p
                    className={`mt-1 text-2xl font-black ${
                      isJourneyCompleted ? "text-emerald-300" : "text-red-400"
                    }`}
                  >
                    {progressPercent}%
                  </p>
                </div>
              </div>

              <nav className="flex items-center gap-1 overflow-x-auto border-t border-white/10 px-3">
                <a
                  href="#achievements"
                  className="border-b-2 border-red-500 px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white"
                >
                  Conquistas
                </a>
                <a
                  href="#first-run"
                  className="border-b-2 border-transparent px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white/40 transition hover:text-white"
                >
                  Primeira Run
                </a>
                <a
                  href="#mastery"
                  className="border-b-2 border-transparent px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white/40 transition hover:text-white"
                >
                  Maestria
                </a>
                <a
                  href="#review-section"
                  className="border-b-2 border-transparent px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white/40 transition hover:text-white"
                >
                  Notas
                </a>
                <a
                  href="#gallery"
                  className="border-b-2 border-transparent px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white/40 transition hover:text-white"
                >
                  Galeria
                </a>
              </nav>
            </section>

            <section
              id="achievements"
              className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/80"
            >
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 md:px-6">
                <div className="flex items-center gap-3">
                  <span className="h-7 w-0.5 bg-red-500" />
                  <div>
                    <h2 className="text-lg font-black uppercase tracking-tight text-white md:text-xl">
                      Conquistas
                    </h2>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-white/25">
                      {completedCount}/{totalAchievements} concluídas
                    </p>
                  </div>
                </div>

                <span className="text-xl">🏆</span>
              </div>

              <div className="p-4 md:p-5">
                <GameAchievementsPanel
                  slug={slug}
                  achievements={achievements}
                  onStatesChange={setManualStates}
                />
              </div>
            </section>

            <section
              id="first-run"
              className="mt-5 rounded-2xl border border-dashed border-white/10 bg-zinc-950/50 p-6"
            >
              <div className="flex items-center gap-3">
                <span className="h-7 w-0.5 bg-red-500" />
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-white/30">
                    Próximo módulo
                  </p>
                  <h2 className="mt-1 text-xl font-black text-white">
                    Primeira Run
                  </h2>
                  <p className="mt-1 text-sm text-white/35">
                    Estrutura preparada para a próxima etapa.
                  </p>
                </div>
              </div>
            </section>

            <section
              id="mastery"
              className="mt-5 rounded-2xl border border-dashed border-white/10 bg-zinc-950/50 p-6"
            >
              <div className="flex items-center gap-3">
                <span className="h-7 w-0.5 bg-red-500" />
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-white/30">
                    Próximo módulo
                  </p>
                  <h2 className="mt-1 text-xl font-black text-white">
                    Maestria
                  </h2>
                  <p className="mt-1 text-sm text-white/35">
                    Estrutura preparada para a próxima etapa.
                  </p>
                </div>
              </div>
            </section>

            <div
              id="review-section"
              ref={reviewSectionRef}
              className="mt-5 scroll-mt-28"
            >
              <GameReviewPanel
                slug={slug}
                review={manualReview}
                isUnlocked={reviewUnlocked}
                achievementsCompleted={completedCount}
                achievementsTotal={totalAchievements}
              />
            </div>

            <section
              id="gallery"
              className="mt-5 rounded-2xl border border-dashed border-white/10 bg-zinc-950/50 p-6"
            >
              <div className="flex items-center gap-3">
                <span className="h-7 w-0.5 bg-red-500" />
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-white/30">
                    Próximo módulo
                  </p>
                  <h2 className="mt-1 text-xl font-black text-white">
                    Galeria
                  </h2>
                  <p className="mt-1 text-sm text-white/35">
                    Estrutura preparada para a próxima etapa.
                  </p>
                </div>
              </div>
            </section>
          </div>

          {/* SIDEBAR DIREITA — RESUMO E OBJETIVO */}
          <aside className="hidden xl:block">
            <div className="sticky top-24 space-y-4">
              <section className="rounded-2xl border border-white/10 bg-zinc-950/90 p-5 shadow-xl">
                <div className="mb-4 flex items-center gap-3">
                  <span className="h-6 w-0.5 bg-red-500" />
                  <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white">
                    Resumo
                  </h2>
                </div>

                <div className="space-y-2">
                  <div className="rounded-xl border border-white/5 bg-white/[0.025] p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.16em] text-white/30">
                      Progresso
                    </p>
                    <p className="mt-1 text-2xl font-black text-white">
                      {progressPercent}%
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-white/5 bg-white/[0.025] p-3">
                      <p className="text-[9px] font-black uppercase tracking-[0.12em] text-white/30">
                        Conquistas
                      </p>
                      <p className="mt-1 text-lg font-black text-white">
                        {completedCount}/{totalAchievements}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/5 bg-white/[0.025] p-3">
                      <p className="text-[9px] font-black uppercase tracking-[0.12em] text-white/30">
                        Horas
                      </p>
                      <p className="mt-1 text-lg font-black text-white">
                        {game.hours}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/5 bg-white/[0.025] p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.12em] text-white/30">
                      Status
                    </p>
                    <p className="mt-1 text-sm font-black text-white">
                      {dynamicStatus}
                    </p>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-white/10 bg-zinc-950/90 p-5 shadow-xl">
                <div className="mb-4 flex items-center gap-3">
                  <span className="h-6 w-0.5 bg-red-500" />
                  <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white">
                    Objetivo atual
                  </h2>
                </div>

                <div className="rounded-xl border border-red-500/15 bg-red-500/[0.04] p-4">
                  <div className="mb-3 flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-red-500/20 bg-black/30">
                    {isJourneyCompleted ? (
                      <FinalBadgeVisual
                        badge={finalBadge}
                        imageClassName="h-full w-full object-cover"
                        fallbackClassName="text-lg"
                      />
                    ) : (
                      "🎯"
                    )}
                  </div>

                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-300">
                    {objectiveLabel}
                  </p>
                  <p className="mt-2 text-sm font-black leading-snug text-white">
                    {objectiveTitle}
                  </p>
                </div>
              </section>

              <section className="rounded-2xl border border-white/10 bg-zinc-950/90 p-5 shadow-xl">
                <div className="mb-4 flex items-center gap-3">
                  <span className="h-6 w-0.5 bg-red-500" />
                  <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white">
                    Review
                  </h2>
                </div>

                {reviewUnlocked && hasReviewScore ? (
                  <>
                    <ScorePill score={reviewScore} />
                    <button
                      type="button"
                      onClick={scrollToReview}
                      className="mt-4 w-full rounded-xl bg-red-500 px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white transition hover:bg-red-400"
                    >
                      Ver review
                    </button>
                  </>
                ) : (
                  <p className="text-xs leading-relaxed text-white/35">
                    A review será liberada conforme a jornada avançar.
                  </p>
                )}
              </section>
            </div>
          </aside>
        </div>

        {emblemData && isCompletedByAchievements && (
          <div className="mt-6">
            <GameEmblemBlock emblem={emblemData} />
          </div>
        )}
      </section>
    </main>
  );
}

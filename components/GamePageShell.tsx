"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import GameAchievementsPanel, {
  type AchievementInput,
  type ManualAchievementState,
} from "@/components/GameAchievementsPanel";

export type GamePageShellInput = {
  title: string;
  subtitle: string;
  image: string;
  cardImage?: string;
  achievements?: string | number;
  progress: number;
  mastery?: string;
  hours: string;
  status: string;
  currentObjective?: string;
  objective?: string;
  achievementsList: AchievementInput[];
  platform?: string;
  genres?: string[];
};

type Props = {
  slug: string;
  game: GamePageShellInput;
};

function normalizeText(value?: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeStatus(value?: string) {
  const normalized = normalizeText(value);
  if (["completed", "finalizado", "concluido", "concluida"].includes(normalized)) {
    return "completed";
  }
  if (["planned", "planejado", "backlog", "futuro"].includes(normalized)) {
    return "planned";
  }
  return "progress";
}

function getStatusLabel(value?: string) {
  const status = normalizeStatus(value);
  if (status === "completed") return "Finalizado";
  if (status === "planned") return "Na fila";
  return "Em progresso";
}

function clamp(value: number) {
  return Math.min(100, Math.max(0, Number(value) || 0));
}

type TrophyRank = "Diamante" | "Ouro" | "Prata" | "Bronze";

function getTrophyRank(achievement: AchievementInput): TrophyRank {
  const difficulty = normalizeText(achievement.difficulty);

  if (difficulty === "extrema" || difficulty === "diamante") return "Diamante";
  if (difficulty === "dificil" || difficulty === "ouro") return "Ouro";
  if (difficulty === "media" || difficulty === "prata") return "Prata";

  if (achievement.trophy?.includes("💎") || achievement.icon?.includes("💎")) return "Diamante";
  if (
    achievement.trophy?.includes("🥇") ||
    achievement.trophy?.includes("🏆") ||
    achievement.icon?.includes("🥇") ||
    achievement.icon?.includes("🏆")
  ) return "Ouro";
  if (achievement.trophy?.includes("🥈") || achievement.icon?.includes("🥈")) return "Prata";

  return "Bronze";
}

const TROPHY_META: Array<{
  rank: TrophyRank;
  icon: string;
  label: string;
}> = [
  { rank: "Diamante", icon: "💎", label: "Diamante" },
  { rank: "Ouro", icon: "🥇", label: "Ouro" },
  { rank: "Prata", icon: "🥈", label: "Prata" },
  { rank: "Bronze", icon: "🥉", label: "Bronze" },
];

function IconGamepad({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M7.2 8.5H16.8C19.2 8.5 20.5 10.7 20.8 13.4L21.3 17.2C21.6 19.5 18.8 20.2 17.4 18.5L15.4 16H8.6L6.6 18.5C5.2 20.2 2.4 19.5 2.7 17.2L3.2 13.4C3.5 10.7 4.8 8.5 7.2 8.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M7 11V15M5 13H9M15.5 12.5H15.51M18 15H18.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconTrophy({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M8 4.5H16V9.3C16 12.3 14.5 14.6 12 14.6C9.5 14.6 8 12.3 8 9.3V4.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8 6H5.8C4.6 6 4.2 7 4.5 8.2C4.9 10.1 6.1 11.3 8.1 11.5M16 6H18.2C19.4 6 19.8 7 19.5 8.2C19.1 10.1 17.9 11.3 15.9 11.5M12 14.6V18M8.5 19.5H15.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconClock({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.4V12L15.2 14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCalendar({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="5.5" width="16" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7.5 3.8V7.2M16.5 3.8V7.2M4.5 9.5H19.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
      <h2 className="text-[12px] font-black uppercase tracking-[0.12em] text-white">
        {children}
      </h2>
    </div>
  );
}

export default function GamePageShell({ slug, game }: Props) {
  const [manualStates, setManualStates] = useState<Record<string, ManualAchievementState>>({});

  const achievements = Array.isArray(game.achievementsList) ? game.achievementsList : [];
  const completedCount = useMemo(
    () => achievements.filter((achievement) => ["completed", "concluido", "concluida"].includes(normalizeText(achievement.status))).length,
    [achievements]
  );
  const totalCount = achievements.length;
  const progress = clamp(game.progress);
  const status = normalizeStatus(game.status);
  const statusLabel = getStatusLabel(game.status);
  const objective = game.currentObjective || game.objective || "Definir próximo objetivo";
  const cover = game.cardImage || game.image || `/images/games/${slug}/cover.jpg`;
  const genres = Array.isArray(game.genres) ? game.genres.filter(Boolean) : [];

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <Navbar />

      <div className="mx-auto w-full max-w-[1500px] px-5 py-6 lg:px-8 lg:py-8">
        <div className="grid gap-5 lg:grid-cols-[205px_minmax(0,1fr)_260px] xl:grid-cols-[220px_minmax(0,1fr)_275px]">
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-5">
              <div className="border-b border-white/[0.08] pb-5">
                <SectionTitle>Jogo</SectionTitle>
              </div>

              <div className="border-b border-white/[0.08] pb-6">
                <div className="overflow-hidden rounded-[12px] border border-white/[0.10] bg-[#090909] shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
                  {cover ? (
                    <img src={cover} alt={game.title} className="aspect-[3/4] w-full object-cover" />
                  ) : (
                    <div className="flex aspect-[3/4] items-center justify-center text-[10px] font-black uppercase text-white/25">Sem capa</div>
                  )}
                </div>

                <p className="mt-3 line-clamp-3 text-[12px] font-black leading-tight text-white" title={game.title}>
                  {game.title}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.08em] ${status === "completed" ? "border-emerald-400/25 bg-emerald-500/[0.08] text-emerald-300" : status === "planned" ? "border-cyan-400/25 bg-cyan-500/[0.08] text-cyan-300" : "border-red-500/25 bg-red-500/[0.08] text-red-300"}`}>
                    {statusLabel}
                  </span>
                  {game.platform && <span className="text-[9px] font-semibold text-white/35">{game.platform}</span>}
                </div>
              </div>

              <div className="border-b border-white/[0.08] pb-5">
                <div className="mb-3">
                  <SectionTitle>Troféus / Conquistas</SectionTitle>
                </div>

                <div className="grid grid-cols-4 gap-1.5">
                  {TROPHY_META.map(({ rank, icon, label }) => {
                    const total = achievements.filter(
                      (achievement) => getTrophyRank(achievement) === rank
                    ).length;
                    const completed = achievements.filter(
                      (achievement) =>
                        getTrophyRank(achievement) === rank &&
                        ["completed", "concluido", "concluida"].includes(
                          normalizeText(achievement.status)
                        )
                    ).length;

                    return (
                      <div
                        key={rank}
                        title={label}
                        className="flex min-w-0 flex-col items-center rounded-[8px] border border-white/[0.06] bg-white/[0.015] px-1 py-2"
                      >
                        <span className="text-[20px] leading-none">{icon}</span>
                        <span className="mt-1 text-[9px] font-black tabular-nums text-white/70">
                          {completed}/{total}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="border-b border-white/[0.08] pb-6">
                <SectionTitle>Jornada</SectionTitle>
                <div className="mt-4 space-y-3">
                  <div>
                    <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-[0.10em] text-white/35">
                      <span>Progresso</span>
                      <span className="text-red-300">{progress}%</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                      <div className="h-full rounded-full bg-red-500" style={{ width: `${progress}%` }} />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[10px]">
                    <span className="flex items-center gap-1.5 text-white/40"><IconTrophy className="h-3.5 w-3.5 text-red-400" /> Conquistas</span>
                    <span className="font-black text-white/75">{completedCount}/{totalCount}</span>
                  </div>

                  <div className="flex items-center justify-between text-[10px]">
                    <span className="flex items-center gap-1.5 text-white/40"><IconClock className="h-3.5 w-3.5 text-red-400" /> Tempo</span>
                    <span className="font-black text-white/75">{game.hours || "0h"}</span>
                  </div>
                </div>
              </div>

              <Link href="/biblioteca" className="inline-flex text-[9px] font-black uppercase tracking-[0.12em] text-red-400 transition hover:text-red-300">
                ← Voltar para Biblioteca
              </Link>
            </div>
          </aside>

          <section className="min-w-0">
            <div id="conquistas" className="mt-5 scroll-mt-24">
              <div className="mb-3 flex items-center justify-between">
                <SectionTitle>Conquistas</SectionTitle>
                <span className="text-[10px] font-black text-white/35">{completedCount}/{totalCount}</span>
              </div>

              <div className="overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#090909]">
                <GameAchievementsPanel
                  slug={slug}
                  achievements={achievements}
                  onStatesChange={setManualStates}
                />
              </div>
            </div>
          </section>

          <aside className="min-w-0">
            <div className="space-y-5 lg:sticky lg:top-24">
              <section className="rounded-[14px] border border-white/[0.08] bg-[#090909] p-4">
                <SectionTitle>Resumo do Jogo</SectionTitle>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-[10px] border border-white/[0.07] bg-white/[0.02] p-3">
                    <IconTrophy className="h-4 w-4 text-red-400" />
                    <p className="mt-2 text-lg font-black text-white">{completedCount}/{totalCount}</p>
                    <p className="text-[8px] font-black uppercase tracking-[0.10em] text-white/30">Conquistas</p>
                  </div>
                  <div className="rounded-[10px] border border-white/[0.07] bg-white/[0.02] p-3">
                    <IconGamepad className="h-4 w-4 text-red-400" />
                    <p className="mt-2 text-lg font-black text-white">{progress}%</p>
                    <p className="text-[8px] font-black uppercase tracking-[0.10em] text-white/30">Progresso</p>
                  </div>
                  <div className="rounded-[10px] border border-white/[0.07] bg-white/[0.02] p-3">
                    <IconClock className="h-4 w-4 text-red-400" />
                    <p className="mt-2 text-lg font-black text-white">{game.hours || "0h"}</p>
                    <p className="text-[8px] font-black uppercase tracking-[0.10em] text-white/30">Tempo</p>
                  </div>
                  <div className="rounded-[10px] border border-white/[0.07] bg-white/[0.02] p-3">
                    <IconCalendar className="h-4 w-4 text-red-400" />
                    <p className="mt-2 text-sm font-black text-white">—</p>
                    <p className="text-[8px] font-black uppercase tracking-[0.10em] text-white/30">Jornada</p>
                  </div>
                </div>
              </section>

              <section id="maestria" className="rounded-[14px] border border-white/[0.08] bg-[#090909] p-4">
                <SectionTitle>Maestria</SectionTitle>
                <div className="mt-4 rounded-[10px] border border-red-500/15 bg-red-500/[0.04] p-3">
                  <p className="text-[8px] font-black uppercase tracking-[0.14em] text-red-300">Objetivo atual</p>
                  <p className="mt-2 text-sm font-black leading-tight text-white">{game.mastery || objective}</p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                    <div className="h-full rounded-full bg-red-500" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="mt-1.5 text-right text-[8px] font-black text-white/30">{progress}%</p>
                </div>
              </section>

              <section id="primeira-run" className="rounded-[14px] border border-white/[0.08] bg-[#090909] p-4">
                <SectionTitle>Primeira Run</SectionTitle>
                <div className="mt-4 border-l-2 border-white/[0.08] pl-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.10em] text-white/55">Registro da primeira jornada</p>
                  <p className="mt-1.5 text-[9px] leading-relaxed text-white/30">
                    Aqui ficará o histórico da primeira vez que este jogo foi jogado, com datas, tempo e progresso.
                  </p>
                </div>
              </section>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

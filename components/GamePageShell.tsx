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

type TrophyRank = "Ouro" | "Prata" | "Bronze";

function getTrophyRank(achievement: AchievementInput): TrophyRank {
  const difficulty = normalizeText(achievement.difficulty);

  if (difficulty === "extrema" || difficulty === "diamante" || difficulty === "ouro") return "Ouro";
  if (difficulty === "media" || difficulty === "prata") return "Prata";

  if (achievement.trophy?.includes("🥇") || achievement.trophy?.includes("🏆") || achievement.icon?.includes("🥇") || achievement.icon?.includes("🏆")) {
    return "Ouro";
  }
  if (achievement.trophy?.includes("🥈") || achievement.icon?.includes("🥈")) return "Prata";

  return "Bronze";
}

const TROPHY_META: Array<{
  rank: TrophyRank | "Maestria";
  label: string;
}> = [
  { rank: "Bronze", label: "Bronze" },
  { rank: "Prata", label: "Prata" },
  { rank: "Ouro", label: "Ouro" },
  { rank: "Maestria", label: "Maestria" },
];

function TrophyIcon({ rank, className = "h-8 w-8" }: { rank: TrophyRank; className?: string }) {
  const palette = {
    Ouro: { top: "#FFF0A8", mid: "#F4B942", bottom: "#A85B08", edge: "#FFD86A", shine: "#FFF8D7" },
    Prata: { top: "#FFFFFF", mid: "#C9D0D8", bottom: "#68727C", edge: "#E9EEF3", shine: "#FFFFFF" },
    Bronze: { top: "#FFD0A8", mid: "#C8784A", bottom: "#7B351E", edge: "#F0A77A", shine: "#FFF0E2" },
  }[rank];

  const id = `trophy-${rank.toLowerCase()}`;

  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="10" y1="4" x2="28" y2="31" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={palette.top} />
          <stop offset="0.42" stopColor={palette.mid} />
          <stop offset="1" stopColor={palette.bottom} />
        </linearGradient>
        <filter id={`${id}-glow`} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="1.6" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g filter={`url(#${id}-glow)`}>
        <path d="M12 7H28V14.2C28 19.3 25.3 23.2 20 24.3C14.7 23.2 12 19.3 12 14.2V7Z" fill={`url(#${id})`} stroke={palette.edge} strokeWidth="1.1" />
        <path d="M12 9H7.8C6.2 9 5.8 10.3 6.3 12.2C7.1 15.1 9 17 12.7 17.2M28 9H32.2C33.8 9 34.2 10.3 33.7 12.2C32.9 15.1 31 17 27.3 17.2" stroke={palette.edge} strokeWidth="2" strokeLinecap="round" />
        <path d="M20 24V29M14.5 32H25.5" stroke={palette.edge} strokeWidth="2.3" strokeLinecap="round" />
        <path d="M14.8 9H25.2" stroke={palette.shine} strokeWidth="1.5" strokeLinecap="round" opacity=".95" />
        <path d="M16 12C16.7 14.8 18.1 17.1 20 18.6C21.9 17.1 23.3 14.8 24 12" stroke={palette.shine} strokeWidth="1" strokeLinecap="round" opacity=".65" />
      </g>
    </svg>
  );
}

function MasteryIcon({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="mastery-shield" x1="9" y1="4" x2="31" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFE89A" />
          <stop offset=".42" stopColor="#D89B32" />
          <stop offset="1" stopColor="#6D3B0E" />
        </linearGradient>
        <filter id="mastery-glow" x="-70%" y="-70%" width="240%" height="240%">
          <feGaussianBlur stdDeviation="1.7" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g filter="url(#mastery-glow)">
        <path d="M20 3.5L32 7.6V16C32 24 26.8 30.2 20 33C13.2 30.2 8 24 8 16V7.6L20 3.5Z" fill="#101010" stroke="url(#mastery-shield)" strokeWidth="2" />
        <path d="M20 9L22.4 13.8L27.7 14.6L23.8 18.3L24.7 23.6L20 21.1L15.3 23.6L16.2 18.3L12.3 14.6L17.6 13.8L20 9Z" fill="#F4C548" stroke="#FFF0AE" strokeWidth=".7" />
        <path d="M11.5 26.7L7.5 31.2M28.5 26.7L32.5 31.2" stroke="#B96C35" strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  );
}

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
                  {game.platform && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.02] px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.08em] text-white/40">
                      {normalizeText(game.platform) === "steam" ? (
                        <img
                          src="/images/platforms/steam.png"
                          alt=""
                          aria-hidden="true"
                          className="h-3 w-3 shrink-0 object-contain"
                        />
                      ) : null}
                      {game.platform}
                    </span>
                  )}
                </div>
              </div>

              <div className="border-b border-white/[0.08] pb-5">
                <div className="mb-3">
                  <SectionTitle>Troféus / Conquistas</SectionTitle>
                </div>

                <div className="grid grid-cols-4 gap-1.5">
                  {TROPHY_META.map(({ rank, label }) => {
                    const total = rank === "Maestria"
                      ? 0
                      : achievements.filter((achievement) => getTrophyRank(achievement) === rank).length;
                    const completed = rank === "Maestria"
                      ? 0
                      : achievements.filter(
                          (achievement) =>
                            getTrophyRank(achievement) === rank &&
                            ["completed", "concluido", "concluida"].includes(normalizeText(achievement.status))
                        ).length;

                    return (
                      <div
                        key={rank}
                        title={label}
                        className="flex min-w-0 flex-col items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.02] px-1 py-3"
                      >
                        <div className="flex h-9 items-center justify-center">
                          {rank === "Maestria" ? (
                            <MasteryIcon className="h-8 w-8" />
                          ) : (
                            <TrophyIcon rank={rank} className="h-8 w-8" />
                          )}
                        </div>
                        <span className="mt-1.5 text-[7px] font-black uppercase tracking-[0.035em] text-white/50">
                          {label}
                        </span>
                        <span className="mt-0.5 text-[10px] font-black tabular-nums text-white/90">
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

          <section id="conquistas" className="min-w-0 scroll-mt-24">
            <GameAchievementsPanel
              slug={slug}
              achievements={achievements}
              onStatesChange={setManualStates}
            />
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

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { type SiteGame, useSiteGames } from "@/lib/useSiteGames";
import { fallbackToOriginal, homeImageSrc } from "@/lib/homeImages";

type AchievementSummary =
  | string
  | number
  | {
      completed?: number;
      unlocked?: number;
      total?: number;
    };

type CompletedGame = SiteGame & {
  mastery?: string;
  achievements?: AchievementSummary;
  achievementsUnlocked?: number;
  achievementsTotal?: number;
};

type AchievementStorageState = {
  status?: string;
  rank?: string;
  date?: string;
  image?: string;
};

type AchievementLike = {
  title?: string;
  status?: string;
  [key: string]: unknown;
};

const ACHIEVEMENTS_UPDATED_EVENT = "rumo-a-conquista-achievements-updated";
const GAMES_UPDATED_EVENT = "rumo-a-conquista-games-updated";

function normalizeStatus(status?: string) {
  const value = String(status || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (
    value === "completed" ||
    value === "finalizado" ||
    value === "concluido"
  ) {
    return "completed";
  }

  if (value === "planned" || value === "backlog" || value === "futuro") {
    return "planned";
  }

  return "progress";
}

function readText(value: unknown, fallback = "") {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return fallback;
}

function readLocalJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }

  const savedData = localStorage.getItem(key);

  if (!savedData) {
    return fallback;
  }

  try {
    return JSON.parse(savedData) as T;
  } catch {
    return fallback;
  }
}

function getAchievementTitle(achievement: AchievementLike, index: number) {
  return readText(achievement.title, `Conquista ${index + 1}`);
}

function getAchievementStats(game: CompletedGame) {
  if (
    typeof game.achievementsUnlocked === "number" ||
    typeof game.achievementsTotal === "number"
  ) {
    return {
      completed: game.achievementsUnlocked ?? 0,
      total: game.achievementsTotal ?? game.achievementsUnlocked ?? 0,
    };
  }

  if (game.achievements && typeof game.achievements === "object") {
    const completed =
      game.achievements.completed ?? game.achievements.unlocked ?? 0;
    const total = game.achievements.total ?? completed;

    return {
      completed,
      total,
    };
  }

  if (typeof game.achievements === "string") {
    const [completed, total] = game.achievements.split("/");

    return {
      completed: Number(completed) || 0,
      total: Number(total) || Number(completed) || 0,
    };
  }

  if (typeof game.achievements === "number") {
    return {
      completed: game.achievements,
      total: game.achievements,
    };
  }

  const baseAchievements: AchievementLike[] = Array.isArray(
    game.achievementsList
  )
    ? game.achievementsList
    : [];

  const manualStates = readLocalJson<Record<string, AchievementStorageState>>(
    `rumo-a-conquista-achievements-${game.slug}`,
    {}
  );

  const customAchievements = readLocalJson<AchievementLike[]>(
    `rumo-a-conquista-custom-achievements-${game.slug}`,
    []
  );

  const hiddenAchievementTitles = readLocalJson<string[]>(
    `rumo-a-conquista-hidden-achievements-${game.slug}`,
    []
  );

  const visibleBaseAchievements = baseAchievements.filter(
    (achievement, index) => {
      const title = getAchievementTitle(achievement, index);
      return !hiddenAchievementTitles.includes(title);
    }
  );

  const allAchievements = [...visibleBaseAchievements, ...customAchievements];

  const completed = allAchievements.filter((achievement, index) => {
    const title = getAchievementTitle(achievement, index);
    const manualStatus = manualStates[title]?.status;
    const achievementStatus = readText(achievement.status, "locked");

    return manualStatus === "completed" || achievementStatus === "completed";
  }).length;

  return {
    completed,
    total: allAchievements.length,
  };
}

function GameCover({ src, alt }: { src?: string; alt: string }) {
  const [hasError, setHasError] = useState(false);

  if (!src || hasError) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black/50 text-sm font-black text-white/35">
        Sem imagem
      </div>
    );
  }

  return (
    <img
      src={homeImageSrc(src)}
      alt={alt}
      loading="lazy"
      decoding="async"
      className="h-full w-full object-cover object-center brightness-90 contrast-110 transition duration-500 group-hover:scale-105"
      onError={fallbackToOriginal(src, () => setHasError(true))}
    />
  );
}

export default function CompletedGames() {
  const { gamesList } = useSiteGames();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    function refreshData() {
      setRefreshKey((current) => current + 1);
    }

    window.addEventListener(ACHIEVEMENTS_UPDATED_EVENT, refreshData);
    window.addEventListener(GAMES_UPDATED_EVENT, refreshData);
    window.addEventListener("storage", refreshData);
    window.addEventListener("focus", refreshData);

    return () => {
      window.removeEventListener(ACHIEVEMENTS_UPDATED_EVENT, refreshData);
      window.removeEventListener(GAMES_UPDATED_EVENT, refreshData);
      window.removeEventListener("storage", refreshData);
      window.removeEventListener("focus", refreshData);
    };
  }, []);

  const completedGames = useMemo(() => {
    return (gamesList as CompletedGame[]).filter((game) => {
      const status = normalizeStatus(game.status);

      return status === "completed" || Number(game.progress) >= 100;
    });
  }, [gamesList, refreshKey]);

  return (
    <section>
      <div className="flex items-end justify-between gap-3 sm:gap-5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-black uppercase tracking-wide text-white sm:text-lg"><span aria-hidden="true" className="h-5 w-1 rounded-full bg-[#FB2C36]" /> Jogos concluídos</h2>

          <p className="mt-1 text-xs text-white/60 sm:text-[13px]">
            Coleção de jornadas finalizadas e emblemas conquistados
          </p>
        </div>

        <Link
          href="/biblioteca#jogos-finalizados"
          className="shrink-0 py-2 text-xs font-bold text-[#FB2C36] transition hover:text-white"
        >
          Ver mais →
        </Link>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
        {completedGames.length > 0 ? (
          completedGames.map((game) => {
            const progress = Math.min(
              100,
              Math.max(0, Number(game.progress) || 0)
            );

            const achievementStats = getAchievementStats(game);

            return (
              <Link
                key={game.slug}
                href={`/games/${game.slug}`}
                className="group grid grid-cols-[76px_minmax(0,1fr)] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#090b0f] transition hover:border-emerald-400/30 hover:shadow-[0_0_35px_rgba(16,185,129,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 sm:block sm:hover:-translate-y-1"
              >
                <div className="relative m-3 mr-0 aspect-[3/4] self-start overflow-hidden rounded-lg border border-white/10 sm:m-0 sm:aspect-auto sm:h-[210px] sm:rounded-none sm:border-0">
                  <GameCover
                    src={game.cardImage || game.image}
                    alt={game.title}
                  />

                  <div className="absolute inset-0 hidden bg-gradient-to-t from-black/85 via-black/20 to-transparent sm:block" />

                  <div className="absolute left-5 top-5 hidden rounded-full border border-emerald-400/25 bg-emerald-500/20 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-100 sm:block">
                    Finalizado
                  </div>
                </div>

                <div className="min-w-0 p-3 sm:p-5">
                  <span className="inline-flex rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-emerald-300 sm:hidden">
                    Finalizado
                  </span>

                  <h3 className="mt-1.5 line-clamp-2 text-base font-black leading-tight text-white group-hover:text-emerald-200 sm:mt-0 sm:text-2xl">
                    {game.title}
                  </h3>

                  {game.subtitle && (
                    <p className="mt-1 truncate text-xs font-bold text-sky-300/90 sm:text-sm">
                      {game.subtitle}
                    </p>
                  )}

                  <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-5 sm:gap-3">
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 sm:rounded-2xl sm:p-4">
                      <p className="text-[9px] font-black uppercase tracking-[0.16em] text-white/40 sm:text-[10px]">
                        Conquistas
                      </p>

                      <div className="mt-1.5 flex items-center gap-1.5 sm:mt-2 sm:gap-2">
                        <img src={homeImageSrc("/images/trophies/ouro.png")} alt="" aria-hidden="true" className="h-5 w-5 shrink-0 object-contain sm:h-7 sm:w-7" />

                        <p className="text-lg font-black leading-none tabular-nums text-white sm:text-2xl">
                          {achievementStats.completed}/{achievementStats.total}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 sm:rounded-2xl sm:p-4">
                      <p className="text-[9px] font-black uppercase tracking-[0.16em] text-white/40 sm:text-[10px]">
                        Horas
                      </p>

                      <p className="mt-1.5 whitespace-nowrap text-base font-black leading-tight tabular-nums text-white sm:mt-2 sm:text-2xl sm:leading-none">
                        {game.hours || "0h"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10 sm:mt-5 sm:h-2">
                    <div
                      className="h-full rounded-full bg-emerald-400 shadow-[0_0_16px_rgba(16,185,129,0.55)]"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              </Link>
            );
          })
        ) : (
          <div className="rounded-[14px] border border-white/[0.08] bg-[#090b0f] p-8 text-sm text-white/45 sm:col-span-2 xl:col-span-3">
            Nenhum jogo concluído no momento.
          </div>
        )}
      </div>
    </section>
  );
}
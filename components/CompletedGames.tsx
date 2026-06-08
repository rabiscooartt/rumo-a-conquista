"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { type SiteGame, useSiteGames } from "@/lib/useSiteGames";

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
      src={src}
      alt={alt}
      className="h-full w-full object-cover object-center brightness-90 contrast-110 transition duration-500 group-hover:scale-105"
      onError={() => setHasError(true)}
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
    <section className="mt-12">
      <div className="flex items-end justify-between gap-5">
        <div>
          <h2 className="text-4xl font-black text-white">Jogos Concluídos</h2>

          <p className="mt-2 text-sm text-white/50">
            Coleção de jornadas finalizadas e maestrias conquistadas
          </p>
        </div>

        <Link
          href="/biblioteca#jogos-finalizados"
          className="shrink-0 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-4 py-2 text-xs font-black text-emerald-300 transition hover:border-emerald-400/45 hover:bg-emerald-500/20 hover:text-emerald-200"
        >
          Ver mais →
        </Link>
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
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
                className="group overflow-hidden rounded-[28px] border border-white/10 bg-zinc-950/80 transition hover:-translate-y-1 hover:border-emerald-400/30 hover:shadow-[0_0_35px_rgba(16,185,129,0.14)]"
              >
                <div className="relative h-[210px] overflow-hidden">
                  <GameCover
                    src={game.cardImage || game.image}
                    alt={game.title}
                  />

                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />

                  <div className="absolute left-5 top-5 rounded-full border border-emerald-400/25 bg-emerald-500/20 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-100">
                    Finalizado
                  </div>
                </div>

                <div className="p-5">
                  <h3 className="text-2xl font-black text-white group-hover:text-emerald-200">
                    {game.title}
                  </h3>

                  {game.subtitle && (
                    <p className="mt-1 text-sm font-bold text-blue-300">
                      {game.subtitle}
                    </p>
                  )}

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">
                        Conquistas
                      </p>

                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-2xl leading-none">🏆</span>

                        <p className="text-2xl font-black leading-none text-white">
                          {achievementStats.completed}/{achievementStats.total}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">
                        Horas
                      </p>

                      <p className="mt-2 text-2xl font-black leading-none text-white">
                        {game.hours || "0h"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
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
          <div className="rounded-[24px] border border-white/10 bg-zinc-950/80 p-8 text-sm text-white/45 sm:col-span-2 xl:col-span-3">
            Nenhum jogo concluído no momento.
          </div>
        )}
      </div>
    </section>
  );
}
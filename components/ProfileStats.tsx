"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { type SiteGame, useSiteGames } from "@/lib/useSiteGames";

type AchievementSummary =
  | string
  | number
  | {
      completed?: number;
      unlocked?: number;
      total?: number;
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

type ProfileGame = SiteGame & {
  mastery?: string;
  achievements?: AchievementSummary;
  achievementsUnlocked?: number;
  achievementsTotal?: number;
  achievementsList?: AchievementLike[];
};

type ProfileTotals = {
  achievements: number;
  games: number;
  masteries: number;
  hours: string;
  emblems: number;
};

const ACHIEVEMENTS_UPDATED_EVENT = "rumo-a-conquista-achievements-updated";
const GAMES_UPDATED_EVENT = "rumo-a-conquista-games-updated";

function normalizeText(text?: string) {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
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

function normalizeAchievementStatus(status?: string) {
  const normalizedStatus = normalizeText(status);

  if (
    normalizedStatus === "completed" ||
    normalizedStatus === "concluido" ||
    normalizedStatus === "concluida" ||
    normalizedStatus === "desbloqueada" ||
    normalizedStatus === "desbloqueado"
  ) {
    return "completed";
  }

  if (
    normalizedStatus === "progress" ||
    normalizedStatus === "emprogresso" ||
    normalizedStatus === "emandamento"
  ) {
    return "progress";
  }

  return "locked";
}

function isCompletedGame(game: ProfileGame) {
  const status = normalizeText(game.status);
  const mastery = normalizeText(game.mastery);

  return (
    Number(game.progress) >= 100 ||
    status === "completed" ||
    status === "finalizado" ||
    status === "concluido" ||
    status === "concluida" ||
    mastery === "concluida" ||
    mastery === "concluido"
  );
}

function getAchievementTitle(achievement: AchievementLike, index: number) {
  return readText(achievement.title, `Conquista ${index + 1}`);
}

function getAchievementStats(game: ProfileGame) {
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

  const allAchievements = [...baseAchievements, ...customAchievements];

  const completed = allAchievements.filter((achievement, index) => {
    const title = getAchievementTitle(achievement, index);
    const manualStatus = manualStates[title]?.status;
    const achievementStatus = readText(achievement.status, "locked");

    return (
      normalizeAchievementStatus(manualStatus) === "completed" ||
      normalizeAchievementStatus(achievementStatus) === "completed"
    );
  }).length;

  return {
    completed,
    total: allAchievements.length,
  };
}

function hasUnlockedEmblem(game: ProfileGame) {
  const stats = getAchievementStats(game);

  return stats.total > 0 && stats.completed === stats.total;
}

function parseHoursToMinutes(value: unknown) {
  const text = readText(value, "0").toLowerCase().replace(",", ".");

  if (!text.trim()) {
    return 0;
  }

  let totalMinutes = 0;

  const hourMatches = Array.from(
    text.matchAll(/(\d+(?:\.\d+)?)\s*(h|hora|horas)\b/g)
  );

  const minuteMatches = Array.from(
    text.matchAll(/(\d+)\s*(m|min|minuto|minutos)\b/g)
  );

  hourMatches.forEach((match) => {
    const hours = Number(match[1]);

    if (Number.isFinite(hours)) {
      totalMinutes += Math.round(hours * 60);
    }
  });

  minuteMatches.forEach((match) => {
    const minutes = Number(match[1]);

    if (Number.isFinite(minutes)) {
      totalMinutes += minutes;
    }
  });

  if (totalMinutes > 0) {
    return totalMinutes;
  }

  const onlyNumber = Number(text.replace(/[^\d.]/g, ""));

  if (Number.isFinite(onlyNumber)) {
    return Math.round(onlyNumber * 60);
  }

  return 0;
}

function formatMinutes(totalMinutes: number) {
  const safeMinutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;

  if (hours <= 0) {
    return `${minutes}M`;
  }

  if (minutes <= 0) {
    return `${hours}H`;
  }

  return `${hours}H ${minutes}M`;
}

function AvatarImage() {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-purple-500/20 text-4xl">
        🙂
      </div>
    );
  }

  return (
    <img
      src="/images/avatar.jpg"
      alt="orabiiisco"
      className="h-full w-full object-cover"
      onError={() => setHasError(true)}
    />
  );
}

function StatItem({
  icon,
  value,
  label,
  href,
}: {
  icon: string;
  value: string;
  label: string;
  href?: string;
}) {
  const content = (
    <div className="group flex h-full min-w-[130px] flex-1 flex-col items-center justify-center border-r border-white/10 px-5 py-5 text-center last:border-r-0">
      <div className="flex h-11 items-center justify-center text-[36px] leading-none transition group-hover:scale-110">
        {icon}
      </div>

      <div className="mt-2 min-h-[54px] text-[46px] font-black leading-[0.88] text-white drop-shadow-[3px_3px_0_rgba(0,90,255,0.45)]">
        {value}
      </div>

      <div className="mt-2 text-sm text-white/55">{label}</div>
    </div>
  );

  if (!href) {
    return content;
  }

  return (
    <Link
      href={href}
      className="min-w-[130px] flex-1 transition hover:bg-white/[0.03]"
    >
      {content}
    </Link>
  );
}

export default function ProfileStats() {
  const { gamesList, isLoaded: gamesLoaded } = useSiteGames();

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    function refreshData() {
      setRefreshKey((current) => current + 1);
    }

    refreshData();

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

  const totals = useMemo<ProfileTotals>(() => {
    const visibleGames = gamesList as ProfileGame[];

    const totalAchievements = visibleGames.reduce((acc, game) => {
      const stats = getAchievementStats(game);
      return acc + stats.completed;
    }, 0);

    const totalGames = visibleGames.length;

    const totalMasteries = visibleGames.filter((game) =>
      isCompletedGame(game)
    ).length;

    const totalMinutes = visibleGames.reduce((acc, game) => {
      return acc + parseHoursToMinutes(game.hours);
    }, 0);

    const totalEmblems = visibleGames.filter((game) =>
      hasUnlockedEmblem(game)
    ).length;

    return {
      achievements: totalAchievements,
      games: totalGames,
      masteries: totalMasteries,
      hours: formatMinutes(totalMinutes),
      emblems: totalEmblems,
    };
  }, [gamesList, refreshKey]);

  const isLoaded = gamesLoaded;

  return (
    <section className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
      <div className="flex items-center gap-4 rounded-[28px] border border-white/10 bg-zinc-950/80 px-5 py-6 shadow-xl">
        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-3xl border border-purple-400/40 bg-purple-500/10 shadow-[0_0_24px_rgba(168,85,247,0.18)]">
          <AvatarImage />

          <span className="absolute bottom-1 right-1 h-4 w-4 rounded-full border-2 border-zinc-950 bg-emerald-400" />
        </div>

        <div className="min-w-0">
          <h2 className="whitespace-nowrap text-3xl font-black text-white">
            orabiiisco
          </h2>

          <p className="mt-1 text-sm text-white/70">Rumo à Conquista</p>

          <p className="mt-3 text-xs text-white/35">Membro desde 2026</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-[28px] border border-white/10 bg-zinc-950/80 shadow-xl">
        <div className="flex h-full items-stretch justify-between">
          <StatItem
            icon="🏆"
            value={isLoaded ? String(totals.achievements) : "..."}
            label="Conquistas"
            href="/historico"
          />

          <StatItem
            icon="🎮"
            value={isLoaded ? String(totals.games) : "..."}
            label="Jogos"
            href="/biblioteca"
          />

          <StatItem
            icon="💎"
            value={isLoaded ? String(totals.masteries) : "..."}
            label="Maestrias"
            href="/biblioteca?filtro=mastery"
          />

          <StatItem
            icon="⏱️"
            value={isLoaded ? totals.hours : "..."}
            label="Horas jogadas"
          />

          <StatItem
            icon="🌟"
            value={isLoaded ? String(totals.emblems) : "..."}
            label="Emblemas"
            href="/sagas"
          />
        </div>
      </div>
    </section>
  );
}
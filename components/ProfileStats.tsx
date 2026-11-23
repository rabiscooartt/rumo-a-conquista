"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
      src={homeImageSrc("/images/avatar.jpg")}
      alt="orabiiisco"
      className="h-full w-full object-cover"
      onError={fallbackToOriginal("/images/avatar.jpg", () => setHasError(true))}
    />
  );
}

type StatIconName = "trophy" | "games" | "mastery" | "time" | "emblem";

// Ícones de traço no mesmo estilo dos indicadores da Home (substituem os emojis).
function StatIcon({ name }: { name: StatIconName }) {
  const paths: Record<StatIconName, React.ReactNode> = {
    trophy: <path d="M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4" />,
    games: <><path d="M7.5 18h9a4.5 4.5 0 0 0 4.4-5.4l-.7-4A4 4 0 0 0 16.3 5H7.7a4 4 0 0 0-3.9 3.6l-.7 4A4.5 4.5 0 0 0 7.5 18Z" /><path d="M8 10v4M6 12h4M15.5 11.5h.01M18 14h.01" /></>,
    mastery: <><path d="M6.5 4h11L21 9l-9 11L3 9l3.5-5Z" /><path d="M3 9h18M9.5 4 8 9l4 11 4-11-1.5-5" /></>,
    time: <><circle cx="12" cy="13" r="7.5" /><path d="M12 9v4l2.5 2M10 2.5h4" /></>,
    emblem: <><path d="M12 3 19 6v5.5c0 4.3-2.9 7.6-7 9.5-4.1-1.9-7-5.2-7-9.5V6l7-3Z" /><path d="m12 8.2 1.2 2.5 2.7.4-2 1.9.5 2.7-2.4-1.3-2.4 1.3.5-2.7-2-1.9 2.7-.4L12 8.2Z" /></>,
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[18px] w-[18px] sm:h-5 sm:w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function StatItem({
  icon,
  value,
  label,
  href,
}: {
  icon: StatIconName;
  value: string;
  label: string;
  href?: string;
}) {
  const content = (
    <div className="group flex h-full min-w-0 flex-1 flex-col items-center justify-center px-2 py-4 text-center sm:px-3 sm:py-5">
      <span className="rac-icon-tile flex h-9 w-9 items-center justify-center rounded-lg transition group-hover:border-red-500/40 sm:h-10 sm:w-10">
        <StatIcon name={icon} />
      </span>

      <div className="mt-3 whitespace-nowrap text-[22px] font-black leading-none tabular-nums tracking-tight text-white sm:text-[28px] xl:text-[32px]">
        {value}
      </div>

      <div className="mt-1.5 text-[11px] font-medium text-white/60 sm:text-[13px]">{label}</div>
    </div>
  );

  if (!href) {
    return content;
  }

  return (
    <Link
      href={href}
      className="min-w-0 flex-1 transition hover:!bg-[#0e1116] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-400"
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
    <section className="grid grid-cols-1 gap-4 2xl:grid-cols-[340px_minmax(0,1fr)]">
      <div className="flex items-center gap-4 rounded-[14px] border border-white/[0.08] bg-[#090b0f] px-4 py-4 shadow-xl sm:px-5 sm:py-6">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl sm:h-24 sm:w-24 sm:rounded-3xl border border-purple-400/40 bg-purple-500/10 shadow-[0_0_24px_rgba(168,85,247,0.18)]">
          <AvatarImage />

          <span className="absolute bottom-1 right-1 h-4 w-4 rounded-full border-2 border-zinc-950 bg-emerald-400" />
        </div>

        <div className="min-w-0">
          <h2 className="truncate text-2xl font-black text-white sm:whitespace-nowrap sm:text-3xl">
            orabiiisco
          </h2>

          <p className="mt-1 text-sm text-white/70">Rumo à Conquista</p>

          <p className="mt-1.5 text-xs text-white/40 sm:mt-3">Membro desde 2026</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#090b0f] shadow-xl">
        <div className="grid h-full grid-cols-6 items-stretch gap-px bg-white/[0.07] [&>*]:col-span-2 [&>*]:bg-[#090b0f] [&>*:nth-child(n+4)]:col-span-3 sm:flex sm:justify-between sm:gap-0 sm:divide-x sm:divide-white/[0.08] sm:bg-transparent">
          <StatItem
            icon="trophy"
            value={isLoaded ? String(totals.achievements) : "..."}
            label="Conquistas"
            href="/historico"
          />

          <StatItem
            icon="games"
            value={isLoaded ? String(totals.games) : "..."}
            label="Jogos"
            href="/biblioteca"
          />

          <StatItem
            icon="mastery"
            value={isLoaded ? String(totals.masteries) : "..."}
            label="Maestrias"
            href="/biblioteca?filtro=mastery"
          />

          <StatItem
            icon="time"
            value={isLoaded ? totals.hours : "..."}
            label="Horas jogadas"
          />

          <StatItem
            icon="emblem"
            value={isLoaded ? String(totals.emblems) : "..."}
            label="Emblemas"
            href="/sagas"
          />
        </div>
      </div>
    </section>
  );
}
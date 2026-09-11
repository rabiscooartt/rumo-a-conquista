"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { type SiteGame, useSiteGames } from "@/lib/useSiteGames";


function SvgIcon({
  children,
  className = "h-4 w-4",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

function IconGamepad(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <path d="M7.2 8.5H16.8C19.2 8.5 20.5 10.7 20.8 13.4L21.3 17.2C21.6 19.5 18.8 20.2 17.4 18.5L15.4 16H8.6L6.6 18.5C5.2 20.2 2.4 19.5 2.7 17.2L3.2 13.4C3.5 10.7 4.8 8.5 7.2 8.5Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
      <path d="M7 11V15M5 13H9M15.5 12.5H15.51M18 15H18.01" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </SvgIcon>
  );
}

function IconTrophy(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <path d="M8 4.25H16V9.25C16 12.35 14.45 14.65 12 14.65C9.55 14.65 8 12.35 8 9.25V4.25Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
      <path d="M8 6.25H5.8C4.8 6.25 4.25 6.9 4.25 7.8V8.3C4.25 10.65 5.9 12.25 8 12.45M16 6.25H18.2C19.2 6.25 19.75 6.9 19.75 7.8V8.3C19.75 10.65 18.1 12.25 16 12.45" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 14.65V18.2M8.3 20H15.7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M12 6.6L12.75 8.05L14.35 8.28L13.17 9.38L13.45 10.95L12 10.2L10.55 10.95L10.83 9.38L9.65 8.28L11.25 8.05L12 6.6Z" fill="currentColor" />
    </SvgIcon>
  );
}

function IconTarget(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="5.1" stroke="currentColor" strokeWidth="1.7" opacity="0.75" />
      <path d="M12 7.3V16.7M7.3 12H16.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
      <path d="M12 9.2L14.8 12L12 14.8L9.2 12L12 9.2Z" fill="currentColor" />
    </SvgIcon>
  );
}

function IconTrend(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <rect x="4" y="14" width="3" height="5.5" rx="1" fill="currentColor" opacity="0.4" />
      <rect x="10.5" y="10" width="3" height="9.5" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="17" y="5.5" width="3" height="14" rx="1" fill="currentColor" />
      <path d="M4.5 10.8L9.2 6.9L13 9.8L19.5 4.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 4.5H19.5V8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </SvgIcon>
  );
}

function IconCalendar(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <rect x="4" y="5.5" width="16" height="14.5" rx="3" stroke="currentColor" strokeWidth="1.9" />
      <path d="M7.5 3.8V7.1M16.5 3.8V7.1M4.5 9.5H19.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M8 13H8.01M12 13H12.01M16 13H16.01M8 16.5H8.01M12 16.5H12.01" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </SvgIcon>
  );
}

function IconClock(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.9" />
      <path d="M12 7.5V12L15 14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </SvgIcon>
  );
}

function IconPlatform(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 10.5H15.5V15H8.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M10 8.5V10.5M14 8.5V10.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </SvgIcon>
  );
}

function IconBell(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <path d="M6.8 16.5H17.2L16 14.6V10.8C16 8.35 14.4 6.5 12 6.5C9.6 6.5 8 8.35 8 10.8V14.6L6.8 16.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M10.2 18C10.65 18.65 11.25 19 12 19C12.75 19 13.35 18.65 13.8 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </SvgIcon>
  );
}

function IconList(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <rect x="7" y="4.5" width="10" height="15" rx="1.8" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9.5 9H14.5M9.5 12H14.5M9.5 15H13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </SvgIcon>
  );
}

type FilterType = "all" | "progress" | "mastery" | "backlog";

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
  id?: string;
  title?: string;
  description?: string;
  trophy?: string;
  icon?: string;
  difficulty?: string;
  rank?: string;
  status?: string;
  earnedDate?: string;
  image?: string;
  isCustom?: boolean;
  [key: string]: unknown;
};

type BibliotecaGame = SiteGame & {
  mastery?: string;
  isInBacklog?: boolean;
  nextMission?: string;
  achievements?: AchievementSummary;
  achievementsUnlocked?: number;
  achievementsTotal?: number;
  achievementsList?: AchievementLike[];
  finalBadge?: {
    title?: string;
    icon?: string;
    image?: string;
  };
};

type AchievementStats = {
  completed: number;
  total: number;
};

type FinalMasteryData = {
  title: string;
  icon: string;
  image: string;
};

type JourneyHighlight = {
  label: string;
  value: string;
  labelClass: string;
  boxClass: string;
  mastery?: FinalMasteryData;
};

const filters: { label: string; value: FilterType }[] = [
  { label: "Todos", value: "all" },
  { label: "Em progresso", value: "progress" },
  { label: "Fila", value: "backlog" },
  { label: "Finalizados", value: "mastery" },
];

const ACHIEVEMENTS_UPDATED_EVENT = "rumo-a-conquista-achievements-updated";
const GAMES_UPDATED_EVENT = "rumo-a-conquista-games-updated";

function isValidFilter(value: string | null): value is FilterType {
  return (
    value === "all" ||
    value === "progress" ||
    value === "mastery" ||
    value === "backlog"
  );
}

function getFilterFromUrl(): FilterType {
  if (typeof window === "undefined") {
    return "all";
  }

  const params = new URLSearchParams(window.location.search);
  const filtro = params.get("filtro") ?? params.get("filter");

  return isValidFilter(filtro) ? filtro : "all";
}

function updateUrlFilter(filter: FilterType) {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);

  if (filter === "all") {
    url.searchParams.delete("filtro");
    url.searchParams.delete("filter");
  } else {
    url.searchParams.set("filtro", filter);
    url.searchParams.delete("filter");
  }

  window.history.replaceState(null, "", url.toString());
}

function normalizeText(text?: string) {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function readText(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);

  return fallback;
}

function readNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return numberValue;
}

function readLocalJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;

  const savedData = localStorage.getItem(key);

  if (!savedData) return fallback;

  try {
    return JSON.parse(savedData) as T;
  } catch {
    return fallback;
  }
}

function normalizeAchievementStatus(status?: string) {
  const normalized = normalizeText(status);

  if (
    normalized === "completed" ||
    normalized === "concluido" ||
    normalized === "concluida" ||
    normalized === "desbloqueado" ||
    normalized === "desbloqueada"
  ) {
    return "completed";
  }

  if (
    normalized === "progress" ||
    normalized === "emprogresso" ||
    normalized === "emandamento"
  ) {
    return "progress";
  }

  return "locked";
}

function normalizeRank(value?: string, trophy?: string) {
  const rank = normalizeText(value);
  const trophyText = trophy ?? "";

  if (
    rank === "diamante" ||
    rank === "extrema" ||
    trophyText.includes("💎")
  ) {
    return "Diamante";
  }

  if (
    rank === "ouro" ||
    rank === "dificil" ||
    trophyText.includes("🥇") ||
    trophyText.includes("🏆")
  ) {
    return "Ouro";
  }

  if (rank === "prata" || rank === "media" || trophyText.includes("🥈")) {
    return "Prata";
  }

  return "Bronze";
}

function getRankIcon(rank?: string) {
  if (rank === "Diamante") return "💎";
  if (rank === "Ouro") return "🥇";
  if (rank === "Prata") return "🥈";

  return "🥉";
}

function isCompletedGame(game: BibliotecaGame) {
  const status = normalizeText(game.status);
  const mastery = normalizeText(game.mastery);

  return (
    readNumber(game.progress) >= 100 ||
    status === "finalizado" ||
    status === "completed" ||
    status === "concluido" ||
    status === "concluida" ||
    mastery === "concluida" ||
    mastery === "concluido"
  );
}

function isProgressGame(game: BibliotecaGame) {
  const status = normalizeText(game.status);
  const progress = readNumber(game.progress);

  if (isCompletedGame(game)) return false;

  if (
    status === "progress" ||
    status === "emprogresso" ||
    status === "emandamento" ||
    status === "jogando" ||
    status === "playing" ||
    status === "active"
  ) {
    return true;
  }

  return progress > 0 && progress < 100;
}

function isBacklogGame(game: BibliotecaGame) {
  const status = normalizeText(game.status);

  return (
    Boolean(game.isInBacklog) ||
    status === "backlog" ||
    status === "planned" ||
    status === "planejado" ||
    status === "futuro" ||
    status === "future"
  );
}

function getStatusLabel(game: BibliotecaGame) {
  if (isCompletedGame(game)) return "Finalizado";
  if (isProgressGame(game)) return "Em progresso";
  if (isBacklogGame(game)) return "Na fila";

  return game.status || "Não definido";
}

function getObjective(game: BibliotecaGame) {
  return (
    game.currentObjective ||
    game.objective ||
    game.nextMission ||
    "Definir próximo objetivo"
  );
}

function getAchievementTitle(achievement: AchievementLike, index: number) {
  return readText(achievement.title, `Conquista ${index + 1}`);
}

function isMasteryAchievement(
  achievement: AchievementLike,
  manualState?: AchievementStorageState
) {
  const title = normalizeText(readText(achievement.title, ""));
  const rank = normalizeRank(
    manualState?.rank ??
      readText(achievement.rank, readText(achievement.difficulty, "")),
    readText(achievement.trophy, readText(achievement.icon, ""))
  );

  return (
    rank === "Diamante" ||
    title.includes("maestria") ||
    title.includes("mastery")
  );
}

function getFinalMastery(game: BibliotecaGame): FinalMasteryData {
  const achievements = Array.isArray(game.achievementsList)
    ? game.achievementsList
    : [];

  const manualStates = readLocalJson<Record<string, AchievementStorageState>>(
    `rumo-a-conquista-achievements-${game.slug}`,
    {}
  );

  const completedMastery = achievements.find((achievement, index) => {
    const title = getAchievementTitle(achievement, index);
    const manualState = manualStates[title];

    const status = normalizeAchievementStatus(
      manualState?.status ?? achievement.status
    );

    return (
      status === "completed" && isMasteryAchievement(achievement, manualState)
    );
  });

  const anyMastery = achievements.find((achievement, index) => {
    const title = getAchievementTitle(achievement, index);
    const manualState = manualStates[title];

    return isMasteryAchievement(achievement, manualState);
  });

  const masteryAchievement = completedMastery ?? anyMastery;

  if (masteryAchievement) {
    const title = readText(masteryAchievement.title, "Maestria conquistada");
    const manualState = manualStates[title];

    const rank = normalizeRank(
      manualState?.rank ??
        readText(
          masteryAchievement.rank,
          readText(masteryAchievement.difficulty, "Diamante")
        ),
      readText(masteryAchievement.trophy, readText(masteryAchievement.icon, ""))
    );

    return {
      title,
      icon:
        readText(masteryAchievement.icon, "") ||
        readText(masteryAchievement.trophy, "") ||
        getRankIcon(rank),
      image:
        readText(manualState?.image, "") ||
        readText(masteryAchievement.image, "") ||
        readText(game.finalBadge?.image, "") ||
        `/images/games/${game.slug}/achievements/maestria-final.png`,
    };
  }

  const mastery = readText(game.mastery, "").trim();
  const normalizedMastery = normalizeText(mastery);

  if (
    mastery &&
    normalizedMastery !== "concluida" &&
    normalizedMastery !== "concluido"
  ) {
    return {
      title: mastery,
      icon: "💎",
      image:
        readText(game.finalBadge?.image, "") ||
        `/images/games/${game.slug}/achievements/maestria-final.png`,
    };
  }

  return {
    icon: readText(game.finalBadge?.icon, "💎"),
    title: readText(game.finalBadge?.title, "Maestria conquistada"),
    image:
      readText(game.finalBadge?.image, "") ||
      `/images/games/${game.slug}/achievements/maestria-final.png`,
  };
}

function getJourneyHighlight(game: BibliotecaGame): JourneyHighlight {
  if (isCompletedGame(game)) {
    const mastery = getFinalMastery(game);

    return {
      label: "Maestria final",
      value: mastery.title,
      mastery,
      labelClass: "text-emerald-300",
      boxClass:
        "border-emerald-400/25 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.16),transparent_45%),rgba(16,185,129,0.04)]",
    };
  }

  if (isBacklogGame(game)) {
    return {
      label: "Próxima maestria",
      value: getObjective(game),
      labelClass: "text-cyan-300",
      boxClass:
        "border-cyan-400/25 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_45%),rgba(34,211,238,0.04)]",
    };
  }

  return {
    label: "Objetivo atual",
    value: getObjective(game),
    labelClass: "text-red-300",
    boxClass:
      "border-red-500/20 bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.14),transparent_45%),rgba(239,68,68,0.04)]",
  };
}

function getAchievementStats(game: BibliotecaGame): AchievementStats {
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

  const achievements: AchievementLike[] = Array.isArray(game.achievementsList)
    ? game.achievementsList
    : [];

  const manualStates = readLocalJson<Record<string, AchievementStorageState>>(
    `rumo-a-conquista-achievements-${game.slug}`,
    {}
  );

  const hiddenAchievementTitles = readLocalJson<string[]>(
    `rumo-a-conquista-hidden-achievements-${game.slug}`,
    []
  );

  const visibleAchievements = achievements.filter((achievement, index) => {
    const title = getAchievementTitle(achievement, index);

    return !hiddenAchievementTitles.includes(title);
  });

  const completed = visibleAchievements.filter((achievement, index) => {
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
    total: visibleAchievements.length,
  };
}

function getProgressPercent(game: BibliotecaGame, stats: AchievementStats) {
  if (isCompletedGame(game)) return 100;

  const progress = readNumber(game.progress);

  if (progress > 0) {
    return Math.min(100, Math.max(0, progress));
  }

  if (stats.total > 0) {
    return Math.round((stats.completed / stats.total) * 100);
  }

  return 0;
}

function GameCoverImage({ src, title }: { src?: string; title: string }) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  if (!src || hasError) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black/50 text-sm font-black text-white/35">
        Sem imagem
      </div>
    );
  }

  return (
    <img
      key={src}
      src={src}
      alt={title}
      className="h-full w-full object-cover object-center brightness-90 contrast-110 transition duration-700 group-hover:scale-105 group-hover:brightness-105"
      onError={() => setHasError(true)}
    />
  );
}

function MasteryVisual({ mastery }: { mastery: FinalMasteryData }) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [mastery.image]);

  if (mastery.image && !hasError) {
    return (
      <img
        key={mastery.image}
        src={mastery.image}
        alt={mastery.title}
        className="h-full w-full object-cover"
        onError={() => setHasError(true)}
      />
    );
  }

  return <span className="text-lg">{mastery.icon || "💎"}</span>;
}

function MiniStatCard({
  label,
  value,
  icon,
  accent = "white",
}: {
  label: string;
  value: string;
  icon?: string;
  accent?: "white" | "green" | "red" | "cyan";
}) {
  const valueColor =
    accent === "green"
      ? "text-emerald-300"
      : accent === "cyan"
      ? "text-cyan-300"
      : accent === "red"
      ? "text-red-300"
      : "text-white";

  const glowClass =
    accent === "green"
      ? "group-hover/card:border-emerald-400/25 group-hover/card:bg-emerald-500/[0.04]"
      : accent === "cyan"
      ? "group-hover/card:border-cyan-400/25 group-hover/card:bg-cyan-500/[0.04]"
      : accent === "red"
      ? "group-hover/card:border-red-400/25 group-hover/card:bg-red-500/[0.04]"
      : "group-hover/card:border-white/20 group-hover/card:bg-white/[0.05]";

  return (
    <div
      className={`min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3 transition ${glowClass}`}
    >
      <p className="truncate text-[9px] font-black uppercase tracking-[0.22em] text-white/35">
        {label}
      </p>

      <div className="mt-3 flex min-w-0 items-center gap-2">
        {icon ? (
          <span className="shrink-0 text-xl leading-none">{icon}</span>
        ) : null}

        <p
          className={`min-w-0 truncate text-[18px] font-black leading-none tracking-tight ${valueColor}`}
          title={value}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

function getPlatformLabel(game: BibliotecaGame) {
  const value = readText((game as BibliotecaGame & { platform?: string }).platform, "").trim();
  if (value) return value;
  return "Plataforma não definida";
}

function formatGameDate(game: BibliotecaGame) {
  const title = normalizeText(readText(game.title, ""));

  if (title === "crisoltheaterofidols") {
    return "27/03/2026 → 06/04/2026";
  }

  if (title === "hogwartslegacy") {
    return "25/01/2026 → 10/02/2026";
  }

  const raw = readText(game.updatedAt, "") || readText(game.createdAt, "");
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR");
}

function GameRow({ game }: { game: BibliotecaGame }) {
  const gameSlug = readText(game.slug, "");
  const gameTitle = readText(game.title, "Jogo");
  const cardImage = readText(game.cardImage, "") || readText(game.image, "");
  const achievementStats = getAchievementStats(game);
  const progress = getProgressPercent(game, achievementStats);
  const isCompleted = isCompletedGame(game);
  const isBacklog = isBacklogGame(game);
  const statusLabel = getStatusLabel(game);
  const platform = getPlatformLabel(game);
  const date = isBacklog ? "" : formatGameDate(game);

  const statusClass = isCompleted
    ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300"
    : isBacklog
    ? "border-cyan-400/25 bg-cyan-500/10 text-cyan-300"
    : "border-red-500/25 bg-red-500/10 text-red-300";

  const progressClass = isCompleted
    ? "bg-emerald-400 shadow-[0_0_14px_rgba(16,185,129,0.55)]"
    : "bg-pink-500 shadow-[0_0_14px_rgba(236,72,153,0.45)]";

  return (
    <Link
      href={`/games/${gameSlug}`}
      className="group/row block border-b border-white/[0.07] px-3 py-5 transition hover:bg-white/[0.025]"
    >
      <div className="grid grid-cols-[72px_minmax(0,1fr)_82px] items-start gap-4 lg:grid-cols-[72px_minmax(0,1fr)_92px]">
        <div className="h-[92px] w-[72px] shrink-0 overflow-hidden rounded-sm border border-white/15 bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <GameCoverImage src={cardImage} title={gameTitle} />
        </div>

        <div className="min-w-0 pt-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="truncate text-[18px] font-black tracking-tight text-white sm:text-[19px]">
              {gameTitle}
            </h2>

            <span className="inline-flex h-[17px] w-[17px] items-center justify-center rounded-full bg-blue-500 text-[9px] font-black text-white shadow-[0_0_10px_rgba(59,130,246,0.25)]">
              ✓
            </span>

            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] ${statusClass}`}>
              {statusLabel}
            </span>
          </div>

          <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] font-medium text-white/55">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <IconPlatform className="h-[15px] w-[15px] text-white/65" />
              {platform}
            </span>

            <span className="hidden h-4 w-px bg-white/15 sm:block" />

            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <IconTrophy className="h-[16px] w-[16px] text-amber-400" />
              {achievementStats.completed}/{achievementStats.total}
            </span>

            <span className="hidden h-4 w-px bg-white/15 sm:block" />

            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <IconClock className="h-[15px] w-[15px] text-white/65" />
              {isBacklog ? "—" : readText(game.hours, "0h")}
            </span>

            {date ? (
              <>
                <span className="hidden h-4 w-px bg-white/15 sm:block" />
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <IconCalendar className="h-[15px] w-[15px] text-white/65" />
                  {date}
                </span>
              </>
            ) : null}
          </div>

          <div className="mt-3 flex items-center gap-2.5">
            <div className="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
              <div
                className={`h-full rounded-full transition-all duration-500 ${progressClass}`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className={`w-10 shrink-0 text-right text-[12px] font-black ${isCompleted ? "text-emerald-300" : "text-white/60"}`}>
              {progress}%
            </span>
          </div>
        </div>

        <div className="flex items-start justify-end gap-3 pt-1.5">
          <button
            type="button"
            aria-label={`Notificações de ${gameTitle}`}
            onClick={(event) => event.preventDefault()}
            className="text-white/45 transition hover:text-white/80"
          >
            <IconBell className="h-[17px] w-[17px]" />
          </button>
          <button
            type="button"
            aria-label={`Conquistas de ${gameTitle}`}
            onClick={(event) => event.preventDefault()}
            className="text-white/45 transition hover:text-white/80"
          >
            <IconTrophy className="h-[17px] w-[17px]" />
          </button>
          <button
            type="button"
            aria-label={`Detalhes de ${gameTitle}`}
            onClick={(event) => event.preventDefault()}
            className="text-white/45 transition hover:text-white/80"
          >
            <IconList className="h-[17px] w-[17px]" />
          </button>
        </div>
      </div>
    </Link>
  );
}

function GameSection({
  eyebrow,
  title,
  description,
  games,
}: {
  eyebrow: string;
  title: string;
  description: string;
  games: BibliotecaGame[];
}) {
  if (games.length === 0) {
    return null;
  }

  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-5 border-b border-white/10 pb-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
            {eyebrow}
          </p>

          <h2 className="mt-2 text-3xl font-black text-white">{title}</h2>

          <p className="mt-2 max-w-[720px] text-sm leading-relaxed text-white/45">
            {description}
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
            Total
          </p>

          <p className="mt-1 text-2xl font-black text-white">{games.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(370px,430px))] gap-8">
        {games.map((game) => (
          <GameRow key={game.slug} game={game} />
        ))}
      </div>
    </section>
  );
}

export default function BibliotecaPage() {
  const { gamesList, isLoaded } = useSiteGames();
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState("");

  useEffect(() => {
    function syncFilterFromUrl() {
      setActiveFilter(getFilterFromUrl());
    }

    syncFilterFromUrl();
    window.addEventListener("popstate", syncFilterFromUrl);
    window.addEventListener("focus", syncFilterFromUrl);

    return () => {
      window.removeEventListener("popstate", syncFilterFromUrl);
      window.removeEventListener("focus", syncFilterFromUrl);
    };
  }, []);

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

  function handleFilterChange(filter: FilterType) {
    setActiveFilter(filter);
    updateUrlFilter(filter);
  }

  const bibliotecaGames = useMemo(() => gamesList as BibliotecaGame[], [gamesList, refreshKey]);

  const progressGames = useMemo(() => bibliotecaGames.filter((game) => isProgressGame(game)), [bibliotecaGames]);
  const backlogGames = useMemo(
    () => bibliotecaGames.filter((game) => isBacklogGame(game) && !isProgressGame(game) && !isCompletedGame(game)),
    [bibliotecaGames]
  );
  const completedGames = useMemo(() => bibliotecaGames.filter((game) => isCompletedGame(game)), [bibliotecaGames]);

  const filteredGames = useMemo(() => {
    const term = normalizeText(search);

    return bibliotecaGames.filter((game) => {
      if (activeFilter === "progress" && !isProgressGame(game)) return false;
      if (activeFilter === "mastery" && !isCompletedGame(game)) return false;
      if (activeFilter === "backlog" && !isBacklogGame(game)) return false;

      if (!term) return true;

      return normalizeText(readText(game.title, "")).includes(term);
    });
  }, [activeFilter, bibliotecaGames, search]);

  const currentHeroGame = progressGames[0] ?? completedGames[0] ?? backlogGames[0];
  const totalAchievementStats = useMemo(() => {
    return bibliotecaGames.reduce(
      (acc, game) => {
        const stats = getAchievementStats(game);
        acc.completed += stats.completed;
        acc.total += stats.total;
        return acc;
      },
      { completed: 0, total: 0 }
    );
  }, [bibliotecaGames]);

  const totalHours = useMemo(() => {
    let minutes = 0;
    for (const game of bibliotecaGames) {
      const value = readText(game.hours, "").toLowerCase();
      const h = value.match(/(\d+)\s*h/);
      const m = value.match(/(\d+)\s*m/);
      minutes += (h ? Number(h[1]) : 0) * 60 + (m ? Number(m[1]) : 0);
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins ? `${hours}h ${mins}min` : `${hours}h`;
  }, [bibliotecaGames]);

  const overallAchievementProgress = totalAchievementStats.total
    ? Math.round((totalAchievementStats.completed / totalAchievementStats.total) * 100)
    : 0;

  return (
    <main className="min-h-screen bg-[#050608] text-white">
      <Navbar />

      <div className="mx-auto grid w-full max-w-[1360px] grid-cols-1 lg:grid-cols-[250px_minmax(0,1fr)]">
        {/* SIDEBAR — estrutura-base compartilhada entre as páginas */}
        <aside className="hidden min-h-[calc(100vh-56px)] border-r border-white/[0.08] px-6 py-7 lg:block">
          <div className="sticky top-20 flex min-h-[calc(100vh-100px)] flex-col">
            <div>
              <div className="border-t border-white/[0.08] pt-5">
                <div className="flex items-center gap-2 text-[12px] font-black uppercase tracking-[0.12em] text-white/75">
                  <IconGamepad className="h-4 w-4 text-red-400" />
                  Jogos
                </div>
                <p className="mt-2 text-[8px] font-black uppercase tracking-[0.20em] text-white/30">Biblioteca</p>
              </div>

              <nav className="mt-6 space-y-1">
                {[
                  ["Todos os jogos", "all"],
                  ["Em progresso", "progress"],
                  ["Na fila", "backlog"],
                  ["Finalizados", "mastery"],
                ].map(([label, filter]) => {
                  const isActive = activeFilter === filter;
                  return (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => handleFilterChange(filter as FilterType)}
                      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left text-[11px] font-bold transition ${
                        isActive
                          ? "bg-red-500/10 text-red-300"
                          : "text-white/50 hover:bg-white/[0.03] hover:text-white"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-red-400" : "bg-white/20"}`} />
                      {label}
                    </button>
                  );
                })}
              </nav>

              <div className="mt-6 border-t border-white/[0.08] pt-5">
                <p className="text-[8px] font-black uppercase tracking-[0.20em] text-white/25">
                  Sua biblioteca
                </p>
                <p className="mt-3 text-[10px] font-medium leading-relaxed text-white/35">
                  Acompanhe seus jogos, progresso, conquistas e caminho até a Maestria.
                </p>
              </div>
            </div>

            <div className="mt-auto space-y-2 pt-8">
              <Link
                href="/configuracoes"
                className="flex items-center gap-3 px-2.5 py-2 text-[10px] font-bold text-white/45 transition hover:text-white"
              >
                <IconTarget className="h-4 w-4" />
                Configurações
              </Link>

              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event("rumo-admin-open-login"))}
                className="mt-2 w-full rounded-lg bg-red-600 px-3 py-3 text-[10px] font-black text-white transition hover:bg-red-500"
              >
                Entrar
              </button>
            </div>
          </div>
        </aside>

        {/* MAIN */}
        <div className="min-w-0 px-4 py-5 md:px-5 lg:px-5">
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0">
            <header className="relative overflow-hidden border-b border-white/10 bg-[#050609]">
              <div
                className="absolute inset-0 bg-cover bg-right-center bg-no-repeat"
                style={{ backgroundImage: "url('/images/jogos-bg.png')" }}
              />

              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,6,9,0.99)_0%,rgba(5,6,9,0.97)_24%,rgba(5,6,9,0.78)_46%,rgba(5,6,9,0.22)_78%,rgba(5,6,9,0.06)_100%)]" />
              <div className="absolute inset-x-0 bottom-0 h-24 bg-[linear-gradient(180deg,transparent_0%,rgba(5,6,9,0.55)_48%,rgba(5,6,9,0.96)_100%)]" />

              <div className="relative min-h-[235px] px-7 py-7 md:px-7 md:py-7">
                <div className="max-w-[470px]">
                  <p className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.22em] text-red-500">
                    <span className="text-[10px] leading-none">✣</span>
                    Sua jornada em jogos
                  </p>

                  <h1 className="mt-2 text-[38px] font-black leading-none tracking-tight text-white md:text-[40px]">
                    JOGOS DA JORNADA
                  </h1>

                  <p className="mt-3 max-w-[390px] text-[12px] font-medium leading-[1.35] text-white/70">
                    Todos os jogos da sua jornada em um só lugar. Acompanhe seu progresso, conquistas e o caminho até a Maestria.
                  </p>
                </div>

                <div className="absolute bottom-8 left-7 right-7 grid grid-cols-3">
                  <div className="flex min-w-0 items-center gap-2.5 pr-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-red-600/15 text-red-500">
                      <IconGamepad className="h-[22px] w-[22px]" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[19px] font-black leading-none tracking-tight text-white">{bibliotecaGames.length}</p>
                      <p className="mt-1 truncate text-[13px] font-medium leading-[1.25] text-white/55">Jogos na biblioteca</p>
                    </div>
                  </div>

                  <div className="flex min-w-0 items-center gap-2.5 border-l border-white/10 px-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-red-600/15 text-red-500">
                      <IconTrophy className="h-[22px] w-[22px]" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[19px] font-black leading-none tracking-tight text-white">{completedGames.length}</p>
                      <p className="mt-1 truncate text-[13px] font-medium leading-[1.25] text-white/55">Finalizados</p>
                    </div>
                  </div>

                  <div className="flex min-w-0 items-center gap-2.5 border-l border-white/10 pl-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-red-600/15 text-red-500">
                      <IconTarget className="h-[22px] w-[22px]" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[19px] font-black leading-none tracking-tight text-white">{backlogGames.length}</p>
                      <p className="mt-1 truncate text-[13px] font-medium leading-[1.25] text-white/55">Na fila</p>
                    </div>
                  </div>
                </div>
              </div>
            </header>

            <section className="mt-4 overflow-hidden rounded-[14px] border border-white/[0.10] bg-[#090b0f]">
              <div className="border-b border-white/[0.08] px-3 pt-3">
                <div className="flex flex-col gap-3 lg:flex-row">
                  <div className="relative min-w-0 flex-1">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/30">⌕</span>
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Buscar por nome do jogo..."
                      className="w-full rounded-xl border border-white/10 bg-black/25 py-3 pl-10 pr-4 text-[11px] font-semibold text-white outline-none placeholder:text-white/25 focus:border-red-500/40 focus:bg-white/[0.04]"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {filters.map((filter) => {
                      const isActive = activeFilter === filter.value;
                      const count = filter.value === "all" ? bibliotecaGames.length : filter.value === "progress" ? progressGames.length : filter.value === "backlog" ? backlogGames.length : completedGames.length;
                      return (
                        <button
                          key={filter.value}
                          type="button"
                          onClick={() => handleFilterChange(filter.value)}
                          className={`rounded-xl border px-4 py-3 text-[11px] font-black transition ${
                            isActive
                              ? "border-red-500/45 bg-red-500/12 text-white"
                              : "border-white/10 bg-white/[0.02] text-white/45 hover:border-white/20 hover:text-white"
                          }`}
                        >
                          {filter.label} <span className="ml-1 text-white/25">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="px-3 sm:px-4">
                {!isLoaded ? (
                  <div className="py-10 text-center text-sm text-white/40">Carregando biblioteca...</div>
                ) : filteredGames.length === 0 ? (
                  <div className="py-10 text-center text-sm text-white/40">Nenhum jogo encontrado.</div>
                ) : (
                  filteredGames.map((game) => <GameRow key={game.slug} game={game} />)
                )}
              </div>
            </section>
            </div>

            <aside className="space-y-3 xl:sticky xl:top-20 xl:self-start">
            <section className="rounded-[14px] border border-white/[0.10] bg-[#090b0f] p-3.5">
              <div className="flex items-center justify-between border-b border-white/[0.07] pb-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.25em] text-red-400">Biblioteca</p>
                  <h2 className="mt-1 text-lg font-black">Resumo da Jornada</h2>
                </div>
                <span className="text-lg text-red-400">◈</span>
              </div>

              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3">
                  <span className="text-xs text-white/45">Tempo total</span>
                  <strong className="text-sm text-white">{totalHours}</strong>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3">
                  <span className="text-xs text-white/45">Conquistas</span>
                  <strong className="text-sm text-white">{totalAchievementStats.completed}/{totalAchievementStats.total}</strong>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3">
                  <span className="text-xs text-white/45">Progresso geral</span>
                  <strong className="text-sm text-pink-400">{overallAchievementProgress}%</strong>
                </div>
              </div>
            </section>

            <section className="rounded-[14px] border border-white/[0.10] bg-[#090b0f] p-3.5">
              <div className="flex items-center justify-between">
                <h2 className="text-[16px] font-black uppercase tracking-[0.01em]">Status dos Jogos</h2>
                <span className="text-red-400">◉</span>
              </div>

              <div className="mt-5 space-y-4">
                {[
                  { label: "Em progresso", value: progressGames.length, total: bibliotecaGames.length, className: "bg-red-500" },
                  { label: "Finalizados", value: completedGames.length, total: bibliotecaGames.length, className: "bg-emerald-400" },
                  { label: "Na fila", value: backlogGames.length, total: bibliotecaGames.length, className: "bg-cyan-400" },
                ].map((item) => (
                  <div key={item.label}>
                    <div className="mb-2 flex items-center justify-between text-[11px]">
                      <span className="text-white/50">{item.label}</span>
                      <strong className="text-white/80">{item.value}</strong>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                      <div className={`h-full rounded-full ${item.className}`} style={{ width: `${item.total ? (item.value / item.total) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[14px] border border-white/[0.10] bg-[#090b0f] p-3.5">
              <div className="flex items-center justify-between border-b border-white/[0.07] pb-4">
                <h2 className="text-[16px] font-black uppercase tracking-[0.01em]">Próximos na Fila</h2>
                <Link href="/backlog" className="text-[10px] font-black uppercase tracking-[0.15em] text-red-400 hover:text-red-300">Ver fila</Link>
              </div>

              <div className="mt-4 space-y-3">
                {backlogGames.slice(0, 4).map((game) => (
                  <Link key={game.slug} href={`/games/${game.slug}`} className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-white/[0.035]">
                    <div className="h-12 w-9 shrink-0 overflow-hidden rounded border border-white/10">
                      <GameCoverImage src={readText(game.cardImage, "") || readText(game.image, "")} title={game.title} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-black text-white">{game.title}</p>
                      <p className="mt-1 truncate text-[10px] text-white/30">{getObjective(game)}</p>
                    </div>
                  </Link>
                ))}
                {backlogGames.length === 0 ? <p className="py-3 text-xs text-white/30">Nenhum jogo na fila.</p> : null}
              </div>
            </section>

            <section className="rounded-[14px] border border-white/[0.10] bg-[#090b0f] p-3.5">
              <div className="flex items-center justify-between">
                <h2 className="text-[16px] font-black uppercase tracking-[0.01em]">Primeira Run</h2>
                <span className="text-red-400">✦</span>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-white/35">
                A preparação da Primeira Run ficará vinculada diretamente a cada jogo. Aqui teremos o ponto de entrada quando esse sistema estiver pronto.
              </p>
            </section>
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}


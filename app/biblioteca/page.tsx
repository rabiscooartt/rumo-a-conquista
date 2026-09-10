"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { type SiteGame, useSiteGames } from "@/lib/useSiteGames";

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

function HeroStat({
  label,
  value,
  icon,
  accent = "white",
}: {
  label: string;
  value: string;
  icon: string;
  accent?: "white" | "green" | "red" | "cyan";
}) {
  const iconClass =
    accent === "green"
      ? "bg-emerald-500/10 text-emerald-300"
      : accent === "cyan"
      ? "bg-cyan-500/10 text-cyan-300"
      : accent === "red"
      ? "bg-red-500/10 text-red-300"
      : "bg-red-500/10 text-red-300";

  const valueClass =
    accent === "green"
      ? "text-emerald-300"
      : accent === "cyan"
      ? "text-cyan-300"
      : accent === "red"
      ? "text-red-300"
      : "text-white";

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[18px] ${iconClass}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className={`truncate text-[19px] font-black leading-none tracking-tight ${valueClass}`}>
          {value}
        </p>
        <p className="mt-1 text-[10px] font-bold text-white/45">{label}</p>
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
  const date = formatGameDate(game);

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
      <div className="grid grid-cols-[64px_minmax(0,1fr)_112px_32px] items-start gap-4 lg:grid-cols-[64px_minmax(0,1fr)_132px_32px]">
        <div className="h-[82px] w-16 shrink-0 overflow-hidden rounded-sm border border-white/15 bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <GameCoverImage src={cardImage} title={gameTitle} />
        </div>

        <div className="min-w-0 pt-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="truncate text-[16px] font-black tracking-tight text-white sm:text-[17px]">
              {gameTitle}
            </h2>

            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[9px] font-black text-white shadow-[0_0_10px_rgba(59,130,246,0.25)]">
              ✓
            </span>

            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] ${statusClass}`}>
              {statusLabel}
            </span>
          </div>

          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/45">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white/[0.06] text-[10px] text-white/80">
                ◉
              </span>
              {platform}
            </span>

            <span className="hidden h-4 w-px bg-white/10 sm:block" />

            <span className="whitespace-nowrap">🏆 {achievementStats.completed}/{achievementStats.total}</span>

            <span className="hidden h-4 w-px bg-white/10 sm:block" />

            <span className="whitespace-nowrap">◷ {readText(game.hours, "0h")}</span>

            {date ? (
              <>
                <span className="hidden h-4 w-px bg-white/10 sm:block" />
                <span className="whitespace-nowrap">▣ {date}</span>
              </>
            ) : null}
          </div>

          <div className="mt-3 flex items-center gap-3">
            <div className="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
              <div
                className={`h-full rounded-full transition-all duration-500 ${progressClass}`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className={`w-10 shrink-0 text-right text-[11px] font-black ${isCompleted ? "text-emerald-300" : "text-white/45"}`}>
              {progress}%
            </span>
          </div>
        </div>

        <div className="hidden pt-1 text-right lg:block">
          <p className="text-[13px] font-black text-white/90">{readText(game.hours, "0h")}</p>
          <p className="mt-1 text-[9px] font-black uppercase tracking-[0.13em] text-white/25">Tempo jogado</p>
        </div>

        <div className="flex justify-end pt-1">
          <span className="text-lg leading-none text-white/35 transition group-hover/row:text-white/70">⋮</span>
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0b1624_0%,#05070b_42%,#020202_100%)] text-white">
      <Navbar />

      <div className="mx-auto grid w-full max-w-[1560px] grid-cols-1 lg:grid-cols-[190px_minmax(0,1fr)]">
        {/* SIDEBAR — estrutura-base compartilhada entre as páginas */}
        <aside className="hidden min-h-[calc(100vh-56px)] border-r border-white/[0.08] px-5 py-6 lg:block">
          <div className="sticky top-20 flex min-h-[calc(100vh-100px)] flex-col">
            <div>
              <div className="border-l-2 border-red-500 pl-3">
                <p className="text-[12px] font-black text-white">JOGOS</p>
                <p className="mt-1 text-[8px] font-black uppercase tracking-[0.2em] text-white/25">Biblioteca</p>
              </div>

              <nav className="mt-7 space-y-1">
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

              <div className="mt-8 border-t border-white/[0.08] pt-6">
                <p className="text-[7px] font-black uppercase tracking-[0.22em] text-white/25">
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
                <span className="text-sm">⚙</span>
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
        <div className="min-w-0 px-4 py-5 md:px-6 lg:px-5">
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0">
            <header className="relative overflow-hidden rounded-[18px] border border-white/10 bg-[#08090c]">
              <img
                src="/images/jogos-bg.png"
                alt=""
                className="absolute inset-0 h-full w-full object-cover object-center opacity-45"
              />
              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(4,5,8,0.96)_0%,rgba(4,5,8,0.84)_38%,rgba(4,5,8,0.58)_70%,rgba(4,5,8,0.28)_100%)]" />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,5,8,0.12),rgba(4,5,8,0.72)_100%)]" />

              <div className="relative z-10 px-6 pb-5 pt-6 sm:px-7 sm:pb-6 sm:pt-7">
                <p className="text-[10px] font-black uppercase tracking-[0.32em] text-red-400">+ Sua jornada em jogos</p>
                <h1 className="mt-2 text-[34px] font-black leading-none tracking-tight text-white sm:text-[40px]">Jogos da Jornada</h1>
                <p className="mt-3 max-w-[650px] text-[12px] leading-relaxed text-white/60 sm:text-[13px]">
                  Todos os jogos da sua jornada em um só lugar. Acompanhe seu progresso, conquistas e o caminho até a Maestria.
                </p>

                <div className="mt-6 grid grid-cols-1 gap-4 border-t border-white/10 pt-4 sm:grid-cols-3 sm:gap-0">
                  <div className="sm:border-r sm:border-white/10 sm:pr-5">
                    <HeroStat label="Jogos na biblioteca" value={String(bibliotecaGames.length)} icon="🎮" />
                  </div>
                  <div className="sm:border-r sm:border-white/10 sm:px-5">
                    <HeroStat label="Finalizados" value={String(completedGames.length)} icon="🏆" accent="green" />
                  </div>
                  <div className="sm:pl-5">
                    <HeroStat label="Na fila" value={String(backlogGames.length)} icon="🎯" accent="cyan" />
                  </div>
                </div>
              </div>
            </header>

            <section className="mt-6 overflow-hidden rounded-[20px] border border-white/10 bg-black/20">
              <div className="border-b border-white/[0.07] p-3 sm:p-4">
                <div className="flex flex-col gap-3 lg:flex-row">
                  <div className="relative min-w-0 flex-1">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/30">⌕</span>
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Buscar por nome do jogo..."
                      className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.025] pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-red-500/40 focus:bg-white/[0.04]"
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
                          className={`h-11 rounded-xl border px-3 text-[11px] font-black transition ${
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

            <aside className="space-y-5 xl:sticky xl:top-5 xl:self-start">
            <section className="rounded-[20px] border border-white/10 bg-black/25 p-5">
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

            <section className="rounded-[20px] border border-white/10 bg-black/25 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black uppercase tracking-[0.18em]">Status dos Jogos</h2>
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

            <section className="rounded-[20px] border border-white/10 bg-black/25 p-5">
              <div className="flex items-center justify-between border-b border-white/[0.07] pb-4">
                <h2 className="text-sm font-black uppercase tracking-[0.18em]">Próximos na Fila</h2>
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

            <section className="rounded-[20px] border border-white/10 bg-black/25 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black uppercase tracking-[0.18em]">Primeira Run</h2>
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


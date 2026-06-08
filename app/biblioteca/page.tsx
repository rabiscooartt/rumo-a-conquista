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

type BacklogItem = {
  id?: string;
  slug?: string;
  order?: number;
  status?: string;
};

type BibliotecaGame = SiteGame & {
  mastery?: string;
  isInBacklog?: boolean;
  backlogOrder?: number;
  order?: number;
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

const BACKLOG_STORAGE_KEY = "rumo-a-conquista-backlog";

const ACHIEVEMENTS_UPDATED_EVENT = "rumo-a-conquista-achievements-updated";
const GAMES_UPDATED_EVENT = "rumo-a-conquista-games-updated";
const BACKLOG_UPDATED_EVENT = "rumo-a-conquista-backlog-updated";

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

function getSavedBacklogItems() {
  const savedData = readLocalJson<unknown>(BACKLOG_STORAGE_KEY, []);

  if (Array.isArray(savedData)) {
    return savedData as BacklogItem[];
  }

  if (savedData && typeof savedData === "object") {
    return Object.values(savedData as Record<string, BacklogItem>);
  }

  return [];
}

function getBacklogOrderMap() {
  const savedItems = getSavedBacklogItems();

  return savedItems.reduce<Record<string, number>>((acc, item, index) => {
    const slug = readText(item.slug, "");

    if (!slug) {
      return acc;
    }

    const order = readNumber(item.order, index + 1);

    acc[slug] = order > 0 ? order : index + 1;

    return acc;
  }, {});
}

function getBacklogOrder(
  game: BibliotecaGame,
  backlogOrderMap: Record<string, number>,
  fallbackIndex: number
) {
  const slug = readText(game.slug, "");
  const savedOrder = slug ? backlogOrderMap[slug] : undefined;

  if (typeof savedOrder === "number" && Number.isFinite(savedOrder)) {
    return savedOrder;
  }

  if (typeof game.backlogOrder === "number") {
    return game.backlogOrder;
  }

  if (typeof game.order === "number") {
    return game.order;
  }

  return fallbackIndex + 10000;
}

function sortBacklogGames(
  games: BibliotecaGame[],
  backlogOrderMap: Record<string, number>
) {
  return games
    .map((game, index) => ({ game, index }))
    .sort((a, b) => {
      const orderA = getBacklogOrder(a.game, backlogOrderMap, a.index);
      const orderB = getBacklogOrder(b.game, backlogOrderMap, b.index);

      if (orderA !== orderB) {
        return orderA - orderB;
      }

      return readText(a.game.title, "").localeCompare(
        readText(b.game.title, "")
      );
    })
    .map((item) => item.game);
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

function GameCard({ game }: { game: BibliotecaGame }) {
  const gameSlug = readText(game.slug, "");
  const gameTitle = readText(game.title, "Jogo");
  const cardImage = readText(game.image, "") || readText(game.cardImage, "");
  const achievementStats = getAchievementStats(game);
  const progress = getProgressPercent(game, achievementStats);
  const isCompleted = isCompletedGame(game);
  const isBacklog = isBacklogGame(game);
  const statusLabel = getStatusLabel(game);
  const highlight = getJourneyHighlight(game);

  return (
    <Link
      href={`/games/${gameSlug}`}
      className={`group/card overflow-hidden rounded-[30px] border bg-zinc-950/85 shadow-xl transition duration-300 hover:-translate-y-1 ${
        isCompleted
          ? "border-emerald-400/20 hover:border-emerald-400/40 hover:shadow-[0_0_42px_rgba(16,185,129,0.16)]"
          : isBacklog
          ? "border-cyan-400/15 hover:border-cyan-400/35 hover:shadow-[0_0_42px_rgba(34,211,238,0.14)]"
          : "border-red-500/15 hover:border-red-500/40 hover:shadow-[0_0_42px_rgba(239,68,68,0.16)]"
      }`}
    >
      <div className="relative h-[245px] overflow-hidden">
        <GameCoverImage src={cardImage} title={gameTitle} />

        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/35 via-transparent to-black/10" />

        <div className="absolute left-5 top-5">
          <span
            className={`rounded-full border px-4 py-1 text-xs font-black uppercase tracking-[0.18em] shadow-[0_0_24px_rgba(0,0,0,0.25)] backdrop-blur-md ${
              isCompleted
                ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300"
                : isBacklog
                ? "border-cyan-400/30 bg-cyan-500/15 text-cyan-300"
                : "border-red-400/30 bg-red-500/15 text-red-300"
            }`}
          >
            {statusLabel}
          </span>
        </div>

        <div className="absolute right-5 top-5 rounded-full border border-white/10 bg-black/55 px-3 py-1 text-xs font-black text-white/80 backdrop-blur-md">
          {progress}%
        </div>
      </div>

      <div className="p-5">
        <h2 className="text-2xl font-black leading-tight text-white">
          {gameTitle}
        </h2>

        <p className="mt-1 text-sm font-medium text-blue-300">
          {game.subtitle || "Sem subtítulo"}
        </p>

        <div
          className={`mt-5 rounded-2xl border p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${highlight.boxClass}`}
        >
          <p
            className={`text-[10px] font-black uppercase tracking-[0.25em] ${highlight.labelClass}`}
          >
            {highlight.label}
          </p>

          <div className="mt-2 flex items-center gap-3">
            {highlight.mastery ? (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-emerald-400/25 bg-black/40 shadow-[0_0_24px_rgba(16,185,129,0.1)]">
                <MasteryVisual mastery={highlight.mastery} />
              </div>
            ) : null}

            <p className="line-clamp-2 text-sm font-black text-white">
              {highlight.value}
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2">
          <MiniStatCard
            label="Conquistas"
            icon="🏆"
            value={`${achievementStats.completed}/${achievementStats.total}`}
          />

          <MiniStatCard label="Horas" value={readText(game.hours, "0h")} />

          <MiniStatCard
            label="Status"
            value={statusLabel}
            accent={isCompleted ? "green" : isBacklog ? "cyan" : "red"}
          />
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-white/45">Progresso da jornada</span>

            <span
              className={`font-black ${
                isCompleted ? "text-emerald-300" : "text-red-400"
              }`}
            >
              {progress}%
            </span>
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isCompleted
                  ? "bg-emerald-400 shadow-[0_0_16px_rgba(16,185,129,0.7)]"
                  : "bg-red-500 shadow-[0_0_16px_rgba(239,68,68,0.7)]"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
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
  sectionId,
}: {
  eyebrow: string;
  title: string;
  description: string;
  games: BibliotecaGame[];
  sectionId?: string;
}) {
  if (games.length === 0) {
    return null;
  }

  return (
    <section id={sectionId} className="scroll-mt-28">
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
          <GameCard key={game.slug} game={game} />
        ))}
      </div>
    </section>
  );
}

export default function BibliotecaPage() {
  const { gamesList, isLoaded } = useSiteGames();
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [refreshKey, setRefreshKey] = useState(0);

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
    window.addEventListener(BACKLOG_UPDATED_EVENT, refreshData);
    window.addEventListener("storage", refreshData);
    window.addEventListener("focus", refreshData);

    return () => {
      window.removeEventListener(ACHIEVEMENTS_UPDATED_EVENT, refreshData);
      window.removeEventListener(GAMES_UPDATED_EVENT, refreshData);
      window.removeEventListener(BACKLOG_UPDATED_EVENT, refreshData);
      window.removeEventListener("storage", refreshData);
      window.removeEventListener("focus", refreshData);
    };
  }, []);

  function handleFilterChange(filter: FilterType) {
    setActiveFilter(filter);
    updateUrlFilter(filter);
  }

  const bibliotecaGames = useMemo(() => {
    return gamesList as BibliotecaGame[];
  }, [gamesList, refreshKey]);

  const backlogOrderMap = useMemo(() => {
    return getBacklogOrderMap();
  }, [refreshKey]);

  const progressGames = useMemo(() => {
    return bibliotecaGames.filter((game) => isProgressGame(game));
  }, [bibliotecaGames]);

  const backlogGames = useMemo(() => {
    const gamesInBacklog = bibliotecaGames.filter((game) => {
      return (
        isBacklogGame(game) && !isProgressGame(game) && !isCompletedGame(game)
      );
    });

    return sortBacklogGames(gamesInBacklog, backlogOrderMap);
  }, [bibliotecaGames, backlogOrderMap]);

  const completedGames = useMemo(() => {
    return bibliotecaGames.filter((game) => isCompletedGame(game));
  }, [bibliotecaGames]);

  const filteredGames = useMemo(() => {
    if (activeFilter === "progress") {
      return progressGames;
    }

    if (activeFilter === "mastery") {
      return completedGames;
    }

    if (activeFilter === "backlog") {
      return backlogGames;
    }

    return bibliotecaGames;
  }, [
    activeFilter,
    bibliotecaGames,
    progressGames,
    completedGames,
    backlogGames,
  ]);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    if (window.location.hash !== "#jogos-finalizados") {
      return;
    }

    const scrollTimer = window.setTimeout(() => {
      const target = document.getElementById("jogos-finalizados");

      if (!target) {
        return;
      }

      target.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 120);

    return () => {
      window.clearTimeout(scrollTimer);
    };
  }, [isLoaded, refreshKey]);

  const hasAnyGameInAllSections =
    progressGames.length > 0 ||
    backlogGames.length > 0 ||
    completedGames.length > 0;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0b1624_0%,#050505_45%,#020202_100%)] text-white">
      <Navbar />

      <section className="mx-auto w-full max-w-[1500px] px-8 py-10">
        <header className="overflow-hidden rounded-[32px] border border-white/10 bg-zinc-950/80 shadow-xl">
          <div className="relative p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.2),transparent_36%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.14),transparent_32%)]" />
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.04),transparent_35%,rgba(255,255,255,0.02))]" />

            <div className="relative z-10">
              <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
                Biblioteca
              </p>

              <div className="mt-3 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
                <div>
                  <h1 className="text-5xl font-black text-white">
                    Jogos da Jornada
                  </h1>

                  <p className="mt-3 max-w-[720px] text-sm leading-relaxed text-white/50">
                    Todos os jogos cadastrados no projeto Rumo à Conquista,
                    separados por progresso, fila de maestrias e jogos
                    finalizados.
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
                    Total de jogos
                  </p>

                  <p className="mt-1 text-3xl font-black text-white">
                    {bibliotecaGames.length}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </header>

        <section className="mt-8">
          <div className="flex flex-wrap gap-3">
            {filters.map((filter) => {
              const isActive = activeFilter === filter.value;

              return (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => handleFilterChange(filter.value)}
                  className={`rounded-xl border px-5 py-3 text-sm font-black transition ${
                    isActive
                      ? "border-red-500/45 bg-red-500/15 text-red-100 shadow-[0_0_24px_rgba(239,68,68,0.12)]"
                      : "border-white/10 bg-white/[0.03] text-white/60 hover:border-red-500/30 hover:bg-red-500/10 hover:text-white"
                  }`}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-8">
          {!isLoaded ? (
            <div className="rounded-[24px] border border-white/10 bg-zinc-950/80 p-8 text-white/50">
              Carregando biblioteca...
            </div>
          ) : activeFilter === "all" ? (
            hasAnyGameInAllSections ? (
              <div className="grid gap-12">
                <GameSection
                  eyebrow="Em progresso"
                  title="Jogos em Progresso"
                  description="Jogos ativos no momento e objetivos que estão acontecendo agora."
                  games={progressGames}
                />

                <GameSection
                  eyebrow="Fila"
                  title="Próximas Maestrias"
                  description="Jogos que estão na fila para entrar na jornada futuramente."
                  games={backlogGames}
                />

                <GameSection
                  sectionId="jogos-finalizados"
                  eyebrow="Finalizados"
                  title="Jogos Finalizados"
                  description="Jogos que já tiveram a jornada concluída ou maestria final liberada."
                  games={completedGames}
                />
              </div>
            ) : (
              <div className="rounded-[24px] border border-white/10 bg-zinc-950/80 p-8 text-white/50">
                Nenhum jogo encontrado.
              </div>
            )
          ) : filteredGames.length === 0 ? (
            <div className="rounded-[24px] border border-white/10 bg-zinc-950/80 p-8 text-white/50">
              Nenhum jogo encontrado nesse filtro.
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(370px,430px))] gap-8">
              {filteredGames.map((game) => (
                <GameCard key={game.slug} game={game} />
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
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


function getGameField(game: BibliotecaGame, key: string) {
  const value = (game as unknown as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function getGamePlatform(game: BibliotecaGame) {
  return (
    getGameField(game, "platform") ||
    getGameField(game, "platformName") ||
    "Plataforma não definida"
  );
}

function getGameDate(game: BibliotecaGame) {
  return (
    getGameField(game, "lastPlayedAt") ||
    getGameField(game, "updatedAt") ||
    getGameField(game, "date") ||
    getGameField(game, "startedAt") ||
    ""
  );
}

function formatGameDate(value: string) {
  if (!value) return "Data não definida";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("pt-BR");
}

function parsePlayedMinutes(value: string) {
  const text = value.toLowerCase().trim();
  if (!text) return 0;

  let minutes = 0;

  const hoursMatch = text.match(/(\d+(?:[.,]\d+)?)\s*h/);
  const minutesMatch = text.match(/(\d+)\s*(?:min|m)\b/);

  if (hoursMatch) {
    minutes += Math.round(Number(hoursMatch[1].replace(",", ".")) * 60);
  }

  if (minutesMatch) {
    minutes += Number(minutesMatch[1]);
  }

  return minutes;
}

function formatTotalMinutes(totalMinutes: number) {
  if (totalMinutes <= 0) return "0h";

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}min`;
}

function getProgressColor(game: BibliotecaGame) {
  if (isCompletedGame(game)) return "bg-emerald-400";
  if (isBacklogGame(game)) return "bg-cyan-400";
  return "bg-pink-500";
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
  const platform = getGamePlatform(game);
  const date = formatGameDate(getGameDate(game));
  const hours = readText(game.hours, "0h");

  return (
    <Link
      href={`/games/${gameSlug}`}
      className="group/game block border-b border-white/[0.07] py-5 transition hover:bg-white/[0.018] first:pt-3 last:border-b-0"
    >
      <div className="grid grid-cols-[64px_minmax(0,1fr)_132px] items-center gap-4">
        <div className="h-[88px] w-16 shrink-0 overflow-hidden border border-white/15 bg-zinc-900">
          <GameCoverImage src={cardImage} title={gameTitle} />
        </div>

        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="truncate text-[16px] font-black leading-tight text-white">
              {gameTitle}
            </h2>

            <span
              title="Jogo cadastrado na jornada"
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-500 text-[9px] font-black text-white"
            >
              ✓
            </span>

            <span
              className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${
                isCompleted
                  ? "border-violet-400/20 bg-violet-500/10 text-violet-300"
                  : isBacklog
                  ? "border-cyan-400/20 bg-cyan-500/10 text-cyan-300"
                  : "border-amber-400/20 bg-amber-500/10 text-amber-300"
              }`}
            >
              {isCompleted ? "Finalizado" : isBacklog ? "Na fila" : "Em progresso"}
            </span>
          </div>

          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-y-1 text-[10px] font-semibold text-white/45">
            <span className="truncate">{platform}</span>
            <span className="mx-2 text-white/15">|</span>
            <span>🏆 {achievementStats.completed}/{achievementStats.total}</span>
            <span className="mx-2 text-white/15">|</span>
            <span>◷ {hours}</span>
            <span className="mx-2 text-white/15">|</span>
            <span>▣ {date}</span>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <div className="h-[4px] min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
              <div
                className={`h-full rounded-full transition-all duration-500 ${getProgressColor(game)}`}
                style={{ width: `${progress}%` }}
              />
            </div>

            <span
              className={`w-9 shrink-0 text-right text-[10px] font-black ${
                isCompleted
                  ? "text-emerald-400"
                  : isBacklog
                  ? "text-cyan-400"
                  : "text-pink-400"
              }`}
            >
              {progress}%
            </span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-4 text-white/35">
          <span title="Acompanhar jogo" className="text-[17px] transition group-hover/game:text-white/70">
            ♧
          </span>
          <span title="Conquistas" className="text-[17px] transition group-hover/game:text-white/70">
            ♜
          </span>
          <span title="Detalhes" className="text-[17px] transition group-hover/game:text-white/70">
            ▤
          </span>
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
  if (games.length === 0) return null;

  return (
    <section>
      <div className="mb-2 flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-red-400">
            {eyebrow}
          </p>
          <h2 className="mt-1 text-[22px] font-black text-white">{title}</h2>
          <p className="mt-1 max-w-[720px] text-[11px] leading-relaxed text-white/35">
            {description}
          </p>
        </div>

        <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.15em] text-white/30">
          {games.length} {games.length === 1 ? "jogo" : "jogos"}
        </span>
      </div>

      <div className="rounded-[14px] border border-white/[0.08] bg-[#090b0f] px-4">
        {games.map((game) => (
          <GameCard key={game.slug} game={game} />
        ))}
      </div>
    </section>
  );
}

function SidebarPanel({
  title,
  children,
  accent = "red",
}: {
  title: string;
  children: React.ReactNode;
  accent?: "red" | "cyan";
}) {
  return (
    <section className="rounded-[14px] border border-white/[0.09] bg-[#090b0f] p-4">
      <div className="mb-4 flex items-center gap-2">
        <span className={`h-4 w-[2px] ${accent === "cyan" ? "bg-cyan-400" : "bg-red-500"}`} />
        <h2 className="text-[12px] font-black uppercase tracking-[0.08em] text-white">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function SidebarMetric({
  label,
  value,
  accent = "white",
}: {
  label: string;
  value: string;
  accent?: "white" | "pink" | "green" | "cyan";
}) {
  const valueClass =
    accent === "pink"
      ? "text-pink-400"
      : accent === "green"
      ? "text-emerald-400"
      : accent === "cyan"
      ? "text-cyan-400"
      : "text-white";

  return (
    <div className="flex items-center justify-between border-b border-white/[0.06] py-3 last:border-b-0">
      <span className="text-[10px] font-semibold text-white/40">{label}</span>
      <span className={`text-[12px] font-black ${valueClass}`}>{value}</span>
    </div>
  );
}

function StatusBar({
  label,
  value,
  total,
  accent,
}: {
  label: string;
  value: number;
  total: number;
  accent: "pink" | "green" | "cyan";
}) {
  const color =
    accent === "green"
      ? "bg-emerald-400"
      : accent === "cyan"
      ? "bg-cyan-400"
      : "bg-pink-500";

  const width = total > 0 ? Math.max(4, Math.round((value / total) * 100)) : 0;

  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-2 flex items-center justify-between text-[10px]">
        <span className="text-white/45">{label}</span>
        <span className="font-black text-white/75">{value}</span>
      </div>
      <div className="h-[4px] overflow-hidden rounded-full bg-white/[0.07]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
      </div>
    </div>
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

  const bibliotecaGames = useMemo(() => {
    return gamesList as BibliotecaGame[];
  }, [gamesList, refreshKey]);

  const searchedGames = useMemo(() => {
    const normalizedSearch = normalizeText(search);
    if (!normalizedSearch) return bibliotecaGames;

    return bibliotecaGames.filter((game) =>
      normalizeText(readText(game.title, "")).includes(normalizedSearch)
    );
  }, [bibliotecaGames, search]);

  const progressGames = useMemo(
    () => searchedGames.filter((game) => isProgressGame(game)),
    [searchedGames]
  );

  const backlogGames = useMemo(
    () =>
      searchedGames.filter(
        (game) =>
          isBacklogGame(game) &&
          !isProgressGame(game) &&
          !isCompletedGame(game)
      ),
    [searchedGames]
  );

  const completedGames = useMemo(
    () => searchedGames.filter((game) => isCompletedGame(game)),
    [searchedGames]
  );

  const filteredGames = useMemo(() => {
    return searchedGames.filter((game) => {
      if (activeFilter === "all") return true;
      if (activeFilter === "progress") return isProgressGame(game);
      if (activeFilter === "mastery") return isCompletedGame(game);
      if (activeFilter === "backlog") return isBacklogGame(game);
      return true;
    });
  }, [activeFilter, searchedGames]);

  const totalMinutes = useMemo(
    () =>
      bibliotecaGames.reduce(
        (sum, game) => sum + parsePlayedMinutes(readText(game.hours, "")),
        0
      ),
    [bibliotecaGames]
  );

  const totalAchievements = useMemo(
    () =>
      bibliotecaGames.reduce((sum, game) => {
        const stats = getAchievementStats(game);
        return sum + stats.completed;
      }, 0),
    [bibliotecaGames]
  );

  const totalAchievementTargets = useMemo(
    () =>
      bibliotecaGames.reduce((sum, game) => {
        const stats = getAchievementStats(game);
        return sum + stats.total;
      }, 0),
    [bibliotecaGames]
  );

  const overallProgress =
    totalAchievementTargets > 0
      ? Math.round((totalAchievements / totalAchievementTargets) * 100)
      : bibliotecaGames.length > 0
      ? Math.round(
          bibliotecaGames.reduce(
            (sum, game) => sum + getProgressPercent(game, getAchievementStats(game)),
            0
          ) / bibliotecaGames.length
        )
      : 0;

  const progressCount = bibliotecaGames.filter((game) => isProgressGame(game)).length;
  const completedCount = bibliotecaGames.filter((game) => isCompletedGame(game)).length;
  const backlogCount = bibliotecaGames.filter((game) => isBacklogGame(game)).length;

  const nextBacklog = bibliotecaGames
    .filter(
      (game) =>
        isBacklogGame(game) &&
        !isProgressGame(game) &&
        !isCompletedGame(game)
    )
    .slice(0, 4);

  const heroGame = progressGames[0] || bibliotecaGames[0];
  const heroImage = heroGame
    ? readText(heroGame.image, "") || readText(heroGame.cardImage, "")
    : "";

  return (
    <main className="min-h-screen bg-[#050607] text-white">
      <Navbar />

      <div className="mx-auto w-full max-w-[1500px] px-5 py-5 lg:px-8">
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_310px]">
          <div className="min-w-0">
            <header className="relative overflow-hidden rounded-[14px] border border-white/[0.09] bg-[#090b0f]">
              {heroImage ? (
                <img
                  src={heroImage}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover opacity-[0.18] blur-[1px]"
                />
              ) : null}

              <div className="absolute inset-0 bg-[linear-gradient(90deg,#090b0f_8%,rgba(9,11,15,0.92)_48%,rgba(9,11,15,0.65)_100%)]" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_left,rgba(239,68,68,0.14),transparent_42%)]" />

              <div className="relative z-10 px-5 py-6 md:px-7">
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-red-400">
                  Biblioteca
                </p>

                <div className="mt-2 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
                  <div className="min-w-0">
                    <h1 className="text-[32px] font-black leading-none tracking-tight md:text-[40px]">
                      Jogos da Jornada
                    </h1>
                    <p className="mt-3 max-w-[650px] text-[11px] leading-relaxed text-white/45">
                      Todos os jogos da jornada em um só lugar. Acompanhe progresso,
                      conquistas, tempo jogado e o caminho até a Maestria.
                    </p>
                  </div>

                  <div className="grid shrink-0 grid-cols-4 gap-2">
                    <div className="min-w-[72px] rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5">
                      <p className="text-[8px] font-black uppercase tracking-wider text-white/30">Jogos</p>
                      <p className="mt-1 text-lg font-black text-white">{bibliotecaGames.length}</p>
                    </div>
                    <div className="min-w-[72px] rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5">
                      <p className="text-[8px] font-black uppercase tracking-wider text-white/30">Ativos</p>
                      <p className="mt-1 text-lg font-black text-pink-400">{progressCount}</p>
                    </div>
                    <div className="min-w-[72px] rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5">
                      <p className="text-[8px] font-black uppercase tracking-wider text-white/30">Finalizados</p>
                      <p className="mt-1 text-lg font-black text-emerald-400">{completedCount}</p>
                    </div>
                    <div className="min-w-[72px] rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5">
                      <p className="text-[8px] font-black uppercase tracking-wider text-white/30">Fila</p>
                      <p className="mt-1 text-lg font-black text-cyan-400">{backlogCount}</p>
                    </div>
                  </div>
                </div>
              </div>
            </header>

            <section className="mt-4 rounded-[14px] border border-white/[0.08] bg-[#090b0f]">
              <div className="flex flex-col gap-2.5 border-b border-white/[0.07] p-3 md:flex-row">
                <div className="relative min-w-0 flex-1">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[12px] text-white/25">
                    ⌕
                  </span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Buscar por nome do jogo..."
                    className="w-full rounded-xl border border-white/[0.08] bg-black/20 py-3 pl-10 pr-4 text-[11px] font-semibold text-white outline-none placeholder:text-white/25 focus:border-red-500/35"
                  />
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  {filters.map((filter) => {
                    const isActive = activeFilter === filter.value;

                    return (
                      <button
                        key={filter.value}
                        type="button"
                        onClick={() => handleFilterChange(filter.value)}
                        className={`rounded-xl border px-3.5 py-2.5 text-[10px] font-black transition ${
                          isActive
                            ? "border-red-500/40 bg-red-500/10 text-red-300"
                            : "border-white/[0.08] bg-white/[0.015] text-white/45 hover:border-red-500/25 hover:text-white"
                        }`}
                      >
                        {filter.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="px-4 pb-4 pt-3">
                {!isLoaded ? (
                  <div className="rounded-xl border border-white/[0.07] bg-black/20 p-8 text-center text-[11px] text-white/40">
                    Carregando biblioteca...
                  </div>
                ) : activeFilter === "all" ? (
                  progressGames.length + backlogGames.length + completedGames.length > 0 ? (
                    <div className="space-y-7">
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

                      <div id="jogos-finalizados">
                        <GameSection
                          eyebrow="Finalizados"
                          title="Jogos Finalizados"
                          description="Jogos que já tiveram a jornada concluída ou maestria final liberada."
                          games={completedGames}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-white/[0.07] bg-black/20 p-8 text-center text-[11px] text-white/40">
                      Nenhum jogo encontrado.
                    </div>
                  )
                ) : filteredGames.length === 0 ? (
                  <div className="rounded-xl border border-white/[0.07] bg-black/20 p-8 text-center text-[11px] text-white/40">
                    Nenhum jogo encontrado nesse filtro.
                  </div>
                ) : (
                  <div>
                    {filteredGames.map((game) => (
                      <GameCard key={game.slug} game={game} />
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-4">
            <SidebarPanel title="Resumo da Jornada">
              <SidebarMetric label="Tempo total" value={formatTotalMinutes(totalMinutes)} />
              <SidebarMetric
                label="Conquistas"
                value={`${totalAchievements}/${totalAchievementTargets}`}
              />
              <SidebarMetric
                label="Progresso geral"
                value={`${overallProgress}%`}
                accent="pink"
              />
            </SidebarPanel>

            <SidebarPanel title="Status dos Jogos">
              <StatusBar
                label="Em progresso"
                value={progressCount}
                total={bibliotecaGames.length}
                accent="pink"
              />
              <StatusBar
                label="Finalizados"
                value={completedCount}
                total={bibliotecaGames.length}
                accent="green"
              />
              <StatusBar
                label="Na fila"
                value={backlogCount}
                total={bibliotecaGames.length}
                accent="cyan"
              />
            </SidebarPanel>

            <SidebarPanel title="Próximos na Fila" accent="cyan">
              {nextBacklog.length === 0 ? (
                <p className="text-[10px] leading-relaxed text-white/35">
                  Nenhum jogo planejado para a próxima etapa da jornada.
                </p>
              ) : (
                <div className="space-y-3">
                  {nextBacklog.map((game, index) => {
                    const image =
                      readText(game.image, "") || readText(game.cardImage, "");

                    return (
                      <Link
                        key={game.slug}
                        href={`/games/${readText(game.slug, "")}`}
                        className="flex items-center gap-3 border-b border-white/[0.06] pb-3 last:border-b-0 last:pb-0"
                      >
                        <span className="w-4 shrink-0 text-center text-[10px] font-black text-cyan-400">
                          {index + 1}
                        </span>
                        <div className="h-10 w-8 shrink-0 overflow-hidden border border-white/10 bg-zinc-900">
                          <GameCoverImage src={image} title={readText(game.title, "Jogo")} />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[10px] font-black text-white">
                            {readText(game.title, "Jogo")}
                          </p>
                          <p className="mt-0.5 truncate text-[9px] text-white/30">
                            {getObjective(game)}
                          </p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </SidebarPanel>
          </aside>
        </div>
      </div>
    </main>
  );
}

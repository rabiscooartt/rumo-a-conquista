"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { type SiteGame, useSiteGames } from "@/lib/useSiteGames";
import { useSiteSagas } from "@/lib/useSiteSagas";

type FilterType = "all" | "trophies" | "badges";

type AchievementStorageState = {
  status?: string;
  rank?: string;
  date?: string;
  image?: string;
  unlockedAt?: string;
  completedAt?: string;
  updatedAt?: string;
  order?: number;
  unlockedOrder?: number;
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

type HistoryGame = SiteGame & {
  mastery?: string;
  achievementsList?: AchievementLike[];
  finalBadge?: {
    title?: string;
    icon?: string;
    image?: string;
  };
};

type HistoryEntry = {
  id: string;
  orderKey: string;
  type: "trophy" | "badge";
  title: string;
  description: string;
  gameTitle: string;
  gameSubtitle: string;
  gameSlug: string;
  icon: string;
  image: string;
  rank: "Bronze" | "Prata" | "Ouro" | "Diamante";
  unlockedOrder: number;
};

const filters: { label: string; value: FilterType }[] = [
  { label: "Tudo", value: "all" },
  { label: "Troféus", value: "trophies" },
  { label: "Insígnias", value: "badges" },
];

const ACHIEVEMENTS_UPDATED_EVENT = "rumo-a-conquista-achievements-updated";
const GAMES_UPDATED_EVENT = "rumo-a-conquista-games-updated";
const SAGAS_UPDATED_EVENT = "rumo-a-conquista-sagas-updated";

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

function readNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return numberValue;
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

function normalizeDate(date?: string) {
  if (!date) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(date)) {
    return date.slice(0, 10);
  }

  const [day, month, year] = date.split("/");

  if (!day || !month || !year) {
    return "";
  }

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function getDateTimeValue(date?: string) {
  if (!date) return 0;

  const directDate = new Date(date).getTime();

  if (Number.isFinite(directDate)) {
    return directDate;
  }

  const normalizedDate = normalizeDate(date);

  if (!normalizedDate) {
    return 0;
  }

  const parsedDate = new Date(`${normalizedDate}T00:00:00`).getTime();

  if (Number.isFinite(parsedDate)) {
    return parsedDate;
  }

  return 0;
}

function isCompletedStatus(status?: string) {
  const normalizedStatus = normalizeText(status);

  return (
    normalizedStatus === "completed" ||
    normalizedStatus === "concluido" ||
    normalizedStatus === "concluida" ||
    normalizedStatus === "desbloqueado" ||
    normalizedStatus === "desbloqueada"
  );
}

function isCompletedGame(game: HistoryGame) {
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

function getAchievementDescription(achievement: AchievementLike) {
  return readText(achievement.description, "Descrição ainda não definida.");
}

function normalizeRank(
  value?: string,
  trophy?: string
): HistoryEntry["rank"] {
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

function getRankIcon(rank: HistoryEntry["rank"]) {
  if (rank === "Diamante") {
    return "💎";
  }

  if (rank === "Ouro") {
    return "🥇";
  }

  if (rank === "Prata") {
    return "🥈";
  }

  return "🥉";
}

function getRankStyle(rank: HistoryEntry["rank"]) {
  if (rank === "Diamante") {
    return {
      row: "border-cyan-400/40 bg-cyan-500/20",
      badge: "border-cyan-300/40 bg-cyan-500/20 text-cyan-100",
      iconBox: "border-cyan-300/30 bg-cyan-500/10",
    };
  }

  if (rank === "Ouro") {
    return {
      row: "border-yellow-400/35 bg-yellow-500/20",
      badge: "border-yellow-300/40 bg-yellow-500/20 text-yellow-100",
      iconBox: "border-yellow-300/30 bg-yellow-500/10",
    };
  }

  if (rank === "Prata") {
    return {
      row: "border-white/20 bg-white/20",
      badge: "border-white/30 bg-white/15 text-white",
      iconBox: "border-white/20 bg-white/10",
    };
  }

  return {
    row: "border-orange-500/30 bg-orange-700/20",
    badge: "border-orange-300/30 bg-orange-500/15 text-orange-100",
    iconBox: "border-orange-300/25 bg-orange-500/10",
  };
}

function getFinalBadge(game: HistoryGame) {
  if (game.finalBadge) {
    return {
      title: readText(game.finalBadge.title, "Maestria Final"),
      icon: readText(game.finalBadge.icon, "💎"),
      image: readText(game.finalBadge.image, ""),
    };
  }

  return {
    title: "Maestria Final",
    icon: "💎",
    image: "",
  };
}

function getSagaGameSlugs(saga: {
  stages?: {
    gameSlugs?: string[];
  }[];
}) {
  if (!Array.isArray(saga.stages)) {
    return [];
  }

  return saga.stages.flatMap((stage) =>
    Array.isArray(stage.gameSlugs) ? stage.gameSlugs : []
  );
}

function makeHistoryOrderKey(
  gameSlug: string,
  type: HistoryEntry["type"],
  title: string
) {
  return `${gameSlug}-${type}-${normalizeText(title)}`;
}

function getManualStateIndex(
  manualStates: Record<string, AchievementStorageState>,
  title: string
) {
  const keys = Object.keys(manualStates);

  const exactIndex = keys.indexOf(title);

  if (exactIndex >= 0) {
    return exactIndex;
  }

  const normalizedTitle = normalizeText(title);

  return keys.findIndex((key) => normalizeText(key) === normalizedTitle);
}

function getAchievementUnlockOrder({
  manualState,
  manualStateIndex,
  achievement,
  achievementIndex,
  gameIndex,
  gamesCount,
}: {
  manualState?: AchievementStorageState;
  manualStateIndex: number;
  achievement: AchievementLike;
  achievementIndex: number;
  gameIndex: number;
  gamesCount: number;
}) {
  const explicitOrder =
    readNumber(manualState?.unlockedOrder, 0) || readNumber(manualState?.order, 0);

  if (explicitOrder > 0) {
    return explicitOrder * 1000000;
  }

  const unlockedDate =
    readText(manualState?.completedAt, "") ||
    readText(manualState?.unlockedAt, "") ||
    readText(manualState?.updatedAt, "") ||
    readText(manualState?.date, "") ||
    readText(achievement.earnedDate, "");

  const dateTime = getDateTimeValue(unlockedDate);

  if (dateTime > 0) {
    const sameDayOrder =
      manualStateIndex >= 0 ? manualStateIndex : 10000 - achievementIndex;

    return dateTime * 100000 + sameDayOrder;
  }

  const gameFallbackOrder = (gamesCount - gameIndex) * 100000;
  const achievementFallbackOrder =
    manualStateIndex >= 0 ? manualStateIndex : 10000 - achievementIndex;

  return gameFallbackOrder + achievementFallbackOrder;
}

function EntryIcon({ entry }: { entry: HistoryEntry }) {
  const [hasError, setHasError] = useState(false);
  const style = getRankStyle(entry.rank);

  useEffect(() => {
    setHasError(false);
  }, [entry.image]);

  if (entry.image && !hasError) {
    return (
      <div
        className={`flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border ${style.iconBox}`}
      >
        <img
          key={entry.image}
          src={entry.image}
          alt={entry.title}
          className="h-full w-full object-cover"
          onError={() => setHasError(true)}
        />
      </div>
    );
  }

  return (
    <div
      className={`flex h-14 w-14 items-center justify-center rounded-xl border text-2xl ${style.iconBox}`}
    >
      {entry.icon || getRankIcon(entry.rank)}
    </div>
  );
}

function buildHistoryEntries(gamesList: HistoryGame[]) {
  const entries: HistoryEntry[] = [];
  const gamesCount = gamesList.length;

  gamesList.forEach((game, gameIndex) => {
    const gameSlug = readText(game.slug, "");
    const gameTitle = readText(game.title, "Jogo");

    if (!gameSlug) {
      return;
    }

    const activeAchievements: AchievementLike[] = Array.isArray(
      game.achievementsList
    )
      ? game.achievementsList
      : [];

    const manualStates = readLocalJson<Record<string, AchievementStorageState>>(
      `rumo-a-conquista-achievements-${gameSlug}`,
      {}
    );

    const hiddenAchievementTitles = readLocalJson<string[]>(
      `rumo-a-conquista-hidden-achievements-${gameSlug}`,
      []
    );

    let hasManualMasteryEntry = false;
    const gameUnlockedOrders: number[] = [];

    activeAchievements.forEach((achievement, achievementIndex) => {
      const title = getAchievementTitle(achievement, achievementIndex);

      if (hiddenAchievementTitles.includes(title)) {
        return;
      }

      const manualState = manualStates[title];
      const status = manualState?.status ?? achievement.status;

      if (!isCompletedStatus(status)) {
        return;
      }

      const manualStateIndex = getManualStateIndex(manualStates, title);

      const rank = normalizeRank(
        manualState?.rank ?? achievement.rank ?? achievement.difficulty,
        achievement.trophy ?? achievement.icon
      );

      if (rank === "Diamante" || normalizeText(title).includes("maestria")) {
        hasManualMasteryEntry = true;
      }

      const icon =
        readText(achievement.icon, "") ||
        readText(achievement.trophy, "") ||
        getRankIcon(rank);

      const image = manualState?.image || readText(achievement.image, "");

      const unlockedOrder = getAchievementUnlockOrder({
        manualState,
        manualStateIndex,
        achievement,
        achievementIndex,
        gameIndex,
        gamesCount,
      });

      gameUnlockedOrders.push(unlockedOrder);

      entries.push({
        id: `${gameSlug}-${title}-${achievementIndex}`,
        orderKey: makeHistoryOrderKey(gameSlug, "trophy", title),
        type: "trophy",
        title,
        description: getAchievementDescription(achievement),
        gameTitle,
        gameSubtitle: readText(game.subtitle, ""),
        gameSlug,
        icon,
        image,
        rank,
        unlockedOrder,
      });
    });

    if (isCompletedGame(game) && !hasManualMasteryEntry) {
      const finalBadge = getFinalBadge(game);

      const fallbackOrder = (gamesCount - gameIndex) * 100000;
      const latestGameOrder =
        gameUnlockedOrders.length > 0
          ? Math.max(...gameUnlockedOrders)
          : fallbackOrder;

      entries.push({
        id: `${gameSlug}-final-badge`,
        orderKey: makeHistoryOrderKey(gameSlug, "badge", finalBadge.title),
        type: "badge",
        title: finalBadge.title,
        description: "Insígnia final conquistada nesta jornada.",
        gameTitle,
        gameSubtitle: readText(game.subtitle, ""),
        gameSlug,
        icon: finalBadge.icon || getRankIcon("Diamante"),
        image: finalBadge.image,
        rank: "Diamante",
        unlockedOrder: latestGameOrder + 1,
      });
    }
  });

  return entries.sort((a, b) => {
    if (b.unlockedOrder !== a.unlockedOrder) {
      return b.unlockedOrder - a.unlockedOrder;
    }

    return a.title.localeCompare(b.title);
  });
}

function SummaryCard({
  icon,
  label,
  value,
  accent = "red",
}: {
  icon: string;
  label: string;
  value: string | number;
  accent?: "red" | "cyan" | "purple";
}) {
  const accentClass =
    accent === "cyan"
      ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-200"
      : accent === "purple"
      ? "border-purple-400/30 bg-purple-500/10 text-purple-200"
      : "border-red-500/30 bg-red-500/10 text-red-100";

  return (
    <div className={`rounded-2xl border px-6 py-5 ${accentClass}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/40">
        {label}
      </p>

      <div className="mt-2 flex items-center gap-3">
        <span className="text-3xl">{icon}</span>

        <p className="text-4xl font-black text-white">{value}</p>
      </div>
    </div>
  );
}

export default function HistoricoPage() {
  const { gamesList, gamesMap, isLoaded: gamesLoaded } = useSiteGames();
  const { sagasList, isLoaded: sagasLoaded } = useSiteSagas();

  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    function refreshData() {
      setRefreshKey((current) => current + 1);
    }

    refreshData();

    window.addEventListener(ACHIEVEMENTS_UPDATED_EVENT, refreshData);
    window.addEventListener(GAMES_UPDATED_EVENT, refreshData);
    window.addEventListener(SAGAS_UPDATED_EVENT, refreshData);
    window.addEventListener("storage", refreshData);
    window.addEventListener("focus", refreshData);

    return () => {
      window.removeEventListener(ACHIEVEMENTS_UPDATED_EVENT, refreshData);
      window.removeEventListener(GAMES_UPDATED_EVENT, refreshData);
      window.removeEventListener(SAGAS_UPDATED_EVENT, refreshData);
      window.removeEventListener("storage", refreshData);
      window.removeEventListener("focus", refreshData);
    };
  }, []);

  const entries = useMemo(() => {
    return buildHistoryEntries(gamesList as HistoryGame[]);
  }, [gamesList, refreshKey]);

  const filteredEntries = useMemo(() => {
    if (activeFilter === "trophies") {
      return entries.filter((entry) => entry.type === "trophy");
    }

    if (activeFilter === "badges") {
      return entries.filter((entry) => entry.type === "badge");
    }

    return entries;
  }, [activeFilter, entries]);

  const completedGames = useMemo(() => {
    return (gamesList as HistoryGame[]).filter((game) =>
      isCompletedGame(game)
    ).length;
  }, [gamesList, refreshKey]);

  const completedSagas = useMemo(() => {
    return sagasList.filter((saga) => {
      const gameSlugs = getSagaGameSlugs(saga);

      if (gameSlugs.length === 0) {
        return false;
      }

      return gameSlugs.every((slug) => {
        const game = gamesMap[slug] as HistoryGame | undefined;

        if (!game) {
          return false;
        }

        return isCompletedGame(game);
      });
    }).length;
  }, [gamesMap, sagasList, refreshKey]);

  const trophyCount = entries.filter((entry) => entry.type === "trophy").length;
  const badgeCount = entries.filter((entry) => entry.type === "badge").length;

  const isLoaded = gamesLoaded && sagasLoaded;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0b1624_0%,#050505_45%,#020202_100%)] text-white">
      <Navbar />

      <section className="mx-auto w-full max-w-[1500px] px-8 py-10">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <Link
            href="/"
            className="inline-flex w-fit rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-black text-red-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
          >
            ← Voltar para Home
          </Link>

          <div className="flex flex-wrap gap-3">
            {filters.map((filter) => {
              const isActive = activeFilter === filter.value;

              return (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setActiveFilter(filter.value)}
                  className={`rounded-xl border px-6 py-3 text-sm font-black transition ${
                    isActive
                      ? "border-red-500/40 bg-red-500/15 text-red-100"
                      : "border-white/10 bg-white/[0.03] text-white/60 hover:border-red-500/30 hover:bg-red-500/10 hover:text-white"
                  }`}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
        </div>

        <header className="mt-8 overflow-hidden rounded-[32px] border border-white/10 bg-zinc-950/80 shadow-xl">
          <div className="relative p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.18),transparent_35%),radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_32%)]" />

            <div className="relative z-10 flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
                  Histórico
                </p>

                <h1 className="mt-3 text-5xl font-black text-white">
                  Troféus Recentes
                </h1>

                <p className="mt-3 max-w-[760px] text-sm leading-relaxed text-white/50">
                  Lista das conquistas desbloqueadas na jornada. As conquistas
                  mais recentes aparecem primeiro.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <SummaryCard
                  icon="🏆"
                  label="Conquistas"
                  value={isLoaded ? trophyCount : "..."}
                  accent="red"
                />

                <SummaryCard
                  icon="💎"
                  label="Maestrias"
                  value={isLoaded ? completedGames : "..."}
                  accent="cyan"
                />

                <SummaryCard
                  icon="🌟"
                  label="Emblemas"
                  value={isLoaded ? completedSagas : "..."}
                  accent="purple"
                />
              </div>
            </div>
          </div>
        </header>

        <section className="mt-8 overflow-hidden rounded-[24px] border border-white/10 bg-zinc-950/80 shadow-xl">
          <div className="hidden grid-cols-[70px_1fr_130px_90px] border-b border-white/10 bg-black/40 px-5 py-3 text-[10px] font-black uppercase tracking-[0.25em] text-white/35 md:grid">
            <p>Ícone</p>
            <p>Conquista</p>
            <p className="text-right">Tipo</p>
            <p className="text-right">Rank</p>
          </div>

          {!isLoaded ? (
            <div className="p-8 text-sm text-white/45">
              Carregando histórico...
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="p-8 text-sm text-white/45">
              Nenhuma conquista encontrada nesse filtro.
            </div>
          ) : (
            <div>
              {filteredEntries.map((entry) => {
                const rankStyle = getRankStyle(entry.rank);

                return (
                  <Link
                    key={entry.id}
                    href={`/games/${entry.gameSlug}`}
                    className={`grid gap-4 border-b px-5 py-4 transition last:border-b-0 hover:brightness-125 md:grid-cols-[70px_1fr_130px_90px] md:items-center ${rankStyle.row}`}
                  >
                    <EntryIcon entry={entry} />

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-black text-white">
                          {entry.title}
                        </h2>

                        <span
                          className={`rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${rankStyle.badge}`}
                        >
                          {entry.rank}
                        </span>
                      </div>

                      <p className="mt-1 text-sm text-white/60">
                        {entry.description}
                      </p>

                      <p className="mt-1 text-xs font-bold text-blue-300">
                        {entry.gameTitle}
                        {entry.gameSubtitle && (
                          <span className="font-medium text-white/35">
                            {" "}
                            • {entry.gameSubtitle}
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="md:text-right">
                      <span className="rounded-md bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white/80">
                        {entry.type === "badge" ? "Insígnia" : "Troféu"}
                      </span>
                    </div>

                    <div className="md:flex md:justify-end">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-black/30 text-2xl">
                        {getRankIcon(entry.rank)}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
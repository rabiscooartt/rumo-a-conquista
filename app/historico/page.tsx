"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import JourneyShortcuts from "@/components/JourneyShortcuts";
import { type SiteGame, useSiteGames } from "@/lib/useSiteGames";
import { useSiteSagas } from "@/lib/useSiteSagas";
import { fallbackToOriginal, homeImageSrc } from "@/lib/homeImages";

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

// Troféus originais do site (os mesmos da página de cada jogo) para a coluna de rank.
const RANK_TROPHY_IMAGE: Record<HistoryEntry["rank"], string> = {
  Diamante: "/images/trophies/maestria.png",
  Ouro: "/images/trophies/ouro.png",
  Prata: "/images/trophies/prata.png",
  Bronze: "/images/trophies/bronze.png",
};

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
  // O Supabase é a fonte oficial da data de desbloqueio.
  // Priorizamos earnedDate/earned_at antes de qualquer estado legado
  // do navegador para que o Histórico siga a ordem real de desbloqueio.
  const remoteUnlockedDate =
    readText(achievement.earnedDate, "") ||
    readText(achievement.earned_at, "") ||
    readText(achievement.earnedAt, "") ||
    readText(achievement.completedAt, "");

  const remoteDateTime = getDateTimeValue(remoteUnlockedDate);

  if (remoteDateTime > 0) {
    // Mantém o timestamp como fator principal. O pequeno desempate evita
    // colisões quando duas conquistas têm exatamente o mesmo timestamp.
    const sameTimestampOrder = Math.max(0, 1000 - achievementIndex);
    return remoteDateTime * 10 + sameTimestampOrder;
  }

  // Compatibilidade apenas para registros antigos que ainda não possuem
  // earned_at/earnedDate no Supabase.
  const legacyUnlockedDate =
    readText(manualState?.completedAt, "") ||
    readText(manualState?.unlockedAt, "") ||
    readText(manualState?.date, "");

  const legacyDateTime = getDateTimeValue(legacyUnlockedDate);

  if (legacyDateTime > 0) {
    const sameDayOrder =
      manualStateIndex >= 0 ? manualStateIndex : 1000 - achievementIndex;

    return legacyDateTime * 10 + sameDayOrder;
  }

  const explicitOrder =
    readNumber(manualState?.unlockedOrder, 0) ||
    readNumber(manualState?.order, 0);

  if (explicitOrder > 0) {
    return explicitOrder;
  }

  const gameFallbackOrder = (gamesCount - gameIndex) * 100000;
  const achievementFallbackOrder =
    manualStateIndex >= 0 ? manualStateIndex : 1000 - achievementIndex;

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
        className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border md:h-14 md:w-14 ${style.iconBox}`}
      >
        <img
          key={entry.image}
          src={homeImageSrc(entry.image)}
          alt={entry.title}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={fallbackToOriginal(entry.image, () => setHasError(true))}
        />
      </div>
    );
  }

  return (
    <div
      className={`flex h-12 w-12 items-center justify-center rounded-xl border text-2xl md:h-14 md:w-14 ${style.iconBox}`}
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
      const status = readText(achievement.status, "") || manualState?.status;

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

  const filterCounts: Record<FilterType, number> = {
    all: entries.length,
    trophies: trophyCount,
    badges: badgeCount,
  };

  return (
    <main className="min-h-screen bg-[#050608] text-white">
      <Navbar />

      <div className="mx-auto grid w-full max-w-[1620px] grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden min-h-[calc(100vh-74px)] border-r border-white/[0.08] px-4 py-5 lg:block">
          <div className="sticky top-20">
            <div className="border-t border-white/[0.08] pt-5">
              <div className="flex items-center gap-2 text-[12px] font-black uppercase tracking-[0.12em] text-white/75">
                <span className="text-red-500">✣</span>
                Histórico
              </div>
            </div>

            <nav aria-label="Filtrar histórico" className="mt-6 border-t border-white/[0.08] pt-5">
              <p className="text-[8px] font-black uppercase tracking-[0.20em] text-white/30">
                Filtro
              </p>

              <div className="mt-3 space-y-1">
                {filters.map((filter) => {
                  const isActive = activeFilter === filter.value;

                  return (
                    <button
                      key={filter.value}
                      type="button"
                      onClick={() => setActiveFilter(filter.value)}
                      aria-pressed={isActive}
                      className={`flex min-h-10 w-full items-center justify-between rounded-lg border px-3 text-left text-[12px] font-bold transition ${
                        isActive
                          ? "border-red-500/30 bg-red-500/10 text-white"
                          : "border-transparent text-white/60 hover:bg-white/[0.04] hover:text-white"
                      }`}
                    >
                      {filter.label}
                      <span className={`text-[11px] font-black ${isActive ? "text-red-300" : "text-white/35"}`}>
                        {isLoaded ? filterCounts[filter.value] : "…"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </nav>
            <JourneyShortcuts current="/historico" />
          </div>
        </aside>

        <div className="min-w-0 px-4 py-5 md:px-5">
          <header className="relative overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#090b0f]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_0%,rgba(239,68,68,0.16),transparent_45%),radial-gradient(circle_at_100%_100%,rgba(34,211,238,0.07),transparent_40%)]" />

            <div className="relative flex flex-col gap-6 px-5 py-6 sm:px-7 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-[460px]">
                <p className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.22em] text-red-500">
                  <span className="text-[10px] leading-none">✣</span>
                  Sua jornada em troféus
                </p>

                <h1 className="mt-2 text-[34px] font-black uppercase leading-none tracking-tight text-white sm:text-[40px]">
                  Histórico
                </h1>

                <p className="mt-3 text-[13px] font-medium leading-[1.5] text-white/70">
                  Todas as conquistas desbloqueadas na jornada, das mais recentes
                  às mais antigas.
                </p>
              </div>

              <dl className="grid grid-cols-3 divide-x divide-white/[0.08] rounded-xl border border-white/[0.08] bg-black/30 lg:min-w-[420px]">
                {[
                  { label: "Conquistas", value: trophyCount, tone: "text-red-400" },
                  { label: "Maestrias", value: completedGames, tone: "text-cyan-300" },
                  { label: "Emblemas", value: completedSagas, tone: "text-amber-300" },
                ].map((metric) => (
                  <div key={metric.label} className="min-w-0 px-3 py-3.5 sm:px-5">
                    <dt className={`truncate text-[9px] font-black uppercase tracking-[0.04em] sm:tracking-[0.18em] ${metric.tone}`}>
                      {metric.label}
                    </dt>
                    <dd className="mt-1.5 text-[26px] font-black leading-none text-white sm:text-[30px]">
                      {isLoaded ? metric.value : "…"}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </header>

          <section className="mt-4 overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#090b0f]">
            <div className="flex gap-1 overflow-x-auto border-b border-white/[0.08] p-2 lg:hidden" role="group" aria-label="Filtrar histórico">
              {filters.map((filter) => {
                const isActive = activeFilter === filter.value;

                return (
                  <button
                    key={filter.value}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setActiveFilter(filter.value)}
                    className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 text-[12px] font-bold transition ${
                      isActive
                        ? "bg-red-500/10 text-white shadow-[inset_0_0_0_1px_rgba(239,68,68,0.3)]"
                        : "text-white/55 hover:text-white"
                    }`}
                  >
                    {filter.label}
                    <span className={isActive ? "text-red-300" : "text-white/35"}>
                      {isLoaded ? filterCounts[filter.value] : "…"}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="hidden grid-cols-[64px_minmax(0,1fr)_110px_64px] gap-4 border-b border-white/[0.08] px-5 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-white/35 md:grid">
              <p>Ícone</p>
              <p>Conquista</p>
              <p className="text-right">Tipo</p>
              <p className="text-right">Rank</p>
            </div>

            {!isLoaded ? (
              <div className="p-8 text-sm text-white/45" role="status">
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
                      className={`grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 border-b px-4 py-3.5 transition last:border-b-0 hover:brightness-125 sm:px-5 md:grid-cols-[64px_minmax(0,1fr)_110px_64px] md:gap-4 ${rankStyle.row}`}
                    >
                      <EntryIcon entry={entry} />

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <h2 className="min-w-0 text-[15px] font-black leading-tight text-white sm:text-base">
                            {entry.title}
                          </h2>

                          <span
                            className={`rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] ${rankStyle.badge}`}
                          >
                            {entry.rank}
                          </span>
                        </div>

                        <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-white/60">
                          {entry.description}
                        </p>

                        <p className="mt-1 truncate text-[12px] font-bold text-sky-300/90">
                          {entry.gameTitle}
                          {entry.gameSubtitle && (
                            <span className="font-medium text-white/35">
                              {" "}
                              • {entry.gameSubtitle}
                            </span>
                          )}
                        </p>
                      </div>

                      <div className="hidden md:block md:text-right">
                        <span className="rounded-md bg-white/[0.07] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white/75">
                          {entry.type === "badge" ? "Insígnia" : "Troféu"}
                        </span>
                      </div>

                      <div className="flex justify-end">
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-black/30"
                          title={entry.rank}
                        >
                          <img src={homeImageSrc(RANK_TROPHY_IMAGE[entry.rank])} alt={entry.rank} className="h-7 w-7 object-contain" />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

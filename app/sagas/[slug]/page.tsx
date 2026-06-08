"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import { type SiteGame, useSiteGames } from "@/lib/useSiteGames";
import { type SiteSaga, useSiteSagas } from "@/lib/useSiteSagas";

type Rank = "Bronze" | "Prata" | "Ouro" | "Diamante";
type AchievementStatus = "locked" | "progress" | "completed";

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

type ManualAchievementState = {
  rank?: Rank;
  status?: AchievementStatus | string;
  date?: string;
  image?: string;
};

type SagaGame = SiteGame & {
  slug?: string;
  title?: string;
  subtitle?: string;
  image?: string;
  cardImage?: string;
  hours?: string | number;
  progress?: string | number;
  achievementsList?: AchievementLike[];
};

type GameProgress = {
  completedCount: number;
  totalCount: number;
  progress: number;
  isCompleted: boolean;
  rankCounts: Record<Rank, number>;
  finalAchievementUnlocked: boolean;
};

type AccentTheme = {
  border: string;
  text: string;
  bg: string;
  progress: string;
  row: string;
  glow: string;
};

const ACHIEVEMENTS_UPDATED_EVENT = "rumo-a-conquista-achievements-updated";
const GAMES_UPDATED_EVENT = "rumo-a-conquista-games-updated";
const SAGAS_UPDATED_EVENT = "rumo-a-conquista-sagas-updated";

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

function normalizeText(text?: string) {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeStatus(status?: string): AchievementStatus {
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

function normalizeDate(date?: string) {
  if (!date) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }

  const [day, month, year] = date.split("/");

  if (!day || !month || !year) {
    return "";
  }

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
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

function getAccentTheme(accent: string): AccentTheme {
  if (accent === "cyan") {
    return {
      border: "border-cyan-400/30",
      text: "text-cyan-300",
      bg: "bg-cyan-500/10",
      progress: "bg-cyan-400",
      row: "hover:border-cyan-400/35",
      glow: "shadow-[0_0_35px_rgba(34,211,238,0.12)]",
    };
  }

  if (accent === "yellow") {
    return {
      border: "border-yellow-400/30",
      text: "text-yellow-300",
      bg: "bg-yellow-500/10",
      progress: "bg-yellow-400",
      row: "hover:border-yellow-400/35",
      glow: "shadow-[0_0_35px_rgba(250,204,21,0.12)]",
    };
  }

  if (accent === "purple") {
    return {
      border: "border-purple-400/30",
      text: "text-purple-300",
      bg: "bg-purple-500/10",
      progress: "bg-purple-400",
      row: "hover:border-purple-400/35",
      glow: "shadow-[0_0_35px_rgba(168,85,247,0.12)]",
    };
  }

  if (accent === "emerald") {
    return {
      border: "border-emerald-400/30",
      text: "text-emerald-300",
      bg: "bg-emerald-500/10",
      progress: "bg-emerald-400",
      row: "hover:border-emerald-400/35",
      glow: "shadow-[0_0_35px_rgba(52,211,153,0.12)]",
    };
  }

  return {
    border: "border-red-500/30",
    text: "text-red-300",
    bg: "bg-red-500/10",
    progress: "bg-red-500",
    row: "hover:border-red-500/35",
    glow: "shadow-[0_0_35px_rgba(239,68,68,0.12)]",
  };
}

function getDefaultRank(achievement: AchievementLike): Rank {
  const difficulty = normalizeText(
    readText(achievement.difficulty, readText(achievement.rank, ""))
  );

  const trophy = readText(achievement.trophy, readText(achievement.icon, ""));

  if (difficulty === "extrema" || difficulty === "diamante") return "Diamante";
  if (difficulty === "dificil" || difficulty === "ouro") return "Ouro";
  if (difficulty === "media" || difficulty === "prata") return "Prata";

  if (trophy.includes("💎")) return "Diamante";
  if (trophy.includes("🥇") || trophy.includes("🏆")) return "Ouro";
  if (trophy.includes("🥈")) return "Prata";

  return "Bronze";
}

function getRankIcon(rank: Rank) {
  if (rank === "Diamante") return "💎";
  if (rank === "Ouro") return "🥇";
  if (rank === "Prata") return "🥈";

  return "🥉";
}

function getAchievementTitle(achievement: AchievementLike, index: number) {
  return readText(achievement.title, `Conquista ${index + 1}`);
}

function getAchievementDefaultState(
  achievement: AchievementLike
): ManualAchievementState {
  return {
    rank: getDefaultRank(achievement),
    status: normalizeStatus(achievement.status),
    date: normalizeDate(achievement.earnedDate),
    image: readText(achievement.image, ""),
  };
}

function isMasteryAchievement(achievement: AchievementLike, rank: Rank) {
  const title = normalizeText(readText(achievement.title, ""));

  return (
    rank === "Diamante" ||
    title.includes("maestria") ||
    title.includes("mastery")
  );
}

function getVisibleAchievements(gameSlug: string, game: SagaGame) {
  const baseAchievements = Array.isArray(game.achievementsList)
    ? game.achievementsList
    : [];

  const hiddenAchievementTitles = readLocalJson<string[]>(
    `rumo-a-conquista-hidden-achievements-${gameSlug}`,
    []
  );

  const customAchievements = readLocalJson<AchievementLike[]>(
    `rumo-a-conquista-custom-achievements-${gameSlug}`,
    []
  );

  const visibleBaseAchievements = baseAchievements.filter(
    (achievement, index) => {
      const title = getAchievementTitle(achievement, index);

      return title && !hiddenAchievementTitles.includes(title);
    }
  );

  const visibleCustomAchievements = customAchievements.filter(
    (achievement, index) => {
      const title = getAchievementTitle(achievement, index);

      return title && !hiddenAchievementTitles.includes(title);
    }
  );

  return [...visibleBaseAchievements, ...visibleCustomAchievements];
}

function createDefaultStates(achievements: AchievementLike[]) {
  return achievements.reduce<Record<string, ManualAchievementState>>(
    (acc, achievement, index) => {
      const title = getAchievementTitle(achievement, index);

      acc[title] = getAchievementDefaultState(achievement);

      return acc;
    },
    {}
  );
}

function getGameProgress(
  gameSlug: string,
  game: SagaGame,
  manualStatesByGame: Record<string, Record<string, ManualAchievementState>>
): GameProgress {
  const achievements = getVisibleAchievements(gameSlug, game);
  const defaultStates = createDefaultStates(achievements);
  const states = manualStatesByGame[gameSlug] ?? defaultStates;

  const rankCounts: Record<Rank, number> = {
    Bronze: 0,
    Prata: 0,
    Ouro: 0,
    Diamante: 0,
  };

  let completedCount = 0;
  let finalAchievementUnlocked = false;

  achievements.forEach((achievement, index) => {
    const title = getAchievementTitle(achievement, index);
    const state = states[title] ?? defaultStates[title];
    const status = normalizeStatus(readText(state?.status, ""));

    if (status !== "completed") {
      return;
    }

    const rank = state?.rank ?? getDefaultRank(achievement);

    completedCount += 1;
    rankCounts[rank] += 1;

    if (isMasteryAchievement(achievement, rank)) {
      finalAchievementUnlocked = true;
    }
  });

  const totalCount = achievements.length;

  const progressFromAchievements =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const progress =
    totalCount > 0
      ? progressFromAchievements
      : Math.min(100, Math.max(0, readNumber(game.progress, 0)));

  const isCompleted =
    totalCount > 0
      ? completedCount === totalCount
      : readNumber(game.progress, 0) >= 100;

  return {
    completedCount,
    totalCount,
    progress,
    isCompleted,
    rankCounts,
    finalAchievementUnlocked,
  };
}

function formatHours(hours?: string | number) {
  if (hours === undefined || hours === null || hours === "") {
    return "0h";
  }

  const hoursText = String(hours);

  if (hoursText.toLowerCase().includes("h")) {
    return hoursText;
  }

  return `${hoursText}h`;
}

function StatusBadge({
  progress,
  isCompleted,
}: {
  progress: number;
  isCompleted: boolean;
}) {
  if (isCompleted) {
    return (
      <span className="rounded border border-emerald-400/30 bg-emerald-500/15 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-300">
        100%
      </span>
    );
  }

  if (progress > 0) {
    return (
      <span className="rounded border border-red-500/30 bg-red-500/15 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-red-200">
        {progress}%
      </span>
    );
  }

  return (
    <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white/40">
      0%
    </span>
  );
}

function FinalEmblemIcon({ unlocked }: { unlocked: boolean }) {
  return (
    <div className="flex h-16 min-w-[82px] items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/45 px-3 shadow-[0_0_18px_rgba(0,0,0,0.35)]">
      <span className={`text-3xl ${unlocked ? "" : "opacity-30 grayscale"}`}>
        💎
      </span>
    </div>
  );
}

function RankIcon({
  icon,
  value,
  dimmed,
}: {
  icon: string;
  value: number;
  dimmed?: boolean;
}) {
  return (
    <div className="flex min-w-[72px] items-center justify-center gap-2 border-l border-white/10 px-4">
      <span className={`text-3xl ${dimmed ? "opacity-35 grayscale" : ""}`}>
        {icon}
      </span>

      <span className="text-base font-black text-white">{value}</span>
    </div>
  );
}

function TrophyTotalIcon({ totalCount }: { totalCount: number }) {
  return (
    <div className="flex min-w-[86px] items-center justify-center gap-2 border-l border-white/10 px-4">
      <span className="text-3xl">🏆</span>
      <span className="text-base font-black text-white">{totalCount}</span>
    </div>
  );
}

function SagaBadgeImage({
  src,
  alt,
  fallbackIcon,
}: {
  src?: string;
  alt: string;
  fallbackIcon: string;
}) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  if (!src || hasError) {
    return (
      <div className="flex h-full w-full items-center justify-center text-7xl">
        {fallbackIcon}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className="h-full w-full scale-[1.08] object-contain"
      onError={() => setHasError(true)}
    />
  );
}

function getSagaGameSlugs(saga: SiteSaga) {
  return Array.from(
    new Set(saga.stages.flatMap((stage) => stage.gameSlugs))
  );
}

export default function SagaDetailPage() {
  const params = useParams();
  const rawSlug = params?.slug;
  const sagaSlug = Array.isArray(rawSlug) ? rawSlug[0] : String(rawSlug ?? "");

  const { sagasMap, isLoaded: sagasLoaded } = useSiteSagas();
  const {
    gamesMap,
    isLoaded: gamesLoaded,
  } = useSiteGames();

  const saga = sagasMap[sagaSlug];
  const theme = getAccentTheme(String(saga?.accent ?? "red"));

  const [manualStatesByGame, setManualStatesByGame] = useState<
    Record<string, Record<string, ManualAchievementState>>
  >({});

  const sagaGameSlugs = useMemo(() => {
    if (!saga) return [];

    return getSagaGameSlugs(saga);
  }, [saga]);

  const loadStates = useCallback(() => {
    const loadedStates: Record<string, Record<string, ManualAchievementState>> =
      {};

    sagaGameSlugs.forEach((gameSlug) => {
      const game = gamesMap[gameSlug] as SagaGame | undefined;

      if (!game) return;

      const achievements = getVisibleAchievements(gameSlug, game);
      const defaultStates = createDefaultStates(achievements);
      const savedStates = readLocalJson<Record<string, ManualAchievementState>>(
        `rumo-a-conquista-achievements-${gameSlug}`,
        {}
      );

      loadedStates[gameSlug] = {
        ...defaultStates,
        ...savedStates,
      };
    });

    setManualStatesByGame(loadedStates);
  }, [gamesMap, sagaGameSlugs]);

  useEffect(() => {
    loadStates();

    window.addEventListener(ACHIEVEMENTS_UPDATED_EVENT, loadStates);
    window.addEventListener(GAMES_UPDATED_EVENT, loadStates);
    window.addEventListener(SAGAS_UPDATED_EVENT, loadStates);
    window.addEventListener("storage", loadStates);
    window.addEventListener("focus", loadStates);

    return () => {
      window.removeEventListener(ACHIEVEMENTS_UPDATED_EVENT, loadStates);
      window.removeEventListener(GAMES_UPDATED_EVENT, loadStates);
      window.removeEventListener(SAGAS_UPDATED_EVENT, loadStates);
      window.removeEventListener("storage", loadStates);
      window.removeEventListener("focus", loadStates);
    };
  }, [loadStates]);

  const isLoaded = sagasLoaded && gamesLoaded;

  const gameProgressList = useMemo(() => {
    if (!saga) return [];

    return sagaGameSlugs
      .map((gameSlug) => {
        const game = gamesMap[gameSlug] as SagaGame | undefined;

        if (!game) return null;

        return {
          gameSlug,
          game,
          progress: getGameProgress(gameSlug, game, manualStatesByGame),
        };
      })
      .filter(
        (
          item
        ): item is {
          gameSlug: string;
          game: SagaGame;
          progress: GameProgress;
        } => Boolean(item)
      );
  }, [gamesMap, manualStatesByGame, saga, sagaGameSlugs]);

  const completedGames = gameProgressList.filter(
    (item) => item.progress.isCompleted
  ).length;

  const totalGames = gameProgressList.length;

  const completedAchievements = gameProgressList.reduce(
    (acc, item) => acc + item.progress.completedCount,
    0
  );

  const totalAchievements = gameProgressList.reduce(
    (acc, item) => acc + item.progress.totalCount,
    0
  );

  const sagaProgress =
    totalAchievements > 0
      ? Math.round((completedAchievements / totalAchievements) * 100)
      : totalGames > 0
      ? Math.round((completedGames / totalGames) * 100)
      : 0;

  const isSagaCompleted = totalGames > 0 && completedGames === totalGames;

  if (!isLoaded) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0b1624_0%,#050505_45%,#020202_100%)] text-white">
        <Navbar />

        <section className="mx-auto max-w-[1200px] px-8 py-16">
          <Link
            href="/sagas"
            className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-black text-red-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
          >
            ← Voltar para Sagas
          </Link>

          <div className="mt-10 rounded-[24px] border border-white/10 bg-zinc-950/80 p-8 text-white/50">
            Carregando saga...
          </div>
        </section>
      </main>
    );
  }

  if (!saga) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0b1624_0%,#050505_45%,#020202_100%)] text-white">
        <Navbar />

        <section className="mx-auto max-w-[1200px] px-8 py-16">
          <Link
            href="/sagas"
            className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-black text-red-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
          >
            ← Voltar para Sagas
          </Link>

          <h1 className="mt-10 text-5xl font-black">Saga não encontrada</h1>

          <p className="mt-4 text-white/50">
            Essa saga ainda não foi cadastrada ou foi removida.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0b1624_0%,#050505_45%,#020202_100%)] text-white">
      <Navbar />

      <section className="mx-auto w-full max-w-[1500px] px-8 py-8">
        <Link
          href="/sagas"
          className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-black text-red-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
        >
          ← Voltar para Sagas
        </Link>

        <header
          className={`mt-8 overflow-hidden rounded-[32px] border bg-zinc-950/80 shadow-xl ${theme.border} ${theme.glow}`}
        >
          <div className="relative min-h-[300px] p-8">
            {saga.coverImage ? (
              <img
                src={saga.coverImage}
                alt={saga.title}
                className="absolute inset-0 h-full w-full object-cover opacity-20"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            ) : null}

            <div className="absolute inset-0 bg-gradient-to-r from-black via-black/85 to-black/45" />

            <div className="relative z-10 flex min-h-[240px] flex-col justify-between gap-8 lg:flex-row lg:items-end">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-end">
                <div className="flex h-[220px] w-[220px] shrink-0 items-center justify-center overflow-visible">
                  <SagaBadgeImage
                    src={saga.badgeImage}
                    alt={`${saga.title} badge`}
                    fallbackIcon={saga.fallbackIcon}
                  />
                </div>

                <div className="max-w-[820px]">
                  <p
                    className={`text-xs font-black uppercase tracking-[0.3em] ${theme.text}`}
                  >
                    Saga
                  </p>

                  <h1 className="mt-3 text-6xl font-black text-white">
                    {saga.title}
                  </h1>

                  <p className={`mt-2 text-xl font-bold ${theme.text}`}>
                    {saga.subtitle}
                  </p>

                  <p className="mt-5 max-w-[760px] text-sm leading-relaxed text-white/55">
                    {saga.description || "Jogos vinculados a esta saga."}
                  </p>
                </div>
              </div>

              <div className="grid min-w-[260px] grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/10 bg-black/35 px-5 py-4 text-center">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                    Jogos
                  </p>

                  <p className="mt-1 text-3xl font-black text-white">
                    {completedGames}/{totalGames}
                  </p>
                </div>

                <div
                  className={`rounded-2xl border px-5 py-4 text-center ${theme.border} ${theme.bg}`}
                >
                  <p
                    className={`text-[10px] font-black uppercase tracking-[0.2em] ${theme.text}`}
                  >
                    Progresso
                  </p>

                  <p className={`mt-1 text-3xl font-black ${theme.text}`}>
                    {sagaProgress}%
                  </p>
                </div>
              </div>
            </div>
          </div>
        </header>

        <section className="mt-8 overflow-hidden rounded-[24px] border border-white/10 bg-zinc-950/80 shadow-xl">
          <div className="flex flex-col gap-4 border-b border-white/10 bg-black/45 px-6 py-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.28em] text-red-400">
                Jogos da Saga
              </p>

              <h2 className="mt-1 text-3xl font-black text-white">
                Biblioteca da Saga
              </h2>
            </div>

            <div
              className={`w-fit rounded-xl border px-4 py-2 text-sm font-black ${
                isSagaCompleted
                  ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300"
                  : "border-white/10 bg-white/[0.03] text-white/55"
              }`}
            >
              {isSagaCompleted ? "Emblema obtido" : "Emblema bloqueado"}
            </div>
          </div>

          {saga.stages.length === 0 ? (
            <div className="p-8 text-sm text-white/45">
              Nenhuma etapa cadastrada nesta saga.
            </div>
          ) : (
            <div>
              {saga.stages.map((stage, stageIndex) => (
                <div
                  key={`${stage.id}-${stageIndex}`}
                  className="grid border-b border-white/10 last:border-b-0 lg:grid-cols-[120px_1fr]"
                >
                  <div className="flex items-center justify-center border-b border-white/10 bg-black/45 px-4 py-5 text-center lg:border-b-0 lg:border-r lg:border-white/10">
                    <div>
                      <p className="text-sm font-black text-white/70">Etapa</p>

                      <p className="text-4xl font-black text-white">
                        {stageIndex + 1}
                      </p>
                    </div>
                  </div>

                  <div>
                    <div className="border-b border-white/10 px-5 py-4">
                      <h3 className="text-xl font-black text-white">
                        {stage.title || "Jogos da Saga"}
                      </h3>

                      {stage.description ? (
                        <p className="mt-1 text-sm text-white/45">
                          {stage.description}
                        </p>
                      ) : null}
                    </div>

                    {stage.gameSlugs.length === 0 ? (
                      <div className="p-6 text-sm text-white/45">
                        Nenhum jogo vinculado nesta etapa.
                      </div>
                    ) : (
                      stage.gameSlugs.map((gameSlug) => {
                        const game = gamesMap[gameSlug] as SagaGame | undefined;

                        if (!game) {
                          return (
                            <div
                              key={gameSlug}
                              className="p-6 text-sm text-white/45"
                            >
                              Jogo não encontrado: {gameSlug}
                            </div>
                          );
                        }

                        const gameProgress = getGameProgress(
                          gameSlug,
                          game,
                          manualStatesByGame
                        );

                        const image =
                          readText(game.image, "") ||
                          readText(game.cardImage, "");

                        return (
                          <Link
                            key={gameSlug}
                            href={`/games/${gameSlug}`}
                            className={`group grid min-h-[140px] items-center gap-4 border-b border-white/10 bg-[#0c0f14] px-5 py-4 transition last:border-b-0 hover:bg-white/[0.035] ${theme.row} xl:grid-cols-[190px_1fr_auto]`}
                          >
                            <div className="aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-black/45 xl:w-[180px]">
                              {image ? (
                                <img
                                  src={image}
                                  alt={readText(game.title, "Jogo")}
                                  className="h-full w-full object-cover opacity-90 transition group-hover:scale-105 group-hover:opacity-100"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-xs font-black text-white/35">
                                  Sem imagem
                                </div>
                              )}
                            </div>

                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-3">
                                <h3 className="line-clamp-1 text-2xl font-black text-white transition group-hover:text-red-300">
                                  {readText(game.title, gameSlug)}
                                </h3>

                                <StatusBadge
                                  progress={gameProgress.progress}
                                  isCompleted={gameProgress.isCompleted}
                                />
                              </div>

                              <p className="mt-1 text-sm font-bold text-blue-300">
                                {readText(game.subtitle, "Sem subtítulo")}
                              </p>

                              <div className="mt-4 max-w-[420px]">
                                <div className="mb-1 flex items-center justify-between text-[11px]">
                                  <span className="text-white/35">
                                    Progresso
                                  </span>

                                  <span className="font-black text-white">
                                    {gameProgress.progress}%
                                  </span>
                                </div>

                                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                                  <div
                                    className={`h-full rounded-full ${theme.progress}`}
                                    style={{
                                      width: `${gameProgress.progress}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <div className="mr-2 text-right">
                                <p className="text-sm font-black text-white">
                                  {formatHours(game.hours)}
                                </p>
                              </div>

                              <FinalEmblemIcon
                                unlocked={
                                  gameProgress.finalAchievementUnlocked
                                }
                              />

                              <RankIcon
                                icon="🥉"
                                value={gameProgress.rankCounts.Bronze}
                                dimmed={gameProgress.rankCounts.Bronze === 0}
                              />

                              <RankIcon
                                icon="🥈"
                                value={gameProgress.rankCounts.Prata}
                                dimmed={gameProgress.rankCounts.Prata === 0}
                              />

                              <RankIcon
                                icon="🥇"
                                value={gameProgress.rankCounts.Ouro}
                                dimmed={gameProgress.rankCounts.Ouro === 0}
                              />

                              <TrophyTotalIcon
                                totalCount={gameProgress.totalCount}
                              />

                              <span className="ml-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-black text-white/35 transition group-hover:border-red-500/35 group-hover:bg-red-500/10 group-hover:text-red-200">
                                Abrir →
                              </span>
                            </div>
                          </Link>
                        );
                      })
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
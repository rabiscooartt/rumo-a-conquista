"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { type SiteGame, useSiteGames } from "@/lib/useSiteGames";

type AchievementStorageState = {
  status?: string;
  rank?: string;
  date?: string;
  image?: string;
};

type HeroAchievement = {
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

type HeroGame = SiteGame & {
  slug: string;
  title: string;
  subtitle?: string;
  status?: string;
  progress?: number;
  hours?: string | number;
  currentObjective?: string;
  objective?: string;
  nextMission?: string;
  image?: string;
  cardImage?: string;
  mastery?: string;
  achievementsList?: HeroAchievement[];
  finalBadge?: {
    title?: string;
    icon?: string;
    image?: string;
  };
  review?: {
    status?: string;
    nota?: string | number;
  };
  createdAt?: string;
  updatedAt?: string;
};

type FinalBadgeData = {
  title: string;
  icon: string;
  image: string;
};

type HeroBannerProps = {
  game?: HeroGame;
  games?: HeroGame[];
};

const GAMES_UPDATED_EVENT = "rumo-a-conquista-games-updated";
const REVIEW_UPDATED_EVENT = "rumo-a-conquista-review-updated";
const ACHIEVEMENTS_UPDATED_EVENT = "rumo-a-conquista-achievements-updated";

function normalizeText(text?: string) {
  return String(text || "")
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

function clampPercent(value: unknown) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return 0;
  }

  return Math.min(100, Math.max(0, numberValue));
}

function getGameTimestamp(game: HeroGame) {
  const updatedAt = readText(game.updatedAt, "");
  const createdAt = readText(game.createdAt, "");

  const updatedTime = updatedAt ? new Date(updatedAt).getTime() : 0;
  const createdTime = createdAt ? new Date(createdAt).getTime() : 0;

  if (Number.isFinite(updatedTime) && updatedTime > 0) {
    return updatedTime;
  }

  if (Number.isFinite(createdTime) && createdTime > 0) {
    return createdTime;
  }

  return 0;
}

function sortNewestFirst(games: HeroGame[]) {
  return [...games].sort((a, b) => {
    const timeA = getGameTimestamp(a);
    const timeB = getGameTimestamp(b);

    if (timeA !== timeB) {
      return timeB - timeA;
    }

    return a.title.localeCompare(b.title);
  });
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

function isCompletedGame(game: HeroGame) {
  const status = normalizeText(game.status);
  const mastery = normalizeText(game.mastery);

  return (
    status === "completed" ||
    status === "finalizado" ||
    status === "concluido" ||
    status === "concluida" ||
    mastery === "concluida" ||
    mastery === "concluido" ||
    clampPercent(game.progress) >= 100
  );
}

function isProgressGame(game: HeroGame) {
  const status = normalizeText(game.status);
  const progress = clampPercent(game.progress);

  if (isCompletedGame(game)) {
    return false;
  }

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

function getHeroGame(games: HeroGame[]) {
  const visibleGames = sortNewestFirst(games.filter(Boolean));

  const progressGames = visibleGames.filter((game) => isProgressGame(game));

  if (progressGames.length > 0) {
    return progressGames[0];
  }

  const completedGames = visibleGames.filter((game) => isCompletedGame(game));

  if (completedGames.length > 0) {
    return completedGames[0];
  }

  return visibleGames[0];
}

function getAchievementTitle(achievement: HeroAchievement, index: number) {
  return readText(achievement.title, `Conquista ${index + 1}`);
}

function isMasteryAchievement(
  achievement: HeroAchievement,
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

function getFinalBadgeFromGame(game: HeroGame): FinalBadgeData {
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
    const title = readText(masteryAchievement.title, "Maestria Final");
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

  return {
    title: readText(game.finalBadge?.title, "Maestria Final"),
    icon: readText(game.finalBadge?.icon, "💎"),
    image:
      readText(game.finalBadge?.image, "") ||
      `/images/games/${game.slug}/achievements/maestria-final.png`,
  };
}

function getObjective(
  game: HeroGame,
  isCompleted: boolean,
  finalBadge: FinalBadgeData
) {
  if (isCompleted) {
    return finalBadge.title || readText(game.mastery, "") || "Maestria Final";
  }

  return (
    game.currentObjective ||
    game.objective ||
    game.nextMission ||
    "Definir próximo objetivo"
  );
}

function getReviewScore(game: HeroGame) {
  const localKey = `rumo-a-conquista-review-${game.slug}`;

  if (typeof window !== "undefined") {
    const savedReview = localStorage.getItem(localKey);

    if (savedReview) {
      try {
        const parsedReview = JSON.parse(savedReview) as {
          nota?: string | number;
        };

        const localScore = readText(parsedReview.nota, "");

        if (localScore) {
          return localScore;
        }
      } catch {
        // mantém fallback abaixo
      }
    }
  }

  return readText(game.review?.nota, "");
}

function GameHeroImage({ src, title }: { src?: string; title: string }) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  if (!src || hasError) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black text-sm font-black text-white/35">
        Sem imagem
      </div>
    );
  }

  return (
    <img
      key={src}
      src={src}
      alt={title}
      className="absolute inset-0 h-full w-full object-cover object-center brightness-90 contrast-110"
      onError={() => setHasError(true)}
    />
  );
}

function FinalBadgeVisual({
  badge,
  imageClassName,
  fallbackClassName = "",
}: {
  badge: FinalBadgeData;
  imageClassName: string;
  fallbackClassName?: string;
}) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [badge.image]);

  if (badge.image && !hasError) {
    return (
      <img
        key={badge.image}
        src={badge.image}
        alt={badge.title}
        className={imageClassName}
        onError={() => setHasError(true)}
      />
    );
  }

  return <span className={fallbackClassName}>{badge.icon || "💎"}</span>;
}

export default function HeroBanner({ game, games }: HeroBannerProps) {
  const { gamesList, isLoaded } = useSiteGames();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    function refreshHero() {
      setRefreshKey((current) => current + 1);
    }

    window.addEventListener(GAMES_UPDATED_EVENT, refreshHero);
    window.addEventListener(REVIEW_UPDATED_EVENT, refreshHero);
    window.addEventListener(ACHIEVEMENTS_UPDATED_EVENT, refreshHero);
    window.addEventListener("storage", refreshHero);
    window.addEventListener("focus", refreshHero);

    return () => {
      window.removeEventListener(GAMES_UPDATED_EVENT, refreshHero);
      window.removeEventListener(REVIEW_UPDATED_EVENT, refreshHero);
      window.removeEventListener(ACHIEVEMENTS_UPDATED_EVENT, refreshHero);
      window.removeEventListener("storage", refreshHero);
      window.removeEventListener("focus", refreshHero);
    };
  }, []);

  const heroGame = useMemo(() => {
    const dynamicGames = (gamesList || []) as HeroGame[];

    if (dynamicGames.length > 0) {
      return getHeroGame(dynamicGames);
    }

    if (Array.isArray(games) && games.length > 0) {
      return getHeroGame(games);
    }

    if (game) {
      return game;
    }

    return undefined;
  }, [game, games, gamesList, refreshKey]);

  if (!isLoaded && !game && (!games || games.length === 0)) {
    return (
      <section className="overflow-hidden rounded-[32px] border border-white/10 bg-zinc-950/80 p-10 text-white/50 shadow-xl">
        Carregando banner...
      </section>
    );
  }

  if (!heroGame) {
    return (
      <section className="overflow-hidden rounded-[32px] border border-white/10 bg-zinc-950/80 shadow-xl">
        <div className="relative min-h-[420px] overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.18),transparent_35%),radial-gradient(circle_at_top_right,rgba(34,211,238,0.16),transparent_35%)]" />

          <div className="relative z-10 flex min-h-[420px] items-center p-10">
            <div className="max-w-[760px]">
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-black uppercase tracking-wide text-white/45">
                Sem jogo ativo
              </span>

              <h1 className="mt-6 text-5xl font-black leading-none text-white">
                Nenhum jogo em progresso no momento
              </h1>

              <p className="mt-4 max-w-[620px] text-sm leading-relaxed text-white/50">
                Quando você marcar um jogo como Em progresso no Admin, ele entra
                automaticamente aqui no banner principal da Home.
              </p>

              <Link
                href="/admin/jogos"
                className="mt-7 inline-flex rounded-xl border border-red-500/35 bg-red-500/15 px-6 py-3 text-sm font-black text-red-100 transition hover:bg-red-500/25"
              >
                Ir para Admin Jogos →
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const completed = isCompletedGame(heroGame);
  const progress = completed ? 100 : clampPercent(heroGame.progress);
  const image = heroGame.image || heroGame.cardImage;
  const finalBadge = getFinalBadgeFromGame(heroGame);
  const objective = getObjective(heroGame, completed, finalBadge);
  const reviewScore = getReviewScore(heroGame);
  const hasReviewScore = completed && reviewScore.trim() !== "";

  const pageHref = `/games/${heroGame.slug}`;
  const reviewHref = `/games/${heroGame.slug}?review=1#review-section`;

  return (
    <section className="overflow-hidden rounded-[32px] border border-white/10 bg-zinc-950/80 shadow-xl">
      <div className="relative min-h-[420px] overflow-hidden">
        <GameHeroImage src={image} title={heroGame.title} />

        <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/55 to-black/15" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />

        {hasReviewScore && (
          <div className="pointer-events-auto absolute right-8 top-8 z-20 hidden rounded-[24px] border border-red-500/30 bg-red-500/15 p-5 shadow-[0_0_35px_rgba(239,68,68,0.18)] backdrop-blur-md lg:block">
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-red-200">
              Nota
            </p>

            <div className="mt-2 flex items-end gap-1">
              <span className="text-5xl font-black leading-none text-white">
                {reviewScore}
              </span>

              <span className="pb-1 text-2xl font-black leading-none text-white/45">
                /10
              </span>
            </div>

            <p className="mt-3 text-[10px] font-black uppercase tracking-[0.25em] text-white/45">
              Review completa
            </p>

            <Link
              href={reviewHref}
              className="mt-4 inline-flex rounded-xl bg-red-500 px-6 py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:bg-red-400"
            >
              Ver review
            </Link>
          </div>
        )}

        <div className="relative z-10 flex min-h-[420px] items-center p-10">
          <div className="max-w-[780px]">
            <span
              className={`rounded-full border px-4 py-2 text-xs font-black uppercase tracking-wide ${
                completed
                  ? "border-emerald-400/30 bg-emerald-500/20 text-emerald-200"
                  : "border-red-500/30 bg-red-500/20 text-red-300"
              }`}
            >
              {completed ? "Última maestria" : "Jogando agora"}
            </span>

            <h1 className="mt-7 max-w-[760px] text-6xl font-black uppercase leading-none text-white">
              {heroGame.title}
            </h1>

            <p className="mt-3 text-3xl text-blue-300">
              {heroGame.subtitle || "Jornada em andamento"}
            </p>

            <div className="mt-8 max-w-[600px]">
              <div className="mb-3 flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-white/70">
                  <span>⏳</span>
                  <span>Progresso da jornada</span>
                </div>

                <span
                  className={`font-black ${
                    completed ? "text-emerald-300" : "text-red-400"
                  }`}
                >
                  {progress}%
                </span>
              </div>

              <div className="h-3 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full ${
                    completed
                      ? "bg-emerald-400 shadow-[0_0_18px_rgba(16,185,129,0.75)]"
                      : "bg-red-500 shadow-[0_0_18px_rgba(239,68,68,0.75)]"
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <div
              className={`mt-6 inline-flex items-center gap-4 rounded-2xl border px-5 py-4 shadow-[0_0_24px_rgba(239,68,68,0.12)] ${
                completed
                  ? "border-emerald-400/30 bg-emerald-500/10"
                  : "border-red-500/30 bg-red-500/10"
              }`}
            >
              <div
                className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border text-xl ${
                  completed
                    ? "border-emerald-400/30 bg-black/35"
                    : "border-red-500/30 bg-red-500/15"
                }`}
              >
                {completed ? (
                  <FinalBadgeVisual
                    badge={finalBadge}
                    imageClassName="h-full w-full object-cover"
                    fallbackClassName="text-xl"
                  />
                ) : (
                  "🎯"
                )}
              </div>

              <div>
                <p
                  className={`text-[10px] font-black uppercase tracking-[0.25em] ${
                    completed ? "text-emerald-300" : "text-red-300"
                  }`}
                >
                  {completed ? "Maestria final" : "Objetivo atual"}
                </p>

                <p className="mt-1 text-lg font-black text-white">
                  {objective}
                </p>
              </div>
            </div>

            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href={pageHref}
                className="rounded-xl border border-red-500/35 bg-red-500/15 px-6 py-3 text-sm font-black text-red-100 transition hover:bg-red-500/25"
              >
                Abrir jornada →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
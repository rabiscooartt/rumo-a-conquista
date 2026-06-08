"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import GameAchievementsPanel, {
  type AchievementInput,
  type ManualAchievementState,
} from "@/components/GameAchievementsPanel";
import GameReviewPanel, {
  createDefaultReview,
  type ManualReviewState,
  type ReviewInput,
} from "@/components/GameReviewPanel";

type FinalBadgeInput = {
  title?: string;
  icon?: string;
  image?: string;
};

type FinalBadgeData = {
  title: string;
  icon: string;
  image: string;
};

type GameEmblemInput = {
  title?: string;
  image?: string;
  description?: string;
  tags?: string[] | string;
};

type GameEmblemData = {
  title: string;
  image: string;
  description: string;
  tags: string[];
};

type EnhancedAchievement = AchievementInput & {
  manualState: ManualAchievementState;
};

type GameInput = {
  title: string;
  subtitle: string;
  image: string;
  cardImage?: string;
  achievements?: string | number;
  progress: number;
  mastery?: string;
  hours: string;
  status: string;
  nextMission?: string;
  currentObjective?: string;
  objective?: string;
  achievementsList: AchievementInput[];
  review: ReviewInput;
  finalBadge?: FinalBadgeInput;
  emblem?: GameEmblemInput;
};

type Props = {
  slug: string;
  game: GameInput;
};

const ACHIEVEMENTS_UPDATED_EVENT = "rumo-a-conquista-achievements-updated";
const REVIEW_UPDATED_EVENT = "rumo-a-conquista-review-updated";
const GAMES_UPDATED_EVENT = "rumo-a-conquista-games-updated";

function readText(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);

  return fallback;
}

function readStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => readText(item, "").trim()).filter(Boolean);
  }

  const text = readText(value, "");

  if (!text.trim()) {
    return [];
  }

  return text
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeText(text?: string) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

function normalizeGameStatus(status?: string) {
  const normalized = normalizeText(status);

  if (
    normalized === "completed" ||
    normalized === "finalizado" ||
    normalized === "concluido" ||
    normalized === "concluida"
  ) {
    return "completed";
  }

  if (
    normalized === "planned" ||
    normalized === "planejado" ||
    normalized === "backlog" ||
    normalized === "futuro"
  ) {
    return "planned";
  }

  return "progress";
}

function getStatusLabel(status?: string) {
  const normalizedStatus = normalizeGameStatus(status);

  if (normalizedStatus === "completed") return "Finalizado";
  if (normalizedStatus === "planned") return "Planejado";

  return "Em progresso";
}

function isCompletedGame(game: GameInput) {
  const status = normalizeGameStatus(game.status);
  const mastery = normalizeText(game.mastery);

  return (
    status === "completed" ||
    Number(game.progress) >= 100 ||
    mastery === "concluida" ||
    mastery === "concluido"
  );
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

function normalizeReviewStatus(status?: string) {
  const normalized = normalizeText(status);

  if (
    normalized === "liberada" ||
    normalized === "reviewliberada" ||
    normalized === "completed" ||
    normalized === "concluida" ||
    normalized === "concluido"
  ) {
    return "liberada";
  }

  if (
    normalized === "emandamento" ||
    normalized === "progress" ||
    normalized === "emprogresso"
  ) {
    return "em-andamento";
  }

  return "bloqueada";
}

function isReviewReleased(review?: ManualReviewState | ReviewInput) {
  return normalizeReviewStatus(review?.status) === "liberada";
}

function getDefaultRank(achievement: AchievementInput) {
  const difficulty = readText(achievement.difficulty, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const trophy = readText(achievement.trophy, "");

  if (difficulty === "extrema" || difficulty === "diamante") return "Diamante";
  if (difficulty === "dificil" || difficulty === "ouro") return "Ouro";
  if (difficulty === "media" || difficulty === "prata") return "Prata";

  if (trophy.includes("💎")) return "Diamante";
  if (trophy.includes("🥇") || trophy.includes("🏆")) return "Ouro";
  if (trophy.includes("🥈")) return "Prata";

  return "Bronze";
}

function getRankIcon(rank?: string) {
  if (rank === "Diamante") return "💎";
  if (rank === "Ouro") return "🥇";
  if (rank === "Prata") return "🥈";

  return "🥉";
}

function toInputDate(date?: string) {
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

function createDefaultStates(achievements: AchievementInput[]) {
  return achievements.reduce<Record<string, ManualAchievementState>>(
    (acc, achievement) => {
      acc[achievement.title] = {
        rank: getDefaultRank(achievement),
        status: normalizeAchievementStatus(achievement.status),
        date: toInputDate(achievement.earnedDate),
      } as ManualAchievementState;

      return acc;
    },
    {}
  );
}

function getManualImage(manualState: ManualAchievementState) {
  return readText((manualState as { image?: string }).image, "");
}

function isMasteryAchievement(achievement: EnhancedAchievement) {
  const title = normalizeText(achievement.title);
  const rank = readText(
    achievement.manualState.rank,
    getDefaultRank(achievement)
  );

  return (
    rank === "Diamante" ||
    title.includes("maestria") ||
    title.includes("mastery")
  );
}

function getFinalBadgeFromAchievements({
  slug,
  game,
  achievements,
}: {
  slug: string;
  game: GameInput;
  achievements: EnhancedAchievement[];
}): FinalBadgeData {
  const completedMastery = achievements.find(
    (achievement) =>
      achievement.manualState.status === "completed" &&
      isMasteryAchievement(achievement)
  );

  const anyMastery = achievements.find((achievement) =>
    isMasteryAchievement(achievement)
  );

  const masteryAchievement = completedMastery ?? anyMastery;

  if (masteryAchievement) {
    const rank = readText(
      masteryAchievement.manualState.rank,
      getDefaultRank(masteryAchievement)
    );

    const image =
      getManualImage(masteryAchievement.manualState) ||
      readText(masteryAchievement.image, "") ||
      `/images/games/${slug}/achievements/maestria-final.png`;

    return {
      title: readText(masteryAchievement.title, "Maestria Final"),
      icon:
        readText(masteryAchievement.icon, "") ||
        readText(masteryAchievement.trophy, "") ||
        getRankIcon(rank),
      image,
    };
  }

  return {
    title: readText(game.finalBadge?.title, "Maestria Final"),
    icon: readText(game.finalBadge?.icon, "💎"),
    image:
      readText(game.finalBadge?.image, "") ||
      `/images/games/${slug}/achievements/maestria-final.png`,
  };
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

function getGameEmblemData(slug: string, game: GameInput): GameEmblemData | null {
  const normalizedSlug = normalizeText(slug);
  const normalizedTitle = normalizeText(game.title);

  const isHogwartsLegacy =
    normalizedSlug === "hogwartslegacy" ||
    normalizedSlug.includes("hogwarts") ||
    normalizedTitle.includes("hogwarts");

  const fallbackHogwartsEmblem: GameEmblemData | null = isHogwartsLegacy
    ? {
        title: "Legado Absoluto",
        image: "/images/games/howgarts-legacy/emblem.png",
        description:
          "Uma relíquia simbólica concedida ao bruxo que explorou Hogwarts por completo, dominou seus desafios e revelou todos os segredos deixados pelo legado mágico. O Legado Absoluto representa a conclusão definitiva da jornada e a marca de quem se tornou um verdadeiro guardião dessa história.",
        tags: ["Colecionável", "Emblema Especial", "Hogwarts Legacy"],
      }
    : null;

  const title =
    readText(game.emblem?.title, "") ||
    readText(fallbackHogwartsEmblem?.title, "");

  const image =
    readText(game.emblem?.image, "") ||
    readText(fallbackHogwartsEmblem?.image, "");

  const description =
    readText(game.emblem?.description, "") ||
    readText(fallbackHogwartsEmblem?.description, "");

  const tags = readStringList(game.emblem?.tags);
  const fallbackTags = fallbackHogwartsEmblem?.tags ?? [];
  const finalTags = tags.length > 0 ? tags : fallbackTags;

  if (!title && !image && !description && finalTags.length <= 0) {
    return null;
  }

  return {
    title: title || "Emblema do Jogo",
    image,
    description,
    tags:
      finalTags.length > 0 ? finalTags : ["Colecionável", "Emblema Especial"],
  };
}

function GameEmblemBlock({ emblem }: { emblem: GameEmblemData }) {
  const [hasImageError, setHasImageError] = useState(false);

  useEffect(() => {
    setHasImageError(false);
  }, [emblem.image]);

  return (
    <section className="relative overflow-hidden rounded-3xl border border-violet-400/20 bg-gradient-to-br from-slate-950 via-violet-950/30 to-slate-950 p-6 shadow-[0_0_40px_rgba(124,58,237,0.18)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(168,85,247,0.22),transparent_38%),radial-gradient(circle_at_50%_90%,rgba(59,130,246,0.16),transparent_40%)]" />

      <div className="relative z-10 grid gap-6 lg:grid-cols-[260px_1fr] lg:items-center">
        <div className="flex justify-center">
          <div className="group relative flex h-[260px] w-[260px] items-center justify-center overflow-visible">
            <div className="absolute inset-8 rounded-full bg-violet-500/10 blur-3xl transition-all duration-300 ease-out group-hover:scale-110 group-hover:bg-violet-400/20" />

            {emblem.image && !hasImageError ? (
              <img
                src={emblem.image}
                alt={`Emblema do Jogo - ${emblem.title}`}
                className="relative z-10 h-full w-full object-contain scale-[1.18] transition-[filter] duration-300 ease-out group-hover:drop-shadow-[0_0_18px_rgba(168,85,247,0.38)]"
                onError={() => setHasImageError(true)}
              />
            ) : (
              <div className="relative z-10 flex h-full w-full scale-[1.18] items-center justify-center rounded-[34px] border border-violet-400/20 bg-black/25 text-6xl transition-[filter] duration-300 ease-out group-hover:drop-shadow-[0_0_18px_rgba(168,85,247,0.38)]">
                💠
              </div>
            )}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.35em] text-violet-300">
            Emblema do Jogo
          </p>

          <h2 className="text-3xl font-black text-white md:text-4xl">
            {emblem.title}
          </h2>

          {emblem.description && (
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-300 md:text-base">
              {emblem.description}
            </p>
          )}

          {emblem.tags.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-3">
              {emblem.tags.map((tag, index) => {
                const styles = [
                  "border-violet-400/30 bg-violet-500/10 text-violet-200",
                  "border-amber-300/30 bg-amber-400/10 text-amber-200",
                  "border-sky-300/30 bg-sky-400/10 text-sky-200",
                ];

                return (
                  <span
                    key={`${tag}-${index}`}
                    className={`rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-wider ${
                      styles[index % styles.length]
                    }`}
                  >
                    {tag}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
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

function ScorePill({ score }: { score: string }) {
  return (
    <div className="mt-2 flex items-end gap-1">
      <span className="text-5xl font-black leading-none text-white">
        {score}
      </span>

      <span className="pb-1 text-2xl font-black leading-none text-white/45">
        /10
      </span>
    </div>
  );
}

export default function GamePageClient({ slug, game }: Props) {
  const reviewSectionRef = useRef<HTMLDivElement | null>(null);

  const achievements = Array.isArray(game.achievementsList)
    ? game.achievementsList
    : [];

  const defaultStates = useMemo(
    () => createDefaultStates(achievements),
    [achievements]
  );

  const defaultReview = useMemo(
    () => createDefaultReview(game.review),
    [game.review]
  );

  const achievementsStorageKey = `rumo-a-conquista-achievements-${slug}`;
  const reviewStorageKey = `rumo-a-conquista-review-${slug}`;

  const [manualStates, setManualStates] =
    useState<Record<string, ManualAchievementState>>(defaultStates);

  const [manualReview, setManualReview] =
    useState<ManualReviewState>(defaultReview);

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const savedData = readLocalJson<
      Record<string, ManualAchievementState> | null
    >(achievementsStorageKey, null);

    if (!savedData) {
      setManualStates(defaultStates);
      return;
    }

    setManualStates({
      ...defaultStates,
      ...savedData,
    });
  }, [defaultStates, achievementsStorageKey, refreshKey]);

  useEffect(() => {
    const savedData = readLocalJson<ManualReviewState | null>(
      reviewStorageKey,
      null
    );

    if (!savedData) {
      setManualReview(defaultReview);
      return;
    }

    setManualReview({
      ...defaultReview,
      ...savedData,
    });
  }, [defaultReview, reviewStorageKey, refreshKey]);

  useEffect(() => {
    function refreshData() {
      setRefreshKey((current) => current + 1);
    }

    window.addEventListener(ACHIEVEMENTS_UPDATED_EVENT, refreshData);
    window.addEventListener(REVIEW_UPDATED_EVENT, refreshData);
    window.addEventListener(GAMES_UPDATED_EVENT, refreshData);
    window.addEventListener("storage", refreshData);
    window.addEventListener("focus", refreshData);

    return () => {
      window.removeEventListener(ACHIEVEMENTS_UPDATED_EVENT, refreshData);
      window.removeEventListener(REVIEW_UPDATED_EVENT, refreshData);
      window.removeEventListener(GAMES_UPDATED_EVENT, refreshData);
      window.removeEventListener("storage", refreshData);
      window.removeEventListener("focus", refreshData);
    };
  }, []);

  function scrollToReview() {
    const reviewSection =
      reviewSectionRef.current ?? document.getElementById("review-section");

    if (!reviewSection) return;

    const headerOffset = 120;
    const reviewPosition =
      reviewSection.getBoundingClientRect().top + window.scrollY - headerOffset;

    window.scrollTo({
      top: reviewPosition,
      behavior: "smooth",
    });

    window.history.replaceState(null, "", "#review-section");
  }

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const shouldScrollToReview =
      window.location.hash === "#review-section" || params.get("review") === "1";

    if (!shouldScrollToReview) return;

    const timers = [150, 500, 900, 1300].map((delay) =>
      window.setTimeout(() => {
        scrollToReview();
      }, delay)
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [refreshKey]);

  const enhancedAchievements: EnhancedAchievement[] = achievements.map(
    (achievement) => {
      const manualState =
        manualStates[achievement.title] ??
        defaultStates[achievement.title] ??
        ({
          rank: getDefaultRank(achievement),
          status: normalizeAchievementStatus(achievement.status),
          date: toInputDate(achievement.earnedDate),
        } as ManualAchievementState);

      return {
        ...achievement,
        manualState,
      };
    }
  );

  const completedAchievements = enhancedAchievements.filter(
    (achievement) => achievement.manualState.status === "completed"
  );

  const progressAchievements = enhancedAchievements.filter(
    (achievement) => achievement.manualState.status === "progress"
  );

  const lockedAchievements = enhancedAchievements.filter(
    (achievement) => achievement.manualState.status === "locked"
  );

  const totalAchievements = enhancedAchievements.length;
  const completedCount = completedAchievements.length;

  const gameProgress = clampPercent(Number(game.progress) || 0);

  const isCompletedByStatus = isCompletedGame(game);
  const isCompletedByAchievements =
    totalAchievements > 0 && completedCount === totalAchievements;

  const isJourneyCompleted = isCompletedByStatus || isCompletedByAchievements;

  const finalBadge = getFinalBadgeFromAchievements({
    slug,
    game,
    achievements: enhancedAchievements,
  });

  const isHogwartsLegacyPage =
    normalizeText(slug).includes("hogwarts") ||
    normalizeText(slug).includes("howgarts") ||
    normalizeText(game.title).includes("hogwarts") ||
    normalizeText(game.image).includes("hogwarts") ||
    normalizeText(game.image).includes("howgarts") ||
    normalizeText(game.cardImage).includes("hogwarts") ||
    normalizeText(game.cardImage).includes("howgarts");

  const hogwartsFallbackEmblem: GameEmblemData = {
    title: "Legado Absoluto",
    image: "/images/games/howgarts-legacy/emblem.png",
    description:
      "Uma relíquia simbólica concedida ao bruxo que explorou Hogwarts por completo, dominou seus desafios e revelou todos os segredos deixados pelo legado mágico. O Legado Absoluto representa a conclusão definitiva da jornada e a marca de quem se tornou um verdadeiro guardião dessa história.",
    tags: ["Colecionável", "Emblema Especial", "Hogwarts Legacy"],
  };

  const emblemData =
    getGameEmblemData(slug, game) ||
    (isHogwartsLegacyPage ? hogwartsFallbackEmblem : null);

  const progressByAchievements =
    totalAchievements > 0
      ? Math.round((completedCount / totalAchievements) * 100)
      : 0;

  const progressPercent = isJourneyCompleted
    ? 100
    : gameProgress > 0
    ? gameProgress
    : progressByAchievements;

  const dynamicMastery = isJourneyCompleted
    ? finalBadge.title
    : readText(game.mastery, "Em andamento") || "Em andamento";

  const dynamicStatus = isJourneyCompleted
    ? "Finalizado"
    : getStatusLabel(game.status);

  const nextAchievement =
    progressAchievements[0] ??
    lockedAchievements[0] ??
    completedAchievements[completedAchievements.length - 1];

  const objectiveLabel = isJourneyCompleted ? "Maestria" : "Objetivo atual";

  const objectiveTitle = isJourneyCompleted
    ? finalBadge.title
    : readText(game.currentObjective || game.objective || game.nextMission, "") ||
      nextAchievement?.title ||
      "Definir próximo objetivo";

  const reviewScore = readText(manualReview.nota || game.review?.nota, "?");
  const hasReviewScore = reviewScore.trim() !== "" && reviewScore !== "?";

  const reviewUnlocked =
    isReviewReleased(manualReview) ||
    isReviewReleased(game.review) ||
    isJourneyCompleted ||
    hasReviewScore;

  const bannerImage = game.image || game.cardImage || "";
  const progressBarClass = isJourneyCompleted
    ? "bg-emerald-400 shadow-[0_0_18px_rgba(16,185,129,0.75)]"
    : "bg-red-500 shadow-[0_0_18px_rgba(239,68,68,0.75)]";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0b1624_0%,#050505_45%,#020202_100%)] text-white">
      <Navbar />

      <section className="mx-auto w-full max-w-[1500px] px-8 py-10">
        <Link
          href="/"
          className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-black text-red-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
        >
          ← Voltar para Home
        </Link>

        <section className="mt-8 overflow-hidden rounded-[32px] border border-white/10 bg-zinc-950/80 shadow-xl">
          <div className="relative min-h-[430px] overflow-hidden">
            {bannerImage ? (
              <img
                src={bannerImage}
                alt={game.title}
                className="absolute inset-0 h-full w-full object-cover object-center brightness-90 contrast-110"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-black text-sm font-black text-white/30">
                Sem imagem
              </div>
            )}

            <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/55 to-black/10" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent" />

            {reviewUnlocked && hasReviewScore && (
              <div className="pointer-events-auto absolute right-8 top-8 z-20 hidden rounded-[24px] border border-red-500/30 bg-red-500/15 p-5 shadow-[0_0_35px_rgba(239,68,68,0.18)] backdrop-blur-md lg:block">
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-red-200">
                  Nota
                </p>

                <ScorePill score={reviewScore} />

                <p className="mt-3 text-[10px] font-black uppercase tracking-[0.25em] text-white/45">
                  Review completa
                </p>

                <button
                  type="button"
                  onClick={scrollToReview}
                  className="pointer-events-auto mt-4 inline-flex rounded-xl bg-red-500 px-6 py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:bg-red-400"
                >
                  Ver review
                </button>
              </div>
            )}

            <div className="relative z-10 flex min-h-[430px] items-center p-10">
              <div className="max-w-[760px]">
                <span
                  className={`rounded-full border px-4 py-2 text-xs font-black uppercase tracking-wide ${
                    isJourneyCompleted
                      ? "border-emerald-400/30 bg-emerald-500/20 text-emerald-200"
                      : "border-red-500/30 bg-red-500/20 text-red-300"
                  }`}
                >
                  {isJourneyCompleted ? "Jogo finalizado" : "Página do jogo"}
                </span>

                <h1 className="mt-7 text-6xl font-black leading-none text-white">
                  {game.title}
                </h1>

                <p className="mt-3 text-3xl text-blue-300">{game.subtitle}</p>

                <div className="mt-8 max-w-[600px]">
                  <div className="mb-3 flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 text-white/70">
                      <span>⏳</span>
                      <span>Progresso da jornada</span>
                    </div>

                    <span
                      className={`font-black ${
                        isJourneyCompleted ? "text-emerald-300" : "text-red-400"
                      }`}
                    >
                      {progressPercent}%
                    </span>
                  </div>

                  <div className="h-3 overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full ${progressBarClass}`}
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>

                <div
                  className={`mt-6 inline-flex items-center gap-4 rounded-2xl border px-5 py-4 shadow-[0_0_24px_rgba(239,68,68,0.12)] ${
                    isJourneyCompleted
                      ? "border-emerald-400/30 bg-emerald-500/10"
                      : "border-red-500/30 bg-red-500/10"
                  }`}
                >
                  <div
                    className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border text-xl ${
                      isJourneyCompleted
                        ? "border-emerald-400/30 bg-black/35"
                        : "border-red-500/30 bg-red-500/15"
                    }`}
                  >
                    {isJourneyCompleted ? (
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
                        isJourneyCompleted ? "text-emerald-300" : "text-red-300"
                      }`}
                    >
                      {objectiveLabel}
                    </p>

                    <p className="mt-1 text-lg font-black text-white">
                      {objectiveTitle}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[24px] border border-white/10 bg-zinc-950/80 p-6 shadow-xl">
            <p className="text-3xl">🏆</p>

            <p className="mt-4 text-3xl font-black text-white">
              {completedCount}/{totalAchievements}
            </p>

            <p className="text-sm text-white/45">Objetivos concluídos</p>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-zinc-950/80 p-6 shadow-xl">
            <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl border border-cyan-400/20 bg-black/35 text-3xl">
              {isJourneyCompleted ? (
                <FinalBadgeVisual
                  badge={finalBadge}
                  imageClassName="h-full w-full object-cover"
                  fallbackClassName="text-3xl"
                />
              ) : (
                "💎"
              )}
            </div>

            <p className="mt-4 whitespace-nowrap text-[26px] font-black leading-tight tracking-tight text-white">
              {dynamicMastery}
            </p>

            <p className="mt-1 text-sm text-white/45">Maestria</p>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-zinc-950/80 p-6 shadow-xl">
            <p className="text-3xl">⏱️</p>

            <p className="mt-4 text-3xl font-black text-white">{game.hours}</p>

            <p className="text-sm text-white/45">Horas jogadas</p>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-zinc-950/80 p-6 shadow-xl">
            <p className="text-3xl">
              {isJourneyCompleted
                ? "✅"
                : normalizeGameStatus(game.status) === "planned"
                ? "🎯"
                : "🔥"}
            </p>

            <p className="mt-4 text-3xl font-black text-white">
              {dynamicStatus}
            </p>

            <p className="text-sm text-white/45">Status</p>
          </div>
        </section>

        {emblemData && isCompletedByAchievements && (
          <div className="mt-5">
            <GameEmblemBlock emblem={emblemData} />
          </div>
        )}

        <GameAchievementsPanel
          slug={slug}
          achievements={achievements}
          onStatesChange={setManualStates}
        />

        <div
          id="review-section"
          ref={reviewSectionRef}
          className="mt-12 scroll-mt-28"
        >
          <GameReviewPanel
            slug={slug}
            review={manualReview}
            isUnlocked={reviewUnlocked}
            achievementsCompleted={completedCount}
            achievementsTotal={totalAchievements}
          />
        </div>
      </section>
    </main>
  );
}
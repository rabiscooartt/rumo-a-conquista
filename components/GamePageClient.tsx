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
        <div className="flex justify-center"><div className="group relative flex h-[260px] w-[260px] items-center justify-center overflow-visible"><div className="absolute inset-8 rounded-full bg-violet-500/10 blur-3xl transition-all duration-300 ease-out group-hover:scale-110 group-hover:bg-violet-400/20" />{emblem.image && !hasImageError ? (<img src={emblem.image} alt={`Emblema do Jogo - ${emblem.title}`} className="relative z-10 h-full w-full object-contain scale-[1.18] transition-[filter] duration-300 ease-out group-hover:drop-shadow-[0_0_18px_rgba(168,85,247,0.38)]" onError={() => setHasImageError(true)} />) : (<div className="relative z-10 flex h-full w-full scale-[1.18] items-center justify-center rounded-[34px] border border-violet-400/20 bg-black/25 text-6xl transition-[filter] duration-300 ease-out group-hover:drop-shadow-[0_0_18px_rgba(168,85,247,0.38)]">💠</div>)}</div></div>
        <div><p className="mb-2 text-xs font-bold uppercase tracking-[0.35em] text-violet-300">Emblema do Jogo</p><h2 className="text-3xl font-black text-white md:text-4xl">{emblem.title}</h2>{emblem.description && <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-300 md:text-base">{emblem.description}</p>}{emblem.tags.length > 0 && <div className="mt-5 flex flex-wrap gap-3">{emblem.tags.map((tag, index) => { const styles = ["border-violet-400/30 bg-violet-500/10 text-violet-200","border-amber-300/30 bg-amber-400/10 text-amber-200","border-sky-300/30 bg-sky-400/10 text-sky-200"]; return <span key={`${tag}-${index}`} className={`rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-wider ${styles[index % styles.length]}`}>{tag}</span>; })}</div>}</div>
      </div>
    </section>
  );
}

function ScorePill({ score }: { score: string }) {
  return <div className="mt-2 flex items-end gap-1"><span className="text-5xl font-black leading-none text-white">{score}</span><span className="pb-1 text-2xl font-black leading-none text-white/45">/10</span></div>;
}

export default function GamePageClient({ slug, game }: Props) {
  const reviewSectionRef = useRef<HTMLDivElement | null>(null);
  const achievements = Array.isArray(game.achievementsList) ? game.achievementsList : [];
  const defaultStates = useMemo(() => createDefaultStates(achievements), [achievements]);
  const defaultReview = useMemo(() => createDefaultReview(game.review), [game.review]);
  const [manualStates, setManualStates] = useState<Record<string, ManualAchievementState>>(defaultStates);
  const [manualReview, setManualReview] = useState<ManualReviewState>(defaultReview);

  useEffect(() => { setManualStates(defaultStates); }, [defaultStates]);
  useEffect(() => { setManualReview(defaultReview); }, [defaultReview]);

  useEffect(() => {
    function refreshData() { setManualStates(defaultStates); setManualReview(defaultReview); }
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
  }, [defaultReview, defaultStates]);

  function scrollToReview() {
    const reviewSection = reviewSectionRef.current ?? document.getElementById("review-section");
    if (!reviewSection) return;
    const headerOffset = 120;
    const reviewPosition = reviewSection.getBoundingClientRect().top + window.scrollY - headerOffset;
    window.scrollTo({ top: reviewPosition, behavior: "smooth" });
    window.history.replaceState(null, "", "#review-section");
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const shouldScrollToReview = window.location.hash === "#review-section" || params.get("review") === "1";
    if (!shouldScrollToReview) return;
    const timers = [150, 500, 900, 1300].map((delay) => window.setTimeout(() => scrollToReview(), delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const enhancedAchievements: EnhancedAchievement[] = achievements.map((achievement) => {
    const manualState = manualStates[achievement.title] ?? defaultStates[achievement.title] ?? ({ rank: getDefaultRank(achievement), status: normalizeAchievementStatus(achievement.status), date: toInputDate(achievement.earnedDate) } as ManualAchievementState);
    return { ...achievement, manualState };
  });

  const completedAchievements = enhancedAchievements.filter((achievement) => achievement.manualState.status === "completed");
  const progressAchievements = enhancedAchievements.filter((achievement) => achievement.manualState.status === "progress");
  const lockedAchievements = enhancedAchievements.filter((achievement) => achievement.manualState.status === "locked");
  const totalAchievements = enhancedAchievements.length;
  const completedCount = completedAchievements.length;
  const gameProgress = clampPercent(Number(game.progress) || 0);
  const isCompletedByStatus = isCompletedGame(game);
  const isCompletedByAchievements = totalAchievements > 0 && completedCount === totalAchievements;
  const isJourneyCompleted = isCompletedByStatus || isCompletedByAchievements;
  const finalBadge = getFinalBadgeFromAchievements({ slug, game, achievements: enhancedAchievements });
  const isHogwartsLegacyPage = normalizeText(slug).includes("hogwarts") || normalizeText(slug).includes("howgarts") || normalizeText(game.title).includes("hogwarts") || normalizeText(game.image).includes("hogwarts") || normalizeText(game.image).includes("howgarts") || normalizeText(game.cardImage).includes("hogwarts") || normalizeText(game.cardImage).includes("howgarts");
  const hogwartsFallbackEmblem: GameEmblemData = { title: "Legado Absoluto", image: "/images/games/howgarts-legacy/emblem.png", description: "Uma relíquia simbólica concedida ao bruxo que explorou Hogwarts por completo, dominou seus desafios e revelou todos os segredos deixados pelo legado mágico. O Legado Absoluto representa a conclusão definitiva da jornada e a marca de quem se tornou um verdadeiro guardião dessa história.", tags: ["Colecionável", "Emblema Especial", "Hogwarts Legacy"] };
  const emblemData = getGameEmblemData(slug, game) || (isHogwartsLegacyPage ? hogwartsFallbackEmblem : null);
  const progressByAchievements = totalAchievements > 0 ? Math.round((completedCount / totalAchievements) * 100) : 0;
  const progressPercent = isJourneyCompleted ? 100 : gameProgress > 0 ? gameProgress : progressByAchievements;
  const dynamicMastery = isJourneyCompleted ? finalBadge.title : readText(game.mastery, "Em andamento") || "Em andamento";
  const dynamicStatus = isJourneyCompleted ? "Finalizado" : getStatusLabel(game.status);
  const nextAchievement = progressAchievements[0] ?? lockedAchievements[0] ?? completedAchievements[completedAchievements.length - 1];
  const objectiveLabel = isJourneyCompleted ? "Maestria" : "Objetivo atual";
  const objectiveTitle = isJourneyCompleted ? finalBadge.title : readText(game.currentObjective || game.objective || game.nextMission, "") || nextAchievement?.title || "Definir próximo objetivo";
  const reviewScore = readText(manualReview.nota || game.review?.nota, "?");
  const hasReviewScore = reviewScore.trim() !== "" && reviewScore !== "?";
  const reviewUnlocked = isReviewReleased(manualReview) || isReviewReleased(game.review) || isJourneyCompleted || hasReviewScore;
  const coverImage = game.cardImage || game.image || "";
  const progressBarClass = isJourneyCompleted ? "bg-emerald-400 shadow-[0_0_18px_rgba(16,185,129,0.75)]" : "bg-red-500 shadow-[0_0_18px_rgba(239,68,68,0.75)]";

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <Navbar />
      <section className="mx-auto w-full max-w-[1700px] px-4 py-6 md:px-6 lg:px-8">
        <div className="mb-5"><Link href="/" className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-white/45 transition hover:text-red-400">← Voltar</Link></div>
        <div className="grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)_270px]">
          <aside className="hidden xl:block">
            <div className="sticky top-24 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/90 shadow-xl">
              <div className="aspect-[3/4] w-full overflow-hidden bg-black">
                {coverImage ? (
                  <img src={coverImage} alt={game.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs font-black uppercase tracking-widest text-white/25">Sem capa</div>
                )}
              </div>
              <div className="p-5">
                <span className={`inline-flex rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${
                  isJourneyCompleted ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300" : "border-red-500/30 bg-red-500/10 text-red-300"
                }`}>
                  {isJourneyCompleted ? "Finalizado" : getStatusLabel(game.status)}
                </span>
                <h1 className="mt-3 text-xl font-black leading-tight tracking-tight text-white">{game.title}</h1>
                <p className="mt-2 text-xs font-bold leading-relaxed text-white/40">{game.subtitle}</p>

                <div className="mt-5 border-t border-white/10 pt-5">
                  <div className="flex items-end justify-between">
                    <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/30">Progresso</span>
                    <span className={`text-lg font-black ${isJourneyCompleted ? "text-emerald-300" : "text-red-400"}`}>{progressPercent}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                    <div className={`h-full rounded-full ${progressBarClass}`} style={{ width: `${progressPercent}%` }} />
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-white/5 bg-white/[0.025] p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.12em] text-white/30">Conquistas</p>
                    <p className="mt-1 text-lg font-black text-white">{completedCount}<span className="text-white/25">/{totalAchievements}</span></p>
                  </div>
                  <div className="rounded-xl border border-white/5 bg-white/[0.025] p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.12em] text-white/30">Horas</p>
                    <p className="mt-1 text-lg font-black text-white">{game.hours}</p>
                  </div>
                </div>

                <div className="mt-2 rounded-xl border border-white/5 bg-white/[0.025] p-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.12em] text-white/30">Maestria</p>
                  <p className="mt-1 text-sm font-black text-white">{dynamicMastery}</p>
                </div>

                <nav className="mt-5 space-y-1 border-t border-white/10 pt-4">
                  <a href="#achievements" className="flex items-center gap-3 rounded-xl bg-red-500/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-red-300"><span>🏆</span>Conquistas</a>
                  <a href="#first-run" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-white/30 transition hover:bg-white/[0.04] hover:text-white"><span>▶</span>Primeira Run</a>
                  <a href="#mastery" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-white/30 transition hover:bg-white/[0.04] hover:text-white"><span>◆</span>Maestria</a>
                  <a href="#review-section" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-white/30 transition hover:bg-white/[0.04] hover:text-white"><span>✦</span>Review</a>
                  <a href="#gallery" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-white/30 transition hover:bg-white/[0.04] hover:text-white"><span>▦</span>Galeria</a>
                </nav>
              </div>
            </div>
          </aside>

          <div className="min-w-0">
            <section id="game-header" className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl">
              <div className="flex min-h-[148px] items-center gap-5 p-5 md:p-6">
                <div className="hidden h-[108px] w-[78px] shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/40 shadow-lg sm:block">
                  {coverImage ? <img src={coverImage} alt={game.title} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs font-black text-white/25">Sem capa</div>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className={`rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${isJourneyCompleted ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300" : "border-red-500/30 bg-red-500/10 text-red-300"}`}>{isJourneyCompleted ? "Finalizado" : getStatusLabel(game.status)}</span>
                    <span className="rounded-md border border-white/10 bg-white/[0.025] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white/45">{game.mastery || "Steam"}</span>
                  </div>
                  <h1 className="truncate text-2xl font-black leading-none tracking-tight text-white md:text-3xl">{game.title}</h1>
                  <p className="mt-2 truncate text-sm font-bold text-white/45 md:text-base">{game.subtitle}</p>
                  <div className="mt-4 flex items-center gap-4">
                    <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.18em] text-white/35">Progresso da jornada</span>
                    <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full ${progressBarClass}`} style={{ width: `${progressPercent}%` }} /></div>
                    <span className={`shrink-0 text-xs font-black ${isJourneyCompleted ? "text-emerald-300" : "text-red-400"}`}>{progressPercent}%</span>
                  </div>
                </div>
                <div className="hidden w-[150px] shrink-0 border-l border-white/10 pl-5 lg:block">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/30">Conquistas</p>
                  <p className="mt-1 text-2xl font-black text-white">{completedCount}<span className="text-white/30">/{totalAchievements}</span></p>
                  <p className="mt-1 text-[10px] font-black uppercase tracking-[0.16em] text-white/25">{game.hours} de jogo</p>
                </div>
              </div>
              <nav className="flex items-center gap-1 overflow-x-auto border-t border-white/10 px-3">
                <a href="#game-header" className="border-b-2 border-red-500 px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white">Visão Geral</a>
                <a href="#achievements" className="border-b-2 border-transparent px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white/40 transition hover:text-white">Conquistas</a>
                <a href="#first-run" className="border-b-2 border-transparent px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white/40 transition hover:text-white">Primeira Run</a>
                <a href="#mastery" className="border-b-2 border-transparent px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white/40 transition hover:text-white">Maestria</a>
                <a href="#review-section" className="border-b-2 border-transparent px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white/40 transition hover:text-white">Notas</a>
                <a href="#gallery" className="border-b-2 border-transparent px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white/40 transition hover:text-white">Galeria</a>
              </nav>
            </section>

            <section id="achievements" className="relative mt-6 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/80 p-5 md:p-6">
              <div className="mb-5 flex items-center gap-3"><span className="h-7 w-0.5 bg-red-500" /><div><h2 className="text-xl font-black uppercase tracking-tight text-white md:text-2xl">Conquistas</h2><p className="mt-1 text-xs text-white/35">Área principal do progresso deste jogo.</p></div></div>
              <GameAchievementsPanel slug={slug} achievements={achievements} onStatesChange={setManualStates} />
            </section>

            <section id="first-run" className="mt-6 rounded-2xl border border-dashed border-white/10 bg-zinc-950/50 p-6"><div className="flex items-center gap-3"><span className="h-7 w-0.5 bg-red-500" /><div><p className="text-[10px] font-black uppercase tracking-[0.28em] text-white/30">Próximo módulo</p><h2 className="mt-1 text-xl font-black text-white">First Run</h2><p className="mt-1 text-sm text-white/35">Estrutura preparada para a próxima etapa.</p></div></div></section>
            <section id="mastery" className="mt-6 rounded-2xl border border-dashed border-white/10 bg-zinc-950/50 p-6"><div className="flex items-center gap-3"><span className="h-7 w-0.5 bg-red-500" /><div><p className="text-[10px] font-black uppercase tracking-[0.28em] text-white/30">Próximo módulo</p><h2 className="mt-1 text-xl font-black text-white">Maestria</h2><p className="mt-1 text-sm text-white/35">Estrutura preparada para a próxima etapa.</p></div></div></section>
            <div id="review-section" ref={reviewSectionRef} className="mt-6 scroll-mt-28"><GameReviewPanel slug={slug} review={manualReview} isUnlocked={reviewUnlocked} achievementsCompleted={completedCount} achievementsTotal={totalAchievements} /></div>
            <section id="gallery" className="mt-6 rounded-2xl border border-dashed border-white/10 bg-zinc-950/50 p-6"><div className="flex items-center gap-3"><span className="h-7 w-0.5 bg-red-500" /><div><p className="text-[10px] font-black uppercase tracking-[0.28em] text-white/30">Próximo módulo</p><h2 className="mt-1 text-xl font-black text-white">Galeria</h2><p className="mt-1 text-sm text-white/35">Estrutura preparada para a próxima etapa.</p></div></div></section>
          </div>

          <aside className="hidden xl:block">
            <div className="sticky top-24 space-y-4">
              <section className="rounded-2xl border border-white/10 bg-zinc-950/90 p-5"><div className="mb-4 flex items-center gap-3"><span className="h-6 w-0.5 bg-red-500" /><h2 className="text-sm font-black uppercase tracking-[0.18em] text-white">Resumo</h2></div><div className="space-y-3"><div className="rounded-xl border border-white/5 bg-white/[0.025] p-3"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/30">Progresso</p><p className="mt-1 text-2xl font-black text-white">{progressPercent}%</p></div><div className="grid grid-cols-2 gap-3"><div className="rounded-xl border border-white/5 bg-white/[0.025] p-3"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-white/30">Conquistas</p><p className="mt-1 text-lg font-black text-white">{completedCount}/{totalAchievements}</p></div><div className="rounded-xl border border-white/5 bg-white/[0.025] p-3"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-white/30">Horas</p><p className="mt-1 text-lg font-black text-white">{game.hours}</p></div></div></div></section>
              <section className="rounded-2xl border border-white/10 bg-zinc-950/90 p-5"><div className="mb-4 flex items-center gap-3"><span className="h-6 w-0.5 bg-red-500" /><h2 className="text-sm font-black uppercase tracking-[0.18em] text-white">Objetivo atual</h2></div><div className="rounded-xl border border-red-500/15 bg-red-500/[0.04] p-4"><div className="mb-3 flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-red-500/20 bg-black/30">{isJourneyCompleted ? <FinalBadgeVisual badge={finalBadge} imageClassName="h-full w-full object-cover" fallbackClassName="text-lg" /> : "🎯"}</div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-300">{objectiveLabel}</p><p className="mt-2 text-sm font-black leading-snug text-white">{objectiveTitle}</p></div></section>
              <section className="rounded-2xl border border-white/10 bg-zinc-950/90 p-5"><div className="mb-4 flex items-center gap-3"><span className="h-6 w-0.5 bg-red-500" /><h2 className="text-sm font-black uppercase tracking-[0.18em] text-white">Status</h2></div><p className="text-2xl font-black text-white">{dynamicStatus}</p><p className="mt-1 text-xs text-white/35">{isJourneyCompleted ? "Jornada concluída" : "Jornada em andamento"}</p></section>
            </div>
          </aside>
        </div>
        {emblemData && isCompletedByAchievements && <div className="mt-6"><GameEmblemBlock emblem={emblemData} /></div>}
      </section>
    </main>
  );
}

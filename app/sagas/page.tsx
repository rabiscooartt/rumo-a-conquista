"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { useSiteGames } from "@/lib/useSiteGames";
import { type SiteSaga, useSiteSagas } from "@/lib/useSiteSagas";

type AccentTheme = {
  border: string;
  text: string;
  bg: string;
  progress: string;
  glow: string;
};

type EmblemFilter = "all" | "completed" | "locked";

type EmblemItem = {
  id: string;
  sagaSlug?: string;
  sagaTitle: string;
  gameSlug: string;
  gameTitle: string;
  title: string;
  image: string;
  fallbackIcon: string;
  progress: number;
  isCompleted: boolean;
  unlockedAt?: string;
};

type EmblemGroup = {
  key: string;
  title: string;
  subtitle: string;
  description: string;
  totalGames: number;
  completedGames: number;
  progress: number;
  isCompleted: boolean;
  theme: AccentTheme;
  emblems: EmblemItem[];
};

function getAccentTheme(accent: string): AccentTheme {
  if (accent === "cyan") {
    return {
      border: "border-cyan-400/35",
      text: "text-cyan-300",
      bg: "bg-cyan-500/10",
      progress: "bg-cyan-400",
      glow: "hover:shadow-[0_0_46px_rgba(34,211,238,0.14)]",
    };
  }

  if (accent === "yellow") {
    return {
      border: "border-yellow-400/35",
      text: "text-yellow-300",
      bg: "bg-yellow-500/10",
      progress: "bg-yellow-400",
      glow: "hover:shadow-[0_0_46px_rgba(250,204,21,0.14)]",
    };
  }

  if (accent === "purple") {
    return {
      border: "border-purple-400/35",
      text: "text-purple-300",
      bg: "bg-purple-500/10",
      progress: "bg-purple-400",
      glow: "hover:shadow-[0_0_46px_rgba(168,85,247,0.14)]",
    };
  }

  if (accent === "emerald") {
    return {
      border: "border-emerald-400/35",
      text: "text-emerald-300",
      bg: "bg-emerald-500/10",
      progress: "bg-emerald-400",
      glow: "hover:shadow-[0_0_46px_rgba(16,185,129,0.14)]",
    };
  }

  return {
    border: "border-red-500/35",
    text: "text-red-300",
    bg: "bg-red-500/10",
    progress: "bg-red-500",
    glow: "hover:shadow-[0_0_46px_rgba(239,68,68,0.16)]",
  };
}

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
    .split(/[\n,;]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeText(value: unknown) {
  return readText(value, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

function normalizeStatus(status?: string) {
  const value = normalizeText(status);

  if (
    value === "completed" ||
    value === "finalizado" ||
    value === "concluido" ||
    value === "concluida"
  ) {
    return "completed";
  }

  if (
    value === "planned" ||
    value === "planejado" ||
    value === "backlog" ||
    value === "futuro"
  ) {
    return "planned";
  }

  return "progress";
}

function normalizeDate(date?: string) {
  const value = readText(date, "").trim();

  if (!value) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
    const [day, month, year] = value.split("/");
    return `${year}-${month}-${day}`;
  }

  return "";
}

function formatDate(date?: string) {
  const normalizedDate = normalizeDate(date);

  if (!normalizedDate) {
    return "";
  }

  const [year, month, day] = normalizedDate.split("-");

  return `${day}/${month}/${year}`;
}

function getYearFromDate(date?: string) {
  const normalizedDate = normalizeDate(date);

  if (!normalizedDate) {
    return "";
  }

  return normalizedDate.slice(0, 4);
}


function getManualEmblemUnlockedAt(gameSlug: string) {
  if (gameSlug === "howgarts-legacy" || gameSlug === "hogwarts-legacy") {
    return "2026-03-17";
  }

  if (gameSlug === "crisol-theater-of-idols") {
    return "2026-04-09";
  }

  return "";
}

function isAchievementCompleted(achievement: unknown) {
  if (!achievement || typeof achievement !== "object") {
    return false;
  }

  const achievementRecord = achievement as { status?: string };
  const status = normalizeText(readText(achievementRecord.status, "locked"));

  return (
    status === "completed" ||
    status === "concluido" ||
    status === "concluida" ||
    status === "desbloqueado" ||
    status === "desbloqueada"
  );
}

function isGameCompleted(game: Record<string, unknown>) {
  const achievements = game.achievementsList;

  if (Array.isArray(achievements) && achievements.length > 0) {
    return achievements.every(isAchievementCompleted);
  }

  const status = normalizeStatus(readText(game.status, "progress"));
  const progress = clampPercent(Number(game.progress) || 0);

  return status === "completed" || progress >= 100;
}

function getGameProgress(game: Record<string, unknown>) {
  return clampPercent(Number(game.progress) || 0);
}

function getSagaGameSlugs(saga: SiteSaga) {
  return saga.stages.flatMap((stage) => stage.gameSlugs);
}

function hasExplicitEmblemData(game: Record<string, unknown>) {
  const emblem = game.emblem as
    | {
        title?: string;
        image?: string;
        description?: string;
        tags?: string[] | string;
        unlockedAt?: string;
        configured?: boolean;
      }
    | undefined;

  const finalBadge = game.finalBadge as
    | {
        title?: string;
        image?: string;
        icon?: string;
        unlockedAt?: string;
      }
    | undefined;

  const gameEmblem = game.gameEmblem as
    | {
        title?: string;
        image?: string;
        description?: string;
        tags?: string[] | string;
        unlockedAt?: string;
      }
    | undefined;

  return Boolean(
    readText(emblem?.title, "") ||
      readText(emblem?.image, "") ||
      readText(emblem?.description, "") ||
      readText(emblem?.unlockedAt, "") ||
      readStringList(emblem?.tags).length > 0 ||
      readText(game.emblemTitle, "") ||
      readText(game.emblemImage, "") ||
      readText(game.emblemDescription, "") ||
      readText(game.emblemUnlockedAt, "") ||
      readStringList(game.emblemTags).length > 0 ||
      readText(gameEmblem?.title, "") ||
      readText(gameEmblem?.image, "") ||
      readText(gameEmblem?.description, "") ||
      readText(gameEmblem?.unlockedAt, "") ||
      readStringList(gameEmblem?.tags).length > 0 ||
      readText(finalBadge?.title, "") ||
      readText(finalBadge?.image, "") ||
      readText(finalBadge?.unlockedAt, "")
  );
}

function shouldShowStandaloneGame(game: Record<string, unknown>) {
  return hasExplicitEmblemData(game) || isGameCompleted(game);
}

function getMasteryAchievementEarnedDate(game: Record<string, unknown>) {
  const achievements = Array.isArray(game.achievementsList)
    ? game.achievementsList
    : [];

  const masteryAchievement = achievements.find((value) => {
    if (!value || typeof value !== "object") return false;

    const achievement = value as Record<string, unknown>;
    if (!isAchievementCompleted(achievement)) return false;

    const title = normalizeText(achievement.title);
    const rank = normalizeText(achievement.difficulty ?? achievement.rank);

    return (
      rank.includes("diamante") ||
      title.includes("maestria") ||
      title.includes("mastery") ||
      title.includes("final") ||
      title.includes("casoencerrado")
    );
  }) as Record<string, unknown> | undefined;

  return readText(masteryAchievement?.earnedDate, "").trim();
}

function getGameEmblem(
  game: Record<string, unknown>,
  gameSlug: string,
  fallbackImage = ""
) {
  const emblem = game.emblem as
    | {
        title?: string;
        image?: string;
        description?: string;
        tags?: string[] | string;
        unlockedAt?: string;
        configured?: boolean;
      }
    | undefined;

  const finalBadge = game.finalBadge as
    | {
        title?: string;
        image?: string;
        icon?: string;
        unlockedAt?: string;
      }
    | undefined;

  const gameEmblem = game.gameEmblem as
    | {
        title?: string;
        image?: string;
        description?: string;
        tags?: string[] | string;
        unlockedAt?: string;
      }
    | undefined;

  // Quando o Emblema foi salvo no Admin, ele é a fonte de verdade.
  // Se a data atual estiver vazia, não reutilizamos uma data antiga da Maestria/lista manual.
  const currentAdminEmblem =
    emblem?.configured === true || game.emblemConfigured === true;
  const unlockedAt = currentAdminEmblem
    ? readText(emblem?.unlockedAt, "")
    : readText(emblem?.unlockedAt, "") ||
      readText(gameEmblem?.unlockedAt, "") ||
      readText(game.emblemUnlockedAt, "") ||
      readText(finalBadge?.unlockedAt, "") ||
      getMasteryAchievementEarnedDate(game) ||
      getManualEmblemUnlockedAt(gameSlug);

  if (
    gameSlug === "hogwarts-legacy" ||
    gameSlug === "howgarts-legacy" ||
    normalizeText(game.title).includes("hogwarts")
  ) {
    return {
      title:
        readText(emblem?.title, "") ||
        readText(gameEmblem?.title, "") ||
        readText(game.emblemTitle, "") ||
        "Legado Absoluto",
      image:
        readText(emblem?.image, "") ||
        readText(gameEmblem?.image, "") ||
        readText(game.emblemImage, "") ||
        "/images/games/howgarts-legacy/emblem.png",
      fallbackIcon: "💎",
      unlockedAt,
    };
  }

  const emblemTitle =
    readText(emblem?.title, "") ||
    readText(gameEmblem?.title, "") ||
    readText(game.emblemTitle, "") ||
    readText(finalBadge?.title, "") ||
    readText(game.title, "Emblema do Jogo");

  const emblemImage =
    readText(emblem?.image, "") ||
    readText(gameEmblem?.image, "") ||
    readText(game.emblemImage, "") ||
    readText(finalBadge?.image, "") ||
    fallbackImage ||
    `/images/games/${gameSlug}/emblem.png`;

  const fallbackIcon =
    readText(finalBadge?.icon, "") || readText(game.fallbackIcon, "") || "🏆";

  return {
    title: emblemTitle,
    image: emblemImage,
    fallbackIcon,
    unlockedAt,
  };
}

function BadgeImage({
  src,
  alt,
  fallbackIcon,
  isLarge = false,
}: {
  src?: string;
  alt: string;
  fallbackIcon: string;
  isLarge?: boolean;
}) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  if (!src || hasError) {
    return (
      <div
        className={`flex h-full w-full items-center justify-center ${
          isLarge ? "text-7xl" : "text-6xl"
        }`}
      >
        {fallbackIcon}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={`h-full w-full object-contain transition duration-300 ${
        isLarge ? "scale-[1.18]" : "scale-[1.14]"
      }`}
      onError={() => setHasError(true)}
    />
  );
}

function getFilterButtonClass(isActive: boolean) {
  return `rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.18em] transition ${
    isActive
      ? "border-red-500/45 bg-red-500/20 text-red-200 shadow-[0_0_24px_rgba(239,68,68,0.14)]"
      : "border-white/10 bg-white/[0.03] text-white/45 hover:border-white/20 hover:text-white"
  }`;
}

function EmptyMessage({
  activeFilter,
  hasSearch = false,
  activeYear = "all",
}: {
  activeFilter: EmblemFilter;
  hasSearch?: boolean;
  activeYear?: string;
}) {
  if (hasSearch) {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#08090c] p-10 text-center">
        <p className="text-base font-bold text-white">Nenhum emblema encontrado</p>
        <p className="mt-2 text-sm text-white/55">Tente outro nome de jogo ou franquia.</p>
      </div>
    );
  }

  if (activeYear !== "all" || activeFilter === "completed") {
    return (
      <div className="rounded-[24px] border border-white/10 bg-zinc-950/80 p-8 text-white/50">
        Nenhum emblema conquistado ainda.
      </div>
    );
  }

  if (activeFilter === "locked") {
    return (
      <div className="rounded-[24px] border border-white/10 bg-zinc-950/80 p-8 text-white/50">
        Nenhum emblema bloqueado no momento.
      </div>
    );
  }

  return (
    <div className="rounded-[24px] border border-white/10 bg-zinc-950/80 p-8 text-white/50">
      Nenhum emblema cadastrado no momento.
    </div>
  );
}

function EmblemCard({
  emblem,
  theme,
}: {
  emblem: EmblemItem;
  theme: AccentTheme;
}) {
  const isLocked = !emblem.isCompleted;
  const unlockedDate = formatDate(emblem.unlockedAt);

  return (
    <Link
      href={`/games/${emblem.gameSlug}`}
      id={`emblem-${emblem.gameSlug}`}
      aria-label={`${isLocked ? "Emblema bloqueado" : emblem.title} — ${emblem.gameTitle}`}
      className={`group relative flex h-full min-w-0 flex-col overflow-hidden rounded-[18px] border bg-[#08090c] text-left shadow-[0_12px_34px_rgba(0,0,0,0.22)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_18px_42px_rgba(0,0,0,0.42)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/70 ${
        isLocked
          ? "border-white/[0.11] hover:border-white/25"
          : `${theme.border} hover:border-red-400/55`
      }`}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-px bg-gradient-to-r from-transparent via-red-500/65 to-transparent opacity-70" />

      <div
        className={`relative isolate flex h-[205px] items-center justify-center overflow-hidden sm:h-[220px] lg:h-[230px] ${
          isLocked
            ? "bg-[radial-gradient(ellipse_at_50%_38%,rgba(255,255,255,0.07),transparent_62%),linear-gradient(180deg,#0c0c0f,#070708)]"
            : "bg-[radial-gradient(ellipse_at_50%_38%,rgba(239,68,68,0.16),transparent_62%),linear-gradient(180deg,#16090c,#080809)]"
        }`}
      >
        <div className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(rgba(255,255,255,0.11)_0.6px,transparent_0.7px)] [background-size:6px_6px]" />
        <div className="pointer-events-none absolute inset-x-6 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />

        <div
          className={`relative z-10 h-full w-full p-4 transition duration-300 group-hover:scale-[1.025] sm:p-5 ${
            isLocked
              ? "opacity-45 grayscale brightness-[0.7]"
              : "drop-shadow-[0_12px_18px_rgba(0,0,0,0.38)]"
          }`}
        >
          <BadgeImage
            src={emblem.image}
            alt={isLocked ? "Emblema bloqueado" : emblem.title}
            fallbackIcon={emblem.fallbackIcon}
          />
        </div>

        <div
          className={`absolute left-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.1em] backdrop-blur-md ${
            isLocked
              ? "border-white/[0.13] bg-black/75 text-white/55"
              : "border-emerald-400/30 bg-emerald-950/85 text-emerald-300"
          }`}
        >
          {isLocked ? (
            <svg viewBox="0 0 24 24" aria-label="Bloqueado" title="Bloqueado" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="10" width="14" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
          ) : (
            <>
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m5 12 4 4L19 6" />
              </svg>
              <span>Conquistado</span>
            </>
          )}
        </div>

        {isLocked ? (
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/80 text-white/65 shadow-xl backdrop-blur-sm">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="10" width="14" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col px-4 pb-4 pt-3.5">
        <h2 className={`line-clamp-2 min-h-[2.6em] text-center text-[17px] font-black leading-[1.3] tracking-tight transition-colors ${
          isLocked ? "text-white/55" : "text-white group-hover:text-red-100"
        }`}>
          {isLocked ? "Emblema bloqueado" : emblem.title}
        </h2>
        <p className={`mt-1 line-clamp-1 text-center text-[12px] font-semibold ${
          isLocked ? "text-white/45" : theme.text
        }`} title={emblem.gameTitle}>
          {emblem.gameTitle}
        </p>

        <div className="mt-auto pt-3">
          {unlockedDate && !isLocked ? (
            <div className="flex items-center justify-center gap-2 border-t border-white/[0.09] pt-3 text-[11px] font-bold text-white/55">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-emerald-300/85" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M16 3v4M8 3v4M3 10h18" />
              </svg>
              <span>Conquistado em</span>
              <time dateTime={normalizeDate(emblem.unlockedAt)} className="text-emerald-200/90">
                {unlockedDate}
              </time>
            </div>
          ) : (
            <div aria-hidden="true" className="h-[41px] border-t border-white/[0.07]" />
          )}
        </div>
      </div>
    </Link>
  );
}

export default function SagasPage() {
  const { sagasList, isLoaded } = useSiteSagas();
  const { gamesList, gamesMap } = useSiteGames();

  const [activeFilter, setActiveFilter] = useState<EmblemFilter>("all");
  const [activeYear, setActiveYear] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<"alphabetical" | "recent" | "oldest">("alphabetical");
  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setShowBackToTop(window.scrollY > 500);
    }

    handleScroll();

    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    const targetId = window.location.hash.slice(1);
    if (!targetId.startsWith("emblem-")) return;

    let cancelled = false;
    let attempts = 0;
    let timer: number | undefined;

    const findAndScrollToEmblem = () => {
      if (cancelled) return;

      const target = document.getElementById(targetId);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }

      attempts += 1;
      if (attempts < 50) {
        timer = window.setTimeout(findAndScrollToEmblem, 100);
      }
    };

    findAndScrollToEmblem();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  const emblemGroups = useMemo<EmblemGroup[]>(() => {
    const linkedGameSlugs = new Set(
      sagasList.flatMap((saga) => getSagaGameSlugs(saga))
    );

    const sagaGroups = sagasList.map((saga) => {
      const gameSlugs = getSagaGameSlugs(saga);

      const activeGameSlugs = gameSlugs.filter((slug) => Boolean(gamesMap[slug]));

      const emblems = activeGameSlugs
        .map((gameSlug) => {
          const game = gamesMap[gameSlug] as Record<string, unknown> | undefined;

          if (!game) return null;

          const emblem = getGameEmblem(game, gameSlug, saga.badgeImage);
          const progress = getGameProgress(game);
          const isCompleted = isGameCompleted(game);

          return {
            id: `${saga.slug}-${gameSlug}`,
            sagaSlug: saga.slug,
            sagaTitle: saga.title,
            gameSlug,
            gameTitle: readText(game.title, gameSlug),
            title: emblem.title,
            image: emblem.image,
            fallbackIcon: emblem.fallbackIcon,
            progress,
            isCompleted,
            unlockedAt: emblem.unlockedAt,
          } satisfies EmblemItem;
        })
        .filter(Boolean) as EmblemItem[];

      const totalGames = emblems.length;
      const completedGames = emblems.filter((emblem) => emblem.isCompleted).length;

      const progress =
        totalGames > 0 ? Math.round((completedGames / totalGames) * 100) : 0;

      const isCompleted = totalGames > 0 && completedGames === totalGames;

      return {
        key: `saga-${saga.slug}`,
        title: saga.title,
        subtitle: saga.subtitle || "",
        description: saga.description || "",
        totalGames,
        completedGames,
        progress,
        isCompleted,
        theme: getAccentTheme(String(saga.accent || "red")),
        emblems: emblems.sort((a, b) =>
          a.gameTitle.localeCompare(b.gameTitle, "pt-BR")
        ),
      } satisfies EmblemGroup;
    });

    const standaloneGroups = gamesList
      .filter((game) => {
        const gameSlug = readText(game.slug, "");

        if (!gameSlug) return false;
        if (linkedGameSlugs.has(gameSlug)) return false;

        return shouldShowStandaloneGame(game as unknown as Record<string, unknown>);
      })
      .map((game) => {
        const gameRecord = game as unknown as Record<string, unknown>;
        const gameSlug = readText(game.slug, "");
        const gameTitle = readText(game.title, gameSlug);
        const emblem = getGameEmblem(gameRecord, gameSlug);
        const progress = getGameProgress(gameRecord);
        const isCompleted = isGameCompleted(gameRecord);

        const item: EmblemItem = {
          id: `game-${gameSlug}`,
          sagaTitle: gameTitle,
          gameSlug,
          gameTitle,
          title: emblem.title,
          image: emblem.image,
          fallbackIcon: emblem.fallbackIcon,
          progress,
          isCompleted,
          unlockedAt: emblem.unlockedAt,
        };

        return {
          key: `game-${gameSlug}`,
          title: gameTitle,
          subtitle: readText(game.subtitle, ""),
          description:
            readText(
              (gameRecord.emblem as { description?: string } | undefined)
                ?.description,
              ""
            ) ||
            readText(gameRecord.emblemDescription, "") ||
            "Emblema individual deste jogo dentro da coleção Rumo à Conquista.",
          totalGames: 1,
          completedGames: isCompleted ? 1 : 0,
          progress,
          isCompleted,
          theme: getAccentTheme("red"),
          emblems: [item],
        } satisfies EmblemGroup;
      });

    return [...sagaGroups, ...standaloneGroups]
      .filter((group) => group.emblems.length > 0)
      .sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
  }, [sagasList, gamesMap, gamesList]);

  const allEmblems = emblemGroups.flatMap((group) => group.emblems);

  const totalEmblems = allEmblems.length;
  const completedEmblems = allEmblems.filter((emblem) => emblem.isCompleted).length;

  const totalProgress =
    totalEmblems > 0 ? Math.round((completedEmblems / totalEmblems) * 100) : 0;

  const emblemsByYear = Object.entries(
    allEmblems.reduce<Record<string, number>>((accumulator, emblem) => {
      if (!emblem.isCompleted) {
        return accumulator;
      }

      const year = getYearFromDate(emblem.unlockedAt);

      if (!year) {
        return accumulator;
      }

      accumulator[year] = (accumulator[year] || 0) + 1;

      return accumulator;
    }, {})
  )
    .map(([year, count]) => ({
      year,
      count,
    }))
    .sort((yearA, yearB) => Number(yearB.year) - Number(yearA.year));

  const filteredEmblems = useMemo(() => {
    const query = normalizeText(search);
    const items = emblemGroups.flatMap((group) =>
      group.emblems.map((emblem) => ({ emblem, theme: group.theme }))
    );

    return items
      .filter(({ emblem }) => {
        if (activeYear !== "all") {
          if (!emblem.isCompleted || getYearFromDate(emblem.unlockedAt) !== activeYear) {
            return false;
          }
        } else {
          if (activeFilter === "completed" && !emblem.isCompleted) return false;
          if (activeFilter === "locked" && emblem.isCompleted) return false;
        }

        if (!query) return true;

        const searchableText = [
          emblem.gameTitle,
          emblem.sagaTitle,
          emblem.isCompleted ? emblem.title : "",
        ].join(" ");

        return normalizeText(searchableText).includes(query);
      })
      .sort((a, b) => {
        if (sortOrder === "recent") {
          return normalizeDate(b.emblem.unlockedAt).localeCompare(normalizeDate(a.emblem.unlockedAt)) ||
            a.emblem.gameTitle.localeCompare(b.emblem.gameTitle, "pt-BR");
        }

        if (sortOrder === "oldest") {
          return normalizeDate(a.emblem.unlockedAt).localeCompare(normalizeDate(b.emblem.unlockedAt)) ||
            a.emblem.gameTitle.localeCompare(b.emblem.gameTitle, "pt-BR");
        }

        return a.emblem.gameTitle.localeCompare(b.emblem.gameTitle, "pt-BR");
      });
  }, [activeFilter, activeYear, emblemGroups, search, sortOrder]);

  function scrollToTop() {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  return (
    <main
      id="topo-emblemas"
      className="min-h-screen bg-[radial-gradient(circle_at_top,#0b1624_0%,#050505_45%,#020202_100%)] text-white"
    >
      <Navbar />

      {showBackToTop && (
        <button
          type="button"
          onClick={scrollToTop}
          className="fixed bottom-6 left-1/2 z-[9999] inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-red-500/35 bg-zinc-950/95 px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-red-200 shadow-[0_0_30px_rgba(239,68,68,0.22)] backdrop-blur-md transition hover:border-red-400/60 hover:bg-red-500/15 hover:text-red-100"
        >
          <span>↑</span>
          <span>Voltar ao topo</span>
        </button>
      )}

      <section className="mx-auto w-full max-w-[1540px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <header className="relative isolate overflow-hidden rounded-[20px] border border-red-500/20 bg-[#08090c] shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_12%_50%,rgba(239,68,68,0.17),transparent_42%),radial-gradient(ellipse_at_87%_20%,rgba(157,23,23,0.18),transparent_38%),linear-gradient(110deg,#100709_0%,#09090b_50%,#070809_100%)]" />
          <div className="pointer-events-none absolute inset-0 -z-10 opacity-40 [background-image:radial-gradient(rgba(255,255,255,0.13)_0.65px,transparent_0.8px)] [background-size:6px_6px]" />
          <div className="pointer-events-none absolute -right-10 -top-16 -z-10 h-[310px] w-[310px] rounded-full border border-red-500/15 sm:right-[250px] sm:h-[360px] sm:w-[360px]" />
          <div className="pointer-events-none absolute -right-2 top-1/2 -z-10 hidden -translate-y-1/2 text-red-500/[0.09] lg:block">
            <svg viewBox="0 0 280 280" aria-hidden="true" className="h-[280px] w-[280px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="140" cy="140" r="103" />
              <circle cx="140" cy="140" r="88" strokeDasharray="3 8" />
              <path d="M92 66h96v21a48 48 0 0 1-96 0V66Z" />
              <path d="M92 75H67a22 22 0 0 0 22 40M188 75h25a22 22 0 0 1-22 40M125 135v28h30v-28M110 163h60v13h-60zM97 195h86" />
              <path d="M56 204c-18-26-19-54-8-79 4 27 15 44 31 52M224 204c18-26 19-54 8-79-4 27-15 44-31 52" />
              <path d="m117 66 23-24 23 24" />
            </svg>
          </div>

          <div className="relative flex flex-col gap-6 px-5 py-6 sm:px-7 sm:py-7 lg:flex-row lg:items-center lg:justify-between lg:gap-8 lg:px-8">
            <div className="max-w-[720px]">
              <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.26em] text-red-400 sm:text-[11px]">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.8)]" />
                Acervo da jornada
              </div>
              <h1 className="text-[30px] font-black leading-[1.06] tracking-tight text-white sm:text-[38px] lg:text-[42px]">
                Coleção de <span className="text-red-500">Emblemas</span>
              </h1>
              <p className="mt-3 max-w-[600px] text-[13px] leading-relaxed text-white/65 sm:text-sm">
                Cada emblema marca uma conquista da sua jornada. Veja o que já foi revelado e o que ainda aguarda por você.
              </p>
            </div>

            <div className="w-full shrink-0 rounded-[16px] border border-white/[0.11] bg-black/45 p-4 shadow-inner backdrop-blur-sm sm:p-5 lg:max-w-[310px]">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.17em] text-white/55">
                    Progresso da coleção
                  </p>
                  <p className="mt-2 text-[35px] font-black leading-none tracking-tight text-white sm:text-[38px]">
                    {totalProgress}<span className="ml-1 text-lg font-bold text-red-400">%</span>
                  </p>
                </div>
                <p className="pb-1 text-right text-[12px] font-semibold text-white/60">
                  <span className="block text-[18px] font-black text-white">{completedEmblems}<span className="mx-1 text-white/35">/</span>{totalEmblems}</span>
                  emblemas
                </p>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.09]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-red-700 via-red-500 to-red-400 shadow-[0_0_14px_rgba(239,68,68,0.45)] transition-all duration-500"
                  style={{ width: `${totalProgress}%` }}
                />
              </div>
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-red-500/50 to-transparent" />
        </header>

        <section className="mt-4 rounded-[18px] border border-white/[0.09] bg-[#08090c]/95 p-3 sm:mt-5 sm:p-4">
          <div className="grid gap-3 2xl:grid-cols-[minmax(270px,1fr)_auto_auto] 2xl:items-center">
            <div className="relative min-w-0">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-4-4" />
              </svg>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por jogo, emblema ou franquia..."
                aria-label="Buscar emblemas"
                className="w-full rounded-xl border border-white/[0.12] bg-black/35 py-3 pl-10 pr-10 text-[12px] font-semibold text-white outline-none transition placeholder:text-white/35 focus:border-red-500/50 focus:ring-2 focus:ring-red-500/15 sm:text-[13px]"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Limpar busca"
                  title="Limpar busca"
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-1.5 py-1 text-sm font-bold text-white/50 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
                >
                  ×
                </button>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => { setActiveFilter("all"); setActiveYear("all"); }}
                aria-pressed={activeFilter === "all" && activeYear === "all"}
                className={getFilterButtonClass(activeFilter === "all" && activeYear === "all")}
              >
                Todos
              </button>
              <button
                type="button"
                onClick={() => { setActiveFilter("completed"); setActiveYear("all"); }}
                aria-pressed={activeFilter === "completed" && activeYear === "all"}
                className={getFilterButtonClass(activeFilter === "completed" && activeYear === "all")}
              >
                Conquistados
              </button>
              <button
                type="button"
                onClick={() => { setActiveFilter("locked"); setActiveYear("all"); }}
                aria-pressed={activeFilter === "locked" && activeYear === "all"}
                className={getFilterButtonClass(activeFilter === "locked" && activeYear === "all")}
              >
                Bloqueados
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <label className="sr-only" htmlFor="emblem-year-filter">Ano da conquista</label>
              <select
                id="emblem-year-filter"
                value={activeYear}
                onChange={(event) => {
                  const year = event.target.value;
                  setActiveYear(year);
                  setActiveFilter(year === "all" ? "all" : "completed");
                }}
                aria-label="Filtrar por ano da conquista"
                className="min-w-0 rounded-xl border border-white/[0.12] bg-[#0b0c0f] px-3 py-3 text-[11px] font-bold text-white/75 outline-none transition focus:border-red-500/50 focus:ring-2 focus:ring-red-500/15 sm:text-[12px]"
              >
                <option value="all">Todos os anos</option>
                {emblemsByYear.map(({ year }) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
              <label className="sr-only" htmlFor="emblem-sort">Ordenar emblemas</label>
              <select
                id="emblem-sort"
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value as "alphabetical" | "recent" | "oldest")}
                aria-label="Ordenar emblemas"
                className="min-w-0 rounded-xl border border-white/[0.12] bg-[#0b0c0f] px-3 py-3 text-[11px] font-bold text-white/75 outline-none transition focus:border-red-500/50 focus:ring-2 focus:ring-red-500/15 sm:text-[12px]"
              >
                <option value="alphabetical">Ordem: A–Z</option>
                <option value="recent">Mais recentes</option>
                <option value="oldest">Mais antigos</option>
              </select>
            </div>
          </div>

          {(activeYear !== "all" || search) ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] pt-3 text-[11px] text-white/50">
              <p>
                {filteredEmblems.length} {filteredEmblems.length === 1 ? "resultado" : "resultados"}
                {activeYear !== "all" ? ` • Conquistas de ${activeYear}` : ""}
              </p>
              <button
                type="button"
                onClick={() => { setSearch(""); setActiveYear("all"); setActiveFilter("all"); }}
                className="font-bold text-red-300 transition hover:text-red-200"
              >
                Limpar filtros
              </button>
            </div>
          ) : null}
        </section>

        <section className="mt-4 sm:mt-5">
          {!isLoaded ? (
            <div className="rounded-2xl border border-white/10 bg-[#08090c] p-8 text-center text-sm text-white/55">
              Carregando emblemas...
            </div>
          ) : filteredEmblems.length === 0 ? (
            <EmptyMessage
              activeFilter={activeFilter}
              hasSearch={Boolean(search)}
              activeYear={activeYear}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 2xl:gap-5">
              {filteredEmblems.map(({ emblem, theme }) => (
                <EmblemCard key={emblem.id} emblem={emblem} theme={theme} />
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

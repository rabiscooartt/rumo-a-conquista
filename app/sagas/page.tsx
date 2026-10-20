"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import BannerBackground from "@/components/BannerBackground";
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

type BadgeImageBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type LoadedBadgeImage = {
  src: string;
  width: number;
  height: number;
  bounds: BadgeImageBounds;
};

const FULL_BADGE_BOUNDS: BadgeImageBounds = {
  left: 0,
  top: 0,
  right: 1,
  bottom: 1,
};

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedImage, setLoadedImage] = useState<LoadedBadgeImage | null>(null);
  const [boxSize, setBoxSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const rect = container.getBoundingClientRect();
      setBoxSize((previous) =>
        Math.abs(previous.width - rect.width) < 1 &&
        Math.abs(previous.height - rect.height) < 1
          ? previous
          : { width: rect.width, height: rect.height }
      );
    };

    const initialMeasure = window.requestAnimationFrame(measure);

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => {
        window.cancelAnimationFrame(initialMeasure);
        window.removeEventListener("resize", measure);
      };
    }

    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => {
      window.cancelAnimationFrame(initialMeasure);
      observer.disconnect();
    };
  }, []);

  const hasError = Boolean(src && failedSrc === src);
  const imageForCurrentSource =
    src && loadedImage?.src === src ? loadedImage : null;
  const hasLayout =
    Boolean(imageForCurrentSource) && boxSize.width > 0 && boxSize.height > 0;
  const contentBounds = imageForCurrentSource?.bounds ?? FULL_BADGE_BOUNDS;
  const naturalWidth = imageForCurrentSource?.width ?? 0;
  const naturalHeight = imageForCurrentSource?.height ?? 0;

  const visibleWidth = Math.max(
    0.01,
    (contentBounds.right - contentBounds.left) * naturalWidth
  );
  const visibleHeight = Math.max(
    0.01,
    (contentBounds.bottom - contentBounds.top) * naturalHeight
  );

  // The panel hugs the visible artwork with a small, consistent inner gap.
  // Its width changes with the art's visible aspect ratio.
  const artPadding = 6;
  const scale = hasLayout
    ? Math.min(
        Math.max(1, boxSize.width - artPadding * 2) / visibleWidth,
        Math.max(1, boxSize.height - artPadding * 2) / visibleHeight
      )
    : 1;

  const renderedWidth = naturalWidth * scale;
  const renderedHeight = naturalHeight * scale;
  const panelWidth = visibleWidth * scale + artPadding * 2;
  const panelHeight = visibleHeight * scale + artPadding * 2;
  const offsetX = artPadding - contentBounds.left * renderedWidth;
  const offsetY = artPadding - contentBounds.top * renderedHeight;

  return (
    <div
      ref={containerRef}
      className="relative z-10 flex h-full w-full items-center justify-center overflow-visible bg-[radial-gradient(ellipse_at_center,rgba(175,157,128,0.075)_0%,rgba(130,118,100,0.025)_38%,transparent_72%)]"
    >
      {!src || hasError ? (
        <div
          className={
            "flex h-full w-full items-center justify-center " +
            (isLarge ? "text-7xl" : "text-6xl")
          }
        >
          {fallbackIcon}
        </div>
      ) : (
        <div
          className="relative shrink-0 overflow-visible rounded-[12px] border border-transparent bg-transparent shadow-none transition-colors duration-300"
          style={{
            width: hasLayout ? panelWidth : "100%",
            height: hasLayout ? panelHeight : "100%",
            maxWidth: "100%",
            maxHeight: "100%",
          }}
        >
          <img
            src={src}
            alt={alt}
            draggable={false}
            className="block transition duration-300"
            style={{
              position: "absolute",
              width: hasLayout ? renderedWidth : "100%",
              height: hasLayout ? renderedHeight : "100%",
              left: hasLayout ? offsetX : 0,
              top: hasLayout ? offsetY : 0,
              maxWidth: "none",
              maxHeight: "none",
              objectFit: hasLayout ? "fill" : "contain",
            }}
            onLoad={(event) => {
              const image = event.currentTarget;
              const width = image.naturalWidth;
              const height = image.naturalHeight;
              if (!width || !height || !src) return;

              let nextBounds = FULL_BADGE_BOUNDS;

              // Inspect a reduced same-origin canvas for transparent margins.
              // The source image itself is never edited or replaced.
              try {
                const imageUrl = new URL(
                  image.currentSrc || image.src,
                  window.location.href
                );
                if (imageUrl.origin === window.location.origin) {
                  const reduction = Math.min(1, 192 / Math.max(width, height));
                  const scanWidth = Math.max(1, Math.round(width * reduction));
                  const scanHeight = Math.max(1, Math.round(height * reduction));
                  const canvas = document.createElement("canvas");
                  canvas.width = scanWidth;
                  canvas.height = scanHeight;
                  const context = canvas.getContext("2d", {
                    willReadFrequently: true,
                  });
                  if (context) {
                    context.drawImage(image, 0, 0, scanWidth, scanHeight);
                    const pixels = context.getImageData(
                      0,
                      0,
                      scanWidth,
                      scanHeight
                    ).data;
                    let minX = scanWidth;
                    let minY = scanHeight;
                    let maxX = -1;
                    let maxY = -1;

                    for (let y = 0; y < scanHeight; y += 1) {
                      for (let x = 0; x < scanWidth; x += 1) {
                        if (pixels[(y * scanWidth + x) * 4 + 3] > 0) {
                          if (x < minX) minX = x;
                          if (x > maxX) maxX = x;
                          if (y < minY) minY = y;
                          if (y > maxY) maxY = y;
                        }
                      }
                    }

                    if (maxX >= minX && maxY >= minY) {
                      nextBounds = {
                        left: minX / scanWidth,
                        top: minY / scanHeight,
                        right: (maxX + 1) / scanWidth,
                        bottom: (maxY + 1) / scanHeight,
                      };
                    }
                  }
                }
              } catch {
                // Keep full-image bounds if inspection is unavailable.
              }

              setLoadedImage({ src, width, height, bounds: nextBounds });
            }}
            onError={() => setFailedSrc(src)}
          />
        </div>
      )}
    </div>
  );
}

function getFilterButtonClass(isActive: boolean) {
  return `rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.18em] transition ${
    isActive
      ? "border-red-500/45 bg-red-500/20 text-red-200 shadow-[0_0_24px_rgba(239,68,68,0.14)]"
      : "border-white/10 bg-white/[0.03] text-white/45 hover:border-white/20 hover:text-white"
  }`;
}

function EmptyMessage({ activeFilter }: { activeFilter: EmblemFilter }) {
  if (activeFilter === "completed") {
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
  isLarge = false,
}: {
  emblem: EmblemItem;
  theme: AccentTheme;
  isLarge?: boolean;
}) {
  const isLocked = !emblem.isCompleted;
  const unlockedDate = formatDate(emblem.unlockedAt);

  return (
    <Link
      href={`/games/${emblem.gameSlug}`}
      id={`emblem-${emblem.gameSlug}`}
      className={`group relative flex h-full min-h-[405px] w-full min-w-0 flex-col scroll-mt-24 overflow-visible rounded-[8px] border border-transparent px-3 pb-3 pt-2 text-center transition duration-300 hover:-translate-y-1 ${
        isLocked
          ? "bg-transparent hover:bg-white/[0.018] hover:shadow-[0_10px_28px_rgba(0,0,0,0.18)]"
          : "bg-transparent hover:bg-red-950/[0.045] hover:shadow-[0_0_24px_rgba(239,68,68,0.045)]"
      } ${isLarge ? "max-w-[380px]" : ""}`}
    >
      <div className="flex h-6 shrink-0 items-center justify-end pb-0">
        <span
          className={`inline-flex h-5 shrink-0 items-center justify-center gap-1 rounded-full border px-2 text-[7px] font-black uppercase tracking-[0.08em] ${
            isLocked
              ? "border-white/20 bg-black/25 text-white/55"
              : "border-emerald-400/35 bg-emerald-950/35 text-emerald-300/90"
          }`}
        >
          {isLocked ? (
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="10" width="14" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12 4 4L19 6" />
            </svg>
          )}
          {isLocked ? "Bloqueado" : "Conquistado"}
        </span>
      </div>

      <div
        className={`relative mx-auto mt-1 flex w-full shrink-0 items-center justify-center overflow-hidden ${
          isLarge ? "h-[300px]" : "h-[270px] sm:h-[285px] lg:h-[300px]"
        }`}
      >
        <div
          className={`h-full w-full transition duration-300 ${
            isLocked
              ? "scale-100 opacity-70 blur-[0.5px] grayscale saturate-0 brightness-[0.72]"
              : "group-hover:brightness-110"
          }`}
        >
          <BadgeImage
            src={emblem.image}
            alt={emblem.title}
            fallbackIcon={emblem.fallbackIcon}
            isLarge={isLarge}
          />
        </div>
      </div>

      <h3
        className={`mt-1 min-h-[30px] w-full line-clamp-2 font-serif text-[16px] font-bold uppercase leading-tight tracking-[0.025em] ${
          isLarge ? "text-lg" : ""
        } ${isLocked ? "text-white/75" : "text-white"}`}
      >
        {emblem.title}
      </h3>

      <div className="mt-0.5 flex shrink-0 items-center justify-center gap-2" aria-hidden="true">
        <span className={`h-px w-8 ${isLocked ? "bg-white/20" : "bg-amber-500/55"}`} />
        <span className={`text-[9px] ${isLocked ? "text-white/35" : "text-amber-400/75"}`}>◆</span>
        <span className={`h-px w-8 ${isLocked ? "bg-white/20" : "bg-amber-500/55"}`} />
      </div>

      <p
        className={`mt-0.5 w-full truncate text-[11px] font-semibold ${
          isLocked ? "text-white/50" : theme.text
        }`}
      >
        {emblem.gameTitle}
      </p>

      <div className="mt-auto pt-3">
        {emblem.isCompleted && unlockedDate ? (
          <time
            dateTime={normalizeDate(emblem.unlockedAt)}
            className="mx-auto inline-flex h-8 w-fit max-w-full items-center justify-center gap-2 whitespace-nowrap rounded-full border border-emerald-500/45 bg-emerald-950/45 px-3 text-[11px] font-black tracking-[0.02em] text-cyan-300"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M16 3v4M8 3v4M3 10h18" />
            </svg>
            {unlockedDate}
          </time>
        ) : (
          <div className="mx-auto inline-flex h-8 w-fit max-w-full items-center justify-center gap-2 whitespace-nowrap rounded-full border border-white/[0.10] bg-white/[0.035] px-3 text-[10px] font-semibold text-white/45">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="10" width="14" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
            Em progresso no futuro
          </div>
        )}
      </div>
    </Link>
  );
}

function EmblemGroupCard({ group }: { group: EmblemGroup }) {
  const hasSingleEmblem = group.emblems.length === 1;
  const unlockedEmblem = group.emblems.find(
    (emblem) => emblem.isCompleted && emblem.unlockedAt
  );
  const unlockedDate = formatDate(unlockedEmblem?.unlockedAt);

  return (
    <article
      className={`group/card overflow-hidden rounded-[30px] border bg-zinc-950/75 p-5 shadow-xl transition hover:-translate-y-1 hover:border-white/20 ${
        group.isCompleted
          ? `${group.theme.border} ${group.theme.glow}`
          : "border-white/10"
      }`}
    >
      <div className="border-b border-white/10 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-white/30">
              Franquia / Jogo
            </p>

            <h2 className="mt-1 line-clamp-1 text-2xl font-black text-white">
              {group.title}
            </h2>
          </div>

          {unlockedDate ? (
            <div className="shrink-0 pt-1 text-right">
              <p className="text-[8px] font-black uppercase tracking-[0.22em] text-emerald-300/45">
                Conquistado
              </p>

              <time
                dateTime={unlockedEmblem?.unlockedAt}
                className="mt-1 block text-xs font-black tracking-[0.08em] text-emerald-200/70"
              >
                {unlockedDate}
              </time>
            </div>
          ) : null}
        </div>

        {group.subtitle && (
          <p className={`mt-1 line-clamp-1 text-xs font-bold ${group.theme.text}`}>
            {group.subtitle}
          </p>
        )}
      </div>

      <div
        className={
          hasSingleEmblem
            ? "mt-5 flex justify-center"
            : "mt-5 grid grid-cols-2 gap-4"
        }
      >
        {group.emblems.map((emblem) => (
          <EmblemCard
            key={emblem.id}
            emblem={emblem}
            theme={group.theme}
            isLarge={hasSingleEmblem}
          />
        ))}
      </div>
    </article>
  );
}

export default function SagasPage() {
  const { sagasList, isLoaded } = useSiteSagas();
  const { gamesList, gamesMap } = useSiteGames();

  const [activeFilter, setActiveFilter] = useState<EmblemFilter>("all");
  const [activeYear, setActiveYear] = useState<string>("all");
  const [yearInput, setYearInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<"alphabetical" | "recent">("alphabetical");
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
  const lockedEmblems = totalEmblems - completedEmblems;

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

  const activeYearEmblemsCount =
    activeYear === "all"
      ? completedEmblems
      : emblemsByYear.find((item) => item.year === activeYear)?.count || 0;

  const filteredGroups = useMemo(() => {
    const shouldSortByConquestDate =
      activeYear !== "all" || activeFilter === "completed";

    const groups = emblemGroups
      .map((group) => {
        const emblems = group.emblems
          .filter((emblem) => {
            if (activeYear !== "all") {
              return (
                emblem.isCompleted &&
                getYearFromDate(emblem.unlockedAt) === activeYear
              );
            }

            if (activeFilter === "completed") return emblem.isCompleted;
            if (activeFilter === "locked") return !emblem.isCompleted;

            return true;
          })
          .sort((emblemA, emblemB) => {
            if (!shouldSortByConquestDate) {
              return 0;
            }

            return normalizeDate(emblemB.unlockedAt).localeCompare(
              normalizeDate(emblemA.unlockedAt)
            );
          });

        return {
          ...group,
          emblems,
        };
      })
      .filter((group) => group.emblems.length > 0);

    if (!shouldSortByConquestDate) {
      return groups;
    }

    return groups.sort((groupA, groupB) => {
      const firstDateA = normalizeDate(groupA.emblems[0]?.unlockedAt);
      const firstDateB = normalizeDate(groupB.emblems[0]?.unlockedAt);

      return firstDateB.localeCompare(firstDateA);
    });
  }, [activeFilter, activeYear, emblemGroups]);

  const filteredEmblems = useMemo(() => {
    const query = normalizeText(searchQuery);
    const items = filteredGroups.flatMap((group) =>
      group.emblems
        .filter((emblem) => {
          if (!query) return true;
          return normalizeText(
            `${emblem.title} ${emblem.gameTitle} ${emblem.sagaTitle}`
          ).includes(query);
        })
        .map((emblem) => ({ emblem, theme: group.theme }))
    );

    return items.sort((a, b) => {
      if (sortOrder === "recent") {
        return normalizeDate(b.emblem.unlockedAt).localeCompare(
          normalizeDate(a.emblem.unlockedAt)
        );
      }

      return a.emblem.gameTitle.localeCompare(b.emblem.gameTitle, "pt-BR");
    });
  }, [filteredGroups, searchQuery, sortOrder]);

  function applyYearFilter(year: string) {
    const normalizedYear = year.trim();

    if (!/^\d{4}$/.test(normalizedYear)) {
      alert("Digite um ano com 4 números. Ex: 2026");
      return;
    }

    setActiveYear(normalizedYear);
    setActiveFilter("completed");
  }

  function clearYearFilter() {
    setActiveYear("all");
    setYearInput("");
    setActiveFilter("all");
  }

  function scrollToTop() {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  return (
    <main
      id="topo-emblemas"
      className="min-h-screen bg-[radial-gradient(ellipse_at_center,#141310_0%,#070706_48%,#020202_100%)] text-white"
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

      <section className="mx-auto w-full max-w-[1780px] px-4 pb-6 pt-3 sm:px-6 lg:px-8 lg:pb-8 lg:pt-4">
        <div className="min-w-0">
        <header className="relative isolate mt-1 min-h-[220px] overflow-hidden rounded-[14px] border border-white/10 bg-[#050505] shadow-[0_18px_55px_rgba(0,0,0,0.38)] lg:min-h-[224px]">
          <BannerBackground
            bannerKey="emblemas"
            imageUrl="/images/emblems-hero.webp"
            className="z-0"
            adminButtonClassName="!top-0"
          />
          <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,2,3,0.96)_0%,rgba(2,2,3,0.78)_27%,rgba(2,2,3,0.18)_54%,rgba(2,2,3,0.30)_73%,rgba(2,2,3,0.86)_100%)]" />
          <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(0deg,rgba(0,0,0,0.5),transparent_45%,rgba(0,0,0,0.08))]" />

          <div className="relative z-10 flex min-h-[220px] flex-col justify-between gap-5 p-5 sm:p-6 lg:min-h-[224px] lg:flex-row lg:items-center lg:gap-8 lg:px-7">
            <div className="min-w-0 max-w-[760px] border-l-[4px] border-red-500 pl-4 sm:pl-5">
              <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.28em] text-white/80">
                <span className="text-red-500">◆</span>
                Emblemas
              </p>
              <h1 className="mt-3 text-2xl font-black uppercase leading-[1.06] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.9)] sm:text-3xl lg:text-[38px]">
                Coleção de <span className="text-red-500">Emblemas</span>
              </h1>
              <p className="mt-3 max-w-[620px] text-xs leading-relaxed text-white/65 sm:text-sm">
                Galeria das franquias, sagas e jogos especiais do projeto.
                Cada emblema representa uma jornada concluída.
              </p>
            </div>

            <div className="w-full shrink-0 rounded-[18px] border border-white/10 bg-[#07080b]/90 p-4 shadow-[0_14px_40px_rgba(0,0,0,0.55)] backdrop-blur-md sm:max-w-[310px] lg:w-[292px]">
              <p className="text-[10px] font-black uppercase tracking-[0.17em] text-white/75">
                Progresso da coleção
              </p>
              <div className="mt-3 flex items-center gap-4">
                <div
                  className="flex h-[86px] w-[86px] shrink-0 items-center justify-center rounded-full p-[7px]"
                  style={{
                    background: `conic-gradient(#f21d2f ${totalProgress}%, rgba(255,255,255,0.12) ${totalProgress}% 100%)`,
                  }}
                  aria-label={`${totalProgress}% da coleção conquistada`}
                >
                  <div className="flex h-full w-full items-center justify-center rounded-full bg-[#08090c] text-xl font-black text-white">
                    {totalProgress}%
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-2xl font-black leading-none text-white">
                    {completedEmblems} <span className="text-white/35">/ {totalEmblems}</span>
                  </p>
                  <p className="mt-2 text-[11px] font-medium text-white/60">
                    Emblemas conquistados
                  </p>
                  <div className="mt-3 h-[7px] overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-red-500 shadow-[0_0_12px_rgba(239,29,47,0.48)] transition-all duration-500"
                      style={{ width: `${totalProgress}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        <section className="mt-3 rounded-[14px] border border-white/10 bg-[linear-gradient(105deg,rgba(7,7,8,0.98),rgba(13,13,16,0.96),rgba(5,5,5,0.98))] p-3 shadow-[0_12px_32px_rgba(0,0,0,0.25)]">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <label className="relative min-w-0 flex-1 xl:min-w-[220px]">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg text-white/35" aria-hidden="true">⌕</span>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Buscar emblema por jogo, franquia ou saga..."
                aria-label="Buscar emblema por jogo, franquia ou saga"
                className="h-[42px] w-full rounded-[10px] border border-white/15 bg-black/55 pl-10 pr-4 text-xs font-medium text-white outline-none transition placeholder:text-white/35 hover:border-white/25 focus:border-red-500/60 focus:ring-2 focus:ring-red-500/10"
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex h-[40px] overflow-hidden rounded-full border border-white/10 bg-black/45">
                <input
                  value={yearInput}
                  onChange={(event) => {
                    const onlyNumbers = event.target.value.replace(/\D/g, "").slice(0, 4);
                    setYearInput(onlyNumbers);
                    if (onlyNumbers.length === 4) applyYearFilter(onlyNumbers);
                    if (onlyNumbers.length === 0) clearYearFilter();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") applyYearFilter(yearInput);
                  }}
                  placeholder="Ano"
                  inputMode="numeric"
                  aria-label="Filtrar por ano"
                  className="w-[62px] bg-transparent px-3 text-xs font-bold text-white outline-none placeholder:text-white/35"
                />
                <button
                  type="button"
                  onClick={() => applyYearFilter(yearInput)}
                  className="border-l border-red-500/25 bg-red-500/10 px-3 text-xs text-red-200 transition hover:bg-red-500/20"
                  aria-label="Aplicar filtro de ano"
                  title="Filtrar por ano"
                >
                  🔎
                </button>
              </div>

              {activeYear !== "all" && (
                <button
                  type="button"
                  onClick={clearYearFilter}
                  className="rounded-full border border-emerald-400/25 bg-emerald-500/[0.08] px-3 py-2 text-[10px] font-black text-emerald-200 transition hover:bg-emerald-500/[0.14]"
                >
                  {activeYear} ×
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setActiveFilter("all");
                  setActiveYear("all");
                  setYearInput("");
                }}
                className={getFilterButtonClass(activeFilter === "all" && activeYear === "all")}
              >
                ▦&nbsp; Todos ({totalEmblems})
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveFilter("completed");
                  setActiveYear("all");
                  setYearInput("");
                }}
                className={getFilterButtonClass(activeFilter === "completed" && activeYear === "all")}
              >
                🏆&nbsp; Conquistados ({completedEmblems})
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveFilter("locked");
                  setActiveYear("all");
                  setYearInput("");
                }}
                className={getFilterButtonClass(activeFilter === "locked" && activeYear === "all")}
              >
                🔒&nbsp; Bloqueados ({lockedEmblems})
              </button>

              <label className="flex h-[40px] items-center gap-2 rounded-[10px] border border-white/10 bg-black/35 px-3 text-white/50 xl:ml-1">
                <span aria-hidden="true" className="text-sm">↕</span>
                <span className="whitespace-nowrap text-[10px] font-black uppercase tracking-[0.08em] text-white/65">Ordem:</span>
                <select
                  value={sortOrder}
                  onChange={(event) => setSortOrder(event.target.value as "alphabetical" | "recent")}
                  aria-label="Ordenar emblemas"
                  className="max-w-[135px] bg-transparent text-[10px] font-bold text-white outline-none"
                >
                  <option value="alphabetical" className="bg-zinc-950">Alfabética</option>
                  <option value="recent" className="bg-zinc-950">Mais recentes</option>
                </select>
              </label>
            </div>
          </div>
        </section>

        <section className="mt-4">
          {!isLoaded ? (
            <div className="rounded-[24px] border border-white/10 bg-zinc-950/80 p-8 text-white/50">
              Carregando emblemas...
            </div>
          ) : emblemGroups.length === 0 ? (
            <EmptyMessage activeFilter={activeFilter} />
          ) : filteredEmblems.length === 0 ? (
            <EmptyMessage activeFilter={activeFilter} />
          ) : (
            <div className="relative isolate mx-auto w-full max-w-[1600px] overflow-visible py-3 sm:py-4">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-0 z-0 h-full w-screen -translate-x-1/2"
                style={{
                  background:
                    "radial-gradient(ellipse 72% 52% at 50% 3%, rgba(178, 171, 151, 0.12) 0%, rgba(92, 88, 77, 0.045) 36%, transparent 72%), radial-gradient(ellipse 36% 80% at 16% 32%, rgba(102, 105, 105, 0.035) 0%, transparent 72%), radial-gradient(ellipse 32% 82% at 85% 55%, rgba(119, 101, 79, 0.03) 0%, transparent 76%), linear-gradient(180deg, #090909 0%, #070706 50%, #020202 100%)",
                }}
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-0 z-0 h-full w-screen -translate-x-1/2"
                style={{
                  backgroundImage:
                    "linear-gradient(110deg, transparent 13%, rgba(227, 219, 198, 0.015) 18%, rgba(227, 219, 198, 0.065) 23%, rgba(227, 219, 198, 0.018) 29%, transparent 35%), linear-gradient(73deg, transparent 31%, rgba(220, 212, 192, 0.025) 36%, rgba(220, 212, 192, 0.055) 41%, transparent 49%), linear-gradient(104deg, transparent 52%, rgba(214, 207, 187, 0.02) 57%, rgba(214, 207, 187, 0.045) 61%, transparent 68%), radial-gradient(circle at 7% 12%, rgba(244, 239, 222, 0.2) 0.7px, transparent 1.5px), radial-gradient(circle at 15% 43%, rgba(244, 239, 222, 0.13) 0.8px, transparent 1.6px), radial-gradient(circle at 25% 74%, rgba(244, 239, 222, 0.14) 0.7px, transparent 1.5px), radial-gradient(circle at 36% 18%, rgba(244, 239, 222, 0.18) 0.7px, transparent 1.5px), radial-gradient(circle at 47% 57%, rgba(244, 239, 222, 0.12) 0.8px, transparent 1.6px), radial-gradient(circle at 59% 27%, rgba(244, 239, 222, 0.17) 0.7px, transparent 1.5px), radial-gradient(circle at 71% 81%, rgba(244, 239, 222, 0.12) 0.8px, transparent 1.6px), radial-gradient(circle at 82% 38%, rgba(244, 239, 222, 0.16) 0.7px, transparent 1.5px), radial-gradient(circle at 94% 16%, rgba(244, 239, 222, 0.13) 0.7px, transparent 1.5px)",
                }}
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-0 z-0 h-full w-screen -translate-x-1/2"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(0, 0, 0, 0.05) 0%, transparent 12%, transparent 78%, rgba(0, 0, 0, 0.30) 100%)",
                }}
              />
            <div className="relative z-10 mx-auto grid w-full max-w-[1600px] grid-cols-1 gap-x-3 gap-y-6 min-[520px]:grid-cols-2 lg:grid-cols-4 2xl:gap-x-4 2xl:gap-y-7">
              {filteredEmblems.map(({ emblem, theme }) => (
                <EmblemCard
                  key={emblem.id}
                  emblem={emblem}
                  theme={theme}
                />
              ))}
            </div>
            </div>
          )}
        </section>
        </div>
      </section>
    </main>
  );
}

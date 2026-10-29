"use client";

import Link from "next/link";
import BannerBackground from "@/components/BannerBackground";
import ProfileAvatar from "@/components/ProfileAvatar";
import { useEffect, useMemo, useState } from "react";
import PlatformIcon from "@/components/PlatformIcon";
import { type SiteGame, useSiteGames } from "@/lib/useSiteGames";

type HomeGame = SiteGame & {
  mastery?: string;
  isInBacklog?: boolean;
  backlogStatus?: "next" | "waiting" | "future";
  backlogOrder?: number;
};
type AchievementLike = {
  id?: string;
  title?: string;
  description?: string;
  status?: string;
  image?: string;
  officialImage?: string;
  icon?: string;
  trophy?: string;
  rank?: string;
  difficulty?: string;
  earnedDate?: string;
  [key: string]: unknown;
};
type SavedAchievementState = { status?: string; rank?: string; date?: string; image?: string };
type BacklogEntry = { id?: string; slug: string; order: number; status: "next" | "waiting" | "future" };
type YoutubeItem = { id: string; title: string; description?: string; publishedAt?: string; thumbnail: string; url: string };
type YoutubePayload = { videos?: YoutubeItem[]; liveNow?: YoutubeItem | null; error?: string };

const GAMES_UPDATED_EVENT = "rumo-a-conquista-games-updated";
const BACKLOG_UPDATED_EVENT = "rumo-a-conquista-backlog-updated";
const BACKLOG_STORAGE_KEY = "rumo-a-conquista-backlog";

function normalizeKey(value: unknown) {
  return String(value ?? "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}
function readLocalJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch { return fallback; }
}
function readText(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}
function getGameStatus(game: HomeGame): "completed" | "progress" | "planned" | "other" {
  const status = normalizeKey(game.status);
  const mastery = normalizeKey(game.mastery);
  if (
    Number(game.progress) >= 100 ||
    ["completed", "finalizado", "finalizada", "concluido", "concluida"].includes(status) ||
    ["concluido", "concluida", "finalizado", "finalizada"].includes(mastery)
  ) return "completed";
  if (["planned", "planejado", "planejada", "backlog", "future", "futuro"].includes(status)) return "planned";
  if (
    ["progress", "emprogresso", "emandamento", "jogando", "playing", "inprogress"].includes(status) ||
    game.firstJourney?.status === "in_progress"
  ) return "progress";
  return "other";
}
function getGameTimestamp(game: HomeGame) {
  const updated = Date.parse(readText(game.updatedAt, ""));
  if (Number.isFinite(updated) && updated > 0) return updated;
  const created = Date.parse(readText(game.createdAt, ""));
  return Number.isFinite(created) && created > 0 ? created : 0;
}
function parseHoursToMinutes(value: unknown) {
  const text = readText(value, "").toLowerCase().replace(",", ".");
  if (!text.trim()) return 0;
  let minutes = 0;
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(?:h|hora|horas)\b/g)) {
    const hours = Number(match[1]);
    if (Number.isFinite(hours)) minutes += Math.round(hours * 60);
  }
  for (const match of text.matchAll(/(\d+)\s*(?:m|min|minuto|minutos)\b/g)) {
    const part = Number(match[1]);
    if (Number.isFinite(part)) minutes += part;
  }
  return minutes;
}
function formatTotalHours(totalMinutes: number) {
  if (!totalMinutes) return "—";
  return new Intl.NumberFormat("pt-BR").format(Math.floor(totalMinutes / 60)) + " h";
}
function hasUsefulTimeValue(value: unknown) {
  const raw = readText(value, "").trim();
  if (!raw || /^[?—–-]+$/.test(raw)) return false;
  const normalized = normalizeKey(raw);
  return !["0", "0h", "0hora", "0horas", "na", "nd", "nada"].includes(normalized);
}
function getAchievementCounts(game: HomeGame) {
  if (typeof game.achievementsUnlocked === "number" && typeof game.achievementsTotal === "number") {
    return { unlocked: Math.max(0, game.achievementsUnlocked), total: Math.max(0, game.achievementsTotal) };
  }
  const achievements = Array.isArray(game.achievementsList) ? game.achievementsList as AchievementLike[] : [];
  const unlocked = achievements.filter((item) =>
    ["completed", "concluido", "concluida", "desbloqueado", "desbloqueada"].includes(normalizeKey(item.status))
  ).length;
  return { unlocked, total: achievements.length };
}
function getGameEmblemImage(game: HomeGame | null | undefined) {
  if (!game) return "";
  const configured = readText(game.emblem?.image, "") || readText(game.finalBadge?.image, "");
  if (configured) return configured;
  const fallbackBySlug: Record<string, string> = {
    "crisol-theater-of-idols": "/images/games/crisol-theater-of-idols/emblem.png",
    "hades": "/images/games/hades/emblem.png",
    "hollow-knight": "/images/games/hollow-knight/emblem.png",
    "howgarts-legacy": "/images/games/howgarts-legacy/emblem.png",
    "metro-last-light": "/images/games/metro-last-light/emblem.png",
    "monster-hunter-world-iceborne": "/images/games/monster-hunter-world-iceborne/emblem.png",
    "mouse-p-i-for-hire": "/images/games/mouse-p-i-for-hire/emblem.png",
    "song-of-nunu": "/images/games/song-of-nunu/emblem.png",
    "the-surge": "/images/games/the-surge/emblem.png",
    "tom-clancy-s-the-division": "/images/games/tom-clancy-s-the-division/emblem.png",
  };
  return fallbackBySlug[game.slug] || "";
}
function getUnlockedAchievements(game: HomeGame) {
  const list = Array.isArray(game.achievementsList) ? game.achievementsList as AchievementLike[] : [];
  return list.filter((item) =>
    ["completed", "concluido", "concluida", "desbloqueado", "desbloqueada"].includes(normalizeKey(item.status))
  );
}

type HomeTrophyTier = "bronze" | "prata" | "ouro" | "maestria";
type HomeTrophyCounter = { unlocked: number; total: number };
type HomeTrophySummary = Record<HomeTrophyTier, HomeTrophyCounter>;

const HOME_TROPHY_TIERS: Array<{
  key: HomeTrophyTier;
  label: string;
  image: string;
  border: string;
  background: string;
}> = [
  {
    key: "bronze",
    label: "Bronze",
    image: "/images/trophies/bronze.png",
    border: "border-[#8B5A35]/55",
    background: "bg-[#120D09]",
  },
  {
    key: "prata",
    label: "Prata",
    image: "/images/trophies/prata.png",
    border: "border-[#8C95A1]/55",
    background: "bg-[#0D1014]",
  },
  {
    key: "ouro",
    label: "Ouro",
    image: "/images/trophies/ouro.png",
    border: "border-[#C6A038]/55",
    background: "bg-[#151106]",
  },
  {
    key: "maestria",
    label: "Maestria",
    image: "/images/trophies/maestria.png",
    border: "border-[#FB2C36]/60",
    background: "bg-[#16080A]",
  },
];

function isMasteryAchievement(achievement: AchievementLike) {
  const title = normalizeKey(achievement.title);
  const difficulty = normalizeKey(
    readText(achievement.difficulty, "") || readText(achievement.rank, "")
  );
  const trophy = readText(achievement.trophy, "") || readText(achievement.icon, "");

  return (
    achievement.isEmblem === true ||
    title.includes("maestria") ||
    title.includes("mastery") ||
    difficulty === "diamante" ||
    difficulty === "extrema" ||
    trophy.includes("💎")
  );
}

function getNormalTrophyTier(achievement: AchievementLike): Exclude<HomeTrophyTier, "maestria"> {
  const difficulty = normalizeKey(
    readText(achievement.difficulty, "") || readText(achievement.rank, "")
  );
  const trophy = readText(achievement.trophy, "") || readText(achievement.icon, "");

  if (
    difficulty === "ouro" ||
    difficulty === "dificil" ||
    trophy.includes("🥇") ||
    trophy.includes("🏆")
  ) {
    return "ouro";
  }

  if (
    difficulty === "prata" ||
    difficulty === "media" ||
    trophy.includes("🥈")
  ) {
    return "prata";
  }

  return "bronze";
}

function isHomeAchievementUnlocked(game: HomeGame, achievement: AchievementLike) {
  const status = normalizeKey(achievement.status);
  if (["completed", "concluido", "concluida", "desbloqueado", "desbloqueada"].includes(status)) {
    return true;
  }

  // Keep completed First Journey selections in sync with the achievement panel.
  if (game.firstJourney?.status !== "completed") return false;

  const titleKey = normalizeKey(achievement.title);
  const achievementId = readText(achievement.id, "").trim();
  const journeyIds = Array.isArray(game.firstJourney.achievementIds)
    ? game.firstJourney.achievementIds
    : [];

  return journeyIds.some((journeyId) => {
    const rawJourneyId = String(journeyId ?? "").trim();
    const normalizedJourneyId = normalizeKey(rawJourneyId);
    return (
      Boolean(achievementId && rawJourneyId === achievementId) ||
      Boolean(titleKey && (
        normalizedJourneyId === titleKey ||
        normalizedJourneyId.endsWith(titleKey)
      ))
    );
  });
}

function getHomeTrophySummary(games: HomeGame[]): HomeTrophySummary {
  const summary: HomeTrophySummary = {
    bronze: { unlocked: 0, total: 0 },
    prata: { unlocked: 0, total: 0 },
    ouro: { unlocked: 0, total: 0 },
    maestria: { unlocked: 0, total: 0 },
  };

  for (const game of games) {
    const achievements = (Array.isArray(game.achievementsList) ? game.achievementsList : [])
      .filter((achievement) =>
        Boolean(readText(achievement.title, "").trim()) &&
        achievement.isHidden !== true &&
        achievement.hidden !== true
      ) as AchievementLike[];

    const normalAchievements = achievements.filter((achievement) => !isMasteryAchievement(achievement));

    for (const achievement of normalAchievements) {
      const tier = getNormalTrophyTier(achievement);
      summary[tier].total += 1;
      if (isHomeAchievementUnlocked(game, achievement)) {
        summary[tier].unlocked += 1;
      }
    }

    const masteryConfigured =
      typeof game.finalBadgeConfigured === "boolean"
        ? game.finalBadgeConfigured
        : Boolean(game.finalBadge?.title || game.finalBadge?.image || game.finalBadge?.description);
    const hasMasteryEntry = achievements.some(isMasteryAchievement);

    // A game's final mastery is represented once, even if its legacy achievement
    // list also contains a mastery record.
    if (masteryConfigured || hasMasteryEntry) {
      summary.maestria.total += 1;
      const normalCompleted = normalAchievements.filter((achievement) =>
        isHomeAchievementUnlocked(game, achievement)
      ).length;
      if (normalAchievements.length > 0 && normalCompleted === normalAchievements.length) {
        summary.maestria.unlocked += 1;
      }
    }
  }

  return summary;
}
function getAchievementTitle(achievement: AchievementLike, index: number) {
  return readText(achievement.title, "Conquista " + (index + 1)).trim();
}
function parseDateValue(value: unknown) {
  const text = readText(value, "").trim();
  if (!text) return 0;
  const brazilian = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brazilian) {
    const day = Number(brazilian[1]); const month = Number(brazilian[2]); const year = Number(brazilian[3]);
    return new Date(year, month - 1, day).getTime();
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}
function formatPublishedDate(value: string | undefined) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" })
    .format(new Date(timestamp))
    .replace(".", "");
}
function formatShortDate(timestamp: number) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(timestamp)).replace(".", "");
}
function getAchievementSymbol(achievement: AchievementLike) {
  const rank = normalizeKey(achievement.rank || achievement.difficulty || achievement.trophy);
  if (rank.includes("ouro") || readText(achievement.trophy, "").includes("🥇")) return "🥇";
  if (rank.includes("prata") || readText(achievement.trophy, "").includes("🥈")) return "🥈";
  if (rank.includes("diamante") || readText(achievement.trophy, "").includes("💎")) return "💎";
  return readText(achievement.icon, "") || readText(achievement.trophy, "") || "🏆";
}
function readBacklogEntries(): BacklogEntry[] {
  const saved = readLocalJson<Partial<BacklogEntry>[]>(BACKLOG_STORAGE_KEY, []);
  return saved.map((item, index) => ({
    id: item.id,
    slug: readText(item.slug, "").trim(),
    order: Number(item.order ?? index + 1),
    status: (item.status === "next" || item.status === "waiting" ? item.status : "future") as BacklogEntry["status"],
  })).filter((item) => item.slug).sort((a, b) => a.order - b.order);
}
function SectionTitle({ title, href, linkLabel = "Ver todos" }: { title: string; href?: string; linkLabel?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="min-w-0 text-sm font-black uppercase tracking-[0.06em] text-white sm:text-[15px]">{title}</h2>
      {href ? <Link href={href} className="shrink-0 text-[11px] font-bold text-white/55 transition hover:text-white">{linkLabel} <span className="text-[#FB2C36]">→</span></Link> : null}
    </div>
  );
}
function StatIcon({ symbol }: { symbol: string }) {
  const common = {
    viewBox: "0 0 24 24",
    className: "h-[22px] w-[22px]",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  if (symbol === "library") {
    return (
      <svg {...common} strokeWidth={2.1}>
        <rect x="4.5" y="4.5" width="6.2" height="6.2" rx="1.2" />
        <rect x="13.3" y="4.5" width="6.2" height="6.2" rx="1.2" />
        <rect x="4.5" y="13.3" width="6.2" height="6.2" rx="1.2" />
        <rect x="13.3" y="13.3" width="6.2" height="6.2" rx="1.2" />
      </svg>
    );
  }

  if (symbol === "check") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8.5" strokeWidth="1.9" />
        <path d="m8.1 12.2 2.6 2.6 5.3-5.5" strokeWidth="2" />
      </svg>
    );
  }

  if (symbol === "trophy") {
    return (
      <svg {...common}>
        <path d="M8 4.25H16V9.25C16 12.35 14.45 14.65 12 14.65C9.55 14.65 8 12.35 8 9.25V4.25Z" strokeWidth="1.9" />
        <path d="M8 6.25H5.8C4.8 6.25 4.25 6.9 4.25 7.8V8.3C4.25 10.65 5.9 12.25 8 12.45M16 6.25H18.2C19.2 6.25 19.75 6.9 19.75 7.8V8.3C19.75 10.65 18.1 12.25 16 12.45" strokeWidth="1.9" />
        <path d="M12 14.65V18.2M8.3 20H15.7" strokeWidth="1.9" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8.6" strokeWidth="1.9" />
      <path d="M12 7.5V12L15.2 14" strokeWidth="2.1" />
    </svg>
  );
}

function Stat({ symbol, value, label, divided = false }: { symbol: string; value: string | number; label: string; divided?: boolean }) {
  return (
    <div className={`flex min-w-0 items-stretch gap-2 ${divided ? "md:border-l md:border-white/10 md:pl-3" : "md:pr-4"}`}>
      <span className="flex min-h-[38px] w-9 shrink-0 self-stretch items-center justify-center rounded-[6px] bg-red-600/15 text-red-500">
        <StatIcon symbol={symbol} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[18px] font-black leading-none tracking-tight text-white">{value}</p>
        <p className={`mt-1 !text-[12px] font-medium leading-[1.25] text-white/55 ${label === "Conquistas desbloqueadas" ? "2xl:whitespace-nowrap" : ""}`}>{label}</p>
      </div>
    </div>
  );
}

function getAchievementFallbackImage(achievement: AchievementLike) {
  if (isMasteryAchievement(achievement)) return "/images/trophies/maestria.png";

  const rank = normalizeKey(
    readText(achievement.rank, "") || readText(achievement.difficulty, "")
  );
  const trophy = readText(achievement.trophy, "") || readText(achievement.icon, "");

  if (rank.includes("ouro") || trophy.includes("🥇")) return "/images/trophies/ouro.png";
  if (rank.includes("prata") || trophy.includes("🥈")) return "/images/trophies/prata.png";
  return "/images/trophies/bronze.png";
}

function AchievementArtwork({ achievement, className }: { achievement: AchievementLike; className: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const image = readText(achievement.image, "").trim() || readText(achievement.officialImage, "").trim();
  const src = image && !imageFailed ? image : getAchievementFallbackImage(achievement);

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => { if (!imageFailed) setImageFailed(true); }}
      className={className}
    />
  );
}

function AchievementIcon({ achievement }: { achievement: AchievementLike }) {
  return (
    <span title={readText(achievement.title, "Conquista desbloqueada")} className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/[0.12] bg-black/45 text-sm">
      <AchievementArtwork achievement={achievement} className="h-full w-full object-contain p-0.5" />
    </span>
  );
}

export default function LandingHome() {
  const { gamesList, isLoaded } = useSiteGames();
  const [backlogEntries, setBacklogEntries] = useState<BacklogEntry[]>([]);
  const [featuredVideo, setFeaturedVideo] = useState<YoutubeItem | null>(null);
  const [recentVideos, setRecentVideos] = useState<YoutubeItem[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [youtubeLoaded, setYoutubeLoaded] = useState(false);

  const allGames = useMemo(
    () => (gamesList || []).filter((game) => Boolean(game.slug && game.title)) as HomeGame[],
    [gamesList]
  );

  useEffect(() => {
    function refreshBacklog() { setBacklogEntries(readBacklogEntries()); }
    refreshBacklog();
    window.addEventListener("storage", refreshBacklog);
    window.addEventListener(BACKLOG_UPDATED_EVENT, refreshBacklog);
    window.addEventListener(GAMES_UPDATED_EVENT, refreshBacklog);
    return () => {
      window.removeEventListener("storage", refreshBacklog);
      window.removeEventListener(BACKLOG_UPDATED_EVENT, refreshBacklog);
      window.removeEventListener(GAMES_UPDATED_EVENT, refreshBacklog);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function loadFeaturedContent() {
      try {
        const response = await fetch(
          "/api/youtube/channel?handle=" + encodeURIComponent("@orabiisco") + "&maxResults=9",
          { signal: controller.signal }
        );
        const payload = await response.json() as YoutubePayload;
        if (!response.ok) throw new Error(payload.error || "Não foi possível buscar o conteúdo.");
        const live = payload.liveNow ?? null;
        const videos = Array.isArray(payload.videos) ? payload.videos : [];
        const uniqueVideos = new Map<string, YoutubeItem>();
        [...(live ? [live] : []), ...videos].forEach((video) => {
          if (video?.id && !uniqueVideos.has(video.id)) uniqueVideos.set(video.id, video);
        });
        setRecentVideos(Array.from(uniqueVideos.values()).slice(0, 4));
        setFeaturedVideo(live || videos[0] || null);
        setIsLive(Boolean(live));
      } catch {
        if (!controller.signal.aborted) { setFeaturedVideo(null); setRecentVideos([]); setIsLive(false); }
      } finally {
        if (!controller.signal.aborted) setYoutubeLoaded(true);
      }
    }
    loadFeaturedContent();
    return () => controller.abort();
  }, []);

  const gamesByUpdated = useMemo(
    () => [...allGames].sort((a, b) => getGameTimestamp(b) - getGameTimestamp(a)),
    [allGames]
  );
  const currentGame = useMemo(
    () => gamesByUpdated.find((game) => getGameStatus(game) === "progress") ?? null,
    [gamesByUpdated]
  );
  const nextMastery = useMemo(() => {
    const bySlug = new Map(allGames.map((game) => [game.slug, game]));
    const eligibleQueue = backlogEntries
      .map((item) => bySlug.get(item.slug))
      .filter((game): game is HomeGame => Boolean(game) && getGameStatus(game as HomeGame) !== "completed");
    const explicitNext = backlogEntries.find((item) => item.status === "next");
    const chosenNext = explicitNext ? bySlug.get(explicitNext.slug) : undefined;

    if (chosenNext && getGameStatus(chosenNext) !== "completed") return chosenNext;
    if (eligibleQueue.length > 0) return eligibleQueue[0];

    return gamesByUpdated.find((game) => game.backlogStatus === "next" && getGameStatus(game) !== "completed") ?? null;
  }, [allGames, backlogEntries, gamesByUpdated]);

  const recentGames = useMemo(() => {
    const reserved = new Set([currentGame?.slug, nextMastery?.slug].filter((slug): slug is string => Boolean(slug)));
    return gamesByUpdated.filter((game) => {
      const status = getGameStatus(game);
      return !reserved.has(game.slug) && (status === "progress" || status === "completed");
    }).slice(0, 6);
  }, [gamesByUpdated, currentGame, nextMastery]);

  const summary = useMemo(() => {
    const completed = allGames.filter((game) => getGameStatus(game) === "completed").length;
    const unlocked = allGames.reduce((total, game) => total + getAchievementCounts(game).unlocked, 0);
    const totalMinutes = allGames.reduce((total, game) => total + parseHoursToMinutes(game.hours), 0);
    return {
      games: allGames.length,
      completed,
      unlocked,
      hours: formatTotalHours(totalMinutes),
    };
  }, [allGames]);

  const currentCounts = currentGame ? getAchievementCounts(currentGame) : null;
  const currentProgress = currentGame ? Math.min(100, Math.max(0, Number(currentGame.progress) || 0)) : 0;
  const nextCounts = nextMastery ? getAchievementCounts(nextMastery) : null;
  const nextProgress = nextMastery ? Math.min(100, Math.max(0, Number(nextMastery.progress) || 0)) : 0;
  const currentUnlockedAchievements = currentGame ? getUnlockedAchievements(currentGame) : [];
  const currentAchievementList = currentGame && Array.isArray(currentGame.achievementsList)
    ? currentGame.achievementsList as AchievementLike[]
    : [];
  const visibleCurrentAchievements = currentAchievementList.slice(0, 6);
  // During the active debut journey, preparation replaces progress and trophy previews.
  const showFirstJourneyPlaceholder =
    currentGame?.firstJourney?.status === "in_progress";
  const showCurrentAchievementProgress =
    !showFirstJourneyPlaceholder && currentAchievementList.length > 0;
  const trophySummary = useMemo(() => getHomeTrophySummary(allGames), [allGames]);

  return (
    <div className="mx-auto grid w-full max-w-[1620px] grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="hidden min-h-[calc(100vh-74px)] border-r border-white/[0.08] px-4 py-5 lg:block" aria-label="Resumo lateral da Home">
        <div className="sticky top-20 flex min-h-[calc(100vh-94px)] flex-col">
          <div className="border-b border-white/[0.08] pb-5 pt-2">
            <div className="flex flex-col items-center text-center">
              <ProfileAvatar />
              <h2 className="mt-3 text-lg font-black leading-tight text-white">Rabiisco</h2>
              <p className="mt-1 text-[10px] font-semibold leading-relaxed text-white/60">Criador do Rumo à Conquista</p>
              <p className="mt-2 max-w-[180px] text-[11px] italic leading-relaxed text-white/50">Jogador por paixão. Conquistas por propósito.</p>

              <div className="mt-4 flex items-center justify-center gap-4" role="group" aria-label="Redes sociais do Rabiisco">
                <a href="https://www.youtube.com/@orabiisco" target="_blank" rel="noreferrer" aria-label="YouTube do Rabiisco" title="YouTube" className="text-[#FB2C36] transition hover:scale-110 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400">
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                    <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.2 3.6-6.2 3.6Z" />
                  </svg>
                </a>
                <a href="https://www.instagram.com/orabiisco/" target="_blank" rel="noreferrer" aria-label="Instagram do Rabiisco" title="Instagram" className="text-[#E879B9] transition hover:scale-110 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-400">
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="5" />
                    <circle cx="12" cy="12" r="4" />
                    <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
                  </svg>
                </a>
                <a href="https://www.twitch.tv/orabiisco" target="_blank" rel="noreferrer" aria-label="Twitch do Rabiisco" title="Twitch" className="text-[#BF94FF] transition hover:scale-110 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400">
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                    <path d="M4.3 2 1 5.3v14.1h5.4V22h3.3l2.6-2.6h4.1L23 12.7V2H4.3Zm16.4 9.6-3.3 3.3h-4.1l-2.6 2.6v-2.6H6.4V4.1h14.3v7.5ZM16 6.8h2.1v6.1H16V6.8Zm-5.7 0h2.1v6.1h-2.1V6.8Z" />
                  </svg>
                </a>
                <a href="https://kick.com/orabiisco" target="_blank" rel="noreferrer" aria-label="Kick do Rabiisco" title="Kick" className="text-[#53E0A0] transition hover:scale-110 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                    <path d="M4 3h5v6l6-6h6l-7.2 8L21 21h-6l-4.5-6L9 17v4H4V3Z" />
                  </svg>
                </a>
              </div>
            </div>
          </div>
          <div className="mt-5 border-b border-white/[0.08] pb-5">
            <div className="flex items-center gap-2">
              <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
              <h2 className="text-[11px] font-black uppercase tracking-[0.12em] text-white">Ranks conquistados</h2>
            </div>

            <div className="mt-3 grid grid-cols-4 gap-1.5">
              {HOME_TROPHY_TIERS.map((tier) => {
                const count = trophySummary[tier.key];
                const countLabel = isLoaded ? String(count.unlocked) : "—";
                const countDescription = isLoaded
                  ? `${tier.label}: ${count.unlocked} desbloqueadas de ${count.total}`
                  : `${tier.label}: carregando contagens`;

                return (
                  <div
                    key={tier.key}
                    title={countDescription}
                    aria-label={countDescription}
                    className={`flex min-w-0 flex-col items-center justify-center rounded-md border px-0.5 py-1.5 ${tier.border} ${tier.background}`}
                  >
                    <img
                      src={tier.image}
                      alt={tier.label}
                      loading="eager"
                      className="h-8 w-8 max-w-full object-contain"
                    />
                    <p className="mt-1 whitespace-nowrap text-[13px] font-black leading-none text-white">
                      {countLabel}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-6">
            <div className="flex items-center gap-2">
              <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
              <h2 className="text-[12px] font-black uppercase tracking-[0.12em] text-white">SETUP</h2>
            </div>

            <div className="mt-3">
              {[
                { name: "RTX 3060 12GB", type: "GPU", icon: "gpu" },
                { name: "i5-12400F", type: "CPU", icon: "chip" },
                { name: "32 GB", type: "RAM", icon: "ram" },
                { name: '27" 75Hz', type: "Monitor", icon: "monitor" },
              ].map((item, index) => (
                <div
                  key={item.name}
                  className={`flex items-center gap-3 py-2.5 ${
                    index > 0 ? "border-t border-white/[0.05]" : ""
                  }`}
                >
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center text-red-500">
                    {item.icon === "gpu" ? (
                      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="3.5" y="5" width="17" height="14" rx="2" />
                        <path d="M7 15.5l3-3 2.2 2.2 2.3-2.3 2.5 2.6M7 8.5h.01M10 8.5h.01" />
                      </svg>
                    ) : item.icon === "chip" ? (
                      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
                        <path d="M9 1.8v3M12 1.8v3M15 1.8v3M9 19.2v3M12 19.2v3M15 19.2v3M1.8 9h3M1.8 12h3M1.8 15h3M19.2 9h3M19.2 12h3M19.2 15h3" />
                      </svg>
                    ) : item.icon === "ram" ? (
                      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="3.5" y="7" width="17" height="10" rx="1.5" />
                        <path d="M7 10v4M10 10v4M13 10v4M16 10v4M6 17v2M9 17v2M12 17v2M15 17v2M18 17v2" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="3.5" y="5" width="17" height="12" rx="2" />
                        <path d="M8 20h8M12 17v3" />
                      </svg>
                    )}
                  </div>

                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-black leading-tight text-white">{item.name}</p>
                    <p className="mt-0.5 text-[10px] font-medium leading-tight text-white/50">{item.type}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-auto pt-8">
            <Link href="/configuracoes" className="flex items-center gap-3 px-2 py-2 text-[11px] font-bold text-white/50 transition hover:text-white">
              <span aria-hidden="true" className="text-red-400">⚙</span> Configurações
            </Link>
          </div>
        </div>
      </aside>

      <div className="min-w-0 px-4 pb-12 pt-4 sm:px-5 lg:px-5 lg:pt-5">
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4">
      {/* Banner principal integrado com as estatísticas, seguindo o padrão visual de Jogos e Conteúdo */}
      <section
        aria-label="Banner principal e resumo da jornada"
        className="relative isolate overflow-hidden rounded-xl border border-white/[0.10] bg-[#050609] shadow-[0_6px_22px_rgba(0,0,0,0.16)]"
      >
        <BannerBackground
          bannerKey="home"
          imageUrl="/images/home-profile-banner-art.webp"
          className="pointer-events-none absolute inset-0 -z-20"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(5,6,9,0.99)_0%,rgba(5,6,9,0.97)_24%,rgba(5,6,9,0.78)_46%,rgba(5,6,9,0.22)_78%,rgba(5,6,9,0.06)_100%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-28 bg-[linear-gradient(180deg,transparent_0%,rgba(5,6,9,0.55)_48%,rgba(5,6,9,0.96)_100%)]"
        />

        <div className="relative min-h-[296px] px-4 pb-5 pt-6 sm:px-6 sm:pb-5 sm:pt-6 md:min-h-[252px] md:px-6">
          <div className="max-w-[470px]">
            <p className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.22em] text-red-500 sm:text-[10px]">
              <span className="text-[10px] leading-none">✣</span>
              Minha jornada, minhas conquistas
            </p>
            <h1 id="home-journey-title" className="mt-2 text-[30px] font-black uppercase leading-none tracking-tight text-white sm:text-[36px] md:text-[38px]">
              Cada desafio conta.
            </h1>
            <p className="mt-1.5 max-w-[440px] text-[11px] font-medium leading-[1.35] text-white/70 sm:text-xs">
              Cada jogo tem uma história. Aqui registro minhas jornadas, celebro minhas vitórias e busco a maestria, uma conquista de cada vez.
            </p>
            <Link
              href="/biblioteca"
              aria-label="Explorar os jogos do Rumo à Conquista"
              className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-md border border-red-400/50 bg-[#FB2C36] px-4 py-1.5 text-[13px] font-bold tracking-[0.01em] text-white shadow-[0_5px_20px_rgba(251,44,54,0.16)] transition hover:border-red-300 hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#06070a] sm:px-4"
            >
              Explorar jogos <span aria-hidden="true">→</span>
            </Link>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-x-3 gap-y-4 md:absolute md:bottom-5 md:left-6 md:right-6 md:mt-0 md:grid-cols-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.12fr)_minmax(0,1fr)] md:gap-x-0 md:gap-y-0">
            <Stat symbol="library" value={isLoaded ? summary.games.toLocaleString("pt-BR") : "—"} label="Jogos registrados" />
            <Stat symbol="check" value={isLoaded ? summary.completed.toLocaleString("pt-BR") : "—"} label="Jogos concluídos" divided />
            <Stat symbol="trophy" value={isLoaded ? summary.unlocked.toLocaleString("pt-BR") : "—"} label="Conquistas desbloqueadas" divided />
            <Stat symbol="clock" value={isLoaded ? summary.hours : "—"} label="Tempo de jogo" divided />
          </div>
        </div>
      </section>

      {/* Jogo atual com a faixa de conquistas integrada */}
      <section className="overflow-hidden rounded-xl border border-white/[0.10] bg-[#07090d]/95" aria-labelledby="current-game-title">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.09] px-4 py-3 sm:px-5">
          <h2 id="current-game-title" className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-white sm:text-base">
            <span aria-hidden="true" className="h-5 w-1 rounded-full bg-[#FB2C36]" /> Jogo atual
          </h2>
          {currentGame ? <Link href={"/games/" + currentGame.slug} className="text-[10px] font-bold text-white/45 transition hover:text-white sm:text-xs">Abrir jogo <span className="text-[#FB2C36]">→</span></Link> : null}
        </div>

        {currentGame ? (
          <>
            <div className="grid grid-cols-[124px_minmax(0,1fr)] items-start gap-3 p-3 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4 sm:p-4 lg:grid-cols-[252px_minmax(0,1fr)] lg:gap-5 lg:p-4">
              <Link href={"/games/" + currentGame.slug} aria-label={"Abrir jogo: " + currentGame.title} className="group relative block aspect-video w-full overflow-hidden rounded-md border border-white/[0.08] bg-black transition hover:border-red-500/40">
                <img src={currentGame.image || currentGame.cardImage || ""} alt={currentGame.title + " — arte do jogo"} loading="lazy" className="h-full w-full object-cover object-center brightness-90 contrast-110 transition duration-700 group-hover:scale-105 group-hover:brightness-105" onError={(event) => { const fallback = currentGame.cardImage; if (fallback && event.currentTarget.dataset.fallbackApplied !== "true") { event.currentTarget.dataset.fallbackApplied = "true"; event.currentTarget.src = fallback; } }} />
              </Link>

              <div className="min-w-0 flex flex-col justify-center">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-lg font-black leading-snug text-white sm:text-xl lg:text-2xl">{currentGame.title}</h3>
                    <p className="mt-1 text-xs text-white/55">{currentGame.subtitle || "Sua jornada em andamento"}</p>
                  </div>
                  {getGameTimestamp(currentGame) ? <span className="shrink-0 text-[10px] text-white/45">{formatShortDate(getGameTimestamp(currentGame))}</span> : null}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-white/65 sm:text-xs">
                  {currentGame.platform ? <span className="inline-flex shrink-0 items-center gap-2 rounded-md bg-[#1267c8] px-3 py-1.5 font-bold text-white"><PlatformIcon platform={currentGame.platform} className="h-4 w-4" />{currentGame.platform}</span> : null}
                  {hasUsefulTimeValue(currentGame.hours) ? <span className="inline-flex shrink-0 items-center gap-2"><span className="text-lg text-white/80">◷</span><span className="font-bold text-white/85">{readText(currentGame.hours, "")}</span></span> : null}
                  {showFirstJourneyPlaceholder ? (
                    <div className="flex min-w-[220px] flex-1 items-center gap-2.5 rounded-lg border border-red-500/20 bg-gradient-to-r from-red-950/25 via-[#0b0d12] to-[#08090c] px-2.5 py-1.5">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-red-500/20 bg-red-500/[0.08] text-[#FB2C36]">
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="8.5" />
                          <circle cx="12" cy="12" r="3.2" />
                          <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="text-[8px] font-black uppercase tracking-[0.1em] text-white/65">Jornada de Estreia</span>
                          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-emerald-300">Em andamento</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0">
                          <p className="shrink-0 text-xs font-black leading-tight text-white">Conquistas em preparação</p>
                          <p className="text-[11px] leading-tight text-white/55 sm:text-xs">O progresso e as miniaturas aparecem quando esta etapa terminar.</p>
                        </div>
                      </div>
                    </div>
                  ) : showCurrentAchievementProgress ? (
                    <div className="flex min-w-[190px] flex-1 items-center gap-2.5 sm:gap-3" aria-label={"Progresso de conquistas: " + (currentCounts?.unlocked ?? 0) + " de " + (currentCounts?.total ?? 0)}>
                      <span className="shrink-0 whitespace-nowrap font-black text-white">{currentCounts?.unlocked ?? 0}/{currentCounts?.total ?? 0}</span>
                      <div
                        className="h-2 min-w-[70px] flex-1 overflow-hidden rounded-full bg-white/[0.10]"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={currentProgress}
                        aria-label={"Progresso de " + currentGame.title}
                      >
                        <div className="h-full rounded-full bg-[#FB2C36] transition-[width] duration-300" style={{ width: currentProgress + "%" }} />
                      </div>
                      <span className="shrink-0 font-black text-white">{currentProgress}%</span>
                    </div>
                  ) : null}
                </div>

              </div>
            </div>

{!showFirstJourneyPlaceholder ? (
            <div className="border-t border-white/[0.09] px-3 py-3 sm:px-4 sm:py-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-xs font-bold text-white/85 sm:text-sm">
                  <span aria-hidden="true" className="h-4 w-1 rounded-full bg-[#FB2C36]" /> Conquistas do jogo
                </h3>
                <Link href={"/games/" + currentGame.slug} className="shrink-0 text-[10px] font-bold text-[#FB2C36] transition hover:text-white sm:text-xs">Ver todas <span aria-hidden="true">→</span></Link>
              </div>
              {visibleCurrentAchievements.length ? (

                <div className="flex gap-2 overflow-x-auto pb-1 sm:gap-3">
                  {visibleCurrentAchievements.map((achievement, index) => {
                    const title = getAchievementTitle(achievement, index);
                    const unlocked = ["completed", "concluido", "concluida", "desbloqueado", "desbloqueada"].includes(normalizeKey(achievement.status));
                    return (
                      <Link key={currentGame.slug + ":" + title + ":" + index} href={"/games/" + currentGame.slug} title={title + (unlocked ? " — desbloqueada" : " — bloqueada")} aria-label={title + (unlocked ? " — desbloqueada" : " — bloqueada")} className={"group relative flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-md border bg-black/40 p-1 transition hover:border-red-500/60 sm:h-[58px] sm:w-[58px] " + (unlocked ? "border-red-500/35" : "border-white/[0.12] opacity-65 grayscale-[0.4]")}>
                        <AchievementArtwork achievement={achievement} className="h-full w-full object-contain" />
                        {!unlocked ? <span aria-hidden="true" className="absolute bottom-1 right-1 rounded bg-black/80 px-1 text-[8px] text-white/70">🔒</span> : null}
                      </Link>
                    );
                  })}
                  {currentAchievementList.length > visibleCurrentAchievements.length ? (
                    <Link href={"/games/" + currentGame.slug} className="flex h-[52px] min-w-[68px] shrink-0 flex-col items-center justify-center rounded-md border border-white/[0.12] bg-white/[0.025] text-[10px] font-bold text-white/70 transition hover:border-red-500/40 hover:text-white sm:h-[58px] sm:min-w-[76px]">
                      +{currentAchievementList.length - visibleCurrentAchievements.length}
                      <span className="mt-0.5 text-[9px] text-white/45">conquistas</span>
                    </Link>
                  ) : null}
                </div>

              ) : (
                <p className="py-2 text-[11px] text-white/45">As conquistas deste jogo aparecerão aqui quando estiverem configuradas.</p>
              )}
            </div>
            ) : null}
          </>
        ) : (
          <div className="p-5 sm:p-7">
            <h3 className="text-base font-black text-white">Nenhum jogo em andamento</h3>
            <p className="mt-2 text-sm text-white/55">Selecione uma jornada na Biblioteca para definir o jogo atual.</p>
            <Link href="/biblioteca" className="mt-3 inline-flex text-xs font-bold text-red-300 hover:text-white">Abrir biblioteca →</Link>
          </div>
        )}
      </section>

      {/* Jogos recentes em linhas horizontais, seguindo a lista de jornadas já existente */}
      <section className="overflow-hidden rounded-xl border border-white/[0.09] bg-[#07090d]/95" aria-labelledby="recent-games-title">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.09] px-4 py-3 sm:px-5">
          <div>
            <h2 id="recent-games-title" className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-white sm:text-base">
              <span aria-hidden="true" className="h-5 w-1 rounded-full bg-[#FB2C36]" /> Jogos recentes
            </h2>
            <p className="mt-1 text-[10px] text-white/45 sm:text-xs">Suas jornadas mais recentes, com progresso e emblema.</p>
          </div>
          <Link href="/biblioteca" className="shrink-0 text-[10px] font-bold text-[#FB2C36] transition hover:text-white sm:text-xs">Ver todos <span aria-hidden="true">→</span></Link>
        </div>

        {recentGames.length ? (
          <div className="divide-y divide-white/[0.09]">
            {recentGames.slice(0, 3).map((game) => {
              const counts = getAchievementCounts(game);
              const progress = Math.max(0, Math.min(100, Number(game.progress) || 0));
              const completed = getGameStatus(game) === "completed";
              const emblem = getGameEmblemImage(game);
              const updatedAt = formatPublishedDate(readText(game.updatedAt, "") || readText(game.createdAt, ""));
              return (
                <Link key={game.slug} href={"/games/" + game.slug} className="group grid grid-cols-[64px_minmax(0,1fr)_42px] items-center gap-3 px-3 py-3 transition hover:bg-white/[0.025] sm:grid-cols-[78px_minmax(0,1fr)_72px] sm:gap-4 sm:px-4 sm:py-3.5">
                  <div className="h-[82px] w-[64px] shrink-0 overflow-hidden rounded-md border border-white/[0.12] bg-black/40 sm:h-[96px] sm:w-[78px]">
                    <img src={game.cardImage || game.image || ""} alt={game.title + " — capa"} loading="lazy" className="h-full w-full object-cover object-center brightness-90 contrast-110 transition duration-700 group-hover:scale-105 group-hover:brightness-105" />
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h3 className="min-w-0 text-xs font-black leading-snug text-white transition group-hover:text-white sm:text-base">{game.title}</h3>
                      <span className={"shrink-0 rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-wide sm:text-[9px] " + (completed ? "border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-300" : "border-red-400/25 bg-red-500/[0.07] text-red-300")}>{completed ? "Finalizado" : "Em andamento"}</span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[9px] text-white/60 sm:gap-x-4 sm:text-[11px]">
                      {game.platform ? <span className="inline-flex items-center gap-1.5 border-r border-white/[0.12] pr-3 sm:pr-4"><span aria-hidden="true" className="text-blue-300">◈</span>{game.platform}</span> : null}
                      <span className="inline-flex items-center gap-1.5 border-r border-white/[0.12] pr-3 sm:pr-4"><span aria-hidden="true" className="text-amber-400">🏆</span>{counts.unlocked}/{counts.total}</span>
                      {hasUsefulTimeValue(game.hours) ? <span className="inline-flex items-center gap-1.5 border-r border-white/[0.12] pr-3 sm:pr-4"><span aria-hidden="true" className="text-cyan-300">◷</span>{readText(game.hours, "")}</span> : null}
                      {updatedAt ? <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="text-violet-300">▦</span>{updatedAt}</span> : null}
                    </div>

                    <div className="mt-3 flex items-center gap-2.5 sm:mt-3.5 sm:gap-3">
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.10] sm:h-[5px]">
                        <div className={"h-full rounded-full " + (completed ? "bg-emerald-400" : "bg-[#FB2C36]")} style={{ width: progress + "%" }} />
                      </div>
                      <span className={"shrink-0 text-[10px] font-black sm:text-xs " + (completed ? "text-emerald-300" : "text-[#FB2C36]")}>{progress}%</span>
                    </div>
                  </div>

                  <div className="flex h-[68px] w-[42px] items-center justify-center sm:h-[86px] sm:w-[72px]">
                    {emblem ? (
                      <img src={emblem} alt="" loading="lazy" className="max-h-full max-w-full object-contain opacity-90 transition group-hover:opacity-100" />
                    ) : (
                      <span aria-hidden="true" className="text-2xl text-white/20 sm:text-3xl">♜</span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="p-5 text-sm text-white/50">Os jogos recentes aparecerão aqui conforme o progresso for registrado.</p>
        )}
      </section>

          </div>

          <aside className="min-w-0 space-y-4" aria-label="Painel lateral da jornada">
          <section className="overflow-hidden rounded-xl border border-white/[0.09] bg-[#07090d]/95" aria-labelledby="next-mastery-title">
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.09] px-3.5 py-3">
              <h2 id="next-mastery-title" className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-white sm:text-sm"><span aria-hidden="true" className="h-4 w-1 rounded-full bg-[#FB2C36]" /> Próxima Maestria</h2>
              <Link href="/backlog" className="shrink-0 text-[10px] font-bold text-white/45 transition hover:text-white">Fila →</Link>
            </div>
            {nextMastery ? (
              <>
                <div className="grid grid-cols-[86px_minmax(0,1fr)] items-center gap-3 p-3">
                  <Link href={"/games/" + nextMastery.slug} className="group relative flex h-[112px] w-full items-center justify-center overflow-hidden rounded-lg border border-white/[0.10] bg-black/45 transition hover:border-red-500/40">
                    <img src={nextMastery.cardImage || nextMastery.image || ""} alt={nextMastery.title + " — capa"} loading="lazy" className="h-full w-full object-cover object-center brightness-90 contrast-110 transition duration-700 group-hover:scale-105 group-hover:brightness-105" />
                  </Link>
                  <div className="min-w-0">
                    <h3 className="text-xs font-black leading-snug text-white sm:text-sm">{nextMastery.title}</h3>
                    <p className="mt-1 text-[10px] text-white/55">{nextCounts?.unlocked ?? 0} / {nextCounts?.total ?? 0} conquistas</p>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.10]"><div className="h-full rounded-full bg-amber-400" style={{ width: nextProgress + "%" }} /></div>
                      <span className="text-[10px] font-black text-white">{nextProgress}%</span>
                    </div>
                    <Link href={"/games/" + nextMastery.slug} className="mt-3 inline-flex text-[10px] font-bold text-[#FB2C36] transition hover:text-white">Ver detalhes <span className="ml-1">→</span></Link>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-3.5">
                <p className="text-xs font-bold text-white">Sua próxima Maestria ainda não foi definida.</p>
                <p className="mt-1 text-[10px] leading-relaxed text-white/50">Escolha um jogo na fila para destacá-lo aqui.</p>
                <Link href="/backlog" className="mt-3 inline-flex text-[10px] font-bold text-[#FB2C36] hover:text-white">Organizar fila →</Link>
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-xl border border-white/[0.09] bg-[#07090d]/95" aria-labelledby="recent-content-title">
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.09] px-3.5 py-3">
              <h2 id="recent-content-title" className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-white sm:text-sm"><span aria-hidden="true" className="h-4 w-1 rounded-full bg-[#FB2C36]" /> Conteúdo recente</h2>
              <Link href="/conteudo" className="shrink-0 text-[10px] font-bold text-[#FB2C36] transition hover:text-white">Ver todos →</Link>
            </div>
            {recentVideos.length ? (
              <div className="divide-y divide-white/[0.08]">
                {recentVideos.slice(0, 4).map((video) => {
                  const liveItem = Boolean(isLive && featuredVideo?.id === video.id);
                  return (
                    <a key={video.id} href={video.url} target="_blank" rel="noreferrer" className="group flex min-w-0 gap-2.5 p-3 transition hover:bg-white/[0.025]">
                      <div className="relative aspect-video w-[104px] shrink-0 overflow-hidden rounded-md border border-white/[0.08] bg-black/45">
                        {video.thumbnail ? <img src={video.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" /> : null}
                        <span className={"absolute left-1 top-1 rounded px-1 py-0.5 text-[7px] font-black uppercase text-white " + (liveItem ? "bg-[#FB2C36]" : "bg-black/75")}>{liveItem ? "Ao vivo" : "YouTube"}</span>
                        <span className="absolute bottom-1 left-1 flex h-5 w-5 items-center justify-center rounded bg-[#FB2C36] text-[10px] text-white">▶</span>
                      </div>
                      <div className="min-w-0 flex-1 self-center">
                        <h3 className="line-clamp-3 text-[10px] font-bold leading-snug text-white/85 transition group-hover:text-white">{video.title}</h3>
                        <p className="mt-1.5 line-clamp-1 text-[9px] text-white/40">{formatPublishedDate(video.publishedAt) || "Canal Rabiisco"}</p>
                      </div>
                    </a>
                  );
                })}
              </div>
            ) : (
              <div className="p-3.5">
                <p className="text-[10px] text-white/50">{youtubeLoaded ? "Nenhum conteúdo recente foi localizado agora." : "Buscando o conteúdo do canal…"}</p>
                <Link href="/conteudo" className="mt-2 inline-flex text-[10px] font-bold text-[#FB2C36] hover:text-white">Abrir Conteúdo →</Link>
              </div>
            )}
          </section>
          </aside>
        </div>

        <footer className="mt-8 border-t border-white/[0.08] py-4 text-center text-[9px] font-semibold tracking-[0.16em] text-white/30">
          RUMO À CONQUISTA · CADA JOGO CONTA. CADA CONQUISTA FICA.
        </footer>
      </div>
    </div>
  );
}
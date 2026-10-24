"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
function getUnlockedAchievements(game: HomeGame) {
  const list = Array.isArray(game.achievementsList) ? game.achievementsList as AchievementLike[] : [];
  return list.filter((item) =>
    ["completed", "concluido", "concluida", "desbloqueado", "desbloqueada"].includes(normalizeKey(item.status))
  );
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
function Stat({ symbol, value, label, accent }: { symbol: string; value: string | number; label: string; accent: string }) {
  const icon = symbol === "gamepad" ? (
    <><path d="M6 9h12a4 4 0 0 1 3.8 5.2l-1 3.1a2.4 2.4 0 0 1-4 .9L14.6 16H9.4l-2.2 2.2a2.4 2.4 0 0 1-4-.9l-1-3.1A4 4 0 0 1 6 9Z" /><path d="M7 11v4m-2-2h4m7-1h.01M18 14h.01" /></>
  ) : symbol === "check" ? (
    <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16.5 9" /></>
  ) : symbol === "trophy" ? (
    <><path d="M8 21h8m-4-4v4m-5-18h10v5a5 5 0 0 1-10 0V3Z" /><path d="M7 5H3v2a5 5 0 0 0 5 5M17 5h4v2a5 5 0 0 1-5 5" /></>
  ) : (
    <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>
  );
  return (
    <div className="flex min-w-0 items-center gap-3 px-3 py-3.5 sm:px-5 sm:py-4">
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center text-[#FB2C36] sm:h-10 sm:w-10" style={{ color: accent }}>
        <svg viewBox="0 0 24 24" className="h-7 w-7 sm:h-8 sm:w-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
      </span>
      <div className="min-w-0">
        <p className="truncate text-lg font-black leading-none text-white sm:text-xl">{value}</p>
        <p className="mt-1 text-[10px] leading-tight text-white/55 sm:text-[11px]">{label}</p>
      </div>
    </div>
  );
}
function AchievementIcon({ achievement }: { achievement: AchievementLike }) {
  const image = readText(achievement.image, "") || readText(achievement.officialImage, "");
  return (
    <span title={readText(achievement.title, "Conquista desbloqueada")} className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/[0.12] bg-black/45 text-sm">
      {image ? <img src={image} alt="" loading="lazy" className="h-full w-full object-contain" /> : getAchievementSymbol(achievement)}
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
  const visibleCurrentAchievements = currentUnlockedAchievements.slice(0, 8);

  return (
    <div className="mx-auto w-full max-w-[1560px] px-4 pb-12 pt-4 sm:px-6 lg:px-8 lg:pt-5">
      {/* Cabeçalho de perfil compacto inspirado no YourGamerProfile */}
      <section
        aria-labelledby="home-profile-title"
        className="relative isolate flex min-h-[145px] items-center overflow-hidden rounded-xl border border-red-500/20 bg-[#06070a] px-4 py-4 sm:min-h-[164px] sm:px-6 lg:px-8"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-20">
          <img src="/images/home-profile-banner-art.webp" alt="" className="h-full w-full object-cover object-center" />
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={{
          backgroundImage: "linear-gradient(90deg, rgba(4,5,8,0.97) 0%, rgba(4,5,8,0.86) 32%, rgba(4,5,8,0.55) 66%, rgba(4,5,8,0.60) 100%), linear-gradient(0deg, rgba(2,3,5,0.35), rgba(2,3,5,0.10))"
        }} />

        <div className="flex w-full min-w-0 items-center gap-4 sm:gap-5">
          <div className="h-[68px] w-[68px] shrink-0 overflow-hidden rounded-lg border border-white/[0.14] bg-black/55 p-0.5 sm:h-[76px] sm:w-[76px]">
            <img
              src="/images/avatar.jpg"
              alt="Avatar do Rabiisco"
              className="h-full w-full rounded-md object-cover"
            />
          </div>

          <div className="min-w-0 flex-1">
            <h1 id="home-profile-title" className="text-2xl font-bold leading-tight tracking-tight text-white sm:text-[28px]">
              Rabiisco
            </h1>
            <p className="mt-1 text-xs leading-relaxed text-white/65 sm:text-[13px]">
              Jogos, conquistas e histórias de cada jornada.
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <a
                href="https://www.youtube.com/@orabiisco"
                target="_blank"
                rel="noreferrer"
                aria-label="YouTube do Rabiisco"
                title="YouTube"
                className="inline-flex h-6 items-center justify-center text-[#FB2C36]/90 transition hover:text-[#ff737a]"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[17px] w-[17px]" fill="currentColor">
                  <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.2 3.6-6.2 3.6Z" />
                </svg>
              </a>
              <a
                href="https://www.twitch.tv/orabiisco"
                target="_blank"
                rel="noreferrer"
                aria-label="Twitch do Rabiisco"
                title="Twitch"
                className="inline-flex h-6 items-center justify-center text-white/55 transition hover:text-[#bf94ff]"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[17px] w-[17px]" fill="currentColor">
                  <path d="M4.3 2 1 5.3v14.1h5.4V22h3.3l2.6-2.6h4.1L23 12.7V2H4.3Zm16.4 9.6-3.3 3.3h-4.1l-2.6 2.6v-2.6H6.4V4.1h14.3v7.5ZM16 6.8h2.1v6.1H16V6.8Zm-5.7 0h2.1v6.1h-2.1V6.8Z" />
                </svg>
              </a>
              <span aria-hidden="true" className="h-3.5 w-px bg-white/15" />
              <Link
                href="/perfil"
                className="text-[10px] font-medium text-white/50 transition hover:text-white/85 sm:text-[11px]"
              >
                Ver perfil completo <span className="text-[#FB2C36]/90">→</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Estatísticas em uma faixa única e discreta */}
      <section aria-label="Resumo da jornada" className="mt-3 overflow-hidden rounded-xl border border-white/[0.09] bg-[#07090d]/95">
        <div className="grid grid-cols-2 divide-x divide-y divide-white/[0.08] sm:grid-cols-4 sm:divide-y-0">
          <Stat symbol="gamepad" value={isLoaded ? summary.games.toLocaleString("pt-BR") : "—"} label="Jogos registrados" accent="#FB2C36" />
          <Stat symbol="check" value={isLoaded ? summary.completed.toLocaleString("pt-BR") : "—"} label="Jogos concluídos" accent="#FB2C36" />
          <Stat symbol="trophy" value={isLoaded ? summary.unlocked.toLocaleString("pt-BR") : "—"} label="Conquistas desbloqueadas" accent="#FB2C36" />
          <Stat symbol="clock" value={isLoaded ? summary.hours : "—"} label="Tempo de jogo" accent="#FB2C36" />
        </div>
      </section>

      {/* Jogo atual com a faixa de conquistas integrada */}
      <section className="mt-4 overflow-hidden rounded-xl border border-red-500/25 bg-[#05070a]" aria-labelledby="current-game-title">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.09] px-4 py-3 sm:px-5">
          <h2 id="current-game-title" className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-white sm:text-base">
            <span aria-hidden="true" className="h-5 w-1 rounded-full bg-[#FB2C36]" /> Jogo atual
          </h2>
          {currentGame ? <Link href={"/games/" + currentGame.slug} className="text-[10px] font-bold text-white/45 transition hover:text-white sm:text-xs">Abrir jogo <span className="text-[#FB2C36]">→</span></Link> : null}
        </div>

        {currentGame ? (
          <>
            <div className="grid gap-4 p-3 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-5 sm:p-4 lg:grid-cols-[192px_minmax(0,1fr)] lg:gap-6 lg:p-5">
              <Link href={"/games/" + currentGame.slug} className="mx-auto flex aspect-[3/4] w-[136px] items-center justify-center overflow-hidden rounded-lg border border-white/[0.12] bg-black/45 p-1.5 transition hover:border-red-500/40 sm:mx-0 sm:w-full">
                <img src={currentGame.cardImage || currentGame.image || ""} alt={currentGame.title + " — capa"} loading="lazy" className="max-h-full max-w-full object-contain" />
              </Link>

              <div className="min-w-0 flex flex-col justify-center">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    {currentGame.firstJourney?.status === "in_progress" ? <span className="inline-flex rounded border border-emerald-400/25 bg-emerald-400/[0.06] px-2 py-1 text-[9px] font-bold text-emerald-200">Jornada de Estreia</span> : null}
                    <h3 className="mt-1 text-lg font-black leading-snug text-white sm:text-2xl">{currentGame.title}</h3>
                    <p className="mt-1 text-xs text-white/55">{currentGame.subtitle || "Sua jornada em andamento"}</p>
                  </div>
                  {getGameTimestamp(currentGame) ? <span className="shrink-0 text-[10px] text-white/45">{formatShortDate(getGameTimestamp(currentGame))}</span> : null}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-white/65 sm:text-xs">
                  {currentGame.platform ? <span className="inline-flex items-center gap-2 rounded-md bg-[#1267c8] px-3 py-1.5 font-bold text-white"><span aria-hidden="true">▰</span>{currentGame.platform}</span> : null}
                  {hasUsefulTimeValue(currentGame.hours) ? <span className="inline-flex items-center gap-2"><span className="text-lg text-white/80">◷</span><span className="font-bold text-white/85">{readText(currentGame.hours, "")}</span></span> : null}
                  {readText(currentGame.currentObjective || currentGame.objective, "") ? <span className="max-w-full truncate">{readText(currentGame.currentObjective || currentGame.objective, "")}</span> : null}
                </div>

                <div className="mt-4 max-w-[820px]">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                    <span className="font-black text-white">{currentCounts?.unlocked ?? 0} / {currentCounts?.total ?? 0} conquistas</span>
                    <div className="h-2 min-w-[100px] flex-1 overflow-hidden rounded-full bg-white/[0.10]">
                      <div className="h-full rounded-full bg-[#FB2C36]" style={{ width: currentProgress + "%" }} />
                    </div>
                    <span className="font-black text-white">{currentProgress}%</span>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-4 text-[10px] text-white/60 sm:gap-6 sm:text-[11px]">
                  <span className="inline-flex items-center gap-2"><span className="text-lg text-[#FB2C36]">🏆</span> {currentCounts?.unlocked ?? 0} desbloqueadas</span>
                  {currentCounts ? <span className="inline-flex items-center gap-2"><span className="text-lg text-[#FB2C36]">◈</span> {currentCounts.total} no total</span> : null}
                </div>
              </div>
            </div>

            <div className="border-t border-white/[0.09] px-3 py-3 sm:px-4 sm:py-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-xs font-bold text-white/85 sm:text-sm">
                  <span aria-hidden="true" className="h-4 w-1 rounded-full bg-[#FB2C36]" /> Conquistas recentes
                </h3>
                <Link href={"/games/" + currentGame.slug} className="shrink-0 text-[10px] font-bold text-[#FB2C36] transition hover:text-white sm:text-xs">Ver todas <span aria-hidden="true">→</span></Link>
              </div>
              {visibleCurrentAchievements.length ? (
                <div className="flex gap-2 overflow-x-auto pb-1 sm:gap-3">
                  {visibleCurrentAchievements.map((achievement, index) => {
                    const image = readText(achievement.image, "") || readText(achievement.officialImage, "");
                    const title = getAchievementTitle(achievement, index);
                    return (
                      <Link key={currentGame.slug + ":" + title + ":" + index} href={"/games/" + currentGame.slug} title={title} aria-label={title} className="group flex h-[58px] w-[58px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/[0.14] bg-black/40 p-1 transition hover:border-red-500/60 sm:h-[66px] sm:w-[66px]">
                        {image ? <img src={image} alt="" loading="lazy" className="h-full w-full object-contain" /> : <span className="text-2xl">{getAchievementSymbol(achievement)}</span>}
                      </Link>
                    );
                  })}
                  {currentUnlockedAchievements.length > visibleCurrentAchievements.length ? (
                    <Link href={"/games/" + currentGame.slug} className="flex h-[58px] min-w-[72px] shrink-0 flex-col items-center justify-center rounded-md border border-white/[0.12] bg-white/[0.025] text-[10px] font-bold text-white/70 transition hover:border-red-500/40 hover:text-white sm:h-[66px] sm:min-w-[82px]">
                      +{currentUnlockedAchievements.length - visibleCurrentAchievements.length}
                      <span className="mt-0.5 text-[9px] text-white/45">conquistas</span>
                    </Link>
                  ) : null}
                </div>
              ) : (
                <p className="py-2 text-[11px] text-white/45">As conquistas desbloqueadas deste jogo aparecerão aqui.</p>
              )}
            </div>
          </>
        ) : (
          <div className="p-5 sm:p-7">
            <h3 className="text-base font-black text-white">Nenhum jogo em andamento</h3>
            <p className="mt-2 text-sm text-white/55">Selecione uma jornada na Biblioteca para definir o jogo atual.</p>
            <Link href="/biblioteca" className="mt-3 inline-flex text-xs font-bold text-red-300 hover:text-white">Abrir biblioteca →</Link>
          </div>
        )}
      </section>

      {/* Jogos recentes em galeria horizontal, sem cartões repetidos */}
      <section className="mt-5 overflow-hidden rounded-xl border border-white/[0.09] bg-[#07090d]/90" aria-labelledby="recent-games-title">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.09] px-4 py-3 sm:px-5">
          <div>
            <h2 id="recent-games-title" className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-white sm:text-base"><span aria-hidden="true" className="h-5 w-1 rounded-full bg-[#FB2C36]" /> Jogos recentes</h2>
            <p className="mt-1 text-[10px] text-white/45 sm:text-xs">Continue de onde parou ou reveja suas jornadas concluídas.</p>
          </div>
          <Link href="/biblioteca" className="shrink-0 text-[10px] font-bold text-[#FB2C36] transition hover:text-white sm:text-xs">Ver todos <span aria-hidden="true">→</span></Link>
        </div>

        {recentGames.length ? (
          <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 sm:p-4 lg:grid-cols-6">
            {recentGames.map((game) => {
              const counts = getAchievementCounts(game);
              const progress = Math.max(0, Math.min(100, Number(game.progress) || 0));
              return (
                <Link key={game.slug} href={"/games/" + game.slug} className="group min-w-0 overflow-hidden rounded-lg border border-white/[0.10] bg-black/30 transition hover:border-red-500/40 hover:bg-black/50">
                  <div className="flex aspect-[3/4] items-center justify-center overflow-hidden bg-black/35 p-1.5 sm:p-2">
                    <img src={game.cardImage || game.image || ""} alt={game.title + " — capa"} loading="lazy" className="max-h-full max-w-full object-contain transition duration-300 group-hover:scale-[1.02]" />
                  </div>
                  <div className="p-2 sm:p-2.5">
                    <h3 className="line-clamp-2 min-h-[2.4em] text-[10px] font-black leading-snug text-white/90 transition group-hover:text-white sm:text-xs">{game.title}</h3>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[9px] text-white/50 sm:text-[10px]">
                      {game.platform ? <span className="truncate rounded bg-white/[0.06] px-1.5 py-0.5 font-bold text-white/70">{game.platform}</span> : <span>Jornada</span>}
                      <span className="shrink-0 font-black text-white/80">{progress}%</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.10]">
                      <div className={"h-full rounded-full " + (progress >= 100 ? "bg-emerald-400" : "bg-[#FB2C36]")} style={{ width: progress + "%" }} />
                    </div>
                    <p className="mt-1.5 text-[9px] text-white/45">{counts.unlocked}/{counts.total} conquistas</p>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="p-5 text-sm text-white/50">Os jogos recentes aparecerão aqui conforme o progresso for registrado.</p>
        )}
      </section>

      {/* Blocos secundários horizontais, sem sidebars */}
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="min-w-0 overflow-hidden rounded-xl border border-white/[0.09] bg-[#07090d]/90" aria-labelledby="next-mastery-title">
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.09] px-4 py-3">
            <h2 id="next-mastery-title" className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-white"><span aria-hidden="true" className="h-5 w-1 rounded-full bg-[#FB2C36]" /> Próxima Maestria</h2>
            <Link href="/backlog" className="shrink-0 text-[10px] font-bold text-white/45 transition hover:text-white">Ver fila →</Link>
          </div>
          {nextMastery ? (
            <div className="grid gap-3 p-3 sm:grid-cols-[132px_minmax(0,1fr)] sm:p-4">
              <Link href={"/games/" + nextMastery.slug} className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-white/[0.10] bg-black/40 p-2 sm:aspect-auto sm:min-h-[132px]">
                <img src={nextMastery.cardImage || nextMastery.image || ""} alt={nextMastery.title + " — capa"} loading="lazy" className="max-h-full max-w-full object-contain" />
              </Link>
              <div className="flex min-w-0 flex-col justify-center">
                <h3 className="text-base font-black leading-snug text-white">{nextMastery.title}</h3>
                <p className="mt-1 text-[11px] text-white/55">{nextCounts?.unlocked ?? 0} / {nextCounts?.total ?? 0} conquistas</p>
                <div className="mt-2 flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.10]"><div className="h-full rounded-full bg-amber-400" style={{ width: nextProgress + "%" }} /></div>
                  <span className="text-xs font-black text-white">{nextProgress}%</span>
                </div>
                <Link href={"/games/" + nextMastery.slug} className="mt-3 inline-flex text-[11px] font-bold text-[#FB2C36] transition hover:text-white">Ver detalhes <span className="ml-1">→</span></Link>
              </div>
            </div>
          ) : (
            <div className="p-4">
              <p className="text-sm font-bold text-white">Sua próxima Maestria ainda não foi definida.</p>
              <p className="mt-1 text-xs text-white/50">Escolha um jogo na fila para destacá-lo aqui.</p>
              <Link href="/backlog" className="mt-3 inline-flex text-xs font-bold text-[#FB2C36] hover:text-white">Organizar fila →</Link>
            </div>
          )}
        </section>

        <section className="min-w-0 overflow-hidden rounded-xl border border-white/[0.09] bg-[#07090d]/90" aria-labelledby="recent-content-title">
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.09] px-4 py-3">
            <h2 id="recent-content-title" className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-white"><span aria-hidden="true" className="h-5 w-1 rounded-full bg-[#FB2C36]" /> Conteúdo recente</h2>
            <Link href="/conteudo" className="shrink-0 text-[10px] font-bold text-[#FB2C36] transition hover:text-white">Ver todos <span aria-hidden="true">→</span></Link>
          </div>
          {recentVideos.length ? (
            <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              {recentVideos.slice(0, 4).map((video) => {
                const liveItem = Boolean(isLive && featuredVideo?.id === video.id);
                return (
                  <a key={video.id} href={video.url} target="_blank" rel="noreferrer" className="group min-w-0 overflow-hidden rounded-lg border border-white/[0.08] bg-black/30 transition hover:border-red-500/35">
                    <div className="relative aspect-video overflow-hidden bg-black/45">
                      {video.thumbnail ? <img src={video.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" /> : null}
                      <span className={"absolute left-1.5 top-1.5 rounded px-1.5 py-1 text-[8px] font-black uppercase text-white " + (liveItem ? "bg-[#FB2C36]" : "bg-black/75")}>{liveItem ? "Ao vivo" : "YouTube"}</span>
                      <span className="absolute bottom-1.5 left-1.5 flex h-6 w-6 items-center justify-center rounded bg-[#FB2C36] text-xs text-white">▶</span>
                    </div>
                    <div className="p-2">
                      <h3 className="line-clamp-2 text-[10px] font-bold leading-snug text-white/90 sm:text-[11px]">{video.title}</h3>
                      <p className="mt-1 line-clamp-1 text-[9px] text-white/40">{video.publishedAt || "Canal Rabiisco"}</p>
                    </div>
                  </a>
                );
              })}
            </div>
          ) : (
            <div className="p-4">
              <p className="text-xs text-white/50">{youtubeLoaded ? "Nenhum conteúdo recente foi localizado agora." : "Buscando o último conteúdo do canal…"}</p>
              <Link href="/conteudo" className="mt-2 inline-flex text-xs font-bold text-[#FB2C36] hover:text-white">Abrir Conteúdo →</Link>
            </div>
          )}
        </section>
      </div>

      <footer className="mt-8 border-t border-white/[0.08] py-4 text-center text-[9px] font-semibold tracking-[0.16em] text-white/30">
        RUMO À CONQUISTA · CADA JOGO CONTA. CADA CONQUISTA FICA.
      </footer>
    </div>
  );
}
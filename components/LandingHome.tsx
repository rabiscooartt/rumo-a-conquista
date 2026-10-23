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
type HomeActivity = {
  key: string; slug: string; gameTitle: string; title: string;
  dateLabel: string; timestamp: number; image?: string; symbol: string; kind: string;
};

const GAMES_UPDATED_EVENT = "rumo-a-conquista-games-updated";
const ACHIEVEMENTS_UPDATED_EVENT = "rumo-a-conquista-achievements-updated";
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
function buildRecentActivity(games: HomeGame[]): HomeActivity[] {
  const events: HomeActivity[] = [];
  const seen = new Set<string>();
  for (const game of games) {
    const slug = readText(game.slug, "");
    if (!slug) continue;
    const base = Array.isArray(game.achievementsList) ? game.achievementsList as AchievementLike[] : [];
    const custom = readLocalJson<AchievementLike[]>("rumo-a-conquista-custom-achievements-" + slug, []);
    const hidden = new Set(readLocalJson<string[]>("rumo-a-conquista-hidden-achievements-" + slug, []));
    const savedStates = readLocalJson<Record<string, SavedAchievementState>>("rumo-a-conquista-achievements-" + slug, {});
    [...base, ...custom].forEach((achievement, index) => {
      const title = getAchievementTitle(achievement, index);
      if (!title || hidden.has(title)) return;
      const saved = savedStates[title];
      const status = normalizeKey(saved?.status || achievement.status);
      const timestamp = parseDateValue(saved?.date || achievement.earnedDate);
      if (
        !timestamp ||
        !["completed", "concluido", "concluida", "desbloqueado", "desbloqueada"].includes(status)
      ) return;
      const key = [slug, title, timestamp].join(":");
      if (seen.has(key)) return;
      seen.add(key);
      events.push({
        key, slug, gameTitle: game.title, title,
        dateLabel: formatShortDate(timestamp), timestamp,
        image: readText(saved?.image, "") || readText(achievement.image, "") || readText(achievement.officialImage, ""),
        symbol: getAchievementSymbol(achievement), kind: "Conquista desbloqueada",
      });
    });
    const emblem = game.emblem;
    const emblemDate = parseDateValue(emblem?.unlockedAt);
    const emblemTitle = readText(emblem?.title, "").trim();
    if (emblemDate && emblemTitle) {
      const key = [slug, "emblem", emblemTitle, emblemDate].join(":");
      if (!seen.has(key)) {
        seen.add(key);
        events.push({
          key, slug, gameTitle: game.title, title: emblemTitle,
          dateLabel: formatShortDate(emblemDate), timestamp: emblemDate,
          image: readText(emblem?.image, ""), symbol: "🏅", kind: "Emblema registrado",
        });
      }
    }
  }
  return events.sort((a, b) => b.timestamp - a.timestamp).slice(0, 4);
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
  return (
    <div className="flex min-w-0 items-center gap-3 px-3 py-3 sm:px-4">
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-black/25 text-lg" style={{ color: accent }}>{symbol}</span>
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
  const [isLive, setIsLive] = useState(false);
  const [youtubeLoaded, setYoutubeLoaded] = useState(false);
  const [recentActivity, setRecentActivity] = useState<HomeActivity[]>([]);

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
        setFeaturedVideo(live || payload.videos?.[0] || null);
        setIsLive(Boolean(live));
      } catch {
        if (!controller.signal.aborted) { setFeaturedVideo(null); setIsLive(false); }
      } finally {
        if (!controller.signal.aborted) setYoutubeLoaded(true);
      }
    }
    loadFeaturedContent();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    function refreshActivity() { setRecentActivity(buildRecentActivity(allGames)); }
    if (isLoaded) refreshActivity();
    window.addEventListener("storage", refreshActivity);
    window.addEventListener(GAMES_UPDATED_EVENT, refreshActivity);
    window.addEventListener(ACHIEVEMENTS_UPDATED_EVENT, refreshActivity);
    return () => {
      window.removeEventListener("storage", refreshActivity);
      window.removeEventListener(GAMES_UPDATED_EVENT, refreshActivity);
      window.removeEventListener(ACHIEVEMENTS_UPDATED_EVENT, refreshActivity);
    };
  }, [allGames, isLoaded]);

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
    }).slice(0, 3);
  }, [gamesByUpdated, currentGame, nextMastery]);

  const recentAchievementKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const game of recentGames) {
      getUnlockedAchievements(game).slice(0, 6).forEach((achievement, index) => {
        keys.add(game.slug + ":" + getAchievementTitle(achievement, index));
      });
    }
    return keys;
  }, [recentGames]);

  const recentActivityKeys = useMemo(
    () => new Set(recentActivity.map((item) => item.slug + ":" + item.title)),
    [recentActivity]
  );

  const featuredAchievements = useMemo(() => {
    const excludedSlugs = new Set(
      [currentGame?.slug, nextMastery?.slug, ...recentGames.map((game) => game.slug)]
        .filter((slug): slug is string => Boolean(slug))
    );
    const candidates: Array<{ game: HomeGame; achievement: AchievementLike; key: string; timestamp: number }> = [];
    for (const game of allGames) {
      if (excludedSlugs.has(game.slug)) continue;
      getUnlockedAchievements(game).forEach((achievement, index) => {
        const title = getAchievementTitle(achievement, index);
        const key = game.slug + ":" + title;
        if (!title || recentAchievementKeys.has(key) || recentActivityKeys.has(key)) return;
        candidates.push({ game, achievement, key, timestamp: parseDateValue(achievement.earnedDate) });
      });
    }
    candidates.sort((a, b) => b.timestamp - a.timestamp);
    return candidates.slice(0, 6);
  }, [allGames, currentGame, nextMastery, recentAchievementKeys, recentGames, recentActivityKeys]);

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

  return (
    <div className="mx-auto w-full max-w-[1380px] px-4 pb-12 pt-5 sm:px-6 lg:px-8 lg:pt-6">
      {/* Banner compacto inspirado no cabeçalho de perfil do YourGamerProfile */}
      <section
        aria-labelledby="home-profile-title"
        className="relative isolate min-h-[148px] overflow-hidden rounded-xl border border-white/[0.10] bg-[#07080b] shadow-[0_14px_36px_rgba(0,0,0,0.22)] sm:min-h-[166px]"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-20">
          <img
            src="/images/home-profile-banner-art.webp"
            alt=""
            className="h-full w-full object-cover object-center"
          />
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            backgroundImage:
              "linear-gradient(90deg, rgba(5,6,9,0.94) 0%, rgba(5,6,9,0.88) 34%, rgba(5,6,9,0.76) 62%, rgba(5,6,9,0.66) 100%), linear-gradient(0deg, rgba(5,6,9,0.22), rgba(5,6,9,0.10))",
          }}
        />
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 -z-10 hidden w-[38%] bg-gradient-to-l from-red-950/20 to-transparent sm:block" />

        <div className="relative flex min-h-[148px] items-center gap-4 px-4 py-4 sm:min-h-[166px] sm:gap-5 sm:px-6 lg:px-7">
          <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl border border-red-500/45 bg-black/70 p-1 shadow-[0_0_20px_rgba(251,44,54,0.12)] sm:h-[84px] sm:w-[84px]">
            <img
              src="/images/avatar.jpg"
              alt="Avatar do Rabiisco"
              className="h-full w-full rounded-lg object-cover"
            />
            <span
              aria-hidden="true"
              className="absolute bottom-1.5 right-1.5 h-2.5 w-2.5 rounded-full border-2 border-[#08090c] bg-[#FB2C36]"
            />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-black uppercase tracking-[0.17em] text-red-300/90 sm:text-[10px] sm:tracking-[0.2em]">
              Criador do Rumo à Conquista
            </p>
            <h1 id="home-profile-title" className="mt-1 text-2xl font-black leading-tight tracking-tight text-white sm:text-3xl">
              Rabiisco
            </h1>
            <p className="mt-1 max-w-[610px] text-xs leading-relaxed text-white/65 sm:text-sm">
              Jogos, conquistas e histórias de cada jornada.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                href="https://www.youtube.com/@orabiisco"
                target="_blank"
                rel="noreferrer"
                aria-label="YouTube do Rabiisco"
                className="inline-flex h-8 items-center gap-2 rounded-md border border-white/[0.12] bg-black/35 px-2.5 text-[10px] font-bold text-white/75 transition hover:border-red-400/40 hover:text-white"
              >
                <span aria-hidden="true" className="text-[#FB2C36]">▶</span> YouTube
              </a>
              <a
                href="https://www.twitch.tv/orabiisco"
                target="_blank"
                rel="noreferrer"
                aria-label="Twitch do Rabiisco"
                className="inline-flex h-8 items-center gap-2 rounded-md border border-white/[0.12] bg-black/35 px-2.5 text-[10px] font-bold text-white/75 transition hover:border-purple-400/40 hover:text-white"
              >
                <span aria-hidden="true" className="text-purple-300">▣</span> Twitch
              </a>
              <Link
                href="/perfil"
                className="px-1.5 py-2 text-[10px] font-semibold text-white/45 transition hover:text-white sm:text-[11px]"
              >
                Ver perfil completo <span className="text-[#FB2C36]">→</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Estatísticas em uma faixa única e discreta */}
      <section aria-label="Resumo da jornada" className="border-b border-white/[0.10]">
        <div className="grid grid-cols-2 divide-x divide-y divide-white/[0.08] sm:grid-cols-4 sm:divide-y-0">
          <Stat symbol="🎮" value={isLoaded ? summary.games.toLocaleString("pt-BR") : "—"} label="Jogos registrados" accent="#FB2C36" />
          <Stat symbol="✓" value={isLoaded ? summary.completed.toLocaleString("pt-BR") : "—"} label="Jogos concluídos" accent="#38d9a9" />
          <Stat symbol="🏆" value={isLoaded ? summary.unlocked.toLocaleString("pt-BR") : "—"} label="Conquistas desbloqueadas" accent="#f5b83d" />
          <Stat symbol="◷" value={isLoaded ? summary.hours : "—"} label="Tempo registrado" accent="#60a5fa" />
        </div>
      </section>

      {/* Foco atual e próximo objetivo em uma composição contínua */}
      <section className="mt-7" aria-labelledby="journey-focus-title">
        <div className="flex items-end justify-between gap-3 border-b border-white/[0.10] pb-3">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#FB2C36]">Em andamento</p>
            <h2 id="journey-focus-title" className="mt-1 text-lg font-black text-white sm:text-xl">Foco da jornada</h2>
          </div>
          <Link href="/biblioteca" className="shrink-0 text-[11px] font-bold text-white/50 transition hover:text-white">Biblioteca completa <span className="text-[#FB2C36]">→</span></Link>
        </div>

        <div className="mt-4">
          {currentGame ? (
            <article className="grid gap-4 border-b border-white/[0.10] pb-5 sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-5 lg:grid-cols-[132px_minmax(0,1fr)_190px] lg:items-center">
              <div className="flex h-[138px] w-[112px] items-center justify-center overflow-hidden rounded-lg border border-white/[0.10] bg-black/35 p-1.5 sm:h-[150px] sm:w-[112px] lg:h-[158px] lg:w-[132px]">
                <img src={currentGame.cardImage || currentGame.image || ""} alt={currentGame.title + " — capa"} loading="lazy" className="max-h-full max-w-full object-contain" />
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded border border-red-400/25 bg-red-500/[0.07] px-2 py-1 text-[9px] font-black uppercase tracking-wide text-red-200">Jogo atual</span>
                  {currentGame.firstJourney?.status === "in_progress" ? <span className="rounded border border-emerald-400/25 px-2 py-1 text-[9px] font-bold text-emerald-200">Jornada de Estreia</span> : null}
                </div>
                <h3 className="mt-2 text-lg font-black leading-snug text-white sm:text-xl">{currentGame.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-white/55">{currentGame.subtitle || "Jornada em andamento"}</p>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-white/55">
                  {currentGame.platform ? <span className="rounded border border-white/[0.10] px-2 py-1 font-bold text-white/75">{currentGame.platform}</span> : null}
                  {hasUsefulTimeValue(currentGame.hours) ? <span>◷ <span className="font-bold text-white/80">{readText(currentGame.hours, "")}</span></span> : null}
                  {readText(currentGame.currentObjective || currentGame.objective, "") ? <span className="max-w-full truncate">{readText(currentGame.currentObjective || currentGame.objective, "")}</span> : null}
                </div>
                <div className="mt-4">
                  <div className="flex items-center justify-between gap-3 text-[11px]">
                    <span className="font-bold text-white/85">{currentCounts?.unlocked ?? 0} de {currentCounts?.total ?? 0} conquistas</span>
                    <span className="font-black text-white">{currentProgress}%</span>
                  </div>
                  <div className="mt-1.5 h-1.5 max-w-[620px] overflow-hidden rounded-full bg-white/[0.10]">
                    <div className="h-full rounded-full bg-[#FB2C36]" style={{ width: currentProgress + "%" }} />
                  </div>
                </div>
                <Link href={"/games/" + currentGame.slug} className="mt-3 inline-flex items-center gap-2 text-[11px] font-black text-red-300 transition hover:text-white">Abrir jogo <span>→</span></Link>
              </div>

              <div className="hidden border-l border-white/[0.10] pl-5 lg:block">
                <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/40">Progresso atual</p>
                <p className="mt-2 text-3xl font-black leading-none text-white">{currentProgress}<span className="ml-1 text-sm text-white/40">%</span></p>
                <p className="mt-2 text-[11px] leading-relaxed text-white/50">{currentCounts?.unlocked ?? 0} de {currentCounts?.total ?? 0} conquistas desbloqueadas</p>
                {hasUsefulTimeValue(currentGame.hours) ? <p className="mt-3 text-[11px] text-white/50">Tempo jogado <span className="font-bold text-white/80">{readText(currentGame.hours, "")}</span></p> : null}
              </div>
            </article>
          ) : (
            <article className="border-b border-white/[0.10] py-6">
              <h3 className="text-base font-black text-white">Nenhum jogo em andamento</h3>
              <p className="mt-2 text-sm text-white/55">Selecione uma jornada na Biblioteca para definir o jogo atual.</p>
              <Link href="/biblioteca" className="mt-3 inline-flex text-xs font-bold text-red-300 hover:text-white">Abrir biblioteca →</Link>
            </article>
          )}

          <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/[0.06] text-xl text-[#FB2C36]">◇</div>
            {nextMastery ? (
              <>
                <div className="flex h-[58px] w-[46px] shrink-0 items-center justify-center overflow-hidden rounded border border-white/[0.10] bg-black/30 p-1">
                  <img src={nextMastery.cardImage || nextMastery.image || ""} alt="" loading="lazy" className="h-full w-full object-contain" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#FB2C36]">Próxima maestria</p>
                  <h3 className="mt-0.5 truncate text-sm font-black text-white">{nextMastery.title}</h3>
                  <p className="mt-1 text-[10px] text-white/50">{nextCounts?.unlocked ?? 0}/{nextCounts?.total ?? 0} conquistas · {nextProgress}% de progresso</p>
                </div>
                <div className="hidden w-[150px] shrink-0 sm:block">
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.10]"><div className="h-full rounded-full bg-amber-400" style={{ width: nextProgress + "%" }} /></div>
                </div>
                <Link href={"/games/" + nextMastery.slug} className="shrink-0 text-[11px] font-black text-white/60 transition hover:text-red-300">Ver detalhes →</Link>
              </>
            ) : (
              <>
                <div className="min-w-0 flex-1">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#FB2C36]">Próxima maestria</p>
                  <h3 className="mt-0.5 text-sm font-black text-white">Sua próxima jornada ainda não foi definida</h3>
                  <p className="mt-1 text-[11px] text-white/50">Escolha um jogo na fila para destacá-lo aqui.</p>
                </div>
                <Link href="/backlog" className="shrink-0 text-[11px] font-black text-white/60 transition hover:text-red-300">Organizar fila →</Link>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Listagem ampla: capas inteiras e progresso em colunas consistentes */}
      <section className="mt-8" aria-labelledby="recent-games-title">
        <div className="flex items-end justify-between gap-3 border-b border-white/[0.10] pb-3">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#FB2C36]">Seu catálogo</p>
            <h2 id="recent-games-title" className="mt-1 text-lg font-black text-white sm:text-xl">Jogos recentes</h2>
          </div>
          <Link href="/biblioteca" className="shrink-0 text-[11px] font-bold text-white/50 transition hover:text-white">Ver biblioteca <span className="text-[#FB2C36]">→</span></Link>
        </div>
        <p className="mt-2 text-xs text-white/45">Últimos jogos atualizados, com as conquistas agrupadas por jogo.</p>

        {recentGames.length ? (
          <div className="mt-2 divide-y divide-white/[0.09]">
            {recentGames.map((game) => {
              const counts = getAchievementCounts(game);
              const progress = Math.max(0, Math.min(100, Number(game.progress) || 0));
              const allUnlockedForGame = getUnlockedAchievements(game);
              const achievements = allUnlockedForGame.slice(0, 4);
              const remainingAchievementCount = Math.max(0, allUnlockedForGame.length - achievements.length);
              const timestamp = getGameTimestamp(game);
              const dateText = timestamp ? formatShortDate(timestamp) : "";
              return (
                <Link key={game.slug} href={"/games/" + game.slug} className="group grid grid-cols-[78px_minmax(0,1fr)] gap-x-3 gap-y-2 py-4 transition hover:bg-white/[0.015] sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-x-4 md:grid-cols-[104px_minmax(0,1fr)_190px] md:items-center md:gap-x-5">
                  <div className="row-span-2 flex h-[92px] w-[78px] items-center justify-center overflow-hidden rounded-lg border border-white/[0.10] bg-black/30 p-1 sm:h-[104px] sm:w-[96px] md:row-span-1 md:w-[104px]">
                    <img src={game.cardImage || game.image || ""} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-black text-white transition group-hover:text-red-100 sm:text-base">{game.title}</h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-white/55 sm:text-[11px]">
                      {game.platform ? <span className="rounded border border-white/[0.10] px-1.5 py-0.5 font-bold text-white/70">{game.platform}</span> : null}
                      {hasUsefulTimeValue(game.hours) ? <span>◷ {readText(game.hours, "")}</span> : null}
                      <span>{counts.unlocked}/{counts.total} conquistas</span>
                      {dateText ? <span className="text-white/35">Atualizado {dateText}</span> : null}
                    </div>
                    <div className="mt-2.5 flex min-h-7 items-center gap-1.5">
                      {achievements.length ? (
                        <>
                          {achievements.map((achievement, index) => <AchievementIcon key={game.slug + "-" + getAchievementTitle(achievement, index)} achievement={achievement} />)}
                          {remainingAchievementCount > 0 ? <span className="flex h-7 min-w-7 items-center justify-center rounded-md border border-white/[0.10] bg-white/[0.035] px-1.5 text-[9px] font-bold text-white/55">+{remainingAchievementCount}</span> : null}
                        </>
                      ) : <span className="text-[10px] text-white/35">Ainda sem conquistas registradas</span>}
                    </div>
                  </div>
                  <div className="col-start-2 min-w-0 pb-1 md:col-start-auto md:pb-0">
                    <div className="flex items-center justify-between gap-2 text-[10px] text-white/55 sm:text-[11px]">
                      <span>Progresso</span><span className="font-black text-white">{progress}%</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.10]">
                      <div className="h-full rounded-full bg-emerald-400" style={{ width: progress + "%" }} />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="py-6 text-sm text-white/50">Os jogos recentes aparecerão aqui conforme o progresso for registrado.</p>
        )}
      </section>

      {/* Conteúdo secundário no fim da página, sem sidebar permanente */}
      <div className="mt-8 grid gap-7 border-t border-white/[0.10] pt-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-9">
        <section className="min-w-0" aria-labelledby="featured-achievements-title">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#FB2C36]">Marcos da jornada</p>
              <h2 id="featured-achievements-title" className="mt-1 text-base font-black text-white sm:text-lg">Conquistas em destaque</h2>
            </div>
            <Link href="/historico" className="shrink-0 text-[10px] font-bold text-white/45 transition hover:text-white">Histórico →</Link>
          </div>
          {featuredAchievements.length ? (
            <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
              {featuredAchievements.map(({ game, achievement, key }) => {
                const image = readText(achievement.image, "") || readText(achievement.officialImage, "");
                return (
                  <Link key={key} href={"/games/" + game.slug} title={getAchievementTitle(achievement, 0) + " — " + game.title} className="group w-[88px] shrink-0 text-center sm:w-[100px]">
                    <div className="mx-auto flex h-[70px] w-[70px] items-center justify-center overflow-hidden rounded-lg border border-white/[0.12] bg-black/35 p-1.5 transition group-hover:border-red-500/40 sm:h-[78px] sm:w-[78px]">
                      {image ? <img src={image} alt="" loading="lazy" className="h-full w-full object-contain" /> : <span className="text-2xl">{getAchievementSymbol(achievement)}</span>}
                    </div>
                    <p className="mt-2 line-clamp-2 text-[10px] font-bold leading-snug text-white/80">{getAchievementTitle(achievement, 0)}</p>
                    <p className="mt-1 line-clamp-1 text-[9px] text-white/40">{game.title}</p>
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="mt-4 text-xs text-white/45">As conquistas especiais aparecerão aqui conforme os registros forem atualizados.</p>
          )}
        </section>

        <section className="min-w-0" aria-labelledby="featured-content-title">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#FB2C36]">Do canal</p>
              <h2 id="featured-content-title" className="mt-1 text-base font-black text-white sm:text-lg">Conteúdo em destaque</h2>
            </div>
            <Link href="/conteudo" className="shrink-0 text-[10px] font-bold text-white/45 transition hover:text-white">Todos os vídeos →</Link>
          </div>
          {featuredVideo ? (
            <a href={featuredVideo.url} target="_blank" rel="noreferrer" className="group mt-4 grid grid-cols-[124px_minmax(0,1fr)] gap-3 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
              <div className="relative aspect-video overflow-hidden rounded-lg border border-white/[0.10] bg-black/40">
                {featuredVideo.thumbnail ? <img src={featuredVideo.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" /> : null}
                <span className={"absolute left-1.5 top-1.5 rounded px-1.5 py-1 text-[8px] font-black uppercase text-white " + (isLive ? "bg-[#FB2C36]" : "border border-white/15 bg-black/80")}>{isLive ? "Ao vivo" : "YouTube"}</span>
                <span className="absolute inset-0 flex items-center justify-center"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#FB2C36] text-sm text-white">▶</span></span>
              </div>
              <div className="min-w-0 self-center">
                <p className="line-clamp-3 text-xs font-black leading-snug text-white transition group-hover:text-red-100 sm:text-sm">{featuredVideo.title}</p>
                <p className="mt-2 text-[10px] font-bold text-red-300">{isLive ? "Assistir ao vivo" : "Assistir no YouTube"} →</p>
              </div>
            </a>
          ) : (
            <div className="mt-4">
              <p className="text-xs leading-relaxed text-white/50">{youtubeLoaded ? "Nenhum conteúdo recente foi localizado agora." : "Buscando o último conteúdo do canal…"}</p>
              <Link href="/conteudo" className="mt-2 inline-flex text-xs font-bold text-red-300 hover:text-white">Abrir Conteúdo →</Link>
            </div>
          )}
        </section>
      </div>

      {recentActivity.length ? (
        <section className="mt-8 border-t border-white/[0.10] pt-6" aria-labelledby="recent-activity-title">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#FB2C36]">Últimas atualizações</p>
              <h2 id="recent-activity-title" className="mt-1 text-base font-black text-white sm:text-lg">Atividade recente</h2>
            </div>
            <Link href="/atividade" className="text-[10px] font-bold text-white/45 transition hover:text-white">Ver atividade →</Link>
          </div>
          <div className="mt-3 grid gap-x-6 sm:grid-cols-2 lg:grid-cols-4">
            {recentActivity.slice(0, 4).map((item) => (
              <Link key={item.key} href={"/games/" + item.slug} className="flex min-w-0 items-center gap-2.5 border-b border-white/[0.07] py-3 transition hover:bg-white/[0.015]">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/[0.10] bg-black/35 text-lg">{item.image ? <img src={item.image} alt="" loading="lazy" className="h-full w-full object-contain" /> : item.symbol}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[9px] font-bold text-[#FB2C36]">{item.kind}</span>
                  <span className="mt-0.5 block truncate text-[11px] font-bold text-white/85">{item.title}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-white/40">{item.gameTitle} · {item.dateLabel}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <footer className="mt-8 border-t border-white/[0.08] py-4 text-center text-[9px] font-semibold tracking-[0.16em] text-white/30">
        RUMO À CONQUISTA · CADA JOGO CONTA. CADA CONQUISTA FICA.
      </footer>
    </div>
  );
}
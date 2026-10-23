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
    status: item.status === "next" || item.status === "waiting" ? item.status : "future",
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
    const explicitNext = backlogEntries.find((item) => item.status === "next");
    if (explicitNext) {
      const chosen = bySlug.get(explicitNext.slug);
      if (chosen && getGameStatus(chosen) !== "completed") return chosen;
    }
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

  const featuredAchievements = useMemo(() => {
    const excludedSlugs = new Set([currentGame?.slug, nextMastery?.slug].filter((slug): slug is string => Boolean(slug)));
    const candidates: Array<{ game: HomeGame; achievement: AchievementLike; key: string; timestamp: number }> = [];
    for (const game of allGames) {
      if (excludedSlugs.has(game.slug)) continue;
      getUnlockedAchievements(game).forEach((achievement, index) => {
        const title = getAchievementTitle(achievement, index);
        const key = game.slug + ":" + title;
        if (!title || recentAchievementKeys.has(key)) return;
        candidates.push({ game, achievement, key, timestamp: parseDateValue(achievement.earnedDate) });
      });
    }
    candidates.sort((a, b) => b.timestamp - a.timestamp);
    return candidates.slice(0, 6);
  }, [allGames, currentGame, nextMastery, recentAchievementKeys]);

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
    <div className="mx-auto w-full max-w-[1480px] px-4 pb-10 pt-4 sm:px-6 lg:px-8 lg:pt-6">
      <section className="relative isolate overflow-hidden rounded-2xl border border-white/[0.10] bg-[#07090d]/80 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.22)] backdrop-blur-sm sm:p-5 lg:flex lg:items-center lg:gap-5">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={{ backgroundImage: "radial-gradient(circle at 85% 10%, rgba(251,44,54,0.12), transparent 34%), linear-gradient(115deg, rgba(2,3,6,0.25), rgba(2,3,6,0.82))" }} />
        <div className="flex min-w-0 items-center gap-4 sm:gap-5">
          <div className="relative h-[82px] w-[82px] shrink-0 overflow-hidden rounded-xl border border-red-500/45 bg-black/60 shadow-[0_0_25px_rgba(251,44,54,0.12)] sm:h-[96px] sm:w-[96px]">
            <img src="/images/avatar.jpg" alt="Avatar do Rabiisco" className="h-full w-full object-cover" />
            <span className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full border-2 border-[#08090c] bg-[#FB2C36]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-black uppercase tracking-[0.22em] text-[#FB2C36]">Criador do Rumo à Conquista</p>
            <h1 className="mt-1 text-2xl font-black leading-none text-white sm:text-3xl">Rabiisco</h1>
            <p className="mt-2 max-w-[650px] text-xs leading-relaxed text-white/65 sm:text-sm">Jogando, explorando e registrando cada jornada. Um lugar para acompanhar conquistas e as histórias por trás de cada jogo.</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-bold">
              <a href="https://www.youtube.com/@orabiisco" target="_blank" rel="noreferrer" className="text-red-300 transition hover:text-white">▶ YouTube</a>
              <a href="https://www.twitch.tv/orabiisco" target="_blank" rel="noreferrer" className="text-purple-300 transition hover:text-white">▣ Twitch</a>
              <Link href="/perfil" className="text-white/55 transition hover:text-white">Ver perfil completo →</Link>
            </div>
          </div>
        </div>
        <div className="mt-4 hidden shrink-0 border-l border-white/[0.10] pl-5 lg:block">
          <p className="max-w-[240px] text-right text-sm italic leading-relaxed text-white/65">“Mais que jogos,<span className="block text-[#FB2C36]">são histórias que ficam.”</span></p>
        </div>
      </section>

      <section aria-label="Resumo da jornada" className="mt-3 overflow-hidden rounded-xl border border-white/[0.09] bg-[#06090d]/85 backdrop-blur-sm">
        <div className="grid grid-cols-2 divide-y divide-white/[0.07] sm:grid-cols-4 sm:divide-y-0">
          <Stat symbol="🎮" value={isLoaded ? summary.games.toLocaleString("pt-BR") : "—"} label="Jogos registrados" accent="#FB2C36" />
          <Stat symbol="✓" value={isLoaded ? summary.completed.toLocaleString("pt-BR") : "—"} label="Jogos concluídos" accent="#38d9a9" />
          <Stat symbol="🏆" value={isLoaded ? summary.unlocked.toLocaleString("pt-BR") : "—"} label="Conquistas desbloqueadas" accent="#f5b83d" />
          <Stat symbol="◷" value={isLoaded ? summary.hours : "—"} label="Tempo registrado" accent="#60a5fa" />
        </div>
      </section>

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_308px] xl:gap-5">
        <div className="min-w-0 space-y-4">
          <section className="grid gap-3 lg:grid-cols-[minmax(0,1.65fr)_minmax(260px,0.95fr)]">
            {currentGame ? (
              <article className="relative isolate min-h-[225px] overflow-hidden rounded-2xl border border-white/[0.10] bg-[#050609]/90">
                {currentGame.image || currentGame.cardImage ? <div aria-hidden="true" className="absolute inset-0 -z-20 bg-cover bg-center" style={{ backgroundImage: "url('" + (currentGame.image || currentGame.cardImage) + "')" }} /> : null}
                <div aria-hidden="true" className="absolute inset-0 -z-10" style={{ backgroundImage: "linear-gradient(90deg, rgba(3,4,7,0.67) 0%, rgba(3,4,7,0.76) 47%, rgba(3,4,7,0.97) 100%), linear-gradient(0deg, rgba(2,3,5,0.78), transparent 64%)" }} />
                <div className="flex min-h-[225px] flex-col justify-between p-4 sm:p-5">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#FB2C36]">Jogo atual</p>
                    <h2 className="mt-2 max-w-[540px] text-xl font-black leading-tight text-white sm:text-2xl">{currentGame.title}</h2>
                    <p className="mt-1 line-clamp-1 text-xs text-white/60">{currentGame.subtitle || "Jornada em andamento"}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-md border border-red-400/25 bg-black/40 px-2 py-1 text-[10px] font-bold text-red-200">Em andamento</span>
                      {currentGame.firstJourney?.status === "in_progress" ? <span className="rounded-md border border-emerald-400/25 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-200">Jornada de Estreia</span> : null}
                    </div>
                  </div>
                  <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3 text-xs"><span className="font-bold text-white">{currentCounts?.unlocked ?? 0}/{currentCounts?.total ?? 0} conquistas</span><span className="font-black text-white">{currentProgress}%</span></div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.12]"><div className="h-full rounded-full bg-[#FB2C36] shadow-[0_0_12px_rgba(251,44,54,0.32)]" style={{ width: currentProgress + "%" }} /></div>
                      {readText(currentGame.hours, "") && readText(currentGame.hours, "0h") !== "0h" ? <p className="mt-2 text-[11px] text-white/60">Tempo registrado: <span className="font-bold text-white/85">{readText(currentGame.hours, "")}</span></p> : null}
                    </div>
                    <Link href={"/games/" + currentGame.slug} className="inline-flex shrink-0 items-center justify-center rounded-lg border border-red-400/35 bg-[#FB2C36] px-3 py-2.5 text-[11px] font-black text-white transition hover:bg-red-500">Ver jogo <span className="ml-2">→</span></Link>
                  </div>
                </div>
              </article>
            ) : (
              <article className="flex min-h-[225px] flex-col justify-center rounded-2xl border border-white/[0.10] bg-[#07090d]/90 p-5">
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#FB2C36]">Jogo atual</p>
                <h2 className="mt-2 text-xl font-black text-white">Nenhum jogo em andamento</h2>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-white/55">Escolha uma jornada na Biblioteca para destacar aqui o seu progresso atual.</p>
                <Link href="/biblioteca" className="mt-4 w-fit rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200 hover:bg-red-500/20">Abrir biblioteca →</Link>
              </article>
            )}

            <article className="rounded-2xl border border-white/[0.10] bg-[#07090d]/90 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2"><p className="text-[9px] font-black uppercase tracking-[0.19em] text-[#FB2C36]">Próxima maestria</p><span className="text-lg text-[#FB2C36]">◇</span></div>
              {nextMastery ? (
                <>
                  <div className="mt-3 flex gap-3">
                    <div className="flex h-[120px] w-[88px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/[0.10] bg-black/50"><img src={nextMastery.cardImage || nextMastery.image || ""} alt="" className="h-full w-full object-contain" loading="lazy" /></div>
                    <div className="min-w-0 flex-1">
                      <h2 className="line-clamp-2 text-sm font-black leading-snug text-white">{nextMastery.title}</h2>
                      <p className="mt-2 text-[11px] text-white/55">{nextCounts?.unlocked ?? 0}/{nextCounts?.total ?? 0} conquistas</p>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.10]"><div className="h-full rounded-full bg-amber-400" style={{ width: nextProgress + "%" }} /></div>
                      <p className="mt-1 text-right text-[10px] font-bold text-white/75">{nextProgress}%</p>
                    </div>
                  </div>
                  <Link href={"/games/" + nextMastery.slug} className="mt-3 flex items-center justify-between rounded-lg border border-white/[0.10] bg-white/[0.03] px-3 py-2 text-[11px] font-bold text-white/75 transition hover:border-red-500/30 hover:text-white">Ver detalhes <span className="text-[#FB2C36]">→</span></Link>
                </>
              ) : (
                <div className="mt-5">
                  <h2 className="text-sm font-black text-white">Fila ainda não definida</h2>
                  <p className="mt-2 text-xs leading-relaxed text-white/55">Escolha o próximo jogo na fila de Próximas Maestrias para que ele apareça aqui.</p>
                  <Link href="/backlog" className="mt-4 inline-flex rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-[11px] font-bold text-red-200 transition hover:bg-red-500/20">Abrir fila →</Link>
                </div>
              )}
            </article>
          </section>

          <section className="overflow-hidden rounded-2xl border border-white/[0.10] bg-[#06090d]/90">
            <div className="px-4 pb-2 pt-4 sm:px-5"><SectionTitle title="Jogos recentes" href="/biblioteca" /><p className="mt-1 text-[11px] text-white/45">Últimos jogos atualizados, com progresso e conquistas por jogo.</p></div>
            {recentGames.length ? (
              <div className="divide-y divide-white/[0.07]">
                {recentGames.map((game) => {
                  const counts = getAchievementCounts(game);
                  const progress = Math.max(0, Math.min(100, Number(game.progress) || 0));
                  const achievements = getUnlockedAchievements(game).slice(0, 6);
                  const timestamp = getGameTimestamp(game);
                  const dateText = timestamp ? formatShortDate(timestamp) : "";
                  return (
                    <Link key={game.slug} href={"/games/" + game.slug} className="group grid grid-cols-[78px_minmax(0,1fr)] gap-3 px-3 py-3 transition hover:bg-white/[0.025] sm:grid-cols-[96px_minmax(0,1fr)] sm:px-4 md:grid-cols-[104px_minmax(0,1.25fr)_minmax(125px,0.8fr)_76px] md:items-center md:gap-4">
                      <div className="flex h-[66px] w-[78px] items-center justify-center overflow-hidden rounded-lg border border-white/[0.10] bg-black/50 sm:h-[72px] sm:w-[96px] md:w-[104px]"><img src={game.cardImage || game.image || ""} alt="" loading="lazy" className="h-full w-full object-contain" /></div>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-black text-white transition group-hover:text-red-100">{game.title}</h3>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-white/55">
                          {game.platform ? <span className="rounded border border-white/[0.10] bg-white/[0.04] px-1.5 py-0.5 font-bold text-white/70">{game.platform}</span> : null}
                          {readText(game.hours, "") && readText(game.hours, "0h") !== "0h" ? <span>◷ {readText(game.hours, "")}</span> : null}
                          <span>{counts.unlocked}/{counts.total} conquistas</span>
                        </div>
                        <div className="mt-2 flex min-h-7 items-center gap-1.5">
                          {achievements.length ? achievements.map((achievement, index) => <AchievementIcon key={game.slug + "-" + getAchievementTitle(achievement, index)} achievement={achievement} />) : <span className="text-[10px] text-white/35">Sem conquistas desbloqueadas registradas</span>}
                        </div>
                      </div>
                      <div className="col-start-2 -mt-1 min-w-0 md:col-start-auto md:mt-0">
                        <div className="flex items-center justify-between gap-2 text-[10px] text-white/65"><span>Progresso</span><span className="font-bold text-white">{progress}%</span></div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.10]"><div className="h-full rounded-full bg-emerald-400" style={{ width: progress + "%" }} /></div>
                      </div>
                      <div className="col-start-2 flex items-center justify-between gap-2 text-[10px] text-white/40 md:col-start-auto md:justify-end"><span>{dateText ? "Atualizado " + dateText : "Data indisponível"}</span><span className="text-[#FB2C36]">→</span></div>
                    </Link>
                  );
                })}
              </div>
            ) : <div className="px-4 pb-5 text-xs text-white/50">Ainda não há outros jogos com progresso registrado para mostrar aqui.</div>}
          </section>

          {featuredAchievements.length ? (
            <section className="overflow-hidden rounded-2xl border border-white/[0.10] bg-[#06090d]/90 p-4 sm:p-5">
              <SectionTitle title="Conquistas em destaque" href="/historico" linkLabel="Ver histórico" />
              <p className="mt-1 text-[11px] text-white/45">Conquistas diferentes das que já aparecem nos jogos recentes.</p>
              <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
                {featuredAchievements.map(({ game, achievement, key }) => {
                  const image = readText(achievement.image, "") || readText(achievement.officialImage, "");
                  return (
                    <Link key={key} href={"/games/" + game.slug} title={getAchievementTitle(achievement, 0) + " — " + game.title} className="group w-[112px] shrink-0 rounded-xl border border-white/[0.08] bg-black/25 p-2 text-center transition hover:border-red-500/35 hover:bg-red-500/[0.05]">
                      <div className="mx-auto flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-lg border border-white/[0.12] bg-black/45 text-2xl">{image ? <img src={image} alt="" loading="lazy" className="h-full w-full object-contain transition group-hover:scale-[1.04]" /> : getAchievementSymbol(achievement)}</div>
                      <p className="mt-2 line-clamp-2 text-[10px] font-bold leading-snug text-white/85">{getAchievementTitle(achievement, 0)}</p>
                      <p className="mt-1 line-clamp-1 text-[9px] text-white/40">{game.title}</p>
                    </Link>
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-4">
          <section className="overflow-hidden rounded-2xl border border-white/[0.10] bg-[#06090d]/95">
            <div className="p-4">
              <SectionTitle title="Conteúdo em destaque" href="/conteudo" />
              {featuredVideo ? (
                <>
                  <a href={featuredVideo.url} target="_blank" rel="noreferrer" className="group mt-3 block overflow-hidden rounded-xl border border-white/[0.10] bg-black/50">
                    <div className="relative aspect-video overflow-hidden">
                      {featuredVideo.thumbnail ? <img src={featuredVideo.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" /> : null}
                      <span className={"absolute left-2 top-2 rounded-md px-2 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-white " + (isLive ? "bg-[#FB2C36]" : "border border-white/15 bg-black/80")}>{isLive ? "Ao vivo" : "YouTube"}</span>
                      <span className="absolute inset-0 flex items-center justify-center"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FB2C36] text-lg text-white shadow-[0_0_20px_rgba(251,44,54,0.35)]">▶</span></span>
                    </div>
                    <div className="p-3"><p className="line-clamp-2 text-xs font-black leading-snug text-white">{featuredVideo.title}</p></div>
                  </a>
                  <a href={featuredVideo.url} target="_blank" rel="noreferrer" className="mt-3 flex items-center justify-center rounded-lg bg-[#FB2C36] px-3 py-2.5 text-[11px] font-black text-white transition hover:bg-red-500">{isLive ? "Assistir ao vivo" : "Assistir no YouTube"} →</a>
                </>
              ) : (
                <div className="mt-3 rounded-xl border border-white/[0.08] bg-black/25 p-4">
                  <p className="text-sm font-bold text-white">{youtubeLoaded ? "Veja o conteúdo do canal" : "Carregando conteúdo…"}</p>
                  <p className="mt-1 text-xs leading-relaxed text-white/50">Acompanhe as lives e os vídeos da jornada na aba Conteúdo.</p>
                  <Link href="/conteudo" className="mt-3 inline-flex text-xs font-bold text-red-300 hover:text-white">Abrir Conteúdo →</Link>
                </div>
              )}
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-white/[0.10] bg-[#06090d]/95 p-4">
            <SectionTitle title="Atividade recente" href="/atividade" />
            {recentActivity.length ? (
              <div className="mt-3 divide-y divide-white/[0.07]">
                {recentActivity.map((item) => (
                  <Link key={item.key} href={"/games/" + item.slug} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/[0.10] bg-black/35 text-lg">{item.image ? <img src={item.image} alt="" loading="lazy" className="h-full w-full object-contain" /> : item.symbol}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[9px] font-bold text-[#FB2C36]">{item.kind}</span>
                      <span className="mt-0.5 block line-clamp-2 text-[11px] font-bold leading-snug text-white/90">{item.title}</span>
                      <span className="mt-1 block line-clamp-1 text-[10px] text-white/45">{item.gameTitle}</span>
                    </span>
                    <span className="shrink-0 pt-1 text-[9px] text-white/40">{item.dateLabel}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-lg border border-white/[0.07] bg-black/20 p-3"><p className="text-xs leading-relaxed text-white/55">As conquistas com data registrada aparecerão aqui, sem inventar atividades ou datas.</p></div>
            )}
          </section>
        </aside>
      </div>

      <footer className="mt-6 border-t border-white/[0.08] py-4 text-center text-[10px] font-semibold tracking-[0.12em] text-white/35">RUMO À CONQUISTA · CADA JOGO CONTA. CADA CONQUISTA FICA.</footer>
    </div>
  );
}

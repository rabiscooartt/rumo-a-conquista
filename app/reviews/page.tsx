"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
import StarRating from "@/components/StarRating";
import BannerBackground from "@/components/BannerBackground";

type ReviewRecord = {
  status?: unknown;
  nota?: unknown;
  titulo?: unknown;
  texto?: unknown;
  resumo?: unknown;
};

type ReviewGame = {
  slug: string;
  title: string;
  image?: string;
  cardImage?: string;
  platform?: string;
  hours?: unknown;
  manualTotalPlayedMinutes?: unknown;
  status?: unknown;
  progress?: unknown;
  updatedAt?: unknown;
  achievementsList?: Array<{ status?: unknown }>;
  review?: ReviewRecord;
};

type CatalogResponse = {
  ok?: boolean;
  games?: ReviewGame[];
  error?: string;
};

function cleanText(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function normalizeKey(value: unknown) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function isPublishedStatus(status: unknown) {
  return [
    "liberada",
    "reviewliberada",
    "liberadapublicada",
    "publicada",
    "publicado",
    "reviewpublicada",
    "reviewpublicado",
    "released",
    "published",
    "completed",
    "concluido",
    "concluida",
  ].includes(normalizeKey(status));
}

function canReadReview(game: ReviewGame) {
  const review = game.review;
  if (!review) return false;

  const score = Number(cleanText(review.nota).replace(",", "."));
  const hasScore = Number.isFinite(score) && score >= 0 && score <= 10 && cleanText(review.nota) !== "";
  const hasContent = Boolean(
    cleanText(review.titulo) ||
      cleanText(review.resumo) ||
      cleanText(review.texto) ||
      hasScore
  );

  if (!hasContent) return false;
  if (isPublishedStatus(review.status)) return true;

  const achievements = Array.isArray(game.achievementsList) ? game.achievementsList : [];
  const completed = achievements.filter((achievement) =>
    ["completed", "concluido", "concluida"].includes(normalizeKey(achievement.status))
  ).length;

  return achievements.length > 0 && completed >= achievements.length;
}

function parseScore(value: unknown): number | null {
  const raw = cleanText(value);
  if (!raw) return null;
  const score = Number(raw.replace(",", "."));
  return Number.isFinite(score) && score >= 0 && score <= 10 ? score : null;
}

function scoreLabel(score: number) {
  if (score >= 9) return "Excelente";
  if (score >= 8) return "Muito bom";
  if (score >= 7) return "Bom";
  if (score >= 6) return "Regular";
  return "Abaixo do esperado";
}

function getReviewPlaytime(game: ReviewGame) {
  const manualMinutes = Number(game.manualTotalPlayedMinutes || 0);
  if (Number.isFinite(manualMinutes) && manualMinutes > 0) {
    const safe = Math.round(manualMinutes);
    const hours = Math.floor(safe / 60);
    const minutes = safe % 60;
    if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h`;
    return `${minutes}m`;
  }

  const saved = cleanText(game.hours);
  if (!saved || /^(?:0h|0m|0h\s*[- ]\s*0m|0)$/i.test(saved)) return "";
  return saved.replace(/\s*[-–]\s*/g, " ").replace(/\bminutos?\b/gi, "m").replace(/\bmins?\b/gi, "m");
}

function ReviewCard({ game }: { game: ReviewGame }) {
  const review = game.review ?? {};
  const reviewTitle = cleanText(review.titulo) || `Review de ${game.title}`;
  const summary = cleanText(review.resumo);
  const fullText = cleanText(review.texto);
  const hasSeparateText = Boolean(summary && fullText && normalizeKey(summary) !== normalizeKey(fullText));
  const mainExcerpt = summary || fullText;
  const score = parseScore(review.nota);
  const image = cleanText(game.cardImage) || cleanText(game.image);
  const playtime = getReviewPlaytime(game);
  const isCustomTitle = normalizeKey(reviewTitle) !== normalizeKey(`Review de ${game.title}`);

  return (
    <article className="group relative grid grid-cols-[112px_minmax(0,1fr)] gap-3 border-b border-white/[0.08] px-3 py-4 last:border-b-0 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4 sm:px-4 sm:py-5 lg:grid-cols-[160px_minmax(0,1fr)] lg:gap-4">
      <div className="relative z-20 aspect-[3/4] w-full overflow-hidden border border-white/10 bg-black pointer-events-none">
        {image ? (
          <img
            src={image}
            alt={`Capa de ${game.title}`}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-1 text-center text-[8px] font-black text-white/25">RC</div>
        )}
      </div>

      <div className="relative z-20 flex min-w-0 flex-col py-0.5 pointer-events-none">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="break-words text-[15px] font-black leading-snug text-white transition-colors group-hover:text-red-100 sm:text-[17px]">
              {game.title}
            </h3>
          </div>
          <span className="hidden shrink-0 rounded-full border border-emerald-400/20 bg-emerald-400/[.05] px-2 py-1 text-[8px] font-black uppercase tracking-[.1em] text-emerald-200/80 sm:inline-flex">
            Publicada
          </span>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {score !== null ? (
            <span className="inline-flex items-center gap-1.5" title={`Nota final: ${score.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/10`}>
              <StarRating
                rating={score / 2}
                size="small"
                className="!text-[17px] !tracking-[-0.03em]"
                ariaLabel={`Nota ${score.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} de 10`}
                title={`Nota final: ${score.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/10`}
              />
              <span className="text-[10px] font-semibold tabular-nums text-white/45">
                {score.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/10
              </span>
            </span>
          ) : null}

          {playtime ? (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-white/45">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="12" r="8.5" />
                <path d="M12 7.5V12l3 1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {playtime}
            </span>
          ) : null}

          {cleanText(game.platform) ? (
            <span className="border border-white/[0.08] bg-white/[0.025] px-1.5 py-0.5 text-[10px] font-semibold text-white/55">
              {cleanText(game.platform)}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1 text-[9px] font-black text-emerald-400 sm:hidden">
            Publicada
          </span>
        </div>

        {isCustomTitle ? (
          <p className="mt-2 text-[12px] font-bold leading-snug text-red-200/90 sm:text-[13px]">
            {reviewTitle}
          </p>
        ) : null}

        {mainExcerpt ? (
          <p className="mt-2 line-clamp-3 text-[12px] leading-[1.6] text-white/70 sm:line-clamp-4 sm:text-[13px]">
            {mainExcerpt}
          </p>
        ) : null}

        {hasSeparateText ? (
          <p className="mt-2 line-clamp-2 text-[12px] leading-[1.6] text-white/55 sm:text-[13px]">
            {fullText}
          </p>
        ) : null}

        <Link
          href={`/games/${encodeURIComponent(game.slug)}/review`}
          className="pointer-events-auto mt-1.5 inline-flex w-fit items-center gap-1 text-[12px] font-bold text-white/90 transition hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70"
        >
          Ler mais <span aria-hidden="true">→</span>
        </Link>

        <div className="mt-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t border-white/[0.08] pt-3">
          <Link
            href={`/games/${encodeURIComponent(game.slug)}`}
            className="pointer-events-auto inline-flex items-center gap-1.5 text-[11px] font-bold text-white/45 transition hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70"
          >
            Ver jogo
          </Link>
          <Link
            href={`/games/${encodeURIComponent(game.slug)}/review`}
            className="pointer-events-auto inline-flex items-center gap-1.5 text-[12px] font-bold text-white/85 transition hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70"
          >
            Abrir review <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
      <Link
        href={`/games/${encodeURIComponent(game.slug)}/review`}
        aria-label={`Abrir review completa de ${game.title}`}
        className="absolute inset-0 z-10 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-400/70"
      >
        <span className="sr-only">Abrir review completa de {game.title}</span>
      </Link>
    </article>
  );
}


export default function ReviewsPage() {
  const [games, setGames] = useState<ReviewGame[]>([]);
  const [catalogGames, setCatalogGames] = useState<ReviewGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [ratingFilter, setRatingFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [reviewOrder, setReviewOrder] = useState("recent");

  useEffect(() => {
    let cancelled = false;

    async function loadReviews() {
      setLoading(true);
      setLoadError("");

      try {
        const response = await fetch("/api/games/catalog", { cache: "no-store" });
        const payload = (await response.json()) as CatalogResponse;

        if (!response.ok || !Array.isArray(payload.games)) {
          throw new Error(payload.error || "Não foi possível carregar as reviews.");
        }

        if (!cancelled) {
          setCatalogGames(payload.games);
          setGames(payload.games.filter((game) => Boolean(game.slug && canReadReview(game))));
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : "Não foi possível carregar as reviews."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadReviews();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleGames = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return games
      .filter((game) => {
        const matchesSearch = !query || [
          game.title,
          game.review?.titulo,
          game.review?.resumo,
          game.review?.texto,
        ].some((value) => cleanText(value).toLocaleLowerCase("pt-BR").includes(query));
        const score = parseScore(game.review?.nota);
        const matchesRating = ratingFilter === "all" || (score !== null && (
          ratingFilter === "9-10" ? score >= 9 :
          ratingFilter === "7-8.9" ? score >= 7 && score < 9 :
          ratingFilter === "5-6.9" ? score >= 5 && score < 7 :
          ratingFilter === "0-4.9" ? score >= 0 && score < 5 : true
        ));
        const platform = cleanText(game.platform) || "Steam";
        const matchesPlatform = platformFilter === "all" || normalizeKey(platform) === normalizeKey(platformFilter);
        return matchesSearch && matchesRating && matchesPlatform;
      })
      .sort((a, b) => {
        if (reviewOrder === "title") return a.title.localeCompare(b.title, "pt-BR");
        if (reviewOrder === "highest") return (parseScore(b.review?.nota) ?? -1) - (parseScore(a.review?.nota) ?? -1);
        if (reviewOrder === "lowest") return (parseScore(a.review?.nota) ?? 99) - (parseScore(b.review?.nota) ?? 99);
        const aTime = Date.parse(cleanText(a.updatedAt)) || 0;
        const bTime = Date.parse(cleanText(b.updatedAt)) || 0;
        return bTime - aTime;
      });
  }, [games, search, ratingFilter, platformFilter, reviewOrder]);

  const reviewPlatformOptions = useMemo(
    () => [...new Set(games.map((game) => cleanText(game.platform) || "Steam"))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [games]
  );

  const scoredGames = games
    .map((game) => parseScore(game.review?.nota))
    .filter((score): score is number => score !== null);
  const averageScore = scoredGames.length
    ? scoredGames.reduce((sum, score) => sum + score, 0) / scoredGames.length
    : null;

  const highScore = scoredGames.length ? Math.max(...scoredGames) : null;

  const featuredReview = useMemo(
    () => [...games]
      .filter((game) => parseScore(game.review?.nota) !== null)
      .sort((a, b) => (parseScore(b.review?.nota) ?? -1) - (parseScore(a.review?.nota) ?? -1))[0] ?? games[0] ?? null,
    [games]
  );

  const latestReviews = useMemo(
    () => [...games]
      .sort((a, b) => (Date.parse(cleanText(b.updatedAt)) || 0) - (Date.parse(cleanText(a.updatedAt)) || 0))
      .slice(0, 3),
    [games]
  );

  const publishedReviewSlugs = useMemo(
    () => new Set(games.map((game) => normalizeKey(game.slug))),
    [games]
  );

  const upcomingReviews = useMemo(
    () => catalogGames
      .filter((game) => {
        if (!game.slug || publishedReviewSlugs.has(normalizeKey(game.slug))) return false;
        const status = normalizeKey(game.status);
        return ["progress", "planned", "backlog", "inprogress", "emandamento"].includes(status);
      })
      .sort((a, b) => {
        const aStatus = normalizeKey(a.status);
        const bStatus = normalizeKey(b.status);
        const aInProgress = ["progress", "inprogress", "emandamento"].includes(aStatus);
        const bInProgress = ["progress", "inprogress", "emandamento"].includes(bStatus);
        if (aInProgress !== bInProgress) return aInProgress ? -1 : 1;
        return a.title.localeCompare(b.title, "pt-BR");
      })
      .slice(0, 3),
    [catalogGames, publishedReviewSlugs]
  );

  return (
    <main className="min-h-screen bg-[#050608] text-white">
      <Navbar />

      <div className="mx-auto grid w-full max-w-[1620px] grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden min-h-[calc(100vh-74px)] border-r border-white/[0.08] px-4 py-5 lg:block">
          <div className="sticky top-20 flex min-h-[calc(100vh-94px)] flex-col">
            <div>
              <div className="border-t border-white/[0.08] pt-5">
                <div className="flex items-center gap-2 text-[12px] font-black uppercase tracking-[0.12em] text-white/75">
                  <span className="text-base text-red-400">✎</span>
                  Review
                </div>
              </div>

              <div className="mt-6 border-t border-white/[0.08] pt-5">
                <p className="text-[8px] font-black uppercase tracking-[0.20em] text-white/30">Navegação</p>
                <Link href="/biblioteca" className="mt-3 flex items-center gap-2 px-0.5 py-2 text-[11px] font-semibold text-white/55 transition hover:text-white">
                  <span>▦</span> Biblioteca de jogos
                </Link>
                <Link href="/atividade" className="flex items-center gap-2 px-0.5 py-2 text-[11px] font-semibold text-white/55 transition hover:text-white">
                  <span>◷</span> Atividade
                </Link>
              </div>
            </div>

            <div className="mt-auto space-y-2 pt-8">
              <Link href="/configuracoes" className="flex items-center gap-3 px-2.5 py-2 text-[12px] font-bold text-white/55">
                <span>⚙</span> Configurações
              </Link>
            </div>
          </div>
        </aside>

        <div className="min-w-0 px-4 py-5 md:px-5 lg:px-5">
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0">
              <header className="relative overflow-hidden border-b border-white/10 bg-[#050609]">
                <BannerBackground bannerKey="conteudo" imageUrl="/images/content-banner-bg.png" adminButtonClassName="top-16" />
                <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,6,9,0.99)_0%,rgba(5,6,9,0.94)_25%,rgba(5,6,9,0.75)_49%,rgba(5,6,9,0.22)_78%,rgba(5,6,9,0.06)_100%)]" />
                <div className="absolute inset-x-0 bottom-0 h-24 bg-[linear-gradient(180deg,transparent_0%,rgba(5,6,9,0.55)_48%,rgba(5,6,9,0.96)_100%)]" />

                <div className="relative min-h-[235px] px-7 py-7">
                  <div className="max-w-[400px]">
                    <p className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.22em] text-red-500">
                      <span className="text-[10px] leading-none">✣</span>
                      Rumo à Conquista · análises
                    </p>
                    <h1 className="mt-2 text-[38px] font-black leading-none tracking-tight text-white md:text-[40px]">REVIEWS</h1>
                    <p className="mt-3 max-w-[340px] text-[12px] font-medium leading-[1.35] text-white/70">
                      Suas análises, notas e impressões sobre os jogos da jornada, reunidas em um só lugar.
                    </p>
                  </div>

                  <div className="absolute bottom-7 left-7 right-7 grid grid-cols-2 gap-y-3 sm:grid-cols-3 sm:gap-y-0">
                    <div>
                      <p className="text-[8px] font-black uppercase tracking-[.15em] text-white/40">Reviews publicadas</p>
                      <p className="mt-1 text-[24px] font-black leading-none text-white">{loading ? "…" : games.length}</p>
                    </div>
                    <div className="border-l border-white/[0.12] pl-4">
                      <p className="text-[8px] font-black uppercase tracking-[.15em] text-white/40">Nota média</p>
                      <p className="mt-1 text-[24px] font-black leading-none text-white">
                        {averageScore === null ? "—" : averageScore.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
                        <span className="ml-1 text-[9px] font-bold text-white/35">/10</span>
                      </p>
                    </div>
                    <div className="hidden border-l border-white/[0.12] pl-4 sm:block">
                      <p className="text-[8px] font-black uppercase tracking-[.15em] text-white/40">Melhor nota</p>
                      <p className="mt-1 text-[24px] font-black leading-none text-white">
                        {highScore === null ? "—" : highScore.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
                        <span className="ml-1 text-[9px] font-bold text-white/35">/10</span>
                      </p>
                    </div>
                  </div>
                </div>
              </header>

              <section className="mt-4 rounded-[14px] border border-white/[0.10] bg-[#090b0f]">
                <div className="border-b border-white/[0.08] px-3 pt-3">
                  <div className="flex items-center gap-1">
                    <span className="inline-flex items-center gap-1.5 rounded-t-lg bg-red-500/10 px-4 py-3 text-[12px] font-black text-red-300">
                      <span aria-hidden="true">✎</span> Reviews
                    </span>

                  </div>
                </div>

                <div className="flex flex-col gap-2.5 p-3 md:flex-row">
                  <label className="relative block min-w-0 flex-1">
                    <span className="sr-only">Buscar review ou jogo</span>
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="7" />
                      <path d="m20 20-4-4" />
                    </svg>
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Buscar por jogo ou título da review..."
                      className="w-full rounded-xl border border-white/10 bg-black/25 py-3 pl-10 pr-4 text-[11px] font-semibold text-white outline-none placeholder:text-white/25 focus:border-red-500/35"
                    />
                  </label>
                  <select
                    value={ratingFilter}
                    onChange={(event) => setRatingFilter(event.target.value)}
                    aria-label="Filtrar reviews por nota"
                    className="w-full rounded-xl border border-white/10 bg-[#090b0f] px-3 py-3 text-[11px] font-bold text-white/70 outline-none focus:border-red-500/40 md:w-[125px]"
                  >
                    <option value="all">Todas as notas</option>
                    <option value="9-10">Nota 9–10</option>
                    <option value="7-8.9">Nota 7–8,9</option>
                    <option value="5-6.9">Nota 5–6,9</option>
                    <option value="0-4.9">Nota 0–4,9</option>
                  </select>
                  <select
                    value={platformFilter}
                    onChange={(event) => setPlatformFilter(event.target.value)}
                    aria-label="Filtrar reviews por plataforma"
                    className="w-full rounded-xl border border-white/10 bg-[#090b0f] px-3 py-3 text-[11px] font-bold text-white/70 outline-none focus:border-red-500/40 md:w-[116px]"
                  >
                    <option value="all">Plataforma</option>
                    {reviewPlatformOptions.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
                  </select>
                  <select
                    value={reviewOrder}
                    onChange={(event) => setReviewOrder(event.target.value)}
                    aria-label="Ordenar reviews"
                    className="w-full rounded-xl border border-white/10 bg-[#090b0f] px-3 py-3 text-[11px] font-bold text-white/70 outline-none focus:border-red-500/40 md:w-[128px]"
                  >
                    <option value="recent">Ordem: recentes</option>
                    <option value="title">Ordem: título</option>
                    <option value="highest">Maior nota</option>
                    <option value="lowest">Menor nota</option>
                  </select>
                </div>

                <div className="px-3 pb-3">
                  <p className="mb-2 px-1 text-[12px] font-black uppercase tracking-[0.16em] text-white/65">
                    Reviews publicadas
                  </p>

                  {loading ? (
                    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black/20">
                      {[0, 1, 2].map((item) => (
                        <div key={item} className="h-28 animate-pulse border-b border-white/[0.06] bg-white/[0.02] last:border-b-0" />
                      ))}
                    </div>
                  ) : loadError ? (
                    <div className="rounded-xl border border-red-400/20 bg-red-500/[.05] p-5">
                      <p className="text-sm font-bold text-red-200">Não foi possível carregar as reviews.</p>
                      <p className="mt-2 text-[11px] text-white/50">{loadError}</p>
                      <button
                        type="button"
                        onClick={() => window.location.reload()}
                        className="mt-4 rounded-lg border border-red-400/25 px-4 py-2 text-[9px] font-black uppercase text-red-200 hover:bg-red-500/10"
                      >
                        Tentar novamente
                      </button>
                    </div>
                  ) : visibleGames.length > 0 ? (
                    <div className="divide-y divide-white/[0.08]">
                      {visibleGames.map((game) => <ReviewCard key={game.slug} game={game} />)}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-white/[0.08] bg-black/20 px-5 py-12 text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-red-400/20 bg-red-500/[.07] text-xl">★</div>
                      <h2 className="mt-4 text-sm font-black text-white">
                        {games.length ? "Nenhuma review encontrada" : "Ainda não há reviews publicadas"}
                      </h2>
                      <p className="mx-auto mt-2 max-w-md text-[11px] leading-relaxed text-white/45">
                        {games.length
                          ? "Tente buscar pelo nome do jogo ou pelo título da análise."
                          : "Quando uma análise for liberada no Admin, ela aparecerá automaticamente nesta página."}
                      </p>
                    </div>
                  )}
                </div>
              </section>
            </div>

            <aside className="space-y-3 xl:sticky xl:top-20">
              <section className="overflow-hidden rounded-[14px] border border-red-500/20 bg-[#090b0f]">
                <div className="flex items-center gap-2 border-b border-white/[0.08] px-3.5 py-3">
                  <span className="text-red-500">★</span>
                  <h2 className="text-[12px] font-black uppercase tracking-[0.05em] text-white/95">Review em destaque</h2>
                </div>
                {featuredReview ? (
                  <>
                    <Link href={"/games/" + encodeURIComponent(featuredReview.slug) + "/review"} className="group block p-2.5">
                      <div className="aspect-[16/9] overflow-hidden rounded-lg border border-white/10 bg-black/30">
                        {(cleanText(featuredReview.image) || cleanText(featuredReview.cardImage)) ? (
                          <img src={cleanText(featuredReview.image) || cleanText(featuredReview.cardImage)} alt={"Imagem de " + featuredReview.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-[10px] font-bold text-white/25">RUMO À CONQUISTA</div>
                        )}
                      </div>
                      <h3 className="mt-2.5 line-clamp-2 text-[14px] font-black leading-snug text-white group-hover:text-red-200">{featuredReview.title}</h3>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <p className="min-w-0 truncate text-[10px] font-bold text-red-300">{cleanText(featuredReview.review?.titulo) || "Review do jogo"}</p>
                        <strong className="shrink-0 text-[16px] font-black text-white"><span className="text-red-500">★</span> {parseScore(featuredReview.review?.nota) === null ? "—" : parseScore(featuredReview.review?.nota)?.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "/10"}</strong>
                      </div>
                      <p className="mt-2 line-clamp-3 text-[11px] leading-[1.5] text-white/60">
                        {cleanText(featuredReview.review?.resumo) || cleanText(featuredReview.review?.texto) || "Leia a análise completa deste jogo."}
                      </p>
                    </Link>
                    <Link href={"/games/" + encodeURIComponent(featuredReview.slug) + "/review"} className="mx-2.5 mb-2.5 mt-0.5 flex items-center justify-center rounded-lg border border-red-500/35 bg-red-500/[0.07] px-3 py-2.5 text-[10px] font-black text-red-100 transition hover:bg-red-500/[0.14]">
                      Ler review completa <span className="ml-1.5">→</span>
                    </Link>
                  </>
                ) : (
                  <p className="p-4 text-[11px] text-white/45">As reviews publicadas aparecerão aqui.</p>
                )}
              </section>

              <section className="rounded-[14px] border border-white/[0.10] bg-[#090b0f] p-3.5">
                <h2 className="flex items-center gap-2 text-[12px] font-black uppercase tracking-[0.05em] text-white/95"><span className="text-red-500">▣</span> Últimas análises</h2>
                {latestReviews.length ? (
                  <div className="mt-3 space-y-2.5">
                    {latestReviews.map((game) => {
                      const score = parseScore(game.review?.nota);
                      return (
                        <Link key={game.slug} href={"/games/" + encodeURIComponent(game.slug) + "/review"} className="group flex items-center gap-2.5 border-b border-white/[0.07] pb-2.5 last:border-b-0 last:pb-0">
                          <div className="h-[48px] w-[38px] shrink-0 overflow-hidden rounded-md border border-white/10 bg-black/30">
                            {(cleanText(game.cardImage) || cleanText(game.image)) ? <img src={cleanText(game.cardImage) || cleanText(game.image)} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[11px] font-bold text-white/80 group-hover:text-red-200">{game.title}</p>
                            <p className="mt-1 truncate text-[9px] text-white/40">{cleanText(game.review?.titulo) || "Review publicada"}</p>
                            <div className="mt-1 flex items-center gap-2">
                              {score !== null ? <span className="text-[10px] font-black text-red-400">★ {score.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/10</span> : null}
                              {getReviewPlaytime(game) ? <span className="truncate text-[9px] text-white/35">{getReviewPlaytime(game)}</span> : null}
                            </div>
                          </div>
                          <span className="shrink-0 text-white/40 transition group-hover:text-red-300">›</span>
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-3 text-[11px] text-white/40">As análises recentes aparecerão aqui quando forem publicadas.</p>
                )}
              </section>

              <section className="rounded-[14px] border border-white/[0.10] bg-[#090b0f] p-3.5">
                <h2 className="flex items-center gap-2 text-[12px] font-black uppercase tracking-[0.05em] text-white/95"><span className="text-red-500">▣</span> Próximos reviews</h2>
                {upcomingReviews.length ? (
                  <div className="mt-3 space-y-2.5">
                    {upcomingReviews.map((game) => {
                      const status = normalizeKey(game.status);
                      const isInProgress = ["progress", "inprogress", "emandamento"].includes(status);
                      return (
                        <Link key={game.slug} href={"/games/" + encodeURIComponent(game.slug)} className="group flex items-center gap-2.5 border-b border-white/[0.07] pb-2.5 last:border-b-0 last:pb-0">
                          <div className="h-[46px] w-[36px] shrink-0 overflow-hidden rounded-md border border-white/10 bg-black/30">
                            {(cleanText(game.cardImage) || cleanText(game.image)) ? <img src={cleanText(game.cardImage) || cleanText(game.image)} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[11px] font-bold text-white/80 group-hover:text-red-200">{game.title}</p>
                            <p className="mt-1 truncate text-[9px] text-white/35">{isInProgress ? "Em jogo · futura análise" : "Na fila de reviews"}</p>
                          </div>
                          <span className={"shrink-0 rounded-md border px-1.5 py-1 text-[8px] font-black uppercase tracking-[0.04em] " + (isInProgress ? "border-red-500/30 bg-red-500/[0.07] text-red-300" : "border-cyan-500/25 bg-cyan-500/[0.06] text-cyan-200")}>{isInProgress ? "Em jogo" : "Planejado"}</span>
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-3 text-[11px] leading-relaxed text-white/40">Os jogos em andamento e planejados aparecerão aqui enquanto ainda não tiverem uma review publicada.</p>
                )}
              </section>
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}

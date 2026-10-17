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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");

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
        if (!query) return true;
        return [
          game.title,
          game.review?.titulo,
          game.review?.resumo,
          game.review?.texto,
        ].some((value) => cleanText(value).toLocaleLowerCase("pt-BR").includes(query));
      })
      .sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
  }, [games, search]);

  const scoredGames = games
    .map((game) => parseScore(game.review?.nota))
    .filter((score): score is number => score !== null);
  const averageScore = scoredGames.length
    ? scoredGames.reduce((sum, score) => sum + score, 0) / scoredGames.length
    : null;

  const topRatedGames = useMemo(
    () =>
      [...games]
        .filter((game) => parseScore(game.review?.nota) !== null)
        .sort((a, b) => (parseScore(b.review?.nota) ?? -1) - (parseScore(a.review?.nota) ?? -1))
        .slice(0, 4),
    [games]
  );

  const highScore = scoredGames.length ? Math.max(...scoredGames) : null;
  const lowScore = scoredGames.length ? Math.min(...scoredGames) : null;

  const ratingDistribution = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5].map((rating) => ({
    rating,
    count: scoredGames.filter((score) => {
      if (score <= 0) return false;
      const roundedStars = Math.round((score / 2) * 2) / 2;
      return roundedStars === rating;
    }).length,
  }));
  const maxRatingCount = Math.max(0, ...ratingDistribution.map((item) => item.count));

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
                <p className="text-[8px] font-black uppercase tracking-[0.20em] text-white/30">Coleção</p>
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-red-400">▤</span>
                  <span className="text-[11px] font-semibold text-white/65">{games.length} reviews publicadas</span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-amber-300">★</span>
                  <span className="text-[11px] font-semibold text-white/65">
                    Nota média {averageScore === null ? "—" : averageScore.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/10
                  </span>
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
                    <span className="px-2 py-3 text-[10px] font-black uppercase tracking-[.1em] text-white/30">
                      {loading ? "Carregando..." : `${visibleGames.length} registros`}
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
                  <div className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-[11px] font-black text-white/50">
                    <span aria-hidden="true">★</span>
                    Todas as notas
                  </div>
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
              <section className="rounded-[14px] border border-white/[0.10] bg-[#090b0f] p-3.5">
                <h2 className="flex items-center gap-2 text-[16px] font-black uppercase tracking-[0.01em] text-white/95">
                  <span className="h-5 w-0.5 rounded-full bg-red-500" />
                  Resumo das reviews
                </h2>

                <div className="mt-3 space-y-3.5">
                  {[
                    ["Reviews publicadas", loading ? "…" : String(games.length), "▤"],
                    ["Nota média", averageScore === null ? "—" : averageScore.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "/10", "★"],
                    ["Maior nota", highScore === null ? "—" : highScore.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "/10", "↑"],
                    ["Menor nota", lowScore === null ? "—" : lowScore.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "/10", "↓"],
                  ].map(([label, value, icon]) => (
                    <div key={label} className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-3.5 last:border-b-0 last:pb-0">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] bg-black/25 text-sm text-red-300">{icon}</span>
                        <span className="truncate text-[11px] font-semibold text-white/65">{label}</span>
                      </div>
                      <strong className="shrink-0 text-[14px] font-black text-white">{value}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[14px] border border-white/[0.10] bg-[#090b0f] p-3.5">
                <h2 className="flex items-center gap-2 text-[16px] font-black uppercase tracking-[0.01em] text-white/95">
                  <span className="h-5 w-0.5 rounded-full bg-red-500" />
                  Distribuição de notas
                </h2>

                <div className="mt-4 space-y-2.5">
                  {ratingDistribution.map(({ rating, count }) => {
                    const width = maxRatingCount > 0 ? (count / maxRatingCount) * 100 : 0;
                    const ratingLabel = `${Number.isInteger(rating) ? rating.toFixed(0) : rating.toFixed(1)}★`;

                    return (
                      <div
                        key={rating}
                        className="grid grid-cols-[30px_minmax(0,1fr)_22px] items-center gap-2"
                        aria-label={`${ratingLabel}: ${count} reviews`}
                        title={`${ratingLabel}: ${count} reviews`}
                      >
                        <span className="whitespace-nowrap text-right text-[10px] font-semibold tabular-nums text-white/55">
                          {ratingLabel}
                        </span>
                        <div className="h-[6px] overflow-hidden rounded-[1px] bg-white/[0.09]">
                          <div
                            className="h-full rounded-[1px] bg-red-500/90 transition-[width] duration-300"
                            style={{ width: `${width}%` }}
                          />
                        </div>
                        <span className="text-right text-[11px] font-bold tabular-nums text-white/75">
                          {loading ? "—" : count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-[14px] border border-white/[0.10] bg-[#090b0f] p-3.5">
                <h2 className="flex items-center gap-2 text-[16px] font-black uppercase tracking-[0.01em] text-white/95">
                  <span className="h-5 w-0.5 rounded-full bg-red-500" />
                  Maiores notas
                </h2>

                {topRatedGames.length ? (
                  <div className="mt-3 space-y-3">
                    {topRatedGames.map((game) => {
                      const score = parseScore(game.review?.nota);
                      return (
                        <Link key={game.slug} href={`/games/${encodeURIComponent(game.slug)}/review`} className="flex items-center gap-3 border-b border-white/[0.06] pb-3 last:border-b-0 last:pb-0 group">
                          <div className="h-11 w-9 shrink-0 overflow-hidden rounded-md border border-white/10 bg-black/30">
                            {(cleanText(game.cardImage) || cleanText(game.image)) ? (
                              <img src={cleanText(game.cardImage) || cleanText(game.image)} alt="" loading="lazy" className="h-full w-full object-cover" />
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[11px] font-bold text-white/75 group-hover:text-red-200">{game.title}</p>
                            <p className="mt-1 truncate text-[9px] text-white/35">{cleanText(game.review?.titulo) || "Review do jogo"}</p>
                          </div>
                          <strong className="text-sm font-black text-white">{score === null ? "—" : score.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</strong>
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-3 text-[11px] text-white/35">As avaliações publicadas aparecerão aqui.</p>
                )}
              </section>

              <section className="rounded-[14px] border border-white/[0.10] bg-[#090b0f] p-3.5">
                <h2 className="flex items-center gap-2 text-[16px] font-black uppercase tracking-[0.01em] text-white/95">
                  <span className="h-5 w-0.5 rounded-full bg-red-500" />
                  Sobre esta área
                </h2>
                <p className="mt-3 text-[11px] leading-relaxed text-white/45">
                  As reviews aparecem aqui automaticamente quando são liberadas no Admin. Cada análise mantém sua página completa e o vínculo com o jogo correspondente.
                </p>
                <Link href="/biblioteca" className="mt-4 flex items-center justify-center rounded-xl border border-red-500/25 bg-red-500/[.06] px-3 py-2.5 text-[9px] font-black uppercase text-red-200 transition hover:bg-red-500/[.12]">
                  Explorar jogos →
                </Link>
              </section>
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}

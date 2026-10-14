"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
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

function ReviewCard({ game }: { game: ReviewGame }) {
  const review = game.review ?? {};
  const title = cleanText(review.titulo) || `Review de ${game.title}`;
  const summary = cleanText(review.resumo);
  const fullText = cleanText(review.texto);
  const excerpt = summary || fullText;
  const score = parseScore(review.nota);
  const image = cleanText(game.cardImage) || cleanText(game.image);
  const filledStars = score === null ? 0 : Math.round(score / 2);

  return (
    <article className="flex flex-col gap-3 border-b border-white/[0.07] px-3 py-4 last:border-b-0 sm:flex-row sm:items-center sm:gap-4 sm:px-4">
      <Link
        href={`/games/${encodeURIComponent(game.slug)}`}
        aria-label={`Abrir página de ${game.title}`}
        className="h-[78px] w-[60px] shrink-0 overflow-hidden rounded-[7px] border border-white/10 bg-black shadow-lg"
      >
        {image ? (
          <img src={image} alt={game.title} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center px-1 text-center text-[8px] font-black text-white/25">RC</div>
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-black text-white sm:text-[17px]">{title}</h3>
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[.05] px-2 py-0.5 text-[8px] font-black uppercase tracking-[.1em] text-emerald-200/80">
            Publicada
          </span>
        </div>
        <p className="mt-1 text-[11px] font-semibold text-white/45">{game.title}{cleanText(game.platform) ? ` · ${cleanText(game.platform)}` : ""}</p>
        {excerpt ? (
          <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-white/65">{excerpt}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-4 sm:w-[112px] sm:flex-col sm:items-end sm:justify-center sm:gap-1">
        <div>
          <p className="text-[8px] font-black uppercase tracking-[.14em] text-white/30 sm:text-right">Nota final</p>
          <p className="mt-0.5 text-[20px] font-black leading-none text-white sm:text-right">
            {score === null ? "—" : score.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
            <span className="ml-1 text-[9px] font-bold text-white/35">/10</span>
          </p>
        </div>
        {score !== null ? (
          <p className="whitespace-nowrap text-[12px] leading-none text-red-400 sm:text-right" aria-label={`${filledStars} de 5 estrelas`}>
            {"★".repeat(filledStars)}<span className="text-white/15">{"★".repeat(5 - filledStars)}</span>
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap gap-2 sm:w-[160px] sm:flex-col sm:items-stretch">
        <Link
          href={`/games/${encodeURIComponent(game.slug)}/review`}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/[.08] px-3 py-2.5 text-[9px] font-black uppercase tracking-[.06em] text-red-200 transition hover:border-red-400/50 hover:bg-red-500/[.14]"
        >
          Ler review <span aria-hidden="true">→</span>
        </Link>
        <Link
          href={`/games/${encodeURIComponent(game.slug)}`}
          className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/[.02] px-3 py-2.5 text-[9px] font-black uppercase tracking-[.06em] text-white/45 transition hover:border-white/20 hover:text-white/80"
        >
          Ver jogo
        </Link>
      </div>
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
                    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black/20">
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

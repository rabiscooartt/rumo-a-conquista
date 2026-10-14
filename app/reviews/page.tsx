"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Navbar from "@/components/Navbar";

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
    <article className="group overflow-hidden rounded-2xl border border-white/10 bg-[#090a0c] transition duration-300 hover:border-red-500/30 hover:bg-[#0b0c0f]">
      <div className="flex h-full flex-col sm:flex-row">
        <Link
          href={`/games/${encodeURIComponent(game.slug)}`}
          aria-label={`Abrir página de ${game.title}`}
          className="relative block h-48 shrink-0 overflow-hidden border-b border-white/[.07] bg-black/30 sm:h-auto sm:min-h-[230px] sm:w-40 sm:border-b-0 sm:border-r"
        >
          {image ? (
            <img
              src={image}
              alt={game.title}
              loading="lazy"
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full min-h-[190px] items-center justify-center bg-gradient-to-br from-red-950/50 via-zinc-950 to-black p-5 text-center">
              <span className="text-sm font-black text-white/65">{game.title}</span>
            </div>
          )}
          <span className="absolute left-3 top-3 rounded-full border border-emerald-300/20 bg-black/75 px-2.5 py-1 text-[9px] font-black uppercase tracking-[.12em] text-emerald-200">
            Publicada
          </span>
        </Link>

        <div className="flex min-w-0 flex-1 flex-col p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-black uppercase tracking-[.18em] text-red-400">
                {cleanText(game.platform) || "Review de jogo"}
              </p>
              <h2 className="mt-1 text-xl font-black leading-tight text-white sm:text-2xl">
                {title}
              </h2>
              <p className="mt-1 text-sm font-semibold text-white/45">{game.title}</p>
            </div>

            <div className="flex shrink-0 items-center gap-3 rounded-xl border border-red-400/20 bg-red-500/[.06] px-3.5 py-2.5">
              <div>
                <p className="text-[8px] font-black uppercase tracking-[.14em] text-red-200/60">Nota final</p>
                <p className="mt-0.5 text-2xl font-black leading-none text-white">
                  {score === null ? "—" : score.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
                  <span className="ml-1 text-[10px] font-bold text-white/40">/10</span>
                </p>
              </div>
              {score !== null && (
                <div className="text-right">
                  <p className="whitespace-nowrap text-sm leading-none text-red-400" aria-label={`${filledStars} de 5 estrelas`}>
                    {"★".repeat(filledStars)}<span className="text-white/15">{"★".repeat(5 - filledStars)}</span>
                  </p>
                  <p className="mt-1 text-[8px] font-black uppercase tracking-[.08em] text-white/40">
                    {scoreLabel(score)}
                  </p>
                </div>
              )}
            </div>
          </div>

          {excerpt && (
            <p className="mt-4 line-clamp-3 text-sm leading-relaxed text-white/65">
              {excerpt}
            </p>
          )}

          <div className="mt-auto flex flex-wrap items-center gap-3 pt-5">
            <Link
              href={`/games/${encodeURIComponent(game.slug)}/review`}
              className="inline-flex items-center gap-2 rounded-xl border border-red-500/35 bg-red-500/[.09] px-4 py-2.5 text-[10px] font-black uppercase tracking-[.08em] text-red-200 transition hover:border-red-400/55 hover:bg-red-500/[.15]"
            >
              Ler review completa <span aria-hidden="true">→</span>
            </Link>
            <Link
              href={`/games/${encodeURIComponent(game.slug)}`}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-[10px] font-black uppercase tracking-[.08em] text-white/50 transition hover:border-white/20 hover:text-white/80"
            >
              Ver jogo
            </Link>
          </div>
        </div>
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

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#17090b_0%,#070707_34%,#020202_100%)] text-white">
      <Navbar />

      <section className="mx-auto w-full max-w-[1420px] px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        <div className="relative overflow-hidden rounded-3xl border border-red-500/20 bg-gradient-to-br from-red-950/35 via-[#090909] to-black p-6 sm:p-9">
          <div className="pointer-events-none absolute -right-12 -top-16 h-64 w-64 rounded-full bg-red-600/[.07] blur-3xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-[10px] font-black uppercase tracking-[.28em] text-red-400">Rumo à Conquista · análises</p>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-5xl">
                Reviews dos jogos
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/55 sm:text-base">
                Nossas análises, notas e impressões sobre os jogos da jornada — reunidas em um só lugar.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:min-w-[300px]">
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <p className="text-[9px] font-black uppercase tracking-[.14em] text-white/40">Reviews publicadas</p>
                <p className="mt-1 text-3xl font-black tabular-nums text-white">{games.length}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <p className="text-[9px] font-black uppercase tracking-[.14em] text-white/40">Nota média</p>
                <p className="mt-1 text-3xl font-black tabular-nums text-white">
                  {averageScore === null ? "—" : averageScore.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
                  <span className="ml-1 text-xs font-bold text-white/35">/10</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-black text-white">Todas as reviews</h2>
            <p className="mt-1 text-xs text-white/40">
              {loading ? "Carregando avaliações…" : `${visibleGames.length} de ${games.length} review(s)`}
            </p>
          </div>

          <label className="relative block w-full sm:max-w-sm">
            <span className="sr-only">Buscar review ou jogo</span>
            <svg viewBox="0 0 24 24" aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </svg>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar jogo ou review…"
              className="w-full rounded-xl border border-white/10 bg-white/[.035] py-3 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-red-400/40"
            />
          </label>
        </div>

        {loading ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="h-64 animate-pulse rounded-2xl border border-white/[.06] bg-white/[.025]" />
            ))}
          </div>
        ) : loadError ? (
          <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-500/[.05] p-6">
            <p className="font-bold text-red-200">Não foi possível carregar as reviews.</p>
            <p className="mt-2 text-sm text-white/50">{loadError}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-xl border border-red-400/25 px-4 py-2 text-xs font-black uppercase text-red-200 hover:bg-red-500/10"
            >
              Tentar novamente
            </button>
          </div>
        ) : visibleGames.length > 0 ? (
          <div className="mt-5 grid items-stretch gap-4 xl:grid-cols-2">
            {visibleGames.map((game) => (
              <ReviewCard key={game.slug} game={game} />
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[.025] px-6 py-14 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-red-400/20 bg-red-500/[.07] text-2xl">★</div>
            <h2 className="mt-4 text-lg font-black text-white">
              {games.length ? "Nenhuma review encontrada" : "Ainda não há reviews publicadas"}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-white/45">
              {games.length
                ? "Tente buscar pelo nome do jogo ou pelo título da análise."
                : "Quando uma análise for liberada no Admin, ela aparecerá automaticamente nesta página."}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

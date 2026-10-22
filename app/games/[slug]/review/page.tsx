"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import type { ReviewInput } from "@/components/GameReviewPanel";

type PublicAchievement = {
  status?: string;
};

type PublicGame = {
  slug?: string;
  title?: string;
  image?: string;
  cardImage?: string;
  platform?: string;
  status?: string;
  progress?: number;
  createdAt?: string;
  updatedAt?: string;
  achievementsList?: PublicAchievement[];
  review?: ReviewInput;
};

type PublicPayload = {
  game?: PublicGame;
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

function scoreLabel(score: number) {
  if (score >= 9) return "Excelente";
  if (score >= 8) return "Muito bom";
  if (score >= 7) return "Bom";
  if (score >= 6) return "Regular";
  return "Abaixo do esperado";
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

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-5 w-0.5 bg-red-500" aria-hidden="true" />
      <h2 className="text-xs font-black uppercase tracking-[0.14em] text-white">
        {children}
      </h2>
    </div>
  );
}

export default function CompleteGameReviewPage() {
  const params = useParams();
  const slugParam = params?.slug;
  const slug = Array.isArray(slugParam) ? String(slugParam[0] || "") : String(slugParam || "");
  const [game, setGame] = useState<PublicGame | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [shareMessage, setShareMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadReview() {
      setLoading(true);
      setLoadError("");

      try {
        const query = new URLSearchParams({ slug });
        const response = await fetch(`/api/games/data?${query.toString()}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as PublicPayload | null;

        if (!response.ok || !payload?.game) {
          throw new Error(payload?.error || "Não foi possível carregar a review.");
        }

        if (!cancelled) setGame(payload.game);
      } catch (error) {
        if (!cancelled) {
          setGame(null);
          setLoadError(
            error instanceof Error ? error.message : "Não foi possível carregar a review."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (slug) void loadReview();
    else setLoading(false);

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const review = game?.review;
  const reviewTitle = cleanText(review?.titulo) || `Review de ${game?.title || "jogo"}`;
  const reviewText = cleanText(review?.texto) || cleanText(review?.resumo);
  const reviewSummary = cleanText(review?.resumo);
  const reviewWordCount = useMemo(
    () => (reviewText ? reviewText.split(/\s+/).filter(Boolean).length : 0),
    [reviewText]
  );
  const readingTimeMinutes = Math.max(1, Math.ceil(reviewWordCount / 200));
  const lastUpdatedLabel = useMemo(() => {
    const value = cleanText(game?.updatedAt);
    if (!value) return "Não registrada";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Não registrada";
    return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).replace(/\.$/, "");
  }, [game?.updatedAt]);
  const scoreText = cleanText(review?.nota);
  const score = Number(scoreText.replace(",", "."));
  const scoreValid = scoreText.length > 0 && Number.isFinite(score) && score >= 0 && score <= 10;

  const reviewAvailable = useMemo(() => {
    if (!game || !review) return false;
    if (isPublishedStatus(review.status)) return true;
    const achievements = Array.isArray(game.achievementsList) ? game.achievementsList : [];
    const completed = achievements.filter((achievement) =>
      ["completed", "concluido", "concluida"].includes(normalizeKey(achievement.status))
    ).length;
    return achievements.length > 0 && completed >= achievements.length;
  }, [game, review]);

  const hasReviewContent = Boolean(reviewText || reviewSummary || scoreValid);

  async function copyReviewLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareMessage("Link copiado para compartilhar.");
    } catch {
      setShareMessage("Não foi possível copiar automaticamente. Copie o endereço da barra do navegador.");
    }
  }

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <Navbar />

      <div className="mx-auto w-full max-w-[1080px] px-5 py-7 sm:py-10 lg:px-8">
        <Link
          href={`/games/${slug}`}
          className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-red-400 transition hover:text-red-300"
        >
          <span aria-hidden="true">←</span>
          Voltar para o jogo
        </Link>

        {loading ? (
          <section className="mt-6 rounded-3xl border border-white/10 bg-[#090909] p-8">
            <p className="text-sm font-bold text-white/55">Carregando review...</p>
          </section>
        ) : loadError || !game ? (
          <section className="mt-6 rounded-3xl border border-red-500/20 bg-[#090909] p-8">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-red-400">Review indisponível</p>
            <h1 className="mt-3 text-2xl font-black">Não foi possível abrir esta avaliação.</h1>
            <p className="mt-2 text-sm text-white/55">{loadError || "Jogo não encontrado."}</p>
          </section>
        ) : !reviewAvailable || !hasReviewContent ? (
          <section className="mt-6 rounded-3xl border border-white/10 bg-[#090909] p-8">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-red-400">Review completa</p>
            <h1 className="mt-3 text-2xl font-black">{game.title}</h1>
            <p className="mt-3 text-sm leading-relaxed text-white/55">
              Esta review ainda não está disponível para leitura.
            </p>
          </section>
        ) : (
          <>
            <header className="mt-6 overflow-hidden rounded-3xl border border-white/[0.09] bg-[#090909]">
              <div className="grid gap-0 md:grid-cols-[250px_minmax(0,1fr)]">
                <div className="relative min-h-[230px] bg-black">
                  {(game.cardImage || game.image) ? (
                    <img
                      src={game.cardImage || game.image}
                      alt={`Capa de ${game.title || "jogo"}`}
                      className="absolute inset-0 h-full w-full object-cover opacity-90"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-red-950/40 to-black" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent md:bg-gradient-to-r" />
                </div>

                <div className="p-6 sm:p-8">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-red-500/25 bg-red-500/[0.08] px-3 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-red-300">
                      Review completa
                    </span>
                    {game.platform ? (
                      <span className="rounded-full border border-white/10 px-3 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-white/45">
                        {game.platform}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-5 text-[10px] font-black uppercase tracking-[0.22em] text-red-400">
                    {game.title}
                  </p>
                  <h1 className="mt-2 text-3xl font-black leading-tight tracking-[-0.035em] sm:text-4xl">
                    {reviewTitle}
                  </h1>
                  {reviewSummary && reviewSummary !== reviewText ? (
                    <p className="mt-4 max-w-2xl line-clamp-3 break-words text-sm font-medium leading-relaxed text-white/60">
                      {reviewSummary}
                    </p>
                  ) : null}

                  <div className="mt-6 flex flex-wrap items-end gap-x-5 gap-y-3 border-t border-white/[0.08] pt-5">
                    {scoreValid ? (
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-[0.16em] text-white/35">Nota final</p>
                        <div className="mt-1 flex items-baseline gap-1">
                          <span className="text-4xl font-black leading-none tabular-nums">{scoreText.replace(".", ",")}</span>
                          <span className="text-sm font-black text-white/40">/10</span>
                        </div>
                      </div>
                    ) : null}
                    {scoreValid ? (
                      <div className="pb-0.5">
                        <div className="flex items-center gap-1" aria-label={`Nota ${scoreText} de 10`}>
                          {Array.from({ length: 5 }, (_, index) => {
                            const fill = Math.max(0, Math.min(1, score / 2 - index));
                            return (
                              <span
                                key={index}
                                className="text-2xl leading-none"
                                style={{
                                  backgroundImage: `linear-gradient(90deg, #fbbf24 ${fill * 100}%, rgba(255,255,255,0.16) ${fill * 100}%)`,
                                  WebkitBackgroundClip: "text",
                                  backgroundClip: "text",
                                  color: "transparent",
                                }}
                              >
                                ★
                              </span>
                            );
                          })}
                        </div>
                        <p className="mt-2 text-[10px] font-black uppercase tracking-[0.12em] text-amber-300">
                          {scoreLabel(score)}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </header>

            <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
              {reviewText ? (
                <article className="min-w-0 rounded-3xl border border-white/[0.09] bg-[#090909] p-6 sm:p-8">
                  <SectionHeading>Análise da jornada</SectionHeading>
                  <div className="mt-5 break-words whitespace-pre-line text-sm font-medium leading-8 text-white/75 sm:text-base">
                    {reviewText}
                  </div>
                </article>
              ) : null}

              <aside className="min-w-0 rounded-3xl border border-white/[0.09] bg-[#090909] p-5 lg:sticky lg:top-24" aria-label="Sobre esta review">
                <SectionHeading>Sobre esta review</SectionHeading>

                <dl className="mt-5 divide-y divide-white/[0.07]">
                  <div className="flex items-start justify-between gap-3 py-3 first:pt-0">
                    <dt className="text-xs text-white/45">Tempo de leitura</dt>
                    <dd className="shrink-0 text-right text-xs font-bold text-white">{readingTimeMinutes} min</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3 py-3">
                    <dt className="text-xs text-white/45">Palavras</dt>
                    <dd className="shrink-0 text-right text-xs font-bold tabular-nums text-white">{reviewWordCount.toLocaleString("pt-BR")}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3 py-3">
                    <dt className="text-xs text-white/45">Situação</dt>
                    <dd className="shrink-0 text-right text-xs font-bold text-emerald-300">Publicada</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3 py-3 last:pb-0">
                    <dt className="text-xs text-white/45">Registro atualizado</dt>
                    <dd className="max-w-[125px] text-right text-xs font-bold leading-5 text-white">{lastUpdatedLabel}</dd>
                  </div>
                </dl>

                <button
                  type="button"
                  onClick={() => void copyReviewLink()}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/[0.08] px-4 py-3 text-xs font-black text-red-100 transition hover:border-red-400/50 hover:bg-red-500/[0.14]"
                >
                  <span aria-hidden="true">↗</span>
                  Compartilhar review
                </button>
                <p aria-live="polite" className="mt-2 min-h-4 text-center text-[10px] leading-4 text-white/45">
                  {shareMessage}
                </p>

                <Link
                  href={`/games/${slug}`}
                  className="mt-2 flex w-full items-center justify-center rounded-xl border border-white/[0.08] px-4 py-3 text-xs font-bold text-white/65 transition hover:bg-white/[0.04] hover:text-white"
                >
                  Ver página do jogo
                </Link>
              </aside>
            </div>

            <div className="mt-6">
              <Link
                href={`/games/${slug}`}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/[0.08] px-5 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-red-100 transition hover:border-red-400/50 hover:bg-red-500/[0.14]"
              >
                ← Voltar para {game.title}
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

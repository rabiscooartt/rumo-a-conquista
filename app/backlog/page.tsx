"use client";

import { useMemo } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { useSiteGames } from "@/lib/useSiteGames";

type BacklogGame = {
  slug: string;
  title: string;
  subtitle: string;
  image: string;
  cardImage: string;
};

const DEFAULT_BACKLOG_SLUGS = [
  "mouse-p-i-for-hire",
  "song-of-nunu",
  "hollow-knight",
  "metro-last-light",
  "the-surge",
  "tom-clancy-s-the-division",
  "hollow-knight-silksong",
  "hades",
  "tom-clancy-s-the-division-2",
  "hades2",
  "metro-2033-redux",
  "metro-exodus",
];

function readText(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);

  return fallback;
}

function StatCard({
  label,
  value,
  accent = "default",
}: {
  label: string;
  value: string | number;
  accent?: "default" | "red" | "blue";
}) {
  const className =
    accent === "red"
      ? "border-red-400/20 bg-red-500/10"
      : accent === "blue"
      ? "border-blue-400/20 bg-blue-500/10"
      : "border-white/10 bg-white/[0.04]";

  return (
    <div className={`rounded-2xl border px-5 py-4 text-center ${className}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/35">
        {label}
      </p>

      <p className="mt-1 text-3xl font-black text-white">{value}</p>
    </div>
  );
}

export default function BacklogPage() {
  const { gamesList: siteGamesList } = useSiteGames();

  const gamesList = useMemo<BacklogGame[]>(() => {
    return (siteGamesList || [])
      .map((game) => ({
        slug: readText(game.slug, ""),
        title: readText(game.title, "Jogo"),
        subtitle: readText(game.subtitle, ""),
        image: readText(game.image, ""),
        cardImage: readText(game.cardImage, ""),
      }))
      .filter((game) => game.slug);
  }, [siteGamesList]);

  const gamesMap = useMemo(() => {
    return gamesList.reduce<Record<string, BacklogGame>>((acc, game) => {
      acc[game.slug] = game;
      return acc;
    }, {});
  }, [gamesList]);

  const visibleSortedItems = DEFAULT_BACKLOG_SLUGS.map((slug) => ({
    id: `official-backlog-${slug}`,
    slug,
  })).filter((item) => Boolean(gamesMap[item.slug]));

  const firstItem = visibleSortedItems[0];
  const firstGame = firstItem ? gamesMap[firstItem.slug] : null;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0b1624_0%,#050505_45%,#020202_100%)] text-white">
      <Navbar />

      <section className="mx-auto w-full max-w-[1560px] px-8 py-8">
        <div className="flex items-center justify-between gap-5">
          <Link
            href="/"
            className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-black text-red-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
          >
            ← Voltar para Home
          </Link>
        </div>

        <header className="mt-8 overflow-hidden rounded-[32px] border border-white/10 bg-zinc-950/80 shadow-xl">
          <div className="relative p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.18),transparent_35%),radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_32%)]" />
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.04),transparent_40%,rgba(255,255,255,0.02))]" />

            <div className="relative z-10 flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
                  Próximas Maestrias
                </p>

                <h1 className="mt-3 text-5xl font-black text-white">
                  Fila de Maestrias
                </h1>

                <p className="mt-3 max-w-[760px] text-sm leading-relaxed text-white/50">
                  Organize a ordem dos próximos jogos que vão entrar na sua
                  jornada de conquistas e maestria.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  label="Na fila"
                  value={visibleSortedItems.length}
                  accent="red"
                />

                <StatCard
                  label="Próximo"
                  value={
                    firstGame?.title
                      ? String(firstGame.title).slice(0, 10)
                      : "—"
                  }
                  accent="blue"
                />
              </div>
            </div>
          </div>
        </header>

        <section className="mt-8 rounded-[32px] border border-white/10 bg-zinc-950/80 p-6 shadow-xl">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
                Ordem da jornada
              </p>

              <h2 className="mt-2 text-4xl font-black text-white">
                Próximas Maestrias
              </h2>

              <p className="mt-2 max-w-[720px] text-sm leading-relaxed text-white/45">
                A lista mostra a ordem dos jogos que você pretende começar
                depois. Como ainda não houve contato com esses jogos, não existe
                progresso aqui.
              </p>
            </div>

            <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-5 py-4 text-center">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/35">
                Total
              </p>

              <p className="mt-1 text-3xl font-black text-white">
                {visibleSortedItems.length}
              </p>
            </div>
          </div>

          {visibleSortedItems.length === 0 ? (
            <div className="mt-8 rounded-[24px] border border-white/10 bg-white/[0.03] p-8">
              <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
                Fila vazia
              </p>

              <h3 className="mt-3 text-3xl font-black text-white">
                Nenhuma maestria planejada ainda
              </h3>

              <p className="mt-3 max-w-[720px] text-sm leading-relaxed text-white/50">
                A fila pública ainda não possui jogos planejados para exibir.
              </p>
            </div>
          ) : (
            <div className="mt-8 grid gap-4">
              {visibleSortedItems.map((item, index) => {
                const game = gamesMap[item.slug];

                if (!game) {
                  return null;
                }

                const title = readText(game.title, item.slug);
                const subtitle = readText(game.subtitle, "");
                const image =
                  readText(game.image, "") || readText(game.cardImage, "");

                return (
                  <article
                    key={item.id}
                    className="grid gap-5 overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.03] p-4 transition hover:border-red-500/30 hover:bg-red-500/[0.04] lg:grid-cols-[260px_1fr_auto]"
                  >
                    <Link
                      href={`/games/${item.slug}`}
                      className="relative block aspect-video overflow-hidden rounded-2xl border border-white/10 bg-black/40"
                    >
                      {image ? (
                        <img
                          src={image}
                          alt={title}
                          className="h-full w-full object-cover opacity-85 transition hover:scale-105 hover:opacity-100"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-sm font-black text-white/35">
                          Sem imagem
                        </div>
                      )}

                      <div className="absolute left-3 top-3 rounded-full border border-black/30 bg-black/70 px-3 py-1 text-[10px] font-black text-white">
                        #{String(index + 1).padStart(2, "0")}
                      </div>
                    </Link>

                    <div className="flex min-w-0 flex-col justify-center">
                      <div className="flex flex-wrap items-center gap-3">
                        <Link
                          href={`/games/${item.slug}`}
                          className="text-4xl font-black text-white transition hover:text-red-300"
                        >
                          {title}
                        </Link>

                        {index === 0 ? (
                          <span className="rounded-xl border border-red-500/35 bg-red-500/15 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-red-200">
                            Próxima Maestria
                          </span>
                        ) : null}
                      </div>

                      {subtitle ? (
                        <p className="mt-2 text-sm font-bold text-blue-300">
                          {subtitle}
                        </p>
                      ) : null}

                      <p className="mt-4 text-sm leading-relaxed text-white/45">
                        Jogo aguardando início na fila da jornada.
                      </p>
                    </div>

                    <div className="flex items-center justify-end">
                      <div className="rounded-2xl border border-white/10 bg-black/30 px-5 py-4 text-center">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">
                          Fila
                        </p>

                        <p className="mt-1 text-4xl font-black text-white">
                          #{String(index + 1).padStart(2, "0")}
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

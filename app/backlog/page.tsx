"use client";

import { useMemo } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import BannerBackground from "@/components/BannerBackground";
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

function BannerMetric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="min-w-0 border-l border-white/15 pl-3 first:border-l-0 first:pl-0 sm:pl-4">
      <p className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">
        {label}
      </p>
      <p className="mt-1 truncate text-[12px] font-black text-white sm:text-[13px]">
        {value || "—"}
      </p>
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
  const lastItem = visibleSortedItems[visibleSortedItems.length - 1];
  const lastGame = lastItem ? gamesMap[lastItem.slug] : null;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0b1624_0%,#050505_45%,#020202_100%)] text-white">
      <Navbar />

      <section className="mx-auto w-full max-w-[1620px] px-6 py-6">
        <div className="grid min-h-[calc(100vh-74px)] grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_320px]">
          <aside className="hidden min-h-[calc(100vh-74px)] border-r border-white/[0.08] px-4 py-5 lg:block">
            <div className="sticky top-20 flex min-h-[calc(100vh-94px)] flex-col gap-5">
              <div className="border-b border-white/[0.08] pb-4 pt-2">
                <div className="flex items-center gap-2 text-[12px] font-black uppercase tracking-[0.12em] text-white/75">
                  <span className="text-red-500">✣</span>
                  Próximas Maestrias
                </div>
              </div>
              <section className="rounded-[12px] border border-white/[0.09] bg-[#090b0f] p-3.5">
                <p className="text-[9px] font-black uppercase tracking-[0.16em] text-white/35">Fila planejada</p>
                <p className="mt-2 text-3xl font-black text-white">{visibleSortedItems.length}</p>
                <p className="mt-1 text-[10px] leading-relaxed text-white/40">jogos aguardando sua próxima jornada.</p>
              </section>
              {firstGame ? (
                <section className="rounded-[12px] border border-red-500/20 bg-red-500/[0.04] p-3.5">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="h-[18px] w-[2px] bg-red-500" />
                    <h2 className="text-[10px] font-black uppercase tracking-[0.12em] text-white/80">Próxima da fila</h2>
                  </div>
                  <Link href={"/games/" + firstGame.slug} className="group block">
                    <div className="relative aspect-video overflow-hidden rounded-lg border border-white/10 bg-black/50">
                      {firstGame.image || firstGame.cardImage ? (
                        <img src={firstGame.image || firstGame.cardImage} alt={firstGame.title} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[10px] text-white/30">Sem imagem</div>
                      )}
                      <span className="absolute left-2 top-2 rounded-md border border-red-500/30 bg-black/80 px-2 py-1 text-[9px] font-black text-red-200">#01</span>
                    </div>
                    <p className="mt-3 text-[12px] font-black leading-[1.3] text-white transition group-hover:text-red-200">{firstGame.title}</p>
                    {firstGame.subtitle ? <p className="mt-1 text-[9px] leading-relaxed text-white/40">{firstGame.subtitle}</p> : null}
                    <p className="mt-3 text-[9px] font-black uppercase tracking-[0.12em] text-red-300/70">Ver jogo →</p>
                  </Link>
                </section>
              ) : (
                <section className="rounded-[12px] border border-white/[0.08] bg-white/[0.02] p-3.5 text-[10px] leading-relaxed text-white/40">
                  A fila está vazia. Os jogos planejados aparecerão aqui.
                </section>
              )}
              <div className="mt-auto border-t border-white/[0.08] pt-4">
                <p className="text-[9px] font-black uppercase tracking-[0.14em] text-white/30">Planejamento da jornada</p>
                <p className="mt-2 text-[10px] leading-relaxed text-white/40">A ordem da lista define qual será a próxima maestria. O progresso começa quando a jornada do jogo for iniciada.</p>
              </div>
            </div>
          </aside>

          <div className="min-w-0 border-r border-white/[0.10] px-4 py-5 md:px-5 lg:px-6">
        <div className="flex items-center justify-between gap-5">
          <Link
            href="/"
            className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-black text-red-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
          >
            ← Voltar para Home
          </Link>
        </div>

        <header className="relative mt-4 overflow-hidden rounded-[14px] border border-white/10 bg-[#050609] shadow-xl">
          <BannerBackground bannerKey="backlog" imageUrl="/images/jogos-bg.png" className="z-0" />
          <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,4,7,0.98)_0%,rgba(3,4,7,0.88)_35%,rgba(3,4,7,0.52)_70%,rgba(3,4,7,0.76)_100%)]" />
          <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(239,68,68,0.16),transparent_42%)]" />
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-20 bg-[linear-gradient(180deg,transparent_0%,rgba(5,6,9,0.9)_100%)]" />
          <div className="relative min-h-[235px] px-5 py-6 md:px-7 md:py-7">
            <div className="max-w-[560px] pb-[76px] sm:pb-[70px]">
              <p className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.22em] text-red-400">
                <span aria-hidden="true">◆</span>
                Próximas Maestrias
              </p>
              <h1 className="mt-2 text-[30px] font-black leading-[1.04] tracking-tight text-white sm:text-[36px]">FILA DE MAESTRIAS</h1>
              <p className="mt-3 max-w-[420px] text-[12px] font-medium leading-[1.45] text-white/65">
                Organize a ordem dos próximos jogos que vão entrar na sua jornada de conquistas e maestria.
              </p>
            </div>
            <div className="absolute bottom-5 left-5 right-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:bottom-6 md:left-7 md:right-7">
              <BannerMetric label="Jogos na fila" value={visibleSortedItems.length} />
              <BannerMetric label="Próxima maestria" value={firstGame?.title || "—"} />
              <BannerMetric label="Última planejada" value={lastGame?.title || "—"} />
            </div>
          </div>
        </header>

        <section className="mt-4 rounded-[14px] border border-white/10 bg-zinc-950/80 p-6 shadow-xl">
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
          </div>

          <aside className="hidden py-5 xl:block">
            <div className="sticky top-20 space-y-3">
              <section className="rounded-[12px] border border-white/[0.10] bg-[#090b0f] p-3.5">
                <div className="mb-3 flex items-center justify-between gap-2 px-1">
                  <div className="flex items-center gap-2">
                    <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
                    <h2 className="text-[12px] font-black uppercase tracking-[0.08em] leading-none text-white">Próximas na fila</h2>
                  </div>
                  <span className="text-[8px] font-black uppercase tracking-[0.12em] text-white/25">{visibleSortedItems.length} jogos</span>
                </div>
                {visibleSortedItems.length === 0 ? (
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-5 text-center text-[10px] leading-relaxed text-white/35">Nenhum jogo planejado no momento.</div>
                ) : (
                  <div className="space-y-1.5">
                    {visibleSortedItems.slice(0, 5).map((item, index) => {
                      const game = gamesMap[item.slug];
                      if (!game) return null;
                      return (
                        <Link key={item.id} href={"/games/" + item.slug}
                          className={index === 0
                            ? "flex items-center gap-2.5 rounded-lg border border-red-500/25 bg-red-500/[0.07] px-2.5 py-2 transition"
                            : "flex items-center gap-2.5 rounded-lg border border-transparent bg-white/[0.015] px-2.5 py-2 transition hover:border-white/[0.08] hover:bg-white/[0.03]"}
                        >
                          <span className={index === 0
                            ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-red-500/30 bg-red-500/10 text-[9px] font-black text-red-200"
                            : "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/[0.08] bg-black/25 text-[9px] font-black text-white/40"}>
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={index === 0 ? "block truncate text-[10px] font-black text-white" : "block truncate text-[10px] font-black text-white/65"}>{game.title}</span>
                            {game.subtitle ? <span className="mt-0.5 block truncate text-[8px] text-white/30">{game.subtitle}</span> : null}
                          </span>
                          <span className="text-[11px] text-white/20">→</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>
              <section className="rounded-[12px] border border-white/[0.10] bg-[#090b0f] p-3.5">
                <div className="mb-3 flex items-center gap-2">
                  <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
                  <h2 className="text-[12px] font-black uppercase tracking-[0.08em] text-white">Sobre a fila</h2>
                </div>
                <div className="space-y-3 text-[10px] leading-relaxed text-white/45">
                  <p><span className="font-black text-white/75">01.</span>{" "}O primeiro jogo é a próxima maestria planejada.</p>
                  <p><span className="font-black text-white/75">02.</span>{" "}Os outros jogos permanecem na ordem definida para a jornada.</p>
                  <p><span className="font-black text-white/75">03.</span>{" "}Selecione um jogo para acessar sua página e acompanhar os detalhes.</p>
                </div>
              </section>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

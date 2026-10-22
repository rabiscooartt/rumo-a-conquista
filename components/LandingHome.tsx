"use client";

import Link from "next/link";
import { useMemo } from "react";
import { type SiteGame, useSiteGames } from "@/lib/useSiteGames";

function normalizeKey(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function getGameStatus(game: SiteGame) {
  const status = normalizeKey(game.status);

  if (
    Number(game.progress) >= 100 ||
    ["completed", "finalizado", "concluido", "concluida"].includes(status)
  ) {
    return "completed";
  }

  if (
    ["progress", "emprogresso", "emandamento", "jogando", "playing", "inprogress"].includes(status)
  ) {
    return "progress";
  }

  if (["planned", "planejado", "backlog", "future", "futuro"].includes(status)) {
    return "planned";
  }

  return "other";
}

const destinations = [
  {
    href: "/perfil",
    number: "01",
    symbol: "✦",
    label: "MINHA JORNADA",
    title: "Perfil e progresso",
    description: "Veja os jogos ativos, suas estatísticas e o panorama da sua jornada.",
  },
  {
    href: "/biblioteca",
    number: "02",
    symbol: "▦",
    label: "COLEÇÃO",
    title: "Biblioteca de jogos",
    description: "Explore os jogos cadastrados, acompanhe o progresso e reveja jornadas concluídas.",
  },
  {
    href: "/conteudo",
    number: "03",
    symbol: "▶",
    label: "DO CANAL",
    title: "Lives e vídeos",
    description: "Encontre transmissões, vídeos, shorts e playlists do Rabiisco.",
  },
  {
    href: "/atividade",
    number: "04",
    symbol: "⌁",
    label: "ACOMPANHAMENTO",
    title: "Mapa de atividade",
    description: "Revise sessões, tempo jogado, conquistas e a evolução recente.",
  },
  {
    href: "/sagas",
    number: "05",
    symbol: "◇",
    label: "COLEÇÃO ESPECIAL",
    title: "Emblemas e sagas",
    description: "Confira as marcas visuais das jornadas concluídas e os próximos objetivos.",
  },
  {
    href: "/reviews",
    number: "06",
    symbol: "✎",
    label: "ANÁLISES",
    title: "Reviews dos jogos",
    description: "Leia notas, impressões e análises pessoais de cada jogo.",
  },
];

function Metric({
  value,
  label,
}: {
  value: string | number;
  label: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.10] bg-black/35 px-4 py-3 backdrop-blur-sm">
      <p className="text-2xl font-black leading-none text-white sm:text-3xl">{value}</p>
      <p className="mt-2 text-[9px] font-black uppercase tracking-[0.16em] text-white/60 sm:text-[10px]">
        {label}
      </p>
    </div>
  );
}

export default function LandingHome() {
  const { gamesList, isLoaded } = useSiteGames();

  const summary = useMemo(() => {
    const games = (gamesList || []).filter((game) => Boolean(game.slug && game.title));
    const active = games
      .filter((game) => getGameStatus(game) === "progress")
      .sort((a, b) => {
        const timeA = Date.parse(String(a.updatedAt || a.createdAt || "")) || 0;
        const timeB = Date.parse(String(b.updatedAt || b.createdAt || "")) || 0;
        return timeB - timeA;
      });
    const completed = games.filter((game) => getGameStatus(game) === "completed");

    return { total: games.length, active, completed: completed.length };
  }, [gamesList]);

  const currentGames = summary.active.slice(0, 3);

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-5 sm:px-6 lg:px-8 lg:pt-7">
      <section
        aria-labelledby="home-title"
        className="relative isolate overflow-hidden rounded-[26px] border border-red-500/20 bg-[#050505] shadow-[0_24px_70px_rgba(0,0,0,0.34)]"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              'linear-gradient(90deg, rgba(3,3,4,0.97) 0%, rgba(3,3,4,0.85) 43%, rgba(3,3,4,0.40) 75%, rgba(3,3,4,0.72) 100%), linear-gradient(0deg, rgba(0,0,0,0.48), transparent 55%), url("/images/emblems-hero.webp")',
          }}
        />
        <div
          aria-hidden="true"
          className="absolute -left-20 top-0 h-72 w-72 rounded-full bg-red-600/10 blur-[100px]"
        />
        <div className="relative z-10 grid min-h-[390px] grid-cols-1 items-center gap-8 px-5 py-9 sm:px-8 sm:py-10 lg:min-h-[420px] lg:grid-cols-[minmax(0,1fr)_minmax(250px,0.7fr)] lg:px-12 lg:py-12">
          <div className="max-w-[760px]">
            <div className="inline-flex items-center gap-2 rounded-full border border-red-400/25 bg-red-500/10 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.24em] text-red-200 sm:text-[10px]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#FB2C36] shadow-[0_0_12px_rgba(251,44,54,0.8)]" />
              Sua jornada gamer
            </div>

            <h1
              id="home-title"
              className="mt-5 max-w-[720px] text-4xl font-black leading-[1.04] tracking-tight text-white sm:text-5xl lg:text-[62px]"
            >
              Cada jogo conta.
              <span className="block text-[#FB2C36]">Cada conquista fica.</span>
            </h1>

            <p className="mt-5 max-w-[620px] text-sm leading-7 text-white/75 sm:text-base">
              Um lugar para acompanhar minhas jornadas, celebrar maestrias,
              registrar conquistas e compartilhar as histórias por trás de cada jogo.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/perfil"
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-red-400/40 bg-[#FB2C36] px-5 py-3 text-xs font-black text-white shadow-[0_8px_26px_rgba(251,44,54,0.20)] transition hover:-translate-y-0.5 hover:bg-red-500 sm:text-sm"
              >
                Acompanhar minha jornada <span className="ml-2">→</span>
              </Link>
              <Link
                href="/biblioteca"
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/15 bg-black/30 px-5 py-3 text-xs font-black text-white/90 backdrop-blur-sm transition hover:border-red-400/35 hover:bg-red-500/10 sm:text-sm"
              >
                Explorar os jogos
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 self-end lg:ml-auto lg:w-full lg:max-w-[360px] lg:grid-cols-1 lg:gap-3">
            <Metric value={isLoaded ? summary.total : "—"} label="Jogos no catálogo" />
            <Metric value={isLoaded ? summary.active.length : "—"} label="Em progresso" />
            <Metric value={isLoaded ? summary.completed : "—"} label="Jornadas concluídas" />
          </div>
        </div>
      </section>

      <section className="mt-10 sm:mt-12" aria-labelledby="destinations-title">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#FB2C36]">
              Explore o projeto
            </p>
            <h2 id="destinations-title" className="mt-2 text-2xl font-black text-white sm:text-3xl">
              Tudo da jornada em um só lugar
            </h2>
          </div>
          <p className="max-w-[440px] text-xs leading-6 text-white/55 sm:text-right sm:text-sm">
            Escolha por onde começar. Cada área acompanha uma parte diferente do caminho.
          </p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 xl:gap-4">
          {destinations.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group relative overflow-hidden rounded-2xl border border-white/[0.10] bg-[#08090c]/90 p-5 transition duration-200 hover:-translate-y-1 hover:border-red-500/35 hover:bg-[#0b0b0e] hover:shadow-[0_15px_38px_rgba(0,0,0,0.30)] sm:p-6"
            >
              <div
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-500/55 to-transparent opacity-60 transition group-hover:opacity-100"
              />
              <div className="flex items-start justify-between gap-4">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-red-500/20 bg-red-500/[0.08] text-xl font-bold text-[#FB2C36] transition group-hover:border-red-400/40 group-hover:bg-red-500/15">
                  {item.symbol}
                </span>
                <span className="text-[10px] font-black tracking-[0.18em] text-white/30">
                  {item.number}
                </span>
              </div>
              <p className="mt-5 text-[9px] font-black uppercase tracking-[0.20em] text-[#FB2C36]">
                {item.label}
              </p>
              <h3 className="mt-2 text-lg font-black text-white transition group-hover:text-red-100 sm:text-xl">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-white/60">{item.description}</p>
              <div className="mt-5 flex items-center justify-between border-t border-white/[0.08] pt-4 text-xs font-black">
                <span className="text-white/60 transition group-hover:text-white/90">
                  Abrir seção
                </span>
                <span className="text-[#FB2C36] transition group-hover:translate-x-1">→</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-12 sm:mt-14" aria-labelledby="current-journey-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#FB2C36]">
              Em andamento
            </p>
            <h2 id="current-journey-title" className="mt-2 text-2xl font-black text-white sm:text-3xl">
              Jornadas em destaque
            </h2>
            <p className="mt-2 text-sm text-white/55">
              Os jogos que estão avançando agora na jornada.
            </p>
          </div>
          <Link
            href="/biblioteca"
            className="inline-flex w-fit items-center gap-2 text-xs font-black text-red-300 transition hover:text-white"
          >
            Ver biblioteca completa <span>→</span>
          </Link>
        </div>

        {currentGames.length > 0 ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {currentGames.map((game) => {
              const progress = Math.max(0, Math.min(100, Number(game.progress) || 0));
              const image = game.image || game.cardImage || "";

              return (
                <Link
                  key={game.slug}
                  href={`/games/${game.slug}`}
                  className="group overflow-hidden rounded-2xl border border-white/[0.10] bg-[#08090c]/95 transition hover:-translate-y-1 hover:border-red-500/35"
                >
                  <div className="relative h-40 overflow-hidden bg-black/50">
                    {image ? (
                      <img
                        src={image}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover object-center transition duration-500 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm font-bold text-white/30">
                        Capa indisponível
                      </div>
                    )}
                    <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/15 to-transparent" />
                    <span className="absolute left-3 top-3 rounded-md border border-red-400/25 bg-black/65 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-red-200">
                      Em progresso
                    </span>
                    <span className="absolute bottom-3 right-3 rounded-md border border-white/15 bg-black/65 px-2.5 py-1 text-xs font-black text-white">
                      {progress}%
                    </span>
                  </div>
                  <div className="p-4">
                    <h3 className="truncate text-base font-black text-white group-hover:text-red-100 sm:text-lg">
                      {game.title}
                    </h3>
                    {game.subtitle && (
                      <p className="mt-1 text-xs font-semibold text-white/50">{game.subtitle}</p>
                    )}
                    <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.10]">
                      <div
                        className="h-full rounded-full bg-[#FB2C36] shadow-[0_0_14px_rgba(251,44,54,0.45)]"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <p className="mt-3 line-clamp-2 text-xs leading-5 text-white/60">
                      {game.currentObjective || game.objective || game.nextMission || "Continue avançando para a próxima conquista."}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-white/[0.10] bg-[#08090c]/85 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
            <div>
              <h3 className="text-base font-black text-white">
                {isLoaded ? "Sua próxima jornada começa aqui" : "Carregando as jornadas…"}
              </h3>
              <p className="mt-1 max-w-[650px] text-sm leading-6 text-white/55">
                {isLoaded
                  ? "Explore a biblioteca para encontrar jogos, acompanhar os já concluídos e preparar sua próxima maestria."
                  : "Estamos buscando os dados atuais do catálogo para mostrar seus jogos em progresso."}
              </p>
            </div>
            <Link
              href="/biblioteca"
              className="inline-flex w-fit shrink-0 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs font-black text-red-200 transition hover:bg-red-500/20"
            >
              Abrir biblioteca →
            </Link>
          </div>
        )}
      </section>

      <footer className="mt-14 border-t border-white/[0.10] py-6 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
        Rumo à Conquista · Cada jogo conta. Cada conquista fica.
      </footer>
    </div>
  );
}

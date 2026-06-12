"use client";

import Link from "next/link";
import Navbar from "@/components/Navbar";
import { type JourneyEntry, useJourneyEntries } from "@/lib/useJourneyEntries";

const DEFAULT_JOURNEY_ENTRIES: JourneyEntry[] = [
  {
    id: "default-dia-21",
    gameTitle: "Rumo á Conquista : Monster Hunter World - Iceborne",
    gameSlug: "",
    dayLabel: "Dia 21",
    status: "🟣 AO VIVO - TWITCH",
    weekDay: "Segunda-feira",
    date: "2026-05-18",
    title: "",
    notes:
      "Tentei enfrentar o Deviljho novamente, dessa vez em uma missão secundária, mas o resultado foi praticamente o mesmo da primeira luta. Mesmo com um set quase inteiro novo, ainda não consegui ficar forte o suficiente para derrotar esse monstro com tranquilidade.\n\nTambém aproveitei para fazer algumas missões secundárias e derrotei um Uragaan e um Rathalos para continuar avançando e farmando recursos.",
    highlight:
      "Fica aqui o momento que matei o Rathalos novamente, dessa vez foi bem mais tranquilo enfrentar ele, matei de primeira, aos poucos estou ficando forte, eu acho",
    threadsUrl: "https://www.threads.com/@orabiisco/post/DYf2K5PgAji",
    tags: [],
    createdAt: "2026-05-31T21:43:39.757Z",
    updatedAt: "2026-05-31T21:43:39.757Z",
  },
  {
    id: "default-dia-20",
    gameTitle: "Rumo á Conquista : Monster Hunter World - Iceborne",
    gameSlug: "monster-hunter-world-iceborne",
    dayLabel: "Dia 20",
    status: "🟣 AO VIVO - TWITCH",
    weekDay: "Sexta-feira",
    date: "2026-05-15",
    title: "",
    notes:
      "Hoje finalmente consegui concluir meu primeiro Serviço Especial derrotando o Deviljho. Foi uma batalha extremamente difícil, cheia de sofrimento, mas no final consegui vencer esse monstro absurdo.\n\nTambém fiz pela segunda vez uma investigação contra o Anjanath, dessa vez no nível mais fácil, mas serviu para continuar avançando e farmando recursos. Além disso, criei uma nova armadura para meu Amigato parceiro e acabei descobrindo mais uma conquista que quero buscar: pegar todas as armaduras do Amigato.",
    highlight:
      "A luta contra o Deviljho foi pura loucura um monstro lindo, brutal e completamente desgraçado de enfrentar.",
    threadsUrl: "https://www.threads.com/@orabiisco/post/DYWnIt8FoYG",
    tags: [],
    createdAt: "2026-05-31T21:41:56.788Z",
    updatedAt: "2026-05-31T21:43:03.534Z",
  },
  {
    id: "default-dia-19",
    gameTitle: "Rumo á Conquista : Monster Hunter World - Iceborne",
    gameSlug: "monster-hunter-world-iceborne",
    dayLabel: "Dia 19",
    status: "🟣 AO VIVO - TWITCH",
    weekDay: "Quinta-feira",
    date: "2026-05-14",
    title: "",
    notes:
      "Hoje fiz duas missões opcionais: derrotei um Odogaron, até que tranquilo, e um Lavasioth, que foi bem mais chato de enfrentar.\n\nQuando fui encarar o Bazelgeuse pela primeira vez, percebi que estou tomando dano demais. Decidi então começar a montar um set de rank alto para continuar a progressão do jogo com mais segurança.",
    highlight:
      "Aqui foi o momento decisivo onde percebi que não dá mais. Pela décima vez tentando matar esse bicho, percebi que com essa armadura não dá para avançar mais.",
    threadsUrl: "https://www.threads.com/@orabiisco/post/DYURk8mgOGo",
    tags: [],
    createdAt: "2026-05-31T21:40:53.545Z",
    updatedAt: "2026-05-31T21:41:15.068Z",
  },
  {
    id: "default-dia-18",
    gameTitle: "Rumo á Conquista : Monster Hunter World - Iceborne",
    gameSlug: "monster-hunter-world-iceborne",
    dayLabel: "Dia 18",
    status: "🟣 AO VIVO - TWITCH",
    weekDay: "Terça-feira",
    date: "2026-05-12",
    title: "",
    notes:
      "Completei uma missão opcional contra a Legiana e recebi meu primeiro Serviço Especial. Depois disso, decidi buscar mais uma conquista: completar todos os Serviços Especiais do jogo.\n\nO problema começou quando fui enfrentar o Deviljho. Tentei completar a missão 4 vezes e falhei em todas. Ficou claro que ainda preciso farmar mais recursos, melhorar meus equipamentos e pensar em uma estratégia melhor.",
    highlight:
      "Essa foi minha última tentativa contra o Deviljho. Amanhã eu volto mais preparado.",
    threadsUrl: "https://www.threads.com/@orabiisco/post/DYQcws7ACLD",
    tags: [],
    createdAt: "2026-05-31T21:40:13.480Z",
    updatedAt: "2026-05-31T21:40:13.480Z",
  },
  {
    id: "default-dia-17",
    gameTitle: "Monster Hunter: World - Iceborne",
    gameSlug: "monster-hunter-world-iceborne",
    dayLabel: "Dia 17",
    status: "🟣 AO VIVO - TWITCH",
    weekDay: "Segunda-feira",
    date: "2026-05-11",
    title: "",
    notes:
      "Hoje finalmente consegui derrotar o Nergigante, e o mais curioso é que foi de primeira. Não troquei build, arma ou armadura — a diferença foi simplesmente jogar com mais calma, foco e paciência.\n\nTambém decidi buscar mais uma conquista: ter todos os amuletos no nível máximo.\n\nDepois fui fazer uma missão secundária contra um Diablos e apanhei bastante. Falhei 3 vezes antes de finalmente conseguir derrotar ele.",
    highlight:
      "Fica aqui o momento mais importante da semana quando consegui de fato matar o Nergigante. Que batalha desgraçada, se loco.",
    threadsUrl: "https://www.threads.com/@orabiisco/post/DYOIgJrABQI",
    tags: [],
    createdAt: "2026-05-31T21:17:25.637Z",
    updatedAt: "2026-05-31T21:17:25.637Z",
  },
  {
    id: "default-dia-16-parte-2",
    gameTitle: "Rumo á Conquista : Monster Hunter World - Iceborne",
    gameSlug: "monster-hunter-world-iceborne",
    dayLabel: "Dia 16 - Parte 2",
    status: "🟣 AO VIVO - TWITCH",
    weekDay: "Domingo",
    date: "2026-05-10",
    title: "",
    notes:
      "Refiz a missão do Zorah Magdaros e completei todas as missões secundárias disponíveis do rank 6.\n\nTambém encontrei o Nergigante pela primeira vez. Tentei derrotar ele 4 vezes seguidas e falhei em todas. Ficou claro que ainda estou um pouco fraco para enfrentar esse monstro com mais tranquilidade, mas mesmo assim a luta foi intensa e divertida.",
    highlight:
      "🔴 Momento destaque: uma das tentativas ficou muito perto da vitória, mas dessa vez ainda não foi suficiente.",
    threadsUrl: "https://www.threads.com/@orabiisco/post/DYLRlSgAA-e",
    tags: [],
    createdAt: "2026-05-31T21:16:04.162Z",
    updatedAt: "2026-05-31T21:16:04.162Z",
  },
  {
    id: "default-dia-16-parte-1",
    gameTitle: "Rumo á Conquista : Monster Hunter World - Iceborne",
    gameSlug: "monster-hunter-world-iceborne",
    dayLabel: "Dia 16 - Parte 1",
    status: "🟣 AO VIVO - TWITCH",
    weekDay: "Domingo",
    date: "2026-05-10",
    title: "",
    notes:
      "Derrotei uma Rathian rank baixo e fiz minha primeira missão da Arena. Testei uma build de Espadão, mas no primeiro contato não gostei tanto da arma.\n\n🏆 Também decidi buscar mais uma conquista: completar todas as missões da Arena com todas as armas disponíveis.\n\nFui explorar o Rio Perene e encontrei 4 monstros novos: Uragaan, Lavasioth, Dodogama e Deviljho.\n\nConsegui derrotar apenas o Uragaan e o Dodogama, mas a dificuldade foi absurda. Desmaiei umas 15 vezes durante a expedição.",
    highlight:
      "Já estava sofrendo contra um monstro quando, do nada, apareceram mais 3 ao mesmo tempo. Caos completo.",
    threadsUrl: "https://www.threads.com/@orabiisco/post/DYKhr0bAKlO",
    tags: [],
    createdAt: "2026-05-31T19:30:07.350Z",
    updatedAt: "2026-05-31T21:07:07.595Z",
  },
];

function normalizeDate(date?: string) {
  if (!date) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }

  const parsedDate = new Date(date);

  if (!Number.isNaN(parsedDate.getTime())) {
    return parsedDate.toISOString().slice(0, 10);
  }

  const [day, month, year] = date.split("/");

  if (!day || !month || !year) {
    return "";
  }

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function formatDate(date?: string) {
  if (!date) return "Sem data";

  const normalizedDate = normalizeDate(date);

  if (!normalizedDate) return date;

  const [year, month, day] = normalizedDate.split("-");

  return `${day}/${month}/${year}`;
}

function formatWeekDay(weekDay?: string) {
  if (!weekDay) return "SEM DIA";

  return weekDay.toUpperCase();
}

function formatStatus(status?: string) {
  if (!status) return "Jornada";

  return status;
}

function cleanDayLabel(dayLabel?: string) {
  if (!dayLabel) return "Registro da Jornada";

  return dayLabel.split("|")[0].trim();
}

function splitParagraphs(text?: string) {
  if (!text) return [];

  return text
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function isValidUrl(url?: string) {
  if (!url) return false;

  return url.startsWith("http://") || url.startsWith("https://");
}

function getStatusClassName(status?: string) {
  const normalized = String(status || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (normalized.includes("youtube")) {
    return "border-red-400/35 bg-red-500/15 text-red-100";
  }

  if (normalized.includes("twitch") || normalized.includes("ao vivo")) {
    return "border-purple-400/35 bg-purple-500/15 text-purple-100";
  }

  return "border-white/10 bg-white/[0.04] text-white/65";
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
    <div className={`rounded-2xl border px-5 py-4 ${className}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
        {label}
      </p>

      <p className="mt-1 text-3xl font-black text-white">{value}</p>
    </div>
  );
}

function ThreadsButton({ threadsUrl }: { threadsUrl?: string }) {
  if (!isValidUrl(threadsUrl)) {
    return null;
  }

  return (
    <a
      href={threadsUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex w-fit rounded-xl border border-blue-400/30 bg-blue-500/10 px-5 py-3 text-sm font-black text-blue-200 transition hover:border-blue-300/50 hover:bg-blue-500/20 hover:text-blue-100"
    >
      Ver no Threads →
    </a>
  );
}

function JourneyEntryCard({
  entry,
  index,
}: {
  entry: JourneyEntry;
  index: number;
}) {
  const notesParagraphs = splitParagraphs(entry.notes);
  const highlightParagraphs = splitParagraphs(entry.highlight);
  const threadsUrl = entry.threadsUrl || "";

  return (
    <article className="group relative overflow-hidden rounded-[32px] border border-white/10 bg-zinc-950/80 shadow-xl transition hover:border-red-500/30 hover:shadow-[0_0_52px_rgba(239,68,68,0.14)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.1),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.09),transparent_30%)] opacity-80" />

      <div className="absolute bottom-7 left-7 top-7 hidden w-px bg-gradient-to-b from-red-500/80 via-red-500/25 to-transparent md:block" />

      <div className="relative z-10">
        <header className="border-b border-white/10 bg-black/35 p-6 md:p-7 md:pl-12">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full border border-red-500/25 bg-red-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-red-300">
                  Registro {String(index + 1).padStart(2, "0")}
                </span>

                <span
                  className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${getStatusClassName(
                    entry.status
                  )}`}
                >
                  {formatStatus(entry.status)}
                </span>

                {isValidUrl(threadsUrl) ? (
                  <a
                    href={threadsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-blue-400/30 bg-blue-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-blue-200 transition hover:border-blue-300/50 hover:bg-blue-500/20"
                  >
                    Threads
                  </a>
                ) : null}
              </div>

              <p className="mt-5 text-[11px] font-black uppercase tracking-[0.32em] text-red-400">
                🏅 {entry.gameTitle}
              </p>

              <h2 className="mt-3 text-3xl font-black leading-tight text-white md:text-4xl">
                {cleanDayLabel(entry.dayLabel)}
              </h2>

              {entry.title ? (
                <p className="mt-3 max-w-[980px] text-base font-bold leading-relaxed text-white/55 md:text-lg">
                  {entry.title}
                </p>
              ) : null}
            </div>

            {entry.tags.length > 0 ? (
              <div className="flex max-w-[420px] flex-wrap gap-2 xl:justify-end">
                {entry.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white/50"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </header>

        <div className="p-6 md:p-7 md:pl-12">
          <div className="rounded-2xl border border-white/10 bg-black/25 p-5 md:p-6">
            <p className="text-sm font-black uppercase tracking-[0.22em] text-blue-300">
              {formatWeekDay(entry.weekDay)} • {formatDate(entry.date)}
            </p>

            <div className="mt-4 h-px w-full bg-gradient-to-r from-red-500/70 via-white/10 to-transparent" />

            <section className="mt-7">
              <p className="text-xs font-black uppercase tracking-[0.28em] text-red-400">
                Anotações
              </p>

              <div className="mt-5 max-w-[1080px] space-y-7 text-[20px] leading-[2.05] text-white/[0.86]">
                {notesParagraphs.length > 0 ? (
                  notesParagraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))
                ) : (
                  <p className="text-white/35">Sem anotações cadastradas.</p>
                )}
              </div>

              {highlightParagraphs.length === 0 ? (
                <div className="mt-7">
                  <ThreadsButton threadsUrl={threadsUrl} />
                </div>
              ) : null}
            </section>
          </div>

          {highlightParagraphs.length > 0 ? (
            <section className="mt-5 overflow-hidden rounded-2xl border border-red-500/35 bg-gradient-to-br from-red-500/20 via-red-950/25 to-black/25">
              <div className="border-b border-red-500/20 bg-red-500/[0.06] px-5 py-4 md:px-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-400/35 bg-red-500/25">
                    <span className="h-3 w-3 rounded-full bg-red-400 shadow-[0_0_18px_rgba(248,113,113,0.9)]" />
                  </span>

                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.25em] text-red-300">
                      Momento destaque
                    </p>

                    <p className="mt-1 text-xs font-bold text-white/40">
                      Registro especial da gameplay
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-5 md:p-6">
                <div className="max-w-[1080px] space-y-5 text-[19px] font-medium leading-[2] text-white/[0.9]">
                  {highlightParagraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>

                <div className="mt-6">
                  <ThreadsButton threadsUrl={threadsUrl} />
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export default function JornadaPage() {
  const { latestEntries, entries, isLoaded } = useJourneyEntries();

  const displayEntries =
    isLoaded && latestEntries.length > 0
      ? latestEntries
      : isLoaded
        ? DEFAULT_JOURNEY_ENTRIES
        : [];

  const totalEntries =
    isLoaded && entries.length > 0 ? entries.length : DEFAULT_JOURNEY_ENTRIES.length;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0b1624_0%,#050505_45%,#020202_100%)] text-white">
      <Navbar />

      <section className="mx-auto w-full max-w-[1560px] px-8 py-10">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <Link
            href="/"
            className="inline-flex w-fit rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-black text-red-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
          >
            ← Voltar para Home
          </Link>

        </div>

        <header className="mt-8 overflow-hidden rounded-[32px] border border-white/10 bg-zinc-950/80 shadow-xl">
          <div className="relative p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.18),transparent_35%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.14),transparent_32%)]" />
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.04),transparent_40%,rgba(255,255,255,0.02))]" />

            <div className="relative z-10 flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
                  Jornada
                </p>

                <h1 className="mt-3 text-5xl font-black text-white">
                  Diário da Jornada
                </h1>

                <p className="mt-3 max-w-[760px] text-sm leading-relaxed text-white/50">
                  Anotações dos dias de gameplay, descobertas, derrotas,
                  vitórias e momentos que podem virar roteiro para vídeos do
                  projeto Rumo à Conquista.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <StatCard
                  label="Anotações"
                  value={isLoaded ? totalEntries : "..."}
                />

                <StatCard
                  label="Mostrando"
                  value={isLoaded ? displayEntries.length : "..."}
                  accent="red"
                />

                <StatCard label="Tipo" value="Diário" accent="blue" />
              </div>
            </div>
          </div>
        </header>

        <section className="mt-8 grid gap-6">
          {!isLoaded ? (
            <div className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-8 text-white/45 shadow-xl">
              Carregando anotações...
            </div>
          ) : displayEntries.length === 0 ? (
            <div className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-8 shadow-xl">
              <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
                Nenhuma anotação ainda
              </p>

              <h2 className="mt-3 text-3xl font-black text-white">
                Comece registrando sua jornada
              </h2>

              <p className="mt-3 max-w-[720px] text-sm leading-relaxed text-white/50">
                As anotações que você criar no admin aparecerão aqui, sempre da
                mais recente para a mais antiga.
              </p>

            </div>
          ) : (
            displayEntries.map((entry, index) => (
              <JourneyEntryCard key={entry.id} entry={entry} index={index} />
            ))
          )}
        </section>
      </section>
    </main>
  );
}
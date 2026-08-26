"use client";

import Link from "next/link";
import Navbar from "@/components/Navbar";
import { useMemo, useState } from "react";
import { type JourneyEntry, useJourneyEntries } from "@/lib/useJourneyEntries";

function formatPlayedTime(minutes = 0) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours <= 0) return `${mins}min`;
  if (mins <= 0) return `${hours}h`;
  return `${hours}h ${mins}min`;
}

function normalizeGameTitle(title?: string) {
  if (!title) return "Sem jogo";

  return title
    .replace(/^Rumo\s*[àáa]\s*Conquista\s*:\s*/i, "")
    .trim();
}

function getDayKey(date?: string) {
  if (!date) return "";

  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) return "";

  return parsed.toISOString().slice(0, 10);
}

function getMonthLabel(date: string) {
  const parsed = new Date(`${date}T12:00:00`);

  if (Number.isNaN(parsed.getTime())) return "";

  return parsed.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
}

function ActivityCard({
  label,
  value,
  description,
}: {
  label: string;
  value: string | number;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
      <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
        {label}
      </p>

      <p className="mt-2 text-3xl font-black text-white">
        {value}
      </p>

      <p className="mt-1 text-xs text-white/40">
        {description}
      </p>
    </div>
  );
}

function ActivityMap({
  entries,
}: {
  entries: JourneyEntry[];
}) {
  const activityByDay = useMemo(() => {
    const map = new Map<string, number>();

    for (const entry of entries) {
      const key = getDayKey(entry.date);

      if (!key) continue;

      map.set(
        key,
        (map.get(key) || 0) + Number(entry.playedMinutes || 0)
      );
    }

    return map;
  }, [entries]);

  const days = useMemo(() => {
    const result: string[] = [];
    const today = new Date();

    for (let i = 89; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);

      result.push(date.toISOString().slice(0, 10));
    }

    return result;
  }, []);

  const getIntensity = (minutes: number) => {
    if (minutes <= 0) {
      return "bg-white/[0.035] border-white/5";
    }

    if (minutes < 60) {
      return "bg-red-500/20 border-red-500/10";
    }

    if (minutes < 180) {
      return "bg-red-500/40 border-red-500/20";
    }

    if (minutes < 300) {
      return "bg-red-500/65 border-red-500/30";
    }

    return "bg-red-500 border-red-400/50";
  };

  return (
    <section className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-6 shadow-xl">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-400">
            Últimos 90 dias
          </p>

          <h2 className="mt-2 text-2xl font-black text-white">
            Mapa de atividade
          </h2>
        </div>

        <p className="text-xs text-white/35">
          Quanto mais jogou, mais intenso fica.
        </p>
      </div>

      <div className="mt-6 overflow-x-auto">
        <div className="grid min-w-[720px] grid-cols-15 gap-1.5">
          {days.map((day) => {
            const minutes = activityByDay.get(day) || 0;

            return (
              <div
                key={day}
                title={`${day} • ${formatPlayedTime(minutes)}`}
                className={`aspect-square rounded-[4px] border transition hover:scale-125 ${getIntensity(
                  minutes
                )}`}
              />
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 text-[10px] font-bold text-white/35">
        <span>Menos</span>

        <span className="h-3 w-3 rounded-[3px] bg-white/[0.035]" />
        <span className="h-3 w-3 rounded-[3px] bg-red-500/20" />
        <span className="h-3 w-3 rounded-[3px] bg-red-500/40" />
        <span className="h-3 w-3 rounded-[3px] bg-red-500/65" />
        <span className="h-3 w-3 rounded-[3px] bg-red-500" />

        <span>Mais</span>
      </div>
    </section>
  );
}

export default function AtividadePage() {
  const { entries, isLoaded } = useJourneyEntries();

  const [activeTab, setActiveTab] = useState<
    "jogos" | "conquistas" | "reviews"
  >("jogos");

  const [search, setSearch] = useState("");

  const sourceEntries = useMemo(() => {
    return [...entries].sort(
      (a, b) =>
        new Date(b.date).getTime() -
        new Date(a.date).getTime()
    );
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return sourceEntries;

    return sourceEntries.filter((entry) =>
      normalizeGameTitle(entry.gameTitle)
        .toLowerCase()
        .includes(query)
    );
  }, [search, sourceEntries]);

  const totalMinutes = sourceEntries.reduce(
    (total, entry) =>
      total + Number(entry.playedMinutes || 0),
    0
  );

  const uniqueDays = new Set(
    sourceEntries
      .map((entry) => getDayKey(entry.date))
      .filter(Boolean)
  ).size;

  const gamesPlayed = new Set(
    sourceEntries.map((entry) =>
      normalizeGameTitle(entry.gameTitle)
    )
  ).size;

  const averageMinutes =
    uniqueDays > 0
      ? Math.round(totalMinutes / uniqueDays)
      : 0;

  const groupedEntries = useMemo(() => {
    const groups: Record<string, JourneyEntry[]> = {};

    for (const entry of filteredEntries) {
      const key = getMonthLabel(entry.date);

      if (!key) continue;

      if (!groups[key]) {
        groups[key] = [];
      }

      groups[key].push(entry);
    }

    return groups;
  }, [filteredEntries]);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0b1624_0%,#050505_45%,#020202_100%)] text-white">
      <Navbar />

      <section className="mx-auto w-full max-w-[1560px] px-6 py-8 md:px-8">
        <Link
          href="/"
          className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-black text-red-400 transition hover:border-red-500/40 hover:bg-red-500/10"
        >
          ← Voltar para Home
        </Link>

        {/* CAPA */}
        <header className="relative mt-6 overflow-hidden rounded-[32px] border border-white/10 bg-zinc-950 shadow-2xl">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.25),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.16),transparent_40%)]" />

          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.05),transparent_45%,rgba(0,0,0,0.5))]" />

          <div className="relative z-10 flex min-h-[280px] flex-col justify-end p-8 md:p-10">
            <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
              Atividade
            </p>

            <h1 className="mt-3 text-5xl font-black tracking-tight text-white md:text-6xl">
              Minha Atividade
            </h1>

            <p className="mt-4 max-w-[760px] text-sm leading-relaxed text-white/50 md:text-base">
              Um registro visual de quando, quanto e em quais jogos
              você esteve jogando ao longo da sua jornada.
            </p>
          </div>
        </header>

        {/* ESTATÍSTICAS */}
        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ActivityCard
            label="Dias jogados"
            value={isLoaded ? uniqueDays : "..."}
            description="Dias com atividade registrada"
          />

          <ActivityCard
            label="Tempo jogado"
            value={
              isLoaded
                ? formatPlayedTime(totalMinutes)
                : "..."
            }
            description="Tempo total registrado"
          />

          <ActivityCard
            label="Média por dia"
            value={
              isLoaded
                ? formatPlayedTime(averageMinutes)
                : "..."
            }
            description="Média de tempo por dia"
          />

          <ActivityCard
            label="Jogos"
            value={isLoaded ? gamesPlayed : "..."}
            description="Jogos registrados"
          />
        </section>

        {/* MAPA */}
        <div className="mt-6">
          <ActivityMap entries={sourceEntries} />
        </div>

        {/* CONTEÚDO */}
        <section className="mt-6 rounded-[28px] border border-white/10 bg-zinc-950/80 p-5 shadow-xl md:p-6">
          {/* ABAS */}
          <div className="flex overflow-x-auto rounded-2xl border border-white/10 bg-black/30">
            {[
              ["jogos", "🎮 Jogos"],
              ["conquistas", "🏆 Conquistas"],
              ["reviews", "📝 Reviews"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() =>
                  setActiveTab(
                    value as "jogos" | "conquistas" | "reviews"
                  )
                }
                className={`whitespace-nowrap px-6 py-3 text-sm font-black transition ${
                  activeTab === value
                    ? "bg-red-500/15 text-red-400"
                    : "text-white/55 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* BUSCA */}
          <div className="mt-5">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome do jogo..."
              className="w-full rounded-2xl border border-white/10 bg-black/30 px-5 py-4 text-sm font-bold text-white outline-none placeholder:text-white/25 focus:border-red-500/40"
            />
          </div>

          {/* FILTRO */}
          <div className="mt-4">
            <button
              type="button"
              className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-black text-white/55"
            >
              Todos os Meses ▾
            </button>
          </div>

          {/* RESULTADO */}
          {activeTab === "jogos" ? (
            <div className="mt-8 space-y-10">
              {Object.entries(groupedEntries).map(
                ([month, monthEntries]) => (
                  <section key={month}>
                    <h2 className="mb-4 text-xl font-black capitalize text-white">
                      {month}
                    </h2>

                    <div className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-black/20">
                      {monthEntries.map((entry) => (
                        <article
                          key={entry.id}
                          className="flex flex-col gap-4 p-5 transition hover:bg-white/[0.025] md:flex-row md:items-center md:justify-between"
                        >
                          <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-red-400">
                              {entry.dayLabel}
                            </p>

                            <h3 className="mt-1 text-lg font-black text-white">
                              {normalizeGameTitle(
                                entry.gameTitle
                              )}
                            </h3>

                            <p className="mt-1 text-xs text-white/40">
                              {entry.weekDay} • {entry.date}
                            </p>
                          </div>

                          <div className="text-left md:text-right">
                            <p className="text-2xl font-black text-white">
                              {formatPlayedTime(
                                Number(
                                  entry.playedMinutes || 0
                                )
                              )}
                            </p>

                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30">
                              Tempo jogado
                            </p>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                )
              )}
            </div>
          ) : (
            <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.02] p-10 text-center">
              <p className="text-sm font-bold text-white/40">
                Esta aba será conectada aos dados de{" "}
                {activeTab === "conquistas"
                  ? "conquistas"
                  : "reviews"}{" "}
                na próxima etapa.
              </p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
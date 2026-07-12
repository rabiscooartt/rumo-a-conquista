"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { useSiteGames } from "@/lib/useSiteGames";
import {
  type JourneyEntry,
  type JourneyEntryInput,
  useJourneyEntries,
} from "@/lib/useJourneyEntries";

const DEFAULT_STATUS = "🟣 AO VIVO - TWITCH";

const emptyForm: JourneyEntryInput = {
  gameTitle: "",
  gameSlug: "",
  dayLabel: "Dia 1",
  status: DEFAULT_STATUS,
  weekDay: "Segunda-feira",
  date: "",
  title: "",
  notes: "",
  highlight: "",
  threadsUrl: "",
  tags: [],
};

const weekDays = [
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
  "Domingo",
];

const statusOptions = ["🟣 AO VIVO - TWITCH", "🔴 AO VIVO - YOUTUBE"];

function readText(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);

  return fallback;
}

function normalizeTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function tagsToInput(tags: string[]) {
  return tags.join(", ");
}

function normalizeStatus(status?: string) {
  if (!status) {
    return DEFAULT_STATUS;
  }

  const normalized = status
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (normalized.includes("youtube")) {
    return "🔴 AO VIVO - YOUTUBE";
  }

  if (normalized.includes("twitch")) {
    return "🟣 AO VIVO - TWITCH";
  }

  return DEFAULT_STATUS;
}

function formatDateForInput(date?: string) {
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

  const normalizedDate = formatDateForInput(date);

  if (!normalizedDate) return date;

  const [year, month, day] = normalizedDate.split("-");

  return `${day}/${month}/${year}`;
}

export default function AdminJornadaPage() {
  const { gamesList, isLoaded: isGamesLoaded } = useSiteGames();

  const {
    entries,
    latestEntries,
    isLoaded,
    addEntry,
    updateEntry,
    removeEntry,
  } = useJourneyEntries();

  const [form, setForm] = useState<JourneyEntryInput>(emptyForm);
  const [tagsInput, setTagsInput] = useState("");
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const games = useMemo(() => {
    return (gamesList || []).map((game) => ({
      slug: readText(game.slug, ""),
      title: readText(game.title, "Jogo"),
      subtitle: readText(game.subtitle, ""),
    }));
  }, [gamesList]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!form.date) {
      setForm((current) => ({
        ...current,
        date: new Date().toISOString().slice(0, 10),
      }));
    }
  }, [form.date]);

  function updateField<K extends keyof JourneyEntryInput>(
    key: K,
    value: JourneyEntryInput[K]
  ) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function handleSelectGame(gameSlug: string) {
    const selectedGame = games.find((game) => game.slug === gameSlug);

    if (!selectedGame) {
      updateField("gameSlug", "");
      return;
    }

    setForm((current) => ({
      ...current,
      gameSlug: selectedGame.slug,
      gameTitle: selectedGame.title,
    }));
  }

  function resetForm() {
    setForm({
      ...emptyForm,
      date: new Date().toISOString().slice(0, 10),
    });

    setTagsInput("");
    setEditingEntryId(null);
  }

  function handleSubmit() {
    const input: JourneyEntryInput = {
      ...form,
      status: normalizeStatus(form.status),
      threadsUrl: form.threadsUrl?.trim() || "",
      tags: normalizeTags(tagsInput),
    };

    if (!input.gameTitle.trim()) {
      alert("Coloque o nome do jogo.");
      return;
    }

    if (!input.notes.trim()) {
      alert("Coloque as anotações.");
      return;
    }

    if (editingEntryId) {
      updateEntry(editingEntryId, input);
    } else {
      addEntry(input);
    }

    resetForm();
  }

  function handleEdit(entry: JourneyEntry) {
    setEditingEntryId(entry.id);

    setForm({
      gameTitle: entry.gameTitle,
      gameSlug: entry.gameSlug || "",
      dayLabel: entry.dayLabel,
      status: normalizeStatus(entry.status),
      weekDay: entry.weekDay,
      date: formatDateForInput(entry.date),
      title: entry.title || "",
      notes: entry.notes,
      highlight: entry.highlight || "",
      threadsUrl: entry.threadsUrl || "",
      tags: entry.tags,
    });

    setTagsInput(tagsToInput(entry.tags));

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0b1624_0%,#050505_45%,#020202_100%)] text-white">
      <Navbar />

      <section className="mx-auto w-full max-w-[1500px] px-8 py-10">
        <div className="flex flex-wrap gap-3">
          <Link
            href="/jornada"
            className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-black text-red-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
          >
            ← Ver Jornada
          </Link>

          <Link
            href="/admin/jogos"
            className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-black text-white/55 transition hover:border-cyan-400/40 hover:bg-cyan-500/10 hover:text-cyan-200"
          >
            Admin Jogos
          </Link>
        </div>

        <header className="mt-8 overflow-hidden rounded-[32px] border border-white/10 bg-zinc-950/80 shadow-xl">
          <div className="relative p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.18),transparent_35%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.14),transparent_32%)]" />

            <div className="relative z-10 flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
                  Admin
                </p>

                <h1 className="mt-3 text-5xl font-black text-white">
                  Editor da Jornada
                </h1>

                <p className="mt-3 max-w-[760px] text-sm leading-relaxed text-white/50">
                  Crie, edite e remova anotações da jornada. A página pública
                  mostra apenas as 7 anotações mais recentes.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
                    Total
                  </p>

                  <p className="mt-1 text-3xl font-black text-white">
                    {isLoaded ? entries.length : "..."}
                  </p>
                </div>

                <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-5 py-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
                    Visíveis
                  </p>

                  <p className="mt-1 text-3xl font-black text-white">
                    {isLoaded ? latestEntries.length : "..."}
                  </p>
                </div>

                <div className="rounded-2xl border border-blue-400/20 bg-blue-500/10 px-5 py-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
                    Limite
                  </p>

                  <p className="mt-1 text-3xl font-black text-white">7</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        <section className="mt-8 rounded-[32px] border border-white/10 bg-zinc-950/80 p-6 shadow-xl">
          <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
            {editingEntryId ? "Editando anotação" : "Nova anotação"}
          </p>

          <h2 className="mt-2 text-3xl font-black text-white">
            {editingEntryId ? "Atualizar anotação" : "Adicionar à Jornada"}
          </h2>

          <div className="mt-6 grid gap-5">
            <div className="grid gap-5 lg:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
                  Jogo cadastrado
                </span>

                <select
                  value={form.gameSlug || ""}
                  onChange={(event) => handleSelectGame(event.target.value)}
                  className="rounded-2xl border border-white/10 bg-black/50 px-4 py-4 text-sm font-black text-white outline-none transition focus:border-red-500/50"
                >
                  <option value="">
                    {isGamesLoaded
                      ? "Selecionar jogo ou escrever manualmente"
                      : "Carregando jogos..."}
                  </option>

                  {mounted &&
                    games.map((game) => (
                      <option key={game.slug} value={game.slug}>
                        {game.title}
                      </option>
                    ))}
                </select>
              </label>

              <label className="grid gap-2">
                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
                  Nome do jogo
                </span>

                <input
                  value={form.gameTitle}
                  onChange={(event) =>
                    updateField("gameTitle", event.target.value)
                  }
                  placeholder="Ex: Monster Hunter World: Iceborne"
                  className="rounded-2xl border border-white/10 bg-black/50 px-4 py-4 text-sm font-black text-white outline-none transition placeholder:text-white/25 focus:border-red-500/50"
                />
              </label>
            </div>

            <div className="grid gap-5 lg:grid-cols-4">
              <label className="grid gap-2">
                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
                  Dia da jornada
                </span>

                <input
                  value={form.dayLabel}
                  onChange={(event) =>
                    updateField("dayLabel", event.target.value)
                  }
                  placeholder="Ex: Dia 21"
                  className="rounded-2xl border border-white/10 bg-black/50 px-4 py-4 text-sm font-black text-white outline-none transition placeholder:text-white/25 focus:border-red-500/50"
                />
              </label>

              <label className="grid gap-2">
                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
                  Status da live
                </span>

                <select
                  value={normalizeStatus(form.status)}
                  onChange={(event) => updateField("status", event.target.value)}
                  className="rounded-2xl border border-white/10 bg-black/50 px-4 py-4 text-sm font-black text-white outline-none transition focus:border-red-500/50"
                >
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2">
                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
                  Dia da semana
                </span>

                <select
                  value={form.weekDay}
                  onChange={(event) =>
                    updateField("weekDay", event.target.value)
                  }
                  className="rounded-2xl border border-white/10 bg-black/50 px-4 py-4 text-sm font-black text-white outline-none transition focus:border-red-500/50"
                >
                  {weekDays.map((weekDay) => (
                    <option key={weekDay} value={weekDay}>
                      {weekDay}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2">
                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
                  Data
                </span>

                <input
                  type="date"
                  value={form.date}
                  onChange={(event) => updateField("date", event.target.value)}
                  className="rounded-2xl border border-white/10 bg-black/50 px-4 py-4 text-sm font-black text-white outline-none transition focus:border-red-500/50"
                />
              </label>
            </div>

            <label className="grid gap-2">
              <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
                Título opcional
              </span>

              <input
                value={form.title || ""}
                onChange={(event) => updateField("title", event.target.value)}
                placeholder="Ex: Deviljho ainda está impossível"
                className="rounded-2xl border border-white/10 bg-black/50 px-4 py-4 text-sm font-black text-white outline-none transition placeholder:text-white/25 focus:border-red-500/50"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
                Anotações
              </span>

              <textarea
                value={form.notes}
                onChange={(event) => updateField("notes", event.target.value)}
                placeholder="Escreva aqui as anotações do dia..."
                rows={8}
                className="resize-y rounded-2xl border border-white/10 bg-black/50 px-4 py-4 text-sm leading-relaxed text-white outline-none transition placeholder:text-white/25 focus:border-red-500/50"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
                Momento destaque opcional
              </span>

              <textarea
                value={form.highlight || ""}
                onChange={(event) =>
                  updateField("highlight", event.target.value)
                }
                placeholder="Ex: Matei o Rathalos novamente com mais tranquilidade..."
                rows={4}
                className="resize-y rounded-2xl border border-white/10 bg-black/50 px-4 py-4 text-sm leading-relaxed text-white outline-none transition placeholder:text-white/25 focus:border-red-500/50"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
                Link do Threads opcional
              </span>

              <input
                value={form.threadsUrl || ""}
                onChange={(event) =>
                  updateField("threadsUrl", event.target.value)
                }
                placeholder="Ex: https://www.threads.net/@orabiisco/post/..."
                className="rounded-2xl border border-white/10 bg-black/50 px-4 py-4 text-sm font-black text-white outline-none transition placeholder:text-white/25 focus:border-red-500/50"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
                Tags separadas por vírgula
              </span>

              <input
                value={tagsInput}
                onChange={(event) => setTagsInput(event.target.value)}
                placeholder="Ex: Boss, Farm, Roteiro"
                className="rounded-2xl border border-white/10 bg-black/50 px-4 py-4 text-sm font-black text-white outline-none transition placeholder:text-white/25 focus:border-red-500/50"
              />
            </label>

            <div className="flex flex-wrap justify-end gap-3">
              {editingEntryId ? (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-black text-white/55 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
                >
                  Cancelar edição
                </button>
              ) : null}

              <button
                type="button"
                onClick={handleSubmit}
                className="rounded-xl border border-green-500/35 bg-green-500/15 px-5 py-3 text-sm font-black text-green-100 transition hover:bg-green-500/25"
              >
                {editingEntryId ? "Salvar alterações" : "+ Adicionar anotação"}
              </button>
            </div>
          </div>
        </section>

        <section className="mt-8">
          <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
            Lista
          </p>

          <h2 className="mt-2 text-3xl font-black text-white">
            Anotações cadastradas
          </h2>

          <div className="mt-6 grid gap-4">
            {!isLoaded ? (
              <div className="rounded-[24px] border border-white/10 bg-zinc-950/80 p-6 text-white/45">
                Carregando anotações...
              </div>
            ) : entries.length === 0 ? (
              <div className="rounded-[24px] border border-white/10 bg-zinc-950/80 p-6 text-white/45">
                Nenhuma anotação cadastrada ainda.
              </div>
            ) : (
              entries.map((entry) => (
                <article
                  key={entry.id}
                  className="rounded-[24px] border border-white/10 bg-zinc-950/80 p-5 shadow-xl"
                >
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-[0.25em] text-red-400">
                        {entry.gameTitle}
                      </p>

                      <h3 className="mt-2 text-2xl font-black text-white">
                        {entry.dayLabel} • {normalizeStatus(entry.status)}
                      </h3>

                      <p className="mt-2 text-xs font-black uppercase tracking-[0.2em] text-blue-300">
                        {entry.weekDay} • {formatDate(entry.date)}
                      </p>

                      {entry.title ? (
                        <p className="mt-3 text-sm font-black text-white/60">
                          {entry.title}
                        </p>
                      ) : null}

                      {entry.threadsUrl ? (
                        <p className="mt-3 text-xs font-black text-blue-300">
                          Threads vinculado
                        </p>
                      ) : null}

                      <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-white/45">
                        {entry.notes}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleEdit(entry)}
                        className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-xs font-black text-cyan-200 transition hover:bg-cyan-500/20"
                      >
                        Editar
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const confirmed = confirm(
                            "Tem certeza que deseja remover esta anotação?"
                          );

                          if (confirmed) {
                            removeEntry(entry.id);
                          }
                        }}
                        className="rounded-xl border border-red-500/35 bg-red-500/15 px-4 py-2 text-xs font-black text-red-100 transition hover:bg-red-500/25"
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
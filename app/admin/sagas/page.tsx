"use client";


import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import {
  type SagaFormInput,
  type SiteSaga,
  slugify,
  useSiteSagas,
} from "@/lib/useSiteSagas";
import { useSiteGames } from "@/lib/useSiteGames";

type GameOption = {
  slug: string;
  title: string;
  subtitle?: string;
};

const emptyForm: SagaFormInput = {
  slug: "",
  title: "",
  subtitle: "",
  description: "",
  accent: "red",
  badgeImage: "",
  coverImage: "",
  fallbackIcon: "🏆",
};

const accentOptions = [
  { label: "Vermelho", value: "red" },
  { label: "Ciano", value: "cyan" },
  { label: "Amarelo", value: "yellow" },
  { label: "Roxo", value: "purple" },
  { label: "Verde", value: "emerald" },
];

function SagaBadgePreview({
  src,
  fallbackIcon,
  title,
}: {
  src?: string;
  fallbackIcon: string;
  title: string;
}) {
  const [hasError, setHasError] = useState(false);

  if (!src || hasError) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black/40 text-6xl">
        {fallbackIcon}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={title}
      className="h-full w-full object-cover"
      onError={() => setHasError(true)}
    />
  );
}

function SagaEditorCard({
  saga,
  isHidden,
  activeGames,
  onSave,
  onHide,
  onRestore,
  onDeletePermanent,
  onAddGame,
  onRemoveGame,
}: {
  saga: SiteSaga;
  isHidden: boolean;
  activeGames: GameOption[];
  onSave: (slug: string, update: Partial<SiteSaga>) => void;
  onHide: (slug: string) => void;
  onRestore: (slug: string) => void;
  onDeletePermanent: (slug: string) => void;
  onAddGame: (sagaSlug: string, gameSlug: string) => void;
  onRemoveGame: (sagaSlug: string, gameSlug: string) => void;
}) {
  const [selectedGameSlug, setSelectedGameSlug] = useState("");

  const [form, setForm] = useState({
    title: saga.title || "",
    subtitle: saga.subtitle || "",
    description: saga.description || "",
    accent: saga.accent || "red",
    badgeImage: saga.badgeImage || "",
    coverImage: saga.coverImage || "",
    fallbackIcon: saga.fallbackIcon || "🏆",
  });

  useEffect(() => {
    setForm({
      title: saga.title || "",
      subtitle: saga.subtitle || "",
      description: saga.description || "",
      accent: saga.accent || "red",
      badgeImage: saga.badgeImage || "",
      coverImage: saga.coverImage || "",
      fallbackIcon: saga.fallbackIcon || "🏆",
    });
  }, [saga]);

  const sagaGameSlugs = useMemo(() => {
    return saga.stages.flatMap((stage) => stage.gameSlugs);
  }, [saga.stages]);

  const sagaGames = useMemo(() => {
    return activeGames.filter((game) => sagaGameSlugs.includes(game.slug));
  }, [activeGames, sagaGameSlugs]);

  const availableGames = useMemo(() => {
    return activeGames.filter((game) => !sagaGameSlugs.includes(game.slug));
  }, [activeGames, sagaGameSlugs]);

  function handleSave() {
    onSave(saga.slug, {
      title: form.title,
      subtitle: form.subtitle,
      description: form.description,
      accent: form.accent,
      badgeImage: form.badgeImage,
      coverImage: form.coverImage,
      fallbackIcon: form.fallbackIcon,
    });

    alert("Saga salva.");
  }

  function handleAddGame() {
    if (!selectedGameSlug) {
      alert("Escolha um jogo.");
      return;
    }

    onAddGame(saga.slug, selectedGameSlug);
    setSelectedGameSlug("");
  }

  return (
    <article
      className={`overflow-hidden rounded-[28px] border bg-zinc-950/80 shadow-xl ${
        isHidden ? "border-yellow-400/30" : "border-white/10"
      }`}
    >
      <div className="grid lg:grid-cols-[260px_1fr]">
        <div className="relative min-h-[260px] overflow-hidden bg-black/40 p-6">
          <div className="mx-auto h-[210px] w-[210px] overflow-hidden rounded-[26px] border border-white/10 bg-black/40">
            <SagaBadgePreview
              src={form.badgeImage}
              fallbackIcon={form.fallbackIcon}
              title={form.title}
            />
          </div>

          <div className="absolute left-4 top-4 rounded-full border border-white/10 bg-black/70 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/60">
            {isHidden ? "Ocultada" : "Ativa"}
          </div>
        </div>

        <div className="p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.25em] text-red-400">
                {saga.slug}
              </p>

              <h3 className="mt-2 text-3xl font-black text-white">
                {saga.title}
              </h3>

              <p className="mt-1 text-sm font-bold text-blue-300">
                {saga.subtitle || "Sem subtítulo"}
              </p>

              {isHidden && (
                <p className="mt-2 text-xs font-bold text-yellow-300">
                  Esta saga está ocultada da página pública, mas ainda pode ser editada aqui.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleSave}
                className="rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-3 text-sm font-black text-emerald-200 transition hover:bg-emerald-500/25"
              >
                Salvar
              </button>

              {isHidden ? (
                <button
                  type="button"
                  onClick={() => onRestore(saga.slug)}
                  className="rounded-xl border border-cyan-400/30 bg-cyan-500/15 px-4 py-3 text-sm font-black text-cyan-200 transition hover:bg-cyan-500/25"
                >
                  Restaurar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onHide(saga.slug)}
                  className="rounded-xl border border-yellow-400/30 bg-yellow-500/10 px-4 py-3 text-sm font-black text-yellow-200 transition hover:bg-yellow-500/20"
                >
                  Ocultar
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  const confirmed = window.confirm(
                    `Excluir definitivamente "${saga.title}"?`
                  );

                  if (!confirmed) return;

                  onDeletePermanent(saga.slug);
                }}
                className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-black text-red-200 transition hover:bg-red-500/20"
              >
                Excluir definitivo
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Nome
              </span>

              <input
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
            </label>

            <label>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Subtítulo
              </span>

              <input
                value={form.subtitle}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    subtitle: event.target.value,
                  }))
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
            </label>

            <label>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Cor
              </span>

              <select
                value={form.accent}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    accent: event.target.value,
                  }))
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              >
                {accentOptions.map((accent) => (
                  <option key={accent.value} value={accent.value}>
                    {accent.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Ícone reserva
              </span>

              <input
                value={form.fallbackIcon}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    fallbackIcon: event.target.value,
                  }))
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
            </label>

            <label className="md:col-span-2 xl:col-span-4">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Descrição
              </span>

              <input
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
            </label>

            <label className="md:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Emblema / Badge
              </span>

              <input
                value={form.badgeImage}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    badgeImage: event.target.value,
                  }))
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
            </label>

            <label className="md:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Capa / Banner
              </span>

              <input
                value={form.coverImage}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    coverImage: event.target.value,
                  }))
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
            </label>
          </div>

          <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
                  Jogos dentro da saga
                </p>

                <p className="mt-1 text-sm text-white/50">
                  {sagaGames.length} jogo(s) vinculados
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  value={selectedGameSlug}
                  onChange={(event) => setSelectedGameSlug(event.target.value)}
                  className="min-w-[260px] rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
                >
                  <option value="">Escolher jogo...</option>

                  {availableGames.map((game) => (
                    <option key={game.slug} value={game.slug}>
                      {game.title}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={handleAddGame}
                  className="rounded-xl border border-red-500/35 bg-red-500/15 px-5 py-3 text-sm font-black text-red-100 transition hover:bg-red-500/25"
                >
                  + Adicionar jogo
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              {sagaGames.length > 0 ? (
                sagaGames.map((game) => (
                  <div
                    key={game.slug}
                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2"
                  >
                    <span className="text-sm font-black text-white">
                      {game.title}
                    </span>

                    <button
                      type="button"
                      onClick={() => onRemoveGame(saga.slug, game.slug)}
                      className="rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] font-black text-red-200 transition hover:bg-red-500/20"
                    >
                      Remover
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-sm text-white/40">
                  Nenhum jogo vinculado nesta saga ainda.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </article>
  );
}

export default function AdminSagasPage() {
  const {
    allSagasList,
    addSaga,
    updateSaga,
    removeSaga,
    deleteSagaPermanently,
    restoreSaga,
    restoreAllSagas,
    addGameToSaga,
    removeGameFromSaga,
    isHiddenSaga,
  } = useSiteSagas();

  const { gamesList } = useSiteGames();

  const activeGames = useMemo<GameOption[]>(() => {
    return gamesList.map((game) => ({
      slug: game.slug,
      title: game.title,
      subtitle: game.subtitle,
    }));
  }, [gamesList]);

  const [form, setForm] = useState<SagaFormInput>(emptyForm);

  const generatedSlug = slugify(form.slug || form.title);

  function fillImageDefaults() {
    const slug = generatedSlug;

    if (!slug) {
      alert("Digite o nome da saga primeiro.");
      return;
    }

    setForm((current) => ({
      ...current,
      slug,
      badgeImage: `/images/sagas/${slug}/badge.jpg`,
      coverImage: `/images/sagas/${slug}/cover.jpg`,
    }));
  }

  function handleAddSaga() {
    const slug = generatedSlug;

    const success = addSaga({
      ...form,
      slug,
      badgeImage: form.badgeImage || `/images/sagas/${slug}/badge.jpg`,
      coverImage: form.coverImage || `/images/sagas/${slug}/cover.jpg`,
    });

    if (!success) return;

    setForm(emptyForm);
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0b1624_0%,#050505_45%,#020202_100%)] text-white">
      <Navbar />

      <section className="mx-auto w-full max-w-[1500px] px-8 py-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <Link
            href="/"
            className="inline-flex w-fit rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-black text-red-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
          >
            ← Voltar para Home
          </Link>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin/jogos"
              className="inline-flex w-fit rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-black text-white/65 transition hover:border-white/20 hover:text-white"
            >
              Admin Jogos →
            </Link>

            <Link
              href="/sagas"
              className="inline-flex w-fit rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-black text-white/65 transition hover:border-white/20 hover:text-white"
            >
              Ver Sagas →
            </Link>
          </div>
        </div>

        <header className="mt-8 overflow-hidden rounded-[32px] border border-white/10 bg-zinc-950/80 shadow-xl">
          <div className="relative p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.18),transparent_35%),radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_32%)]" />

            <div className="relative z-10">
              <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
                Admin
              </p>

              <h1 className="mt-3 text-5xl font-black text-white">
                Editor de Sagas
              </h1>

              <p className="mt-3 max-w-[860px] text-sm leading-relaxed text-white/50">
                Crie, edite, oculte e organize as sagas do projeto. Aqui você
                também escolhe quais jogos fazem parte de cada saga.
              </p>
            </div>
          </div>
        </header>

        <section className="mt-8 rounded-[28px] border border-red-500/20 bg-red-500/5 p-6 shadow-xl">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.3em] text-red-300">
              Nova saga
            </p>

            <h2 className="mt-2 text-3xl font-black text-white">
              + Adicionar saga
            </h2>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <input
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  title: event.target.value,
                  slug: current.slug || slugify(event.target.value),
                }))
              }
              placeholder="Nome da saga"
              className="rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
            />

            <input
              value={form.slug}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  slug: slugify(event.target.value),
                }))
              }
              placeholder="slug-da-saga"
              className="rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
            />

            <input
              value={form.subtitle}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  subtitle: event.target.value,
                }))
              }
              placeholder="Subtítulo"
              className="rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
            />

            <select
              value={form.accent}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  accent: event.target.value,
                }))
              }
              className="rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
            >
              {accentOptions.map((accent) => (
                <option key={accent.value} value={accent.value}>
                  {accent.label}
                </option>
              ))}
            </select>

            <input
              value={form.fallbackIcon}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  fallbackIcon: event.target.value,
                }))
              }
              placeholder="🏆"
              className="rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
            />

            <input
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              placeholder="Descrição"
              className="rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40 md:col-span-3"
            />

            <input
              value={form.badgeImage}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  badgeImage: event.target.value,
                }))
              }
              placeholder={`/images/sagas/${generatedSlug || "nome-da-saga"}/badge.jpg`}
              className="rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40 md:col-span-2"
            />

            <input
              value={form.coverImage}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  coverImage: event.target.value,
                }))
              }
              placeholder={`/images/sagas/${generatedSlug || "nome-da-saga"}/cover.jpg`}
              className="rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40 md:col-span-2"
            />
          </div>

          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={fillImageDefaults}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-black text-white/65 transition hover:border-cyan-400/30 hover:bg-cyan-500/10 hover:text-cyan-200"
            >
              Usar caminhos automáticos
            </button>

            <button
              type="button"
              onClick={handleAddSaga}
              className="rounded-xl border border-red-500/35 bg-red-500/15 px-6 py-3 text-sm font-black text-red-100 transition hover:bg-red-500/25"
            >
              + Adicionar saga
            </button>
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
                Lista
              </p>

              <h2 className="mt-2 text-3xl font-black text-white">
                Sagas para editar
              </h2>
            </div>

            <button
              type="button"
              onClick={restoreAllSagas}
              className="w-fit rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-5 py-3 text-sm font-black text-cyan-200 transition hover:bg-cyan-500/20"
            >
              Restaurar todas
            </button>
          </div>

          <div className="space-y-5">
            {allSagasList.length > 0 ? (
              allSagasList.map((saga) => (
                <SagaEditorCard
                  key={saga.slug}
                  saga={saga}
                  isHidden={isHiddenSaga(saga.slug)}
                  activeGames={activeGames}
                  onSave={updateSaga}
                  onHide={removeSaga}
                  onRestore={restoreSaga}
                  onDeletePermanent={deleteSagaPermanently}
                  onAddGame={addGameToSaga}
                  onRemoveGame={removeGameFromSaga}
                />
              ))
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-sm text-white/45">
                Nenhuma saga cadastrada no momento.
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

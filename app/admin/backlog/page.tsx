"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { useSiteGames } from "@/lib/useSiteGames";

type BacklogItem = {
  id: string;
  slug: string;
  order: number;
};

type BacklogGame = {
  slug: string;
  title: string;
  subtitle: string;
  image: string;
  cardImage: string;
};

const STORAGE_KEY = "rumo-a-conquista-backlog";
const BACKLOG_UPDATED_EVENT = "rumo-a-conquista-backlog-updated";

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

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createDefaultBacklogItems() {
  return DEFAULT_BACKLOG_SLUGS.map((slug, index) => ({
    id: `default-backlog-${slug}`,
    slug,
    order: index + 1,
  }));
}

function readText(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);

  return fallback;
}

function normalizeBacklogItem(item: Partial<BacklogItem>, index: number) {
  return {
    id: item.id ?? createId(),
    slug: item.slug ?? "",
    order: Number(item.order ?? index + 1),
  } as BacklogItem;
}

function sortBacklog(items: BacklogItem[]) {
  return [...items].sort((a, b) => a.order - b.order);
}

function normalizeBacklogOrder(items: BacklogItem[]) {
  return sortBacklog(items).map((item, index) => ({
    ...item,
    order: index + 1,
  }));
}

function readBacklogFromStorage() {
  if (typeof window === "undefined") {
    return createDefaultBacklogItems();
  }

  const savedData = localStorage.getItem(STORAGE_KEY);

  if (!savedData) {
    return createDefaultBacklogItems();
  }

  try {
    const parsedData = JSON.parse(savedData) as Partial<BacklogItem>[];

    if (!Array.isArray(parsedData) || parsedData.length === 0) {
      return createDefaultBacklogItems();
    }

    const parsedItems = parsedData
      .map((item, index) => normalizeBacklogItem(item, index))
      .filter((item) => item.slug);

    if (parsedItems.length === 0) {
      return createDefaultBacklogItems();
    }

    return normalizeBacklogOrder(parsedItems);
  } catch {
    return createDefaultBacklogItems();
  }
}

function saveBacklogToStorage(items: BacklogItem[]) {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedItems = normalizeBacklogOrder(items);

  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedItems));
  window.dispatchEvent(new Event(BACKLOG_UPDATED_EVENT));
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

export default function AdminBacklogPage() {
  const { gamesList: siteGamesList, isLoaded: isGamesLoaded } = useSiteGames();

  const [items, setItems] = useState<BacklogItem[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");

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

  useEffect(() => {
    setItems(readBacklogFromStorage());

    function refreshBacklog() {
      setItems(readBacklogFromStorage());
    }

    window.addEventListener(BACKLOG_UPDATED_EVENT, refreshBacklog);
    window.addEventListener("storage", refreshBacklog);
    window.addEventListener("focus", refreshBacklog);

    return () => {
      window.removeEventListener(BACKLOG_UPDATED_EVENT, refreshBacklog);
      window.removeEventListener("storage", refreshBacklog);
      window.removeEventListener("focus", refreshBacklog);
    };
  }, []);

  function saveItems(nextItems: BacklogItem[]) {
    const normalizedItems = normalizeBacklogOrder(nextItems);

    setItems(normalizedItems);
    saveBacklogToStorage(normalizedItems);
  }

  function addItem() {
    if (!selectedSlug) {
      alert("Escolha um jogo.");
      return;
    }

    const normalizedItems = normalizeBacklogOrder(items);
    const alreadyExists = normalizedItems.some(
      (item) => item.slug === selectedSlug
    );

    if (alreadyExists) {
      alert("Esse jogo já está na fila.");
      return;
    }

    const newItem: BacklogItem = {
      id: createId(),
      slug: selectedSlug,
      order: normalizedItems.length + 1,
    };

    saveItems([...normalizedItems, newItem]);
    setSelectedSlug("");
  }

  function removeItem(id: string) {
    const confirmed = confirm("Remover este jogo das Próximas Maestrias?");

    if (!confirmed) {
      return;
    }

    saveItems(items.filter((item) => item.id !== id));
  }

  function updateOrder(id: string, order: number) {
    const sortedItems = normalizeBacklogOrder(items);
    const currentIndex = sortedItems.findIndex((item) => item.id === id);

    if (currentIndex === -1) {
      return;
    }

    const safeOrder = Math.min(
      sortedItems.length,
      Math.max(1, Number(order) || 1)
    );

    const targetIndex = safeOrder - 1;

    if (currentIndex === targetIndex) {
      return;
    }

    const reorderedItems = [...sortedItems];
    const [movedItem] = reorderedItems.splice(currentIndex, 1);

    reorderedItems.splice(targetIndex, 0, movedItem);

    const normalizedItems = reorderedItems.map((item, index) => ({
      ...item,
      order: index + 1,
    }));

    saveItems(normalizedItems);
  }

  function moveItem(id: string, direction: "up" | "down") {
    const sortedItems = normalizeBacklogOrder(items);
    const currentIndex = sortedItems.findIndex((item) => item.id === id);

    if (currentIndex === -1) {
      return;
    }

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (targetIndex < 0 || targetIndex >= sortedItems.length) {
      return;
    }

    const reorderedItems = [...sortedItems];
    const [movedItem] = reorderedItems.splice(currentIndex, 1);

    reorderedItems.splice(targetIndex, 0, movedItem);

    const normalizedItems = reorderedItems.map((item, index) => ({
      ...item,
      order: index + 1,
    }));

    saveItems(normalizedItems);
  }

  function clearBacklog() {
    const confirmed = confirm("Tem certeza que deseja limpar a fila inteira?");

    if (!confirmed) {
      return;
    }

    saveItems([]);
  }

  function resetToDefaultBacklog() {
    const confirmed = confirm("Restaurar a fila padrão das Próximas Maestrias?");

    if (!confirmed) {
      return;
    }

    saveItems(createDefaultBacklogItems());
  }

  function createOfficialBacklogCode() {
    const officialSlugs = normalizeBacklogOrder(items)
      .map((item) => item.slug)
      .filter(Boolean);

    const slugsCode = officialSlugs
      .map((slug) => `  "${slug}",`)
      .join("\n");

    return `const DEFAULT_BACKLOG_SLUGS = [\n${slugsCode}\n];`;
  }

  async function handleCopyOfficialBacklog() {
    const exportCode = createOfficialBacklogCode();

    try {
      await navigator.clipboard.writeText(exportCode);
      alert(
        "Fila oficial copiada. Substitua o bloco DEFAULT_BACKLOG_SLUGS em app/backlog/page.tsx e app/admin/backlog/page.tsx se quiser deixar os dois padrões iguais. Depois rode npm run build, git add ., commit e push."
      );
    } catch {
      window.prompt(
        "Não consegui copiar automaticamente. Copie este bloco:",
        exportCode
      );
    }
  }

  const sortedItems = normalizeBacklogOrder(items);

  const visibleSortedItems = sortedItems.filter((item) => {
    return Boolean(gamesMap[item.slug]);
  });

  const availableGames = gamesList.filter(
    (game) => !sortedItems.some((item) => item.slug === game.slug)
  );

  const firstItem = visibleSortedItems[0];
  const firstGame = firstItem ? gamesMap[firstItem.slug] : null;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0b1624_0%,#050505_45%,#020202_100%)] text-white">
      <Navbar />

      <section className="mx-auto w-full max-w-[1560px] px-8 py-8">
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
              href="/backlog"
              className="inline-flex w-fit rounded-full border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-sm font-black text-cyan-200 transition hover:bg-cyan-500/20"
            >
              Ver página pública →
            </Link>
          </div>
        </div>

        <header className="mt-8 overflow-hidden rounded-[32px] border border-white/10 bg-zinc-950/80 shadow-xl">
          <div className="relative p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.18),transparent_35%),radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_32%)]" />
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.04),transparent_40%,rgba(255,255,255,0.02))]" />

            <div className="relative z-10 flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
                  Admin
                </p>

                <h1 className="mt-3 text-5xl font-black text-white">
                  Editor de Próximas Maestrias
                </h1>

                <p className="mt-3 max-w-[760px] text-sm leading-relaxed text-white/50">
                  Organize a fila dos próximos jogos, teste a ordem no navegador
                  e copie a lista oficial quando quiser publicar no site.
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

        <section className="mt-8 rounded-[28px] border border-red-500/20 bg-red-500/5 p-6 shadow-xl">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.3em] text-red-300">
                Modo editor
              </p>

              <h2 className="mt-2 text-3xl font-black text-white">
                Adicionar jogo à fila
              </h2>

              <p className="mt-2 text-sm text-white/45">
                Adicione jogos, remova da fila e ajuste a ordem manualmente.
                Ao digitar uma posição, a fila inteira é reorganizada
                automaticamente.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleCopyOfficialBacklog}
                className="w-fit rounded-xl border border-yellow-400/30 bg-yellow-500/10 px-5 py-3 text-sm font-black text-yellow-100 transition hover:bg-yellow-500/20"
              >
                Copiar fila oficial
              </button>

              <button
                type="button"
                onClick={resetToDefaultBacklog}
                className="w-fit rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-5 py-3 text-sm font-black text-cyan-200 transition hover:bg-cyan-500/20"
              >
                Restaurar padrão
              </button>

              <button
                type="button"
                onClick={clearBacklog}
                className="w-fit rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-3 text-sm font-black text-red-200 transition hover:bg-red-500/20"
              >
                Limpar fila
              </button>
            </div>
          </div>

          <div className="mt-6 rounded-[22px] border border-yellow-400/20 bg-yellow-500/[0.055] p-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-yellow-200/80">
                  Quando usar “Copiar fila oficial”?
                </p>

                <p className="mt-2 text-sm font-bold leading-relaxed text-white/55">
                  Use esse botão quando terminar de organizar a fila e quiser
                  transformar a ordem atual em padrão oficial do site para todos.
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-xs font-bold leading-relaxed text-white/45 xl:max-w-[620px]">
                <p>
                  <span className="font-black text-yellow-100">Fluxo:</span>{" "}
                  organize a fila → Copiar fila oficial → substituir o bloco{" "}
                  <span className="font-black text-white">
                    DEFAULT_BACKLOG_SLUGS
                  </span>{" "}
                  em app/backlog/page.tsx → npm run build → git add . → commit → push.
                </p>

                <p className="mt-2">
                  Se for só testar a ordem no seu navegador, não precisa copiar
                  a fila oficial.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_auto]">
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Jogo
              </span>

              <select
                value={selectedSlug}
                onChange={(event) => setSelectedSlug(event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none transition focus:border-red-500/50"
              >
                <option value="">
                  {isGamesLoaded ? "Selecione um jogo" : "Carregando jogos..."}
                </option>

                {availableGames.map((game) => (
                  <option key={game.slug} value={game.slug}>
                    {game.title}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-end">
              <button
                type="button"
                onClick={addItem}
                className="w-full rounded-xl border border-red-500/35 bg-red-500/15 px-5 py-3 text-sm font-black text-red-100 transition hover:bg-red-500/25"
              >
                Adicionar
              </button>
            </div>
          </div>
        </section>

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
                Use o editor acima para adicionar os próximos jogos da sua
                jornada.
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

                      <div className="mt-5 grid gap-3 rounded-2xl border border-white/10 bg-black/25 p-4 md:grid-cols-[110px_auto_auto_auto]">
                        <label className="block">
                          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                            Ordem
                          </span>

                          <input
                            type="number"
                            min={1}
                            max={visibleSortedItems.length}
                            value={index + 1}
                            onChange={(event) =>
                              updateOrder(item.id, Number(event.target.value))
                            }
                            className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2 text-sm font-bold text-white outline-none transition focus:border-red-500/50"
                          />
                        </label>

                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() => moveItem(item.id, "up")}
                            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-black text-white/60 transition hover:bg-white/[0.06] hover:text-white"
                          >
                            Subir
                          </button>
                        </div>

                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() => moveItem(item.id, "down")}
                            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-black text-white/60 transition hover:bg-white/[0.06] hover:text-white"
                          >
                            Descer
                          </button>
                        </div>

                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            className="w-full rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-black text-red-200 transition hover:bg-red-500/20"
                          >
                            Remover
                          </button>
                        </div>
                      </div>
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

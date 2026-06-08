"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { useSiteGames } from "@/lib/useSiteGames";
import { type SiteSaga, useSiteSagas } from "@/lib/useSiteSagas";

type AccentTheme = {
  border: string;
  text: string;
  bg: string;
  progress: string;
  glow: string;
};

type EmblemFilter = "all" | "completed" | "locked";

type EmblemItem = {
  id: string;
  sagaSlug?: string;
  sagaTitle: string;
  gameSlug: string;
  gameTitle: string;
  title: string;
  image: string;
  fallbackIcon: string;
  progress: number;
  isCompleted: boolean;
};

type EmblemGroup = {
  key: string;
  title: string;
  subtitle: string;
  description: string;
  totalGames: number;
  completedGames: number;
  progress: number;
  isCompleted: boolean;
  theme: AccentTheme;
  emblems: EmblemItem[];
};

function getAccentTheme(accent: string): AccentTheme {
  if (accent === "cyan") {
    return {
      border: "border-cyan-400/35",
      text: "text-cyan-300",
      bg: "bg-cyan-500/10",
      progress: "bg-cyan-400",
      glow: "hover:shadow-[0_0_46px_rgba(34,211,238,0.14)]",
    };
  }

  if (accent === "yellow") {
    return {
      border: "border-yellow-400/35",
      text: "text-yellow-300",
      bg: "bg-yellow-500/10",
      progress: "bg-yellow-400",
      glow: "hover:shadow-[0_0_46px_rgba(250,204,21,0.14)]",
    };
  }

  if (accent === "purple") {
    return {
      border: "border-purple-400/35",
      text: "text-purple-300",
      bg: "bg-purple-500/10",
      progress: "bg-purple-400",
      glow: "hover:shadow-[0_0_46px_rgba(168,85,247,0.14)]",
    };
  }

  if (accent === "emerald") {
    return {
      border: "border-emerald-400/35",
      text: "text-emerald-300",
      bg: "bg-emerald-500/10",
      progress: "bg-emerald-400",
      glow: "hover:shadow-[0_0_46px_rgba(16,185,129,0.14)]",
    };
  }

  return {
    border: "border-red-500/35",
    text: "text-red-300",
    bg: "bg-red-500/10",
    progress: "bg-red-500",
    glow: "hover:shadow-[0_0_46px_rgba(239,68,68,0.16)]",
  };
}

function readText(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);

  return fallback;
}

function readStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => readText(item, "").trim()).filter(Boolean);
  }

  const text = readText(value, "");

  if (!text.trim()) {
    return [];
  }

  return text
    .split(/[\n,;]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeText(value: unknown) {
  return readText(value, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

function normalizeStatus(status?: string) {
  const value = normalizeText(status);

  if (
    value === "completed" ||
    value === "finalizado" ||
    value === "concluido" ||
    value === "concluida"
  ) {
    return "completed";
  }

  if (
    value === "planned" ||
    value === "planejado" ||
    value === "backlog" ||
    value === "futuro"
  ) {
    return "planned";
  }

  return "progress";
}

function isAchievementCompleted(achievement: unknown) {
  if (!achievement || typeof achievement !== "object") {
    return false;
  }

  const achievementRecord = achievement as { status?: string };
  const status = normalizeText(readText(achievementRecord.status, "locked"));

  return (
    status === "completed" ||
    status === "concluido" ||
    status === "concluida" ||
    status === "desbloqueado" ||
    status === "desbloqueada"
  );
}

function isGameCompleted(game: Record<string, unknown>) {
  const achievements = game.achievementsList;

  if (Array.isArray(achievements) && achievements.length > 0) {
    return achievements.every(isAchievementCompleted);
  }

  const status = normalizeStatus(readText(game.status, "progress"));
  const progress = clampPercent(Number(game.progress) || 0);

  return status === "completed" || progress >= 100;
}

function getGameProgress(game: Record<string, unknown>) {
  return clampPercent(Number(game.progress) || 0);
}

function getSagaGameSlugs(saga: SiteSaga) {
  return saga.stages.flatMap((stage) => stage.gameSlugs);
}

function hasExplicitEmblemData(game: Record<string, unknown>) {
  const emblem = game.emblem as
    | {
        title?: string;
        image?: string;
        description?: string;
        tags?: string[] | string;
      }
    | undefined;

  const finalBadge = game.finalBadge as
    | {
        title?: string;
        image?: string;
        icon?: string;
      }
    | undefined;

  return Boolean(
    readText(emblem?.title, "") ||
      readText(emblem?.image, "") ||
      readText(emblem?.description, "") ||
      readStringList(emblem?.tags).length > 0 ||
      readText(game.emblemTitle, "") ||
      readText(game.emblemImage, "") ||
      readText(game.emblemDescription, "") ||
      readStringList(game.emblemTags).length > 0 ||
      readText(finalBadge?.title, "") ||
      readText(finalBadge?.image, "")
  );
}

function shouldShowStandaloneGame(game: Record<string, unknown>) {
  return hasExplicitEmblemData(game) || isGameCompleted(game);
}

function getGameEmblem(
  game: Record<string, unknown>,
  gameSlug: string,
  fallbackImage = ""
) {
  const emblem = game.emblem as
    | {
        title?: string;
        image?: string;
        description?: string;
        tags?: string[] | string;
      }
    | undefined;

  const finalBadge = game.finalBadge as
    | {
        title?: string;
        image?: string;
        icon?: string;
      }
    | undefined;

  if (
    gameSlug === "hogwarts-legacy" ||
    gameSlug === "howgarts-legacy" ||
    normalizeText(game.title).includes("hogwarts")
  ) {
    return {
      title: "Legado Absoluto",
      image: "/images/games/howgarts-legacy/emblem.png",
      fallbackIcon: "💎",
    };
  }

  const emblemTitle =
    readText(emblem?.title, "") ||
    readText(game.emblemTitle, "") ||
    readText(finalBadge?.title, "") ||
    readText(game.title, "Emblema do Jogo");

  const emblemImage =
    readText(emblem?.image, "") ||
    readText(game.emblemImage, "") ||
    readText(finalBadge?.image, "") ||
    fallbackImage ||
    `/images/games/${gameSlug}/emblem.png`;

  const fallbackIcon =
    readText(finalBadge?.icon, "") ||
    readText(game.fallbackIcon, "") ||
    "🏆";

  return {
    title: emblemTitle,
    image: emblemImage,
    fallbackIcon,
  };
}

function BadgeImage({
  src,
  alt,
  fallbackIcon,
  isLarge = false,
}: {
  src?: string;
  alt: string;
  fallbackIcon: string;
  isLarge?: boolean;
}) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  if (!src || hasError) {
    return (
      <div
        className={`flex h-full w-full items-center justify-center ${
          isLarge ? "text-7xl" : "text-6xl"
        }`}
      >
        {fallbackIcon}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={`h-full w-full object-contain transition duration-300 ${
        isLarge ? "scale-[1.18]" : "scale-[1.14]"
      }`}
      onError={() => setHasError(true)}
    />
  );
}

function getFilterButtonClass(isActive: boolean) {
  return `rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.18em] transition ${
    isActive
      ? "border-red-500/45 bg-red-500/20 text-red-200 shadow-[0_0_24px_rgba(239,68,68,0.14)]"
      : "border-white/10 bg-white/[0.03] text-white/45 hover:border-white/20 hover:text-white"
  }`;
}

function EmptyMessage({ activeFilter }: { activeFilter: EmblemFilter }) {
  if (activeFilter === "completed") {
    return (
      <div className="rounded-[24px] border border-white/10 bg-zinc-950/80 p-8 text-white/50">
        Nenhum emblema conquistado ainda.
      </div>
    );
  }

  if (activeFilter === "locked") {
    return (
      <div className="rounded-[24px] border border-white/10 bg-zinc-950/80 p-8 text-white/50">
        Nenhum emblema bloqueado no momento.
      </div>
    );
  }

  return (
    <div className="rounded-[24px] border border-white/10 bg-zinc-950/80 p-8 text-white/50">
      Nenhum emblema cadastrado no momento.
    </div>
  );
}

function EmblemCard({
  emblem,
  theme,
  isLarge = false,
}: {
  emblem: EmblemItem;
  theme: AccentTheme;
  isLarge?: boolean;
}) {
  const isLocked = !emblem.isCompleted;

  return (
    <Link
      href={`/games/${emblem.gameSlug}`}
      className={`group relative text-center transition hover:-translate-y-1 ${
        isLarge ? "w-full max-w-[340px]" : "w-full"
      }`}
    >
      <div
        className={`relative mx-auto flex items-center justify-center overflow-visible ${
          isLarge
            ? "h-[290px] w-full max-w-[290px]"
            : "h-[220px] w-full max-w-[220px]"
        }`}
      >
        <div
          className={`h-full w-full transition duration-300 ${
            isLocked
              ? "opacity-25 grayscale saturate-0 blur-[5px] brightness-[0.45] scale-[0.98]"
              : "group-hover:scale-[1.03]"
          }`}
        >
          <BadgeImage
            src={emblem.image}
            alt={emblem.title}
            fallbackIcon={emblem.fallbackIcon}
            isLarge={isLarge}
          />
        </div>

        {isLocked && (
          <div
            className={`pointer-events-none absolute right-2 top-2 z-20 flex items-center justify-center rounded-full border border-white/15 bg-black/75 shadow-[0_0_18px_rgba(0,0,0,0.5)] backdrop-blur-sm ${
              isLarge ? "h-10 w-10 text-lg" : "h-8 w-8 text-base"
            }`}
          >
            🔒
          </div>
        )}
      </div>

      <div
        className={`mx-auto mt-3 inline-flex rounded-full border px-2.5 py-1 text-[8px] font-black uppercase tracking-[0.14em] ${
          emblem.isCompleted
            ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300"
            : "border-white/10 bg-white/[0.03] text-white/40"
        }`}
      >
        {emblem.isCompleted ? "Conquistado" : "Bloqueado"}
      </div>

      <h3
        className={`mt-2 line-clamp-2 font-black leading-tight ${
          isLarge ? "text-xl" : "text-base"
        } ${emblem.isCompleted ? "text-white" : "text-white/55"}`}
      >
        {emblem.isCompleted ? emblem.title : "Emblema bloqueado"}
      </h3>

      <p
        className={`mt-1 line-clamp-1 font-bold ${
          isLarge ? "text-xs" : "text-[11px]"
        } ${emblem.isCompleted ? theme.text : "text-white/35"}`}
      >
        {emblem.gameTitle}
      </p>
    </Link>
  );
}

function EmblemGroupCard({ group }: { group: EmblemGroup }) {
  const hasSingleEmblem = group.emblems.length === 1;

  return (
    <article
      className={`group/card overflow-hidden rounded-[30px] border bg-zinc-950/75 p-5 shadow-xl transition hover:-translate-y-1 hover:border-white/20 ${
        group.isCompleted
          ? `${group.theme.border} ${group.theme.glow}`
          : "border-white/10"
      }`}
    >
      <div className="border-b border-white/10 pb-3">
        <p className="text-[10px] font-black uppercase tracking-[0.28em] text-white/30">
          Franquia / Jogo
        </p>

        <h2 className="mt-1 line-clamp-1 text-2xl font-black text-white">
          {group.title}
        </h2>

        {group.subtitle && (
          <p className={`mt-1 line-clamp-1 text-xs font-bold ${group.theme.text}`}>
            {group.subtitle}
          </p>
        )}
      </div>

      <div
        className={
          hasSingleEmblem
            ? "mt-5 flex justify-center"
            : "mt-5 grid grid-cols-2 gap-4"
        }
      >
        {group.emblems.map((emblem) => (
          <EmblemCard
            key={emblem.id}
            emblem={emblem}
            theme={group.theme}
            isLarge={hasSingleEmblem}
          />
        ))}
      </div>
    </article>
  );
}

export default function SagasPage() {
  const { sagasList, isLoaded } = useSiteSagas();
  const { gamesList, gamesMap } = useSiteGames();

  const [activeFilter, setActiveFilter] = useState<EmblemFilter>("all");
  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setShowBackToTop(window.scrollY > 500);
    }

    handleScroll();

    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const emblemGroups = useMemo<EmblemGroup[]>(() => {
    const linkedGameSlugs = new Set(
      sagasList.flatMap((saga) => getSagaGameSlugs(saga))
    );

    const sagaGroups = sagasList.map((saga) => {
      const gameSlugs = getSagaGameSlugs(saga);

      const activeGameSlugs = gameSlugs.filter((slug) =>
        Boolean(gamesMap[slug])
      );

      const emblems = activeGameSlugs
        .map((gameSlug) => {
          const game = gamesMap[gameSlug] as Record<string, unknown> | undefined;

          if (!game) return null;

          const emblem = getGameEmblem(game, gameSlug, saga.badgeImage);
          const progress = getGameProgress(game);
          const isCompleted = isGameCompleted(game);

          return {
            id: `${saga.slug}-${gameSlug}`,
            sagaSlug: saga.slug,
            sagaTitle: saga.title,
            gameSlug,
            gameTitle: readText(game.title, gameSlug),
            title: emblem.title,
            image: emblem.image,
            fallbackIcon: emblem.fallbackIcon,
            progress,
            isCompleted,
          } satisfies EmblemItem;
        })
        .filter(Boolean) as EmblemItem[];

      const totalGames = emblems.length;
      const completedGames = emblems.filter((emblem) => emblem.isCompleted).length;

      const progress =
        totalGames > 0 ? Math.round((completedGames / totalGames) * 100) : 0;

      const isCompleted = totalGames > 0 && completedGames === totalGames;

      return {
        key: `saga-${saga.slug}`,
        title: saga.title,
        subtitle: saga.subtitle || "",
        description: saga.description || "",
        totalGames,
        completedGames,
        progress,
        isCompleted,
        theme: getAccentTheme(String(saga.accent || "red")),
        emblems: emblems.sort((a, b) =>
          a.gameTitle.localeCompare(b.gameTitle, "pt-BR")
        ),
      } satisfies EmblemGroup;
    });

    const standaloneGroups = gamesList
      .filter((game) => {
        const gameSlug = readText(game.slug, "");

        if (!gameSlug) return false;
        if (linkedGameSlugs.has(gameSlug)) return false;

        return shouldShowStandaloneGame(game as unknown as Record<string, unknown>);
      })
      .map((game) => {
        const gameRecord = game as unknown as Record<string, unknown>;
        const gameSlug = readText(game.slug, "");
        const gameTitle = readText(game.title, gameSlug);
        const emblem = getGameEmblem(gameRecord, gameSlug);
        const progress = getGameProgress(gameRecord);
        const isCompleted = isGameCompleted(gameRecord);

        const item: EmblemItem = {
          id: `game-${gameSlug}`,
          sagaTitle: gameTitle,
          gameSlug,
          gameTitle,
          title: emblem.title,
          image: emblem.image,
          fallbackIcon: emblem.fallbackIcon,
          progress,
          isCompleted,
        };

        return {
          key: `game-${gameSlug}`,
          title: gameTitle,
          subtitle: readText(game.subtitle, ""),
          description:
            readText(
              (gameRecord.emblem as { description?: string } | undefined)
                ?.description,
              ""
            ) ||
            readText(gameRecord.emblemDescription, "") ||
            "Emblema individual deste jogo dentro da coleção Rumo à Conquista.",
          totalGames: 1,
          completedGames: isCompleted ? 1 : 0,
          progress,
          isCompleted,
          theme: getAccentTheme("red"),
          emblems: [item],
        } satisfies EmblemGroup;
      });

    return [...sagaGroups, ...standaloneGroups]
      .filter((group) => group.emblems.length > 0)
      .sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
  }, [sagasList, gamesMap, gamesList]);

  const allEmblems = emblemGroups.flatMap((group) => group.emblems);

  const totalEmblems = allEmblems.length;
  const completedEmblems = allEmblems.filter((emblem) => emblem.isCompleted).length;
  const lockedEmblems = totalEmblems - completedEmblems;

  const totalProgress =
    totalEmblems > 0 ? Math.round((completedEmblems / totalEmblems) * 100) : 0;

  const filteredGroups = useMemo(() => {
    return emblemGroups
      .map((group) => {
        const emblems = group.emblems.filter((emblem) => {
          if (activeFilter === "completed") return emblem.isCompleted;
          if (activeFilter === "locked") return !emblem.isCompleted;

          return true;
        });

        return {
          ...group,
          emblems,
        };
      })
      .filter((group) => group.emblems.length > 0);
  }, [activeFilter, emblemGroups]);

  function scrollToTop() {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  return (
    <main
      id="topo-emblemas"
      className="min-h-screen bg-[radial-gradient(circle_at_top,#0b1624_0%,#050505_45%,#020202_100%)] text-white"
    >
      <Navbar />

      {showBackToTop && (
        <button
          type="button"
          onClick={scrollToTop}
          className="fixed bottom-6 left-1/2 z-[9999] inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-red-500/35 bg-zinc-950/95 px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-red-200 shadow-[0_0_30px_rgba(239,68,68,0.22)] backdrop-blur-md transition hover:border-red-400/60 hover:bg-red-500/15 hover:text-red-100"
        >
          <span>↑</span>
          <span>Voltar ao topo</span>
        </button>
      )}

      <section className="mx-auto w-full max-w-[1500px] px-8 py-8">
        <Link
          href="/"
          className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-black text-red-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
        >
          ← Voltar para Home
        </Link>

        <header className="mt-8 overflow-hidden rounded-[32px] border border-white/10 bg-zinc-950/80 shadow-xl">
          <div className="relative p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.18),transparent_35%),radial-gradient(circle_at_top_right,rgba(34,211,238,0.14),transparent_32%)]" />

            <div className="relative z-10 flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
                  Emblemas
                </p>

                <h1 className="mt-3 text-5xl font-black text-white">
                  Coleção de Emblemas
                </h1>

                <p className="mt-3 max-w-[780px] text-sm leading-relaxed text-white/50">
                  Galeria das franquias, sagas e jogos avulsos do projeto. Cada
                  card exibe o emblema disponível dentro da coleção.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 text-center">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                    Emblemas
                  </p>

                  <p className="mt-1 text-3xl font-black text-white">
                    {completedEmblems}/{totalEmblems}
                  </p>
                </div>

                <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 px-5 py-4 text-center">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-300/70">
                    Progresso
                  </p>

                  <p className="mt-1 text-3xl font-black text-cyan-300">
                    {totalProgress}%
                  </p>
                </div>
              </div>
            </div>
          </div>
        </header>

        <section className="mt-8 rounded-[24px] border border-white/10 bg-zinc-950/70 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.28em] text-red-400">
                Organização
              </p>

              <p className="mt-1 text-sm text-white/45">
                Coleção em ordem alfabética. Use os filtros para separar
                conquistados e bloqueados.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setActiveFilter("all")}
                className={getFilterButtonClass(activeFilter === "all")}
              >
                Todos {totalEmblems}
              </button>

              <button
                type="button"
                onClick={() => setActiveFilter("completed")}
                className={getFilterButtonClass(activeFilter === "completed")}
              >
                Conquistados {completedEmblems}
              </button>

              <button
                type="button"
                onClick={() => setActiveFilter("locked")}
                className={getFilterButtonClass(activeFilter === "locked")}
              >
                Bloqueados {lockedEmblems}
              </button>
            </div>
          </div>
        </section>

        <section className="mt-8">
          {!isLoaded ? (
            <div className="rounded-[24px] border border-white/10 bg-zinc-950/80 p-8 text-white/50">
              Carregando emblemas...
            </div>
          ) : emblemGroups.length === 0 ? (
            <EmptyMessage activeFilter={activeFilter} />
          ) : filteredGroups.length === 0 ? (
            <EmptyMessage activeFilter={activeFilter} />
          ) : (
            <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
              {filteredGroups.map((group) => (
                <EmblemGroupCard key={group.key} group={group} />
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
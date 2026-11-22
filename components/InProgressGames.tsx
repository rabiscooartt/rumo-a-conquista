"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSiteGames } from "@/lib/useSiteGames";
import { fallbackToOriginal, homeImageSrc } from "@/lib/homeImages";

function normalizeStatus(status?: string) {
  const value = String(status || "").toLowerCase();

  if (value === "completed" || value === "finalizado") return "completed";
  if (value === "planned" || value === "backlog" || value === "futuro")
    return "planned";

  return "progress";
}

function GameCover({
  src,
  alt,
}: {
  src?: string;
  alt: string;
}) {
  const [hasError, setHasError] = useState(false);

  if (!src || hasError) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black/50 text-sm font-black text-white/35">
        Sem imagem
      </div>
    );
  }

  return (
    <img
      src={homeImageSrc(src)}
      alt={alt}
      loading="lazy"
      decoding="async"
      className="h-full w-full object-cover"
      onError={fallbackToOriginal(src, () => setHasError(true))}
    />
  );
}

export default function InProgressGames() {
  const { gamesList } = useSiteGames();

  const progressGames = useMemo(() => {
    return gamesList.filter((game) => normalizeStatus(game.status) === "progress");
  }, [gamesList]);

  return (
    <section>
      <div>
        <h2 className="flex items-center gap-2 text-base font-black uppercase tracking-wide text-white sm:text-lg"><span aria-hidden="true" className="h-5 w-1 rounded-full bg-[#FB2C36]" /> Jogos em progresso</h2>

        <p className="mt-1 text-xs text-white/60 sm:text-[13px]">
          Jogos ativos no momento e próximos objetivos da jornada
        </p>
      </div>

      <div className="mt-4 space-y-4">
        {progressGames.length > 0 ? (
          progressGames.map((game) => {
            const progress = Math.min(
              100,
              Math.max(0, Number(game.progress) || 0)
            );

            const achievements = Array.isArray(game.achievementsList)
              ? game.achievementsList
              : [];

            const completedAchievements =
              typeof game.achievementsUnlocked === "number"
                ? game.achievementsUnlocked
                : achievements.filter(
                    (achievement) => achievement.status === "completed"
                  ).length;
            const totalAchievements =
              typeof game.achievementsTotal === "number"
                ? game.achievementsTotal
                : achievements.length;

            return (
              <Link
                key={game.slug}
                href={`/games/${game.slug}`}
                className="group grid grid-cols-[84px_minmax(0,1fr)] gap-x-4 overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#090b0f] p-4 transition hover:border-red-500/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 sm:grid-cols-[128px_minmax(0,1fr)] sm:gap-x-5 sm:p-5 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-x-6 lg:p-0"
              >
                <div className="relative aspect-[3/4] self-start overflow-hidden rounded-lg border border-white/10 bg-black lg:row-span-2 lg:aspect-auto lg:h-full lg:min-h-[300px] lg:rounded-none lg:border-0 lg:border-r">
                  <GameCover
                    src={game.cardImage || game.image}
                    alt={game.title}
                  />
                </div>

                <div className="min-w-0 self-center lg:self-end lg:pr-6 lg:pt-6">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-red-300">
                      Em progresso
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] font-black tabular-nums text-white/80">
                      {progress}%
                    </span>
                  </div>

                  <h3 className="mt-2 line-clamp-3 text-lg font-black leading-tight text-white transition group-hover:text-red-200 sm:text-2xl lg:text-[28px]">
                    {game.title}
                  </h3>

                  {game.subtitle && (
                    <p className="mt-1 line-clamp-2 text-xs font-bold text-sky-300/90 sm:text-sm">
                      {game.subtitle}
                    </p>
                  )}
                </div>

                <div className="col-span-2 mt-4 min-w-0 sm:mt-5 lg:col-span-1 lg:col-start-2 lg:mt-5 lg:pb-6 lg:pr-6">
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/[0.05] p-3 sm:p-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/15 text-lg">
                        🎯
                      </div>

                      <div className="min-w-0">
                        <p className="text-[9px] font-black uppercase tracking-[0.2em] text-red-300">
                          Objetivo atual
                        </p>

                        <p className="mt-1 text-sm font-black leading-snug text-white sm:text-base">
                          {game.currentObjective ||
                            game.objective ||
                            "Definir próximo objetivo"}
                        </p>
                      </div>
                    </div>

                    <dl className="grid grid-cols-2 divide-x divide-white/[0.08] rounded-xl border border-white/[0.08] bg-white/[0.02] xl:min-w-[240px]">
                      <div className="px-4 py-3">
                        <dt className="text-[9px] font-black uppercase tracking-[0.18em] text-white/40">
                          Conquistas
                        </dt>
                        <dd className="mt-1 text-xl font-black tabular-nums text-white">
                          {completedAchievements}/{totalAchievements}
                        </dd>
                      </div>

                      <div className="px-4 py-3">
                        <dt className="text-[9px] font-black uppercase tracking-[0.18em] text-white/40">
                          Horas
                        </dt>
                        <dd className="mt-1 text-xl font-black tabular-nums text-white">
                          {game.hours || "0h"}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div className="mt-4">
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="text-white/55">Progresso da jornada</span>

                      <span className="font-black tabular-nums text-red-400">
                        {progress}%
                      </span>
                    </div>

                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-red-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                </div>
              </Link>
            );
          })
        ) : (
          <div className="rounded-[14px] border border-white/[0.08] bg-[#090b0f] p-8 text-sm text-white/45">
            Nenhum jogo em progresso no momento.
          </div>
        )}
      </div>
    </section>
  );
}
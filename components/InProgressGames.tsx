"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSiteGames } from "@/lib/useSiteGames";

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
      src={src}
      alt={alt}
      className="h-full w-full object-cover"
      onError={() => setHasError(true)}
    />
  );
}

export default function InProgressGames() {
  const { gamesList } = useSiteGames();

  const progressGames = useMemo(() => {
    return gamesList.filter((game) => normalizeStatus(game.status) === "progress");
  }, [gamesList]);

  return (
    <section className="mt-10">
      <div>
        <h2 className="text-4xl font-black text-white">Jogos em Progresso</h2>

        <p className="mt-2 text-sm text-white/50">
          Jogos ativos no momento e próximos objetivos da jornada
        </p>
      </div>

      <div className="mt-6 space-y-5">
        {progressGames.length > 0 ? (
          progressGames.map((game) => {
            const progress = Math.min(
              100,
              Math.max(0, Number(game.progress) || 0)
            );

            const achievements = Array.isArray(game.achievementsList)
              ? game.achievementsList
              : [];

            const completedAchievements = achievements.filter(
              (achievement) => achievement.status === "completed"
            ).length;

            return (
              <Link
                key={game.slug}
                href={`/games/${game.slug}`}
                className="group grid overflow-hidden rounded-[28px] border border-white/10 bg-zinc-950/80 transition hover:border-red-500/35 lg:grid-cols-[280px_1fr]"
              >
                <div className="relative h-[320px] overflow-hidden">
                  <GameCover
                    src={game.cardImage || game.image}
                    alt={game.title}
                  />

                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                  <div className="absolute left-5 top-5 rounded-full border border-red-400/25 bg-red-500/20 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-red-100">
                    Em progresso
                  </div>

                  <div className="absolute right-5 top-5 rounded-full border border-white/10 bg-white/20 px-4 py-2 text-sm font-black text-white">
                    {progress}%
                  </div>
                </div>

                <div className="p-6">
                  <div className="flex flex-col gap-5 xl:flex-row xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-3xl font-black text-white group-hover:text-red-200">
                        {game.title}
                      </h3>

                      {game.subtitle && (
                        <p className="mt-1 text-sm font-bold text-blue-300">
                          {game.subtitle}
                        </p>
                      )}

                      <div className="mt-6 flex items-center gap-4 rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/15 text-xl">
                          🎯
                        </div>

                        <div className="min-w-0">
                          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-red-300">
                            Objetivo atual
                          </p>

                          <p className="mt-2 text-lg font-black text-white">
                            {game.currentObjective ||
                              game.objective ||
                              "Definir próximo objetivo"}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid min-w-[260px] gap-3">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                          Conquistas
                        </p>

                        <p className="mt-2 text-2xl font-black text-white">
                          {completedAchievements}/{achievements.length}
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                          Horas
                        </p>

                        <p className="mt-2 text-2xl font-black text-white">
                          {game.hours || "0h"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-7">
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="text-white/50">Progresso da jornada</span>

                      <span className="font-black text-red-400">
                        {progress}%
                      </span>
                    </div>

                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
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
          <div className="rounded-[24px] border border-white/10 bg-zinc-950/80 p-8 text-sm text-white/45">
            Nenhum jogo em progresso no momento.
          </div>
        )}
      </div>
    </section>
  );
}
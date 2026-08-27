"use client";

import Link from "next/link";
import Navbar from "@/components/Navbar";
import { useMemo, useState } from "react";
import { useSiteGames } from "@/lib/useSiteGames";
import { type JourneyEntry, useJourneyEntries } from "@/lib/useJourneyEntries";

type ActivityTab = "jogos" | "conquistas" | "reviews";

type GameLike = {
  slug?: string;
  title?: string;
  subtitle?: string;
  image?: string;
  cardImage?: string;
  platform?: string;
  platforms?: string[];
  console?: string;
  achievementsList?: unknown[];
};

type AchievementLike = {
  id?: string;
  title?: string;
  description?: string;
  image?: string;
  earnedDate?: string;
  earned_at?: string;
  earnedAt?: string;
  completedAt?: string;
  status?: string;
  rank?: string;
  difficulty?: string;
};

function formatPlayedTime(minutes = 0) {
  const safeMinutes = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;

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

function normalizeKey(value?: string) {
  return (value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function getDateKey(date?: string) {
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

function getMonthShort(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";

  return parsed
    .toLocaleDateString("pt-BR", { month: "short" })
    .replace(".", "")
    .toUpperCase();
}

function getWeekdayShort(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";

  return parsed.toLocaleDateString("pt-BR", {
    weekday: "long",
  });
}

function getGamePlatform(game?: GameLike) {
  if (!game) return "";

  if (game.platform) return game.platform;
  if (game.console) return game.console;

  if (Array.isArray(game.platforms) && game.platforms.length > 0) {
    return game.platforms.join(" • ");
  }

  return "";
}

function getGameCover(game?: GameLike, slug?: string) {
  if (game?.cardImage) return game.cardImage;
  if (game?.image) return game.image;
  if (slug) return `/images/games/${slug}/cover.jpg`;
  return "";
}

function isCompletedAchievement(achievement: AchievementLike) {
  const status = normalizeKey(achievement.status);

  return (
    status === "completed" ||
    status === "concluida" ||
    status === "concluido"
  );
}

function getAchievementDate(achievement: AchievementLike) {
  return (
    achievement.earnedDate ||
    achievement.earned_at ||
    achievement.earnedAt ||
    achievement.completedAt ||
    ""
  );
}

function getAchievementImage(achievement: AchievementLike) {
  return String(achievement.image || "").trim();
}

function getInitials(value: string) {
  const words = value
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return "RC";

  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() || "")
    .join("");
}

function calculateStreak(entries: JourneyEntry[]) {
  const uniqueDates = Array.from(
    new Set(
      entries
        .map((entry) => getDateKey(entry.date))
        .filter(Boolean)
    )
  ).sort((a, b) => b.localeCompare(a));

  if (uniqueDates.length === 0) return 0;

  let streak = 1;

  for (let index = 0; index < uniqueDates.length - 1; index += 1) {
    const current = new Date(`${uniqueDates[index]}T12:00:00`);
    const previous = new Date(`${uniqueDates[index + 1]}T12:00:00`);

    const difference =
      Math.round(
        (current.getTime() - previous.getTime()) /
          (1000 * 60 * 60 * 24)
      );

    if (difference !== 1) break;

    streak += 1;
  }

  return streak;
}

function Metric({
  label,
  value,
  icon,
  accent = "red",
}: {
  label: string;
  value: string | number;
  icon: string;
  accent?: "red" | "blue" | "violet" | "green";
}) {
  const accentClasses = {
    red: "border-red-500/25 bg-red-500/10 text-red-300",
    blue: "border-sky-500/20 bg-sky-500/10 text-sky-300",
    violet: "border-violet-500/20 bg-violet-500/10 text-violet-300",
    green: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  } as const;

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-sm ${accentClasses[accent]}`}
      >
        {icon}
      </div>

      <div className="min-w-0">
        <p className="text-[8px] font-black uppercase tracking-[0.15em] text-white/35">
          {label}
        </p>
        <p className="mt-0.5 truncate text-sm font-black text-white">
          {value}
        </p>
      </div>
    </div>
  );
}

function ActivityMap({ entries }: { entries: JourneyEntry[] }) {
  const activityByDay = useMemo(() => {
    const map = new Map<string, number>();

    for (const entry of entries) {
      const key = getDateKey(entry.date);
      if (!key) continue;

      map.set(
        key,
        (map.get(key) || 0) + Number(entry.playedMinutes || 0)
      );
    }

    return map;
  }, [entries]);

  const calendar = useMemo(() => {
    const today = new Date();
    const first = new Date(today);
    first.setDate(today.getDate() - 89);

    // Align the first cell to Monday and the last cell to Sunday.
    const start = new Date(first);
    const mondayOffset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - mondayOffset);

    const end = new Date(today);
    const sundayOffset = (7 - end.getDay()) % 7;
    end.setDate(end.getDate() + sundayOffset);

    const cells: string[] = [];
    const cursor = new Date(start);

    while (cursor <= end) {
      cells.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }

    return cells;
  }, []);

  const weeks = Math.ceil(calendar.length / 7);

  const rows = [
    "Seg",
    "Ter",
    "Qua",
    "Qui",
    "Sex",
    "Sáb",
    "Dom",
  ];

  const getIntensity = (minutes: number) => {
    if (minutes <= 0) return "bg-white/[0.025]";

    if (minutes < 60) return "bg-red-500/25";

    if (minutes < 180) return "bg-red-500/45";

    if (minutes < 300) return "bg-red-500/70";

    return "bg-red-500";
  };

  const monthMarkers = useMemo(() => {
    const markers: { label: string; column: number }[] = [];

    calendar.forEach((day, index) => {
      const date = new Date(`${day}T12:00:00`);
      const isMonday = date.getDay() === 1;

      if (!isMonday) return;

      const label = date
        .toLocaleDateString("pt-BR", {
          month: "short",
        })
        .replace(".", "")
        .toUpperCase();

      if (
        !markers.length ||
        markers[markers.length - 1].label !== label
      ) {
        markers.push({
          label,
          column: Math.floor(index / 7) + 1,
        });
      }
    });

    return markers;
  }, [calendar]);

  return (
    <section className="rounded-2xl border border-white/10 bg-[#08090c]/90 p-4 md:p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[8px] font-black uppercase tracking-[0.25em] text-red-400">
            Últimos 90 dias
          </p>
          <h2 className="mt-1 text-lg font-black text-white">
            Mapa de atividade
          </h2>
        </div>

        <span className="hidden text-[9px] font-medium text-white/30 md:block">
          Cada quadrado representa um dia
        </span>
      </div>

      <div className="mt-4 overflow-x-auto pb-1">
        <div
          className="min-w-[620px]"
          style={{
            display: "grid",
            gridTemplateColumns: `42px repeat(${weeks}, minmax(12px, 1fr))`,
            gridTemplateRows: "16px repeat(7, 13px)",
            columnGap: "3px",
            rowGap: "4px",
          }}
        >
          <div />

          {monthMarkers.map((marker) => (
            <div
              key={`${marker.label}-${marker.column}`}
              className="text-[7px] font-black tracking-[0.14em] text-white/30"
              style={{
                gridColumnStart: marker.column + 1,
                gridRowStart: 1,
              }}
            >
              {marker.label}
            </div>
          ))}

          {rows.map((row) => (
            <div
              key={row}
              className="flex items-center justify-end pr-1 text-[9px] font-bold text-white/40"
            >
              {row}
            </div>
          ))}

          {Array.from({ length: weeks * 7 }).map((_, index) => {
            const day = calendar[index];
            const week = Math.floor(index / 7);
            const dayIndex = index % 7;

            if (!day) {
              return (
                <div
                  key={`empty-${index}`}
                  style={{
                    gridColumnStart: week + 2,
                    gridRowStart: dayIndex + 2,
                  }}
                />
              );
            }

            const minutes = activityByDay.get(day) || 0;

            return (
              <div
                key={day}
                title={`${day} • ${formatPlayedTime(minutes)}`}
                className={`h-[13px] w-full rounded-[3px] ${getIntensity(
                  minutes
                )} transition duration-150 hover:scale-110`}
                style={{
                  gridColumnStart: week + 2,
                  gridRowStart: dayIndex + 2,
                }}
              />
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-1.5 text-[8px] font-bold text-white/30">
        <span>Menos</span>
        <span className="h-2.5 w-2.5 rounded-[2px] bg-white/[0.025]" />
        <span className="h-2.5 w-2.5 rounded-[2px] bg-red-500/25" />
        <span className="h-2.5 w-2.5 rounded-[2px] bg-red-500/45" />
        <span className="h-2.5 w-2.5 rounded-[2px] bg-red-500/70" />
        <span className="h-2.5 w-2.5 rounded-[2px] bg-red-500" />
        <span>Mais</span>
      </div>
    </section>
  );
}

function ActivityRow({
  entry,
  game,
  achievements,
}: {
  entry: JourneyEntry;
  game?: GameLike;
  achievements: AchievementLike[];
}) {
  const cover = getGameCover(game, entry.gameSlug);
  const platform = getGamePlatform(game);
  const day = new Date(`${entry.date}T12:00:00`).getDate();
  const month = getMonthShort(entry.date);

  return (
    <article className="group grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/[0.08] px-3 py-3.5 last:border-b-0 md:grid-cols-[54px_minmax(0,1fr)_minmax(185px,1fr)_105px] md:gap-4 md:px-4">
      <div>
        <p className="text-[24px] font-black leading-none tracking-tight text-white">
          {day}
        </p>
        <p className="mt-1 text-[9px] font-black uppercase tracking-[0.12em] text-red-400">
          {month}
        </p>
      </div>

      <div className="flex min-w-0 items-center gap-3">
        <div className="h-[56px] w-[43px] shrink-0 overflow-hidden rounded-[7px] border border-white/10 bg-black shadow-lg">
          {cover ? (
            <img
              src={cover}
              alt={normalizeGameTitle(entry.gameTitle)}
              className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[8px] font-black text-white/20">
              {getInitials(entry.gameTitle)}
            </div>
          )}
        </div>

        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-black leading-tight text-white md:text-[15px]">
            {normalizeGameTitle(entry.gameTitle)}
          </h3>

          <p className="mt-1 truncate text-[10px] font-medium text-white/40 md:text-[11px]">
            {entry.weekDay || getWeekdayShort(entry.date)}
            {platform ? ` • ${platform}` : ""}
          </p>
        </div>
      </div>

      <div className="hidden min-w-0 md:block">
        {achievements.length > 0 ? (
          <>
            <p className="mb-2 text-[8px] font-black uppercase tracking-[0.14em] text-white/30">
              Conquistas desbloqueadas
            </p>

            <div className="flex items-center gap-2">
              {achievements.slice(0, 5).map((achievement, index) => {
                const image = getAchievementImage(achievement);
                const title = achievement.title || `Conquista ${index + 1}`;

                return (
                  <div
                    key={`${entry.id}-${title}-${index}`}
                    title={title}
                    className="h-9 w-9 shrink-0 overflow-hidden rounded-full border border-white/15 bg-black/70"
                  >
                    {image ? (
                      <img
                        src={image}
                        alt={title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs">
                        🏆
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <span className="text-[8px] font-black uppercase tracking-[0.12em] text-white/15">
            —
          </span>
        )}
      </div>

      <div className="text-right">
        <p className="text-[14px] font-black leading-none text-white md:text-[16px]">
          {formatPlayedTime(entry.playedMinutes)}
        </p>
        <p className="mt-1 text-[8px] font-black uppercase tracking-[0.13em] text-white/25">
          Tempo jogado
        </p>
      </div>
    </article>
  );
}

export default function AtividadePage() {
  const { entries, isLoaded } = useJourneyEntries();
  const { gamesList } = useSiteGames();

  const [activeTab, setActiveTab] = useState<ActivityTab>("jogos");
  const [search, setSearch] = useState("");

  const games = useMemo(
    () => gamesList as GameLike[],
    [gamesList]
  );

  const sourceEntries = useMemo(
    () =>
      [...entries].sort(
        (a, b) =>
          new Date(b.date).getTime() -
          new Date(a.date).getTime()
      ),
    [entries]
  );

  const filteredEntries = useMemo(() => {
    const query = normalizeKey(search);

    if (!query) return sourceEntries;

    return sourceEntries.filter((entry) =>
      normalizeKey(normalizeGameTitle(entry.gameTitle)).includes(query)
    );
  }, [search, sourceEntries]);

  const totalMinutes = useMemo(
    () =>
      sourceEntries.reduce(
        (total, entry) =>
          total + Number(entry.playedMinutes || 0),
        0
      ),
    [sourceEntries]
  );

  const uniqueDays = useMemo(
    () =>
      new Set(
        sourceEntries
          .map((entry) => getDateKey(entry.date))
          .filter(Boolean)
      ).size,
    [sourceEntries]
  );

  const differentGames = useMemo(
    () =>
      new Set(
        sourceEntries.map((entry) =>
          normalizeKey(normalizeGameTitle(entry.gameTitle))
        )
      ).size,
    [sourceEntries]
  );

  const averageMinutes =
    uniqueDays > 0 ? Math.round(totalMinutes / uniqueDays) : 0;

  const currentStreak = useMemo(
    () => calculateStreak(sourceEntries),
    [sourceEntries]
  );

  const allCompletedAchievements = useMemo(() => {
    const result: Array<
      AchievementLike & {
        gameTitle: string;
        gameSlug?: string;
      }
    > = [];

    for (const game of games) {
      for (const item of game.achievementsList || []) {
        const achievement = item as AchievementLike;

        if (!isCompletedAchievement(achievement)) continue;

        result.push({
          ...achievement,
          gameTitle: normalizeGameTitle(game.title),
          gameSlug: game.slug,
        });
      }
    }

    return result.sort((a, b) => {
      const dateA = getAchievementDate(a);
      const dateB = getAchievementDate(b);

      return (
        new Date(dateB).getTime() -
        new Date(dateA).getTime()
      );
    });
  }, [games]);

  const groupedEntries = useMemo(() => {
    const groups: Record<string, JourneyEntry[]> = {};

    for (const entry of filteredEntries) {
      const month = getMonthLabel(entry.date);
      if (!month) continue;

      if (!groups[month]) groups[month] = [];
      groups[month].push(entry);
    }

    return groups;
  }, [filteredEntries]);

  const gameTimeDistribution = useMemo(() => {
    const map = new Map<string, number>();

    for (const entry of sourceEntries) {
      const title = normalizeGameTitle(entry.gameTitle);

      map.set(
        title,
        (map.get(title) || 0) + Number(entry.playedMinutes || 0)
      );
    }

    const rows = Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([title, minutes]) => ({
        title,
        minutes,
        percent:
          totalMinutes > 0
            ? (minutes / totalMinutes) * 100
            : 0,
      }));

    return rows;
  }, [sourceEntries, totalMinutes]);

  const heroGame = useMemo(() => {
    const current = games.find(
      (game) =>
        normalizeKey(game.slug) ===
        normalizeKey(sourceEntries[0]?.gameSlug)
    );

    return current || games[0];
  }, [games, sourceEntries]);

  const heroImage = getGameCover(heroGame);

  const recentAchievementDateKeys = useMemo(
    () =>
      new Set(
        allCompletedAchievements
          .map((achievement) =>
            getDateKey(getAchievementDate(achievement))
          )
          .filter(Boolean)
      ),
    [allCompletedAchievements]
  );

  return (
    <main className="min-h-screen bg-[#050608] text-white">
      <Navbar />

      <div className="mx-auto grid w-full max-w-[1560px] grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* SIDEBAR */}
        <aside className="hidden min-h-[calc(100vh-64px)] border-r border-white/[0.08] px-5 py-6 lg:block">
          <div className="sticky top-24">
            <p className="border-l-2 border-red-500 pl-3 text-[13px] font-black text-white">
              Rumo à Conquista
            </p>

            <nav className="mt-7 space-y-1">
              {[
                ["Início", "/"],
                ["Jogos", "/jogos"],
                ["Jornada", "/jornada"],
                ["Conteúdo", "/conteudo"],
                ["Atividade", "/atividade"],
                ["Próximas Maestrias", "/proximas-maestrias"],
                ["Emblemas", "/emblemas"],
              ].map(([label, href]) => (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-bold transition ${
                    href === "/atividade"
                      ? "bg-red-500/10 text-red-300"
                      : "text-white/50 hover:bg-white/[0.03] hover:text-white"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      href === "/atividade"
                        ? "bg-red-400"
                        : "bg-white/20"
                    }`}
                  />
                  {label}
                </Link>
              ))}
            </nav>

            <div className="mt-10 border-t border-white/[0.08] pt-5">
              <p className="text-[8px] font-black uppercase tracking-[0.22em] text-white/25">
                Seu espaço
              </p>

              <p className="mt-3 text-xs font-medium leading-relaxed text-white/35">
                Acompanhe sua evolução, dias jogados e conquistas ao longo do tempo.
              </p>
            </div>
          </div>
        </aside>

        <div className="min-w-0 px-4 py-6 md:px-6 lg:px-8">
          {/* HERO */}
          <header className="relative overflow-hidden rounded-[24px] border border-white/10 bg-[#090a0d] shadow-2xl">
            {heroImage && (
              <img
                src={heroImage}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 h-full w-full object-cover opacity-35"
              />
            )}

            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(239,68,68,0.24),transparent_38%),linear-gradient(90deg,rgba(5,6,8,0.97)_0%,rgba(5,6,8,0.82)_48%,rgba(5,6,8,0.68)_100%)]" />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent_45%,rgba(0,0,0,0.35))]" />

            <div className="relative grid min-h-[270px] gap-8 p-6 md:p-8 xl:grid-cols-[1fr_auto] xl:items-end">
              <div className="max-w-[680px]">
                <p className="text-[9px] font-black uppercase tracking-[0.28em] text-red-400">
                  Sua trajetória
                </p>

                <h1 className="mt-2 text-4xl font-black tracking-tight text-white md:text-5xl">
                  ATIVIDADE
                </h1>

                <p className="mt-3 max-w-[620px] text-sm leading-relaxed text-white/55 md:text-[15px]">
                  Acompanhe seus dias de jogo, horas investidas e conquistas ao longo do tempo.
                </p>

                <div className="mt-6 flex flex-wrap items-center gap-5 border-t border-white/10 pt-4">
                  <Metric
                    label="Dias jogados"
                    value={isLoaded ? uniqueDays : "..."}
                    icon="▣"
                  />

                  <div className="hidden h-8 w-px bg-white/10 sm:block" />

                  <Metric
                    label="Tempo jogado"
                    value={isLoaded ? formatPlayedTime(totalMinutes) : "..."}
                    icon="◷"
                    accent="blue"
                  />

                  <div className="hidden h-8 w-px bg-white/10 sm:block" />

                  <Metric
                    label="Média diária"
                    value={isLoaded ? formatPlayedTime(averageMinutes) : "..."}
                    icon="↗"
                    accent="violet"
                  />

                  <div className="hidden h-8 w-px bg-white/10 sm:block" />

                  <Metric
                    label="Jogos diferentes"
                    value={isLoaded ? differentGames : "..."}
                    icon="◆"
                    accent="green"
                  />
                </div>
              </div>

              <div className="hidden xl:block">
                <div className="rounded-2xl border border-red-500/20 bg-black/35 px-5 py-4 backdrop-blur-sm">
                  <p className="text-[8px] font-black uppercase tracking-[0.18em] text-red-300">
                    Sequência atual
                  </p>
                  <div className="mt-2 flex items-end gap-2">
                    <span className="text-4xl font-black text-white">
                      {currentStreak}
                    </span>
                    <span className="pb-1 text-xs font-bold text-white/45">
                      dias
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </header>

          {/* BODY */}
          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_290px]">
            <div className="min-w-0">
              <ActivityMap entries={sourceEntries} />

              <section className="mt-5 rounded-2xl border border-white/10 bg-[#08090c]/90">
                <div className="border-b border-white/[0.08] px-3 pt-3">
                  <div className="flex items-center gap-1">
                    {(
                      [
                        ["jogos", "🎮 Jogos"],
                        ["conquistas", "🏆 Conquistas"],
                        ["reviews", "📝 Reviews"],
                      ] as [ActivityTab, string][]
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setActiveTab(value)}
                        className={`rounded-t-xl px-4 py-2.5 text-[11px] font-black transition ${
                          activeTab === value
                            ? "bg-red-500/10 text-red-300"
                            : "text-white/45 hover:text-white"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-3 p-3 md:flex-row md:items-center">
                  <div className="relative min-w-0 flex-1">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-xs text-white/25">
                      🔍
                    </span>
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Buscar por nome do jogo..."
                      className="w-full rounded-xl border border-white/10 bg-black/30 py-3 pl-10 pr-4 text-xs font-semibold text-white outline-none placeholder:text-white/25 focus:border-red-500/35"
                    />
                  </div>

                  <button
                    type="button"
                    className="shrink-0 rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3 text-[10px] font-black text-white/50 transition hover:text-white"
                  >
                    Todos os Meses ▾
                  </button>

                  <button
                    type="button"
                    className="shrink-0 rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3 text-[10px] font-black text-white/50 transition hover:text-white"
                  >
                    Todas as Plataformas ▾
                  </button>
                </div>

                {activeTab === "jogos" && (
                  <div className="px-3 pb-3">
                    {Object.entries(groupedEntries).map(
                      ([month, monthEntries]) => (
                        <section key={month} className="mt-4 first:mt-1">
                          <div className="mb-2 flex items-center justify-between">
                            <h2 className="text-[12px] font-black uppercase tracking-[0.12em] text-white/80">
                              {month}
                            </h2>
                            <span className="text-[8px] font-bold uppercase tracking-[0.16em] text-white/20">
                              {monthEntries.length} registros
                            </span>
                          </div>

                          <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black/20">
                            {monthEntries.map((entry) => {
                              const normalizedTitle = normalizeKey(
                                normalizeGameTitle(entry.gameTitle)
                              );

                              const game = games.find(
                                (item) =>
                                  normalizeKey(item.slug) ===
                                    normalizeKey(entry.gameSlug) ||
                                  normalizeKey(
                                    normalizeGameTitle(item.title)
                                  ) === normalizedTitle
                              );

                              const dayKey = getDateKey(entry.date);

                              const dayAchievements =
                                (game?.achievementsList || [])
                                  .map(
                                    (item) =>
                                      item as AchievementLike
                                  )
                                  .filter((achievement) => {
                                    if (
                                      !isCompletedAchievement(
                                        achievement
                                      )
                                    ) {
                                      return false;
                                    }

                                    return (
                                      getDateKey(
                                        getAchievementDate(
                                          achievement
                                        )
                                      ) === dayKey
                                    );
                                  });

                              return (
                                <ActivityRow
                                  key={entry.id}
                                  entry={entry}
                                  game={game}
                                  achievements={dayAchievements}
                                />
                              );
                            })}
                          </div>
                        </section>
                      )
                    )}

                    {filteredEntries.length === 0 && (
                      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
                        <p className="text-sm font-black text-white/45">
                          Nenhuma atividade encontrada.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "conquistas" && (
                  <div className="p-3">
                    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black/20">
                      {allCompletedAchievements
                        .filter((achievement) => {
                          const query = normalizeKey(search);
                          if (!query) return true;

                          return (
                            normalizeKey(
                              achievement.title
                            ).includes(query) ||
                            normalizeKey(
                              achievement.gameTitle
                            ).includes(query)
                          );
                        })
                        .slice(0, 30)
                        .map((achievement, index) => {
                          const game = games.find(
                            (item) =>
                              normalizeKey(item.slug) ===
                              normalizeKey(
                                achievement.gameSlug
                              )
                          );

                          return (
                            <article
                              key={`${achievement.title}-${index}`}
                              className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-3 last:border-b-0"
                            >
                              <div className="h-10 w-10 overflow-hidden rounded-lg border border-white/10 bg-black">
                                {getAchievementImage(
                                  achievement
                                ) ? (
                                  <img
                                    src={getAchievementImage(
                                      achievement
                                    )}
                                    alt={achievement.title || "Conquista"}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full items-center justify-center">
                                    🏆
                                  </div>
                                )}
                              </div>

                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[12px] font-black text-white">
                                  {achievement.title ||
                                    "Conquista"}
                                </p>
                                <p className="mt-1 truncate text-[9px] text-white/35">
                                  {achievement.gameTitle}
                                  {game
                                    ? ` • ${getGamePlatform(game)}`
                                    : ""}
                                </p>
                              </div>

                              <span className="text-[9px] font-bold text-white/35">
                                {getDateKey(
                                  getAchievementDate(
                                    achievement
                                  )
                                )}
                              </span>
                            </article>
                          );
                        })}

                      {allCompletedAchievements.length === 0 && (
                        <div className="p-8 text-center text-sm font-bold text-white/35">
                          Nenhuma conquista concluída encontrada.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === "reviews" && (
                  <div className="p-3">
                    <div className="rounded-xl border border-white/[0.08] bg-black/20 p-8 text-center">
                      <p className="text-sm font-black text-white/50">
                        As reviews aparecerão aqui.
                      </p>
                      <p className="mt-2 text-[10px] text-white/25">
                        Esta área visual já está preparada para receber os dados de reviews do site.
                      </p>
                    </div>
                  </div>
                )}
              </section>
            </div>

            {/* RIGHT SIDEBAR */}
            <aside className="space-y-5">
              <section className="rounded-2xl border border-white/10 bg-[#08090c]/90 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-black text-white">
                    Resumo da atividade
                  </h2>
                  <span className="text-red-400">◉</span>
                </div>

                <div className="mt-4 space-y-3">
                  {[
                    ["🔥", "Sequência atual", `${currentStreak} dias`, "red"],
                    ["▣", "Dias jogados", `${uniqueDays}`, "violet"],
                    ["◷", "Horas jogadas", formatPlayedTime(totalMinutes), "blue"],
                    ["🏆", "Conquistas desbloqueadas", `${allCompletedAchievements.length}`, "red"],
                    ["↗", "Média diária", formatPlayedTime(averageMinutes), "green"],
                    ["◆", "Jogos diferentes", `${differentGames}`, "violet"],
                  ].map(([icon, label, value, tone]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-3 last:border-b-0 last:pb-0"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <div
                          className={`flex h-8 w-8 items-center justify-center rounded-lg border text-xs ${
                            tone === "violet"
                              ? "border-violet-500/20 bg-violet-500/10 text-violet-300"
                              : tone === "blue"
                              ? "border-sky-500/20 bg-sky-500/10 text-sky-300"
                              : tone === "green"
                              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                              : "border-red-500/20 bg-red-500/10 text-red-300"
                          }`}
                        >
                          {icon}
                        </div>

                        <span className="truncate text-[10px] font-medium text-white/45">
                          {label}
                        </span>
                      </div>

                      <strong className="shrink-0 text-[12px] font-black text-white">
                        {value}
                      </strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-white/10 bg-[#08090c]/90 p-4">
                <h2 className="text-sm font-black text-white">
                  Distribuição de tempo
                </h2>

                <div className="mt-4 flex items-center gap-4">
                  <div
                    className="relative h-32 w-32 shrink-0 rounded-full"
                    style={{
                      background:
                        gameTimeDistribution.length > 0
                          ? (() => {
                              let start = 0;
                              const colors = [
                                "#ef4444",
                                "#f87171",
                                "#fb7185",
                                "#94a3b8",
                                "#64748b",
                              ];

                              const stops = gameTimeDistribution
                                .slice(0, 5)
                                .map((item, index) => {
                                  const end =
                                    start + item.percent;
                                  const stop = `${colors[index % colors.length]} ${start}% ${end}%`;
                                  start = end;
                                  return stop;
                                });

                              return `conic-gradient(${stops.join(", ")})`;
                            })()
                          : "conic-gradient(#27272a 0 100%)",
                    }}
                  >
                    <div className="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-[#08090c] text-center">
                      <span className="text-2xl font-black text-white">
                        {Math.round(totalMinutes / 60)}h
                      </span>
                      <span className="text-[8px] font-black uppercase tracking-[0.14em] text-white/25">
                        total
                      </span>
                    </div>
                  </div>

                  <div className="min-w-0 flex-1 space-y-2">
                    {gameTimeDistribution
                      .slice(0, 5)
                      .map((item, index) => {
                        const colors = [
                          "bg-red-500",
                          "bg-red-400",
                          "bg-rose-400",
                          "bg-slate-400",
                          "bg-slate-500",
                        ];

                        return (
                          <div key={item.title}>
                            <div className="flex items-center gap-2">
                              <span
                                className={`h-2 w-2 shrink-0 rounded-full ${colors[index]}`}
                              />
                              <p className="truncate text-[9px] font-bold text-white/55">
                                {item.title}
                              </p>
                            </div>

                            <p className="ml-4 mt-0.5 text-[8px] font-medium text-white/25">
                              {formatPlayedTime(item.minutes)} •{" "}
                              {Math.round(item.percent)}%
                            </p>
                          </div>
                        );
                      })}

                    {gameTimeDistribution.length === 0 && (
                      <p className="text-[9px] text-white/30">
                        Ainda não há tempo registrado.
                      </p>
                    )}
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-white/10 bg-[#08090c]/90 p-4">
                <h2 className="text-sm font-black text-white">
                  Atividade recente
                </h2>

                <div className="mt-3 space-y-2">
                  {sourceEntries.slice(0, 5).map((entry) => (
                    <div
                      key={`recent-${entry.id}`}
                      className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.015] p-2.5"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-red-500/15 bg-red-500/10 text-[10px] text-red-300">
                        {recentAchievementDateKeys.has(
                          getDateKey(entry.date)
                        )
                          ? "🏆"
                          : "🎮"}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[10px] font-black text-white/65">
                          {normalizeGameTitle(entry.gameTitle)}
                        </p>
                        <p className="mt-0.5 text-[8px] text-white/25">
                          {getDateKey(entry.date)}
                        </p>
                      </div>

                      <span className="text-[9px] font-black text-white/45">
                        {formatPlayedTime(entry.playedMinutes)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}

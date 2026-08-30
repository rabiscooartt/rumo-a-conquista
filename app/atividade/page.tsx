"use client";

import Link from "next/link";
import {
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Navbar from "@/components/Navbar";
import { useSiteGames } from "@/lib/useSiteGames";
import {
  type JourneyEntry,
  useJourneyEntries,
} from "@/lib/useJourneyEntries";

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
};

function formatPlayedTime(minutes = 0) {
  const safe = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;

  if (hours <= 0) return `${mins}min`;
  if (mins <= 0) return `${hours}h`;
  return `${hours}h ${mins}min`;
}

function normalizeKey(value?: string) {
  return (value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function normalizeGameTitle(title?: string) {
  if (!title) return "Sem jogo";

  return title
    .replace(/^Rumo\s*[àáa]\s*Conquista\s*:\s*/i, "")
    .trim();
}

function getDateKey(value?: string) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toISOString().slice(0, 10);
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

function getGameCover(game?: GameLike, slug?: string) {
  return (
    game?.cardImage ||
    game?.image ||
    (slug ? `/images/games/${slug}/cover.jpg` : "")
  );
}

function getGamePlatform(game?: GameLike) {
  if (!game) return "";
  if (game.platform) return game.platform;
  if (game.console) return game.console;

  if (Array.isArray(game.platforms)) {
    return game.platforms.join(" • ");
  }

  return "";
}

function calculateStreak(entries: JourneyEntry[]) {
  const dates = Array.from(
    new Set(
      entries
        .map((entry) => getDateKey(entry.date))
        .filter(Boolean)
    )
  ).sort((a, b) => b.localeCompare(a));

  if (!dates.length) return 0;

  let streak = 1;

  for (let index = 0; index < dates.length - 1; index += 1) {
    const current = new Date(`${dates[index]}T12:00:00`);
    const previous = new Date(`${dates[index + 1]}T12:00:00`);

    const diff = Math.round(
      (current.getTime() - previous.getTime()) /
        (1000 * 60 * 60 * 24)
    );

    if (diff !== 1) break;
    streak += 1;
  }

  return streak;
}

/* ---------- ÍCONES ---------- */

function SvgIcon({
  children,
  className = "h-4 w-4",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function IconHome(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <path
        d="M3.5 10.5L12 3.5L20.5 10.5V20H14.8V14H9.2V20H3.5V10.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </SvgIcon>
  );
}

function IconGamepad(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <path
        d="M7.2 8.5H16.8C19.2 8.5 20.5 10.7 20.8 13.4L21.3 17.2C21.6 19.5 18.8 20.2 17.4 18.5L15.4 16H8.6L6.6 18.5C5.2 20.2 2.4 19.5 2.7 17.2L3.2 13.4C3.5 10.7 4.8 8.5 7.2 8.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M7 11V15M5 13H9M15.5 12.5H15.51M18 15H18.01"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </SvgIcon>
  );
}

function IconClock(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <circle
        cx="12"
        cy="12"
        r="8.5"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M12 7.5V12L15.5 14"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </SvgIcon>
  );
}

function IconCalendar(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <rect
        x="3.5"
        y="5"
        width="17"
        height="15.5"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M7.5 3.5V7M16.5 3.5V7M3.5 9.5H20.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </SvgIcon>
  );
}

function IconTrophy(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <path
        d="M8 4H16V9.5C16 12.4 14.4 14.5 12 14.5C9.6 14.5 8 12.4 8 9.5V4Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M8 6H5.5C4.7 6 4 6.7 4 7.5V8.5C4 10.7 5.8 12.5 8 12.5M16 6H18.5C19.3 6 20 6.7 20 7.5V8.5C20 10.7 18.2 12.5 16 12.5M12 14.5V18.5M8.5 20H15.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </SvgIcon>
  );
}

function IconTrend(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <path
        d="M4 16L9 11L13 15L20 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15.5 7H20V11.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </SvgIcon>
  );
}

function IconTarget(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <circle
        cx="12"
        cy="12"
        r="8.5"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <circle
        cx="12"
        cy="12"
        r="4.5"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </SvgIcon>
  );
}

function IconFlame(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <path
        d="M13.5 4.5C13.9 7.3 11.8 8.3 10.7 10.1C9.6 11.9 10.1 14 12 14C13.8 14 15 12.8 14.7 11.1C17.3 13 18.5 15 18.5 17C18.5 20.1 15.9 22 12.2 22C8.2 22 5.5 19.7 5.5 16C5.5 12.8 7.6 10.5 9.8 8.2C10.6 7.3 11.1 6.1 11.2 4C12.1 4.1 12.9 4.3 13.5 4.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </SvgIcon>
  );
}

function IconSearch(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <circle
        cx="10.5"
        cy="10.5"
        r="6.5"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M15.5 15.5L20 20"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </SvgIcon>
  );
}

function IconFile(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <rect
        x="5"
        y="3.5"
        width="14"
        height="17"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M8.5 8H15.5M8.5 11.5H15.5M8.5 15H12.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </SvgIcon>
  );
}

/* ---------- MAPA ---------- */

function ActivityMap({ entries }: { entries: JourneyEntry[] }) {
  const activityByDay = useMemo(() => {
    const map = new Map<string, number>();

    for (const entry of entries) {
      const key = getDateKey(entry.date);
      if (!key) continue;

      map.set(
        key,
        (map.get(key) || 0) +
          Number(entry.playedMinutes || 0)
      );
    }

    return map;
  }, [entries]);

  const days = useMemo(() => {
    const result: string[] = [];
    const today = new Date();

    for (let index = 59; index >= 0; index -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - index);
      result.push(date.toISOString().slice(0, 10));
    }

    return result;
  }, []);

  const weekdays = [
    "Seg",
    "Ter",
    "Qua",
    "Qui",
    "Sex",
    "Sáb",
    "Dom",
  ];

  const getIntensity = (minutes: number) => {
    if (minutes <= 0) return "bg-[#181a20]";
    if (minutes < 60) return "bg-red-950";
    if (minutes < 180) return "bg-red-800";
    if (minutes < 300) return "bg-red-600";
    return "bg-red-500";
  };

  const monthGroups = useMemo(() => {
    const groups: Array<{
      label: string;
      days: string[];
      isPartial: boolean;
    }> = [];

    for (const day of days) {
      const date = new Date(`${day}T12:00:00`);
      const label = date
        .toLocaleDateString("pt-BR", {
          month: "short",
        })
        .replace(".", "")
        .toUpperCase();

      const current = groups[groups.length - 1];

      if (!current || current.label !== label) {
        groups.push({
          label,
          days: [day],
          isPartial: false,
        });
      } else {
        current.days.push(day);
      }
    }

    // O primeiro mês dos 60 dias pode ser apenas um recorte parcial.
    if (groups.length > 0) {
      groups[0].isPartial = true;
    }

    return groups;
  }, [days]);

  const visibleMonthGroups = useMemo(
    () =>
      monthGroups
        .filter((group) => !group.isPartial)
        .slice(-3),
    [monthGroups]
  );

  const monthEndKeys = useMemo(() => {
    const keys = new Set<string>();

    monthGroups.forEach((group, index) => {
      if (group.isPartial) return;
      if (index === monthGroups.length - 1) return;

      const lastDay =
        group.days[group.days.length - 1];

      if (lastDay) keys.add(lastDay);
    });

    return keys;
  }, [monthGroups]);

  return (
    <section className="rounded-[14px] border border-white/[0.10] bg-[#090b0f] p-4 md:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[18px] font-black tracking-tight text-white">
              Mapa de atividade
            </h2>

            <span
              title="Cada quadrado representa um dia"
              className="flex h-[17px] w-[17px] items-center justify-center rounded-full border border-white/20 text-[9px] font-black text-white/40"
            >
              i
            </span>
          </div>

          <p className="mt-1 text-[10px] font-medium text-white/40">
            Cada quadrado representa um dia. Quanto mais escuro, mais tempo jogado.
          </p>
        </div>

        <button
          type="button"
          className="shrink-0 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[9px] font-black text-white/45"
        >
          Últimos 60 dias⌄
        </button>
      </div>

      <div className="mt-5 w-full">
        <div className="w-full">
          {/* MESES:
              o primeiro mês parcial fica sem rótulo;
              os meses válidos ficam destacados acima do seu trecho. */}
          <div className="mb-1 flex items-end pl-[42px]">
            {visibleMonthGroups.map((group, index) => {
              const isLast =
                index === visibleMonthGroups.length - 1;

              return (
                <div
                  key={`${group.label}-${index}`}
                  className={`shrink-0 whitespace-nowrap text-[9px] font-black tracking-[0.10em] text-white/30 ${
                    index > 0 ? "ml-[7px]" : ""
                  }`}
                  style={{
                    width: `${
                      group.days.length * 15 +
                      (isLast ? 0 : 7)
                    }px`,
                  }}
                >
                  {group.label}
                </div>
              );
            })}
          </div>

          <div className="space-y-[3px]">
            {weekdays.map((weekday, rowIndex) => (
              <div
                key={weekday}
                className="flex items-center"
              >
                <div className="w-[42px] shrink-0 pr-2 text-right text-[9px] font-semibold leading-none text-white/50">
                  {weekday}
                </div>

                <div className="flex min-w-0 flex-1 items-center">
                  {days.map((day) => {
                    const date = new Date(`${day}T12:00:00`);
                    const actualRow =
                      (date.getDay() + 6) % 7;

                    const minutes =
                      actualRow === rowIndex
                        ? activityByDay.get(day) || 0
                        : 0;

                    return (
                      <div
                        key={`${day}-${weekday}`}
                        title={
                          actualRow === rowIndex
                            ? `${day} • ${formatPlayedTime(minutes)}`
                            : undefined
                        }
                        className={`h-[14px] w-[14px] shrink-0 rounded-[2px] ${getIntensity(
                          minutes
                        )} ${
                          monthEndKeys.has(day)
                            ? "mr-[7px]"
                            : "mr-[2px]"
                        }`}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-1.5 text-[8px] font-bold text-white/30">
        <span>Menos tempo</span>

        <span className="h-2.5 w-2.5 rounded-[2px] bg-[#181a20]" />
        <span className="h-2.5 w-2.5 rounded-[2px] bg-red-950" />
        <span className="h-2.5 w-2.5 rounded-[2px] bg-red-800" />
        <span className="h-2.5 w-2.5 rounded-[2px] bg-red-600" />
        <span className="h-2.5 w-2.5 rounded-[2px] bg-red-500" />

        <span>Mais tempo</span>
      </div>
    </section>
  );
}

function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  tone: "red" | "blue" | "violet" | "green";
}) {
  const styles = {
    red: "border-red-500/20 bg-red-500/10 text-red-400",
    blue: "border-sky-500/20 bg-sky-500/10 text-sky-400",
    violet: "border-violet-500/20 bg-violet-500/10 text-violet-400",
    green:
      "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  } as const;

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${styles[tone]}`}
      >
        {icon}
      </div>

      <div className="min-w-0">
        <p className="text-[8px] font-black uppercase tracking-[0.15em] text-white/35">
          {label}
        </p>

        <p className="mt-0.5 truncate text-[17px] font-black text-white">
          {value}
        </p>
      </div>
    </div>
  );
}

/* ---------- ATIVIDADE ---------- */

function ActivityRow({
  entry,
  game,
}: {
  entry: JourneyEntry;
  game?: GameLike;
}) {
  const date = new Date(`${entry.date}T12:00:00`);
  const cover = getGameCover(game, entry.gameSlug);
  const platform = getGamePlatform(game);

  return (
    <article className="grid grid-cols-[54px_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/[0.07] px-3 py-3.5 last:border-b-0 md:grid-cols-[70px_minmax(0,1fr)_120px] md:px-4">
      <div>
        <p className="text-[25px] font-black leading-none text-white md:text-[27px]">
          {date.getDate()}
        </p>

        <p className="mt-1 text-[9px] font-black uppercase tracking-[0.12em] text-red-400">
          {getMonthShort(entry.date)}
        </p>
      </div>

      <div className="flex min-w-0 items-center gap-3">
        <div className="h-[78px] w-[60px] shrink-0 overflow-hidden rounded-[7px] border border-white/10 bg-black shadow-lg">
          {cover ? (
            <img
              src={cover}
              alt={normalizeGameTitle(entry.gameTitle)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[8px] font-black text-white/25">
              RC
            </div>
          )}
        </div>

        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-black text-white md:text-[16px]">
            {normalizeGameTitle(entry.gameTitle)}
          </h3>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-medium text-white/45 md:text-[11px]">
            <span>
              {entry.weekDay ||
                date.toLocaleDateString("pt-BR", {
                  weekday: "long",
                })}
            </span>

            {platform && (
              <>
                <span className="text-white/15">•</span>
                <span>{platform}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="text-right">
        <p className="text-[16px] font-black leading-none text-white md:text-[17px]">
          {formatPlayedTime(entry.playedMinutes)}
        </p>

        <p className="mt-1 text-[8px] font-black uppercase tracking-[0.12em] text-white/25">
          Tempo jogado
        </p>
      </div>
    </article>
  );
}

export default function AtividadePage() {
  const { entries, isLoaded } = useJourneyEntries();
  const { gamesList } = useSiteGames();

  const [activeTab, setActiveTab] =
    useState<ActivityTab>("jogos");
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
          normalizeKey(
            normalizeGameTitle(entry.gameTitle)
          )
        )
      ).size,
    [sourceEntries]
  );

  const averageMinutes =
    uniqueDays > 0
      ? Math.round(totalMinutes / uniqueDays)
      : 0;

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

        if (!isCompletedAchievement(achievement)) {
          continue;
        }

        result.push({
          ...achievement,
          gameTitle: normalizeGameTitle(game.title),
          gameSlug: game.slug,
        });
      }
    }

    return result.sort(
      (a, b) =>
        new Date(getAchievementDate(b)).getTime() -
        new Date(getAchievementDate(a)).getTime()
    );
  }, [games]);

  const filteredEntries = useMemo(() => {
    const query = normalizeKey(search);

    if (!query) return sourceEntries;

    return sourceEntries.filter((entry) =>
      normalizeKey(
        normalizeGameTitle(entry.gameTitle)
      ).includes(query)
    );
  }, [search, sourceEntries]);

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

  const gameDistribution = useMemo(() => {
    const map = new Map<string, number>();

    for (const entry of sourceEntries) {
      const title = normalizeGameTitle(entry.gameTitle);

      map.set(
        title,
        (map.get(title) || 0) +
          Number(entry.playedMinutes || 0)
      );
    }

    return Array.from(map.entries())
      .map(([title, minutes]) => ({
        title,
        minutes,
        percent:
          totalMinutes > 0
            ? (minutes / totalMinutes) * 100
            : 0,
      }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [sourceEntries, totalMinutes]);

  return (
    <main className="min-h-screen bg-[#050608] text-white">
      <Navbar />

      <div className="mx-auto grid w-full max-w-[1360px] grid-cols-1 lg:grid-cols-[185px_minmax(0,1fr)]">
        {/* SIDEBAR */}
        <aside className="hidden min-h-[calc(100vh-56px)] border-r border-white/[0.08] px-6 py-7 lg:block">
          <div className="sticky top-20 flex min-h-[calc(100vh-100px)] flex-col">
            <div>
              <div className="border-l-2 border-red-500 pl-3">
                <p className="text-[17px] font-black text-white">
                  Rumo à Conquista
                </p>
              </div>

              <nav className="mt-7 space-y-1">
                {[
                  ["Início", "/", <IconHome />],
                  ["Jogos", "/jogos", <IconGamepad />],
                  ["Sagas", "/sagas", <IconTarget />],
                  ["Backlog", "/backlog", <IconFile />],
                  ["Conteúdo", "/conteudo", <IconFile />],
                  ["Atividade", "/atividade", <IconTrend />],
                ].map(([label, href, icon]) => (
                  <Link
                    key={String(href)}
                    href={String(href)}
                    className={`flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-[11px] font-bold transition ${
                      href === "/atividade"
                        ? "bg-red-500/10 text-red-300"
                        : "text-white/50 hover:bg-white/[0.03] hover:text-white"
                    }`}
                  >
                    <span>{icon}</span>
                    {label}
                  </Link>
                ))}
              </nav>

              <div className="mt-8 border-t border-white/[0.08] pt-6">
                <p className="text-[7px] font-black uppercase tracking-[0.22em] text-white/25">
                  Seu espaço
                </p>

                <p className="mt-3 text-[11px] font-medium leading-relaxed text-white/38">
                  Acompanhe sua evolução, dias jogados e conquistas ao longo do tempo.
                </p>
              </div>
            </div>

            <div className="mt-auto space-y-2 pt-8">
              <Link
                href="/configuracoes"
                className="flex items-center gap-3 px-2.5 py-2 text-[11px] font-bold text-white/50"
              >
                <IconTarget className="h-4 w-4" />
                Configurações
              </Link>

              <button
                type="button"
                className="flex items-center gap-3 px-2.5 py-2 text-[11px] font-bold text-white/50"
              >
                <span className="text-sm">↪</span>
                Sair
              </button>

              <button
                type="button"
                className="mt-2 w-full rounded-lg bg-red-600 px-3 py-3 text-[10px] font-black text-white transition hover:bg-red-500"
              >
                Entrar
              </button>
            </div>
          </div>
        </aside>

        {/* MAIN */}
        <div className="min-w-0 px-4 py-5 md:px-5 lg:px-5">
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            {/* COLUNA PRINCIPAL */}
            <div className="min-w-0">
          {/* HERO */}
          <header className="relative overflow-hidden rounded-[16px] border border-white/10 bg-[#090b10]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_58%_15%,rgba(255,35,45,0.55),transparent_30%),radial-gradient(circle_at_20%_80%,rgba(255,0,30,0.22),transparent_45%)]" />

            <div className="absolute inset-y-0 right-[23%] flex items-end opacity-[0.10]">
              <IconTrophy className="h-[190px] w-[190px] text-red-300" />
            </div>

            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(4,5,8,0.98)_0%,rgba(4,5,8,0.78)_48%,rgba(4,5,8,0.44)_100%)]" />

            <div className="relative flex min-h-[225px] flex-col justify-end p-7 md:p-8">
              <div className="max-w-[650px]">
                <p className="text-[9px] font-black uppercase tracking-[0.28em] text-red-400">
                  Sua trajetória
                </p>

                <h1 className="mt-1 text-[48px] font-black leading-none tracking-tight text-white md:text-[56px]">
                  ATIVIDADE
                </h1>

                <p className="mt-3 max-w-[560px] text-[14px] font-medium leading-relaxed text-white/55 md:text-[15px]">
                  Acompanhe seus dias de jogo, horas investidas e conquistas ao longo do tempo.
                </p>

                <div className="mt-5 flex flex-wrap items-center gap-5 border-t border-white/10 pt-4">
                  <Metric
                    icon={
                      <IconCalendar className="h-4 w-4" />
                    }
                    label="Dias jogados"
                    value={isLoaded ? uniqueDays : "..."}
                    tone="red"
                  />

                  <div className="hidden h-8 w-px bg-white/10 sm:block" />

                  <Metric
                    icon={
                      <IconClock className="h-4 w-4" />
                    }
                    label="Tempo jogado"
                    value={
                      isLoaded
                        ? formatPlayedTime(totalMinutes)
                        : "..."
                    }
                    tone="blue"
                  />

                  <div className="hidden h-8 w-px bg-white/10 sm:block" />

                  <Metric
                    icon={
                      <IconTrend className="h-4 w-4" />
                    }
                    label="Média por dia"
                    value={
                      isLoaded
                        ? formatPlayedTime(averageMinutes)
                        : "..."
                    }
                    tone="violet"
                  />

                  <div className="hidden h-8 w-px bg-white/10 sm:block" />

                  <Metric
                    icon={
                      <IconGamepad className="h-4 w-4" />
                    }
                    label="Jogos"
                    value={isLoaded ? differentGames : "..."}
                    tone="green"
                  />
                </div>
              </div>

              <div className="absolute bottom-6 right-5 hidden rounded-xl border border-red-500/25 bg-black/30 px-5 py-3 backdrop-blur-sm md:block">
                <p className="text-[7px] font-black uppercase tracking-[0.18em] text-red-300">
                  Sequência atual
                </p>

                <div className="mt-1 flex items-end gap-2">
                  <span className="text-3xl font-black text-white">
                    {currentStreak}
                  </span>
                  <span className="pb-1 text-[10px] font-bold text-white/40">
                    dias
                  </span>
                </div>
              </div>
            </div>
          </header>

          {/* MAPA DE ATIVIDADE — ACIMA DO LAYOUT PRINCIPAL */}
          <div className="mt-4">
            <ActivityMap entries={sourceEntries} />
          </div>

              <div className="mt-4">
              <section className="rounded-[14px] border border-white/[0.10] bg-[#090b0f]">
                <div className="border-b border-white/[0.08] px-3 pt-3">
                  <div className="flex items-center gap-1">
                    {(
                      [
                        ["jogos", "Jogos"],
                        ["conquistas", "Conquistas"],
                        ["reviews", "Reviews"],
                      ] as [ActivityTab, string][]
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() =>
                          setActiveTab(value)
                        }
                        className={`inline-flex items-center gap-1.5 rounded-t-lg px-4 py-3 text-[11px] font-black transition ${
                          activeTab === value
                            ? "bg-red-500/10 text-red-300"
                            : "text-white/40 hover:text-white"
                        }`}
                      >
                        {value === "jogos" ? (
                          <IconGamepad className="h-3.5 w-3.5" />
                        ) : value === "conquistas" ? (
                          <IconTrophy className="h-3.5 w-3.5" />
                        ) : (
                          <IconFile className="h-3.5 w-3.5" />
                        )}
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-2.5 p-3 md:flex-row">
                  <div className="relative min-w-0 flex-1">
                    <IconSearch className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />

                    <input
                      value={search}
                      onChange={(event) =>
                        setSearch(event.target.value)
                      }
                      placeholder="Buscar por nome do jogo..."
                      className="w-full rounded-xl border border-white/10 bg-black/25 py-3 pl-10 pr-4 text-[10px] font-semibold text-white outline-none placeholder:text-white/25 focus:border-red-500/35"
                    />
                  </div>

                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-[10px] font-black text-white/45"
                  >
                    <IconCalendar className="h-3.5 w-3.5" />
                    Todos os Meses ▾
                  </button>

                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-[10px] font-black text-white/45"
                  >
                    <IconGamepad className="h-3.5 w-3.5" />
                    Todas as Plataformas ▾
                  </button>
                </div>

                {activeTab === "jogos" && (
                  <div className="px-3 pb-3">
                    <p className="mb-2 px-1 text-[11px] font-black uppercase tracking-[0.16em] text-white/55">
                      Atividades recentes
                    </p>

                    {Object.entries(groupedEntries).map(
                      ([month, monthEntries]) => (
                        <section
                          key={month}
                          className="mt-4"
                        >
                          <div className="mb-2 flex items-center justify-between px-1">
                            <h2 className="text-[11px] font-black uppercase tracking-[0.12em] text-white/75">
                              {month}
                            </h2>

                            <span className="text-[8px] font-black uppercase tracking-[0.14em] text-white/25">
                              {monthEntries.length} registros
                            </span>
                          </div>

                          <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black/20">
                            {monthEntries.map((entry) => {
                              const titleKey = normalizeKey(
                                normalizeGameTitle(
                                  entry.gameTitle
                                )
                              );

                              const game = games.find(
                                (item) =>
                                  normalizeKey(item.slug) ===
                                    normalizeKey(
                                      entry.gameSlug
                                    ) ||
                                  normalizeKey(
                                    normalizeGameTitle(
                                      item.title
                                    )
                                  ) === titleKey
                              );

                              return (
                                <ActivityRow
                                  key={entry.id}
                                  entry={entry}
                                  game={game}
                                />
                              );
                            })}
                          </div>
                        </section>
                      )
                    )}

                    {filteredEntries.length === 0 && (
                      <div className="rounded-xl border border-white/10 p-10 text-center text-[11px] font-bold text-white/35">
                        Nenhuma atividade encontrada.
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "conquistas" && (
                  <div className="p-3">
                    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black/20">
                      {allCompletedAchievements
                        .filter((achievement) => {
                          const query =
                            normalizeKey(search);

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
                        .slice(0, 40)
                        .map((achievement, index) => (
                          <article
                            key={`${achievement.title}-${index}`}
                            className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-3 last:border-b-0"
                          >
                            <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black">
                              {getAchievementImage(
                                achievement
                              ) ? (
                                <img
                                  src={getAchievementImage(
                                    achievement
                                  )}
                                  alt={
                                    achievement.title ||
                                    "Conquista"
                                  }
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full items-center justify-center text-white/40">
                                  <IconTrophy className="h-4 w-4" />
                                </div>
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-black text-white">
                                {achievement.title ||
                                  "Conquista"}
                              </p>

                              <p className="mt-1 truncate text-[10px] text-white/40">
                                {achievement.gameTitle}
                              </p>
                            </div>

                            <span className="text-[8px] font-bold text-white/25">
                              {getDateKey(
                                getAchievementDate(
                                  achievement
                                )
                              )}
                            </span>
                          </article>
                        ))}
                    </div>
                  </div>
                )}

                {activeTab === "reviews" && (
                  <div className="p-3">
                    <div className="rounded-xl border border-white/[0.08] p-10 text-center">
                      <IconFile className="mx-auto h-6 w-6 text-white/25" />
                      <p className="mt-3 text-[11px] font-black text-white/50">
                        Reviews
                      </p>
                      <p className="mt-1 text-[9px] text-white/25">
                        Área preparada para os dados de reviews.
                      </p>
                    </div>
                  </div>
                )}
              </section>
              </div>
            </div>

            {/* SIDEBAR DIREITA */}
{/* RIGHT */}
            <aside className="space-y-3 xl:sticky xl:top-20">
              <section className="rounded-[14px] border border-white/[0.10] bg-[#090b0f] p-3.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-[14px] font-black uppercase text-white/90">
                    Resumo da atividade
                  </h2>

                  <IconFlame className="h-4 w-4 text-red-500" />
                </div>

                <div className="mt-3 space-y-3">
                  {[
                    [
                      <IconFlame className="h-4 w-4" />,
                      "Sequência atual",
                      `${currentStreak} dias`,
                      "red",
                    ],
                    [
                      <IconCalendar className="h-4 w-4" />,
                      "Dias jogados",
                      `${uniqueDays}`,
                      "violet",
                    ],
                    [
                      <IconClock className="h-4 w-4" />,
                      "Horas jogadas",
                      formatPlayedTime(totalMinutes),
                      "blue",
                    ],
                    [
                      <IconTrophy className="h-4 w-4" />,
                      "Conquistas desbloqueadas",
                      `${allCompletedAchievements.length}`,
                      "red",
                    ],
                    [
                      <IconTrend className="h-4 w-4" />,
                      "Média diária",
                      formatPlayedTime(averageMinutes),
                      "green",
                    ],
                    [
                      <IconTarget className="h-4 w-4" />,
                      "Jogos diferentes",
                      `${differentGames}`,
                      "violet",
                    ],
                  ].map(([icon, label, value, tone]) => (
                    <div
                      key={String(label)}
                      className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-3 last:border-b-0 last:pb-0"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <div
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
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

                      <strong className="shrink-0 text-[11px] font-black text-white">
                        {value}
                      </strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[14px] border border-white/[0.10] bg-[#090b0f] p-3.5">
                <h2 className="text-[14px] font-black uppercase text-white/90">
                  Distribuição de tempo por jogo
                </h2>

                <div className="mt-4 flex items-center gap-4">
                  <div
                    className="relative h-32 w-32 shrink-0 rounded-full"
                    style={{
                      background:
                        gameDistribution.length > 0
                          ? (() => {
                              const palette = [
                                "#ef2432",
                                "#a92b83",
                                "#5e70e8",
                                "#7f42a8",
                                "#8b5cf6",
                              ];

                              let start = 0;

                              return `conic-gradient(${gameDistribution
                                .slice(0, 5)
                                .map((item, index) => {
                                  const end =
                                    start + item.percent;
                                  const result = `${
                                    palette[
                                      index %
                                        palette.length
                                    ]
                                  } ${start}% ${end}%`;
                                  start = end;
                                  return result;
                                })
                                .join(", ")})`;
                            })()
                          : "conic-gradient(#24262d 0 100%)",
                    }}
                  >
                    <div className="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-[#090b0f]">
                      <span className="text-[23px] font-black">
                        {Math.round(totalMinutes / 60)}h
                      </span>
                      <span className="text-[7px] font-black uppercase tracking-[0.16em] text-white/25">
                        total
                      </span>
                    </div>
                  </div>

                  <div className="min-w-0 flex-1 space-y-2.5">
                    {gameDistribution
                      .slice(0, 5)
                      .map((item, index) => (
                        <div key={item.title}>
                          <div className="flex items-center gap-2">
                            <span
                              className={`h-2 w-2 shrink-0 rounded-full ${
                                [
                                  "bg-red-500",
                                  "bg-pink-500",
                                  "bg-indigo-400",
                                  "bg-violet-500",
                                  "bg-purple-500",
                                ][index] ||
                                "bg-white/30"
                              }`}
                            />

                            <p className="truncate text-[8px] font-bold text-white/55">
                              {item.title}
                            </p>
                          </div>

                          <p className="ml-4 mt-0.5 text-[7px] text-white/25">
                            {formatPlayedTime(item.minutes)} (
                            {Math.round(item.percent)}
                            %)
                          </p>
                        </div>
                      ))}
                  </div>
                </div>

                <div className="mt-4 flex items-start gap-2 border-t border-white/[0.07] pt-3">
                  <IconTarget className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                  <p className="text-[8px] leading-relaxed text-white/30">
                    Os dados são atualizados automaticamente conforme você registra suas sessões de jogo.
                  </p>
                </div>
              </section>

              <section className="rounded-[14px] border border-white/[0.10] bg-[#090b0f] p-3.5">
                <h2 className="text-[14px] font-black uppercase text-white/90">
                  Atividade recente
                </h2>

                <div className="mt-3 space-y-2">
                  {sourceEntries.slice(0, 5).map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.01] p-2"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-red-500/15 bg-red-500/10 text-red-300">
                        <IconGamepad className="h-3.5 w-3.5" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[8px] font-black text-white/60">
                          {normalizeGameTitle(
                            entry.gameTitle
                          )}
                        </p>
                        <p className="mt-0.5 text-[7px] text-white/25">
                          {getDateKey(entry.date)}
                        </p>
                      </div>

                      <span className="text-[7px] font-black text-white/35">
                        {formatPlayedTime(
                          entry.playedMinutes
                        )}
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

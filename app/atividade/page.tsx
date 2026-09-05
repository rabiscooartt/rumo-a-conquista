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
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
    </SvgIcon>
  );
}


function IconMetricDays(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <rect
        x="4.5"
        y="5.5"
        width="15"
        height="14"
        rx="2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      <path
        d="M8 3.5V7M16 3.5V7M4.8 9.2H19.2"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M8.5 13H8.51M12 13H12.01M15.5 13H15.51M8.5 16.5H8.51M12 16.5H12.01"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </SvgIcon>
  );
}

function IconMetricTime(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <circle
        cx="12"
        cy="12"
        r="8.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      <path
        d="M12 7.4V12L15.2 14"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    </SvgIcon>
  );
}

function IconMetricAverage(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <path
        d="M4.8 18.4H19.2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path
        d="M5.5 15.4L9.3 11.8L12.2 14.1L18.4 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15.5 7H18.4V9.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </SvgIcon>
  );
}

function IconMetricGames(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <path
        d="M6.7 8.2H17.3C19.1 8.2 20.2 10 20.45 12L20.9 15.4C21.2 17.7 18.6 19.1 17.25 17.15L15.65 14.9H8.35L6.75 17.15C5.4 19.1 2.8 17.7 3.1 15.4L3.55 12C3.8 10 4.9 8.2 6.7 8.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="M7.1 11.5V15M5.35 13.25H8.85"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="15.8" cy="11.8" r="1.15" fill="currentColor" />
      <circle cx="18" cy="13.9" r="1.15" fill="currentColor" />
    </SvgIcon>
  );
}

function IconGamepad(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <path
        d="M7.2 8.5H16.8C19.2 8.5 20.5 10.7 20.8 13.4L21.3 17.2C21.6 19.5 18.8 20.2 17.4 18.5L15.4 16H8.6L6.6 18.5C5.2 20.2 2.4 19.5 2.7 17.2L3.2 13.4C3.5 10.7 4.8 8.5 7.2 8.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M7 11V15M5 13H9M15.5 12.5H15.51M18 15H18.01"
        stroke="currentColor"
        strokeWidth="1.8"
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
        r="8.6"
        stroke="currentColor"
        strokeWidth="1.9"
      />
      <path
        d="M12 7.1V12L15.35 14"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="12"
        r="1.6"
        fill="currentColor"
      />
      <path
        d="M12 3V4.2M21 12H19.8M12 21V19.8M3 12H4.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.5"
      />
    </SvgIcon>
  );
}
function IconCalendar(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <rect
        x="4"
        y="5.5"
        width="16"
        height="14.5"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.9"
      />
      <path
        d="M7.5 3.8V7.1M16.5 3.8V7.1M4.5 9.5H19.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M8 13H8.01M12 13H12.01M16 13H16.01M8 16.5H8.01M12 16.5H12.01"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </SvgIcon>
  );
}
function IconTrophy(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <path
        d="M8 4.25H16V9.25C16 12.35 14.45 14.65 12 14.65C9.55 14.65 8 12.35 8 9.25V4.25Z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <path
        d="M8 6.25H5.8C4.8 6.25 4.25 6.9 4.25 7.8V8.3C4.25 10.65 5.9 12.25 8 12.45M16 6.25H18.2C19.2 6.25 19.75 6.9 19.75 7.8V8.3C19.75 10.65 18.1 12.25 16 12.45"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 14.65V18.2M8.3 20H15.7"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M12 6.6L12.75 8.05L14.35 8.28L13.17 9.38L13.45 10.95L12 10.2L10.55 10.95L10.83 9.38L9.65 8.28L11.25 8.05L12 6.6Z"
        fill="currentColor"
      />
    </SvgIcon>
  );
}
function IconTrend(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <rect x="4" y="14" width="3" height="5.5" rx="1" fill="currentColor" opacity="0.4" />
      <rect x="10.5" y="10" width="3" height="9.5" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="17" y="5.5" width="3" height="14" rx="1" fill="currentColor" />
      <path
        d="M4.5 10.8L9.2 6.9L13 9.8L19.5 4.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16 4.5H19.5V8"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </SvgIcon>
  );
}
function IconTarget(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="5.1" stroke="currentColor" strokeWidth="1.55" opacity="0.75" />
      <path
        d="M12 7.3V16.7M7.3 12H16.7"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        opacity="0.5"
      />
      <path
        d="M12 9.2L14.8 12L12 14.8L9.2 12L12 9.2Z"
        fill="currentColor"
      />
    </SvgIcon>
  );
}
function IconFlame(props: { className?: string }) {
  return (
    <SvgIcon {...props}>
      <path
        d="M13.2 3.5C14.05 6.25 12.4 7.95 11.3 9.45C10.45 10.6 10.8 11.95 12.15 11.95C13.45 11.95 14.25 10.95 14.15 9.55C16.95 11.3 18.55 13.7 18.55 16.35C18.55 19.65 15.75 21.7 12.25 21.7C8.25 21.7 5.45 19.25 5.45 15.95C5.45 12.65 7.55 10.35 9.45 8.05C10.45 6.85 11 5.3 10.95 3.2C11.8 3.2 12.65 3.3 13.2 3.5Z"
        fill="currentColor"
      />
      <path
        d="M12.1 13.35C11.05 14.65 10.55 15.45 10.55 16.35C10.55 17.55 11.3 18.3 12.35 18.3C13.55 18.3 14.25 17.55 14.25 16.4C14.25 15.5 13.75 14.75 12.95 14.05"
        stroke="#090b0f"
        strokeWidth="1.45"
        strokeLinecap="round"
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
        strokeWidth="1.9"
      />
      <path
        d="M8.5 8H15.5M8.5 11.5H15.5M8.5 15H12.5"
        stroke="currentColor"
        strokeWidth="1.9"
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

  /*
   * Dois meses automáticos:
   * mês anterior + mês atual.
   * Cada dia real = 1 quadrado.
   * O calendário muda sozinho conforme o número real de dias do mês.
   */
  const months = useMemo(() => {
    const today = new Date();

    const buildMonth = (
      year: number,
      month: number
    ) => {
      const daysInMonth = new Date(
        year,
        month + 1,
        0
      ).getDate();

      const days: string[] = [];

      for (
        let day = 1;
        day <= daysInMonth;
        day += 1
      ) {
        const date = new Date(
          year,
          month,
          day,
          12,
          0,
          0,
          0
        );

        days.push(
          date.toISOString().slice(0, 10)
        );
      }

      const firstDate = new Date(
        `${days[0]}T12:00:00`
      );

      const mondayOffset =
        (firstDate.getDay() + 6) % 7;

      const slots: Array<string | null> =
        Array(mondayOffset).fill(null);

      slots.push(...days);

      const weeks = Math.ceil(
        slots.length / 7
      );

      while (slots.length < weeks * 7) {
        slots.push(null);
      }

      const label = new Date(
        year,
        month,
        1,
        12,
        0,
        0,
        0
      )
        .toLocaleDateString("pt-BR", {
          month: "short",
        })
        .replace(".", "")
        .toUpperCase();

      return {
        year,
        month,
        label,
        days,
        slots,
        weeks,
      };
    };

    const currentMonth = new Date(
      today.getFullYear(),
      today.getMonth(),
      1
    );

    const previousMonth = new Date(
      today.getFullYear(),
      today.getMonth() - 1,
      1
    );

    return [
      buildMonth(
        previousMonth.getFullYear(),
        previousMonth.getMonth()
      ),
      buildMonth(
        currentMonth.getFullYear(),
        currentMonth.getMonth()
      ),
    ];
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
    if (minutes <= 0) return "bg-[#171a21]";
    if (minutes < 60) return "bg-red-950";
    if (minutes < 180) return "bg-red-800";
    if (minutes < 300) return "bg-red-600";
    return "bg-red-500";
  };

  const cellSize = 13;
  const cellGap = 2;

  return (
    <section className="rounded-[14px] border border-white/[0.10] bg-[#090b0f] p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="truncate text-[15px] font-black tracking-[0.01em] text-white/95">
              Mapa de atividade
            </h2>

            <span
              title="Calendário automático: 1 quadrado representa 1 dia"
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/20 text-[8px] font-black text-white/50"
            >
              i
            </span>
          </div>

          <p className="mt-1 text-[9px] font-medium text-white/45">
            1 quadrado = 1 dia
          </p>
        </div>

        <span className="shrink-0 rounded-md border border-white/12 bg-white/[0.03] px-2 py-1 text-[8px] font-black tracking-[0.04em] text-white/45">
          2 MESES
        </span>
      </div>

      <div className="mt-4 flex justify-center">
        <div className="grid grid-cols-2 gap-[12px]">
          {months.map((month) => (
            <div
              key={`${month.year}-${month.month}`}
              className="min-w-0"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[9px] font-black tracking-[0.12em] text-white/50">
                  {month.label}
                </span>

                <span className="text-[7px] font-bold text-white/30">
                  {month.days.length}
                </span>
              </div>

              <div
                className="grid"
                style={{
                  gridTemplateColumns: `repeat(${month.weeks}, ${cellSize}px)`,
                  gridTemplateRows: `repeat(7, ${cellSize}px)`,
                  columnGap: `${cellGap}px`,
                  rowGap: `${cellGap}px`,
                }}
              >
                {Array.from({ length: 7 }).flatMap(
                  (_, rowIndex) =>
                    Array.from({
                      length: month.weeks,
                    }).map((_, weekIndex) => {
                      const day =
                        month.slots[
                          weekIndex * 7 +
                            rowIndex
                        ];

                      if (!day) {
                        return (
                          <div
                            key={`empty-${month.year}-${month.month}-${rowIndex}-${weekIndex}`}
                            className="h-[13px] w-[13px]"
                          />
                        );
                      }

                      const minutes =
                        activityByDay.get(day) || 0;

                      return (
                        <div
                          key={day}
                          title={`${day} • ${formatPlayedTime(
                            minutes
                          )}`}
                          className={`h-[13px] w-[13px] rounded-[3px] ${getIntensity(
                            minutes
                          )}`}
                        />
                      );
                    })
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-1.5 text-[8px] font-bold text-white/35">
        <span>Menos</span>

        <span className="h-2.5 w-2.5 rounded-[2px] bg-[#171a21]" />
        <span className="h-2.5 w-2.5 rounded-[2px] bg-red-950" />
        <span className="h-2.5 w-2.5 rounded-[2px] bg-red-800" />
        <span className="h-2.5 w-2.5 rounded-[2px] bg-red-600" />
        <span className="h-2.5 w-2.5 rounded-[2px] bg-red-500" />

        <span>Mais</span>
      </div>
    </section>
  );
}


function PremiumIconBadge({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-red-600/15 text-red-500">
      {children}
    </div>
  );
}


function Metric({
  icon,
  label,
  value,
  divided = false,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  divided?: boolean;
}) {
  return (
    <div
      className={`flex min-w-0 items-center gap-2.5 ${
        divided ? "border-l border-white/10 pl-4" : ""
      }`}
    >
      <PremiumIconBadge>{icon}</PremiumIconBadge>

      <div className="min-w-0">
        <p className="truncate text-[19px] font-black leading-none tracking-tight text-white">
          {value}
        </p>

        <p className="mt-1 truncate text-[13px] font-medium leading-[1.25] text-white/55">
          {label}
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
        <p className="text-[29px] font-black leading-none tracking-tight text-white md:text-[31px]">
          {date.getDate()}
        </p>

        <p className="mt-1 text-[10px] font-black uppercase tracking-[0.10em] text-red-400">
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
          <h3 className="truncate text-[17px] font-black text-white md:text-[18px]">
            {normalizeGameTitle(entry.gameTitle)}
          </h3>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-medium text-white/65 md:text-[13px]">
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
        <p className="text-[18px] font-black leading-none text-white md:text-[19px]">
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
              <nav className="mt-4 space-y-1">
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
                    className={`flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-[12px] font-bold transition ${
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
                className="flex items-center gap-3 px-2.5 py-2 text-[12px] font-bold text-white/55"
              >
                <IconTarget className="h-4 w-4" />
                Configurações
              </Link>

              <button
                type="button"
                className="flex items-center gap-3 px-2.5 py-2 text-[12px] font-bold text-white/55"
              >
                <span className="text-sm">↪</span>
                Sair
              </button>

              <button
                type="button"
                className="mt-2 w-full rounded-lg bg-red-600 px-3 py-3 text-[12px] font-black text-white transition hover:bg-red-500"
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
          <header className="relative overflow-hidden border-b border-white/10 bg-[#050609]">
            <div
              className="absolute inset-0 bg-cover bg-right-center bg-no-repeat"
              style={{ backgroundImage: "url('/images/activity-banner-bg.png')" }}
            />

            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,6,9,0.99)_0%,rgba(5,6,9,0.97)_24%,rgba(5,6,9,0.78)_46%,rgba(5,6,9,0.22)_78%,rgba(5,6,9,0.06)_100%)]" />
            <div className="absolute inset-x-0 bottom-0 h-24 bg-[linear-gradient(180deg,transparent_0%,rgba(5,6,9,0.55)_48%,rgba(5,6,9,0.96)_100%)]" />

            <div className="relative min-h-[235px] px-7 py-7 md:px-7 md:py-7">
              <div className="max-w-[400px]">
                <p className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.22em] text-red-500">
                  <span className="text-[10px] leading-none">✣</span>
                  Sua jornada em números
                </p>

                <h1 className="mt-2 text-[38px] font-black leading-none tracking-tight text-white md:text-[40px]">
                  ATIVIDADE
                </h1>

                <p className="mt-3 max-w-[340px] text-[12px] font-medium leading-[1.35] text-white/70">
                  Acompanhe seus dias de jogo, horas investidas e
                  conquistas ao longo do tempo.
                </p>
              </div>

              <div className="absolute bottom-8 left-7 right-7 grid grid-cols-2 gap-y-3 sm:grid-cols-4 sm:gap-y-0">
                <Metric
                  icon={<IconMetricDays className="h-[22px] w-[22px]" />}
                  label="Dias jogados"
                  value={isLoaded ? uniqueDays : "..."}
                />

                <Metric
                  icon={<IconMetricTime className="h-[22px] w-[22px]" />}
                  label="Tempo jogado"
                  value={isLoaded ? formatPlayedTime(totalMinutes) : "..."}
                  divided
                />

                <Metric
                  icon={<IconMetricAverage className="h-[22px] w-[22px]" />}
                  label="Média por dia"
                  value={isLoaded ? formatPlayedTime(averageMinutes) : "..."}
                  divided
                />

                <Metric
                  icon={<IconMetricGames className="h-[22px] w-[22px]" />}
                  label="Jogos"
                  value={isLoaded ? differentGames : "..."}
                  divided
                />
              </div>
            </div>
          </header>

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
                        className={`inline-flex items-center gap-1.5 rounded-t-lg px-4 py-3 text-[12px] font-black transition ${
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
                      className="w-full rounded-xl border border-white/10 bg-black/25 py-3 pl-10 pr-4 text-[11px] font-semibold text-white outline-none placeholder:text-white/25 focus:border-red-500/35"
                    />
                  </div>

                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-[11px] font-black text-white/50"
                  >
                    <IconCalendar className="h-3.5 w-3.5" />
                    Todos os Meses ▾
                  </button>

                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-[11px] font-black text-white/50"
                  >
                    <IconGamepad className="h-3.5 w-3.5" />
                    Todas as Plataformas ▾
                  </button>
                </div>

                {activeTab === "jogos" && (
                  <div className="px-3 pb-3">
                    <p className="mb-2 px-1 text-[12px] font-black uppercase tracking-[0.16em] text-white/65">
                      Atividades recentes
                    </p>

                    {Object.entries(groupedEntries).map(
                      ([month, monthEntries]) => (
                        <section
                          key={month}
                          className="mt-4"
                        >
                          <div className="mb-2 flex items-center justify-between px-1">
                            <h2 className="text-[12px] font-black uppercase tracking-[0.12em] text-white/80">
                              {month}
                            </h2>

                            <span className="text-[10px] font-black uppercase tracking-[0.12em] text-white/45">
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
              <ActivityMap entries={sourceEntries} />
              <section className="rounded-[14px] border border-white/[0.10] bg-[#090b0f] p-3.5">
                <div className="flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-[16px] font-black uppercase tracking-[0.01em] text-white/95">
                    <span className="h-5 w-0.5 rounded-full bg-red-500" />
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

                        <span className="truncate text-[11px] font-medium text-white/55">
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
                <h2 className="flex items-center gap-2 text-[16px] font-black uppercase tracking-[0.01em] text-white/95">
                  <span className="h-5 w-0.5 rounded-full bg-red-500" />
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

                          <p className="ml-4 mt-0.5 text-[8px] text-white/35">
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
                <h2 className="flex items-center gap-2 text-[15px] font-black uppercase tracking-[0.01em] text-white/95">
                  <span className="h-5 w-0.5 rounded-full bg-red-500" />
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
                        <p className="truncate text-[9px] font-black text-white/70">
                          {normalizeGameTitle(
                            entry.gameTitle
                          )}
                        </p>
                        <p className="mt-0.5 text-[7px] text-white/25">
                          {getDateKey(entry.date)}
                        </p>
                      </div>

                      <span className="text-[8px] font-black text-white/45">
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

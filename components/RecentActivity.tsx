"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { games } from "@/data/games";

type Rank = "Bronze" | "Prata" | "Ouro" | "Diamante";
type AchievementStatus = "locked" | "progress" | "completed";

type ActivityItem = {
  type: "trophy" | "badge";
  slug: string;
  gameTitle: string;
  gameSubtitle: string;
  title: string;
  description: string;
  icon: string;
  image?: string;
  rank: Rank;
  date: string;
  timestamp: number;
};

type RecentAchievementLike = {
  title?: string;
  description?: string;
  trophy?: string;
  icon?: string;
  image?: string;
  difficulty?: string;
  rank?: string;
  status?: string;
  earnedDate?: string;
  [key: string]: unknown;
};

type ManualAchievementState = {
  status?: AchievementStatus | string;
  rank?: Rank;
  date?: string;
  image?: string;
};

type GameLike = {
  title?: string;
  subtitle?: string;
  achievementsList?: RecentAchievementLike[];
  finalBadge?: {
    title?: string;
    icon?: string;
    image?: string;
  };
};

const ACHIEVEMENTS_UPDATED_EVENT = "rumo-a-conquista-achievements-updated";
const GAMES_UPDATED_EVENT = "rumo-a-conquista-games-updated";

function readText(value: unknown, fallback = "") {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return fallback;
}

function readLocalJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }

  const savedData = localStorage.getItem(key);

  if (!savedData) {
    return fallback;
  }

  try {
    return JSON.parse(savedData) as T;
  } catch {
    return fallback;
  }
}

function normalizeStatus(status?: string): AchievementStatus {
  const value = String(status || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

  if (
    value === "completed" ||
    value === "concluido" ||
    value === "concluida" ||
    value === "desbloqueado" ||
    value === "desbloqueada" ||
    value === "finalizado" ||
    value === "finalizada"
  ) {
    return "completed";
  }

  if (
    value === "progress" ||
    value === "emprogresso" ||
    value === "emandamento"
  ) {
    return "progress";
  }

  return "locked";
}

function normalizeText(text?: string) {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeRank(value?: string, trophy?: string): Rank {
  const rank = normalizeText(value);
  const trophyText = trophy ?? "";

  if (
    rank === "diamante" ||
    rank === "extrema" ||
    trophyText.includes("💎")
  ) {
    return "Diamante";
  }

  if (
    rank === "ouro" ||
    rank === "dificil" ||
    trophyText.includes("🥇") ||
    trophyText.includes("🏆")
  ) {
    return "Ouro";
  }

  if (rank === "prata" || rank === "media" || trophyText.includes("🥈")) {
    return "Prata";
  }

  return "Bronze";
}

function getDefaultRank(achievement: RecentAchievementLike): Rank {
  return normalizeRank(
    readText(achievement.rank, readText(achievement.difficulty, "")),
    readText(achievement.trophy, readText(achievement.icon, ""))
  );
}

function toInputDate(date?: string) {
  if (!date) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }

  const [day, month, year] = date.split("/");

  if (!day || !month || !year) {
    return "";
  }

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function toBrazilianDate(date?: string) {
  if (!date) {
    return "Sem data";
  }

  const [year, month, day] = date.split("-");

  if (!day || !month || !year) {
    return "Sem data";
  }

  return `${day}/${month}/${year}`;
}

function parseInputDate(date?: string) {
  if (!date) {
    return 0;
  }

  const [year, month, day] = date.split("-").map(Number);

  if (!day || !month || !year) {
    return 0;
  }

  return new Date(year, month - 1, day).getTime();
}

function getAchievementTitle(
  achievement: RecentAchievementLike,
  index: number
) {
  return readText(achievement.title, `Conquista ${index + 1}`);
}

function getVisibleAchievements(slug: string, game: GameLike) {
  const baseAchievements = Array.isArray(game.achievementsList)
    ? game.achievementsList
    : [];

  const customAchievements = readLocalJson<RecentAchievementLike[]>(
    `rumo-a-conquista-custom-achievements-${slug}`,
    []
  );

  const hiddenAchievementTitles = readLocalJson<string[]>(
    `rumo-a-conquista-hidden-achievements-${slug}`,
    []
  );

  const visibleBaseAchievements = baseAchievements.filter(
    (achievement, index) => {
      const title = getAchievementTitle(achievement, index);

      return !hiddenAchievementTitles.includes(title);
    }
  );

  const visibleCustomAchievements = customAchievements.filter(
    (achievement, index) => {
      const title = getAchievementTitle(achievement, index);

      return !hiddenAchievementTitles.includes(title);
    }
  );

  return [...visibleBaseAchievements, ...visibleCustomAchievements];
}

function createDefaultStates(achievements: RecentAchievementLike[]) {
  return achievements.reduce<Record<string, ManualAchievementState>>(
    (acc, achievement, index) => {
      const title = getAchievementTitle(achievement, index);

      acc[title] = {
        rank: getDefaultRank(achievement),
        status: normalizeStatus(achievement.status),
        date: toInputDate(readText(achievement.earnedDate, "")),
        image: readText(achievement.image, ""),
      };

      return acc;
    },
    {}
  );
}

function getRankIcon(rank: Rank) {
  if (rank === "Diamante") {
    return "💎";
  }

  if (rank === "Ouro") {
    return "🥇";
  }

  if (rank === "Prata") {
    return "🥈";
  }

  return "🥉";
}

function ActivityCard({ activity }: { activity?: ActivityItem }) {
  if (!activity) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="text-sm font-black text-white/45">
          Nenhuma atividade ainda
        </p>

        <p className="mt-1 text-xs leading-relaxed text-white/35">
          Desbloqueie uma conquista para aparecer aqui.
        </p>
      </div>
    );
  }

  const rankIcon = getRankIcon(activity.rank);

  return (
    <Link
      href={`/games/${activity.slug}`}
      className="group block rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-red-500/35 hover:bg-red-500/10"
    >
      <div className="flex gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/35 text-2xl">
          {activity.image ? (
            <img
              src={activity.image}
              alt={activity.title}
              className="h-full w-full object-cover"
            />
          ) : (
            activity.icon
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-300">
              {activity.type === "badge" ? "Última Maestria" : "Último Troféu"}
            </p>

            <span className="text-lg">
              {activity.type === "badge" ? "⭐" : rankIcon}
            </span>
          </div>

          <h3 className="mt-1 line-clamp-1 text-sm font-black text-white">
            {activity.title}
          </h3>

          <p className="mt-1 line-clamp-1 text-xs text-white/45">
            {activity.gameTitle}
          </p>

          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="line-clamp-1 text-[11px] font-bold text-blue-300">
              {activity.gameSubtitle}
            </p>

            <p className="shrink-0 text-[10px] font-black text-white/35">
              {activity.date}
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function RecentActivity() {
  const gamesList = useMemo(() => {
    return Object.entries(games).map(([slug, game]) => ({
      slug,
      game: game as unknown as GameLike,
    }));
  }, []);

  const [manualStatesByGame, setManualStatesByGame] = useState<
    Record<string, Record<string, ManualAchievementState>>
  >({});

  const loadStates = useCallback(() => {
    const loadedStates: Record<string, Record<string, ManualAchievementState>> =
      {};

    gamesList.forEach(({ slug, game }) => {
      const achievements = getVisibleAchievements(slug, game);
      const defaultStates = createDefaultStates(achievements);
      const storageKey = `rumo-a-conquista-achievements-${slug}`;
      const savedData = localStorage.getItem(storageKey);

      if (!savedData) {
        loadedStates[slug] = defaultStates;
        return;
      }

      try {
        const parsedData = JSON.parse(savedData) as Record<
          string,
          ManualAchievementState
        >;

        loadedStates[slug] = {
          ...defaultStates,
          ...parsedData,
        };
      } catch {
        loadedStates[slug] = defaultStates;
      }
    });

    setManualStatesByGame(loadedStates);
  }, [gamesList]);

  useEffect(() => {
    loadStates();

    window.addEventListener(ACHIEVEMENTS_UPDATED_EVENT, loadStates);
    window.addEventListener(GAMES_UPDATED_EVENT, loadStates);
    window.addEventListener("storage", loadStates);
    window.addEventListener("focus", loadStates);

    return () => {
      window.removeEventListener(ACHIEVEMENTS_UPDATED_EVENT, loadStates);
      window.removeEventListener(GAMES_UPDATED_EVENT, loadStates);
      window.removeEventListener("storage", loadStates);
      window.removeEventListener("focus", loadStates);
    };
  }, [loadStates]);

  const { latestTrophy, latestBadge } = useMemo(() => {
    const trophyActivities: ActivityItem[] = gamesList.flatMap(
      ({ slug, game }) => {
        const achievements = getVisibleAchievements(slug, game);
        const defaultStates = createDefaultStates(achievements);
        const states = manualStatesByGame[slug] ?? defaultStates;

        return achievements
          .map((achievement, index) => {
            const title = getAchievementTitle(achievement, index);
            const state = states[title] ?? defaultStates[title];

            return {
              achievement,
              title,
              state,
            };
          })
          .filter(({ state }) => normalizeStatus(state?.status) === "completed")
          .map(({ achievement, title, state }) => {
            const rank = state.rank ?? getDefaultRank(achievement);

            return {
              type: "trophy" as const,
              slug,
              gameTitle: readText(game.title, "Jogo"),
              gameSubtitle: readText(game.subtitle, ""),
              title,
              description: readText(
                achievement.description,
                "Conquista registrada na jornada."
              ),
              icon:
                readText(achievement.icon, "") ||
                readText(achievement.trophy, "") ||
                getRankIcon(rank),
              image:
                readText(state.image, "") || readText(achievement.image, ""),
              rank,
              date: toBrazilianDate(state.date),
              timestamp: parseInputDate(state.date),
            };
          });
      }
    );

    const badgeActivities: ActivityItem[] = gamesList
      .map(({ slug, game }) => {
        const achievements = getVisibleAchievements(slug, game);
        const defaultStates = createDefaultStates(achievements);
        const states = manualStatesByGame[slug] ?? defaultStates;

        const enhancedAchievements = achievements.map((achievement, index) => {
          const title = getAchievementTitle(achievement, index);

          return {
            achievement,
            title,
            state: states[title] ?? defaultStates[title],
          };
        });

        const finalAchievement =
          enhancedAchievements.find(({ achievement, state }) => {
            const rank = state.rank ?? getDefaultRank(achievement);

            return rank === "Diamante";
          }) ?? enhancedAchievements[enhancedAchievements.length - 1];

        if (
          !finalAchievement ||
          normalizeStatus(finalAchievement.state.status) !== "completed"
        ) {
          return null;
        }

        const finalDate = finalAchievement.state.date;
        const badgeIcon = readText(game.finalBadge?.icon, "⭐");
        const badgeImage = readText(game.finalBadge?.image, "");

        return {
          type: "badge" as const,
          slug,
          gameTitle: readText(game.title, "Jogo"),
          gameSubtitle: readText(game.subtitle, ""),
          title: readText(game.finalBadge?.title, "Maestria Final"),
          description: "Insígnia final conquistada nesta jornada.",
          icon: badgeIcon,
          image: badgeImage,
          rank: "Diamante" as Rank,
          date: toBrazilianDate(finalDate),
          timestamp: parseInputDate(finalDate),
        };
      })
      .filter(Boolean) as ActivityItem[];

    const latestTrophy = trophyActivities.sort(
      (a, b) => b.timestamp - a.timestamp
    )[0];

    const latestBadge = badgeActivities.sort(
      (a, b) => b.timestamp - a.timestamp
    )[0];

    return {
      latestTrophy,
      latestBadge,
    };
  }, [gamesList, manualStatesByGame]);

  return (
    <section className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5 shadow-xl">
      <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
        Atividade
      </p>

      <h2 className="mt-2 text-2xl font-black text-white">Recente</h2>

      <div className="mt-5 grid gap-3">
        <ActivityCard activity={latestTrophy} />
        <ActivityCard activity={latestBadge} />
      </div>
    </section>
  );
}
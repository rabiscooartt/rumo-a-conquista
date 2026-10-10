"use client";

import { useMemo, useState } from "react";
import TrophyIcon, { type TrophyRank } from "@/components/TrophyIcon";
import { formatAchievementDescription, formatAchievementTitle } from "@/lib/useSiteGames";

type Achievement = {
  icon: string;
  title: string;
  description: string;
  trophy: string;
  status: string;
  earnedDate?: string;
};

type AchievementListProps = {
  achievements: Achievement[];
};

type SortKey = "title" | "difficulty" | "date";
type SortDirection = "asc" | "desc";

function getTrophyRank(trophy: string): TrophyRank {
  if (trophy === "🥈") return "Prata";
  if (trophy === "🥇") return "Ouro";
  if (trophy === "🏆" || trophy === "💎") return "Emblema";
  return "Bronze";
}

function getDifficultyValue(trophy: string) {
  const rank = getTrophyRank(trophy);
  if (rank === "Bronze") return 1;
  if (rank === "Prata") return 2;
  if (rank === "Ouro") return 3;
  return 4;
}

function parseDate(date?: string) {
  if (!date) return 0;

  const [day, month, year] = date.split("/").map(Number);
  return new Date(year, month - 1, day).getTime();
}

function getTrophyStyle(trophy: string) {
  const rank = getTrophyRank(trophy);
  if (rank === "Bronze") return "drop-shadow-[0_0_8px_rgba(205,127,50,0.35)]";
  if (rank === "Prata") return "drop-shadow-[0_0_8px_rgba(199,203,209,0.35)]";
  if (rank === "Ouro") return "drop-shadow-[0_0_10px_rgba(224,184,61,0.45)]";
  return "drop-shadow-[0_0_10px_rgba(243,198,35,0.45)]";
}

function getStatusStyle(status: string) {
  if (status === "completed") {
    return {
      row: "opacity-100",
      icon: "shadow-[0_0_24px_rgba(74,222,128,0.18)]",
      trophy: "opacity-100",
    };
  }

  if (status === "progress") {
    return {
      row: "opacity-100 bg-white/[0.025]",
      icon: "scale-105 shadow-[0_0_26px_rgba(59,130,246,0.2)]",
      trophy: "opacity-100 animate-pulse",
    };
  }

  if (status === "locked") {
    return {
      row: "opacity-35 grayscale",
      icon: "brightness-50",
      trophy: "opacity-30",
    };
  }

  return {
    row: "opacity-70",
    icon: "",
    trophy: "opacity-70",
  };
}

export default function AchievementList({ achievements }: AchievementListProps) {
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const rankCounts = useMemo(() => {
    const counts = { Bronze: 0, Prata: 0, Ouro: 0 };
    for (const achievement of achievements) {
      const rank = getTrophyRank(achievement.trophy);
      if (rank !== "Emblema") counts[rank] += 1;
    }
    return counts;
  }, [achievements]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
      return;
    }

    setSortKey(key);
    setSortDirection("asc");
  }

  const sortedAchievements = useMemo(() => {
    return [...achievements].sort((a, b) => {
      let valueA = 0;
      let valueB = 0;

      if (sortKey === "title") {
        const result = a.title.localeCompare(b.title);
        return sortDirection === "asc" ? result : -result;
      }

      if (sortKey === "difficulty") {
        valueA = getDifficultyValue(a.trophy);
        valueB = getDifficultyValue(b.trophy);
      }

      if (sortKey === "date") {
        valueA = parseDate(a.earnedDate);
        valueB = parseDate(b.earnedDate);
      }

      return sortDirection === "asc" ? valueA - valueB : valueB - valueA;
    });
  }, [achievements, sortKey, sortDirection]);

  function sortIcon(key: SortKey) {
    if (sortKey !== key) return "↕";
    return sortDirection === "asc" ? "↑" : "↓";
  }

  return (
    <section className="max-w-[1500px] mx-auto px-8 mt-10 mb-20">
      <div className="rounded-[28px] border border-white/10 bg-white/[0.03] overflow-hidden">
        <div className="p-8 border-b border-white/10 flex items-center justify-between gap-6">
          <div>
            <h2 className="text-4xl font-black">Sistema de Conquistas</h2>

            <p className="text-white/50 mt-2">
              Objetivos especiais da jornada
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/30 px-5 py-4">
            <p className="text-xs text-white/40 mb-3 uppercase tracking-[0.2em]">
              Dificuldade
            </p>

            <div className="flex items-center gap-4 text-sm">
              {([
                ["Bronze", rankCounts.Bronze],
                ["Prata", rankCounts.Prata],
                ["Ouro", rankCounts.Ouro],
              ] as const).map(([rank, count]) => (
                <span key={rank} title={rank} className="inline-flex items-center gap-1.5">
                  <TrophyIcon rank={rank} className="h-5 w-5" />
                  <span className="font-black">{count}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_96px_140px] px-8 py-4 border-b border-white/10 bg-white/[0.02] text-white/40 text-xs uppercase tracking-[0.22em]">
          <button
            onClick={() => handleSort("title")}
            className="text-left hover:text-white transition"
          >
            Conquista {sortIcon("title")}
          </button>

          <button
            onClick={() => handleSort("difficulty")}
            className="text-center hover:text-white transition"
          >
            Troféu {sortIcon("difficulty")}
          </button>

          <button
            onClick={() => handleSort("date")}
            className="text-right hover:text-white transition"
          >
            Data {sortIcon("date")}
          </button>
        </div>

        <div>
          {sortedAchievements.map((achievement, index) => {
            const statusStyle = getStatusStyle(achievement.status);

            return (
              <div
                key={index}
                className={`grid grid-cols-[1fr_96px_140px] items-center gap-6 px-8 py-5 border-b border-white/5 transition-all duration-300 hover:bg-white/[0.03] ${statusStyle.row}`}
              >
                <div className="flex items-center gap-5">
                  <div
                    className={`w-[72px] h-[72px] rounded-2xl bg-black/40 border border-white/10 flex items-center justify-center text-3xl transition-all duration-300 ${statusStyle.icon}`}
                  >
                    {achievement.icon}
                  </div>

                  <div>
                    <h3 className="text-xl font-bold">
                      {formatAchievementTitle(achievement.title)}
                    </h3>

                    <p className="text-base text-white/60 mt-1 max-w-[700px]">
                      {formatAchievementDescription(achievement.description)}
                    </p>
                  </div>
                </div>

                <div
                  className={`text-3xl text-center transition-all ${getTrophyStyle(
                    achievement.trophy
                  )} ${statusStyle.trophy}`}
                >
                  <TrophyIcon
                    rank={getTrophyRank(achievement.trophy)}
                    className="h-6 w-6"
                  />
                </div>

                <div className="text-right text-white/60 text-sm">
                  {achievement.status === "completed"
                    ? achievement.earnedDate
                    : "—"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
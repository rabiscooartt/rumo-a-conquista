"use client";

import { useMemo, useState } from "react";

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

function getDifficultyValue(trophy: string) {
  if (trophy === "🥉") return 1;
  if (trophy === "🥈") return 2;
  if (trophy === "🏆") return 3;
  if (trophy === "💎") return 4;
  return 0;
}

function parseDate(date?: string) {
  if (!date) return 0;

  const [day, month, year] = date.split("/").map(Number);
  return new Date(year, month - 1, day).getTime();
}

function getTrophyStyle(trophy: string) {
  if (trophy === "🥉") return "text-orange-300 drop-shadow-[0_0_8px_rgba(251,146,60,0.45)]";
  if (trophy === "🥈") return "text-zinc-200 drop-shadow-[0_0_8px_rgba(228,228,231,0.45)]";
  if (trophy === "🏆") return "text-yellow-300 drop-shadow-[0_0_10px_rgba(250,204,21,0.55)]";
  if (trophy === "💎") return "text-cyan-300 drop-shadow-[0_0_12px_rgba(34,211,238,0.65)]";

  return "text-white";
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
              <span title="Bronze - Simples">🥉 Simples</span>
              <span title="Prata - Média">🥈 Média</span>
              <span title="Ouro - Difícil">🏆 Difícil</span>
              <span title="Diamante - Extrema">💎 Extrema</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_140px_180px] px-8 py-4 border-b border-white/10 bg-white/[0.02] text-white/40 text-xs uppercase tracking-[0.22em]">
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
            Classe {sortIcon("difficulty")}
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
                className={`grid grid-cols-[1fr_140px_180px] items-center gap-6 px-8 py-6 border-b border-white/5 transition-all duration-300 hover:bg-white/[0.03] ${statusStyle.row}`}
              >
                <div className="flex items-center gap-5">
                  <div
                    className={`w-20 h-20 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-center text-3xl transition-all duration-300 ${statusStyle.icon}`}
                  >
                    {achievement.icon}
                  </div>

                  <div>
                    <h3 className="text-2xl font-bold">
                      {achievement.title}
                    </h3>

                    <p className="text-white/60 mt-1 max-w-[700px]">
                      {achievement.description}
                    </p>
                  </div>
                </div>

                <div
                  className={`text-3xl text-center transition-all ${getTrophyStyle(
                    achievement.trophy
                  )} ${statusStyle.trophy}`}
                >
                  {achievement.trophy}
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
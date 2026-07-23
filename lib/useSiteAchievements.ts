"use client";

import { useCallback, useEffect, useState } from "react";
import {
  loadAchievementsForGame,
  saveAchievementsForGame,
} from "@/lib/achievements/repository";
import type {
  AchievementLoadResult,
  SiteAchievement,
} from "@/lib/achievements/types";

export function useSiteAchievements(
  gameSlug: string,
  baseAchievements: SiteAchievement[]
) {
  const [result, setResult] = useState<AchievementLoadResult>({
    achievements: baseAchievements,
    source: "base",
  });
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!gameSlug) return;

    const next = await loadAchievementsForGame(gameSlug, baseAchievements);
    setResult(next);
    setIsLoading(false);
  }, [baseAchievements, gameSlug]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void reload();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [reload]);

  const save = useCallback(
    async (achievements: SiteAchievement[]) => {
      await saveAchievementsForGame(gameSlug, achievements);
      setResult({ achievements, source: "supabase" });
    },
    [gameSlug]
  );

  return { ...result, isLoading, reload, save };
}

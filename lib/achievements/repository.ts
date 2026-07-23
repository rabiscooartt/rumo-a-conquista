import { supabase } from "@/lib/supabase";
import type {
  AchievementLoadResult,
  AchievementRank,
  AchievementStatus,
  SiteAchievement,
} from "@/lib/achievements/types";

const OWNER_KEY = "default";

type DatabaseAchievement = {
  id: string;
  legacy_id: string;
  title: string;
  description: string;
  trophy: string;
  rank: AchievementRank;
  image: string;
  sort_order: number;
  is_custom: boolean;
  is_hidden: boolean;
  achievement_progress?: Array<{
    status: AchievementStatus;
    earned_at: string | null;
    rank_override: AchievementRank | null;
    image_override: string | null;
  }>;
};

function rankFrom(value?: string): AchievementRank {
  return value === "Prata" || value === "Ouro" || value === "Diamante"
    ? value
    : "Bronze";
}

function statusFrom(value?: string): AchievementStatus {
  return value === "completed" || value === "progress" ? value : "locked";
}

function localJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;

  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function getLocalAchievementFallback(
  gameSlug: string,
  baseAchievements: SiteAchievement[]
): SiteAchievement[] {
  const states = localJson<
    Record<string, { rank?: string; status?: string; date?: string; image?: string }>
  >(`rumo-a-conquista-achievements-${gameSlug}`, {});
  const custom = localJson<SiteAchievement[]>(
    `rumo-a-conquista-custom-achievements-${gameSlug}`,
    []
  );
  const hidden = localJson<string[]>(
    `rumo-a-conquista-hidden-achievements-${gameSlug}`,
    []
  );

  return [...baseAchievements, ...custom].map((achievement) => {
    const state = states[achievement.title];
    const rank = rankFrom(state?.rank ?? achievement.rank ?? achievement.difficulty);

    return {
      ...achievement,
      trophy: achievement.trophy || achievement.icon || "",
      icon: achievement.icon || achievement.trophy || "",
      rank,
      difficulty: rank,
      status: statusFrom(state?.status ?? achievement.status),
      earnedDate: state?.date ?? achievement.earnedDate ?? "",
      image: state?.image ?? achievement.image ?? "",
      isHidden: hidden.includes(achievement.title) || achievement.isHidden === true,
    };
  });
}

export async function loadAchievementsForGame(
  gameSlug: string,
  baseAchievements: SiteAchievement[]
): Promise<AchievementLoadResult> {
  const { data, error } = await supabase
    .from("achievements")
    .select(
      "id, legacy_id, title, description, trophy, rank, image, sort_order, is_custom, is_hidden, achievement_progress(status, earned_at, rank_override, image_override)"
    )
    .eq("game_slug", gameSlug)
    .order("sort_order", { ascending: true });

  if (error || !data || data.length === 0) {
    const fallback = getLocalAchievementFallback(gameSlug, baseAchievements);
    return {
      achievements: fallback,
      source: fallback.length > 0 ? "localStorage" : "base",
    };
  }

  return {
    source: "supabase",
    achievements: (data as DatabaseAchievement[]).map((achievement) => {
      const progress = achievement.achievement_progress?.[0];
      const rank = progress?.rank_override ?? achievement.rank;

      return {
        id: achievement.legacy_id || achievement.id,
        title: achievement.title,
        description: achievement.description,
        trophy: achievement.trophy,
        icon: achievement.trophy,
        rank,
        difficulty: rank,
        status: progress?.status ?? "locked",
        earnedDate: progress?.earned_at ?? "",
        image: progress?.image_override || achievement.image,
        isCustom: achievement.is_custom,
        isHidden: achievement.is_hidden,
      };
    }),
  };
}

export async function saveAchievementsForGame(
  gameSlug: string,
  achievements: SiteAchievement[]
) {
  const response = await fetch("/admin/api/achievements", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameSlug, achievements, ownerKey: OWNER_KEY }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error || "Não foi possível salvar no Supabase.");
  }
}

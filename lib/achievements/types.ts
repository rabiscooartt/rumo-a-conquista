export type AchievementRank = "Bronze" | "Prata" | "Ouro" | "Diamante";
export type AchievementStatus = "locked" | "progress" | "completed";

export type SiteAchievement = {
  id?: string;
  title: string;
  description: string;
  trophy: string;
  difficulty: string;
  rank?: string;
  status?: AchievementStatus | string;
  earnedDate?: string;
  icon?: string;
  image?: string;
  isCustom?: boolean;
  isHidden?: boolean;
  hidden?: boolean;
};

export type AchievementSource = "supabase" | "localStorage" | "base";

export type AchievementLoadResult = {
  achievements: SiteAchievement[];
  source: AchievementSource;
};

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

  // Imagem personalizada do Rumo à Conquista
  image?: string;

  // Novos campos para importação automática
  source?: "manual" | "playstation" | "steam" | "xbox";
  externalId?: string;
  officialImage?: string;

  isCustom?: boolean;
  isHidden?: boolean;
  hidden?: boolean;
};

export type AchievementSource = "supabase" | "localStorage" | "base";

export type AchievementLoadResult = {
  achievements: SiteAchievement[];
  source: AchievementSource;
};
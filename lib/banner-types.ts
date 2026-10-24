export type SiteBannerKey = "home" | "jogos" | "atividade" | "conteudo" | "reviews" | "emblemas" | "backlog";

export type SiteBannerSetting = {
  x: number;
  y: number;
  zoom: number;
  /** Public URL persisted in Supabase Storage; empty means use the page default. */
  imageUrl: string;
};

export type SiteBannerSettingsMap = Record<
  SiteBannerKey,
  SiteBannerSetting
>;

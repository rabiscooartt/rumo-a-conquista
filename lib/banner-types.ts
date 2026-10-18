export type SiteBannerKey = "jogos" | "atividade" | "conteudo" | "reviews";

export type SiteBannerSetting = {
  x: number;
  y: number;
  zoom: number;
};

export type SiteBannerSettingsMap = Record<
  SiteBannerKey,
  SiteBannerSetting
>;

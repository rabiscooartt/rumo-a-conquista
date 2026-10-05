export type SiteBannerKey = "jogos" | "atividade" | "conteudo";

export type SiteBannerSetting = {
  x: number;
  y: number;
  zoom: number;
};

export type SiteBannerSettingsMap = Record<
  SiteBannerKey,
  SiteBannerSetting
>;

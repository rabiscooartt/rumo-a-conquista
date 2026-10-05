import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import type {
  SiteBannerKey,
  SiteBannerSetting,
} from "@/lib/banner-types";

const DEFAULT_SETTINGS: SiteBannerSetting = {
  x: 0,
  y: 0,
  zoom: 1,
};

export const SITE_BANNER_DEFAULTS: Record<
  SiteBannerKey,
  SiteBannerSetting
> = {
  jogos: { ...DEFAULT_SETTINGS },
  atividade: { ...DEFAULT_SETTINGS },
  conteudo: { ...DEFAULT_SETTINGS },
};

export async function loadSiteBannerSettings(): Promise<
  Record<SiteBannerKey, SiteBannerSetting>
> {
  const settings = {
    jogos: { ...DEFAULT_SETTINGS },
    atividade: { ...DEFAULT_SETTINGS },
    conteudo: { ...DEFAULT_SETTINGS },
  };

  try {
    const client = createAdminSupabaseClient();
    const { data, error } = await client
      .from("site_banner_settings")
      .select("banner_key, x, y, zoom")
      .in("banner_key", ["jogos", "atividade", "conteudo"]);

    if (error) throw error;

    for (const row of data ?? []) {
      const bannerKey = String(row.banner_key ?? "");

      if (
        bannerKey !== "jogos" &&
        bannerKey !== "atividade" &&
        bannerKey !== "conteudo"
      ) {
        continue;
      }

      const key = bannerKey as SiteBannerKey;

      settings[key] = {
        x: Number.isFinite(Number(row.x)) ? Number(row.x) : 0,
        y: Number.isFinite(Number(row.y)) ? Number(row.y) : 0,
        zoom:
          Number.isFinite(Number(row.zoom)) && Number(row.zoom) > 0
            ? Number(row.zoom)
            : 1,
      };
    }
  } catch {
    // Em caso de indisponibilidade, o banner continua com a posição padrão.
  }

  return settings;
}

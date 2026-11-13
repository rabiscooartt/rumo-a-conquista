import "server-only";

import { unstable_cache } from "next/cache";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import type {
  SiteBannerKey,
  SiteBannerSetting,
} from "@/lib/banner-types";
import { getStoredBannerImage, withActiveFraming } from "@/lib/images/storedImages";

export const SITE_BANNER_CACHE_TAG = "site-banners";
const BANNER_CACHE_SECONDS = 60;
const BANNER_KEYS: SiteBannerKey[] = [
  "home",
  "jogos",
  "atividade",
  "conteudo",
  "reviews",
  "emblemas",
  "backlog",
];

const DEFAULT_SETTINGS: SiteBannerSetting = {
  x: 0,
  y: 0,
  zoom: 1,
  imageUrl: "",
};

export const SITE_BANNER_DEFAULTS: Record<
  SiteBannerKey,
  SiteBannerSetting
> = {
  home: { ...DEFAULT_SETTINGS },
  jogos: { ...DEFAULT_SETTINGS },
  atividade: { ...DEFAULT_SETTINGS },
  conteudo: { ...DEFAULT_SETTINGS },
  reviews: { ...DEFAULT_SETTINGS },
  emblemas: { ...DEFAULT_SETTINGS },
  backlog: { ...DEFAULT_SETTINGS },
};

async function loadSiteBannerSettings(): Promise<
  Record<SiteBannerKey, SiteBannerSetting>
> {
  const settings: Record<SiteBannerKey, SiteBannerSetting> = {
    home: { ...DEFAULT_SETTINGS },
    jogos: { ...DEFAULT_SETTINGS },
    atividade: { ...DEFAULT_SETTINGS },
    conteudo: { ...DEFAULT_SETTINGS },
    reviews: { ...DEFAULT_SETTINGS },
    emblemas: { ...DEFAULT_SETTINGS },
  backlog: { ...DEFAULT_SETTINGS },
  };

  let client: ReturnType<typeof createAdminSupabaseClient> | null = null;

  try {
    client = createAdminSupabaseClient();
    const { data, error } = await client
      .from("site_banner_settings")
      .select("banner_key, x, y, zoom")
      .in("banner_key", BANNER_KEYS);

    if (error) throw error;

    for (const row of data ?? []) {
      const key = String(row.banner_key ?? "");
      if (!BANNER_KEYS.includes(key as SiteBannerKey)) continue;

      const bannerKey = key as SiteBannerKey;
      settings[bannerKey] = {
        x: Number.isFinite(Number(row.x)) ? Number(row.x) : 0,
        y: Number.isFinite(Number(row.y)) ? Number(row.y) : 0,
        zoom:
          Number.isFinite(Number(row.zoom)) && Number(row.zoom) > 0
            ? Number(row.zoom)
            : 1,
        imageUrl: "",
      };
    }
  } catch {
    // Keep default framing if the settings table is unavailable.
  }

  if (client) {
    const imageEntries = await Promise.all(
      BANNER_KEYS.map(async (key) => [key, await getStoredBannerImage(client!, key)] as const)
    );

    // Imagem ativa e o enquadramento salvo com ela (prioridade sobre a cópia da tabela).
    for (const [key, active] of imageEntries) {
      settings[key] = { ...withActiveFraming(settings[key], active), imageUrl: active.url };
    }
  }

  return settings;
}

// O layout lê isto em toda página; sem cache, cada abertura esperava 8 consultas antes do HTML.
export const loadCachedSiteBannerSettings = unstable_cache(
  loadSiteBannerSettings,
  ["site-banner-settings"],
  { revalidate: BANNER_CACHE_SECONDS, tags: [SITE_BANNER_CACHE_TAG] }
);

import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import type {
  SiteBannerKey,
  SiteBannerSetting,
} from "@/lib/banner-types";

const BUCKET = "site-banners";
const BANNER_KEYS: SiteBannerKey[] = [
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
  jogos: { ...DEFAULT_SETTINGS },
  atividade: { ...DEFAULT_SETTINGS },
  conteudo: { ...DEFAULT_SETTINGS },
  reviews: { ...DEFAULT_SETTINGS },
  emblemas: { ...DEFAULT_SETTINGS },
  backlog: { ...DEFAULT_SETTINGS },
};

async function getStoredBannerImageUrl(
  client: ReturnType<typeof createAdminSupabaseClient>,
  bannerKey: SiteBannerKey
): Promise<string> {
  try {
    const path = `banners/${bannerKey}`;
    const { data: files, error } = await client.storage
      .from(BUCKET)
      .list(path, { limit: 20 });

    if (error || !files) return "";

    const file = files.find((item) => item.name === "background");
    if (!file) return "";

    const { data } = client.storage
      .from(BUCKET)
      .getPublicUrl(`${path}/background`);
    const version = file.updated_at || file.created_at;

    return version
      ? `${data.publicUrl}?v=${encodeURIComponent(version)}`
      : data.publicUrl;
  } catch {
    return "";
  }
}

export async function loadSiteBannerSettings(): Promise<
  Record<SiteBannerKey, SiteBannerSetting>
> {
  const settings: Record<SiteBannerKey, SiteBannerSetting> = {
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
      BANNER_KEYS.map(async (key) => [key, await getStoredBannerImageUrl(client!, key)] as const)
    );

    for (const [key, imageUrl] of imageEntries) {
      settings[key].imageUrl = imageUrl;
    }
  }

  return settings;
}

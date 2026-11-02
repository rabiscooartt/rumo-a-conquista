import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const AVATAR_BUCKET = "site-profile";
export const AVATAR_PATH = "profile/avatar";
export const AVATAR_SETTINGS_PATH = "profile/settings.json";

export type AvatarSettings = {
  x: number;
  y: number;
  zoom: number;
};

export const DEFAULT_AVATAR_SETTINGS: AvatarSettings = { x: 0, y: 0, zoom: 1 };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeAvatarSettings(input: Record<string, unknown>): AvatarSettings {
  const rawZoom = Number(input.zoom);
  const zoom = clamp(Number.isFinite(rawZoom) ? rawZoom : 1, 1, 2.5);
  const maxOffset = (zoom - 1) * 50;
  const rawX = Number(input.x);
  const rawY = Number(input.y);

  return {
    x: clamp(Number.isFinite(rawX) ? rawX : 0, -maxOffset, maxOffset),
    y: clamp(Number.isFinite(rawY) ? rawY : 0, -maxOffset, maxOffset),
    zoom,
  };
}

export async function getStoredAvatarUrl(
  client: ReturnType<typeof createAdminSupabaseClient>
): Promise<string> {
  try {
    const { data: files, error } = await client.storage
      .from(AVATAR_BUCKET)
      .list("profile", { limit: 20 });

    if (error || !files) return "";
    const avatar = files.find((file) => file.name === "avatar");
    if (!avatar) return "";

    const { data } = client.storage.from(AVATAR_BUCKET).getPublicUrl(AVATAR_PATH);
    const version = avatar.updated_at || avatar.created_at;
    return version ? `${data.publicUrl}?v=${encodeURIComponent(version)}` : data.publicUrl;
  } catch {
    return "";
  }
}

export async function getStoredAvatarSettings(
  client: ReturnType<typeof createAdminSupabaseClient>
): Promise<AvatarSettings> {
  try {
    const { data, error } = await client.storage
      .from(AVATAR_BUCKET)
      .download(AVATAR_SETTINGS_PATH);
    if (error || !data) return DEFAULT_AVATAR_SETTINGS;

    const parsed = JSON.parse(await data.text()) as Record<string, unknown>;
    return normalizeAvatarSettings(parsed);
  } catch {
    return DEFAULT_AVATAR_SETTINGS;
  }
}

export async function loadStoredAvatar() {
  const client = createAdminSupabaseClient();
  const [settings, imageUrl] = await Promise.all([
    getStoredAvatarSettings(client),
    getStoredAvatarUrl(client),
  ]);

  return { ...settings, imageUrl };
}

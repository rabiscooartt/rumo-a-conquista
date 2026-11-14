import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { getStoredAvatarImage, getStoredAvatarImageUrl } from "@/lib/images/storedImages";

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

export function getStoredAvatarUrl(
  client: ReturnType<typeof createAdminSupabaseClient>
): Promise<string> {
  // Escolhe a versão mais recente: WebP imutável (novos envios) ou o arquivo legado "avatar".
  return getStoredAvatarImageUrl(client);
}

export async function getStoredAvatarSettings(
  client: ReturnType<typeof createAdminSupabaseClient>
): Promise<AvatarSettings> {
  try {
    // Endereço único a cada leitura: o cache do Storage devolveria o enquadramento anterior após salvar.
    const { data } = client.storage.from(AVATAR_BUCKET).getPublicUrl(AVATAR_SETTINGS_PATH);
    const response = await fetch(`${data.publicUrl}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return DEFAULT_AVATAR_SETTINGS;

    const parsed = (await response.json()) as Record<string, unknown>;
    return normalizeAvatarSettings(parsed);
  } catch {
    return DEFAULT_AVATAR_SETTINGS;
  }
}

/**
 * Foto ativa e enquadramento. O enquadramento salvo com a foto ativa (no ponteiro) tem
 * prioridade sobre o settings.json, que fica como cópia de compatibilidade.
 */
export async function getStoredAvatarState(client: ReturnType<typeof createAdminSupabaseClient>) {
  const [saved, active] = await Promise.all([getStoredAvatarSettings(client), getStoredAvatarImage(client)]);
  const settings = active.framing ? normalizeAvatarSettings(active.framing) : saved;
  return { ...settings, imageUrl: active.url };
}

export async function loadStoredAvatar() {
  return getStoredAvatarState(createAdminSupabaseClient());
}

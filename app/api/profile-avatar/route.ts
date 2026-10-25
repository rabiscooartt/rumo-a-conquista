import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/lib/admin-auth";

const BUCKET = "site-profile";
const AVATAR_PATH = "profile/avatar";
const SETTINGS_PATH = "profile/settings.json";
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const ALLOWED_BUCKET_TYPES = [...ALLOWED_IMAGE_TYPES, "application/json"];
const MAX_IMAGE_SIZE = 4 * 1024 * 1024;

type AvatarSettings = {
  x: number;
  y: number;
  zoom: number;
};

const DEFAULT_SETTINGS: AvatarSettings = { x: 0, y: 0, zoom: 1 };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSettings(input: Record<string, unknown>): AvatarSettings {
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

async function isAdmin(request: NextRequest) {
  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  return verifyAdminSession(token);
}

async function ensureBucket(client: ReturnType<typeof createAdminSupabaseClient>) {
  const { data: bucket } = await client.storage.getBucket(BUCKET);
  if (bucket) return;

  const { error } = await client.storage.createBucket(BUCKET, {
    public: true,
    allowedMimeTypes: ALLOWED_BUCKET_TYPES,
    fileSizeLimit: "4MB",
  });

  if (error && !/already exists|duplicate/i.test(error.message)) {
    throw error;
  }
}

async function getStoredAvatarUrl(
  client: ReturnType<typeof createAdminSupabaseClient>
): Promise<string> {
  try {
    const { data: files, error } = await client.storage
      .from(BUCKET)
      .list("profile", { limit: 20 });

    if (error || !files) return "";
    const avatar = files.find((file) => file.name === "avatar");
    if (!avatar) return "";

    const { data } = client.storage.from(BUCKET).getPublicUrl(AVATAR_PATH);
    const version = avatar.updated_at || avatar.created_at;
    return version ? `${data.publicUrl}?v=${encodeURIComponent(version)}` : data.publicUrl;
  } catch {
    return "";
  }
}

async function getStoredSettings(
  client: ReturnType<typeof createAdminSupabaseClient>
): Promise<AvatarSettings> {
  try {
    const { data, error } = await client.storage.from(BUCKET).download(SETTINGS_PATH);
    if (error || !data) return DEFAULT_SETTINGS;

    const parsed = JSON.parse(await data.text()) as Record<string, unknown>;
    return normalizeSettings(parsed);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function GET(request: NextRequest) {
  const authenticated = await isAdmin(request);

  try {
    const client = createAdminSupabaseClient();
    const [settings, imageUrl] = await Promise.all([
      getStoredSettings(client),
      getStoredAvatarUrl(client),
    ]);

    return NextResponse.json(
      { ...settings, imageUrl, authenticated },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error) {
    console.error("[ProfileAvatar] Erro ao carregar a foto:", error);
    return NextResponse.json(
      { ...DEFAULT_SETTINGS, imageUrl: "", authenticated },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const contentType = request.headers.get("content-type") || "";
    let body: Record<string, unknown>;
    let file: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      body = {
        x: formData.get("x"),
        y: formData.get("y"),
        zoom: formData.get("zoom"),
      };
      const candidate = formData.get("file");
      if (candidate instanceof File && candidate.size > 0) file = candidate;
    } else {
      body = (await request.json()) as Record<string, unknown>;
    }

    if (file && !ALLOWED_IMAGE_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Use uma foto PNG, JPG ou WEBP." },
        { status: 415 }
      );
    }

    if (file && (file.size <= 0 || file.size > MAX_IMAGE_SIZE)) {
      return NextResponse.json(
        { error: "A foto precisa ter até 4 MB." },
        { status: 413 }
      );
    }

    const settings = normalizeSettings(body);
    const client = createAdminSupabaseClient();
    await ensureBucket(client);

    if (file) {
      const { error: uploadError } = await client.storage
        .from(BUCKET)
        .upload(AVATAR_PATH, file, {
          contentType: file.type,
          upsert: true,
          cacheControl: "60",
        });

      if (uploadError) throw uploadError;
    }

    const settingsFile = new Blob([JSON.stringify(settings)], {
      type: "application/json",
    });
    const { error: settingsError } = await client.storage
      .from(BUCKET)
      .upload(SETTINGS_PATH, settingsFile, {
        contentType: "application/json",
        upsert: true,
        cacheControl: "60",
      });

    if (settingsError) throw settingsError;

    return NextResponse.json({
      ok: true,
      ...settings,
      imageUrl: await getStoredAvatarUrl(client),
    });
  } catch (error) {
    console.error("[ProfileAvatar] Erro salvando a foto:", error);
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "Não foi possível salvar a foto do perfil.",
      },
      { status: 500 }
    );
  }
}

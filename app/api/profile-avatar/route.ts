import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/lib/admin-auth";
import {
  AVATAR_BUCKET as BUCKET,
  AVATAR_PATH,
  AVATAR_SETTINGS_PATH as SETTINGS_PATH,
  DEFAULT_AVATAR_SETTINGS as DEFAULT_SETTINGS,
  getStoredAvatarSettings as getStoredSettings,
  getStoredAvatarUrl,
  normalizeAvatarSettings as normalizeSettings,
} from "@/lib/profileAvatarStorage";

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const ALLOWED_BUCKET_TYPES = [...ALLOWED_IMAGE_TYPES, "application/json"];
const MAX_IMAGE_SIZE = 4 * 1024 * 1024;

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

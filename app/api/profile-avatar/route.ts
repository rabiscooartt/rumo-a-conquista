import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { HOME_AVATAR_CACHE_TAG } from "@/lib/homeInitialData";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/lib/admin-auth";
import {
  AVATAR_IMAGE_TARGET,
  replaceActiveImage,
  updateActiveFraming,
} from "@/lib/images/storedImages";
import {
  ImageValidationError,
  optimizationSummary,
  optimizeUploadedFile,
} from "@/lib/images/optimizeImage";
import {
  AVATAR_BUCKET as BUCKET,
  AVATAR_SETTINGS_PATH as SETTINGS_PATH,
  DEFAULT_AVATAR_SETTINGS as DEFAULT_SETTINGS,
  getStoredAvatarState,
  getStoredAvatarUrl,
  normalizeAvatarSettings as normalizeSettings,
} from "@/lib/profileAvatarStorage";

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const ALLOWED_BUCKET_TYPES = [...ALLOWED_IMAGE_TYPES, "application/json"];
const MAX_IMAGE_SIZE = 4 * 1024 * 1024;

export const runtime = "nodejs";

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
    // Foto ativa com o enquadramento salvo junto dela (prioridade sobre o settings.json).
    const state = await getStoredAvatarState(client);

    return NextResponse.json(
      { ...state, authenticated },
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

    // Cópia de compatibilidade do enquadramento (leitores antigos e avatar sem ponteiro).
    const saveFraming = async () => {
      const settingsFile = new Blob([JSON.stringify(settings)], {
        type: "application/json",
      });
      const { error: settingsError } = await client.storage
        .from(BUCKET)
        .upload(SETTINGS_PATH, settingsFile, {
          contentType: "application/json",
          upsert: true,
          cacheControl: "0",
        });
      if (settingsError) throw settingsError;
    };

    let optimization: ReturnType<typeof optimizationSummary> | null = null;
    if (file) {
      // Arquivo imutável "avatar.<hash>.webp" (reaproveitado se idêntico) e depois o
      // ponteiro, que ativa foto e enquadramento juntos. Se um dos dois falhar, a foto
      // anterior continua no ar com o enquadramento dela. O arquivo legado não é tocado.
      const optimized = await optimizeUploadedFile(file, "avatar");
      await replaceActiveImage(client, AVATAR_IMAGE_TARGET, optimized, {
        framing: settings,
        afterActivate: saveFraming,
      });
      optimization = optimizationSummary(optimized);
    } else {
      // Só o enquadramento: atualiza o ponteiro (se existir) antes da cópia de compatibilidade.
      await updateActiveFraming(client, AVATAR_IMAGE_TARGET, settings);
      await saveFraming();
    }

    revalidateTag(HOME_AVATAR_CACHE_TAG, { expire: 0 });

    return NextResponse.json({
      ok: true,
      ...settings,
      imageUrl: await getStoredAvatarUrl(client),
      optimization,
    });
  } catch (error) {
    if (error instanceof ImageValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
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

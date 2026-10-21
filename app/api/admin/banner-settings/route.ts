import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/lib/admin-auth";
import type { SiteBannerKey } from "@/lib/banner-types";

const BUCKET = "site-banners";
const VALID_BANNERS = new Set<SiteBannerKey>([
  "jogos",
  "atividade",
  "conteudo",
  "reviews",
  "emblemas",
  "backlog",
]);
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_FILE_SIZE = 4 * 1024 * 1024;

function normalize(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeSettings(input: Record<string, unknown>) {
  return {
    x: Math.max(-50, Math.min(50, normalize(input.x, 0))),
    y: Math.max(-50, Math.min(50, normalize(input.y, 0))),
    zoom: Math.max(0.8, Math.min(2, normalize(input.zoom, 1))),
  };
}

async function isAdmin(request: NextRequest) {
  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  return verifyAdminSession(token);
}

async function ensureBucket(
  client: ReturnType<typeof createAdminSupabaseClient>
) {
  const { data: bucket } = await client.storage.getBucket(BUCKET);
  if (bucket) return;

  const { error } = await client.storage.createBucket(BUCKET, {
    public: true,
    allowedMimeTypes: [...ALLOWED_TYPES],
    fileSizeLimit: "4MB",
  });

  if (error && !/already exists|duplicate/i.test(error.message)) {
    throw error;
  }
}

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

export async function GET(request: NextRequest) {
  const banner = request.nextUrl.searchParams.get("banner") || "";
  if (!VALID_BANNERS.has(banner as SiteBannerKey)) {
    return NextResponse.json({ error: "Banner inválido." }, { status: 400 });
  }

  try {
    const client = createAdminSupabaseClient();
    const bannerKey = banner as SiteBannerKey;
    const { data, error } = await client
      .from("site_banner_settings")
      .select("x, y, zoom")
      .eq("banner_key", bannerKey)
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json(
      {
        x: data?.x ?? 0,
        y: data?.y ?? 0,
        zoom: data?.zoom ?? 1,
        imageUrl: await getStoredBannerImageUrl(client, bannerKey),
        authenticated: await isAdmin(request),
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch {
    return NextResponse.json(
      {
        x: 0,
        y: 0,
        zoom: 1,
        imageUrl: "",
        authenticated: await isAdmin(request),
      },
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
        banner: String(formData.get("banner") ?? ""),
        x: formData.get("x"),
        y: formData.get("y"),
        zoom: formData.get("zoom"),
      };
      const candidate = formData.get("file");
      if (candidate instanceof File && candidate.size > 0) file = candidate;
    } else {
      body = (await request.json()) as Record<string, unknown>;
    }

    const banner = String(body.banner || "");
    if (!VALID_BANNERS.has(banner as SiteBannerKey)) {
      return NextResponse.json({ error: "Banner inválido." }, { status: 400 });
    }

    if (file && !ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Use uma imagem PNG, JPG ou WEBP." },
        { status: 415 }
      );
    }

    if (file && (file.size <= 0 || file.size > MAX_FILE_SIZE)) {
      return NextResponse.json(
        { error: "A imagem precisa ter até 4 MB." },
        { status: 413 }
      );
    }

    const bannerKey = banner as SiteBannerKey;
    const settings = normalizeSettings(body);
    const client = createAdminSupabaseClient();

    if (file) {
      await ensureBucket(client);
      const path = `banners/${bannerKey}/background`;
      const { error: uploadError } = await client.storage
        .from(BUCKET)
        .upload(path, file, {
          contentType: file.type,
          upsert: true,
          cacheControl: "60",
        });

      if (uploadError) throw uploadError;
    }

    const { error } = await client
      .from("site_banner_settings")
      .upsert(
        {
          banner_key: bannerKey,
          x: settings.x,
          y: settings.y,
          zoom: settings.zoom,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "banner_key" }
      );

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      ...settings,
      imageUrl: await getStoredBannerImageUrl(client, bannerKey),
    });
  } catch (error) {
    console.error("[BannerSettings] Erro salvando banner:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível salvar as configurações do banner.",
      },
      { status: 500 }
    );
  }
}

import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { ADMIN_SESSION_COOKIE, readAdminSessionUser, verifyAdminSession } from "@/lib/admin-auth";
import { supabaseLifecycleRpc } from "@/lib/images/lifecycle/tracked";
import { activateTrackedImage } from "@/lib/images/lifecycle/trackedPointer";
import { lifecycleErrorResponse } from "@/lib/images/lifecycle/httpErrors";
import { SITE_BANNER_CACHE_TAG } from "@/lib/site-banner-settings";
import type { SiteBannerKey } from "@/lib/banner-types";
import {
  bannerImageTarget,
  getStoredBannerImage,
  getStoredBannerUrl,
  updateActiveFraming,
  withActiveFraming,
} from "@/lib/images/storedImages";
import {
  ImageValidationError,
  optimizationSummary,
  optimizeUploadedFile,
} from "@/lib/images/optimizeImage";

export const runtime = "nodejs";

const BUCKET = "site-banners";
const VALID_BANNERS = new Set<SiteBannerKey>([
  "home",
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

function getStoredBannerImageUrl(
  client: ReturnType<typeof createAdminSupabaseClient>,
  bannerKey: SiteBannerKey
): Promise<string> {
  return getStoredBannerUrl(client, bannerKey);
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

    // Enquadramento salvo com a imagem ativa tem prioridade sobre a cópia da tabela.
    const active = await getStoredBannerImage(client, bannerKey);
    const framing = withActiveFraming(
      { x: Number(data?.x ?? 0), y: Number(data?.y ?? 0), zoom: Number(data?.zoom ?? 1) },
      active
    );

    return NextResponse.json(
      {
        ...framing,
        imageUrl: active.url,
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
  // O ator da auditoria vem da sessão validada aqui, nunca do navegador.
  const adminUser = await readAdminSessionUser(request.cookies.get(ADMIN_SESSION_COOKIE)?.value);
  if (!adminUser) {
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

    // Cópia de compatibilidade do enquadramento (leitores antigos e banners sem ponteiro).
    const saveFraming = async () => {
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
    };

    let optimization: ReturnType<typeof optimizationSummary> | null = null;
    if (file) {
      // Valida a assinatura real e converte para WebP antes de tocar no Storage.
      const optimized = await optimizeUploadedFile(file, "banner");
      await ensureBucket(client);
      // Arquivo imutável "background.<hash>.webp" (reaproveitado se idêntico) e depois o
      // ponteiro, que ativa imagem e enquadramento juntos. Se um dos dois falhar, o banner
      // anterior continua no ar com o enquadramento dele. O arquivo legado não é tocado.
      await activateTrackedImage({
        client,
        rpc: supabaseLifecycleRpc(client),
        target: bannerImageTarget(bannerKey),
        image: optimized,
        actor: `admin:${adminUser}`,
        reason: `novo banner (${bannerKey})`,
        framing: settings,
        afterActivate: saveFraming,
      });
      optimization = optimizationSummary(optimized);
    } else {
      // Só o enquadramento: atualiza o ponteiro (se existir) antes da cópia da tabela.
      await updateActiveFraming(client, bannerImageTarget(bannerKey), settings);
      await saveFraming();
    }

    revalidateTag(SITE_BANNER_CACHE_TAG, { expire: 0 });

    return NextResponse.json({
      ok: true,
      ...settings,
      imageUrl: await getStoredBannerImageUrl(client, bannerKey),
      optimization,
    });
  } catch (error) {
    if (error instanceof ImageValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    // Ciclo de vida: mensagens com o motivo e o que fazer (pendências, colisão, ativação em aberto).
    const lifecycle = lifecycleErrorResponse(error);
    if (lifecycle) return NextResponse.json(lifecycle.body, { status: lifecycle.status });
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

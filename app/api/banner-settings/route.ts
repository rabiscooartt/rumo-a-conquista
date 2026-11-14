import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/lib/admin-auth";
import type { SiteBannerKey } from "@/lib/banner-types";
import { getStoredBannerImage, withActiveFraming } from "@/lib/images/storedImages";

const VALID_BANNERS = new Set<SiteBannerKey>([
  "home",
  "jogos",
  "atividade",
  "conteudo",
  "reviews",
  "emblemas",
  "backlog",
]);

export async function GET(request: NextRequest) {
  const banner = request.nextUrl.searchParams.get("banner") || "";

  if (!VALID_BANNERS.has(banner as SiteBannerKey)) {
    return NextResponse.json({ error: "Banner inválido." }, { status: 400 });
  }

  const bannerKey = banner as SiteBannerKey;
  let settings = { x: 0, y: 0, zoom: 1, imageUrl: "" };

  try {
    const client = createAdminSupabaseClient();
    try {
      const { data, error } = await client
        .from("site_banner_settings")
        .select("x, y, zoom")
        .eq("banner_key", bannerKey)
        .maybeSingle();

      if (error) throw error;

      settings = {
        x: Number.isFinite(Number(data?.x)) ? Number(data?.x ?? 0) : 0,
        y: Number.isFinite(Number(data?.y)) ? Number(data?.y ?? 0) : 0,
        zoom:
          Number.isFinite(Number(data?.zoom)) && Number(data?.zoom) > 0
            ? Number(data?.zoom)
            : 1,
        imageUrl: "",
      };
    } catch (error) {
      console.error("[BannerSettings] Erro ao ler posição:", error);
    }

    // Imagem ativa e o enquadramento salvo com ela (prioridade sobre a cópia da tabela).
    const active = await getStoredBannerImage(client, bannerKey);
    settings = { ...withActiveFraming(settings, active), imageUrl: active.url };
  } catch (error) {
    console.error("[BannerSettings] Erro ao carregar configuração:", error);
  }

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const authenticated = await verifyAdminSession(token);

  return NextResponse.json(
    { ...settings, authenticated },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/lib/admin-auth";

const VALID_BANNERS = new Set(["jogos", "atividade", "conteudo"]);

export async function GET(request: NextRequest) {
  const banner = request.nextUrl.searchParams.get("banner") || "";

  if (!VALID_BANNERS.has(banner)) {
    return NextResponse.json(
      { error: "Banner inválido." },
      { status: 400 }
    );
  }

  let settings = {
    x: 0,
    y: 0,
    zoom: 1,
  };

  try {
    const client = createAdminSupabaseClient();

    const { data, error } = await client
      .from("site_banner_settings")
      .select("x, y, zoom")
      .eq("banner_key", banner)
      .maybeSingle();

    if (error) throw error;

    settings = {
      x: Number(data?.x ?? 0),
      y: Number(data?.y ?? 0),
      zoom: Number(data?.zoom ?? 1),
    };
  } catch (error) {
    console.error("[BannerSettings] Erro ao ler configuração:", error);
  }

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const authenticated = await verifyAdminSession(token);

  return NextResponse.json(
    {
      ...settings,
      authenticated,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}

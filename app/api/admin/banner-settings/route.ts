import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/lib/admin-auth";

const VALID_BANNERS = new Set(["jogos", "atividade", "conteudo"]);

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

export async function GET(request: NextRequest) {
  const banner = request.nextUrl.searchParams.get("banner") || "";
  if (!VALID_BANNERS.has(banner)) {
    return NextResponse.json({ error: "Banner inválido." }, { status: 400 });
  }

  try {
    const client = createAdminSupabaseClient();
    const { data, error } = await client
      .from("site_banner_settings")
      .select("x, y, zoom")
      .eq("banner_key", banner)
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json(
      {
        x: data?.x ?? 0,
        y: data?.y ?? 0,
        zoom: data?.zoom ?? 1,
        authenticated: await isAdmin(request),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      {
        x: 0,
        y: 0,
        zoom: 1,
        authenticated: await isAdmin(request),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const banner = String(body.banner || "");

    if (!VALID_BANNERS.has(banner)) {
      return NextResponse.json({ error: "Banner inválido." }, { status: 400 });
    }

    const settings = normalizeSettings(body);
    const client = createAdminSupabaseClient();

    const { error } = await client
      .from("site_banner_settings")
      .upsert(
        {
          banner_key: banner,
          x: settings.x,
          y: settings.y,
          zoom: settings.zoom,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "banner_key" }
      );

    if (error) throw error;

    return NextResponse.json({ ok: true, ...settings });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível salvar as configurações.",
      },
      { status: 500 }
    );
  }
}

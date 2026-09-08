import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  SESSION_MAX_AGE,
  createAdminSession,
  getAdminCredentials,
} from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  const { user: adminUser, password: adminPassword } = getAdminCredentials();

  if (!adminUser || !adminPassword) {
    return NextResponse.json(
      { ok: false, error: "Admin não configurado." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const body = (await request.json()) as {
      user?: unknown;
      password?: unknown;
    };

    const user = String(body.user ?? "");
    const password = String(body.password ?? "");

    if (user !== adminUser || password !== adminPassword) {
      return NextResponse.json(
        { ok: false, error: "Usuário ou senha inválidos." },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    const token = await createAdminSession();
    const response = NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } }
    );

    response.cookies.set({
      name: ADMIN_SESSION_COOKIE,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });

    return response;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Não foi possível processar o login." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}

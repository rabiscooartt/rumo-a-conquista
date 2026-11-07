import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  SESSION_MAX_AGE,
  constantTimeEqual,
  createAdminSession,
  getAdminCredentials,
} from "@/lib/admin-auth";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_FIELD_LENGTH = 256;
// Cada tentativa errada espera um pouco antes de responder, o que torna adivinhações em massa lentas
// sem nunca bloquear o proprietário. O limite por IP fica a cargo da regra do Vercel Firewall.
const FAILED_LOGIN_DELAY_MS = 900;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rejectLogin() {
  await wait(FAILED_LOGIN_DELAY_MS);
  return NextResponse.json(
    { ok: false, error: "Usuário ou senha inválidos." },
    { status: 401, headers: NO_STORE }
  );
}

export async function POST(request: NextRequest) {
  const { user: adminUser, password: adminPassword } = getAdminCredentials();

  if (!adminUser || !adminPassword) {
    return NextResponse.json(
      { ok: false, error: "Admin não configurado." },
      { status: 500, headers: NO_STORE }
    );
  }

  let body: { user?: unknown; password?: unknown };
  try {
    body = (await request.json()) as { user?: unknown; password?: unknown };
  } catch {
    return NextResponse.json(
      { ok: false, error: "Não foi possível processar o login." },
      { status: 400, headers: NO_STORE }
    );
  }

  const user = typeof body.user === "string" ? body.user : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!user || !password || user.length > MAX_FIELD_LENGTH || password.length > MAX_FIELD_LENGTH) {
    return rejectLogin();
  }

  // As duas comparações sempre rodam, para que o tempo não indique qual campo estava certo.
  const [userMatches, passwordMatches] = await Promise.all([
    constantTimeEqual(user, adminUser),
    constantTimeEqual(password, adminPassword),
  ]);

  if (!userMatches || !passwordMatches) {
    console.warn("[Admin] Tentativa de login recusada.");
    return rejectLogin();
  }

  const token = await createAdminSession();
  const response = NextResponse.json({ ok: true }, { headers: NO_STORE });

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
}

import "server-only";

import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, readAdminSessionUser, verifyAdminSession } from "@/lib/admin-auth";

function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return undefined;
}

/**
 * Igual a rejectUnlessAdmin, mas devolve também o ator para a auditoria, derivado SÓ da sessão
 * validada no backend (nunca de um valor enviado pelo navegador).
 */
export async function requireAdminActor(request: Request): Promise<{ denied: NextResponse; actor?: undefined } | { denied?: undefined; actor: string }> {
  const user = await readAdminSessionUser(readCookie(request, ADMIN_SESSION_COOKIE));
  if (user) return { actor: `admin:${user}` };
  return {
    denied: NextResponse.json(
      { ok: false, error: "Área restrita do Rumo à Conquista." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    ),
  };
}

// Segunda verificação, dentro da própria rota, para não depender só do proxy.
export async function rejectUnlessAdmin(request: Request) {
  const authenticated = await verifyAdminSession(readCookie(request, ADMIN_SESSION_COOKIE));
  if (authenticated) return null;

  return NextResponse.json(
    { ok: false, error: "Área restrita do Rumo à Conquista." },
    { status: 401, headers: { "Cache-Control": "no-store" } }
  );
}

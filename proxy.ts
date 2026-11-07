import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  isCrossSiteWrite,
  verifyAdminSession,
} from "@/lib/admin-auth";

// Cópia antiga da sincronização do Admin que ficou fora de /api/admin: exige a mesma sessão.
const LEGACY_ADMIN_API_PREFIX = "/api/youtube/channel/games";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  const isAdminPage = pathname.startsWith("/admin");
  const isAdminApi =
    pathname.startsWith("/api/admin") || pathname.startsWith(LEGACY_ADMIN_API_PREFIX);

  if (!isAdminPage && !isAdminApi) {
    return NextResponse.next();
  }

  // Escritas administrativas, inclusive login e logout, só valem a partir de páginas do próprio site.
  if (isCrossSiteWrite(request)) {
    return new NextResponse("Origem não permitida.", {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }

  // Os endpoints de autenticação precisam ficar públicos para que o login
  // possa criar a sessão antes de qualquer outra chamada administrativa.
  const isAuthEndpoint =
    pathname === "/api/admin/auth/login" ||
    pathname === "/api/admin/auth/logout" ||
    pathname === "/api/admin/auth/status";

  // A Biblioteca pode ler o mapa de gêneros via GET. A busca de títulos
  // arbitrários via POST permanece protegida pela sessão administrativa.
  const isPublicGenreEndpoint =
    pathname === "/api/admin/games/genres" && request.method === "GET";

  if (isAuthEndpoint || isPublicGenreEndpoint) {
    return NextResponse.next();
  }

  const adminUser = process.env.ADMIN_USER;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminUser || !adminPassword) {
    return new NextResponse(
      "Admin não configurado. Defina ADMIN_USER e ADMIN_PASSWORD.",
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const authenticated = await verifyAdminSession(token);

  if (authenticated) {
    return NextResponse.next();
  }

  // Navegação direta para uma área administrativa leva o criador ao site
  // público, onde o login global pode ser aberto automaticamente.
  if (isAdminPage) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/";
    loginUrl.search = "";
    loginUrl.searchParams.set("adminLogin", "1");
    loginUrl.searchParams.set("next", pathname);

    return NextResponse.redirect(loginUrl);
  }

  return new NextResponse("Área restrita do Rumo à Conquista.", {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*", "/api/youtube/channel/games/:path*"],
};

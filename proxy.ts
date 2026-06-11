import { NextRequest, NextResponse } from "next/server";

const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function unauthorizedResponse() {
  return new NextResponse("Área restrita do Rumo à Conquista.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Rumo a Conquista Admin"',
      "Cache-Control": "no-store",
    },
  });
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (!pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  if (!ADMIN_USER || !ADMIN_PASSWORD) {
    return new NextResponse(
      "Admin não configurado. Defina ADMIN_USER e ADMIN_PASSWORD.",
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const authHeader = request.headers.get("authorization");

  if (!authHeader) {
    return unauthorizedResponse();
  }

  const [scheme, encodedCredentials] = authHeader.split(" ");

  if (scheme !== "Basic" || !encodedCredentials) {
    return unauthorizedResponse();
  }

  try {
    const decodedCredentials = atob(encodedCredentials);
    const separatorIndex = decodedCredentials.indexOf(":");

    if (separatorIndex === -1) {
      return unauthorizedResponse();
    }

    const user = decodedCredentials.slice(0, separatorIndex);
    const password = decodedCredentials.slice(separatorIndex + 1);

    if (user === ADMIN_USER && password === ADMIN_PASSWORD) {
      return NextResponse.next();
    }

    return unauthorizedResponse();
  } catch {
    return unauthorizedResponse();
  }
}

export const config = {
  matcher: ["/admin/:path*"],
};
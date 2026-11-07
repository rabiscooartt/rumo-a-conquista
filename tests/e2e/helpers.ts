import { createHmac } from "node:crypto";
import type { Page } from "@playwright/test";

export const ADMIN_COOKIE = "rumo_admin_session";

export function testCredentials() {
  return {
    user: process.env.E2E_ADMIN_USER ?? "",
    password: process.env.E2E_ADMIN_PASSWORD ?? "",
  };
}

// Monta um token no mesmo formato do servidor para testar expiração e adulteração.
export function signTestSession(payload: Record<string, unknown>, secret = process.env.E2E_SESSION_SECRET ?? "") {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

// Rotas GET que podem gravar no banco (correções automáticas legadas). Os testes nunca as executam.
const GET_ROUTES_WITH_WRITES = ["/api/games/data", "/api/admin/games/genres"];
const ADMIN_GAMES_PATH = "/api/admin/games";

// Os testes só leem: qualquer escrita disparada pela página é cancelada antes de sair do navegador.
// A lista do Admin é servida a partir do catálogo público, para não acionar o GET que corrige dados.
export async function blockWrites(page: Page) {
  const blocked: string[] = [];
  let catalogBody: Promise<string> | undefined;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const isAuth = /^\/api\/admin\/auth\/(login|logout)$/.test(url.pathname);
    const isSafeMethod = method === "GET" || method === "HEAD" || method === "OPTIONS";
    if ((!isSafeMethod && !isAuth) || GET_ROUTES_WITH_WRITES.includes(url.pathname)) {
      blocked.push(`${method} ${url.pathname}`);
      return route.abort("blockedbyclient");
    }
    try {
      if (url.pathname === ADMIN_GAMES_PATH) {
        catalogBody ??= page.request.get("/api/games/catalog?achievements=1").then((response) => response.text());
        return await route.fulfill({ status: 200, contentType: "application/json", body: await catalogBody });
      }
      return await route.continue();
    } catch {
      // A página foi fechada no meio da resposta; nada a fazer.
    }
  });
  return blocked;
}

export function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`exceção: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // Recursos externos bloqueados pelo navegador em localhost (ex.: avatares do YouTube) não são erros do site.
    if (/ERR_BLOCKED_BY_ORB|net::ERR_BLOCKED_BY_CLIENT/.test(text)) return;
    errors.push(text);
  });
  return errors;
}

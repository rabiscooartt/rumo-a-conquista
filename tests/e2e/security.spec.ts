import { expect, test } from "@playwright/test";
import { ADMIN_COOKIE, signTestSession, testCredentials } from "./helpers";

// Nenhum destes testes grava dados: as escritas sem sessão são recusadas antes de chegar às rotas,
// e com sessão válida só são feitas leituras.

const ADMIN_PAGES = ["/admin/jogos", "/admin/jornada", "/admin/backlog", "/admin/sagas", "/admin/sorteio-jogos", "/admin/preparar-jogo"];
const ADMIN_READS = ["/api/admin/games", "/api/admin/games/sync", "/api/admin/achievement-reference", "/api/admin/final-mastery-references", "/api/youtube/channel/games/sync"];
const ADMIN_WRITES: Array<[string, string]> = [
  ["POST", "/api/admin/games"],
  ["PUT", "/api/admin/games"],
  ["DELETE", "/api/admin/games"],
  ["POST", "/api/admin/games/sync"],
  ["POST", "/api/admin/achievement-records"],
  ["POST", "/api/admin/banner-settings"],
  ["POST", "/api/admin/games/genres"],
  ["POST", "/api/youtube/channel/games/sync"],
  ["PUT", "/api/youtube/channel/games/sync"],
  ["DELETE", "/api/youtube/channel/games/sync"],
  ["PUT", "/admin/api/achievements"],
  ["POST", "/admin/api/jornada"],
];

test.describe("visitante", () => {
  for (const path of ADMIN_PAGES) {
    test(`${path} leva ao login sem mostrar o painel`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(307);
      const location = new URL(response.headers().location, "http://localhost");
      expect(location.pathname).toBe("/");
      expect(location.searchParams.get("adminLogin")).toBe("1");
      expect(location.searchParams.get("next")).toBe(path);
    });
  }

  for (const path of ADMIN_READS) {
    test(`GET ${path} exige sessão`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(401);
      expect(await response.text()).not.toMatch(/supabase|service_role|stack/i);
    });
  }

  for (const [method, path] of ADMIN_WRITES) {
    test(`${method} ${path} exige sessão`, async ({ request }) => {
      const response = await request.fetch(path, { method, data: {}, maxRedirects: 0 });
      // Rotas em /admin redirecionam para o login; as demais respondem 401.
      expect([401, 307]).toContain(response.status());
    });
  }

  test("status informa visitante como não autenticado", async ({ request }) => {
    const response = await request.get("/api/admin/auth/status");
    expect(await response.json()).toEqual({ authenticated: false });
    expect(response.headers()["cache-control"]).toContain("no-store");
  });
});

test.describe("login", () => {
  test("senha errada é recusada, com atraso e sem cookie", async ({ request }) => {
    const { user } = testCredentials();
    const started = Date.now();
    const response = await request.post("/api/admin/auth/login", { data: { user, password: "senha-errada" } });
    expect(response.status()).toBe(401);
    expect(Date.now() - started).toBeGreaterThanOrEqual(800);
    expect(response.headers()["set-cookie"] ?? "").not.toContain(ADMIN_COOKIE);
    expect(await response.json()).toEqual({ ok: false, error: "Usuário ou senha inválidos." });
  });

  test("usuário errado, campos ausentes e campos enormes são recusados", async ({ request }) => {
    const { password } = testCredentials();
    for (const data of [{ user: "outro", password }, {}, { user: ["x"], password: ["y"] }, { user: "a".repeat(5000), password: "b".repeat(5000) }]) {
      const response = await request.post("/api/admin/auth/login", { data });
      expect(response.status()).toBe(401);
    }
  });

  test("corpo inválido não expõe detalhes internos", async ({ request }) => {
    const response = await request.post("/api/admin/auth/login", { data: Buffer.from("{quebrado"), headers: { "Content-Type": "application/json" } });
    expect(response.status()).toBe(400);
    expect(await response.text()).not.toMatch(/SyntaxError|at |stack/);
  });

  test("login vindo de outro site é bloqueado", async ({ request }) => {
    const response = await request.post("/api/admin/auth/login", {
      data: testCredentials(),
      headers: { Origin: "https://site-malicioso.example" },
    });
    expect(response.status()).toBe(403);
    expect(response.headers()["set-cookie"] ?? "").not.toContain(ADMIN_COOKIE);
  });

  test("login válido cria sessão protegida, libera leitura e o logout encerra", async ({ request, baseURL }) => {
    const login = await request.post("/api/admin/auth/login", { data: testCredentials(), headers: { Origin: baseURL! } });
    expect(login.status()).toBe(200);
    const cookie = login.headers()["set-cookie"] ?? "";
    expect(cookie).toContain(`${ADMIN_COOKIE}=`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);

    expect(await (await request.get("/api/admin/auth/status")).json()).toEqual({ authenticated: true });
    // Só leitura: /api/admin/games não é chamado com sessão porque o GET dele pode corrigir dados.
    expect((await request.get("/api/admin/final-mastery-references")).status()).not.toBe(401);
    expect((await request.get("/admin/jogos", { maxRedirects: 0 })).status()).toBe(200);

    // Escrita administrativa com sessão, mas disparada de outro site, é barrada antes da rota.
    const crossSite = await request.post("/api/admin/games", { data: {}, headers: { Origin: "https://site-malicioso.example" } });
    expect(crossSite.status()).toBe(403);

    const logout = await request.post("/api/admin/auth/logout", { headers: { Origin: baseURL! } });
    expect(logout.status()).toBe(200);
    expect(logout.headers()["set-cookie"] ?? "").toMatch(/Max-Age=0/i);
    expect(await (await request.get("/api/admin/auth/status")).json()).toEqual({ authenticated: false });
    expect((await request.get("/api/admin/final-mastery-references")).status()).toBe(401);
  });
});

test.describe("sessão", () => {
  const user = () => testCredentials().user;
  const now = () => Math.floor(Date.now() / 1000);

  async function statusWith(request: import("@playwright/test").APIRequestContext, token: string) {
    const response = await request.get("/api/admin/auth/status", { headers: { Cookie: `${ADMIN_COOKIE}=${token}` } });
    return (await response.json()).authenticated;
  }

  test("token válido é aceito", async ({ request }) => {
    expect(await statusWith(request, signTestSession({ user: user(), exp: now() + 600, nonce: "a" }))).toBe(true);
  });

  test("sessão expirada é recusada", async ({ request }) => {
    expect(await statusWith(request, signTestSession({ user: user(), exp: now() - 1, nonce: "b" }))).toBe(false);
  });

  test("token assinado com outro segredo é recusado", async ({ request }) => {
    expect(await statusWith(request, signTestSession({ user: user(), exp: now() + 600 }, "segredo-falso"))).toBe(false);
  });

  test("token adulterado é recusado", async ({ request }) => {
    const valid = signTestSession({ user: user(), exp: now() + 600 });
    const [, signature] = valid.split(".");
    const forged = Buffer.from(JSON.stringify({ user: user(), exp: now() + 999999 })).toString("base64url");
    expect(await statusWith(request, `${forged}.${signature}`)).toBe(false);
  });

  test("token de outro usuário é recusado", async ({ request }) => {
    expect(await statusWith(request, signTestSession({ user: "intruso", exp: now() + 600 }))).toBe(false);
  });

  test("lixo no cookie é recusado", async ({ request }) => {
    for (const token of ["", "abc", "a.b", ".", "x".repeat(4000)]) {
      expect(await statusWith(request, token)).toBe(false);
    }
  });
});

test("cabeçalhos de segurança estão presentes", async ({ request }) => {
  const headers = (await request.get("/")).headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'self'");
  expect(headers["x-powered-by"]).toBeUndefined();
});

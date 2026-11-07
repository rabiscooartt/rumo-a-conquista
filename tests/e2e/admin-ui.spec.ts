import { expect, test } from "@playwright/test";
import { blockWrites, testCredentials } from "./helpers";

const PUBLIC_PAGES = ["/", "/biblioteca", "/atividade", "/sagas", "/reviews", "/conteudo", "/games/mouse-p-i-for-hire"];

test.describe("avatar e entradas do Admin para visitantes", () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path} não oferece acesso administrativo`, async ({ page }) => {
      await blockWrites(page);
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      const header = page.locator("header").first();
      const avatar = header.getByRole("img", { name: "Avatar do canal" });
      await expect(avatar).toBeVisible();
      // O avatar é só imagem: nenhum botão ou link o envolve.
      expect(await avatar.evaluate((node) => Boolean(node.closest("button, a")))).toBe(false);

      await expect(page.getByRole("button", { name: /entrar/i })).toHaveCount(0);
      await expect(page.getByText(/modo administrador|acesso administrativo|entrar no admin/i)).toHaveCount(0);
      await expect(page.getByRole("link", { name: /administração|banco de jogos/i })).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });
  }

  test("o menu do perfil mostra só o perfil para visitantes", async ({ page }) => {
    await blockWrites(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Abrir menu do perfil" }).click();
    await expect(page.getByRole("link", { name: "Meu perfil" })).toBeVisible();
    await expect(page.getByText(/admin/i)).toHaveCount(0);
  });

  test("o menu móvel não convida para o Admin", async ({ page }) => {
    await blockWrites(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
    const menu = page.locator("#rac-mobile-navigation");
    await expect(menu).toBeVisible();
    await expect(menu.getByText(/admin|avatar/i)).toHaveCount(0);
  });
});

test.describe("fluxo do proprietário", () => {
  test("/admin abre o login, recusa senha errada e entra com a correta", async ({ page }) => {
    await blockWrites(page);
    await page.goto("/admin/jogos");
    await expect(page).toHaveURL(/\/\?adminLogin=1&next=%2Fadmin%2Fjogos/);

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const { user, password } = testCredentials();
    await dialog.getByLabel("Usuário").fill(user);
    await dialog.getByLabel("Senha").fill("senha-errada");
    await dialog.getByRole("button", { name: "Entrar" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Usuário ou senha inválidos.");

    await dialog.getByLabel("Senha").fill(password);
    await dialog.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/admin\/jogos$/);
  });

  test("com sessão, o avatar abre as opções do Admin e permite sair", async ({ page, baseURL }) => {
    await blockWrites(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    const login = await page.request.post("/api/admin/auth/login", { data: testCredentials(), headers: { Origin: baseURL! } });
    expect(login.ok()).toBe(true);

    await page.goto("/");
    const avatarButton = page.getByRole("button", { name: "Abrir opções do Admin" });
    await expect(avatarButton).toBeVisible();
    await avatarButton.click();
    await expect(page.getByRole("link", { name: /Administração de jogos/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Banco de jogos/ }).first()).toBeVisible();

    await page.getByRole("button", { name: "Sair do modo Admin" }).click();
    await expect(page.getByRole("img", { name: "Avatar do canal" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir opções do Admin" })).toHaveCount(0);
    expect(await (await page.request.get("/api/admin/auth/status")).json()).toEqual({ authenticated: false });
  });

  test("com sessão, a Atividade mostra Sair e nunca Entrar", async ({ page, baseURL }) => {
    await blockWrites(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.request.post("/api/admin/auth/login", { data: testCredentials(), headers: { Origin: baseURL! } });
    await page.goto("/atividade");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: /^\s*↪?\s*Sair$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^entrar$/i })).toHaveCount(0);
  });
});

import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { blockWrites } from "./helpers";

// Regressão de imagens: quando existe cópia leve (WebP no tamanho de exibição), a página
// não pode baixar o original pesado. Roda contra o build local; nada é enviado a buckets.
const variants: Record<string, string> = JSON.parse(readFileSync("data/homeImageVariants.json", "utf8"));
const originalsWithLightCopy = new Set(
  Object.keys(variants).map((source) => source.replace(/#large$/, ""))
);

const PAGES = [
  "/",
  "/biblioteca",
  "/atividade",
  "/sagas",
  "/games/mouse-p-i-for-hire",
  "/games/hades",
  "/games/crisol-theater-of-idols",
];

async function collectImageRequests(page: Page, path: string) {
  const requested: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "image") requested.push(request.url());
  });
  await page.goto(path, { waitUntil: "load" });
  // Rola até o fim para disparar as imagens com loading="lazy".
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  return requested;
}

for (const path of PAGES) {
  test(`imagens leves em ${path}`, async ({ page, baseURL }) => {
    await blockWrites(page);
    const requested = await collectImageRequests(page, path);

    const heavyOriginals = requested
      .map((url) => new URL(url))
      .filter((url) => url.origin === new URL(baseURL!).origin)
      .map((url) => decodeURIComponent(url.pathname))
      .filter((pathname) => originalsWithLightCopy.has(pathname));
    expect(heavyOriginals, "originais baixados apesar de existir cópia leve").toEqual([]);

    // Supabase está isolado neste teste: URLs remotas que tenham cópia leve também não podem aparecer.
    const remoteWithCopy = requested.filter((url) => originalsWithLightCopy.has(url));
    expect(remoteWithCopy).toEqual([]);

    // Nenhuma cópia leve quebrada: toda <img> que aponta para /images/home ou /images/game-page carregou.
    const broken = await page.evaluate(() =>
      Array.from(document.images)
        .filter((image) => /\/images\/(home|game-page)\//.test(image.currentSrc || image.src))
        .filter((image) => image.complete && image.naturalWidth === 0)
        .map((image) => image.currentSrc || image.src)
    );
    expect(broken).toEqual([]);
  });
}

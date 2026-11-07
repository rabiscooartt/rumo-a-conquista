import { expect, test, type Page } from "@playwright/test";
import { blockWrites, collectConsoleErrors, testCredentials } from "./helpers";

export const WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440];

const PUBLIC_ROUTES = [
  "/",
  "/biblioteca",
  "/atividade",
  "/sagas",
  "/reviews",
  "/conteudo",
  "/perfil",
  "/historico",
  "/games/mouse-p-i-for-hire",
  "/games/mouse-p-i-for-hire/review",
  "/games/monster-hunter-world-iceborne",
];

// Artes que os dados citam mas ainda não existem no projeto (pendência conhecida; a tela já esconde a falha).
// As sagas padrão de data/sagas.ts apontam para /images/sagas/<saga>/badge.jpg, ainda não desenhadas.
const KNOWN_MISSING_ASSETS = [
  "/images/games/monster-hunter-world-iceborne/achievements/equipe-seu-primeiro-pingente-dlc-iceborne.png",
];
const KNOWN_MISSING_PATTERN = /^\/images\/sagas\/[a-z0-9-]+\/badge\.jpg$/;

const ADMIN_ROUTES = ["/admin/jogos", "/admin/jornada", "/admin/backlog", "/admin/sagas", "/admin/sorteio-jogos"];

type LayoutReport = {
  overflow: number;
  cut: string[];
  broken: string[];
  smallTargets: string[];
  tinyText: string[];
};

// Mede o que um visitante sentiria: rolagem lateral, elementos para fora da tela, imagens quebradas,
// áreas de toque pequenas e textos minúsculos. Elementos dentro de áreas com rolagem própria são ignorados.
async function measure(page: Page, width: number): Promise<LayoutReport> {
  return page.evaluate((viewport) => {
    const doc = document.documentElement;
    const scrollsOrClips = (el: Element | null) => {
      for (let node = el?.parentElement; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) return true;
      }
      return false;
    };
    const describe = (el: Element) => {
      const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
      const cls = typeof el.className === "string" ? el.className.split(" ").slice(0, 3).join(".") : "";
      return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}${text ? ` "${text}"` : ""}`;
    };
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0;
    };

    const cut: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      if (!visible(el)) continue;
      const rect = el.getBoundingClientRect();
      if ((rect.right > viewport + 1 || rect.left < -1) && !scrollsOrClips(el) && getComputedStyle(el).position !== "fixed") {
        cut.push(`${describe(el)} [${Math.round(rect.left)}→${Math.round(rect.right)}]`);
      }
    }

    const broken = Array.from(document.images)
      // Avatares do YouTube (yt3.ggpht.com) são recusados pelo próprio Google quando a página vem de localhost.
      .filter((img) => img.complete && img.naturalWidth === 0 && img.getBoundingClientRect().width > 0 && img.loading !== "lazy" && !img.src.includes("ggpht.com"))
      .map((img) => img.getAttribute("src") || "");

    const smallTargets: string[] = [];
    if (viewport < 768) {
      for (const el of Array.from(document.querySelectorAll("a[href], button, [role=button], input, select"))) {
        if (!visible(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight * 3) continue;
        if (rect.width < 24 || rect.height < 24) smallTargets.push(`${describe(el)} ${Math.round(rect.width)}×${Math.round(rect.height)}`);
      }
    }

    const tinyText: string[] = [];
    if (viewport < 768) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!parent || !(node.textContent || "").trim() || !visible(parent)) continue;
        const size = parseFloat(getComputedStyle(parent).fontSize);
        if (size < 9) tinyText.push(`${describe(parent)} ${size}px`);
      }
    }

    return {
      overflow: doc.scrollWidth - doc.clientWidth,
      cut: Array.from(new Set(cut)).slice(0, 12),
      broken,
      smallTargets: Array.from(new Set(smallTargets)).slice(0, 15),
      tinyText: Array.from(new Set(tinyText)).slice(0, 15),
    };
  }, width);
}

async function checkRoute(page: Page, path: string) {
  const errors = collectConsoleErrors(page);
  const failedResponses: string[] = [];
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    const known = KNOWN_MISSING_ASSETS.includes(pathname) || KNOWN_MISSING_PATTERN.test(pathname);
    if (response.status() >= 400 && !known) failedResponses.push(`${response.status()} ${pathname}`);
  });
  const blocked = await blockWrites(page);
  await page.setViewportSize({ width: WIDTHS[0], height: 800 });
  const response = await page.goto(path, { waitUntil: "networkidle" });
  expect(response?.status(), `${path} respondeu`).toBeLessThan(400);

  const problems: string[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
    await page.waitForTimeout(350);
    const report = await measure(page, width);
    if (report.overflow > 1) problems.push(`${width}px: rolagem lateral de ${report.overflow}px`);
    if (report.cut.length) problems.push(`${width}px: fora da tela → ${report.cut.join(" | ")}`);
    if (report.broken.length) problems.push(`${width}px: imagens quebradas → ${report.broken.join(", ")}`);
    // Toque e tamanho de texto são registrados como observação, sem reprovar o teste.
    if (report.smallTargets.length) test.info().annotations.push({ type: `toque ${width}px`, description: report.smallTargets.join(" | ") });
    if (report.tinyText.length) test.info().annotations.push({ type: `texto <9px ${width}px`, description: report.tinyText.join(" | ") });
  }
  test.info().annotations.push({ type: "escritas bloqueadas", description: blocked.join(", ") || "nenhuma" });
  expect(problems, problems.join("\n")).toEqual([]);
  expect(failedResponses, failedResponses.join("\n")).toEqual([]);
  // A mensagem genérica de recurso com erro já é coberta pela lista de respostas acima.
  const otherErrors = errors.filter((message) => !/^Failed to load resource/.test(message));
  expect(otherErrors, otherErrors.join("\n")).toEqual([]);
}

test.describe("layout público", () => {
  for (const path of PUBLIC_ROUTES) {
    test(`${path} em ${WIDTHS.join(", ")}px`, async ({ page }) => {
      await checkRoute(page, path);
    });
  }
});

test.describe("layout do Admin", () => {
  for (const path of ADMIN_ROUTES) {
    test(`${path} em ${WIDTHS.join(", ")}px`, async ({ page, baseURL }) => {
      const login = await page.request.post("/api/admin/auth/login", { data: testCredentials(), headers: { Origin: baseURL! } });
      expect(login.ok()).toBe(true);
      await checkRoute(page, path);
    });
  }
});

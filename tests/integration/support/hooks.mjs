// Carregador dos testes de integração: resolve "@/..." como o tsconfig do Next; "server-only" vazio;
// next/cache, next/headers e os módulos de cache da home substituídos por versões mínimas (fora do
// Next não há cache de renderização). Rotas da versão de referência (baseline), extraídas do git
// pelo executor em <tmp>/head-routes/, resolvem pacotes a partir do repositório.
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
const repo = process.env.REPO;
const headDir = process.env.HEAD_DIR;
const data = (src) => ({ url: "data:text/javascript," + encodeURIComponent(src), shortCircuit: true });
export async function resolve(specifier, context, next) {
  // Arquivos HEAD ficam fora do repositório: pacotes resolvidos a partir do repositório.
  const parent = context.parentURL ? decodeURIComponent(context.parentURL).split("\\").join("/") : "";
  const bare = !(specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("@/") || /^(node|data|file):/.test(specifier));
  if (headDir && parent.includes("/head-routes/") && bare) {
    context = { ...context, parentURL: pathToFileURL(`${repo}/package.json`).href };
  }
  if (specifier === "next/server") return next("next/server.js", context);
  if (specifier === "server-only") return data("export{}");
  if (specifier === "next/headers") return data("export async function cookies(){return {get:(n)=>{const v=(globalThis.__cookies??{})[n];return v===undefined?undefined:{name:n,value:v};}};}");
  if (specifier === "next/cache") return data("export function revalidateTag(tag){(globalThis.__revalidated??=[]).push(tag)} export function revalidatePath(){} export function unstable_cache(fn){return fn}");
  if (specifier === "@/lib/site-banner-settings") return data(`export const SITE_BANNER_CACHE_TAG = "site-banners";`);
  if (specifier === "@/lib/homeInitialData") return data(`export const HOME_CATALOG_CACHE_TAG = ${JSON.stringify(process.env.HOME_TAG)}; export const HOME_AVATAR_CACHE_TAG = "home-avatar";`);
  if (specifier.startsWith("@/")) {
    const base = `${repo}/${specifier.slice(2)}`;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
      if (existsSync(candidate) && /\.(ts|tsx|js|mjs)$/.test(candidate)) return next(pathToFileURL(candidate).href, context);
    }
  }
  return next(specifier, context);
}

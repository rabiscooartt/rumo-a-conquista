// Verificação SOMENTE LEITURA do formato de resposta do Storage (Etapa 4.1).
// Chama info() de UM objeto de imagem já existente e lista a pasta dele; mostra só os NOMES dos
// campos devolvidos e se há um campo de metadados próprios. Não baixa imagens, não envia nada.
//
//   node --env-file=.env.local scripts/storage-metadata-check.mjs --confirm-remote [bucket/caminho]
//
// Limite: objetos antigos não têm metadados próprios; esta leitura prova o FORMATO da resposta,
// não a ida e volta de um SHA-256 gravado. A prova completa exige um envio de teste (autorização à parte).
import { readFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
if (argv[0] !== "--confirm-remote" || argv.length > 2) {
  console.log("Uso: node --env-file=.env.local scripts/storage-metadata-check.mjs --confirm-remote [bucket/caminho]\nSem --confirm-remote nada é acessado.");
  process.exit(argv.length === 0 ? 0 : 1);
}
const target = argv[1] ?? "site-banners/banners/emblemas/background.0446aacfba04d831.webp";
const slash = target.indexOf("/");
const bucket = target.slice(0, slash);
const path = target.slice(slash + 1);
if (slash <= 0 || !/\.(webp|png|jpe?g)$/i.test(path)) {
  console.error("Informe bucket/caminho de uma imagem existente.");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  process.exit(1);
}
const variants = JSON.parse(readFileSync(join(process.cwd(), "data", "homeImageVariants.json"), "utf8"));
const expectedHost = Object.keys(variants).map((k) => { try { return new URL(k).host; } catch { return null; } }).find((h) => h?.endsWith(".supabase.co"));
if (!expectedHost || new URL(url).host !== expectedHost) {
  console.error("O ambiente não aponta para o projeto Supabase esperado (rumo-a-conquista). Nada foi acessado.");
  process.exit(1);
}

const { createClient } = await import("@supabase/supabase-js");
const api = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from(bucket);

const describe = (value) => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value);
const info = await api.info(path);
if (info.error) {
  console.error(`info() falhou: ${info.error.message}`);
  process.exit(1);
}
console.log(`info(${target}) — campos: ${Object.keys(info.data).sort().join(", ")}`);
console.log(`  metadata: ${describe(info.data.metadata)}${info.data.metadata && typeof info.data.metadata === "object" ? ` (chaves: ${Object.keys(info.data.metadata).join(", ") || "nenhuma"})` : ""}`);
console.log(`  size: ${describe(info.data.size)} · contentType: ${describe(info.data.contentType)} · etag: ${describe(info.data.etag)}`);

const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
const listed = await api.list(folder, { limit: 5, search: path.slice(path.lastIndexOf("/") + 1) });
if (listed.error) {
  console.error(`list() falhou: ${listed.error.message}`);
  process.exit(1);
}
const entry = (listed.data ?? [])[0];
console.log(`list(${bucket}/${folder}) — campos: ${entry ? Object.keys(entry).sort().join(", ") : "(vazio)"}`);
if (entry) console.log(`  metadata: ${describe(entry.metadata)}${entry.metadata ? ` (chaves: ${Object.keys(entry.metadata).sort().join(", ")})` : ""} · user_metadata: ${describe(entry.user_metadata)}`);
console.log("Somente leitura: nenhuma imagem baixada, nada enviado.");

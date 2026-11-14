// Cópias WebP leves das imagens do site, listadas em data/homeImageVariants.json.
//   npm run home-images:generate   cria só as cópias que faltam ou cujo original local mudou
//   npm run home-images:check      falha se faltar cópia ou se um original local mudou
//   npm run home-images:report     grava o manifesto (origem → destino, tamanhos e dimensões)
//                                  e a página de comparação visual em .image-report/index.html
//
// Opções do generate:
//   --force            recria todas as cópias locais, mesmo sem mudança no original
//   --include-remote   inclui originais hospedados fora do repositório (ex.: Supabase Storage).
//                      Sem esta opção nada é baixado da internet: só arquivos de public/ são lidos.
//
// Originais na Supabase não precisam de conferência: cada envio gera um endereço novo.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import sharp from "sharp";

const root = process.cwd();
const variantsPath = join(root, "data/homeImageVariants.json");
const sourcesPath = join(root, "scripts/home-image-sources.json");
const manifestPath = join(root, "scripts/image-optimization-manifest.json");
const reportDir = join(root, ".image-report");
const variants = JSON.parse(readFileSync(variantsPath, "utf8"));
// "#large" marca uma segunda cópia, maior, do mesmo original (capas e emblemas exibidos em destaque).
const LARGE_SUFFIX = "#large";
const originalOf = (src) => (src.endsWith(LARGE_SUFFIX) ? src.slice(0, -LARGE_SUFFIX.length) : src);
const isLocal = (src) => src.startsWith("/");
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

export function presetFor(src) {
  if (src.endsWith(LARGE_SUFFIX)) return { width: 768, height: 768, quality: 88 };
  if (src.includes("/achievements/")) return { width: 128, height: 128, quality: 85 };
  if (src.includes("/activity-summary-icons/")) return { width: 128, height: 128, quality: 90 };
  if (src.includes("/trophies/")) return { width: 128, height: 128, quality: 90 };
  if (src.includes("/emblem.")) return { width: 384, height: 384, quality: 90 };
  if (src.includes("/badge.")) return { width: 384, height: 384, quality: 90 };
  if (src.includes("/cover.")) return { width: 480, height: 480, quality: 84 };
  if (src.includes("/banner.")) return { width: 1280, height: 1280, quality: 82 };
  if (/-bg\.(png|jpe?g|webp)$/i.test(src)) return { width: 1920, height: 1920, quality: 82 };
  if (src.includes("/images/avatar.")) return { width: 384, height: 480, quality: 86 };
  if (src.includes("/site-profile/")) return { width: 384, height: 384, quality: 88 };
  throw new Error(`Sem preset para ${src}`);
}

async function readSource(src) {
  if (isLocal(src)) return readFileSync(join(root, "public", originalOf(src)));

  const response = await fetch(originalOf(src));
  if (!response.ok) throw new Error(`${response.status} ao baixar ${src}`);
  return Buffer.from(await response.arrayBuffer());
}

function readHashes() {
  return existsSync(sourcesPath) ? JSON.parse(readFileSync(sourcesPath, "utf8")) : {};
}

async function generate({ force = false, includeRemote = false } = {}) {
  const hashes = readHashes();
  const counts = { created: 0, unchanged: 0, skippedRemote: 0 };

  for (const [src, variant] of Object.entries(variants)) {
    const variantFile = join(root, "public", variant);
    const local = isLocal(src);

    if (!local && !includeRemote) {
      if (!existsSync(variantFile)) console.warn(`Cópia remota ausente (use --include-remote): ${variant}`);
      counts.skippedRemote += 1;
      continue;
    }

    let input = null;
    if (local) {
      input = await readSource(src);
      const unchanged = hashes[originalOf(src)] === sha256(input) && existsSync(variantFile);
      if (unchanged && !force) {
        counts.unchanged += 1;
        continue;
      }
    } else if (existsSync(variantFile) && !force) {
      counts.unchanged += 1;
      continue;
    }

    input ??= await readSource(src);
    const { width, height, quality } = presetFor(src);
    const output = await sharp(input)
      .rotate()
      .resize({ width, height, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
      .webp({ quality, alphaQuality: 100, effort: 6, smartSubsample: true })
      .toBuffer();

    // Original já menor (ex.: AVIF ou JPG pequeno): a "cópia leve" pioraria. Não grava.
    if (output.byteLength >= input.byteLength) {
      console.warn(`Cópia não reduz o tamanho; remova a entrada do mapa: ${src}`);
      counts.unchanged += 1;
      continue;
    }

    writeFileSync(variantFile, output);
    if (local) hashes[originalOf(src)] = sha256(input);
    counts.created += 1;
    console.log(`Gerada: ${variant} (${Math.round(output.byteLength / 1024)} KB)`);
  }

  // Mantém só os hashes de originais locais que ainda têm cópia listada.
  const localSources = new Set(Object.keys(variants).filter(isLocal).map(originalOf));
  const sortedHashes = Object.fromEntries(
    Object.entries(hashes).filter(([src]) => localSources.has(src))
  );
  writeFileSync(sourcesPath, JSON.stringify(sortedHashes, null, 2) + "\n");
  console.log(
    `${counts.created} cópias geradas, ${counts.unchanged} sem mudança, ` +
      `${counts.skippedRemote} remotas não baixadas.`
  );
}

function check() {
  const hashes = readHashes();
  const problems = [];

  for (const [src, variant] of Object.entries(variants)) {
    if (!existsSync(join(root, "public", variant))) problems.push(`Cópia ausente: ${variant}`);
    if (!isLocal(src)) continue;

    const file = join(root, "public", originalOf(src));
    if (!existsSync(file)) problems.push(`Original ausente: ${src}`);
    else if (sha256(readFileSync(file)) !== hashes[originalOf(src)]) problems.push(`Original alterado: ${src}`);
  }

  if (problems.length > 0) {
    console.error(problems.join("\n"));
    console.error("Rode npm run home-images:generate para atualizar as cópias.");
    process.exit(1);
  }

  console.log(`${Object.keys(variants).length} cópias conferidas.`);
}

async function describe(buffer) {
  const meta = await sharp(buffer).metadata();
  return { format: meta.format, width: meta.width, height: meta.height, hasAlpha: Boolean(meta.hasAlpha) };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

async function report() {
  const entries = [];
  for (const [src, variant] of Object.entries(variants)) {
    const variantFile = join(root, "public", variant);
    if (!existsSync(variantFile)) continue;
    const optimized = readFileSync(variantFile);
    const entry = {
      source: src,
      variant,
      preset: presetFor(src),
      optimizedBytes: optimized.byteLength,
      optimized: await describe(optimized),
    };
    // Originais remotos não são baixados: o manifesto registra só o que é verificável localmente.
    if (isLocal(src)) {
      const original = readFileSync(join(root, "public", originalOf(src)));
      entry.originalBytes = original.byteLength;
      entry.original = await describe(original);
      entry.reductionPercent = Math.round((1 - optimized.byteLength / original.byteLength) * 1000) / 10;
    }
    entries.push(entry);
  }

  const local = entries.filter((entry) => entry.originalBytes);
  const totals = {
    variants: entries.length,
    localVariants: local.length,
    originalBytes: local.reduce((sum, entry) => sum + entry.originalBytes, 0),
    optimizedBytes: local.reduce((sum, entry) => sum + entry.optimizedBytes, 0),
  };
  writeFileSync(manifestPath, JSON.stringify({ totals, entries }, null, 2) + "\n");

  // Página local de comparação lado a lado (não é publicada; a pasta fica fora do Git).
  mkdirSync(reportDir, { recursive: true });
  const toReport = (publicPath) =>
    relative(reportDir, join(root, "public", publicPath)).split("\\").join("/");
  const rows = local
    .map((entry) => {
      const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
      return `<tr>
  <td><img src="${escapeHtml(toReport(originalOf(entry.source)))}" loading="lazy"><br>${escapeHtml(originalOf(entry.source))}<br>${entry.original.format} ${entry.original.width}×${entry.original.height} · ${kb(entry.originalBytes)}${entry.original.hasAlpha ? " · alpha" : ""}</td>
  <td><img src="${escapeHtml(toReport(entry.variant))}" loading="lazy"><br>${escapeHtml(entry.variant)}<br>webp ${entry.optimized.width}×${entry.optimized.height} · ${kb(entry.optimizedBytes)}${entry.optimized.hasAlpha ? " · alpha" : ""}</td>
  <td>−${entry.reductionPercent}%</td>
</tr>`;
    })
    .join("\n");
  writeFileSync(
    join(reportDir, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>Comparação de imagens</title>
<style>body{font:13px system-ui;background:#111;color:#ddd;margin:16px}table{border-collapse:collapse;width:100%}
td{border:1px solid #333;padding:8px;vertical-align:top;word-break:break-all}
img{max-width:256px;max-height:256px;background:repeating-conic-gradient(#444 0 25%,#222 0 50%) 0 0/16px 16px}</style>
<h1>Original × cópia WebP (${local.length} imagens locais)</h1>
<p>Total: ${(totals.originalBytes / 1024 / 1024).toFixed(1)} MB → ${(totals.optimizedBytes / 1024 / 1024).toFixed(2)} MB.
O fundo xadrez revela a transparência.</p>
<table><tr><th>Original</th><th>WebP</th><th>Redução</th></tr>
${rows}
</table>`
  );

  console.log(
    `Manifesto: ${relative(root, manifestPath)} · Comparação: ${relative(root, join(reportDir, "index.html"))}`
  );
  console.log(
    `${local.length} originais locais: ${(totals.originalBytes / 1024 / 1024).toFixed(1)} MB → ` +
      `${(totals.optimizedBytes / 1024 / 1024).toFixed(2)} MB`
  );
}

const command = process.argv[2];
const flags = new Set(process.argv.slice(3));
if (command === "generate") await generate({ force: flags.has("--force"), includeRemote: flags.has("--include-remote") });
else if (command === "check") check();
else if (command === "report") await report();
else if (command) throw new Error("Use: generate, check ou report");

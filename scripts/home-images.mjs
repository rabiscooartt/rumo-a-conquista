// Gera as cópias leves da Início e confere se os originais locais mudaram.
//   npm run home-images:generate  recria as cópias listadas em data/homeImageVariants.json
//   npm run home-images:check     falha se um original local mudou desde a última geração
// Originais na Supabase não precisam de conferência: cada envio muda a URL (?v=) e a cópia deixa de ser usada.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const root = process.cwd();
const variantsPath = join(root, "data/homeImageVariants.json");
const sourcesPath = join(root, "scripts/home-image-sources.json");
const variants = JSON.parse(readFileSync(variantsPath, "utf8"));
// "#large" marca uma segunda cópia, maior, do mesmo original (capas e emblemas exibidos em destaque).
const LARGE_SUFFIX = "#large";
const originalOf = (src) => (src.endsWith(LARGE_SUFFIX) ? src.slice(0, -LARGE_SUFFIX.length) : src);
const isLocal = (src) => src.startsWith("/");
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

function presetFor(src) {
  if (src.endsWith(LARGE_SUFFIX)) return { width: 768, height: 768, quality: 88 };
  if (src.includes("/achievements/")) return { width: 128, height: 128, quality: 85 };
  if (src.includes("/activity-summary-icons/")) return { width: 128, height: 128, quality: 90 };
  if (src.includes("/trophies/")) return { width: 128, height: 128, quality: 90 };
  if (src.includes("/emblem.")) return { width: 384, height: 384, quality: 90 };
  if (src.includes("/cover.")) return { width: 480, height: 480, quality: 84 };
  if (src.includes("/banner.")) return { width: 1280, height: 1280, quality: 82 };
  if (src.includes("/images/avatar.")) return { width: 384, height: 480, quality: 86 };
  if (src.includes("/site-profile/")) return { width: 384, height: 384, quality: 88 };
  throw new Error(`Sem preset para ${src}`);
}

async function readSource(src) {
  if (isLocal(src)) return readFileSync(join(root, "public", originalOf(src)));

  const response = await fetch(src);
  if (!response.ok) throw new Error(`${response.status} ao baixar ${src}`);
  return Buffer.from(await response.arrayBuffer());
}

async function generate() {
  const hashes = {};

  for (const [src, variant] of Object.entries(variants)) {
    const input = await readSource(src);
    const { width, height, quality } = presetFor(src);
    const output = await sharp(input)
      .resize({ width, height, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
      .webp({ quality, alphaQuality: 100, effort: 6, smartSubsample: true })
      .toBuffer();

    writeFileSync(join(root, "public", variant), output);
    if (isLocal(src)) hashes[src] = sha256(input);
  }

  writeFileSync(sourcesPath, JSON.stringify(hashes, null, 2) + "\n");
  console.log(`${Object.keys(variants).length} cópias geradas.`);
}

function check() {
  const hashes = JSON.parse(readFileSync(sourcesPath, "utf8"));
  const problems = [];

  for (const [src, variant] of Object.entries(variants)) {
    if (!existsSync(join(root, "public", variant))) problems.push(`Cópia ausente: ${variant}`);
    if (!isLocal(src)) continue;

    const file = join(root, "public", originalOf(src));
    if (!existsSync(file)) problems.push(`Original ausente: ${src}`);
    else if (sha256(readFileSync(file)) !== hashes[src]) problems.push(`Original alterado: ${src}`);
  }

  if (problems.length > 0) {
    console.error(problems.join("\n"));
    console.error("Rode npm run home-images:generate para atualizar as cópias.");
    process.exit(1);
  }

  console.log(`${Object.keys(variants).length} cópias conferidas.`);
}

const command = process.argv[2];
if (command === "generate") await generate();
else if (command === "check") check();
else throw new Error("Use: generate ou check");

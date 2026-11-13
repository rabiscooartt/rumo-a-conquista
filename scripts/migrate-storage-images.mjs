// Migração FUTURA das imagens que hoje existem só no Supabase Storage (PNG/JPG legados).
// NÃO roda por acidente: sem --confirm-remote o script só mostra esta ajuda e sai, sem rede.
//
// Etapas (cada uma exige autorização do proprietário antes de rodar):
//   1) Planejar (só leitura; baixa os originais para medir):
//        node scripts/migrate-storage-images.mjs --confirm-remote
//      → grava .image-report/storage-migration-plan.json com tamanho atual e estimado.
//   2) Enviar as versões WebP (nunca apaga nem sobrescreve originais; nomes imutáveis):
//        node scripts/migrate-storage-images.mjs --confirm-remote --apply
//      → grava .image-report/storage-migration-result.json (URL antiga → URL nova)
//        e .image-report/storage-migration.sql com os UPDATEs para revisão manual.
//      O SQL NÃO é executado pelo script: deve ser revisado e aplicado em etapa separada.
//
// Requer NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente (nunca impressos).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = new Set(process.argv.slice(2));
const HELP = `Uso:
  node scripts/migrate-storage-images.mjs --confirm-remote            # plano (só leitura)
  node scripts/migrate-storage-images.mjs --confirm-remote --apply    # envia WebP + gera SQL p/ revisão
Sem --confirm-remote nada é acessado.`;

// Pastas e presets migráveis. Banners e avatar não precisam de SQL: a leitura já escolhe
// a versão mais recente da pasta (ver lib/images/storedImages.ts).
const TARGETS = [
  { bucket: "achievement-art", prefixRoot: "games", nested: "achievements", preset: "achievement" },
  { bucket: "site-banners", prefixRoot: "banners", nested: "", preset: "banner", fixedBase: "background" },
  { bucket: "site-profile", prefixRoot: "profile", nested: null, preset: "avatar", fixedBase: "avatar" },
];

if (!args.has("--confirm-remote")) {
  console.log(HELP);
  process.exit(0);
}

const root = process.cwd();
const outDir = join(root, ".image-report");
const apply = args.has("--apply");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  process.exit(1);
}

const { createClient } = await import("@supabase/supabase-js");
const { optimizeImage } = await import("../lib/images/optimizeImage.ts");
const { uploadOptimizedImage } = await import("../lib/images/storage.ts");
const { isImmutableImageName, safeImageBaseName } = await import("../lib/images/naming.ts");
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function listFolder(bucket, folder) {
  const { data, error } = await client.storage.from(bucket).list(folder, { limit: 1000 });
  if (error) throw new Error(`${bucket}/${folder}: ${error.message}`);
  return data ?? [];
}

async function collectLegacyObjects(target) {
  const objects = [];
  if (target.nested === null) {
    for (const file of await listFolder(target.bucket, target.prefixRoot)) {
      if (file.name === target.fixedBase) objects.push(`${target.prefixRoot}/${file.name}`);
    }
    return objects;
  }
  for (const folder of await listFolder(target.bucket, target.prefixRoot)) {
    if (folder.id) continue; // só subpastas
    const dir = [target.prefixRoot, folder.name, target.nested].filter(Boolean).join("/");
    for (const file of await listFolder(target.bucket, dir)) {
      if (!file.id || isImmutableImageName(file.name)) continue;
      if (target.fixedBase ? file.name !== target.fixedBase : !/\.(png|jpe?g|webp)$/i.test(file.name)) continue;
      objects.push(`${dir}/${file.name}`);
    }
  }
  return objects;
}

const plan = [];
const results = [];
const sql = ["-- Revisar antes de aplicar. Gerado por scripts/migrate-storage-images.mjs.", "begin;"];

for (const target of TARGETS) {
  for (const path of await collectLegacyObjects(target)) {
    const { data: blob, error } = await client.storage.from(target.bucket).download(path);
    if (error || !blob) {
      plan.push({ bucket: target.bucket, path, error: error?.message ?? "download falhou" });
      continue;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const optimized = await optimizeImage({ bytes, preset: target.preset });
    const entry = {
      bucket: target.bucket,
      path,
      originalBytes: optimized.originalBytes,
      optimizedBytes: optimized.optimizedBytes,
      reductionPercent: optimized.reductionPercent,
      size: `${optimized.originalWidth}x${optimized.originalHeight} -> ${optimized.width}x${optimized.height}`,
    };
    plan.push(entry);

    if (!apply) continue;
    const directory = path.split("/").slice(0, -1).join("/");
    const baseName = target.fixedBase ?? safeImageBaseName(path.split("/").pop());
    const stored = await uploadOptimizedImage(client.storage.from(target.bucket), directory, baseName, optimized);
    const oldUrl = client.storage.from(target.bucket).getPublicUrl(path).data.publicUrl;
    results.push({ ...entry, oldUrl, newUrl: stored.publicUrl, deduplicated: stored.deduplicated });

    if (target.bucket === "achievement-art") {
      const literal = (value) => `'${value.replace(/'/g, "''")}'`;
      // Cobre a URL com e sem "?v=..." gravada pelos envios antigos.
      const match = (column) =>
        `(${column} = ${literal(oldUrl)} or ${column} like ${literal(oldUrl + "?v=%")})`;
      sql.push(`update achievements set image = ${literal(stored.publicUrl)} where ${match("image")};`);
      sql.push(
        `update achievement_progress set image_override = ${literal(stored.publicUrl)} where ${match("image_override")};`
      );
    }
  }
}

sql.push("-- commit;  -- descomente somente após revisar", "");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "storage-migration-plan.json"), JSON.stringify(plan, null, 2) + "\n");
if (apply) {
  writeFileSync(join(outDir, "storage-migration-result.json"), JSON.stringify(results, null, 2) + "\n");
  writeFileSync(join(outDir, "storage-migration.sql"), sql.join("\n"));
}
const total = (field) => plan.reduce((sum, item) => sum + (item[field] ?? 0), 0);
console.log(
  `${plan.length} objetos: ${(total("originalBytes") / 1024 / 1024).toFixed(2)} MB → ` +
    `${(total("optimizedBytes") / 1024 / 1024).toFixed(2)} MB` + (apply ? " (enviados)" : " (só plano)")
);

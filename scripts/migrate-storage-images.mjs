// Migração das imagens que hoje existem só no Supabase Storage (PNG/JPG legados) para WebP.
// NÃO roda por acidente: sem --confirm-remote o script só mostra a ajuda e sai, sem rede.
// A lógica fica em lib/images/storageMigration.ts (testada com Storage simulado).
//
// Modos (cada um exige autorização do proprietário antes de rodar):
//   --confirm-remote            PLANO: lista e baixa os originais para medir (Egress fora do
//                               cache, da ordem do tamanho do Storage). Não envia nada.
//   --confirm-remote --apply    ENVIA as versões WebP (nunca apaga, move ou sobrescreve
//                               originais) e gera o SQL para revisão. O SQL NÃO é executado.
//   --limit N                   processa no máximo N objetos (migração controlada em lotes).
//   --preview-sql               OFFLINE: prévia do SQL a partir do plan.json já gravado.
//
// Conversões sem redução real de tamanho (medida depois da conversão) são ignoradas, com
// motivo explícito, no plano e no envio, e nunca entram no SQL.
//
// Imagens que já têm cópia leve local com correspondência exata (data/homeImageVariants.json)
// são preservadas: não são baixadas, convertidas, enviadas nem entram no SQL.
// Cada banner/avatar traz o estado do ponteiro (válido, ausente, inválido, arquivo inexistente).
//
// Saídas em .image-report/storage-migration/ (fora do Git):
//   progress.jsonl  um registro por objeto, gravado na hora (migrado, preservado, ignorado, erro);
//                   rodar de novo retoma: o que já foi migrado é pulado, erros são refeitos
//   plan.json       resultado do modo plano
//   migration.sql   UPDATEs com backup prévio das linhas afetadas, para revisão manual
//   rollback.sql    reversão a partir do backup
//
// Requer NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente (nunca impressos).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const args = new Set(argv);
const HELP = `Uso:
  node scripts/migrate-storage-images.mjs --confirm-remote [--limit N]            # plano (só leitura)
  node scripts/migrate-storage-images.mjs --confirm-remote --apply [--limit N]    # envia WebP + gera SQL p/ revisão
  node scripts/migrate-storage-images.mjs --preview-sql                           # prévia do SQL a partir do plan.json (offline)
Sem --confirm-remote nada é acessado.`;

// Prévia do SQL: 100% local, lê o plan.json já gravado. Não importa o cliente do Supabase.
if (args.has("--preview-sql")) {
  if (argv.length !== 1) {
    console.error(`--preview-sql não aceita outras opções.\n${HELP}`);
    process.exit(1);
  }
  const dir = join(process.cwd(), ".image-report", "storage-migration");
  const planPath = join(dir, "plan.json");
  if (!existsSync(planPath)) {
    console.error("plan.json não encontrado: rode o plano antes (--confirm-remote).");
    process.exit(1);
  }
  const { buildMigrationSqlPreview, PREVIEW_HASH_PLACEHOLDER } = await import("../lib/images/storageMigration.ts");
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const preview = buildMigrationSqlPreview(plan);
  writeFileSync(join(dir, "migration.preview.sql"), preview.sql);
  writeFileSync(join(dir, "rollback.preview.sql"), preview.rollbackSql);
  console.log(`Prévia: ${preview.count} artes em .image-report/storage-migration/migration.preview.sql (não executar).`);
  if (preview.placeholders.length > 0) {
    console.log(
      `${preview.placeholders.length} URL(s) nova(s) com o marcador ${PREVIEW_HASH_PLACEHOLDER}: ` +
        "o plano não registrou o destino exato; o envio gera o SQL definitivo."
    );
  }
  process.exit(0);
}

if (!args.has("--confirm-remote")) {
  console.log(HELP);
  process.exit(0);
}

const limitIndex = argv.indexOf("--limit");
const limit = limitIndex >= 0 ? Number(argv[limitIndex + 1]) : Infinity;
if (limitIndex >= 0 && (!Number.isInteger(limit) || limit <= 0)) {
  console.error("--limit precisa de um número inteiro positivo.");
  process.exit(1);
}
const known = new Set(["--confirm-remote", "--apply", "--limit"]);
const unknown = argv.filter((arg, index) => !known.has(arg) && argv[index - 1] !== "--limit");
if (unknown.length > 0) {
  console.error(`Opção desconhecida: ${unknown.join(" ")}\n${HELP}`);
  process.exit(1);
}

const apply = args.has("--apply");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  process.exit(1);
}

const outDir = join(process.cwd(), ".image-report", "storage-migration");
mkdirSync(outDir, { recursive: true });
const progressPath = join(outDir, "progress.jsonl");
const runPath = join(outDir, "run.json");

const { createClient } = await import("@supabase/supabase-js");
const { buildMigrationSql, createLocalVariantIndex, latestRecords, migrateObject, scanLegacyObjects } = await import(
  "../lib/images/storageMigration.ts"
);
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// Cópias leves locais: imagens com correspondência exata são preservadas (sem download/envio/SQL).
const variants = JSON.parse(readFileSync(join(process.cwd(), "data", "homeImageVariants.json"), "utf8"));
const localVariants = createLocalVariantIndex(variants, (publicPath) =>
  existsSync(join(process.cwd(), "public", publicPath))
);

function readProgress() {
  if (!existsSync(progressPath)) return [];
  return readFileSync(progressPath, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return []; // linha cortada por uma interrupção: o objeto será refeito
      }
    });
}

// Identificador estável da migração: o mesmo em todas as retomadas (usado no backup do SQL).
const run = existsSync(runPath)
  ? JSON.parse(readFileSync(runPath, "utf8"))
  : { runId: `img-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`, createdAt: new Date().toISOString() };
if (apply && !existsSync(runPath)) writeFileSync(runPath, JSON.stringify(run, null, 2) + "\n");

const mode = apply ? "apply" : "plan";
const previous = latestRecords(readProgress());
const counts = { migrated: 0, planned: 0, preserved: 0, skipped: 0, error: 0, alreadyDone: 0 };
const planRecords = [];
const doubts = [];

function record(entry) {
  counts[entry.status] += 1;
  if (entry.localVariant?.status === "doubt") doubts.push(entry.key);
  const line = { ...entry, runId: run.runId, mode, at: new Date().toISOString() };
  if (apply) appendFileSync(progressPath, JSON.stringify(line) + "\n");
  else planRecords.push(line);
  const pointer = entry.pointerState ? ` [ponteiro: ${entry.pointerState}]` : "";
  console.log(`${entry.status.padEnd(9)} ${entry.key}${pointer}${entry.reason ? ` — ${entry.reason}` : ""}`);
}

// Pastas que não puderam ser listadas viram erro (nunca "ignorado"); as demais continuam.
const { objects, errors: scanErrors } = await scanLegacyObjects(client);
for (const error of scanErrors) record(error);

let processed = 0;
for (const item of objects) {
  if (apply && previous.get(item.key)?.status === "migrated") {
    counts.alreadyDone += 1;
    continue;
  }
  if (processed >= limit) break;
  processed += 1;
  record(await migrateObject(client, item, { apply, localVariants }));
}

if (!apply) {
  writeFileSync(join(outDir, "plan.json"), JSON.stringify(planRecords, null, 2) + "\n");
} else {
  // SQL sempre a partir do histórico completo, para cobrir também execuções anteriores.
  const all = [...latestRecords(readProgress()).values()];
  const { sql, rollbackSql, count } = buildMigrationSql(all, run.runId);
  writeFileSync(join(outDir, "migration.sql"), sql);
  writeFileSync(join(outDir, "rollback.sql"), rollbackSql);
  console.log(`SQL para revisão: ${count} artes em .image-report/storage-migration/migration.sql (não executado).`);
}

const remaining = objects.length - counts.alreadyDone - processed;
console.log(
  `${objects.length} objetos legados · migrados ${counts.migrated} · planejados ${counts.planned} · ` +
    `preservados (variante local) ${counts.preserved} · ignorados ${counts.skipped} · erros ${counts.error} · ` +
    `já migrados antes ${counts.alreadyDone}` +
    (remaining > 0 ? ` · restantes ${remaining} (--limit)` : "")
);
if (doubts.length > 0) console.log(`Revisar (variante local não confirmada): ${doubts.join(", ")}`);
process.exit(counts.error > 0 ? 2 : 0);

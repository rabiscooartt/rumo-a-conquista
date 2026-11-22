// Executor de arquivamento e restauração das imagens do ciclo de vida (Etapa 5.2).
//
// Simulação (somente leitura, escrita bloqueada tecnicamente no fetch e nas dependências):
//   node --env-file=.env.local scripts/image-lifecycle-archive.mjs --dry-run [--archive <bucket/caminho> ...] [--restore <bucket/caminho> ...]
// Aplicação (alvos EXPLÍCITOS, no máximo 10 por execução; o bucket de arquivo precisa existir):
//   node --env-file=.env.local scripts/image-lifecycle-archive.mjs --apply --confirm-remote --archive <bucket/caminho> [...]
//   node --env-file=.env.local scripts/image-lifecycle-archive.mjs --apply --confirm-remote --restore <bucket/caminho> [...]
//   node --env-file=.env.local scripts/image-lifecycle-archive.mjs --apply --confirm-remote --resume
//
// Nunca cria o bucket de arquivo, nunca remove originais (sem opção para isso aqui), nunca altera
// referências do site. Cada passo vai para .image-report/lifecycle/archive/<data>-<modo>.jsonl e o
// resumo para o .json de mesmo nome. Os checkpoints persistentes ficam no banco (intenção aberta):
// repetir o mesmo comando retoma de onde parou, sem duplicar cópia nem registro.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const listAfter = (flag) => {
  const out = [];
  argv.forEach((a, i) => { if (a === flag && argv[i + 1] && !argv[i + 1].startsWith("--")) out.push(argv[i + 1]); });
  return out;
};
const known = new Set(["--dry-run", "--apply", "--confirm-remote", "--archive", "--restore", "--resume"]);
const mode = flags.has("--apply") && flags.has("--confirm-remote") && !flags.has("--dry-run") ? "apply"
  : flags.has("--dry-run") && !flags.has("--apply") ? "dry-run" : null;
const archiveTargets = listAfter("--archive");
const restoreTargets = listAfter("--restore");
const resume = flags.has("--resume");
const usage = () => {
  console.log("Uso:\n  --dry-run [--archive <bucket/caminho> ...] [--restore <bucket/caminho> ...]\n  --apply --confirm-remote (--archive <bucket/caminho> ... | --restore <bucket/caminho> ... | --resume)\nNo máximo 10 alvos por execução. Sem opções válidas nada é acessado.");
};
if (!mode || [...flags].some((f) => !known.has(f)) || archiveTargets.length + restoreTargets.length > 10
    || (mode === "apply" && archiveTargets.length + restoreTargets.length === 0 && !resume)) {
  usage();
  process.exit(argv.length === 0 ? 0 : 1);
}

const root = process.cwd();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  process.exit(1);
}
const variants = JSON.parse(readFileSync(join(root, "data", "homeImageVariants.json"), "utf8"));
const expectedHost = Object.keys(variants).map((k) => { try { return new URL(k).host; } catch { return null; } }).find((h) => h?.endsWith(".supabase.co"));
// Testes locais: ARCHIVE_TEST_HOST só aceita 127.0.0.1 (simuladores); qualquer outro host exige o projeto real.
const testHost = process.env.ARCHIVE_TEST_HOST;
const localTest = Boolean(testHost) && /^127\.0\.0\.1:\d+$/.test(testHost) && new URL(url).host === testHost;
if (!localTest && (!expectedHost || new URL(url).host !== expectedHost)) {
  console.error("O ambiente não aponta para o projeto Supabase esperado (rumo-a-conquista). Nada foi acessado.");
  process.exit(1);
}

const { createClient } = await import("@supabase/supabase-js");
const runner = await import("../lib/images/lifecycle/archiveRunner.ts");
const { ARCHIVE_BUCKET } = await import("../lib/images/lifecycle/archive.ts");
const { supabaseLifecycleRpc } = await import("../lib/images/lifecycle/tracked.ts");

const now = new Date();
const stamp = `${now.toISOString().replace(/[-:.]/g, "").slice(0, 15)}Z-${mode}`;
const dir = join(root, ".image-report", "lifecycle", "archive");
mkdirSync(dir, { recursive: true });
const logFile = join(dir, `${stamp}.jsonl`);
const log = (step) => appendFileSync(logFile, `${runner.stepLine(step)}\n`);

// Simulação: o próprio fetch do client recusa qualquer escrita antes de enviá-la.
const fetchImpl = mode === "dry-run" ? runner.readOnlyFetch(globalThis.fetch) : globalThis.fetch;
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchImpl } });
const rpc = supabaseLifecycleRpc(client);
const deps = runner.supabaseArchiveDeps(client, rpc, log);
const actor = "scripts/image-lifecycle-archive.mjs";

console.log(`Projeto confirmado · modo: ${mode === "apply" ? "APLICAÇÃO" : "simulação (escrita bloqueada)"}`);
const { data: archiveBucket } = await client.storage.getBucket(ARCHIVE_BUCKET);
console.log(`Bucket de arquivo ${ARCHIVE_BUCKET}: ${archiveBucket ? `existe (${archiveBucket.public ? "PÚBLICO" : "privado"})` : "não existe"}`);
if (mode === "apply" && (archiveTargets.length > 0 || resume) && (!archiveBucket || archiveBucket.public)) {
  console.error(`O bucket ${ARCHIVE_BUCKET} precisa existir e ser privado antes de arquivar; este executor não o cria. Nada foi feito.`);
  process.exit(1);
}

const state = await runner.readArchiveState(client, rpc);
const plan = runner.planArchive(state.rows, state.evidence);
const counts = plan.reduce((acc, entry) => ((acc[entry.eligible ? "elegíveis" : entry.state] = (acc[entry.eligible ? "elegíveis" : entry.state] ?? 0) + 1), acc), {});
console.log(`Inventário: ${plan.length} objetos · ${JSON.stringify(counts)} · pendências de arquivo: ${state.pending.length}`);
for (const entry of plan.filter((e) => e.eligible)) console.log(`  elegível: ${entry.object} (${entry.reason})`);

const results = { archive: [], restore: [], resume: [] };
if (resume || (mode === "dry-run" && state.pending.length > 0)) {
  results.resume = await runner.resumePending({ deps, mode, pending: state.pending, actor, reason: "retomada pelo executor" });
}
if (archiveTargets.length > 0) {
  results.archive = await runner.runArchive({ deps, mode, targets: archiveTargets, plan, actor, reason: "arquivamento pelo executor" });
}
if (restoreTargets.length > 0) {
  results.restore = await runner.runRestore({ deps, mode, targets: restoreTargets, actor, reason: "restauração pelo executor" });
}
for (const [kind, list] of Object.entries(results)) {
  for (const r of list) console.log(`· ${kind} ${r.object} → ${r.status}${r.error ? `: ${r.error}` : ""}`);
}
// aguardando_gravacao: a cerca das fontes estava ocupada (55P03); nada mudou, basta repetir.
const failures = Object.values(results).flat().filter((r) => ["erro", "falhou", "pendente", "bloqueado_na_simulacao", "aguardando_gravacao"].includes(r.status)).length;
writeFileSync(join(dir, `${stamp}.json`), JSON.stringify({ mode, at: now.toISOString(), archiveBucket: Boolean(archiveBucket), counts, plan, pending: state.pending, results }, null, 2));
console.log(`Registro: ${join(".image-report", "lifecycle", "archive", `${stamp}.json`)} (passos em .jsonl) · ocorrências: ${failures}`);
process.exitCode = failures > 0 ? 1 : 0;

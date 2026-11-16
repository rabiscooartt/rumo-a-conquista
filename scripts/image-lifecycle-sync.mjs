// Etapa 4 — sincronização inicial do inventário com as tabelas do ciclo de vida.
//
// Simulação (somente leitura no Supabase; grava só o plano local):
//   node --env-file=.env.local scripts/image-lifecycle-sync.mjs --dry-run <scanId>
//
// Escrita (exige autorização específica; as três opções juntas):
//   node --env-file=.env.local scripts/image-lifecycle-sync.mjs --apply --confirm-remote <scanId> --report-sha256 <sha256 aprovado>
//
// A escrita chama SOMENTE as funções da interface (storage_lifecycle_register_scan,
// storage_lifecycle_sync_scan, storage_lifecycle_set_manual_protection × 4) e confere tudo com
// storage_operation_log_verify. Antes de cada passo relê o estado remoto; qualquer divergência para
// antes da próxima escrita. Repetir o comando retoma de onde parou (todas as chamadas são idempotentes).
// Cada operação é mostrada antes de executar e registrada em
// .image-report/lifecycle/sync-runs/<scanId>-apply-<data>.jsonl (arquivo novo a cada execução).
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const USAGE = [
  "Uso:",
  "  node --env-file=.env.local scripts/image-lifecycle-sync.mjs --dry-run <scanId>",
  "  node --env-file=.env.local scripts/image-lifecycle-sync.mjs --apply --confirm-remote <scanId> --report-sha256 <sha256>",
].join("\n");

function parseArgs(list) {
  if (list.length === 2 && list[0] === "--dry-run") return { mode: "dry-run", scanId: list[1] };
  const flags = new Set(list.filter((a) => a.startsWith("--")));
  const shaIndex = list.indexOf("--report-sha256");
  const positional = list.filter((a, i) => !a.startsWith("--") && i !== shaIndex + 1);
  const known = new Set(["--apply", "--confirm-remote", "--report-sha256"]);
  if (list.length === 5 && flags.has("--apply") && flags.has("--confirm-remote") && shaIndex >= 0 && positional.length === 1
      && [...flags].every((f) => known.has(f))) {
    return { mode: "apply", scanId: positional[0], expectedSha: list[shaIndex + 1] };
  }
  return null;
}
const args = parseArgs(argv);
if (!args) {
  console.log(`${USAGE}\nO modo de escrita exige --apply e --confirm-remote juntos, mais o SHA-256 aprovado do relatório.`);
  process.exit(argv.length === 0 ? 0 : 1);
}
const { mode, scanId } = args;
if (!/^scan-[0-9]{8}T[0-9]{6}Z$/.test(scanId)) {
  console.error("Identificador de varredura inválido.");
  process.exit(1);
}

const root = process.cwd();
const baseDir = join(root, ".image-report", "lifecycle");
const scanDir = join(baseDir, scanId);
const reportPath = join(scanDir, "report.json");
const recordPath = join(scanDir, "scan-record.json");
for (const file of [reportPath, recordPath, join(baseDir, "history.jsonl")]) {
  if (!existsSync(file)) {
    console.error(`Arquivo ausente: ${file}. Nada foi acessado.`);
    process.exit(1);
  }
}
const reportBytes = readFileSync(reportPath);
const reportSha256 = createHash("sha256").update(reportBytes).digest("hex");
if (mode === "apply" && args.expectedSha !== reportSha256) {
  console.error(`SHA-256 do relatório (${reportSha256}) difere do aprovado (${args.expectedSha}). Nada foi acessado.`);
  process.exit(1);
}
const report = JSON.parse(reportBytes.toString("utf8"));
const scanRecord = JSON.parse(readFileSync(recordPath, "utf8"));

const { parseHistory } = await import("../lib/images/lifecycle/history.ts");
const { DEFAULT_PROTECTED_OBJECTS } = await import("../lib/images/lifecycle/references.ts");
const { runInitialSync, supabaseLifecycleApi, MOUSE_MANUAL_PROTECTIONS } = await import("../lib/images/lifecycle/syncRun.ts");
const history = parseHistory(readFileSync(join(baseDir, "history.jsonl"), "utf8"));

// Projeto certo (mesma regra da varredura).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  process.exit(1);
}
const variants = JSON.parse(readFileSync(join(root, "data", "homeImageVariants.json"), "utf8"));
const expectedHost = Object.keys(variants).map((k) => { try { return new URL(k).host; } catch { return null; } }).find((h) => h?.endsWith(".supabase.co"));
if (!expectedHost || new URL(url).host !== expectedHost) {
  console.error("O ambiente não aponta para o projeto Supabase esperado (rumo-a-conquista). Nada foi acessado.");
  process.exit(1);
}
console.log(`Projeto confirmado: ${expectedHost.split(".")[0]} (rumo-a-conquista) · modo: ${mode === "apply" ? "ESCRITA" : "simulação"}`);

const { createClient } = await import("@supabase/supabase-js");
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const api = supabaseLifecycleApi(client);
if (mode === "dry-run") {
  // Na simulação, qualquer tentativa de escrita é um erro de programação.
  for (const name of ["registerScan", "syncScan", "setManualProtection"]) api[name] = async () => { throw new Error(`escrita (${name}) chamada na simulação`); };
}

const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";
let runLog = null;
if (mode === "apply") {
  const runsDir = join(baseDir, "sync-runs");
  mkdirSync(runsDir, { recursive: true });
  runLog = join(runsDir, `${scanId}-apply-${stamp}.jsonl`);
  if (existsSync(runLog)) {
    console.error(`${runLog} já existe; nada foi sobrescrito nem acessado.`);
    process.exit(1);
  }
}
const log = (event) => {
  const line = { at: new Date().toISOString(), ...event };
  if (runLog) appendFileSync(runLog, JSON.stringify(line) + "\n");
  if (event.kind === "planned") console.log(`→ ${mode === "apply" ? "EXECUTAR" : "executaria"} ${event.step}: ${event.detail}`);
  else if (event.kind === "result") console.log(`  ✔ ${event.step}: ${JSON.stringify(event.result)}`);
  else if (event.kind === "skipped") console.log(`  · ${event.step}: pulado (${event.reason})`);
  else if (event.kind === "stop") console.error(`  ✘ INTERROMPIDO: ${event.reason}`);
  else console.log(`  ${event.message}`);
};

const result = await runInitialSync({
  mode, scanId, report, reportSha256, expectedReportSha256: args.expectedSha, scanRecord, history,
  protectedObjects: DEFAULT_PROTECTED_OBJECTS, protections: MOUSE_MANUAL_PROTECTIONS,
  actor: `scripts/image-lifecycle-sync.mjs (${mode})`, now: () => new Date(), api, log,
});

if (mode === "dry-run" && result.plan) {
  const plansDir = join(baseDir, "sync-plans");
  mkdirSync(plansDir, { recursive: true });
  const planFile = join(plansDir, `${scanId}-dryrun-${stamp}.json`);
  if (!existsSync(planFile)) {
    writeFileSync(planFile, JSON.stringify({ mode: "dry-run", generatedAt: new Date().toISOString(), protections: MOUSE_MANUAL_PROTECTIONS, ...result.plan }, null, 2));
    console.log(`Plano salvo em ${planFile.slice(root.length + 1)}`);
  }
}
if (runLog) console.log(`Registro da execução: ${runLog.slice(root.length + 1)}`);
if (!result.ok) {
  console.error(`\n${mode === "apply" ? "Execução" : "Simulação"} interrompida (${result.writes} escrita(s) feitas). Repetir o comando retoma de onde parou depois de corrigir a causa.`);
  process.exit(1);
}
console.log(mode === "apply"
  ? `\nSincronização inicial concluída e conferida (${result.writes} chamada(s) de escrita nesta execução).`
  : "\nSimulação aprovada: nenhuma escrita foi feita. A sincronização real exige autorização específica.");

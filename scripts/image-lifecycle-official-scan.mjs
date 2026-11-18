// Varredura OFICIAL do ciclo de vida das imagens (as seguintes à carga inicial).
// Núcleo em lib/images/lifecycle/officialScan.ts; regras em docs/ciclo-de-vida-imagens-varreduras.md.
//
//   Simulação (só leitura; não abre execução, não grava arquivos nem histórico, nunca vira oficial):
//     node --env-file=.env.local scripts/image-lifecycle-official-scan.mjs --dry-run
//   Varredura oficial (abre a execução no banco, coleta, registra, atesta, sincroniza e confere):
//     node --env-file=.env.local scripts/image-lifecycle-official-scan.mjs --apply --confirm-remote
//   Retomar uma execução interrompida (nada é duplicado):
//     node --env-file=.env.local scripts/image-lifecycle-official-scan.mjs --apply --confirm-remote --scan-id <scanId>
//   Abandonar uma execução pendente (encerra como falha; a varredura nunca vale como prova):
//     node --env-file=.env.local scripts/image-lifecycle-official-scan.mjs --abandon <scanId> --reason "<motivo>" --confirm-remote
//
// Saídas em .image-report/lifecycle/<scanId>/ (arquivos novos, nunca sobrescritos): report.json,
// manifest.json, scan-record.json, usage.json e official-run.jsonl (pontos de controle).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const usage = () => {
  console.log([
    "Uso:",
    "  --dry-run                                     simulação somente leitura",
    "  --apply --confirm-remote [--scan-id <id>]     varredura oficial (ou retomada)",
    '  --abandon <id> --reason "<motivo>" --confirm-remote',
  ].join("\n"));
};
const known = new Set(["--dry-run", "--apply", "--confirm-remote", "--scan-id", "--abandon", "--reason"]);
const flags = argv.filter((a) => a.startsWith("--"));
const mode = flag("--abandon") ? "abandon" : flag("--apply") ? "apply" : flag("--dry-run") ? "dry-run" : null;
if (!mode || flags.some((a) => !known.has(a)) || [flag("--dry-run"), flag("--apply"), flag("--abandon")].filter(Boolean).length !== 1
    || (mode !== "dry-run" && !flag("--confirm-remote")) || (mode === "dry-run" && (flag("--confirm-remote") || flag("--scan-id")))
    || (mode === "abandon" && !(value("--abandon") && value("--reason")))) {
  usage();
  process.exit(mode ? 1 : 0);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  process.exit(1);
}
const root = process.cwd();
const variants = JSON.parse(readFileSync(join(root, "data", "homeImageVariants.json"), "utf8"));
const expectedHost = Object.keys(variants).map((k) => { try { return new URL(k).host; } catch { return null; } }).find((h) => h?.endsWith(".supabase.co"));
if (!expectedHost || new URL(url).host !== expectedHost) {
  console.error("O ambiente não aponta para o projeto Supabase esperado (rumo-a-conquista). Nada foi acessado.");
  process.exit(1);
}

const { createClient } = await import("@supabase/supabase-js");
const { collectRemoteSources } = await import("../lib/images/lifecycle/collect.ts");
const { referencesFromProtectionList, referencesFromVariantMap, DEFAULT_PROTECTED_OBJECTS } = await import("../lib/images/lifecycle/references.ts");
const { supabaseLifecycleApi } = await import("../lib/images/lifecycle/syncRun.ts");
const { supabaseLifecycleRpc } = await import("../lib/images/lifecycle/tracked.ts");
const { runOfficialScan, abandonOfficialScan, officialScanApi } = await import("../lib/images/lifecycle/officialScan.ts");
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const baseDir = join(root, ".image-report", "lifecycle");
const store = {
  exists: (p) => existsSync(join(baseDir, p)),
  read: (p) => readFileSync(join(baseDir, p), "utf8"),
  writeNew: (p, text) => { mkdirSync(dirname(join(baseDir, p)), { recursive: true }); writeFileSync(join(baseDir, p), text, { flag: "wx" }); },
  append: (p, text) => { mkdirSync(dirname(join(baseDir, p)), { recursive: true }); appendFileSync(join(baseDir, p), text); },
};
const rpc = supabaseLifecycleRpc(client);
const api = officialScanApi(rpc, supabaseLifecycleApi(client), async (scanId) => {
  const { count, error } = await client.from("storage_lifecycle_scan_objects").select("scan_id", { count: "exact", head: true }).eq("scan_id", scanId);
  if (error) throw new Error(`leitura de storage_lifecycle_scan_objects: ${error.message}`);
  return count ?? 0;
});
const actor = "image-lifecycle-official-scan";

if (mode === "abandon") {
  const result = await abandonOfficialScan({ scanId: value("--abandon"), reason: value("--reason"), actor, api, store, now: () => new Date() });
  console.log(`Execução ${value("--abandon")}: ${JSON.stringify(result)}`);
  process.exit(result.status === "failed" || result.result === "failed" ? 0 : 1);
}

// Coleta somente leitura (listagens, SELECT paginado, JSON de ponteiros e rascunhos; nenhuma imagem baixada).
const storage = {
  listBuckets: () => client.storage.listBuckets(),
  from: (bucket) => ({
    list: (path, options) => client.storage.from(bucket).list(path, options),
    download: (path) => client.storage.from(bucket).download(path),
  }),
};
const selectPage = (table, columns, orderBy, from, to) =>
  client.from(table).select(columns, { count: "exact" }).order(orderBy, { ascending: true }).range(from, to);
const { games: legacyGames } = await import("../data/games.ts");
const collect = async () => {
  const collected = await collectRemoteSources(storage, selectPage, undefined, legacyGames);
  return { collected, sources: [...collected.sources, referencesFromVariantMap(variants), referencesFromProtectionList()] };
};

const result = await runOfficialScan({
  mode, resumeScanId: value("--scan-id"), actor, now: () => new Date(), api, store, collect,
  protectedObjects: DEFAULT_PROTECTED_OBJECTS, log: (e) => console.log(`[${e.kind}] ${e.message}`),
});
console.log(JSON.stringify({ ok: result.ok, scanId: result.scanId, stage: result.stage, reason: result.reason ?? null, runFailed: result.runFailed ?? false, reportSha256: result.reportSha256 ?? null, writes: result.writes }, null, 2));
process.exit(result.ok ? 0 : 1);

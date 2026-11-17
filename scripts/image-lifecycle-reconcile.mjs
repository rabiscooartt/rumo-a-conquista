// Reconciliação das operações pendentes do ciclo de vida das imagens (Etapa 4.3).
//
// Simulação (somente leitura):
//   node --env-file=.env.local scripts/image-lifecycle-reconcile.mjs --dry-run [--min-age-minutes 30]
// Aplicação (registra só resultados COMPROVADOS; não envia, não troca referências, não apaga):
//   node --env-file=.env.local scripts/image-lifecycle-reconcile.mjs --apply --confirm-remote [--min-age-minutes 30] [--close-unconfirmed-sync]
//
// Decisões e evidências ficam em .image-report/lifecycle/reconcile/<data>.json (arquivo novo a cada execução).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const minIndex = argv.indexOf("--min-age-minutes");
const minAge = minIndex >= 0 ? Number(argv[minIndex + 1]) : 30;
const known = new Set(["--dry-run", "--apply", "--confirm-remote", "--min-age-minutes", "--close-unconfirmed-sync"]);
const mode = flags.has("--apply") && flags.has("--confirm-remote") && !flags.has("--dry-run") ? "apply"
  : flags.has("--dry-run") && !flags.has("--apply") ? "dry-run" : null;
if (!mode || [...flags].some((f) => !known.has(f)) || !Number.isInteger(minAge) || minAge < 5) {
  console.log("Uso:\n  --dry-run [--min-age-minutes N]\n  --apply --confirm-remote [--min-age-minutes N]\nN ≥ 5 (padrão 30). Sem opções válidas nada é acessado.");
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
if (!expectedHost || new URL(url).host !== expectedHost) {
  console.error("O ambiente não aponta para o projeto Supabase esperado (rumo-a-conquista). Nada foi acessado.");
  process.exit(1);
}
console.log(`Projeto confirmado: ${expectedHost.split(".")[0]} · modo: ${mode === "apply" ? "APLICAÇÃO" : "simulação"} · idade mínima ${minAge} min`);

const { createClient } = await import("@supabase/supabase-js");
const { reconcilePending, supabaseReconcileDeps } = await import("../lib/images/lifecycle/reconcile.ts");
const { supabaseLifecycleRpc } = await import("../lib/images/lifecycle/tracked.ts");
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const rpc = supabaseLifecycleRpc(client);
const deps = supabaseReconcileDeps(client, mode === "apply" ? rpc : async () => { throw new Error("escrita na simulação"); });

const now = new Date();
// --close-unconfirmed-sync só vale no modo de escrita: encerra salvamentos sem prova como failed.
const closeUnconfirmedSync = mode === "apply" && flags.has("--close-unconfirmed-sync");
const result = await reconcilePending({ deps, mode, actor: "scripts/image-lifecycle-reconcile.mjs", now, minAgeMinutes: minAge, closeUnconfirmedSync });
for (const d of result.decisions) {
  console.log(`· ${d.operation} ${d.object ?? ""} (${d.ageMinutes} min) → ${d.decision}: ${d.diagnosis}${d.applied ? ` · resultado: ${JSON.stringify(d.applied)}` : ""}`);
}
if (result.decisions.length === 0) console.log("Nenhuma operação pendente.");

const dir = join(root, ".image-report", "lifecycle", "reconcile");
mkdirSync(dir, { recursive: true });
const file = join(dir, `${now.toISOString().replace(/[-:.]/g, "").slice(0, 15)}Z-${mode}.json`);
if (!existsSync(file)) writeFileSync(file, JSON.stringify({ mode, at: now.toISOString(), minAgeMinutes: minAge, ...result }, null, 2));
console.log(`Registro: ${file.slice(root.length + 1)} · aplicadas ${result.applied} · erros ${result.errors}`);
process.exitCode = result.errors > 0 ? 1 : 0;

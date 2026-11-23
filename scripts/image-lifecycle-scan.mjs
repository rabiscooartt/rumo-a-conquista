// Varredura SOMENTE LEITURA do ciclo de vida das imagens (Etapa 2).
// Lista objetos (metadados, sem baixar imagens), lê as tabelas por SELECT paginado, lê
// ponteiros e rascunhos JSON dentro de limites e classifica com lib/images/lifecycle/.
// Nunca escreve no Supabase. Sem --confirm-remote, só mostra a ajuda.
//
//   node --env-file=.env.local scripts/image-lifecycle-scan.mjs --confirm-remote
//
// Saídas (fora do Git), numa pasta nova a cada varredura (nunca sobrescreve):
//   .image-report/lifecycle/<scanId>/report.json      objetos, estados e referências
//   .image-report/lifecycle/<scanId>/summary.md       resumo legível
//   .image-report/lifecycle/<scanId>/scan-record.json registro para a comparação futura
//   .image-report/lifecycle/<scanId>/usage.json       consumo da investigação
//   .image-report/lifecycle/history.jsonl             histórico (uma linha por varredura, só acrescenta)
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

//
// Invalidar uma varredura como baseline (local, sem acessar o Supabase; só acrescenta uma linha):
//   node scripts/image-lifecycle-scan.mjs --invalidate-scan <scanId> --reason "<motivo>"
const argv = process.argv.slice(2);
const historyFile = join(process.cwd(), ".image-report", "lifecycle", "history.jsonl");

if (argv[0] === "--invalidate-scan") {
  if (argv.length !== 4 || argv[2] !== "--reason") {
    console.error('Uso: node scripts/image-lifecycle-scan.mjs --invalidate-scan <scanId> --reason "<motivo>"');
    process.exit(1);
  }
  const { parseHistory, buildInvalidation } = await import("../lib/images/lifecycle/history.ts");
  if (!existsSync(historyFile)) {
    console.error("Não há histórico de varreduras; nada foi alterado.");
    process.exit(1);
  }
  const parsed = parseHistory(readFileSync(historyFile, "utf8"));
  if (parsed.unreadableLines > 0) {
    console.error("O histórico tem linhas ilegíveis; nada foi alterado.");
    process.exit(1);
  }
  let entry;
  try {
    entry = buildInvalidation(parsed, argv[1], argv[3], new Date());
  } catch (error) {
    console.error(`${error.message}; nada foi alterado.`);
    process.exit(1);
  }
  appendFileSync(historyFile, JSON.stringify(entry) + "\n");
  console.log(`Invalidação registrada (append-only) para ${entry.scanId}: ${entry.reason}`);
  process.exit(0);
}

const args = new Set(argv);
if (!args.has("--confirm-remote") || argv.length !== 1) {
  console.log("Uso: node --env-file=.env.local scripts/image-lifecycle-scan.mjs --confirm-remote\nSem --confirm-remote nada é acessado.");
  process.exit(args.has("--confirm-remote") ? 1 : 0);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  process.exit(1);
}

const root = process.cwd();
const variants = JSON.parse(readFileSync(join(root, "data", "homeImageVariants.json"), "utf8"));

// Projeto certo: o mesmo host usado pelas cópias leves do site (rumo-a-conquista).
const expectedHost = Object.keys(variants).map((k) => { try { return new URL(k).host; } catch { return null; } }).find((h) => h?.endsWith(".supabase.co"));
const actualHost = new URL(url).host;
if (!expectedHost || actualHost !== expectedHost) {
  console.error("O ambiente não aponta para o projeto Supabase esperado (rumo-a-conquista). Nada foi acessado.");
  process.exit(1);
}
console.log(`Projeto confirmado: ${actualHost.split(".")[0]} (rumo-a-conquista).`);

const now = new Date();
const scanId = `scan-${now.toISOString().replace(/[-:.]/g, "").slice(0, 15)}Z`;
const baseDir = join(root, ".image-report", "lifecycle");
const outDir = join(baseDir, scanId);
if (existsSync(outDir)) {
  console.error(`${outDir} já existe; nada foi sobrescrito.`);
  process.exit(1);
}

const { createClient } = await import("@supabase/supabase-js");
const { collectRemoteSources } = await import("../lib/images/lifecycle/collect.ts");
const { classifyImages } = await import("../lib/images/lifecycle/classify.ts");
const { referencesFromProtectionList, referencesFromVariantMap, DEFAULT_PROTECTED_OBJECTS } = await import("../lib/images/lifecycle/references.ts");
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// Somente leitura: listBuckets, list, download (só .json) e SELECT paginado com contagem exata.
const storage = {
  listBuckets: () => client.storage.listBuckets(),
  from: (bucket) => ({
    list: (path, options) => client.storage.from(bucket).list(path, options),
    download: (path) => client.storage.from(bucket).download(path),
  }),
};
const selectPage = (table, columns, orderBy, from, to) =>
  client.from(table).select(columns, { count: "exact" }).order(orderBy, { ascending: true }).range(from, to);

// Dados locais (data/games.ts): o painel público os usa quando o banco falha; entram nas referências
// implícitas por convenção de nome. Sem eles, a fonte "convention" falha e nada vira candidato.
const { games: legacyGames } = await import("../data/games.ts");
const collected = await collectRemoteSources(storage, selectPage, undefined, legacyGames);
const sources = [...collected.sources, referencesFromVariantMap(variants), referencesFromProtectionList()];

const historyPath = historyFile;
const { parseHistory, effectiveHistory } = await import("../lib/images/lifecycle/history.ts");
const parsedHistory = parseHistory(existsSync(historyPath) ? readFileSync(historyPath, "utf8") : "");
const { history, warnings: historyWarnings } = effectiveHistory(parsedHistory);
const validPriorScans = history.filter((h) => h.complete).map((h) => h.scanId);
const report = classifyImages(collected.inventory, sources, { now, history, scanId, safetyPeriodDays: 30 });

// Referências guardadas só como bucket/caminho + origem + localização (sem o valor bruto).
const slimRef = (ref) => ({ objectKey: ref.objectKey, source: ref.source, location: ref.location });
const objectByKey = new Map(collected.allImageObjects.map((o) => [`${o.bucket}/${o.path}`, o]));
const objects = report.objects.map((item) => {
  const meta = objectByKey.get(item.objectKey) ?? {};
  return { objectKey: item.objectKey, state: item.state, size: meta.size ?? null, mimetype: meta.mimetype ?? null, createdAt: meta.createdAt ?? null, updatedAt: meta.updatedAt ?? null, reasons: item.reasons, references: item.references.map(slimRef), unreferencedSince: item.unreferencedSince ?? null };
});

const byBucket = {};
for (const o of collected.allImageObjects) {
  const b = (byBucket[o.bucket] ??= { images: 0, imageBytes: 0, nonImages: 0, nonImageBytes: 0 });
  b.images += 1;
  b.imageBytes += o.size ?? 0;
}
for (const o of collected.nonImageObjects) {
  const b = (byBucket[o.bucket] ??= { images: 0, imageBytes: 0, nonImages: 0, nonImageBytes: 0 });
  b.nonImages += 1;
  b.nonImageBytes += o.size ?? 0;
}
const byState = {};
for (const o of objects) {
  const s = (byState[o.state] ??= { count: 0, bytes: 0 });
  s.count += 1;
  s.bytes += o.size ?? 0;
}
const sourceStatus = sources.map((s) => ({ source: s.source, status: s.status, references: s.references.length, error: s.error ?? null, unparsed: s.unparsed?.length ?? 0 }));

const scanRecord = { ...report.scanRecord, inventoryStatus: collected.inventory.status, sourceStatus: sourceStatus.map(({ source, status }) => ({ source, status })), imageObjects: objects.length };
const usage = { ...collected.counters, tableCounts: collected.tableCounts };

// Validações pedidas.
const protectedOk = DEFAULT_PROTECTED_OBJECTS.every((k) => objects.find((o) => o.objectKey === k)?.state === "protected");
const missingProtected = DEFAULT_PROTECTED_OBJECTS.filter((k) => !objects.some((o) => o.objectKey === k));
const danglingBySource = {};
for (const ref of report.danglingReferences) (danglingBySource[ref.source] ??= []).push(`${ref.objectKey} ← ${ref.location}`);
const validations = {
  inventoryComplete: collected.inventory.status === "complete",
  allTablesRead: Object.values(collected.tableCounts).every((n) => typeof n === "number"),
  imageDownloads: collected.counters.imageDownloads,
  protectedOk,
  missingProtected,
  candidatesTrustworthy: report.evidenceComplete && validPriorScans.length > 0,
  validPriorScans,
  invalidatedScans: parsedHistory.invalidations.map((i) => i.scanId),
  historyWarnings,
  failuresTreatedAsAbsence: objects.some((o) => o.state === "candidate") && !report.evidenceComplete,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "report.json"), JSON.stringify({ scanId, at: now.toISOString(), project: "rumo-a-conquista", existingBuckets: collected.existingBuckets, evidenceComplete: report.evidenceComplete, blockers: report.blockers, issues: collected.issues, byBucket, byState, sourceStatus, pointerReadings: collected.pointerReadings.map((r) => ({ target: r.target.pointer, state: r.state, file: r.file ?? null, error: r.error ?? null })), danglingReferences: report.danglingReferences.map(slimRef), duplicateGroups: report.duplicateGroups, nonImageObjects: collected.nonImageObjects.map((o) => ({ objectKey: `${o.bucket}/${o.path}`, size: o.size, mimetype: o.mimetype })), validations, objects }, null, 2) + "\n");
writeFileSync(join(outDir, "scan-record.json"), JSON.stringify(scanRecord, null, 2) + "\n");
writeFileSync(join(outDir, "usage.json"), JSON.stringify(usage, null, 2) + "\n");
appendFileSync(historyPath, JSON.stringify(scanRecord) + "\n");

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
const md = [
  `# Varredura do ciclo de vida das imagens — ${scanId}`,
  "",
  `- Data: ${now.toISOString()}`,
  `- Inventário: **${collected.inventory.status}** · evidência completa: **${report.evidenceComplete ? "sim" : "não"}**`,
  validPriorScans.length
    ? `- Varreduras anteriores válidas como evidência: ${validPriorScans.join(", ")}`
    : `- Nenhuma varredura anterior válida: esta é a baseline; nada pode ser liberado com base só nela (regra das duas varreduras, prazo de 30 dias).`,
  ...historyWarnings.map((w) => `- Histórico: ${w}`),
  "",
  "## Buckets",
  "| Bucket | Imagens | Tamanho | Outros arquivos | Tamanho |",
  "|---|---|---|---|---|",
  ...Object.entries(byBucket).map(([b, v]) => `| ${b} | ${v.images} | ${mb(v.imageBytes)} | ${v.nonImages} | ${kb(v.nonImageBytes)} |`),
  "",
  "## Estados",
  "| Estado | Objetos | Tamanho |",
  "|---|---|---|",
  ...Object.entries(byState).map(([s, v]) => `| ${s} | ${v.count} | ${mb(v.bytes)} |`),
  "",
  "## Fontes",
  "| Fonte | Estado | Referências | Observação |",
  "|---|---|---|---|",
  ...sourceStatus.map((s) => `| ${s.source} | ${s.status} | ${s.references} | ${s.error ?? (s.unparsed ? `${s.unparsed} não interpretado(s)` : "")} |`),
  "",
  "## Bloqueios e ocorrências",
  ...(report.blockers.length ? report.blockers.map((b) => `- ${b}`) : ["- nenhum bloqueio"]),
  ...collected.issues.map((i) => `- ${i.kind}: ${i.where} — ${i.detail}`),
  "",
  "## Referências sem objeto",
  ...(report.danglingReferences.length ? Object.entries(danglingBySource).map(([s, list]) => `- ${s}: ${list.length}`) : ["- nenhuma"]),
  "",
  "## Consumo",
  `- Listagens: ${usage.listCalls} chamadas, ${usage.listedEntries} entradas · SELECT: ${usage.tablePages} páginas, ${usage.tableRows} linhas`,
  `- JSON baixados: ${usage.jsonFilesDownloaded} (${kb(usage.jsonBytesDownloaded)}) · imagens baixadas: ${usage.imageDownloads}`,
  `- Metadados recebidos (aproximado): ${kb(usage.approxMetadataBytes)}`,
  "",
].join("\n");
writeFileSync(join(outDir, "summary.md"), md);

console.log(md);
console.log(`Relatórios em .image-report/lifecycle/${scanId}/ (somente leitura no Supabase).`);

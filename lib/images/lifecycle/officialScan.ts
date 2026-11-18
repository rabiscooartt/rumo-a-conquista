// Varredura OFICIAL do ciclo de vida das imagens (as seguintes à carga inicial de runInitialSync).
// Usado por scripts/image-lifecycle-official-scan.mjs. Ordem fixa, retomável e com falha fechada:
//
//   1. storage_lifecycle_begin_scan_run    execução oficial aberta ANTES da coleta (política vigente)
//   2. coleta de todas as fontes exigidas pela política
//   3. relatório completo + manifesto das fontes + SHA-256
//   4. relatório gravado (arquivos novos, nunca sobrescritos), relido e conferido; linha no histórico
//   5. storage_lifecycle_register_scan
//   6. storage_lifecycle_attest_scan       (manifesto, SHA-256 do relatório, versão vigente)
//   7. storage_lifecycle_sync_scan         (plano incremental, reconferido antes)
//   8. storage_lifecycle_finish_scan_run   ("succeeded" só com 5–7 confirmados pelo banco)
//   9. conferência final: estado persistido = relatório; varredura atende à política; cadeia íntegra
//
// Cada etapa concluída vai para <scanId>/official-run.jsonl (só acrescenta). Repetir com --scan-id
// retoma do ponto certo sem duplicar nada (todas as funções do banco são idempotentes).
// Recusa definitiva (fonte incompleta, relatório inválido, política mudou, banco recusou com
// 23514/23505/22023) encerra a execução como "failed": essa varredura nunca vale como prova.
// Falha transitória (rede, leitura) só para: a execução fica pendente e pode ser retomada (ou
// abandonada com abandonOfficialScan). A simulação ("dry-run") não abre execução, não grava nada no
// banco, não cria arquivos e não acrescenta ao histórico: nunca vira varredura oficial.
import { createHash } from "node:crypto";
import type { ScanRecord } from "./classify.ts";
import type { CollectedSources } from "./collect.ts";
import { effectiveHistory, parseHistory, type ParsedHistory } from "./history.ts";
import type { SourceResult } from "./references.ts";
import { buildScanArtifacts } from "./scanReport.ts";
import { buildSourceManifest, SCAN_POLICY_SOURCES, SCAN_POLICY_VERSION, type ManifestEntry } from "./scanPolicy.ts";
import { buildSyncPlan, type RegisterScanPayload, type ScanRecordFile, type ScanReport, type SyncObjectPayload, type SyncPlan } from "./syncPlan.ts";
import type { RemoteFullState } from "./syncRun.ts";

export type RunStatus = "started" | "pending" | "succeeded" | "failed";
export type OfficialScanApi = {
  policyCurrent(): Promise<{ policy_version: number; required_sources: string[] }>;
  beginRun(scanId: string, actor: string): Promise<{ status: RunStatus; operation_id: string; policy_version: number; started_at: string }>;
  finishRun(scanId: string, result: "succeeded" | "failed", actor: string, details: Record<string, unknown>): Promise<Record<string, unknown>>;
  registerScan(payload: RegisterScanPayload, actor: string): Promise<Record<string, unknown>>;
  attestScan(scanId: string, policyVersion: number, manifest: ManifestEntry[], reportSha256: string, actor: string): Promise<Record<string, unknown>>;
  syncScan(scanId: string, objects: SyncObjectPayload[], actor: string): Promise<Record<string, unknown>>;
  invalidateScan(scanId: string, reason: string, actor: string): Promise<Record<string, unknown>>;
  readState(): Promise<RemoteFullState>;
  scanObjectCount(scanId: string): Promise<number>;
  meetsPolicy(scanId: string): Promise<boolean>;
  verifyChain(): Promise<unknown[]>;
};
/** Arquivos em .image-report/lifecycle (caminhos relativos). writeNew falha se o arquivo existir. */
export type ScanStore = {
  exists(path: string): boolean;
  read(path: string): string;
  writeNew(path: string, text: string): void;
  append(path: string, text: string): void;
};
export type Collector = () => Promise<{ collected: CollectedSources; sources: SourceResult[] }>;
export type OfficialEvent = { kind: "info" | "step" | "skipped" | "stop"; message: string };

export type OfficialScanInput = {
  mode: "dry-run" | "apply";
  /** Retomada: identificador de uma execução já começada (precisa do official-run.jsonl). */
  resumeScanId?: string;
  actor: string;
  now: () => Date;
  api: OfficialScanApi;
  store: ScanStore;
  collect: Collector;
  protectedObjects: readonly string[];
  log: (event: OfficialEvent) => void;
};
export type OfficialScanResult = {
  ok: boolean;
  scanId: string;
  stage: string;
  reason?: string;
  /** A execução foi encerrada como falha (a varredura nunca valerá como prova). */
  runFailed?: boolean;
  reportSha256?: string;
  writes: number;
  plan?: SyncPlan;
};

export const HISTORY_FILE = "history.jsonl";
export const checkpointFile = (scanId: string) => `${scanId}/official-run.jsonl`;
export const scanIdFor = (at: Date) => `scan-${at.toISOString().replace(/[-:.]/g, "").slice(0, 15)}Z`;
export const sha256Text = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const SCAN_ID_RE = /^scan-[0-9]{8}T[0-9]{6}Z$/;
const DEFINITIVE_CODES = new Set(["23514", "23505", "22023"]);

type Checkpoint = { step: string; at: string } & Record<string, unknown>;
/** Recusa definitiva: a execução é encerrada como falha. */
class Definitive extends Error {}
/** Parada retomável: nada é encerrado. */
class Halt extends Error {}

const errorCode = (error: unknown) => (error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code ?? "") : "");
const errorText = (error: unknown) => {
  if (!(error instanceof Error)) return String(error);
  const hint = (error as { hint?: unknown }).hint;
  return `${error.message}${errorCode(error) ? ` [${errorCode(error)}]` : ""}${hint ? ` (${String(hint)})` : ""}`;
};

function readCheckpoints(store: ScanStore, scanId: string): Checkpoint[] {
  if (!store.exists(checkpointFile(scanId))) return [];
  return store.read(checkpointFile(scanId)).split("\n").filter((l) => l.trim()).map((line) => {
    try { return JSON.parse(line) as Checkpoint; } catch { throw new Halt(`official-run.jsonl de ${scanId} com linha ilegível; nada foi feito`); }
  });
}

/** Histórico local que vale como evidência: só varreduras oficiais da política vigente que o banco confirma. */
async function officialHistory(api: OfficialScanApi, parsed: ParsedHistory, exclude: string) {
  const { history, warnings } = effectiveHistory(parsed);
  const kept: ScanRecord[] = [];
  const ignored: string[] = [];
  for (const scan of history) {
    if (scan.scanId === exclude) continue;
    if (scan.complete && scan.official === true && scan.policyVersion === SCAN_POLICY_VERSION && (await api.meetsPolicy(scan.scanId))) kept.push(scan);
    else ignored.push(scan.scanId);
  }
  if (ignored.length) warnings.push(`fora da evidência (não oficiais pela política v${SCAN_POLICY_VERSION} ou não confirmadas pelo banco): ${ignored.join(", ")}`);
  return { history: kept, warnings };
}

/** Conferência final: o estado persistido no banco corresponde ao relatório sincronizado. */
export function officialDivergences(plan: SyncPlan, remote: RemoteFullState, evidenceRows: number) {
  const problems: string[] = [];
  const rows = new Map(remote.objects.map((r) => [`${r.bucket}/${r.object_path}`, r]));
  for (const want of plan.predicted) {
    const row = rows.get(want.objectKey);
    if (!row) { problems.push(`${want.objectKey}: ausente do banco`); continue; }
    if (want.action === "preserve") continue;
    const stateOk = row.state === want.applied || (want.applied === "candidate" && row.state === "observing");
    if (!stateOk) problems.push(`${want.objectKey}: estado ${row.state}, esperado ${want.applied}`);
    if (row.reference_count !== want.referenceCount) problems.push(`${want.objectKey}: ${row.reference_count} referência(s), esperado ${want.referenceCount}`);
    if (row.last_seen_scan_id !== plan.scanId) problems.push(`${want.objectKey}: última varredura ${row.last_seen_scan_id}`);
  }
  if (evidenceRows !== plan.counts.objects) problems.push(`${evidenceRows} linha(s) de evidência, esperado ${plan.counts.objects}`);
  if (!remote.syncedScanIds.includes(plan.scanId)) problems.push("varredura não aparece como sincronizada");
  return problems;
}

export async function runOfficialScan(input: OfficialScanInput): Promise<OfficialScanResult> {
  const { api, store, log, actor, mode } = input;
  const apply = mode === "apply";
  let writes = 0;
  let plan: SyncPlan | undefined;
  let runOpen = false;
  let reportSha256: string | undefined;
  const scanId = input.resumeScanId ?? scanIdFor(input.now());
  let stage = "início";
  let checkpoints: Checkpoint[] = [];
  const has = (step: string) => checkpoints.find((c) => c.step === step);
  const mark = (step: string, data: Record<string, unknown> = {}) => {
    const entry = { step, at: input.now().toISOString(), ...data };
    store.append(checkpointFile(scanId), JSON.stringify(entry) + "\n");
    checkpoints.push(entry);
  };
  /** Chamada ao banco: recusa com código de validação é definitiva; o resto é retomável. */
  const remote = async <T>(what: string, call: () => Promise<T>, write = false): Promise<T> => {
    try {
      const value = await call();
      if (write) writes += 1;
      return value;
    } catch (error) {
      if (DEFINITIVE_CODES.has(errorCode(error))) throw new Definitive(`${what} recusado pelo banco: ${errorText(error)}`);
      throw new Halt(`${what} falhou (retomável): ${errorText(error)}`);
    }
  };

  try {
    if (!SCAN_ID_RE.test(scanId)) throw new Halt(`identificador de varredura inválido: ${scanId}`);
    // ---------- Política vigente (o banco precisa usar a mesma deste código) ----------
    stage = "política";
    const policy = await remote("leitura da política", () => api.policyCurrent());
    const samePolicy = policy?.policy_version === SCAN_POLICY_VERSION
      && [...(policy.required_sources ?? [])].sort().join() === [...SCAN_POLICY_SOURCES].sort().join();

    if (!apply) {
      // ---------- Simulação: só leitura; nada é gravado em lugar nenhum ----------
      if (!samePolicy) throw new Halt(`política do banco (v${policy?.policy_version}) difere da deste código (v${SCAN_POLICY_VERSION})`);
      stage = "coleta (simulação)";
      const now = input.now();
      const parsed = parseHistory(store.exists(HISTORY_FILE) ? store.read(HISTORY_FILE) : "");
      const prior = await officialHistory(api, parsed, scanId);
      const { collected, sources } = await input.collect();
      const manifest = buildSourceManifest(sources);
      const extra = { official: false, simulation: true, policyVersion: SCAN_POLICY_VERSION };
      const artifacts = buildScanArtifacts({ scanId, now, collected, sources, history: prior.history, historyWarnings: prior.warnings, reportExtra: { ...extra, manifest }, recordExtra: extra });
      const text = JSON.stringify(artifacts.report, null, 2) + "\n";
      reportSha256 = sha256Text(text);
      const virtual = parseHistory((store.exists(HISTORY_FILE) ? store.read(HISTORY_FILE) : "") + JSON.stringify({ ...artifacts.scanRecord, official: true }) + "\n");
      plan = buildSyncPlan({
        scanId, report: artifacts.report, reportSha256, scanRecord: { ...artifacts.scanRecord, official: true }, history: virtual,
        remote: await remote("leitura do estado", () => api.readState()), protectedObjects: input.protectedObjects, now, mode: "incremental", policyVersion: SCAN_POLICY_VERSION,
      });
      log({ kind: "info", message: `simulação ${scanId}: ${plan.counts.objects} objetos · estados ${JSON.stringify(plan.counts.byState)} · ${plan.blockers.length} bloqueio(s)` });
      for (const b of plan.blockers) log({ kind: "info", message: `bloqueio: ${b}` });
      return { ok: plan.ready, scanId, stage: "simulação", reportSha256, writes, plan, reason: plan.ready ? undefined : plan.blockers.join("; ") };
    }

    // ---------- 1. Execução oficial ----------
    stage = "execução";
    checkpoints = readCheckpoints(store, scanId);
    if (input.resumeScanId && checkpoints.length === 0) throw new Halt(`nada para retomar: ${checkpointFile(scanId)} não existe`);
    if (has("verified")) { log({ kind: "skipped", message: "varredura oficial já concluída e conferida" }); return { ok: true, scanId, stage: "concluída", writes }; }
    if (has("failed")) throw new Halt(`a execução de ${scanId} foi encerrada como falha: ${String(has("failed")!.reason)}. Comece uma varredura nova.`);
    if (!input.resumeScanId) {
      if (!samePolicy) throw new Halt(`política do banco (v${policy?.policy_version}) difere da deste código (v${SCAN_POLICY_VERSION}); nenhuma execução foi aberta`);
      if (store.exists(`${scanId}/report.json`) || store.exists(checkpointFile(scanId))) throw new Halt(`${scanId} já existe; nada foi sobrescrito`);
      mark("begin_requested", { actor });
    }
    const run = await remote("abertura da execução oficial", () => api.beginRun(scanId, actor), true);
    if (run.status === "failed") throw new Halt(`a execução de ${scanId} já foi encerrada como falha no banco. Comece uma varredura nova.`);
    runOpen = run.status === "started" || run.status === "pending";
    if (!has("run_started")) mark("run_started", { operationId: run.operation_id, startedAt: run.started_at, policyVersion: run.policy_version });
    const startedAt = new Date(String(has("run_started")!.startedAt));
    if (runOpen && (!samePolicy || run.policy_version !== SCAN_POLICY_VERSION)) {
      throw new Definitive(`a política mudou (execução v${run.policy_version}, banco v${policy?.policy_version}, código v${SCAN_POLICY_VERSION}): versões diferentes nunca formam prova`);
    }
    log({ kind: "step", message: `execução oficial ${scanId} (${run.status}) · política v${run.policy_version}` });

    // ---------- 2–4. Coleta, relatório, manifesto e gravação conferida ----------
    if (!has("persisted")) {
      if (run.status === "succeeded") throw new Halt("o banco diz que a execução terminou, mas o relatório local não foi gravado");
      if (store.exists(`${scanId}/report.json`) || store.exists(`${scanId}/manifest.json`) || store.exists(`${scanId}/scan-record.json`)) {
        throw new Definitive("gravação do relatório interrompida no meio: arquivos parciais não podem virar varredura oficial");
      }
      stage = "coleta";
      const historyText = store.exists(HISTORY_FILE) ? store.read(HISTORY_FILE) : "";
      const parsed = parseHistory(historyText);
      if (parsed.scans.some((s) => s.scanId === scanId)) throw new Definitive("o histórico já tem esta varredura sem gravação conferida");
      const prior = await officialHistory(api, parsed, scanId);
      let collected: Awaited<ReturnType<Collector>>;
      try { collected = await input.collect(); } catch (error) { throw new Halt(`coleta falhou (retomável): ${errorText(error)}`); }
      const now = input.now();
      if (now.getTime() < startedAt.getTime()) throw new Halt("relógio local antes da abertura da execução no banco; tente de novo");
      stage = "relatório";
      let manifest: ManifestEntry[];
      try { manifest = buildSourceManifest(collected.sources); } catch (error) { throw new Definitive(`coleta incompleta: ${errorText(error)}`); }
      const extra = { official: true, policyVersion: SCAN_POLICY_VERSION, runOperationId: run.operation_id };
      const artifacts = buildScanArtifacts({
        scanId, now, collected: collected.collected, sources: collected.sources, history: prior.history, historyWarnings: prior.warnings,
        reportExtra: { ...extra, runStartedAt: startedAt.toISOString(), manifest }, recordExtra: extra,
      });
      const reportText = JSON.stringify(artifacts.report, null, 2) + "\n";
      const manifestText = JSON.stringify(manifest, null, 2) + "\n";
      const recordText = JSON.stringify(artifacts.scanRecord, null, 2) + "\n";
      const sha = sha256Text(reportText);
      // Validação do relatório sem olhar o banco: erro aqui é definitivo.
      const precheck = buildSyncPlan({
        scanId, report: artifacts.report, reportSha256: sha, scanRecord: artifacts.scanRecord,
        history: parseHistory(historyText + JSON.stringify(artifacts.scanRecord) + "\n"),
        remote: { scans: [], objects: [], scanObjectRows: 0, logRows: 0, syncedScanIds: [], pendingOperations: 0 },
        protectedObjects: input.protectedObjects, now, mode: "incremental", policyVersion: SCAN_POLICY_VERSION,
      });
      if (!precheck.ready) throw new Definitive(`relatório recusado: ${precheck.blockers.slice(0, 10).join("; ")}`);
      stage = "gravação";
      store.writeNew(`${scanId}/report.json`, reportText);
      store.writeNew(`${scanId}/manifest.json`, manifestText);
      store.writeNew(`${scanId}/scan-record.json`, recordText);
      store.writeNew(`${scanId}/usage.json`, JSON.stringify(artifacts.usage, null, 2) + "\n");
      if (sha256Text(store.read(`${scanId}/report.json`)) !== sha || store.read(`${scanId}/manifest.json`) !== manifestText || store.read(`${scanId}/scan-record.json`) !== recordText) {
        throw new Definitive("relatório relido difere do gravado");
      }
      store.append(HISTORY_FILE, JSON.stringify(artifacts.scanRecord) + "\n");
      mark("persisted", { reportSha256: sha, manifestSha256: sha256Text(manifestText), completedAt: artifacts.report.at, objects: artifacts.report.objects.length });
      log({ kind: "step", message: `relatório gravado e conferido · SHA-256 ${sha}` });
    }

    // Relatório gravado: sempre relido do disco e conferido com o ponto de controle.
    stage = "releitura";
    const persisted = has("persisted")!;
    const reportText = store.read(`${scanId}/report.json`);
    reportSha256 = sha256Text(reportText);
    if (reportSha256 !== persisted.reportSha256) throw new Definitive(`report.json mudou depois de gravado (${reportSha256} × ${String(persisted.reportSha256)})`);
    const report = JSON.parse(reportText) as ScanReport & { manifest: ManifestEntry[]; runOperationId?: string };
    const manifestText = store.read(`${scanId}/manifest.json`);
    if (sha256Text(manifestText) !== persisted.manifestSha256 || JSON.stringify(JSON.parse(manifestText)) !== JSON.stringify(report.manifest)) {
      throw new Definitive("manifest.json não confere com o relatório");
    }
    if (report.runOperationId !== has("run_started")!.operationId) throw new Definitive("relatório de outra execução");
    const scanRecord = JSON.parse(store.read(`${scanId}/scan-record.json`)) as ScanRecordFile;
    const history = parseHistory(store.exists(HISTORY_FILE) ? store.read(HISTORY_FILE) : "");
    const planFor = (state: RemoteFullState) => buildSyncPlan({
      scanId, report, reportSha256: reportSha256!, scanRecord, history, remote: state, protectedObjects: input.protectedObjects,
      now: input.now(), mode: "incremental", policyVersion: SCAN_POLICY_VERSION,
    });
    const freshPlan = async () => {
      const built = planFor(await remote("leitura do estado", () => api.readState()));
      if (!built.ready) throw new Halt(`plano bloqueado pelo estado do banco: ${built.blockers.slice(0, 10).join("; ")}`);
      return built;
    };

    if (runOpen) {
      // ---------- 5. Registro ----------
      stage = "registro";
      plan = await freshPlan();
      if (plan.register!.action === "register") {
        const r = await remote("registro da varredura", () => api.registerScan(plan!.register!.payload, actor), true);
        if (r.status !== "registered" && r.status !== "already_registered") throw new Halt(`register_scan devolveu ${JSON.stringify(r)}`);
      } else log({ kind: "skipped", message: "varredura já registrada com os mesmos dados" });
      if (!has("registered")) mark("registered");

      // ---------- 6. Atestação ----------
      stage = "atestação";
      const attested = await remote("atestação", () => api.attestScan(scanId, SCAN_POLICY_VERSION, report.manifest, reportSha256!, actor), true);
      if (attested.status !== "attested" && attested.status !== "already_attested") throw new Halt(`attest_scan devolveu ${JSON.stringify(attested)}`);
      if (!has("attested")) mark("attested", { manifestSha256Db: attested.manifest_sha256 ?? null });

      // ---------- 7. Sincronização ----------
      stage = "sincronização";
      plan = await freshPlan();
      if (plan.sync!.action === "sync") {
        const r = await remote("sincronização", () => api.syncScan(scanId, plan!.sync!.objects, actor), true);
        const ok = r.status === "synced" && r.evidence_rows === plan.counts.objects && r.inserted === plan.counts.insert && r.missing === plan.counts.missing;
        if (!ok && r.status !== "already_synced") throw new Definitive(`sync_scan devolveu resultado diferente do plano: ${JSON.stringify({ ...r, override_details: undefined })}`);
      } else log({ kind: "skipped", message: "varredura já sincronizada" });
      if (!has("synced")) mark("synced", { objects: plan.counts.objects });

      // ---------- 8. Conclusão da execução ----------
      stage = "conclusão";
      const done = await remote("conclusão da execução", () => api.finishRun(scanId, "succeeded", actor, { report_sha256: reportSha256, objects: plan!.counts.objects }), true);
      const finished = done.status === "succeeded" || (done.status === "already_finished" && done.result === "succeeded");
      if (!finished) throw new Halt(`finish_scan_run devolveu ${JSON.stringify(done)}`);
      runOpen = false;
      if (!has("finished")) mark("finished");
    }

    // ---------- 9. Conferência final ----------
    stage = "conferência";
    const finalState = await remote("leitura do estado", () => api.readState());
    // Previsão recalculada do relatório gravado contra o estado atual, como se a sincronização ainda
    // fosse acontecer: as mesmas regras do banco (proteção, conflito, referências) dão o estado esperado.
    const expected = planFor({ ...finalState, syncedScanIds: finalState.syncedScanIds.filter((id) => id !== scanId), pendingOperations: 0, pendingRunScanIds: [] });
    plan ??= expected;
    const problems = officialDivergences({ ...expected, scanId }, finalState, await remote("contagem da evidência", () => api.scanObjectCount(scanId)));
    if (!(await remote("política da varredura", () => api.meetsPolicy(scanId)))) problems.push("o banco não reconhece a varredura como oficial pela política vigente");
    const chain = await remote("cadeia de auditoria", () => api.verifyChain());
    if (chain.length) problems.push(`cadeia de auditoria com ${chain.length} problema(s)`);
    if ((finalState.pendingRunScanIds ?? []).length) problems.push(`execução oficial pendente: ${finalState.pendingRunScanIds!.join(", ")}`);
    if (problems.length) {
      // Concluída no banco, mas o estado não confere: a varredura é invalidada (deixa de valer como prova).
      await remote("invalidação", () => api.invalidateScan(scanId, `conferência final da varredura oficial falhou: ${problems.slice(0, 3).join("; ")}`, actor), true);
      mark("invalidated", { problems: problems.slice(0, 20) });
      log({ kind: "stop", message: `conferência final falhou; varredura invalidada: ${problems.slice(0, 10).join("; ")}` });
      return { ok: false, scanId, stage, reason: problems.join("; "), reportSha256, writes, plan };
    }
    mark("verified", { reportSha256 });
    log({ kind: "step", message: `varredura oficial ${scanId} concluída e conferida (${plan.counts.objects} objetos)` });
    return { ok: true, scanId, stage: "concluída", reportSha256, writes, plan };
  } catch (error) {
    if (error instanceof Definitive) {
      let runFailed = false;
      if (runOpen) {
        try {
          const r = await api.finishRun(scanId, "failed", actor, { stage, reason: error.message.slice(0, 1000) });
          writes += 1;
          runFailed = r.status === "failed" || r.result === "failed";
        } catch (finishError) {
          log({ kind: "stop", message: `não foi possível encerrar a execução como falha: ${errorText(finishError)}` });
        }
      }
      try { if (store.exists(checkpointFile(scanId))) mark("failed", { stage, reason: error.message }); } catch { /* o banco já registra a falha */ }
      log({ kind: "stop", message: `recusa definitiva em ${stage}: ${error.message}` });
      return { ok: false, scanId, stage, reason: error.message, runFailed, reportSha256, writes, plan };
    }
    const message = error instanceof Halt ? error.message : `erro inesperado (retomável): ${errorText(error)}`;
    log({ kind: "stop", message: `${message}${apply && runOpen ? ` — retome com --scan-id ${scanId}` : ""}` });
    return { ok: false, scanId, stage, reason: message, reportSha256, writes, plan };
  }
}

/** Abandona uma execução pendente (encerra como falha). A varredura nunca valerá como prova. */
export async function abandonOfficialScan(input: { scanId: string; reason: string; actor: string; api: OfficialScanApi; store: ScanStore; now: () => Date }) {
  if (!SCAN_ID_RE.test(input.scanId)) throw new Error(`identificador de varredura inválido: ${input.scanId}`);
  if (input.reason.trim().length < 10) throw new Error("informe o motivo (pelo menos 10 caracteres)");
  const result = await input.api.finishRun(input.scanId, "failed", input.actor, { reason: input.reason.trim(), abandoned: true });
  if (input.store.exists(checkpointFile(input.scanId))) {
    input.store.append(checkpointFile(input.scanId), JSON.stringify({ step: "failed", at: input.now().toISOString(), reason: input.reason.trim(), abandoned: true }) + "\n");
  }
  return result;
}

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;
/** Funções do banco usadas pelo fluxo oficial (somente RPC das funções da interface + leituras). */
export function officialScanApi(rpc: Rpc, base: { readState(): Promise<RemoteFullState>; verifyChain(): Promise<unknown[]> },
  countScanObjects: (scanId: string) => Promise<number>): OfficialScanApi {
  const obj = async (fn: string, args: Record<string, unknown>) => ((await rpc(fn, args)) ?? {}) as Record<string, unknown>;
  return {
    policyCurrent: async () => (await obj("storage_lifecycle_scan_policy_current", {})) as unknown as { policy_version: number; required_sources: string[] },
    beginRun: async (scanId, actor) => (await obj("storage_lifecycle_begin_scan_run", { p_scan_id: scanId, p_actor: actor })) as unknown as Awaited<ReturnType<OfficialScanApi["beginRun"]>>,
    finishRun: (scanId, result, actor, details) => obj("storage_lifecycle_finish_scan_run", { p_scan_id: scanId, p_result: result, p_actor: actor, p_details: details }),
    registerScan: (payload, actor) => obj("storage_lifecycle_register_scan", { p_scan: payload, p_actor: actor }),
    attestScan: (scanId, version, manifest, sha, actor) => obj("storage_lifecycle_attest_scan", { p_scan_id: scanId, p_policy_version: version, p_manifest: manifest, p_report_sha256: sha, p_actor: actor }),
    syncScan: (scanId, objects, actor) => obj("storage_lifecycle_sync_scan", { p_scan_id: scanId, p_objects: objects, p_actor: actor }),
    invalidateScan: (scanId, reason, actor) => obj("storage_lifecycle_invalidate_scan", { p_scan_id: scanId, p_reason: reason, p_actor: actor }),
    readState: () => base.readState(),
    scanObjectCount: countScanObjects,
    meetsPolicy: async (scanId) => (await rpc("storage_lifecycle_scan_meets_policy", { p_scan_id: scanId })) === true,
    verifyChain: () => base.verifyChain(),
  };
}

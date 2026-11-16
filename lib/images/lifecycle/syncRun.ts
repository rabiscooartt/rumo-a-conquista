// Etapa 4 — execução da sincronização inicial (núcleo). Usado pelo script
// scripts/image-lifecycle-sync.mjs; o modo "apply" só roda com --apply --confirm-remote.
//
// Ordem fixa, sempre reconferindo o estado remoto antes de cada passo:
//   1. storage_lifecycle_register_scan     (idempotente: already_registered)
//   2. storage_lifecycle_sync_scan         (idempotente: already_synced; uma transação no banco)
//   3. storage_lifecycle_set_manual_protection × 4 (idempotente pela chave)
//   4. storage_operation_log_verify + conferência final
// Qualquer divergência interrompe ANTES da próxima escrita. Repetir o comando retoma de onde parou.
// Só chama funções da interface do ciclo de vida; nunca escreve direto nas tabelas.
import type { ParsedHistory } from "./history.ts";
import {
  buildSyncPlan,
  splitObjectKey,
  type RegisterScanPayload,
  type RemoteLifecycleState,
  type ScanRecordFile,
  type ScanReport,
  type SyncObjectPayload,
  type SyncPlan,
} from "./syncPlan.ts";

export type ManualProtection = { objectKey: string; reason: string };

/** As quatro artes do Mouse: artes corretas identificadas no diagnóstico, protegidas mesmo sem referência. */
export const MOUSE_MANUAL_PROTECTIONS: readonly ManualProtection[] = [
  ["16-de-capa-a-capa.png", "De Capa a Capa"],
  ["24-queijo-e-fumaca.png", "Queijo e Fumaça"],
  ["27-nossos-irmaos-menores.png", "Nossos Irmãos Menores"],
  ["29-tinsel-boulevard.png", "Tinsel Boulevard"],
].map(([file, title]) => ({
  objectKey: `achievement-art/games/mouse-p-i-for-hire/achievements/${file}`,
  reason: `Arte correta da conquista "${title}" de Mouse: P.I. for Hire, identificada no diagnóstico das imagens; protegida por decisão manual mesmo sem referência no banco.`,
}));

export type RemoteObjectFull = RemoteLifecycleState["objects"][number] & { manual_protection_reason?: string | null };
export type RemoteFullState = Omit<RemoteLifecycleState, "objects"> & { objects: RemoteObjectFull[] };
export type LifecycleApi = {
  readState(): Promise<RemoteFullState>;
  registerScan(payload: RegisterScanPayload, actor: string): Promise<Record<string, unknown>>;
  syncScan(scanId: string, objects: SyncObjectPayload[], actor: string): Promise<Record<string, unknown>>;
  setManualProtection(key: string, bucket: string, path: string, actor: string, reason: string): Promise<Record<string, unknown>>;
  verifyChain(): Promise<unknown[]>;
};

export type RunInput = {
  mode: "dry-run" | "apply";
  scanId: string;
  report: ScanReport;
  reportSha256: string;
  /** SHA-256 aprovado, informado na linha de comando. Obrigatório no modo apply. */
  expectedReportSha256?: string;
  scanRecord: ScanRecordFile;
  history: ParsedHistory;
  protectedObjects: readonly string[];
  protections: readonly ManualProtection[];
  actor: string;
  now: () => Date;
  api: LifecycleApi;
  log: (event: RunEvent) => void;
};
export type RunEvent =
  | { kind: "info"; message: string }
  | { kind: "planned"; step: string; detail: string }
  | { kind: "result"; step: string; result: Record<string, unknown> }
  | { kind: "skipped"; step: string; reason: string }
  | { kind: "stop"; reason: string };
export type RunResult = { ok: boolean; stoppedAt?: string; reason?: string; plan?: SyncPlan; writes: number };

export const protectionKey = (scanId: string, objectKey: string) => `manual-protect:${scanId}:${objectKey}`;
export const EXPECTED_LOG_ROWS = (protections: number) => 4 + 2 * protections;

class Stop extends Error {}

/** O estado remoto bate exatamente com o esperado depois da sincronização (e das proteções já feitas)? */
export function remoteDivergences(plan: SyncPlan, remote: RemoteFullState, protections: readonly ManualProtection[]) {
  const problems: string[] = [];
  const expected = new Map(plan.predicted.map((p) => [p.objectKey, p]));
  const manual = new Set(protections.map((p) => p.objectKey));
  const seen = new Set<string>();
  for (const row of remote.objects) {
    const key = `${row.bucket}/${row.object_path}`;
    if (seen.has(key)) problems.push(`${key}: duplicado no inventário`);
    seen.add(key);
    const want = expected.get(key);
    if (!want) { problems.push(`${key}: objeto inesperado no banco`); continue; }
    if (row.state !== want.applied) problems.push(`${key}: estado ${row.state}, esperado ${want.applied}`);
    if (row.reference_count !== want.referenceCount) problems.push(`${key}: ${row.reference_count} referência(s), esperado ${want.referenceCount}`);
    if (row.archive_state !== "none") problems.push(`${key}: archive_state ${row.archive_state}`);
    if (row.manual_protection && !manual.has(key)) problems.push(`${key}: proteção manual fora da lista`);
    if (row.last_seen_scan_id !== plan.scanId) problems.push(`${key}: última varredura ${row.last_seen_scan_id}`);
  }
  for (const key of expected.keys()) if (!seen.has(key)) problems.push(`${key}: ausente do banco`);
  if (remote.scanObjectRows !== plan.counts.objects) problems.push(`${remote.scanObjectRows} linha(s) de evidência, esperado ${plan.counts.objects}`);
  if (remote.objects.some((r) => r.state === "candidate" || r.state === "duplicate")) problems.push("estado candidate/duplicate presente");
  if (remote.pendingOperations > 0) problems.push(`${remote.pendingOperations} operação(ões) pendente(s)`);
  return problems;
}

export async function runInitialSync(input: RunInput): Promise<RunResult> {
  const { api, log, scanId, actor } = input;
  let writes = 0;
  let plan: SyncPlan | undefined;
  const stop = (reason: string): never => { log({ kind: "stop", reason }); throw new Stop(reason); };
  const freshPlan = async () => {
    const remote = await api.readState();
    const built = buildSyncPlan({
      scanId, report: input.report, reportSha256: input.reportSha256, scanRecord: input.scanRecord, history: input.history,
      remote, protectedObjects: input.protectedObjects, now: input.now(),
    });
    if (!built.ready) stop(`plano bloqueado: ${built.blockers.join("; ")}`);
    if (built.sync?.action === "sync" && (remote.objects.length > 0 || remote.scanObjectRows > 0)) {
      stop("sincronização inicial exige as tabelas de objetos vazias; o banco já tem objetos");
    }
    return { plan: built, remote };
  };

  try {
    // 0. Baseline e proteções conferidas antes de qualquer escrita.
    if (input.mode === "apply") {
      if (!input.expectedReportSha256 || !/^[0-9a-f]{64}$/.test(input.expectedReportSha256)) stop("modo apply exige --report-sha256 com o SHA-256 aprovado");
      if (input.expectedReportSha256 !== input.reportSha256) stop(`SHA-256 do relatório (${input.reportSha256}) difere do aprovado (${input.expectedReportSha256})`);
    }
    const protectedSet = new Set(input.protectedObjects);
    if (input.protections.length !== protectedSet.size || input.protections.some((p) => !protectedSet.has(p.objectKey) || p.reason.trim().length < 20)) {
      stop("proteções manuais não correspondem à lista de proteção ou estão sem justificativa");
    }

    // Resultado esperado da baseline, calculado SEM olhar o banco: é contra ele que o remoto é conferido.
    const expected = buildSyncPlan({
      scanId, report: input.report, reportSha256: input.reportSha256, scanRecord: input.scanRecord, history: input.history,
      remote: { scans: [], objects: [], scanObjectRows: 0, logRows: 0, syncedScanIds: [], pendingOperations: 0 },
      protectedObjects: input.protectedObjects, now: input.now(),
    });
    if (!expected.ready) stop(`relatório recusado: ${expected.blockers.join("; ")}`);
    if (expected.counts.candidates > 0 || expected.counts.overrides > 0) stop("a baseline produziria candidatos ou ajustes de classificação");

    let current = await freshPlan();
    plan = current.plan;
    log({ kind: "info", message: `relatório ${scanId} · SHA-256 ${input.reportSha256} · ${plan.counts.objects} objetos · estado remoto: ${current.remote.scans.length} varredura(s), ${current.remote.objects.length} objeto(s), ${current.remote.logRows} linha(s) de auditoria` });
    if (plan.sync?.action === "already_synced") {
      const problems = remoteDivergences(expected, current.remote, input.protections);
      if (problems.length) stop(`estado remoto diverge do esperado: ${problems.slice(0, 10).join("; ")}`);
    }

    // 1. Registro da varredura.
    const register = plan.register!;
    if (register.action === "register") {
      log({ kind: "planned", step: "register_scan", detail: JSON.stringify(register.payload) });
      if (input.mode === "apply") {
        const result = await api.registerScan(register.payload, actor);
        writes += 1;
        log({ kind: "result", step: "register_scan", result });
        if (result.status !== "registered" && result.status !== "already_registered") stop(`register_scan devolveu ${JSON.stringify(result)}`);
      }
    } else log({ kind: "skipped", step: "register_scan", reason: "já registrada com os mesmos dados" });

    // 2. Sincronização (reconfere o estado antes).
    if (input.mode === "apply") { current = await freshPlan(); plan = current.plan; }
    if (plan.sync!.action === "sync") {
      log({ kind: "planned", step: "sync_scan", detail: `${plan.sync!.objects.length} objetos · previsão: inserir ${plan.counts.insert}, ajustes ${plan.counts.overrides}, ausentes ${plan.counts.missing}, estados ${JSON.stringify(plan.counts.byState)}` });
      if (input.mode === "apply") {
        const result = await api.syncScan(scanId, plan.sync!.objects, actor);
        writes += 1;
        log({ kind: "result", step: "sync_scan", result: { ...result, override_details: undefined } });
        const okSynced = result.status === "synced" && result.inserted === plan.counts.insert && result.updated === 0 && result.overrides === 0
          && result.missing === 0 && result.state_changes === 0 && result.evidence_rows === plan.counts.objects;
        if (!okSynced && result.status !== "already_synced") stop(`sync_scan devolveu resultado diferente da previsão: ${JSON.stringify(result)}`);
      }
    } else log({ kind: "skipped", step: "sync_scan", reason: "varredura já sincronizada" });

    // 3. Proteções manuais (reconfere o inventário inteiro antes).
    if (input.mode === "apply") {
      current = await freshPlan();
      plan = current.plan;
      const problems = remoteDivergences(expected, current.remote, input.protections);
      if (problems.length) stop(`estado remoto diverge do esperado depois da sincronização: ${problems.slice(0, 10).join("; ")}`);
    }
    const rows = new Map(current.remote.objects.map((r) => [`${r.bucket}/${r.object_path}`, r]));
    for (const protection of input.protections) {
      const step = `set_manual_protection ${protection.objectKey}`;
      if (rows.get(protection.objectKey)?.manual_protection) { log({ kind: "skipped", step, reason: "proteção manual já ativa" }); continue; }
      const parts = splitObjectKey(protection.objectKey)!;
      log({ kind: "planned", step, detail: `chave ${protectionKey(scanId, protection.objectKey)} · motivo: ${protection.reason}` });
      if (input.mode === "apply") {
        const result = await api.setManualProtection(protectionKey(scanId, protection.objectKey), parts.bucket, parts.path, actor, protection.reason);
        writes += 1;
        log({ kind: "result", step, result });
        if (!["applied", "already_applied", "already_protected"].includes(String(result.status))) stop(`set_manual_protection devolveu ${JSON.stringify(result)}`);
      }
    }

    // 4. Conferência final.
    if (input.mode === "apply") {
      const finalState = await api.readState();
      const problems = remoteDivergences(expected, finalState, input.protections);
      const manualOn = finalState.objects.filter((r) => r.manual_protection);
      if (manualOn.length !== input.protections.length || manualOn.some((r) => r.state !== "protected" || !(r.manual_protection_reason ?? "").trim())) {
        problems.push(`${manualOn.length} proteção(ões) manual(is) ativa(s), esperado ${input.protections.length} com motivo`);
      }
      if (finalState.logRows !== EXPECTED_LOG_ROWS(input.protections.length)) problems.push(`${finalState.logRows} linha(s) de auditoria, esperado ${EXPECTED_LOG_ROWS(input.protections.length)}`);
      const chain = await api.verifyChain();
      if (chain.length) problems.push(`cadeia de auditoria com ${chain.length} problema(s): ${JSON.stringify(chain.slice(0, 3))}`);
      if (problems.length) stop(`conferência final falhou: ${problems.slice(0, 10).join("; ")}`);
      log({ kind: "info", message: `conferência final: ${finalState.objects.length} objetos, ${manualOn.length} proteções manuais, ${finalState.logRows} linhas de auditoria, cadeia íntegra` });
    }
    return { ok: true, plan, writes };
  } catch (error) {
    if (error instanceof Stop) return { ok: false, stoppedAt: "parada", reason: error.message, plan, writes };
    const message = error instanceof Error ? error.message : String(error);
    log({ kind: "stop", reason: `erro: ${message}` });
    return { ok: false, stoppedAt: "erro", reason: message, plan, writes };
  }
}

type RpcClient = {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
  from(table: string): {
    select(columns: string, options?: { count?: "exact"; head?: boolean }): unknown;
  };
};

/** Implementação pela API do Supabase (service_role): só SELECT nas tabelas/view e RPC das funções da interface. */
export function supabaseLifecycleApi(client: RpcClient): LifecycleApi {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.code ?? ""} ${error.message}`.trim());
    return data;
  };
  type Query = PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null; count: number | null }> & {
    eq(c: string, v: string): Query; order(c: string): Query; limit(n: number): Query;
  };
  const select = async (table: string, columns: string, build: (q: Query) => Query = (q) => q, count = false) => {
    const query = client.from(table).select(columns, count ? { count: "exact" } : undefined) as Query;
    const { data, error, count: total } = await build(query);
    if (error) throw new Error(`leitura de ${table}: ${error.message}`);
    return { rows: data ?? [], count: total ?? 0 };
  };
  return {
    async readState() {
      const scans = await select("storage_lifecycle_scans", "scan_id, completed_at, complete, inventory_status, image_objects, image_bytes, report_sha256");
      const objects = await select("storage_object_lifecycle",
        "bucket, object_path, state, manual_protection, manual_protection_reason, archive_state, reference_count, observing_since, observing_since_scan_id, last_seen_scan_id",
        (q) => q.order("bucket").order("object_path").limit(5000));
      const scanObjects = await select("storage_lifecycle_scan_objects", "scan_id", (q) => q.limit(1), true);
      const log = await select("storage_operation_log", "id", (q) => q.limit(1), true);
      const synced = await select("storage_operation_log", "scan_id", (q) => q.eq("operation", "scan_sync").eq("phase", "succeeded"));
      const pending = await select("storage_lifecycle_pending_operations", "operation_id", (q) => q.limit(1), true);
      return {
        scans: scans.rows as unknown as RemoteLifecycleState["scans"],
        objects: objects.rows as unknown as RemoteObjectFull[],
        scanObjectRows: scanObjects.count,
        logRows: log.count,
        syncedScanIds: synced.rows.map((r) => String(r.scan_id)),
        pendingOperations: pending.count,
      };
    },
    registerScan: async (payload, actor) => (await rpc("storage_lifecycle_register_scan", { p_scan: payload, p_actor: actor })) as Record<string, unknown>,
    syncScan: async (scanId, objects, actor) => (await rpc("storage_lifecycle_sync_scan", { p_scan_id: scanId, p_objects: objects, p_actor: actor })) as Record<string, unknown>,
    setManualProtection: async (key, bucket, path, actor, reason) =>
      (await rpc("storage_lifecycle_set_manual_protection", {
        p_idempotency_key: key, p_bucket: bucket, p_object_path: path, p_protect: true, p_actor: actor, p_reason: reason,
      })) as Record<string, unknown>,
    verifyChain: async () => ((await rpc("storage_operation_log_verify", {})) as unknown[] | null) ?? [],
  };
}

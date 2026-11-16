// Etapa 4 — plano da sincronização inicial (SOMENTE PLANEJAMENTO; nada aqui escreve em lugar nenhum).
//
// Valida o relatório local de uma varredura, monta exatamente o que seria enviado às funções da
// interface do ciclo de vida (storage_lifecycle_register_scan e storage_lifecycle_sync_scan) e
// simula, com as MESMAS regras da função SQL, o que a sincronização faria com o estado remoto lido.
// Qualquer divergência vira bloqueio: o plano só é "pronto" sem nenhum bloqueio.
//
// Regras deliberadas:
//   - sha256 das imagens NÃO é enviado (a varredura não baixa imagens; nada é inventado);
//   - reference_count = referências de uso (todas as fontes, exceto a lista de proteção);
//   - estado "candidate" no relatório é bloqueio (só há uma baseline válida);
//   - nenhuma data é criada aqui: a única data enviada é completed_at da própria varredura.
import type { ParsedHistory } from "./history.ts";
import { effectiveHistory } from "./history.ts";

export const SYNC_STATES = ["protected", "active", "referenced", "unverified", "duplicate", "observing", "candidate", "superseded"] as const;
export type SyncState = (typeof SYNC_STATES)[number];

export const REQUIRED_SOURCES = [
  "achievements", "achievement_progress", "games", "journey_entries", "journey_history_events",
  "pointers", "drafts", "variant_map", "protection",
] as const;

type ReportReference = { objectKey: string; source: string; location: string };
export type ReportObject = {
  objectKey: string;
  state: string;
  size: number | null;
  mimetype: string | null;
  references: ReportReference[];
  reasons?: string[];
};
export type ScanReport = {
  scanId: string;
  at: string;
  existingBuckets: string[];
  evidenceComplete: boolean;
  blockers: unknown[];
  issues: unknown[];
  byBucket: Record<string, { images: number; imageBytes: number }>;
  byState: Record<string, { count: number; bytes: number }>;
  sourceStatus: { source: string; status: string; error: string | null; unparsed: number }[];
  danglingReferences?: unknown[];
  validations: {
    inventoryComplete: boolean;
    allTablesRead: boolean;
    protectedOk: boolean;
    missingProtected: string[];
    failuresTreatedAsAbsence?: boolean;
  };
  objects: ReportObject[];
};
export type ScanRecordFile = {
  scanId: string;
  completedAt: string;
  complete: boolean;
  inventoryStatus?: string;
  imageObjects?: number;
  present?: string[];
  unreferenced?: string[];
};

export type RemoteScanRow = {
  scan_id: string; completed_at: string; complete: boolean; inventory_status: string;
  image_objects: number; image_bytes: number; report_sha256: string | null;
};
export type RemoteObjectRow = {
  bucket: string; object_path: string; state: SyncState; manual_protection: boolean; archive_state: string;
  reference_count: number; observing_since: string | null; observing_since_scan_id: string | null; last_seen_scan_id: string;
};
export type RemoteLifecycleState = {
  scans: RemoteScanRow[];
  objects: RemoteObjectRow[];
  scanObjectRows: number;
  logRows: number;
  syncedScanIds: string[];
  pendingOperations: number;
};

export type SyncObjectPayload = {
  bucket: string;
  path: string;
  state: SyncState;
  reference_count: number;
  size: number;
  mimetype: string;
  protected_reason?: string;
};
export type RegisterScanPayload = {
  scan_id: string; completed_at: string; complete: true; inventory_status: "complete";
  image_objects: number; image_bytes: number; report_sha256: string;
};
export type PredictedObject = {
  objectKey: string;
  requested: SyncState;
  applied: SyncState;
  action: "insert" | "update" | "preserve";
  referenceCount: number;
  observingSinceScan: string | null;
  lastReferencedScan: string | null;
  protectedReason: string | null;
  override: string | null;
};
export type SyncPlan = {
  ready: boolean;
  blockers: string[];
  scanId: string;
  reportSha256: string;
  register: { action: "register" | "already_registered"; payload: RegisterScanPayload } | null;
  sync: { action: "sync" | "already_synced"; objects: SyncObjectPayload[] } | null;
  predicted: PredictedObject[];
  counts: {
    objects: number; insert: number; update: number; preserve: number; blocked: number;
    overrides: number; stateChanges: number; missing: number; candidates: number;
    byState: Record<string, number>; protectedObjects: number; logRowsExpected: number;
  };
};

const STATE_SET = new Set<string>(SYNC_STATES);
const BUCKET_RE = /^[a-z0-9][a-z0-9._-]{1,62}$/;
const SCAN_ID_RE = /^scan-[0-9]{8}T[0-9]{6}Z$/;
const SHA_RE = /^[0-9a-f]{64}$/;

export function splitObjectKey(objectKey: string) {
  const slash = objectKey.indexOf("/");
  if (slash <= 0) return null;
  const bucket = objectKey.slice(0, slash);
  const path = objectKey.slice(slash + 1);
  const pathOk = path !== "" && !path.startsWith("/") && !/(^|\/)\.{1,2}(\/|$)/.test(path) && !path.includes("//") && path.length <= 1024;
  return BUCKET_RE.test(bucket) && pathOk ? { bucket, path } : null;
}

function sameSet(a: Iterable<string>, b: Iterable<string>) {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((x) => right.has(x));
}

export type SyncPlanInput = {
  scanId: string;
  report: ScanReport;
  reportSha256: string;
  scanRecord: ScanRecordFile;
  history: ParsedHistory;
  remote: RemoteLifecycleState;
  protectedObjects: readonly string[];
  now: Date;
};

export function buildSyncPlan(input: SyncPlanInput): SyncPlan {
  const { scanId, report, reportSha256, scanRecord, history, remote, protectedObjects, now } = input;
  const blockers: string[] = [];
  const block = (message: string) => blockers.push(message);

  // ---------- 1. Identidade, histórico e validade da varredura ----------
  if (!SCAN_ID_RE.test(scanId)) block(`identificador de varredura inválido: ${scanId}`);
  if (!SHA_RE.test(reportSha256)) block("SHA-256 do relatório inválido");
  if (report.scanId !== scanId) block(`relatório é de ${report.scanId}, não de ${scanId}`);
  if (scanRecord.scanId !== scanId) block(`scan-record.json é de ${scanRecord.scanId}, não de ${scanId}`);
  if (scanRecord.completedAt !== report.at) block("data do scan-record.json diverge do relatório");
  if (history.unreadableLines > 0) block(`histórico local com ${history.unreadableLines} linha(s) ilegível(is)`);
  const { history: valid } = effectiveHistory(history);
  const entry = valid.find((h) => h.scanId === scanId);
  const invalidated = history.invalidations.some((i) => i.scanId === scanId);
  if (invalidated) block(`varredura ${scanId} invalidada no histórico local`);
  if (!entry) block(`varredura ${scanId} não é uma varredura válida no histórico local`);
  else {
    if (!entry.complete) block("histórico marca a varredura como incompleta");
    if (entry.completedAt !== report.at) block("data do histórico diverge do relatório");
  }
  const completedAt = new Date(report.at);
  if (Number.isNaN(completedAt.getTime())) block("data da varredura ilegível");
  else if (completedAt.getTime() > now.getTime() + 5 * 60 * 1000) block("varredura com data no futuro");

  // ---------- 2. Completude ----------
  if (report.evidenceComplete !== true) block("evidência incompleta no relatório");
  if (!report.validations?.inventoryComplete) block("inventário incompleto");
  if (!report.validations?.allTablesRead) block("nem todas as tabelas foram lidas");
  if (!report.validations?.protectedOk || (report.validations?.missingProtected ?? []).length > 0) block("objeto protegido ausente");
  if (report.validations?.failuresTreatedAsAbsence) block("falhas tratadas como ausência");
  if ((report.blockers ?? []).length > 0) block(`relatório com ${report.blockers.length} bloqueio(s)`);
  if ((report.issues ?? []).length > 0) block(`relatório com ${report.issues.length} ocorrência(s)`);
  if ((report.danglingReferences ?? []).length > 0) block("referências sem objeto no relatório");
  if (scanRecord.complete !== true || (scanRecord.inventoryStatus && scanRecord.inventoryStatus !== "complete")) block("scan-record.json não marca varredura completa");
  for (const source of REQUIRED_SOURCES) {
    const status = report.sourceStatus.find((s) => s.source === source);
    if (!status) block(`fonte ${source} ausente do relatório`);
    else if (status.status !== "complete" || status.error || status.unparsed > 0) block(`fonte ${source} incompleta (${status.status}${status.error ? `: ${status.error}` : ""}${status.unparsed ? `, ${status.unparsed} não interpretada(s)` : ""})`);
  }

  // ---------- 3. Os objetos ----------
  const objects = report.objects ?? [];
  const keys = objects.map((o) => o.objectKey);
  if (new Set(keys).size !== keys.length) block("chaves de objeto duplicadas no relatório");
  const bucketImages = Object.values(report.byBucket ?? {}).reduce((sum, b) => sum + b.images, 0);
  const bucketBytes = Object.values(report.byBucket ?? {}).reduce((sum, b) => sum + b.imageBytes, 0);
  if (scanRecord.imageObjects !== undefined && scanRecord.imageObjects !== objects.length) block(`scan-record.json diz ${scanRecord.imageObjects} imagens, relatório tem ${objects.length}`);
  if (bucketImages !== objects.length) block(`contagem por bucket (${bucketImages}) diverge dos objetos (${objects.length})`);
  if (!scanRecord.present || !sameSet(scanRecord.present, keys)) block("lista 'present' do scan-record.json não corresponde aos objetos do relatório");
  // Mesma definição do classificador: sem referência de uso, fora da proteção e da versão ativa.
  const noRefs = objects
    .filter((o) => o.state !== "protected" && o.state !== "active" && o.references.every((r) => r.source === "protection"))
    .map((o) => o.objectKey);
  if (!scanRecord.unreferenced || !sameSet(scanRecord.unreferenced, noRefs)) block("lista 'unreferenced' do scan-record.json não corresponde às evidências");
  const stateCounts: Record<string, number> = {};
  for (const o of objects) stateCounts[o.state] = (stateCounts[o.state] ?? 0) + 1;
  for (const [state, value] of Object.entries(report.byState ?? {})) {
    if ((stateCounts[state] ?? 0) !== value.count) block(`contagem do estado ${state} diverge (${value.count} × ${stateCounts[state] ?? 0})`);
  }
  if (Object.keys(stateCounts).some((s) => !(s in (report.byState ?? {})))) block("estado presente nos objetos e ausente do resumo");

  const protectedKeys = objects.filter((o) => o.state === "protected").map((o) => o.objectKey);
  if (!sameSet(protectedKeys, protectedObjects)) block(`objetos protegidos (${protectedKeys.length}) não correspondem à lista de proteção (${protectedObjects.length})`);

  let imageBytes = 0;
  const payload: SyncObjectPayload[] = [];
  for (const o of objects) {
    const where = o.objectKey;
    const parts = splitObjectKey(o.objectKey);
    if (!parts) { block(`${where}: chave inválida`); continue; }
    if (!report.existingBuckets.includes(parts.bucket)) block(`${where}: bucket fora do inventário`);
    if (!STATE_SET.has(o.state)) { block(`${where}: estado desconhecido ${o.state}`); continue; }
    if (o.state === "candidate") block(`${where}: candidato numa sincronização com uma única baseline`);
    if (o.state === "unverified" || o.state === "duplicate") block(`${where}: estado ${o.state} não esperado nesta baseline`);
    if (!Number.isInteger(o.size) || (o.size as number) < 0) block(`${where}: tamanho ausente ou inválido`);
    if (typeof o.mimetype !== "string" || !o.mimetype.startsWith("image/")) block(`${where}: tipo ${o.mimetype ?? "ausente"} não é imagem`);
    if (o.references.some((r) => r.objectKey !== o.objectKey)) block(`${where}: referência apontando para outro objeto`);
    const protection = o.references.filter((r) => r.source === "protection");
    const usage = o.references.filter((r) => r.source !== "protection");
    if ((o.state === "protected") !== (protection.length > 0)) block(`${where}: proteção e estado divergentes`);
    if (["observing", "superseded"].includes(o.state) && usage.length > 0) block(`${where}: ${o.state} com ${usage.length} referência(s)`);
    if (o.state === "referenced" && usage.length === 0) block(`${where}: referenced sem referência`);
    imageBytes += o.size ?? 0;
    payload.push({
      bucket: parts.bucket,
      path: parts.path,
      state: o.state as SyncState,
      reference_count: usage.length,
      size: o.size as number,
      mimetype: o.mimetype as string,
      ...(o.state === "protected" ? { protected_reason: `lista de proteção (${protection.map((r) => r.location).join("; ")})` } : {}),
    });
  }
  if (imageBytes !== bucketBytes) block(`soma dos tamanhos (${imageBytes}) diverge do resumo por bucket (${bucketBytes})`);

  const registerPayload: RegisterScanPayload = {
    scan_id: scanId, completed_at: report.at, complete: true, inventory_status: "complete",
    image_objects: objects.length, image_bytes: imageBytes, report_sha256: reportSha256,
  };

  // ---------- 4. Estado remoto ----------
  let registerAction: "register" | "already_registered" = "register";
  let syncAction: "sync" | "already_synced" = "sync";
  const remoteScan = remote.scans.find((s) => s.scan_id === scanId);
  if (remoteScan) {
    const same = new Date(remoteScan.completed_at).getTime() === completedAt.getTime() && remoteScan.complete === true
      && remoteScan.inventory_status === "complete" && Number(remoteScan.image_objects) === registerPayload.image_objects
      && Number(remoteScan.image_bytes) === registerPayload.image_bytes && remoteScan.report_sha256 === reportSha256;
    if (!same) block(`varredura ${scanId} já registrada no banco com outros dados (relatório ou contagens diferentes)`);
    registerAction = "already_registered";
  }
  if (remote.syncedScanIds.includes(scanId)) syncAction = "already_synced";
  for (const other of remote.scans) {
    if (other.scan_id !== scanId && remote.syncedScanIds.includes(other.scan_id) && new Date(other.completed_at).getTime() >= completedAt.getTime()) {
      block(`varredura ${other.scan_id}, igual ou mais recente, já sincronizada: ${scanId} ficaria fora de ordem`);
    }
  }
  if (remote.pendingOperations > 0) block(`${remote.pendingOperations} operação(ões) pendente(s) no banco`);
  if (remote.scans.length === 0 && (remote.objects.length > 0 || remote.scanObjectRows > 0)) block("tabelas de objetos com linhas sem nenhuma varredura registrada");

  // ---------- 5. Simulação (mesmas regras de storage_lifecycle_sync_scan) ----------
  const existing = new Map(remote.objects.map((r) => [`${r.bucket}/${r.object_path}`, r]));
  const predicted: PredictedObject[] = [];
  let overrides = 0;
  let stateChanges = 0;
  let blocked = 0;
  for (const item of payload) {
    const key = `${item.bucket}/${item.path}`;
    const row = existing.get(key);
    if (syncAction === "already_synced") {
      predicted.push({ objectKey: key, requested: item.state, applied: (row?.state ?? item.state), action: "preserve", referenceCount: item.reference_count,
        observingSinceScan: row?.observing_since_scan_id ?? null, lastReferencedScan: null, protectedReason: null, override: null });
      continue;
    }
    let applied: SyncState = item.state;
    let override: string | null = null;
    const conflict = !!row && ["deleting", "deleted", "restoring"].includes(row.archive_state);
    if (conflict) { applied = "unverified"; override = `objeto em ${row!.archive_state}; estado atual preservado`; blocked += 1; }
    else if (row?.manual_protection && item.state !== "protected") { applied = "protected"; override = "proteção manual prevalece"; }
    else if (row && row.state === "protected" && item.state !== "protected") { applied = "protected"; override = "protegido só sai por proteção manual"; }
    else if (item.reference_count > 0 && ["observing", "candidate", "superseded", "duplicate"].includes(item.state)) { applied = "referenced"; override = `estado ${item.state} com referências`; }
    if (applied === "candidate") { applied = "observing"; override = "candidato sem prova (primeira sincronização)"; }
    if (override) overrides += 1;
    const unreferenced = item.reference_count === 0 && ["observing", "candidate", "superseded", "duplicate", "unverified"].includes(applied);
    const referencedNow = item.reference_count > 0 || applied === "active" || applied === "referenced";
    if (row && !conflict && row.state !== applied) stateChanges += 1;
    predicted.push({
      objectKey: key,
      requested: item.state,
      applied,
      action: conflict ? "preserve" : row ? "update" : "insert",
      referenceCount: item.reference_count,
      observingSinceScan: unreferenced ? (row?.observing_since_scan_id ?? scanId) : null,
      lastReferencedScan: referencedNow ? scanId : null,
      protectedReason: applied === "protected" ? (row?.state === "protected" ? "(mantém o atual)" : item.protected_reason ?? "lista de proteção") : null,
      override,
    });
  }
  const seen = new Set(payload.map((p) => `${p.bucket}/${p.path}`));
  const missing = syncAction === "sync"
    ? remote.objects.filter((r) => ["none", "archiving", "archived"].includes(r.archive_state) && !seen.has(`${r.bucket}/${r.object_path}`)).length
    : 0;

  const byState: Record<string, number> = {};
  for (const p of predicted) byState[p.applied] = (byState[p.applied] ?? 0) + 1;
  const candidates = predicted.filter((p) => p.applied === "candidate").length;
  if (candidates > 0) block(`${candidates} candidato(s) previsto(s) — proibido nesta sincronização`);

  const logRowsExpected =
    (registerAction === "register" ? 2 : 0) +
    (syncAction === "sync" ? 2 + 2 * overrides + 2 * stateChanges + 2 * missing : 0);

  return {
    ready: blockers.length === 0,
    blockers,
    scanId,
    reportSha256,
    register: { action: registerAction, payload: registerPayload },
    sync: { action: syncAction, objects: payload },
    predicted,
    counts: {
      objects: payload.length,
      insert: predicted.filter((p) => p.action === "insert").length,
      update: predicted.filter((p) => p.action === "update").length,
      preserve: predicted.filter((p) => p.action === "preserve").length,
      blocked,
      overrides,
      stateChanges,
      missing,
      candidates,
      byState,
      protectedObjects: predicted.filter((p) => p.applied === "protected").length,
      logRowsExpected,
    },
  };
}

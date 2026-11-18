// Montagem do relatório de uma varredura a partir da coleta e da classificação (sem E/S).
// Mesmo formato de .image-report/lifecycle/<scanId>/report.json e scan-record.json produzido por
// scripts/image-lifecycle-scan.mjs, para que o plano de sincronização (syncPlan.ts) valide os dois.
import { classifyImages, type ScanRecord } from "./classify.ts";
import type { CollectedSources } from "./collect.ts";
import { DEFAULT_PROTECTED_OBJECTS, type ImageReference, type SourceResult } from "./references.ts";
import type { ScanRecordFile, ScanReport } from "./syncPlan.ts";

export type ScanArtifacts = {
  report: ScanReport & Record<string, unknown>;
  scanRecord: ScanRecordFile & Record<string, unknown>;
  usage: Record<string, unknown>;
};

const slimRef = (ref: ImageReference) => ({ objectKey: ref.objectKey, source: ref.source, location: ref.location });

export function buildScanArtifacts(input: {
  scanId: string;
  now: Date;
  collected: CollectedSources;
  sources: SourceResult[];
  /** Histórico que vale como evidência local (o banco decide a elegibilidade de verdade). */
  history: ScanRecord[];
  historyWarnings?: string[];
  invalidatedScans?: string[];
  /** Campos extras do relatório (ex.: execução oficial, versão da política, manifesto). */
  reportExtra?: Record<string, unknown>;
  /** Campos extras do registro do histórico. */
  recordExtra?: Record<string, unknown>;
}): ScanArtifacts {
  const { scanId, now, collected, sources, history } = input;
  const result = classifyImages(collected.inventory, sources, { now, history, scanId, safetyPeriodDays: 30 });
  const validPriorScans = history.filter((h) => h.complete).map((h) => h.scanId);

  const objectByKey = new Map(collected.allImageObjects.map((o) => [`${o.bucket}/${o.path}`, o]));
  const objects = result.objects.map((item) => {
    const meta = objectByKey.get(item.objectKey);
    return {
      objectKey: item.objectKey, state: item.state, size: meta?.size ?? null, mimetype: meta?.mimetype ?? null,
      createdAt: meta?.createdAt ?? null, updatedAt: meta?.updatedAt ?? null, reasons: item.reasons,
      references: item.references.map(slimRef), unreferencedSince: item.unreferencedSince ?? null,
    };
  });

  const byBucket: Record<string, { images: number; imageBytes: number; nonImages: number; nonImageBytes: number }> = {};
  const bucketOf = (bucket: string) => (byBucket[bucket] ??= { images: 0, imageBytes: 0, nonImages: 0, nonImageBytes: 0 });
  for (const o of collected.allImageObjects) { bucketOf(o.bucket).images += 1; bucketOf(o.bucket).imageBytes += o.size ?? 0; }
  for (const o of collected.nonImageObjects) { bucketOf(o.bucket).nonImages += 1; bucketOf(o.bucket).nonImageBytes += o.size ?? 0; }
  const byState: Record<string, { count: number; bytes: number }> = {};
  for (const o of objects) { const s = (byState[o.state] ??= { count: 0, bytes: 0 }); s.count += 1; s.bytes += o.size ?? 0; }
  const sourceStatus = sources.map((s) => ({ source: s.source, status: s.status, references: s.references.length, error: s.error ?? null, unparsed: s.unparsed?.length ?? 0 }));

  const protectedOk = DEFAULT_PROTECTED_OBJECTS.every((k) => objects.find((o) => o.objectKey === k)?.state === "protected");
  const missingProtected = DEFAULT_PROTECTED_OBJECTS.filter((k) => !objects.some((o) => o.objectKey === k));
  const validations = {
    inventoryComplete: collected.inventory.status === "complete",
    allTablesRead: Object.values(collected.tableCounts).every((n) => typeof n === "number"),
    imageDownloads: collected.counters.imageDownloads,
    protectedOk,
    missingProtected,
    candidatesTrustworthy: result.evidenceComplete && validPriorScans.length > 0,
    validPriorScans,
    invalidatedScans: input.invalidatedScans ?? [],
    historyWarnings: input.historyWarnings ?? [],
    failuresTreatedAsAbsence: objects.some((o) => o.state === "candidate") && !result.evidenceComplete,
  };

  const report = {
    scanId, at: now.toISOString(), project: "rumo-a-conquista", ...input.reportExtra,
    existingBuckets: collected.existingBuckets, evidenceComplete: result.evidenceComplete, blockers: result.blockers, issues: collected.issues,
    byBucket, byState, sourceStatus,
    pointerReadings: collected.pointerReadings.map((r) => ({ target: r.target.pointer, state: r.state, file: r.file ?? null, error: r.error ?? null })),
    danglingReferences: result.danglingReferences.map(slimRef), duplicateGroups: result.duplicateGroups,
    nonImageObjects: collected.nonImageObjects.map((o) => ({ objectKey: `${o.bucket}/${o.path}`, size: o.size, mimetype: o.mimetype })),
    validations, objects,
  };
  const scanRecord = {
    ...result.scanRecord, inventoryStatus: collected.inventory.status,
    sourceStatus: sourceStatus.map(({ source, status }) => ({ source, status })), imageObjects: objects.length, ...input.recordExtra,
  };
  return {
    report: report as unknown as ScanArtifacts["report"],
    scanRecord: scanRecord as unknown as ScanArtifacts["scanRecord"],
    usage: { ...collected.counters, tableCounts: collected.tableCounts },
  };
}

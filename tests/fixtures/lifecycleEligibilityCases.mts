// Converte os casos de tests/fixtures/lifecycle-eligibility-cases.json para a prova do TypeScript.
// O mesmo arquivo de casos é aplicado ao banco (funções storage_lifecycle_*) pelo executor local;
// os dois lados precisam dar o mesmo resultado.
import { readFileSync } from "node:fs";
import { evaluateEvidence, type Evidence } from "../../lib/images/lifecycle/evidence.ts";
import type { ScanRecord } from "../../lib/images/lifecycle/classify.ts";

export type CaseObject = { state: string; refs: number };
export type CaseScan = { id: string; at: string; complete: boolean; synced?: boolean; objects: Record<string, CaseObject> };
export type EligibilityCase = {
  name: string;
  scans: CaseScan[];
  invalidate?: string[];
  manual?: { protect?: string[]; release?: string[] };
  expected: Record<string, [boolean, string | null]>;
};

export const fixture = JSON.parse(readFileSync(new URL("./lifecycle-eligibility-cases.json", import.meta.url), "utf8")) as {
  bucket: string;
  cases: EligibilityCase[];
};

const BLOCKING = new Set(["protected", "active", "referenced"]);

/** Registros de varredura como o histórico local os guarda (invalidadas já como incompletas). */
export function scanRecordsFor(item: EligibilityCase, bucket: string): ScanRecord[] {
  const invalid = new Set(item.invalidate ?? []);
  return item.scans.map((scan) => {
    const keys = Object.keys(scan.objects).map((path) => `${bucket}/${path}`);
    // Varredura válida registrada mas sem evidência gravada: completa, sem ninguém presente.
    if (!scan.complete || scan.synced === false) {
      return { scanId: scan.id, completedAt: scan.at, complete: scan.complete && !invalid.has(scan.id), unreferenced: [], present: [] };
    }
    return {
      scanId: scan.id,
      completedAt: scan.at,
      complete: !invalid.has(scan.id),
      present: keys.sort(),
      unreferenced: Object.entries(scan.objects)
        .filter(([, object]) => object.refs === 0 && !BLOCKING.has(object.state))
        .map(([path]) => `${bucket}/${path}`)
        .sort(),
    };
  });
}

/** Prova do TypeScript para um objeto do caso. `releasedAt` = quando a proteção manual foi removida. */
export function tsEvidenceFor(item: EligibilityCase, bucket: string, path: string, releasedAt: string): Evidence {
  const synced = item.scans.filter((scan) => scan.complete && scan.synced !== false && path in scan.objects);
  const lastState = synced.at(-1)?.objects[path]?.state;
  return evaluateEvidence({
    objectKey: `${bucket}/${path}`,
    scans: scanRecordsFor(item, bucket),
    manualProtection: item.manual?.protect?.includes(path) ?? false,
    protectedNow: lastState === "protected",
    manualUnprotectedAt: item.manual?.release?.includes(path) ? releasedAt : null,
  });
}

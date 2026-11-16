// Histórico de varreduras (append-only). Cada linha do history.jsonl é um destes registros:
//   { ...ScanRecord }                                   varredura (linhas antigas não têm "type")
//   { type: "scan", ...ScanRecord }                     varredura
//   { type: "invalidation", scanId, reason, at, by? }   invalida uma varredura como baseline
// Nada é apagado nem reescrito: uma invalidação só acrescenta uma linha. O classificador
// recebe o histórico já com as invalidações aplicadas (varredura invalidada = incompleta).

import type { ScanRecord } from "./classify.ts";

export type InvalidationEntry = { type: "invalidation"; scanId: string; reason: string; at: string; by?: string };

export type ParsedHistory = {
  scans: ScanRecord[];
  invalidations: InvalidationEntry[];
  /** Linhas que não puderam ser interpretadas. */
  unreadableLines: number;
};

function isScanRecord(value: Record<string, unknown>): boolean {
  return (
    typeof value.scanId === "string" &&
    typeof value.completedAt === "string" &&
    typeof value.complete === "boolean" &&
    Array.isArray(value.unreferenced)
  );
}

export function parseHistory(text: string): ParsedHistory {
  const scans: ScanRecord[] = [];
  const invalidations: InvalidationEntry[] = [];
  let unreadableLines = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(line);
    } catch {
      unreadableLines += 1;
      continue;
    }
    if (value.type === "invalidation") {
      if (typeof value.scanId === "string" && typeof value.reason === "string" && value.reason.trim() && typeof value.at === "string") {
        invalidations.push(value as unknown as InvalidationEntry);
      } else unreadableLines += 1;
      continue;
    }
    if ((value.type === undefined || value.type === "scan") && isScanRecord(value)) {
      scans.push(value as unknown as ScanRecord);
      continue;
    }
    unreadableLines += 1;
  }
  return { scans, invalidations, unreadableLines };
}

/**
 * Histórico que o classificador pode usar como evidência:
 * - varredura invalidada vira incompleta (não conta para candidatos);
 * - se alguma linha for ilegível, NADA do histórico conta (falha fechada).
 */
export function effectiveHistory(parsed: ParsedHistory): { history: ScanRecord[]; warnings: string[] } {
  if (parsed.unreadableLines > 0) {
    return { history: [], warnings: [`${parsed.unreadableLines} linha(s) ilegível(is) no histórico: nenhuma varredura anterior vale como evidência`] };
  }
  const invalid = new Map(parsed.invalidations.map((entry) => [entry.scanId, entry.reason]));
  const warnings: string[] = [];
  const history = parsed.scans.map((scan) => {
    if (!invalid.has(scan.scanId)) return scan;
    warnings.push(`varredura ${scan.scanId} invalidada como baseline: ${invalid.get(scan.scanId)}`);
    return { ...scan, complete: false };
  });
  return { history, warnings };
}

/** Monta a linha de invalidação, recusando varredura inexistente, repetida ou motivo vazio. */
export function buildInvalidation(parsed: ParsedHistory, scanId: string, reason: string, at: Date, by?: string): InvalidationEntry {
  if (!parsed.scans.some((scan) => scan.scanId === scanId)) throw new Error(`varredura ${scanId} não existe no histórico`);
  if (parsed.invalidations.some((entry) => entry.scanId === scanId)) throw new Error(`varredura ${scanId} já foi invalidada`);
  if (!reason.trim()) throw new Error("o motivo da invalidação é obrigatório");
  return { type: "invalidation", scanId, reason: reason.trim(), at: at.toISOString(), ...(by ? { by } : {}) };
}

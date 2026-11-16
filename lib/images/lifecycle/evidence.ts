// Prova de elegibilidade — mesma regra, na mesma ordem e com os mesmos motivos de
// storage_lifecycle_evidence (supabase/migrations/20261114_create_storage_image_lifecycle.sql).
// A equivalência é conferida por tests/fixtures/lifecycle-eligibility-cases.json nos dois lados.
//
// No TypeScript o resultado é PRELIMINAR: serve para o relatório local e para pedir "candidate"
// ao banco. A decisão definitiva é do banco, que recalcula a prova com a evidência gravada.

import type { ScanRecord } from "./classify.ts";

export const EVIDENCE_REASONS = {
  outside: "objeto fora do ciclo de vida",
  manual: "proteção manual ativa",
  protected: "objeto protegido",
  noScans: "nenhuma varredura registrada",
  latestInvalid: "a varredura mais recente está incompleta ou invalidada",
  tooFewScans: "menos de duas varreduras completas e válidas sem referência",
  tooShort: "intervalo entre as varreduras menor que o prazo de segurança",
  unprotectedInWindow: "proteção manual removida dentro do período de evidência",
} as const;

export type EvidenceInput = {
  objectKey: string;
  /** Todas as varreduras conhecidas, inclusive a atual; invalidadas já com complete=false. */
  scans: ScanRecord[];
  safetyPeriodDays?: number;
  /** Proteção manual ativa agora. */
  manualProtection?: boolean;
  /** Objeto protegido agora (lista de proteção). */
  protectedNow?: boolean;
  /** Momento em que uma proteção manual foi removida pela última vez. */
  manualUnprotectedAt?: string | null;
};

export type Evidence = {
  eligible: boolean;
  reason: string | null;
  latestScan?: string;
  firstScan?: string | null;
  scans?: number;
  spanDays?: number | null;
  requiredDays?: number;
  stoppedAt?: string | null;
};

const DAY_MS = 86_400_000;
const time = (iso: string) => Date.parse(iso);

/** Mais recente primeiro; empate pelo identificador (como ORDER BY completed_at DESC, scan_id DESC). */
function newestFirst(scans: ScanRecord[]) {
  return [...scans]
    .filter((scan) => Number.isFinite(time(scan.completedAt)))
    .sort((left, right) => time(right.completedAt) - time(left.completedAt) || (left.scanId < right.scanId ? 1 : left.scanId > right.scanId ? -1 : 0));
}

/** O objeto consta da varredura? Registros antigos sem `present` só sabem quem estava sem referência. */
function presentIn(scan: ScanRecord, objectKey: string) {
  return scan.present ? scan.present.includes(objectKey) : scan.unreferenced.includes(objectKey);
}

export function evaluateEvidence(input: EvidenceInput): Evidence {
  const { objectKey } = input;
  const requiredDays = input.safetyPeriodDays ?? 30;
  const ordered = newestFirst(input.scans);

  // No banco o objeto existe desde a primeira varredura sincronizada que o viu (mesmo que ela
  // seja invalidada depois); aqui, desde o primeiro registro que o lista.
  if (!input.scans.some((scan) => presentIn(scan, objectKey))) {
    return { eligible: false, reason: EVIDENCE_REASONS.outside };
  }
  if (input.manualProtection) return { eligible: false, reason: EVIDENCE_REASONS.manual };
  if (input.protectedNow) return { eligible: false, reason: EVIDENCE_REASONS.protected };

  const latest = ordered[0];
  if (!latest) return { eligible: false, reason: EVIDENCE_REASONS.noScans };
  if (!latest.complete) return { eligible: false, reason: EVIDENCE_REASONS.latestInvalid, latestScan: latest.scanId };

  let streak = 0;
  let first: ScanRecord | null = null;
  let stoppedAt: string | null = null;
  for (const scan of ordered) {
    if (!scan.complete) continue;
    if (scan.present && !scan.present.includes(objectKey)) {
      stoppedAt = `ausente da varredura ${scan.scanId}`;
      break;
    }
    if (!scan.unreferenced.includes(objectKey)) {
      stoppedAt = scan.present
        ? `referenciado ou protegido na varredura ${scan.scanId}`
        : `sem referência não comprovada na varredura ${scan.scanId} (registro antigo, sem lista de presença)`;
      break;
    }
    streak += 1;
    first = scan;
  }

  const spanMs = first ? time(latest.completedAt) - time(first.completedAt) : null;
  const verdict: Evidence = {
    eligible: false,
    reason: null,
    latestScan: latest.scanId,
    firstScan: first?.scanId ?? null,
    scans: streak,
    spanDays: spanMs === null ? null : Math.round((spanMs / DAY_MS) * 100) / 100,
    requiredDays,
    stoppedAt,
  };
  if (streak < 2) return { ...verdict, reason: EVIDENCE_REASONS.tooFewScans };
  if ((spanMs ?? 0) < requiredDays * DAY_MS) return { ...verdict, reason: EVIDENCE_REASONS.tooShort };
  if (input.manualUnprotectedAt && first && time(input.manualUnprotectedAt) > time(first.completedAt)) {
    return { ...verdict, reason: EVIDENCE_REASONS.unprotectedInWindow };
  }
  return { ...verdict, eligible: true, reason: null };
}

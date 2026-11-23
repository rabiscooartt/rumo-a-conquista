// Política versionada de varredura (Etapa 5.3). O banco (migração 20261119) só aceita como prova de
// elegibilidade varreduras ATESTADAS pela versão vigente: completas, válidas, com o SHA-256 do
// relatório registrado e com todas as fontes desta lista. Varreduras anteriores à política (como a
// de 15/11/2026, sem a fonte "convention") ficam só como histórico.
import { createHash } from "node:crypto";
import { REFERENCE_SOURCES, type SourceResult } from "./references.ts";
import type { LifecycleRpc } from "./tracked.ts";

/** Versão vigente; precisa ser igual à maior versão em storage_lifecycle_scan_policies. */
export const SCAN_POLICY_VERSION = 2;
/** Fontes exigidas pela versão 2 (iguais às da migração 20261119 — conferido em teste). */
export const SCAN_POLICY_SOURCES: readonly string[] = REFERENCE_SOURCES;

export type ReportSourceStatus = { source: string; status: string; error?: string | null; unparsed?: number };

/** Fontes completas do relatório; erro se faltar alguma exigida ou se houver qualquer fonte incompleta. */
export function attestableSources(sourceStatus: ReportSourceStatus[]): string[] {
  const incomplete = sourceStatus.filter((s) => s.status !== "complete" || s.error || (s.unparsed ?? 0) > 0).map((s) => s.source);
  if (incomplete.length > 0) throw new Error(`relatório com fonte(s) incompleta(s): ${incomplete.join(", ")}`);
  const present = new Set(sourceStatus.map((s) => s.source));
  const missing = SCAN_POLICY_SOURCES.filter((s) => !present.has(s));
  if (missing.length > 0) throw new Error(`relatório sem a(s) fonte(s) exigida(s) pela política v${SCAN_POLICY_VERSION}: ${missing.join(", ")}`);
  return [...present].sort();
}

/** Uma entrada do manifesto: fonte completa, quantas referências e o resumo SHA-256 delas. */
export type ManifestEntry = { source: string; status: "complete"; references: number; digest: string };

/**
 * Manifesto das fontes coletadas: uma entrada por fonte, ordenada pelo nome. O resumo é o SHA-256
 * das linhas "objectKey<TAB>location" ordenadas (sem o valor bruto). Recusa fonte incompleta, ausente
 * ou repetida. O relatório inclui o manifesto, então o SHA-256 do relatório também o cobre.
 */
export function buildSourceManifest(sources: readonly SourceResult[]): ManifestEntry[] {
  attestableSources(sources.map((s) => ({ source: s.source, status: s.status, error: s.error ?? null, unparsed: s.unparsed?.length ?? 0 })));
  const names = sources.map((s) => s.source);
  if (new Set(names).size !== names.length) throw new Error("fonte repetida na coleta");
  return [...sources]
    .sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0))
    .map((s) => {
      const lines = s.references.map((r) => `${r.objectKey}\t${r.location}`).sort();
      const digest = createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
      return { source: s.source, status: "complete" as const, references: s.references.length, digest };
    });
}

/**
 * Atesta a varredura no banco (depois de registrada, dentro da execução oficial aberta antes da
 * coleta). O banco revalida tudo: execução, versão, manifesto, relatório, completude e validade.
 */
export async function attestScan(input: {
  rpc: LifecycleRpc; scanId: string; reportSha256: string; manifest: ManifestEntry[]; actor: string;
}) {
  const present = new Set(input.manifest.map((m) => m.source));
  const missing = SCAN_POLICY_SOURCES.filter((s) => !present.has(s));
  if (missing.length > 0 || input.manifest.some((m) => m.status !== "complete")) {
    throw new Error(`manifesto sem a(s) fonte(s) completa(s) exigida(s) pela política v${SCAN_POLICY_VERSION}: ${missing.join(", ")}`);
  }
  return input.rpc("storage_lifecycle_attest_scan", {
    p_scan_id: input.scanId, p_policy_version: SCAN_POLICY_VERSION, p_manifest: input.manifest,
    p_report_sha256: input.reportSha256, p_actor: input.actor,
  });
}

/** Prova do banco só vale se calculada pela política vigente (sem o campo: migração ausente → recusa). */
export function evidenceMeetsPolicy(evidence: { eligible?: unknown; policy_version?: unknown } | null | undefined) {
  return evidence?.eligible === true && evidence.policy_version === SCAN_POLICY_VERSION;
}

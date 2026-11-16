// Núcleo puro de classificação do ciclo de vida das imagens do Storage.
// Recebe o inventário, as referências já normalizadas e o histórico de varreduras, e devolve
// o estado de cada objeto. Não lê nem escreve nada: só decide.
//
// Estados, em ordem de precedência:
//   protected  → proteção manual (banco) ou lista de proteção (nunca sai daqui sem ação humana)
//   active     → versão ativa de banner/avatar (ponteiro válido ou regra do mais recente)
//   referenced → citado por alguma fonte (banco, JSON de jogos, rascunho, mapa local)
//   unverified → evidência incompleta (fonte com falha, inventário parcial): falha fechada
//   duplicate  → sem referência, mas com conteúdo idêntico a outro objeto (decisão manual)
//   candidate  → PRELIMINAR: a prova local (evidence.ts, mesma regra do banco) foi cumprida
//   superseded → sem referência, existe versão mais nova da mesma imagem; aguardando o prazo
//   observing  → sem referência pela primeira vez (ou há pouco tempo); aguardando o prazo
//
// "candidate" não autoriza nada: é o pedido do classificador local. O banco recalcula a prova com
// a evidência gravada (storage_lifecycle_evidence) e corrige o objeto se ela não fechar.

import { pickLatestStoredImage, stripImageVersion } from "../naming.ts";
import { AVATAR_IMAGE_TARGET, bannerImageTarget, type FixedImageTarget } from "../storedImages.ts";
import { REFERENCE_SOURCES, type ImageReference, type SourceResult } from "./references.ts";
import { evaluateEvidence, type Evidence } from "./evidence.ts";

export type StorageObjectInfo = {
  bucket: string;
  path: string;
  size?: number | null;
  /** SHA-256 do conteúdo, quando conhecido (necessário para identificar duplicatas). */
  sha256?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type InventorySnapshot = {
  /** "complete" só quando todas as pastas foram listadas sem erro. */
  status: "complete" | "partial" | "failed";
  objects: StorageObjectInfo[];
  /** Prefixos ("<bucket>/<pasta>") que não puderam ser listados. */
  failedPrefixes?: string[];
  error?: string;
};

export type ObjectState =
  | "protected"
  | "active"
  | "referenced"
  | "unverified"
  | "duplicate"
  | "candidate"
  | "superseded"
  | "observing";

/** Resultado de uma varredura anterior, como será guardado pela etapa de registro. */
export type ScanRecord = {
  scanId: string;
  completedAt: string;
  /** Só varreduras completas contam como evidência. */
  complete: boolean;
  /** Objetos sem nenhuma referência nesta varredura (sem proteção, sem uso, sem ponteiro). */
  unreferenced: string[];
  /** Todos os objetos inventariados nesta varredura (distingue "ausente" de "referenciado"). */
  present?: string[];
};

export type ClassifyOptions = {
  now: Date;
  /** Prazo mínimo entre a primeira e a última varredura sem referência (padrão: 30 dias). */
  safetyPeriodDays?: number;
  history?: ScanRecord[];
  scanId?: string;
  /** Proteções manuais ativas no banco: objectKey → motivo. Prevalecem sobre tudo. */
  manualProtections?: Record<string, string>;
  /** Última remoção de proteção manual por objeto (ISO). Dentro da janela, impede a prova. */
  manualUnprotectedAt?: Record<string, string>;
};

export type ObjectClassification = {
  objectKey: string;
  state: ObjectState;
  reasons: string[];
  references: ImageReference[];
  sha256?: string | null;
  /** Outros objetos com o mesmo conteúdo. */
  duplicateOf?: string[];
  /** Varredura completa mais antiga, numa sequência ininterrupta, em que o objeto já estava sem referência. */
  unreferencedSince?: string;
  /** Prova local (preliminar) para objetos sem referência. */
  evidence?: Evidence;
};

export type ClassificationReport = {
  /** Classificação preliminar: a elegibilidade definitiva é decidida pelo banco. */
  preliminary: true;
  evidenceComplete: boolean;
  blockers: string[];
  objects: ObjectClassification[];
  /** Referências a objetos que não estão no inventário (informativo; nunca apaga nada). */
  danglingReferences: ImageReference[];
  duplicateGroups: string[][];
  /** Registro desta varredura, para o histórico (só vale como evidência se `complete`). */
  scanRecord: ScanRecord;
};


export const objectKeyOf = (object: StorageObjectInfo) => `${object.bucket}/${object.path}`;

function lastModified(object: StorageObjectInfo) {
  const values = [object.createdAt, object.updatedAt].map((value) => Date.parse(value ?? "")).filter(Number.isFinite);
  return values.length > 0 ? Math.max(...values) : 0;
}

/** Banner ou avatar ao qual o objeto pertence, se for uma imagem de endereço fixo. */
export function fixedTargetFor(object: StorageObjectInfo): FixedImageTarget | null {
  const parts = object.path.split("/");
  if (object.bucket === "site-banners" && parts.length === 3 && parts[0] === "banners") return bannerImageTarget(parts[1]);
  if (object.bucket === AVATAR_IMAGE_TARGET.bucket && parts.length === 2 && parts[0] === AVATAR_IMAGE_TARGET.folder) {
    return AVATAR_IMAGE_TARGET;
  }
  return null;
}

function isFixedImageFile(object: StorageObjectInfo, target: FixedImageTarget) {
  const name = object.path.split("/").pop() ?? "";
  return stripImageVersion(name) === target.baseName;
}

/** Mesma imagem em versões diferentes: pasta + nome sem hash e sem extensão. */
function lineageOf(object: StorageObjectInfo) {
  const parts = object.path.split("/");
  const name = stripImageVersion(parts.pop() ?? "").replace(/\.[a-z0-9]{2,5}$/i, "");
  return `${object.bucket}/${parts.join("/")}/${name}`;
}

/** Versões ativas de banners e avatar: ponteiro (se o arquivo existir) ou o mais recente da pasta. */
function activeFixedImages(objects: StorageObjectInfo[], pointerRefs: ImageReference[]) {
  const groups = new Map<string, { target: FixedImageTarget; files: StorageObjectInfo[] }>();
  for (const object of objects) {
    const target = fixedTargetFor(object);
    if (!target || !isFixedImageFile(object, target)) continue;
    const id = `${target.bucket}/${target.folder}`;
    const group = groups.get(id) ?? { target, files: [] };
    group.files.push(object);
    groups.set(id, group);
  }

  const active = new Map<string, string>();
  for (const { target, files } of groups.values()) {
    const keys = new Set(files.map(objectKeyOf));
    const pointed = pointerRefs.find((ref) => ref.objectKey.startsWith(`${target.bucket}/${target.folder}/`) && keys.has(ref.objectKey));
    if (pointed) {
      active.set(pointed.objectKey, "versão ativa pelo ponteiro");
      continue;
    }
    const latest = pickLatestStoredImage(
      files.map((file) => ({ name: file.path.split("/").pop() ?? "", created_at: file.createdAt, updated_at: file.updatedAt, file })),
      target.baseName
    );
    if (latest) active.set(objectKeyOf(latest.file), "versão ativa pela regra do mais recente (sem ponteiro válido)");
  }
  return active;
}

/**
 * Desde quando o objeto está sem referência, contando só varreduras completas e consecutivas
 * (da mais recente para trás). Uma varredura completa em que ele tinha referência, ou em que
 * não existia, interrompe a sequência.
 */
function unreferencedSince(objectKey: string, history: ScanRecord[]) {
  const complete = history
    .filter((scan) => scan.complete && Number.isFinite(Date.parse(scan.completedAt)))
    .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt));
  let since: string | undefined;
  for (const scan of complete) {
    if (!scan.unreferenced.includes(objectKey)) break;
    since = scan.completedAt;
  }
  return since;
}

export function classifyImages(
  inventory: InventorySnapshot,
  sources: SourceResult[],
  options: ClassifyOptions
): ClassificationReport {
  const currentScanId = options.scanId ?? `scan-${options.now.toISOString()}`;

  // 1. Evidência completa? Qualquer falha bloqueia candidatos (falha fechada).
  const blockers: string[] = [];
  if (inventory.status !== "complete") blockers.push(`inventário ${inventory.status}${inventory.error ? `: ${inventory.error}` : ""}`);
  for (const prefix of inventory.failedPrefixes ?? []) blockers.push(`pasta não listada: ${prefix}`);
  for (const name of REFERENCE_SOURCES) {
    const results = sources.filter((source) => source.source === name);
    if (results.length === 0) blockers.push(`fonte ausente: ${name}`);
    for (const result of results) {
      if (result.status !== "complete") {
        const detail = result.error ?? (result.unparsed?.length ? `${result.unparsed.length} valor(es) não interpretado(s)` : "");
        blockers.push(`fonte ${name} ${result.status}${detail ? `: ${detail}` : ""}`);
      }
    }
  }
  const evidenceComplete = blockers.length === 0;

  // 2. Referências por objeto.
  const allRefs = sources.flatMap((source) => source.references);
  const refsByKey = new Map<string, ImageReference[]>();
  for (const ref of allRefs) refsByKey.set(ref.objectKey, [...(refsByKey.get(ref.objectKey) ?? []), ref]);

  const objects = inventory.objects;
  const inventoryKeys = new Set(objects.map(objectKeyOf));
  const active = activeFixedImages(objects, allRefs.filter((ref) => ref.source === "pointers"));

  // 3. Conteúdo idêntico (só quando o hash é conhecido).
  const byHash = new Map<string, string[]>();
  for (const object of objects) {
    if (!object.sha256) continue;
    byHash.set(object.sha256, [...(byHash.get(object.sha256) ?? []), objectKeyOf(object)]);
  }
  const duplicateGroups = [...byHash.values()].filter((group) => group.length > 1).map((group) => [...group].sort());

  // 4. Linhagens: existe versão mais nova da mesma imagem?
  const newestByLineage = new Map<string, number>();
  for (const object of objects) {
    const lineage = lineageOf(object);
    newestByLineage.set(lineage, Math.max(newestByLineage.get(lineage) ?? 0, lastModified(object)));
  }

  const failedPrefixes = inventory.failedPrefixes ?? [];
  const classified: ObjectClassification[] = [];
  const unreferenced: string[] = [];

  for (const object of objects) {
    const objectKey = objectKeyOf(object);
    const references = refsByKey.get(objectKey) ?? [];
    const protection = references.filter((ref) => ref.source === "protection");
    const usage = references.filter((ref) => ref.source !== "protection");
    const base = { objectKey, references, sha256: object.sha256 ?? null };

    const manualReason = options.manualProtections?.[objectKey];
    if (manualReason !== undefined) {
      classified.push({ ...base, state: "protected", reasons: [`proteção manual: ${manualReason}`] });
      continue;
    }
    if (protection.length > 0) {
      classified.push({ ...base, state: "protected", reasons: protection.map((ref) => ref.location) });
      continue;
    }
    if (active.has(objectKey)) {
      classified.push({ ...base, state: "active", reasons: [active.get(objectKey)!] });
      continue;
    }
    if (usage.length > 0) {
      classified.push({ ...base, state: "referenced", reasons: usage.map((ref) => `${ref.source}: ${ref.location}`) });
      continue;
    }

    const affectedByFailure = failedPrefixes.some((prefix) => objectKey.startsWith(prefix.replace(/\/?$/, "/")));
    if (!evidenceComplete || affectedByFailure) {
      classified.push({ ...base, state: "unverified", reasons: ["evidência incompleta: não pode virar candidato", ...blockers] });
      continue;
    }

    unreferenced.push(objectKey);
    const twins = object.sha256 ? (byHash.get(object.sha256) ?? []).filter((key) => key !== objectKey) : [];
    if (twins.length > 0) {
      classified.push({
        ...base,
        state: "duplicate",
        duplicateOf: twins,
        reasons: ["sem referência, mas com conteúdo idêntico a outro objeto: decisão manual, nunca automática"],
      });
      continue;
    }

    const since = unreferencedSince(objectKey, options.history ?? []);
    const newerExists = (newestByLineage.get(lineageOf(object)) ?? 0) > lastModified(object);
    // A varredura atual entra na prova como a mais recente (completa, objeto presente e sem referência).
    const evidence = evaluateEvidence({
      objectKey,
      scans: [...(options.history ?? []), { scanId: currentScanId, completedAt: options.now.toISOString(), complete: true, unreferenced: [objectKey], present: [objectKey] }],
      safetyPeriodDays: options.safetyPeriodDays,
      manualUnprotectedAt: options.manualUnprotectedAt?.[objectKey] ?? null,
    });
    if (evidence.eligible) {
      classified.push({
        ...base,
        state: "candidate",
        unreferencedSince: since,
        evidence,
        reasons: [
          `preliminar: sem referência em ${evidence.scans} varreduras completas e válidas, ${evidence.spanDays} dias desde ${evidence.firstScan} (prazo de ${evidence.requiredDays} dias); confirmação pelo banco`,
          ...(newerExists ? ["existe versão mais nova da mesma imagem"] : []),
        ],
      });
      continue;
    }
    classified.push({
      ...base,
      state: newerExists ? "superseded" : "observing",
      unreferencedSince: since,
      evidence,
      reasons: [
        `sem prova: ${evidence.reason}${evidence.stoppedAt ? ` (${evidence.stoppedAt})` : ""}`,
        ...(newerExists ? ["existe versão mais nova da mesma imagem"] : []),
      ],
    });
  }

  return {
    preliminary: true,
    evidenceComplete,
    blockers,
    objects: classified,
    danglingReferences: allRefs.filter((ref) => !inventoryKeys.has(ref.objectKey)),
    duplicateGroups,
    scanRecord: {
      scanId: currentScanId,
      completedAt: options.now.toISOString(),
      complete: evidenceComplete,
      unreferenced: evidenceComplete ? unreferenced.sort() : [],
      present: evidenceComplete ? [...inventoryKeys].sort() : [],
    },
  };
}

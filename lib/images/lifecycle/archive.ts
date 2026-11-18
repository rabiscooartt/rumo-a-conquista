// Arquivamento e restauração de imagens (Etapa 4.4) sobre as funções da migração principal
// (storage_lifecycle_begin_operation / storage_lifecycle_finish_operation).
//
//   archiveObject        none → archiving → archived: baixa o original, confere o SHA-256 com o
//                        registrado, grava a CÓPIA no bucket de arquivo (sem sobrescrever, SHA-256 nos
//                        metadados), confere a cópia e só então confirma. O original continua no lugar.
//   cancelArchive        archived → none: confere que o original continua íntegro e desfaz o estado.
//   deleteArchivedOriginal archived → deleting → deleted: confere a cópia arquivada, remove SÓ o
//                        original e confere a remoção. Exige allowDelete (operação irreversível no Storage).
//   restoreObject        deleted → restoring → none: baixa a cópia, confere o SHA-256 arquivado, devolve
//                        o arquivo ao caminho original (sem sobrescrever) e confere. O objeto volta como
//                        "unverified" até a próxima varredura.
//
// Cada passo é um checkpoint: a operação fica pendente no banco entre a intenção e o resultado, e
// repetir a mesma chamada retoma do ponto em que parou (mesma chave; o Storage é conferido antes de
// regravar). A guarda do banco decide a elegibilidade (duas varreduras válidas, 30 dias, sem
// referência nem proteção): este módulo nunca a contorna.
//
// Etapa 5.2: tamanho e MIME do original conferidos com o registro antes da cópia; cópia e arquivo
// restaurado conferidos por SHA-256, tamanho e MIME; destino ocupado por OUTRO conteúdo nunca é
// sobrescrito (arquivo: fica pendente para revisão; restauração: falha "destination_conflict", com o
// arquivo de quem ocupa intacto); cada passo é registrado em onStep (log detalhado do executor).
import { createHash } from "node:crypto";
import type { LifecycleRpc } from "./tracked.ts";
import { evidenceMeetsPolicy, SCAN_POLICY_VERSION } from "./scanPolicy.ts";

export const ARCHIVE_BUCKET = "image-archive";

export type ArchiveStorage = {
  /** null quando o objeto não existe. */
  download(bucket: string, path: string): Promise<Uint8Array | null>;
  /** "exists" quando o caminho já estava ocupado (nada foi sobrescrito). */
  upload(bucket: string, path: string, bytes: Uint8Array, options: { contentType: string; cacheControl: string; metadata: Record<string, string> }): Promise<"created" | "exists">;
  info(bucket: string, path: string): Promise<{ size: number | null; contentType: string | null; metadata: Record<string, unknown> | null } | null>;
  remove(bucket: string, path: string): Promise<void>;
};
export type LifecycleRow = {
  state: string; archive_state: string; sha256: string | null; size_bytes: number | null; mimetype: string | null;
  archive_bucket: string | null; archive_path: string | null; archive_sha256: string | null; restore_metadata: Record<string, unknown> | null;
  manual_protection: boolean;
};
export type ArchiveStep = { operation: string; bucket: string; path: string; step: string; operationId?: string | null; detail?: Record<string, unknown> };
export type ArchiveDeps = {
  rpc: LifecycleRpc;
  storage: ArchiveStorage;
  readObject(bucket: string, path: string): Promise<LifecycleRow | null>;
  /** Log detalhado: cada passo (checkpoint) do executor. */
  onStep?: (step: ArchiveStep) => void;
};

/**
 * Prova de elegibilidade só vale se o BANCO a calculou pela política de varredura vigente
 * (migração 20261119: só varreduras atestadas, completas, íntegras e com todas as fontes, inclusive
 * "convention"). Sem a política no banco, a prova não traz policy_version e é recusada aqui também.
 * A varredura de 15/11/2026 é anterior à política e nunca é atestada. Ver
 * docs/ciclo-de-vida-imagens-varreduras.md.
 */
async function assertEvidencePolicy(deps: ArchiveDeps, bucket: string, path: string, operation: string) {
  const evidence = await deps.rpc("storage_lifecycle_evidence", { p_bucket: bucket, p_object_path: path });
  // Não elegível: a guarda do banco recusa com o motivo dela. Elegível só vale pela política vigente.
  if (evidence.eligible === true && !evidenceMeetsPolicy(evidence)) {
    throw new ArchiveError(
      `${operation} de ${bucket}/${path} recusado: a prova não foi calculada pela política de varredura v${SCAN_POLICY_VERSION} ` +
        `(policy_version ${String(evidence.policy_version ?? "ausente")}). Nada foi feito.`,
      null, false
    );
  }
}
const note = (deps: ArchiveDeps, step: ArchiveStep) => {
  try { deps.onStep?.(step); } catch { /* o log nunca interrompe a operação */ }
};
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class ArchiveError extends Error {
  readonly operationId: string | null;
  readonly pending: boolean;
  constructor(message: string, operationId: string | null, pending: boolean) {
    super(message);
    this.operationId = operationId;
    this.pending = pending;
  }
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const objectHash = (bucket: string, path: string) => createHash("sha256").update(`${bucket}/${path}`).digest("hex");
export const archiveKey = (operation: string, bucket: string, path: string, attempt: number) => `${operation}:${objectHash(bucket, path)}:${attempt}`;

type Begin = { status: "started" | "pending" | "finished"; operationId: string; result?: string };

export const MAX_ATTEMPTS = 5;

/**
 * Começa (ou retoma) a operação. Tentativas já encerradas usam a chave seguinte.
 * `provenDone`: chamada SÓ quando a guarda do banco recusa (23514) — corrida em que outro processo
 * concluiu a mesma operação entre a leitura do estado e este início. Devolve true apenas se o estado
 * persistido E o Storage comprovarem a conclusão; aí o resultado é idempotente ("finished").
 * Sem essa prova, o erro original da guarda é mantido.
 */
async function beginOrResume(
  deps: ArchiveDeps, operation: string, bucket: string, path: string, actor: string, reason: string,
  details: Record<string, unknown>, provenDone?: () => Promise<boolean>
): Promise<Begin> {
  let succeeded = 0;
  let failed = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let r: Record<string, unknown>;
    try {
      r = await deps.rpc("storage_lifecycle_begin_operation", {
        p_idempotency_key: archiveKey(operation, bucket, path, attempt), p_operation: operation, p_bucket: bucket, p_object_path: path,
        p_actor: actor, p_reason: reason, p_details: details,
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23514" && provenDone && (await provenDone().catch(() => false))) {
        return { status: "finished", operationId: "", result: "succeeded_concurrently" };
      }
      throw error;
    }
    // Tentativa já encerrada (falha OU sucesso antigo, ex.: arquivar de novo depois de cancelar):
    // quem chama já conferiu o estado atual antes, então é uma operação nova na chave seguinte.
    if (r.status === "finished") {
      if (r.result === "succeeded") succeeded += 1;
      else failed += 1;
      continue;
    }
    return { status: r.status as Begin["status"], operationId: String(r.operation_id), result: r.result as string | undefined };
  }
  throw new ArchiveError(
    `${operation} de ${bucket}/${path}: limite de ${MAX_ATTEMPTS} tentativas por tipo de operação atingido ` +
      `(${succeeded} concluída(s) com sucesso, ${failed} encerrada(s) com falha); nada foi alterado. Revise a auditoria antes de repetir.`,
    null, false
  );
}

const finish = (deps: ArchiveDeps, operationId: string, result: "succeeded" | "failed", actor: string, details: Record<string, unknown>) =>
  deps.rpc("storage_lifecycle_finish_operation", { p_operation_id: operationId, p_result: result, p_actor: actor, p_details: details });

/** Confirmação final: se a resposta do banco se perde, a operação continua pendente (checkpoint) — nunca "concluída". */
async function confirm(deps: ArchiveDeps, operationId: string, actor: string, details: Record<string, unknown>, what: string) {
  try {
    await finish(deps, operationId, "succeeded", actor, details);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code && !["08006", "08000", "08003", "57P01"].includes(code) && !/fetch|socket|network|conex/i.test(message(error))) throw error;
    throw new ArchiveError(`${what}: o Storage está conferido, mas a confirmação no banco não foi registrada (${message(error)}); a operação continua pendente. Repita para concluir.`, operationId, true);
  }
}

export async function archiveObject(input: { deps: ArchiveDeps; bucket: string; path: string; actor: string; reason: string; archiveBucket?: string }) {
  const { deps, bucket, path, actor } = input;
  const archiveBucket = input.archiveBucket ?? ARCHIVE_BUCKET;
  const archivePath = `${bucket}/${path}`;
  const row = await deps.readObject(bucket, path);
  if (!row) throw new ArchiveError(`${bucket}/${path} não está no ciclo de vida.`, null, false);
  if (row.archive_state === "archived") return { status: "already_archived" as const, archiveBucket: row.archive_bucket, archivePath: row.archive_path };
  if (row.archive_state === "none") await assertEvidencePolicy(deps, bucket, path, "Arquivamento");

  // Intenção (a guarda do banco recusa objeto não elegível ANTES de qualquer cópia).
  const begin = await beginOrResume(deps, "archive_copy", bucket, path, actor, input.reason, { archive_bucket: archiveBucket, archive_path: archivePath },
    // Prova de arquivamento concluído por outro processo: estado archived E cópia com o SHA-256 registrado.
    async () => {
      const now = await deps.readObject(bucket, path);
      if (now?.archive_state !== "archived" || !now.archive_bucket || !now.archive_path || !now.archive_sha256) return false;
      const copy = await deps.storage.download(now.archive_bucket, now.archive_path);
      return Boolean(copy) && sha256(copy!) === now.archive_sha256;
    });
  if (begin.status === "finished") return { status: "already_archived" as const, archiveBucket, archivePath, operationId: begin.operationId };

  const step = (name: string, detail?: Record<string, unknown>) =>
    note(deps, { operation: "archive_copy", bucket, path, step: name, operationId: begin.operationId, detail });
  step(begin.status === "pending" ? "retomada" : "intencao", { archive_bucket: archiveBucket, archive_path: archivePath });

  // 1. Original: precisa existir e conferir com o registro (SHA-256, tamanho e MIME).
  const originalInfo = await deps.storage.info(bucket, path);
  const original = originalInfo ? await deps.storage.download(bucket, path) : null;
  if (!originalInfo || !original) {
    await finish(deps, begin.operationId, "failed", actor, { reason: "original ausente no Storage" });
    step("falha", { reason: "original ausente" });
    throw new ArchiveError(`O original ${bucket}/${path} não existe; arquivamento registrado como falho.`, begin.operationId, false);
  }
  const originalSha = sha256(original);
  const mismatch = row.sha256 && row.sha256 !== originalSha ? "SHA-256"
    : row.size_bytes !== null && Number(row.size_bytes) !== original.byteLength ? "tamanho"
    : originalInfo.size !== null && Number(originalInfo.size) !== original.byteLength ? "tamanho informado pelo Storage"
    : row.mimetype && originalInfo.contentType && row.mimetype !== originalInfo.contentType ? "MIME" : null;
  if (mismatch) {
    await finish(deps, begin.operationId, "failed", actor, {
      reason: `original diverge do registro (${mismatch})`, original_sha256: originalSha,
      original_size: original.byteLength, original_content_type: originalInfo.contentType,
    });
    step("falha", { reason: `original diverge (${mismatch})` });
    throw new ArchiveError(`O original ${bucket}/${path} não confere com o registro (${mismatch}); nada foi arquivado.`, begin.operationId, false);
  }
  step("original_conferido", { sha256: originalSha, size: original.byteLength, content_type: originalInfo.contentType });

  // 2. Cópia no arquivo (sem sobrescrever). Caminho ocupado: só aceita se for a MESMA cópia (retomada).
  const contentType = row.mimetype ?? originalInfo.contentType ?? "application/octet-stream";
  let uploaded: "created" | "exists";
  try {
    uploaded = await deps.storage.upload(archiveBucket, archivePath, original, {
      contentType, cacheControl: "3600", metadata: { sha256: originalSha, source: `${bucket}/${path}` },
    });
  } catch (error) {
    // Falha no meio da cópia ou resposta perdida: a intenção continua aberta no banco (checkpoint).
    step("copia_interrompida", { error: message(error) });
    throw new ArchiveError(`A cópia de ${bucket}/${path} foi interrompida (${message(error)}); a operação continua pendente. Repita para retomar.`, begin.operationId, true);
  }
  const copy = await deps.storage.info(archiveBucket, archivePath);
  if (!copy || copy.metadata?.sha256 !== originalSha || Number(copy.size) !== original.byteLength || (copy.contentType !== null && copy.contentType !== contentType)) {
    step("copia_divergente", { uploaded, copy_sha256: copy?.metadata?.sha256 ?? null, copy_size: copy?.size ?? null, copy_content_type: copy?.contentType ?? null });
    throw new ArchiveError(uploaded === "exists"
      ? `O destino ${archiveBucket}/${archivePath} já está ocupado por outro conteúdo; nada foi sobrescrito e a operação continua pendente para revisão.`
      : `A cópia em ${archiveBucket}/${archivePath} não confere (SHA-256, tamanho ou MIME); a operação continua pendente para revisão.`, begin.operationId, true);
  }
  // O SHA-256 dos metadados é o que NÓS enviamos: a prova de integridade é o conteúdo relido.
  const copyBytes = await deps.storage.download(archiveBucket, archivePath);
  if (!copyBytes || sha256(copyBytes) !== originalSha) {
    step("copia_divergente", { uploaded, reason: "conteúdo relido não confere com o SHA-256 do original" });
    throw new ArchiveError(`O conteúdo da cópia em ${archiveBucket}/${archivePath} não confere com o original (SHA-256 relido); nada foi confirmado e a operação continua pendente para revisão.`, begin.operationId, true);
  }
  step(uploaded === "exists" ? "copia_existente_conferida" : "copia_conferida", { sha256: originalSha, size: original.byteLength, content_type: contentType, content_verified: true });

  // 3. Checkpoint final: confirmação com origem, destino, hash e dados para restaurar.
  await confirm(deps, begin.operationId, actor, {
    archive_bucket: archiveBucket, archive_path: archivePath, archive_sha256: originalSha,
    restore: { content_type: contentType, cache_control: "31536000", size: original.byteLength, source_bucket: bucket, source_path: path },
  }, `Arquivamento de ${bucket}/${path}`);
  step("concluida", { archive_sha256: originalSha });
  return { status: "archived" as const, archiveBucket, archivePath, sha256: originalSha, operationId: begin.operationId };
}

export async function cancelArchive(input: { deps: ArchiveDeps; bucket: string; path: string; actor: string; reason: string }) {
  const { deps, bucket, path, actor } = input;
  const row = await deps.readObject(bucket, path);
  if (!row || row.archive_state !== "archived") throw new ArchiveError(`${bucket}/${path} não está arquivado.`, null, false);
  const begin = await beginOrResume(deps, "archive_cancel", bucket, path, actor, input.reason, {},
    // Prova de cancelamento concluído por outro processo: estado none E original íntegro.
    async () => {
      const now = await deps.readObject(bucket, path);
      if (now?.archive_state !== "none") return false;
      const original = await deps.storage.download(bucket, path);
      return Boolean(original) && sha256(original!) === row.archive_sha256;
    });
  if (begin.status === "finished") return { status: "cancelled" as const, operationId: begin.operationId };
  const original = await deps.storage.download(bucket, path);
  if (!original || sha256(original) !== row.archive_sha256) {
    await finish(deps, begin.operationId, "failed", actor, { reason: "original ausente ou diferente da cópia arquivada" });
    throw new ArchiveError(`O original ${bucket}/${path} não confere; o arquivamento continua.`, begin.operationId, false);
  }
  await finish(deps, begin.operationId, "succeeded", actor, { original_sha256: row.archive_sha256 });
  return { status: "cancelled" as const, operationId: begin.operationId };
}

export async function deleteArchivedOriginal(input: { deps: ArchiveDeps; bucket: string; path: string; actor: string; reason: string; allowDelete: boolean }) {
  const { deps, bucket, path, actor } = input;
  if (input.allowDelete !== true) throw new ArchiveError("Remoção do original exige autorização explícita (allowDelete).", null, false);
  const row = await deps.readObject(bucket, path);
  if (!row) throw new ArchiveError(`${bucket}/${path} não está no ciclo de vida.`, null, false);
  if (row.archive_state === "deleted") return { status: "already_deleted" as const };
  if (!row.archive_bucket || !row.archive_path || !row.archive_sha256) throw new ArchiveError(`${bucket}/${path} não tem cópia arquivada registrada.`, null, false);
  if (row.archive_state === "archived") await assertEvidencePolicy(deps, bucket, path, "Remoção do original");

  // A cópia precisa estar íntegra ANTES de qualquer remoção.
  // Conteúdo relido (não só os metadados) precisa bater com o SHA-256 arquivado.
  const copy = await deps.storage.info(row.archive_bucket, row.archive_path);
  const copyBytes = copy ? await deps.storage.download(row.archive_bucket, row.archive_path) : null;
  if (!copy || copy.metadata?.sha256 !== row.archive_sha256 || !copyBytes || sha256(copyBytes) !== row.archive_sha256) {
    throw new ArchiveError(`A cópia arquivada de ${bucket}/${path} não confere; nada foi removido.`, null, false);
  }
  const begin = await beginOrResume(deps, "delete_object", bucket, path, actor, input.reason, { archive_bucket: row.archive_bucket, archive_path: row.archive_path },
    // Prova de remoção concluída por outro processo: estado deleted E original ausente no Storage.
    async () => (await deps.readObject(bucket, path))?.archive_state === "deleted" && (await deps.storage.info(bucket, path)) === null);
  if (begin.status === "finished") return { status: "already_deleted" as const, operationId: begin.operationId };

  let removeError: unknown = null;
  try {
    await deps.storage.remove(bucket, path);
  } catch (error) {
    removeError = error;
  }
  const still = await deps.storage.info(bucket, path);
  if (still === null) {
    await finish(deps, begin.operationId, "succeeded", actor, { removed: true, archive_sha256: row.archive_sha256 });
    return { status: "deleted" as const, operationId: begin.operationId };
  }
  await finish(deps, begin.operationId, "failed", actor, { reason: `original continua no Storage${removeError ? `: ${String(removeError)}` : ""}` });
  throw new ArchiveError(`O original ${bucket}/${path} não foi removido; continua arquivado.`, begin.operationId, false);
}

export async function restoreObject(input: { deps: ArchiveDeps; bucket: string; path: string; actor: string; reason: string }) {
  const { deps, bucket, path, actor } = input;
  const row = await deps.readObject(bucket, path);
  if (!row) throw new ArchiveError(`${bucket}/${path} não está no ciclo de vida.`, null, false);
  if (row.archive_state === "none") return { status: "already_restored" as const };
  if (row.archive_state === "archived") throw new ArchiveError(`${bucket}/${path} ainda tem o original; use cancelArchive.`, null, false);
  if (!row.archive_bucket || !row.archive_path || !row.archive_sha256) throw new ArchiveError(`${bucket}/${path} não tem cópia arquivada registrada.`, null, false);

  const begin = await beginOrResume(deps, "restore_object", bucket, path, actor, input.reason, { archive_bucket: row.archive_bucket, archive_path: row.archive_path },
    // Prova de restauração concluída por outro processo: estado none E arquivo de volta com o SHA-256 arquivado.
    async () => {
      const now = await deps.readObject(bucket, path);
      if (now?.archive_state !== "none") return false;
      const back = await deps.storage.download(bucket, path);
      return Boolean(back) && sha256(back!) === row.archive_sha256;
    });
  if (begin.status === "finished") return { status: "already_restored" as const, operationId: begin.operationId };

  const archiveSha = row.archive_sha256;
  const step = (name: string, detail?: Record<string, unknown>) =>
    note(deps, { operation: "restore_object", bucket, path, step: name, operationId: begin.operationId, detail });
  step(begin.status === "pending" ? "retomada" : "intencao", { archive_bucket: row.archive_bucket, archive_path: row.archive_path });

  const restore = (row.restore_metadata ?? {}) as { content_type?: string; cache_control?: string; size?: number };
  const contentType = restore.content_type ?? row.mimetype ?? "application/octet-stream";
  const copy = await deps.storage.download(row.archive_bucket, row.archive_path);
  if (!copy || sha256(copy) !== archiveSha || (restore.size !== undefined && Number(restore.size) !== copy.byteLength)) {
    step("copia_divergente", { present: Boolean(copy) });
    throw new ArchiveError(`A cópia arquivada de ${bucket}/${path} está ausente ou não confere; a restauração continua pendente para revisão.`, begin.operationId, true);
  }
  step("copia_conferida", { sha256: archiveSha, size: copy.byteLength });

  // Destino: livre → grava; com o MESMO arquivo (retomada) → segue; com OUTRO → conflito, nada é tocado.
  type Info = Awaited<ReturnType<ArchiveStorage["info"]>>;
  const isSame = (info: Info) => info !== null && info.metadata?.sha256 === archiveSha && Number(info.size) === copy.byteLength;
  const occupant = await deps.storage.info(bucket, path);
  if (occupant && !isSame(occupant)) {
    await finish(deps, begin.operationId, "failed", actor, {
      reason: "destination_conflict", occupant_sha256: occupant.metadata?.sha256 ?? null, occupant_size: occupant.size,
    });
    step("conflito_de_destino", { occupant_sha256: occupant.metadata?.sha256 ?? null });
    throw new ArchiveError(`O caminho ${bucket}/${path} já está ocupado por outro arquivo; nada foi sobrescrito e a restauração foi registrada como falha (a cópia arquivada continua intacta).`, begin.operationId, false);
  }
  if (!occupant) {
    try {
      await deps.storage.upload(bucket, path, copy, { contentType, cacheControl: restore.cache_control ?? "31536000", metadata: { sha256: archiveSha } });
    } catch (error) {
      step("gravacao_interrompida", { error: message(error) });
      throw new ArchiveError(`A restauração de ${bucket}/${path} foi interrompida (${message(error)}); continua pendente. Repita para retomar.`, begin.operationId, true);
    }
  }
  const back = await deps.storage.info(bucket, path);
  const backBytes = isSame(back) ? await deps.storage.download(bucket, path) : null;
  if (!isSame(back) || (back!.contentType !== null && back!.contentType !== contentType) || !backBytes || sha256(backBytes) !== archiveSha) {
    step("restaurado_divergente", { sha256: back?.metadata?.sha256 ?? null, size: back?.size ?? null, content_type: back?.contentType ?? null });
    throw new ArchiveError(`O arquivo restaurado em ${bucket}/${path} não confere; a restauração continua pendente.`, begin.operationId, true);
  }
  await confirm(deps, begin.operationId, actor, {
    restored_sha256: archiveSha, restored_size: copy.byteLength, restored_content_type: contentType, resumed_existing: Boolean(occupant),
  }, `Restauração de ${bucket}/${path}`);
  step("concluida", { restored_sha256: archiveSha });
  return { status: "restored" as const, operationId: begin.operationId };
}

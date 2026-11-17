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
import { createHash } from "node:crypto";
import type { LifecycleRpc } from "./tracked.ts";

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
export type ArchiveDeps = { rpc: LifecycleRpc; storage: ArchiveStorage; readObject(bucket: string, path: string): Promise<LifecycleRow | null> };

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

/** Começa (ou retoma) a operação. Tentativas encerradas como falha usam a chave seguinte. */
async function beginOrResume(deps: ArchiveDeps, operation: string, bucket: string, path: string, actor: string, reason: string, details: Record<string, unknown>): Promise<Begin> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const r = await deps.rpc("storage_lifecycle_begin_operation", {
      p_idempotency_key: archiveKey(operation, bucket, path, attempt), p_operation: operation, p_bucket: bucket, p_object_path: path,
      p_actor: actor, p_reason: reason, p_details: details,
    });
    if (r.status === "finished" && r.result === "failed") continue;
    return { status: r.status as Begin["status"], operationId: String(r.operation_id), result: r.result as string | undefined };
  }
  throw new ArchiveError(`${operation} de ${bucket}/${path} falhou 5 vezes; revise a auditoria.`, null, false);
}

const finish = (deps: ArchiveDeps, operationId: string, result: "succeeded" | "failed", actor: string, details: Record<string, unknown>) =>
  deps.rpc("storage_lifecycle_finish_operation", { p_operation_id: operationId, p_result: result, p_actor: actor, p_details: details });

export async function archiveObject(input: { deps: ArchiveDeps; bucket: string; path: string; actor: string; reason: string; archiveBucket?: string }) {
  const { deps, bucket, path, actor } = input;
  const archiveBucket = input.archiveBucket ?? ARCHIVE_BUCKET;
  const archivePath = `${bucket}/${path}`;
  const row = await deps.readObject(bucket, path);
  if (!row) throw new ArchiveError(`${bucket}/${path} não está no ciclo de vida.`, null, false);
  if (row.archive_state === "archived") return { status: "already_archived" as const, archiveBucket: row.archive_bucket, archivePath: row.archive_path };

  // Intenção (a guarda do banco recusa objeto não elegível ANTES de qualquer cópia).
  const begin = await beginOrResume(deps, "archive_copy", bucket, path, actor, input.reason, { archive_bucket: archiveBucket, archive_path: archivePath });
  if (begin.status === "finished") return { status: "already_archived" as const, archiveBucket, archivePath, operationId: begin.operationId };

  // 1. Original: precisa existir e conferir com o SHA-256 registrado (se houver).
  const original = await deps.storage.download(bucket, path);
  if (!original) {
    await finish(deps, begin.operationId, "failed", actor, { reason: "original ausente no Storage" });
    throw new ArchiveError(`O original ${bucket}/${path} não existe; arquivamento registrado como falho.`, begin.operationId, false);
  }
  const originalSha = sha256(original);
  if (row.sha256 && row.sha256 !== originalSha) {
    await finish(deps, begin.operationId, "failed", actor, { reason: "original diverge do SHA-256 registrado", original_sha256: originalSha });
    throw new ArchiveError(`O original ${bucket}/${path} não confere com o SHA-256 registrado; nada foi arquivado.`, begin.operationId, false);
  }

  // 2. Cópia no arquivo (sem sobrescrever). Caminho ocupado: só aceita se for a MESMA cópia (retomada).
  const contentType = row.mimetype ?? "application/octet-stream";
  await deps.storage.upload(archiveBucket, archivePath, original, { contentType, cacheControl: "3600", metadata: { sha256: originalSha, source: `${bucket}/${path}` } });
  const copy = await deps.storage.info(archiveBucket, archivePath);
  if (!copy || copy.metadata?.sha256 !== originalSha || Number(copy.size) !== original.byteLength) {
    throw new ArchiveError(`A cópia em ${archiveBucket}/${archivePath} não confere (tamanho ou SHA-256); a operação continua pendente para revisão.`, begin.operationId, true);
  }

  // 3. Checkpoint final: confirmação com origem, destino, hash e dados para restaurar.
  await finish(deps, begin.operationId, "succeeded", actor, {
    archive_bucket: archiveBucket, archive_path: archivePath, archive_sha256: originalSha,
    restore: { content_type: contentType, cache_control: "31536000", size: original.byteLength, source_bucket: bucket, source_path: path },
  });
  return { status: "archived" as const, archiveBucket, archivePath, sha256: originalSha, operationId: begin.operationId };
}

export async function cancelArchive(input: { deps: ArchiveDeps; bucket: string; path: string; actor: string; reason: string }) {
  const { deps, bucket, path, actor } = input;
  const row = await deps.readObject(bucket, path);
  if (!row || row.archive_state !== "archived") throw new ArchiveError(`${bucket}/${path} não está arquivado.`, null, false);
  const begin = await beginOrResume(deps, "archive_cancel", bucket, path, actor, input.reason, {});
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

  // A cópia precisa estar íntegra ANTES de qualquer remoção.
  const copy = await deps.storage.info(row.archive_bucket, row.archive_path);
  if (!copy || copy.metadata?.sha256 !== row.archive_sha256) {
    throw new ArchiveError(`A cópia arquivada de ${bucket}/${path} não confere; nada foi removido.`, null, false);
  }
  const begin = await beginOrResume(deps, "delete_object", bucket, path, actor, input.reason, { archive_bucket: row.archive_bucket, archive_path: row.archive_path });
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

  const begin = await beginOrResume(deps, "restore_object", bucket, path, actor, input.reason, { archive_bucket: row.archive_bucket, archive_path: row.archive_path });
  if (begin.status === "finished") return { status: "already_restored" as const, operationId: begin.operationId };

  const copy = await deps.storage.download(row.archive_bucket, row.archive_path);
  if (!copy || sha256(copy) !== row.archive_sha256) {
    throw new ArchiveError(`A cópia arquivada de ${bucket}/${path} está ausente ou não confere; a restauração continua pendente para revisão.`, begin.operationId, true);
  }
  const restore = (row.restore_metadata ?? {}) as { content_type?: string; cache_control?: string };
  await deps.storage.upload(bucket, path, copy, {
    contentType: restore.content_type ?? row.mimetype ?? "application/octet-stream", cacheControl: restore.cache_control ?? "31536000",
    metadata: { sha256: row.archive_sha256 },
  });
  const back = await deps.storage.info(bucket, path);
  const restoredSha = back?.metadata?.sha256 ?? null;
  if (!back || Number(back.size) !== copy.byteLength || restoredSha !== row.archive_sha256) {
    throw new ArchiveError(`O arquivo restaurado em ${bucket}/${path} não confere; a restauração continua pendente.`, begin.operationId, true);
  }
  await finish(deps, begin.operationId, "succeeded", actor, { restored_sha256: row.archive_sha256, restored_size: copy.byteLength });
  return { status: "restored" as const, operationId: begin.operationId };
}

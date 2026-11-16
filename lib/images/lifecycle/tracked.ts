// Serviço central do ciclo de vida para as rotas de imagem (Etapa 4.1).
//
// uploadTracked: SHA-256 completo do WebP → intenção no banco → envio sem sobrescrever (com o
// SHA-256 nos metadados do objeto) → verificação do objeto no Storage → confirmação no banco.
// O objeto novo fica "unverified" até uma varredura classificá-lo.
//
// Reaproveitar um arquivo que já existe no mesmo caminho só é aceito com prova do SHA-256
// COMPLETO: o mesmo hash já registrado no banco, ou o mesmo hash nos metadados gravados no envio
// anterior. Coincidir só o prefixo de 16 caracteres do nome nunca basta. Sem prova, a operação
// fica PENDENTE (intenção aberta, visível em storage_lifecycle_pending_operations) e o envio é
// interrompido com IdentityUnverifiedError, sem baixar a imagem antiga.
//
// applyReferenceBatch: lote de trocas (cada uma storage_lifecycle_replace_reference, com chave
// própria) registrado ANTES da primeira troca. Para na primeira falha: as referências seguintes
// continuam como estavam, o lote fica pendente e repetir a mesma solicitação retoma do ponto
// em que parou, sem duplicar nada.
import { createHash } from "node:crypto";
import { immutableImageName } from "../naming.ts";
import { IMMUTABLE_CACHE_SECONDS } from "../presets.ts";
import type { OptimizedImage } from "../optimizeImage.ts";

type StorageErrorLike = { message?: string; statusCode?: string | number; status?: number } | null;

/** Recorte da API do bucket usada aqui (compatível com supabase.storage.from(bucket)). */
export type TrackedBucketApi = {
  upload(
    path: string,
    body: Buffer | Uint8Array,
    options: { contentType: string; cacheControl: string; upsert: false; metadata: Record<string, string> }
  ): Promise<{ error: StorageErrorLike }>;
  info(path: string): Promise<{
    data: { size?: number | null; contentType?: string | null; metadata?: Record<string, unknown> | null } | null;
    error: StorageErrorLike;
  }>;
  getPublicUrl(path: string): { data: { publicUrl: string } };
};

/** Chamada às funções da interface do ciclo de vida (RPC). Lança erro com `code` do Postgres. */
export type LifecycleRpc = (fn: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

export class IdentityUnverifiedError extends Error {
  readonly objectKey: string;
  readonly operationId: string;
  constructor(objectKey: string, operationId: string) {
    super(`O arquivo ${objectKey} já existe no Storage e não há prova de que seja o mesmo conteúdo (SHA-256 completo). O envio ficou pendente para revisão; nada foi alterado.`);
    this.objectKey = objectKey;
    this.operationId = operationId;
  }
}
export class TrackedUploadError extends Error {
  readonly operationId: string | null;
  readonly pending: boolean;
  constructor(message: string, operationId: string | null, pending: boolean) {
    super(message);
    this.operationId = operationId;
    this.pending = pending;
  }
}

export type TrackedUploadResult = {
  status: "uploaded" | "reused";
  bucket: string;
  path: string;
  publicUrl: string;
  sha256: string;
  operationId: string;
  evidence: "uploaded_verified" | "storage_metadata" | "registered_identity";
};

export function fullSha256(buffer: Uint8Array) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Chave de idempotência do envio, de tamanho fixo (136 caracteres): a auditoria limita a chave a
 * 300, e caminho + nome podem passar disso. O banco confere bucket, caminho e SHA-256 completos
 * à parte; aqui o caminho entra pelo próprio SHA-256.
 */
export const uploadKey = (bucket: string, path: string, sha256: string, attempt = 1) =>
  `upload:${sha256}:${createHash("sha256").update(`${bucket}/${path}`).digest("hex")}${attempt > 1 ? `:${attempt}` : ""}`;

/** Tentativas de envio do MESMO arquivo depois de tentativas encerradas como falhas (cada uma com chave própria). */
export const MAX_UPLOAD_ATTEMPTS = 5;

function isAlreadyExists(error: NonNullable<StorageErrorLike>) {
  const status = String(error.statusCode ?? error.status ?? "");
  return status === "409" || /already exists|duplicate/i.test(error.message ?? "");
}

function cleanDirectory(directory: string) {
  const clean = directory.replace(/^\/+|\/+$/g, "");
  if (!clean || clean.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Pasta de destino inválida.");
  return clean;
}

export async function uploadTracked(input: {
  rpc: LifecycleRpc;
  bucket: string;
  api: TrackedBucketApi;
  directory: string;
  baseName: string;
  image: OptimizedImage;
  actor: string;
  reason: string;
}): Promise<TrackedUploadResult> {
  const { rpc, bucket, api, image, actor } = input;
  const buffer = image.buffer as Uint8Array;
  const sha256 = fullSha256(buffer);
  const path = `${cleanDirectory(input.directory)}/${immutableImageName(input.baseName, sha256)}`;
  const objectKey = `${bucket}/${path}`;
  const size = buffer.byteLength;
  const publicUrl = api.getPublicUrl(path).data.publicUrl;

  // 1. Intenção (antes de qualquer envio). Repetir devolve a operação existente.
  // Uma tentativa encerrada como FALHA (ex.: arquivo nunca chegou ao Storage, fechada pela
  // reconciliação) não bloqueia o mesmo arquivo: a próxima usa a chave seguinte, também determinística.
  let begin: Record<string, unknown> = {};
  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
    begin = await rpc("storage_lifecycle_begin_upload", {
      p_idempotency_key: uploadKey(bucket, path, sha256, attempt), p_bucket: bucket, p_object_path: path, p_sha256: sha256,
      p_size: size, p_mimetype: image.contentType, p_actor: actor, p_reason: input.reason,
    });
    if (begin.status !== "failed") break;
  }
  const operationId = String(begin.operation_id);
  if (begin.status === "succeeded") {
    const details = (begin.result_details ?? {}) as { method?: TrackedUploadResult["evidence"] };
    return { status: "reused", bucket, path, publicUrl, sha256, operationId, evidence: details.method ?? "registered_identity" };
  }
  if (begin.status === "failed") {
    throw new TrackedUploadError(`O envio de ${objectKey} falhou ${MAX_UPLOAD_ATTEMPTS} vezes; revise a auditoria antes de tentar de novo.`, operationId, false);
  }

  const finish = async (method: TrackedUploadResult["evidence"], extra: Record<string, unknown> = {}) => {
    const result = await rpc("storage_lifecycle_finish_upload", {
      p_operation_id: operationId, p_result: "succeeded", p_actor: actor,
      p_evidence: { method, sha256, size: String(size), ...extra },
    });
    if (result.status === "already_finished" && result.result !== "succeeded") {
      throw new TrackedUploadError(`O envio de ${objectKey} já estava encerrado como ${String(result.result)}.`, operationId, false);
    }
  };

  // Identidade conhecida pelo banco (mesmo SHA-256 completo já registrado): não reenvia.
  if (begin.known_object === true && begin.known_sha256 === sha256) {
    await finish("registered_identity");
    return { status: "reused", bucket, path, publicUrl, sha256, operationId, evidence: "registered_identity" };
  }

  // 2. Envio sem sobrescrever, com o SHA-256 completo nos metadados do objeto.
  let uploadError: StorageErrorLike = null;
  try {
    ({ error: uploadError } = await api.upload(path, buffer, {
      contentType: image.contentType, cacheControl: IMMUTABLE_CACHE_SECONDS, upsert: false, metadata: { sha256 },
    }));
  } catch (error) {
    // Resposta perdida: o envio pode ou não ter acontecido. A intenção continua aberta; repetir
    // a mesma solicitação reconhece o arquivo pelos metadados e conclui.
    throw new TrackedUploadError(`Falha de comunicação ao enviar ${objectKey}: ${error instanceof Error ? error.message : String(error)}. O envio ficou pendente; repita a operação.`, operationId, true);
  }
  if (uploadError && !isAlreadyExists(uploadError)) {
    throw new TrackedUploadError(`O Storage recusou ${objectKey}: ${uploadError.message ?? "erro"}. O envio ficou pendente; repita a operação.`, operationId, true);
  }

  // 3. Verificação do objeto no Storage (sem baixar a imagem).
  const { data: info, error: infoError } = await api.info(path);
  if (infoError || !info) {
    throw new TrackedUploadError(`Não foi possível conferir ${objectKey} no Storage: ${infoError?.message ?? "sem dados"}. O envio ficou pendente; repita a operação.`, operationId, true);
  }
  const storedSha = typeof info.metadata?.sha256 === "string" ? info.metadata.sha256 : null;
  const sameSize = Number(info.size) === size;

  if (!uploadError) {
    // Enviado agora: tamanho e (quando o Storage devolve) SHA-256 dos metadados precisam conferir.
    if (!sameSize || (storedSha !== null && storedSha !== sha256)) {
      throw new TrackedUploadError(`O objeto ${objectKey} no Storage não confere com o arquivo enviado (tamanho ou SHA-256). O envio ficou pendente para revisão.`, operationId, true);
    }
    await finish("uploaded_verified", { stored_size: Number(info.size), metadata_sha256: storedSha });
    return { status: "uploaded", bucket, path, publicUrl, sha256, operationId, evidence: "uploaded_verified" };
  }

  // Já existia: só com o SHA-256 completo gravado nos metadados do envio anterior.
  if (storedSha === sha256 && sameSize) {
    await finish("storage_metadata", { stored_size: Number(info.size) });
    return { status: "reused", bucket, path, publicUrl, sha256, operationId, evidence: "storage_metadata" };
  }
  throw new IdentityUnverifiedError(objectKey, operationId);
}

export type ReferenceItem = {
  key: string;
  table: "achievements" | "achievement_progress" | "games";
  row_key: string;
  column: string;
  old_value: string | null;
  new_value: string;
};

export type BatchResult =
  | { status: "completed"; batchOperationId: string; applied: string[]; alreadyApplied: string[] }
  | { status: "partial"; batchOperationId: string; applied: string[]; alreadyApplied: string[]; failed: { key: string; code?: string; message: string }; notAttempted: string[] };

export async function applyReferenceBatch(input: {
  rpc: LifecycleRpc;
  batchKey: string;
  actor: string;
  reason: string;
  items: ReferenceItem[];
}): Promise<BatchResult> {
  const { rpc, actor, reason } = input;
  // 1. Lote registrado antes da primeira troca. Na retomada, valem os itens ORIGINAIS
  //    (valores anteriores da primeira tentativa), não os relidos agora.
  const begin = await rpc("storage_lifecycle_begin_reference_batch", {
    p_idempotency_key: input.batchKey, p_actor: actor, p_reason: reason, p_items: input.items,
  });
  const batchOperationId = String(begin.operation_id);
  const items = (begin.items as ReferenceItem[]) ?? input.items;
  const applied: string[] = [];
  const alreadyApplied: string[] = [];
  if (begin.status === "succeeded") {
    return { status: "completed", batchOperationId, applied, alreadyApplied: items.map((i) => i.key) };
  }

  // 2. Trocas, uma a uma, cada uma auditada e idempotente pela chave.
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    try {
      const result = await rpc("storage_lifecycle_replace_reference", {
        p_idempotency_key: item.key, p_table: item.table, p_row_key: item.row_key, p_column: item.column,
        p_expected_value: item.old_value, p_new_value: item.new_value, p_actor: actor, p_reason: reason,
      });
      if (result.status === "applied") applied.push(item.key);
      else if (result.status === "already_applied" && result.result === "succeeded") alreadyApplied.push(item.key);
      else throw Object.assign(new Error(`resultado inesperado: ${JSON.stringify(result)}`), { code: "XX000" });
    } catch (error) {
      const failure = error as { code?: string; message?: string };
      return {
        status: "partial", batchOperationId, applied, alreadyApplied,
        failed: { key: item.key, code: failure.code, message: failure.message ?? String(error) },
        notAttempted: items.slice(index + 1).map((i) => i.key),
      };
    }
  }

  // 3. Conclusão: o banco confere que todas as trocas do lote tiveram sucesso.
  await rpc("storage_lifecycle_finish_reference_batch", { p_operation_id: batchOperationId, p_actor: actor });
  return { status: "completed", batchOperationId, applied, alreadyApplied };
}

/** RPC pela API do Supabase (service_role). O erro carrega o código do Postgres. */
export function supabaseLifecycleRpc(client: {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string; hint?: string } | null }>;
}): LifecycleRpc {
  return async (fn, args) => {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw Object.assign(new Error(error.message), { code: error.code, hint: error.hint });
    return (data ?? {}) as Record<string, unknown>;
  };
}

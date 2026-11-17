// Ativação rastreada de imagem por ponteiro (banners e avatar) — Etapa 4.2.
//
// 1. Envio rastreado do arquivo (uploadTracked): intenção, envio sem sobrescrever, SHA-256 completo,
//    conferência e confirmação; o objeto fica "unverified" até uma varredura.
// 2. Lê o ponteiro atual (arquivo anterior). Ponteiro ilegível → para (não dá para auditar a troca).
//    Mesmo arquivo já ativo: só o enquadramento é regravado (não é troca de imagem).
// 3. Intenção da ativação no banco (com o arquivo anterior) ANTES de gravar o ponteiro.
// 4. Grava o ponteiro (imagem + enquadramento juntos) e RELÊ: só a releitura com o arquivo novo
//    confirma a ativação; releitura com o anterior registra falha; qualquer outra coisa deixa a
//    operação pendente. Repetir a solicitação retoma a mesma ativação pendente.
// 5. afterActivate (cópia de compatibilidade do enquadramento), como antes.
// O arquivo anterior nunca é apagado nem movido.
import type { OptimizedImage } from "../optimizeImage.ts";
import {
  inspectActivePointer,
  writeActivePointer,
  type FixedImageTarget,
  type ImageFraming,
  type StorageReader,
} from "../storedImages.ts";
import { uploadTracked, type LifecycleRpc, type TrackedBucketApi, type TrackedUploadResult } from "./tracked.ts";

export class PointerActivationError extends Error {
  readonly operationId: string | null;
  readonly pending: boolean;
  constructor(message: string, operationId: string | null, pending: boolean) {
    super(message);
    this.operationId = operationId;
    this.pending = pending;
  }
}

export type TrackedActivationResult = {
  upload: TrackedUploadResult;
  fileName: string;
  previousFile: string | null;
  activation: "activated" | "framing_only";
  operationId: string | null;
};

function sameFraming(a: ImageFraming | null, b: ImageFraming | null | undefined) {
  if (!a || !b) return !a && !b;
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}

export async function activateTrackedImage(input: {
  client: StorageReader;
  rpc: LifecycleRpc;
  target: FixedImageTarget;
  image: OptimizedImage;
  actor: string;
  reason: string;
  framing?: ImageFraming | null;
  afterActivate?: () => Promise<void>;
  now?: () => Date;
}): Promise<TrackedActivationResult> {
  const { client, rpc, target, actor } = input;
  const api = client.storage.from(target.bucket) as unknown as TrackedBucketApi;
  const upload = await uploadTracked({
    rpc, bucket: target.bucket, api, directory: target.folder, baseName: target.baseName, image: input.image, actor, reason: input.reason,
  });
  const fileName = upload.path.slice(target.folder.length + 1);

  const current = await inspectActivePointer(client, target);
  if (current.state === "unreadable") {
    throw new PointerActivationError(`Não foi possível ler o ponteiro ${target.pointer} (${current.reason}); nada foi ativado.`, null, false);
  }
  const previousFile = current.state === "present" ? current.pointer.file : null;

  // Sempre passa pelo banco: se houver ativação pendente deste ponteiro para este arquivo (por
  // exemplo, ponteiro gravado e resposta perdida), ela é retomada e confirmada pela releitura.
  const begin = await rpc("storage_lifecycle_begin_pointer_activation", {
    p_pointer: target.pointer, p_bucket: target.bucket, p_object_path: upload.path, p_previous_file: previousFile,
    p_actor: actor, p_reason: input.reason,
  });
  if (begin.status === "already_active") {
    // Mesmo arquivo já ativo e nada pendente: só o enquadramento, se mudou (não é troca de imagem).
    if (current.state === "present" && !sameFraming(current.pointer.framing, input.framing ?? null)) {
      await writeActivePointer(client, target, fileName, { framing: input.framing, now: input.now });
    }
    await input.afterActivate?.();
    return { upload, fileName, previousFile, activation: "framing_only", operationId: null };
  }
  const operationId = String(begin.operation_id);
  // Retomada: o "anterior" válido é o registrado na intenção original.
  const expectedPrevious = (begin.previous_file as string | null) ?? null;

  const finish = (result: "succeeded" | "failed", readBack: string | null) =>
    rpc("storage_lifecycle_finish_pointer_activation", {
      p_operation_id: operationId, p_result: result, p_actor: actor,
      p_evidence: { method: "pointer_read_back", read_back_file: readBack, pointer: target.pointer },
    });

  let writeError: unknown = null;
  try {
    await writeActivePointer(client, target, fileName, { framing: input.framing, now: input.now });
  } catch (error) {
    writeError = error;
  }

  const readBack = await inspectActivePointer(client, target);
  const readFile = readBack.state === "present" ? readBack.pointer.file : readBack.state === "absent" ? null : undefined;
  if (readFile === fileName) {
    await finish("succeeded", fileName);
  } else if (readFile !== undefined && readFile === expectedPrevious) {
    await finish("failed", readFile);
    throw new PointerActivationError(
      `O ponteiro ${target.pointer} não foi alterado${writeError ? `: ${writeError instanceof Error ? writeError.message : String(writeError)}` : ""}. A imagem anterior continua ativa.`,
      operationId, false);
  } else {
    throw new PointerActivationError(
      `Não foi possível comprovar a ativação de ${fileName} no ponteiro ${target.pointer}; a operação ficou pendente. Repita para concluir.`,
      operationId, true);
  }

  await input.afterActivate?.();
  return { upload, fileName, previousFile: expectedPrevious, activation: "activated", operationId };
}

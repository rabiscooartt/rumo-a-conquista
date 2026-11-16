// Importação de artes de conquista (rota /api/admin/achievement-art) com o ciclo de vida.
//
// Por solicitação:
//   1. Lê do banco a imagem atual de cada conquista e TODOS os progressos com image_override
//      (as referências que a rota troca). Conquista com progresso afetado "completed" sem
//      earned_at é recusada ANTES do envio (a troca acionaria o gatilho que grava a data de hoje);
//      as demais seguem normalmente. Nenhuma data ou status é alterado.
//   2. Envia cada arte aceita por uploadTracked (intenção → envio → verificação → confirmação).
//   3. Registra UM lote com todas as trocas (achievements.image + image_override afetados) e
//      aplica cada troca pela função auditada, na ordem. Primeira falha: para, as referências
//      seguintes continuam como estavam, o lote fica pendente e a resposta NÃO é de sucesso.
//      Repetir a mesma solicitação retoma do ponto em que parou (mesmas chaves).
// Arquivos anteriores nunca são apagados, movidos ou arquivados. Proteções não são tocadas.
import { createHash } from "node:crypto";
import type { OptimizedImage } from "../optimizeImage.ts";
import { objectKeyFromReference } from "./references.ts";
import {
  applyReferenceBatch,
  fullSha256,
  IdentityUnverifiedError,
  TrackedUploadError,
  uploadTracked,
  type BatchResult,
  type LifecycleRpc,
  type ReferenceItem,
  type TrackedBucketApi,
  type TrackedUploadResult,
} from "./tracked.ts";

export const ACHIEVEMENT_ART_BUCKET = "achievement-art";

export type AchievementRow = { id: string; title: string; image: string | null };
export type ProgressRow = { id: string; achievement_id: string; status: string; earned_at: string | null; image_override: string | null };
export type LifecycleObjectRow = { bucket: string; object_path: string; state: string; manual_protection: boolean };

export type AchievementArtDeps = {
  rpc: LifecycleRpc;
  bucketApi: TrackedBucketApi;
  loadAchievements(gameSlug: string, ids: string[]): Promise<AchievementRow[]>;
  /** Progressos das conquistas com image_override preenchido (os que a rota troca). */
  loadAffectedProgress(achievementIds: string[]): Promise<ProgressRow[]>;
  loadObjects(objectKeys: string[]): Promise<LifecycleObjectRow[]>;
  /** Itens de um lote já registrado (retomada), ou null. */
  loadBatchItems(batchKey: string): Promise<ReferenceItem[] | null>;
};

export type ImportItem = { filename: string; achievementId: string; baseName: string; optimized: OptimizedImage };

export type ImportOutcome = {
  status: "completed" | "partial" | "upload_failed" | "nothing_accepted";
  refused: { filename: string; title: string; reason: string; progressIds: string[] }[];
  uploads: (TrackedUploadResult & { filename: string; achievementId: string })[];
  uploadFailure?: { filename: string; message: string; pending: boolean; operationId: string | null };
  batch?: BatchResult & { batchKey: string; items: number };
  saved: { filename: string; title: string; image: string; references: number }[];
  previousObjects: { objectKey: string; state: string | null; manualProtection: boolean }[];
};

export function batchKeyFor(gameSlug: string, pairs: { achievementId: string; sha256: string }[]) {
  const canonical = JSON.stringify([...pairs].sort((a, b) => a.achievementId.localeCompare(b.achievementId)).map((p) => [p.achievementId, p.sha256]));
  return `achievement-art:${gameSlug}:${createHash("sha256").update(canonical).digest("hex")}`;
}

export async function importAchievementArt(input: {
  deps: AchievementArtDeps;
  gameSlug: string;
  items: ImportItem[];
  actor: string;
}): Promise<ImportOutcome> {
  const { deps, gameSlug, actor } = input;
  const reason = `importação de artes de conquista (${gameSlug})`;
  const ids = [...new Set(input.items.map((i) => i.achievementId))];
  const achievements = new Map((await deps.loadAchievements(gameSlug, ids)).map((a) => [a.id, a]));
  const progress = await deps.loadAffectedProgress(ids);
  const outcome: ImportOutcome = { status: "completed", refused: [], uploads: [], saved: [], previousObjects: [] };

  // 1. Pré-verificação por conquista (antes de qualquer envio).
  const accepted: ImportItem[] = [];
  for (const item of input.items) {
    const achievement = achievements.get(item.achievementId);
    if (!achievement) throw new Error(`Conquista ${item.achievementId} não encontrada em ${gameSlug}.`);
    const affected = progress.filter((p) => p.achievement_id === item.achievementId && p.image_override !== null);
    const noDate = affected.filter((p) => p.status === "completed" && !p.earned_at);
    if (noDate.length > 0) {
      outcome.refused.push({
        filename: item.filename, title: achievement.title, progressIds: noDate.map((p) => p.id),
        reason: "progresso concluído sem data de desbloqueio (earned_at): a troca gravaria a data de hoje. Corrija a data antes; nada foi enviado nem alterado.",
      });
      continue;
    }
    accepted.push(item);
  }
  if (accepted.length === 0) return { ...outcome, status: "nothing_accepted" };

  // Proteções e estado das imagens que deixarão de ser referenciadas (informativo; nada muda nelas).
  const previousKeys = new Set<string>();
  for (const item of accepted) {
    const keys = [achievements.get(item.achievementId)!.image, ...progress.filter((p) => p.achievement_id === item.achievementId).map((p) => p.image_override)];
    for (const value of keys) {
      const key = objectKeyFromReference(value ?? "");
      if (key) previousKeys.add(key);
    }
  }
  const known = new Map((await deps.loadObjects([...previousKeys])).map((o) => [`${o.bucket}/${o.object_path}`, o]));
  outcome.previousObjects = [...previousKeys].sort().map((k) => ({ objectKey: k, state: known.get(k)?.state ?? null, manualProtection: known.get(k)?.manual_protection ?? false }));

  // 2. Envios rastreados.
  for (const item of accepted) {
    try {
      const uploaded = await uploadTracked({
        rpc: deps.rpc, bucket: ACHIEVEMENT_ART_BUCKET, api: deps.bucketApi,
        directory: `games/${gameSlug}/achievements`, baseName: item.baseName, image: item.optimized, actor, reason,
      });
      outcome.uploads.push({ ...uploaded, filename: item.filename, achievementId: item.achievementId });
    } catch (error) {
      const pending = error instanceof IdentityUnverifiedError || (error instanceof TrackedUploadError && error.pending);
      const operationId = error instanceof IdentityUnverifiedError || error instanceof TrackedUploadError ? error.operationId : null;
      outcome.uploadFailure = { filename: item.filename, message: error instanceof Error ? error.message : String(error), pending, operationId };
      return { ...outcome, status: "upload_failed" };
    }
  }

  // 3. Lote de trocas: achievements.image e cada image_override afetado.
  const batchKey = batchKeyFor(gameSlug, accepted.map((item) => ({ achievementId: item.achievementId, sha256: fullSha256(item.optimized.buffer as Uint8Array) })));
  let items = await deps.loadBatchItems(batchKey);
  if (!items) {
    items = [];
    for (const upload of outcome.uploads) {
      const achievement = achievements.get(upload.achievementId)!;
      if (achievement.image !== upload.publicUrl) {
        items.push({ key: `${batchKey}:achievements:${achievement.id}`, table: "achievements", row_key: achievement.id, column: "image", old_value: achievement.image, new_value: upload.publicUrl });
      }
      for (const row of progress.filter((p) => p.achievement_id === upload.achievementId && p.image_override !== null)) {
        if (row.image_override !== upload.publicUrl) {
          items.push({ key: `${batchKey}:progress:${row.id}`, table: "achievement_progress", row_key: row.id, column: "image_override", old_value: row.image_override, new_value: upload.publicUrl });
        }
      }
    }
  }

  const describeSaved = () => outcome.uploads.map((u) => ({
    filename: u.filename, title: achievements.get(u.achievementId)!.title, image: u.publicUrl,
    references: items!.filter((i) => i.new_value === u.publicUrl).length,
  }));
  if (items.length === 0) {
    outcome.saved = describeSaved();
    return outcome;
  }
  const batch = await applyReferenceBatch({ rpc: deps.rpc, batchKey, actor, reason, items });
  outcome.batch = { ...batch, batchKey, items: items.length };
  outcome.saved = describeSaved();
  return { ...outcome, status: batch.status === "completed" ? "completed" : "partial" };
}

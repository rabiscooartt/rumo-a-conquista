// Reconciliação de operações pendentes do ciclo de vida (Etapa 4.3).
//
// Lê storage_lifecycle_pending_operations e, para cada intenção sem resultado, busca EVIDÊNCIA:
//   object_upload    info() no caminho exato: mesmo SHA-256 completo (metadados próprios) e mesmo
//                    tamanho → concluído (storage_metadata); objeto inexistente → falha (nunca chegou);
//                    qualquer outra coisa → continua pendente, com diagnóstico.
//   pointer_activate releitura do ponteiro: arquivo novo → concluído; arquivo anterior → falha;
//                    ilegível/outro → pendente.
//   reference_batch  conclui só se TODAS as trocas do lote já tiverem sucesso (o banco confere de
//                    novo); senão pendente, listando o que falta (retomar = repetir a solicitação).
//   reference_sync   salvamento em massa (Etapa 5.1): o BANCO relê cada local registrado e conclui
//                    se todos têm o valor novo, ou registra falha se nenhum foi gravado; mistura
//                    continua pendente. Com --close-unconfirmed-sync (explícito), a mistura é
//                    encerrada como failed com os valores reais (destrava o jogo sem confirmar nada).
//   arquivamento     pendente (o executor ainda não existe; nada é resolvido automaticamente).
// Nunca envia arquivos, nunca troca referências, nunca apaga nada: só registra o resultado
// comprovado, pelas funções finish_* (que validam a evidência outra vez). Operações recentes
// (abaixo da idade mínima) são ignoradas para não atropelar uma solicitação em andamento.
import type { LifecycleRpc } from "./tracked.ts";

export type PendingOperation = {
  operation_id: string;
  operation: string;
  bucket: string | null;
  object_path: string | null;
  started_at: string;
  details: Record<string, unknown>;
};
export type StorageInfoResult =
  | { status: "found"; size: number | null; contentType: string | null; metadata: Record<string, unknown> | null }
  | { status: "not_found" }
  | { status: "error"; message: string };
export type PointerRead = { state: "present"; file: string } | { state: "absent" } | { state: "invalid" | "unreadable"; reason: string };
export type ReplaceStatus = { key: string; newValue: string | null; result: "succeeded" | "failed" | null };

export type ReconcileDeps = {
  listPending(): Promise<PendingOperation[]>;
  storageInfo(bucket: string, path: string): Promise<StorageInfoResult>;
  readPointer(pointer: string): Promise<PointerRead>;
  replaceStatuses(keys: string[]): Promise<ReplaceStatus[]>;
  rpc: LifecycleRpc;
};

export type ReconcileDecision = {
  operationId: string;
  operation: string;
  object: string | null;
  ageMinutes: number;
  decision: "succeeded" | "failed" | "finish_batch" | "settle_sync" | "keep_pending" | "too_recent";
  diagnosis: string;
  evidence?: Record<string, unknown>;
  applied?: Record<string, unknown> | { error: string; code?: string };
};

export async function reconcilePending(input: {
  deps: ReconcileDeps;
  mode: "dry-run" | "apply";
  actor: string;
  now: Date;
  minAgeMinutes: number;
  /** reference_sync sem prova: encerra como failed registrando os valores reais (só com pedido explícito). */
  closeUnconfirmedSync?: boolean;
}): Promise<{ decisions: ReconcileDecision[]; applied: number; errors: number }> {
  const { deps, mode, actor, now } = input;
  const pending = await deps.listPending();
  const decisions: ReconcileDecision[] = [];

  for (const op of pending) {
    const ageMinutes = Math.floor((now.getTime() - new Date(op.started_at).getTime()) / 60000);
    const object = op.bucket && op.object_path ? `${op.bucket}/${op.object_path}` : null;
    const base = { operationId: op.operation_id, operation: op.operation, object, ageMinutes };
    if (ageMinutes < input.minAgeMinutes) {
      decisions.push({ ...base, decision: "too_recent", diagnosis: `iniciada há ${ageMinutes} min (mínimo ${input.minAgeMinutes}); pode estar em andamento` });
      continue;
    }

    if (op.operation === "object_upload") {
      const sha256 = String(op.details.sha256 ?? "");
      const size = Number(op.details.size);
      const info = await deps.storageInfo(op.bucket!, op.object_path!);
      if (info.status === "not_found") {
        decisions.push({ ...base, decision: "failed", diagnosis: "o arquivo não existe no Storage: o envio nunca chegou",
          evidence: { method: "storage_not_found", checked_at: now.toISOString() } });
      } else if (info.status === "error") {
        decisions.push({ ...base, decision: "keep_pending", diagnosis: `não foi possível consultar o Storage: ${info.message}` });
      } else {
        const storedSha = typeof info.metadata?.sha256 === "string" ? info.metadata.sha256 : null;
        if (storedSha === sha256 && Number(info.size) === size) {
          decisions.push({ ...base, decision: "succeeded", diagnosis: "arquivo presente com o mesmo SHA-256 completo e o mesmo tamanho",
            evidence: { method: "storage_metadata", sha256, size: String(size), stored_size: Number(info.size), reconciled: true } });
        } else {
          decisions.push({ ...base, decision: "keep_pending",
            diagnosis: storedSha === null
              ? "arquivo presente sem SHA-256 nos metadados: identidade não comprovada (revisão manual)"
              : storedSha !== sha256 ? "arquivo presente com OUTRO SHA-256: possível colisão (revisão manual)" : `tamanho diferente (${info.size} × ${size})` });
        }
      }
    } else if (op.operation === "pointer_activate") {
      const pointer = String(op.details.pointer ?? "");
      const expected = String(op.details.pointer_file ?? "");
      const previous = (op.details.previous_file as string | null) ?? null;
      const read = await deps.readPointer(pointer);
      const file = read.state === "present" ? read.file : read.state === "absent" ? null : undefined;
      if (file === expected) {
        decisions.push({ ...base, decision: "succeeded", diagnosis: `ponteiro ${pointer} aponta para ${expected}`,
          evidence: { method: "pointer_read_back", read_back_file: expected, pointer, reconciled: true } });
      } else if (file !== undefined && file === previous) {
        decisions.push({ ...base, decision: "failed", diagnosis: `ponteiro ${pointer} continua no arquivo anterior (${previous ?? "nenhum"})`,
          evidence: { method: "pointer_read_back", read_back_file: previous, pointer, reconciled: true } });
      } else {
        decisions.push({ ...base, decision: "keep_pending",
          diagnosis: read.state === "present" ? `ponteiro ${pointer} aponta para um terceiro arquivo (${read.file})` : `ponteiro ${pointer} ${read.state}${"reason" in read ? `: ${read.reason}` : ""}` });
      }
    } else if (op.operation === "reference_batch") {
      const items = (Array.isArray(op.details.items) ? op.details.items : []) as { key: string; new_value: string }[];
      const statuses = new Map((await deps.replaceStatuses(items.map((i) => i.key))).map((s) => [s.key, s]));
      const missing = items.filter((i) => {
        const s = statuses.get(i.key);
        return !s || s.result !== "succeeded" || s.newValue !== i.new_value;
      });
      if (items.length > 0 && missing.length === 0) {
        decisions.push({ ...base, decision: "finish_batch", diagnosis: `todas as ${items.length} trocas do lote já tiveram sucesso` });
      } else {
        decisions.push({ ...base, decision: "keep_pending",
          diagnosis: `${missing.length} de ${items.length} troca(s) sem sucesso (${missing.slice(0, 5).map((i) => i.key.split(":").slice(-2).join(":")).join(", ")}); para concluir, repita a mesma solicitação no painel` });
      }
    } else if (op.operation === "reference_sync") {
      const count = Number(op.details.count ?? 0);
      decisions.push({ ...base, decision: "settle_sync",
        diagnosis: `salvamento ${String(op.details.scope ?? "?")} com ${count} referência(s): o banco relê cada local e conclui só com todos os valores novos (ou falha se nenhum foi gravado); mistura continua pendente${input.closeUnconfirmedSync ? " e será encerrada como failed com os valores reais" : ""}` });
    } else {
      const archiveOps = ["archive_copy", "archive_cancel", "delete_object", "restore_object"];
      decisions.push({ ...base, decision: "keep_pending",
        diagnosis: archiveOps.includes(op.operation)
          ? `operação ${op.operation}: retome pelo executor de arquivamento (lib/images/lifecycle/archive.ts, mesma chave), que confere o Storage antes de cada passo`
          : `operação ${op.operation}: resolução automática não implementada; revisão manual` });
    }
  }

  let applied = 0;
  let errors = 0;
  if (mode === "apply") {
    for (const d of decisions) {
      try {
        if (d.decision === "succeeded" || d.decision === "failed") {
          const fn = d.operation === "object_upload" ? "storage_lifecycle_finish_upload" : "storage_lifecycle_finish_pointer_activation";
          const args = d.operation === "object_upload"
            ? { p_operation_id: d.operationId, p_result: d.decision, p_actor: actor, p_evidence: d.evidence }
            : { p_operation_id: d.operationId, p_result: d.decision, p_actor: actor, p_evidence: d.evidence };
          d.applied = await deps.rpc(fn, args);
          applied += 1;
        } else if (d.decision === "settle_sync") {
          try {
            d.applied = await deps.rpc("storage_lifecycle_finish_reference_sync", { p_operation_id: d.operationId, p_actor: actor, p_mode: "settle" });
          } catch (error) {
            const e = error as { code?: string; hint?: string };
            if (!input.closeUnconfirmedSync || e.code !== "55000" || !String(e.hint ?? "").includes("reference_sync_unverified")) throw error;
            d.applied = await deps.rpc("storage_lifecycle_finish_reference_sync", { p_operation_id: d.operationId, p_actor: actor, p_mode: "close_unconfirmed" });
          }
          applied += 1;
        } else if (d.decision === "finish_batch") {
          d.applied = await deps.rpc("storage_lifecycle_finish_reference_batch", { p_operation_id: d.operationId, p_actor: actor });
          applied += 1;
        }
      } catch (error) {
        const e = error as { message?: string; code?: string };
        d.applied = { error: e.message ?? String(error), code: e.code };
        errors += 1;
      }
    }
  }
  return { decisions, applied, errors };
}

type SupabaseLike = {
  from(table: string): { select(columns: string): unknown };
  storage: { from(bucket: string): {
    info(path: string): Promise<{ data: { size?: number | null; contentType?: string | null; metadata?: Record<string, unknown> | null } | null; error: { message?: string; statusCode?: string | number; status?: number } | null }>;
    download(path: string): Promise<{ data: Blob | null; error: { message?: string; statusCode?: string | number; status?: number } | null }>;
  } };
};
type Query = PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }> & {
  eq(column: string, value: string): Query; in(column: string, values: string[]): Query; order(column: string): Query;
};

const isNotFound = (error: { message?: string; statusCode?: string | number; status?: number } | null) =>
  /not.?found|404/i.test(`${error?.message ?? ""} ${error?.statusCode ?? ""} ${error?.status ?? ""}`);

/** Dependências pela API do Supabase (service_role): SELECT na view/auditoria, info() e download do ponteiro. */
export function supabaseReconcileDeps(client: SupabaseLike, rpc: LifecycleRpc): ReconcileDeps {
  const select = async (table: string, columns: string, build: (q: Query) => Query) => {
    const { data, error } = await build(client.from(table).select(columns) as Query);
    if (error) throw new Error(`leitura de ${table}: ${error.message}`);
    return data ?? [];
  };
  return {
    rpc,
    listPending: async () => (await select("storage_lifecycle_pending_operations", "operation_id, operation, bucket, object_path, started_at, details", (q) => q.order("started_at"))) as unknown as PendingOperation[],
    async storageInfo(bucket, path) {
      const { data, error } = await client.storage.from(bucket).info(path);
      if (error) return isNotFound(error) ? { status: "not_found" } : { status: "error", message: error.message ?? "erro" };
      if (!data) return { status: "error", message: "sem dados" };
      return { status: "found", size: data.size ?? null, contentType: data.contentType ?? null, metadata: data.metadata ?? null };
    },
    async readPointer(pointer) {
      if (!/^[a-z0-9-]+$/.test(pointer)) return { state: "invalid", reason: "nome de ponteiro inválido" };
      const { data, error } = await client.storage.from("site-profile").download(`active/${pointer}.json`);
      if (error) return isNotFound(error) ? { state: "absent" } : { state: "unreadable", reason: error.message ?? "erro" };
      try {
        const parsed = JSON.parse(await data!.text()) as { file?: unknown };
        return typeof parsed.file === "string" ? { state: "present", file: parsed.file } : { state: "invalid", reason: "sem arquivo" };
      } catch {
        return { state: "invalid", reason: "JSON ilegível" };
      }
    },
    async replaceStatuses(keys) {
      if (keys.length === 0) return [];
      const intents = await select("storage_operation_log", "operation_id, idempotency_key, details",
        (q) => q.eq("operation", "reference_replace").eq("phase", "intent").in("idempotency_key", keys));
      const ids = intents.map((r) => String(r.operation_id));
      const results = ids.length ? await select("storage_operation_log", "operation_id, phase", (q) => q.in("operation_id", ids)) : [];
      return intents.map((r) => ({
        key: String(r.idempotency_key),
        newValue: ((r.details as Record<string, unknown>)?.new_value as string | undefined) ?? null,
        result: (results.find((x) => x.operation_id === r.operation_id && x.phase !== "intent")?.phase as "succeeded" | "failed" | undefined) ?? null,
      }));
    },
  };
}

// Executor de arquivamento e restauração (Etapa 5.2) sobre archive.ts.
//
//   planArchive      classifica cada objeto do ciclo de vida, com o motivo: só "candidate" e
//                    "superseded" sem referência, sem proteção e com a prova vigente (duas varreduras
//                    válidas, 30 dias) aparecem como elegíveis. unverified, observing, active,
//                    referenced e protected nunca são elegíveis — e a guarda do banco confere de novo.
//   readOnlyDeps     simulação: qualquer escrita (RPC fora da lista de leitura, upload, remoção)
//                    lança WriteBlockedError ANTES de sair do processo. É uma barreira técnica, não
//                    uma condição: o código de escrita é o mesmo e é ele que bate na barreira.
//   runArchive /     executam alvos EXPLÍCITOS (nunca "tudo"), um por vez; cada passo vai para o log.
//   runRestore       Repetir retoma (mesma chave, checkpoints no banco), sem duplicar arquivo nem registro.
//   resumePending    retoma operações de arquivo pendentes no banco (archive_copy, archive_cancel,
//                    restore_object); delete_object nunca é retomado automaticamente.
// Nada aqui altera referências do site.
import { archiveObject, cancelArchive, restoreObject, ArchiveError, type ArchiveDeps, type ArchiveStep, type LifecycleRow } from "./archive.ts";
import { evidenceMeetsPolicy, SCAN_POLICY_VERSION } from "./scanPolicy.ts";

export const ARCHIVABLE_STATES = ["candidate", "superseded"] as const;
/** RPCs só de leitura (STABLE) que a simulação pode chamar. */
export const READ_ONLY_RPCS = new Set([
  "storage_lifecycle_evidence", "storage_operation_log_verify", "storage_lifecycle_scan_is_valid",
  "storage_lifecycle_object_key", "storage_lifecycle_known_buckets", "storage_lifecycle_url_decode",
]);

export class WriteBlockedError extends Error {
  constructor(what: string) {
    super(`Escrita bloqueada no modo de simulação: ${what}.`);
    this.name = "WriteBlockedError";
  }
}

/** Dependências de simulação: leituras passam; qualquer escrita é recusada antes de acontecer. */
export function readOnlyDeps(deps: ArchiveDeps): ArchiveDeps {
  return {
    readObject: deps.readObject,
    onStep: deps.onStep,
    rpc: async (fn, args) => {
      if (!READ_ONLY_RPCS.has(fn)) throw new WriteBlockedError(`RPC ${fn}`);
      return deps.rpc(fn, args);
    },
    storage: {
      download: deps.storage.download,
      info: deps.storage.info,
      upload: async (bucket, path) => { throw new WriteBlockedError(`upload em ${bucket}/${path}`); },
      remove: async (bucket, path) => { throw new WriteBlockedError(`remoção de ${bucket}/${path}`); },
    },
  };
}

export type InventoryRow = LifecycleRow & { bucket: string; object_path: string; reference_count: number };
export type Evidence = { eligible?: boolean; reason?: string; first_scan?: string; policy_version?: number } | null;
export type PlanEntry = {
  object: string; bucket: string; path: string; state: string; archiveState: string;
  eligible: boolean; reason: string;
};

/** Classificação local (espelha a guarda do banco; o banco decide de novo na execução). */
export function planArchive(rows: InventoryRow[], evidence: Map<string, Evidence>): PlanEntry[] {
  return rows.map((row) => {
    const object = `${row.bucket}/${row.object_path}`;
    const base = { object, bucket: row.bucket, path: row.object_path, state: row.state, archiveState: row.archive_state };
    const refuse = (reason: string) => ({ ...base, eligible: false, reason });
    if (row.archive_state !== "none") return refuse(`já em ${row.archive_state}`);
    if (row.manual_protection) return refuse("proteção manual");
    if (row.reference_count > 0) return refuse(`referenciado (${row.reference_count})`);
    if (!(ARCHIVABLE_STATES as readonly string[]).includes(row.state)) {
      const why: Record<string, string> = {
        unverified: "unverified: enviado ou restaurado, ainda sem varredura que o confirme",
        observing: "observing: sem referência há pouco tempo; precisa de duas varreduras com 30 dias",
        active: "active: imagem ativa de banner/avatar",
        referenced: "referenced: usado pelo site",
        protected: "protected: na lista de proteção",
        duplicate: "duplicate: cópia de outro objeto; revisão manual",
      };
      return refuse(why[row.state] ?? `estado ${row.state}`);
    }
    const proof = evidence.get(object);
    if (!proof?.eligible) return refuse(`${row.state} sem prova vigente: ${proof?.reason ?? "evidência indisponível"}`);
    if (!evidenceMeetsPolicy(proof)) {
      return refuse(`${row.state}: prova não calculada pela política de varredura v${SCAN_POLICY_VERSION} (policy_version ${proof.policy_version ?? "ausente"})`);
    }
    return { ...base, eligible: true, reason: `${row.state}, sem referência nem proteção, prova de duas varreduras vigente` };
  });
}

export type RunResult = { object: string; status: string; operationId?: string | null; error?: string; pending?: boolean; code?: string };

function outcome(object: string, error: unknown): RunResult {
  if (error instanceof WriteBlockedError) return { object, status: "bloqueado_na_simulacao", error: error.message };
  if (error instanceof ArchiveError) return { object, status: error.pending ? "pendente" : "falhou", operationId: error.operationId, error: error.message, pending: error.pending };
  const e = error as { message?: string; code?: string };
  return { object, status: e.code === "23514" ? "recusado_pela_guarda" : "erro", error: e.message ?? String(error), code: e.code };
}

const split = (object: string) => {
  const index = object.indexOf("/");
  if (index <= 0) throw new Error(`Objeto inválido: ${object}`);
  return { bucket: object.slice(0, index), path: object.slice(index + 1) };
};

/**
 * Arquiva alvos explícitos que o plano marcou como elegíveis. Na simulação, confere o original
 * (existe, SHA-256, tamanho) sem escrever nada; no modo de escrita, executa archiveObject.
 */
export async function runArchive(input: {
  deps: ArchiveDeps; mode: "dry-run" | "apply"; targets: string[]; plan: PlanEntry[];
  actor: string; reason: string; archiveBucket?: string;
}): Promise<RunResult[]> {
  const byObject = new Map(input.plan.map((entry) => [entry.object, entry]));
  const deps = input.mode === "dry-run" ? readOnlyDeps(input.deps) : input.deps;
  const results: RunResult[] = [];
  for (const object of input.targets) {
    const entry = byObject.get(object);
    if (!entry) { results.push({ object, status: "fora_do_inventario" }); continue; }
    // "archiving" = arquivamento pendente deste objeto: repetir o comando retoma pela mesma operação.
    const resuming = !entry.eligible && entry.archiveState === "archiving";
    if (!entry.eligible && !resuming) { results.push({ object, status: "nao_elegivel", error: entry.reason }); continue; }
    if (input.mode === "dry-run" && resuming) { results.push({ object, status: "seria_retomado (archive_copy)" }); continue; }
    if (input.mode === "dry-run") {
      const row = await deps.readObject(entry.bucket, entry.path);
      const info = await deps.storage.info(entry.bucket, entry.path);
      results.push({ object, status: info ? "seria_arquivado" : "original_ausente",
        error: info && row?.size_bytes !== null && row?.size_bytes !== undefined && Number(info.size) !== Number(row.size_bytes) ? "tamanho diverge do registro" : undefined });
      continue;
    }
    try {
      const r = await archiveObject({ deps, bucket: entry.bucket, path: entry.path, actor: input.actor, reason: input.reason, archiveBucket: input.archiveBucket });
      results.push({ object, status: r.status, operationId: "operationId" in r ? r.operationId ?? null : null });
    } catch (error) {
      results.push(outcome(object, error));
    }
  }
  return results;
}

/** Restaura alvos explícitos (objetos com o original removido e cópia arquivada). */
export async function runRestore(input: { deps: ArchiveDeps; mode: "dry-run" | "apply"; targets: string[]; actor: string; reason: string }): Promise<RunResult[]> {
  const deps = input.mode === "dry-run" ? readOnlyDeps(input.deps) : input.deps;
  const results: RunResult[] = [];
  for (const object of input.targets) {
    const { bucket, path } = split(object);
    try {
      if (input.mode === "dry-run") {
        const row = await deps.readObject(bucket, path);
        const copy = row?.archive_bucket && row.archive_path ? await deps.storage.info(row.archive_bucket, row.archive_path) : null;
        const occupant = await deps.storage.info(bucket, path);
        results.push({ object, status: !row ? "fora_do_inventario" : row.archive_state !== "deleted" ? `nao_restauravel (${row.archive_state})`
          : !copy || copy.metadata?.sha256 !== row.archive_sha256 ? "copia_ausente_ou_divergente" : occupant ? "destino_ocupado" : "seria_restaurado" });
        continue;
      }
      const r = await restoreObject({ deps, bucket, path, actor: input.actor, reason: input.reason });
      results.push({ object, status: r.status, operationId: "operationId" in r ? r.operationId ?? null : null });
    } catch (error) {
      results.push(outcome(object, error));
    }
  }
  return results;
}

export type PendingArchiveOperation = { operation_id: string; operation: string; bucket: string | null; object_path: string | null };

/** Retoma operações de arquivo pendentes no banco, pela mesma chave (sem duplicar arquivo ou registro). */
export async function resumePending(input: { deps: ArchiveDeps; mode: "dry-run" | "apply"; pending: PendingArchiveOperation[]; actor: string; reason: string }): Promise<RunResult[]> {
  const deps = input.mode === "dry-run" ? readOnlyDeps(input.deps) : input.deps;
  const results: RunResult[] = [];
  for (const op of input.pending) {
    if (!op.bucket || !op.object_path) continue;
    const object = `${op.bucket}/${op.object_path}`;
    if (!["archive_copy", "archive_cancel", "restore_object", "delete_object"].includes(op.operation)) continue;
    if (op.operation === "delete_object") {
      results.push({ object, status: "pendente", operationId: op.operation_id, error: "remoção do original nunca é retomada automaticamente; revisão manual" });
      continue;
    }
    if (input.mode === "dry-run") { results.push({ object, status: `seria_retomado (${op.operation})`, operationId: op.operation_id }); continue; }
    try {
      const args = { deps, bucket: op.bucket, path: op.object_path, actor: input.actor, reason: input.reason };
      const r = op.operation === "archive_copy" ? await archiveObject(args) : op.operation === "archive_cancel" ? await cancelArchive(args) : await restoreObject(args);
      results.push({ object, status: r.status, operationId: op.operation_id });
    } catch (error) {
      results.push(outcome(object, error));
    }
  }
  return results;
}

/** Linha de log (JSONL) para um passo do executor. */
export function stepLine(step: ArchiveStep, at = new Date()) {
  return JSON.stringify({ at: at.toISOString(), ...step });
}

/**
 * fetch da simulação: só leituras saem do processo (GET/HEAD; POST apenas para listar o Storage e
 * para as RPCs da lista de leitura). Qualquer outra requisição lança WriteBlockedError sem ser enviada.
 */
export function readOnlyFetch(base: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = String(init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/)?.[1];
    const allowed = method === "GET" || method === "HEAD"
      || (method === "POST" && url.pathname.startsWith("/storage/v1/object/list/"))
      || (method === "POST" && rpc !== undefined && READ_ONLY_RPCS.has(rpc));
    if (!allowed) throw new WriteBlockedError(`${method} ${url.pathname}`);
    return base(input, init);
  }) as typeof fetch;
}

type StorageError = { message?: string; statusCode?: string | number; status?: number } | null;
type SupabaseArchiveClient = {
  from(table: string): { select(columns: string): unknown };
  storage: { from(bucket: string): {
    download(path: string): Promise<{ data: Blob | null; error: StorageError }>;
    upload(path: string, body: Uint8Array, options: { contentType: string; cacheControl: string; upsert: boolean; metadata: Record<string, string> }): Promise<{ error: StorageError }>;
    info(path: string): Promise<{ data: { size?: number | null; contentType?: string | null; metadata?: Record<string, unknown> | null } | null; error: StorageError }>;
    remove(paths: string[]): Promise<{ error: StorageError }>;
  } };
};
type Query = PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }> & {
  eq(column: string, value: string): Query; in(column: string, values: string[]): Query; order(column: string): Query; limit(n: number): Query;
};
const notFound = (error: StorageError) => /not.?found|404/i.test(`${error?.message ?? ""} ${error?.statusCode ?? ""} ${error?.status ?? ""}`);
const exists = (error: StorageError) => /already exists|duplicate|409/i.test(`${error?.message ?? ""} ${error?.statusCode ?? ""} ${error?.status ?? ""}`);
const LIFECYCLE_COLUMNS = "bucket, object_path, state, archive_state, sha256, size_bytes, mimetype, archive_bucket, archive_path, archive_sha256, restore_metadata, manual_protection, reference_count";

/** Dependências reais (service_role). Na simulação, o client já usa readOnlyFetch e as deps passam por readOnlyDeps. */
export function supabaseArchiveDeps(client: SupabaseArchiveClient, rpc: ArchiveDeps["rpc"], onStep?: ArchiveDeps["onStep"]): ArchiveDeps {
  return {
    rpc,
    onStep,
    async readObject(bucket, path) {
      const { data, error } = await (client.from("storage_object_lifecycle").select(LIFECYCLE_COLUMNS) as Query).eq("bucket", bucket).eq("object_path", path);
      if (error) throw new Error(`leitura do ciclo de vida: ${error.message}`);
      return ((data ?? [])[0] as unknown as LifecycleRow) ?? null;
    },
    storage: {
      async download(bucket, path) {
        const { data, error } = await client.storage.from(bucket).download(path);
        if (error) { if (notFound(error)) return null; throw new Error(`download de ${bucket}/${path}: ${error.message}`); }
        return new Uint8Array(await data!.arrayBuffer());
      },
      async upload(bucket, path, bytes, options) {
        const { error } = await client.storage.from(bucket).upload(path, bytes, { ...options, upsert: false });
        if (!error) return "created";
        if (exists(error)) return "exists";
        throw new Error(`upload em ${bucket}/${path}: ${error.message}`);
      },
      async info(bucket, path) {
        const { data, error } = await client.storage.from(bucket).info(path);
        if (error) { if (notFound(error)) return null; throw new Error(`info de ${bucket}/${path}: ${error.message}`); }
        return { size: data?.size ?? null, contentType: data?.contentType ?? null, metadata: data?.metadata ?? null };
      },
      async remove(bucket, path) {
        const { error } = await client.storage.from(bucket).remove([path]);
        if (error) throw new Error(`remoção de ${bucket}/${path}: ${error.message}`);
      },
    },
  };
}

/** Inventário, evidências e pendências de arquivo (somente leitura). */
export async function readArchiveState(client: SupabaseArchiveClient, rpc: ArchiveDeps["rpc"]) {
  const { data, error } = await (client.from("storage_object_lifecycle").select(LIFECYCLE_COLUMNS) as Query).order("object_path");
  if (error) throw new Error(`leitura do inventário: ${error.message}`);
  const rows = (data ?? []) as unknown as InventoryRow[];
  const evidence = new Map<string, Evidence>();
  for (const row of rows) {
    if (row.archive_state === "none" && (ARCHIVABLE_STATES as readonly string[]).includes(row.state) && row.reference_count === 0 && !row.manual_protection) {
      evidence.set(`${row.bucket}/${row.object_path}`, (await rpc("storage_lifecycle_evidence", { p_bucket: row.bucket, p_object_path: row.object_path })) as Evidence);
    }
  }
  const pendingQuery = await (client.from("storage_lifecycle_pending_operations").select("operation_id, operation, bucket, object_path") as Query)
    .in("operation", ["archive_copy", "archive_cancel", "delete_object", "restore_object"]);
  if (pendingQuery.error) throw new Error(`leitura das pendências: ${pendingQuery.error.message}`);
  return { rows, evidence, pending: (pendingQuery.data ?? []) as unknown as PendingArchiveOperation[] };
}

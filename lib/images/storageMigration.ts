// Núcleo da migração das imagens antigas do Storage para WebP (usado por
// scripts/migrate-storage-images.mjs). Recebe o cliente do Storage por parâmetro, o que
// permite testar tudo com um Storage simulado, sem rede.
//
// Garantias:
// - originais nunca são apagados, movidos nem sobrescritos (só uploads novos, upsert: false);
// - destino determinístico: "<pasta>/<base>.<hash>.webp" na mesma pasta do original;
// - idempotência: o mesmo conteúdo gera o mesmo nome e o reenvio reaproveita o arquivo;
// - integridade: o WebP é decodificado e conferido antes do envio, e o objeto enviado é
//   conferido na listagem (nome e tamanho) depois;
// - banner/avatar só são migrados quando o arquivo legado é a versão ativa; nenhum ponteiro
//   é gravado, então uma versão enviada pelo Admin nunca é substituída;
// - cada objeto devolve um registro (migrado, ignorado, erro), sem interromper os demais.

import { createHash } from "node:crypto";
import sharp from "sharp";
import { isImmutableImageName, safeImageBaseName } from "./naming.ts";
import { optimizeImage, type OptimizedImage } from "./optimizeImage.ts";
import type { ImagePresetName } from "./presets.ts";
import { uploadOptimizedImage, type StorageBucketApi } from "./storage.ts";
import {
  AVATAR_IMAGE_TARGET,
  bannerImageTarget,
  inspectActiveStoredImage,
  type FixedImageTarget,
  type PointerState,
  type StorageReader,
} from "./storedImages.ts";

/** O bucket de artes aceita até 10 MB (fileSizeLimit da criação do bucket). */
export const MIGRATION_MAX_INPUT_BYTES = 10 * 1024 * 1024;
const PAGE_SIZE = 1000;

type ListedObject = {
  name: string;
  id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  metadata?: { size?: number } | null;
};

type MigrationBucketApi = {
  list(
    path: string,
    options?: { limit?: number; offset?: number; search?: string; sortBy?: { column: string; order: string } }
  ): Promise<{ data: ListedObject[] | null; error: unknown }>;
  download(path: string): Promise<{ data: Blob | null; error: unknown }>;
  getPublicUrl(path: string): { data: { publicUrl: string } };
  upload: StorageBucketApi["upload"];
};

export type MigrationClient = { storage: { from(bucket: string): MigrationBucketApi } };

export type LegacyObject = {
  /** Identificador estável do objeto: "<bucket>/<caminho>". */
  key: string;
  bucket: string;
  path: string;
  preset: ImagePresetName;
  kind: "achievement" | "fixed";
  /** Banner/avatar: alvo de endereço fixo. */
  target?: FixedImageTarget;
};

export type MigrationStatus = "planned" | "migrated" | "preserved" | "skipped" | "error";

/**
 * Cópias leves locais (data/homeImageVariants.json): chave = URL exata usada pelo site,
 * valor = arquivo em public/. `exists` confere o arquivo no disco.
 */
export type LocalVariantIndex = {
  entriesFor(objectUrl: string): Array<{ key: string; variant: string; exists: boolean }>;
};

export function createLocalVariantIndex(
  variants: Record<string, string>,
  exists: (publicPath: string) => boolean
): LocalVariantIndex {
  const byBase = new Map<string, Array<{ key: string; variant: string; exists: boolean }>>();
  for (const [key, variant] of Object.entries(variants)) {
    if (!/^https?:\/\//.test(key)) continue;
    const base = key.split("?")[0];
    const list = byBase.get(base) ?? [];
    list.push({ key, variant, exists: exists(variant) });
    byBase.set(base, list);
  }
  return { entriesFor: (objectUrl) => byBase.get(objectUrl.split("?")[0]) ?? [] };
}

export type LocalVariantMatch = {
  /** preserved: correspondência exata confirmada; doubt: há cópia para este objeto, mas não confirmada. */
  status: "preserved" | "doubt";
  keys: string[];
  note: string;
};

/**
 * Correspondência exata com a cópia local, sem aproximação:
 * - arte de conquista: a URL do objeto (sem "?v=") é ela mesma uma chave do mapa;
 * - banner/avatar: a URL ativa (com o "?v=<updated_at>" atual) é exatamente uma chave do mapa;
 * - e, nos dois casos, o arquivo da cópia existe em public/.
 * Se há chaves para o objeto, mas nenhuma confirma, é "doubt": o objeto segue o fluxo normal e
 * o SQL não toca nas linhas que usam essas chaves exatas.
 */
export function matchLocalVariant(
  index: LocalVariantIndex | undefined,
  objectUrl: string,
  activeUrl?: string
): LocalVariantMatch | null {
  const entries = index?.entriesFor(objectUrl) ?? [];
  if (entries.length === 0) return null;
  const keys = entries.map((entry) => entry.key);
  const expected = activeUrl ?? objectUrl;
  const exact = entries.find((entry) => entry.key === expected);
  if (exact?.exists) {
    return { status: "preserved", keys, note: `já possui variante local ${exact.variant}` };
  }
  if (exact && !exact.exists) {
    return { status: "doubt", keys: [], note: `a variante ${exact.variant} está no mapa, mas o arquivo não existe` };
  }
  return {
    status: "doubt",
    keys: entries.filter((entry) => entry.exists).map((entry) => entry.key),
    note: activeUrl
      ? "a variante local é de outra versão desta imagem (o ?v= não confere com a versão ativa)"
      : "só há variante local para uma URL versionada (?v=); não confirmada para o objeto",
  };
}

export type MigrationRecord = {
  key: string;
  bucket: string;
  path: string;
  /** "group": registro de uma pasta que não pôde ser listada. */
  kind: LegacyObject["kind"] | "group";
  status: MigrationStatus;
  reason?: string;
  oldUrl?: string;
  newPath?: string;
  newUrl?: string;
  deduplicated?: boolean;
  /** Banner/avatar: estado do ponteiro de ativação. */
  pointerState?: PointerState;
  /** Cópia local: preservada (excluída da migração) ou dúvida registrada para revisão. */
  localVariant?: LocalVariantMatch;
  originalBytes?: number;
  optimizedBytes?: number;
  reductionPercent?: number;
  size?: string;
};

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return String(error);
}

async function listAll(api: MigrationBucketApi, folder: string) {
  const all: ListedObject[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await api.list(folder, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`${folder}: ${errorMessage(error)}`);
    const page = data ?? [];
    all.push(...page);
    if (page.length < PAGE_SIZE) return all;
  }
}

const isFile = (entry: ListedObject) => Boolean(entry.id);
const isFolder = (entry: ListedObject) => !entry.id && Boolean(entry.name);
const isLegacyImageName = (name: string) => /\.(png|jpe?g|webp)$/i.test(name) && !isImmutableImageName(name);

/** Erro de leitura de um grupo (pasta) do Storage, registrado sem interromper os demais. */
function groupError(bucket: string, folder: string, error: unknown): MigrationRecord {
  return {
    key: `${bucket}/${folder}/`,
    bucket,
    path: folder,
    kind: "group",
    status: "error",
    reason: `falha ao listar: ${errorMessage(error)}`,
  };
}

/**
 * Lista os objetos legados a migrar, em ordem estável. Só leitura.
 * Falha ao listar uma pasta vira um registro de erro daquela pasta; as demais continuam.
 */
export async function scanLegacyObjects(client: MigrationClient): Promise<{ objects: LegacyObject[]; errors: MigrationRecord[] }> {
  const objects: LegacyObject[] = [];
  const errors: MigrationRecord[] = [];
  const tryList = async (api: MigrationBucketApi, bucket: string, folder: string) => {
    try {
      return await listAll(api, folder);
    } catch (error) {
      errors.push(groupError(bucket, folder, error));
      return null;
    }
  };

  const art = client.storage.from("achievement-art");
  for (const game of ((await tryList(art, "achievement-art", "games")) ?? []).filter(isFolder)) {
    const folder = `games/${game.name}/achievements`;
    for (const file of ((await tryList(art, "achievement-art", folder)) ?? []).filter(isFile)) {
      if (!isLegacyImageName(file.name)) continue;
      const path = `${folder}/${file.name}`;
      objects.push({ key: `achievement-art/${path}`, bucket: "achievement-art", path, preset: "achievement", kind: "achievement" });
    }
  }

  const banners = client.storage.from("site-banners");
  for (const banner of ((await tryList(banners, "site-banners", "banners")) ?? []).filter(isFolder)) {
    const target = bannerImageTarget(banner.name);
    const files = await tryList(banners, "site-banners", target.folder);
    if (files?.some((file) => isFile(file) && file.name === target.baseName)) {
      const path = `${target.folder}/${target.baseName}`;
      objects.push({ key: `site-banners/${path}`, bucket: "site-banners", path, preset: "banner", kind: "fixed", target });
    }
  }

  const profile = client.storage.from(AVATAR_IMAGE_TARGET.bucket);
  const profileFiles = await tryList(profile, AVATAR_IMAGE_TARGET.bucket, AVATAR_IMAGE_TARGET.folder);
  if (profileFiles?.some((file) => isFile(file) && file.name === AVATAR_IMAGE_TARGET.baseName)) {
    const path = `${AVATAR_IMAGE_TARGET.folder}/${AVATAR_IMAGE_TARGET.baseName}`;
    objects.push({
      key: `${AVATAR_IMAGE_TARGET.bucket}/${path}`,
      bucket: AVATAR_IMAGE_TARGET.bucket,
      path,
      preset: "avatar",
      kind: "fixed",
      target: AVATAR_IMAGE_TARGET,
    });
  }

  return { objects, errors };
}

/** Só os objetos; lança se alguma pasta não pôde ser listada. */
export async function collectLegacyObjects(client: MigrationClient): Promise<LegacyObject[]> {
  const { objects, errors } = await scanLegacyObjects(client);
  if (errors.length > 0) throw new Error(errors.map((error) => `${error.key}: ${error.reason}`).join("; "));
  return objects;
}

/** Confere o WebP gerado antes de enviar: decodifica, formato, dimensões e hash. */
export async function verifyOptimizedImage(image: OptimizedImage) {
  const hash = createHash("sha256").update(image.buffer).digest("hex");
  if (hash !== image.contentHash) throw new Error("hash do WebP não confere");
  if (image.buffer.byteLength !== image.optimizedBytes) throw new Error("tamanho do WebP não confere");
  const meta = await sharp(image.buffer).metadata();
  if (meta.format !== "webp") throw new Error(`formato inesperado: ${meta.format}`);
  if (meta.width !== image.width || meta.height !== image.height) throw new Error("dimensões do WebP não conferem");
  if ((meta.pages ?? 1) > 1) throw new Error("WebP animado inesperado");
}

/** Confere, depois do envio, que o objeto existe no Storage com o tamanho esperado. */
async function verifyUploadedObject(api: MigrationBucketApi, path: string, expectedBytes: number) {
  const folder = path.split("/").slice(0, -1).join("/");
  const name = path.split("/").pop()!;
  const { data, error } = await api.list(folder, { limit: 100, search: name });
  if (error) throw new Error(`não foi possível conferir o envio: ${errorMessage(error)}`);
  const entry = (data ?? []).find((item) => item.name === name);
  if (!entry) throw new Error("objeto enviado não aparece no Storage");
  const size = entry.metadata?.size;
  if (typeof size === "number" && size !== expectedBytes) {
    throw new Error(`tamanho no Storage (${size}) difere do enviado (${expectedBytes})`);
  }
}

const POINTER_LABEL: Record<PointerState, string> = {
  valid: "ponteiro válido",
  absent: "sem ponteiro",
  invalid: "ponteiro inválido",
  "missing-file": "ponteiro aponta para arquivo inexistente",
  unreadable: "ponteiro ilegível (erro de leitura)",
  unverified: "ponteiro não conferido (listagem indisponível)",
};

/**
 * Banner/avatar: decide antes de qualquer download.
 * - Falha ao ler a pasta ou o ponteiro → erro (nunca "ignorado").
 * - Ponteiro válido → ignorado (a versão ativa já é um WebP enviado pelo Admin).
 * - Sem ponteiro utilizável → só migra se o arquivo legado for exatamente a versão ativa.
 */
async function fixedImageDecision(client: MigrationClient, item: LegacyObject) {
  const inspection = await inspectActiveStoredImage(client as unknown as StorageReader, item.target!);
  const pointerState = inspection.pointerState;
  const label = POINTER_LABEL[pointerState];
  if (inspection.listingError) {
    return { pointerState, activeUrl: undefined, error: `${label}; falha ao listar a pasta: ${inspection.listingError}` };
  }
  if (pointerState === "unreadable") return { pointerState, activeUrl: undefined, error: label };
  if (pointerState === "valid") return { pointerState, activeUrl: inspection.active.url, skip: `${label}: já existe versão ativa enviada pelo Admin` };
  if (inspection.active.source === "none") return { pointerState, activeUrl: undefined, skip: `${label}; nenhuma versão ativa na pasta` };
  const legacyUrl = client.storage.from(item.bucket).getPublicUrl(item.path).data.publicUrl;
  if (inspection.active.url.split("?")[0] !== legacyUrl) {
    return { pointerState, activeUrl: inspection.active.url, skip: `${label}; outra versão mais recente já está ativa` };
  }
  return { pointerState, activeUrl: inspection.active.url, note: label };
}

/**
 * Processa um objeto. Nunca lança: qualquer falha vira um registro "error".
 * Sem `apply`, só baixa e mede (registro "planned").
 * Com cópia local confirmada (`localVariants`), o objeto é "preserved": nada é baixado nem enviado.
 */
export async function migrateObject(
  client: MigrationClient,
  item: LegacyObject,
  options: { apply: boolean; maxInputBytes?: number; localVariants?: LocalVariantIndex }
): Promise<MigrationRecord> {
  const api = client.storage.from(item.bucket);
  let base: MigrationRecord = {
    key: item.key,
    bucket: item.bucket,
    path: item.path,
    kind: item.kind,
    status: "error",
    oldUrl: api.getPublicUrl(item.path).data.publicUrl,
  };

  try {
    let activeUrl: string | undefined;
    if (item.kind === "fixed") {
      const decision = await fixedImageDecision(client, item);
      base = { ...base, pointerState: decision.pointerState };
      if (decision.error) return { ...base, status: "error", reason: decision.error };
      if (decision.skip) return { ...base, status: "skipped", reason: decision.skip };
      activeUrl = decision.activeUrl;
    }

    // Cópia local confirmada: preservada, sem download, conversão, envio ou SQL.
    const localVariant = matchLocalVariant(options.localVariants, base.oldUrl!, activeUrl);
    if (localVariant) base = { ...base, localVariant };
    if (localVariant?.status === "preserved") {
      return { ...base, status: "preserved", reason: `preservada: ${localVariant.note}` };
    }

    const { data: blob, error } = await api.download(item.path);
    if (error || !blob) return { ...base, reason: `download: ${errorMessage(error ?? "vazio")}` };

    const optimized = await optimizeImage({
      bytes: new Uint8Array(await blob.arrayBuffer()),
      preset: item.preset,
      maxInputBytes: options.maxInputBytes ?? MIGRATION_MAX_INPUT_BYTES,
    });
    await verifyOptimizedImage(optimized);

    const measured: MigrationRecord = {
      ...base,
      reason: localVariant ? `revisar: ${localVariant.note}` : undefined,
      originalBytes: optimized.originalBytes,
      optimizedBytes: optimized.optimizedBytes,
      reductionPercent: optimized.reductionPercent,
      size: `${optimized.originalWidth}x${optimized.originalHeight} -> ${optimized.width}x${optimized.height}`,
    };
    if (!options.apply) return { ...measured, status: "planned" };

    const directory = item.path.split("/").slice(0, -1).join("/");
    const baseName = item.target?.baseName ?? safeImageBaseName(item.path.split("/").pop()!, "conquista");
    const stored = await uploadOptimizedImage(api, directory, baseName, optimized);
    await verifyUploadedObject(api, stored.path, optimized.optimizedBytes);

    return {
      ...measured,
      status: "migrated",
      newPath: stored.path,
      newUrl: stored.publicUrl,
      deduplicated: stored.deduplicated,
    };
  } catch (error) {
    return { ...base, status: "error", reason: errorMessage(error) };
  }
}

/** Último registro por objeto, a partir do histórico (JSONL) de execuções anteriores. */
export function latestRecords(records: MigrationRecord[]) {
  const latest = new Map<string, MigrationRecord>();
  for (const record of records) latest.set(record.key, record);
  return latest;
}

export function sqlLiteral(value: string) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Padrão LIKE "começa com <prefix>": escapa \, % e _ do prefixo (usar com ESCAPE '\'). */
export function likePrefixLiteral(prefix: string) {
  return sqlLiteral(prefix.replace(/[\\%_]/g, (char) => `\\${char}`) + "%");
}

const TABLES = [
  { table: "public.achievements", name: "achievements", column: "image" },
  { table: "public.achievement_progress", name: "achievement_progress", column: "image_override" },
] as const;

/**
 * SQL para revisão manual (o script nunca executa). Só artes de conquista precisam de SQL:
 * banner e avatar trocam de versão pela leitura da pasta.
 * - Grava o valor atual de cada linha afetada numa tabela de backup antes de atualizar.
 * - Atualiza a URL exata e as variantes "?v=..." gravadas pelos envios antigos.
 * - Pode ser aplicado mais de uma vez sem efeito extra.
 * O SQL de reversão só restaura linhas que ainda estão com a URL nova.
 */
export function buildMigrationSql(records: MigrationRecord[], runId: string) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(runId)) throw new Error("runId inválido");
  // "preserved" nunca entra (status diferente de "migrated"); a checagem extra é defensiva.
  const migrated = records
    .filter(
      (record) =>
        record.status === "migrated" &&
        record.kind === "achievement" &&
        record.oldUrl &&
        record.newUrl &&
        record.localVariant?.status !== "preserved"
    )
    .sort((left, right) => left.key.localeCompare(right.key));

  const header = [
    "-- Gerado por scripts/migrate-storage-images.mjs. REVISAR antes de aplicar; o script não executa SQL.",
    `-- Execução: ${runId} · ${migrated.length} artes de conquista.`,
    "-- Depois de aplicar, o site passa a usar as URLs novas em até 60 s (cache do catálogo).",
    "-- Os arquivos originais continuam no Storage: as URLs antigas seguem funcionando.",
  ];

  const apply = [
    ...header,
    "begin;",
    "create table if not exists public.image_migration_backup (",
    "  run_id text not null,",
    "  table_name text not null,",
    "  row_id uuid not null,",
    "  column_name text not null,",
    "  old_value text,",
    "  new_value text not null,",
    "  saved_at timestamptz not null default now(),",
    "  primary key (run_id, table_name, row_id, column_name)",
    ");",
  ];
  const rollback = [
    "-- Reversão da migração de imagens. Só restaura linhas que ainda têm a URL nova.",
    `-- Execução: ${runId}.`,
    "begin;",
  ];

  for (const record of migrated) {
    apply.push(`-- ${record.key} -> ${record.newPath}`);
    for (const { table, name, column } of TABLES) {
      // Linhas que usam exatamente uma URL com cópia local (dúvida registrada) ficam como estão.
      const keep = record.localVariant?.status === "doubt" ? record.localVariant.keys : [];
      const keepClause = keep.length > 0 ? ` and ${column} not in (${keep.map(sqlLiteral).join(", ")})` : "";
      const match = `(${column} = ${sqlLiteral(record.oldUrl!)} or ${column} like ${likePrefixLiteral(record.oldUrl! + "?v=")} escape '\\')${keepClause}`;
      apply.push(
        `insert into public.image_migration_backup (run_id, table_name, row_id, column_name, old_value, new_value) ` +
          `select ${sqlLiteral(runId)}, ${sqlLiteral(name)}, id, ${sqlLiteral(column)}, ${column}, ${sqlLiteral(record.newUrl!)} ` +
          `from ${table} where ${match} on conflict do nothing;`,
        `update ${table} set ${column} = ${sqlLiteral(record.newUrl!)} where ${match};`
      );
    }
  }

  for (const { table, name, column } of TABLES) {
    rollback.push(
      `update ${table} as t set ${column} = b.old_value from public.image_migration_backup as b ` +
        `where b.run_id = ${sqlLiteral(runId)} and b.table_name = ${sqlLiteral(name)} and b.column_name = ${sqlLiteral(column)} ` +
        `and t.id = b.row_id and t.${column} = b.new_value;`
    );
  }

  apply.push(
    "-- Conferência (só leitura): artes de conquista que ainda apontam para PNG/JPG no Storage.",
    "select id, game_slug, image from public.achievements where image like '%/achievement-art/%' and image !~ '\\.[0-9a-f]{16}\\.webp$';",
    "commit;",
    ""
  );
  rollback.push("commit;", "");

  return { sql: apply.join("\n"), rollbackSql: rollback.join("\n"), count: migrated.length };
}

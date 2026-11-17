// Coletor SOMENTE LEITURA das fontes reais do ciclo de vida das imagens.
// Recebe o acesso ao Storage e ao banco por parâmetro (testável sem rede) e devolve as fontes
// normalizadas e o inventário para o classificador. Nunca baixa imagens: só lista objetos
// (metadados) e baixa JSON pequenos (ponteiros e rascunhos) dentro de limites explícitos.

import { isValidActiveFile, AVATAR_IMAGE_TARGET, bannerImageTarget, type FixedImageTarget } from "../storedImages.ts";
import {
  referencesFromAchievements,
  referencesFromDrafts,
  referencesFromGames,
  referencesFromJourneyEntries,
  referencesFromJourneyHistory,
  referencesFromPointers,
  referencesFromProgress,
  type PointerReading,
  type SourceResult,
} from "./references.ts";
import type { InventorySnapshot, StorageObjectInfo } from "./classify.ts";

/**
 * Buckets inventariados (todos os objetos listados; só os que são imagem pelo tipo ou extensão
 * entram na classificação). `game-images` não é usado pelo código atual, mas existe no projeto
 * desde 19/07/2026 com artes antigas: entra no inventário para não ficar fora da contagem.
 */
export const IMAGE_BUCKETS = ["achievement-art", "site-banners", "site-profile", "game-images"] as const;
export const DRAFT_BUCKETS = ["achievement-preparation-drafts", "game-review-drafts"] as const;
export const POINTER_BUCKET = "site-profile";
export const POINTER_FOLDER = "active";

export const TABLES = {
  achievements: { columns: "id, image, official_image", orderBy: "id" },
  achievement_progress: { columns: "id, image_override", orderBy: "id" },
  games: { columns: "slug, image, card_image, final_badge, emblem, trophies, review", orderBy: "slug" },
  // Fontes acrescentadas em 15/11/2026: não estavam na baseline scan-20261114T225139Z.
  journey_entries: { columns: "id, tags", orderBy: "id" },
  journey_history_events: { columns: "id, metadata", orderBy: "id" },
} as const;

export const DEFAULT_LIMITS = {
  pageSize: 1000,
  maxJsonBytes: 2 * 1024 * 1024,
  maxTotalJsonBytes: 10 * 1024 * 1024,
  maxDepth: 20,
};

type ListEntry = {
  name: string;
  id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  metadata?: { size?: number; mimetype?: string } | null;
};

export type LifecycleStorage = {
  listBuckets(): Promise<{ data: Array<{ name: string }> | null; error: unknown }>;
  from(bucket: string): {
    list(path: string, options: { limit: number; offset: number; sortBy: { column: string; order: string } }): Promise<{ data: ListEntry[] | null; error: unknown }>;
    download(path: string): Promise<{ data: Blob | null; error: unknown }>;
  };
};

/** Uma página de SELECT: deve devolver a contagem exata total para conferir a paginação. */
export type SelectPage = (
  table: keyof typeof TABLES,
  columns: string,
  orderBy: string,
  from: number,
  to: number
) => Promise<{ data: Array<Record<string, unknown>> | null; error: unknown; count: number | null }>;

export type ScanCounters = {
  listCalls: number;
  listedEntries: number;
  tablePages: number;
  tableRows: number;
  jsonFilesDownloaded: number;
  jsonBytesDownloaded: number;
  /** Tem que terminar em zero: o coletor nunca baixa imagens. */
  imageDownloads: number;
  /** Tamanho aproximado das respostas de listagem e SELECT (JSON serializado). */
  approxMetadataBytes: number;
};

export type ScanIssue = { kind: string; where: string; detail: string };

export type StoredObject = StorageObjectInfo & { mimetype?: string | null; isImage: boolean };

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : String(error);

export const isImageObject = (name: string, mimetype?: string | null) =>
  (mimetype ?? "").startsWith("image/") || /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(name);

export function newCounters(): ScanCounters {
  return { listCalls: 0, listedEntries: 0, tablePages: 0, tableRows: 0, jsonFilesDownloaded: 0, jsonBytesDownloaded: 0, imageDownloads: 0, approxMetadataBytes: 0 };
}

/** Lista recursivamente um bucket, com paginação. Pastas que falham ficam registradas. */
export async function listBucketTree(storage: LifecycleStorage, bucket: string, counters: ScanCounters, limits = DEFAULT_LIMITS) {
  const objects: StoredObject[] = [];
  const failedPrefixes: string[] = [];
  const api = storage.from(bucket);

  const walk = async (prefix: string, depth: number): Promise<void> => {
    if (depth > limits.maxDepth) {
      failedPrefixes.push(`${bucket}/${prefix}`);
      return;
    }
    const folders: string[] = [];
    for (let offset = 0; ; offset += limits.pageSize) {
      counters.listCalls += 1;
      let page: { data: ListEntry[] | null; error: unknown };
      try {
        page = await api.list(prefix, { limit: limits.pageSize, offset, sortBy: { column: "name", order: "asc" } });
      } catch (error) {
        page = { data: null, error };
      }
      if (page.error || !Array.isArray(page.data)) {
        failedPrefixes.push(prefix ? `${bucket}/${prefix}` : bucket);
        return;
      }
      counters.listedEntries += page.data.length;
      counters.approxMetadataBytes += JSON.stringify(page.data).length;
      for (const entry of page.data) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (!entry.id && !entry.metadata) folders.push(path);
        else
          objects.push({
            bucket,
            path,
            size: entry.metadata?.size ?? null,
            mimetype: entry.metadata?.mimetype ?? null,
            createdAt: entry.created_at ?? null,
            updatedAt: entry.updated_at ?? null,
            sha256: null,
            isImage: isImageObject(entry.name, entry.metadata?.mimetype),
          });
      }
      if (page.data.length < limits.pageSize) break;
    }
    for (const folder of folders) await walk(folder, depth + 1);
  };

  await walk("", 0);
  return { objects, failedPrefixes };
}

/** Lê uma tabela inteira com paginação explícita e confere com a contagem exata do banco. */
export async function readAllRows(selectPage: SelectPage, table: keyof typeof TABLES, counters: ScanCounters, limits = DEFAULT_LIMITS) {
  const { columns, orderBy } = TABLES[table];
  const rows: Array<Record<string, unknown>> = [];
  let expected: number | null = null;
  for (let from = 0; ; from += limits.pageSize) {
    counters.tablePages += 1;
    let page: Awaited<ReturnType<SelectPage>>;
    try {
      page = await selectPage(table, columns, orderBy, from, from + limits.pageSize - 1);
    } catch (error) {
      return { rows, error: `página a partir de ${from}: ${errorText(error)}` };
    }
    if (page.error || !Array.isArray(page.data)) return { rows, error: `página a partir de ${from}: ${errorText(page.error ?? "sem dados")}` };
    if (typeof page.count !== "number") return { rows, error: "contagem exata indisponível" };
    expected ??= page.count;
    if (page.count !== expected) return { rows, error: `contagem mudou durante a leitura (${expected} → ${page.count})` };
    rows.push(...page.data);
    counters.tableRows += page.data.length;
    counters.approxMetadataBytes += JSON.stringify(page.data).length;
    if (page.data.length < limits.pageSize || rows.length >= expected) break;
  }
  if (rows.length !== expected) return { rows, error: `linhas lidas (${rows.length}) diferentes da contagem (${expected})` };
  return { rows, error: undefined as string | undefined };
}

async function downloadJson(storage: LifecycleStorage, bucket: string, path: string, counters: ScanCounters) {
  if (!/\.json$/i.test(path)) throw new Error("download recusado: não é JSON");
  const { data, error } = await storage.from(bucket).download(path);
  if (error || !data) return { text: null as string | null, error: errorText(error ?? "vazio"), notFound: /not.?found|404/i.test(errorText(error ?? "")) };
  const text = await data.text();
  counters.jsonFilesDownloaded += 1;
  counters.jsonBytesDownloaded += Buffer.byteLength(text);
  return { text, error: undefined as string | undefined, notFound: false };
}

/** Rascunhos privados: só JSON, até 2 MB cada e 10 MB no total. Guarda só as referências. */
export async function readDraftSources(
  storage: LifecycleStorage,
  existingBuckets: Set<string>,
  counters: ScanCounters,
  issues: ScanIssue[],
  limits = DEFAULT_LIMITS
): Promise<SourceResult> {
  const documents: Array<{ bucket: string; path: string; content: unknown }> = [];
  let incomplete = false;
  let total = 0;
  for (const bucket of DRAFT_BUCKETS) {
    if (!existingBuckets.has(bucket)) {
      issues.push({ kind: "fonte não localizada", where: bucket, detail: "bucket de rascunhos não existe" });
      incomplete = true;
      continue;
    }
    const { objects, failedPrefixes } = await listBucketTree(storage, bucket, counters, limits);
    for (const prefix of failedPrefixes) issues.push({ kind: "pasta não listada", where: prefix, detail: "listagem falhou" });
    if (failedPrefixes.length > 0) incomplete = true;
    for (const object of objects) {
      if (!/\.json$/i.test(object.path)) {
        issues.push({ kind: "rascunho ignorado", where: `${bucket}/${object.path}`, detail: "não é JSON (não baixado)" });
        incomplete = true;
        continue;
      }
      const size = object.size ?? Number.POSITIVE_INFINITY;
      if (size > limits.maxJsonBytes) {
        issues.push({ kind: "JSON acima do limite", where: `${bucket}/${object.path}`, detail: `${size} bytes > ${limits.maxJsonBytes}` });
        incomplete = true;
        continue;
      }
      if (total + size > limits.maxTotalJsonBytes) {
        issues.push({ kind: "limite total de JSON", where: `${bucket}/${object.path}`, detail: `total passaria de ${limits.maxTotalJsonBytes} bytes` });
        incomplete = true;
        continue;
      }
      total += size;
      const result = await downloadJson(storage, bucket, object.path, counters);
      if (result.error || result.text === null) {
        issues.push({ kind: "JSON não baixado", where: `${bucket}/${object.path}`, detail: result.error ?? "vazio" });
        incomplete = true;
        continue;
      }
      documents.push({ bucket, path: object.path, content: result.text });
    }
  }
  const source = referencesFromDrafts(documents);
  for (const item of source.unparsed ?? []) issues.push({ kind: "JSON ilegível", where: item.split(":")[1] ?? item, detail: item });
  // Texto completo descartado: só as referências seguem adiante.
  documents.length = 0;
  return incomplete ? { ...source, status: source.status === "failed" ? "failed" : "partial" } : source;
}

/** Banners e avatar presentes no inventário (pastas reais, não presumidas). */
export function fixedTargetsFromInventory(objects: StoredObject[]): FixedImageTarget[] {
  const targets = new Map<string, FixedImageTarget>();
  for (const object of objects) {
    const parts = object.path.split("/");
    if (object.bucket === "site-banners" && parts.length === 3 && parts[0] === "banners") {
      targets.set(`banner-${parts[1]}`, bannerImageTarget(parts[1]));
    }
    if (object.bucket === AVATAR_IMAGE_TARGET.bucket && parts.length === 2 && parts[0] === AVATAR_IMAGE_TARGET.folder && object.isImage) {
      targets.set("avatar", AVATAR_IMAGE_TARGET);
    }
  }
  return [...targets.values()];
}

/**
 * Ponteiros: lista a pasta `active/` (sem download para os ausentes) e baixa só os existentes.
 * Falha na listagem torna todos os ponteiros ilegíveis (fonte incompleta, nunca vazia).
 */
export async function readPointerSource(
  storage: LifecycleStorage,
  targets: FixedImageTarget[],
  pointerFiles: StoredObject[] | null,
  counters: ScanCounters,
  issues: ScanIssue[]
): Promise<{ source: SourceResult; readings: PointerReading[] }> {
  if (pointerFiles === null) {
    issues.push({ kind: "ponteiros ilegíveis", where: `${POINTER_BUCKET}/${POINTER_FOLDER}`, detail: "listagem falhou" });
    const readings = targets.map((target): PointerReading => ({ target, state: "unreadable", error: "listagem falhou" }));
    return { source: referencesFromPointers(readings), readings };
  }
  const names = new Set(pointerFiles.map((object) => object.path.split("/").pop()));
  const readings: PointerReading[] = [];
  for (const target of targets) {
    const file = `${target.pointer}.json`;
    if (!names.has(file)) {
      readings.push({ target, state: "absent" });
      continue;
    }
    const result = await downloadJson(storage, POINTER_BUCKET, `${POINTER_FOLDER}/${file}`, counters);
    if (result.error || result.text === null) {
      readings.push({ target, state: "unreadable", error: result.error });
      continue;
    }
    try {
      const parsed = JSON.parse(result.text) as { file?: unknown };
      readings.push(
        isValidActiveFile(target, parsed.file) ? { target, state: "present", file: parsed.file } : { target, state: "invalid", error: "arquivo fora do formato" }
      );
    } catch {
      readings.push({ target, state: "invalid", error: "JSON ilegível" });
    }
  }
  for (const reading of readings) {
    if (reading.state === "invalid" || reading.state === "unreadable") {
      issues.push({ kind: "ponteiro inválido", where: reading.target.pointer, detail: reading.error ?? reading.state });
    }
  }
  return { source: referencesFromPointers(readings), readings };
}

export type CollectedSources = {
  existingBuckets: string[];
  inventory: InventorySnapshot;
  nonImageObjects: StoredObject[];
  allImageObjects: StoredObject[];
  sources: SourceResult[];
  pointerReadings: PointerReading[];
  tableCounts: Record<string, number | null>;
  issues: ScanIssue[];
  counters: ScanCounters;
};

/** Junta todas as leituras remotas (somente leitura). Arquivos locais entram pelo chamador. */
export async function collectRemoteSources(storage: LifecycleStorage, selectPage: SelectPage, limits = DEFAULT_LIMITS): Promise<CollectedSources> {
  const counters = newCounters();
  const issues: ScanIssue[] = [];

  const buckets = await storage.listBuckets().catch((error: unknown) => ({ data: null, error }));
  const bucketsKnown = !buckets.error && Array.isArray(buckets.data);
  if (!bucketsKnown) issues.push({ kind: "buckets inacessíveis", where: "listBuckets", detail: errorText(buckets.error ?? "sem dados") });
  const existing = new Set((buckets.data ?? []).map((bucket) => bucket.name));

  // Inventário dos buckets de imagens.
  const objects: StoredObject[] = [];
  const failedPrefixes: string[] = [];
  for (const bucket of IMAGE_BUCKETS) {
    if (bucketsKnown && !existing.has(bucket)) {
      issues.push({ kind: "bucket inacessível", where: bucket, detail: "não encontrado em listBuckets" });
      failedPrefixes.push(bucket);
      continue;
    }
    const listed = await listBucketTree(storage, bucket, counters, limits);
    objects.push(...listed.objects);
    for (const prefix of listed.failedPrefixes) {
      issues.push({ kind: "pasta não listada", where: prefix, detail: "listagem falhou" });
      failedPrefixes.push(prefix);
    }
  }
  // Bucket que existe mas não está coberto pela varredura: o inventário não é completo.
  const covered = new Set<string>([...IMAGE_BUCKETS, ...DRAFT_BUCKETS]);
  for (const bucket of existing) {
    if (covered.has(bucket)) continue;
    issues.push({ kind: "bucket não coberto", where: bucket, detail: "existe no projeto, mas não foi inventariado" });
    failedPrefixes.push(bucket);
  }
  const imageObjects = objects.filter((object) => object.isImage);
  const nonImageObjects = objects.filter((object) => !object.isImage);
  const inventory: InventorySnapshot = {
    status: bucketsKnown && failedPrefixes.length === 0 ? "complete" : "partial",
    objects: imageObjects,
    failedPrefixes,
  };

  // Banco: três tabelas inteiras.
  const tableCounts: Record<string, number | null> = {};
  const tableSource = async (table: keyof typeof TABLES) => {
    const { rows, error } = await readAllRows(selectPage, table, counters, limits);
    tableCounts[table] = error ? null : rows.length;
    if (error) issues.push({ kind: "consulta incompleta", where: `public.${table}`, detail: error });
    return { rows, error };
  };
  const achievements = await tableSource("achievements");
  const progress = await tableSource("achievement_progress");
  const games = await tableSource("games");
  const journeyEntries = await tableSource("journey_entries");
  const journeyHistory = await tableSource("journey_history_events");
  // Caminhos relativos valem para qualquer bucket existente (não só os inventariados).
  const relativeBuckets = bucketsKnown ? [...existing].sort() : [...IMAGE_BUCKETS, ...DRAFT_BUCKETS];
  const sources: SourceResult[] = [
    referencesFromAchievements(achievements.rows as Array<{ id: string }>, achievements.error),
    referencesFromProgress(progress.rows as Array<{ id: string }>, progress.error),
    referencesFromGames(games.rows, games.error),
    referencesFromJourneyEntries(journeyEntries.rows as Array<{ id: string }>, journeyEntries.error, relativeBuckets),
    referencesFromJourneyHistory(journeyHistory.rows as Array<{ id: string }>, journeyHistory.error, relativeBuckets),
  ];
  for (const source of sources) {
    for (const item of source.unparsed ?? []) issues.push({ kind: "valor não interpretado", where: source.source, detail: item });
  }

  // Ponteiros (pasta active/ do site-profile) e rascunhos.
  const pointerFiles = failedPrefixes.some((prefix) => prefix === POINTER_BUCKET || prefix.startsWith(`${POINTER_BUCKET}/${POINTER_FOLDER}`))
    ? null
    : nonImageObjects.filter((object) => object.bucket === POINTER_BUCKET && object.path.startsWith(`${POINTER_FOLDER}/`));
  const pointers = await readPointerSource(storage, fixedTargetsFromInventory(imageObjects), pointerFiles, counters, issues);
  sources.push(pointers.source);
  sources.push(await readDraftSources(storage, bucketsKnown ? existing : new Set(), counters, issues, limits));

  return {
    existingBuckets: [...existing].sort(),
    inventory,
    nonImageObjects,
    allImageObjects: imageObjects,
    sources,
    pointerReadings: pointers.readings,
    tableCounts,
    issues,
    counters,
  };
}

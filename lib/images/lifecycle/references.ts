// Normalização das referências a imagens do Supabase Storage, vindas de fontes diferentes
// (banco, JSON de jogos, ponteiros, rascunhos, mapa local de cópias, proteção manual).
// Tudo aqui é puro: recebe dados já lidos e devolve referências no formato "<bucket>/<caminho>".
// Nenhuma função acessa rede, banco ou Storage.

import { isValidActiveFile, type FixedImageTarget } from "../storedImages.ts";

/** Fontes que precisam estar completas para que um objeto possa virar candidato. */
export const REFERENCE_SOURCES = [
  "achievements",
  "achievement_progress",
  "games",
  "journey_entries",
  "journey_history_events",
  "pointers",
  "drafts",
  "variant_map",
  "protection",
] as const;

export type ReferenceSourceName = (typeof REFERENCE_SOURCES)[number];

export type ImageReference = {
  /** Identidade do objeto: "<bucket>/<caminho>", sem domínio, sem "?v=" e decodificado. */
  objectKey: string;
  source: ReferenceSourceName;
  /** Onde a referência foi encontrada (ex.: "achievements:<id>.image"). */
  location: string;
  /** Valor original, para auditoria. */
  raw: string;
};

export type SourceResult = {
  source: ReferenceSourceName;
  /** "complete": lida inteira e interpretada. Qualquer outro valor bloqueia candidatos. */
  status: "complete" | "partial" | "failed";
  references: ImageReference[];
  error?: string;
  /** Valores que pareciam referências mas não puderam ser interpretados. */
  unparsed?: string[];
};

// O caminho vai até o fim do texto ou até "?"/"#". Espaço cru, aspas ou outro texto depois do
// caminho tornam a referência ininterpretável (null): truncar apontaria para OUTRO objeto.
// A mesma regra está em storage_lifecycle_object_key (SQL); os casos ficam em
// tests/fixtures/storage-object-keys.json e são conferidos nos dois lados.
const OBJECT_PATH = /\/storage\/v1\/(?:object|render\/image)\/(?:public|sign|authenticated)\/([^?#\s"']+)(?:[?#][\s\S]*)?$/;
/** Caracteres de controle no caminho decodificado (ex.: %00, %0A): caminho inválido. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Converte uma URL do Storage (pública, assinada ou de transformação, com ou sem "?v=")
 * em "<bucket>/<caminho>". Devolve null para o que não é objeto do Storage.
 * Também aceita a chave já normalizada ("<bucket>/<caminho>") quando `knownBuckets` a reconhece.
 */
export function objectKeyFromReference(value: unknown, knownBuckets?: readonly string[]): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;

  const match = text.match(OBJECT_PATH);
  let candidate: string | null = match ? match[1] : null;
  if (!candidate && knownBuckets && !/^[a-z]+:\/\//i.test(text) && !text.startsWith("/")) {
    const bucket = text.split("/")[0];
    if (knownBuckets.includes(bucket)) candidate = text.split(/[?#]/)[0];
  }
  if (!candidate) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    return null;
  }
  if (CONTROL_CHARACTERS.test(decoded)) return null;
  const segments = decoded.split("/");
  if (segments.length < 2 || segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return segments.join("/");
}

/** Texto que menciona o Storage mas não é uma referência interpretável (falha fechada). */
function looksLikeStorageReference(value: string) {
  return /\/storage\/v1\//.test(value);
}

/**
 * Percorre um valor (objeto, lista, texto JSON) e coleta toda referência ao Storage, com o
 * caminho exato dentro do JSON. Textos que parecem JSON são interpretados; se a interpretação
 * falhar e o texto mencionar o Storage, ele vai para `unparsed`.
 */
export function collectReferencesFromValue(
  value: unknown,
  source: ReferenceSourceName,
  location: string,
  knownBuckets?: readonly string[]
): { references: ImageReference[]; unparsed: string[] } {
  const references: ImageReference[] = [];
  const unparsed: string[] = [];

  const visit = (node: unknown, path: string, depth: number) => {
    if (depth > 50) {
      unparsed.push(`${path}: profundidade excessiva`);
      return;
    }
    if (typeof node === "string") {
      const trimmed = node.trim();
      if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && looksLikeStorageReference(trimmed)) {
        try {
          visit(JSON.parse(trimmed), path, depth + 1);
          return;
        } catch {
          unparsed.push(`${path}: JSON ilegível`);
          return;
        }
      }
      const key = objectKeyFromReference(trimmed, knownBuckets);
      if (key) references.push({ objectKey: key, source, location: path, raw: node });
      else if (looksLikeStorageReference(trimmed)) unparsed.push(`${path}: ${trimmed.slice(0, 120)}`);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) visit(child, `${path}.${key}`, depth + 1);
    }
  };

  visit(value, location, 0);
  return { references, unparsed };
}

function fromRows<T extends Record<string, unknown>>(
  source: ReferenceSourceName,
  rows: T[] | null | undefined,
  idOf: (row: T) => string,
  fields: (keyof T & string)[] | "all",
  error?: string,
  knownBuckets?: readonly string[]
): SourceResult {
  if (error) return { source, status: "failed", references: [], error };
  if (!Array.isArray(rows)) return { source, status: "failed", references: [], error: "linhas ausentes" };
  const references: ImageReference[] = [];
  const unparsed: string[] = [];
  for (const row of rows) {
    const keys = fields === "all" ? Object.keys(row) : fields;
    for (const field of keys) {
      const found = collectReferencesFromValue(row[field], source, `${source}:${idOf(row)}.${field}`, knownBuckets);
      references.push(...found.references);
      unparsed.push(...found.unparsed);
    }
  }
  return { source, status: unparsed.length > 0 ? "partial" : "complete", references, unparsed };
}

/** `achievements.image` (e `official_image`, se vier). */
export function referencesFromAchievements(
  rows: Array<{ id: string; image?: unknown; official_image?: unknown }> | null | undefined,
  error?: string
): SourceResult {
  return fromRows("achievements", rows, (row) => String(row.id), ["image", "official_image"], error);
}

/** `achievement_progress.image_override`. */
export function referencesFromProgress(
  rows: Array<{ id: string; image_override?: unknown }> | null | undefined,
  error?: string
): SourceResult {
  return fromRows("achievement_progress", rows, (row) => String(row.id), ["image_override"], error);
}

/** Todas as colunas dos jogos, inclusive os JSON (`final_badge`, `emblem`, `trophies`...). */
export function referencesFromGames(rows: Array<Record<string, unknown>> | null | undefined, error?: string): SourceResult {
  return fromRows("games", rows, (row) => String(row.slug ?? row.id ?? "?"), "all", error);
}

/**
 * `journey_entries.tags` (JSON). Também reconhece caminhos relativos ("<bucket>/<caminho>") de
 * qualquer bucket existente no projeto, não só os inventariados.
 */
export function referencesFromJourneyEntries(
  rows: Array<{ id: string; tags?: unknown }> | null | undefined,
  error?: string,
  knownBuckets?: readonly string[]
): SourceResult {
  return fromRows("journey_entries", rows, (row) => String(row.id), ["tags"], error, knownBuckets);
}

/** `journey_history_events.metadata` (JSON), com a mesma regra de caminhos relativos. */
export function referencesFromJourneyHistory(
  rows: Array<{ id: string; metadata?: unknown }> | null | undefined,
  error?: string,
  knownBuckets?: readonly string[]
): SourceResult {
  return fromRows("journey_history_events", rows, (row) => String(row.id), ["metadata"], error, knownBuckets);
}

export type PointerReading = {
  target: FixedImageTarget;
  /** Estado lido: "absent" é normal; "present" exige `file`; "invalid"/"unreadable" bloqueiam candidatos. */
  state: "present" | "absent" | "invalid" | "unreadable";
  file?: string;
  error?: string;
};

/** Ponteiros de ativação de banners e avatar. Ponteiro ilegível ou inválido torna a fonte incompleta. */
export function referencesFromPointers(readings: PointerReading[] | null | undefined, error?: string): SourceResult {
  if (error) return { source: "pointers", status: "failed", references: [], error };
  if (!Array.isArray(readings)) return { source: "pointers", status: "failed", references: [], error: "leituras ausentes" };
  const references: ImageReference[] = [];
  const unparsed: string[] = [];
  for (const reading of readings) {
    const where = `pointers:${reading.target.pointer}`;
    if (reading.state === "absent") continue;
    if (reading.state === "present" && isValidActiveFile(reading.target, reading.file)) {
      const objectKey = `${reading.target.bucket}/${reading.target.folder}/${reading.file}`;
      references.push({ objectKey, source: "pointers", location: where, raw: reading.file });
      continue;
    }
    unparsed.push(`${where}: ${reading.state}${reading.error ? ` (${reading.error})` : ""}`);
  }
  return { source: "pointers", status: unparsed.length > 0 ? "partial" : "complete", references, unparsed };
}

/** Rascunhos privados (JSON), lidos como texto ou já interpretados. Texto ilegível = incompleto. */
export function referencesFromDrafts(
  drafts: Array<{ bucket: string; path: string; content: unknown }> | null | undefined,
  error?: string
): SourceResult {
  if (error) return { source: "drafts", status: "failed", references: [], error };
  if (!Array.isArray(drafts)) return { source: "drafts", status: "failed", references: [], error: "rascunhos ausentes" };
  const references: ImageReference[] = [];
  const unparsed: string[] = [];
  for (const draft of drafts) {
    let content = draft.content;
    if (typeof content === "string") {
      try {
        content = JSON.parse(content);
      } catch {
        unparsed.push(`drafts:${draft.bucket}/${draft.path}: JSON ilegível`);
        continue;
      }
    }
    const found = collectReferencesFromValue(content, "drafts", `drafts:${draft.bucket}/${draft.path}`);
    references.push(...found.references);
    unparsed.push(...found.unparsed);
  }
  return { source: "drafts", status: unparsed.length > 0 ? "partial" : "complete", references, unparsed };
}

/** Chaves do mapa local de cópias leves (`data/homeImageVariants.json`) que apontam para o Storage. */
export function referencesFromVariantMap(map: Record<string, string> | null | undefined, error?: string): SourceResult {
  if (error) return { source: "variant_map", status: "failed", references: [], error };
  if (!map || typeof map !== "object") return { source: "variant_map", status: "failed", references: [], error: "mapa ausente" };
  const references: ImageReference[] = [];
  for (const key of Object.keys(map)) {
    const objectKey = objectKeyFromReference(key);
    if (objectKey) references.push({ objectKey, source: "variant_map", location: `variant_map:${map[key]}`, raw: key });
  }
  return { source: "variant_map", status: "complete", references };
}

/**
 * Proteção manual (não depende de nenhuma consulta). As quatro artes corretas do Mouse
 * que o banco não referencia hoje ficam protegidas por padrão.
 */
export const DEFAULT_PROTECTED_OBJECTS = [
  "achievement-art/games/mouse-p-i-for-hire/achievements/16-de-capa-a-capa.png",
  "achievement-art/games/mouse-p-i-for-hire/achievements/24-queijo-e-fumaca.png",
  "achievement-art/games/mouse-p-i-for-hire/achievements/27-nossos-irmaos-menores.png",
  "achievement-art/games/mouse-p-i-for-hire/achievements/29-tinsel-boulevard.png",
] as const;

export function referencesFromProtectionList(
  entries: Array<string | { objectKey: string; reason?: string }> = [...DEFAULT_PROTECTED_OBJECTS]
): SourceResult {
  const references: ImageReference[] = [];
  const unparsed: string[] = [];
  for (const entry of entries) {
    const raw = typeof entry === "string" ? entry : entry.objectKey;
    const objectKey = objectKeyFromReference(raw, ["achievement-art", "site-banners", "site-profile"]) ?? null;
    if (!objectKey) {
      unparsed.push(`protection: ${raw}`);
      continue;
    }
    const reason = typeof entry === "string" ? "proteção manual" : entry.reason ?? "proteção manual";
    references.push({ objectKey, source: "protection", location: `protection:${reason}`, raw });
  }
  return { source: "protection", status: unparsed.length > 0 ? "partial" : "complete", references, unparsed };
}

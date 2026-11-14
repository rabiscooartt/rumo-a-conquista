// Imagens de endereço fixo (banners e avatar) guardadas no Storage.
//
// Versão ativa = ponteiro de ativação: um JSON pequeno ("active/<tipo>.json", no bucket
// site-profile, que já guarda o settings.json do avatar) com o arquivo ativo E o seu
// enquadramento, gravados juntos numa única escrita.
// - Se o envio ou o ponteiro falharem, imagem e enquadramento anteriores continuam juntos.
// - Reenviar uma imagem idêntica reaproveita o arquivo imutável existente e só move o ponteiro:
//   nada é duplicado nem sobrescrito, e é possível voltar a uma imagem anterior.
// - É lido pela API do Storage (download), não pelo CDN, para nunca vir desatualizado.
// - O arquivo apontado é conferido na listagem da pasta; se tiver sido removido, vale a
//   regra de compatibilidade abaixo.
//
// Sem ponteiro válido (dados anteriores a esta versão ou arquivo removido): o arquivo mais
// recente que existe na pasta, entre o legado ("background"/"avatar", servido com
// "?v=<data>") e as versões imutáveis ("<base>.<hash>.webp").

import { CONTENT_HASH_LENGTH, pickLatestStoredImage, storedImageUrl } from "./naming.ts";
import type { OptimizedImage } from "./optimizeImage.ts";
import { uploadOptimizedImage, type StorageBucketApi } from "./storage.ts";

export const BANNER_BUCKET = "site-banners";
export const BANNER_FILE_BASE = "background";
export const AVATAR_STORAGE_BUCKET = "site-profile";
export const AVATAR_FOLDER = "profile";
export const AVATAR_FILE_BASE = "avatar";
/** Bucket dos ponteiros: aceita JSON (o bucket dos banners só aceita imagens). */
export const ACTIVE_POINTER_BUCKET = "site-profile";

type ListedFile = { name: string; created_at?: string | null; updated_at?: string | null };
type StorageError = { message?: string } | null;

type BucketApi = {
  list(
    path: string,
    options?: { limit?: number; sortBy?: { column: string; order: string } }
  ): Promise<{ data: ListedFile[] | null; error: unknown }>;
  getPublicUrl(path: string): { data: { publicUrl: string } };
  download?(path: string): Promise<{ data: Blob | null; error: unknown }>;
  upload?(
    path: string,
    body: Blob | Buffer | ArrayBuffer | Uint8Array,
    options: { contentType: string; cacheControl: string; upsert: boolean }
  ): Promise<{ error: StorageError }>;
};

export type StorageReader = { storage: { from(bucket: string): BucketApi } };

/** Imagem de endereço fixo: onde ficam os arquivos e qual ponteiro decide a versão ativa. */
export type FixedImageTarget = {
  bucket: string;
  folder: string;
  baseName: string;
  /** Nome do ponteiro, sem extensão (ex.: "avatar", "banner-home"). */
  pointer: string;
};

export function bannerImageTarget(bannerKey: string): FixedImageTarget {
  return { bucket: BANNER_BUCKET, folder: `banners/${bannerKey}`, baseName: BANNER_FILE_BASE, pointer: `banner-${bannerKey}` };
}

export const AVATAR_IMAGE_TARGET: FixedImageTarget = {
  bucket: AVATAR_STORAGE_BUCKET,
  folder: AVATAR_FOLDER,
  baseName: AVATAR_FILE_BASE,
  pointer: "avatar",
};

function pointerPath(target: FixedImageTarget) {
  if (!/^[a-z0-9-]+$/.test(target.pointer)) throw new Error("Nome de ponteiro inválido.");
  return `active/${target.pointer}.json`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Só aceita no ponteiro um arquivo imutável da própria imagem ("<base>.<hash>.webp"). */
export function isValidActiveFile(target: FixedImageTarget, fileName: unknown): fileName is string {
  return (
    typeof fileName === "string" &&
    new RegExp(`^${escapeRegExp(target.baseName)}\\.[0-9a-f]{${CONTENT_HASH_LENGTH}}\\.webp$`).test(fileName)
  );
}

/** Enquadramento salvo junto com a imagem ativa (mesma escrita do ponteiro). */
export type ImageFraming = { x: number; y: number; zoom: number };

export type ActivePointer = { file: string; framing: ImageFraming | null };

function readFraming(value: unknown): ImageFraming | null {
  if (!value || typeof value !== "object") return null;
  const { x, y, zoom } = value as Record<string, unknown>;
  const numbers = [x, y, zoom].map(Number);
  if (!numbers.every(Number.isFinite) || numbers[2] <= 0) return null;
  return { x: numbers[0], y: numbers[1], zoom: numbers[2] };
}

export type PointerInspection =
  | { state: "present"; pointer: ActivePointer }
  | { state: "absent" }
  | { state: "invalid"; reason: string }
  /** Erro de leitura que não é "não encontrado" (rede, permissão...). */
  | { state: "unreadable"; reason: string };

function isNotFound(error: unknown) {
  const value = error as { status?: unknown; statusCode?: unknown; message?: unknown } | null;
  const status = String(value?.statusCode ?? value?.status ?? "");
  return status === "404" || /not.?found/i.test(String(value?.message ?? ""));
}

/** Lê o ponteiro e diz exatamente em que estado ele está. */
export async function inspectActivePointer(client: StorageReader, target: FixedImageTarget): Promise<PointerInspection> {
  const api = client.storage.from(ACTIVE_POINTER_BUCKET);
  if (!api.download) return { state: "absent" };
  let text: string;
  try {
    const { data, error } = await api.download(pointerPath(target));
    if (error) return isNotFound(error) ? { state: "absent" } : { state: "unreadable", reason: String((error as { message?: unknown }).message ?? error) };
    if (!data) return { state: "absent" };
    text = await data.text();
  } catch (error) {
    return { state: "unreadable", reason: error instanceof Error ? error.message : String(error) };
  }
  try {
    const parsed = JSON.parse(text) as { file?: unknown; framing?: unknown };
    if (!isValidActiveFile(target, parsed.file)) return { state: "invalid", reason: "arquivo do ponteiro fora do formato <base>.<hash>.webp" };
    return { state: "present", pointer: { file: parsed.file, framing: readFraming(parsed.framing) } };
  } catch {
    return { state: "invalid", reason: "JSON do ponteiro ilegível" };
  }
}

/** Lê o ponteiro; null quando não existe, é inválido ou não pôde ser lido. */
export async function readActivePointer(client: StorageReader, target: FixedImageTarget): Promise<ActivePointer | null> {
  try {
    const inspection = await inspectActivePointer(client, target);
    return inspection.state === "present" ? inspection.pointer : null;
  } catch {
    return null;
  }
}

/**
 * Ativa um arquivo já enviado, com o seu enquadramento, numa única escrita (JSON mutável,
 * sem cache). Imagem ativa e enquadramento mudam juntos ou não mudam.
 * O arquivo de imagem imutável nunca é sobrescrito.
 */
export async function writeActivePointer(
  client: StorageReader,
  target: FixedImageTarget,
  fileName: string,
  options: { framing?: ImageFraming | null; now?: () => Date } = {}
) {
  if (!isValidActiveFile(target, fileName)) throw new Error("Arquivo ativo inválido.");
  const api = client.storage.from(ACTIVE_POINTER_BUCKET);
  if (!api.upload) throw new Error("Storage sem suporte a envio.");
  const framing = options.framing ? readFraming(options.framing) : null;
  const now = options.now ?? (() => new Date());
  const body = new Blob([JSON.stringify({ file: fileName, framing, activatedAt: now().toISOString() })], {
    type: "application/json",
  });
  const { error } = await api.upload(pointerPath(target), body, {
    contentType: "application/json",
    cacheControl: "0",
    upsert: true,
  });
  if (error) throw new Error(error.message || "Não foi possível ativar a imagem.");
}

export type ActiveStoredImage = {
  /** Endereço público, ou "" quando não há imagem guardada. */
  url: string;
  /** Enquadramento da imagem ativa; null quando não há ponteiro válido (use o salvo à parte). */
  framing: ImageFraming | null;
  source: "pointer" | "fallback" | "none";
};

/** Estado do ponteiro, como diagnosticado junto com a escolha da versão ativa. */
export type PointerState = "valid" | "absent" | "invalid" | "missing-file" | "unreadable" | "unverified";

export type ActiveImageInspection = {
  active: ActiveStoredImage;
  pointerState: PointerState;
  /** Arquivo citado pelo ponteiro (válido, removido ou não conferido). */
  pointerFile?: string;
  /** Falha ao listar a pasta: a escolha não pôde ser conferida. */
  listingError?: string;
  /** Arquivo escolhido na pasta, quando a escolha veio da regra de compatibilidade. */
  chosenFile?: { name: string; created_at?: string | null; updated_at?: string | null };
};

/**
 * Escolha da versão ativa com diagnóstico completo:
 * - ponteiro válido e arquivo existente → "valid";
 * - ponteiro válido, mas listagem indisponível → "unverified" (o site confia no ponteiro);
 * - ponteiro válido para arquivo removido → "missing-file" (vale a regra de compatibilidade);
 * - sem ponteiro → "absent"; ponteiro ilegível ou fora do formato → "invalid";
 * - erro ao ler o ponteiro → "unreadable".
 * Sem ponteiro utilizável: a versão mais recente que existe na pasta (imutável ou legado).
 */
export async function inspectActiveStoredImage(
  client: StorageReader,
  target: FixedImageTarget
): Promise<ActiveImageInspection> {
  const none: ActiveStoredImage = { url: "", framing: null, source: "none" };
  const api = client.storage.from(target.bucket);
  const [inspection, listing] = await Promise.all([
    inspectActivePointer(client, target).catch(
      (error): PointerInspection => ({ state: "unreadable", reason: String(error) })
    ),
    api
      .list(target.folder, { limit: 1000, sortBy: { column: "created_at", order: "desc" } })
      .catch((error: unknown) => ({ data: null, error })),
  ]);
  const listingError = listing.error
    ? String((listing.error as { message?: unknown }).message ?? listing.error)
    : !listing.data
      ? "listagem vazia (null)"
      : undefined;
  const files = listingError ? null : listing.data;
  const pointer = inspection.state === "present" ? inspection.pointer : null;

  if (pointer && (!files || files.some((file) => file.name === pointer.file))) {
    return {
      active: {
        url: api.getPublicUrl(`${target.folder}/${pointer.file}`).data.publicUrl,
        framing: pointer.framing,
        source: "pointer",
      },
      pointerState: files ? "valid" : "unverified",
      pointerFile: pointer.file,
      listingError,
    };
  }

  const pointerState: PointerState = pointer ? "missing-file" : inspection.state === "present" ? "valid" : inspection.state;
  const base = { pointerState, pointerFile: pointer?.file, listingError };
  if (!files) return { ...base, active: none };

  const file = pickLatestStoredImage(files, target.baseName);
  if (!file) return { ...base, active: none };
  const { data } = api.getPublicUrl(`${target.folder}/${file.name}`);
  return {
    ...base,
    active: { url: storedImageUrl(data.publicUrl, file), framing: null, source: "fallback" },
    chosenFile: { name: file.name, created_at: file.created_at, updated_at: file.updated_at },
  };
}

/**
 * Versão ativa: a do ponteiro, se o arquivo apontado existir na pasta. Se o arquivo tiver sido
 * removido (ou não houver ponteiro), vale a regra de compatibilidade, determinística: a versão
 * mais recente que ainda existe (outra versão imutável ou o arquivo legado).
 */
export async function resolveActiveStoredImage(
  client: StorageReader,
  target: FixedImageTarget
): Promise<ActiveStoredImage> {
  try {
    return (await inspectActiveStoredImage(client, target)).active;
  } catch {
    return { url: "", framing: null, source: "none" };
  }
}

export async function getActiveStoredImageUrl(client: StorageReader, target: FixedImageTarget): Promise<string> {
  return (await resolveActiveStoredImage(client, target)).url;
}

/**
 * Envia a versão otimizada (ou reaproveita o arquivo idêntico já existente) e a ativa junto
 * com o enquadramento. Ordem: arquivo → ponteiro (imagem + enquadramento) → `afterActivate`
 * (cópia de compatibilidade do enquadramento, ex.: tabela do banner ou settings.json).
 * Falha no arquivo ou no ponteiro mantém imagem e enquadramento anteriores.
 */
export async function replaceActiveImage(
  client: StorageReader,
  target: FixedImageTarget,
  image: OptimizedImage,
  options: { framing?: ImageFraming | null; afterActivate?: () => Promise<void>; now?: () => Date } = {}
) {
  const api = client.storage.from(target.bucket);
  if (!api.upload) throw new Error("Storage sem suporte a envio.");
  const stored = await uploadOptimizedImage(api as StorageBucketApi, target.folder, target.baseName, image);
  const fileName = stored.path.slice(target.folder.length + 1);
  await writeActivePointer(client, target, fileName, { framing: options.framing, now: options.now });
  await options.afterActivate?.();
  return { ...stored, fileName };
}

/**
 * Só o enquadramento mudou: regrava o ponteiro com a mesma imagem e o novo enquadramento.
 * Devolve false quando ainda não há ponteiro (dados antigos: vale só a cópia de compatibilidade).
 */
export async function updateActiveFraming(
  client: StorageReader,
  target: FixedImageTarget,
  framing: ImageFraming,
  now?: () => Date
) {
  const pointer = await readActivePointer(client, target);
  if (!pointer) return false;
  await writeActivePointer(client, target, pointer.file, { framing, now });
  return true;
}

/** Aplica o enquadramento da imagem ativa sobre o salvo à parte, quando houver. */
export function withActiveFraming<T extends ImageFraming>(saved: T, active: ActiveStoredImage): T {
  return active.framing ? { ...saved, ...active.framing } : saved;
}

export function getStoredBannerUrl(client: StorageReader, bannerKey: string) {
  return getActiveStoredImageUrl(client, bannerImageTarget(bannerKey));
}

export function getStoredBannerImage(client: StorageReader, bannerKey: string) {
  return resolveActiveStoredImage(client, bannerImageTarget(bannerKey));
}

export function getStoredAvatarImageUrl(client: StorageReader) {
  return getActiveStoredImageUrl(client, AVATAR_IMAGE_TARGET);
}

export function getStoredAvatarImage(client: StorageReader) {
  return resolveActiveStoredImage(client, AVATAR_IMAGE_TARGET);
}

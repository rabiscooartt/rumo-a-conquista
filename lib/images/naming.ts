// Nomes imutáveis: "<base>.<hash>.webp", em que o hash vem do conteúdo otimizado.
// O mesmo conteúdo gera sempre o mesmo nome; conteúdo novo gera um nome novo.
// Por isso o arquivo pode ter cache de um ano sem "?v=" e nunca é sobrescrito.

export const CONTENT_HASH_LENGTH = 16;

const IMMUTABLE_SUFFIX = new RegExp(`\\.([0-9a-f]{${CONTENT_HASH_LENGTH}})\\.webp$`, "i");

/** Base segura para nome de arquivo: sem extensão, sem acentos e só com [a-zA-Z0-9-_]. */
export function safeImageBaseName(value: string, fallback = "imagem") {
  const base = stripImageVersion(String(value ?? ""))
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return base || fallback;
}

export function immutableImageName(baseName: string, contentHash: string) {
  const hash = contentHash.slice(0, CONTENT_HASH_LENGTH).toLowerCase();
  if (!new RegExp(`^[0-9a-f]{${CONTENT_HASH_LENGTH}}$`).test(hash)) {
    throw new Error("Hash de conteúdo inválido.");
  }
  return `${safeImageBaseName(baseName)}.${hash}.webp`;
}

/** Remove o sufixo ".<hash>.webp", para comparar nomes novos com os nomes antigos. */
export function stripImageVersion(filename: string) {
  return String(filename ?? "").replace(IMMUTABLE_SUFFIX, "");
}

export function isImmutableImageName(filenameOrUrl: string) {
  const path = String(filenameOrUrl ?? "").split(/[?#]/)[0];
  return IMMUTABLE_SUFFIX.test(path);
}

type StoredFile = {
  name: string;
  created_at?: string | null;
  updated_at?: string | null;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Última modificação: o legado é sobrescrito no mesmo nome, então created_at fica antigo. */
function timestamp(file: StoredFile) {
  const values = [file.created_at, file.updated_at]
    .map((value) => Date.parse(value || ""))
    .filter((value) => Number.isFinite(value));
  return values.length > 0 ? Math.max(...values) : 0;
}

/**
 * Regra de compatibilidade, usada só quando não existe ponteiro de ativação
 * (ver lib/images/storedImages.ts): a versão modificada por último entre o arquivo legado
 * sem extensão ("background") e as versões imutáveis ("background.<hash>.webp").
 * Desempate determinístico, independente da ordem da listagem:
 * data → versão imutável antes do legado → nome em ordem decrescente.
 */
export function pickLatestStoredImage<T extends StoredFile>(files: T[], baseName: string): T | null {
  const versioned = new RegExp(`^${escapeRegExp(baseName)}\\.[0-9a-f]{${CONTENT_HASH_LENGTH}}\\.webp$`, "i");
  const candidates = files.filter((file) => file?.name === baseName || versioned.test(file?.name ?? ""));
  if (candidates.length === 0) return null;

  return [...candidates].sort((left, right) => {
    const byTime = timestamp(right) - timestamp(left);
    if (byTime !== 0) return byTime;
    const byKind = Number(isImmutableImageName(right.name)) - Number(isImmutableImageName(left.name));
    if (byKind !== 0) return byKind;
    return right.name < left.name ? -1 : right.name > left.name ? 1 : 0;
  })[0];
}

/**
 * Endereço público da imagem escolhida. Versões imutáveis dispensam "?v=";
 * o arquivo legado continua com "?v=<data>", como antes.
 */
export function storedImageUrl(publicUrl: string, file: StoredFile) {
  if (isImmutableImageName(file.name)) return publicUrl;
  const version = file.updated_at || file.created_at;
  return version ? `${publicUrl}?v=${encodeURIComponent(version)}` : publicUrl;
}

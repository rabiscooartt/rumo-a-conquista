// Envio da versão otimizada ao Supabase Storage com nome imutável e cache de um ano.
// Recebe só a API do bucket, o que permite testar com um objeto falso, sem rede.

import { immutableImageName } from "./naming.ts";
import { IMMUTABLE_CACHE_SECONDS } from "./presets.ts";
import type { OptimizedImage } from "./optimizeImage.ts";

type UploadError = { message?: string; statusCode?: string | number; status?: number } | null;

export type StorageBucketApi = {
  upload(
    path: string,
    body: Buffer | Blob | ArrayBuffer | Uint8Array,
    options: { contentType: string; cacheControl: string; upsert: boolean }
  ): Promise<{ error: UploadError }>;
  getPublicUrl(path: string): { data: { publicUrl: string } };
};

export type StoredOptimizedImage = {
  path: string;
  publicUrl: string;
  /** true quando um arquivo idêntico já existia e foi reaproveitado. */
  deduplicated: boolean;
};

function isAlreadyExists(error: NonNullable<UploadError>) {
  const status = String(error.statusCode ?? error.status ?? "");
  return status === "409" || /already exists|duplicate/i.test(error.message ?? "");
}

export async function uploadOptimizedImage(
  bucket: StorageBucketApi,
  directory: string,
  baseName: string,
  image: OptimizedImage
): Promise<StoredOptimizedImage> {
  const cleanDirectory = directory.replace(/^\/+|\/+$/g, "");
  if (!cleanDirectory || cleanDirectory.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Pasta de destino inválida.");
  }

  const path = `${cleanDirectory}/${immutableImageName(baseName, image.contentHash)}`;
  const { error } = await bucket.upload(path, image.buffer, {
    contentType: image.contentType,
    cacheControl: IMMUTABLE_CACHE_SECONDS,
    // Nunca sobrescreve: o nome depende do conteúdo, então o mesmo nome já tem o mesmo arquivo.
    upsert: false,
  });

  let deduplicated = false;
  if (error) {
    if (!isAlreadyExists(error)) throw new Error(error.message || "Falha ao enviar a imagem.");
    deduplicated = true;
  }

  const { data } = bucket.getPublicUrl(path);
  return { path, publicUrl: data.publicUrl, deduplicated };
}

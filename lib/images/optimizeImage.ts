// Pipeline central de imagens: valida o arquivo recebido e gera a versão WebP de exibição.
// Roda só no servidor (sharp é nativo). Não usa o serviço pago de transformação do Supabase.

import { createHash } from "node:crypto";
import sharp from "sharp";
import type { Metadata, OutputInfo } from "sharp";
import {
  detectImageFormat,
  normalizeDeclaredMime,
  SUPPORTED_IMAGE_MIME_TYPES,
  type SupportedImageFormat,
} from "./imageFormat.ts";
import {
  IMAGE_PRESETS,
  MAX_INPUT_DIMENSION,
  MAX_INPUT_PIXELS,
  type ImagePresetName,
} from "./presets.ts";

export class ImageValidationError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ImageValidationError";
    this.status = status;
  }
}

export type OptimizedImage = {
  buffer: Buffer;
  contentType: "image/webp";
  /** SHA-256 (hex) do arquivo final. */
  contentHash: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  originalFormat: SupportedImageFormat;
  originalWidth: number;
  originalHeight: number;
  originalBytes: number;
  optimizedBytes: number;
  /** Percentual de redução de bytes (0 quando não houve redução). */
  reductionPercent: number;
  /** true quando o arquivo de entrada já era um WebP adequado e foi mantido sem recodificar. */
  passthrough: boolean;
};

export type OptimizeImageInput = {
  bytes: Uint8Array;
  /** MIME informado pelo navegador; precisa coincidir com o formato real. */
  declaredMime?: string | null;
  preset: ImagePresetName;
  /** Substitui o limite de entrada do preset (usado só pelo script local, sem upload). */
  maxInputBytes?: number;
};

function reduction(originalBytes: number, optimizedBytes: number) {
  if (originalBytes <= 0 || optimizedBytes >= originalBytes) return 0;
  return Math.round((1 - optimizedBytes / originalBytes) * 1000) / 10;
}

export async function optimizeImage({
  bytes,
  declaredMime,
  preset,
  maxInputBytes,
}: OptimizeImageInput): Promise<OptimizedImage> {
  const presetSettings = IMAGE_PRESETS[preset];
  if (!presetSettings) throw new Error(`Preset de imagem desconhecido: ${preset}`);
  const settings = { ...presetSettings, maxInputBytes: maxInputBytes ?? presetSettings.maxInputBytes };

  const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (input.byteLength === 0) {
    throw new ImageValidationError("O arquivo de imagem está vazio.");
  }
  if (input.byteLength > settings.maxInputBytes) {
    const limitMb = (settings.maxInputBytes / 1024 / 1024).toFixed(0);
    throw new ImageValidationError(`A imagem deve ter até ${limitMb} MB.`, 413);
  }

  const format = detectImageFormat(input);
  if (!format) {
    throw new ImageValidationError("O conteúdo do arquivo não é uma imagem PNG, JPG ou WEBP válida.", 415);
  }

  if (declaredMime !== undefined && declaredMime !== null && declaredMime !== "") {
    const declared = normalizeDeclaredMime(declaredMime);
    if (!declared) {
      throw new ImageValidationError("Use uma imagem PNG, JPG ou WEBP.", 415);
    }
    if (declared !== SUPPORTED_IMAGE_MIME_TYPES[format]) {
      throw new ImageValidationError("O tipo informado não corresponde ao conteúdo real da imagem.", 415);
    }
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new ImageValidationError("Não foi possível ler a imagem. O arquivo pode estar corrompido.");
  }

  const originalWidth = metadata.width ?? 0;
  const originalHeight = metadata.height ?? 0;
  if (originalWidth <= 0 || originalHeight <= 0) {
    throw new ImageValidationError("A imagem não tem dimensões válidas.");
  }
  if (originalWidth > MAX_INPUT_DIMENSION || originalHeight > MAX_INPUT_DIMENSION) {
    throw new ImageValidationError(`A imagem deve ter no máximo ${MAX_INPUT_DIMENSION} px de largura e de altura.`, 413);
  }
  if ((metadata.pages ?? 1) > 1) {
    throw new ImageValidationError("Imagens animadas não são aceitas.", 415);
  }

  // Dimensões já orientadas: fotos de celular podem vir giradas pelo EXIF.
  const rotated = (metadata.orientation ?? 1) >= 5;
  const displayWidth = rotated ? originalHeight : originalWidth;
  const displayHeight = rotated ? originalWidth : originalHeight;
  const fitsPreset = displayWidth <= settings.maxWidth && displayHeight <= settings.maxHeight;
  const hasPrivateMetadata = Boolean(metadata.exif || metadata.xmp || metadata.iptc);

  // Um WebP que já cabe no tamanho e não carrega metadados é mantido como está:
  // recodificar só acrescentaria perda de qualidade.
  if (format === "webp" && fitsPreset && !hasPrivateMetadata) {
    return {
      buffer: input,
      contentType: "image/webp",
      contentHash: createHash("sha256").update(input).digest("hex"),
      width: displayWidth,
      height: displayHeight,
      hasAlpha: Boolean(metadata.hasAlpha),
      originalFormat: format,
      originalWidth,
      originalHeight,
      originalBytes: input.byteLength,
      optimizedBytes: input.byteLength,
      reductionPercent: 0,
      passthrough: true,
    };
  }

  let output: { data: Buffer; info: OutputInfo };
  try {
    output = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({
        width: settings.maxWidth,
        height: settings.maxHeight,
        fit: "inside",
        withoutEnlargement: true,
        kernel: "lanczos3",
      })
      .webp({
        quality: settings.quality,
        alphaQuality: settings.alphaQuality,
        effort: 6,
        smartSubsample: true,
      })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new ImageValidationError("Não foi possível converter a imagem para WebP.");
  }

  const outputMeta = await sharp(output.data).metadata();

  return {
    buffer: output.data,
    contentType: "image/webp",
    contentHash: createHash("sha256").update(output.data).digest("hex"),
    width: output.info.width,
    height: output.info.height,
    hasAlpha: Boolean(outputMeta.hasAlpha),
    originalFormat: format,
    originalWidth,
    originalHeight,
    originalBytes: input.byteLength,
    optimizedBytes: output.data.byteLength,
    reductionPercent: reduction(input.byteLength, output.data.byteLength),
    passthrough: false,
  };
}

/** Lê um File de formulário e otimiza. Erros de validação saem como ImageValidationError. */
export async function optimizeUploadedFile(file: File, preset: ImagePresetName) {
  const limit = IMAGE_PRESETS[preset].maxInputBytes;
  if (file.size > limit) {
    throw new ImageValidationError(`A imagem deve ter até ${(limit / 1024 / 1024).toFixed(0)} MB.`, 413);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return optimizeImage({ bytes, declaredMime: file.type, preset });
}

/** Resumo enviado ao Admin depois do envio. */
export function optimizationSummary(image: OptimizedImage) {
  return {
    format: "webp" as const,
    originalFormat: image.originalFormat,
    originalBytes: image.originalBytes,
    optimizedBytes: image.optimizedBytes,
    reductionPercent: image.reductionPercent,
    originalWidth: image.originalWidth,
    originalHeight: image.originalHeight,
    width: image.width,
    height: image.height,
    hasAlpha: image.hasAlpha,
  };
}

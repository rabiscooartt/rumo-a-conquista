// Identifica o formato real de uma imagem pela assinatura dos primeiros bytes.
// O MIME informado pelo navegador vem do nome do arquivo e não pode ser usado sozinho.

export type SupportedImageFormat = "png" | "jpeg" | "webp";

export const SUPPORTED_IMAGE_MIME_TYPES: Record<SupportedImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  if (bytes.length < offset + length) return "";
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

export function detectImageFormat(bytes: Uint8Array): SupportedImageFormat | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  return null;
}

/** Converte "image/jpg" e variações de caixa para o MIME canônico, ou null se não for aceito. */
export function normalizeDeclaredMime(value: string | null | undefined): string | null {
  const mime = String(value ?? "").trim().toLowerCase();
  if (mime === "image/jpg" || mime === "image/pjpeg") return "image/jpeg";
  return Object.values(SUPPORTED_IMAGE_MIME_TYPES).includes(mime) ? mime : null;
}

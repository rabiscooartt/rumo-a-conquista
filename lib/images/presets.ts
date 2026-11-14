// Tamanhos de saída por tipo de imagem. A imagem é reduzida para caber no retângulo
// (sem cortar, sem distorcer e sem ampliar) e convertida para WebP.
//
// Maior exibição real medida no código (CSS px; telas de alta densidade usam 2–3×):
// - arte de conquista: 52 px (página do jogo), 54 px (Atividade), 56 px (Histórico), 48 px (Início).
//   256 px cobre 3× com folga e mantém nitidez se a arte for mostrada maior no futuro.
// - emblema: destaque da página do jogo (~300 px exibidos, ampliado 125%); 768 px = mesmo
//   tamanho da cópia "#large" já aprovada.
// - avatar: enquadramento com zoom de até 2,5×; 512 px.
// - banner: cabeçalhos de largura total; 1920 px.

export type ImagePresetName = "achievement" | "emblem" | "avatar" | "banner";

export type ImagePreset = {
  /** Maior largura de saída, em pixels. */
  maxWidth: number;
  /** Maior altura de saída, em pixels. */
  maxHeight: number;
  /** Qualidade WebP das cores (0–100). */
  quality: number;
  /** Qualidade do canal de transparência (0–100). 100 evita bordas serrilhadas. */
  alphaQuality: number;
  /** Maior arquivo de entrada aceito, em bytes. */
  maxInputBytes: number;
};

const FOUR_MB = 4 * 1024 * 1024;

export const IMAGE_PRESETS: Record<ImagePresetName, ImagePreset> = {
  achievement: { maxWidth: 256, maxHeight: 256, quality: 85, alphaQuality: 100, maxInputBytes: FOUR_MB },
  emblem: { maxWidth: 768, maxHeight: 768, quality: 88, alphaQuality: 100, maxInputBytes: FOUR_MB },
  avatar: { maxWidth: 512, maxHeight: 512, quality: 86, alphaQuality: 100, maxInputBytes: FOUR_MB },
  banner: { maxWidth: 1920, maxHeight: 1920, quality: 84, alphaQuality: 100, maxInputBytes: FOUR_MB },
};

/** Limites de segurança contra imagens com dimensões absurdas (bombas de descompressão). */
export const MAX_INPUT_DIMENSION = 10_000;
export const MAX_INPUT_PIXELS = 50_000_000;

/** Cache do navegador e do CDN para arquivos com nome imutável (o conteúdo nunca muda). */
export const IMMUTABLE_CACHE_SECONDS = "31536000";

// Ícone do aplicativo: o troféu de Maestria do site (assets/maestria.png, mesmo arquivo de
// public/images/trophies/maestria.png).
//  - Tamanhos grandes (48 px ou mais): o troféu detalhado, recortado para ocupar o quadro.
//  - Tamanhos pequenos (bandeja, até 32 px): versão simplificada e legível — a silhueta do mesmo
//    troféu em vermelho sólido, contorno escuro e o diamante da Maestria em destaque.
// Funções puras sobre bitmaps BGRA (formato do nativeImage do Electron), sem dependências.

export const BRAND_RED = [226, 32, 44];
const OUTLINE = [20, 8, 10];
const GEM = [255, 247, 240];

/** Cores do ponto de estado na bandeja (ok = sem ponto). */
export const STATUS_DOT = { warn: [245, 158, 11], error: [239, 68, 68], idle: [148, 152, 160] };

/** Quadrado mínimo que contém a parte visível da imagem (para o troféu ocupar o ícone). */
export function trimRect(bitmap, width, height, threshold = 24) {
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (bitmap[(y * width + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0) return { x: 0, y: 0, width, height };
  const side = Math.min(Math.max(x1 - x0, y1 - y0) + 1, width, height);
  const x = Math.min(Math.max(0, Math.round((x0 + x1) / 2 - side / 2)), width - side);
  const y = Math.min(Math.max(0, Math.round((y0 + y1) / 2 - side / 2)), height - side);
  return { x, y, width: side, height: side };
}

const put = (out, i, [r, g, b], a = 255) => {
  out[i] = b;
  out[i + 1] = g;
  out[i + 2] = r;
  out[i + 3] = a;
};

/**
 * Versão pequena: recebe o troféu (já recortado) redimensionado para size×size e devolve a
 * silhueta vermelha com contorno de 1 px e o diamante claro no centro da taça.
 */
export function smallIconBitmap(bitmap, size) {
  const alpha = (x, y) => (x < 0 || y < 0 || x >= size || y >= size ? 0 : bitmap[(y * size + x) * 4 + 3]);
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (alpha(x, y) > 90) put(out, i, BRAND_RED);
      else if (Math.max(alpha(x - 1, y), alpha(x + 1, y), alpha(x, y - 1), alpha(x, y + 1)) > 90) put(out, i, OUTLINE);
    }
  }
  const cx = (size - 1) / 2;
  const cy = size * 0.3;
  const r = Math.max(1.6, size * 0.13);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (Math.abs(x - cx) / r + Math.abs(y - cy) / (r * 1.25) <= 1) put(out, (y * size + x) * 4, GEM);
    }
  }
  return out;
}

/** Ponto de estado no canto inferior direito (borda escura para aparecer sobre o vermelho). */
export function drawStatusDot(bitmap, width, height, state) {
  const color = STATUS_DOT[state];
  if (!color) return bitmap;
  const out = Buffer.from(bitmap);
  const r = Math.max(3, Math.round(width * 0.22));
  const cx = width - r;
  const cy = height - r;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > r) continue;
      put(out, (y * width + x) * 4, d > r - 1.2 ? OUTLINE : color);
    }
  }
  return out;
}

/** ICO com imagens PNG embutidas (Windows Vista+ e Inno Setup aceitam). */
export function icoFromPngs(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = [];
  let offset = 6 + 16 * entries.length;
  for (const { size, png } of entries) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    dir.push(e);
  }
  return Buffer.concat([header, ...dir, ...entries.map((e) => e.png)]);
}

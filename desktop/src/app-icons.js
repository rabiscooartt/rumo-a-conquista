// Monta os ícones com o nativeImage do Electron a partir do troféu de Maestria (assets/maestria.png).
import { nativeImage } from "electron";
import { drawStatusDot, smallIconBitmap, trimRect } from "./icon.js";

/** Até este tamanho usa a versão simplificada (legível na bandeja e em ícones pequenos). */
export const SMALL_MAX = 32;
/** Escalas de tela do Windows → tamanho do ícone da bandeja. */
const TRAY_SCALES = [
  [1, 16],
  [1.25, 20],
  [1.5, 24],
  [2, 32],
];

export function loadTrophy(path) {
  const source = nativeImage.createFromPath(path);
  if (source.isEmpty()) throw new Error(`Ícone não encontrado: ${path}`);
  const { width, height } = source.getSize();
  return source.crop(trimRect(source.toBitmap(), width, height));
}

/** Bitmap BGRA do ícone num tamanho exato (simplificado nos pequenos, detalhado nos grandes). */
export function iconBitmap(trophy, size) {
  const resized = trophy.resize({ width: size, height: size, quality: "best" });
  return size <= SMALL_MAX ? smallIconBitmap(resized.toBitmap(), size) : resized.toBitmap();
}

export function iconPng(trophy, size) {
  return nativeImage.createFromBitmap(iconBitmap(trophy, size), { width: size, height: size }).toPNG();
}

/** Ícone da bandeja com uma representação desenhada para cada escala de tela, mais o ponto de estado. */
export function trayImage(trophy, state) {
  const image = nativeImage.createEmpty();
  for (const [scaleFactor, size] of TRAY_SCALES) {
    image.addRepresentation({ scaleFactor, width: size, height: size, buffer: nativeImage.createFromBitmap(drawStatusDot(iconBitmap(trophy, size), size, size, state), { width: size, height: size }).toPNG() });
  }
  return image;
}

/** Ícone de janela/notificação: simplificado em 16–32 px, detalhado acima disso. */
export function windowImage(trophy) {
  const image = nativeImage.createEmpty();
  for (const size of [16, 24, 32, 48, 64, 128, 256]) {
    image.addRepresentation({ scaleFactor: size / 32, width: size, height: size, buffer: iconPng(trophy, size) });
  }
  return image;
}

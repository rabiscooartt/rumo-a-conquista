// Testes do pipeline central de imagens. Rodam só localmente, sem rede e sem Supabase.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { detectImageFormat, normalizeDeclaredMime } from "../../lib/images/imageFormat.ts";
import { ImageValidationError, optimizeImage } from "../../lib/images/optimizeImage.ts";

const ACHIEVEMENT = "public/images/games/mouse-p-i-for-hire/achievements/maestria-final.png";
const EMBLEM = "public/images/games/hades/emblem.png";

async function rgbaImage(width: number, height: number, format: "png" | "webp" = "png") {
  // Metade esquerda opaca (vermelho), metade direita totalmente transparente,
  // e uma faixa semitransparente no meio para conferir o alpha intermediário.
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const alpha = x < width * 0.4 ? 255 : x < width * 0.6 ? 128 : 0;
      pixels.set([220, 40, 40, alpha], offset);
    }
  }
  const image = sharp(pixels, { raw: { width, height, channels: 4 } });
  return format === "png" ? image.png().toBuffer() : image.webp({ quality: 90 }).toBuffer();
}

test("detecta o formato real pela assinatura", async () => {
  assert.equal(detectImageFormat(readFileSync(ACHIEVEMENT)), "png");
  assert.equal(detectImageFormat(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).jpeg().toBuffer()), "jpeg");
  assert.equal(detectImageFormat(await rgbaImage(4, 4, "webp")), "webp");
  assert.equal(detectImageFormat(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")), null);
  assert.equal(normalizeDeclaredMime("image/JPG"), "image/jpeg");
  assert.equal(normalizeDeclaredMime("image/svg+xml"), null);
});

test("arte de conquista vira WebP 256×256, muito menor", async () => {
  const input = readFileSync(ACHIEVEMENT);
  const result = await optimizeImage({ bytes: input, declaredMime: "image/png", preset: "achievement" });
  const meta = await sharp(result.buffer).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(result.contentType, "image/webp");
  assert.deepEqual([meta.width, meta.height], [256, 256]);
  assert.deepEqual([result.originalWidth, result.originalHeight], [1254, 1254]);
  assert.ok(result.optimizedBytes < 60 * 1024, `esperado < 60 KB, veio ${result.optimizedBytes}`);
  assert.ok(result.reductionPercent > 95);
  assert.equal(result.optimizedBytes, result.buffer.byteLength);
  assert.match(result.contentHash, /^[0-9a-f]{64}$/);
});

test("emblema mantém proporção 2:3 e a transparência", async () => {
  const result = await optimizeImage({ bytes: readFileSync(EMBLEM), preset: "emblem" });
  assert.deepEqual([result.width, result.height], [512, 768]);
  assert.equal(result.hasAlpha, true);
  assert.ok(Math.abs(result.width / result.height - 1024 / 1536) < 0.01);
});

test("preserva pixels transparentes e semitransparentes", async () => {
  const input = await rgbaImage(600, 300);
  const result = await optimizeImage({ bytes: input, declaredMime: "image/png", preset: "achievement" });
  assert.deepEqual([result.width, result.height], [256, 128]);
  assert.equal(result.hasAlpha, true);

  const { data, info } = await sharp(result.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
  assert.ok(alphaAt(20, 64) >= 250, "lado opaco deve continuar opaco");
  assert.ok(alphaAt(240, 64) <= 5, "lado transparente deve continuar transparente");
  const middle = alphaAt(128, 64);
  assert.ok(middle > 100 && middle < 160, `faixa semitransparente preservada (alpha ${middle})`);
});

test("não amplia imagens menores que o preset", async () => {
  const input = await rgbaImage(100, 50);
  const result = await optimizeImage({ bytes: input, preset: "banner" });
  assert.deepEqual([result.width, result.height], [100, 50]);
});

test("WebP que já cabe no preset e sem metadados é mantido sem recodificar", async () => {
  const input = await rgbaImage(200, 200, "webp");
  const result = await optimizeImage({ bytes: input, declaredMime: "image/webp", preset: "achievement" });
  assert.equal(result.passthrough, true);
  assert.ok(result.buffer.equals(input));
});

test("remove EXIF (ex.: localização) e aplica a orientação", async () => {
  const withExif = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#3366aa" } })
    .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "teste", ImageDescription: "gps" } } })
    .jpeg()
    .toBuffer();
  assert.ok((await sharp(withExif).metadata()).exif, "a entrada do teste deve ter EXIF");

  const result = await optimizeImage({ bytes: withExif, declaredMime: "image/jpeg", preset: "avatar" });
  const meta = await sharp(result.buffer).metadata();
  assert.equal(meta.exif, undefined);
  // Orientação 6 = girada 90°: 900×600 vira 600×900 e cabe em 512 de altura.
  assert.deepEqual([result.width, result.height], [341, 512]);
});

test("rejeita MIME que não corresponde ao conteúdo", async () => {
  await assert.rejects(
    optimizeImage({ bytes: readFileSync(ACHIEVEMENT), declaredMime: "image/jpeg", preset: "achievement" }),
    (error: unknown) => error instanceof ImageValidationError && error.status === 415
  );
});

test("rejeita conteúdo que não é imagem, mesmo com MIME de imagem", async () => {
  await assert.rejects(
    optimizeImage({ bytes: Buffer.from("isto não é um png"), declaredMime: "image/png", preset: "achievement" }),
    (error: unknown) => error instanceof ImageValidationError && error.status === 415
  );
});

test("rejeita PNG corrompido com assinatura válida", async () => {
  const broken = Buffer.concat([readFileSync(ACHIEVEMENT).subarray(0, 64), Buffer.alloc(64)]);
  await assert.rejects(
    optimizeImage({ bytes: broken, preset: "achievement" }),
    (error: unknown) => error instanceof ImageValidationError
  );
});

test("rejeita arquivo maior que o limite e dimensões absurdas", async () => {
  await assert.rejects(
    optimizeImage({ bytes: Buffer.alloc(5 * 1024 * 1024, 1), preset: "achievement" }),
    (error: unknown) => error instanceof ImageValidationError && error.status === 413
  );
  const wide = await sharp({ create: { width: 12000, height: 2, channels: 3, background: "#000" } }).png().toBuffer();
  await assert.rejects(
    optimizeImage({ bytes: wide, preset: "banner" }),
    (error: unknown) => error instanceof ImageValidationError && error.status === 413
  );
});

test("rejeita arquivo vazio", async () => {
  await assert.rejects(
    optimizeImage({ bytes: new Uint8Array(), preset: "achievement" }),
    (error: unknown) => error instanceof ImageValidationError
  );
});

test("o mesmo conteúdo gera sempre o mesmo hash (deduplicação)", async () => {
  const input = readFileSync(ACHIEVEMENT);
  const first = await optimizeImage({ bytes: input, preset: "achievement" });
  const second = await optimizeImage({ bytes: input, preset: "achievement" });
  assert.equal(first.contentHash, second.contentHash);
});

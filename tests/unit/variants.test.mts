// Cópias leves usadas pelas páginas: mapa coerente, arquivos existentes e fallback seguro.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { createVariantLookup, fallbackToOriginal } from "../../lib/images/variantLookup.ts";

const variants: Record<string, string> = JSON.parse(readFileSync("data/homeImageVariants.json", "utf8"));
const lookup = createVariantLookup(variants);
const MOUSE_12 =
  "https://mjrbqsgdtssedjldenzo.supabase.co/storage/v1/object/public/achievement-art/games/mouse-p-i-for-hire/achievements/12-hora-do-b-a-n-g.png";

test("toda cópia listada existe, é WebP e é menor que o original local", async () => {
  for (const [source, variant] of Object.entries(variants)) {
    const file = `public${variant}`;
    assert.ok(existsSync(file), `cópia ausente: ${variant}`);
    assert.match(variant, /\.webp$/);
    assert.equal((await sharp(file).metadata()).format, "webp", variant);
    if (source.startsWith("/")) {
      const original = `public${source.replace(/#large$/, "")}`;
      assert.ok(existsSync(original), `original ausente: ${source}`);
      assert.ok(readFileSync(file).byteLength < readFileSync(original).byteLength, `cópia não é menor: ${variant}`);
    }
  }
});

test("arte do Mouse (12-hora-do-b-a-n-g) tem cópia leve; URLs desconhecidas ficam intactas", () => {
  assert.equal(lookup.homeImageSrc(MOUSE_12), "/images/home/mouse-p-i-for-hire-12-hora-do-b-a-n-g.webp");
  // Arte reenviada (URL nova) não pode cair na cópia antiga, que mostraria a arte anterior.
  assert.equal(lookup.homeImageSrc(`${MOUSE_12}?v=999`), `${MOUSE_12}?v=999`);
  const immutable = "https://x.supabase.co/storage/v1/object/public/achievement-art/games/a/achievements/01-a.0123456789abcdef.webp";
  assert.equal(lookup.homeImageSrc(immutable), immutable);
});

test("candidatos: cópia leve primeiro, original como reserva, sem repetidos", () => {
  assert.deepEqual(lookup.lightImageCandidates([MOUSE_12, "", null, MOUSE_12]), [
    "/images/home/mouse-p-i-for-hire-12-hora-do-b-a-n-g.webp",
    MOUSE_12,
  ]);
  assert.deepEqual(lookup.lightImageCandidates(["/sem/copia.png"]), ["/sem/copia.png"]);
});

test("cópias de destaque (#large) e imagens novas desta etapa", () => {
  assert.equal(lookup.largeImageSrc("/images/games/emblem.png"), "/images/game-page/default-emblem.webp");
  for (const source of [
    "/images/games/emblem.png",
    "/images/trophies/bronze.png",
    "/images/jogos-bg.png",
    "/images/activity-banner-bg.png",
    "/images/games/monster-hunter-world-iceborne/achievements/cacada-suprema.png",
  ]) {
    assert.notEqual(lookup.homeImageSrc(source), source, source);
  }
});

test("fallback: troca uma vez para o original e depois repassa o erro", () => {
  const attributes: Record<string, string> = { src: "/images/home/x.webp" };
  const image = {
    dataset: {} as Record<string, string>,
    getAttribute: (name: string) => attributes[name] ?? null,
    set src(value: string) {
      attributes.src = value;
    },
  } as unknown as HTMLImageElement;
  let forwarded = 0;
  const handler = fallbackToOriginal("/images/games/x.png", () => {
    forwarded += 1;
  });

  handler({ currentTarget: image });
  assert.equal(attributes.src, "/images/games/x.png");
  assert.equal(forwarded, 0);

  handler({ currentTarget: image });
  assert.equal(forwarded, 1, "o original também falhou: o componente decide o que mostrar");
});

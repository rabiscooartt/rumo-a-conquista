// Reenvio e ativação de banners e avatar, com Supabase Storage SIMULADO em memória.
// Nenhum teste acessa a rede ou buckets reais.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { optimizeImage, type OptimizedImage } from "../../lib/images/optimizeImage.ts";
import { pickLatestStoredImage } from "../../lib/images/naming.ts";
import {
  ACTIVE_POINTER_BUCKET,
  AVATAR_IMAGE_TARGET,
  bannerImageTarget,
  getActiveStoredImageUrl,
  readActivePointer,
  replaceActiveImage,
  resolveActiveStoredImage,
  updateActiveFraming,
  withActiveFraming,
  type StorageReader,
} from "../../lib/images/storedImages.ts";

const BASE = "https://exemplo.supabase.co/storage/v1/object/public";

type StoredObject = { body: Buffer; created_at: string; updated_at: string; cacheControl: string; contentType: string };

/** Storage em memória com o comportamento relevante do Supabase (upsert, 409, list, download). */
function createStorage(options: { failUploadsTo?: RegExp } = {}) {
  const objects = new Map<string, StoredObject>(); // chave: "<bucket>/<path>"
  let clock = Date.parse("2026-11-13T10:00:00Z");
  const tick = () => new Date((clock += 1000)).toISOString();
  const writes: string[] = [];
  let failUploadsTo = options.failUploadsTo;

  const client: StorageReader = {
    storage: {
      from(bucket: string) {
        return {
          async upload(path, body, uploadOptions) {
            const key = `${bucket}/${path}`;
            if (failUploadsTo?.test(key)) return { error: { message: `falha simulada em ${key}` } };
            const existing = objects.get(key);
            if (existing && !uploadOptions.upsert) {
              return { error: { message: "The resource already exists", statusCode: "409" } as { message: string } };
            }
            const bytes =
              body instanceof Blob ? Buffer.from(await body.arrayBuffer()) : Buffer.from(body as Uint8Array);
            const now = tick();
            // Como no Supabase: sobrescrever mantém created_at e muda updated_at.
            objects.set(key, {
              body: bytes,
              created_at: existing?.created_at ?? now,
              updated_at: now,
              cacheControl: uploadOptions.cacheControl,
              contentType: uploadOptions.contentType,
            });
            writes.push(key);
            return { error: null };
          },
          async download(path: string) {
            const object = objects.get(`${bucket}/${path}`);
            return object
              ? { data: new Blob([new Uint8Array(object.body)]), error: null }
              : { data: null, error: { message: "Object not found" } };
          },
          async list(folder: string) {
            const prefix = `${bucket}/${folder}/`;
            const data = [...objects.entries()]
              .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
              .map(([key, object]) => ({ name: key.slice(prefix.length), created_at: object.created_at, updated_at: object.updated_at }));
            return { data, error: null };
          },
          getPublicUrl(path: string) {
            return { data: { publicUrl: `${BASE}/${bucket}/${path}` } };
          },
        };
      },
    },
  };

  return {
    client,
    objects,
    writes,
    setFailUploadsTo(pattern: RegExp | undefined) {
      failUploadsTo = pattern;
    },
    imageFiles(bucket: string, folder: string) {
      return [...objects.keys()].filter((key) => key.startsWith(`${bucket}/${folder}/`) && key.endsWith(".webp"));
    },
  };
}

async function solid(color: string): Promise<OptimizedImage> {
  const png = await sharp({ create: { width: 640, height: 360, channels: 3, background: color } }).png().toBuffer();
  return optimizeImage({ bytes: png, declaredMime: "image/png", preset: "banner" });
}

const red = await solid("#c0392b");
const blue = await solid("#2c3e8f");
const HOME = bannerImageTarget("home");
const FRAMING_A = { x: 10, y: -5, zoom: 1.2 };
const FRAMING_B = { x: -20, y: 15, zoom: 1.6 };
const homeUrl = (image: OptimizedImage) =>
  `${BASE}/site-banners/banners/home/background.${image.contentHash.slice(0, 16)}.webp`;

test("1. primeiro envio: grava o WebP imutável com cache de 1 ano e o ativa", async () => {
  const storage = createStorage();
  const result = await replaceActiveImage(storage.client, HOME, red);

  assert.equal(result.deduplicated, false);
  assert.equal(await getActiveStoredImageUrl(storage.client, HOME), homeUrl(red));
  const image = storage.objects.get(`site-banners/banners/home/${result.fileName}`)!;
  assert.equal(image.cacheControl, "31536000");
  assert.equal(image.contentType, "image/webp");
  const pointer = storage.objects.get(`${ACTIVE_POINTER_BUCKET}/active/banner-home.json`)!;
  assert.equal(pointer.cacheControl, "0", "o ponteiro é mutável e não pode ficar em cache");
  assert.equal(JSON.parse(pointer.body.toString()).file, result.fileName);
});

test("2. reenvio da mesma imagem: não duplica nem sobrescreve, e ela continua ativa", async () => {
  const storage = createStorage();
  await replaceActiveImage(storage.client, HOME, red);
  const original = storage.objects.get(`site-banners/banners/home/background.${red.contentHash.slice(0, 16)}.webp`)!;
  const before = { ...original };

  const again = await replaceActiveImage(storage.client, HOME, red);
  assert.equal(again.deduplicated, true);
  assert.equal(storage.imageFiles("site-banners", "banners/home").length, 1);
  assert.deepEqual(
    storage.objects.get(`site-banners/banners/home/${again.fileName}`),
    before,
    "o arquivo imutável não foi regravado"
  );
  assert.equal(await getActiveStoredImageUrl(storage.client, HOME), homeUrl(red));
});

test("3. voltar a uma imagem usada antes: A → B → A deixa A ativa, com 2 arquivos", async () => {
  const storage = createStorage();
  await replaceActiveImage(storage.client, HOME, red);
  await replaceActiveImage(storage.client, HOME, blue);
  assert.equal(await getActiveStoredImageUrl(storage.client, HOME), homeUrl(blue));

  const back = await replaceActiveImage(storage.client, HOME, red);
  assert.equal(back.deduplicated, true);
  assert.equal(await getActiveStoredImageUrl(storage.client, HOME), homeUrl(red));
  assert.equal(storage.imageFiles("site-banners", "banners/home").length, 2);
});

test("4. imagem diferente: novo arquivo, ativa a nova e mantém a anterior guardada", async () => {
  const storage = createStorage();
  await replaceActiveImage(storage.client, HOME, red);
  const second = await replaceActiveImage(storage.client, HOME, blue);
  assert.equal(second.deduplicated, false);
  assert.equal(await getActiveStoredImageUrl(storage.client, HOME), homeUrl(blue));
  assert.equal(storage.imageFiles("site-banners", "banners/home").length, 2);
});

test("5. falha no envio: erro propagado, nada é ativado e a imagem anterior continua", async () => {
  const storage = createStorage();
  await replaceActiveImage(storage.client, HOME, red, { framing: FRAMING_A });
  storage.setFailUploadsTo(/^site-banners\//);

  let compatibilitySaved = false;
  await assert.rejects(
    replaceActiveImage(storage.client, HOME, blue, {
      framing: FRAMING_B,
      afterActivate: async () => void (compatibilitySaved = true),
    }),
    /falha simulada/
  );
  assert.equal(compatibilitySaved, false, "nada é salvo se a imagem não subiu");
  assert.deepEqual(await resolveActiveStoredImage(storage.client, HOME), {
    url: homeUrl(red),
    framing: FRAMING_A,
    source: "pointer",
  });
});

test("6. falha ao atualizar o ponteiro: imagem e enquadramento anteriores continuam juntos", async () => {
  const storage = createStorage();
  await replaceActiveImage(storage.client, HOME, red, { framing: FRAMING_A });
  storage.setFailUploadsTo(/^site-profile\/active\//);

  let compatibilitySaved = false;
  await assert.rejects(
    replaceActiveImage(storage.client, HOME, blue, {
      framing: FRAMING_B,
      afterActivate: async () => void (compatibilitySaved = true),
    }),
    /falha simulada/
  );
  assert.equal(compatibilitySaved, false, "a cópia de compatibilidade não recebe o enquadramento novo");
  assert.deepEqual(await resolveActiveStoredImage(storage.client, HOME), {
    url: homeUrl(red),
    framing: FRAMING_A,
    source: "pointer",
  });

  // Só o enquadramento, com o ponteiro falhando: nada muda.
  await assert.rejects(updateActiveFraming(storage.client, HOME, FRAMING_B), /falha simulada/);
  assert.deepEqual((await resolveActiveStoredImage(storage.client, HOME)).framing, FRAMING_A);

  // O arquivo novo já enviado fica guardado; repetir o envio reaproveita e ativa.
  storage.setFailUploadsTo(undefined);
  const retry = await replaceActiveImage(storage.client, HOME, blue, { framing: FRAMING_B });
  assert.equal(retry.deduplicated, true);
  assert.deepEqual(await resolveActiveStoredImage(storage.client, HOME), {
    url: homeUrl(blue),
    framing: FRAMING_B,
    source: "pointer",
  });
});

test("falha ao salvar as configurações (cópia de compatibilidade): imagem e enquadramento novos continuam vinculados", async () => {
  const storage = createStorage();
  await replaceActiveImage(storage.client, HOME, red, { framing: FRAMING_A });

  await assert.rejects(
    replaceActiveImage(storage.client, HOME, blue, {
      framing: FRAMING_B,
      afterActivate: async () => {
        throw new Error("banco indisponível");
      },
    }),
    /banco indisponível/
  );
  // O ponteiro já ativou imagem + enquadramento juntos; a tabela desatualizada não é usada.
  const active = await resolveActiveStoredImage(storage.client, HOME);
  assert.deepEqual(active, { url: homeUrl(blue), framing: FRAMING_B, source: "pointer" });
  const staleTable = { x: 0, y: 0, zoom: 1 };
  assert.deepEqual(withActiveFraming(staleTable, active), FRAMING_B);
});

test("consistência: enquadramento novo sem troca de imagem fica com a imagem ativa", async () => {
  const storage = createStorage();
  await replaceActiveImage(storage.client, HOME, red, { framing: FRAMING_A });
  assert.equal(await updateActiveFraming(storage.client, HOME, FRAMING_B), true);
  assert.deepEqual(await resolveActiveStoredImage(storage.client, HOME), {
    url: homeUrl(red),
    framing: FRAMING_B,
    source: "pointer",
  });

  // Sem ponteiro (dados antigos), nada é criado: vale só a cópia de compatibilidade.
  const legacy = createStorage();
  assert.equal(await updateActiveFraming(legacy.client, HOME, FRAMING_B), false);
  assert.equal(legacy.objects.size, 0);
});

test("ponteiro para arquivo removido: volta para a versão anterior que ainda existe", async () => {
  const storage = createStorage();
  await replaceActiveImage(storage.client, HOME, red, { framing: FRAMING_A });
  await replaceActiveImage(storage.client, HOME, blue, { framing: FRAMING_B });

  // Remoção manual no painel do arquivo ativo (blue).
  storage.objects.delete(`site-banners/banners/home/background.${blue.contentHash.slice(0, 16)}.webp`);

  const active = await resolveActiveStoredImage(storage.client, HOME);
  assert.equal(active.url, homeUrl(red));
  assert.equal(active.source, "fallback");
  assert.equal(active.framing, null, "o enquadramento do ponteiro era da imagem removida");
  // Nada é apagado nem regravado pela leitura: o ponteiro continua como estava.
  assert.equal(JSON.parse(storage.objects.get("site-profile/active/banner-home.json")!.body.toString()).file, `background.${blue.contentHash.slice(0, 16)}.webp`);
});

test("ponteiro para arquivo removido: volta para a imagem legada", async () => {
  const storage = createStorage();
  await storage.client.storage.from("site-banners").upload!("banners/home/background", Buffer.from("png"), {
    contentType: "image/png",
    cacheControl: "60",
    upsert: true,
  });
  const legacy = storage.objects.get("site-banners/banners/home/background")!;
  await replaceActiveImage(storage.client, HOME, blue, { framing: FRAMING_B });
  storage.objects.delete(`site-banners/banners/home/background.${blue.contentHash.slice(0, 16)}.webp`);

  const active = await resolveActiveStoredImage(storage.client, HOME);
  assert.equal(active.source, "fallback");
  assert.equal(active.url, `${BASE}/site-banners/banners/home/background?v=${encodeURIComponent(legacy.updated_at)}`);
  assert.deepEqual(storage.objects.get("site-banners/banners/home/background"), legacy, "o legado não é tocado");

  // Sem nenhuma imagem restante: vazio (a página usa a imagem padrão), nunca uma URL quebrada.
  storage.objects.delete("site-banners/banners/home/background");
  assert.deepEqual(await resolveActiveStoredImage(storage.client, HOME), { url: "", framing: null, source: "none" });
});

test("listagem indisponível: confia no ponteiro em vez de esconder a imagem", async () => {
  const storage = createStorage();
  await replaceActiveImage(storage.client, HOME, red, { framing: FRAMING_A });
  const failingList: StorageReader = {
    storage: {
      from(bucket: string) {
        const api = storage.client.storage.from(bucket);
        return { ...api, list: async () => ({ data: null, error: new Error("offline") }) };
      },
    },
  };
  assert.deepEqual(await resolveActiveStoredImage(failingList, HOME), {
    url: homeUrl(red),
    framing: FRAMING_A,
    source: "pointer",
  });
});

test("7. seleção determinística", async () => {
  // Com ponteiro: vale o ponteiro, mesmo que outro arquivo seja mais recente.
  const storage = createStorage();
  await replaceActiveImage(storage.client, HOME, blue);
  await replaceActiveImage(storage.client, HOME, red); // red ativo
  const blueKey = `site-banners/banners/home/background.${blue.contentHash.slice(0, 16)}.webp`;
  storage.objects.get(blueKey)!.created_at = "2030-01-01T00:00:00Z";
  storage.objects.get(blueKey)!.updated_at = "2030-01-01T00:00:00Z";
  assert.equal(await getActiveStoredImageUrl(storage.client, HOME), homeUrl(red));

  // Sem ponteiro: mesma escolha qualquer que seja a ordem da listagem, inclusive em empates.
  const sameTime = "2026-11-12T00:00:00Z";
  const files = [
    { name: "background", created_at: sameTime, updated_at: sameTime },
    { name: "background.aaaaaaaaaaaaaaaa.webp", created_at: sameTime, updated_at: sameTime },
    { name: "background.bbbbbbbbbbbbbbbb.webp", created_at: sameTime, updated_at: sameTime },
  ];
  const expected = "background.bbbbbbbbbbbbbbbb.webp";
  for (const order of [[0, 1, 2], [2, 1, 0], [1, 0, 2], [1, 2, 0], [0, 2, 1], [2, 0, 1]]) {
    assert.equal(pickLatestStoredImage(order.map((index) => files[index]), "background")?.name, expected);
  }

  // Legado sobrescrito (created_at antigo, updated_at novo) conta pela última modificação.
  assert.equal(
    pickLatestStoredImage(
      [
        { name: "background", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-11-20T00:00:00Z" },
        { name: "background.aaaaaaaaaaaaaaaa.webp", created_at: "2026-11-15T00:00:00Z", updated_at: "2026-11-15T00:00:00Z" },
      ],
      "background"
    )?.name,
    "background"
  );
});

test("8. compatibilidade: banner e avatar legados sem ponteiro continuam iguais", async () => {
  const storage = createStorage();
  // Arquivos antigos, como estão hoje no Storage: sem extensão e sem ponteiro.
  await storage.client.storage.from("site-banners").upload!("banners/emblemas/background", Buffer.from("png"), {
    contentType: "image/png",
    cacheControl: "60",
    upsert: true,
  });
  await storage.client.storage.from("site-profile").upload!("profile/avatar", Buffer.from("jpg"), {
    contentType: "image/jpeg",
    cacheControl: "60",
    upsert: true,
  });
  const legacyBanner = storage.objects.get("site-banners/banners/emblemas/background")!;
  const legacyAvatar = storage.objects.get("site-profile/profile/avatar")!;

  // Mesmo formato de URL de antes ("?v=<updated_at>"), que é a chave das cópias leves.
  assert.equal(
    await getActiveStoredImageUrl(storage.client, bannerImageTarget("emblemas")),
    `${BASE}/site-banners/banners/emblemas/background?v=${encodeURIComponent(legacyBanner.updated_at)}`
  );
  assert.equal(
    await getActiveStoredImageUrl(storage.client, AVATAR_IMAGE_TARGET),
    `${BASE}/site-profile/profile/avatar?v=${encodeURIComponent(legacyAvatar.updated_at)}`
  );

  // Sem nenhuma imagem: string vazia (a página usa a imagem padrão).
  assert.equal(await getActiveStoredImageUrl(storage.client, bannerImageTarget("jogos")), "");

  // Primeiro envio novo do avatar passa a valer; o legado não é tocado.
  const photo = await optimizeImage({ bytes: readFileSync("public/images/avatar.jpg"), preset: "avatar" });
  await replaceActiveImage(storage.client, AVATAR_IMAGE_TARGET, photo);
  assert.equal(
    await getActiveStoredImageUrl(storage.client, AVATAR_IMAGE_TARGET),
    `${BASE}/site-profile/profile/avatar.${photo.contentHash.slice(0, 16)}.webp`
  );
  assert.deepEqual(storage.objects.get("site-profile/profile/avatar"), legacyAvatar);
});

test("ponteiro corrompido ou de outra imagem é ignorado com segurança", async () => {
  const storage = createStorage();
  await storage.client.storage.from("site-banners").upload!("banners/home/background", Buffer.from("png"), {
    contentType: "image/png",
    cacheControl: "60",
    upsert: true,
  });
  const pointers = storage.client.storage.from(ACTIVE_POINTER_BUCKET);
  for (const content of ["{não é json", JSON.stringify({ file: "../../segredo.webp" }), JSON.stringify({ file: "avatar.0123456789abcdef.webp" })]) {
    await pointers.upload!("active/banner-home.json", Buffer.from(content), {
      contentType: "application/json",
      cacheControl: "0",
      upsert: true,
    });
    assert.equal(await readActivePointer(storage.client, HOME), null, content);
    assert.match(await getActiveStoredImageUrl(storage.client, HOME), /\/banners\/home\/background\?v=/);
  }
});

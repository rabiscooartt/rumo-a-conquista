// Envio ao Storage, nomes imutáveis e leitura de banners/avatar, com Supabase SIMULADO.
// Nenhum teste acessa a rede ou buckets reais.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { optimizeImage } from "../../lib/images/optimizeImage.ts";
import { uploadOptimizedImage, type StorageBucketApi } from "../../lib/images/storage.ts";
import {
  immutableImageName,
  isImmutableImageName,
  pickLatestStoredImage,
  safeImageBaseName,
  storedImageUrl,
  stripImageVersion,
} from "../../lib/images/naming.ts";
import { bannerImageTarget, getActiveStoredImageUrl } from "../../lib/images/storedImages.ts";

const BASE_URL = "https://exemplo.supabase.co/storage/v1/object/public/bucket";

function mockBucket(options: { existing?: Set<string>; failWith?: string } = {}) {
  const calls: Array<{ path: string; options: Record<string, unknown>; bytes: number }> = [];
  const existing = options.existing ?? new Set<string>();
  const bucket: StorageBucketApi = {
    async upload(path, body, uploadOptions) {
      calls.push({ path, options: uploadOptions, bytes: (body as Buffer).byteLength });
      if (options.failWith) return { error: { message: options.failWith, statusCode: "500" } };
      if (existing.has(path) && !uploadOptions.upsert) {
        return { error: { message: "The resource already exists", statusCode: "409" } };
      }
      existing.add(path);
      return { error: null };
    },
    getPublicUrl(path) {
      return { data: { publicUrl: `${BASE_URL}/${path}` } };
    },
  };
  return { bucket, calls, existing };
}

const optimized = await optimizeImage({
  bytes: readFileSync("public/images/games/mouse-p-i-for-hire/achievements/maestria-final.png"),
  preset: "achievement",
});

test("envia só o WebP, com nome por hash, cache de 1 ano e sem sobrescrever", async () => {
  const { bucket, calls } = mockBucket();
  const stored = await uploadOptimizedImage(bucket, "games/mouse/achievements", "12-Hora do B.A.N.G!.png", optimized);

  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.match(call.path, /^games\/mouse\/achievements\/12-Hora-do-B-A-N-G\.[0-9a-f]{16}\.webp$/);
  assert.equal(call.path.split(".")[1], optimized.contentHash.slice(0, 16));
  assert.deepEqual(call.options, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
  assert.equal(call.bytes, optimized.optimizedBytes);
  assert.equal(stored.publicUrl, `${BASE_URL}/${call.path}`);
  assert.ok(!stored.publicUrl.includes("?v="), "URL imutável dispensa ?v=");
  assert.equal(stored.deduplicated, false);
});

test("reenvio do mesmo conteúdo reaproveita o arquivo existente", async () => {
  const mock = mockBucket();
  const first = await uploadOptimizedImage(mock.bucket, "banners/home", "background", optimized);
  const second = await uploadOptimizedImage(mock.bucket, "banners/home", "background", optimized);
  assert.equal(second.path, first.path);
  assert.equal(second.deduplicated, true);
  assert.equal(mock.existing.size, 1);
});

test("outros erros do Storage são propagados", async () => {
  const { bucket } = mockBucket({ failWith: "bucket indisponível" });
  await assert.rejects(uploadOptimizedImage(bucket, "banners/home", "background", optimized), /bucket indisponível/);
});

test("pasta de destino com '..' é recusada", async () => {
  const { bucket } = mockBucket();
  await assert.rejects(uploadOptimizedImage(bucket, "games/../segredos", "x", optimized), /inválida/);
});

test("nomes imutáveis e compatibilidade com nomes antigos", () => {
  const name = immutableImageName("01-Mestre dos Macetes.png", "a".repeat(64));
  assert.equal(name, "01-Mestre-dos-Macetes.aaaaaaaaaaaaaaaa.webp");
  assert.equal(isImmutableImageName(name), true);
  assert.equal(isImmutableImageName(`${BASE_URL}/x/${name}`), true);
  assert.equal(isImmutableImageName("01-mestre-dos-macetes.png?v=123"), false);
  assert.equal(stripImageVersion(name), "01-Mestre-dos-Macetes");
  assert.equal(stripImageVersion("01-legado.png"), "01-legado.png");
  assert.equal(safeImageBaseName("Ação Épica.JPG"), "Acao-Epica");
  assert.equal(safeImageBaseName("../../etc/passwd"), "etc-passwd");
  assert.throws(() => immutableImageName("x", "nao-hex"));
});

test("banner: escolhe a versão mais recente entre a legada e as imutáveis", () => {
  const files = [
    { name: "background", created_at: "2026-10-20T00:00:00Z", updated_at: "2026-10-20T00:00:00Z" },
    { name: "background.1111111111111111.webp", created_at: "2026-11-10T00:00:00Z" },
    { name: "background.2222222222222222.webp", created_at: "2026-11-12T00:00:00Z" },
    { name: "outra.png", created_at: "2026-12-01T00:00:00Z" },
  ];
  assert.equal(pickLatestStoredImage(files, "background")?.name, "background.2222222222222222.webp");
  assert.equal(pickLatestStoredImage(files.slice(0, 1), "background")?.name, "background");
  assert.equal(pickLatestStoredImage([], "background"), null);

  // Legado mais novo que a versão WebP (ex.: substituído manualmente no painel) continua valendo.
  const legacyNewer = [
    { name: "background.1111111111111111.webp", created_at: "2026-11-10T00:00:00Z" },
    { name: "background", created_at: "2026-11-11T00:00:00Z", updated_at: "2026-11-11T00:00:00Z" },
  ];
  assert.equal(pickLatestStoredImage(legacyNewer, "background")?.name, "background");
});

test("URL: legado mantém ?v=<data>; imutável não usa ?v=", () => {
  assert.equal(
    storedImageUrl(`${BASE_URL}/banners/home/background`, { name: "background", updated_at: "2026-10-24T20:34:56Z" }),
    `${BASE_URL}/banners/home/background?v=2026-10-24T20%3A34%3A56Z`
  );
  assert.equal(
    storedImageUrl(`${BASE_URL}/banners/home/background.1111111111111111.webp`, {
      name: "background.1111111111111111.webp",
      updated_at: "2026-11-12T00:00:00Z",
    }),
    `${BASE_URL}/banners/home/background.1111111111111111.webp`
  );
});

test("leitura do banner pelo cliente simulado e falhas silenciosas", async () => {
  const listed: string[] = [];
  const client = {
    storage: {
      from: (bucket: string) => ({
        async list(path: string) {
          listed.push(`${bucket}/${path}`);
          return {
            data: [
              { name: "background", created_at: "2026-10-20T00:00:00Z", updated_at: "2026-10-20T00:00:00Z" },
              { name: "background.3333333333333333.webp", created_at: "2026-11-12T00:00:00Z" },
            ],
            error: null,
          };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `${BASE_URL}/${path}` } }),
      }),
    },
  };
  // Cliente sem download: não há ponteiro, então vale a regra de compatibilidade.
  assert.equal(
    await getActiveStoredImageUrl(client, bannerImageTarget("emblemas")),
    `${BASE_URL}/banners/emblemas/background.3333333333333333.webp`
  );
  assert.deepEqual(listed, ["site-banners/banners/emblemas"]);

  const failing = {
    storage: {
      from: () => ({
        list: async () => ({ data: null, error: new Error("offline") }),
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
      }),
    },
  };
  assert.equal(await getActiveStoredImageUrl(failing, bannerImageTarget("home")), "");
});

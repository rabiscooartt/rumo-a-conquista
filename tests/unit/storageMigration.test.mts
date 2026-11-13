// Migração do Storage com Supabase SIMULADO em memória. Nenhum teste acessa a rede.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import {
  buildMigrationSql,
  collectLegacyObjects,
  createLocalVariantIndex,
  latestRecords,
  matchLocalVariant,
  migrateObject,
  scanLegacyObjects,
  type MigrationClient,
  type MigrationRecord,
} from "../../lib/images/storageMigration.ts";
import { bannerImageTarget, replaceActiveImage, resolveActiveStoredImage, type StorageReader } from "../../lib/images/storedImages.ts";
import { optimizeImage } from "../../lib/images/optimizeImage.ts";

const BASE = "https://exemplo.supabase.co/storage/v1/object/public";

type Stored = { body: Buffer; created_at: string; updated_at: string };

function createStorage(options: { corruptUploads?: boolean; failDownloads?: RegExp; failList?: RegExp } = {}) {
  const objects = new Map<string, Stored>();
  let clock = Date.parse("2026-11-13T10:00:00Z");
  const tick = () => new Date((clock += 1000)).toISOString();
  const uploads: string[] = [];
  const downloads: string[] = [];

  const client: MigrationClient = {
    storage: {
      from(bucket: string) {
        return {
          async list(folder: string, opts: { limit?: number; offset?: number; search?: string } = {}) {
            if (options.failList?.test(`${bucket}/${folder}`)) return { data: null, error: { message: "falha de listagem simulada" } };
            const prefix = `${bucket}/${folder}/`;
            const entries = new Map<string, { name: string; id: string | null; created_at?: string; updated_at?: string; metadata?: { size: number } | null }>();
            for (const [key, object] of objects) {
              if (!key.startsWith(prefix)) continue;
              const rest = key.slice(prefix.length);
              const [first, ...deeper] = rest.split("/");
              if (deeper.length > 0) entries.set(first, { name: first, id: null, metadata: null });
              else entries.set(first, { name: first, id: `id-${key}`, created_at: object.created_at, updated_at: object.updated_at, metadata: { size: object.body.byteLength } });
            }
            let data = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
            if (opts.search) data = data.filter((entry) => entry.name.includes(opts.search!));
            const offset = opts.offset ?? 0;
            return { data: data.slice(offset, offset + (opts.limit ?? 100)), error: null };
          },
          async download(path: string) {
            const key = `${bucket}/${path}`;
            downloads.push(key);
            if (options.failDownloads?.test(key)) return { data: null, error: { message: "falha simulada" } };
            const object = objects.get(key);
            return object ? { data: new Blob([new Uint8Array(object.body)]), error: null } : { data: null, error: { message: "not found" } };
          },
          async upload(path: string, body: Buffer | Blob | ArrayBuffer | Uint8Array, opts: { upsert: boolean }) {
            const key = `${bucket}/${path}`;
            const existing = objects.get(key);
            if (existing && !opts.upsert) return { error: { message: "The resource already exists", statusCode: "409" } };
            let bytes = body instanceof Blob ? Buffer.from(await body.arrayBuffer()) : Buffer.from(body as Uint8Array);
            if (options.corruptUploads && key.endsWith(".webp")) bytes = bytes.subarray(0, 10);
            const now = tick();
            objects.set(key, { body: bytes, created_at: existing?.created_at ?? now, updated_at: now });
            uploads.push(key);
            return { error: null };
          },
          getPublicUrl(path: string) {
            return { data: { publicUrl: `${BASE}/${bucket}/${path}` } };
          },
        };
      },
    },
  };

  const put = (key: string, body: Buffer) => {
    const now = tick();
    objects.set(key, { body, created_at: now, updated_at: now });
  };
  return { client, objects, uploads, downloads, put };
}

const png = (color: string, width = 1254, height = 1254) =>
  sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
// PNG grande (ruído não comprime): ~6 MB, acima do limite de 4 MB dos uploads e abaixo dos 10 MB do bucket.
async function noisePng(width: number, height: number) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 2654435761) >>> 24;
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
}

const ART = "achievement-art/games/mouse/achievements";

test("identifica só os objetos legados e seus destinos", async () => {
  const storage = createStorage();
  storage.put(`${ART}/01-mestre.png`, await png("#a33"));
  storage.put(`${ART}/02-taco.jpg`, await sharp({ create: { width: 50, height: 50, channels: 3, background: "#333" } }).jpeg().toBuffer());
  storage.put(`${ART}/03-ja-otimizada.0123456789abcdef.webp`, Buffer.from("x"));
  storage.put(`${ART}/.emptyFolderPlaceholder`, Buffer.from(""));
  storage.put("site-banners/banners/emblemas/background", await png("#123", 2560, 1440));
  storage.put("site-banners/banners/home/background.0123456789abcdef.webp", Buffer.from("x"));
  storage.put("site-profile/profile/avatar", await png("#555", 800, 800));
  storage.put("site-profile/profile/settings.json", Buffer.from("{}"));

  const keys = (await collectLegacyObjects(storage.client)).map((item) => `${item.kind}:${item.key}`);
  assert.deepEqual(keys, [
    "achievement:achievement-art/games/mouse/achievements/01-mestre.png",
    "achievement:achievement-art/games/mouse/achievements/02-taco.jpg",
    "fixed:site-banners/banners/emblemas/background",
    "fixed:site-profile/profile/avatar",
  ]);
});

test("listagem paginada: mais de 1000 arquivos numa pasta", async () => {
  const storage = createStorage();
  for (let i = 0; i < 1005; i += 1) storage.put(`${ART}/${String(i).padStart(4, "0")}-arte.png`, Buffer.from("p"));
  assert.equal((await collectLegacyObjects(storage.client)).length, 1005);
});

test("migra arte de conquista: WebP conferido, original intacto, destino determinístico", async () => {
  const storage = createStorage();
  const original = await png("#a33");
  storage.put(`${ART}/01-mestre.png`, original);
  const [item] = await collectLegacyObjects(storage.client);

  const record = await migrateObject(storage.client, item, { apply: true });
  assert.equal(record.status, "migrated", record.reason);
  assert.match(record.newPath!, /^games\/mouse\/achievements\/01-mestre\.[0-9a-f]{16}\.webp$/);
  assert.equal(record.oldUrl, `${BASE}/${ART}/01-mestre.png`);
  assert.equal(record.newUrl, `${BASE}/achievement-art/${record.newPath}`);
  assert.ok(storage.objects.get(`${ART}/01-mestre.png`)!.body.equals(original), "original preservado byte a byte");
  const meta = await sharp(storage.objects.get(`achievement-art/${record.newPath}`)!.body).metadata();
  assert.equal(meta.format, "webp");
  assert.deepEqual([meta.width, meta.height], [256, 256]);
});

test("idempotência: repetir a migração não duplica nem sobrescreve", async () => {
  const storage = createStorage();
  storage.put(`${ART}/01-mestre.png`, await png("#a33"));
  const [item] = await collectLegacyObjects(storage.client);
  const first = await migrateObject(storage.client, item, { apply: true });
  const stored = { ...storage.objects.get(`achievement-art/${first.newPath}`)! };
  const second = await migrateObject(storage.client, item, { apply: true });

  assert.equal(second.status, "migrated");
  assert.equal(second.newPath, first.newPath);
  assert.equal(second.deduplicated, true);
  assert.equal(storage.uploads.length, 1);
  assert.deepEqual(storage.objects.get(`achievement-art/${first.newPath}`), stored);
});

test("modo plano: mede sem enviar nada", async () => {
  const storage = createStorage();
  storage.put(`${ART}/01-mestre.png`, await png("#a33"));
  const [item] = await collectLegacyObjects(storage.client);
  const record = await migrateObject(storage.client, item, { apply: false });
  assert.equal(record.status, "planned");
  assert.ok(record.optimizedBytes! < record.originalBytes!);
  assert.equal(storage.uploads.length, 0);
});

test("erros por objeto não interrompem os demais e ficam registrados", async () => {
  const storage = createStorage({ failDownloads: /02-quebrada/ });
  storage.put(`${ART}/01-boa.png`, await png("#a33"));
  storage.put(`${ART}/02-quebrada.png`, await png("#3a3"));
  storage.put(`${ART}/03-nao-e-imagem.png`, Buffer.from("texto qualquer"));
  storage.put(`${ART}/04-boa.png`, await png("#33a"));

  const records = [];
  for (const item of await collectLegacyObjects(storage.client)) records.push(await migrateObject(storage.client, item, { apply: true }));
  assert.deepEqual(records.map((record) => record.status), ["migrated", "error", "error", "migrated"]);
  assert.match(records[1].reason!, /download/);
  assert.match(records[2].reason!, /PNG, JPG ou WEBP/);
});

test("aceita originais de até 10 MB (limite do bucket) e recusa acima disso", async () => {
  const storage = createStorage();
  const big = await noisePng(1500, 1500); // ~6,7 MB
  assert.ok(big.byteLength > 4 * 1024 * 1024 && big.byteLength < 10 * 1024 * 1024, `tamanho do teste: ${big.byteLength}`);
  storage.put(`${ART}/01-grande.png`, big);
  const huge = await noisePng(2000, 1800); // ~10,8 MB
  assert.ok(huge.byteLength > 10 * 1024 * 1024, `tamanho do teste: ${huge.byteLength}`);
  storage.put(`${ART}/02-enorme.png`, huge);

  const [bigItem, hugeItem] = await collectLegacyObjects(storage.client);
  assert.equal((await migrateObject(storage.client, bigItem, { apply: true })).status, "migrated");
  const rejected = await migrateObject(storage.client, hugeItem, { apply: true });
  assert.equal(rejected.status, "error");
  assert.match(rejected.reason!, /10 MB/);
});

test("integridade: envio corrompido no Storage é detectado", async () => {
  const storage = createStorage({ corruptUploads: true });
  storage.put(`${ART}/01-mestre.png`, await png("#a33"));
  const [item] = await collectLegacyObjects(storage.client);
  const record = await migrateObject(storage.client, item, { apply: true });
  assert.equal(record.status, "error");
  assert.match(record.reason!, /tamanho no Storage/);
});

test("banner legado ativo é migrado sem ponteiro e continua sendo a mesma imagem", async () => {
  const storage = createStorage();
  storage.put("site-banners/banners/emblemas/background", await png("#123", 2560, 1440));
  const [item] = await collectLegacyObjects(storage.client);
  const record = await migrateObject(storage.client, item, { apply: true });
  assert.equal(record.status, "migrated", record.reason);
  assert.equal([...storage.objects.keys()].some((key) => key.startsWith("site-profile/active/")), false, "nenhum ponteiro gravado");
  const active = await resolveActiveStoredImage(storage.client as unknown as StorageReader, bannerImageTarget("emblemas"));
  assert.equal(active.url, record.newUrl);
  assert.ok(storage.objects.has("site-banners/banners/emblemas/background"), "legado preservado");
});

test("banner com versão enviada pelo Admin (ponteiro) não é migrado nem reativado", async () => {
  const storage = createStorage();
  storage.put("site-banners/banners/home/background", await png("#111", 2560, 1440));
  const admin = await optimizeImage({ bytes: await png("#c33", 1920, 1080), preset: "banner" });
  await replaceActiveImage(storage.client as unknown as StorageReader, bannerImageTarget("home"), admin, { framing: { x: 1, y: 2, zoom: 1.1 } });
  const pointerBefore = { ...storage.objects.get("site-profile/active/banner-home.json")! };
  const uploadsBefore = storage.uploads.length;

  const [item] = await collectLegacyObjects(storage.client);
  const record = await migrateObject(storage.client, item, { apply: true });
  assert.equal(record.status, "skipped");
  assert.match(record.reason!, /ponteiro/);
  assert.equal(storage.uploads.length, uploadsBefore);
  assert.deepEqual(storage.objects.get("site-profile/active/banner-home.json"), pointerBefore);
});

test("banner com versão imutável mais recente (sem ponteiro) não é migrado", async () => {
  const storage = createStorage();
  storage.put("site-banners/banners/home/background", await png("#111", 2560, 1440));
  storage.put("site-banners/banners/home/background.0123456789abcdef.webp", Buffer.from("x"));
  const [item] = await collectLegacyObjects(storage.client);
  const record = await migrateObject(storage.client, item, { apply: true });
  assert.equal(record.status, "skipped");
  assert.match(record.reason!, /mais recente/);
});

test("retomada: o último registro de cada objeto vale", () => {
  const base = { bucket: "achievement-art", path: "p", kind: "achievement" as const };
  const latest = latestRecords([
    { ...base, key: "a", status: "error" },
    { ...base, key: "b", status: "migrated" },
    { ...base, key: "a", status: "migrated" },
  ] as MigrationRecord[]);
  assert.equal(latest.get("a")?.status, "migrated");
  assert.equal(latest.size, 2);
});

test("SQL: backup antes do update, curingas escapados, reversão segura e sem execução", () => {
  const oldUrl = `${BASE}/achievement-art/games/o'brien/achievements/01_maestria%.png`;
  const records: MigrationRecord[] = [
    { key: "k1", bucket: "achievement-art", path: "x", kind: "achievement", status: "migrated", oldUrl, newUrl: `${BASE}/n.0123456789abcdef.webp`, newPath: "n" },
    { key: "k2", bucket: "achievement-art", path: "y", kind: "achievement", status: "error", oldUrl: "ignorar", newUrl: "ignorar" },
    { key: "k3", bucket: "site-banners", path: "z", kind: "fixed", status: "migrated", oldUrl: "banner", newUrl: "banner-novo" },
  ];
  const { sql, rollbackSql, count } = buildMigrationSql(records, "img-20261113");

  assert.equal(count, 1, "só artes migradas entram; banner/avatar não precisam de SQL");
  assert.ok(!sql.includes("ignorar") && !sql.includes("banner-novo"));
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
  assert.ok(sql.indexOf("insert into public.image_migration_backup") < sql.indexOf("update public.achievements"), "backup antes do update");
  assert.ok(sql.includes("o''brien"), "aspas escapadas");
  assert.ok(sql.includes("01\\_maestria\\%.png?v=%' escape '\\'"), "curingas do LIKE escapados");
  assert.ok(sql.includes("on conflict do nothing"), "reaplicar não duplica o backup");
  assert.match(rollbackSql, /t\.image = b\.new_value/, "só reverte linhas que ainda têm a URL nova");
  assert.match(rollbackSql, /t\.image_override = b\.new_value/);
  assert.throws(() => buildMigrationSql(records, "x'; drop table achievements; --"));
});

test("script: sem autorização explícita não acessa nada e sai com a ajuda", () => {
  const env = { ...process.env };
  delete env.NEXT_PUBLIC_SUPABASE_URL;
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  for (const args of [[], ["--apply"], ["--limit", "1"]]) {
    const result = spawnSync(process.execPath, ["scripts/migrate-storage-images.mjs", ...args], { env, encoding: "utf8" });
    assert.equal(result.status, 0, args.join(" "));
    assert.match(result.stdout, /Sem --confirm-remote nada é acessado/);
  }
  const noCredentials = spawnSync(process.execPath, ["scripts/migrate-storage-images.mjs", "--confirm-remote"], { env, encoding: "utf8" });
  assert.equal(noCredentials.status, 1);
  assert.match(noCredentials.stderr, /Defina NEXT_PUBLIC_SUPABASE_URL/);
});

// ---------------------------------------------------------------------------------------------
// Variantes locais, diagnóstico de ponteiro e falhas de listagem.
// ---------------------------------------------------------------------------------------------

const MOUSE_URL = `${BASE}/${ART}/01-mestre.png`;
const indexFor = (variants: Record<string, string>, missing: string[] = []) =>
  createLocalVariantIndex(variants, (publicPath) => !missing.includes(publicPath));

test("arte com variante local exata: preservada sem download, envio nem SQL (plano e envio)", async () => {
  const storage = createStorage();
  storage.put(`${ART}/01-mestre.png`, await png("#a33"));
  const localVariants = indexFor({
    [MOUSE_URL]: "/images/home/mouse-01.webp",
    [`${MOUSE_URL}?v=1793662305750`]: "/images/home/mouse-01.webp",
  });
  const [item] = await collectLegacyObjects(storage.client);

  const planned = await migrateObject(storage.client, item, { apply: false, localVariants });
  const applied = await migrateObject(storage.client, item, { apply: true, localVariants });
  for (const record of [planned, applied]) {
    assert.equal(record.status, "preserved");
    assert.match(record.reason!, /preservada: já possui variante local \/images\/home\/mouse-01\.webp/);
    assert.equal(record.localVariant?.keys.length, 2);
  }
  assert.deepEqual(storage.downloads, [], "nada foi baixado");
  assert.deepEqual(storage.uploads, [], "nada foi enviado");
  const { sql, count } = buildMigrationSql([applied], "img-1");
  assert.equal(count, 0);
  assert.ok(!sql.includes("01-mestre"), "o SQL não toca na referência preservada");
});

test("correspondência exata: outro jogo, outro host ou outro nome não casam", () => {
  const index = indexFor({ [MOUSE_URL]: "/images/home/mouse-01.webp" });
  assert.equal(matchLocalVariant(index, `${BASE}/achievement-art/games/outro/achievements/01-mestre.png`), null);
  assert.equal(matchLocalVariant(index, MOUSE_URL.replace("exemplo", "outro")), null);
  assert.equal(matchLocalVariant(index, `${BASE}/${ART}/01-mestre.jpg`), null);
  assert.equal(matchLocalVariant(index, `${BASE}/${ART}/01-mestre.png.bak`), null);
  assert.equal(matchLocalVariant(index, MOUSE_URL)?.status, "preserved");
});

test("variante só para URL versionada (?v=) ou com arquivo ausente: dúvida, sem exclusão", async () => {
  const onlyVersioned = indexFor({ [`${MOUSE_URL}?v=123`]: "/images/home/mouse-01.webp" });
  const doubt = matchLocalVariant(onlyVersioned, MOUSE_URL)!;
  assert.equal(doubt.status, "doubt");
  assert.deepEqual(doubt.keys, [`${MOUSE_URL}?v=123`]);

  const missingFile = indexFor({ [MOUSE_URL]: "/images/home/sumiu.webp" }, ["/images/home/sumiu.webp"]);
  assert.equal(matchLocalVariant(missingFile, MOUSE_URL)?.status, "doubt");

  // Fluxo completo da dúvida: migra normalmente e o SQL deixa intactas as linhas da URL exata.
  const storage = createStorage();
  storage.put(`${ART}/01-mestre.png`, await png("#a33"));
  const [item] = await collectLegacyObjects(storage.client);
  const record = await migrateObject(storage.client, item, { apply: true, localVariants: onlyVersioned });
  assert.equal(record.status, "migrated");
  assert.match(record.reason!, /revisar: só há variante local para uma URL versionada/);
  const { sql, count } = buildMigrationSql([record], "img-1");
  assert.equal(count, 1);
  assert.ok(sql.includes(`and image not in ('${MOUSE_URL}?v=123')`));
  assert.ok(sql.includes(`and image_override not in ('${MOUSE_URL}?v=123')`));
});

test("imagem sem variante local segue o fluxo normal", async () => {
  const storage = createStorage();
  storage.put(`${ART}/09-sem-copia.png`, await png("#3a3"));
  const [item] = await collectLegacyObjects(storage.client);
  const record = await migrateObject(storage.client, item, { apply: false, localVariants: indexFor({ [MOUSE_URL]: "/x.webp" }) });
  assert.equal(record.status, "planned");
  assert.equal(record.localVariant, undefined);
  assert.equal(record.reason, undefined);
});

test("avatar com variante local da versão ativa: preservado sem download", async () => {
  const storage = createStorage();
  storage.put("site-profile/profile/avatar", await png("#555", 800, 800));
  const updatedAt = storage.objects.get("site-profile/profile/avatar")!.updated_at;
  const avatarUrl = `${BASE}/site-profile/profile/avatar`;
  const localVariants = indexFor({ [`${avatarUrl}?v=${encodeURIComponent(updatedAt)}`]: "/images/home/avatar.webp" });
  const [item] = await collectLegacyObjects(storage.client);

  const record = await migrateObject(storage.client, item, { apply: true, localVariants });
  assert.equal(record.status, "preserved");
  assert.equal(record.pointerState, "absent");
  assert.ok(!storage.downloads.includes("site-profile/profile/avatar"), "o avatar não foi baixado");
  assert.deepEqual(storage.uploads, []);
});

test("avatar com variante de outra versão (?v= diferente) ou sem variante: migrado, com dúvida registrada", async () => {
  const storage = createStorage();
  storage.put("site-profile/profile/avatar", await png("#555", 800, 800));
  const avatarUrl = `${BASE}/site-profile/profile/avatar`;
  const [item] = await collectLegacyObjects(storage.client);

  const stale = await migrateObject(storage.client, item, {
    apply: false,
    localVariants: indexFor({ [`${avatarUrl}?v=2026-10-25T18%3A38%3A23.346Z`]: "/images/home/avatar.webp" }),
  });
  assert.equal(stale.status, "planned");
  assert.equal(stale.localVariant?.status, "doubt");
  assert.match(stale.reason!, /outra versão desta imagem/);

  const none = await migrateObject(storage.client, item, { apply: false, localVariants: indexFor({}) });
  assert.equal(none.status, "planned");
  assert.equal(none.localVariant, undefined);
});

test("ponteiros: válido, ausente, inválido e apontando para arquivo inexistente", async () => {
  const states: Record<string, { status: string; pointerState?: string }> = {};
  for (const scenario of ["valid", "absent", "invalid", "missing-file"] as const) {
    const storage = createStorage();
    storage.put("site-banners/banners/home/background", await png("#111", 2560, 1440));
    if (scenario === "valid" || scenario === "missing-file") {
      const admin = await optimizeImage({ bytes: await png("#c33", 1920, 1080), preset: "banner" });
      const stored = await replaceActiveImage(storage.client as unknown as StorageReader, bannerImageTarget("home"), admin);
      if (scenario === "missing-file") storage.objects.delete(`site-banners/banners/home/${stored.fileName}`);
    }
    if (scenario === "invalid") storage.put("site-profile/active/banner-home.json", Buffer.from("{ quebrado"));
    const [item] = await collectLegacyObjects(storage.client);
    const record = await migrateObject(storage.client, item, { apply: false });
    states[scenario] = { status: record.status, pointerState: record.pointerState };
  }
  assert.deepEqual(states, {
    valid: { status: "skipped", pointerState: "valid" },
    absent: { status: "planned", pointerState: "absent" },
    invalid: { status: "planned", pointerState: "invalid" },
    "missing-file": { status: "planned", pointerState: "missing-file" },
  });
});

test("falha ao ler o ponteiro (não é 'não encontrado') vira erro, nunca ignorado", async () => {
  const storage = createStorage({ failDownloads: /^site-profile\/active\// });
  storage.put("site-banners/banners/home/background", await png("#111", 2560, 1440));
  const [item] = await collectLegacyObjects(storage.client);
  const record = await migrateObject(storage.client, item, { apply: false });
  assert.equal(record.status, "error");
  assert.equal(record.pointerState, "unreadable");
});

test("falha de listagem: erro da pasta, as demais continuam", async () => {
  const storage = createStorage({ failList: /^achievement-art\/games\/quebrado\/achievements$/ });
  storage.put("achievement-art/games/quebrado/achievements/01-a.png", await png("#a33"));
  storage.put(`${ART}/01-mestre.png`, await png("#a33"));
  storage.put("site-banners/banners/home/background", await png("#111", 2560, 1440));

  const { objects, errors } = await scanLegacyObjects(storage.client);
  assert.deepEqual(objects.map((item) => item.key), [`${ART}/01-mestre.png`, "site-banners/banners/home/background"]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].status, "error");
  assert.equal(errors[0].kind, "group");
  assert.match(errors[0].reason!, /falha ao listar: games\/quebrado\/achievements: falha de listagem simulada/);
  await assert.rejects(collectLegacyObjects(storage.client), /falha de listagem/);
});

test("falha de listagem da pasta do banner na hora da decisão vira erro, nunca ignorado", async () => {
  const storage = createStorage();
  storage.put("site-banners/banners/home/background", await png("#111", 2560, 1440));
  const [item] = await collectLegacyObjects(storage.client);
  const failing = createStorage({ failList: /^site-banners\/banners\/home$/ });
  for (const [key, value] of storage.objects) failing.objects.set(key, value);

  const record = await migrateObject(failing.client, item, { apply: true });
  assert.equal(record.status, "error");
  assert.match(record.reason!, /falha ao listar a pasta/);
  assert.deepEqual(failing.uploads, []);
});

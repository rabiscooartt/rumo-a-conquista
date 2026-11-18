// Etapa 4.1 — teste HTTP do handler REAL de app/api/admin/achievement-art/route.ts:
// autenticação real (cookie assinado), supabase-js real, PostgREST e Storage simulados neste
// processo (127.0.0.1), PostgreSQL 17 local com postgres não superusuário e gatilhos reais.
// Nenhuma credencial do projeto é carregada; um vigia no fetch registra qualquer saída da máquina.
import http from "node:http";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const repo = process.env.REPO;
const replica = process.argv[2];
if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http://127.0.0.1:")) throw new Error("URL do Supabase não é local; abortado");
if (/supabase\.co/.test(JSON.stringify(process.env))) throw new Error("variável apontando para supabase.co no ambiente; abortado");
const PORT = Number(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).port);
const read = (p) => readFileSync(`${repo}/${p}`, "utf8");
const repoRequire = createRequire(`${repo}/package.json`);
const sharp = repoRequire("sharp");
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`); };

// Vigia: toda requisição precisa ser para 127.0.0.1.
const outbound = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
  outbound.push(url.host);
  if (url.hostname !== "127.0.0.1") throw new Error(`requisição bloqueada para ${url.host}`);
  return realFetch(input, init);
};

// ---------- Banco ----------
const base = { host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 55433) };
const admin = new pg.Client({ ...base, user: process.env.PG_ADMIN_USER ?? "supabase_admin", database: "postgres" });
await admin.connect();
await admin.query(`
  create role postgres login createrole bypassrls inherit;
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create role authenticator login noinherit;
  grant anon to authenticator with inherit false; grant authenticated to authenticator with inherit false; grant service_role to authenticator with inherit false;
  grant anon, authenticated, service_role, authenticator to postgres with admin option;`);
await admin.query("create database rumo_base owner postgres");
const OLD = (n) => `http://127.0.0.1:${PORT}/storage/v1/object/public/achievement-art/games/jogo-h/achievements/${n}-antiga.png`;
{
  const a = new pg.Client({ ...base, user: process.env.PG_ADMIN_USER ?? "supabase_admin", database: "rumo_base" });
  await a.connect();
  await a.query(`grant usage on schema public to postgres, anon, authenticated, service_role;
    alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;`);
  await a.end();
  const db = new pg.Client({ ...base, user: "postgres", database: "rumo_base" });
  await db.connect();
  await db.query(readFileSync(replica, "utf8"));
  await db.query(read("supabase/migrations/20261102_add_games_backlog_order.sql"));
  await db.query(read("supabase/migrations/20261114_create_storage_image_lifecycle.sql"));
  await db.query(read("supabase/migrations/20261116_storage_lifecycle_tracked_uploads.sql"));
  await db.query(`
    insert into public.games (slug, title, status, review) values ('jogo-h', 'Jogo H', 'progress', '{"texto": "review do jogo H"}');
    insert into public.achievements (id, game_slug, legacy_id, title, image, sort_order) values
      ('00000000-0000-0000-0000-00000000aa01', 'jogo-h', 'h1', 'Primeira Arte', '${OLD("h1")}', 0),
      ('00000000-0000-0000-0000-00000000aa02', 'jogo-h', 'h2', 'Segunda Arte', '${OLD("h2")}', 1),
      ('00000000-0000-0000-0000-00000000aa03', 'jogo-h', 'h3', 'Terceira Arte', '${OLD("h3")}', 2);
    insert into public.achievement_progress (id, achievement_id, status, earned_at, image_override) values
      ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000aa01', 'completed', '2026-10-01', '${OLD("h1")}'),
      ('00000000-0000-0000-0000-00000000bb02', '00000000-0000-0000-0000-00000000aa02', 'locked', null, '${OLD("h2")}');
    alter table public.achievement_progress disable trigger user;
    insert into public.achievement_progress (id, achievement_id, status, earned_at, image_override) values
      ('00000000-0000-0000-0000-00000000bb03', '00000000-0000-0000-0000-00000000aa03', 'completed', null, '${OLD("h3")}');
    alter table public.achievement_progress enable trigger user;`);
  await db.end();
}
let dbCounter = 0;
let api = null;       // conexão do "PostgREST" (authenticator → service_role) no banco do cenário
let currentDb = null;
async function switchToFreshDb() {
  currentDb = `rumo_${++dbCounter}`;
  await admin.query(`create database ${currentDb} template rumo_base owner postgres`);
  if (api) await api.end();
  api = new pg.Client({ ...base, user: "authenticator", database: currentDb });
  await api.connect();
  return currentDb;
}

// ---------- Storage simulado + PostgREST simulado ----------
let storage = new Map();
const faults = { rpc: null, upload: null };
const rpcCalls = {};
const q = (name) => `"${name.replace(/"/g, '""')}"`;
function parseList(v) {
  return v.slice(1, -1).split(",").map((s) => s.trim().replace(/^"(.*)"$/, "$1"));
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks);
  const send = (status, payload, headers = {}) => { res.writeHead(status, { "Content-Type": "application/json", ...headers }); res.end(payload === undefined ? undefined : JSON.stringify(payload)); };
  try {
    if (req.headers.apikey !== process.env.SUPABASE_SERVICE_ROLE_KEY) return send(401, { message: "chave inválida" });
    // Storage
    if (url.pathname === "/storage/v1/bucket" && req.method === "POST") return send(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
    let m = url.pathname.match(/^\/storage\/v1\/object\/info\/([^/]+)\/(.+)$/);
    if (m && req.method === "GET") {
      const f = storage.get(`${m[1]}/${decodeURIComponent(m[2])}`);
      if (!f) return send(400, { statusCode: "404", error: "not_found", message: "Object not found" });
      return send(200, { id: f.id, version: f.id, name: decodeURIComponent(m[2]), bucket_id: m[1], size: f.bytes.length, content_type: f.contentType, etag: `"x"`, metadata: f.metadata, created_at: new Date().toISOString(), last_modified: new Date().toISOString() });
    }
    m = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
    if (m && req.method === "POST") {
      const key = `${m[1]}/${decodeURIComponent(m[2])}`;
      if (faults.upload === "before") return req.socket.destroy();
      if (storage.has(key) && req.headers["x-upsert"] !== "true") return send(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
      const meta = req.headers["x-metadata"] ? JSON.parse(Buffer.from(req.headers["x-metadata"], "base64").toString("utf8")) : null;
      storage.set(key, { id: randomUUID(), bytes: raw, contentType: req.headers["content-type"], metadata: meta });
      return send(200, { Key: key, Id: storage.get(key).id });
    }
    // PostgREST: RPC
    m = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (m && req.method === "POST") {
      const fn = m[1];
      rpcCalls[fn] = (rpcCalls[fn] ?? 0) + 1;
      if (faults.rpc && faults.rpc.fn === fn && faults.rpc.nth === rpcCalls[fn]) {
        return send(500, { code: "08006", message: `falha simulada em ${fn}`, details: null, hint: null });
      }
      const args = JSON.parse(raw.toString("utf8") || "{}");
      const names = Object.keys(args);
      const values = names.map((n) => (args[n] !== null && typeof args[n] === "object" ? JSON.stringify(args[n]) : args[n]));
      await api.query("begin; set local role service_role");
      try {
        const r = (await api.query(`select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`, values)).rows[0].r;
        await api.query("commit");
        return send(200, r);
      } catch (e) { await api.query("rollback"); throw e; }
    }
    // PostgREST: tabelas (GET)
    m = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
    if (m && req.method === "GET") {
      const cols = (url.searchParams.get("select") ?? "*").split(",").map((c) => c.trim()).map((c) => (c === "*" ? c : q(c))).join(", ");
      const where = []; const vals = [];
      for (const [k, v] of url.searchParams) {
        if (["select", "order", "limit", "offset"].includes(k)) continue;
        let mm;
        if ((mm = /^eq\.(.*)$/s.exec(v))) { vals.push(mm[1]); where.push(`${q(k)}::text = $${vals.length}`); }
        else if ((mm = /^in\.(\(.*\))$/s.exec(v))) { vals.push(parseList(mm[1])); where.push(`${q(k)}::text = any($${vals.length})`); }
        else if (v === "not.is.null") where.push(`${q(k)} is not null`);
        else if (v === "is.null") where.push(`${q(k)} is null`);
        else throw Object.assign(new Error(`filtro não simulado ${k}=${v}`), { code: "PGRST100" });
      }
      const limit = url.searchParams.get("limit");
      await api.query("begin; set local role service_role");
      let rows;
      try { rows = (await api.query(`select ${cols} from public.${m[1]}${where.length ? ` where ${where.join(" and ")}` : ""}${limit ? ` limit ${Number(limit)}` : ""}`, vals)).rows; await api.query("commit"); }
      catch (e) { await api.query("rollback"); throw e; }
      if (/vnd\.pgrst\.object/.test(req.headers.accept ?? "")) {
        if (rows.length !== 1) return send(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${rows.length} rows`, hint: null });
        return send(200, rows[0]);
      }
      return send(200, rows, { "Content-Range": `0-${Math.max(rows.length - 1, 0)}/*` });
    }
    return send(404, { message: `não simulado: ${req.method} ${url.pathname}` });
  } catch (e) {
    send(400, { code: e.code ?? "XX000", message: e.message, details: null, hint: null });
  }
});
const { startServer } = await import(pathToFileURL(`${repo}/tests/integration/support/server.mjs`).href);
const stopServer = await startServer(server, PORT, "achievement-art-http");
try {

// ---------- Handler real, autenticação real ----------
const { NextRequest } = repoRequire("next/server");
const route = await import(pathToFileURL(`${repo}/app/api/admin/achievement-art/route.ts`).href);
const { createAdminSession, ADMIN_SESSION_COOKIE } = await import(pathToFileURL(`${repo}/lib/admin-auth.ts`).href);
const { optimizeUploadedFile } = await import(pathToFileURL(`${repo}/lib/images/optimizeImage.ts`).href);
const { immutableImageName, safeImageBaseName } = await import(pathToFileURL(`${repo}/lib/images/naming.ts`).href);
const token = await createAdminSession();
const COOKIE = `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`;

const png = (r, g, b) => sharp({ create: { width: 900, height: 900, channels: 3, background: { r, g, b } } }).png().toBuffer();
const PNG = { h1: await png(200, 30, 30), h2: await png(30, 200, 30), h3: await png(30, 30, 200) };
const NAME = { h1: "primeira-arte.png", h2: "segunda-arte.png", h3: "terceira-arte.png" };
const fileOf = (k) => new File([PNG[k]], NAME[k], { type: "image/png" });
const expectedPath = {};
for (const k of ["h1", "h2", "h3"]) {
  const opt = await optimizeUploadedFile(fileOf(k), "achievement");
  expectedPath[k] = `games/jogo-h/achievements/${immutableImageName(safeImageBaseName(NAME[k], "conquista"), opt.contentHash)}`;
}
const publicUrl = (k) => `http://127.0.0.1:${PORT}/storage/v1/object/public/achievement-art/${expectedPath[k]}`;

async function post(keys, { cookie = COOKIE, extra = {} } = {}) {
  const form = new FormData();
  form.set("gameSlug", "jogo-h");
  for (const k of keys) form.append("files", fileOf(k));
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  const request = new NextRequest("http://localhost/api/admin/achievement-art", { method: "POST", body: form, headers: cookie ? { cookie } : {} });
  const response = await route.POST(request);
  return { status: response.status, json: await response.json() };
}
async function snapshot() {
  const c = new pg.Client({ ...base, user: "postgres", database: currentDb });
  await c.connect();
  const rows = async (sql) => (await c.query(sql)).rows;
  const s = {
    images: Object.fromEntries((await rows("select legacy_id, image from public.achievements where game_slug = 'jogo-h'")).map((r) => [r.legacy_id, r.image])),
    overrides: Object.fromEntries((await rows("select right(id::text, 2) k, image_override, status, earned_at::text from public.achievement_progress where id::text like '%bb0%'")).map((r) => [r.k, r])),
    review: (await rows("select review::text r, review_updated_at from public.games where slug = 'jogo-h'"))[0],
    log: Number((await rows("select count(*) n from public.storage_operation_log"))[0].n),
    actors: (await rows("select distinct actor from public.storage_operation_log where phase = 'intent' and operation in ('object_upload','reference_batch','reference_replace')")).map((r) => r.actor),
    pending: (await rows("select operation from public.storage_lifecycle_pending_operations")).map((r) => r.operation),
    objects: await rows("select object_path, state, sha256, registered_by_upload is not null upload from public.storage_object_lifecycle"),
    events: Number((await rows("select count(*) n from public.journey_history_events"))[0].n),
  };
  await c.end();
  const c2 = new pg.Client({ ...base, user: "authenticator", database: currentDb });
  await c2.connect(); await c2.query("set role service_role");
  s.chain = Number((await c2.query("select count(*) n from public.storage_operation_log_verify()")).rows[0].n);
  await c2.end();
  return s;
}
const seedOld = () => new Map(["h1", "h2", "h3"].map((k) => [`achievement-art/games/jogo-h/achievements/${k}-antiga.png`, { id: randomUUID(), bytes: Buffer.from(`antiga-${k}`), contentType: "image/png", metadata: null }]));
const resetFaults = () => { faults.rpc = null; faults.upload = null; for (const k of Object.keys(rpcCalls)) delete rpcCalls[k]; };

// ========== Cenários ==========
// A. Autenticação, envio multipart, recusa parcial, troca auditada, repetição, preservação.
await switchToFreshDb(); storage = seedOld(); resetFaults();
{
  const before = await snapshot();
  const noAuth = await post(["h1"], { cookie: null });
  const forged = await post(["h1"], { cookie: `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token.replace(/.$/, (c) => (c === "A" ? "B" : "A")))}` });
  const expiredUser = await post(["h1"], { cookie: `${ADMIN_SESSION_COOKIE}=lixo.assinatura` });
  const s0 = await snapshot();
  check("1. sem autenticação, cookie com assinatura adulterada e cookie inválido: 401, nada registrado nem enviado",
    noAuth.status === 401 && forged.status === 401 && expiredUser.status === 401 && s0.log === before.log && storage.size === 3, `${noAuth.status}/${forged.status}/${expiredUser.status}`);

  const r = await post(["h1", "h2", "h3"], { extra: { actor: "invasor", gameSlugActor: "x" } });
  const s1 = await snapshot();
  check("2/3. sessão de admin válida + multipart com 3 artes: 200, h1 e h2 salvas, h3 recusada (progresso concluído sem earned_at)",
    r.status === 200 && r.json.ok === true && r.json.count === 2 && r.json.refused?.length === 1 && r.json.refused[0].title === "Terceira Arte",
    `${r.status} saved=${r.json.saved?.map((x) => x.title)} refused=${r.json.refused?.map((x) => x.title)}`);
  check("4. intenção registrada antes do envio e envio rastreado: 2 objetos unverified com SHA-256 completo; arquivos com o SHA nos metadados; nada enviado para h3",
    s1.objects.filter((o) => o.upload).length === 2 && s1.objects.every((o) => o.state === "unverified" && /^[0-9a-f]{64}$/.test(o.sha256))
    && storage.get(`achievement-art/${expectedPath.h1}`)?.metadata?.sha256 === s1.objects.find((o) => o.object_path === expectedPath.h1)?.sha256
    && !storage.has(`achievement-art/${expectedPath.h3}`));
  check("5. referências trocadas: achievements.image e image_override de h1/h2; earned_at e status preservados; sem eventos novos",
    s1.images.h1 === publicUrl("h1") && s1.images.h2 === publicUrl("h2") && s1.overrides["01"].image_override === publicUrl("h1") && s1.overrides["02"].image_override === publicUrl("h2")
    && s1.overrides["01"].earned_at === before.overrides["01"].earned_at && s1.overrides["01"].status === "completed" && s1.overrides["02"].status === "locked" && s1.events === before.events);
  check("6/7. h3 intocada (imagem, override, status e earned_at nulo) — recusa parcial não bloqueia as outras",
    s1.images.h3 === before.images.h3 && s1.overrides["03"].image_override === before.overrides["03"].image_override && s1.overrides["03"].earned_at === null && s1.overrides["03"].status === "completed");
  check("ator da auditoria = sessão validada (admin:<usuário>); campo 'actor' do formulário ignorado",
    JSON.stringify(s1.actors) === JSON.stringify([`admin:${process.env.ADMIN_USER}`]), JSON.stringify(s1.actors));
  check("auditoria: 14 linhas (2 envios, 1 lote, 4 trocas), nada pendente, cadeia íntegra; games.review intacta",
    s1.log === 14 && s1.pending.length === 0 && s1.chain === 0 && s1.review.r === before.review.r && String(s1.review.review_updated_at) === String(before.review.review_updated_at), `${s1.log} linhas`);
  check("13. imagens anteriores preservadas no Storage", ["h1", "h2", "h3"].every((k) => storage.has(`achievement-art/games/jogo-h/achievements/${k}-antiga.png`)));

  const again = await post(["h1", "h2", "h3"]);
  const s2 = await snapshot();
  check("10. repetição idempotente: 200, nenhuma linha nova de auditoria, nenhum arquivo novo, referências iguais",
    again.status === 200 && s2.log === s1.log && storage.size === 5 && JSON.stringify(s2.images) === JSON.stringify(s1.images), `${again.status}, ${s2.log} linhas, ${storage.size} arquivos`);
}

// B. Falha no 2º registro do lote e retomada.
await switchToFreshDb(); storage = seedOld(); resetFaults();
{
  const before = await snapshot();
  faults.rpc = { fn: "storage_lifecycle_replace_reference", nth: 2 };
  const r = await post(["h1", "h2"]);
  const s1 = await snapshot();
  const changed = [s1.images.h1 !== before.images.h1, s1.overrides["01"].image_override !== before.overrides["01"].image_override, s1.images.h2 !== before.images.h2, s1.overrides["02"].image_override !== before.overrides["02"].image_override];
  check("8. falha na 2ª troca do lote: 500 parcial (não é sucesso), só a 1ª referência mudou, lote pendente, envios confirmados",
    r.status === 500 && r.json.partial === true && r.json.pending === true && /reconcilia/.test(r.json.error) && r.json.applied === 1 && r.json.total === 4 && JSON.stringify(changed) === "[true,false,false,false]"
    && JSON.stringify(s1.pending) === '["reference_batch"]' && s1.objects.filter((o) => o.upload).length === 2, `${r.status} ${r.json.error}`);
  resetFaults();
  const resumed = await post(["h1", "h2"]);
  const s2 = await snapshot();
  check("9. retomada pela mesma solicitação: 200, lote concluído, todas as referências trocadas, sem duplicação",
    resumed.status === 200 && s2.pending.length === 0 && s2.images.h2 === publicUrl("h2") && s2.overrides["02"].image_override === publicUrl("h2")
    && s2.log === 14 && storage.size === 5 && s2.chain === 0, `${resumed.status}, ${s2.log} linhas`);
}

// C. Colisão de prefixo de SHA-256: caminho já registrado com outro SHA-256 completo.
await switchToFreshDb(); storage = seedOld(); resetFaults();
{
  const svc = async (fn, args) => { await api.query("begin; set local role service_role"); const names = Object.keys(args); const r = (await api.query(`select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) r`, names.map((n) => (typeof args[n] === "object" ? JSON.stringify(args[n]) : args[n])))).rows[0].r; await api.query("commit"); return r; };
  const opt = await optimizeUploadedFile(fileOf("h1"), "achievement");
  await svc("storage_lifecycle_register_scan", { p_scan: { scan_id: "scan-20261115T000000Z", completed_at: "2026-11-15T00:00:00Z", complete: true, inventory_status: "complete", image_objects: 1, image_bytes: 10 }, p_actor: "teste" });
  await svc("storage_lifecycle_sync_scan", { p_scan_id: "scan-20261115T000000Z", p_objects: [{ bucket: "achievement-art", path: expectedPath.h1, state: "observing", reference_count: 0, size: 10, mimetype: "image/webp", sha256: opt.contentHash.slice(0, 16) + "0".repeat(48) }], p_actor: "teste" });
  const before = await snapshot();
  const r = await post(["h1"]);
  const s1 = await snapshot();
  check("11. colisão de prefixo: 502, recusada antes do envio, nada enviado, nenhuma referência trocada, auditoria inalterada",
    r.status === 502 && /Colisão de prefixo/.test(r.json.error) && !storage.has(`achievement-art/${expectedPath.h1}`) && s1.log === before.log && s1.images.h1 === before.images.h1, `${r.status} ${r.json.error?.slice(0, 80)}`);
}

// D. Falha de auditoria: intenção do envio e registro do lote.
await switchToFreshDb(); storage = seedOld(); resetFaults();
{
  const before = await snapshot();
  faults.rpc = { fn: "storage_lifecycle_begin_upload", nth: 1 };
  const r1 = await post(["h1"]);
  const s1 = await snapshot();
  check("12a. falha ao registrar a intenção do envio: 502, nada enviado ao Storage, nenhuma referência trocada, auditoria inalterada",
    r1.status === 502 && storage.size === 3 && s1.log === before.log && s1.images.h1 === before.images.h1, `${r1.status} ${r1.json.error?.slice(0, 60)}`);
  resetFaults();
  faults.rpc = { fn: "storage_lifecycle_begin_reference_batch", nth: 1 };
  const r2 = await post(["h1"]);
  const s2 = await snapshot();
  check("12b. falha ao registrar o lote: erro, envio confirmado e rastreado, NENHUMA referência trocada",
    r2.status >= 500 && s2.images.h1 === before.images.h1 && s2.overrides["01"].image_override === before.overrides["01"].image_override
    && s2.objects.filter((o) => o.upload).length === 1 && s2.pending.length === 0, `${r2.status}`);
  resetFaults();
  const r3 = await post(["h1"]);
  const s3 = await snapshot();
  check("12c. nova tentativa depois das falhas: 200, envio reaproveitado pelo registro, referências trocadas, cadeia íntegra",
    r3.status === 200 && s3.images.h1 === publicUrl("h1") && storage.size === 4 && s3.chain === 0, `${r3.status}`);
}

// E. Rota achievement-prep-art (envio rastreado sem troca de referência).
{
  const prepRoute = await import(pathToFileURL(`${repo}/app/api/admin/achievement-prep-art/route.ts`).href);
  const manualPng = await png(120, 120, 20);
  const manualFile = () => new File([manualPng], "manual-arte.png", { type: "image/png" });
  const opt = await optimizeUploadedFile(manualFile(), "achievement");
  const manualPath = `games/jogo-h/achievements/${immutableImageName(safeImageBaseName("manual-arte.png", "conquista"), opt.contentHash)}`;
  const postPrep = async ({ cookie = COOKIE } = {}) => {
    const form = new FormData();
    form.set("gameSlug", "jogo-h");
    form.set("expectedAchievements", JSON.stringify([{ name: "Arte Manual", filename: "manual-arte.png" }]));
    form.set("files", manualFile());
    form.set("actor", "invasor");
    const request = new NextRequest("http://localhost/api/admin/achievement-prep-art", { method: "POST", body: form, headers: cookie ? { cookie } : {} });
    const response = await prepRoute.POST(request);
    return { status: response.status, json: await response.json() };
  };

  await switchToFreshDb(); storage = seedOld(); resetFaults();
  const before = await snapshot();
  const noAuth = await postPrep({ cookie: null });
  check("E1. prep-art sem autenticação: 401, nada registrado nem enviado", noAuth.status === 401 && (await snapshot()).log === before.log && storage.size === 3);
  const r = await postPrep();
  const s1 = await snapshot();
  const obj = s1.objects.find((o) => o.object_path === manualPath);
  check("E2. prep-art: 200, arquivo enviado com SHA-256 nos metadados, objeto unverified registrado, nenhuma referência trocada",
    r.status === 200 && r.json.saved?.[0]?.image === `http://127.0.0.1:${PORT}/storage/v1/object/public/achievement-art/${manualPath}`
    && obj?.state === "unverified" && obj?.sha256 === storage.get(`achievement-art/${manualPath}`)?.metadata?.sha256
    && s1.log === before.log + 2 && JSON.stringify(s1.images) === JSON.stringify(before.images) && JSON.stringify(s1.actors) === JSON.stringify([`admin:${process.env.ADMIN_USER}`]),
    `${r.status} log ${before.log}→${s1.log}`);
  const again = await postPrep();
  const s2 = await snapshot();
  check("E3. prep-art repetido: 200, mesma URL, nada novo na auditoria nem no Storage", again.status === 200 && again.json.saved?.[0]?.image === r.json.saved?.[0]?.image && s2.log === s1.log && storage.size === 4);

  await switchToFreshDb(); storage = seedOld(); resetFaults();
  faults.rpc = { fn: "storage_lifecycle_begin_upload", nth: 1 };
  const failed = await postPrep();
  const s3 = await snapshot();
  check("E4. prep-art com falha ao registrar a intenção: erro, nada enviado ao Storage nem registrado", failed.status >= 500 && storage.size === 3 && s3.log === 0, `${failed.status}`);
  resetFaults();

  await switchToFreshDb(); storage = seedOld(); resetFaults();
  storage.set(`achievement-art/${manualPath}`, { id: randomUUID(), bytes: Buffer.from("conteúdo desconhecido"), contentType: "image/webp", metadata: null });
  const unknown = await postPrep();
  const s4 = await snapshot();
  check("E5. prep-art com arquivo existente sem prova de identidade: 409 pendente com orientação, arquivo intacto, nada registrado como objeto",
    unknown.status === 409 && unknown.json.pending === true && /reconcilia/.test(unknown.json.error) && JSON.stringify(s4.pending) === '["object_upload"]' && s4.objects.length === 0
    && storage.get(`achievement-art/${manualPath}`).bytes.toString() === "conteúdo desconhecido", `${unknown.status}`);
}

// F. Arte recusada sozinha (como o painel envia, um arquivo por vez): o motivo vem no texto.
await switchToFreshDb(); storage = seedOld(); resetFaults();
{
  const r = await post(["h3"]);
  check("F. arte recusada sozinha: 409 e o texto exibido traz o arquivo e o motivo (earned_at); nada enviado",
    r.status === 409 && /terceira-arte\.png: progresso concluído sem data de desbloqueio \(earned_at\)/.test(r.json.error) && storage.size === 3, r.json.error?.slice(0, 120));
}
check("nenhuma requisição saiu de 127.0.0.1 (vigia do fetch)", outbound.length > 0 && outbound.every((h) => h === `127.0.0.1:${PORT}`), `${outbound.length} requisições, hosts: ${[...new Set(outbound)].join(", ")}`);
check("cache da home invalidado só nas importações aceitas", (globalThis.__revalidated ?? []).every((t) => t === "home-catalog"));

} finally {
  // Encerrado sempre, inclusive se uma etapa lançar erro no meio da suíte.
  await stopServer();
}
await api.end();
await admin.end();
const failed = results.filter((x) => !x).length;
console.log(failed ? `\n${failed} falha(s) de ${results.length}` : `\nTudo aprovado (${results.length} verificações).`);
process.exit(failed ? 1 : 0);

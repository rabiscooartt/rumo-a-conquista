// Etapa 4.2 — ativação rastreada de ponteiros: handlers REAIS de banner-settings e profile-avatar,
// autenticação real, supabase-js real, PostgREST/Storage simulados (127.0.0.1), PostgreSQL 17 local.
import http from "node:http";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const repo = process.env.REPO;
const replica = process.argv[2];
if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http://127.0.0.1:")) throw new Error("URL não local");
if (/supabase\.co/.test(JSON.stringify(process.env))) throw new Error("supabase.co no ambiente");
const PORT = Number(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).port);
const read = (p) => readFileSync(`${repo}/${p}`, "utf8");
const repoRequire = createRequire(`${repo}/package.json`);
const sharp = repoRequire("sharp");
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`); };
const outbound = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
  outbound.push(url.host);
  if (url.hostname !== "127.0.0.1") throw new Error(`bloqueado: ${url.host}`);
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
  // Rollback da 20261117 sem uso: aplica, desfaz, reaplica.
  await db.query(read("supabase/migrations/20261117_storage_lifecycle_pointer_activation.sql"));
  await db.query(read("supabase/rollbacks/20261117_storage_lifecycle_pointer_activation_rollback.sql"));
  const gone = (await db.query("select to_regprocedure('public.storage_lifecycle_begin_pointer_activation(text,text,text,text,text,text)') is null g")).rows[0].g;
  await db.query(read("supabase/migrations/20261117_storage_lifecycle_pointer_activation.sql"));
  check("migração 20261117 aplica como postgres sem superusuário; rollback sem uso desfaz; reaplica", gone === true);
  await db.query(`create table public.site_banner_settings (banner_key text primary key, x numeric not null default 0, y numeric not null default 0,
    zoom numeric not null default 1, updated_at timestamptz not null default now()); alter table public.site_banner_settings enable row level security;`);
  await db.end();
}
let api = null, currentDb = null, dbCounter = 0;
async function switchToFreshDb() {
  currentDb = `rumo_${++dbCounter}`;
  await admin.query(`create database ${currentDb} template rumo_base owner postgres`);
  if (api) await api.end();
  api = new pg.Client({ ...base, user: "authenticator", database: currentDb });
  await api.connect();
}

// ---------- Storage + PostgREST simulados ----------
let storage = new Map();
const faults = { rpc: null, storage: null, download: null };
const rpcCalls = {};
let storageWrites = 0;
const q = (n) => `"${n.replace(/"/g, '""')}"`;
const parseList = (v) => v.slice(1, -1).split(",").map((s) => s.trim().replace(/^"(.*)"$/, "$1"));
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const send = (status, payload, headers = {}) => { res.writeHead(status, { "Content-Type": "application/json", ...headers }); res.end(payload === undefined ? undefined : JSON.stringify(payload)); };
  try {
    if (req.headers.apikey !== process.env.SUPABASE_SERVICE_ROLE_KEY) return send(401, { message: "chave inválida" });
    if (url.pathname.startsWith("/storage/v1/bucket")) {
      if (req.method === "GET") return send(200, { id: url.pathname.split("/").pop(), name: url.pathname.split("/").pop(), public: true });
      return send(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
    }
    let m = url.pathname.match(/^\/storage\/v1\/object\/list\/([^/]+)$/);
    if (m && req.method === "POST") {
      const body = JSON.parse(raw.toString("utf8"));
      const prefix = body.prefix ? `${m[1]}/${body.prefix.replace(/\/$/, "")}/` : `${m[1]}/`;
      const rows = [...storage.entries()].filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"))
        .map(([k, f]) => ({ name: k.slice(prefix.length), id: f.id, created_at: f.at, updated_at: f.at, metadata: { size: f.bytes.length, mimetype: f.contentType } }));
      return send(200, rows);
    }
    m = url.pathname.match(/^\/storage\/v1\/object\/info\/([^/]+)\/(.+)$/);
    if (m && req.method === "GET") {
      const f = storage.get(`${m[1]}/${decodeURIComponent(m[2])}`);
      if (!f) return send(400, { statusCode: "404", error: "not_found", message: "Object not found" });
      return send(200, { id: f.id, version: f.id, name: decodeURIComponent(m[2]), bucket_id: m[1], size: f.bytes.length, content_type: f.contentType, etag: `"x"`, metadata: f.metadata ?? {}, created_at: f.at, last_modified: f.at });
    }
    m = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
    if (m && req.method === "GET") {
      const key = `${m[1]}/${decodeURIComponent(m[2])}`;
      if (faults.download && faults.download.test(key)) return send(500, { statusCode: "500", error: "internal", message: "falha simulada de leitura" });
      const f = storage.get(key);
      if (!f) return send(400, { statusCode: "404", error: "not_found", message: "Object not found" });
      res.writeHead(200, { "Content-Type": f.contentType }); return res.end(f.bytes);
    }
    if (m && req.method === "POST") {
      const key = `${m[1]}/${decodeURIComponent(m[2])}`;
      storageWrites += 1;
      const fault = faults.storage && faults.storage.match.test(key) ? faults.storage : null;
      if (fault?.when === "before") { faults.storage = null; return send(500, { statusCode: "500", error: "internal", message: "falha simulada antes de gravar" }); }
      if (storage.has(key) && req.headers["x-upsert"] !== "true") return send(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
      let bytes = raw, contentType = req.headers["content-type"], meta = req.headers["x-metadata"] ? JSON.parse(Buffer.from(req.headers["x-metadata"], "base64").toString("utf8")) : null;
      if (/multipart\/form-data/.test(contentType ?? "")) {
        const form = await new Request("http://x/", { method: "POST", headers: { "content-type": contentType }, body: raw }).formData();
        const file = [...form.values()].find((v) => typeof v === "object");
        bytes = Buffer.from(await file.arrayBuffer());
        contentType = file.type || "application/octet-stream";
        if (form.get("metadata")) meta = JSON.parse(form.get("metadata"));
      }
      storage.set(key, { id: randomUUID(), bytes, contentType, metadata: meta, at: new Date().toISOString() });
      if (fault?.when === "after") { faults.storage = null; return send(500, { statusCode: "500", error: "internal", message: "resposta perdida depois de gravar" }); }
      return send(200, { Key: key, Id: storage.get(key).id });
    }
    m = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (m && req.method === "POST") {
      const fn = m[1];
      rpcCalls[fn] = (rpcCalls[fn] ?? 0) + 1;
      const f = faults.rpc && faults.rpc.fn === fn && faults.rpc.nth === rpcCalls[fn] ? faults.rpc : null;
      if (f?.when === "before") return send(500, { code: "08006", message: `falha simulada em ${fn}` });
      const args = JSON.parse(raw.toString("utf8") || "{}");
      const names = Object.keys(args);
      const values = names.map((n) => (args[n] !== null && typeof args[n] === "object" ? JSON.stringify(args[n]) : args[n]));
      await api.query("begin; set local role service_role");
      let r;
      try { r = (await api.query(`select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`, values)).rows[0].r; await api.query("commit"); }
      catch (e) { await api.query("rollback"); throw e; }
      if (f?.when === "after") return send(500, { code: "08006", message: `resposta perdida depois de ${fn}` });
      return send(200, r);
    }
    m = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
    if (m && req.method === "POST") {
      const rows = [].concat(JSON.parse(raw.toString("utf8")));
      const cols = Object.keys(rows[0]);
      const conflict = url.searchParams.get("on_conflict");
      await api.query("begin; set local role service_role");
      try {
        for (const row of rows) {
          await api.query(`insert into public.${m[1]} (${cols.map(q).join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})
            ${conflict ? `on conflict (${q(conflict)}) do update set ${cols.map((c) => `${q(c)} = excluded.${q(c)}`).join(", ")}` : ""}`, cols.map((c) => row[c]));
        }
        await api.query("commit");
      } catch (e) { await api.query("rollback"); throw e; }
      return send(201, undefined);
    }
    if (m && req.method === "GET") {
      const cols = (url.searchParams.get("select") ?? "*").split(",").map((c) => c.trim()).map((c) => (c === "*" ? c : q(c))).join(", ");
      const where = []; const vals = [];
      for (const [k, v] of url.searchParams) {
        if (["select", "order", "limit", "offset"].includes(k)) continue;
        let mm;
        if ((mm = /^eq\.(.*)$/s.exec(v))) { vals.push(mm[1]); where.push(`${q(k)}::text = $${vals.length}`); }
        else if ((mm = /^in\.(\(.*\))$/s.exec(v))) { vals.push(parseList(mm[1])); where.push(`${q(k)}::text = any($${vals.length})`); }
        else if (v === "not.is.null") where.push(`${q(k)} is not null`);
        else throw Object.assign(new Error(`filtro ${k}=${v}`), { code: "PGRST100" });
      }
      await api.query("begin; set local role service_role");
      let rows;
      try { rows = (await api.query(`select ${cols} from public.${m[1]}${where.length ? ` where ${where.join(" and ")}` : ""}`, vals)).rows; await api.query("commit"); }
      catch (e) { await api.query("rollback"); throw e; }
      if (/vnd\.pgrst\.object/.test(req.headers.accept ?? "")) {
        if (rows.length !== 1) return send(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${rows.length} rows` });
        return send(200, rows[0]);
      }
      return send(200, rows);
    }
    return send(404, { message: `não simulado: ${req.method} ${url.pathname}` });
  } catch (e) {
    send(400, { code: e.code ?? "XX000", message: e.message, details: null, hint: null });
  }
});
const { startServer } = await import(pathToFileURL(`${repo}/tests/integration/support/server.mjs`).href);
const stopServer = await startServer(server, PORT, "pointer-http");
try {

// ---------- Handlers reais ----------
const { NextRequest } = repoRequire("next/server");
const banner = await import(pathToFileURL(`${repo}/app/api/admin/banner-settings/route.ts`).href);
const avatar = await import(pathToFileURL(`${repo}/app/api/profile-avatar/route.ts`).href);
const { createAdminSession, ADMIN_SESSION_COOKIE } = await import(pathToFileURL(`${repo}/lib/admin-auth.ts`).href);
const COOKIE = `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(await createAdminSession())}`;
const png = (r, g, b) => sharp({ create: { width: 1600, height: 600, channels: 3, background: { r, g, b } } }).png().toBuffer();
const IMG = { A: await png(200, 40, 40), B: await png(40, 200, 40) };

async function postBanner(img, { cookie = COOKIE, x = 0 } = {}) {
  const form = new FormData();
  form.set("banner", "home"); form.set("x", String(x)); form.set("y", "0"); form.set("zoom", "1");
  if (img) form.set("file", new File([IMG[img]], `banner-${img}.png`, { type: "image/png" }));
  const response = await banner.POST(new NextRequest("http://localhost/api/admin/banner-settings", { method: "POST", body: form, headers: cookie ? { cookie } : {} }));
  return { status: response.status, json: await response.json() };
}
async function postAvatar(img, { cookie = COOKIE } = {}) {
  const form = new FormData();
  form.set("x", "0"); form.set("y", "0"); form.set("zoom", "1");
  form.set("file", new File([IMG[img]], `avatar-${img}.png`, { type: "image/png" }));
  const response = await avatar.POST(new NextRequest("http://localhost/api/profile-avatar", { method: "POST", body: form, headers: cookie ? { cookie } : {} }));
  return { status: response.status, json: await response.json() };
}
const pointer = (name) => { const f = storage.get(`site-profile/active/${name}.json`); return f ? JSON.parse(f.bytes.toString("utf8")) : null; };
async function snap() {
  const c = new pg.Client({ ...base, user: "postgres", database: currentDb });
  await c.connect();
  const rows = async (sql) => (await c.query(sql)).rows;
  const s = {
    log: Number((await rows("select count(*) n from public.storage_operation_log"))[0].n),
    activations: await rows("select l.details ->> 'pointer' pointer, l.details ->> 'previous_file' prev, l.details ->> 'pointer_file' file, l.actor, (select d.phase from public.storage_operation_log d where d.operation_id = l.operation_id and d.phase <> 'intent') result from public.storage_operation_log l where l.operation = 'pointer_activate' and l.phase = 'intent' order by l.id"),
    pending: (await rows("select operation from public.storage_lifecycle_pending_operations")).map((r) => r.operation),
    objects: await rows("select bucket, object_path, state, sha256 from public.storage_object_lifecycle order by bucket, object_path"),
    framing: await rows("select banner_key, x::float x from public.site_banner_settings"),
  };
  await c.end();
  const v = new pg.Client({ ...base, user: "authenticator", database: currentDb });
  await v.connect(); await v.query("set role service_role");
  s.chain = Number((await v.query("select count(*) n from public.storage_operation_log_verify()")).rows[0].n);
  await v.end();
  return s;
}
const reset = () => { faults.rpc = null; faults.storage = null; faults.download = null; for (const k of Object.keys(rpcCalls)) delete rpcCalls[k]; };
const legacy = () => new Map([["site-banners/banners/home/background", { id: randomUUID(), bytes: Buffer.from("legado"), contentType: "image/webp", metadata: null, at: "2026-01-01T00:00:00Z" }]]);
const ACTOR = `admin:${process.env.ADMIN_USER}`;

// ===== Banner =====
await switchToFreshDb(); storage = legacy(); reset();
{
  const s0 = await snap();
  const no = await postBanner("A", { cookie: null });
  check("P1. banner sem autenticação: 401, nada enviado nem registrado", no.status === 401 && storage.size === 1 && (await snap()).log === s0.log);

  const r = await postBanner("A");
  const s1 = await snap();
  const pA = pointer("banner-home");
  const objA = s1.objects.find((o) => o.object_path.startsWith("banners/home/background.") && o.object_path.endsWith(".webp"));
  check("P2. banner novo: 200; arquivo rastreado (unverified, SHA nos metadados); intenção da ativação antes do ponteiro; ponteiro relido e confirmado; enquadramento salvo",
    r.status === 200 && objA?.state === "unverified" && storage.get(`site-banners/${objA.object_path}`)?.metadata?.sha256 === objA.sha256
    && pA?.file === objA.object_path.slice("banners/home/".length) && s1.activations.length === 1 && s1.activations[0].result === "succeeded"
    && s1.activations[0].prev === null && s1.activations[0].actor === ACTOR && s1.log === 4 && s1.framing[0]?.banner_key === "home" && s1.chain === 0,
    `${r.status} log=${s1.log} ${JSON.stringify(s1.activations)}`);
  const again = await postBanner("A");
  const s2 = await snap();
  check("P3. repetir o mesmo banner: 200, nenhuma ativação nova nem linha de auditoria", again.status === 200 && s2.log === s1.log && pointer("banner-home").file === pA.file);
  const framingOnly = await postBanner("A", { x: 12 });
  const s3 = await snap();
  check("P4. mesmo arquivo com outro enquadramento: só o enquadramento muda (sem ativação nova)", framingOnly.status === 200 && s3.log === s1.log && pointer("banner-home").framing.x === 12 && pointer("banner-home").file === pA.file);
  const toB = await postBanner("B");
  const pB = pointer("banner-home");
  const backA = await postBanner("A");
  const s4 = await snap();
  check("P5. troca A → B → A: duas ativações novas auditadas, cada uma com o arquivo anterior correto; arquivos A, B e legado preservados",
    toB.status === 200 && backA.status === 200 && s4.activations.length === 3 && s4.activations[1].prev === pA.file && s4.activations[1].file === pB.file
    && s4.activations[2].prev === pB.file && s4.activations[2].file === pA.file && s4.activations.every((a) => a.result === "succeeded")
    && storage.has(`site-banners/banners/home/${pA.file}`) && storage.has(`site-banners/banners/home/${pB.file}`) && storage.has("site-banners/banners/home/background") && s4.chain === 0,
    JSON.stringify(s4.activations.map((a) => `${a.prev}→${a.file}:${a.result}`)));
}

// Falhas na gravação do ponteiro.
await switchToFreshDb(); storage = legacy(); reset();
{
  await postBanner("A");
  const pA = pointer("banner-home").file;
  faults.storage = { match: /^site-profile\/active\/banner-home\.json$/, when: "after" };
  const lost = await postBanner("B");
  const s1 = await snap();
  check("P6. ponteiro gravado com resposta perdida: a releitura comprova a troca e confirma (200, sem pendência)",
    lost.status === 200 && pointer("banner-home").file !== pA && s1.activations.at(-1).result === "succeeded" && s1.pending.length === 0, `${lost.status}`);
  faults.storage = { match: /^site-profile\/active\/banner-home\.json$/, when: "before" };
  const before = pointer("banner-home").file;
  const failed = await postBanner("A");
  const s2 = await snap();
  check("P7. gravação do ponteiro recusada: releitura mostra o anterior → falha registrada, 502 não pendente, banner anterior continua",
    failed.status === 502 && failed.json.pending === false && pointer("banner-home").file === before && s2.activations.at(-1).result === "failed" && s2.pending.length === 0, `${failed.status}`);
  const retry = await postBanner("A");
  const s3 = await snap();
  check("P8. nova tentativa depois da falha: nova ativação, 200", retry.status === 200 && pointer("banner-home").file === pA && s3.activations.at(-1).result === "succeeded" && s3.chain === 0);
}
await switchToFreshDb(); storage = legacy(); reset();
{
  await postBanner("A");
  reset();
  faults.rpc = { fn: "storage_lifecycle_finish_pointer_activation", nth: 1, when: "before" };
  const r1 = await postBanner("B");
  const s1 = await snap();
  const fileB = pointer("banner-home").file;
  check("P9. confirmação da ativação falhou (ponteiro já gravado): 502 pendente, operação aberta",
    r1.status >= 500 && JSON.stringify(s1.pending) === '["pointer_activate"]', `${r1.status} ${JSON.stringify(s1.pending)}`);
  reset();
  const other = await postBanner("A");
  const s2 = await snap();
  check("P10. outra imagem com ativação pendente do mesmo ponteiro: recusada (55000), ponteiro intacto", other.status === 409 && other.json.pending === true && /MESMA imagem/.test(other.json.error) && /reconcilia/.test(other.json.error) && pointer("banner-home").file === fileB && s2.pending.length === 1, other.json.error?.slice(0, 80));
  const resume = await postBanner("B");
  const s3 = await snap();
  check("P11. repetir a mesma imagem retoma a ativação pendente e confirma pela releitura (sem ativação nova)",
    resume.status === 200 && s3.pending.length === 0 && s3.activations.length === 2 && s3.activations[1].result === "succeeded" && s3.chain === 0, `${resume.status} ${s3.activations.length} ativações`);
  faults.download = /^site-profile\/active\/banner-home\.json$/;
  const unreadable = await postBanner("A");
  const s4 = await snap();
  faults.download = null;
  check("P12. ponteiro ilegível: nada é ativado (erro), ponteiro intacto, nenhuma ativação registrada", unreadable.status >= 500 && pointer("banner-home").file === fileB && s4.activations.length === 2 && s4.pending.length === 0, `${unreadable.status}`);
  const c = new pg.Client({ ...base, user: "postgres", database: currentDb });
  await c.connect();
  const rb = await c.query(read("supabase/rollbacks/20261117_storage_lifecycle_pointer_activation_rollback.sql")).then(() => "aplicou", (e) => e.message);
  await c.query("rollback").catch(() => {});
  await c.end();
  check("P13. rollback da 20261117 com ativações registradas: recusado", /Rollback recusado/.test(rb), rb.slice(0, 90));
}

// ===== Avatar =====
await switchToFreshDb(); storage = new Map(); reset();
{
  const no = await postAvatar("A", { cookie: null });
  const r = await postAvatar("B");
  const s = await snap();
  const p = pointer("avatar");
  check("P14. avatar: 401 sem sessão; com sessão 200, arquivo rastreado, ativação auditada, ponteiro e settings.json gravados",
    no.status === 401 && r.status === 200 && p?.file?.startsWith("avatar.") && s.activations.length === 1 && s.activations[0].result === "succeeded"
    && s.activations[0].actor === ACTOR && storage.has("site-profile/profile/settings.json") && s.objects.some((o) => o.bucket === "site-profile" && o.state === "unverified") && s.chain === 0,
    `${no.status}/${r.status}`);
}

// ===== Reconciliação (adaptador real via supabase-js → PostgREST/Storage simulados) =====
{
  const { reconcilePending, supabaseReconcileDeps } = await import(pathToFileURL(`${repo}/lib/images/lifecycle/reconcile.ts`).href);
  const { supabaseLifecycleRpc } = await import(pathToFileURL(`${repo}/lib/images/lifecycle/tracked.ts`).href);
  const { createClient } = repoRequire("@supabase/supabase-js");
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const rdeps = supabaseReconcileDeps(client, supabaseLifecycleRpc(client));
  // Uploads ao Storage feitos DURANTE as reconciliações (precisam ser zero: ela nunca envia nada).
  let uploadsDuringReconcile = 0;
  const reconcile = async (mode, minAgeMinutes = 0) => {
    const before = storageWrites;
    try { return await reconcilePending({ deps: rdeps, mode, actor: "teste-reconciliacao", now: new Date(Date.now() + 60_000), minAgeMinutes }); }
    finally { uploadsDuringReconcile += storageWrites - before; }
  };
  const asPostgres = async (sql) => { const c = new pg.Client({ ...base, user: "postgres", database: currentDb }); await c.connect(); try { return (await c.query(sql)).rows; } finally { await c.end(); } };
  const svc = async (fn, args) => { await api.query("begin; set local role service_role"); const n = Object.keys(args); try { const r = (await api.query(`select public.${fn}(${n.map((k, i) => `${k} => $${i + 1}`).join(", ")}) r`, n.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k])))).rows[0].r; await api.query("commit"); return r; } catch (e) { await api.query("rollback"); throw e; } };

  await switchToFreshDb(); storage = legacy(); reset();
  faults.storage = { match: /^site-banners\/banners\/home\/background\..*\.webp$/, when: "before" };
  const neverArrived = await postBanner("A");
  faults.storage = { match: /^site-profile\/profile\/avatar\..*\.webp$/, when: "after" };
  const lostResponse = await postAvatar("B");
  reset();
  const s0 = await snap();
  check("R0. dois envios pendentes criados (nunca chegou / resposta perdida)", neverArrived.status === 502 && lostResponse.status === 502
    && JSON.stringify(s0.pending) === '["object_upload","object_upload"]', `${neverArrived.status}/${lostResponse.status} ${JSON.stringify(s0.pending)}`);

  const recent = await reconcile("apply", 30);
  check("R1. idade mínima: operações recentes ficam de fora, nada é registrado", recent.decisions.every((d) => d.decision === "too_recent") && recent.applied === 0 && (await snap()).log === s0.log);
  const dry = await reconcile("dry-run");
  const s1 = await snap();
  check("R2. simulação: decide falha (ausente) e concluído (SHA e tamanho conferem), sem escrever nada",
    JSON.stringify(dry.decisions.map((d) => d.decision).sort()) === '["failed","succeeded"]' && dry.applied === 0 && s1.log === s0.log && s1.pending.length === 2);
  const applied = await reconcile("apply");
  const s2 = await snap();
  check("R3. aplicação: 2 resultados registrados pelas funções finish (evidência revalidada no banco); nada pendente; cadeia íntegra",
    applied.applied === 2 && applied.errors === 0 && s2.pending.length === 0 && s2.log === s0.log + 2 && s2.chain === 0
    && s2.objects.some((o) => o.bucket === "site-profile" && o.state === "unverified"), JSON.stringify(applied.decisions.map((d) => d.applied)));
  const retry = await postBanner("A");
  const s3 = await snap();
  check("R4. depois da falha registrada, o mesmo banner é enviado de novo (chave da 2ª tentativa) e ativado",
    retry.status === 200 && s3.activations.at(-1)?.result === "succeeded" && s3.pending.length === 0, `${retry.status}`);

  reset();
  faults.rpc = { fn: "storage_lifecycle_finish_pointer_activation", nth: 1, when: "before" };
  await postBanner("B");
  reset();
  const avatarFile = pointer("avatar")?.file ?? null;
  const avatarObj = (await snap()).objects.find((o) => o.bucket === "site-profile" && o.object_path.startsWith("profile/avatar."));
  await svc("storage_lifecycle_begin_pointer_activation", { p_pointer: "avatar", p_bucket: "site-profile", p_object_path: avatarObj.object_path, p_previous_file: avatarFile, p_actor: "teste", p_reason: "intenção sem gravação" });
  const gameImage = (await asPostgres("select image from public.games where slug = 'jogo-a'"))[0].image;
  const newUrl = `http://127.0.0.1:${PORT}/storage/v1/object/public/site-banners/banners/a.0123456789abcdef.webp`;
  await svc("storage_lifecycle_begin_reference_batch", { p_idempotency_key: "lote-completo", p_actor: "teste", p_reason: "teste", p_items: [{ key: "lote-completo:1", table: "games", row_key: "jogo-a", column: "image", old_value: gameImage, new_value: newUrl }] });
  await svc("storage_lifecycle_replace_reference", { p_idempotency_key: "lote-completo:1", p_table: "games", p_row_key: "jogo-a", p_column: "image", p_expected_value: gameImage, p_new_value: newUrl, p_actor: "teste", p_reason: "teste" });
  await svc("storage_lifecycle_begin_reference_batch", { p_idempotency_key: "lote-incompleto", p_actor: "teste", p_reason: "teste", p_items: [{ key: "lote-incompleto:1", table: "games", row_key: "jogo-a", column: "card_image", old_value: "", new_value: newUrl }] });
  storage.set("site-banners/banners/home/background.ffffffffffffffff.webp", { id: randomUUID(), bytes: Buffer.from("x"), contentType: "image/webp", metadata: null, at: new Date().toISOString() });
  await svc("storage_lifecycle_begin_upload", { p_idempotency_key: "envio-sem-prova", p_bucket: "site-banners", p_object_path: "banners/home/background.ffffffffffffffff.webp", p_sha256: "f".repeat(64), p_size: 1, p_mimetype: "image/webp", p_actor: "teste", p_reason: "teste" });
  const s4 = await snap();
  const second = await reconcile("apply");
  const s5 = await snap();
  const byOp = Object.fromEntries(second.decisions.map((d) => [`${d.operation}:${d.decision}`, d]));
  check("R5. ponteiro já gravado → concluído; intenção sem gravação → falha; lote completo → concluído; lote incompleto e envio sem prova → pendentes",
    s4.pending.length === 5 && byOp["pointer_activate:succeeded"] && byOp["pointer_activate:failed"] && byOp["reference_batch:finish_batch"]
    && byOp["reference_batch:keep_pending"] && byOp["object_upload:keep_pending"] && second.applied === 3 && second.errors === 0
    && JSON.stringify(s5.pending.sort()) === '["object_upload","reference_batch"]' && s5.chain === 0,
    second.decisions.map((d) => `${d.operation}:${d.decision}`).join(", "));
  check("R6. nada foi enviado, trocado nem apagado pela reconciliação (0 uploads; Storage e referências intactos)",
    uploadsDuringReconcile === 0 && storage.has("site-banners/banners/home/background.ffffffffffffffff.webp") && (await asPostgres("select card_image from public.games where slug = 'jogo-a'"))[0].card_image !== newUrl);
  const third = await reconcile("apply");
  const s6 = await snap();
  check("R7. repetir a reconciliação: só os 2 pendentes sem prova continuam; nada novo registrado nem enviado", third.applied === 0 && s6.log === s5.log && s6.pending.length === 2 && uploadsDuringReconcile === 0);
}

check("nenhuma requisição saiu de 127.0.0.1", outbound.length > 0 && outbound.every((h) => h === `127.0.0.1:${PORT}`), `${outbound.length} requisições`);
} finally {
  // Encerrado sempre, inclusive se uma etapa lançar erro no meio da suíte.
  await stopServer();
}
await api.end();
await admin.end();
const failedCount = results.filter((x) => !x).length;
console.log(failedCount ? `\n${failedCount} falha(s) de ${results.length}` : `\nTudo aprovado (${results.length} verificações).`);
process.exitCode = failedCount ? 1 : 0;

// Etapa 5.1 — salvamentos em massa com os handlers REAIS (rotas de jogos, conquistas, sincronizações,
// Maestria, Emblema, review, recover-mouse): autenticação real, supabase-js real, PostgREST e Storage
// simulados aqui (127.0.0.1), PostgreSQL 17 local com postgres NÃO superusuário, gatilhos reais e as
// migrações 20261114/16/17/18. Cada cenário também roda a versão ANTERIOR (HEAD) da rota num banco
// gêmeo: fora a auditoria, as tabelas do site precisam ficar idênticas. Nada sai de 127.0.0.1.
import http from "node:http";
import pg from "pg";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const repo = process.env.REPO;
const headDir = process.env.HEAD_DIR;
const replica = process.argv[2];
if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http://127.0.0.1:")) throw new Error("URL do Supabase não é local; abortado");
if (/supabase\.co/.test(JSON.stringify(process.env))) throw new Error("variável apontando para supabase.co no ambiente; abortado");
const PORT = Number(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).port);
const read = (p) => readFileSync(`${repo}/${p}`, "utf8");
const repoRequire = createRequire(`${repo}/package.json`);
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${String(detail).slice(0, 220)}` : ""}`); };

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
const S = (path) => `http://127.0.0.1:${PORT}/storage/v1/object/public/achievement-art/${path}`;
const A = (slug, n) => S(`games/${slug}/achievements/${n}.webp`);
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
  await db.query("delete from public.achievement_progress; delete from public.achievements; delete from public.games; delete from public.journey_history_events;");
  // Restrições únicas que as rotas usam em upsert (on_conflict); conferidas no Production pelo precheck.
  await db.query(`create unique index achievements_game_legacy_key on public.achievements (game_slug, legacy_id);
    create unique index achievement_progress_owner_achievement_key on public.achievement_progress (owner_key, achievement_id);`);
  for (const m of ["20261102_add_games_backlog_order", "20261114_create_storage_image_lifecycle", "20261116_storage_lifecycle_tracked_uploads",
    "20261117_storage_lifecycle_pointer_activation", "20261118_storage_lifecycle_reference_sync", "20261119_storage_lifecycle_scan_policy"]) {
    await db.query(read(`supabase/migrations/${m}.sql`));
  }
  const game = (slug) => `insert into public.games (slug, title, status, image, card_image, final_badge, emblem, trophies, review) values ('${slug}', 'Jogo ${slug}', 'progress',
      '${S(`games/${slug}/banner.webp`)}', '/images/games/${slug}/cover.jpg',
      '{"title": "Maestria Final", "icon": "💎", "image": "${S(`games/${slug}/maestria.webp`)}", "description": "fim"}',
      '{"title": "Emblema", "image": "${S(`games/${slug}/emblema.webp`)}", "description": "e", "tags": [], "configured": true}',
      '[{"icon": "${S(`games/${slug}/t0.webp`)}", "name": "T0"}]',
      '{"texto": "review de ${slug}", "capa": "${S(`games/${slug}/review.webp`)}"}');`;
  const ach = (slug, i, extra = "") => `insert into public.achievements (id, game_slug, legacy_id, title, image, sort_order${extra ? ", is_custom" : ""}) values
      ('00000000-0000-0000-0000-${slug === "jogo-a" ? "a" : "b"}0000000000${i}', '${slug}', 'l${i}', 'Conquista ${i}', '${A(slug, i)}', ${i}${extra ? ", true" : ""});`;
  await db.query([game("jogo-a"), game("jogo-b"),
    ach("jogo-a", 1), ach("jogo-a", 2), ach("jogo-a", 3), ach("jogo-b", 1, "c"), ach("jogo-b", 2, "c"),
    `insert into public.achievement_progress (achievement_id, owner_key, status, earned_at, image_override) values
      ('00000000-0000-0000-0000-a00000000001', 'default', 'completed', '2026-10-01', '${A("jogo-a", 1)}'),
      ('00000000-0000-0000-0000-a00000000002', 'default', 'locked', null, '${A("jogo-a", 2)}'),
      ('00000000-0000-0000-0000-a00000000003', 'default', 'locked', null, '${A("jogo-a", 3)}'),
      ('00000000-0000-0000-0000-a00000000002', 'visitante', 'locked', null, '${A("jogo-a", "2-v")}'),
      ('00000000-0000-0000-0000-b00000000001', 'default', 'locked', null, '${A("jogo-b", 1)}'),
      ('00000000-0000-0000-0000-b00000000002', 'default', 'locked', null, '${A("jogo-b", 2)}');`].join("\n"));
  await db.end();
}
let dbCounter = 0;
let api = null;
const connections = new Map();
async function freshDb() {
  const name = `rumo_${++dbCounter}`;
  await admin.query(`create database ${name} template rumo_base owner postgres`);
  return name;
}
// Um pool por banco: cada requisição simulada usa a própria conexão e transação (como o PostgREST).
async function selectDb(name) {
  if (!connections.has(name)) connections.set(name, new pg.Pool({ ...base, user: "authenticator", database: name, max: 6 }));
  api = connections.get(name);
}
async function sql(dbName, text, params) {
  const c = new pg.Client({ ...base, user: process.env.PG_ADMIN_USER ?? "supabase_admin", database: dbName });
  await c.connect();
  try { return (await c.query(text, params)).rows; } finally { await c.end(); }
}

// ---------- PostgREST + Storage simulados ----------
let faults = [];   // { method, target, nth, mode: "before" | "after" | "gate", gate?: Promise }
const counters = {};
const q = (name) => `"${name.replace(/"/g, '""')}"`;
const parseList = (v) => v.slice(1, -1).split(",").map((s) => s.trim().replace(/^"(.*)"$/, "$1"));
function filters(url) {
  const where = []; const vals = [];
  for (const [k, v] of url.searchParams) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
    let mm;
    if ((mm = /^eq\.(.*)$/s.exec(v))) { vals.push(mm[1]); where.push(`${q(k)}::text = $${vals.length}`); }
    else if ((mm = /^neq\.(.*)$/s.exec(v))) { vals.push(mm[1]); where.push(`${q(k)}::text <> $${vals.length}`); }
    else if ((mm = /^in\.(\(.*\))$/s.exec(v))) { vals.push(parseList(mm[1])); where.push(`${q(k)}::text = any($${vals.length})`); }
    else if (v === "not.is.null") where.push(`${q(k)} is not null`);
    else if (v === "is.null") where.push(`${q(k)} is null`);
    else throw Object.assign(new Error(`filtro não simulado ${k}=${v}`), { code: "PGRST100" });
  }
  return { where, vals };
}
const selectCols = (url) => {
  const raw = url.searchParams.get("select");
  if (!raw) return "*";
  return raw.split(",").map((c) => c.trim()).filter(Boolean).map((c) => (c === "*" ? c : q(c))).join(", ");
};
const orderBy = (url) => {
  const o = url.searchParams.get("order");
  if (!o) return "";
  return " order by " + o.split(",").map((part) => { const [c, dir] = part.split("."); return `${q(c)} ${dir === "desc" ? "desc" : "asc"}`; }).join(", ");
};
async function tx(fn) {
  const c = await api.connect();
  try {
    await c.query("begin; set local role service_role");
    try { const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback"); throw e; }
  } finally { c.release(); }
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks);
  const send = (status, payload, headers = {}) => { if (res.headersSent) return; res.writeHead(status, { "Content-Type": "application/json", ...headers }); res.end(payload === undefined ? undefined : JSON.stringify(payload)); };
  try {
    if (req.headers.apikey !== process.env.SUPABASE_SERVICE_ROLE_KEY) return send(401, { message: "chave inválida" });
    // Storage: listagem vazia, download inexistente, upload aceito (rascunho do recover-mouse).
    if (url.pathname.startsWith("/storage/v1/object/list/")) return send(200, []);
    if (url.pathname.startsWith("/storage/v1/object/") && req.method === "GET") return send(400, { statusCode: "404", error: "not_found", message: "Object not found" });
    if (url.pathname.startsWith("/storage/v1/object/") && req.method === "POST") return send(200, { Key: url.pathname });
    let m = url.pathname.match(/^\/rest\/v1\/(rpc\/)?(\w+)$/);
    if (!m) return send(404, { message: `não simulado: ${req.method} ${url.pathname}` });
    const target = m[1] ? `rpc:${m[2]}` : m[2];
    const key = `${req.method} ${target}`;
    counters[key] = (counters[key] ?? 0) + 1;
    const fault = faults.find((f) => f.method === req.method && f.target === target && f.nth === counters[key]);
    if (fault?.mode === "before") return send(500, { code: "08006", message: `falha simulada antes: ${key}`, details: null, hint: null });
    if (fault?.mode === "gate") await fault.gate;
    const body = raw.length ? JSON.parse(raw.toString("utf8")) : null;
    const prefer = String(req.headers.prefer ?? "");
    const wantsObject = /vnd\.pgrst\.object/.test(req.headers.accept ?? "");
    const representation = /return=representation/.test(prefer);
    let rows;
    if (m[1]) {
      const names = Object.keys(body ?? {});
      const values = names.map((n) => (body[n] !== null && typeof body[n] === "object" ? JSON.stringify(body[n]) : body[n]));
      const r = await tx(async (c) => (await c.query(`select public.${m[2]}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`, values)).rows[0].r);
      if (fault?.mode === "after") return req.socket.destroy();
      return send(200, r);
    }
    const table = `public.${q(m[2])}`;
    const { where, vals } = filters(url);
    const whereSql = where.length ? ` where ${where.join(" and ")}` : "";
    if (req.method === "GET") {
      rows = await tx(async (c) => (await c.query(`select ${selectCols(url)} from ${table}${whereSql}${orderBy(url)}`, vals)).rows);
    } else if (req.method === "POST") {
      const list = Array.isArray(body) ? body : [body];
      const cols = [...new Set(list.flatMap((row) => Object.keys(row)))];
      const conflict = url.searchParams.get("on_conflict");
      const upsert = /resolution=merge-duplicates/.test(prefer);
      const colSql = cols.map(q).join(", ");
      const onConflict = upsert && conflict
        ? ` on conflict (${conflict.split(",").map(q).join(", ")}) do update set ${cols.map((c) => `${q(c)} = excluded.${q(c)}`).join(", ")}`
        : upsert ? ` on conflict do nothing` : "";
      rows = await tx(async (c) => (await c.query(
        `insert into ${table} (${colSql}) select ${colSql} from jsonb_populate_recordset(null::${table}, $1::jsonb)${onConflict} returning ${selectCols(url)}`,
        [JSON.stringify(list)])).rows);
    } else if (req.method === "PATCH") {
      const cols = Object.keys(body);
      rows = await tx(async (c) => (await c.query(
        `update ${table} set (${cols.map(q).join(", ")}) = (select ${cols.map(q).join(", ")} from jsonb_populate_record(null::${table}, $${vals.length + 1}::jsonb))${whereSql} returning ${selectCols(url)}`,
        [...vals, JSON.stringify(body)])).rows);
    } else if (req.method === "DELETE") {
      rows = await tx(async (c) => (await c.query(`delete from ${table}${whereSql} returning ${selectCols(url)}`, vals)).rows);
    } else return send(405, { message: "método não simulado" });
    if (fault?.mode === "after") return req.socket.destroy();
    if (req.method !== "GET" && !representation) return send(201, undefined);
    if (wantsObject) {
      if (rows.length !== 1) return send(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${rows.length} rows`, hint: null });
      return send(200, rows[0]);
    }
    return send(200, rows, { "Content-Range": `0-${Math.max(rows.length - 1, 0)}/*` });
  } catch (e) {
    send(400, { code: e.code ?? "XX000", message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
  }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

// ---------- Handlers reais (novos e HEAD) ----------
const { NextRequest } = repoRequire("next/server");
const imp = (p) => import(pathToFileURL(p).href);
const ROUTES = {
  games: "app/api/admin/games/route.ts",
  finalMastery: "app/api/admin/games/final-mastery/route.ts",
  gamesSync: "app/api/admin/games/sync/route.ts",
  achievements: "app/admin/api/achievements/route.ts",
  youtube: "app/api/youtube/channel/games/sync/route.ts",
  recoverMouse: "app/api/admin/recover-mouse/route.ts",
};
const NEW = {}, OLD = {};
for (const [k, p] of Object.entries(ROUTES)) { NEW[k] = await imp(`${repo}/${p}`); OLD[k] = await imp(`${headDir}/${p}`); }
const { createAdminSession, ADMIN_SESSION_COOKIE } = await imp(`${repo}/lib/admin-auth.ts`);
const { reconcilePending, supabaseReconcileDeps } = await imp(`${repo}/lib/images/lifecycle/reconcile.ts`);
const { supabaseLifecycleRpc } = await imp(`${repo}/lib/images/lifecycle/tracked.ts`);
const { createClient } = repoRequire("@supabase/supabase-js");
const token = await createAdminSession();
const COOKIE = `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`;
globalThis.__cookies = { [ADMIN_SESSION_COOKIE]: token };

async function call(mod, method, path, body, { cookie = COOKIE } = {}) {
  const request = new NextRequest(`http://localhost${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) } });
  const response = await mod[method](request);
  let json = null;
  try { json = await response.json(); } catch {}
  return { status: response.status, json };
}

// Estado comparável do site (sem ids/tempos) e a auditoria.
async function siteState(dbName) {
  const games = await sql(dbName, `select slug, title, subtitle, status, progress, hours, current_objective, image, card_image, final_badge, emblem, trophies, review, is_hidden, is_deleted, manual_total_played_minutes, platform from public.games order by slug`);
  const achievements = await sql(dbName, `select game_slug, legacy_id, title, description, trophy, rank, image, sort_order, is_custom, is_hidden, source, external_id, official_image from public.achievements order by game_slug, legacy_id`);
  const progress = await sql(dbName, `select a.game_slug, a.legacy_id, p.owner_key, p.status, p.earned_at::text, p.rank_override, p.image_override from public.achievement_progress p join public.achievements a on a.id = p.achievement_id order by 1, 2, 3`);
  const history = await sql(dbName, `select event_type, game_slug, source_table from public.journey_history_events order by 1, 2, 3`);
  return { games, achievements, progress, history };
}
async function audit(dbName) {
  const log = await sql(dbName, `select operation, phase, actor, details from public.storage_operation_log where operation = 'reference_sync' order by id`);
  const pending = await sql(dbName, `select operation_id from public.storage_lifecycle_pending_operations where operation = 'reference_sync'`);
  const chain = await sql(dbName, `select count(*)::int as problems from public.storage_operation_log_verify()`);
  return { log, pending: pending.length, chainProblems: chain[0].problems };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- Plano isolado: preparação, ida, volta e recuperação (Etapa 5, teste real proposto) ----------
const PREP = readFileSync(process.env.PREP_SQL, "utf8");
const TEST_IMG = S("games/lifecycle-test/achievements/lifecycle-test-6bfa4f71.fae5895747756909.webp");
const fm = (image) => ({ slug: "lifecycle-test", finalBadge: { title: "Teste do ciclo de vida", icon: "💎", image, description: "Registro isolado de teste; nunca exibido." } });
let ORIGINAL;
const asService = async (db, text, params) => { const c = new pg.Client({ ...base, user: "authenticator", database: db }); await c.connect(); try { await c.query("set role service_role"); return (await c.query(text, params)).rows; } finally { await c.end(); } };
async function prepared() {
  const db = await freshDb();
  await sql(db, PREP);
  await selectDb(db);
  ORIGINAL = (await sql(db, `select final_badge from public.games where slug = 'lifecycle-test'`))[0].final_badge;
  return db;
}
const gameRow = async (db) => (await sql(db, `select slug, title, status, progress, hours, image, card_image, final_badge, emblem, trophies, review, is_hidden, is_deleted, backlog_order, manual_total_played_minutes from public.games where slug = 'lifecycle-test'`))[0];
const others = async (db) => {
  const s = await siteState(db);
  return { ...s, games: s.games.filter((g) => g.slug !== "lifecycle-test") };
};
const publicCatalog = async (db) => (await sql(db, `select slug from public.games where is_deleted = false and is_hidden = false`)).map((r) => r.slug);
const fmItems = (a) => a.log.filter((l) => l.phase === "intent").flatMap((l) => l.details.items);

// I1. Preparação isolada (o SQL proposto, sem mudança).
{
  const base = await freshDb();
  const before = { history: (await siteState(base)).history.length, catalog: await publicCatalog(base) };
  const db = await prepared();
  const after = { history: (await siteState(db)).history.length, catalog: await publicCatalog(db) };
  const row = await gameRow(db);
  const again = await sql(db, PREP).then(() => null, (e) => e.message);
  check("I1. preparação: jogo oculto+excluído, fora do catálogo e da fila; histórico público inalterado; repetir é recusado sem gravar",
    row?.is_hidden && row.is_deleted && row.backlog_order === null && before.history === after.history && same(before.catalog, after.catalog)
      && /Já existe/.test(again ?? ""), `${before.history}/${after.history} ${again}`);
}
// I2–I3. Ida e volta pela rota real final-mastery.
{
  const db = await prepared();
  const beforeRow = await gameRow(db);
  const beforeOthers = await others(db);
  const a = await call(NEW.finalMastery, "POST", "/api/admin/games/final-mastery", fm(TEST_IMG));
  const mid = await audit(db);
  const midRow = await gameRow(db);
  const itemsA = fmItems(mid);
  check("I2. ida: 200; final_badge.image = imagem de teste; reference_sync confirmado pela releitura (1 item games.final_badge[image]); cadeia íntegra",
    a.status === 200 && midRow.final_badge.image === TEST_IMG && mid.log.map((l) => l.phase).join() === "intent,succeeded"
      && itemsA.length === 1 && itemsA[0].column === "final_badge" && itemsA[0].path.join() === "image" && itemsA[0].new === TEST_IMG
      && itemsA[0].new_object === "achievement-art/games/lifecycle-test/achievements/lifecycle-test-6bfa4f71.fae5895747756909.webp"
      && mid.chainProblems === 0 && mid.pending === 0, `${a.status} ${JSON.stringify(itemsA[0] ?? {}).slice(0, 120)}`);
  const b = await call(NEW.finalMastery, "POST", "/api/admin/games/final-mastery", fm(ORIGINAL.image));
  const end = await audit(db);
  const endRow = await gameRow(db);
  const keys = Object.keys(beforeRow).filter((k) => !same(beforeRow[k], endRow[k]));
  check("I3. volta: 200; final_badge idêntico ao original (JSON completo); nenhum outro campo do jogo, de outros jogos, conquistas, progresso ou histórico mudou; 4 registros novos",
    b.status === 200 && same(endRow.final_badge, ORIGINAL) && keys.length === 0 && same(await others(db), beforeOthers)
      && end.log.length === 4 && end.log.at(-1).phase === "succeeded" && end.chainProblems === 0 && end.pending === 0,
    `${b.status} campos diferentes: ${keys.join(",") || "nenhum"}`);
}
// I4. Volta falha ANTES de gravar: imagem de teste fica num jogo oculto; recuperação auditada por
//     storage_lifecycle_replace_json_reference (valor esperado conferido) restaura o original.
{
  const db = await prepared();
  await call(NEW.finalMastery, "POST", "/api/admin/games/final-mastery", fm(TEST_IMG));
  faults = [{ method: "PATCH", target: "games", nth: (counters["PATCH games"] ?? 0) + 1, mode: "before" }];
  const b = await call(NEW.finalMastery, "POST", "/api/admin/games/final-mastery", fm(ORIGINAL.image));
  faults = [];
  const stuck = (await gameRow(db)).final_badge.image;
  const catalog = await publicCatalog(db);
  const rec = await asService(db, `select public.storage_lifecycle_replace_json_reference('recuperacao:lifecycle-test:1', 'games', 'lifecycle-test', 'final_badge', array['image'], $1, $2, 'teste:recuperacao', 'recuperação do teste isolado') as r`, [TEST_IMG, ORIGINAL.image]).then((r) => r[0].r, (e) => ({ error: e.message }));
  const row = await gameRow(db);
  const a = await audit(db);
  const jr = await sql(db, `select phase from public.storage_operation_log where operation = 'json_reference_replace' order by id`);
  check("I4. volta falha antes de gravar: 500, imagem de teste só no jogo oculto (fora do catálogo); recuperação auditada restaura o JSON original; nada pendente",
    b.status === 500 && stuck === TEST_IMG && !catalog.includes("lifecycle-test") && rec?.status === "applied" && same(row.final_badge, ORIGINAL)
      && jr.map((r) => r.phase).join() === "intent,succeeded" && a.pending === 0 && a.chainProblems === 0, `${b.status} ${JSON.stringify(rec).slice(0, 100)}`);
  const twice = await asService(db, `select public.storage_lifecycle_replace_json_reference('recuperacao:lifecycle-test:1', 'games', 'lifecycle-test', 'final_badge', array['image'], $1, $2, 'teste:recuperacao', 'recuperação do teste isolado') as r`, [TEST_IMG, ORIGINAL.image]).then((r) => r[0].r.status);
  check("I4b. repetir a recuperação: already_applied, nada novo", twice === "already_applied", twice);
}
// I5. Volta grava mas a confirmação se perde: 502 pendente; a reconciliação relê e confirma.
{
  const db = await prepared();
  await call(NEW.finalMastery, "POST", "/api/admin/games/final-mastery", fm(TEST_IMG));
  faults = [{ method: "POST", target: "rpc:storage_lifecycle_finish_reference_sync", nth: (counters["POST rpc:storage_lifecycle_finish_reference_sync"] ?? 0) + 1, mode: "before" }];
  const b = await call(NEW.finalMastery, "POST", "/api/admin/games/final-mastery", fm(ORIGINAL.image));
  faults = [];
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const rec = await reconcilePending({ deps: supabaseReconcileDeps(client, supabaseLifecycleRpc(client)), mode: "apply", actor: "teste", now: new Date(), minAgeMinutes: 0 });
  const a = await audit(db);
  check("I5. volta grava e a confirmação se perde: 502 pendente; JSON já original; reconciliação confirma (succeeded)",
    b.status === 502 && same((await gameRow(db)).final_badge, ORIGINAL) && rec.applied === 1 && a.pending === 0 && a.log.at(-1).phase === "succeeded",
    `${b.status} ${rec.applied}`);
}
// I6. Volta com a imagem errada (digitação): 200 mas JSON ≠ original → detectado pela comparação; recuperação igual a I4.
{
  const db = await prepared();
  await call(NEW.finalMastery, "POST", "/api/admin/games/final-mastery", fm(TEST_IMG));
  const b = await call(NEW.finalMastery, "POST", "/api/admin/games/final-mastery", fm(ORIGINAL.image + " "));
  check("I6. normalização: espaço extra no valor de volta é removido pela rota e o JSON fica idêntico ao original",
    b.status === 200 && same((await gameRow(db)).final_badge, ORIGINAL), JSON.stringify((await gameRow(db)).final_badge.image));
}

check("nenhuma requisição saiu de 127.0.0.1 (vigia do fetch)", outbound.every((h) => h.startsWith("127.0.0.1")), [...new Set(outbound)].join(","));
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} verificações passaram`);
for (const c of connections.values()) await c.end();
await admin.end();
server.close();
process.exit(ok === results.length ? 0 : 1);

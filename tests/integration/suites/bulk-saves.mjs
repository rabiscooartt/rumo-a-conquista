// Etapa 5.1 — salvamentos em massa com os handlers REAIS (rotas de jogos, conquistas, sincronizações,
// Maestria, Emblema, review, recover-mouse): autenticação real, supabase-js real, PostgREST e Storage
// simulados aqui (127.0.0.1), PostgreSQL 17 local com postgres NÃO superusuário, gatilhos reais e as
// migrações 20261114/16/17/18. Cada cenário também roda a versão ANTERIOR (HEAD) da rota num banco
// gêmeo: fora a auditoria, as tabelas do site precisam ficar idênticas. Nada sai de 127.0.0.1.
import http from "node:http";
import pg from "pg";
import { randomUUID } from "node:crypto";
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
function diffKeys(a, b) {
  const out = [];
  for (const k of Object.keys(a)) if (!same(a[k], b[k])) out.push(k);
  return out.join(",") || "nenhuma";
}

/** Roda o mesmo pedido na rota nova e na HEAD (bancos gêmeos); devolve os dois lados. */
async function twin(route, method, path, body, prep) {
  const dbNew = await freshDb(); const dbOld = await freshDb();
  if (prep) { await prep(dbNew); await prep(dbOld); }
  await selectDb(dbOld); const old = await call(OLD[route], method, path, body);
  await selectDb(dbNew); const now = await call(NEW[route], method, path, body);
  return { dbNew, dbOld, old, now, stateNew: await siteState(dbNew), stateOld: await siteState(dbOld), audit: await audit(dbNew) };
}
const succeededItems = (a) => a.log.filter((l) => l.phase === "intent").reduce((n, l) => n + l.details.count, 0);

// ---------- Cargas ----------
const fullGame = (slug, changes = {}) => ({
  slug, title: `Jogo ${slug}`, status: "progress",
  image: S(`games/${slug}/banner.webp`), cardImage: `/images/games/${slug}/cover.jpg`,
  finalBadge: { title: "Maestria Final", icon: "💎", image: S(`games/${slug}/maestria.webp`), description: "fim" },
  emblem: { title: "Emblema", image: S(`games/${slug}/emblema.webp`), description: "e", tags: [], configured: true },
  trophies: [{ icon: S(`games/${slug}/t0.webp`), name: "T0" }],
  review: { texto: `review de ${slug}`, capa: S(`games/${slug}/review.webp`) },
  achievementsList: [1, 2, 3].map((i) => ({ id: `l${i}`, title: `Conquista ${i}`, image: A(slug, i), status: i === 1 ? "completed" : "locked", earnedDate: i === 1 ? "2026-10-01" : "" })),
  ...changes,
});

// =====================================================================================
// A. Rota principal (POST /api/admin/games, jogo completo) — matriz completa.
// =====================================================================================
{
  // A1. Sem alteração de imagem: nenhuma operação; mesmas tabelas que a HEAD.
  const t = await twin("games", "POST", "/api/admin/games", fullGame("jogo-a", { title: "Jogo A renomeado" }));
  check("A1. jogo completo sem troca de imagem: 200, nenhuma operação registrada, tabelas idênticas à versão anterior",
    t.now.status === 200 && t.old.status === 200 && t.audit.log.length === 0 && same(t.stateNew, t.stateOld), `${t.now.status}/${t.old.status} ops=${t.audit.log.length} dif=${diffKeys(t.stateNew, t.stateOld)}`);

  // A2. Uma referência (banner).
  const t2 = await twin("games", "POST", "/api/admin/games", fullGame("jogo-a", { image: S("games/jogo-a/banner-2.webp") }));
  const i2 = t2.audit.log.find((l) => l.phase === "intent");
  check("A2. uma referência trocada: intenção com local/anterior/novo, confirmada pela releitura; tabelas iguais à anterior",
    t2.now.status === 200 && t2.audit.log.map((l) => l.phase).join() === "intent,succeeded" && i2?.details.count === 1
      && i2.details.items[0].column === "image" && i2.details.items[0].old === S("games/jogo-a/banner.webp") && i2.details.items[0].new_object === "achievement-art/games/jogo-a/banner-2.webp"
      && t2.audit.log[1].details.method === "db_read_back" && t2.audit.log[0].actor === "admin:admin-teste" && same(t2.stateNew, t2.stateOld) && t2.audit.chainProblems === 0,
    `${t2.now.status} ${JSON.stringify(i2?.details.items?.[0]).slice(0, 160)} dif=${diffKeys(t2.stateNew, t2.stateOld)}`);

  // A3. Múltiplas: JSON (Maestria, Emblema, troféus, review), conquista removida, nova, override.
  const multi = fullGame("jogo-a", {
    finalBadge: { title: "Maestria Final", icon: "💎", image: S("games/jogo-a/maestria-2.webp"), description: "fim" },
    emblem: { title: "Emblema", image: S("games/jogo-a/emblema-2.webp"), description: "e", tags: [], configured: true },
    trophies: [{ icon: S("games/jogo-a/t0.webp"), name: "T0" }, { icon: S("games/jogo-a/t1.webp"), name: "T1" }],
    review: { texto: "review de jogo-a", capa: S("games/jogo-a/review-2.webp") },
    achievementsList: [
      { id: "l1", title: "Conquista 1", image: A("jogo-a", "1-b"), status: "completed", earnedDate: "2026-10-01" },
      { id: "l4", title: "Conquista 4", image: A("jogo-a", 4), status: "locked" },
    ],
  });
  const t3 = await twin("games", "POST", "/api/admin/games", multi);
  const items3 = t3.audit.log.filter((l) => l.phase === "intent").flatMap((l) => l.details.items);
  const cols3 = items3.map((i) => `${i.table}.${i.column}${i.path ? "[" + i.path.join(".") + "]" : ""}`).sort();
  check("A3. múltiplas referências (JSON, removida, nova, override; outro dono incluído): todas registradas e comprovadas; tabelas iguais à anterior",
    t3.now.status === 200 && t3.audit.pending === 0 && t3.audit.log.at(-1).phase === "succeeded" && same(t3.stateNew, t3.stateOld)
      && cols3.includes("games.final_badge[image]") && cols3.includes("games.emblem[image]") && cols3.includes("games.trophies[1.icon]")
      && cols3.includes("games.review[capa]") && items3.some((i) => i.table === "achievement_progress" && i.row.owner_key === "visitante" && i.new === null),
    `${t3.now.status} itens=${items3.length} ${cols3.join(" ")} dif=${diffKeys(t3.stateNew, t3.stateOld)}`);

  // A4. Repetição do mesmo pedido: nada novo a registrar.
  await selectDb(t3.dbNew);
  const again = await call(NEW.games, "POST", "/api/admin/games", multi);
  const a4 = await audit(t3.dbNew);
  check("A4. repetir o mesmo salvamento: 200, nenhuma operação nova (diferença vazia)", again.status === 200 && a4.log.length === t3.audit.log.length, `${again.status} ${a4.log.length}`);

  // A5. Referência inválida: 400, nada gravado, nenhuma intenção.
  const bad = fullGame("jogo-a", { image: `http://127.0.0.1:${PORT}/storage/v1/object/public/achievement-art/../x.webp` });
  const t5 = await twin("games", "POST", "/api/admin/games", bad);
  const untouched5 = (await siteState(t5.dbNew)).games.find((g) => g.slug === "jogo-a").image === S("games/jogo-a/banner.webp");
  check("A5. referência ao Storage inválida: 400 com o motivo, nada gravado, nenhuma intenção", t5.now.status === 400 && t5.audit.log.length === 0 && untouched5 && /inválida/.test(t5.now.json?.error ?? ""), `${t5.now.status} ${t5.now.json?.error}`);

  // A6. Falha ANTES da gravação (games upsert recusado): erro original, intenção encerrada como failed/not_applied.
  const db6 = await freshDb(); await selectDb(db6);
  faults = [{ method: "POST", target: "games", nth: (counters["POST games"] ?? 0) + 1, mode: "before" }];
  const r6 = await call(NEW.games, "POST", "/api/admin/games", fullGame("jogo-a", { image: S("games/jogo-a/banner-6.webp") }));
  faults = [];
  const a6 = await audit(db6);
  const g6 = (await siteState(db6)).games.find((g) => g.slug === "jogo-a").image;
  check("A6. falha antes da gravação: 500 original, banco intocado, auditoria encerrada como failed (not_applied), nada pendente",
    r6.status === 500 && g6 === S("games/jogo-a/banner.webp") && a6.log.map((l) => l.phase).join() === "intent,failed" && a6.log[1].details.reason === "not_applied" && a6.pending === 0,
    `${r6.status} ${a6.log.map((l) => l.phase)}`);

  // A7. Falha parcial: jogo gravado, conquistas falham → mistura → 502 pendente; repetir conclui.
  const db7 = await freshDb(); await selectDb(db7);
  const req7 = fullGame("jogo-a", { image: S("games/jogo-a/banner-7.webp"), achievementsList: [{ id: "l1", title: "Conquista 1", image: A("jogo-a", "1-7"), status: "completed", earnedDate: "2026-10-01" }, { id: "l2", title: "Conquista 2", image: "" }, { id: "l3", title: "Conquista 3", image: A("jogo-a", 3) }] });
  faults = [{ method: "POST", target: "achievements", nth: (counters["POST achievements"] ?? 0) + 1, mode: "before" }];
  const r7 = await call(NEW.games, "POST", "/api/admin/games", req7);
  faults = [];
  const a7 = await audit(db7);
  check("A7. falha parcial (jogo gravado, conquistas não): 502 pendente com orientação; operação aberta, sem confirmação falsa",
    r7.status === 502 && r7.json?.pending === true && /repita o MESMO salvamento/.test(r7.json?.error ?? "") && a7.pending === 1 && !a7.log.some((l) => l.phase === "succeeded"),
    `${r7.status} ${r7.json?.error}`);
  // A8. Recuperação: repetir o MESMO pedido retoma a operação pendente (itens originais) e confirma.
  const r8 = await call(NEW.games, "POST", "/api/admin/games", req7);
  const a8 = await audit(db7);
  check("A8. repetir o mesmo pedido retoma a pendência e confirma (sem duplicar intenção)",
    r8.status === 200 && a8.pending === 0 && a8.log.filter((l) => l.phase === "intent").length === 1 && a8.log.at(-1).phase === "succeeded", `${r8.status} ${a8.log.map((l) => l.phase)}`);

  // A9. Outro pedido enquanto há pendência: 409, nada gravado.
  const db9 = await freshDb(); await selectDb(db9);
  faults = [{ method: "POST", target: "achievements", nth: (counters["POST achievements"] ?? 0) + 1, mode: "before" }];
  await call(NEW.games, "POST", "/api/admin/games", req7);
  faults = [];
  const before9 = await siteState(db9);
  const r9 = await call(NEW.games, "POST", "/api/admin/games", fullGame("jogo-a", { image: S("games/jogo-a/banner-9.webp") }));
  check("A9. outro salvamento do mesmo jogo com pendência aberta: 409 explicando, nada gravado",
    r9.status === 409 && /Outro salvamento deste jogo/.test(r9.json?.error ?? "") && same(before9, await siteState(db9)), `${r9.status} ${r9.json?.error?.slice(0, 80)}`);
  // A10. Reconciliação: settle conclui a pendência (dados novos já gravados? não: mistura) → continua pendente;
  //      fechamento explícito recusa antes de 30 min; com a operação "envelhecida", encerra como failed.
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const deps = supabaseReconcileDeps(client, supabaseLifecycleRpc(client));
  const rec1 = await reconcilePending({ deps, mode: "apply", actor: "teste-reconcile", now: new Date(), minAgeMinutes: 0 });
  const rec2 = await reconcilePending({ deps, mode: "apply", actor: "teste-reconcile", now: new Date(), minAgeMinutes: 0, closeUnconfirmedSync: true });
  await sql(db9, `alter table public.storage_operation_log disable trigger user; update public.storage_operation_log set occurred_at = now() - interval '2 hours' where operation = 'reference_sync'; alter table public.storage_operation_log enable trigger user;`);
  const rec3 = await reconcilePending({ deps, mode: "apply", actor: "teste-reconcile", now: new Date(Date.now() + 3 * 3600e3), minAgeMinutes: 0, closeUnconfirmedSync: true });
  const a10 = await audit(db9);
  check("A10. reconciliação: mistura continua pendente; fechamento explícito recusado antes de 30 min; depois encerra como failed com os valores reais",
    rec1.decisions[0]?.decision === "settle_sync" && rec1.errors === 1 && rec2.errors === 1 && /30 minutos/.test(rec2.decisions[0]?.applied?.error ?? "")
      && rec3.applied === 1 && a10.pending === 0 && a10.log.at(-1).phase === "failed" && a10.log.at(-1).details.reason === "unconfirmed" && Array.isArray(a10.log.at(-1).details.actual),
    `${rec1.errors}/${rec2.errors}/${rec3.applied} ${JSON.stringify(rec2.decisions[0]?.applied).slice(0, 90)}`);
  // A11. Depois da reconciliação, o jogo destrava.
  const r11 = await call(NEW.games, "POST", "/api/admin/games", fullGame("jogo-a", { image: S("games/jogo-a/banner-11.webp") }));
  check("A11. após a reconciliação, novo salvamento do jogo é aceito e confirmado", r11.status === 200 && (await audit(db9)).pending === 0, String(r11.status));

  // A12. Falha DEPOIS da gravação: a confirmação se perde (resposta perdida no finish) → 502 pendente;
  //      a releitura pela reconciliação comprova e conclui.
  const db12 = await freshDb(); await selectDb(db12);
  faults = [{ method: "POST", target: "rpc:storage_lifecycle_finish_reference_sync", nth: (counters["POST rpc:storage_lifecycle_finish_reference_sync"] ?? 0) + 1, mode: "before" }];
  const r12 = await call(NEW.games, "POST", "/api/admin/games", fullGame("jogo-a", { image: S("games/jogo-a/banner-12.webp") }));
  faults = [];
  const p12 = (await audit(db12)).pending;
  const rec12 = await reconcilePending({ deps, mode: "apply", actor: "teste-reconcile", now: new Date(), minAgeMinutes: 0 });
  const a12 = await audit(db12);
  check("A12. confirmação perdida depois da gravação: 502 pendente; reconciliação relê e confirma (succeeded)",
    r12.status === 502 && p12 === 1 && rec12.applied === 1 && a12.pending === 0 && a12.log.at(-1).phase === "succeeded", `${r12.status} ${p12} ${rec12.applied}`);

  // A13. Resposta perdida da ÚLTIMA gravação (progresso gravado, resposta some): erro para o painel,
  //      mas a auditoria é fiel (succeeded, comprovado pela releitura); repetir não cria operação nova.
  const db13 = await freshDb(); await selectDb(db13);
  const req13 = fullGame("jogo-a", { achievementsList: [{ id: "l1", title: "Conquista 1", image: A("jogo-a", "1-13"), status: "completed", earnedDate: "2026-10-01" }, { id: "l2", title: "Conquista 2", image: "" }, { id: "l3", title: "Conquista 3", image: A("jogo-a", 3) }] });
  faults = [{ method: "POST", target: "achievement_progress", nth: (counters["POST achievement_progress"] ?? 0) + 1, mode: "after" }];
  const r13 = await call(NEW.games, "POST", "/api/admin/games", req13);
  faults = [];
  const a13 = await audit(db13);
  const r13b = await call(NEW.games, "POST", "/api/admin/games", req13);
  check("A13. resposta perdida após gravar: painel recebe erro, auditoria confirmada pela releitura (sem falsa falha); repetir: 200 sem operação nova",
    r13.status === 500 && a13.log.map((l) => l.phase).join() === "intent,succeeded" && r13b.status === 200 && (await audit(db13)).log.length === 2, `${r13.status} ${a13.log.map((l) => l.phase)} ${r13b.status}`);

  // A14. Concorrência: dois salvamentos diferentes do mesmo jogo; o segundo chega com o primeiro em andamento.
  const db14 = await freshDb(); await selectDb(db14);
  let release;
  const gate = new Promise((r) => { release = r; });
  faults = [{ method: "POST", target: "games", nth: (counters["POST games"] ?? 0) + 1, mode: "gate", gate }];
  const first = call(NEW.games, "POST", "/api/admin/games", fullGame("jogo-a", { image: S("games/jogo-a/banner-p1.webp") }));
  await new Promise((r) => setTimeout(r, 400));
  const second = await call(NEW.games, "POST", "/api/admin/games", fullGame("jogo-a", { image: S("games/jogo-a/banner-p2.webp") }));
  release(); const firstDone = await first; faults = [];
  const g14 = (await siteState(db14)).games.find((g) => g.slug === "jogo-a").image;
  const a14 = await audit(db14);
  check("A14. concorrência no mesmo jogo: o segundo recebe 409 sem gravar; o primeiro conclui e é confirmado",
    second.status === 409 && firstDone.status === 200 && g14 === S("games/jogo-a/banner-p1.webp") && a14.pending === 0 && a14.log.filter((l) => l.phase === "intent").length === 1,
    `${second.status}/${firstDone.status} ${g14.slice(-20)}`);
  // A15. Jogos diferentes em paralelo: ambos concluem.
  const [x, y] = await Promise.all([
    call(NEW.games, "POST", "/api/admin/games", fullGame("jogo-a", { image: S("games/jogo-a/banner-x.webp") })),
    call(NEW.games, "POST", "/api/admin/games", { ...fullGame("jogo-b", { image: S("games/jogo-b/banner-y.webp") }), achievementsList: undefined }),
  ]);
  check("A15. jogos diferentes em paralelo: os dois concluem e são confirmados", x.status === 200 && y.status === 200 && (await audit(db14)).pending === 0, `${x.status}/${y.status}`);

  // A16. Sem sessão / sessão adulterada: 401 e nada registrado.
  const logBefore16 = (await audit(db14)).log.length;
  const r16 = await call(NEW.games, "POST", "/api/admin/games", fullGame("jogo-a", { image: S("x.webp") }), { cookie: `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token.slice(0, -2) + "xx")}` });
  const r16b = await call(NEW.games, "POST", "/api/admin/games", fullGame("jogo-a", { image: S("x.webp") }), { cookie: "" });
  check("A16. sessão adulterada ou ausente: 401, nada registrado", r16.status === 401 && r16b.status === 401 && (await audit(db14)).log.length === logBefore16, `${r16.status}/${r16b.status}`);
}

// =====================================================================================
// B. Demais fluxos reais: troca simples, sem troca, repetição, inválida, falha antes, equivalência.
// =====================================================================================
async function flow(label, route, method, path, makeBody, opts = {}) {
  const changed = await twin(route, method, path, makeBody(true), opts.prep);
  const n = succeededItems(changed.audit);
  check(`${label}: troca registrada e comprovada; tabelas iguais à versão anterior`,
    changed.now.status === changed.old.status && changed.now.status < 300 && n >= (opts.minItems ?? 1) && changed.audit.pending === 0
      && changed.audit.log.at(-1)?.phase === "succeeded" && same(changed.stateNew, changed.stateOld) && changed.audit.chainProblems === 0,
    `${changed.now.status}/${changed.old.status} itens=${n} dif=${diffKeys(changed.stateNew, changed.stateOld)} ${JSON.stringify(changed.now.json).slice(0, 80)}`);
  await selectDb(changed.dbNew);
  const again = await call(NEW[route], method, path, makeBody(true));
  check(`${label}: repetir não cria operação nova`, again.status < 300 && (await audit(changed.dbNew)).log.length === changed.audit.log.length, String(again.status));
  if (!opts.skipUnchanged) {
    const unchanged = await twin(route, method, path, makeBody(false), opts.prep);
    check(`${label}: sem troca de imagem, nenhuma operação e tabelas iguais`, unchanged.now.status < 300 && unchanged.audit.log.length === 0 && same(unchanged.stateNew, unchanged.stateOld),
      `${unchanged.now.status} ops=${unchanged.audit.log.length} dif=${diffKeys(unchanged.stateNew, unchanged.stateOld)}`);
  }
  if (opts.badBody) {
    const db = await freshDb(); if (opts.prep) await opts.prep(db); await selectDb(db);
    const before = await siteState(db);
    const r = await call(NEW[route], method, path, opts.badBody());
    check(`${label}: referência inválida → 400, nada gravado nem registrado`, r.status === 400 && same(before, await siteState(db)) && (await audit(db)).log.length === 0, `${r.status} ${r.json?.error?.slice(0, 60)}`);
  }
  if (opts.firstWrite) {
    const db = await freshDb(); if (opts.prep) await opts.prep(db); await selectDb(db);
    const before = await siteState(db);
    const [m, t] = opts.firstWrite;
    faults = [{ method: m, target: t, nth: (counters[`${m} ${t}`] ?? 0) + 1, mode: "before" }];
    const r = await call(NEW[route], method, path, makeBody(true));
    faults = [];
    const a = await audit(db);
    check(`${label}: falha antes da gravação → erro, banco intocado, intenção encerrada como failed`,
      r.status >= 500 && same(before, await siteState(db)) && a.log.map((l) => l.phase).join() === "intent,failed" && a.pending === 0, `${r.status} ${a.log.map((l) => l.phase)}`);
  }
}
const badUrl = `http://127.0.0.1:${PORT}/storage/v1/object/public/achievement-art/a/%00.webp`;

await flow("B1. PUT /api/admin/games", "games", "PUT", "/api/admin/games",
  (c) => fullGame("jogo-a", c ? { cardImage: S("games/jogo-a/capa.webp"), achievementsList: undefined } : { title: "x", achievementsList: undefined }),
  { badBody: () => fullGame("jogo-a", { image: badUrl, achievementsList: undefined }), firstWrite: ["PATCH", "games"] });
await flow("B2. Maestria Final (POST action)", "games", "POST", "/api/admin/games",
  (c) => ({ slug: "jogo-a", action: "final-mastery", finalBadge: { title: "Maestria Final", image: c ? S("games/jogo-a/maestria-b2.webp") : S("games/jogo-a/maestria.webp"), description: "fim", icon: "💎" } }),
  { badBody: () => ({ slug: "jogo-a", action: "final-mastery", finalBadge: { title: "M", image: badUrl } }), firstWrite: ["PATCH", "games"] });
await flow("B3. Emblema (POST action)", "games", "POST", "/api/admin/games",
  (c) => ({ slug: "jogo-a", action: "emblem", emblem: { title: "Emblema", image: c ? S("games/jogo-a/emblema-b3.webp") : S("games/jogo-a/emblema.webp"), description: "e", updatedAt: "2026-11-01T00:00:00Z" } }),
  { badBody: () => ({ slug: "jogo-a", action: "emblem", emblem: { title: "E", image: badUrl, updatedAt: "2026-11-01T00:00:00Z" } }), firstWrite: ["PATCH", "games"] });
await flow("B4. review (POST action)", "games", "POST", "/api/admin/games",
  (c) => ({ slug: "jogo-a", action: "review", review: { texto: "review de jogo-a", capa: c ? S("games/jogo-a/review-b4.webp") : S("games/jogo-a/review.webp") } }),
  { firstWrite: ["PATCH", "games"] });
await flow("B5. rota final-mastery", "finalMastery", "POST", "/api/admin/games/final-mastery",
  (c) => ({ slug: "jogo-a", finalBadge: c ? { title: "Conquista 3", image: S("games/jogo-a/maestria-b5.webp"), description: "", icon: "💎" } : { title: "Maestria Final", image: S("games/jogo-a/maestria.webp"), description: "fim", icon: "💎" } }),
  { minItems: 2, badBody: () => ({ slug: "jogo-a", finalBadge: { title: "M", image: badUrl } }), firstWrite: ["PATCH", "games"] });
await flow("B6. games/sync POST", "gamesSync", "POST", "/api/admin/games/sync",
  (c) => ({ ...fullGame("jogo-a", c ? { image: S("games/jogo-a/sync.webp") } : {}), achievementsList: undefined }),
  { badBody: () => ({ ...fullGame("jogo-a", { image: badUrl }), achievementsList: undefined }), firstWrite: ["POST", "games"] });
await flow("B7. games/sync PUT", "gamesSync", "PUT", "/api/admin/games/sync",
  (c) => ({ ...fullGame("jogo-a", c ? { trophies: [{ icon: S("games/jogo-a/t0-sync.webp"), name: "T0" }] } : {}), achievementsList: undefined }),
  { firstWrite: ["PATCH", "games"] });
await flow("B8. conquistas do painel (PUT /admin/api/achievements)", "achievements", "PUT", "/admin/api/achievements",
  (c) => ({ gameSlug: "jogo-b", achievements: c ? [{ id: "l1", title: "Conquista 1", image: A("jogo-b", "1-b8"), isCustom: true }]
    : [{ id: "l1", title: "Conquista 1", image: A("jogo-b", 1), isCustom: true }, { id: "l2", title: "Conquista 2", image: A("jogo-b", 2), isCustom: true }] }),
  { minItems: 2, badBody: () => ({ gameSlug: "jogo-b", achievements: [{ id: "l1", title: "Conquista 1", image: badUrl, isCustom: true }] }), firstWrite: ["DELETE", "achievement_progress"] });
await flow("B9. sincronização do canal (POST)", "youtube", "POST", "/api/youtube/channel/games/sync",
  (c) => fullGame("jogo-a", { achievementsList: [{ id: "l1", title: "Conquista 1", image: c ? A("jogo-a", "1-yt") : A("jogo-a", 1) }] }),
  { badBody: () => fullGame("jogo-a", { achievementsList: [{ id: "l3", title: "Conquista 3", image: badUrl }] }), firstWrite: ["POST", "games"] });
await flow("B10. sincronização do canal (PUT)", "youtube", "PUT", "/api/youtube/channel/games/sync",
  (c) => fullGame("jogo-a", { image: c ? S("games/jogo-a/yt.webp") : S("games/jogo-a/banner.webp"), achievementsList: undefined }),
  { firstWrite: ["PATCH", "games"] });

// B11. recover-mouse: 34 artes numeradas + 1 extra; banner/capa voltam para locais, extra sai.
const mouse = "mouse-p-i-for-hire";
const prepMouse = async (db) => {
  const rows = Array.from({ length: 34 }, (_, i) => `('${randomUUID()}', '${mouse}', 'm${i + 1}', 'M ${i + 1}', '${S(`games/${mouse}/achievements/${String(i + 1).padStart(2, "0")}-arte.png`)}', ${i})`);
  rows.push(`('${randomUUID()}', '${mouse}', 'extra', 'Extra', '${S(`games/${mouse}/achievements/sem-numero.png`)}', 99)`);
  await sql(db, `insert into public.games (slug, title, image, card_image, platform) values ('${mouse}', 'Mouse', '${S(`games/${mouse}/banner.webp`)}', '${S(`games/${mouse}/capa.webp`)}', 'Steam');
    insert into public.achievements (id, game_slug, legacy_id, title, image, sort_order) values ${rows.join(",")};`);
};
{
  const t = await twin("recoverMouse", "POST", "/api/admin/recover-mouse", undefined, prepMouse);
  const items = t.audit.log.filter((l) => l.phase === "intent").flatMap((l) => l.details.items).map((i) => `${i.table}.${i.column}`).sort();
  check("B11. recover-mouse: banner, capa e conquista extra registrados e comprovados; tabelas iguais à versão anterior",
    t.now.status === 200 && t.old.status === 200 && items.join() === "achievements.image,games.card_image,games.image" && t.audit.log.at(-1).phase === "succeeded" && same(t.stateNew, t.stateOld),
    `${t.now.status}/${t.old.status} ${items} ${JSON.stringify(t.now.json).slice(0, 100)} dif=${diffKeys(t.stateNew, t.stateOld)}`);
}

check("nenhuma requisição saiu de 127.0.0.1 (vigia do fetch)", outbound.every((h) => h.startsWith("127.0.0.1")), [...new Set(outbound)].join(","));
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} verificações passaram`);
for (const c of connections.values()) await c.end();
await admin.end();
server.close();
process.exit(ok === results.length ? 0 : 1);

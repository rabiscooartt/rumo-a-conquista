// Etapa 5.2 — o SCRIPT scripts/image-lifecycle-archive.mjs de ponta a ponta, como processo separado,
// contra PostgREST e Storage simulados (127.0.0.1) sobre PostgreSQL 17. O servidor conta cada
// requisição: na simulação, nenhuma escrita pode chegar a ele.
import http from "node:http";
import pg from "pg";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repo = process.env.REPO;
const replica = process.argv[2];
const read = (p) => readFileSync(`${repo}/${p}`, "utf8");
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${String(detail).slice(0, 220)}` : ""}`); };
const sha = (b) => createHash("sha256").update(b).digest("hex");
const PORT = 54412;
const KEY = "chave-local-falsa";

const base = { host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 55433) };
const admin = new pg.Client({ ...base, user: process.env.PG_ADMIN_USER ?? "supabase_admin", database: "postgres" });
await admin.connect();
await admin.query(`create role postgres login createrole bypassrls inherit; create role anon nologin; create role authenticated nologin;
  create role service_role nologin bypassrls; create role authenticator login noinherit;
  grant anon to authenticator with inherit false; grant authenticated to authenticator with inherit false; grant service_role to authenticator with inherit false;
  grant anon, authenticated, service_role, authenticator to postgres with admin option;`);
await admin.query("create database rumo owner postgres");
{
  const a = new pg.Client({ ...base, user: process.env.PG_ADMIN_USER ?? "supabase_admin", database: "rumo" });
  await a.connect();
  await a.query(`grant usage on schema public to postgres, anon, authenticated, service_role;
    alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;`);
  await a.end();
}
const db = new pg.Client({ ...base, user: "postgres", database: "rumo" });
await db.connect();
await db.query(readFileSync(replica, "utf8"));
for (const m of ["20261102_add_games_backlog_order", "20261114_create_storage_image_lifecycle", "20261116_storage_lifecycle_tracked_uploads",
  "20261117_storage_lifecycle_pointer_activation", "20261118_storage_lifecycle_reference_sync", "20261119_storage_lifecycle_scan_policy"]) await db.query(read(`supabase/migrations/${m}.sql`));
const pool = new pg.Pool({ ...base, user: "authenticator", database: "rumo", max: 4 });
const svc = async (text, params) => { const c = await pool.connect(); try { await c.query("begin; set local role service_role"); const r = await c.query(text, params); await c.query("commit"); return r.rows; } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); } };
const rpcCall = async (fn, args) => { const names = Object.keys(args); const values = names.map((n) => (args[n] !== null && typeof args[n] === "object" ? JSON.stringify(args[n]) : args[n]));
  return (await svc(`select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`, values))[0].r; };

// Inventário: a, b superseded elegíveis; c referenced.
const files = new Map();
const bytes = { a: Buffer.from("arte-a-".repeat(80)), b: Buffer.from("arte-b-".repeat(80)), c: Buffer.from("arte-c-".repeat(80)) };
const pathOf = (n) => `games/jogo-z/achievements/${n}.png`;
for (const n of Object.keys(bytes)) files.set(`achievement-art/${pathOf(n)}`, { bytes: bytes[n], contentType: "image/png", metadata: null });
const objects = Object.keys(bytes).map((n) => ({ bucket: "achievement-art", path: pathOf(n), size: bytes[n].length, mimetype: "image/png", sha256: sha(bytes[n]), state: n === "c" ? "referenced" : "superseded", reference_count: n === "c" ? 1 : 0 }));
// Varredura registrada e ATESTADA pela política v2 (migração 20261119): só assim vale como prova.
// Execução oficial aberta antes do relatório, atestação com manifesto, sincronização e conclusão
// (tests/integration/support/officialRun.mjs).
const { officialScan, installTimeTravel } = await import(pathToFileURL(`${repo}/tests/integration/support/officialRun.mjs`).href);
const travel = await installTimeTravel({ base, database: "rumo" });
const registerAttested = (payload, scanObjects) => officialScan({ rpc: rpcCall, backdate: travel.backdate, payload, objects: scanObjects });
for (const [id, at] of [["scan-20260901T000000Z", "2026-09-01T00:00:00Z"], ["scan-20261015T000000Z", "2026-10-15T00:00:00Z"]]) {
  await registerAttested({ scan_id: id, completed_at: at, complete: true, inventory_status: "complete", image_objects: 3, image_bytes: 1 }, objects);
}
let bucketExists = false;
const requests = [];
const q = (name) => `"${name.replace(/"/g, '""')}"`;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  requests.push(`${req.method} ${url.pathname}`);
  const send = (status, payload, headers = {}) => { res.writeHead(status, { "Content-Type": "application/json", ...headers }); res.end(payload === undefined ? undefined : JSON.stringify(payload)); };
  try {
    if (req.headers.apikey !== KEY) return send(401, { message: "chave inválida" });
    let m;
    if ((m = url.pathname.match(/^\/storage\/v1\/bucket\/([^/]+)$/)) && req.method === "GET") {
      return bucketExists && m[1] === "image-archive" ? send(200, { id: "image-archive", name: "image-archive", public: false }) : send(400, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
    }
    if ((m = url.pathname.match(/^\/storage\/v1\/object\/info\/([^/]+)\/(.+)$/))) {
      const f = files.get(`${m[1]}/${decodeURIComponent(m[2])}`);
      if (!f) return send(400, { statusCode: "404", error: "not_found", message: "Object not found" });
      return send(200, { id: "x", name: m[2], bucket_id: m[1], size: f.bytes.length, content_type: f.contentType, metadata: f.metadata, created_at: new Date().toISOString(), last_modified: new Date().toISOString() });
    }
    if ((m = url.pathname.match(/^\/storage\/v1\/object\/(?:authenticated\/)?([^/]+)\/(.+)$/)) && req.method === "GET") {
      const f = files.get(`${m[1]}/${decodeURIComponent(m[2])}`);
      if (!f) return send(400, { statusCode: "404", error: "not_found", message: "Object not found" });
      res.writeHead(200, { "Content-Type": f.contentType }); return res.end(f.bytes);
    }
    if ((m = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/)) && req.method === "POST") {
      const key = `${m[1]}/${decodeURIComponent(m[2])}`;
      if (files.has(key)) return send(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
      const meta = req.headers["x-metadata"] ? JSON.parse(Buffer.from(req.headers["x-metadata"], "base64").toString("utf8")) : null;
      let body = raw, contentType = req.headers["content-type"];
      if (/multipart\/form-data/.test(contentType ?? "")) {
        const form = await new Response(raw, { headers: { "content-type": contentType } }).formData();
        const file = [...form.values()].find((v) => typeof v === "object");
        body = Buffer.from(await file.arrayBuffer()); contentType = file.type;
      }
      files.set(key, { bytes: body, contentType, metadata: meta });
      return send(200, { Key: key, Id: randomUUID() });
    }
    if ((m = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/)) && req.method === "POST") return send(200, await rpcCall(m[1], JSON.parse(raw.toString() || "{}")));
    if ((m = url.pathname.match(/^\/rest\/v1\/(\w+)$/)) && req.method === "GET") {
      const where = []; const vals = [];
      for (const [k, v] of url.searchParams) {
        if (["select", "order", "limit"].includes(k)) continue;
        let mm;
        if ((mm = /^eq\.(.*)$/s.exec(v))) { vals.push(mm[1]); where.push(`${q(k)}::text = $${vals.length}`); }
        else if ((mm = /^in\.\((.*)\)$/s.exec(v))) { vals.push(mm[1].split(",").map((s) => s.replace(/^"(.*)"$/, "$1"))); where.push(`${q(k)}::text = any($${vals.length})`); }
        else throw new Error(`filtro não simulado ${k}=${v}`);
      }
      const cols = (url.searchParams.get("select") ?? "*").split(",").map((c) => c.trim()).map((c) => (c === "*" ? c : q(c))).join(", ");
      const order = url.searchParams.get("order") ? ` order by ${q(url.searchParams.get("order").split(".")[0])}` : "";
      return send(200, await svc(`select ${cols} from public.${m[1]}${where.length ? ` where ${where.join(" and ")}` : ""}${order}`, vals));
    }
    return send(404, { message: `não simulado ${req.method} ${url.pathname}` });
  } catch (e) { send(400, { code: e.code ?? "XX000", message: e.message, hint: e.hint ?? null }); }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const work = mkdtempSync(join(tmpdir(), "archive-script-"));
mkdirSync(join(work, "data"));
copyFileSync(`${repo}/data/homeImageVariants.json`, join(work, "data", "homeImageVariants.json"));
const script = `${repo}/scripts/image-lifecycle-archive.mjs`;
async function runScript(args, env = {}) {
  const start = requests.length;
  const child = await new Promise((resolve) => {
    const { spawn } = require_spawn;
    const p = spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, ...args], {
      cwd: work, env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${PORT}`, SUPABASE_SERVICE_ROLE_KEY: KEY, ARCHIVE_TEST_HOST: `127.0.0.1:${PORT}`, ...env },
    });
    let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
  });
  return { ...child, requests: requests.slice(start) };
}
const require_spawn = await import("node:child_process");
const writes = (reqs) => reqs.filter((r) => !/^GET /.test(r) && !/^POST \/storage\/v1\/object\/list\//.test(r) && !/^POST \/rest\/v1\/rpc\/storage_lifecycle_evidence$/.test(r));
const logCount = async () => Number((await db.query("select count(*) n from public.storage_operation_log")).rows[0].n);

// S1. Outro host (fora de 127.0.0.1 e não o projeto): recusa sem acessar nada.
{
  const r = await runScript(["--dry-run"], { NEXT_PUBLIC_SUPABASE_URL: "http://10.0.0.1:1", ARCHIVE_TEST_HOST: "10.0.0.1:1" });
  check("S1. host de teste fora de 127.0.0.1: recusado, nenhuma requisição", r.code === 1 && r.requests.length === 0, r.out.trim().split("\n").pop());
}
// S2. Simulação com alvos: plano, diagnóstico e ZERO escritas recebidas pelo servidor.
{
  const before = { log: await logCount(), files: files.size };
  const r = await runScript(["--dry-run", "--archive", `achievement-art/${pathOf("a")}`, "--archive", `achievement-art/${pathOf("c")}`]);
  check("S2. --dry-run: elegíveis listados, alvo referenciado recusado, nenhuma escrita chegou ao servidor; banco e Storage intactos",
    r.code === 0 && /elegível: achievement-art\/games\/jogo-z\/achievements\/a\.png/.test(r.out) && /seria_arquivado/.test(r.out) && /nao_elegivel: referenciado/.test(r.out)
      && writes(r.requests).length === 0 && (await logCount()) === before.log && files.size === before.files, `${writes(r.requests)} | ${r.out.split("\n").filter((l) => l.startsWith("·")).join(" ")}`);
}
// S3. Aplicação sem o bucket de arquivo: recusa antes de qualquer escrita (o executor não cria bucket).
{
  const r = await runScript(["--apply", "--confirm-remote", "--archive", `achievement-art/${pathOf("a")}`]);
  check("S3. --apply sem o bucket image-archive: recusado, nenhuma escrita", r.code === 1 && /precisa existir e ser privado/.test(r.out) && writes(r.requests).length === 0, r.out.trim().split("\n").pop());
}
// S4. Aplicação com o bucket: arquiva o alvo explícito; o outro elegível não é tocado.
{
  bucketExists = true;
  const r = await runScript(["--apply", "--confirm-remote", "--archive", `achievement-art/${pathOf("a")}`]);
  const row = (await svc(`select archive_state, archive_sha256 from public.storage_object_lifecycle where object_path = $1`, [pathOf("a")]))[0];
  const rowB = (await svc(`select archive_state from public.storage_object_lifecycle where object_path = $1`, [pathOf("b")]))[0];
  const logs = readdirSync(join(work, ".image-report", "lifecycle", "archive")).filter((f) => f.endsWith("-apply.jsonl"));
  const stepsLog = readFileSync(join(work, ".image-report", "lifecycle", "archive", logs.at(-1)), "utf8").trim().split("\n").map((l) => JSON.parse(l).step);
  check("S4. --apply: só o alvo explícito é arquivado (cópia conferida, original mantido); b intacto; passos no .jsonl",
    r.code === 0 && row.archive_state === "archived" && row.archive_sha256 === sha(bytes.a) && files.has(`image-archive/achievement-art/${pathOf("a")}`)
      && files.has(`achievement-art/${pathOf("a")}`) && rowB.archive_state === "none" && stepsLog.join() === "intencao,original_conferido,copia_conferida,concluida",
    `${r.out.split("\n").filter((l) => l.startsWith("·")).join(" ")} | ${stepsLog}`);
}
// S5. Repetir: nada novo. S6. Simulação de restauração de um objeto não removido: diagnóstico, sem escrita.
{
  const before = await logCount();
  const r = await runScript(["--apply", "--confirm-remote", "--archive", `achievement-art/${pathOf("a")}`]);
  check("S5. repetir o arquivamento: já arquivado (não elegível de novo), nenhum registro novo", r.code === 0 && (await logCount()) === before && /nao_elegivel: já em archived/.test(r.out), r.out.split("\n").filter((l) => l.startsWith("·")).join(" "));
  const d = await runScript(["--dry-run", "--restore", `achievement-art/${pathOf("a")}`]);
  check("S6. --dry-run --restore: diagnóstico (original ainda presente), nenhuma escrita", d.code === 0 && /nao_restauravel \(archived\)/.test(d.out) && writes(d.requests).length === 0, d.out.split("\n").filter((l) => l.startsWith("·")).join(" "));
}
// S8. Política de varredura no banco: uma varredura mais recente NÃO atestada (relatório sem a
//     política) faz o banco recusar a prova → o script mostra o objeto como não elegível; nada escrito.
{
  await rpcCall("storage_lifecycle_register_scan", { p_scan: { scan_id: "scan-20261117T120000Z", completed_at: "2026-11-17T12:00:00Z", complete: true, inventory_status: "complete", image_objects: 3, image_bytes: 1, report_sha256: "b".repeat(64) }, p_actor: "teste" });
  const r = await runScript(["--dry-run", "--archive", `achievement-art/${pathOf("b")}`]);
  check("S8. varredura mais recente sem atestação: objeto antes elegível aparece como não elegível (política); nenhuma escrita",
    r.code === 0 && /nao_elegivel: superseded sem prova vigente: a varredura mais recente não atende à política/.test(r.out) && writes(r.requests).length === 0,
    r.out.split(/\r?\n/).filter((l) => l.startsWith("·")).join(" "));
}
// S7. Opções inválidas e mais de 10 alvos: nada acessado.
{
  const many = Array.from({ length: 11 }, (_, i) => ["--archive", `achievement-art/x${i}.png`]).flat();
  const r1 = await runScript(["--apply", "--confirm-remote", ...many]);
  const r2 = await runScript(["--apply", "--archive", "x/y.png"]);
  const r3 = await runScript(["--dry-run", "--delete"]);
  check("S7. mais de 10 alvos, --apply sem --confirm-remote e opção desconhecida: recusados sem nenhuma requisição",
    [r1, r2, r3].every((r) => r.code === 1 && r.requests.length === 0), [r1, r2, r3].map((r) => r.code).join());
}

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} verificações passaram`);
server.close(); await pool.end(); await db.end(); await admin.end();
process.exit(ok === results.length ? 0 : 1);

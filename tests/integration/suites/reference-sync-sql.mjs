// Etapa 5.1 — migração 20261118 em PostgreSQL 17 (postgres não superusuário): pré-verificação,
// aplicação, reaplicação recusada, privilégios, validação dos itens, semântica do finish e rollback.
import pg from "pg";
import { readFileSync } from "node:fs";

const repo = process.env.REPO;
const replica = process.argv[2];
const read = (p) => readFileSync(`${repo}/${p}`, "utf8");
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ""}`); };
const base = { host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 55433) };
const admin = new pg.Client({ ...base, user: process.env.PG_ADMIN_USER ?? "supabase_admin", database: "postgres" });
await admin.connect();
await admin.query(`
  create role postgres login createrole bypassrls inherit;
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create role authenticator login noinherit;
  grant anon to authenticator with inherit false; grant authenticated to authenticator with inherit false; grant service_role to authenticator with inherit false;
  grant anon, authenticated, service_role, authenticator to postgres with admin option;`);
let n = 0;
async function newDb() {
  const name = `rs_${++n}`;
  await admin.query(`create database ${name} owner postgres`);
  const a = new pg.Client({ ...base, user: process.env.PG_ADMIN_USER ?? "supabase_admin", database: name });
  await a.connect();
  await a.query(`grant usage on schema public to postgres, anon, authenticated, service_role;
    alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;`);
  await a.end();
  const db = new pg.Client({ ...base, user: "postgres", database: name });
  await db.connect();
  await db.query(readFileSync(replica, "utf8"));
  await db.query(`create unique index achievements_game_legacy_key on public.achievements (game_slug, legacy_id);
    create unique index achievement_progress_owner_achievement_key on public.achievement_progress (owner_key, achievement_id);`);
  for (const m of ["20261102_add_games_backlog_order", "20261114_create_storage_image_lifecycle", "20261116_storage_lifecycle_tracked_uploads", "20261117_storage_lifecycle_pointer_activation"]) {
    await db.query(read(`supabase/migrations/${m}.sql`));
  }
  return { name, db };
}
async function as(dbName, role, text, params) {
  const c = new pg.Client({ ...base, user: "authenticator", database: dbName });
  await c.connect();
  try { await c.query(`set role ${role}`); return (await c.query(text, params)).rows; } finally { await c.end(); }
}
const err = async (p) => { try { await p; return null; } catch (e) { return e; } };
const URL = (p) => `https://x.supabase.co/storage/v1/object/public/achievement-art/${p}`;

// 1. Pré-verificação antes da migração.
const tpl = await newDb();
await tpl.db.end();
async function clone() {
  const name = `rs_${++n}`;
  await admin.query(`create database ${name} template ${tpl.name} owner postgres`);
  const db = new pg.Client({ ...base, user: "postgres", database: name });
  await db.connect();
  return { name, db };
}
const { name, db } = await clone();
const pre = (await db.query(read("supabase/tests/storage_lifecycle_reference_sync_precheck.sql"))).rows;
check("1. pré-verificação (somente leitura) aprova o banco com 20261117", pre.every((r) => r.ok), pre.filter((r) => !r.ok).map((r) => r.verificacao).join(" | "));

// 2. Aplicação e reaplicação.
const applyErr = await err(db.query(read("supabase/migrations/20261118_storage_lifecycle_reference_sync.sql")));
check("2. migração aplicada por postgres não superusuário", applyErr === null, applyErr?.message);
const again = await err(db.query(read("supabase/migrations/20261118_storage_lifecycle_reference_sync.sql")));
check("3. reaplicar é recusado sem alterar nada", again !== null && /já existem/.test(again.message), again?.message);
await db.query("rollback").catch(() => {});

// 3. Privilégios.
const beginArgs = `p_scope => 'game:jogo-a', p_base_key => 'refsync:${"a".repeat(64)}', p_chunk => 1, p_chunks => 1, p_actor => 't', p_reason => 'r', p_items => '[]'::jsonb`;
const anonErr = await err(as(name, "anon", `select public.storage_lifecycle_begin_reference_sync(${beginArgs})`));
const authErr = await err(as(name, "authenticated", `select public.storage_lifecycle_begin_reference_sync(${beginArgs})`));
const readErr = await err(as(name, "service_role", `select public.storage_lifecycle_reference_sync_read('{"table":"games","column":"image","row":{"slug":"jogo-a"},"path":null}')`));
const okCall = await as(name, "service_role", `select public.storage_lifecycle_begin_reference_sync(${beginArgs}) as r`);
check("4. anon e authenticated sem EXECUTE; service_role não chama a leitura interna; service_role chama begin",
  anonErr?.code === "42501" && authErr?.code === "42501" && readErr?.code === "42501" && okCall[0].r.status === "nothing", `${anonErr?.code}/${authErr?.code}/${readErr?.code}/${okCall[0].r.status}`);
const priv = (await db.query(`select has_column_privilege('storage_lifecycle_owner','public.games','review','SELECT') s, has_column_privilege('storage_lifecycle_owner','public.games','review','UPDATE') u,
  has_column_privilege('storage_lifecycle_owner','public.achievements','title','SELECT') t`)).rows[0];
check("5. dono lê review (só SELECT), não escreve nela e não lê colunas fora da lista", priv.s && !priv.u && !priv.t, JSON.stringify(priv));

// 4. Validação dos itens (cada um recusado com 22023, nada registrado).
const item = (o) => ({ table: "games", column: "image", row: { slug: "jogo-a" }, path: null, old: URL("a.png"), new: URL("b.png"), ...o });
const begin = (items, scope = "game:jogo-a", chunk = 1, chunks = 1, key = "a".repeat(64)) => as(name, "service_role",
  `select public.storage_lifecycle_begin_reference_sync($1, $2, $3, $4, 'teste', 'r', $5::jsonb) as r`, [scope, `refsync:${key}`, chunk, chunks, JSON.stringify(items)]);
const bad = {
  "linha de outro jogo": [item({ row: { slug: "jogo-b" } })],
  "coluna fora da lista": [item({ column: "title" })],
  "chave extra na linha": [item({ row: { slug: "jogo-a", id: "x" } })],
  "sem old": [(() => { const i = item(); delete i.old; return i; })()],
  "old igual a new": [item({ new: URL("a.png") })],
  "'' e null equivalentes": [item({ old: "", new: null })],
  "JSON sem caminho": [item({ column: "emblem", path: null })],
  "caminho não textual": [item({ column: "emblem", path: ["image", 1] })],
  "local repetido": [item(), item({ new: URL("c.png") })],
  "referência ao Storage inválida": [item({ new: "https://x.supabase.co/storage/v1/object/public/achievement-art/../x.png" })],
  "mais de 150 itens": Array.from({ length: 151 }, (_, i) => item({ row: { game_slug: "jogo-a", legacy_id: `l${i}` }, table: "achievements" })),
};
const outcomes = [];
for (const [label, items] of Object.entries(bad)) { const e = await err(begin(items)); outcomes.push(`${label}:${e?.code}`); }
const logRows = Number((await db.query("select count(*) n from public.storage_operation_log where operation = 'reference_sync'")).rows[0].n);
check("6. itens inválidos recusados (22023) e nada registrado", outcomes.every((o) => o.endsWith(":22023")) && logRows === 0, outcomes.join(" "));
const scopeErr = await err(begin([item()], "jogo-a"));
const partErr = await err(begin([item()], "game:jogo-a", 2, 1));
check("7. escopo e parte inválidos recusados", scopeErr?.code === "22023" && partErr?.code === "22023");

// 5. Semântica do finish com dados reais.
await db.query(`delete from public.achievement_progress; delete from public.achievements; delete from public.games;
  insert into public.games (slug, title, image, emblem) values ('jogo-a', 'A', '${URL("a.png")}', '{"image": "${URL("e.png")}"}');`);
const started = (await begin([item(), item({ column: "emblem", path: ["image"], old: URL("e.png"), new: URL("e2.png") })]))[0].r;
const finish = (op, mode) => as(name, "service_role", `select public.storage_lifecycle_finish_reference_sync($1, 'teste', $2) as r`, [op, mode]);
const mixedVerify = await err((async () => { await db.query(`update public.games set image = '${URL("b.png")}' where slug = 'jogo-a'`); return finish(started.operation_id, "verify"); })());
const mixedSettle = await err(finish(started.operation_id, "settle"));
const tooRecent = await err(finish(started.operation_id, "close_unconfirmed"));
check("8. mistura (1 de 2 gravado): verify e settle recusam (55000), close_unconfirmed recusa antes de 30 min",
  mixedVerify?.code === "55000" && /1 de 2/.test(mixedVerify.message) && mixedSettle?.code === "55000" && tooRecent?.code === "55000" && /30 minutos/.test(tooRecent.message),
  `${mixedVerify?.message?.slice(0, 80)} | ${tooRecent?.message?.slice(0, 60)}`);
const conflict = await err(begin([item({ new: URL("z.png"), old: URL("b.png") })], "game:jogo-a", 1, 1, "b".repeat(64)));
const resume = (await begin([], "game:jogo-a", 1, 1, "a".repeat(64)))[0].r;
check("9. outro pedido com pendência: 55000 (reference_sync_pending); o mesmo pedido retoma com os itens originais",
  conflict?.code === "55000" && /reference_sync_pending/.test(conflict.hint ?? "") && resume.status === "pending" && resume.items.length === 2, `${conflict?.code} ${resume.status}`);
await db.query(`update public.games set emblem = jsonb_set(emblem, '{image}', '"${URL("e2.png")}"') where slug = 'jogo-a'`);
const done = (await finish(started.operation_id, "verify"))[0].r;
const twice = (await finish(started.operation_id, "verify"))[0].r;
check("10. tudo gravado: verify confirma pela releitura; repetir devolve already_finished", done.status === "succeeded" && done.verified === 2 && twice.status === "already_finished", JSON.stringify(done));
const s2 = (await begin([item({ old: URL("b.png"), new: URL("c.png") })], "game:jogo-a", 1, 1, "c".repeat(64)))[0].r;
const settled = (await finish(s2.operation_id, "settle"))[0].r;
check("11. nada gravado: settle encerra como failed (not_applied)", settled.status === "failed" && settled.reason === "not_applied");
const s3 = (await begin([item({ old: URL("b.png"), new: URL("c.png") })], "game:jogo-a", 1, 1, "c".repeat(64)))[0].r;
const attempts = (await db.query(`select idempotency_key from public.storage_operation_log where operation = 'reference_sync' and phase = 'intent' and details ->> 'base_key' = 'refsync:${"c".repeat(64)}' order by id`)).rows.map((r) => r.idempotency_key.split(":").slice(-1)[0]);
check("12. mesmo pedido depois de encerrado: nova tentativa (:2), sem colidir com a chave antiga", s3.status === "started" && attempts.join() === "1,2", attempts.join());
await finish(s3.operation_id, "settle");
const chain = (await db.query("select count(*)::int n from public.storage_operation_log_verify()")).rows[0].n;
check("13. cadeia de auditoria íntegra depois das operações", chain === 0, String(chain));

// 6. Rollback: recusado com uso; aceito sem uso, restaurando restrição e privilégios.
const rbUsed = await err(db.query(read("supabase/rollbacks/20261118_storage_lifecycle_reference_sync_rollback.sql")));
await db.query("rollback").catch(() => {});
check("14. rollback recusado depois de uso (não apaga auditoria)", rbUsed !== null && /Rollback recusado/.test(rbUsed.message), rbUsed?.message);
await db.end();
const fresh = await clone();
await fresh.db.query(read("supabase/migrations/20261118_storage_lifecycle_reference_sync.sql"));
const rbErr = await err(fresh.db.query(read("supabase/rollbacks/20261118_storage_lifecycle_reference_sync_rollback.sql")));
const pre2 = (await fresh.db.query(read("supabase/tests/storage_lifecycle_reference_sync_precheck.sql"))).rows;
check("15. rollback sem uso: aceito; pré-verificação volta a aprovar (funções, restrição e privilégios como antes)", rbErr === null && pre2.every((r) => r.ok), rbErr?.message ?? pre2.filter((r) => !r.ok).map((r) => r.verificacao).join(" | "));
const reapply = await err(fresh.db.query(read("supabase/migrations/20261118_storage_lifecycle_reference_sync.sql")));
check("16. reaplicar depois do rollback funciona", reapply === null, reapply?.message);
await fresh.db.end();

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} verificações passaram`);
await admin.end();
process.exit(ok === results.length ? 0 : 1);

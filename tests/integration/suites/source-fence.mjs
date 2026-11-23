// Migração 20261120 — diário das fontes, cerca transacional e estado durável na remoção — em
// PostgreSQL 17 com postgres NÃO superusuário e transações realmente concorrentes (clientes
// separados). storage.objects é uma réplica mínima (bucket_id, name, version), com outro dono, como no
// Supabase; o comportamento do gatilho na API real do Storage foi validado no projeto isolado de teste.
// Cobre: diário, cerca da varredura (abertura, sincronização, conclusão), prova, autorização com
// conferência viva, remoção só depois de varredura posterior ao arquivamento, ponteiros e rascunhos,
// orquestrador oficial real, desempenho e ausência de deadlock, privilégios, cadeia de auditoria e
// rollback.
import pg from "pg";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const repo = process.env.REPO;
const replica = process.argv[2];
const read = (p) => readFileSync(`${repo}/${p}`, "utf8");
const imp = (p) => import(pathToFileURL(`${repo}/${p}`).href);
const { TIME_TRAVEL_SQL, officialScan } = await imp("tests/integration/support/officialRun.mjs");
const base = { host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 55433) };
const ADMIN = process.env.PG_ADMIN_USER ?? "supabase_admin";
const PORT = Number(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).port);
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${String(detail).slice(0, 240)}` : ""}`); };
const err = async (p) => { try { await p; return null; } catch (e) { return e; } };
const hint = (e) => String(e?.hint ?? "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIGRATION = "supabase/migrations/20261120_storage_lifecycle_source_fence.sql";
const ROLLBACK = "supabase/rollbacks/20261120_storage_lifecycle_source_fence_rollback.sql";
const PRECHECK = "supabase/tests/storage_lifecycle_source_fence_precheck.sql";
const URL_OF = (path) => `http://127.0.0.1:${PORT}/storage/v1/object/public/achievement-art/${path}`;
const ANTIGA = "games/jogo-a/antiga.webp";
const BANNER = "games/jogo-a/banner.webp";
const SHA = "e".repeat(64);

// ---------- Cluster e banco-modelo (migrações até 20261119 + réplica mínima de storage.objects) ----------
const admin = new pg.Client({ ...base, user: ADMIN, database: "postgres" });
await admin.connect();
await admin.query(`create role postgres login createrole bypassrls inherit; create role anon nologin; create role authenticated nologin;
  create role service_role nologin bypassrls; create role authenticator login noinherit;
  grant anon to authenticator with inherit false; grant authenticated to authenticator with inherit false; grant service_role to authenticator with inherit false;
  grant anon, authenticated, service_role, authenticator to postgres with admin option;`);
await admin.query("create database sf_tpl owner postgres");
{
  const a = new pg.Client({ ...base, user: ADMIN, database: "sf_tpl" });
  await a.connect();
  await a.query(`grant usage on schema public to postgres, anon, authenticated, service_role;
    alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;`);
  const t = new pg.Client({ ...base, user: "postgres", database: "sf_tpl" });
  await t.connect();
  await t.query(readFileSync(replica, "utf8"));
  for (const m of ["20261102_add_games_backlog_order", "20261114_create_storage_image_lifecycle", "20261116_storage_lifecycle_tracked_uploads",
    "20261117_storage_lifecycle_pointer_activation", "20261118_storage_lifecycle_reference_sync", "20261119_storage_lifecycle_scan_policy"]) {
    await t.query(read(`supabase/migrations/${m}.sql`));
  }
  await t.query("delete from public.achievement_progress; delete from public.achievements; delete from public.games; delete from public.journey_history_events; delete from public.journey_entries;");
  await t.query(`insert into public.games (slug, title, status, image, card_image) values ('jogo-a', 'Jogo A', 'progress', $1, '/images/games/jogo-a/cover.jpg')`, [URL_OF(BANNER)]);
  await t.end();
  // storage.objects com outro dono (no Supabase: supabase_storage_admin); postgres recebe TRIGGER.
  await a.query(`do $r$ begin if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then create role supabase_storage_admin nologin; end if; end $r$;
    create schema storage;
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null,
      version text, owner uuid, created_at timestamptz not null default now(), unique (bucket_id, name));
    grant usage on schema storage to postgres, service_role;
    grant all on storage.objects to postgres, service_role;
    alter table storage.objects owner to supabase_storage_admin;`);
  await a.query(TIME_TRAVEL_SQL);
  await a.end();
}
let dbCount = 0;
async function newDb({ migrate = true, extra: extraObjects = [] } = {}) {
  const name = `sf_${++dbCount}`;
  await admin.query(`create database ${name} template sf_tpl owner postgres`);
  const open = async (user, role) => {
    const c = new pg.Client({ ...base, user, database: name });
    await c.connect();
    if (role) await c.query(`set role ${role}`);
    return c;
  };
  const db = await open("postgres");
  if (migrate) await db.query(read(MIGRATION));
  const svc = await open("authenticator", "service_role");
  const adm = await open(ADMIN);
  const clients = [db, svc, adm];
  const extra = async (user = "postgres", role) => { const c = await open(user, role); clients.push(c); return c; };
  const rpc = async (fn, args, client = svc) => {
    const names = Object.keys(args);
    const values = names.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
    return (await client.query(`select public.${fn}(${names.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, values)).rows[0].r;
  };
  const backdate = (id, at) => adm.query("select test_support.backdate_scan_run($1, $2)", [id, at]);
  const obj = (path, state, refs = 0) => ({ bucket: "achievement-art", path, size: 10, mimetype: "image/webp", sha256: SHA, state, reference_count: refs });
  const payload = (id, at, n) => ({ scan_id: id, completed_at: at, complete: true, inventory_status: "complete", image_objects: n, image_bytes: 10 * n });
  // Varredura oficial completa (a sequência real), com a antiga sem uso e o banner em uso.
  const scan = (id, at, antigaState = "observing", opts = {}) => {
    const objects = [obj(ANTIGA, antigaState), obj(BANNER, "referenced", 1), ...extraObjects.map((p) => obj(p, antigaState))];
    return officialScan({ rpc, backdate, payload: payload(id, at, objects.length), objects, ...opts });
  };
  const evidence = (path = ANTIGA) => rpc("storage_lifecycle_evidence", { p_bucket: "achievement-art", p_object_path: path });
  const row = async (path = ANTIGA) => (await svc.query("select state, reference_count, archive_state from public.storage_object_lifecycle where bucket = 'achievement-art' and object_path = $1", [path])).rows[0];
  const journal = async () => (await svc.query("select seq, source, operation, row_key, object_keys, prefixes, scopes from public.storage_lifecycle_source_changes order by seq")).rows;
  const runPhase = async (id) => (await svc.query("select phase from public.storage_operation_log where operation = 'scan_run' and phase <> 'intent' and details ->> 'scan_id' = $1", [id])).rows[0]?.phase ?? "pendente";
  const op = (key, operation, path = ANTIGA) => rpc("storage_lifecycle_begin_operation", { p_idempotency_key: key, p_operation: operation, p_bucket: "achievement-art", p_object_path: path, p_actor: "teste", p_reason: "teste da cerca", p_details: {} });
  const finishOp = (id, details = {}) => rpc("storage_lifecycle_finish_operation", { p_operation_id: id, p_result: "succeeded", p_actor: "teste", p_details: details });
  const archived = { archive_bucket: "image-archive", archive_path: `achievement-art/${ANTIGA}`, archive_sha256: SHA, restore: { content_type: "image/webp" } };
  const close = async () => { for (const c of clients) await c.end().catch(() => {}); };
  return { name, db, svc, adm, extra, rpc, backdate, obj, payload, scan, evidence, row, journal, runPhase, op, finishOp, archived, close };
}
/** Duas varreduras oficiais com 39 dias: a antiga vira candidata com prova. */
async function eligibleDb(options = {}) {
  const env = await newDb(options);
  await env.scan("scan-20260901T100000Z", "2026-09-01T10:00:00Z", "observing");
  await env.scan("scan-20261010T100000Z", "2026-10-10T10:00:00Z", "candidate");
  return env;
}

// ---------- 1. Pré-verificação, aplicação, reaplicação ----------
{
  const env = await newDb({ migrate: false });
  const pre = (await env.db.query(read(PRECHECK))).rows;
  check("1. pré-verificação (somente leitura) aprova o banco com 20261119 e storage.objects", pre.every((r) => r.ok), pre.filter((r) => !r.ok).map((r) => r.verificacao).join(" | "));
  const logBefore = Number((await env.db.query("select count(*) n from public.storage_operation_log")).rows[0].n);
  const applyErr = await err(env.db.query(read(MIGRATION)));
  const triggers = (await env.db.query("select count(*)::int n from pg_trigger where tgname in ('storage_lifecycle_source_guard', 'storage_lifecycle_source_journal', 'storage_lifecycle_source_truncate')")).rows[0].n;
  check("2. migração aplicada por postgres não superusuário: 15 gatilhos nas fontes + 1 em storage.objects; nada alterado",
    applyErr === null && triggers === 16 && Number((await env.db.query("select count(*) n from public.storage_operation_log")).rows[0].n) === logBefore, applyErr?.message ?? `gatilhos ${triggers}`);
  const again = await err(env.db.query(read(MIGRATION)));
  await env.db.query("rollback").catch(() => {});
  check("3. reaplicar é recusado", again !== null && /já existem/.test(again.message), again?.message);
  await env.close();
}

// ---------- 2. Diário: todos os gravadores, só mudanças de referência ----------
{
  const env = await newDb();
  const before = (await env.journal()).length;
  await env.db.query("update public.games set title = 'Jogo A (novo título)' where slug = 'jogo-a'");
  const noRef = (await env.journal()).length;
  await env.db.query("update public.games set image = $1 where slug = 'jogo-a'", [URL_OF("games/jogo-a/novo.webp")]);
  const swap = (await env.journal()).filter((r) => r.source === "games").at(-1);
  await env.svc.query(`insert into public.journey_entries ("gameTitle", date, tags) values ('Jogo A', '2026-10-01', $1::jsonb)`, [JSON.stringify({ capa: URL_OF("journey/capa.webp") })]);
  const journey = (await env.journal()).find((r) => r.source === "journey_entries");
  await env.db.query("insert into public.achievements (game_slug, legacy_id, title) values ('jogo-a', 'l1', 'Primeira')");
  await env.db.query("update public.achievements set title = 'Primeira (renomeada)' where game_slug = 'jogo-a'");
  const rename = (await env.journal()).filter((r) => r.source === "achievements").at(-1);
  check("4. diário: salvamento sem troca de imagem não gera evento; troca grava a chave que saiu e a que entrou",
    noRef === before && swap?.source === "games" && swap.object_keys.includes(`achievement-art/${BANNER}`) && swap.object_keys.includes("achievement-art/games/jogo-a/novo.webp"),
    JSON.stringify(swap));
  check("5. diário: Jornada (sem auditoria) e convenção (título de conquista) entram, com o prefixo do jogo",
    journey?.source === "journey_entries" && journey.object_keys.includes("achievement-art/journey/capa.webp")
      && rename?.source === "achievements" && rename.prefixes.includes("achievement-art/games/jogo-a/achievements/"), JSON.stringify([journey, rename]));
  await env.adm.query("insert into storage.objects (bucket_id, name) values ('site-profile', 'active/banner.json'), ('achievement-art', 'games/jogo-a/qualquer.webp'), ('game-review-drafts', 'rascunho.json')");
  const storageRows = (await env.journal()).filter((r) => r.source === "pointers" || r.source === "drafts");
  check("6. Storage: ponteiro e rascunho entram com escopo total; upload de imagem comum não entra",
    storageRows.length === 2 && storageRows.every((r) => r.scopes.includes("*")), JSON.stringify(storageRows));
  const upd = await err(env.svc.query("update public.storage_lifecycle_source_changes set row_key = 'x'"));
  const del = await err(env.db.query("delete from public.storage_lifecycle_source_changes"));
  const ins = await err(env.svc.query("insert into public.storage_lifecycle_source_changes (source, operation, scopes) values ('games', 'UPDATE', '{*}')"));
  const anonRead = await err((async () => { const c = await env.extra("authenticator", "anon"); await c.query("select 1 from public.storage_lifecycle_source_changes"); })());
  const base = await err(env.rpc("storage_lifecycle_evidence_base", { p_bucket: "achievement-art", p_object_path: ANTIGA }));
  const fence = await err(env.svc.query("select public.storage_lifecycle_fence_exclusive(10)"));
  check("7. diário somente inclusão e fechado: service_role não grava, ninguém altera, anon não lê; *_base e a cerca não são do service_role",
    upd && del && ins && anonRead && base?.code === "42501" && fence?.code === "42501", [upd, del, ins, anonRead, base, fence].map((e) => e?.code).join(","));
  await env.db.query("truncate public.journey_history_events");
  const [trunc] = (await env.journal()).slice(-1);
  check("8. TRUNCATE de uma fonte entra com escopo total", trunc?.operation === "TRUNCATE" && trunc.scopes.includes("*"), JSON.stringify(trunc));
  await env.close();
}

// ---------- 3. Cerca da varredura (R1) com transação realmente aberta ----------
{
  // 3a. Alteração aberta DEPOIS da coleta: sincronização não consegue a trava; após o COMMIT, recusa.
  const env = await eligibleDb();
  const T2 = await env.extra("postgres");
  const S3 = "scan-20261020T100000Z";
  await env.rpc("storage_lifecycle_begin_scan_run", { p_scan_id: S3, p_actor: "teste" });
  await env.backdate(S3, "2026-10-20T09:59:00Z");
  await env.rpc("storage_lifecycle_register_scan", { p_scan: { ...env.payload(S3, "2026-10-20T10:00:00Z", 2), report_sha256: "a".repeat(64) }, p_actor: "teste" });
  await env.rpc("storage_lifecycle_attest_scan", { p_scan_id: S3, p_policy_version: 2, p_manifest: (await imp("tests/integration/support/officialRun.mjs")).manifestFor(), p_report_sha256: "a".repeat(64), p_actor: "teste" });
  await T2.query("begin");
  await T2.query("update public.games set image = $1 where slug = 'jogo-a'", [URL_OF(ANTIGA)]);
  const T3 = await env.extra("postgres");
  const t0 = Date.now();
  const syncPromise = err(env.rpc("storage_lifecycle_sync_scan", { p_scan_id: S3, p_objects: [env.obj(ANTIGA, "candidate"), env.obj(BANNER, "referenced", 1)], p_actor: "teste" }));
  // Salvamento normal concorrente (outro jogo, com imagem) enquanto a sincronização tenta a exclusiva: não espera.
  await sleep(500);
  const w0 = Date.now();
  await T3.query("insert into public.games (slug, title, status, image) values ('jogo-c', 'Jogo C', 'progress', $1)", [URL_OF("games/jogo-c/capa.webp")]);
  const writerMs = Date.now() - w0;
  const syncBusy = await syncPromise;
  const waited = Date.now() - t0;
  await T2.query("commit");
  const syncAfter = await err(env.rpc("storage_lifecycle_sync_scan", { p_scan_id: S3, p_objects: [env.obj(ANTIGA, "candidate"), env.obj(BANNER, "referenced", 1)], p_actor: "teste" }));
  await env.rpc("storage_lifecycle_finish_scan_run", { p_scan_id: S3, p_result: "failed", p_actor: "teste", p_details: { reason: "fontes alteradas" } });
  const ev = await env.evidence();
  check("9. R1 (T2 aberta depois da coleta): sincronização recebe 55P03 sem esperar além de 3 s; salvamento concorrente não espera",
    syncBusy?.code === "55P03" && hint(syncBusy).includes("source_write_in_progress") && waited < 4500 && writerMs < 100, `${syncBusy?.code} ${waited} ms; salvamento ${writerMs} ms`);
  check("10. R1: depois do COMMIT de T2, a sincronização recusa (scan_sources_changed), a execução vira failed e nada vira prova",
    syncAfter?.code === "23514" && hint(syncAfter).includes("scan_sources_changed") && (await env.runPhase(S3)) === "failed" && ev.eligible === false,
    `${syncAfter?.message} | prova: ${ev.reason}`);
  await env.close();
}
{
  // 3b. Alteração aberta ANTES da abertura: a abertura não consegue a trava; após o COMMIT, abre normalmente.
  const env = await eligibleDb();
  const T2 = await env.extra("postgres");
  await T2.query("begin");
  await T2.query("update public.games set image = $1 where slug = 'jogo-a'", [URL_OF(ANTIGA)]);
  const busy = await err(env.rpc("storage_lifecycle_begin_scan_run", { p_scan_id: "scan-20261020T100000Z", p_actor: "teste" }));
  const opened = (await env.svc.query("select count(*)::int n from public.storage_operation_log where idempotency_key = 'scan_run:scan-20261020T100000Z'")).rows[0].n;
  await T2.query("commit");
  const ok = await env.rpc("storage_lifecycle_begin_scan_run", { p_scan_id: "scan-20261020T100000Z", p_actor: "teste" });
  const seq = (await env.svc.query("select max(seq)::int m from public.storage_lifecycle_source_changes")).rows[0].m;
  check("11. R1 (T2 aberta antes da abertura): abertura recusada com 55P03 sem abrir nada; depois do COMMIT abre com o marcador já incluindo T2",
    busy?.code === "55P03" && opened === 0 && ok.status === "started" && ok.source_change_seq === seq, `${busy?.code} · marcador ${ok.source_change_seq} = diário ${seq}`);
  await env.close();
}
{
  // 3c. Alteração confirmada entre a sincronização e a conclusão: a conclusão recusa.
  const env = await eligibleDb();
  const S3 = "scan-20261020T100000Z";
  await env.scan(S3, "2026-10-20T10:00:00Z", "candidate", { finish: false });
  await env.db.query("update public.games set image = $1 where slug = 'jogo-a'", [URL_OF(ANTIGA)]);
  const fin = await err(env.rpc("storage_lifecycle_finish_scan_run", { p_scan_id: S3, p_result: "succeeded", p_actor: "teste", p_details: {} }));
  await env.rpc("storage_lifecycle_finish_scan_run", { p_scan_id: S3, p_result: "failed", p_actor: "teste", p_details: {} });
  const ev = await env.evidence();
  check("12. alteração entre a sincronização e a conclusão: conclusão recusada (scan_sources_changed) e a varredura não vale como prova",
    fin?.code === "23514" && hint(fin).includes("scan_sources_changed") && ev.eligible === false, `${fin?.message} | ${ev.reason}`);
  await env.close();
}
{
  // 3d. Execução aberta antes da migração (sem marcador) não vira prova.
  const env = await newDb({ migrate: false });
  await env.rpc("storage_lifecycle_begin_scan_run", { p_scan_id: "scan-20261020T100000Z", p_actor: "teste" });
  await env.db.query(read(MIGRATION));
  const S = "scan-20261020T100000Z";
  await env.backdate(S, "2026-10-20T09:59:00Z");
  await env.rpc("storage_lifecycle_register_scan", { p_scan: { ...env.payload(S, "2026-10-20T10:00:00Z", 2), report_sha256: "a".repeat(64) }, p_actor: "teste" });
  await env.rpc("storage_lifecycle_attest_scan", { p_scan_id: S, p_policy_version: 2, p_manifest: (await imp("tests/integration/support/officialRun.mjs")).manifestFor(), p_report_sha256: "a".repeat(64), p_actor: "teste" });
  const sync = await err(env.rpc("storage_lifecycle_sync_scan", { p_scan_id: S, p_objects: [env.obj(ANTIGA, "observing"), env.obj(BANNER, "referenced", 1)], p_actor: "teste" }));
  check("13. execução aberta antes da migração (sem marcador): sincronização recusada (scan_run_without_fence)", sync?.code === "23514" && hint(sync).includes("scan_run_without_fence"), sync?.message);
  await env.close();
}

// ---------- 4. Prova depois da varredura ----------
{
  const env = await eligibleDb();
  const ev0 = await env.evidence();
  await env.db.query("update public.games set image = $1 where slug = 'jogo-a'", [URL_OF("games/jogo-a/outra.webp")]);
  const evOther = await env.evidence();
  await env.db.query("update public.games set card_image = $1 where slug = 'jogo-a'", [URL_OF(ANTIGA)]);
  const evUsed = await env.evidence();
  check("14. prova: elegível depois de duas varreduras; troca em OUTRA imagem não afeta; uso novo depois da varredura derruba a prova",
    ev0.eligible === true && typeof ev0.source_change_seq === "number" && evOther.eligible === true && evUsed.eligible === false && /uso alterado depois da varredura/.test(evUsed.reason),
    `${ev0.eligible}/${evOther.eligible}/${evUsed.reason}`);
  const bypass = await err(env.op("arch:1", "archive_copy"));
  check("15. arquivar com uso novo (mesmo chamando o banco direto): recusado", bypass?.code === "23514", bypass?.message);
  await env.close();
}
{
  const env = await eligibleDb();
  await env.adm.query("insert into storage.objects (bucket_id, name) values ('achievement-preparation-drafts', 'jogo-a/rascunho.json')");
  const ev = await env.evidence();
  check("16. rascunho gravado depois da varredura: conteúdo opaco → nenhuma imagem é elegível até a próxima varredura", ev.eligible === false && /uso alterado/.test(ev.reason), ev.reason);
  await env.close();
}
{
  const CONV = "games/jogo-a/achievements/02-nova-conquista.png";
  const env = await eligibleDb({ extra: [CONV] });
  const evConv0 = await env.evidence(CONV);
  await env.db.query("insert into public.achievements (game_slug, legacy_id, title) values ('jogo-a', 'l2', 'Nova conquista')");
  const evConv = await env.evidence(CONV);
  const evAntiga = await env.evidence();
  check("17. convenção: conquista nova muda o prefixo do jogo (objetos de outras pastas continuam com prova)",
    evConv0.eligible === true && evConv.eligible === false && evAntiga.eligible === true, `${evConv0.eligible} → ${evConv.reason} | antiga ${evAntiga.eligible}`);
  await env.close();
}

// ---------- 5. Autorização: conferência viva (coleta desatualizada) e gravação aberta (D4) ----------
{
  // A Jornada passa a usar a antiga ANTES das varreduras, mas o relatório (desatualizado) diz 0 referência.
  const env = await newDb();
  await env.svc.query(`insert into public.journey_entries ("gameTitle", date, tags) values ('Jogo A', '2026-10-01', $1::jsonb)`, [JSON.stringify([URL_OF(ANTIGA)])]);
  await env.scan("scan-20260901T100000Z", "2026-09-01T10:00:00Z", "observing");
  await env.scan("scan-20261010T100000Z", "2026-10-10T10:00:00Z", "candidate");
  const ev = await env.evidence();
  const live = await err(env.op("arch:live", "archive_copy"));
  check("18. coleta desatualizada: prova diz elegível, mas a autorização confere o uso real no banco e recusa (object_in_use, journey_entries)",
    ev.eligible === true && live?.code === "23514" && hint(live).includes("object_in_use") && /journey_entries/.test(live.message), `${ev.eligible} · ${live?.message}`);
  await env.close();
}
{
  const env = await eligibleDb();
  const T2 = await env.extra("postgres");
  await T2.query("begin");
  await T2.query("update public.games set card_image = $1 where slug = 'jogo-a'", [URL_OF(ANTIGA)]);
  const busy = await err(env.op("arch:d4", "archive_copy"));
  const state0 = (await env.row()).archive_state;
  await T2.query("commit");
  const after = await err(env.op("arch:d4b", "archive_copy"));
  check("19. D4: gravação aberta na autorização → 55P03 sem mudar nada; depois do COMMIT → recusada (uso alterado/em uso)",
    busy?.code === "55P03" && state0 === "none" && after?.code === "23514" && (await env.row()).archive_state === "none", `${busy?.code} · ${after?.message}`);
  await env.close();
}

// ---------- 6. Estado durável: arquivar, remover só com varredura posterior, recusas durante a remoção ----------
{
  const env = await eligibleDb();
  const arch = await env.op("arch:ok", "archive_copy");
  await env.finishOp(arch.operation_id, env.archived);
  const refArchived = await err(env.db.query("update public.games set card_image = $1 where slug = 'jogo-a'", [URL_OF(ANTIGA)]));
  check("20. arquivada: referência NOVA por SQL direto (como no painel) é recusada pelo gatilho", refArchived?.code === "23514" && hint(refArchived).includes("reference_to_archived"), refArchived?.message);
  const early = await err(env.op("del:early", "delete_object"));
  check("21. remover o original sem varredura posterior ao arquivamento: recusado (delete_needs_scan_after_archive)",
    early?.code === "23514" && hint(early).includes("delete_needs_scan_after_archive") && (await env.row()).archive_state === "archived", early?.message);
  await env.scan("scan-20261020T100000Z", "2026-10-20T10:00:00Z", "candidate");
  const del = await env.op("del:ok", "delete_object");
  check("22. com varredura oficial posterior ao arquivamento: remoção autorizada (deleting)", del.status === "started" && (await env.row()).archive_state === "deleting", JSON.stringify(del));
  const D1 = await err(env.db.query("update public.games set image = $1 where slug = 'jogo-a'", [URL_OF(ANTIGA)]));
  const ptr = await err(env.adm.query("insert into storage.objects (bucket_id, name) values ('site-profile', 'active/avatar.json')"));
  const conv = await err(env.db.query("insert into public.achievements (game_slug, legacy_id, title) values ('jogo-a', 'l3', 'Outra')"));
  const otherGame = await err(env.db.query("insert into public.games (slug, title, status) values ('jogo-b', 'Jogo B', 'progress')"));
  check("23. D1 durante a remoção: SQL direto recusado (reference_to_archived); ponteiro recusado (source_write_during_delete)",
    D1?.code === "23514" && hint(D1).includes("reference_to_archived") && ptr?.code === "23514" && hint(ptr).includes("source_write_during_delete"), `${D1?.message} | ${ptr?.message}`);
  check("24. durante a remoção: salvamentos sem relação (conquista em outra pasta, outro jogo) passam normalmente",
    conv === null && otherGame === null, `${conv?.message ?? "ok"} | ${otherGame?.message ?? "ok"}`);
  await env.finishOp(del.operation_id, {});
  const ptrAfter = await err(env.adm.query("insert into storage.objects (bucket_id, name) values ('site-profile', 'active/avatar.json')"));
  check("25. depois da remoção concluída: estado deleted e ponteiros voltam a ser aceitos", (await env.row()).archive_state === "deleted" && ptrAfter === null, ptrAfter?.message);
  const problems = (await env.svc.query("select * from public.storage_operation_log_verify()")).rows;
  check("26. cadeia de auditoria íntegra depois de todo o fluxo (storage_operation_log_verify sem problemas)", problems.length === 0, JSON.stringify(problems.slice(0, 3)));
  await env.close();
}

// ---------- 7. Orquestrador oficial REAL: R1 de ponta a ponta ----------
{
  const env = await newDb();
  const { runOfficialScan, officialScanApi } = await imp("lib/images/lifecycle/officialScan.ts");
  const { REFERENCE_SOURCES, DEFAULT_PROTECTED_OBJECTS, referencesFromGames, referencesFromProtectionList } = await imp("lib/images/lifecycle/references.ts");
  const q1 = async (sql, params = []) => (await env.svc.query(sql, params)).rows;
  const rawRpc = (fn, args) => env.rpc(fn, args);
  const clock = { t: Date.parse("2026-09-01T10:00:00Z") };
  const now = () => new Date((clock.t += 1000));
  const readState = async () => {
    const pending = await q1("select operation, details from public.storage_lifecycle_pending_operations");
    return {
      scans: await q1("select scan_id, completed_at, complete, inventory_status, image_objects, image_bytes, report_sha256 from public.storage_lifecycle_scans"),
      objects: await q1("select bucket, object_path, state, manual_protection, manual_protection_reason, archive_state, reference_count, observing_since, observing_since_scan_id, last_seen_scan_id from public.storage_object_lifecycle order by bucket, object_path"),
      scanObjectRows: Number((await q1("select count(*) n from public.storage_lifecycle_scan_objects"))[0].n),
      logRows: Number((await q1("select count(*) n from public.storage_operation_log"))[0].n),
      syncedScanIds: (await q1("select scan_id from public.storage_operation_log where operation = 'scan_sync' and phase = 'succeeded'")).map((r) => r.scan_id),
      pendingOperations: pending.length,
      pendingRunScanIds: pending.filter((r) => r.operation === "scan_run").map((r) => r.details.scan_id),
    };
  };
  const baseApi = officialScanApi(rawRpc, { readState, verifyChain: () => q1("select * from public.storage_operation_log_verify()") },
    async (id) => Number((await q1("select count(*) n from public.storage_lifecycle_scan_objects where scan_id = $1", [id]))[0].n));
  const api = { ...baseApi, beginRun: async (scanId, actor) => {
    const r = await baseApi.beginRun(scanId, actor);
    if ((r.status === "started" || r.status === "pending") && Date.parse(r.started_at) > clock.t) {
      await env.backdate(scanId, new Date(clock.t - 500).toISOString());
      return { ...r, started_at: new Date(clock.t - 500).toISOString() };
    }
    return r;
  } };
  const T2 = await env.extra("postgres");
  let afterCollect = null;
  const openT2 = async () => {
    await T2.query("begin");
    await T2.query("update public.games set image = $1 where slug = 'jogo-a'", [URL_OF(ANTIGA)]);
  };
  const files = [ANTIGA, BANNER, ...DEFAULT_PROTECTED_OBJECTS.map((k) => k.slice("achievement-art/".length))]
    .map((p) => ({ bucket: "achievement-art", path: p, size: 10, mimetype: "image/webp", isImage: true }));
  const collect = async () => {
    const games = await q1("select * from public.games");
    const sources = REFERENCE_SOURCES.filter((s) => s !== "games" && s !== "protection").map((source) => ({ source, status: "complete", references: [] }));
    sources.push(referencesFromGames(games), referencesFromProtectionList());
    const collected = {
      existingBuckets: ["achievement-art"], inventory: { status: "complete", objects: files }, nonImageObjects: [], allImageObjects: files, sources: [],
      pointerReadings: [], tableCounts: { games: games.length }, issues: [],
      counters: { listCalls: 1, listedEntries: files.length, tablePages: 1, tableRows: games.length, jsonFilesDownloaded: 0, jsonBytesDownloaded: 0, imageDownloads: 0, approxMetadataBytes: 0 },
    };
    if (afterCollect) { const h = afterCollect; afterCollect = null; await h(); }
    return { collected, sources };
  };
  const store = new Map();
  const memStore = { exists: (p) => store.has(p), read: (p) => store.get(p), writeNew: (p, t) => { if (store.has(p)) throw new Error("EEXIST"); store.set(p, t); }, append: (p, t) => store.set(p, (store.get(p) ?? "") + t) };
  const official = (resume) => runOfficialScan({ mode: "apply", resumeScanId: resume, actor: "teste", now, api, store: memStore, collect, protectedObjects: DEFAULT_PROTECTED_OBJECTS, log: () => {} });
  const s1 = await official();
  clock.t = Date.parse("2026-10-10T10:00:00Z");
  afterCollect = openT2;
  const first = await official();
  await T2.query("commit");
  const resumed = first.ok ? null : await official(first.scanId);
  const phase = await env.runPhase(first.scanId);
  const ev = await env.evidence();
  check("27. orquestrador real (R1): com a gravação aberta para de forma retomável; retomado após o COMMIT, encerra a execução como falha",
    s1.ok === true && first.ok === false && /55P03|retomável/.test(first.reason ?? "") && resumed?.ok === false && phase === "failed", `S1 ${s1.ok ? "ok" : s1.reason?.slice(0, 120)} | ${first.reason?.slice(0, 120)} | ${resumed?.reason?.slice(0, 120)} | ${phase}`);
  check("28. orquestrador real (R1): a antiga, agora em uso, não tem prova de elegibilidade", ev.eligible === false, ev.reason);
  await env.close();
}

// ---------- 8. Concorrência: 200 salvamentos x verificações exclusivas, sem deadlock ----------
{
  const env = await eligibleDb();
  const writers = await Promise.all([1, 2, 3, 4].map(() => env.extra("authenticator", "service_role")));
  const checker = await env.extra("authenticator", "service_role");
  for (let i = 0; i < 4; i += 1) await env.db.query("insert into public.games (slug, title, status) values ($1, $1, 'progress')", [`carga-${i}`]);
  const latencies = [];
  const errors = [];
  let checks = 0;
  let acquired = 0;
  let yielded = 0;
  let stop = false;
  const checkerLoop = (async () => {
    while (!stop) {
      // Cada tentativa pega a trava exclusiva e é recusada no fim (objeto não elegível): repetição real da cerca.
      const e = await err(env.rpc("storage_lifecycle_begin_operation", { p_idempotency_key: `carga:${checks}`, p_operation: "archive_copy", p_bucket: "achievement-art", p_object_path: BANNER, p_actor: "teste", p_reason: "carga", p_details: {} }, checker));
      if (e?.code === "23514") acquired += 1;
      else if (e?.code === "55P03") yielded += 1;
      else errors.push(`verificação ${e?.code} ${e?.message ?? "sem recusa"}`);
      checks += 1;
    }
  })();
  await Promise.all(writers.map(async (w, i) => {
    for (let k = 0; k < 50; k += 1) {
      const t = Date.now();
      const e = await err(w.query("update public.games set image = $1 where slug = $2", [URL_OF(`carga/${i}-${k}.webp`), `carga-${i}`]));
      latencies.push(Date.now() - t);
      if (e) errors.push(`gravador ${e.code} ${e.message}`);
      await sleep(10);
    }
  }));
  stop = true;
  await checkerLoop;
  latencies.sort((a, b) => a - b);
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const deadlocks = errors.filter((e) => /40P01/.test(e)).length;
  check("29. 200 salvamentos concorrentes (4 conexões) intercalados com verificações exclusivas repetidas: nenhum erro, nenhum deadlock, p95 < 100 ms",
    errors.length === 0 && deadlocks === 0 && latencies.length === 200 && p95 < 100 && acquired >= 20,
    `p95 ${p95} ms · máx ${latencies.at(-1)} ms · exclusivas obtidas ${acquired}, cedidas (55P03) ${yielded} · erros ${errors.slice(0, 2).join(" | ")}`);
  const logged = (await env.svc.query("select count(*)::int n from public.storage_lifecycle_source_changes where source = 'games' and exists (select 1 from unnest(object_keys) k where k like 'achievement-art/carga/%')")).rows[0].n;
  check("30. diário íntegro sob concorrência: um evento por salvamento com troca de imagem", logged === 200, `${logged} eventos`);
  await env.close();
}

// ---------- 8b. Ordem das travas: função do ciclo de vida que grava numa fonte x trava exclusiva segurada ----------
{
  const env = await newDb();
  const A = await env.extra("authenticator", "service_role");
  const B = await env.extra("authenticator", "service_role");
  // A segura a exclusiva (abertura da execução numa transação explícita) e depois pede a trava global de escrita.
  await A.query("begin");
  await A.query("select public.storage_lifecycle_begin_scan_run('scan-20261020T100000Z', 'teste')");
  // B: troca de referência auditada (trava global de escrita + UPDATE em games, que pede a cerca compartilhada).
  const t0 = Date.now();
  const bPromise = err(env.rpc("storage_lifecycle_replace_reference", { p_idempotency_key: "rr:1", p_table: "games", p_row_key: "jogo-a", p_column: "image",
    p_expected_value: URL_OF(BANNER), p_new_value: URL_OF("games/jogo-a/nova.webp"), p_actor: "teste", p_reason: "troca concorrente" }, B));
  await sleep(300);
  const aErr = await err(A.query("select public.storage_lifecycle_register_scan($1::jsonb, 'teste')", [JSON.stringify({ ...env.payload("scan-20261020T100000Z", "2026-10-20T10:00:00Z", 2), report_sha256: "a".repeat(64) })]));
  await A.query(aErr ? "rollback" : "commit");
  const bErr = await bPromise;
  const waited = Date.now() - t0;
  const image = (await env.svc.query("select image from public.games where slug = 'jogo-a'")).rows[0].image;
  check("33. ordem das travas: troca auditada (trava global + fonte) concorrente com a exclusiva segurada não entra em deadlock; ambas concluem",
    aErr === null && bErr === null && image.endsWith("nova.webp") && waited < 3000, `${aErr?.code ?? "ok"} / ${bErr?.code ?? "ok"} ${bErr?.message ?? ""} · B esperou ${waited} ms`);
  await env.close();
}

// ---------- 9. Rollback ----------
{
  const used = await eligibleDb();
  const refused = await err(used.db.query(read(ROLLBACK)));
  await used.db.query("rollback").catch(() => {});
  const policyFirst = await err(used.db.query(read("supabase/rollbacks/20261119_storage_lifecycle_scan_policy_rollback.sql")));
  await used.db.query("rollback").catch(() => {});
  check("31b. rollback da 20261119 com a 20261120 aplicada: recusado (ordem obrigatória)", policyFirst !== null && /20261120/.test(policyFirst.message), policyFirst?.message);
  check("31. rollback recusado depois que a cerca foi usada por uma execução oficial", refused !== null && /Rollback recusado/.test(refused.message), refused?.message);
  await used.close();
  const env = await newDb();
  // No Supabase, supautils (drop_trigger_grants) deixa o postgres remover gatilho em storage.objects; aqui, por participação no dono.
  await admin.query("grant supabase_storage_admin to postgres");
  await env.db.query("update public.games set image = $1 where slug = 'jogo-a'", [URL_OF("games/jogo-a/x.webp")]);
  const rb = await err(env.db.query(read(ROLLBACK)));
  if (rb) { console.log(`rollback falhou: ${rb.message} ${rb.where ?? ""}`); await env.db.query("rollback").catch(() => {}); }
  const after = (await env.db.query(`select to_regclass('public.storage_lifecycle_source_changes') is null as sem_diario,
      (select count(*)::int from pg_trigger where tgname in ('storage_lifecycle_source_guard', 'storage_lifecycle_source_journal', 'storage_lifecycle_source_truncate')) as gatilhos,
      has_function_privilege('service_role', 'public.storage_lifecycle_evidence(text, text)', 'EXECUTE') as prova,
      strpos(pg_get_functiondef('public.storage_lifecycle_lock_key(text, text)'::regprocedure), 'fence') = 0 as travas_originais`)).rows[0];
  const reapply = await err(env.db.query(read(MIGRATION)));
  check("32. rollback sem uso: remove diário e gatilhos, restaura as funções anteriores e a ordem de travas; reaplicar funciona",
    rb === null && after.sem_diario && after.gatilhos === 0 && after.prova && after.travas_originais && reapply === null, rb?.message ?? reapply?.message ?? JSON.stringify(after));
  await env.close();
}

await admin.end();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} verificações aprovadas`);
process.exit(failed === 0 ? 0 : 1);

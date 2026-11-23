// Etapa 5.3 — política versionada de varredura NO BANCO (migração 20261119), em PostgreSQL 17 com
// postgres não superusuário: varreduras anteriores à política nunca viram prova; a prova exige duas
// varreduras atestadas pela política vigente, completas, íntegras e com 30 dias; contornar o
// executor não ajuda (a guarda do banco usa a mesma prova); rollback seguro.
import pg from "pg";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const repo = process.env.REPO;
const replica = process.argv[2];
const read = (p) => readFileSync(`${repo}/${p}`, "utf8");
const { TIME_TRAVEL_SQL, manifestFor } = await import(pathToFileURL(`${repo}/tests/integration/support/officialRun.mjs`).href);
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ""}`); };
const base = { host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 55433) };
const ADMIN = process.env.PG_ADMIN_USER ?? "supabase_admin";
const admin = new pg.Client({ ...base, user: ADMIN, database: "postgres" });
await admin.connect();
await admin.query(`
  create role postgres login createrole bypassrls inherit;
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create role authenticator login noinherit;
  grant anon to authenticator with inherit false; grant authenticated to authenticator with inherit false; grant service_role to authenticator with inherit false;
  grant anon, authenticated, service_role, authenticator to postgres with admin option;`);
const BEFORE = ["20261102_add_games_backlog_order", "20261114_create_storage_image_lifecycle", "20261116_storage_lifecycle_tracked_uploads",
  "20261117_storage_lifecycle_pointer_activation", "20261118_storage_lifecycle_reference_sync"];
let n = 0;
// Banco-modelo com as migrações até 20261118 (papéis são do cluster: a 20261114 só roda uma vez).
{
  await admin.query("create database sp_tpl owner postgres");
  const a = new pg.Client({ ...base, user: ADMIN, database: "sp_tpl" });
  await a.connect();
  await a.query(`grant usage on schema public to postgres, anon, authenticated, service_role;
    alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;`);
  await a.end();
  const t = new pg.Client({ ...base, user: "postgres", database: "sp_tpl" });
  await t.connect();
  await t.query(readFileSync(replica, "utf8"));
  for (const m of BEFORE) await t.query(read(`supabase/migrations/${m}.sql`));
  await t.end();
  // Viagem no tempo só para os testes (tests/integration/support/officialRun.mjs).
  const tt = new pg.Client({ ...base, user: ADMIN, database: "sp_tpl" });
  await tt.connect();
  await tt.query(TIME_TRAVEL_SQL);
  await tt.end();
}
async function newDb() {
  const name = `sp_${++n}`;
  await admin.query(`create database ${name} template sp_tpl owner postgres`);
  const db = new pg.Client({ ...base, user: "postgres", database: name });
  await db.connect();
  const svc = new pg.Client({ ...base, user: "authenticator", database: name });
  await svc.connect();
  await svc.query("set role service_role");
  const adm = new pg.Client({ ...base, user: ADMIN, database: name });
  await adm.connect();
  const backdate = async (id, at) => { await adm.query("select test_support.backdate_scan_run($1, $2)", [id, at]); };
  return { name, db, svc, adm, backdate };
}
const err = async (p) => { try { await p; return null; } catch (e) { return e; } };
const SOURCES = ["achievements", "achievement_progress", "games", "journey_entries", "journey_history_events", "pointers", "drafts", "variant_map", "protection", "convention"];
const sha = (c) => c.repeat(64);
const OBJ = { bucket: "achievement-art", path: "games/jogo/achievements/sobra.png", size: 10, mimetype: "image/png", sha256: sha("e"), state: "superseded", reference_count: 0 };
const KEYP = { p_bucket: OBJ.bucket, p_object_path: OBJ.path };

function api(svc, backdate) {
  const call = async (fn, args) => {
    const names = Object.keys(args);
    // Listas de texto viram text[]; objetos e listas de objetos, JSON.
    const values = names.map((k) => (Array.isArray(args[k]) && args[k].every((x) => typeof x === "string") ? args[k] : args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
    return (await svc.query(`select public.${fn}(${names.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, values)).rows[0].r;
  };
  return {
    call,
    // official: execução aberta antes do relatório (recuada para 1 min antes de completed_at);
    // attest: atestação com manifesto; finish: conclusão depois da sincronização.
    scan: async (id, at, { complete = true, report = sha("a"), official = false, attest = official, sync = complete, finish = attest && sync, manifest = manifestFor() } = {}) => {
      if (official) {
        await call("storage_lifecycle_begin_scan_run", { p_scan_id: id, p_actor: "teste" });
        await backdate(id, new Date(Date.parse(at) - 60_000).toISOString());
      }
      await call("storage_lifecycle_register_scan", { p_scan: { scan_id: id, completed_at: at, complete, inventory_status: complete ? "complete" : "partial", image_objects: 1, image_bytes: 10, report_sha256: report }, p_actor: "teste" });
      if (attest) await call("storage_lifecycle_attest_scan", { p_scan_id: id, p_policy_version: 2, p_manifest: manifest, p_report_sha256: report, p_actor: "teste" });
      if (sync) await call("storage_lifecycle_sync_scan", { p_scan_id: id, p_objects: [OBJ], p_actor: "teste" });
      if (finish) await call("storage_lifecycle_finish_scan_run", { p_scan_id: id, p_result: "succeeded", p_actor: "teste", p_details: {} });
      return report;
    },
    finish: (id, result = "succeeded") => call("storage_lifecycle_finish_scan_run", { p_scan_id: id, p_result: result, p_actor: "teste", p_details: {} }),
    attest: (id, o = {}) => call("storage_lifecycle_attest_scan", { p_scan_id: id, p_policy_version: 2, p_manifest: manifestFor(), p_report_sha256: sha("a"), p_actor: "teste", ...o }),
    meets: (id) => call("storage_lifecycle_scan_meets_policy", { p_scan_id: id }),
    evidence: () => call("storage_lifecycle_evidence", KEYP),
  };
}

// ---------- Banco com a varredura "antiga" (como a de 15/11), antes da política ----------
const { name, db, svc, backdate } = await newDb();
const a = api(svc, backdate);
await a.scan("scan-20260601T000000Z", "2026-06-01T00:00:00Z");
const OLD_REPORT = await a.scan("scan-20260715T000000Z", "2026-07-15T00:00:00Z");
const before = await a.evidence();
check("0. controle (sem a política): duas varreduras antigas com 44 dias tornariam o objeto elegível", before.eligible === true, JSON.stringify(before).slice(0, 120));

const pre = (await db.query(read("supabase/tests/storage_lifecycle_scan_policy_precheck.sql"))).rows;
check("1. pré-verificação (somente leitura) aprova o banco com 20261118", pre.every((r) => r.ok), pre.filter((r) => !r.ok).map((r) => r.verificacao).join(" | "));
const logBefore = Number((await db.query("select count(*) n from public.storage_operation_log")).rows[0].n);
const applyErr = await err(db.query(read("supabase/migrations/20261119_storage_lifecycle_scan_policy.sql")));
check("2. migração aplicada por postgres não superusuário; histórico preservado (nenhum registro alterado)",
  applyErr === null && Number((await db.query("select count(*) n from public.storage_operation_log")).rows[0].n) === logBefore
    && Number((await db.query("select count(*) n from public.storage_lifecycle_scans")).rows[0].n) === 2, applyErr?.message);
const again = await err(db.query(read("supabase/migrations/20261119_storage_lifecycle_scan_policy.sql")));
await db.query("rollback").catch(() => {});
check("3. reaplicar é recusado", again !== null && /já existem/.test(again.message), again?.message);

// ---------- Varreduras antigas não são prova ----------
const ev1 = await a.evidence();
check("4. depois da política: varreduras antigas não contam (a mais recente não atende à política v2)",
  ev1.eligible === false && /política de varredura vigente/.test(ev1.reason) && ev1.policy_version === 2, JSON.stringify(ev1));
const attestOld = await err(a.attest("scan-20260715T000000Z", { p_report_sha256: OLD_REPORT }));
check("5. varredura registrada antes da política nunca é atestada (23514 scan_predates_policy)", attestOld?.code === "23514" && /scan_predates_policy/.test(attestOld.hint ?? ""), attestOld?.message);
const bypass = await err(a.call("storage_lifecycle_begin_operation", { p_idempotency_key: "bypass:1", p_operation: "archive_copy", ...{ p_bucket: OBJ.bucket, p_object_path: OBJ.path }, p_actor: "teste", p_reason: "contornar o executor", p_details: {} }));
check("6. contornar o executor (begin_operation direto) com prova antiga: a guarda do banco recusa (23514)", bypass?.code === "23514", bypass?.message);

// ---------- Atestação: versão, fontes, relatório ----------
const N1 = "scan-20260801T000000Z";
await a.scan(N1, "2026-08-01T00:00:00Z", { official: true, attest: false, sync: false });
const att = (o) => err(a.attest(N1, o));
const noConvention = await att({ p_manifest: manifestFor(SOURCES.filter((s) => s !== "convention")) });
const wrongSha = await att({ p_report_sha256: sha("b") });
const oldVersion = await att({ p_policy_version: 1 });
const dup = await att({ p_manifest: manifestFor([...SOURCES, "games"]) });
check("7. atestação recusada: sem a fonte convention, relatório com outro SHA-256, versão antiga, fontes repetidas",
  noConvention?.hint?.includes("scan_sources_missing") && wrongSha?.hint?.includes("scan_report_mismatch") && oldVersion?.hint?.includes("scan_policy_version") && dup?.hint?.includes("scan_sources_missing"),
  [noConvention, wrongSha, oldVersion, dup].map((e) => e?.hint ?? e?.message).join(" | "));
const ok1 = await a.attest(N1);
const ok2 = await a.attest(N1);
const conflict = await err(a.attest(N1, { p_manifest: manifestFor([...SOURCES, "extra"]) }));
const pendingMeets = await a.meets(N1);
await a.call("storage_lifecycle_sync_scan", { p_scan_id: N1, p_objects: [OBJ], p_actor: "teste" });
const syncedMeets = await a.meets(N1);
const fin = await a.finish(N1);
check("8. atestação válida; repetir é idempotente; outro manifesto para a mesma varredura → 23505; só vale como prova depois da conclusão da execução",
  ok1.status === "attested" && ok2.status === "already_attested" && conflict?.code === "23505" && pendingMeets === false && syncedMeets === false && fin.status === "succeeded" && (await a.meets(N1)) === true,
  `${ok1.status}/${ok2.status}/${conflict?.code}/${pendingMeets}/${syncedMeets}/${fin.status}`);

// ---------- Antiga + nova não formam par; intervalo; duas novas válidas ----------
const ev2 = await a.evidence();
check("9. varredura antiga + 1 nova válida (mais de 30 dias entre elas) NÃO formam prova: só 1 conta", ev2.eligible === false && ev2.scans === 1 && /menos de duas/.test(ev2.reason), JSON.stringify(ev2).slice(0, 160));
await a.scan("scan-20260816T000000Z", "2026-08-16T00:00:00Z", { official: true });
const ev3 = await a.evidence();
check("10. duas novas com 15 dias: intervalo insuficiente", ev3.eligible === false && ev3.scans === 2 && /intervalo/.test(ev3.reason), JSON.stringify(ev3).slice(0, 160));
await a.scan("scan-20260905T000000Z", "2026-09-05T00:00:00Z", { official: true });
const ev4 = await a.evidence();
check("11. duas (ou mais) novas válidas da mesma política, com 35 dias: elegível; a prova começa na primeira nova",
  ev4.eligible === true && ev4.first_scan === N1 && ev4.policy_version === 2 && ev4.scans === 3, JSON.stringify(ev4).slice(0, 180));
const begin = await a.call("storage_lifecycle_begin_operation", { p_idempotency_key: "ok:1", p_operation: "archive_copy", p_bucket: OBJ.bucket, p_object_path: OBJ.path, p_actor: "teste", p_reason: "prova válida", p_details: {} });
await a.call("storage_lifecycle_finish_operation", { p_operation_id: begin.operation_id, p_result: "failed", p_actor: "teste", p_details: { reason: "teste" } });
check("12. com a prova válida, a guarda do banco aceita iniciar o arquivamento (encerrado em seguida como falha de teste)", begin.status === "started", begin.status);

// ---------- Varredura nova sem atestação, incompleta ou invalidada ----------
await a.scan("scan-20260910T000000Z", "2026-09-10T00:00:00Z");
const ev5 = await a.evidence();
check("13. varredura mais recente sem atestação (fonte ausente / relatório não atestado): nada elegível", ev5.eligible === false && /política/.test(ev5.reason), ev5.reason);
await a.call("storage_lifecycle_invalidate_scan", { p_scan_id: "scan-20260910T000000Z", p_reason: "teste: sem atestação", p_actor: "teste" });
const ev5b = await a.evidence();
check("13b. a mais recente invalidada: nada elegível (regra anterior preservada)", ev5b.eligible === false && /invalidada/.test(ev5b.reason), ev5b.reason);
await a.scan("scan-20260911T000000Z", "2026-09-11T00:00:00Z", { complete: false });
const incompleteNoRun = await err(a.attest("scan-20260911T000000Z"));
await a.scan("scan-20260912T000000Z", "2026-09-12T00:00:00Z", { complete: false, official: true, attest: false, sync: false });
const incomplete = await err(a.attest("scan-20260912T000000Z"));
await a.finish("scan-20260912T000000Z", "failed");
check("14. relatório incompleto não pode ser atestado (sem execução: scan_run_missing; com execução: 23514 scan_incomplete)",
  /scan_run_missing/.test(incompleteNoRun?.hint ?? "") && incomplete?.code === "23514" && /scan_incomplete/.test(incomplete.hint ?? ""), `${incompleteNoRun?.hint} | ${incomplete?.hint}`);
await a.scan("scan-20260920T000000Z", "2026-09-20T00:00:00Z", { official: true });
await a.call("storage_lifecycle_invalidate_scan", { p_scan_id: "scan-20260905T000000Z", p_reason: "teste", p_actor: "teste" });
const ev6 = await a.evidence();
check("15. varredura atestada e depois invalidada deixa de contar (prova recalculada sem ela)", ev6.eligible === true && ev6.scans === 3 && ev6.first_scan === N1, JSON.stringify(ev6).slice(0, 160));

// ---------- Privilégios: ninguém escreve direto nas tabelas da política ----------
const insertDirect = await err(svc.query(`insert into public.storage_lifecycle_scan_attestations (scan_id, policy_version, sources, manifest, manifest_sha256, run_operation_id, report_sha256, attested_by) values ('scan-20260715T000000Z', 2, $1, '[]', $2, gen_random_uuid(), $2, 'x')`, [SOURCES, OLD_REPORT]));
const logDirect = await err(svc.query(`select public.storage_lifecycle_append_log(gen_random_uuid(), 'intent', 'scan_run', 'scan_run:scan-20260715T000000Z', null, null, null, 'x', 'forjar execução', null, null, null, null, '{"scan_id":"scan-20260715T000000Z","policy_version":2}'::jsonb)`));
const policyDirect = await err(svc.query(`insert into public.storage_lifecycle_scan_policies (policy_version, required_sources, description) values (9, '{x}', 'x')`));
const asRole = (role, sql, params = []) => err((async () => { const c = new pg.Client({ ...base, user: "authenticator", database: name }); await c.connect(); try { await c.query(`set role ${role}`); await c.query(sql, params); } finally { await c.end(); } })());
const anonCall = await asRole("anon", `select public.storage_lifecycle_attest_scan('scan-20260715T000000Z', 2, $1::jsonb, $2, 'x')`, [JSON.stringify(manifestFor()), OLD_REPORT]);
const directRun = [];
for (const role of ["anon", "authenticated"]) {
  directRun.push(await asRole(role, "select public.storage_lifecycle_begin_scan_run('scan-20261201T000000Z', 'x')"));
  directRun.push(await asRole(role, "select public.storage_lifecycle_finish_scan_run('scan-20260801T000000Z', 'failed', 'x', '{}')"));
}
const updateOwner = await err(db.query(`update public.storage_lifecycle_scan_attestations set policy_version = 2`));
check("16. service_role não grava direto em atestações, políticas nem na auditoria (não forja execução); anon/authenticated não executam atestação nem execução; postgres não altera",
  insertDirect?.code === "42501" && policyDirect?.code === "42501" && logDirect?.code === "42501" && anonCall?.code === "42501" && updateOwner?.code === "42501"
    && directRun.every((e) => e?.code === "42501"),
  [insertDirect, policyDirect, logDirect, anonCall, updateOwner, ...directRun].map((e) => e?.code).join("/"));

// ---------- Nova versão da política: atestações antigas deixam de valer ----------
const R3 = "scan-20261117T000000Z";
await a.call("storage_lifecycle_begin_scan_run", { p_scan_id: R3, p_actor: "teste" });
await backdate(R3, "2026-11-16T23:59:00Z");
const sup = new pg.Client({ ...base, user: ADMIN, database: name });
await sup.connect();
await sup.query(`begin; set local role storage_lifecycle_owner;
  insert into public.storage_lifecycle_scan_policies (policy_version, required_sources, description) values (3, '{achievements,achievement_progress,games,journey_entries,journey_history_events,pointers,drafts,variant_map,protection,convention,nova_fonte}', 'teste v3');
  commit;`);
await sup.end();
const ev7 = await a.evidence();
const attestV3 = await err(a.attest("scan-20260920T000000Z", { p_policy_version: 3, p_manifest: manifestFor([...SOURCES, "nova_fonte"]) }));
check("17. nova versão da política: provas atestadas pela v2 deixam de valer; varreduras anteriores à v3 não podem ser atestadas por ela",
  ev7.eligible === false && ev7.policy_version === 3 && attestV3?.code === "23514" && /scan_predates_policy/.test(attestV3.hint ?? ""), `${ev7.reason} | ${attestV3?.code} ${attestV3?.hint} ${attestV3?.message}`);
await a.call("storage_lifecycle_register_scan", { p_scan: { scan_id: R3, completed_at: "2026-11-17T00:00:00Z", complete: true, inventory_status: "complete", image_objects: 1, image_bytes: 10, report_sha256: sha("a") }, p_actor: "teste" });
const mixed = await err(a.attest(R3, { p_policy_version: 3, p_manifest: manifestFor([...SOURCES, "nova_fonte"]) }));
const mixedOld = await err(a.attest(R3));
await a.finish(R3, "failed");
check("17b. execução aberta na v2 e atestada depois da v3: recusada (versões nunca formam par); atestar pela v2 também é recusado",
  mixed?.code === "23514" && /scan_run_policy_changed/.test(mixed.hint ?? "") && /scan_policy_version/.test(mixedOld?.hint ?? ""), `${mixed?.hint} ${mixed?.message} | ${mixedOld?.hint}`);

const chain = Number((await db.query("select count(*)::int n from public.storage_operation_log_verify()")).rows[0].n);
const attests = (await db.query("select count(*)::int n from public.storage_operation_log where operation = 'scan_attest' and phase = 'succeeded'")).rows[0].n;
check("18. cadeia de auditoria íntegra; cada atestação registrada (intenção + sucesso)", chain === 0 && attests === 4, `${chain} / ${attests}`);
const rbUsed = await err(db.query(read("supabase/rollbacks/20261119_storage_lifecycle_scan_policy_rollback.sql")));
await db.query("rollback").catch(() => {});
check("19. rollback recusado depois de uso (não apaga atestações)", rbUsed !== null && /Rollback recusado/.test(rbUsed.message), rbUsed?.message);
await svc.end(); await db.end();

// ---------- Execução oficial: o banco exige a sequência que só o fluxo oficial produz ----------
{
  const x = await newDb();
  await x.db.query(read("supabase/migrations/20261119_storage_lifecycle_scan_policy.sql"));
  const r = api(x.svc, x.backdate);
  const reg = (id, at, o = {}) => r.call("storage_lifecycle_register_scan", { p_scan: { scan_id: id, completed_at: at, complete: true, inventory_status: "complete", image_objects: 1, image_bytes: 10, report_sha256: sha("a"), ...o }, p_actor: "teste" });
  const begin = (id) => r.call("storage_lifecycle_begin_scan_run", { p_scan_id: id, p_actor: "teste" });
  const hint = (e) => e?.hint ?? e?.message;

  // Simulação/registro direto nunca vira oficial.
  await reg("scan-20261001T000000Z", "2026-10-01T00:00:00Z");
  const promote = await err(begin("scan-20261001T000000Z"));
  const noRun = await err(r.attest("scan-20261001T000000Z"));
  check("22. varredura registrada sem execução (simulação ou chamada direta): não abre execução depois (scan_run_after_register) nem é atestada (scan_run_missing)",
    /scan_run_after_register/.test(hint(promote)) && /scan_run_missing/.test(hint(noRun)), `${hint(promote)} | ${hint(noRun)}`);

  // Relatório concluído antes da abertura da execução (produzido fora dela).
  const E1 = "scan-20261002T000000Z";
  const b1 = await begin(E1);
  const b1again = await begin(E1);
  const other = await err(begin("scan-20261003T000000Z"));
  const pendingView = (await x.db.query("select count(*)::int n from public.storage_lifecycle_pending_operations where operation = 'scan_run'")).rows[0].n;
  await reg(E1, "2026-10-02T00:00:00Z");
  const before = await err(r.attest(E1));
  const fe = await r.finish(E1, "failed");
  check("23. execução idempotente (repetir devolve pending); uma por vez (scan_run_other_pending); aparece como pendência; relatório anterior à abertura é recusado (scan_report_before_run)",
    b1.status === "started" && b1again.status === "pending" && b1again.operation_id === b1.operation_id && /scan_run_other_pending/.test(hint(other))
      && pendingView === 1 && /scan_report_before_run/.test(hint(before)) && fe.status === "failed",
    `${b1.status}/${b1again.status} | ${hint(other)} | ${pendingView} | ${hint(before)}`);

  // Manifesto sem prova: entradas inválidas.
  const E2 = "scan-20261004T000000Z";
  await begin(E2);
  await x.backdate(E2, "2026-10-03T23:59:00Z");
  await reg(E2, "2026-10-04T00:00:00Z");
  const bad = [
    manifestFor().map((m, i) => (i === 0 ? { ...m, status: "partial" } : m)),
    manifestFor().map((m, i) => (i === 1 ? { ...m, digest: "nao-e-sha" } : m)),
    manifestFor().map((m, i) => (i === 2 ? { ...m, references: -1 } : m)),
    manifestFor().map((m, i) => (i === 3 ? { ...m, references: 1.5 } : m)),
    manifestFor().map(({ source }) => ({ source, status: "complete" })),
    { fontes: SOURCES },
    [],
  ];
  const refusals = [];
  for (const m of bad) refusals.push(await err(r.attest(E2, { p_manifest: m })));
  check("24. atestação sem prova de coleta: fonte parcial, resumo inválido, contagem negativa ou fracionária, sem resumo, manifesto que não é lista ou vazio → recusada (scan_sources_missing)",
    refusals.every((e) => e?.code === "23514" && /scan_sources_missing/.test(e.hint ?? "")), refusals.map(hint).join(" | "));

  // Conclusão: só com registro, atestação, sincronização depois da atestação e evidência completa.
  const early = await err(r.finish(E2));
  await r.call("storage_lifecycle_sync_scan", { p_scan_id: E2, p_objects: [OBJ], p_actor: "teste" });
  const syncFirst = await err(r.finish(E2));
  const attested = await r.attest(E2);
  const afterAttest = await err(r.finish(E2));
  const meetsPending = await r.meets(E2);
  const failed = await r.finish(E2, "failed");
  const again = await r.finish(E2, "succeeded");
  const closed = await err(r.attest(E2, { p_manifest: manifestFor(SOURCES, sha("c")) }));
  const meetsFailed = await r.meets(E2);
  check("25. conclusão recusada antes da atestação e com sincronização ANTERIOR à atestação (scan_run_incomplete); execução encerrada como falha nunca vale (mesmo atestada e sincronizada); repetir devolve o resultado gravado; atestar depois do encerramento → scan_run_closed",
    /scan_run_incomplete/.test(hint(early)) && /scan_run_incomplete/.test(hint(syncFirst)) && attested.status === "attested" && /scan_run_incomplete/.test(hint(afterAttest))
      && meetsPending === false && failed.status === "failed" && again.status === "already_finished" && again.result === "failed"
      && /scan_run_closed/.test(hint(closed)) && meetsFailed === false,
    [hint(early), hint(syncFirst), attested.status, hint(afterAttest), meetsPending, failed.status, again.result, hint(closed), meetsFailed].join(" | "));

  // Fluxo completo e evidência ligada à execução.
  const E3 = "scan-20261005T000000Z";
  await r.scan(E3, "2026-10-05T00:00:00Z", { official: true });
  const row = (await x.db.query(`select a.run_operation_id = l.operation_id as same_run, a.manifest_sha256 = encode(sha256(convert_to(a.manifest::text, 'UTF8')), 'hex') as sha_ok,
      a.sources = (select array_agg(x order by x) from unnest($1::text[]) x) as sources_ok
    from public.storage_lifecycle_scan_attestations a join public.storage_operation_log l on l.idempotency_key = 'scan_run:' || a.scan_id and l.phase = 'intent' where a.scan_id = $2`, [SOURCES, E3])).rows[0];
  const reuse = await err(begin(E3));
  check("26. fluxo oficial completo: atende à política; atestação ligada à execução, com o SHA-256 do manifesto conferido e as fontes tiradas do manifesto; repetir a abertura devolve succeeded",
    (await r.meets(E3)) === true && row.same_run && row.sha_ok && row.sources_ok && reuse === null && (await begin(E3)).status === "succeeded", JSON.stringify(row));

  const chainX = Number((await x.db.query("select count(*)::int n from public.storage_operation_log_verify()")).rows[0].n);
  check("27. cadeia de auditoria íntegra depois das execuções (inclusive com a abertura recuada só nos testes)", chainX === 0, chainX);
  await x.svc.end(); await x.db.end(); await x.adm.end();

  // Rollback recusado com execução registrada (mesmo sem atestação).
  const y = await newDb();
  await y.db.query(read("supabase/migrations/20261119_storage_lifecycle_scan_policy.sql"));
  await api(y.svc, y.backdate).call("storage_lifecycle_begin_scan_run", { p_scan_id: "scan-20261006T000000Z", p_actor: "teste" });
  const rbRun = await err(y.db.query(read("supabase/rollbacks/20261119_storage_lifecycle_scan_policy_rollback.sql")));
  await y.db.query("rollback").catch(() => {});
  check("28. rollback recusado quando já existe execução oficial registrada (não apaga histórico)", rbRun !== null && /Rollback recusado/.test(rbRun.message), rbRun?.message);
  await y.svc.end(); await y.db.end(); await y.adm.end();
}

// ---------- Rollback sem uso: restaura a prova original exatamente ----------
const fresh = await newDb();
const fa = api(fresh.svc, fresh.backdate);
await fa.scan("scan-20260601T000000Z", "2026-06-01T00:00:00Z");
await fa.scan("scan-20260715T000000Z", "2026-07-15T00:00:00Z");
const defBefore = (await fresh.db.query(`select pg_get_functiondef('public.storage_lifecycle_evidence(text,text)'::regprocedure) d`)).rows[0].d;
await fresh.db.query(read("supabase/migrations/20261119_storage_lifecycle_scan_policy.sql"));
const blocked = (await fa.evidence()).eligible;
const rbErr = await err(fresh.db.query(read("supabase/rollbacks/20261119_storage_lifecycle_scan_policy_rollback.sql")));
const defAfter = (await fresh.db.query(`select pg_get_functiondef('public.storage_lifecycle_evidence(text,text)'::regprocedure) d`)).rows[0].d;
const restored = (await fa.evidence()).eligible;
// Mesmo texto, ignorando só o fim de linha (CRLF num checkout Windows, LF no CI e nos arquivos novos).
const sameDef = defBefore.replaceAll(String.fromCharCode(13), "") === defAfter.replaceAll(String.fromCharCode(13), "");
const pre2 = (await fresh.db.query(read("supabase/tests/storage_lifecycle_scan_policy_precheck.sql"))).rows;
check("20. rollback sem uso: aceito; a prova volta EXATAMENTE à definição anterior; pré-verificação aprova de novo",
  blocked === false && rbErr === null && sameDef && restored === true && pre2.every((r) => r.ok), rbErr?.message ?? `${sameDef}`);
const reapply = await err(fresh.db.query(read("supabase/migrations/20261119_storage_lifecycle_scan_policy.sql")));
check("21. reaplicar depois do rollback funciona", reapply === null, reapply?.message);
await fresh.svc.end(); await fresh.db.end();

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} verificações passaram`);
await admin.end();
process.exit(ok === results.length ? 0 : 1);

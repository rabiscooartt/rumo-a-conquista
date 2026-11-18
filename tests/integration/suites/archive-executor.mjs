// Etapa 5.2 — executores de arquivamento e restauração em PostgreSQL 17 LOCAL (postgres não superusuário,
// migrações 20261114/16/17/18) com Storage SIMULADO em memória e falhas injetadas. Nada acessa o Supabase.
import pg from "pg";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const repo = process.env.REPO;
const replica = process.argv[2];
const read = (p) => readFileSync(`${repo}/${p}`, "utf8");
const imp = (p) => import(pathToFileURL(`${repo}/${p}`).href);
const { archiveObject, cancelArchive, deleteArchivedOriginal, ARCHIVE_BUCKET } = await imp("lib/images/lifecycle/archive.ts");
const { planArchive, runArchive, runRestore, resumePending, readOnlyDeps, WriteBlockedError } = await imp("lib/images/lifecycle/archiveRunner.ts");
const base = { host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 55433) };
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ""}`); };
const sha = (b) => createHash("sha256").update(b).digest("hex");

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
  "20261117_storage_lifecycle_pointer_activation", "20261118_storage_lifecycle_reference_sync", "20261119_storage_lifecycle_scan_policy"]) {
  await db.query(read(`supabase/migrations/${m}.sql`));
}
const api = new pg.Client({ ...base, user: "authenticator", database: "rumo" });
await api.connect();
await api.query("set role service_role");
const rpcFaults = [];
const calls = {};
const rpc = async (fn, args) => {
  calls[fn] = (calls[fn] ?? 0) + 1;
  const i = rpcFaults.findIndex((f) => f.fn === fn && f.nth === calls[fn]);
  if (i >= 0) { rpcFaults.splice(i, 1); throw Object.assign(new Error(`falha simulada em ${fn}`), { code: "08006" }); }
  const names = Object.keys(args);
  const values = names.map((n) => (args[n] !== null && typeof args[n] === "object" ? JSON.stringify(args[n]) : args[n]));
  return (await api.query(`select public.${fn}(${names.map((n, j) => `${n} => $${j + 1}`).join(", ")}) as r`, values)).rows[0].r;
};
const COLS = "bucket, object_path, state, archive_state, sha256, size_bytes, mimetype, archive_bucket, archive_path, archive_sha256, restore_metadata, manual_protection, reference_count";
const readObject = async (bucket, path) => (await api.query(`select ${COLS} from public.storage_object_lifecycle where bucket = $1 and object_path = $2`, [bucket, path])).rows[0] ?? null;

// Storage simulado com falhas: before (nada grava), after (grava e a resposta se perde), corrupt (grava outro SHA).
const files = new Map();
const uploadFaults = [];
const uploads = {};
const storage = {
  async download(bucket, path) { const f = files.get(`${bucket}/${path}`); return f ? new Uint8Array(f.bytes) : null; },
  async upload(bucket, path, bytes, options) {
    const key = `${bucket}/${path}`;
    uploads[key] = (uploads[key] ?? 0) + 1;
    const i = uploadFaults.findIndex((f) => key.endsWith(f.suffix));
    const fault = i >= 0 ? uploadFaults.splice(i, 1)[0] : null;
    if (fault?.mode === "before") throw new Error("conexão interrompida durante a cópia");
    if (files.has(key)) return "exists";
    const stored = fault?.mode === "corrupt" ? Buffer.concat([Buffer.from(bytes), Buffer.from("X")]) : Buffer.from(bytes);
    // "lie": conteúdo corrompido, mas metadados como enviados (SHA-256 "certo" só nos metadados).
    const finalBytes = fault?.mode === "lie" ? Buffer.concat([Buffer.from(bytes).subarray(1), Buffer.from("Z")]) : stored;
    files.set(key, { bytes: finalBytes, contentType: options.contentType, metadata: { ...options.metadata, ...(fault?.mode === "corrupt" ? { sha256: sha(stored) } : {}) } });
    if (fault?.mode === "after") throw new Error("resposta perdida depois do upload");
    return "created";
  },
  async info(bucket, path) { const f = files.get(`${bucket}/${path}`); return f ? { size: f.bytes.length, contentType: f.contentType, metadata: f.metadata } : null; },
  async remove(bucket, path) { files.delete(`${bucket}/${path}`); },
};
const steps = [];
const deps = { rpc, storage, readObject, onStep: (s) => steps.push(s) };
const ACTOR = "admin:teste";

// Inventário: superseded elegíveis (x, v, w, t, r, k, m, s), referenced (y), protected (p), observing (z), unverified (u).
const names = ["x", "v", "w", "t", "r", "k", "m", "s", "n", "q", "y", "p", "z", "u"];
const bytes = Object.fromEntries(names.map((n) => [n, Buffer.from(`imagem-${n}-`.repeat(60))]));
const pathOf = (n) => `games/jogo-a/achievements/${n}-antiga.png`;
const KEY = (n) => `achievement-art/${pathOf(n)}`;
for (const n of names) files.set(KEY(n), { bytes: bytes[n], contentType: "image/png", metadata: null });
const stateOf = (n) => ({ y: "referenced", p: "protected", z: "observing", u: "unverified" }[n] ?? "superseded");
const objects = names.map((n) => ({
  bucket: "achievement-art", path: pathOf(n), size: bytes[n].length, mimetype: "image/png", sha256: sha(bytes[n]),
  state: stateOf(n), reference_count: n === "y" ? 1 : 0, ...(n === "p" ? { protected_reason: "lista de proteção" } : {}),
}));
// Varredura registrada e ATESTADA pela política v2 (migração 20261119): só assim vale como prova.
// Execução oficial aberta antes do relatório, atestação com manifesto, sincronização e conclusão
// (tests/integration/support/officialRun.mjs).
const { officialScan, installTimeTravel } = await import(pathToFileURL(`${repo}/tests/integration/support/officialRun.mjs`).href);
const travel = await installTimeTravel({ base, database: "rumo" });
const registerAttested = (payload, scanObjects) => officialScan({ rpc: rpc, backdate: travel.backdate, payload, objects: scanObjects });
for (const [id, at] of [["scan-20260901T000000Z", "2026-09-01T00:00:00Z"], ["scan-20261015T000000Z", "2026-10-15T00:00:00Z"]]) {
  await registerAttested({ scan_id: id, completed_at: at, complete: true, inventory_status: "complete", image_objects: objects.length, image_bytes: objects.reduce((s, o) => s + o.size, 0) }, objects);
}
await rpc("storage_lifecycle_set_manual_protection", { p_idempotency_key: "mp-p", p_bucket: "achievement-art", p_object_path: pathOf("p"), p_protect: true, p_actor: "teste", p_reason: "arte protegida (teste)" });

const counts = async () => (await db.query(`select (select count(*)::int from public.storage_operation_log) log,
  (select count(*)::int from public.storage_lifecycle_pending_operations) pending`)).rows[0];
const chain = async () => Number((await api.query("select count(*) n from public.storage_operation_log_verify()")).rows[0].n);
const inventory = async () => (await api.query(`select ${COLS} from public.storage_object_lifecycle order by object_path`)).rows;
async function plan() {
  const rows = await inventory();
  const evidence = new Map();
  for (const r of rows) evidence.set(`${r.bucket}/${r.object_path}`, await rpc("storage_lifecycle_evidence", { p_bucket: r.bucket, p_object_path: r.object_path }));
  return planArchive(rows, evidence);
}
const pendingArchive = async () => (await db.query(`select operation_id, operation, bucket, object_path from public.storage_lifecycle_pending_operations
  where operation in ('archive_copy', 'archive_cancel', 'delete_object', 'restore_object')`)).rows;
const archived = (n) => files.get(`${ARCHIVE_BUCKET}/${KEY(n)}`);
const copies = (n) => [...files.keys()].filter((k) => k.startsWith(`${ARCHIVE_BUCKET}/`) && k.endsWith(pathOf(n))).length;
const run = (targets, mode = "apply") => plan().then((p) => runArchive({ deps, mode, targets: targets.map(KEY), plan: p, actor: ACTOR, reason: "teste" }));

// E1. Simulação: plano correto e nenhuma escrita (inclusive tentando escrever com as deps de simulação).
{
  const before = { counts: await counts(), files: files.size, uploads: Object.values(uploads).reduce((a, b) => a + b, 0) };
  const p = await plan();
  const eligible = p.filter((e) => e.eligible).map((e) => e.path.split("/").pop()[0]).sort().join("");
  const reasons = Object.fromEntries(p.map((e) => [e.path.split("/").pop()[0], e.reason]));
  const dry = await runArchive({ deps, mode: "dry-run", targets: ["x", "y", "u"].map(KEY), plan: p, actor: ACTOR, reason: "teste" });
  const blocked = await archiveObject({ deps: readOnlyDeps(deps), bucket: "achievement-art", path: pathOf("x"), actor: ACTOR, reason: "t" }).then(() => null, (e) => e);
  const after = { counts: await counts(), files: files.size, uploads: Object.values(uploads).reduce((a, b) => a + b, 0) };
  check("E1. simulação: só superseded com prova elegíveis; y/p/z/u com motivos distintos; nada escrito, escrita direta barrada (WriteBlockedError)",
    eligible === "kmnqrstvwx" && /^referenciado/.test(reasons.y) && reasons.p === "proteção manual" && /^observing/.test(reasons.z) && /^unverified/.test(reasons.u)
      && dry.map((r) => r.status).join() === "seria_arquivado,nao_elegivel,nao_elegivel" && blocked instanceof WriteBlockedError
      && JSON.stringify(before) === JSON.stringify(after), `${eligible} ${dry.map((r) => r.status)} ${blocked?.message}`);
}
// E2. Arquivamento válido + integridade do original + log detalhado.
{
  steps.length = 0;
  const [r] = await run(["x"]);
  const row = await readObject("achievement-art", pathOf("x"));
  const copy = archived("x");
  check("E2. arquivamento válido: cópia com SHA-256, tamanho e MIME conferidos; origem/destino/restauração registrados; original intacto; passos no log",
    r.status === "archived" && copy && sha(copy.bytes) === sha(bytes.x) && copy.contentType === "image/png" && copy.metadata.source === KEY("x")
      && row.archive_state === "archived" && row.archive_bucket === ARCHIVE_BUCKET && row.archive_path === KEY("x") && row.archive_sha256 === sha(bytes.x)
      && row.restore_metadata?.size === bytes.x.length && sha(files.get(KEY("x")).bytes) === sha(bytes.x)
      && steps.map((s) => s.step).join() === "intencao,original_conferido,copia_conferida,concluida", steps.map((s) => s.step).join());
}
// E3. Protegido, referenciado, observing, unverified: o executor não toca; direto no módulo, a guarda do banco recusa.
{
  const before = await counts();
  const viaRunner = await run(["p", "y", "z", "u"]);
  const direct = [];
  for (const n of ["p", "y", "z", "u"]) direct.push(await archiveObject({ deps, bucket: "achievement-art", path: pathOf(n), actor: ACTOR, reason: "t" }).then(() => null, (e) => e?.code));
  check("E3. protegido, referenciado, observing e unverified: executor recusa (não elegível); guarda do banco recusa direto (23514); nenhuma cópia nem pendência",
    viaRunner.every((r) => r.status === "nao_elegivel") && direct.every((c) => c === "23514") && ["p", "y", "z", "u"].every((n) => !archived(n))
      && (await counts()).pending === 0 && (await counts()).log === before.log, `${viaRunner.map((r) => r.status)} ${direct}`);
}
// E4. Falha durante a cópia: pendente; repetir retoma e grava UMA cópia.
{
  uploadFaults.push({ suffix: pathOf("v"), mode: "before" });
  const [first] = await run(["v"]);
  const mid = await counts();
  const [second] = await run(["v"]);
  check("E4. falha durante a cópia: pendente (checkpoint no banco); repetir retoma pela mesma operação e grava uma única cópia",
    first.status === "pendente" && mid.pending === 1 && second.status === "archived" && copies("v") === 1 && (await counts()).pending === 0, `${first.status}/${second.status}`);
}
// E5. Cópia concluída com hash divergente: nunca confirma; fica pendente; original intacto.
{
  uploadFaults.push({ suffix: pathOf("w"), mode: "corrupt" });
  const [r] = await run(["w"]);
  const row = await readObject("achievement-art", pathOf("w"));
  const [again] = await run(["w"]);
  check("E5. cópia com hash divergente: pendente para revisão (sem confirmação), original intacto; repetir continua pendente (destino ocupado por outro conteúdo, nada sobrescrito)",
    r.status === "pendente" && row.archive_state === "archiving" && sha(files.get(KEY("w")).bytes) === sha(bytes.w) && again.status === "pendente"
      && /ocupado por outro conteúdo/.test(again.error) && uploads[`${ARCHIVE_BUCKET}/${KEY("w")}`] === 2, `${r.error?.slice(0, 60)} | ${again.error?.slice(0, 60)}`);
}
// E6. Resposta perdida no upload: repetir reconhece a MESMA cópia e conclui.
{
  uploadFaults.push({ suffix: pathOf("t"), mode: "after" });
  const [first] = await run(["t"]);
  const [second] = await run(["t"]);
  check("E6. resposta perdida (cópia gravada, resposta some): pendente; repetir reconhece a mesma cópia e conclui sem duplicar",
    first.status === "pendente" && second.status === "archived" && copies("t") === 1 && steps.some((s) => s.step === "copia_existente_conferida"), `${first.status}/${second.status}`);
}
// E7. Confirmação perdida: pendente; retomada pelas pendências do banco conclui sem recopiar.
{
  rpcFaults.push({ fn: "storage_lifecycle_finish_operation", nth: (calls.storage_lifecycle_finish_operation ?? 0) + 1 });
  const [first] = await run(["r"]);
  const uploadsBefore = uploads[`${ARCHIVE_BUCKET}/${KEY("r")}`];
  const resumed = await resumePending({ deps, mode: "apply", pending: await pendingArchive(), actor: ACTOR, reason: "retomada" });
  const keep = resumed.filter((x) => x.object !== KEY("w"));
  check("E7. confirmação perdida: pendente; retomada (pendências do banco) conclui; a cópia não é regravada",
    first.status === "pendente" && keep.length === 1 && keep[0].status === "archived" && uploads[`${ARCHIVE_BUCKET}/${KEY("r")}`] === uploadsBefore + 1 && copies("r") === 1,
    `${first.status} ${JSON.stringify(keep)}`);
}
// E8. Retomada após interrupção de um lote: o 1º termina, o 2º para no meio; a retomada conclui o 2º.
{
  uploadFaults.push({ suffix: pathOf("m"), mode: "before" });
  const batch = await run(["k", "m"]);
  const pendingNow = (await pendingArchive()).map((p) => p.object_path);
  const resumed = await resumePending({ deps, mode: "apply", pending: await pendingArchive(), actor: ACTOR, reason: "retomada" });
  check("E8. lote interrompido: k concluído, m pendente; retomada conclui m sem duplicar arquivo nem intenção",
    batch.map((r) => r.status).join() === "archived,pendente" && pendingNow.includes(pathOf("m")) && resumed.find((x) => x.object === KEY("m"))?.status === "archived"
      && copies("m") === 1 && (await db.query(`select count(*)::int n from public.storage_operation_log where operation = 'archive_copy' and phase = 'intent' and object_path = $1`, [pathOf("m")])).rows[0].n === 1,
    `${batch.map((r) => r.status)} ${JSON.stringify(resumed.map((r) => r.status))}`);
}
// E9–E10. Restauração válida (original removido antes, só neste teste) e repetida.
{
  const logBefore = (await db.query(`select count(*)::int n from public.storage_operation_log where object_path = $1`, [pathOf("x")])).rows[0].n;
  await deleteArchivedOriginal({ deps, bucket: "achievement-art", path: pathOf("x"), actor: ACTOR, reason: "teste", allowDelete: true });
  const removed = !files.has(KEY("x"));
  const [r] = await runRestore({ deps, mode: "apply", targets: [KEY("x")], actor: ACTOR, reason: "teste" });
  const row = await readObject("achievement-art", pathOf("x"));
  const back = files.get(KEY("x"));
  const history = (await db.query(`select operation, phase from public.storage_operation_log where object_path = $1 order by id`, [pathOf("x")])).rows.map((h) => `${h.operation}:${h.phase}`);
  check("E9. restauração válida: arquivo de volta com o mesmo SHA-256, tamanho e MIME; estado unverified; histórico preservado (arquivo, remoção, restauração); cópia arquivada mantida",
    removed && r.status === "restored" && sha(back.bytes) === sha(bytes.x) && back.contentType === "image/png" && row.archive_state === "none" && row.state === "unverified"
      && history.length === logBefore + 4 && history.includes("archive_copy:succeeded") && history.includes("delete_object:succeeded") && history.at(-1) === "restore_object:succeeded"
      && archived("x") && sha(archived("x").bytes) === sha(bytes.x), history.join(" "));
  const before = await counts();
  const [again] = await runRestore({ deps, mode: "apply", targets: [KEY("x")], actor: ACTOR, reason: "teste" });
  check("E10. restauração repetida: already_restored, nada novo registrado", again.status === "already_restored" && (await counts()).log === before.log, again.status);
}
// E11. Conflito de destino: outro arquivo ocupa o caminho original → falha registrada, nada sobrescrito.
{
  await deleteArchivedOriginal({ deps, bucket: "achievement-art", path: pathOf("k"), actor: ACTOR, reason: "teste", allowDelete: true });
  const intruder = Buffer.from("outro-arquivo");
  files.set(KEY("k"), { bytes: intruder, contentType: "image/png", metadata: { sha256: sha(intruder) } });
  const [r] = await runRestore({ deps, mode: "apply", targets: [KEY("k")], actor: ACTOR, reason: "teste" });
  const row = await readObject("achievement-art", pathOf("k"));
  check("E11. conflito de destino: falha (destination_conflict) sem sobrescrever; ocupante e cópia arquivada intactos; estado volta a deleted, nada pendente",
    r.status === "falhou" && /ocupado por outro arquivo/.test(r.error) && files.get(KEY("k")).bytes.equals(intruder) && sha(archived("k").bytes) === sha(bytes.k)
      && row.archive_state === "deleted" && !(await pendingArchive()).some((p) => p.object_path === pathOf("k")), `${r.status} ${row.archive_state}`);
  files.delete(KEY("k"));
  const [retry] = await runRestore({ deps, mode: "apply", targets: [KEY("k")], actor: ACTOR, reason: "teste" });
  check("E11b. caminho liberado: nova tentativa (chave seguinte) restaura", retry.status === "restored" && sha(files.get(KEY("k")).bytes) === sha(bytes.k), retry.status);
}
// E12. Restauração com confirmação perdida: retomada reconhece o arquivo já gravado e conclui.
{
  await deleteArchivedOriginal({ deps, bucket: "achievement-art", path: pathOf("v"), actor: ACTOR, reason: "teste", allowDelete: true });
  rpcFaults.push({ fn: "storage_lifecycle_finish_operation", nth: (calls.storage_lifecycle_finish_operation ?? 0) + 1 });
  const [first] = await runRestore({ deps, mode: "apply", targets: [KEY("v")], actor: ACTOR, reason: "teste" });
  const resumed = await resumePending({ deps, mode: "apply", pending: (await pendingArchive()).filter((p) => p.object_path === pathOf("v")), actor: ACTOR, reason: "retomada" });
  const done = (await db.query(`select details from public.storage_operation_log where operation = 'restore_object' and phase = 'succeeded' and object_path = $1`, [pathOf("v")])).rows;
  check("E12. restauração com confirmação perdida: pendente; retomada reconhece o arquivo já restaurado (resumed_existing) e conclui; um único upload",
    first.status === "pendente" && resumed[0]?.status === "restored" && done.length === 1 && done[0].details.resumed_existing === true && uploads[KEY("v")] === 1,
    `${first.status} ${resumed[0]?.status}`);
}
// E13. Cancelar arquivamento: original conferido, estado volta a none, nada removido.
{
  const [r] = await run(["s"]);
  const c = await cancelArchive({ deps, bucket: "achievement-art", path: pathOf("s"), actor: ACTOR, reason: "teste" });
  const row = await readObject("achievement-art", pathOf("s"));
  check("E13. cancelar arquivamento: original íntegro, estado none, cópia e original preservados",
    r.status === "archived" && c.status === "cancelled" && row.archive_state === "none" && sha(files.get(KEY("s")).bytes) === sha(bytes.s) && archived("s"), row.archive_state);
}
// E14. Simulação de restauração e de retomada: só leitura.
{
  const before = { c: await counts(), f: files.size };
  const r = await runRestore({ deps, mode: "dry-run", targets: [KEY("x"), KEY("y")], actor: ACTOR, reason: "t" });
  const rp = await resumePending({ deps, mode: "dry-run", pending: await pendingArchive(), actor: ACTOR, reason: "t" });
  check("E14. simulação de restauração e de retomada: diagnósticos sem nenhuma escrita",
    r.map((x) => x.status).join() === "nao_restauravel (none),nao_restauravel (none)" && rp.every((x) => x.status.startsWith("seria_retomado") || x.status === "pendente")
      && JSON.stringify(before) === JSON.stringify({ c: await counts(), f: files.size }), `${r.map((x) => x.status)} ${rp.map((x) => x.status)}`);
}
// E16. Metadados dizem o SHA-256 certo, mas o conteúdo da cópia é outro: o conteúdo relido barra a confirmação.
{
  uploadFaults.push({ suffix: pathOf("n"), mode: "lie" });
  const [r] = await run(["n"]);
  const row = await readObject("achievement-art", pathOf("n"));
  check("E16. cópia com metadados corretos e conteúdo diferente: pendente (SHA-256 relido do conteúdo), nada confirmado, original intacto",
    r.status === "pendente" && /conteúdo da cópia/.test(r.error) && row.archive_state === "archiving" && sha(files.get(KEY("n")).bytes) === sha(bytes.n), r.error?.slice(0, 90));
}
// E17. Restauração grava conteúdo diferente com metadados corretos: não confirma; fica pendente.
{
  const [a] = await run(["q"]);
  await deleteArchivedOriginal({ deps, bucket: "achievement-art", path: pathOf("q"), actor: ACTOR, reason: "teste", allowDelete: true });
  uploadFaults.push({ suffix: `achievement-art/${pathOf("q")}`, mode: "lie" });
  const [r] = await runRestore({ deps, mode: "apply", targets: [KEY("q")], actor: ACTOR, reason: "teste" });
  const row = await readObject("achievement-art", pathOf("q"));
  check("E17. restauração com conteúdo divergente (metadados corretos): pendente, sem confirmação; cópia arquivada intacta",
    a.status === "archived" && r.status === "pendente" && /não confere/.test(r.error) && row.archive_state === "restoring" && sha(archived("q").bytes) === sha(bytes.q), `${r.status} ${row.archive_state}`);
}
// E18. Remoção do original recusa quando o conteúdo da cópia arquivada não confere (metadados corretos).
{
  await (async () => { await run(["s"]); const k = `${ARCHIVE_BUCKET}/${KEY("s")}`; const f = files.get(k); files.set(k, { ...f, bytes: Buffer.concat([f.bytes, Buffer.from("!")]).subarray(1) }); return k; })();
  const rowBefore = await readObject("achievement-art", pathOf("s"));
  const del = await deleteArchivedOriginal({ deps, bucket: "achievement-art", path: pathOf("s"), actor: ACTOR, reason: "teste", allowDelete: true }).then(() => null, (e) => e.message);
  check("E18. remover original com cópia adulterada (metadados corretos): recusado antes de qualquer mudança; original mantido",
    rowBefore.archive_state === "archived" && /não confere; nada foi removido/.test(del ?? "") && files.has(KEY("s")) && (await readObject("achievement-art", pathOf("s"))).archive_state === "archived", del ?? "sem erro");
}
// E15. Estado final: cadeia íntegra; só a cópia divergente (E5) continua pendente, para revisão.
{
  const pend = await pendingArchive();
  check("E15. cadeia de auditoria íntegra; pendências só nas divergências provocadas (E5, E16, E17), para revisão manual",
    (await chain()) === 0 && pend.map((p) => p.object_path).sort().join() === [pathOf("n"), pathOf("q"), pathOf("w")].sort().join(), `${await chain()} ${pend.map((p) => p.object_path)}`);
}

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} verificações passaram`);
await api.end(); await db.end(); await admin.end();
process.exit(ok === results.length ? 0 : 1);

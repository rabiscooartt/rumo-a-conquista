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
const { archiveObject, cancelArchive, deleteArchivedOriginal, restoreObject, ARCHIVE_BUCKET } = await imp("lib/images/lifecycle/archive.ts");
const { planArchive } = await imp("lib/images/lifecycle/archiveRunner.ts");
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
const archived = (n) => files.get(`${ARCHIVE_BUCKET}/${KEY(n)}`);
const copies = (n) => [...files.keys()].filter((k) => k.startsWith(`${ARCHIVE_BUCKET}/`) && k.endsWith(pathOf(n))).length;

// ---------- Revisão das correções de archive.ts: concorrência, ciclos e limite de tentativas ----------
const intents = async (op, n) => Number((await db.query(`select count(*)::int c from public.storage_operation_log where operation = $1 and phase = 'intent' and object_path = $2`, [op, pathOf(n)])).rows[0].c);
const archiveDirect = (n) => archiveObject({ deps, bucket: "achievement-art", path: pathOf(n), actor: ACTOR, reason: "rev" }).then((r) => r, (e) => e);
const cancel = (n) => cancelArchive({ deps, bucket: "achievement-art", path: pathOf(n), actor: ACTOR, reason: "rev" }).then((r) => r, (e) => e);
const del = (n) => deleteArchivedOriginal({ deps, bucket: "achievement-art", path: pathOf(n), actor: ACTOR, reason: "rev", allowDelete: true }).then((r) => r, (e) => e);
const restore = (n) => restoreObject({ deps, bucket: "achievement-art", path: pathOf(n), actor: ACTOR, reason: "rev" }).then((r) => r, (e) => e);

// R1. Concorrência: duas chamadas simultâneas para o MESMO objeto → uma intenção, uma cópia, ambas sem falso sucesso.
{
  const [a, b] = await Promise.all([archiveDirect("x"), archiveDirect("x")]);
  const row = await readObject("achievement-art", pathOf("x"));
  const ok = (r) => r?.status === "archived" || r?.status === "already_archived" || (r instanceof Error);
  check("R1. concorrência no mesmo objeto: uma única intenção e uma única cópia; estado final archived; nenhuma pendência",
    ok(a) && ok(b) && [a, b].some((r) => r?.status === "archived") && row.archive_state === "archived" && (await intents("archive_copy", "x")) === 1
      && copies("x") === 1 && (await counts()).pending === 0, `${a?.status ?? a?.message} | ${b?.status ?? b?.message}`);
}
// R2. Repetição da mesma operação: já arquivado, nada novo.
{
  const before = await counts();
  const r = await archiveDirect("x");
  check("R2. repetir o arquivamento concluído: already_archived, nenhum registro novo", r.status === "already_archived" && (await counts()).log === before.log, r.status);
}
// R3. Ciclo arquivar → cancelar → arquivar → cancelar: cada etapa usa chave nova e faz o trabalho de verdade.
{
  const steps = [];
  steps.push((await cancel("x")).status);                  // cancela o arquivamento de R1
  steps.push((await archiveDirect("x")).status);           // tentativa 2 (antes da correção: "already_archived" falso)
  const archivedAgain = (await readObject("achievement-art", pathOf("x"))).archive_state;
  steps.push((await cancel("x")).status);                  // cancelamento 2 (antes: "cancelled" falso, estado continuava archived)
  const finalState = (await readObject("achievement-art", pathOf("x"))).archive_state;
  check("R3. arquivar e cancelar repetidamente: cada operação acontece de fato (chaves :1, :2), sem falso 'já arquivado' nem falso 'cancelado'",
    steps.join() === "cancelled,archived,cancelled" && archivedAgain === "archived" && finalState === "none"
      && (await intents("archive_copy", "x")) === 2 && (await intents("archive_cancel", "x")) === 2, `${steps} ${archivedAgain}/${finalState}`);
}
// R4. Remover → restaurar → arquivar → remover → restaurar: idem para delete_object e restore_object.
{
  const s = [];
  s.push((await archiveDirect("v")).status, (await del("v")).status, (await restore("v")).status);
  const refused = await archiveDirect("v");   // restaurado = unverified: a guarda recusa (correto)
  s.push(refused?.code ?? refused?.status);
  // Duas varreduras novas (31 dias) tornam v elegível de novo, como em produção.
  for (const [id, at] of [["scan-20261016T000000Z", "2026-10-16T00:00:00Z"], ["scan-20261116T000000Z", "2026-11-16T00:00:00Z"]]) {
    await registerAttested({ scan_id: id, completed_at: at, complete: true, inventory_status: "complete", image_objects: objects.length, image_bytes: 1 }, objects);
  }
  s.push((await archiveDirect("v")).status, (await del("v")).status);
  const goneAgain = !files.has(KEY("v"));
  s.push((await restore("v")).status);
  const back = files.get(KEY("v"));
  check("R4. segundo ciclo de remoção e restauração acontece de fato (antes da correção: 'already_deleted' / 'already_restored' falsos); conteúdo restaurado íntegro",
    s.join() === "archived,deleted,restored,23514,archived,deleted,restored" && goneAgain && back && sha(back.bytes) === sha(bytes.v)
      && (await intents("delete_object", "v")) === 2 && (await intents("restore_object", "v")) === 2 && (await counts()).pending === 0, s.join());
}
// R5. Limite de cinco tentativas por tipo de operação: a sexta é recusada sem gravar nada.
{
  const s = [];
  for (let i = 0; i < 4; i += 1) { s.push((await archiveDirect("t")).status); s.push((await cancel("t")).status); }
  s.push((await archiveDirect("t")).status);              // 5ª tentativa de archive_copy
  s.push((await cancel("t")).status);                     // 5º cancelamento
  const before = await counts();
  const sixth = await archiveDirect("t");
  check("R5. limite de 5 tentativas: a 6ª é recusada antes de qualquer escrita, com a contagem real (5 com sucesso, 0 com falha)",
    s.filter((x) => x === "archived").length === 5 && sixth instanceof Error && /limite de 5 tentativas/.test(sixth.message)
      && sixth.message.includes("5 concluída(s) com sucesso, 0 encerrada(s) com falha") && !/falhou/.test(sixth.message) && (await counts()).log === before.log
      && (await readObject("achievement-art", pathOf("t"))).archive_state === "none", `${sixth?.message}`);
}
// R6. Falha depois da cópia (resposta perdida) e falha na confirmação, em sequência no mesmo objeto; retomada pela mesma operação.
{
  uploadFaults.push({ suffix: pathOf("r"), mode: "after" });
  const a = await archiveDirect("r");
  rpcFaults.push({ fn: "storage_lifecycle_finish_operation", nth: (calls.storage_lifecycle_finish_operation ?? 0) + 1 });
  const b = await archiveDirect("r");
  const c = await archiveDirect("r");
  check("R6. resposta perdida e depois confirmação perdida: pendente, pendente, concluído; 1 intenção, 1 cópia",
    a.pending === true && b.pending === true && c.status === "archived" && (await intents("archive_copy", "r")) === 1 && copies("r") === 1 && (await counts()).pending === 0,
    `${a.message?.slice(0, 40)} | ${b.message?.slice(0, 40)} | ${c.status}`);
}
// R7. Corrida: a operação de outro processo termina entre a leitura do estado e o begin.
{
  const realRead = deps.readObject;
  // Só a PRIMEIRA leitura está desatualizada (como na corrida real); a releitura da prova vê o estado atual.
  let first = true;
  const racer = { ...deps, readObject: async (b, p) => { const row = await realRead(b, p); if (!first) return row; first = false; return { ...row, archive_state: "none" }; } };
  await archiveDirect("k");                                // o "outro processo" conclui
  const r = await archiveObject({ deps: racer, bucket: "achievement-art", path: pathOf("k"), actor: ACTOR, reason: "rev" }).then((x) => x, (e) => e);
  check("R7. corrida (outro processo concluiu): a guarda recusa (23514), o estado e a cópia relidos comprovam a conclusão → already_archived; nada duplicado",
    r?.status === "already_archived" && (await intents("archive_copy", "k")) === 1 && copies("k") === 1, r?.code ?? r?.status);
}
// R9. 23514 SEM prova de conclusão (objeto unverified, nunca arquivado): o erro da guarda é mantido.
{
  const before = await counts();
  const realRead = deps.readObject;
  const racer = { ...deps, readObject: async (b, p) => ({ ...(await realRead(b, p)), archive_state: "none" }) };
  const r = await archiveObject({ deps: racer, bucket: "achievement-art", path: pathOf("u"), actor: ACTOR, reason: "rev" }).then((x) => x, (e) => e);
  check("R9. guarda recusa sem prova de conclusão (unverified): erro 23514 preservado, nada gravado", r instanceof Error && r.code === "23514" && (await counts()).log === before.log && !archived("u"), r?.code ?? r?.status);
  // R9b. Prova parcial não basta: estado archived mas cópia adulterada → erro preservado.
  const k = `${ARCHIVE_BUCKET}/${KEY("k")}`;
  const original = files.get(k);
  files.set(k, { ...original, bytes: Buffer.concat([original.bytes.subarray(1), Buffer.from("?")]) });
  let firstK = true;
  const stale = { ...deps, readObject: async (b, p) => { const row = await realRead(b, p); if (!firstK) return row; firstK = false; return { ...row, archive_state: "none" }; } };
  const r2 = await archiveObject({ deps: stale, bucket: "achievement-art", path: pathOf("k"), actor: ACTOR, reason: "rev" }).then((x) => x, (e) => e);
  files.set(k, original);
  check("R9b. estado archived com cópia adulterada não prova a conclusão: erro 23514 preservado", r2 instanceof Error && r2.code === "23514", r2?.code ?? r2?.status);
}
// R10. Imagem exibida IMPLICITAMENTE (convenção de nome do painel público) nunca vira candidata nem é arquivada.
{
  const { classifyImages } = await imp("lib/images/lifecycle/classify.ts");
  const { referencesFromConvention, referencesFromVariantMap, referencesFromProtectionList } = await imp("lib/images/lifecycle/references.ts");
  const PATH = "games/jogo-z/achievements/07-arte-implicita.png";
  const KEYC = `achievement-art/${PATH}`;
  const bytesC = Buffer.from("arte-implicita-".repeat(40));
  files.set(KEYC, { bytes: bytesC, contentType: "image/png", metadata: null });
  const inventoryC = { status: "complete", failedPrefixes: [], objects: [{ bucket: "achievement-art", path: PATH, size: bytesC.length, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }] };
  const others = ["achievements", "achievement_progress", "games", "journey_entries", "journey_history_events", "pointers", "drafts"]
    .map((source) => ({ source, status: "complete", references: [] })).concat([referencesFromVariantMap({}), referencesFromProtectionList([])]);
  const history = [{ scanId: "scan-20260801T000000Z", completedAt: "2026-08-01T00:00:00Z", complete: true, unreferenced: [KEYC], present: [KEYC] }];
  // 8 conquistas sem imagem explícita: na ordem/busca certas, "Arte Implícita" aparece na posição 7.
  const achievementsC = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, game_slug: "jogo-z", title: i === 0 ? "Arte Implícita" : `Outra ${i}`, image: "" }));
  const conv = (rows) => referencesFromConvention({ games: [{ slug: "jogo-z" }], achievements: rows, legacyGames: {}, existingObjectKeys: new Set([KEYC]) });
  const without = classifyImages(inventoryC, [...others, conv([])], { now: new Date("2026-09-15T00:00:00Z"), history });
  const withUse = classifyImages(inventoryC, [...others, conv(achievementsC)], { now: new Date("2026-09-15T00:00:00Z"), history });
  const stateC = withUse.objects[0].state;
  // A varredura sincroniza o estado classificado; a guarda do banco recusa arquivar.
  const obj = { bucket: "achievement-art", path: PATH, size: bytesC.length, mimetype: "image/png", sha256: sha(bytesC), state: stateC, reference_count: 1 };
  await registerAttested({ scan_id: "scan-20261117T000000Z", completed_at: "2026-11-17T00:00:00Z", complete: true, inventory_status: "complete", image_objects: objects.length + 1, image_bytes: 1 }, [...objects, obj]);
  const before = await counts();
  const r = await archiveObject({ deps, bucket: "achievement-art", path: PATH, actor: ACTOR, reason: "rev" }).then((x) => x, (e) => e);
  check("R10. imagem exibida por convenção: sem a fonte seria candidata; com ela fica 'referenced', e arquivar é recusado (23514) sem cópia nem registro",
    without.objects[0].state === "candidate" && stateC === "referenced" && r instanceof Error && r.code === "23514"
      && !files.has(`${ARCHIVE_BUCKET}/${KEYC}`) && (await counts()).log === before.log, `${without.objects[0].state}/${stateC}/${r?.code ?? r?.status}`);
}
// R11. Política de varredura: (a) prova sem policy_version (banco sem a política) é recusada pelo
//      plano e pelo executor; (b) uma varredura mais recente NÃO atestada faz o BANCO recusar a prova,
//      mesmo chamando begin_operation direto (sem executor). Nada é gravado.
{
  const before = await counts();
  const real = await rpc("storage_lifecycle_evidence", { p_bucket: "achievement-art", p_object_path: pathOf("m") });
  const legacy = { ...real };
  delete legacy.policy_version;
  const rows = (await inventory()).filter((r) => r.object_path === pathOf("m"));
  const pLegacy = planArchive(rows, new Map([[KEY("m"), legacy]]));
  const legacyDeps = { ...deps, rpc: async (fn, args) => (fn === "storage_lifecycle_evidence" ? legacy : rpc(fn, args)) };
  const rLegacy = await archiveObject({ deps: legacyDeps, bucket: "achievement-art", path: pathOf("m"), actor: ACTOR, reason: "rev" }).then((x) => x, (e) => e);
  check("R11a. prova sem policy_version (banco sem a política): plano e executor recusam, nada gravado",
    real.eligible === true && real.policy_version === 2 && pLegacy[0]?.eligible === false && /política de varredura v2/.test(pLegacy[0]?.reason ?? "")
      && rLegacy instanceof Error && /política de varredura v2/.test(rLegacy.message) && (await counts()).log === before.log,
    `${pLegacy[0]?.reason?.slice(0, 60)} | ${rLegacy?.message?.slice(0, 60)}`);
  // Varredura nova, completa, mas sem atestação (relatório sem a política): passa a ser a mais recente.
  await rpc("storage_lifecycle_register_scan", { p_scan: { scan_id: "scan-20261117T120000Z", completed_at: "2026-11-17T12:00:00Z", complete: true, inventory_status: "complete", image_objects: 1, image_bytes: 1, report_sha256: "b".repeat(64) }, p_actor: "teste" });
  const ev = await rpc("storage_lifecycle_evidence", { p_bucket: "achievement-art", p_object_path: pathOf("m") });
  const logBefore = (await counts()).log;
  const direct = await rpc("storage_lifecycle_begin_operation", { p_idempotency_key: "direto:m", p_operation: "archive_copy", p_bucket: "achievement-art", p_object_path: pathOf("m"), p_actor: ACTOR, p_reason: "sem executor", p_details: {} }).then((x) => x, (e) => e);
  check("R11b. varredura mais recente sem atestação: o banco recusa a prova e begin_operation direto (sem executor) é barrado (23514)",
    ev.eligible === false && /política/.test(ev.reason) && direct instanceof Error && direct.code === "23514" && (await counts()).log === logBefore,
    `${ev.reason} | ${direct?.code}`);
}
check("R8. cadeia de auditoria íntegra e nenhuma pendência ao final", (await chain()) === 0 && (await counts()).pending === 0, String(await chain()));

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} verificações passaram`);
await api.end(); await db.end(); await admin.end();
process.exit(ok === results.length ? 0 : 1);

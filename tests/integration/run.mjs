// Executor dos testes de integração do ciclo de vida das imagens (PostgreSQL 17 + handlers reais).
//
//   npm run test:integration                 # todas as suítes
//   npm run test:integration -- bulk-saves   # só as suítes indicadas
//
// Banco: um PostgreSQL 17 ISOLADO, de uso exclusivo dos testes, com superusuário (padrão
// "supabase_admin") — as suítes criam e apagam papéis e bancos. Duas formas:
//   1. Servidor já em execução (CI: contêiner postgres:17): PGHOST/PGPORT (padrão 127.0.0.1:55433),
//      PG_ADMIN_USER. Entre as suítes, o executor apaga os bancos e papéis criados por elas.
//   2. Binários locais (LIFECYCLE_PG_BIN=<pasta com initdb e pg_ctl>): um cluster novo em pasta
//      temporária para cada suíte, removido no fim.
// Nada aqui acessa o Supabase: cada suíte roda com ambiente limpo (sem credenciais do projeto),
// URL do Supabase em 127.0.0.1 e um vigia de fetch que bloqueia qualquer outro host.
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPortFree } from "./support/server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const replica = join(here, "fixtures", "replica.sql");
const PGHOST = process.env.PGHOST ?? "127.0.0.1";
const PGPORT = process.env.PGPORT ?? "55433";
const ADMIN = process.env.PG_ADMIN_USER ?? "supabase_admin";
const PG_BIN = process.env.LIFECYCLE_PG_BIN ?? "";
// Versão de referência das rotas de salvamento (antes da auditoria em massa), para a comparação de
// efeitos em bulk-saves: as tabelas do site precisam ficar idênticas às da versão anterior.
const BASELINE_COMMIT = process.env.LIFECYCLE_BASELINE_COMMIT ?? "9661ac3";
const BASELINE_ROUTES = [
  "app/api/admin/games/route.ts", "app/api/admin/games/final-mastery/route.ts", "app/api/admin/games/sync/route.ts",
  "app/admin/api/achievements/route.ts", "app/api/youtube/channel/games/sync/route.ts", "app/api/admin/recover-mouse/route.ts",
];

// Cada suíte: arquivo, porta do Supabase simulado (extraPorts: outros servidores simulados dela) e
// argumentos. Faixa 24412 e 24421–24430: fora das portas temporárias do Linux e do Windows
// (support/server.mjs). Cada porta é conferida antes da suíte e depois dela.
const SUITES = [
  { name: "reference-sync-sql", file: "reference-sync-sql.mjs", port: 24421 },
  { name: "scan-policy-sql", file: "scan-policy-sql.mjs", port: 24429 },
  { name: "bulk-saves", file: "bulk-saves.mjs", port: 24422, baseline: true },
  { name: "isolated-plan", file: "isolated-plan.mjs", port: 24423, baseline: true },
  { name: "archive-executor", file: "archive-executor.mjs", port: 24424 },
  { name: "archive-review", file: "archive-review.mjs", port: 24425 },
  { name: "archive-script", file: "archive-script.mjs", port: 24426, extraPorts: [24412] },
  { name: "achievement-art-http", file: "achievement-art-http.mjs", port: 24427 },
  { name: "pointer-http", file: "pointer-http.mjs", port: 24428 },
  { name: "official-scan", file: "official-scan.mjs", port: 24430 },
];

const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const unknown = wanted.filter((w) => !SUITES.some((s) => s.name === w));
if (unknown.length) {
  console.error(`Suítes desconhecidas: ${unknown.join(", ")}. Disponíveis: ${SUITES.map((s) => s.name).join(", ")}`);
  process.exit(2);
}
const selected = wanted.length ? SUITES.filter((s) => wanted.includes(s.name)) : SUITES;

const work = mkdtempSync(join(tmpdir(), "lifecycle-it-"));
let headDir = "";
if (selected.some((s) => s.baseline)) {
  headDir = join(work, "head-routes");
  for (const path of BASELINE_ROUTES) {
    const out = spawnSync("git", ["show", `${BASELINE_COMMIT}:${path}`], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (out.status !== 0) {
      console.error(`Não foi possível ler ${path} em ${BASELINE_COMMIT} (histórico do git completo é necessário: fetch-depth 0).\n${out.stderr}`);
      process.exit(2);
    }
    mkdirSync(dirname(join(headDir, path)), { recursive: true });
    writeFileSync(join(headDir, path), out.stdout);
  }
}

const bin = (name) => join(PG_BIN, process.platform === "win32" ? `${name}.exe` : name);
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });

/** Servidor externo: apaga bancos e papéis criados pelas suítes (estado limpo entre elas). */
async function cleanExternalCluster() {
  const pg = (await import("pg")).default;
  const admin = new pg.Client({ host: PGHOST, port: Number(PGPORT), user: ADMIN, database: "postgres" });
  await admin.connect();
  try {
    const dbs = (await admin.query(`select datname from pg_database where not datistemplate and datname not in ('postgres', $1)`, [ADMIN])).rows;
    for (const { datname } of dbs) await admin.query(`drop database "${datname.replace(/"/g, '""')}" with (force)`);
    for (const role of ["authenticator", "service_role", "authenticated", "anon", "storage_lifecycle_owner", "postgres"]) {
      if (role === ADMIN) continue;
      const exists = (await admin.query("select 1 from pg_roles where rolname = $1", [role])).rowCount > 0;
      if (exists) {
        await admin.query(`drop owned by "${role}"`).catch(() => {});
        await admin.query(`drop role "${role}"`);
      }
    }
  } finally {
    await admin.end();
  }
}

/** Binários locais: cluster novo para a suíte; devolve a função que o desliga e remove. */
function startLocalCluster(suite) {
  const data = join(work, `pg-${suite.name}`);
  const init = run(bin("initdb"), ["-D", data, "-U", ADMIN, "-A", "trust", "-E", "UTF8", "--locale=C"]);
  if (init.status !== 0) throw new Error(`initdb falhou: ${init.stderr}`);
  // stdio "ignore": o servidor herdaria os pipes e o spawnSync nunca terminaria (o log vai para -l).
  const start = run(bin("pg_ctl"), ["-D", data, "-o", `-p ${PGPORT} -c listen_addresses=${PGHOST}`, "-l", join(work, `pg-${suite.name}.log`), "-w", "start"], { stdio: "ignore" });
  if (start.status !== 0) throw new Error(`pg_ctl start falhou (código ${start.status}); veja ${join(work, `pg-${suite.name}.log`)}`);
  return () => {
    // Parada conferida (rápida; se não parar, imediata) e remoção com novas tentativas: no Windows os
    // arquivos ficam presos alguns instantes depois da parada. Falha de limpeza nunca derruba o executor.
    for (const mode of ["fast", "immediate"]) {
      run(bin("pg_ctl"), ["-D", data, "-m", mode, "-w", "-t", "60", "stop"], { stdio: "ignore" });
      if (run(bin("pg_ctl"), ["-D", data, "status"], { stdio: "ignore" }).status !== 0) break;
    }
    if (run(bin("pg_ctl"), ["-D", data, "status"], { stdio: "ignore" }).status === 0) {
      console.log(`  ⚠ o PostgreSQL de ${suite.name} não parou; pasta mantida em ${data}`);
      return;
    }
    try {
      rmSync(data, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
    } catch (error) {
      console.log(`  ⚠ pasta temporária não removida (${error instanceof Error ? error.message : String(error)})`);
    }
  };
}

function cleanEnv(suite) {
  // Só o mínimo para o Node funcionar + configuração falsa e local. Nenhuma credencial real passa.
  const keep = ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "COMSPEC", "PATHEXT"];
  const env = Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
  Object.assign(env, {
    REPO: repo, PGHOST, PGPORT, PG_ADMIN_USER: ADMIN, HOME_TAG: "home-catalog",
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${suite.port}`, SUPABASE_SERVICE_ROLE_KEY: "chave-local-falsa",
    ADMIN_USER: "admin-teste", ADMIN_PASSWORD: "segredo-local-de-teste", ADMIN_SESSION_SECRET: "segredo-de-sessao-somente-teste-0123456789",
    PREP_SQL: join(here, "fixtures", "isolated-test-prep.sql"),
    ...(headDir ? { HEAD_DIR: headDir } : {}),
  });
  if (/supabase\.co/.test(JSON.stringify(env))) throw new Error("ambiente com supabase.co; abortado");
  return env;
}

function runSuite(suite) {
  const args = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--disable-warning=ExperimentalWarning",
    "--import", "./support/register.mjs", `./suites/${suite.file}`, replica];
  return new Promise((resolveSuite) => {
    const child = spawn(process.execPath, args, { cwd: here, env: cleanEnv(suite), stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const onData = (chunk) => {
      const text = chunk.toString();
      tail = (tail + text).slice(-4000);
      for (const line of text.split(/\r?\n/)) if (/^[✔✘]|verificações|aprovado/.test(line)) console.log(`  ${line}`);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (c) => { tail = (tail + c.toString()).slice(-4000); });
    child.on("close", (code) => resolveSuite({ code, tail }));
  });
}

const summary = [];
let failed = 0;
for (const suite of selected) {
  console.log(`\n▶ ${suite.name}`);
  let stop = null;
  try {
    if (PG_BIN) stop = startLocalCluster(suite);
    else await cleanExternalCluster();
    const ports = [suite.port, ...(suite.extraPorts ?? [])];
    for (const port of ports) await assertPortFree(port, { label: `${suite.name} (antes)` });
    const { code, tail } = await runSuite(suite);
    for (const port of ports) {
      await assertPortFree(port, { label: `${suite.name} (depois)` }).catch((error) => {
        throw new Error(`a porta continua ocupada depois da suíte: ${error.message}`);
      });
    }
    if (code !== 0) {
      failed += 1;
      console.log(`  ✘ suíte ${suite.name} terminou com código ${code}\n${tail.split("\n").slice(-25).join("\n")}`);
    }
    summary.push(`${code === 0 ? "✔" : "✘"} ${suite.name} (código de saída ${code})`);
  } catch (error) {
    failed += 1;
    summary.push(`✘ ${suite.name} (${error instanceof Error ? error.message : String(error)})`);
  } finally {
    if (stop) stop();
  }
}
if (!PG_BIN) await cleanExternalCluster().catch(() => {});
try {
  rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
} catch {
  console.log(`⚠ pasta temporária ${work} não removida`);
}
console.log(`\n${summary.join("\n")}\n${selected.length - failed}/${selected.length} suítes aprovadas`);
process.exit(failed === 0 ? 0 : 1);

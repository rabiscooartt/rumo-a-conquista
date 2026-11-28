// Configuração do agente e limite de segurança contra credenciais privilegiadas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, DEFAULT_SITE_URL, loadConfig } from "../../agent/src/config.ts";
import { redact } from "../../agent/src/logger.ts";

function tempDir(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "agent-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const fakeJwt = (role: string) =>
  ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", Buffer.from(JSON.stringify({ role })).toString("base64url"), "assinatura"].join(".");

test("cria config.json padrão na primeira execução", (t) => {
  const dir = tempDir(t);
  const config = loadConfig({ dataDir: dir, env: {} });
  assert.ok(existsSync(join(dir, "config.json")));
  assert.equal(config.site.url, DEFAULT_SITE_URL);
  assert.equal(config.control.host, "127.0.0.1");
  assert.equal(config.dbPath, join(dir, "agent.db"));
});

test("variáveis de ambiente têm prioridade sobre o arquivo", (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, "config.json"), JSON.stringify({ controlPort: 5000, obsEnabled: true }));
  const config = loadConfig({ dataDir: dir, env: { RUMO_AGENT_CONTROL_PORT: "6000", RUMO_AGENT_OBS_ENABLED: "false" } });
  assert.equal(config.control.port, 6000);
  assert.equal(config.obs.enabled, false);
});

test("recusa service-role do Supabase no arquivo ou no ambiente", (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, "config.json"), JSON.stringify({ extra: fakeJwt("service_role") }));
  assert.throws(() => loadConfig({ dataDir: dir, env: {} }), ConfigError);

  writeFileSync(join(dir, "config.json"), JSON.stringify({ supabaseServiceRoleKey: "qualquer" }));
  assert.throws(() => loadConfig({ dataDir: dir, env: {} }), /credencial privilegiada/);

  writeFileSync(join(dir, "config.json"), "{}");
  assert.throws(() => loadConfig({ dataDir: dir, env: { RUMO_AGENT_SITE_TOKEN: "sb_secret_abc" } }), ConfigError);
  // Chave anon (pública) não é bloqueada.
  assert.doesNotThrow(() => loadConfig({ dataDir: dir, env: { RUMO_AGENT_X: fakeJwt("anon") } }));
});

test("valida URLs, porta e nível de log", (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, "config.json"), JSON.stringify({ siteUrl: "http://exemplo.com", obsUrl: "http://x", controlPort: 70000, logLevel: "alto" }));
  try {
    loadConfig({ dataDir: dir, env: {} });
    assert.fail("deveria falhar");
  } catch (error) {
    assert.ok(error instanceof ConfigError);
    assert.equal(error.problems.length, 4);
  }
  writeFileSync(join(dir, "config.json"), JSON.stringify({ siteUrl: "http://localhost:3000" }));
  assert.equal(loadConfig({ dataDir: dir, env: {} }).site.url, "http://localhost:3000");
});

test("logs ocultam segredos e serializam erros", () => {
  const out = redact({ obsPassword: "123", nested: { token: "abc", ok: 1 }, error: new Error("falhou") }) as { obsPassword: string; nested: { token: string; ok: number }; error: { message: string } };
  assert.equal(out.obsPassword, "[oculto]");
  assert.equal(out.nested.token, "[oculto]");
  assert.equal(out.nested.ok, 1);
  assert.equal(out.error.message, "falhou");
});

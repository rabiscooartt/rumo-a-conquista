// Supervisor do agente: roda o agente atual (sem mudanças) como processo separado, usando o
// próprio executável do Electron como Node (ELECTRON_RUN_AS_NODE). Se já houver um agente em
// execução (iniciado pelo CLI, por exemplo), apenas se conecta a ele, sem assumir o controle.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class AgentSupervisor {
  /**
   * @param {{ agentDir: string, dataDir: string, nodeExecutable: string, log?: (msg: string) => void,
   *           onChange?: () => void, restartDelaysMs?: number[] }} options
   */
  constructor(options) {
    this.agentDir = options.agentDir;
    this.dataDir = options.dataDir;
    this.nodeExecutable = options.nodeExecutable;
    this.log = options.log ?? (() => {});
    this.onChange = options.onChange ?? (() => {});
    this.restartDelaysMs = options.restartDelaysMs ?? [1_000, 2_000, 5_000, 10_000, 30_000];
    /** "stopped" | "starting" | "running" | "attached" | "crashed" */
    this.state = "stopped";
    this.child = null;
    this.owned = false;
    this.quitting = false;
    this.failures = 0;
    this.lastOutput = [];
  }

  /** Trava do agente: { pid, controlPort } se o processo dela estiver vivo. */
  liveLock() {
    const path = join(this.dataDir, "agent.lock");
    if (!existsSync(path)) return null;
    try {
      const lock = JSON.parse(readFileSync(path, "utf8"));
      if (!lock?.pid) return null;
      process.kill(lock.pid, 0); // lança se o processo não existe
      return lock;
    } catch {
      return null;
    }
  }

  token() {
    try {
      return readFileSync(join(this.dataDir, "control-token"), "utf8").trim();
    } catch {
      return "";
    }
  }

  baseUrl() {
    const lock = this.liveLock();
    return lock?.controlPort ? `http://127.0.0.1:${lock.controlPort}` : null;
  }

  async request(method, path, body) {
    const base = this.baseUrl();
    if (!base) throw new Error("Agente fora do ar");
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", "x-agent-token": this.token() },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
    return json;
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.onChange();
  }

  /** Garante um agente: conecta ao existente ou inicia um próprio. */
  async ensure() {
    this.quitting = false;
    if (this.liveLock()) {
      this.owned = false;
      this.setState("attached");
      this.log("Agente já em execução: conectado sem assumir o controle");
      return;
    }
    this.spawn();
  }

  spawn() {
    if (this.child) return;
    this.owned = true;
    this.setState("starting");
    const entry = join(this.agentDir, "src", "main.ts");
    const child = spawn(this.nodeExecutable, [entry, "start"], {
      cwd: this.agentDir,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", RUMO_AGENT_DATA_DIR: this.dataDir },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    const keep = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
        this.lastOutput.push(line);
        if (this.lastOutput.length > 40) this.lastOutput.shift();
      }
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("exit", (code) => {
      this.child = null;
      this.log(`Agente encerrou (código ${code})`);
      if (this.quitting) return this.setState("stopped");
      // Outro agente assumiu a trava (ex.: iniciado pelo CLI): passa a só se conectar.
      if (this.liveLock()) {
        this.owned = false;
        return this.setState("attached");
      }
      this.failures += 1;
      this.setState("crashed");
      const delay = this.restartDelaysMs[Math.min(this.failures - 1, this.restartDelaysMs.length - 1)];
      this.log(`Reiniciando o agente em ${delay} ms`);
      setTimeout(() => !this.quitting && this.spawn(), delay).unref?.();
    });
    void this.waitReady();
  }

  async waitReady(timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && this.child) {
      if (this.liveLock() && this.baseUrl()) {
        try {
          await this.request("GET", "/status");
          this.failures = 0;
          this.setState("running");
          return true;
        } catch {
          // ainda subindo
        }
      }
      await sleep(250);
    }
    return false;
  }

  /** Para o agente se foi este aplicativo que o iniciou (ou se force=true). */
  async stop({ force = false } = {}) {
    this.quitting = true;
    if (!this.owned && !force) return this.setState("stopped");
    if (!this.liveLock()) return this.setState("stopped");
    try {
      await this.request("POST", "/shutdown");
    } catch (error) {
      this.log(`Pedido de encerramento falhou: ${error.message}`);
    }
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && this.liveLock()) await sleep(250);
    if (this.child && this.liveLock()) this.child.kill();
    this.setState("stopped");
  }

  /** Reinicia (ex.: depois de mudar a configuração). Assume o controle se estava só conectado. */
  async restart() {
    await this.stop({ force: true });
    this.quitting = false;
    this.failures = 0;
    this.spawn();
    return this.waitReady();
  }
}

import { execFile } from "node:child_process";

export type ProcessInfo = { name: string; pid: number };

/** Sinais do sistema usados na identificação. A implementação real usa ferramentas nativas do Windows. */
export interface SystemSignals {
  listProcesses(): Promise<ProcessInfo[]>;
  /** AppID do jogo Steam em execução; 0 = nenhum; null = Steam ausente/ilegível. */
  steamRunningAppId(): Promise<number | null>;
  steamPath(): Promise<string | null>;
  windowTitle(pid: number): Promise<string | null>;
}

function run(file: string, args: string[], timeoutMs = 8_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout));
    });
  });
}

export function parseTasklistCsv(text: string): ProcessInfo[] {
  const out: ProcessInfo[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^"([^"]+)","(\d+)"/.exec(line.trim());
    if (match) out.push({ name: match[1], pid: Number(match[2]) });
  }
  return out;
}

/** Lê um valor de `reg query`. REG_DWORD vem em hexadecimal (0x...). */
export function parseRegValue(text: string, name: string): string | null {
  const match = new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.*)$`, "im").exec(text);
  return match ? match[1].trim() : null;
}

const STEAM_KEY = "HKCU\\Software\\Valve\\Steam";

export function windowsSignals(): SystemSignals {
  return {
    async listProcesses() {
      return parseTasklistCsv(await run("tasklist", ["/fo", "csv", "/nh"]));
    },
    async steamRunningAppId() {
      try {
        const value = parseRegValue(await run("reg", ["query", STEAM_KEY, "/v", "RunningAppID"], 4_000), "RunningAppID");
        if (value === null) return null;
        const id = value.startsWith("0x") ? Number.parseInt(value, 16) : Number(value);
        return Number.isFinite(id) ? id : null;
      } catch {
        return null;
      }
    },
    async steamPath() {
      try {
        return parseRegValue(await run("reg", ["query", STEAM_KEY, "/v", "SteamPath"], 4_000), "SteamPath");
      } catch {
        return null;
      }
    },
    async windowTitle(pid: number) {
      try {
        const script =
          "[Console]::OutputEncoding=[Text.Encoding]::UTF8;" +
          `(Get-Process -Id ${Math.trunc(pid)} -ErrorAction SilentlyContinue).MainWindowTitle`;
        const title = (await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], 8_000)).trim();
        return title || null;
      } catch {
        return null;
      }
    },
  };
}

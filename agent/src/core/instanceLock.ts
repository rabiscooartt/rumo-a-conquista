import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from "node:fs";

export type LockInfo = {
  pid: number;
  version: string;
  startedAt: number;
  controlPort: number | null;
};

export class AlreadyRunningError extends Error {
  readonly info: LockInfo;
  constructor(info: LockInfo) {
    super(`O agente já está em execução (PID ${info.pid}, porta ${info.controlPort ?? "?"})`);
    this.name = "AlreadyRunningError";
    this.info = info;
  }
}

export function isProcessAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function readLock(path: string): LockInfo | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LockInfo;
  } catch {
    return null;
  }
}

/** Retorna o lock somente se o processo dono ainda estiver vivo. */
export function readLiveLock(path: string): LockInfo | null {
  const info = readLock(path);
  return info && isProcessAlive(info.pid) ? info : null;
}

/** Garante uma única instância do agente por pasta de dados (lock com PID; lock órfão é recuperado). */
export class InstanceLock {
  private readonly path: string;
  private info: LockInfo | null = null;

  constructor(path: string) {
    this.path = path;
  }

  acquire(info: LockInfo): { staleRecovered: boolean } {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const fd = openSync(this.path, "wx");
        writeSync(fd, JSON.stringify(info));
        closeSync(fd);
        this.info = info;
        return { staleRecovered: attempt > 0 };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const current = readLock(this.path);
        // Lock de processo vivo (inclusive outra instância neste mesmo processo) bloqueia; só lock órfão é removido.
        if (current && isProcessAlive(current.pid)) throw new AlreadyRunningError(current);
        unlinkSync(this.path);
      }
    }
    throw new Error(`Não foi possível obter o lock ${this.path}`);
  }

  update(patch: Partial<LockInfo>) {
    if (!this.info) return;
    this.info = { ...this.info, ...patch };
    writeFileSync(this.path, JSON.stringify(this.info));
  }

  release() {
    if (!this.info) return;
    const current = readLock(this.path);
    if (current?.pid === this.info.pid) unlinkSync(this.path);
    this.info = null;
  }
}

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type SteamAppInfo = { appId: number; name: string; installdir: string | null };

/** Extrai pares "chave" "valor" de arquivos VDF/ACF da Steam (suficiente para os campos usados). */
export function vdfValues(text: string, key: string): string[] {
  const out: string[] = [];
  const pattern = new RegExp(`"${key}"\\s+"((?:[^"\\\\]|\\\\.)*)"`, "gi");
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) out.push(match[1].replace(/\\\\/g, "\\"));
  return out;
}

/**
 * Nome dos jogos Steam a partir dos manifestos locais (steamapps/appmanifest_<id>.acf),
 * em todas as bibliotecas de libraryfolders.vdf. Sem rede.
 */
export class SteamLibrary {
  private readonly steamPath: string;
  private libraries: string[] | null = null;
  private readonly cache = new Map<number, SteamAppInfo | null>();

  constructor(steamPath: string) {
    this.steamPath = steamPath;
  }

  libraryPaths(): string[] {
    if (this.libraries) return this.libraries;
    // O registro traz "c:/steam" e o VDF traz "C:\\Steam": no Windows são a mesma pasta.
    const paths = new Map<string, string>();
    const add = (path: string) => {
      const resolved = resolve(path);
      const key = resolved.toLowerCase();
      if (!paths.has(key)) paths.set(key, resolved);
    };
    add(this.steamPath);
    const vdf = join(this.steamPath, "steamapps", "libraryfolders.vdf");
    if (existsSync(vdf)) for (const path of vdfValues(readFileSync(vdf, "utf8"), "path")) add(path);
    this.libraries = [...paths.values()];
    return this.libraries;
  }

  appInfo(appId: number): SteamAppInfo | null {
    if (this.cache.has(appId)) return this.cache.get(appId)!;
    let info: SteamAppInfo | null = null;
    for (const library of this.libraryPaths()) {
      const manifest = join(library, "steamapps", `appmanifest_${appId}.acf`);
      if (!existsSync(manifest)) continue;
      const text = readFileSync(manifest, "utf8");
      const name = vdfValues(text, "name")[0];
      if (name) {
        info = { appId, name, installdir: vdfValues(text, "installdir")[0] ?? null };
        break;
      }
    }
    // Só guarda acertos: um jogo instalado depois do início do agente ainda pode ser encontrado.
    if (info) this.cache.set(appId, info);
    return info;
  }
}

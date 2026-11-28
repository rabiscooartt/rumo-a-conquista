import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { kvNumber, kvObject, kvString, parseBinaryKeyValues, type KvObject } from "../keyvalues.ts";
import { ProviderUnavailableError, type AchievementProvider, type ProviderAchievement, type ProviderSnapshot } from "./types.ts";

/*
 * Provedor "steam-local": lê o cache de estatísticas que o próprio cliente Steam mantém no disco
 * (Steam/appcache/stats). Fonte legítima e local, sem rede, sem credenciais e sem interagir com o
 * jogo ou com proteções. Dois arquivos por jogo:
 *   UserGameStatsSchema_<appid>.bin          definição: stat → bits → apiname, nome, descrição
 *   UserGameStats_<accountid>_<appid>.bin    estado do usuário: stat → data (bitmask) + AchievementTimes
 * O horário do desbloqueio vem da própria Steam (AchievementTimes, em segundos Unix).
 *
 * Limitação: a Steam decide quando grava esse cache; o desbloqueio aparece quando o arquivo é
 * atualizado (o observador relê ao longo da sessão e ao fim dela).
 */
const LANGUAGE_PREFERENCE = ["brazilian", "portuguese", "english"];

function localized(display: KvObject | null, field: string) {
  const entry = kvObject(display?.[field]);
  if (!entry) return null;
  for (const language of LANGUAGE_PREFERENCE) {
    const value = kvString(entry[language]);
    if (value) return value;
  }
  return null;
}

export class SteamLocalProvider implements AchievementProvider {
  readonly id = "steam-local";
  readonly siteProvider = "steam" as const;
  private readonly steamPath: () => string | null;

  constructor(steamPath: () => string | null) {
    this.steamPath = steamPath;
  }

  private statsDir() {
    const steam = this.steamPath();
    return steam ? join(steam, "appcache", "stats") : null;
  }

  sourceKeyFor(detectionKey: string) {
    return /^steam:\d+$/.test(detectionKey) ? detectionKey : null;
  }

  private files(sourceKey: string) {
    const dir = this.statsDir();
    const appId = sourceKey.slice("steam:".length);
    if (!dir || !existsSync(dir)) return null;
    const schema = join(dir, `UserGameStatsSchema_${appId}.bin`);
    // Pode haver mais de uma conta Steam no computador: vale o arquivo atualizado mais recentemente.
    const pattern = new RegExp(`^UserGameStats_(\\d+)_${appId}\\.bin$`);
    const userFiles = readdirSync(dir)
      .filter((name) => pattern.test(name))
      .map((name) => {
        const path = join(dir, name);
        return { path, accountId: pattern.exec(name)![1], mtimeMs: statSync(path).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return { appId, schema: existsSync(schema) ? schema : null, user: userFiles[0] ?? null };
  }

  async fingerprint(sourceKey: string) {
    const files = this.files(sourceKey);
    if (!files?.schema) return null;
    const schema = statSync(files.schema);
    const user = files.user ? statSync(files.user.path) : null;
    return `${schema.mtimeMs}:${schema.size}|${user ? `${files.user!.accountId}:${user.mtimeMs}:${user.size}` : "-"}`;
  }

  async read(sourceKey: string): Promise<ProviderSnapshot | null> {
    if (!this.sourceKeyFor(sourceKey)) return null;
    const dir = this.statsDir();
    if (!dir) throw new ProviderUnavailableError("pasta da Steam não encontrada");
    const files = this.files(sourceKey);
    if (!files?.schema) return null; // jogo sem conquistas (ou nunca aberto neste computador)

    let schemaRoot: KvObject;
    let userRoot: KvObject | null = null;
    try {
      schemaRoot = parseBinaryKeyValues(readFileSync(files.schema));
      if (files.user) userRoot = parseBinaryKeyValues(readFileSync(files.user.path));
    } catch (error) {
      // Arquivo sendo regravado pela Steam ou em formato inesperado: tenta de novo depois.
      throw new ProviderUnavailableError(`cache da Steam ilegível: ${(error as Error).message}`);
    }

    const stats = kvObject(kvObject(schemaRoot[files.appId])?.stats) ?? {};
    const userStats = kvObject(userRoot?.cache) ?? {};
    const achievements: ProviderAchievement[] = [];
    for (const [statId, statValue] of Object.entries(stats)) {
      const bits = kvObject(kvObject(statValue)?.bits);
      if (!bits) continue;
      const user = kvObject(userStats[statId]);
      const data = (kvNumber(user?.data) ?? 0) >>> 0;
      const times = kvObject(user?.AchievementTimes) ?? {};
      for (const [bit, bitValue] of Object.entries(bits)) {
        const definition = kvObject(bitValue);
        const externalId = kvString(definition?.name);
        const bitIndex = Number(bit);
        if (!externalId || !Number.isInteger(bitIndex) || bitIndex < 0 || bitIndex > 31) continue;
        const unlocked = ((data >>> bitIndex) & 1) === 1;
        const seconds = kvNumber(times[bit]);
        const display = kvObject(definition?.display);
        achievements.push({
          externalId,
          name: localized(display, "name"),
          description: localized(display, "desc"),
          unlocked,
          unlockedAt: unlocked && seconds && seconds > 0 ? seconds * 1000 : null,
          evidence: { statId, bit: bitIndex },
        });
      }
    }
    return {
      sourceKey,
      achievements,
      evidence: {
        schemaFile: files.schema,
        userFile: files.user?.path ?? null,
        userFileModifiedAt: files.user ? new Date(files.user.mtimeMs).toISOString() : null,
      },
    };
  }
}

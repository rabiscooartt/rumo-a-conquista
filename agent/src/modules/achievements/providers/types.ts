/*
 * Contrato dos provedores de conquistas. Cada provedor sabe ler o estado de conquistas de
 * uma "fonte" (ex.: steam:<appid>) e devolve o estado atual; o observador compara com o último
 * estado gravado e só então gera eventos. Provedores não enviam nada ao site.
 *
 * Provedores futuros (RetroAchievements, emuladores, arquivos locais de jogos externos) entram
 * implementando esta interface; nada mais no fluxo muda.
 */
export type ProviderAchievement = {
  /** Identificador estável na fonte (ex.: apiname da Steam). Nunca o nome exibido. */
  externalId: string;
  name: string | null;
  description: string | null;
  unlocked: boolean;
  /** Momento do desbloqueio informado pela própria fonte (ms). null = a fonte não informa. */
  unlockedAt: number | null;
  /** Onde, na fonte, está a prova do desbloqueio. */
  evidence?: Record<string, unknown>;
};

export type ProviderSnapshot = {
  sourceKey: string;
  achievements: ProviderAchievement[];
  evidence: Record<string, unknown>;
};

export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export interface AchievementProvider {
  /** Identificador do provedor no agente (ex.: "steam-local"). */
  readonly id: string;
  /** Como o site vincula as conquistas desta fonte (achievements.source). */
  readonly siteProvider: "steam" | "site";
  /** Fonte correspondente a uma detecção de jogo (ex.: "steam:440"), ou null se não se aplica. */
  sourceKeyFor(detectionKey: string): string | null;
  /** Marca barata de mudança (ex.: data/tamanho do arquivo) para evitar releituras inúteis. */
  fingerprint(sourceKey: string): Promise<string | null>;
  /** Estado atual da fonte; null quando a fonte não tem dados de conquistas. */
  read(sourceKey: string): Promise<ProviderSnapshot | null>;
}

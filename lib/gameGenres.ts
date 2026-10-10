/**
 * Centraliza a taxonomia e a escolha de um único gênero predominante.
 * A prioridade representa o quanto o gênero costuma definir o ciclo principal
 * de jogo; rótulos amplos como "Indie" ficam abaixo de gêneros de gameplay.
 */
export const GAME_GENRES = [
  "Ação",
  "Aventura",
  "RPG",
  "Terror",
  "Tiro",
  "Luta",
  "Estratégia",
  "Puzzle",
  "Plataforma",
  "Corrida",
  "Simulação",
  "Esportes",
  "Arcade",
  "Casual",
  "Música",
  "Indie",
] as const;

export type GameGenre = (typeof GAME_GENRES)[number];

function normalizeGenre(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const CANONICAL_GENRES: Record<string, GameGenre> = {
  action: "Ação",
  acao: "Ação",
  adventure: "Aventura",
  aventura: "Aventura",
  rpg: "RPG",
  "role playing rpg": "RPG",
  horror: "Terror",
  terror: "Terror",
  "survival horror": "Terror",
  shooter: "Tiro",
  "first person shooter": "Tiro",
  "third person shooter": "Tiro",
  tiro: "Tiro",
  fighting: "Luta",
  luta: "Luta",
  strategy: "Estratégia",
  estrategia: "Estratégia",
  puzzle: "Puzzle",
  platform: "Plataforma",
  platformer: "Plataforma",
  plataforma: "Plataforma",
  racing: "Corrida",
  corrida: "Corrida",
  simulation: "Simulação",
  simulacao: "Simulação",
  sports: "Esportes",
  esportes: "Esportes",
  arcade: "Arcade",
  casual: "Casual",
  music: "Música",
  musica: "Música",
  indie: "Indie",
};

const GENRE_PRIORITY: Record<GameGenre, number> = {
  Terror: 100,
  RPG: 95,
  Estratégia: 90,
  Simulação: 88,
  Corrida: 87,
  Esportes: 86,
  Luta: 85,
  Tiro: 84,
  Plataforma: 82,
  Puzzle: 81,
  "Ação": 80,
  Aventura: 75,
  Música: 70,
  Arcade: 68,
  Casual: 65,
  Indie: 10,
};

/** Retorna exatamente um gênero, inclusive quando a fonte informa vários. */
export function inferPrimaryGenre(values: unknown): string {
  if (!Array.isArray(values)) return "";

  const genres = values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!genres.length) return "";

  const normalized = genres.map((genre, index) => {
    const canonical = CANONICAL_GENRES[normalizeGenre(genre)];
    return {
      original: genre,
      canonical,
      index,
      // A posição na fonte é a principal pista de predominância; a prioridade
      // resolve empates aproximados e rebaixa rótulos amplos como "Indie".
      priority:
        (canonical ? GENRE_PRIORITY[canonical] : -100) +
        (genres.length - 1 - index) * 20,
    };
  });

  normalized.sort((a, b) => b.priority - a.priority || a.index - b.index);
  return normalized[0].canonical || normalized[0].original;
}

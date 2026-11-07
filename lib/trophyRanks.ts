// Classificação única dos troféus, usada pela página do jogo e pela Biblioteca.
// Bronze, Prata e Ouro vêm do rank de cada conquista. "Diamante"/"Extrema" (ou 💎) é o nome
// legado da recompensa final e por isso conta como Maestria, nunca como Ouro.

export type TrophyRank = "Ouro" | "Prata" | "Bronze" | "Maestria";

export type TrophyRankInput = {
  difficulty?: string;
  trophy?: string;
  icon?: string;
};

function normalizeText(value?: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function getTrophyRank(achievement: TrophyRankInput): TrophyRank {
  const difficulty = normalizeText(achievement.difficulty);

  // Diamante representa a Maestria Final e não deve entrar na contagem
  // de Ouro. Assim, a sidebar separa corretamente Ouro de Maestria.
  if (difficulty === "extrema" || difficulty === "diamante") return "Maestria";
  if (difficulty === "ouro") return "Ouro";
  if (difficulty === "media" || difficulty === "prata") return "Prata";

  if (achievement.trophy?.includes("💎") || achievement.icon?.includes("💎")) {
    return "Maestria";
  }
  if (achievement.trophy?.includes("🥇") || achievement.trophy?.includes("🏆") || achievement.icon?.includes("🥇") || achievement.icon?.includes("🏆")) {
    return "Ouro";
  }
  if (achievement.trophy?.includes("🥈") || achievement.icon?.includes("🥈")) return "Prata";

  return "Bronze";
}

export const TROPHY_META: Array<{ rank: TrophyRank; label: string; icon: string }> = [
  { rank: "Bronze", label: "Bronze", icon: "/images/trophies/bronze.png" },
  { rank: "Prata", label: "Prata", icon: "/images/trophies/prata.png" },
  { rank: "Ouro", label: "Ouro", icon: "/images/trophies/ouro.png" },
  { rank: "Maestria", label: "Maestria Final", icon: "/images/trophies/maestria.png" },
];

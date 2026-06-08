export type SagaAccent = "red" | "cyan" | "yellow" | "purple" | "emerald";

export type SagaStage = {
  title: string;
  description?: string;
  gameSlugs: string[];
};

export type Saga = {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  coverImage: string;
  badgeImage: string;
  fallbackIcon: string;
  accent: SagaAccent;
  stages: SagaStage[];
};

export const sagas: Record<string, Saga> = {
  "monster-hunter": {
    slug: "monster-hunter",
    title: "Monster Hunter",
    subtitle: "Caçadas, monstros e maestria",
    description:
      "Saga focada em caçadas, evolução de equipamento, domínio de monstros e jornadas longas rumo à maestria.",
    coverImage: "/images/sagas/monster-hunter/cover.jpg",
    badgeImage: "/images/sagas/monster-hunter/badge.jpg",
    fallbackIcon: "🐉",
    accent: "cyan",
    stages: [
      {
        title: "Etapa 1",
        description: "Primeira jornada da saga dentro do projeto.",
        gameSlugs: ["monster-hunter"],
      },
    ],
  },

  "resident-evil": {
    slug: "resident-evil",
    title: "Resident Evil",
    subtitle: "Survival horror e desafios",
    description:
      "Saga focada em campanhas, rankings, desafios extras, colecionáveis e domínio dos jogos de survival horror.",
    coverImage: "/images/sagas/resident-evil/cover.jpg",
    badgeImage: "/images/sagas/resident-evil/badge.jpg",
    fallbackIcon: "🧟",
    accent: "red",
    stages: [
      {
        title: "Etapa 1",
        description: "Primeira jornada da saga Resident Evil no projeto.",
        gameSlugs: ["resident-evil-4"],
      },
    ],
  },

  souls: {
    slug: "souls",
    title: "Souls",
    subtitle: "Bosses, builds e superação",
    description:
      "Saga dedicada aos jogos Souls e semelhantes, com foco em exploração, bosses opcionais, builds e conclusão de desafios.",
    coverImage: "/images/sagas/souls/cover.jpg",
    badgeImage: "/images/sagas/souls/badge.jpg",
    fallbackIcon: "🔥",
    accent: "yellow",
    stages: [
      {
        title: "Etapa 1",
        description: "Primeiro jogo da fila Souls dentro do projeto.",
        gameSlugs: ["dark-souls-3"],
      },
    ],
  },

  "wizarding-world": {
    slug: "wizarding-world",
    title: "Wizarding World",
    subtitle: "Magia, exploração e colecionáveis",
    description:
      "Saga voltada para jogos do universo mágico, com foco em exploração, colecionáveis e conclusão completa da jornada.",
    coverImage: "/images/sagas/wizarding-world/cover.jpg",
    badgeImage: "/images/sagas/wizarding-world/badge.jpg",
    fallbackIcon: "💎",
    accent: "purple",
    stages: [
      {
        title: "Etapa 1",
        description: "Primeira maestria concluída no universo mágico.",
        gameSlugs: ["hogwarts-legacy"],
      },
    ],
  },
};

export const sagasList = Object.values(sagas);
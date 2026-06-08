export type AchievementStatus = "completed" | "progress" | "locked";

export type Achievement = {
  id?: string;
  icon: string;
  title: string;
  description: string;
  trophy: string;
  difficulty?: string;
  rank?: string;
  earnedDate?: string;
  status: AchievementStatus | string;
  image?: string;
  isCustom?: boolean;
  isHidden?: boolean;
};

export type Review = {
  status: string;
  nota: string;
  titulo?: string;
  resumo: string;
  texto?: string;
  melhorMomento: string;
  dificuldade: string;
  pontosFortes: string[];
  pontosFracos: string[];
  positivos?: string[];
  negativos?: string[];
};

export type LatestContent = {
  tipo: "Live" | "Vídeo" | "Corte" | "Resumo" | "Review";
  titulo: string;
  plataforma: string;
  data: string;
  link: string;
  thumbnail: string;
  descricao?: string;
};

export type TrophySummary = {
  bronze: number;
  silver: number;
  gold: number;
  platinum: number;
};

export type FinalBadge = {
  title: string;
  icon: string;
  image?: string;
};

export type GameEmblem = {
  title: string;
  image: string;
  description: string;
  tags?: string[];
};

export type Game = {
  slug?: string;
  title: string;
  subtitle: string;

  image: string;
  cardImage?: string;

  progress: number;
  nextMission: string;
  currentObjective?: string;
  objective?: string;

  achievements: string;
  achievementsUnlocked?: number;
  achievementsTotal?: number;

  mastery: string;
  hours: string;
  status: string;

  isInBacklog: boolean;
  backlogOrder?: number;

  trophySummary: TrophySummary;
  finalBadge: FinalBadge;

  emblem?: GameEmblem;
  gameEmblem?: GameEmblem;

  review: Review;
  ultimoConteudo: LatestContent;
  achievementsList: Achievement[];

  createdAt?: string;
  updatedAt?: string;

  youtubePlaylistId?: string;
};

export const games = {
  "crisol-theater-of-idols": {
    "slug": "crisol-theater-of-idols",
    "title": "Crisol: Theater of Idols",
    "subtitle": "Survival Horror",
    "image": "/images/games/crisol-theater-of-idols/banner.jpg",
    "cardImage": "/images/games/crisol-theater-of-idols/cover.jpg",
    "progress": 100,
    "nextMission": "Maestria concluída",
    "currentObjective": "",
    "objective": "",
    "achievements": "7/7",
    "achievementsUnlocked": 7,
    "achievementsTotal": 7,
    "mastery": "Concluída",
    "hours": "27H - 54M",
    "status": "completed",
    "isInBacklog": false,
    "trophySummary": {
      "bronze": 3,
      "silver": 2,
      "gold": 1,
      "platinum": 1
    },
    "finalBadge": {
      "title": "Ídolo Absoluto",
      "icon": "💎",
      "image": "/images/games/crisol-theater-of-idols/achievements/maestria-final.png"
    },
    "emblem": {
      "title": "Ídolo da Dor Eterna",
      "image": "/images/games/crisol-theater-of-idols/emblem.png",
      "description": "Uma relíquia sombria concedida ao jogador que atravessou os horrores de Tormentosa, enfrentou seus ídolos vivos e resistiu ao teatro sagrado de sangue, fé e sofrimento. O Ídolo da Dor Eterna representa a marca final de quem sobreviveu à maldição de Crisol e transformou dor, sacrifício e devoção em conquista.",
      "tags": [
        "Horror Religioso",
        "Ídolos Sombrios",
        "Sangue e Fé"
      ]
    },
    "gameEmblem": {
      "title": "Ídolo da Dor Eterna",
      "image": "/images/games/crisol-theater-of-idols/emblem.png",
      "description": "Uma relíquia sombria concedida ao jogador que atravessou os horrores de Tormentosa, enfrentou seus ídolos vivos e resistiu ao teatro sagrado de sangue, fé e sofrimento. O Ídolo da Dor Eterna representa a marca final de quem sobreviveu à maldição de Crisol e transformou dor, sacrifício e devoção em conquista.",
      "tags": [
        "Horror Religioso",
        "Ídolos Sombrios",
        "Sangue e Fé"
      ]
    },
    "review": {
      "status": "liberada",
      "nota": "6",
      "titulo": "Simples, envolvente e limitado",
      "resumo": "Simples e envolvente",
      "texto": "Um jogo simples, mas envolvente, com boa atmosfera, exploração agradável e uma história que prende até o final. Mesmo com alguns problemas de dificuldade e balanceamento, diverte bastante e entrega uma experiência melhor do que parece. Uma experiência curta, mas marcante, que diverte mesmo com suas limitações.",
      "melhorMomento": "",
      "dificuldade": "",
      "pontosFortes": [
        "História envolvente.",
        "Arte e ambientação bonitas.",
        "Exploração bem organizada.",
        "Boa rejogabilidade."
      ],
      "pontosFracos": [
        "Dificuldade muito baixa.",
        "IA dos inimigos fraca.",
        "Pouca variedade de inimigos.",
        "Armas mal balanceadas."
      ],
      "positivos": [
        "História envolvente.",
        "Arte e ambientação bonitas.",
        "Exploração bem organizada.",
        "Boa rejogabilidade."
      ],
      "negativos": [
        "Dificuldade muito baixa.",
        "IA dos inimigos fraca.",
        "Pouca variedade de inimigos.",
        "Armas mal balanceadas."
      ]
    },
    "ultimoConteudo": {
      "tipo": "Resumo",
      "titulo": "Crisol: Theater of Idols - Jornada",
      "plataforma": "YouTube",
      "data": "",
      "link": "https://www.youtube.com/@orabiisco",
      "thumbnail": "/images/games/crisol-theater-of-idols/cover.jpg",
      "descricao": "Conteúdo da jornada Rumo à Conquista."
    },
    "achievementsList": [
      {
        "id": "crisol-theater-of-idols-achievement-1779923084348",
        "title": "Ecos do Palco Profano",
        "description": "Colete todos os discos de vinil espalhados pelo jogo.",
        "trophy": "🥉",
        "icon": "🥉",
        "difficulty": "Bronze",
        "rank": "Bronze",
        "status": "completed",
        "image": "/images/games/crisol-theater-of-idols/achievements/ecos-do-palco-profano.png",
        "isCustom": true,
        "earnedDate": ""
      },
      {
        "id": "crisol-theater-of-idols-achievement-1779923087316",
        "title": "Arsenal dos Ídolos Caídos",
        "description": "Eleve todas as armas ao nível máximo.",
        "trophy": "🥉",
        "icon": "🥉",
        "difficulty": "Bronze",
        "rank": "Bronze",
        "status": "completed",
        "image": "/images/games/crisol-theater-of-idols/achievements/arsenal-dos-idolos-caidos.png",
        "isCustom": true,
        "earnedDate": ""
      },
      {
        "id": "crisol-theater-of-idols-achievement-1779923087836",
        "title": "Escrituras do Maremanto",
        "description": "Reúna todas as páginas de Maremanto.",
        "trophy": "🥈",
        "icon": "🥈",
        "difficulty": "Prata",
        "rank": "Prata",
        "status": "completed",
        "image": "/images/games/crisol-theater-of-idols/achievements/escrituras-do-maremanto.png",
        "isCustom": true,
        "earnedDate": ""
      },
      {
        "id": "crisol-theater-of-idols-achievement-1779923088113",
        "title": "Ascensão Penitente",
        "description": "Alcance o nível máximo de todas as habilidades.",
        "trophy": "🥈",
        "icon": "🥈",
        "difficulty": "Prata",
        "rank": "Prata",
        "status": "completed",
        "image": "/images/games/crisol-theater-of-idols/achievements/ascensao-penitente.png",
        "isCustom": true,
        "earnedDate": ""
      },
      {
        "id": "crisol-theater-of-idols-achievement-1780097025051",
        "title": "Primeira Reverência ao Ídolo",
        "description": "Finalize o jogo pela primeira vez na dificuldade Penitente.",
        "trophy": "🥉",
        "icon": "🥉",
        "difficulty": "Bronze",
        "rank": "Bronze",
        "status": "completed",
        "image": "/images/games/crisol-theater-of-idols/achievements/primeira-reverencia-ao-idolo.png",
        "isCustom": true,
        "earnedDate": ""
      },
      {
        "id": "crisol-theater-of-idols-achievement-1780097085539",
        "title": "Coroa do Mártir",
        "description": "Finalize o jogo novamente na dificuldade Mártir.",
        "trophy": "🥇",
        "icon": "🥇",
        "difficulty": "Ouro",
        "rank": "Ouro",
        "status": "completed",
        "image": "/images/games/crisol-theater-of-idols/achievements/coroa-do-martir.png",
        "isCustom": true,
        "earnedDate": ""
      },
      {
        "id": "crisol-theater-of-idols-achievement-1780097124900",
        "title": "Ídolo Absoluto",
        "description": "Conclua todas as conquistas de Crisol: Theater of Idols.",
        "trophy": "💎",
        "icon": "💎",
        "difficulty": "Diamante",
        "rank": "Diamante",
        "status": "completed",
        "image": "/images/games/crisol-theater-of-idols/achievements/maestria-final.png",
        "isCustom": true,
        "earnedDate": ""
      }
    ]
  },
  "howgarts-legacy": {
    "slug": "howgarts-legacy",
    "title": "Hogwarts Legacy",
    "subtitle": "RPG de Ação, Aventura, Fantasia",
    "image": "/images/games/howgarts-legacy/banner.jpg",
    "cardImage": "/images/games/howgarts-legacy/cover.jpg",
    "progress": 100,
    "nextMission": "Maestria concluída",
    "currentObjective": "",
    "objective": "",
    "achievements": "4/4",
    "achievementsUnlocked": 4,
    "achievementsTotal": 4,
    "mastery": "Concluída",
    "hours": "53H",
    "status": "completed",
    "isInBacklog": false,
    "trophySummary": {
      "bronze": 2,
      "silver": 1,
      "gold": 0,
      "platinum": 1
    },
    "finalBadge": {
      "title": "Legado Completo",
      "icon": "💎",
      "image": "/images/games/howgarts-legacy/achievements/guardiao-do-legado.png"
    },
    "emblem": {
      "title": "Relíquia de Hogwarts",
      "image": "/images/games/howgarts-legacy/emblem.png",
      "description": "Uma relíquia simbólica concedida ao bruxo que explorou Hogwarts por completo, dominou seus desafios e revelou todos os segredos deixados pelo legado mágico. O Legado Absoluto representa a conclusão definitiva da jornada e a marca de quem se tornou um verdadeiro guardião dessa história.",
      "tags": [
        "Magia Ancestral",
        "Segredos de Hogwarts",
        "Legado Mágico"
      ]
    },
    "gameEmblem": {
      "title": "Relíquia de Hogwarts",
      "image": "/images/games/howgarts-legacy/emblem.png",
      "description": "Uma relíquia simbólica concedida ao bruxo que explorou Hogwarts por completo, dominou seus desafios e revelou todos os segredos deixados pelo legado mágico. O Legado Absoluto representa a conclusão definitiva da jornada e a marca de quem se tornou um verdadeiro guardião dessa história.",
      "tags": [
        "Magia Ancestral",
        "Segredos de Hogwarts",
        "Legado Mágico"
      ]
    },
    "review": {
      "status": "liberada",
      "nota": "8",
      "titulo": "Divertido e bonito, mas com história fraca.",
      "resumo": "Uma aventura mágica, divertida e repetitiva",
      "texto": "O jogo se destaca pela gameplay fluida, com combate divertido, boas magias e combos variados. A exploração é um dos pontos mais fortes, com um mapa enorme, montarias, vassouras e muitos puzzles. Visualmente, entrega muito bem a atmosfera de Hogwarts, com gráficos bonitos, boa dublagem e desempenho estável. Mesmo com bastante conteúdo para completar, a história fraca e a repetição de atividades acabam limitando a experiência.",
      "melhorMomento": "",
      "dificuldade": "",
      "pontosFortes": [
        "Combate fluido.",
        "Exploração muito boa.",
        "Gráficos bonitos.",
        "Boa rejogabilidade."
      ],
      "pontosFracos": [
        "História fraca.",
        "Atividades repetitivas.",
        "Pouca variedade de inimigos.",
        "Quadribol mal aproveitado."
      ],
      "positivos": [
        "Combate fluido.",
        "Exploração muito boa.",
        "Gráficos bonitos.",
        "Boa rejogabilidade."
      ],
      "negativos": [
        "História fraca.",
        "Atividades repetitivas.",
        "Pouca variedade de inimigos.",
        "Quadribol mal aproveitado."
      ]
    },
    "ultimoConteudo": {
      "tipo": "Resumo",
      "titulo": "Hogwarts Legacy - Jornada",
      "plataforma": "YouTube",
      "data": "",
      "link": "https://www.youtube.com/@orabiisco",
      "thumbnail": "/images/games/howgarts-legacy/cover.jpg",
      "descricao": "Conteúdo da jornada Rumo à Conquista."
    },
    "achievementsList": [
      {
        "id": "howgarts-legacy-achievement-1780164650087",
        "title": "O Legado Desperto",
        "description": "Finalize a jornada principal de Hogwarts Legacy.",
        "trophy": "🥉",
        "icon": "🥉",
        "difficulty": "Bronze",
        "rank": "Bronze",
        "status": "completed",
        "image": "/images/games/howgarts-legacy/achievements/o-legado-desperto.png",
        "isCustom": true,
        "isHidden": false,
        "earnedDate": ""
      },
      {
        "id": "howgarts-legacy-achievement-1780164652189",
        "title": "Bruxo em Plenitude",
        "description": "Alcance o nível máximo do personagem.",
        "trophy": "🥈",
        "icon": "🥈",
        "difficulty": "Prata",
        "rank": "Prata",
        "status": "completed",
        "image": "/images/games/howgarts-legacy/achievements/bruxo-em-plenitude.png",
        "isCustom": true,
        "isHidden": false,
        "earnedDate": ""
      },
      {
        "id": "howgarts-legacy-achievement-1780164652967",
        "title": "Todos os Segredos de Hogwarts",
        "description": "Complete toda a progressão geral do jogo.",
        "trophy": "🥉",
        "icon": "🥉",
        "difficulty": "Bronze",
        "rank": "Bronze",
        "status": "completed",
        "image": "/images/games/howgarts-legacy/achievements/todos-os-segredos-de-hogwarts.png",
        "isCustom": true,
        "isHidden": false,
        "earnedDate": ""
      },
      {
        "id": "howgarts-legacy-achievement-1780164653722",
        "title": "Legado Completo",
        "description": "Conclua todas as conquistas de Hogwarts Legacy.",
        "trophy": "💎",
        "icon": "💎",
        "difficulty": "Diamante",
        "rank": "Diamante",
        "status": "completed",
        "image": "/images/games/howgarts-legacy/achievements/guardiao-do-legado.png",
        "isCustom": true,
        "isHidden": false,
        "earnedDate": ""
      }
    ]
  },
  "monster-hunter-world-iceborne": {
    "slug": "monster-hunter-world-iceborne",
    "title": "Monster Hunter: World - Iceborne",
    "subtitle": "Caça a Monstros, Aventura, Cooperativo",
    "image": "/images/games/monster-hunter-world-iceborne/banner.jpg",
    "cardImage": "/images/games/monster-hunter-world-iceborne/cover.jpg",
    "progress": 0,
    "nextMission": "Finalizar á História Principal",
    "currentObjective": "Finalizar á História Principal",
    "objective": "Finalizar á História Principal",
    "achievements": "0/11",
    "achievementsUnlocked": 0,
    "achievementsTotal": 11,
    "mastery": "Em andamento",
    "hours": "?",
    "status": "progress",
    "isInBacklog": false,
    "trophySummary": {
      "bronze": 10,
      "silver": 0,
      "gold": 0,
      "platinum": 1
    },
    "finalBadge": {
      "title": "Caçada Suprema",
      "icon": "💎",
      "image": ""
    },
    "emblem": {
      "title": "Caçador da Geada Eterna",
      "image": "/images/games/monster-hunter-world-iceborne/emblem.png",
      "description": "Um emblema concedido ao caçador que enfrentou as terras congeladas de Iceborne, sobreviveu às criaturas colossais da Expansão Glacial e provou sua força diante do domínio gelado de Velkhana. Caçador da Geada Eterna representa coragem, preparo e domínio sobre uma caçada onde cada monstro é uma prova de resistência.",
      "tags": []
    },
    "gameEmblem": {
      "title": "Caçador da Geada Eterna",
      "image": "/images/games/monster-hunter-world-iceborne/emblem.png",
      "description": "Um emblema concedido ao caçador que enfrentou as terras congeladas de Iceborne, sobreviveu às criaturas colossais da Expansão Glacial e provou sua força diante do domínio gelado de Velkhana. Caçador da Geada Eterna representa coragem, preparo e domínio sobre uma caçada onde cada monstro é uma prova de resistência.",
      "tags": []
    },
    "review": {
      "status": "bloqueada",
      "nota": "",
      "titulo": "Análise da Jornada",
      "resumo": "",
      "texto": "",
      "melhorMomento": "",
      "dificuldade": "",
      "pontosFortes": [],
      "pontosFracos": [],
      "positivos": [],
      "negativos": []
    },
    "ultimoConteudo": {
      "tipo": "Resumo",
      "titulo": "Monster Hunter: World - Iceborne - Jornada",
      "plataforma": "YouTube",
      "data": "",
      "link": "https://www.youtube.com/@orabiisco",
      "thumbnail": "/images/games/monster-hunter-world-iceborne/cover.jpg",
      "descricao": "Conteúdo da jornada Rumo à Conquista."
    },
    "achievementsList": [
      {
        "id": "monster-hunter-world-iceborne-achievement-1780171754055",
        "title": "Finalizar á História Principal",
        "description": "",
        "trophy": "🥉",
        "icon": "🥉",
        "difficulty": "Bronze",
        "rank": "Bronze",
        "status": "locked",
        "image": "/images/games/monster-hunter-world-iceborne/achievements/finalizar-a-historia-principal.png",
        "isCustom": true,
        "isHidden": false,
        "earnedDate": ""
      },
      {
        "id": "monster-hunter-world-iceborne-achievement-1780171774406",
        "title": "Finalizar Todas as Missões Secundárias",
        "description": "",
        "trophy": "🥉",
        "icon": "🥉",
        "difficulty": "Bronze",
        "rank": "Bronze",
        "status": "locked",
        "image": "/images/games/monster-hunter-world-iceborne/achievements/finalizar-todas-as-missoes-secundarias.png",
        "isCustom": true,
        "isHidden": false,
        "earnedDate": ""
      },
      {
        "id": "monster-hunter-world-iceborne-achievement-1780171793205",
        "title": "Pegar todas as armaduras Ranque -",
        "description": "",
        "trophy": "🥉",
        "icon": "🥉",
        "difficulty": "Bronze",
        "rank": "Bronze",
        "status": "locked",
        "image": "/images/games/monster-hunter-world-iceborne/achievements/pegar-todas-as-armaduras-ranque.png",
        "isCustom": true,
        "isHidden": false,
        "earnedDate": ""
      },
      {
        "id": "monster-hunter-world-iceborne-achievement-1780172437004",
        "title": "Pegar todas as armaduras Ranque+",
        "description": "",
        "trophy": "🥉",
        "icon": "🥉",
        "difficulty": "Bronze",
        "rank": "Bronze",
        "status": "locked",
        "image": "/images/games/monster-hunter-world-iceborne/achievements/pegar-todas-as-armaduras-ranque.png",
        "isCustom": true,
        "isHidden": false,
        "earnedDate": ""
      },
      {
        "id": "monster-hunter-world-iceborne-achievement-1780172444706",
        "title": "Concluir todas as Entregas da Centras de Recursos",
        "description": "",
        "trophy": "🥉",
        "icon": "🥉",
        "difficulty": "Bronze",
        "rank": "Bronze",
        "status": "locked",
        "image": "/images/games/monster-hunter-world-iceborne/achievements/concluir-todas-as-entregas-da-centras-de-recursos.png",
        "isCustom": true,
        "isHidden": false,
        "earnedDate": ""
      },
      {
        "id": "monster-hunter-world-iceborne-achievement-1780172452322",
        "title": "Pegar level máximo de pesquisa de todos os monstros.",
        "description": "",
        "trophy": "🥉",
        "icon": "🥉",
        "difficulty": "Bronze",
        "rank": "Bronze",
        "status": "locked",
        "image": "/images/games/monster-hunter-world-iceborne/achievements/nova-conquista-6.png",
        "isCustom": true,
        "isHidden": false,
        "earnedDate": ""
      },
      {
        "id": "monster-hunter-world-iceborne-achievement-1780172452672",
        "title": "Completar todas as missões da Arena com todas as armas disponíveis.",
        "description": "",
        "trophy": "🥉",
        "icon": "🥉",
        "difficulty": "Bronze",
        "rank": "Bronze",
        "status": "locked",
        "image": "",
        "isCustom": true,
        "isHidden": false,
        "earnedDate": ""
      },
      {
        "id": "monster-hunter-world-iceborne-achievement-1780172452906",
        "title": "Conseguir todos os amuletos no  level máximo",
        "description": "",
        "trophy": "🥉",
        "icon": "🥉",
        "difficulty": "Bronze",
        "rank": "Bronze",
        "status": "locked",
        "image": "",
        "isCustom": true,
        "isHidden": false,
        "earnedDate": ""
      },
      {
        "id": "monster-hunter-world-iceborne-achievement-1780172453091",
        "title": "Fazer todas os Serviços Especiais",
        "description": "",
        "trophy": "🥉",
        "icon": "🥉",
        "difficulty": "Bronze",
        "rank": "Bronze",
        "status": "locked",
        "image": "",
        "isCustom": true,
        "isHidden": false,
        "earnedDate": ""
      },
      {
        "id": "monster-hunter-world-iceborne-achievement-1780172453265",
        "title": "Todas as Armaduras do Amigado",
        "description": "",
        "trophy": "🥉",
        "icon": "🥉",
        "difficulty": "Bronze",
        "rank": "Bronze",
        "status": "locked",
        "image": "",
        "isCustom": true,
        "isHidden": false,
        "earnedDate": ""
      },
      {
        "id": "monster-hunter-world-iceborne-achievement-1780874605952",
        "title": "Caçada Suprema",
        "description": "",
        "trophy": "💎",
        "icon": "💎",
        "difficulty": "Diamante",
        "rank": "Diamante",
        "status": "locked",
        "image": "",
        "isCustom": true,
        "isHidden": true,
        "earnedDate": ""
      }
    ]
  },
  "mouse-p-i-for-hire": {
    "slug": "mouse-p-i-for-hire",
    "title": "MOUSE - P.I. For Hire",
    "subtitle": "FPS / Tiro em Primeira Pessoa",
    "image": "/images/games/mouse-p-i-for-hire/banner.jpg",
    "cardImage": "/images/games/mouse-p-i-for-hire/cover.jpg",
    "progress": 0,
    "nextMission": "Definir próximo objetivo",
    "currentObjective": "",
    "objective": "",
    "achievements": "0/1",
    "achievementsUnlocked": 0,
    "achievementsTotal": 1,
    "mastery": "Em andamento",
    "hours": "0h",
    "status": "planned",
    "isInBacklog": true,
    "backlogOrder": 1,
    "trophySummary": {
      "bronze": 0,
      "silver": 0,
      "gold": 0,
      "platinum": 1
    },
    "finalBadge": {
      "title": "Caso Encerrado",
      "icon": "💎",
      "image": ""
    },
    "emblem": {
      "title": "O Distintivo de Ouro de Mouseburg",
      "image": "/images/games/mouse-p-i-for-hire/emblem.png",
      "description": "Uma relíquia forjada no metal das ruas chuvosas da cidade velha, concedida apenas ao investigador que teve a coragem de descer aos becos mais escuros de Mouseburg, desmascarar a corrupção e encerrar o caso mais perigoso da sua carreira. Este emblema representa a justiça implacável e o faro afiado de Jack Pepper.",
      "tags": [
        "Colecionável"
      ]
    },
    "gameEmblem": {
      "title": "O Distintivo de Ouro de Mouseburg",
      "image": "/images/games/mouse-p-i-for-hire/emblem.png",
      "description": "Uma relíquia forjada no metal das ruas chuvosas da cidade velha, concedida apenas ao investigador que teve a coragem de descer aos becos mais escuros de Mouseburg, desmascarar a corrupção e encerrar o caso mais perigoso da sua carreira. Este emblema representa a justiça implacável e o faro afiado de Jack Pepper.",
      "tags": [
        "Colecionável"
      ]
    },
    "review": {
      "status": "bloqueada",
      "nota": "",
      "titulo": "Análise da Jornada",
      "resumo": "",
      "texto": "",
      "melhorMomento": "",
      "dificuldade": "",
      "pontosFortes": [],
      "pontosFracos": [],
      "positivos": [],
      "negativos": []
    },
    "ultimoConteudo": {
      "tipo": "Resumo",
      "titulo": "MOUSE - P.I. For Hire - Jornada",
      "plataforma": "YouTube",
      "data": "",
      "link": "https://www.youtube.com/@orabiisco",
      "thumbnail": "/images/games/mouse-p-i-for-hire/cover.jpg",
      "descricao": "Conteúdo da jornada Rumo à Conquista."
    },
    "achievementsList": [
      {
        "id": "mouse-p-i-for-hire-achievement-1780853371335",
        "title": "Caso Encerrado",
        "description": "",
        "trophy": "💎",
        "icon": "💎",
        "difficulty": "Diamante",
        "rank": "Diamante",
        "status": "locked",
        "image": "",
        "isCustom": true,
        "isHidden": true,
        "earnedDate": ""
      }
    ]
  },
  "song-of-nunu": {
    "slug": "song-of-nunu",
    "title": "Song of Nunu: A League of Legends Stor",
    "subtitle": "Aventura 3D, Plataforma",
    "image": "/images/games/song-of-nunu/banner.jpg",
    "cardImage": "/images/games/song-of-nunu/cover.jpg",
    "progress": 0,
    "nextMission": "Definir próximo objetivo",
    "currentObjective": "",
    "objective": "",
    "achievements": "0/1",
    "achievementsUnlocked": 0,
    "achievementsTotal": 1,
    "mastery": "Em andamento",
    "hours": "0h",
    "status": "planned",
    "isInBacklog": true,
    "backlogOrder": 2,
    "trophySummary": {
      "bronze": 0,
      "silver": 0,
      "gold": 0,
      "platinum": 1
    },
    "finalBadge": {
      "title": "Amizade Inquebrável",
      "icon": "💎",
      "image": ""
    },
    "emblem": {
      "title": "Canção de Freljord",
      "image": "/images/games/song-of-nunu/emblem.png",
      "description": "Um emblema concedido à dupla que atravessou as terras geladas de Freljord, enfrentou seus mistérios antigos e transformou uma jornada pela neve em uma história de amizade, coragem e esperança. Canção de Freljord representa o vínculo entre Nunu e Willump e a magia que guia essa aventura pelo gelo.",
      "tags": [
        "Amizade Gelada",
        "Magia de Freljord",
        "Jornada na Neve"
      ]
    },
    "gameEmblem": {
      "title": "Canção de Freljord",
      "image": "/images/games/song-of-nunu/emblem.png",
      "description": "Um emblema concedido à dupla que atravessou as terras geladas de Freljord, enfrentou seus mistérios antigos e transformou uma jornada pela neve em uma história de amizade, coragem e esperança. Canção de Freljord representa o vínculo entre Nunu e Willump e a magia que guia essa aventura pelo gelo.",
      "tags": [
        "Amizade Gelada",
        "Magia de Freljord",
        "Jornada na Neve"
      ]
    },
    "review": {
      "status": "bloqueada",
      "nota": "",
      "titulo": "Análise da Jornada",
      "resumo": "",
      "texto": "",
      "melhorMomento": "",
      "dificuldade": "",
      "pontosFortes": [],
      "pontosFracos": [],
      "positivos": [],
      "negativos": []
    },
    "ultimoConteudo": {
      "tipo": "Resumo",
      "titulo": "Song of Nunu: A League of Legends Stor - Jornada",
      "plataforma": "YouTube",
      "data": "",
      "link": "https://www.youtube.com/@orabiisco",
      "thumbnail": "/images/games/song-of-nunu/cover.jpg",
      "descricao": "Conteúdo da jornada Rumo à Conquista."
    },
    "achievementsList": [
      {
        "id": "song-of-nunu-achievement-1780870466594",
        "title": "Amizade Inquebrável",
        "description": "",
        "trophy": "💎",
        "icon": "💎",
        "difficulty": "Diamante",
        "rank": "Diamante",
        "status": "locked",
        "image": "",
        "isCustom": true,
        "isHidden": true,
        "earnedDate": ""
      }
    ]
  },
  "hollow-knight": {
    "slug": "hollow-knight",
    "title": "Hollow Knight",
    "subtitle": "Metroidvania / Ação e Aventura",
    "image": "/images/games/hollow-knight/banner.jpg",
    "cardImage": "/images/games/hollow-knight/cover.jpg",
    "progress": 0,
    "nextMission": "Definir próximo objetivo",
    "currentObjective": "",
    "objective": "",
    "achievements": "0/1",
    "achievementsUnlocked": 0,
    "achievementsTotal": 1,
    "mastery": "Em andamento",
    "hours": "0h",
    "status": "planned",
    "isInBacklog": true,
    "backlogOrder": 3,
    "trophySummary": {
      "bronze": 0,
      "silver": 0,
      "gold": 0,
      "platinum": 1
    },
    "finalBadge": {
      "title": "Vazio Absoluto",
      "icon": "💎",
      "image": ""
    },
    "emblem": {
      "title": "Guardião de Hallownest",
      "image": "/images/games/hollow-knight/emblem.png",
      "description": "Um emblema concedido ao cavaleiro que atravessou as profundezas de Hallownest, enfrentou criaturas esquecidas e desvendou os mistérios de um reino consumido pelo silêncio. Guardião de Hallownest representa a marca de quem dominou a jornada sombria, melancólica e mística de Hollow Knight.",
      "tags": [
        "Reino Esquecido",
        "Vazio e Luz",
        "Mistérios de Hallownest"
      ]
    },
    "gameEmblem": {
      "title": "Guardião de Hallownest",
      "image": "/images/games/hollow-knight/emblem.png",
      "description": "Um emblema concedido ao cavaleiro que atravessou as profundezas de Hallownest, enfrentou criaturas esquecidas e desvendou os mistérios de um reino consumido pelo silêncio. Guardião de Hallownest representa a marca de quem dominou a jornada sombria, melancólica e mística de Hollow Knight.",
      "tags": [
        "Reino Esquecido",
        "Vazio e Luz",
        "Mistérios de Hallownest"
      ]
    },
    "review": {
      "status": "bloqueada",
      "nota": "",
      "titulo": "Análise da Jornada",
      "resumo": "",
      "texto": "",
      "melhorMomento": "",
      "dificuldade": "",
      "pontosFortes": [],
      "pontosFracos": [],
      "positivos": [],
      "negativos": []
    },
    "ultimoConteudo": {
      "tipo": "Resumo",
      "titulo": "Hollow Knight - Jornada",
      "plataforma": "YouTube",
      "data": "",
      "link": "https://www.youtube.com/@orabiisco",
      "thumbnail": "/images/games/hollow-knight/cover.jpg",
      "descricao": "Conteúdo da jornada Rumo à Conquista."
    },
    "achievementsList": [
      {
        "id": "hollow-knight-achievement-1780871731352",
        "title": "Vazio Absoluto",
        "description": "",
        "trophy": "💎",
        "icon": "💎",
        "difficulty": "Diamante",
        "rank": "Diamante",
        "status": "locked",
        "image": "",
        "isCustom": true,
        "isHidden": true,
        "earnedDate": ""
      }
    ]
  },
  "metro-last-light": {
    "slug": "metro-last-light",
    "title": "Metro: Last Light",
    "subtitle": "Tiro em Primeira Pessoa / Survival Horror",
    "image": "/images/games/metro-last-light/banner.jpg",
    "cardImage": "/images/games/metro-last-light/cover.jpg",
    "progress": 0,
    "nextMission": "Definir próximo objetivo",
    "currentObjective": "",
    "objective": "",
    "achievements": "0/1",
    "achievementsUnlocked": 0,
    "achievementsTotal": 1,
    "mastery": "Em andamento",
    "hours": "0h",
    "status": "planned",
    "isInBacklog": true,
    "backlogOrder": 4,
    "trophySummary": {
      "bronze": 0,
      "silver": 0,
      "gold": 0,
      "platinum": 1
    },
    "finalBadge": {
      "title": "Sobrevivente dos Túneis",
      "icon": "💎",
      "image": ""
    },
    "emblem": {
      "title": "Última Luz do Metrô",
      "image": "/images/games/metro-last-light/emblem.png",
      "description": "Um emblema concedido ao ranger que atravessou os túneis destruídos de Moscou, enfrentou a radiação, as facções e as criaturas das sombras em busca da última esperança da humanidade. Última Luz do Metrô representa a resistência de quem sobreviveu ao horror subterrâneo e carregou uma chama de esperança em um mundo condenado.",
      "tags": [
        "Sobrevivência Subterrânea",
        "Mundo Pós-Apocalíptico",
        "Radiação e Escuridão"
      ]
    },
    "gameEmblem": {
      "title": "Última Luz do Metrô",
      "image": "/images/games/metro-last-light/emblem.png",
      "description": "Um emblema concedido ao ranger que atravessou os túneis destruídos de Moscou, enfrentou a radiação, as facções e as criaturas das sombras em busca da última esperança da humanidade. Última Luz do Metrô representa a resistência de quem sobreviveu ao horror subterrâneo e carregou uma chama de esperança em um mundo condenado.",
      "tags": [
        "Sobrevivência Subterrânea",
        "Mundo Pós-Apocalíptico",
        "Radiação e Escuridão"
      ]
    },
    "review": {
      "status": "bloqueada",
      "nota": "",
      "titulo": "Análise da Jornada",
      "resumo": "",
      "texto": "",
      "melhorMomento": "",
      "dificuldade": "",
      "pontosFortes": [],
      "pontosFracos": [],
      "positivos": [],
      "negativos": []
    },
    "ultimoConteudo": {
      "tipo": "Resumo",
      "titulo": "Metro: Last Light - Jornada",
      "plataforma": "YouTube",
      "data": "",
      "link": "https://www.youtube.com/@orabiisco",
      "thumbnail": "/images/games/metro-last-light/cover.jpg",
      "descricao": "Conteúdo da jornada Rumo à Conquista."
    },
    "achievementsList": [
      {
        "id": "metro-last-light-achievement-1780870550593",
        "title": "Sobrevivente dos Túneis",
        "description": "",
        "trophy": "💎",
        "icon": "💎",
        "difficulty": "Diamante",
        "rank": "Diamante",
        "status": "locked",
        "image": "",
        "isCustom": true,
        "isHidden": true,
        "earnedDate": ""
      }
    ]
  },
  "the-surge": {
    "slug": "the-surge",
    "title": "The Surge",
    "subtitle": "RPG de Ação / Soulslike",
    "image": "/images/games/the-surge/banner.jpg",
    "cardImage": "/images/games/the-surge/cover.jpg",
    "progress": 0,
    "nextMission": "Definir próximo objetivo",
    "currentObjective": "",
    "objective": "",
    "achievements": "0/1",
    "achievementsUnlocked": 0,
    "achievementsTotal": 1,
    "mastery": "Em andamento",
    "hours": "0h",
    "status": "planned",
    "isInBacklog": true,
    "backlogOrder": 5,
    "trophySummary": {
      "bronze": 0,
      "silver": 0,
      "gold": 0,
      "platinum": 1
    },
    "finalBadge": {
      "title": "Sistema Dominado",
      "icon": "💎",
      "image": ""
    },
    "emblem": {
      "title": "Núcleo da CREO",
      "image": "/images/games/the-surge/emblem.png",
      "description": "Um emblema concedido ao sobrevivente que enfrentou o colapso das instalações da CREO, dominou o poder do exoesqueleto e atravessou fábricas destruídas, máquinas hostis e metal retorcido. Núcleo da CREO representa a marca de quem resistiu ao caos industrial e transformou sucata, dor e tecnologia em força.",
      "tags": [
        "Colapso Industrial",
        "Exoesqueleto Letal",
        "Máquinas Hostis"
      ]
    },
    "gameEmblem": {
      "title": "Núcleo da CREO",
      "image": "/images/games/the-surge/emblem.png",
      "description": "Um emblema concedido ao sobrevivente que enfrentou o colapso das instalações da CREO, dominou o poder do exoesqueleto e atravessou fábricas destruídas, máquinas hostis e metal retorcido. Núcleo da CREO representa a marca de quem resistiu ao caos industrial e transformou sucata, dor e tecnologia em força.",
      "tags": [
        "Colapso Industrial",
        "Exoesqueleto Letal",
        "Máquinas Hostis"
      ]
    },
    "review": {
      "status": "bloqueada",
      "nota": "",
      "titulo": "Análise da Jornada",
      "resumo": "",
      "texto": "",
      "melhorMomento": "",
      "dificuldade": "",
      "pontosFortes": [],
      "pontosFracos": [],
      "positivos": [],
      "negativos": []
    },
    "ultimoConteudo": {
      "tipo": "Resumo",
      "titulo": "The Surge - Jornada",
      "plataforma": "YouTube",
      "data": "",
      "link": "https://www.youtube.com/@orabiisco",
      "thumbnail": "/images/games/the-surge/cover.jpg",
      "descricao": "Conteúdo da jornada Rumo à Conquista."
    },
    "achievementsList": [
      {
        "id": "the-surge-achievement-1780873100093",
        "title": "Sistema Dominado",
        "description": "",
        "trophy": "💎",
        "icon": "💎",
        "difficulty": "Diamante",
        "rank": "Diamante",
        "status": "locked",
        "image": "",
        "isCustom": true,
        "isHidden": true,
        "earnedDate": ""
      }
    ]
  },
  "tom-clancy-s-the-division": {
    "slug": "tom-clancy-s-the-division",
    "title": "Tom Clancy's The Division",
    "subtitle": "RPG de ação / Loot Shooter / Tiro em terceira pessoa",
    "image": "/images/games/tom-clancy-s-the-division/banner.jpg",
    "cardImage": "/images/games/tom-clancy-s-the-division/cover.jpg",
    "progress": 0,
    "nextMission": "Definir próximo objetivo",
    "currentObjective": "",
    "objective": "",
    "achievements": "0/1",
    "achievementsUnlocked": 0,
    "achievementsTotal": 1,
    "mastery": "Em andamento",
    "hours": "0h",
    "status": "planned",
    "isInBacklog": true,
    "backlogOrder": 6,
    "trophySummary": {
      "bronze": 0,
      "silver": 0,
      "gold": 0,
      "platinum": 1
    },
    "finalBadge": {
      "title": "Última Linha de Defesa",
      "icon": "💎",
      "image": ""
    },
    "emblem": {
      "title": "Agente da Zona Escura",
      "image": "/images/games/tom-clancy-s-the-division/emblem.png",
      "description": "",
      "tags": [
        "Crise Urbana",
        "Operação SHD",
        "Zona Contaminada"
      ]
    },
    "gameEmblem": {
      "title": "Agente da Zona Escura",
      "image": "/images/games/tom-clancy-s-the-division/emblem.png",
      "description": "",
      "tags": [
        "Crise Urbana",
        "Operação SHD",
        "Zona Contaminada"
      ]
    },
    "review": {
      "status": "bloqueada",
      "nota": "",
      "titulo": "Análise da Jornada",
      "resumo": "",
      "texto": "",
      "melhorMomento": "",
      "dificuldade": "",
      "pontosFortes": [],
      "pontosFracos": [],
      "positivos": [],
      "negativos": []
    },
    "ultimoConteudo": {
      "tipo": "Resumo",
      "titulo": "Tom Clancy's The Division - Jornada",
      "plataforma": "YouTube",
      "data": "",
      "link": "https://www.youtube.com/@orabiisco",
      "thumbnail": "/images/games/tom-clancy-s-the-division/cover.jpg",
      "descricao": "Conteúdo da jornada Rumo à Conquista."
    },
    "achievementsList": [
      {
        "id": "tom-clancy-s-the-division-achievement-1780870589001",
        "title": "Última Linha de Defesa",
        "description": "",
        "trophy": "💎",
        "icon": "💎",
        "difficulty": "Diamante",
        "rank": "Diamante",
        "status": "locked",
        "image": "",
        "isCustom": true,
        "isHidden": true,
        "earnedDate": ""
      }
    ]
  },
  "hades": {
    "slug": "hades",
    "title": "Hades",
    "subtitle": "Roguelike / RPG de Ação",
    "image": "/images/games/hades/banner.jpg",
    "cardImage": "/images/games/hades/cover.jpg",
    "progress": 0,
    "nextMission": "Definir próximo objetivo",
    "currentObjective": "",
    "objective": "",
    "achievements": "0/1",
    "achievementsUnlocked": 0,
    "achievementsTotal": 1,
    "mastery": "Em andamento",
    "hours": "0h",
    "status": "planned",
    "isInBacklog": true,
    "backlogOrder": 8,
    "trophySummary": {
      "bronze": 0,
      "silver": 0,
      "gold": 0,
      "platinum": 1
    },
    "finalBadge": {
      "title": "Fuga Definitiva",
      "icon": "💎",
      "image": ""
    },
    "emblem": {
      "title": "Herdeiro do Submundo",
      "image": "/images/games/hades/emblem.png",
      "description": "Uma relíquia infernal concedida ao guerreiro que desafiou o Submundo, enfrentou seus guardiões e provou sua força diante das chamas eternas. Chama do Submundo representa a conclusão da jornada de Hades e a marca de quem venceu uma fuga impossível.",
      "tags": [
        "Mitologia Sombria",
        "Chamas Infernais",
        "Fuga do Submundo"
      ]
    },
    "gameEmblem": {
      "title": "Herdeiro do Submundo",
      "image": "/images/games/hades/emblem.png",
      "description": "Uma relíquia infernal concedida ao guerreiro que desafiou o Submundo, enfrentou seus guardiões e provou sua força diante das chamas eternas. Chama do Submundo representa a conclusão da jornada de Hades e a marca de quem venceu uma fuga impossível.",
      "tags": [
        "Mitologia Sombria",
        "Chamas Infernais",
        "Fuga do Submundo"
      ]
    },
    "review": {
      "status": "bloqueada",
      "nota": "",
      "titulo": "Análise da Jornada",
      "resumo": "",
      "texto": "",
      "melhorMomento": "",
      "dificuldade": "",
      "pontosFortes": [],
      "pontosFracos": [],
      "positivos": [],
      "negativos": []
    },
    "ultimoConteudo": {
      "tipo": "Resumo",
      "titulo": "Hades - Jornada",
      "plataforma": "YouTube",
      "data": "",
      "link": "https://www.youtube.com/@orabiisco",
      "thumbnail": "/images/games/hades/cover.jpg",
      "descricao": "Conteúdo da jornada Rumo à Conquista."
    },
    "achievementsList": [
      {
        "id": "hades-achievement-1780858190849",
        "title": "Fuga Definitiva",
        "description": "",
        "trophy": "💎",
        "icon": "💎",
        "difficulty": "Diamante",
        "rank": "Diamante",
        "status": "locked",
        "image": "",
        "isCustom": true,
        "isHidden": true,
        "earnedDate": ""
      }
    ]
  }
} satisfies Record<string, Game>;

export type GameSlug = keyof typeof games;

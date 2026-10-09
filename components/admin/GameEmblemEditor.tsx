"use client";

import { useEffect, useMemo, useState } from "react";
import type { GameEmblemInput, SiteGame } from "@/lib/useSiteGames";

type GameEmblemEditorProps = {
  game: SiteGame;
  collapsed: boolean;
  onToggle: () => void;
  onSave: (emblem: GameEmblemInput) => Promise<boolean>;
};

type LegacyEmblemFields = {
  gameEmblem?: GameEmblemInput;
  emblemUnlockAchievement?: string;
  emblemTitle?: string;
  emblemImage?: string;
  emblemDescription?: string;
  emblemTags?: string[] | string;
  emblemUnlockedAt?: string;
};

type PackageState = "idle" | "downloading" | "error";

type EmblemReference = {
  slug: string;
  title: string;
  image: string;
  updatedAt?: string;
};

function readText(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function automaticEmblemPath(slug: string) {
  // This asset kept a historical misspelling in its public folder.
  if (slug === "hogwarts-legacy") return "/images/games/howgarts-legacy/emblem.png";
  return `/images/games/${slug}/emblem.png`;
}

function readTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((tag) => readText(tag).trim()).filter(Boolean);
  }

  return readText(value)
    .split(/[\n,]/g)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function getLegacyEmblemUnlockedAt(game: SiteGame): string {
  const achievements = Array.isArray(game.achievementsList) ? game.achievementsList : [];
  const mastery = achievements.find((achievement) => {
    const title = readText(achievement.title).toLowerCase();
    const rank = readText(achievement.difficulty, readText(achievement.rank, "")).toLowerCase();
    const status = readText(achievement.status).toLowerCase();
    const completed = ["completed", "concluida", "concluido", "desbloqueado", "desbloqueada"].includes(status);
    return completed && (
      rank.includes("diamante") ||
      rank.includes("maestria") ||
      title.includes("maestria") ||
      title.includes("mastery") ||
      title.includes("final") ||
      title.includes("caso encerrado")
    );
  });

  const achievementDate = readText(mastery?.earnedDate).trim();
  if (achievementDate) return achievementDate;

  // Preserve the established dates shown for legacy emblem cards until the
  // owner explicitly saves the emblem configuration in Admin.
  if (game.slug === "crisol-theater-of-idols") return "2026-04-09";
  if (game.slug === "hogwarts-legacy" || game.slug === "howgarts-legacy") return "2026-03-17";
  return "";
}


function buildEmblemTemplate(
  game: SiteGame,
  emblem: GameEmblemInput,
  tagsText: string,
  referenceItems: EmblemReference[]
) {
  const achievementLines = (game.achievementsList ?? [])
    .filter((item) => readText(item.title).trim())
    .slice(0, 12)
    .map((item, index) => {
      const title = readText(item.title, `Conquista ${index + 1}`);
      const description = readText(item.description).trim();
      return `- ${title}${description ? `: ${description}` : ""}`;
    });
  const tags = tagsText.split(",").map((tag) => tag.trim()).filter(Boolean);
  const rawEmblemTitle = readText(emblem.title).trim();
  const emblemTitle = rawEmblemTitle && rawEmblemTitle.toLowerCase() !== "emblema do jogo"
    ? rawEmblemTitle
    : `Crie um nome original para o Emblema de ${game.title}`;
  const rawDescription = readText(emblem.description).trim();
  const references = referenceItems.map(
    (item) => `- ${item.title}: REFERENCIAS-EMBLEMAS/${item.slug}-emblem.png`
  );

  return [
    "RUMO À CONQUISTA — TEMPLATE OFICIAL DE CRIAÇÃO DE EMBLEMA",
    "OBJETIVO: criar um único Emblema original e específico para o jogo indicado. Este template adapta o briefing aos dados atuais do jogo e usa os emblemas existentes do site como referências visuais reais.",
    "",
    "IDENTIFICAÇÃO DO JOGO",
    `Nome: ${game.title}`,
    `Slug: ${game.slug}`,
    `Gênero / identidade: ${readText(game.subtitle, "Não informado; use somente informações que possam ser sustentadas pelas referências e pelo universo do jogo.")}`,
    `Plataforma cadastrada: ${readText(game.platform, "Não informada")}`,
    `Objetivo atual: ${readText(game.currentObjective || game.objective, "Não informado")}`,
    `Maestria Final: ${readText(game.finalBadge?.title, "Não cadastrada")}`,
    `Descrição da Maestria: ${readText(game.finalBadge?.description, "Não cadastrada")}`,
    "",
    "BRIEFING DO EMBLEMA",
    `Título / conceito: ${emblemTitle}`,
    `Descrição fornecida: ${rawDescription || "Ainda não fornecida. Desenvolva uma interpretação visual específica baseada no jogo, sem preencher lacunas com lore inventada."}`,
    `Tags atuais: ${tags.length ? tags.join(", ") : "Não definidas; identifique temas visuais específicos a partir dos dados do jogo."}`,
    `Caminho esperado: ${automaticEmblemPath(game.slug)}`,
    "",
    "CONQUISTAS QUE PODEM AJUDAR A IDENTIFICAR TEMAS",
    ...(achievementLines.length ? achievementLines : ["- Ainda não há conquistas suficientes cadastradas. Não invente detalhes narrativos específicos."]),
    "",
    "ETAPA 1 — AUDITORIA VISUAL DAS REFERÊNCIAS ANEXADAS",
    "Abra e examine visualmente TODOS os arquivos PNG da pasta REFERENCIAS-EMBLEMAS incluída neste pacote. Não se baseie apenas nos nomes dos arquivos.",
    "Compare em cada imagem: silhueta externa, geometria da moldura, ornamento superior, laterais, base ou placa inferior, símbolo central, material, pátina, textura, paleta dominante e secundária, iluminação, densidade ornamental e leitura quando reduzida.",
    "Extraia o DNA visual comum da coleção: emblemas com aparência de artefatos colecionáveis premium, símbolo central marcante, materiais trabalhados, sensação de profundidade, acabamento cuidadoso e compatibilidade com a interface escura do Rumo à Conquista.",
    "Ao mesmo tempo, registre o que torna cada moldura individual: contorno, arquitetura, material, distribuição de ornamentos, elemento central e estrutura da base. Não transforme o DNA comum em uma moldura única repetida.",
    "",
    "ÍNDICE DOS EMBLEMAS EXISTENTES A COMPARAR",
    ...references,
    "",
    "ETAPA 2 — PROJETAR UMA MOLDURA PRÓPRIA PARA ESTE JOGO",
    "Depois de analisar o conjunto, escolha uma silhueta e uma combinação de detalhes que evite repetir qualquer moldura existente. Varie de forma deliberada o contorno, o topo, as laterais, a base, o material e a maneira como o símbolo central é emoldurado.",
    "A moldura deve nascer do universo deste jogo: use símbolos, objetos, criaturas, arquitetura, tecnologia, materiais e formas que realmente combinem com sua identidade.",
    "Não copie exatamente a composição, a moldura, a coroa, o halo, as asas, a placa inferior ou o elemento central de nenhum dos emblemas de referência.",
    "A unidade da coleção vem da qualidade de acabamento, da profundidade e do tratamento de artefato premium — não de repetir o mesmo desenho.",
    "Não force a mesma paleta em todos os jogos. Use cores e materiais adequados a este universo; vermelho, bronze, ouro ou tons frios podem aparecer apenas quando fizerem sentido para a identidade do jogo.",
    "",
    "ETAPA 3 — SÍMBOLO CENTRAL E IDENTIDADE",
    `O resultado deve traduzir o conceito “${emblemTitle}” e a descrição específica do jogo em uma imagem, não em palavras.`,
    "O símbolo central precisa ser identificável em tamanho pequeno. A moldura deve reforçar o símbolo, não competir com ele.",
    "O Emblema é uma peça de coleção distinta da Maestria Final; não reutilize o desenho da Maestria, da taça de rank ou de uma conquista existente.",
    "Evite letras aleatórias, texto pequeno, logos, marcas-d'água, interface de jogo, mockups ou fundos de apresentação. Se uma placa fizer sentido como parte física do objeto, mantenha-a ornamental, sem texto ilegível.",
    "",
    "ESPECIFICAÇÕES TÉCNICAS",
    "- Um único Emblema; uma imagem; um arquivo.",
    "- PNG com canvas quadrado de 1024x1024 px.",
    "- A silhueta do próprio Emblema deve ser predominantemente vertical, adequada ao card de Emblema do site.",
    "- Centralizar e preencher cerca de 80–88% da altura do canvas, sem cortar a ponta superior, os laterais ou a base.",
    "- Preferir fundo transparente fora da silhueta, para que o Emblema se integre ao fundo escuro da interface; não criar uma placa quadrada atrás da peça.",
    "- Manter foco forte, contorno limpo, contraste controlado e leitura clara quando exibido pequeno.",
    "- Sem colagem, mosaico, painel, comparativo, múltiplas opções ou várias artes na mesma imagem.",
    "",
    "CHECKLIST DE APROVAÇÃO",
    "1. O Emblema comunica este jogo, e não apenas uma fantasia genérica?",
    "2. A moldura é claramente diferente das dez referências atuais?",
    "3. O acabamento ainda parece pertencer à coleção do Rumo à Conquista?",
    "4. O símbolo principal continua legível em tamanho pequeno?",
    "5. O desenho é diferente da Maestria Final e não copia uma referência?",
    "",
    `ARQUIVO FINAL: ${game.slug}-emblem.png`,
    "RESULTADO: entregar somente a arte final do Emblema deste jogo.",
  ].join("\n");
}

function buildUniversalPrompt01(
  game: SiteGame,
  emblem: GameEmblemInput,
  tagsText: string
) {
  const achievementLines = (game.achievementsList ?? [])
    .filter((item) => readText(item.title).trim())
    .slice(0, 20)
    .map((item) => {
      const title = readText(item.title).trim();
      const description = readText(item.description).trim();
      return `- ${title}${description ? `: ${description}` : ""}`;
    });
  const tags = readTags(tagsText);
  const gameTitle = readText(game.title, "Jogo não informado");
  const emblemTitle = readText(emblem.title).trim() || "Definir durante a análise";
  const unlockAchievement = readText(emblem.unlockAchievement).trim() || "Definir com base nas conquistas reais cadastradas; não inventar.";
  const platform = readText(game.platform, "Plataforma não informada");

  return [
    "RUMO À CONQUISTA — PROMPT 01 — ANÁLISE E PROJETO UNIVERSAL DE EMBLEMAS V4",
    "",
    "PAPEL",
    "Você é diretor de arte e designer de artefatos colecionáveis para o projeto Rumo à Conquista. Este sistema precisa funcionar com QUALQUER jogo: adapte identidade, personagens, símbolos, cenário, cores, materiais, moldura, composição e atmosfera ao universo específico do jogo. Não reutilize automaticamente a mesma moldura mudando apenas o personagem.",
    "",
    "OBJETIVO DESTA ETAPA",
    "Analisar a identidade do jogo e todas as referências visuais anexadas, planejar um Emblema exclusivo e entregar um briefing técnico completo para o Prompt 02. NÃO gere, desenhe ou edite imagens nesta etapa. Não tente simular a arte com texto.",
    "",
    "DADOS REAIS DO JOGO",
    `Jogo: ${gameTitle}`,
    `Slug: ${readText(game.slug)}`,
    `Plataforma para a placa: ${platform}`,
    `Gênero/identidade cadastrada: ${readText(game.subtitle, "Não informado; confirmar pelas referências disponíveis.")}`,
    `Objetivo atual: ${readText(game.currentObjective || game.objective, "Não informado")}`,
    `Título provisório do Emblema: ${emblemTitle}`,
    `Conquista necessária para desbloquear o Emblema: ${unlockAchievement}`,
    `Descrição atual: ${readText(emblem.description).trim() || "Criar uma descrição temática após definir o conceito."}`,
    `Tags atuais: ${tags.length ? tags.join(", ") : "Definir após a análise."}`,
    "",
    "CONQUISTAS CADASTRADAS COMO CONTEXTO — NÃO TRATAR COMO LORE COMPLETA",
    ...(achievementLines.length ? achievementLines : ["- Não há conquistas cadastradas suficientes para servir de referência."]),
    "",
    "ETAPA 1 — INVESTIGAR A IDENTIDADE DO JOGO",
    "Use os dados fornecidos e as referências anexadas. Quando a pesquisa externa estiver disponível, confirme a identidade visual com fontes confiáveis. Identifique atmosfera, cenários, iconografia, personagens ou criaturas relevantes, arquitetura, equipamentos, símbolos e materiais característicos. Separe fatos confirmados de interpretações. Não invente lore, nomes, eventos ou itens específicos para preencher lacunas; indique o que não puder ser confirmado.",
    "",
    "ETAPA 2 — AUDITAR O ZIP DE REFERÊNCIAS",
    "Abra e examine VISUALMENTE todos os PNGs dentro do ZIP REFERENCIAS-EMBLEMAS. Não se baseie somente nos nomes dos arquivos. Compare silhueta externa, geometria da moldura, topo, laterais, base, placas, símbolo central, paleta, materiais, pátina, ornamentos, profundidade, iluminação, densidade visual e legibilidade em tamanho pequeno.",
    "Identifique o DNA comum da coleção Rumo à Conquista: artefato colecionável premium, acabamento intencional, volumes e relevos bem definidos, foco central legível e qualidade coerente com a interface escura. Em seguida, liste as características particulares de cada referência que NÃO devem ser copiadas literalmente.",
    "Se o ZIP não estiver anexado, não afirme que analisou as imagens. Solicite o ZIP antes de concluir a comparação visual.",
    "",
    "ETAPA 3 — DESENHAR UMA IDENTIDADE EXCLUSIVA",
    "Proponha uma composição que seja reconhecível como pertencente a este jogo e diferente das referências. Adapte formato da silhueta, perfil da moldura, ornamentos, elemento central, cenário interno, materiais e paleta. Não force vermelho, dourado, bronze, preto ou qualquer cor padrão quando não combinar com o jogo.",
    "O Emblema deve continuar pertencendo à família visual premium do site, mas não deve parecer uma cópia ou variação mínima de outra moldura. Não reutilize automaticamente a composição da Maestria Final ou de conquistas já existentes.",
    "",
    "REQUISITOS OBRIGATÓRIOS DA ARTE FINAL",
    "- Uma única peça; não fazer colagem, grade, painel, mockup, comparação ou múltiplas opções.",
    "- Canvas quadrado de 1024x1024 px; a peça do Emblema deve ter silhueta visual predominantemente vertical.",
    "- Preferir PNG com transparência alpha real fora da silhueta. Não desenhar fundo cinza, preto, branco ou quadriculado para simular transparência.",
    "- O Emblema ocupa aproximadamente 80–88% da altura do canvas, centralizado e com margem de segurança suficiente. Não cortar topo, laterais, base ou placas.",
    "- O símbolo central é dominante e ocupa aproximadamente 60–75% da área visual útil, ajustado à composição sem esconder a moldura.",
    "- Relevo 3D, materiais plausíveis, contraste controlado, iluminação dramática e contorno limpo. Evitar glow exagerado e excesso de microdetalhes.",
    "- A placa principal DEVE trazer o nome do jogo, legível e integrado fisicamente à peça. Abaixo dela, uma placa secundária menor DEVE trazer a plataforma cadastrada. Para este tipo de Emblema, esses dois textos nas placas são exceções intencionais à regra geral de evitar texto em artes de conquistas.",
    "- Não adicionar slogans, parágrafos, texto aleatório, marcas-d'água, logos de terceiros, interface de jogo ou palavras ilegíveis. Não usar moldura externa quadrada como fundo.",
    "- Personagens podem ser usados quando relevantes e permitidos; se não funcionarem, priorize símbolo, criatura, objeto, arquitetura ou ícone próprio do universo.",
    "",
    "ETAPA 4 — METADADOS",
    "Defina ou refine: (1) nome exclusivo do Emblema; (2) conquista real que o desbloqueia, escolhida entre as conquistas cadastradas sempre que possível; (3) descrição temática curta para o site; (4) tags específicas; (5) nome de arquivo sugerido no formato [slug]-emblem.png. Não invente uma conquista do jogo. Se não houver dados suficientes para identificar a conquista correta, marque como pendente e faça uma recomendação claramente identificada.",
    "",
    "FORMATO OBRIGATÓRIO DA RESPOSTA",
    "A. Diagnóstico da identidade do jogo (fatos confirmados e incertezas).",
    "B. Relatório visual do ZIP, com DNA comum e diferenças entre as referências.",
    "C. Conceito exclusivo deste Emblema e justificativa da relação com o jogo.",
    "D. Direção de arte detalhada: silhueta, moldura, topo, laterais, base, símbolo central, cenário interno, materiais, paleta com cores nomeadas, iluminação, composição e legibilidade.",
    "E. Especificação exata das duas placas: nome do jogo na placa principal; plataforma cadastrada na placa secundária logo abaixo; estilo tipográfico legível e coerente com o jogo.",
    "F. Lista do que evitar para não repetir as referências nem criar ruído visual.",
    "G. Metadados propostos: nome do Emblema, conquista real de desbloqueio, descrição e tags.",
    "H. BRIEFING FINAL PARA O PROMPT 02, autocontido, específico e pronto para copiar, incluindo todos os requisitos técnicos e instruções para gerar UMA imagem.",
    "",
    "CHECKLIST ANTES DE ENTREGAR",
    "Confirme que o conceito serve a este jogo; adapta cores e materiais em vez de impor uma paleta universal; não copia uma moldura existente; preserva a qualidade da coleção; inclui as duas placas legíveis; deixa margens seguras; e especifica transparência real. Não gerar imagem nesta etapa."
  ].join("\n");
}

function buildUniversalPrompt02(
  game: SiteGame,
  emblem: GameEmblemInput,
  tagsText: string
) {
  const tags = readTags(tagsText);
  const title = readText(emblem.title).trim() || "Use o nome definido no briefing do Prompt 01";
  const unlockAchievement = readText(emblem.unlockAchievement).trim() || "Use a conquista real identificada e validada no briefing do Prompt 01";
  const description = readText(emblem.description).trim() || "Use/refine a descrição temática proposta no briefing do Prompt 01";
  const gameTitle = readText(game.title, "Jogo não informado");
  const platform = readText(game.platform, "Plataforma não informada");
  return [
    "RUMO À CONQUISTA — PROMPT 02 — GERAÇÃO DO EMBLEMA UNIVERSAL V4",
    "",
    "EXECUTE A ARTE AGORA. Use o BRIEFING FINAL PARA O PROMPT 02 produzido pelo Prompt 01 nesta conversa. Se o briefing não estiver disponível no contexto, peça para eu colá-lo antes de gerar. Se estiver trabalhando em uma nova conversa, eu também anexarei o ZIP com os Emblemas de referência; examine as imagens antes de criar.",
    "",
    "DADOS DO CADASTRO — PRESERVAR E CONFERIR COM O BRIEFING",
    `Jogo: ${gameTitle}`,
    `Plataforma: ${platform}`,
    `Slug/arquivo sugerido: ${readText(game.slug)}-emblem.png`,
    `Título atual/proposto: ${title}`,
    `Conquista de desbloqueio: ${unlockAchievement}`,
    `Descrição: ${description}`,
    `Tags: ${tags.length ? tags.join(", ") : "Usar as tags definidas no briefing"}`,
    "",
    "REGRA DE PRECEDÊNCIA",
    "O briefing aprovado do Prompt 01 define a identidade visual específica deste jogo: conceito, silhueta, elementos, cores, materiais e composição. Estas especificações V4 definem o formato, acabamento e critérios técnicos. Se faltar uma informação crucial, pergunte antes de inventar. Não substitua o briefing por um emblema genérico.",
    "",
    "ESPECIFICAÇÕES DE GERAÇÃO — OBRIGATÓRIAS",
    "- Gere exatamente UMA imagem final de Emblema. Não gerar alternativas, folhas de contato, colagem, comparação, díptico ou múltiplas versões.",
    "- Proporção 1:1; canvas quadrado de 1024x1024 px; saída PNG.",
    "- O objeto tem silhueta visual predominantemente vertical e ocupa cerca de 80–88% da altura do canvas, centralizado e sem cortes. Deixe espaço seguro acima do topo e abaixo da base.",
    "- O exterior da silhueta deve ter transparência alpha real. Não simular alpha com padrão quadriculado; não colocar fundo sólido, cenário de apresentação, mockup ou uma placa quadrada por trás do objeto.",
    "- A peça precisa parecer um artefato colecionável premium com profundidade 3D, volumes e relevos coerentes, materiais convincentes, detalhes intencionais, luz dramática e contraste controlado. Evite brilho/glow excessivo e ruído de microdetalhes.",
    "- O símbolo central é o ponto focal e ocupa aproximadamente 60–75% da área útil do Emblema, adaptando-se à composição sem ocultar as formas essenciais.",
    "- A moldura, a paleta, os ornamentos e os materiais DEVEM seguir a identidade específica do jogo definida no briefing. Não reutilizar moldura igual para jogos diferentes; não copiar literalmente as referências do ZIP.",
    `- A placa principal deve conter exatamente o nome do jogo: ${gameTitle}. Tipografia integrada à peça, visualmente coerente com o jogo e legível em tamanho pequeno.`,
    `- Abaixo da placa principal, incluir uma placa secundária menor com exatamente: ${platform}.`,
    "- O nome do jogo e a plataforma são os únicos textos permitidos dentro da arte, salvo se o briefing justificar explicitamente outro texto físico curto. Não criar letras aleatórias nem texto ilegível.",
    "- Todos os detalhes, adornos, placas, pontas, asas, armas e efeitos devem permanecer dentro da silhueta externa do Emblema. Nada deve ser cortado pelas bordas do canvas.",
    "- Personagens apenas quando apropriados ao conceito e permitidos. Se houver bloqueio ou risco de imitação, preserve a identidade por meio de atmosfera, materiais, símbolos, arquitetura e formas originais, sem abandonar o tema.",
    "",
    "ENTREGA",
    "Produza a imagem final diretamente. Não mostre rascunhos, instruções em forma de imagem, mockups nem variações. Depois da imagem, forneça em texto separado: nome exclusivo do Emblema; conquista de desbloqueio (não inventar; indicar pendência se não foi possível verificar); descrição temática curta; tags; nome de arquivo sugerido. Não afirme que a transparência alpha foi validada se o arquivo gerado não permitir confirmar isso."
  ].join("\n");
}

function buildPromptUsageInstructions(game: SiteGame) {
  return [
    "RUMO À CONQUISTA — COMO USAR OS PROMPTS DO EMBLEMA V4",
    "",
    "1. No Admin, selecione o jogo correto e confira título, plataforma, descrição e a conquista de desbloqueio.",
    "2. Clique em “Baixar ZIP de referências”. O pacote contém os PNGs dos Emblemas existentes e estas instruções V4; ele não inclui o template antigo.",
    "3. Abra uma conversa no ChatGPT, anexe o ZIP de referências e cole o PROMPT 01. Envie. Ele deve analisar e entregar um briefing completo, sem gerar imagem.",
    "4. Leia e aprove o conceito e os metadados. Se algo estiver genérico ou incorreto, peça ajustes no briefing antes de avançar.",
    "5. Na MESMA conversa, cole o PROMPT 02 para que ele use o briefing aprovado. Se iniciar outra conversa, cole também o briefing completo do Prompt 01 e anexe novamente o ZIP de referências.",
    "6. Após gerar, confira a legibilidade do nome do jogo e da plataforma, a moldura, as margens, o tema e a transparência real. Não trate um padrão quadriculado desenhado como alpha.",
    "7. Volte à caixa 05, confira o nome, arquivo/caminho, descrição, tags e conquista de desbloqueio, depois use “Salvar Emblema”. O botão de template antigo está identificado como legado e pode ser ignorado no fluxo V4.",
    "",
    `Jogo selecionado nesta caixa: ${readText(game.title)} (${readText(game.platform, "plataforma não informada")}).`,
    "Importante: os botões de prompt apenas copiam texto para a área de transferência. A geração da arte acontece na conversa em que você colar o Prompt 02."
  ].join("\n");
}

function initialEmblem(game: SiteGame): GameEmblemInput {
  const legacy = game as SiteGame & LegacyEmblemFields;
  const saved =
    game.emblem ??
    legacy.gameEmblem ??
    (legacy.emblemTitle || legacy.emblemImage || legacy.emblemDescription || legacy.emblemTags || legacy.emblemUnlockedAt || legacy.emblemUnlockAchievement
      ? {
          title: legacy.emblemTitle,
          image: legacy.emblemImage,
          description: legacy.emblemDescription,
          tags: legacy.emblemTags,
          unlockedAt: legacy.emblemUnlockedAt,
          unlockAchievement: legacy.emblemUnlockAchievement,
          configured: false,
        }
      : undefined);

  if (saved) {
    return {
      title: readText(saved.title, "Emblema do Jogo"),
      image: readText(saved.image, automaticEmblemPath(game.slug)),
      description: readText(saved.description),
      tags: readTags(saved.tags),
      unlockAchievement: readText(saved.unlockAchievement, readText(legacy.emblemUnlockAchievement)).trim(),
      unlockedAt:
        readText(saved.unlockedAt).trim() ||
        (saved.configured === true ? "" : getLegacyEmblemUnlockedAt(game)),
      configured: saved.configured === true,
    };
  }

  if (game.slug === "hogwarts-legacy") {
    return {
      title: "Legado Absoluto",
      image: automaticEmblemPath(game.slug),
      description:
        "Uma relíquia simbólica concedida ao bruxo que explorou Hogwarts por completo, dominou seus desafios e revelou todos os segredos deixados pelo legado mágico. O Legado Absoluto representa a conclusão definitiva da jornada e a marca de quem se tornou um verdadeiro guardião dessa história.",
      tags: ["Colecionável", "Emblema Especial", "Hogwarts Legacy"],
      unlockedAt: getLegacyEmblemUnlockedAt(game),
      configured: false,
    };
  }

  return {
    title: "Emblema do Jogo",
    image: automaticEmblemPath(game.slug),
    description: "",
    tags: [],
    unlockedAt: getLegacyEmblemUnlockedAt(game),
    configured: false,
  };
}

export default function GameEmblemEditor({
  game,
  collapsed,
  onToggle,
  onSave,
}: GameEmblemEditorProps) {
  const legacyGame = game as SiteGame & LegacyEmblemFields;
  const incomingEmblem = useMemo(
    () => initialEmblem(game),
    [
      game.slug,
      game.title,
      game.emblem,
      legacyGame.gameEmblem,
      legacyGame.emblemTitle,
      legacyGame.emblemImage,
      legacyGame.emblemDescription,
      legacyGame.emblemTags,
      legacyGame.emblemUnlockedAt,
      legacyGame.emblemUnlockAchievement,
      game.achievementsList,
    ]
  );
  const [emblem, setEmblem] = useState<GameEmblemInput>(() => incomingEmblem);
  const [tagsText, setTagsText] = useState(() => incomingEmblem.tags?.join(", ") ?? "");
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [validationError, setValidationError] = useState("");
  const [imageError, setImageError] = useState(false);
  const [packageState, setPackageState] = useState<PackageState>("idle");
  const [templateFeedback, setTemplateFeedback] = useState("");
  const [promptFeedback, setPromptFeedback] = useState("");
  const [emblemReferences, setEmblemReferences] = useState<EmblemReference[]>([]);
  const [referenceStatus, setReferenceStatus] = useState<"loading" | "ready" | "error">("loading");
  const [referenceError, setReferenceError] = useState("");
  const [referenceRefresh, setReferenceRefresh] = useState(0);

  useEffect(() => {
    setEmblem(incomingEmblem);
    setTagsText(incomingEmblem.tags?.join(", ") ?? "");
    setImageError(false);
    setSaveState("idle");
  }, [incomingEmblem]);

  useEffect(() => {
    const controller = new AbortController();
    setReferenceStatus("loading");
    setReferenceError("");

    void fetch("/api/admin/emblem-reference-batch", {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as {
          references?: EmblemReference[];
          error?: string;
        } | null;

        if (!response.ok) {
          throw new Error(payload?.error || "Não foi possível carregar as referências da coleção.");
        }

        const refs = Array.isArray(payload?.references) ? payload.references : [];
        setEmblemReferences(refs);
        setReferenceStatus("ready");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setEmblemReferences([]);
        setReferenceStatus("error");
        setReferenceError(
          error instanceof Error ? error.message : "Não foi possível carregar as referências da coleção."
        );
      });

    return () => controller.abort();
  }, [referenceRefresh]);

  function update(field: keyof GameEmblemInput, value: string) {
    setEmblem((current) => ({ ...current, [field]: value }));
    if (field === "image") setImageError(false);
    setSaveState("idle");
    setValidationError("");
  }

  async function save() {
    const title = readText(emblem.title).trim();
    const image = readText(emblem.image).trim();
    if (!title || !image) {
      setSaveState("error");
      setValidationError(!title && !image
        ? "Informe o título e o caminho/URL da imagem antes de salvar."
        : !title
          ? "Informe o título do emblema antes de salvar."
          : "Informe o caminho ou URL da imagem antes de salvar.");
      return;
    }

    setSaving(true);
    setSaveState("idle");
    setValidationError("");

    const payload: GameEmblemInput = {
      title,
      image,
      description: readText(emblem.description).trim(),
      tags: readTags(tagsText),
      unlockedAt: readText(emblem.unlockedAt).trim(),
      unlockAchievement: readText(emblem.unlockAchievement).trim(),
      updatedAt: new Date().toISOString(),
      configured: true,
    };

    try {
      const ok = await onSave(payload);
      setSaveState(ok ? "saved" : "error");
      if (ok) setReferenceRefresh((current) => current + 1);
    } catch {
      setSaveState("error");
    } finally {
      setSaving(false);
    }
  }


  const emblemTemplate = useMemo(
    () => buildEmblemTemplate(game, emblem, tagsText, emblemReferences),
    [game, emblem, tagsText, emblemReferences]
  );

  async function copyTemplate() {
    try {
      await navigator.clipboard.writeText(emblemTemplate);
      setTemplateFeedback("Template copiado. Para que ele compare as molduras de verdade, anexe também o ZIP de referências.");
      setPackageState("idle");
    } catch {
      setTemplateFeedback("A cópia automática não funcionou. Verifique a permissão da área de transferência e tente novamente.");
    }
  }

  async function downloadReferencePackage() {
    setPackageState("downloading");
    setTemplateFeedback("");
    try {
      const response = await fetch("/api/admin/emblem-reference-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: `${game.slug}-referencias-emblemas.zip`,
          gameSlug: game.slug,
          packageText: usageInstructions,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Não foi possível montar o pacote de referências.");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${game.slug}-referencias-emblemas.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      const count = response.headers.get("X-Emblem-Reference-Count") || "10";
      setTemplateFeedback(`ZIP baixado com ${count} imagens de referência e instruções V4 para ${game.title}. Anexe-o à conversa junto do Prompt 01.`);
      setPackageState("idle");
    } catch (error) {
      setPackageState("error");
      setTemplateFeedback(error instanceof Error ? error.message : "Não foi possível montar o pacote de referências.");
    }
  }

  const prompt01 = useMemo(
    () => buildUniversalPrompt01(game, emblem, tagsText),
    [game, emblem, tagsText]
  );
  const prompt02 = useMemo(
    () => buildUniversalPrompt02(game, emblem, tagsText),
    [game, emblem, tagsText]
  );
  const usageInstructions = useMemo(
    () => buildPromptUsageInstructions(game),
    [game]
  );

  async function copyPrompt(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setPromptFeedback(`${label} copiado. Use o ZIP de referências conforme as instruções.`);
    } catch {
      setPromptFeedback(`Não foi possível copiar automaticamente ${label.toLowerCase()}. Verifique a permissão da área de transferência e tente novamente.`);
    }
  }

  const imageSrc = readText(emblem.image).trim();
  const hasSavedData = Boolean(
    game.emblem?.title ||
      game.emblem?.image ||
      game.emblem?.description ||
      game.emblem?.tags?.length ||
      game.emblem?.unlockAchievement ||
      legacyGame.gameEmblem?.title ||
      legacyGame.gameEmblem?.image ||
      legacyGame.gameEmblem?.description ||
      legacyGame.gameEmblem?.tags?.length ||
      legacyGame.emblemTitle ||
      legacyGame.emblemImage ||
      legacyGame.emblemDescription ||
      readTags(legacyGame.emblemTags).length ||
      legacyGame.emblemUnlockAchievement
  );

  return (
    <section className="rounded-[20px] border border-white/[0.08] bg-[#090909] p-5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="group flex w-full items-center justify-between gap-4 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-14 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/40">
            {imageSrc && !imageError ? (
              <img
                key={imageSrc}
                src={imageSrc}
                alt=""
                className="h-full w-full object-contain"
                onError={() => setImageError(true)}
              />
            ) : (
              <span aria-hidden="true" className="text-xl text-white/30">◇</span>
            )}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[9px] font-black uppercase tracking-[0.18em] text-white/35">05</span>
            <span className="mt-1 text-xl font-black text-white transition-colors group-hover:text-red-100">Emblema</span>
            <span className="mt-1 truncate text-xs text-white/45">
              {readText(emblem.title).trim() || "Emblema do Jogo"}
              {" · "}
              {hasSavedData ? "Emblema cadastrado" : "Configure o emblema deste jogo"}
            </span>
          </span>
        </span>
        <span aria-hidden="true" className="shrink-0 text-lg font-black text-white/45 transition-colors group-hover:text-red-300">
          {collapsed ? "+" : "−"}
        </span>
      </button>

      {!collapsed && (
        <>
        <div className="mt-5 rounded-2xl border border-violet-300/20 bg-violet-400/[0.04] p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h4 className="text-sm font-black text-white">Novo fluxo universal de Emblemas V4</h4>
              <p className="mt-1 max-w-[760px] text-xs leading-relaxed text-white/50">
                Fluxo antes do cadastro: 1) baixe o ZIP; 2) copie e execute o Prompt 01; 3) aprove o briefing e só depois copie e execute o Prompt 02. O template antigo permanece identificado como legado para comparação.
              </p>
            </div>
            <span className="w-fit rounded-full border border-amber-300/20 bg-amber-300/[0.07] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-amber-100">Em teste</span>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <button
              type="button"
              onClick={() => void downloadReferencePackage()}
              disabled={packageState === "downloading"}
              className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-3 text-left text-[10px] font-black uppercase leading-relaxed tracking-[0.06em] text-emerald-100 transition hover:bg-emerald-400/15 disabled:opacity-40"
            >
              {packageState === "downloading" ? "Montando ZIP..." : "1. 📦 Baixar ZIP de referências"}
            </button>
            <button
              type="button"
              onClick={() => void copyPrompt(prompt01, "Prompt 01 — análise e projeto")}
              className="rounded-xl border border-violet-300/30 bg-violet-400/10 px-3 py-3 text-left text-[10px] font-black uppercase leading-relaxed tracking-[0.06em] text-violet-100 transition hover:bg-violet-400/15"
            >
              2. 📋 Copiar Prompt 01 — Análise e projeto
            </button>
            <button
              type="button"
              onClick={() => void copyPrompt(usageInstructions, "Instruções de uso")}
              className="rounded-xl border border-sky-300/25 bg-sky-400/[0.07] px-3 py-3 text-left text-[10px] font-black uppercase leading-relaxed tracking-[0.06em] text-sky-100 transition hover:bg-sky-400/10"
            >
              🧭 Copiar instruções de uso
            </button>
            <button
              type="button"
              onClick={() => void copyPrompt(prompt02, "Prompt 02 — geração da arte")}
              className="rounded-xl border border-emerald-300/25 bg-emerald-400/[0.07] px-3 py-3 text-left text-[10px] font-black uppercase leading-relaxed tracking-[0.06em] text-emerald-100 transition hover:bg-emerald-400/10"
            >
              3. 🎨 Copiar Prompt 02 — Gerar arte
            </button>
          </div>
          {promptFeedback && (
            <p className="mt-3 text-xs font-bold leading-relaxed text-emerald-200" role="status">
              {promptFeedback}
            </p>
          )}
          {templateFeedback && (
            <p className={packageState === "error" ? "mt-3 text-xs font-bold leading-relaxed text-red-200" : "mt-3 text-xs font-bold leading-relaxed text-emerald-200"} role="status">
              {templateFeedback}
            </p>
          )}
          <p className="mt-3 text-[10px] leading-relaxed text-white/35">
            Etapa 2: o Prompt 01 não deve gerar imagens. Etapa 3: o Prompt 02 depende do briefing aprovado. O ZIP contém os PNGs reais da coleção e um arquivo de instruções V4, sem o template antigo. Anexe o ZIP na conversa junto do Prompt 01. Os botões de prompt só copiam texto; a geração é feita na conversa do ChatGPT.
          </p>
        </div>


        <div className="mt-5 border-t border-white/[0.07] pt-5">
          <h4 className="text-sm font-black text-white">Cadastro e arte final</h4>
          <p className="mt-1 text-xs leading-relaxed text-white/45">Preencha ou revise estes campos depois de aprovar a arte gerada.</p>
        </div>
        <div className="mt-5 grid gap-5 border-t border-white/[0.07] pt-5 lg:grid-cols-[190px_minmax(0,1fr)]">
          <div>
            <div className="relative flex min-h-[210px] items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/30 p-3">
              {imageSrc && !imageError ? (
                <img
                  key={imageSrc}
                  src={imageSrc}
                  alt={readText(emblem.title, "Emblema do Jogo")}
                  className="max-h-[290px] w-full object-contain"
                  onError={() => setImageError(true)}
                />
              ) : (
                <div className="px-3 text-center">
                  <span className="text-4xl text-white/25">◇</span>
                  <p className="mt-2 text-xs font-bold text-white/45">A imagem ainda não foi encontrada.</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-white/25">Confira o caminho ou informe uma URL válida no campo ao lado.</p>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => update("image", automaticEmblemPath(game.slug))}
              className="mt-3 w-full rounded-xl border border-cyan-400/25 bg-cyan-500/[0.06] px-3 py-2.5 text-[9px] font-black uppercase tracking-[0.08em] text-cyan-200"
            >
              Usar caminho automático
            </button>
          </div>

          <div className="min-w-0 space-y-4">
            <label className="block">
              <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Título do emblema</span>
              <input
                value={readText(emblem.title)}
                onChange={(event) => update("title", event.target.value)}
                placeholder="Ex.: Legado Absoluto"
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
            </label>

            <label className="block">
              <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Imagem do emblema (caminho ou URL)</span>
              <input
                value={readText(emblem.image)}
                onChange={(event) => update("image", event.target.value)}
                placeholder={automaticEmblemPath(game.slug)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
              <span className="mt-1 block text-[10px] leading-relaxed text-white/30">A prévia mostra a arte que será usada na página pública. Para arquivos locais, coloque a imagem em public/images/games/{game.slug}/.</span>
            </label>

            <label className="block">
              <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Descrição</span>
              <textarea
                value={readText(emblem.description)}
                onChange={(event) => update("description", event.target.value)}
                rows={3}
                placeholder="Descreva o significado deste emblema."
                className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold leading-relaxed text-white outline-none focus:border-red-500/40"
              />
            </label>

            <label className="block">
              <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Conquista necessária para desbloquear o Emblema</span>
              <input
                value={readText(emblem.unlockAchievement)}
                onChange={(event) => update("unlockAchievement", event.target.value)}
                placeholder="Selecione o nome real da conquista final"
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
              <span className="mt-1 block text-[10px] leading-relaxed text-white/30">Use o nome de uma conquista existente. Esse dado será salvo junto do Emblema e incluído nos prompts.</span>
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Tags</span>
                <input
                  value={tagsText}
                  onChange={(event) => {
                    setTagsText(event.target.value);
                    setSaveState("idle");
                  }}
                  placeholder="Colecionável, Emblema Especial"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
                />
              </label>
              <label className="block">
                <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Data de conquista (opcional)</span>
                <input
                  value={readText(emblem.unlockedAt)}
                  onChange={(event) => update("unlockedAt", event.target.value)}
                  placeholder="AAAA-MM-DD"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
                />
                <span className="mt-1 block text-[10px] leading-relaxed text-white/30">Preencher esta data marca o emblema como conquistado na página do jogo.</span>
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/[0.07] pt-4">
              {saveState === "saved" && <span role="status" className="text-xs font-bold text-emerald-200">Emblema salvo com sucesso.</span>}
              {validationError && <span role="alert" className="text-xs font-bold text-red-200">{validationError}</span>}
              {saveState === "error" && !validationError && <span role="alert" className="text-xs font-bold text-red-200">Não foi possível salvar o emblema. Verifique a conexão e tente novamente.</span>}
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-5 py-3 text-xs font-black uppercase tracking-[0.12em] text-emerald-100 transition hover:bg-emerald-500/15 disabled:opacity-50"
              >
                {saving ? "Salvando..." : saveState === "saved" ? "✓ Emblema salvo" : "Salvar Emblema"}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-4">
              <span className="mr-1 text-[9px] font-black uppercase tracking-[0.1em] text-white/30">Opção antiga — legado</span>
              <button
                type="button"
                onClick={() => void copyTemplate()}
                className="rounded-xl border border-violet-300/30 bg-violet-400/10 px-4 py-3 text-[9px] font-black uppercase tracking-[0.08em] text-violet-100"
              >
                📋 Copiar template antigo (legado)
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 border-t border-white/[0.08] pt-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h4 className="text-sm font-black text-white">Emblemas existentes — referências da coleção</h4>
              <p className="mt-1 max-w-[760px] text-xs leading-relaxed text-white/45">
                A galeria e o ZIP usam a mesma seleção dinâmica: até os 10 Emblemas com imagens válidas mais recentes. A análise compara silhuetas, molduras, materiais, paletas e símbolos para evitar repetir a identidade visual de peças anteriores.
              </p>
            </div>
            <span className="text-[9px] font-black uppercase tracking-[0.1em] text-white/35">
              {referenceStatus === "loading" ? "Carregando..." : `${emblemReferences.length} referências válidas`}
            </span>
          </div>
          {referenceStatus === "error" && (
            <p role="alert" className="mt-4 rounded-xl border border-red-400/20 bg-red-400/[0.05] p-3 text-xs leading-relaxed text-red-200">
              {referenceError || "Não foi possível carregar as referências."}
            </p>
          )}
          {referenceStatus === "ready" && emblemReferences.length === 0 && (
            <p className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[0.04] p-3 text-xs leading-relaxed text-amber-100">
              Ainda não há Emblemas salvos com imagens válidas para usar como referência.
            </p>
          )}
          {emblemReferences.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {emblemReferences.map((reference, index) => (
                <div key={reference.slug} className="relative min-w-0 rounded-xl border border-white/[0.08] bg-black/25 p-2">
                  <span className="absolute left-3 top-3 z-10 rounded-md border border-white/10 bg-black/75 px-1.5 py-0.5 text-[9px] font-black text-white/70">
                    #{index + 1}
                  </span>
                  <div className="flex h-28 items-center justify-center overflow-hidden rounded-lg bg-black/40 p-1">
                    <img
                      src={reference.image}
                      alt={reference.title}
                      className="h-full w-full object-contain"
                      loading="lazy"
                    />
                  </div>
                  <p className="mt-2 line-clamp-2 min-h-8 text-[10px] font-bold leading-relaxed text-white/60">{reference.title}</p>
                  <p className="mt-1 text-[9px] text-white/25">
                    {reference.updatedAt ? new Date(reference.updatedAt).toLocaleDateString("pt-BR") : "Data não disponível"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
        </>
      )}
    </section>
  );
}

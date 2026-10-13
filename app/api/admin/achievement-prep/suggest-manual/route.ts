import { NextResponse } from "next/server";

type AchievementRank = "Bronze" | "Prata" | "Ouro";
type AchievementSuggestion = {
  title: string;
  description: string;
  rank: AchievementRank;
  rankReason: string;
};

function normalize(value: string) {
  return value
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fallbackSuggestion(note: string): AchievementSuggestion {
  const value = note.trim().replace(/\s+/g, " ");
  const key = normalize(value);
  const difficultyMatch = value.match(/(?:dificuldade|modo)\s+(muito facil|facil|normal|medio|médio|dificil|difícil|muito dificil|muito difícil|hard|nightmare|insano)/i);
  const difficultyRaw = difficultyMatch?.[1] ?? "";
  const difficulty = difficultyRaw
    ? difficultyRaw.charAt(0).toLocaleUpperCase("pt-BR") + difficultyRaw.slice(1).toLocaleLowerCase("pt-BR")
    : "";

  const isCompletion = /\b(finalizei|terminei|conclui|concluí|zerei|completei|finalizar|finalize|concluir|conclua|termine|terminar|complete|completei)\b/.test(key);
  const isWin = /\b(venca|vencer|ganhe|ganhar|ganhei|venci|venceu|vitoria)\b/.test(key);
  const isFirst = /\b(primeiro|primeira|primeiros|primeiras|pela primeira vez)\b/.test(key);
  const gameOrCampaign = /\b(jogo|campanha|historia|historia principal|game|campanha principal)\b/.test(key);
  const isHard = /\b(dificuldade dificil|muito dificil|hard|nightmare|insano|sem tomar dano|sem receber dano|sem morrer|sem ser atingido|no hit|100%|todos os trofeus|todas as conquistas|platina)\b/.test(key);
  const isNormal = /\b(normal|medio|medium)\b/.test(key);
  const isEasy = /\b(facil|easy)\b/.test(key);
  const rank: AchievementRank = isHard
    ? "Ouro"
    : isCompletion && isNormal
      ? "Prata"
      : isCompletion && isEasy
        ? "Bronze"
        : /\b(todos|todas|100%|maximo|maxima|completo|completa)\b/.test(key)
          ? "Ouro"
          : /\b(derrote|derrotar|chefe|boss|complete|finalize|conclua)\b/.test(key)
            ? "Prata"
            : "Bronze";

  let title = "Um Novo Feito";
  if (isWin && /\b(partida|rodada|torneio|duelo|disputa)\b/.test(key) && /\b(cartas|baralho|poker|beisebol)\b/.test(key)) {
    title = isFirst ? "Primeira Cartada Vencedora" : "Vitória na Mesa";
  } else if (isWin && isFirst) {
    title = "Primeira Vitória";
  } else if (isWin && /\b(partida|rodada|torneio|duelo|disputa)\b/.test(key)) {
    title = "Vitória Decisiva";
  } else if (isCompletion && gameOrCampaign && isNormal) title = "Vitória Equilibrada";
  else if (isCompletion && gameOrCampaign && isHard) title = "Prova de Ferro";
  else if (isCompletion && gameOrCampaign && isEasy) title = "Uma Jornada Tranquila";
  else if (isCompletion && gameOrCampaign) title = "Até o Fim";
  else if (/\b(sem tomar dano|sem receber dano|sem ser atingido|no hit)\b/.test(key)) title = "Intocável";
  else if (/\b(um unico tiro|uma unica bala|um so tiro|uma so bala)\b/.test(key)) title = "Um Tiro, Alvo Certo";
  else if (/\b(derrote|derrotar|mate|matar|elimine|eliminar)\b/.test(key)) title = "Precisão Mortal";
  else if (/\b(colete|coletar|encontre|encontrar|pegue|pegar)\b/.test(key)) title = /\b(todos|todas|100%)\b/.test(key) ? "Nada Ficou Para Trás" : "Em Busca do Inesperado";
  else if (/\b(explore|explorar|visite|visitar|descubra|descobrir)\b/.test(key)) title = "Além do Caminho";

  let description = value.replace(/[.!?]+$/, "");
  if (/\b(finalizei|terminei|conclui|concluí|zerei|completei)\b/i.test(description)) {
    description = description.replace(/^(eu\s+)?(finalizei|terminei|conclui|concluí|zerei|completei)\b/i, "Conclua");
  } else if (/\b(matei|mate|mat(ar|e)|eliminei|elimine|derrotei|derrote)\b/i.test(description)) {
    description = description.replace(/^(eu\s+)?(matei|eliminei|derrotei)\b/i, (_match, _prefix, verb) =>
      verb.toLocaleLowerCase("pt-BR") === "matei" ? "Elimine" :
      verb.toLocaleLowerCase("pt-BR") === "eliminei" ? "Elimine" : "Derrote"
    );
  } else if (/\b(coletei|encontrei|peguei|recolhi)\b/i.test(description)) {
    description = description.replace(/^(eu\s+)?(coletei|encontrei|peguei|recolhi)\b/i, (_match, _prefix, verb) => {
      const verbs: Record<string, string> = { coletei: "Colete", encontrei: "Encontre", peguei: "Colete", recolhi: "Recolha" };
      return verbs[String(verb).toLocaleLowerCase("pt-BR")] ?? "Conclua";
    });
  } else if (/\b(ganhei|venci|vençi|conquistei)\b/i.test(description)) {
    description = description.replace(/^(eu\s+)?(ganhei|venci|vençi|conquistei)\b/i, "Conquiste");
  } else if (/\b(finalizar|finalize|concluir|conclua|termine|complete)\b/i.test(description)) {
    description = description.replace(/^(eu\s+)?/i, "");
    description = description.charAt(0).toLocaleUpperCase("pt-BR") + description.slice(1);
  } else {
    description = description.charAt(0).toLocaleUpperCase("pt-BR") + description.slice(1);
  }

  if (difficulty && /\b(jogo|campanha|historia|historia principal)\b/i.test(description) && !/\b(dificuldade|modo)\b/i.test(description)) {
    description = description.replace(/\b(jogo|campanha|historia principal|historia)\b/i, (target) => `${target} na dificuldade ${difficulty}`);
  }
  description = description.replace(/\s+/g, " ").trim();
  if (!/[.!?]$/.test(description)) description += ".";

  return {
    title,
    description,
    rank,
    rankReason: rank === "Ouro"
      ? "O objetivo parece exigir uma execução difícil, completa ou altamente desafiadora."
      : rank === "Prata"
        ? "O objetivo parece exigir uma etapa importante ou uma conclusão de dificuldade intermediária."
        : "O objetivo parece ser uma tarefa direta ou um marco inicial.",
  };
}

function extractOutputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text.trim();
  }
  for (const item of record.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && typeof part.text === "string" && part.text.trim()) {
        return part.text.trim();
      }
    }
  }
  return "";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      note?: unknown;
      gameTitle?: unknown;
      gameContext?: unknown;
      mode?: unknown;
      currentTitle?: unknown;
    };
    const note = typeof body.note === "string" ? body.note.trim() : "";
    const gameTitle = typeof body.gameTitle === "string" ? body.gameTitle.trim().slice(0, 120) : "";
    const mode = body.mode === "rewrite" ? "rewrite" : "create";
    const currentTitle = typeof body.currentTitle === "string" ? body.currentTitle.trim().slice(0, 100) : "";
    const gameContext = Array.isArray(body.gameContext)
      ? body.gameContext.slice(0, 18).flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const value = item as { title?: unknown; description?: unknown };
          const title = typeof value.title === "string" ? value.title.trim().slice(0, 100) : "";
          const description = typeof value.description === "string" ? value.description.trim().slice(0, 200) : "";
          return title ? [{ title, description }] : [];
        })
      : [];

    if (!note) {
      return NextResponse.json({ error: "Escreva uma anotação sobre a conquista." }, { status: 400 });
    }
    if (note.length > 600) {
      return NextResponse.json({ error: "A anotação deve ter até 600 caracteres." }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey && mode === "rewrite") {
      return NextResponse.json({ error: "A IA está indisponível; a conquista original foi mantida sem alterações." }, { status: 503 });
    }
    if (!apiKey) {
      return NextResponse.json({ ...fallbackSuggestion(note), source: "regras", notice: "A chave da IA não está configurada; usei a sugestão automática por regras." });
    }

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        rank: { type: "string", enum: ["Bronze", "Prata", "Ouro"] },
        rankReason: { type: "string" },
      },
      required: ["title", "description", "rank", "rankReason"],
    };

    const requestBody = (model: string) => ({
      model,
      store: false,
      max_output_tokens: 450,
      text: {
        format: {
          type: "json_schema",
          name: "manual_game_achievement",
          strict: true,
          schema,
        },
      },
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                ...(mode === "rewrite"
                  ? [
                      "MODO REESCRITA: o usuário já tem uma conquista pronta e quer apenas uma versão alternativa de título e descrição.",
                      "REGRA ABSOLUTA: preserve exatamente o mesmo objetivo, o mesmo sentido e o mesmo nível de exigência da conquista original. Não troque a tarefa por outra, não aumente nem diminua requisitos e não acrescente objetivos.",
                      "Crie um novo título com palavras e imagem mental diferentes, mas que ainda identifique o mesmo feito. Reescreva a descrição para ficar natural e objetiva, mantendo todas as condições, números, dificuldade, modo e critérios da descrição original.",
                      "Não use a anotação original como um novo objetivo: use o título e a descrição atuais como fonte principal de verdade. As referências de outras conquistas servem apenas para manter o estilo do jogo.",
                      "O rank retornado deve permanecer equivalente ao esforço do objetivo original; a interface manterá o rank já escolhido pelo usuário.",
                    ]
                  : []),
                "Você é diretor criativo e game designer de conquistas personalizadas do projeto Rumo à Conquista.",
                "Transforme a anotação informal do usuário em uma conquista que pareça pertencer especificamente a esse jogo, em português brasileiro.",
                "Use o título do jogo e as conquistas existentes fornecidas como contexto para identificar tom, universo, vocabulário, atividades, itens e mecânicas. Quando uma referência existente se conectar à anotação, aproveite essa conexão com criatividade.",
                "Não copie títulos de conquistas existentes. Não invente personagens, locais, armas, chefes, itens, missões ou mecânicas que não estejam na anotação, no contexto fornecido ou que você não conheça com segurança. Se não houver evidência suficiente sobre a lore, seja criativo a partir da ação concreta descrita sem fingir conhecer detalhes.",
                "Retorne somente os quatro campos do JSON definido no schema.",
                "TÍTULO: 2 a 6 palavras, marcante, específico e com cara de conquista oficial. Nomeie o feito real — ação, objeto, partida, habilidade, desafio ou marco — em vez de usar rótulos genéricos como 'Um Novo Feito', 'Novo Desafio' ou 'Até o Fim', a menos que essa seja genuinamente a melhor síntese do objetivo.",
                "DESCRIÇÃO: uma frase clara e natural no imperativo, pronta para aparecer numa lista de conquistas. Explique exatamente o que o jogador precisa fazer; corrija a gramática; preserve números, dificuldade, modo e detalhes concretos. Não acrescente condições que não foram informadas.",
                "RANK: Bronze para tarefas simples ou marcos iniciais; Prata para objetivos intermediários ou conclusão em Normal; Ouro para desafios difíceis, 100%, sem dano, dificuldade elevada ou grandes séries de tarefas. Classifique o esforço real exigido, não o quão épico o título soa.",
                "RANK REASON: uma frase curta e específica explicando a exigência do objetivo, sem exagerar ou apenas repetir a descrição.",
                "Se a anotação descreve algo que já aconteceu, transforme-o em objetivo que outra pessoa poderia cumprir. Preserve a intenção do usuário mesmo se a frase estiver incompleta ou coloquial.",
                "Não invente EP, data, colecionáveis, chefes ou requisitos. O texto deve fazer sentido tanto para a mecânica descrita quanto para o jogo indicado.",
              ].join("\n"),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                modo: mode,
                jogo: gameTitle || "Jogo não especificado",
                tituloAtual: currentTitle,
                anotacao: note,
                referenciasDeConquistasExistentes: gameContext,
              }),
            },
          ],
        },
      ],
    });
    const endpoint = "https://api.openai.com/v1/responses";
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    const configuredModel = process.env.OPENAI_ACHIEVEMENT_MODEL?.trim() || "gpt-5-mini";
    let apiResponse = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody(configuredModel)),
      cache: "no-store",
    });

    // Retry once with a supported default if a saved custom model name is invalid.
    if (!apiResponse.ok && configuredModel !== "gpt-5-mini" && [400, 404].includes(apiResponse.status)) {
      const detail = await apiResponse.clone().text().catch(() => "");
      if (/model|not found|does not exist|unsupported|invalid/i.test(detail)) {
        apiResponse = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody("gpt-5-mini")),
          cache: "no-store",
        });
      }
    }

    if (!apiResponse.ok) {
      const detail = await apiResponse.text().catch(() => "");
      console.error("[Achievement Suggestion] OpenAI response:", apiResponse.status, detail.slice(0, 800));
      if (mode === "rewrite") {
        return NextResponse.json({ error: "Não foi possível gerar uma alternativa agora. A conquista original continua intacta; tente novamente." }, { status: 503 });
      }
      return NextResponse.json({ ...fallbackSuggestion(note), source: "regras", notice: "A IA não respondeu; usei a sugestão automática por regras." });
    }

    const payload: unknown = await apiResponse.json();
    const raw = extractOutputText(payload);
    if (!raw) {
      if (mode === "rewrite") {
        return NextResponse.json({ error: "A IA não retornou uma alternativa válida. A conquista original continua intacta; tente novamente." }, { status: 503 });
      }
      return NextResponse.json({ ...fallbackSuggestion(note), source: "regras", notice: "A IA não retornou uma sugestão válida; usei regras automáticas." });
    }

    let suggestion: unknown;
    try {
      suggestion = JSON.parse(raw);
    } catch {
      const firstBrace = raw.indexOf("{");
      const lastBrace = raw.lastIndexOf("}");
      const jsonText =
        firstBrace >= 0 && lastBrace > firstBrace
          ? raw.slice(firstBrace, lastBrace + 1)
          : raw;
      suggestion = JSON.parse(jsonText);
    }

    const candidate = suggestion as Partial<AchievementSuggestion>;
    if (
      typeof candidate.title !== "string" ||
      !candidate.title.trim() ||
      typeof candidate.description !== "string" ||
      !candidate.description.trim() ||
      !["Bronze", "Prata", "Ouro"].includes(String(candidate.rank)) ||
      typeof candidate.rankReason !== "string"
    ) {
      if (mode === "rewrite") {
        return NextResponse.json({ error: "A alternativa gerada não passou na validação. A conquista original continua intacta." }, { status: 503 });
      }
      return NextResponse.json({ ...fallbackSuggestion(note), source: "regras", notice: "A IA não retornou todos os campos; usei regras automáticas." });
    }

    return NextResponse.json({
      title: candidate.title.trim().slice(0, 80),
      description: candidate.description.trim().slice(0, 240),
      rank: candidate.rank,
      rankReason: candidate.rankReason.trim().slice(0, 180),
      source: "ia",
    });
  } catch (error) {
    console.error("[Achievement Suggestion] Error:", error);
    return NextResponse.json({ error: "Não foi possível preparar a sugestão. Tente novamente." }, { status: 500 });
  }
}

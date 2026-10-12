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
  if (isCompletion && gameOrCampaign && isNormal) title = "Vitória Equilibrada";
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
    const body = (await request.json()) as { note?: unknown; gameTitle?: unknown };
    const note = typeof body.note === "string" ? body.note.trim() : "";
    const gameTitle = typeof body.gameTitle === "string" ? body.gameTitle.trim().slice(0, 120) : "";

    if (!note) {
      return NextResponse.json({ error: "Escreva uma anotação sobre a conquista." }, { status: 400 });
    }
    if (note.length > 600) {
      return NextResponse.json({ error: "A anotação deve ter até 600 caracteres." }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
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

    const apiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_ACHIEVEMENT_MODEL?.trim() || "gpt-6-luna",
        store: false,
        max_output_tokens: 350,
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
                  "Você é editor de conquistas de videogames do projeto Rumo à Conquista.",
                  "O usuário fornece uma anotação informal do que fez ou quer registrar. Transforme-a em uma conquista de videogame em português brasileiro.",
                  "Retorne somente os quatro campos do JSON definido no schema.",
                  "TÍTULO: curto, memorável, natural, com cara de conquista; idealmente de 2 a 6 palavras. Não copie a anotação inteira e não invente detalhes do jogo.",
                  "DESCRIÇÃO: uma frase objetiva no imperativo, dizendo exatamente o que precisa ser feito. Corrija a gramática e preserve a dificuldade/modo e os números citados. Não acrescente requisitos ausentes na anotação.",
                  "RANK: Bronze para marcos simples ou tarefas diretas; Prata para objetivos intermediários ou concluir o jogo em dificuldade Normal; Ouro para objetivos difíceis, 100%, sem dano, dificuldade elevada ou grandes séries de tarefas. Julgue a exigência descrita, não a raridade do título.",
                  "RANK REASON: justifique em uma frase curta, sem exagerar e sem repetir a descrição.",
                  "Se a anotação descreve algo que já aconteceu, reescreva como objetivo que alguém pode cumprir.",
                  "Não invente EP, data, colecionáveis, chefes ou outras condições que não foram fornecidas.",
                  "O resultado precisa ser específico à anotação, não uma lista genérica de nomes.",
                ].join("\n"),
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({ jogo: gameTitle || "Jogo não especificado", anotacao: note }),
              },
            ],
          },
        ],
      }),
      cache: "no-store",
    });

    if (!apiResponse.ok) {
      const detail = await apiResponse.text().catch(() => "");
      console.error("[Achievement Suggestion] OpenAI response:", apiResponse.status, detail.slice(0, 800));
      return NextResponse.json({ ...fallbackSuggestion(note), source: "regras", notice: "A IA não respondeu; usei a sugestão automática por regras." });
    }

    const payload: unknown = await apiResponse.json();
    const raw = extractOutputText(payload);
    if (!raw) {
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

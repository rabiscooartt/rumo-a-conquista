import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/lib/admin-auth";

type ReviewAnswers = Record<string, unknown>;

function readText(value: unknown, maxLength = 4000) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim().slice(0, maxLength);
}

function limitText(value: unknown, maxLength: number) {
  const normalized = readText(value, 2000).replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const fragment = normalized.slice(0, maxLength + 1);
  const lastSpace = fragment.lastIndexOf(" ");
  return (lastSpace > Math.floor(maxLength * 0.7) ? fragment.slice(0, lastSpace) : fragment.slice(0, maxLength)).trim();
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!(await verifyAdminSession(token))) {
    return NextResponse.json({ error: "Entre no modo Admin para gerar a review." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "A chave da API de IA não está configurada no ambiente de produção." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const body = (await request.json()) as { gameTitle?: unknown; answers?: ReviewAnswers };
    const gameTitle = readText(body.gameTitle, 160);
    const answers = body.answers && typeof body.answers === "object" && !Array.isArray(body.answers) ? body.answers : {};
    if (!gameTitle) {
      return NextResponse.json({ error: "Selecione um jogo antes de gerar o resumo." }, { status: 400 });
    }

    const normalizedAnswers = {
      historia: readText(answers.historia),
      jogabilidade: readText(answers.jogabilidade),
      direcaoArtistica: readText(answers.direcaoArtistica),
      trilhaSonora: readText(answers.trilhaSonora),
      progressaoConquistas: readText(answers.progressaoConquistas),
      pontosPositivos: readText(answers.pontosPositivos),
      pontosNegativos: readText(answers.pontosNegativos),
      experienciaPessoal: readText(answers.experienciaPessoal),
      notaFinal: readText(answers.notaFinal, 20),
      recomendacao: readText(answers.recomendacao, 40),
      recomendacaoExplicacao: readText(answers.recomendacaoExplicacao),
      resumoDaExperiencia: readText(answers.resumoDaExperiencia),
    };
    const hasContent = [
      normalizedAnswers.historia,
      normalizedAnswers.jogabilidade,
      normalizedAnswers.direcaoArtistica,
      normalizedAnswers.trilhaSonora,
      normalizedAnswers.progressaoConquistas,
      normalizedAnswers.pontosPositivos,
      normalizedAnswers.pontosNegativos,
      normalizedAnswers.experienciaPessoal,
      normalizedAnswers.recomendacaoExplicacao,
      normalizedAnswers.resumoDaExperiencia,
    ].some(Boolean);
    if (!hasContent) {
      return NextResponse.json({ error: "Preencha pelo menos uma resposta da ficha antes de gerar o resumo." }, { status: 400 });
    }

    const apiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.5,
        max_tokens: 700,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "rumo_a_conquista_review",
            strict: true,
            schema: {
              type: "object",
              properties: {
                titulo: { type: "string" },
                resumoPrincipal: { type: "string" },
                fraseCartao: { type: "string" },
                resumo: { type: "string" },
              },
              required: ["titulo", "resumoPrincipal", "fraseCartao", "resumo"],
              additionalProperties: false,
            },
          },
        },
        messages: [
          {
            role: "system",
            content: "Você é o editor responsável pelos reviews do Rumo à Conquista. Escreva em português brasileiro natural, claro, bem revisado e sem repetições. Leia a ficha inteira antes de escrever e conecte as respostas para produzir uma avaliação que faça sentido como um todo. Use exclusivamente informações, observações e opiniões que o usuário forneceu; nunca invente acontecimentos, personagens, mecânicas, qualidade técnica ou sentimentos. Não transforme respostas curtas em afirmações fortes que elas não sustentam. Quando um campo estiver vazio, não presuma a opinião do usuário sobre esse aspecto. Respeite os pontos positivos e negativos, a experiência pessoal, a recomendação e a nota informada, sem mudar o julgamento do autor. Gere exatamente quatro campos: titulo (título curto, específico e natural, que reflita o principal aspecto da experiência; evite título genérico e não repita o nome do jogo à toa); resumoPrincipal (um único parágrafo coerente, aproximadamente 300 caracteres, idealmente entre 260 e 340; apresente a impressão geral e os pontos positivos e limitações mais relevantes mencionados, com transições naturais; não faça lista nem introduza críticas ausentes da ficha); fraseCartao (frase de até 100 caracteres para o cartão da biblioteca, atraente mas concreta, baseada em uma característica realmente descrita); resumo (frase de até 100 caracteres para o cartão de avaliação dentro da página do jogo). As duas frases curtas devem ser complementares, não cópias uma da outra, e ambas precisam combinar com o título e o resumo principal. Não use clichês vazios como “uma aventura incrível”, “uma experiência inesquecível” ou ‐diversão garantida” a menos que a ficha sustente especificamente essa ideia. Evite exageros e contradições; se houver opiniões mistas, represente esse equilíbrio. Não mencione dados ausentes, não explique seu processo e não use Markdown, aspas em volta dos campos ou texto fora do JSON.",
          },
          {
            role: "user",
            content: JSON.stringify({ jogo: gameTitle, ficha: normalizedAnswers }),
          },
        ],
      }),
    });

    const responseBody = (await apiResponse.json().catch(() => null)) as
      | { error?: { message?: string }; choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }> }
      | null;
    if (!apiResponse.ok) {
      const providerMessage = readText(responseBody?.error?.message, 300);
      return NextResponse.json(
        { error: providerMessage || "O serviço de IA não conseguiu gerar o resumo. Tente novamente." },
        { status: apiResponse.status === 429 ? 429 : 502, headers: { "Cache-Control": "no-store" } }
      );
    }

    const content = responseBody?.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ error: "A IA não retornou um resumo. Revise a ficha e tente novamente." }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }

    const parsed = JSON.parse(content) as Record<string, unknown>;
    const result = {
      titulo: limitText(parsed.titulo, 100),
      resumoPrincipal: limitText(parsed.resumoPrincipal, 420),
      fraseCartao: limitText(parsed.fraseCartao, 100),
      resumo: limitText(parsed.resumo, 100),
    };
    if (!result.titulo || !result.resumoPrincipal || !result.fraseCartao || !result.resumo) {
      return NextResponse.json({ error: "O resumo veio incompleto. Clique em Gerar resumo novamente." }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "TimeoutError";
    return NextResponse.json(
      { error: isTimeout ? "A geração demorou demais. Tente novamente." : "Não foi possível gerar o resumo agora. Tente novamente." },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}

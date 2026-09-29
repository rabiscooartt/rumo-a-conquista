import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_ACHIEVEMENTS = 20;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type AchievementInput = {
  id: string;
  name: string;
  description: string;
  visualReferenceUrl: string;
};

type VisualAnalysis = {
  id: string;
  palette: string;
  contrast: string;
  linework: string;
  composition: string;
  atmosphere: string;
  lighting: string;
  texture: string;
  detailDensity: string;
  generalElements: string;
  monochrome: boolean;
  brief: string;
};

function isAllowedReferenceUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      (url.hostname === "exophase.com" ||
        url.hostname.endsWith(".exophase.com"))
    );
  } catch {
    return false;
  }
}

async function fetchReferenceAsDataUrl(url: string) {
  if (!isAllowedReferenceUrl(url)) {
    throw new Error("A referência visual não é uma URL válida do Exophase.");
  }

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; Rumo-a-Conquista/1.0; +https://www.exophase.com/)",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error("O Exophase não entregou uma das imagens de referência.");
  }

  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > MAX_IMAGE_BYTES) {
    throw new Error("Uma das referências do Exophase é maior que 5 MB.");
  }

  const contentType =
    response.headers.get("content-type")?.split(";")[0].trim() || "";

  if (!contentType.startsWith("image/")) {
    throw new Error("Uma das referências retornadas pelo Exophase não é uma imagem.");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error("Uma das referências do Exophase é maior que 5 MB.");
  }

  return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function toVisualBrief(analysis: VisualAnalysis) {
  return [
    `PALETA: ${analysis.palette}`,
    `CONTRASTE: ${analysis.contrast}`,
    `TRAÇO / LINHA: ${analysis.linework}`,
    `COMPOSIÇÃO / ENQUADRAMENTO: ${analysis.composition}`,
    `ATMOSFERA: ${analysis.atmosphere}`,
    `ILUMINAÇÃO: ${analysis.lighting}`,
    `TEXTURA / ACABAMENTO: ${analysis.texture}`,
    `DENSIDADE DE DETALHES: ${analysis.detailDensity}`,
    `ELEMENTOS VISUAIS GERAIS: ${analysis.generalElements}`,
    `MONOCROMÁTICO / PALETA RESTRITA: ${analysis.monochrome ? "SIM" : "NÃO"}`,
    `RESUMO PARA GERAÇÃO: ${analysis.brief}`,
  ].join("\n");
}

async function analyzeWithOpenAI(
  achievements: Array<AchievementInput & { imageDataUrl: string }>
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY não está configurada no Vercel. Adicione a chave da API da OpenAI nas variáveis de ambiente do projeto."
    );
  }

  const model = process.env.OPENAI_VISION_MODEL || "gpt-5.6-luna";

  const content: Array<Record<string, unknown>> = [
    {
      type: "input_text",
      text: [
        "Você é o analista visual do projeto Rumo à Conquista.",
        "Analise cada imagem do Exophase apenas como FONTE DE DADOS VISUAIS.",
        "A sua saída será usada para criar uma nova arte original, portanto NÃO descreva como reproduzir, copiar, redesenhar ou transformar a imagem.",
        "Não nomeie personagens, marcas, logos, franquias, textos legíveis ou ícones proprietários presentes na imagem. Em vez disso, descreva-os de forma abstrata e geral (por exemplo: figura central cartunesca, objeto esportivo, papel impresso, símbolo geométrico).",
        "Ignore palavras, letras, números e nomes como conteúdo visual a reproduzir.",
        "Extraia somente características amplas: paleta, contraste, traço/linha, composição/enquadramento, atmosfera, iluminação, textura/acabamento, densidade de detalhes e categorias gerais de elementos.",
        "Se a imagem for monocromática ou usar uma paleta muito restrita, identifique isso claramente e preserve essa característica.",
        "O brief deve ser específico o suficiente para orientar uma arte nova, mas abstrato o suficiente para não reproduzir a referência.",
        "Escreva tudo em português do Brasil.",
        "Há uma entrada textual antes de cada imagem com ID, nome e descrição da conquista. Use o significado da conquista para contextualizar o que importa na leitura visual, mas nunca invente detalhes que não estão sustentados pela imagem ou pelo texto.",
      ].join("\n"),
    },
  ];

  for (const achievement of achievements) {
    content.push(
      {
        type: "input_text",
        text: [
          `ID: ${achievement.id}`,
          `NOME DA CONQUISTA: ${achievement.name}`,
          `DESCRIÇÃO DA CONQUISTA: ${achievement.description || "Sem descrição disponível."}`,
          "Analise agora somente a referência visual associada a este bloco.",
        ].join("\n"),
      },
      {
        type: "input_image",
        image_url: achievement.imageDataUrl,
        detail: "high",
      }
    );
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        {
          role: "user",
          content,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "achievement_visual_analysis",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              analyses: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    id: { type: "string" },
                    palette: { type: "string" },
                    contrast: { type: "string" },
                    linework: { type: "string" },
                    composition: { type: "string" },
                    atmosphere: { type: "string" },
                    lighting: { type: "string" },
                    texture: { type: "string" },
                    detailDensity: { type: "string" },
                    generalElements: { type: "string" },
                    monochrome: { type: "boolean" },
                    brief: { type: "string" },
                  },
                  required: [
                    "id",
                    "palette",
                    "contrast",
                    "linework",
                    "composition",
                    "atmosphere",
                    "lighting",
                    "texture",
                    "detailDensity",
                    "generalElements",
                    "monochrome",
                    "brief",
                  ],
                },
              },
            },
            required: ["analyses"],
          },
        },
      },
    }),
  });

  const payload = await response.json();

  if (!response.ok) {
    const providerMessage =
      payload?.error?.message ||
      payload?.message ||
      "A API da OpenAI recusou a análise visual.";

    throw new Error(`OpenAI: ${providerMessage}`);
  }

  const outputText = String(payload.output_text ?? "").trim();
  if (!outputText) {
    throw new Error("A OpenAI não retornou um resultado textual para a análise visual.");
  }

  let parsed: { analyses?: VisualAnalysis[] };

  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new Error("A OpenAI retornou uma análise visual em formato inválido.");
  }

  const analyses = Array.isArray(parsed.analyses) ? parsed.analyses : [];
  if (analyses.length !== achievements.length) {
    throw new Error(
      `A análise visual retornou ${analyses.length} item(ns) para ${achievements.length} conquista(s).`
    );
  }

  const expectedIds = new Set(achievements.map((achievement) => achievement.id));
  const returnedIds = new Set<string>();

  for (const analysis of analyses) {
    if (!analysis || !expectedIds.has(analysis.id) || returnedIds.has(analysis.id)) {
      throw new Error("A OpenAI devolveu IDs de conquista inválidos ou duplicados.");
    }
    returnedIds.add(analysis.id);
  }

  if (returnedIds.size !== expectedIds.size) {
    throw new Error("A OpenAI não devolveu uma análise para todas as conquistas enviadas.");
  }

  return analyses.map((analysis) => ({
    ...analysis,
    brief: toVisualBrief(analysis),
  }));
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      achievements?: AchievementInput[];
    };

    const achievements = Array.isArray(body.achievements)
      ? body.achievements
      : [];

    if (!achievements.length) {
      return NextResponse.json(
        { error: "Nenhuma conquista com referência visual foi enviada." },
        { status: 400 }
      );
    }

    if (achievements.length > MAX_ACHIEVEMENTS) {
      return NextResponse.json(
        {
          error: `Envie no máximo ${MAX_ACHIEVEMENTS} conquistas por análise.`,
        },
        { status: 400 }
      );
    }

    const seenIds = new Set<string>();
    const normalized = achievements.map((achievement, index) => {
      const id = String(achievement?.id ?? "").trim();
      const name = String(achievement?.name ?? "").trim();
      const description = String(achievement?.description ?? "").trim();
      const visualReferenceUrl = String(
        achievement?.visualReferenceUrl ?? ""
      ).trim();

      if (!id || !name || !visualReferenceUrl) {
        throw new Error(
          `A conquista ${index + 1} está sem ID, nome ou referência visual.`
        );
      }

      if (seenIds.has(id)) {
        throw new Error(`A conquista "${name}" foi enviada duas vezes.`);
      }

      seenIds.add(id);

      if (!isAllowedReferenceUrl(visualReferenceUrl)) {
        throw new Error(
          `A referência visual de "${name}" não é uma URL válida do Exophase.`
        );
      }

      return { id, name, description, visualReferenceUrl };
    });

    const withImages = await Promise.all(
      normalized.map(async (achievement) => ({
        ...achievement,
        imageDataUrl: await fetchReferenceAsDataUrl(
          achievement.visualReferenceUrl
        ),
      }))
    );

    const analyses = await analyzeWithOpenAI(withImages);

    return NextResponse.json({
      ok: true,
      model: process.env.OPENAI_VISION_MODEL || "gpt-5.6-luna",
      count: analyses.length,
      analyses,
    });
  } catch (error) {
    console.error("[Achievement Visual Analysis]", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível analisar as referências visuais.",
      },
      { status: 400 }
    );
  }
}

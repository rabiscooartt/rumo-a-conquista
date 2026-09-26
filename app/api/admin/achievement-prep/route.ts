import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

type ExophaseAchievement = {
  name?: string;
  description?: string;
  percent?: number;
  visualReferenceUrl?: string | null;
};

function norm(v: unknown) {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slug(v: string) {
  return norm(v).replace(/\s+/g, "-");
}

function rank(p?: number): "Bronze" | "Prata" | "Ouro" {
  if (typeof p !== "number") return "Bronze";
  return p < 5 ? "Ouro" : p < 20 ? "Prata" : "Bronze";
}

function isOnline(name: string, description: string) {
  const text = norm(name + " " + description);
  return [
    "online", "multiplayer", "multijogador", "co op", "coop",
    "cooperative", "cooperativo", "other players", "outros jogadores",
    "pvp", "player versus player", "matchmaking", "server", "servidor",
  ].some((pattern) => text.includes(pattern));
}

function isMomentary(name: string, description: string) {
  const text = norm(name + " " + description);

  if (
    /\bem \d+ segundos?\b/.test(text) ||
    /\bem \d+ minutos?\b/.test(text) ||
    /\b\d+ inimigos? em \d+ segundos?\b/.test(text)
  ) {
    return true;
  }

  return [
    "in a single playthrough",
    "in one playthrough",
    "in a single game",
    "in one game",
    "in a single match",
    "in one match",
    "in a single run",
    "in one run",
    "during the chase",
    "during the escape",
    "during the mission",
    "during the level",
    "during the chapter",
    "before the timer",
    "within the time limit",
    "sem ser atingido",
    "sem tomar dano",
    "em uma unica partida",
    "em uma unica jogada",
    "em uma unica run",
    "em uma unica tentativa",
    "durante a missao",
    "durante o capitulo",
    "durante a fase",
    "antes do tempo acabar",
    "dentro do tempo",
  ].some((pattern) => text.includes(pattern));
}

function isJourneyByCompletion(name: string, description: string) {
  const text = norm(name + " " + description);

  return [
    "complete the campaign",
    "complete the story",
    "complete the game",
    "finish the campaign",
    "finish the story",
    "finish the game",
    "beat the game",
    "wrap up the",
    "resolve the case",
    "concluir a campanha",
    "concluir a historia",
    "concluir o jogo",
    "finalizar a campanha",
    "finalizar a historia",
    "finalizar o jogo",
    "resolver o caso",
    "resolva o caso",
    "complete o caso",
    "conclua o caso",
    "finalize o caso",
  ].some((pattern) => text.includes(pattern));
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(parseInt(code, 16))
    );
}

function stripHtml(value: string) {
  // O Exophase/Jina pode devolver HTML escapado (ex.: &lt;img ...&gt;).
  // Fazemos mais de um ciclo para remover também essas tags depois de
  // decodificadas, evitando que atributos de imagem apareçam na descrição.
  let current = value;

  for (let i = 0; i < 3; i += 1) {
    current = current.replace(/<script[\s\S]*?<\/script>/gi, " ");
    current = current.replace(/<style[\s\S]*?<\/style>/gi, " ");
    current = current.replace(/<[^>]*>/g, " ");
    current = decodeHtml(current);
  }

  return current.replace(/\s+/g, " ").trim();
}

function isPortugueseExophasePage(html: string) {
  return /(?:Conquistas|Portugu(?:ê|e)s(?:\s*\(Brasil\))?|Estatísticas)/i.test(
    html
  );
}

async function findExophaseSteamGame(title: string) {
  // A preparação usa a versão PT-BR do Exophase. Não usamos a página
  // inglesa como fallback, porque títulos e descrições precisam permanecer
  // em português quando a tradução estiver disponível.
  return {
    url:
      "https://www.exophase.com/game/" +
      slug(title) +
      "-steam/achievements/pt-BR/",
  };
}

function parseExophaseHtml(html: string) {
  // Procuramos a abertura do elemento .award-title, e não o primeiro
  // fechamento de tag. Assim títulos com <span>/<a> internos não quebram.
  const titleOpenMatches = Array.from(
    html.matchAll(
      /<([a-z0-9]+)\b[^>]*class=["'][^"']*\baward-title\b[^"']*["'][^>]*>/gi
    )
  );

  if (!titleOpenMatches.length) return null;

  const achievements: ExophaseAchievement[] = titleOpenMatches
    .map((match, index) => {
      const titleStart = (match.index ?? 0) + match[0].length;
      const nextTitleStart =
        index + 1 < titleOpenMatches.length
          ? titleOpenMatches[index + 1].index ?? html.length
          : html.length;

      const chunk = html.slice(titleStart, nextTitleStart);

      // O primeiro fechamento de tag depois da abertura normalmente encerra
      // o <span>/<a> que contém o nome. O stripHtml cuida do restante.
      const titlePart = chunk.split(/<\/[^>]+>/i)[0];
      const title = stripHtml(titlePart);

      if (!title) return null;

      // A arte da conquista no Exophase pode ficar ANTES do .award-title
      // (por exemplo, em <img>, <source> ou background-image). Por isso,
      // procurar somente no texto depois do título perde a referência.
      // O bloco abaixo vai do fim do título anterior até o início do título atual,
      // preservando a região visual associada à conquista atual.
      const previousTitleEnd =
        index > 0
          ? (titleOpenMatches[index - 1].index ?? 0) +
            titleOpenMatches[index - 1][0].length
          : 0;

      const visualBlock = decodeHtml(
        html.slice(previousTitleEnd, nextTitleStart)
      );

      const visualMatch =
        visualBlock.match(
          /<(?:img|source)\b[^>]*(?:src|data-src|data-original)=["']([^"']+)["']/i
        ) ??
        visualBlock.match(
          /<(?:img|source)\b[^>]*srcset=["']([^"']+)["']/i
        ) ??
        visualBlock.match(
          /background-image\s*:\s*url\(\s*["']?([^"')]+)["']?\s*\)/i
        );

      let rawVisualReference = visualMatch?.[1]?.trim() || null;

      // srcset pode conter várias URLs; usamos a primeira.
      if (rawVisualReference?.includes(",")) {
        rawVisualReference = rawVisualReference.split(",")[0]?.trim() || null;
      }

      // Alguns srcset usam "URL 1x" / "URL 2x".
      if (rawVisualReference) {
        rawVisualReference = rawVisualReference
          .replace(/\s+\d+(?:\.\d+)?x$/i, "")
          .trim();
      }

      const visualReferenceUrl =
        rawVisualReference && !rawVisualReference.startsWith("data:")
          ? new URL(rawVisualReference, "https://www.exophase.com").toString()
          : null;

      // O bloco também contém a descrição, a raridade e o EXP. Depois de
      // limpar o HTML, removemos o título e pegamos a descrição até o %.
      const visible = stripHtml(chunk);
      let detailText = visible;

      if (detailText.toLowerCase().startsWith(title.toLowerCase())) {
        detailText = detailText.slice(title.length).trim();
      }

      const percentMatch = detailText.match(/(\d+(?:\.\d+)?)%/);
      const percent = percentMatch ? Number(percentMatch[1]) : undefined;

      let description = percentMatch
        ? detailText.slice(0, percentMatch.index).trim()
        : detailText.trim();

      description = description
        .replace(/^(?:Image|Imagem)\s+/i, "")
        .replace(/\s+/g, " ")
        .trim();

      return { name: title, description, percent, visualReferenceUrl };
    })
    .filter(
      (achievement): achievement is {
        name: string;
        description: string;
        percent: number | undefined;
        visualReferenceUrl: string | null;
      } => Boolean(achievement)
    );

  return achievements.length ? achievements : null;
}

async function fetchExophaseAchievements(url: string) {
  // Somente a rota PT-BR. Se o Exophase redirecionar para inglês, tentamos
  // o mesmo endereço pelo Reader, mas nunca aceitamos a página inglesa.
  const targetUrl = url;

  try {
    const response = await fetch(targetUrl, {
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Rumo-a-Conquista/1.0; +https://www.exophase.com/)",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
    });

    if (response.ok) {
      const html = await response.text();

      if (isPortugueseExophasePage(html)) {
        const achievements = parseExophaseHtml(html);

        if (achievements) {
          return { url: targetUrl, achievements };
        }
      }
    }
  } catch (error) {
    console.error("[Exophase Direct Achievements]", error);
  }

  // Fallback de transporte: Jina apenas lê a página do Exophase.
  try {
    const readerUrl = "https://r.jina.ai/" + targetUrl;
    const response = await fetch(readerUrl, {
      cache: "no-store",
      headers: {
        Accept: "text/html",
        "X-Respond-With": "html",
        "X-Timeout": "20",
      },
    });

    if (response.ok) {
      const html = await response.text();

      if (isPortugueseExophasePage(html)) {
        const achievements = parseExophaseHtml(html);

        if (achievements) {
          return { url: targetUrl, achievements };
        }
      }
    }
  } catch (error) {
    console.error("[Exophase Reader Fallback]", error);
  }

  return null;
}

async function resolveGameTitle(slugParam: string | null, titleParam: string) {
  if (slugParam) {
    const client = createAdminSupabaseClient();

    const { data, error } = await client
      .from("games")
      .select("slug, title")
      .eq("slug", slugParam)
      .eq("is_deleted", false)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error("Jogo cadastrado não encontrado.");

    return { slug: String(data.slug), title: String(data.title) };
  }

  if (!titleParam) throw new Error("O nome do jogo é obrigatório.");

  return { slug: slug(titleParam), title: titleParam };
}

export async function GET(req: NextRequest) {
  const titleParam = req.nextUrl.searchParams.get("title")?.trim() ?? "";
  const slugParam = req.nextUrl.searchParams.get("slug")?.trim() ?? "";

  try {
    const registeredGame = await resolveGameTitle(
      slugParam || null,
      titleParam
    );

    const exophaseGame = await findExophaseSteamGame(registeredGame.title);

    if (!exophaseGame) {
      return NextResponse.json(
        {
          error:
            "Não encontrei este jogo no Exophase. A preparação de conquistas agora usa o Exophase como fonte única.",
        },
        { status: 404 }
      );
    }

    const exophaseData = await fetchExophaseAchievements(exophaseGame.url);

    if (!exophaseData) {
      return NextResponse.json(
        {
          error:
            "Encontrei o jogo no Exophase, mas não consegui ler a lista de conquistas em PT-BR dessa página.",
        },
        { status: 502 }
      );
    }

    const achievements = exophaseData.achievements.map((a, i) => {
      const name = a.name?.trim() || "";
      const description = a.description?.trim() || "";
      const online = isOnline(name, description);
      const momentary = isMomentary(name, description);
      const journey = !online && isJourneyByCompletion(name, description);

      return {
        name,
        description,
        rank: rank(a.percent),
        online,
        momentary,
        journeySuggestion: journey,
        journey,
        notDoing: false,
        visualReferenceUrl: a.visualReferenceUrl ?? null,
        id:
          "exophase-" +
          slug(registeredGame.slug) +
          "-achievement-" +
          (i + 1) +
          "-" +
          slug(name || "conquista-" + (i + 1)),
      };
    });

    return NextResponse.json({
      ok: true,
      game: {
        name: registeredGame.title,
        slug: registeredGame.slug,
        source: "Exophase",
        registered: Boolean(slugParam),
        exophase: {
          found: true,
          url: exophaseData.url,
          achievementCount: achievements.length,
        },
      },
      achievements,
      warnings: [
        "Exophase é a fonte única desta preparação: nome, descrição e raridade vêm diretamente da página do jogo.",
        "Jornada de Estreia começa como sugestão automática para conquistas que parecem fazer parte da primeira conclusão normal do jogo. Conquistas online ficam fora dessa sugestão e conquistas momentâneas recebem um alerta para decisão do preparador.",
      ],
    });
  } catch (e) {
    console.error("[Achievement Prep]", e);

    const message =
      e instanceof Error ? e.message : "Não foi possível preparar o jogo.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

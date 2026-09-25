import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

type ExophaseAchievement = {
  name?: string;
  description?: string;
  percent?: number;
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
  ) return true;

  return [
    "in a single playthrough", "in one playthrough", "in a single game",
    "in one game", "in a single match", "in one match", "in a single run",
    "in one run", "during the chase", "during the escape", "during the mission",
    "during the level", "during the chapter", "before the timer",
    "within the time limit", "sem ser atingido", "sem tomar dano",
    "em uma unica partida", "em uma unica jogada", "em uma unica run",
    "em uma unica tentativa", "durante a missao", "durante o capitulo",
    "durante a fase", "antes do tempo acabar", "dentro do tempo",
  ].some((pattern) => text.includes(pattern));
}

function isJourneyByCompletion(name: string, description: string) {
  const text = norm(name + " " + description);
  return [
    "complete the campaign", "complete the story", "complete the game",
    "finish the campaign", "finish the story", "finish the game",
    "beat the game", "wrap up the", "resolve the case",
    "concluir a campanha", "concluir a historia", "concluir o jogo",
    "finalizar a campanha", "finalizar a historia", "finalizar o jogo",
    "resolver o caso", "resolva o caso", "complete o caso",
    "conclua o caso", "finalize o caso",
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
  // Algumas respostas do Exophase/Jina trazem trechos de HTML escapados
  // como &lt;img ...&gt;. Por isso decodificamos e removemos tags mais de
  // uma vez, evitando que atributos de imagens vazem para a descrição.
  let current = value;

  for (let i = 0; i < 3; i += 1) {
    current = current.replace(/<script[\\s\\S]*?<\\/script>/gi, " ");
    current = current.replace(/<style[\\s\\S]*?<\\/style>/gi, " ");
    current = current.replace(/<[^>]*>/g, " ");
    current = decodeHtml(current);
  }

  return current.replace(/\\s+/g, " ").trim();
}

async function findExophaseSteamGame(title: string) {
  // O fluxo da preparação é PT-BR. O Exophase possui uma rota localizada
  // própria, então não usamos a página inglesa como fallback.
  return {
    url:
      "https://www.exophase.com/game/" +
      slug(title) +
      "-steam/achievements/pt-BR/",
  };
}

async function parseExophaseHtml(html: string) {
  // Em vez de capturar até o primeiro </tag>, localizamos a abertura do
  // elemento .award-title. Isso evita cortar o título no meio quando ele
  // possui <span>, <a> ou outras tags internas.
  const titleOpenMatches = Array.from(
    html.matchAll(
      /<([a-z0-9]+)\\b[^>]*class=["'][^"']*\\baward-title\\b[^"']*["'][^>]*>/gi
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

      const titleEndTag = new RegExp(
        `</${match[1]}>\\s*import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

type ExophaseAchievement = {
  name?: string;
  description?: string;
  percent?: number;
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
  ) return true;

  return [
    "in a single playthrough", "in one playthrough", "in a single game",
    "in one game", "in a single match", "in one match", "in a single run",
    "in one run", "during the chase", "during the escape", "during the mission",
    "during the level", "during the chapter", "before the timer",
    "within the time limit", "sem ser atingido", "sem tomar dano",
    "em uma unica partida", "em uma unica jogada", "em uma unica run",
    "em uma unica tentativa", "durante a missao", "durante o capitulo",
    "durante a fase", "antes do tempo acabar", "dentro do tempo",
  ].some((pattern) => text.includes(pattern));
}

function isJourneyByCompletion(name: string, description: string) {
  const text = norm(name + " " + description);
  return [
    "complete the campaign", "complete the story", "complete the game",
    "finish the campaign", "finish the story", "finish the game",
    "beat the game", "wrap up the", "resolve the case",
    "concluir a campanha", "concluir a historia", "concluir o jogo",
    "finalizar a campanha", "finalizar a historia", "finalizar o jogo",
    "resolver o caso", "resolva o caso", "complete o caso",
    "conclua o caso", "finalize o caso",
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
  // Algumas respostas do Exophase/Jina trazem trechos de HTML escapados
  // como &lt;img ...&gt;. Por isso decodificamos e removemos tags mais de
  // uma vez, evitando que atributos de imagens vazem para a descrição.
  let current = value;

  for (let i = 0; i < 3; i += 1) {
    current = current.replace(/<script[\\s\\S]*?<\\/script>/gi, " ");
    current = current.replace(/<style[\\s\\S]*?<\\/style>/gi, " ");
    current = current.replace(/<[^>]*>/g, " ");
    current = decodeHtml(current);
  }

  return current.replace(/\\s+/g, " ").trim();
}

async function findExophaseSteamGame(title: string) {
  // A URL do Exophase é determinística para a página Steam.
  // A leitura do conteúdo fica separada para podermos usar um fallback
  // quando o ambiente do servidor não consegue acessar o Exophase diretamente.
  return {
    url:
      "https://www.exophase.com/game/" + slug(title) + "-steam/achievements/",
  };
}

,
        "i"
      );
      const titleRaw = html
        .slice(titleStart, nextTitleStart)
        .split(/<\\/[^>]+>/i)[0]
        .replace(titleEndTag, "");

      const title = stripHtml(titleRaw);

      // Tudo entre este título e o próximo título pertence ao mesmo card.
      // A descrição vem antes da primeira ocorrência de percentual.
      const chunk = html.slice(titleStart, nextTitleStart);
      const visible = stripHtml(chunk);

      const percentMatch = visible.match(/(\\d+(?:\\.\\d+)?)%/);
      const percent = percentMatch ? Number(percentMatch[1]) : undefined;

      let description = percentMatch
        ? visible.slice(0, percentMatch.index).trim()
        : visible;

      // Remove textos de interface que podem aparecer antes da descrição.
      description = description
        .replace(/^Image\\s+/i, "")
        .replace(/^Imagem\\s+/i, "")
        .trim();

      return { name: title, description, percent };
    })
    .filter((achievement) => achievement.name);

  return achievements.length ? achievements : null;
}

async function fetchExophaseAchievements(url: string) {
  const targetUrl = url;

  // Primeiro tentamos a página PT-BR do Exophase diretamente. Não caímos
  // para a página inglesa, porque a preparação precisa manter títulos e
  // descrições em português quando essa tradução existir.
  const directUrls = [targetUrl];

  // Primeiro tentamos o Exophase diretamente.
  for (const targetUrl of directUrls) {
    try {
      const response = await fetch(targetUrl, {
        cache: "no-store",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; Rumo-a-Conquista/1.0; +https://www.exophase.com/)",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        },
      });

      if (!response.ok) continue;

      const html = await response.text();

      // A rota PT-BR deve retornar a interface localizada. Se o servidor
      // receber uma página inglesa/redirectada, seguimos para o Reader em vez
      // de apresentar inglês no painel.
      const isPortuguese =
        /conquistas|portugu[eê]s(?:\s*\\(brasil\\))?/i.test(html);

      const achievements =
        isPortuguese ? await parseExophaseHtml(html) : null;

      if (achievements) {
        return { url: targetUrl, achievements };
      }
    } catch (error) {
      console.error("[Exophase Direct Achievements]", error);
    }
  }

  // Fallback de transporte: o conteúdo continua vindo da página do Exophase.
  // O Reader apenas faz a leitura da URL quando o servidor da aplicação não
  // consegue acessar o Exophase diretamente.
  for (const targetUrl of directUrls) {
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

      if (!response.ok) continue;

      const html = await response.text();
      const isPortuguese =
        /conquistas|portugu[eê]s(?:\s*\\(brasil\\))?/i.test(html);

      const achievements =
        isPortuguese ? await parseExophaseHtml(html) : null;

      if (achievements) {
        return { url: targetUrl, achievements };
      }
    } catch (error) {
      console.error("[Exophase Reader Fallback]", error);
    }
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
    const registeredGame = await resolveGameTitle(slugParam || null, titleParam);
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
            "Encontrei o jogo no Exophase, mas não consegui ler a lista de conquistas dessa página.",
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
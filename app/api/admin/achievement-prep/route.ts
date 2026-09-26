import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

type ExophaseAchievement = {
  name?: string;
  description?: string;
  percent?: number;
  visualReferenceUrl?: string | null;
  detailUrl?: string | null;
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

function extractAttribute(tag: string, attribute: string) {
  const match = tag.match(
    new RegExp(attribute + "\\s*=\\s*[\"']([^\"']+)[\"']", "i")
  );

  return match?.[1]?.trim() || null;
}

function resolveExophaseUrl(rawUrl: string | null) {
  if (!rawUrl) return null;

  try {
    const url = new URL(decodeHtml(rawUrl), "https://www.exophase.com");

    // O Exophase pode servir as artes por subdomínios/CDN próprios
    // (por exemplo, cdn.exophase.com). Continuamos bloqueando domínios externos.
    if (
      url.hostname !== "exophase.com" &&
      !url.hostname.endsWith(".exophase.com")
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function extractVisualReference(block: string) {
  const decoded = decodeHtml(block);

  const candidates: string[] = [];

  const addCandidate = (value?: string | null) => {
    if (!value) return;

    let normalized = value.trim();

    if (normalized.includes(",")) {
      normalized = normalized.split(",")[0]?.trim() || "";
    }

    normalized = normalized
      .replace(/^\s*url\(\s*["']?/i, "")
      .replace(/["']?\s*\)\s*$/i, "")
      .replace(/\s+\d+(?:\.\d+)?x$/i, "")
      .trim();

    if (
      normalized &&
      !normalized.startsWith("data:") &&
      !normalized.startsWith("javascript:")
    ) {
      candidates.push(normalized);
    }
  };

  for (const match of decoded.matchAll(
    /<(?:img|source)\b[^>]*\b(?:src|data-src|data-original|data-lazy-src|data-image|data-image-url|data-bg|data-background|data-background-image)\s*=\s*["']([^"']+)["']/gi
  )) {
    addCandidate(match[1]);
  }

  for (const match of decoded.matchAll(
    /\b(?:data-src|data-original|data-lazy-src|data-image|data-image-url|data-bg|data-background|data-background-image)\s*=\s*["']([^"']+)["']/gi
  )) {
    addCandidate(match[1]);
  }

  for (const match of decoded.matchAll(
    /\bsrcset\s*=\s*["']([^"']+)["']/gi
  )) {
    addCandidate(match[1]);
  }

  for (const match of decoded.matchAll(
    /(?:background(?:-image)?|--background-image)\s*:\s*url\(\s*["']?([^"')]+)["']?\s*\)/gi
  )) {
    addCandidate(match[1]);
  }

  for (const match of decoded.matchAll(
    /<a\b[^>]*\bhref\s*=\s*["']([^"']+\.(?:png|jpe?g|webp)(?:\?[^"']*)?)["']/gi
  )) {
    addCandidate(match[1]);
  }

  for (const candidate of candidates) {
    const resolved = resolveExophaseUrl(candidate);
    if (resolved) return resolved;
  }

  return null;
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

      const previousTitleEnd =
        index > 0
          ? (titleOpenMatches[index - 1].index ?? 0) +
            titleOpenMatches[index - 1][0].length
          : 0;

      // O ícone pode estar antes do .award-title, dentro do mesmo card.
      // Procuramos vários formatos de lazy-loading/background, em vez de
      // depender de uma única estrutura HTML do Exophase.
      const visualBlock = html.slice(previousTitleEnd, nextTitleStart);
      const visualReferenceUrl = extractVisualReference(visualBlock);

      // Guardamos também o link da conquista. Se a listagem não expuser o
      // ícone diretamente, a página individual da conquista será usada como
      // fallback para obter a imagem oficial do Exophase.
      const detailLink =
        extractAttribute(match[0], "href") ||
        extractAttribute(
          chunk.match(/<a\b[^>]*\bhref\s*=\s*["'][^"']+["'][^>]*>/i)?.[0] ?? "",
          "href"
        );

      const detailUrl = resolveExophaseUrl(detailLink);

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

      return {
        name: title,
        description,
        percent,
        visualReferenceUrl,
        detailUrl,
      };
    })
    .filter(
      (achievement): achievement is {
        name: string;
        description: string;
        percent: number | undefined;
        visualReferenceUrl: string | null;
        detailUrl: string | null;
      } => Boolean(achievement)
    );

  return achievements.length ? achievements : null;
}

async function fetchJinaHtml(
  url: string,
  waitForSelector = ".award-title"
) {
  const readerUrl = "https://r.jina.ai/" + url;

  try {
    const browserResponse = await fetch(readerUrl, {
      cache: "no-store",
      headers: {
        Accept: "text/html",
        "X-Engine": "browser",
        "X-Respond-With": "html",
        "X-Respond-Timing": "network-idle",
        "X-Wait-For-Selector": waitForSelector,
        "X-No-Cache": "true",
        "X-Timeout": "30",
      },
    });

    if (browserResponse.ok) {
      const html = await browserResponse.text();
      if (html && html.includes("award-title")) return html;
    }
  } catch (error) {
    console.error("[Jina Browser]", error);
  }

  // Fallback de compatibilidade: nem toda resposta do Jina/Exophase
  // aceita o modo browser/selector. Mantemos o Reader simples como segunda
  // tentativa para não transformar uma falha do browser em erro da preparação.
  const plainResponse = await fetch(readerUrl, {
    cache: "no-store",
    headers: {
      Accept: "text/html",
      "X-Respond-With": "html",
      "X-Timeout": "20",
    },
  });

  if (!plainResponse.ok) {
    throw new Error(
      "Jina Reader respondeu com status " + plainResponse.status
    );
  }

  return plainResponse.text();
}

async function fetchExophaseAchievementImage(detailUrl: string) {
  const extractFromPage = (html: string) => {
    // Para a página individual, priorizamos a imagem que está realmente
    // dentro do conteúdo da conquista. OG/Twitter podem apontar para a arte
    // geral da página, então só usamos esses metadados como último fallback.
    const visual = extractVisualReference(html);
    if (visual) return visual;

    const metaImage =
      html.match(
        /<meta\b[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["'][^>]*>/i
      ) ??
      html.match(
        /<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/i
      );

    const linkImage = html.match(
      /<link\b[^>]*rel=["'][^"']*\bimage_src\b[^"']*["'][^>]*href=["']([^"']+)["']/i
    );

    return resolveExophaseUrl(metaImage?.[1] || linkImage?.[1] || null);
  };

  try {
    const response = await fetch(detailUrl, {
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Rumo-a-Conquista/1.0; +https://www.exophase.com/)",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
    });

    if (response.ok) {
      const html = await response.text();
      const image = extractFromPage(html);
      if (image) return image;
    }
  } catch (error) {
    console.error("[Exophase Achievement Image Direct]", error);
  }

  try {
    // O Reader é usado com Chromium, HTML renderizado e espera pelo
    // .award-title. Isso cobre conteúdo/imagens que só aparecem após JS.
    const html = await fetchJinaHtml(detailUrl, ".award-title");
    const image = extractFromPage(html);
    if (image) return image;
  } catch (error) {
    console.error("[Exophase Achievement Image Reader Browser]", error);
  }

  return null;
}

async function hydrateExophaseVisualReferences(
  achievements: ExophaseAchievement[]
) {
  const result = [...achievements];

  // Evitamos abrir dezenas de páginas individuais ao mesmo tempo.
  const missing = result
    .map((achievement, index) => ({ achievement, index }))
    .filter(
      ({ achievement }) =>
        !achievement.visualReferenceUrl && Boolean(achievement.detailUrl)
    );

  const concurrency = 5;

  for (let i = 0; i < missing.length; i += concurrency) {
    const batch = missing.slice(i, i + concurrency);

    const resolved = await Promise.all(
      batch.map(async ({ achievement, index }) => ({
        index,
        image: achievement.detailUrl
          ? await fetchExophaseAchievementImage(achievement.detailUrl)
          : null,
      }))
    );

    for (const item of resolved) {
      if (item.image) {
        result[item.index] = {
          ...result[item.index],
          visualReferenceUrl: item.image,
        };
      }
    }
  }

  return result;
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
          const hydrated = await hydrateExophaseVisualReferences(achievements);
          return { url: targetUrl, achievements: hydrated };
        }
      }
    }
  } catch (error) {
    console.error("[Exophase Direct Achievements]", error);
  }

  // Fallback de transporte: Jina apenas lê a página do Exophase.
  try {
    // Fallback robusto: Chromium + HTML renderizado + espera do bloco
    // de conquistas. O Exophase pode montar parte do card/imagem via JS.
    const html = await fetchJinaHtml(targetUrl, ".award-title");

    if (isPortugueseExophasePage(html)) {
      const achievements = parseExophaseHtml(html);

      if (achievements) {
        const hydrated = await hydrateExophaseVisualReferences(achievements);
        return { url: targetUrl, achievements: hydrated };
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

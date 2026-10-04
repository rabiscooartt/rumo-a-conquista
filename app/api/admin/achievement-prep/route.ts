import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

type ExophaseAchievement = {
  name?: string;
  description?: string;
  percent?: number;
  visualReferenceUrl?: string | null;
  detailUrl?: string | null;
  image?: string;
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

function balancedRanks(achievements: ExophaseAchievement[]) {
  const total = achievements.length;
  const ranks: ("Bronze" | "Prata" | "Ouro")[] = Array.from(
    { length: total },
    () => "Bronze"
  );

  if (total === 0) return ranks;

  // A raridade é relativa ao próprio jogo. Isso evita que um jogo com
  // conquistas naturalmente mais fáceis fique sem Ouro só porque nenhuma
  // delas ficou abaixo de um limite absoluto de porcentagem.
  const ordered = achievements
    .map((achievement, index) => ({
      index,
      percent:
        typeof achievement.percent === "number"
          ? achievement.percent
          : Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => {
      if (a.percent !== b.percent) return a.percent - b.percent;
      return a.index - b.index;
    });

  // Distribuição oficial do Rumo à Conquista:
  // aproximadamente 15% Ouro, 35% Prata e 50% Bronze.
  // Sempre existe pelo menos 1 Ouro quando o jogo possui conquistas.
  const goldCount = Math.min(
    total,
    Math.max(1, Math.round(total * 0.15))
  );
  const silverCount = Math.min(
    total - goldCount,
    Math.max(0, Math.round(total * 0.35))
  );

  ordered.forEach((item, position) => {
    if (position < goldCount) {
      ranks[item.index] = "Ouro";
    } else if (position < goldCount + silverCount) {
      ranks[item.index] = "Prata";
    }
  });

  return ranks;
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


function analyzeJourney(
  gameTitle: string,
  name: string,
  description: string
): {
  journey: boolean;
  confidence: "confirmed" | "probable" | "outside";
} {
  const gameKey = slug(gameTitle);
  const title = norm(name);
  const text = norm(name + " " + description);

  // Regra do preparador:
  // CONFIRMADA + PROVAVELMENTE FEITA = VERDE.
  // O Admin mostra as duas categorias juntas como Jornada de Estreia.
  const verifiedJourneyByGame: Record<string, Set<string>> = {
    "mouse-p-i-for-hire": new Set([
      "mestre dos macetes",
      "tricks of the trade",
      "armas muitas armas",
      "guns lots of guns",
      "ponta do queijobergue",
      "tip of the cheeseberg",
    ]),
  };

  // Lista consolidada a partir da análise manual da primeira jornada:
  // são conquistas que foram consideradas plausivelmente obtidas durante
  // a primeira run, junto das conquistas confirmadas acima.
  const probableJourneyByGame: Record<string, Set<string>> = {
    "mouse-p-i-for-hire": new Set([
      "taco tudo",
      "babe got bat",
      "balada de betty borocoxo",
      "burdens of blue betty",
      "alivio comico",
      "comic relief",
      "detetive de romance de banca de jornal",
      "dime novel sleuth",
      "o martirio do magico misterioso",
      "smoked cheese and mirrors",
      "misterios da mingua dos musaranhos",
      "our lesser brothers",
      "essa e a minha espingarda",
      "de capa a capa",
      "cover to cover",
      "romance muito grafico",
      "extremely graphic novel",
      "pessoal de papel",
      "paper person",
      "as de bolso",
      "pocket aces",
      "baralho de iniciante",
      "starter deck",
      "queijo e fumaca",
      "tinsel boulevard",
      "felicidade do quint",
      "quints delight",
      "resolva o caso da mingua do musaranho",
      "resolva o caso da betty borocoxo",
      "resolva o caso do magico misterioso",
      "concluir o caso da escassez de musaranhos",
      "concluir o caso blue betty",
      "concluir o caso do magico desaparecido",
      "encontre as pistas principais do caso blue betty",
      "encontre as pistas principais do caso da escassez de musaranhos",
      "encontre as pistas principais do caso do magico desaparecido",
      "encontre as pistas chaves do caso da betty borocoxo",
      "encontre as pistas chaves do caso do magico misterioso",
      "concluir a historia",
      "descansar tranquilo detetive caso encerrado ou sera que nao",
      "tip of the cheeseberg",
      "chutar o tubarao de wallop bay ate que ele deixe cair a placa de carro",
    ]),
  };

  const verified = verifiedJourneyByGame[gameKey];
  if (verified?.has(title)) {
    return { journey: true, confidence: "confirmed" };
  }

  const probable = probableJourneyByGame[gameKey];
  if (probable?.has(title)) {
    return { journey: true, confidence: "probable" };
  }

  // Conquistas que, pela análise fornecida para a primeira jornada, ficam
  // explicitamente fora: metas de completar tudo, grandes coleções,
  // dezenas de partidas, todas as pistas, dificuldade específica etc.
  const outsidePatterns = [
    "conquistar todos os trofeus",
    "all trophies",
    "tá tudo nas cartas",
    "ta tudo nas cartas",
    "s all in the cards",
    "entao quem foi",
    "so whodunit",
    "pendure todas as pistas",
    "fixar todas as pistas",
    "todas as pistas",
    "extra extra",
    "todos os trabalhos secundarios",
    "todo trabalho secundario",
    "all side jobs",
    "hora do bang",
    "hora do b a n g",
    "o prologo",
    "the prologue",
    "verdadeiro detetive",
    "real deal gumshoe",
    "melhorar todas as armas",
    "aprimorar todas as armas",
    "hora do b a n g",
    "todas as historias em quadrinhos",
    "colete todas as tirinhas",
    "todas as edicoes do mouseburg herald",
    "colete todas as edicoes",
    "rato de baralho",
    "card shark",
    "cole t todas as cartas",
    "coletar todas as cartas",
    "todas as cartas de beisebol",
    "vencer 30 partidas",
    "venca 30 partidas",
    "win 30",
    "todas as armas disponiveis",
    "todas as armas que nao estao bloqueadas",
    "all weapons",
    "finalizar o jogo na dificuldade dificil",
    "finalize o jogo na dificuldade dificil",
    "10 estatuetas secretas",
    "estatuetas secretas",
    "x1 d ratificador",
    "x1 d mousifier",
    "arma exclusiva",
    "arma quase exclusiva",
    "desbloqueie a x1",
    "desbloquear a x1",
    "concluir todos os casos",
    "complete all cases",
  ];

  if (outsidePatterns.some((pattern) => text.includes(pattern))) {
    return { journey: false, confidence: "outside" };
  }

  // Fora do Mouse, somente uma conclusão textual inequívoca da campanha
  // entra automaticamente como provável. O restante fica para revisão.
  const explicitCompletionPatterns = [
    "complete the game",
    "finish the game",
    "beat the game",
    "complete the campaign",
    "finish the campaign",
    "complete the story",
    "finish the story",
    "concluir o jogo",
    "finalizar o jogo",
    "concluir a campanha",
    "finalizar a campanha",
    "concluir a historia",
    "finalizar a historia",
    "complete o jogo",
    "finalize o jogo",
    "reach the ending",
    "reached the ending",
    "reach the final",
    "alcance o final",
    "chegue ao final",
  ];

  if (explicitCompletionPatterns.some((pattern) => text.includes(pattern))) {
    return { journey: true, confidence: "probable" };
  }

  return { journey: false, confidence: "outside" };
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

function resolveEmbeddedImageUrl(rawUrl: string | null) {
  if (!rawUrl) return null;

  try {
    const url = new URL(decodeHtml(rawUrl), "https://www.exophase.com");

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }

    // A página do Exophase pode embutir a arte através de uma CDN externa.
    // Isso continua sendo uma referência encontrada NO Exophase; não estamos
    // consultando Steam/Xbox/outra base para descobrir uma arte alternativa.
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

    let normalized = value
      .trim()
      .replace(/^\\+/, "//")
      .replace(/^\s*url\(\s*["']?/i, "")
      .replace(/["']?\s*\)\s*$/i, "")
      .replace(/\s+\d+(?:\.\d+)?x$/i, "")
      .trim();

    if (normalized.includes(",")) {
      normalized = normalized.split(",")[0]?.trim() || "";
    }

    if (
      normalized &&
      !normalized.startsWith("data:") &&
      !normalized.startsWith("javascript:")
    ) {
      candidates.push(normalized);
    }
  };

  // A imagem pode estar no próprio <img>/<source> ou em atributos de
  // lazy-loading. Aceitamos atributos com aspas simples, duplas ou sem
  // aspas, porque o HTML retornado pelo Reader pode variar.
  const imageAttributePattern =
    /\b(?:src|srcset|data-src|data-srcset|data-original|data-original-src|data-lazy-src|data-lazy-srcset|data-image|data-image-url|data-bg|data-background|data-background-image|data-url)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;

  for (const match of decoded.matchAll(imageAttributePattern)) {
    addCandidate(match[1] || match[2] || match[3]);
  }

  for (const match of decoded.matchAll(
    /(?:background(?:-image)?|--background-image)\s*:\s*url\(\s*["']?([^"')]+)["']?\s*\)/gi
  )) {
    addCandidate(match[1]);
  }

  // Jina pode devolver uma imagem em Markdown mesmo quando foi solicitado
  // HTML. Também cobrimos URLs sem extensão (CDNs costumam usar esse formato).
  for (const match of decoded.matchAll(
    /!\[[^\]]*\]\(\s*<?([^)>\s]+)>?[^)]*\)/gi
  )) {
    addCandidate(match[1]);
  }

  // Último formato: links diretos para arquivos de imagem.
  for (const match of decoded.matchAll(
    /<a\b[^>]*\bhref\s*=\s*["']([^"']+\.(?:png|jpe?g|webp)(?:\?[^"']*)?)["']/gi
  )) {
    addCandidate(match[1]);
  }

  for (const candidate of candidates) {
    const exophaseUrl = resolveExophaseUrl(candidate);
    if (exophaseUrl) return exophaseUrl;

    const embeddedUrl = resolveEmbeddedImageUrl(candidate);
    if (embeddedUrl) return embeddedUrl;
  }

  return null;
}

function parseExophaseAchievementLinks(html: string) {
  const matches = Array.from(
    html.matchAll(
      /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*\/achievement\/[^""]+)"|'([^']*\/achievement\/[^']+)'|([^\s>]*\/achievement\/[^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi
    )
  );

  if (!matches.length) return null;

  const achievements: ExophaseAchievement[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const href = match[1] || match[2] || match[3] || "";
    const name = stripHtml(decodeHtml(match[4] || ""))
      .replace(/\s+/g, " ")
      .trim();

    if (!href || !name) continue;

    const key = norm(name);
    if (!key || seen.has(key)) continue;

    const anchorEnd = (match.index ?? 0) + match[0].length;
    const nextAnchorStart =
      index + 1 < matches.length
        ? matches[index + 1].index ?? html.length
        : html.length;

    const followingText = stripHtml(
      decodeHtml(html.slice(anchorEnd, nextAnchorStart))
    )
      .replace(/\s+/g, " ")
      .trim();

    const percentMatch = followingText.match(/(\d+(?:\.\d+)?)%/);
    const percent = percentMatch ? Number(percentMatch[1]) : undefined;

    let description = percentMatch
      ? followingText.slice(0, percentMatch.index).trim()
      : followingText;

    description = description
      .replace(/^(?:Image|Imagem)\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!description) continue;

    const cardStart = Math.max(0, (match.index ?? 0) - 5000);
    const visualReferenceUrl = extractVisualReference(
      html.slice(cardStart, nextAnchorStart)
    );

    seen.add(key);
    achievements.push({
      name,
      description,
      percent,
      visualReferenceUrl,
      detailUrl: resolveExophaseUrl(href),
    });
  }

  return achievements.length ? achievements : null;
}

function parseExophaseText(source: string) {
  const prepared = decodeHtml(source)
    .replace(/\r/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:div|p|li|section|article|h[1-6]|tr|td|th)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n");

  const lines = prepared
    .split("\n")
    .map((line) => decodeHtml(line).replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const percentRegex = /^(\d+(?:[.,]\d+)?)%\s*(?:\(([-\d.,]+)\))?$/;
  const achievements: ExophaseAchievement[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const percentMatch = lines[index].match(percentRegex);
    if (!percentMatch) continue;

    const percent = Number(percentMatch[1].replace(",", "."));
    const candidates: string[] = [];

    for (let cursor = index - 1; cursor >= 0 && candidates.length < 8; cursor -= 1) {
      const value = lines[cursor];
      const lower = value.toLowerCase();

      if (!value) continue;
      if (lower === "image" || lower === "imagem") continue;
      if (/^https?:\/\//i.test(value)) continue;
      if (/^(?:steam|achievements?|conquistas|leaderboard|forum|game info|image|imagem)$/i.test(value)) continue;
      if (/^\d+\s+(?:total )?(?:achievements?|conquistas?)$/i.test(value)) continue;
      if (/^(?:all|earned|locked) achievements?$/i.test(value)) continue;

      if (percentRegex.test(value)) break;

      candidates.unshift(value);
    }

    if (candidates.length < 2) continue;

    const name = candidates[candidates.length - 2];
    const description = candidates[candidates.length - 1];
    if (!name || !description) continue;

    const key = norm(name);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    achievements.push({
      name,
      description,
      percent: Number.isFinite(percent) ? percent : undefined,
      visualReferenceUrl: null,
      detailUrl: null,
    });
  }

  return achievements.length ? achievements : null;
}

function parseExophaseHtml(html: string) {
  // Formato antigo do Exophase.
  const titleOpenMatches = Array.from(
    html.matchAll(
      /<([a-z0-9]+)\b[^>]*class=["'][^"']*\baward-title\b[^"']*["'][^>]*>/gi
    )
  );

  if (titleOpenMatches.length) {
    const achievements: ExophaseAchievement[] = titleOpenMatches
      .map((match, index) => {
        const titleStart = (match.index ?? 0) + match[0].length;
        const nextTitleStart =
          index + 1 < titleOpenMatches.length
            ? titleOpenMatches[index + 1].index ?? html.length
            : html.length;
        const chunk = html.slice(titleStart, nextTitleStart);
        const titlePart = chunk.split(/<\/[^>]+>/i)[0];
        const title = stripHtml(titlePart);
        if (!title) return null;

        const previousTitleEnd =
          index > 0
            ? (titleOpenMatches[index - 1].index ?? 0) +
              titleOpenMatches[index - 1][0].length
            : 0;
        const cardStart = Math.max(previousTitleEnd, (match.index ?? 0) - 8000);
        const cardBlock = html.slice(cardStart, nextTitleStart);
        const visualReferenceUrl = extractVisualReference(cardBlock);

        const detailLinkCandidates = Array.from(
          cardBlock.matchAll(
            /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi
          )
        )
          .map((a) => a[1] || a[2] || a[3])
          .filter(Boolean);

        const detailLink =
          detailLinkCandidates.find((href) => /\/achievement\//i.test(href as string)) ||
          extractAttribute(match[0], "href") ||
          detailLinkCandidates[0] ||
          null;

        const detailUrl = resolveExophaseUrl(detailLink);
        const visible = stripHtml(chunk);
        let detailText = visible;
        if (detailText.toLowerCase().startsWith(title.toLowerCase())) {
          detailText = detailText.slice(title.length).trim();
        }

        const percentMatch = detailText.match(/(\d+(?:\.\d+)?)%/);
        const percent = percentMatch ? Number(percentMatch[1]) : undefined;
        const description = (percentMatch
          ? detailText.slice(0, percentMatch.index).trim()
          : detailText.trim()
        )
          .replace(/^(?:Image|Imagem)\s+/i, "")
          .replace(/\s+/g, " ")
          .trim();

        return { name: title, description, percent, visualReferenceUrl, detailUrl };
      })
      .filter(Boolean) as ExophaseAchievement[];

    if (achievements.length) return achievements;
  }

  // Formato atual: o Exophase pode entregar a mesma lista sem os antigos
  // seletores award-title/award-description.
  return parseExophaseText(html);
}

async function fetchJinaHtml(
  url: string,
  _legacyWaitForSelector?: string
) {
  const readerUrl = "https://r.jina.ai/" + url;

  try {
    const browserResponse = await fetch(readerUrl, {
      cache: "no-store",
      headers: {
        Accept: "text/html",
        "X-Engine": "browser",
        "X-Respond-With": "html",
        "X-No-Cache": "true",
        "X-Timeout": "30",
      },
    });

    if (browserResponse.ok) {
      const html = await browserResponse.text();
      if (html && /\/achievement\//i.test(html)) return html;
    }
  } catch (error) {
    console.error("[Jina Browser]", error);
  }

  const plainResponse = await fetch(readerUrl, {
    cache: "no-store",
    headers: {
      Accept: "text/html",
      "X-Respond-With": "html",
      "X-No-Cache": "true",
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
        const achievements = parseExophaseHtml(html) ?? parseExophaseAchievementLinks(html);

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
    // Fallback robusto: Chromium + HTML renderizado + espera do bloco
    // de conquistas. O Exophase pode montar parte do card/imagem via JS.
    const html = await fetchJinaHtml(targetUrl, ".award-title");

    const achievements =
      parseExophaseHtml(html) ??
      parseExophaseAchievementLinks(html) ??
      parseExophaseText(html);

    if (achievements) {
      return { url: targetUrl, achievements };
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
      .select("slug, title, review")
      .eq("slug", slugParam)
      .eq("is_deleted", false)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error("Jogo cadastrado não encontrado.");

    return {
      slug: String(data.slug),
      title: String(data.title),
      youtubePlaylistUrl:
        data.review &&
        typeof data.review === "object" &&
        !Array.isArray(data.review)
          ? String(
              (data.review as Record<string, unknown>).__youtubePlaylistUrl ?? ""
            ).trim()
          : "",
      youtubeFirstLiveUrl:
        data.review &&
        typeof data.review === "object" &&
        !Array.isArray(data.review)
          ? String(
              (data.review as Record<string, unknown>).__youtubeFirstLiveUrl ?? ""
            ).trim()
          : "",
      youtubeFirstLiveEpisode:
        data.review &&
        typeof data.review === "object" &&
        !Array.isArray(data.review)
          ? String(
              (data.review as Record<string, unknown>).__youtubeFirstLiveEpisode ?? ""
            ).trim()
          : "",
    };
  }

  if (!titleParam) throw new Error("O nome do jogo é obrigatório.");

  return {
    slug: slug(titleParam),
    title: titleParam,
    youtubePlaylistUrl: "",
    youtubeFirstLiveUrl: "",
    youtubeFirstLiveEpisode: "",
  };
}

async function buildAchievementPreparation(
  registeredGame: Awaited<ReturnType<typeof resolveGameTitle>>,
  exophaseData: { url: string; achievements: ExophaseAchievement[] }
) {
  const exophaseRanks = balancedRanks(exophaseData.achievements);

  const achievements = exophaseData.achievements.map((a, i) => {
    const name = a.name?.trim() || "";
    const description = a.description?.trim() || "";
    const online = isOnline(name, description);
    const momentary = isMomentary(name, description);
    const journeyAnalysis = !online
      ? analyzeJourney(registeredGame.title, name, description)
      : { journey: false, confidence: "outside" as const };

    return {
      name,
      description,
      rank: exophaseRanks[i] ?? "Bronze",
      online,
      momentary,
      journeySuggestion: false,
      journey: journeyAnalysis.journey,
      notDoing: false,
      visualReferenceUrl: a.visualReferenceUrl ?? null,
      image: null as string | null,
      id:
        "exophase-" +
        slug(registeredGame.slug) +
        "-achievement-" +
        (i + 1) +
        "-" +
        slug(name || "conquista-" + (i + 1)),
    };
  });

  try {
    const client = createAdminSupabaseClient();
    const { data: savedRows, error: savedRowsError } = await client
      .from("achievements")
      .select("id, title, sort_order, image")
      .eq("game_slug", registeredGame.slug)
      .order("sort_order", { ascending: true });

    if (savedRowsError) throw savedRowsError;

    const byTitle = new Map(
      (savedRows ?? []).map((row) => [norm(row.title), row])
    );
    const byOrder = new Map(
      (savedRows ?? [])
        .filter((row) => Number.isFinite(Number(row.sort_order)))
        .map((row) => [Number(row.sort_order), row])
    );

    for (const [index, achievement] of achievements.entries()) {
      const row = byTitle.get(norm(achievement.name)) ?? byOrder.get(index);
      if (!row) continue;

      if (typeof row.image === "string" && row.image.trim()) {
        achievement.image = row.image.trim();
      }

      const { error: updateError } = await client
        .from("achievements")
        .update({ rank: achievement.rank })
        .eq("id", row.id)
        .eq("game_slug", registeredGame.slug);

      if (updateError) throw updateError;
    }
  } catch (rankSyncError) {
    console.error("[Achievement Prep Rank Sync]", rankSyncError);
  }

  return NextResponse.json({
    ok: true,
    game: {
      name: registeredGame.title,
      slug: registeredGame.slug,
      source: "Exophase",
      registered: Boolean(registeredGame.slug),
      youtubePlaylistUrl: registeredGame.youtubePlaylistUrl,
      youtubeFirstLiveUrl: registeredGame.youtubeFirstLiveUrl,
      youtubeFirstLiveEpisode: registeredGame.youtubeFirstLiveEpisode,
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
          browserFallbackAvailable: true,
          exophaseUrl: exophaseGame.url,
        },
        { status: 502 }
      );
    }

    return buildAchievementPreparation(registeredGame, exophaseData);

  } catch (e) {
    console.error("[Achievement Prep]", e);

    const message =
      e instanceof Error ? e.message : "Não foi possível preparar o jogo.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      slug?: string;
      title?: string;
      exophaseUrl?: string;
      achievements?: ExophaseAchievement[];
    };

    const achievements = Array.isArray(body.achievements)
      ? body.achievements.filter((item) => item?.name && item?.description)
      : [];

    if (achievements.length === 0) {
      return NextResponse.json(
        { error: "Nenhuma conquista estruturada foi recebida do Exophase." },
        { status: 422 }
      );
    }

    const registeredGame = await resolveGameTitle(
      body.slug?.trim() || null,
      body.title?.trim() || ""
    );

    const exophaseUrl = body.exophaseUrl?.trim();
    if (!exophaseUrl || !resolveExophaseUrl(exophaseUrl)) {
      return NextResponse.json(
        { error: "A URL do Exophase recebida é inválida." },
        { status: 400 }
      );
    }

    return buildAchievementPreparation(registeredGame, {
      url: exophaseUrl,
      achievements,
    });
  } catch (e) {
    console.error("[Achievement Prep Browser]", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "Não foi possível preparar o jogo.",
      },
      { status: 500 }
    );
  }
}
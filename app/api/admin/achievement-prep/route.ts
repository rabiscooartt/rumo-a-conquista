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
  // A página Steam do Exophase reúne as conquistas de Iceborne dentro de
  // Monster Hunter: World; o slug "monster-hunter-world-iceborne-steam"
  // não é o endereço canônico dessa lista.
  const normalizedTitle = norm(title);
  const exophaseSlug =
    normalizedTitle.includes("monster hunter") && normalizedTitle.includes("iceborne")
      ? "monster-hunter-world"
      : slug(title);

  // A preparação usa a versão PT-BR do Exophase para preservar os nomes
  // e as descrições em português sempre que a tradução estiver disponível.
  return {
    url:
      "https://www.exophase.com/game/" +
      exophaseSlug +
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
  _legacyWaitForSelector?: string,
  onStage?: (message: string) => void
) {
  const readerUrl = "https://r.jina.ai/" + url;

  // Primeiro tentamos o engine direct. Ele não depende do Chromium do Jina
  // e continua sendo uma leitura do próprio Exophase, sem trocar a fonte.
  onStage?.("Tentando leitura direta pelo leitor alternativo.");
  try {
    const directResponse = await fetch(readerUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      headers: {
        Accept: "text/html",
        "X-Engine": "direct",
        "X-Respond-With": "html",
        "X-No-Cache": "true",
        "X-Timeout": "20",
      },
    });

    if (directResponse.ok) {
      const html = await directResponse.text();
      if (html && /\/achievement\//i.test(html)) return html;
    } else {
      console.error("[Jina Direct] status", directResponse.status);
    }
  } catch (error) {
    console.error("[Jina Direct]", error);
  }

  // Segunda tentativa: Chromium renderizado, útil quando o Exophase monta
  // parte da lista por JavaScript.
  onStage?.("Tentando abrir a página renderizada pelo navegador.");
  try {
    const browserResponse = await fetch(readerUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
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
    } else {
      console.error("[Jina Browser] status", browserResponse.status);
    }
  } catch (error) {
    console.error("[Jina Browser]", error);
  }

  // Última tentativa de compatibilidade com a rota simples do Reader.
  onStage?.("Tentando a leitura simples como último recurso.");
  const plainResponse = await fetch(readerUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
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

async function fetchExophaseAchievements(
  url: string,
  onStage?: (message: string) => void
) {
  // Mantém a rota PT-BR como primeira opção, mas tenta todos os parsers
  // disponíveis para tolerar mudanças de HTML e de tradução do Exophase.
  const targetUrl = url;
  onStage?.("Consultando a página do Exophase diretamente.");

  try {
    const response = await fetch(targetUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Rumo-a-Conquista/1.0; +https://www.exophase.com/)",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
    });

    if (response.ok) {
      const html = await response.text();

      const achievements =
        parseExophaseHtml(html) ??
        parseExophaseAchievementLinks(html) ??
        parseExophaseText(html);

      if (achievements) {
        return { url: targetUrl, achievements };
      }
    }
  } catch (error) {
    console.error("[Exophase Direct Achievements]", error);
  }

  // Fallback de transporte: Jina apenas lê a página do Exophase.
  try {
    // Fallback robusto: Chromium + HTML renderizado + espera do bloco
    // de conquistas. O Exophase pode montar parte do card/imagem via JS.
    onStage?.("A leitura direta não funcionou; alternando o método de leitura.");
    const html = await fetchJinaHtml(targetUrl, ".award-title", onStage);

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
      .select("slug, title, review, final_badge")
      .eq("slug", slugParam)
      .eq("is_deleted", false)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error("Jogo cadastrado não encontrado.");

    const review =
      data.review && typeof data.review === "object" && !Array.isArray(data.review)
        ? data.review as Record<string, unknown>
        : {};
    const firstJourney =
      review.__firstJourney && typeof review.__firstJourney === "object" && !Array.isArray(review.__firstJourney)
        ? review.__firstJourney as Record<string, unknown>
        : {};
    const achievementMeta =
      firstJourney.achievementMeta && typeof firstJourney.achievementMeta === "object" && !Array.isArray(firstJourney.achievementMeta)
        ? firstJourney.achievementMeta as Record<string, unknown>
        : {};
    const finalMasteryMetaRaw = achievementMeta[String(data.slug) + "-final-mastery"];
    const finalMasteryMeta =
      finalMasteryMetaRaw && typeof finalMasteryMetaRaw === "object" && !Array.isArray(finalMasteryMetaRaw)
        ? finalMasteryMetaRaw as Record<string, unknown>
        : {};
    const finalBadge =
      data.final_badge && typeof data.final_badge === "object" && !Array.isArray(data.final_badge)
        ? data.final_badge as Record<string, unknown>
        : null;

    return {
      slug: String(data.slug),
      title: String(data.title),
      finalBadge,
      finalMasteryEpisode: String(finalMasteryMeta.episode ?? "").trim(),
      finalMasteryDate: String(finalMasteryMeta.date ?? "").trim(),
      youtubePlaylistUrl: String(review.__youtubePlaylistUrl ?? "").trim(),
      youtubeFirstLiveUrl: String(review.__youtubeFirstLiveUrl ?? "").trim(),
      youtubeFirstLiveEpisode: String(review.__youtubeFirstLiveEpisode ?? "").trim(),
    };
  }

  if (!titleParam) throw new Error("O nome do jogo é obrigatório.");

  return {
    slug: slug(titleParam),
    title: titleParam,
    finalBadge: null,
    finalMasteryEpisode: "",
    finalMasteryDate: "",
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
      finalBadge: registeredGame.finalBadge,
      finalMasteryEpisode: registeredGame.finalMasteryEpisode,
      finalMasteryDate: registeredGame.finalMasteryDate,
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


type ExophaseRecoveryCandidate = {
  url: string;
  label: string;
  source: "title" | "catalog";
};

function localizedPageUrl(gameSlug: string, platformHint = "") {
  const platform = (platformHint || gameSlug).toLowerCase();
  const isPsn = /(?:^|[-_])(?:psn|ps[345])(?:$|[-_])/.test(platform) ||
    /-psn$/.test(gameSlug);
  const endpoint = isPsn ? "trophies" : "achievements";
  return "https://www.exophase.com/game/" + gameSlug + "/" + endpoint + "/pt-BR/";
}

function buildStaticRecoveryCandidates(title: string, registeredSlug: string): ExophaseRecoveryCandidate[] {
  const candidates: ExophaseRecoveryCandidate[] = [];
  const seen = new Set<string>();
  const add = (value: string, label: string) => {
    const key = slug(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const gameSlug = key;
    const platform = /-(?:psn|ps[345]-psn)$/.test(gameSlug) ? "psn" : "steam";
    candidates.push({
      url: localizedPageUrl(gameSlug, platform),
      label,
      source: "title",
    });
  };

  const normalizedTitle = norm(title);
  if (normalizedTitle.includes("monster hunter") && normalizedTitle.includes("iceborne")) {
    add("monster-hunter-world", "Monster Hunter: World (página que reúne Iceborne)");
  }

  // Título completo e slug cadastrado são tentativas independentes; alguns
  // jogos usam um endereço no Exophase diferente do nome visível no projeto.
  add(title, "Nome completo do jogo");
  add(registeredSlug.replace(/-/g, " "), "Slug cadastrado");
  add(title.replace(/\s*\([^)]*(?:edition|version|deluxe|soundtrack|bundle|dlc|expansion)[^)]*\)\s*$/i, ""), "Nome sem edição/versão entre parênteses");

  // Só remove o subtítulo quando ele contém uma indicação clara de edição,
  // DLC ou expansão. Evita transformar títulos como "Mouse - P.I. For Hire"
  // em uma palavra genérica.
  const baseTitle = title.replace(/\s*(?:[:–—-])\s*(?=.*\b(?:dlc|expansion|iceborne|definitive edition|complete edition|deluxe edition|game of the year|remastered|remake|chapter|episode|season pass)\b).*$/i, "");
  if (baseTitle && norm(baseTitle) !== normalizedTitle) {
    add(baseTitle, "Título-base sem DLC/edição");
  }

  return candidates.slice(0, 5);
}

function parseExophaseCatalogSearch(html: string, title: string): ExophaseRecoveryCandidate[] {
  const targetWords = [...new Set(norm(title).split(" ").filter((word) => word.length > 2))];
  const matches = Array.from(html.matchAll(
    /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi
  ));
  const ranked: Array<ExophaseRecoveryCandidate & { score: number }> = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const rawHref = decodeHtml(match[1] || match[2] || match[3] || "");
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawHref, "https://www.exophase.com");
    } catch {
      continue;
    }
    if (!/(^|\.)exophase\.com$/i.test(parsedUrl.hostname)) continue;

    const gameMatch = parsedUrl.pathname.match(/^\/game\/([^/]+)\/?$/i);
    if (!gameMatch) continue;
    const gameSlug = decodeURIComponent(gameMatch[1]).toLowerCase();
    if (!/(?:-steam|-psn|-ps[345]-psn|-xbox(?:-one|-series-[xs])?|-gog|-epic|-nintendo-switch)$/.test(gameSlug)) continue;
    if (seen.has(gameSlug)) continue;
    seen.add(gameSlug);

    const visibleName = stripHtml(decodeHtml(match[4] || "")).replace(/\s+/g, " ").trim();
    const slugName = gameSlug
      .replace(/-(?:steam|psn|ps[345]-psn|xbox(?:-one|-series-[xs])?|gog|epic|nintendo-switch)$/i, "")
      .replace(/-/g, " ");
    const candidateName = norm((visibleName || "") + " " + slugName);
    const matched = targetWords.filter((word) => candidateName.includes(word)).length;
    const score = targetWords.length ? matched / targetWords.length : 0;
    if (score < 0.3) continue;

    const isPsn = /-psn$/.test(gameSlug) || /-ps[345]-psn$/.test(gameSlug);
    const endpoint = isPsn ? "trophies" : "achievements";
    ranked.push({
      url: "https://www.exophase.com/game/" + gameSlug + "/" + endpoint + "/pt-BR/",
      label: visibleName || slugName,
      source: "catalog",
      score: score + (/-steam$/.test(gameSlug) ? 0.15 : 0),
    });
  }

  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ score: _score, ...candidate }) => candidate);
}

async function discoverExophaseCatalogCandidates(title: string, onStage?: (message: string) => void) {
  const searchUrl = "https://www.exophase.com/games/?q=" + encodeURIComponent(title);
  onStage?.("Buscando o jogo no catálogo do Exophase para descobrir o endereço correto.");

  const urls = [
    searchUrl,
    "https://r.jina.ai/" + searchUrl,
  ];

  for (let i = 0; i < urls.length; i += 1) {
    try {
      const response = await fetch(urls[i], {
        cache: "no-store",
        signal: AbortSignal.timeout(i === 0 ? 10_000 : 15_000),
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Rumo-a-Conquista/1.0)",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
          "X-Engine": i === 0 ? "direct" : "browser",
          "X-Respond-With": "html",
          "X-No-Cache": "true",
        },
      });
      if (!response.ok) continue;
      const html = await response.text();
      const found = parseExophaseCatalogSearch(html, title);
      if (found.length) return found;
    } catch (error) {
      console.error("[Exophase Recovery Search]", error);
    }
  }

  return [];
}

function createAutomaticRecoveryResponse(req: NextRequest) {
  const encoder = new TextEncoder();
  const slugParam = req.nextUrl.searchParams.get("slug")?.trim() ?? "";
  const titleParam = req.nextUrl.searchParams.get("title")?.trim() ?? "";

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // A aba pode ter sido fechada; nesse caso não há mais cliente para informar.
        }
      };

      void (async () => {
        try {
          send({
            type: "progress",
            progress: 0,
            stage: "recovery",
            message: "Falha detectada. Iniciando a correção automática do preparador.",
          });

          const registeredGame = await resolveGameTitle(slugParam || null, titleParam);
          const primary = await findExophaseSteamGame(registeredGame.title);
          const staticCandidates = buildStaticRecoveryCandidates(registeredGame.title, slugParam);
          const candidates: ExophaseRecoveryCandidate[] = [
            { url: primary.url, label: "Endereço principal", source: "title" },
            ...staticCandidates,
          ].filter((candidate, index, all) => all.findIndex((item) => item.url === candidate.url) === index);

          const attemptedUrls = new Set<string>();
          const firstAttempts = candidates.slice(0, 5);
          const totalStatic = firstAttempts.length;
          let completedAttempts = 0;

          for (const candidate of firstAttempts) {
            if (attemptedUrls.has(candidate.url)) continue;
            attemptedUrls.add(candidate.url);
            const attemptNumber = completedAttempts + 1;
            const baseProgress = 8 + Math.floor((completedAttempts / Math.max(1, totalStatic)) * 52);
            send({
              type: "progress",
              progress: baseProgress,
              stage: "recovery",
              message: "Tentativa " + attemptNumber + "/" + totalStatic + ": " + candidate.label + ".",
            });

            const result = await fetchExophaseAchievements(candidate.url, (message) => {
              send({
                type: "progress",
                progress: baseProgress,
                stage: "recovery",
                message: "Tentativa " + attemptNumber + "/" + totalStatic + ": " + message,
              });
            });
            completedAttempts += 1;

            if (result && result.achievements.length > 0) {
              send({
                type: "progress",
                progress: 84,
                stage: "finalizing",
                message: "Conquistas encontradas. Organizando nomes, descrições e classificações.",
              });
              const builtResponse = await buildAchievementPreparation(registeredGame, result);
              const payload = await builtResponse.json();
              send({
                type: "success",
                progress: 100,
                stage: "complete",
                message: "Erro corrigido automaticamente. As conquistas foram recuperadas com sucesso.",
                result: payload,
                attempts: completedAttempts,
                sourceUrl: result.url,
              });
              return;
            }
          }

          send({
            type: "progress",
            progress: 64,
            stage: "recovery",
            message: "Os endereços previsíveis não funcionaram. Procurando o título diretamente no catálogo do Exophase.",
          });
          const catalogCandidates = await discoverExophaseCatalogCandidates(registeredGame.title, (message) => {
            send({ type: "progress", progress: 68, stage: "recovery", message });
          });
          const remainingCandidates = catalogCandidates.filter((candidate) => !attemptedUrls.has(candidate.url));
          const catalogAttempts = remainingCandidates.slice(0, 4);
          let catalogDone = 0;

          for (const candidate of catalogAttempts) {
            const attemptNumber = catalogDone + 1;
            const baseProgress = 72 + Math.floor((catalogDone / Math.max(1, catalogAttempts.length)) * 19);
            send({
              type: "progress",
              progress: baseProgress,
              stage: "recovery",
              message: "Tentando o resultado encontrado no catálogo (" + attemptNumber + "/" + catalogAttempts.length + "): " + candidate.label + ".",
            });

            const result = await fetchExophaseAchievements(candidate.url, (message) => {
              send({
                type: "progress",
                progress: baseProgress,
                stage: "recovery",
                message: "Catálogo Exophase: " + message,
              });
            });
            catalogDone += 1;

            if (result && result.achievements.length > 0) {
              send({
                type: "progress",
                progress: 94,
                stage: "finalizing",
                message: "A lista foi recuperada. Finalizando a preparação.",
              });
              const builtResponse = await buildAchievementPreparation(registeredGame, result);
              const payload = await builtResponse.json();
              send({
                type: "success",
                progress: 100,
                stage: "complete",
                message: "Erro corrigido automaticamente. As conquistas foram recuperadas com sucesso.",
                result: payload,
                attempts: completedAttempts + catalogDone,
                sourceUrl: result.url,
              });
              return;
            }
          }

          send({
            type: "failed",
            progress: 95,
            stage: "needs-attention",
            error: "Tentei novamente com diferentes endereços, leitores e o catálogo do Exophase, mas não consegui extrair uma lista válida. Não alterei nem apaguei suas conquistas salvas. Confira se o jogo tem uma página de conquistas/troféus no Exophase ou informe o link correto para adicionar como endereço preferencial.",
            message: "Todas as tentativas automáticas terminaram sem encontrar uma lista válida. Nenhum dado publicado foi alterado.",
            attempts: completedAttempts + catalogDone,
          });
        } catch (error) {
          send({
            type: "failed",
            progress: 95,
            stage: "needs-attention",
            error: error instanceof Error ? error.message : "Falha inesperada durante a correção automática.",
            message: "A correção automática parou por uma falha de serviço. Nenhuma lista publicada foi substituída.",
          });
        } finally {
          try {
            controller.close();
          } catch {
            // Sem cliente conectado.
          }
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function GET(req: NextRequest) {
  const titleParam = req.nextUrl.searchParams.get("title")?.trim() ?? "";
  const slugParam = req.nextUrl.searchParams.get("slug")?.trim() ?? "";

  if (req.nextUrl.searchParams.get("autoRecover") === "1") {
    return createAutomaticRecoveryResponse(req);
  }

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
            "Não consegui ler as conquistas pela rota principal do Exophase. O preparador pode tentar URLs alternativas, outros métodos de leitura e a busca no catálogo.",
          browserFallbackAvailable: true,
          recoverySuggested: true,
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

    return NextResponse.json({
      error: message,
      recoverySuggested: true,
    }, { status: 500 });
  }
}
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      slug?: string;
      title?: string;
      exophaseUrl?: string;
      achievements?: ExophaseAchievement[];
      sourceHtml?: string;
    };

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

    const providedAchievements = Array.isArray(body.achievements)
      ? body.achievements.filter((item) => item?.name && item?.description)
      : [];
    let achievements = providedAchievements;

    // Se o navegador conseguiu ler uma versão HTML/texto que o servidor não
    // conseguiu buscar, reutilizamos os mesmos parsers testados do endpoint GET.
    // Isso evita a heurística frágil que tentava adivinhar nome/descrição linha a linha.
    if (achievements.length === 0 && typeof body.sourceHtml === "string" && body.sourceHtml.trim()) {
      const sourceHtml = body.sourceHtml;
      achievements =
        parseExophaseHtml(sourceHtml) ??
        parseExophaseAchievementLinks(sourceHtml) ??
        parseExophaseText(sourceHtml) ??
        [];
    }

    if (achievements.length === 0) {
      return NextResponse.json(
        {
          error: "Não consegui estruturar as conquistas do Exophase, mesmo após a leitura pelo navegador. Confira se a página aberta é a página Steam correta do jogo.",
        },
        { status: 422 }
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
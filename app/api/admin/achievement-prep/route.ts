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
  return decodeHtml(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

async function findExophaseSteamGame(title: string) {
  const directUrl =
    "https://www.exophase.com/game/" + slug(title) + "-steam/achievements/";

  try {
    const directResponse = await fetch(directUrl, {
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Rumo-a-Conquista/1.0; +https://www.exophase.com/)",
      },
    });

    if (directResponse.ok) {
      const directHtml = await directResponse.text();
      if (/award-title|Total Achievements|achievement/i.test(directHtml)) {
        return { url: directUrl };
      }
    }
  } catch (error) {
    console.error("[Exophase Direct Lookup]", error);
  }

  const searchUrl =
    "https://www.exophase.com/games/?q=" + encodeURIComponent(title);

  try {
    const response = await fetch(searchUrl, {
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Rumo-a-Conquista/1.0; +https://www.exophase.com/)",
      },
    });

    if (!response.ok) return null;

    const html = await response.text();
    const candidates = Array.from(
      html.matchAll(/href=["'](\/game\/[^"'?#]+-steam\/achievements\/?)[ "']?/gi)
    ).map((match) => match[1]);

    const unique = [...new Set(candidates)];
    if (!unique.length) return null;

    const exactSlug = slug(title) + "-steam";
    const exact = unique.find((href) => {
      const match = href.match(/\/game\/([^/]+)\/achievements\/?$/i);
      return match?.[1] === exactSlug;
    });

    const href = exact ?? unique[0];
    return {
      url: href.startsWith("http") ? href : "https://www.exophase.com" + href,
    };
  } catch (error) {
    console.error("[Exophase Lookup]", error);
    return null;
  }
}

async function fetchExophaseAchievements(url: string) {
  const urls = [
    url.endsWith("/") ? url + "pt-BR/" : url + "/pt-BR/",
    url,
  ];

  for (const targetUrl of urls) {
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
      const titleMatches = Array.from(
        html.matchAll(
          /<[^>]*class=["'][^"']*award-title[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi
        )
      );

      if (!titleMatches.length) continue;

      const achievements: ExophaseAchievement[] = titleMatches
        .map((match, index) => {
          const title = stripHtml(match[1]);
          const start = (match.index ?? 0) + match[0].length;
          const end =
            index + 1 < titleMatches.length
              ? titleMatches[index + 1].index ?? html.length
              : html.length;
          const chunk = html.slice(start, end);
          const percentMatch = chunk.match(/(\d+(?:\.\d+)?)%/);
          const percent = percentMatch ? Number(percentMatch[1]) : undefined;
          const description = stripHtml(
            chunk
              .replace(/(\d+(?:\.\d+)?)%\s*\([^)]*\)/g, " ")
              .replace(/\([^)]*\)/g, " ")
          );

          return { name: title, description, percent };
        })
        .filter((achievement) => achievement.name);

      if (achievements.length) return { url: targetUrl, achievements };
    } catch (error) {
      console.error("[Exophase Achievements]", error);
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
import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

type SteamSearch = { items?: Array<{ id?: number; name?: string }> };
type Details = {
  name?: string;
  achievements?: Array<{
    name?: string;
    displayName?: string;
    description?: string;
    percent?: number;
  }>;
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

function isJourneyByCompletion(name: string, description: string) { const text = norm(`${name} ${description}`); return ["complete the campaign","complete the story","complete the game","finish the campaign","finish the story","finish the game","beat the game","wrap up the","complete the","resolve the","concluir a campanha","concluir a historia","concluir o jogo","finalizar a campanha","finalizar a historia","finalizar o jogo","resolver o caso","resolva o caso","complete o caso","conclua o caso","finalize o caso"].some((pattern) => text.includes(pattern)); }

async function searchSteam(title: string) {
  const r = await fetch(
    "https://store.steampowered.com/api/storesearch/?term=" +
      encodeURIComponent(title) +
      "&l=brazilian&cc=US",
    { cache: "no-store" }
  );

  if (!r.ok) return null;

  const p = (await r.json()) as SteamSearch;
  return (
    (p.items ?? []).find((x) => norm(x.name) === norm(title)) ??
    p.items?.[0] ??
    null
  );
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

async function details(id: number, language = "brazilian") {
  const url =
    `https://store.steampowered.com/api/appdetails?appids=${id}&cc=US&l=${language}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const r = await fetch(url, {
        cache: "no-store",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Rumo-a-Conquista/1.0)",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        },
      });

      if (!r.ok) continue;

      const p = (await r.json()) as Record<
        string,
        { success?: boolean; data?: Details }
      >;

      const data = p[String(id)]?.data;
      if (data) return data;
    } catch (error) {
      console.error("[Steam AppDetails]", error);
    }
  }

  return null;
}

async function communityDetails(id: number, title: string) {
  try {
    const r = await fetch(
      `https://steamcommunity.com/stats/${id}/achievements/?l=brazilian`,
      {
        cache: "no-store",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Rumo-a-Conquista/1.0)",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
          "X-ValveUserAgent": "panorama",
        },
      }
    );

    if (!r.ok) return null;

    const html = await r.text();
    const rows = Array.from(
      html.matchAll(
        /<div[^>]*class=["'][^"']*\bachieveRow\b[^"']*["'][^>]*>([\s\S]*?)(?=<div[^>]*class=["'][^"']*\bachieveRow\b|$)/gi
      )
    );

    const achievements = rows
      .map((match) => {
        const row = match[1];
        const titleMatch = row.match(
          /<div[^>]*class=["'][^"']*\bachieveTxt\b[^"']*["'][^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/i
        );
        const descriptionMatch = row.match(
          /<h5[^>]*>([\s\S]*?)<\/h5>/i
        );
        const percentMatch = row.match(/(\d+(?:\.\d+)?)%/);

        const displayName = titleMatch ? stripHtml(titleMatch[1]) : "";
        const description = descriptionMatch
          ? stripHtml(descriptionMatch[1])
          : "";
        const percent = percentMatch ? Number(percentMatch[1]) : undefined;

        return {
          name: `community-${slug(displayName)}`,
          displayName,
          description,
          percent,
        };
      })
      .filter((achievement) => achievement.displayName);

    if (!achievements.length) return null;

    return { name: title, achievements } satisfies Details;
  } catch (error) {
    console.error("[Steam Community Achievements]", error);
    return null;
  }
}

async function findExophaseSteamGame(title: string) {
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
      html.matchAll(/href=["'](\/game\/[^"'?#]+-steam\/achievements\/?)["']/gi)
    ).map((match) => match[1]);

    const unique = [...new Set(candidates)];

    if (!unique.length) return null;

    const normalizedTitle = norm(title);

    const exactSlug = slug(title) + "-steam";
    const exact = unique.find((href) => {
      const match = href.match(/\/game\/([^/]+)\/achievements\/?$/i);
      return match?.[1] === exactSlug;
    });

    const href = exact ?? unique[0];

    return {
      url: href.startsWith("http")
        ? href
        : "https://www.exophase.com" + href,
      searchedTitle: normalizedTitle,
    };
  } catch (error) {
    console.error("[Exophase Lookup]", error);
    return null;
  }
}

async function fetchExophaseAchievementTitles(url: string) {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Rumo-a-Conquista/1.0; +https://www.exophase.com/)",
      },
    });

    if (!response.ok) return null;

    const html = await response.text();
    const titles = Array.from(
      html.matchAll(
        /<[^>]*class=["'][^"']*award-title[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi
      )
    )
      .map((match) => stripHtml(match[1]))
      .filter(Boolean);

    return titles.length ? new Set(titles.map(norm)) : null;
  } catch (error) {
    console.error("[Exophase Achievements]", error);
    return null;
  }
}

async function percentages(id: number) {
  try {
    const r = await fetch(
      `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${id}`,
      { cache: "no-store" }
    );

    if (!r.ok) return new Map<string, number>();

    const p = (await r.json()) as {
      achievementpercentages?: {
        achievements?: Array<{ name?: string; percent?: number }>;
      };
    };

    return new Map(
      (p.achievementpercentages?.achievements ?? [])
        .filter((x) => x.name)
        .map((x) => [x.name!, Number(x.percent ?? 0)])
    );
  } catch {
    return new Map<string, number>();
  }
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
    if (!data) {
      throw new Error("Jogo cadastrado não encontrado.");
    }

    return {
      slug: String(data.slug),
      title: String(data.title),
    };
  }

  if (!titleParam) {
    throw new Error("O nome do jogo é obrigatório.");
  }

  return {
    slug: slug(titleParam),
    title: titleParam,
  };
}

export async function GET(req: NextRequest) {
  const titleParam = req.nextUrl.searchParams.get("title")?.trim() ?? "";
  const slugParam = req.nextUrl.searchParams.get("slug")?.trim() ?? "";

  try {
    const registeredGame = await resolveGameTitle(
      slugParam || null,
      titleParam
    );

    const g = await searchSteam(registeredGame.title);

    if (!g?.id) {
      return NextResponse.json(
        {
          error:
            "Não encontrei esse jogo na Steam. Nesta primeira etapa, a busca automática usa a base pública da Steam.",
        },
        { status: 404 }
      );
    }

    const storeDetails = await details(g.id);
    const d =
      storeDetails ??
      (await communityDetails(g.id, g.name || registeredGame.title));

    if (!d) {
      return NextResponse.json(
        {
          error:
            "Encontrei o jogo, mas não consegui carregar suas conquistas na Steam.",
        },
        { status: 502 }
      );
    }

    const [p, exophaseGame] = await Promise.all([
      percentages(g.id),
      findExophaseSteamGame(d.name || g.name || registeredGame.title),
    ]);

    const exophaseTitles = exophaseGame
      ? await fetchExophaseAchievementTitles(exophaseGame.url)
      : null;

    const englishDetails = exophaseTitles
      ? await details(g.id, "english")
      : null;

    const achievements = (d.achievements ?? [])
      .map((a, i) => {
        const name = a.displayName?.trim() || a.name?.trim() || "";
        const englishAchievement =
          englishDetails?.achievements?.[i]?.displayName?.trim() ||
          englishDetails?.achievements?.[i]?.name?.trim() ||
          "";

        const exophase =
          exophaseTitles && englishAchievement
            ? exophaseTitles.has(norm(englishAchievement))
              ? "sim"
              : "nao"
            : "nao_verificado";

        return {
          name,
          description: a.description?.trim() || "",
          rank: rank(
            typeof a.percent === "number"
              ? a.percent
              : a.name
                ? p.get(a.name)
                : undefined
          ),
          exophase: exophase as "sim" | "nao" | "nao_verificado",
          journey: isJourneyByCompletion(name, a.description?.trim() || ""),
          id: `${g.id}-achievement-${i + 1}-${slug(
            name || `conquista-${i + 1}`
          )}`,
        };
      })
      .filter((a) => a.name);

    return NextResponse.json({
      ok: true,
      game: {
        name: d.name || g.name || registeredGame.title,
        slug: registeredGame.slug,
        appId: g.id,
        source: "Steam",
        registered: Boolean(slugParam),
        exophase: exophaseGame
          ? {
              found: true,
              url: exophaseGame.url,
            }
          : {
              found: false,
              url: null,
            },
      },
      achievements,
      warnings: [
        "Rank Bronze/Prata/Ouro é uma sugestão automática baseada na raridade global da conquista na Steam.",
        exophaseGame
        ? exophaseTitles
          ? "Exophase consultado: cada conquista foi marcada apenas pela existência do mesmo título no Exophase."
          : "O jogo foi localizado no Exophase, mas não foi possível ler a lista de conquistas."
        : "O jogo ainda não foi localizado no Exophase. As conquistas ficam como Aguardando Exophase.",
      ],
    });
  } catch (e) {
    console.error("[Achievement Prep]", e);

    const message = e instanceof Error ? e.message : "Não foi possível preparar o jogo.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

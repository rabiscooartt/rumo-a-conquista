import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { inferPrimaryGenre } from "@/lib/gameGenres";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

type GameRow = {
  slug: string;
  title: string;
  platform: string | null;
  genres: string[] | null;
};

type GenreResult = {
  genres: string[];
  source: "igdb" | "steam" | "wikidata" | "none";
};

let igdbToken: { value: string; expiresAt: number } | null = null;

const genreLookupCache = new Map<string, { result: GenreResult; expiresAt: number }>();
const GENRE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const EDITION_SUFFIXES = [
  "game of the year edition",
  "collectors edition",
  "collector edition",
  "definitive edition",
  "anniversary edition",
  "legendary edition",
  "ultimate edition",
  "deluxe edition",
  "complete edition",
  "enhanced edition",
  "special edition",
  "standard edition",
  "premium edition",
  "royal edition",
  "gold edition",
  "remastered edition",
  "directors cut",
  "game of the year",
  "video game franchise",
  "video game series",
  "computer game",
  "video game",
  "goty edition",
  "goty",
  "hd remaster",
  "remastered",
  "remaster",
  "redux",
  "definitive",
  "directors cut",
  "enhanced",
  "anniversary",
  "edition",
];

function normalizeEditionTitle(value: unknown) {
  let normalized = normalizeText(value);
  let changed = true;

  // Some storefront names stack two edition labels (e.g. "X Ultimate Edition").
  while (changed && normalized) {
    changed = false;
    for (const suffix of EDITION_SUFFIXES) {
      if (normalized.endsWith(" " + suffix)) {
        normalized = normalized.slice(0, -(suffix.length + 1)).trim();
        changed = true;
        break;
      }
    }
  }

  return normalized;
}

function matchesGameTitle(query: string, candidate: unknown) {
  const queryExact = normalizeText(query);
  const candidateExact = normalizeText(candidate);
  if (queryExact && queryExact === candidateExact) return true;

  const queryBase = normalizeEditionTitle(query);
  const candidateBase = normalizeEditionTitle(candidate);
  return Boolean(queryBase && queryBase === candidateBase);
}

function getTitleSearchVariants(title: string) {
  const normalized = normalizeText(title);
  const base = normalizeEditionTitle(title);
  return [...new Set([title.trim(), ...(base && base !== normalized ? [base] : [])])]
    .filter(Boolean);
}

function translateGenre(value: string) {
  const normalized = normalizeText(value);

  const map: Record<string, string> = {
    action: "Ação",
    adventure: "Aventura",
    "role playing rpg": "RPG",
    rpg: "RPG",
    strategy: "Estratégia",
    "turn based strategy": "Estratégia por turnos",
    puzzle: "Puzzle",
    indie: "Indie",
    platform: "Plataforma",
    platformer: "Plataforma",
    shooter: "Tiro",
    fighting: "Luta",
    racing: "Corrida",
    simulation: "Simulação",
    sports: "Esportes",
    arcade: "Arcade",
    casual: "Casual",
    music: "Música",
    "hack and slash beat em up": "Hack and Slash",
    "hack and slash": "Hack and Slash",
    pinball: "Pinball",
    "card board game": "Cartas / Tabuleiro",
    "card and board game": "Cartas / Tabuleiro",
  };

  return map[normalized] || value.trim();
}

function cleanGenres(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map(translateGenre)
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).slice(0, 6);
}

async function getIgdbToken() {
  const clientId = process.env.IGDB_CLIENT_ID;
  const clientSecret = process.env.IGDB_CLIENT_SECRET;

  if (!clientId || !clientSecret) return null;

  if (igdbToken && igdbToken.expiresAt > Date.now() + 60_000) {
    return { clientId, token: igdbToken.value };
  }

  const response = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`,
    { method: "POST", cache: "no-store" }
  );

  if (!response.ok) return null;

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!payload.access_token) return null;

  igdbToken = {
    value: payload.access_token,
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in ?? 3600)) * 1000,
  };

  return { clientId, token: payload.access_token };
}

async function detectWithIgdb(title: string): Promise<string[] | null> {
  const auth = await getIgdbToken();
  if (!auth) return null;

  let receivedResponse = false;
  const resultsByName = new Map<string, { name?: string; genres?: Array<{ name?: string }> }>();

  for (const searchTerm of getTitleSearchVariants(title)) {
    try {
      const response = await fetch("https://api.igdb.com/v4/games", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Client-ID": auth.clientId,
          Authorization: "Bearer " + auth.token,
        },
        body: 'search "' + searchTerm.replace(/\\/g, "\\\\").replace(/"/g, '\\"') +
          '"; fields name,genres.name; where version_parent = null; limit 10;',
        cache: "no-store",
        signal: AbortSignal.timeout(4500),
      });

      if (!response.ok) continue;
      receivedResponse = true;
      const results = (await response.json()) as Array<{
        name?: string;
        genres?: Array<{ name?: string }>;
      }>;

      for (const game of results) {
        const key = normalizeText(game.name);
        if (key) resultsByName.set(key, game);
      }

      const matchingGame = results.find((game) => matchesGameTitle(title, game.name));
      if (matchingGame) {
        const genres = cleanGenres((matchingGame.genres ?? []).map((genre) => genre.name ?? ""));
        if (genres.length > 0) return genres;
      }
    } catch (error) {
      console.warn("[Genres] Consulta de título na IGDB falhou:", error);
    }
  }

  if (!receivedResponse && resultsByName.size === 0) return null;
  return [];
}

async function detectWithSteam(title: string): Promise<string[] | null> {
  let receivedResponse = false;
  const itemsById = new Map<number, { id?: number; name?: string; type?: number }>();

  for (const searchTerm of getTitleSearchVariants(title)) {
    try {
      const searchUrl =
        "https://store.steampowered.com/api/storesearch/?term=" +
        encodeURIComponent(searchTerm) +
        "&l=english&cc=US";
      const searchResponse = await fetch(searchUrl, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(4500),
      });

      if (!searchResponse.ok) continue;
      receivedResponse = true;

      const searchPayload = (await searchResponse.json()) as {
        items?: Array<{ id?: number; name?: string; type?: number }>;
      };

      for (const item of searchPayload.items ?? []) {
        if (item.id && (item.type === undefined || item.type === 0)) {
          itemsById.set(item.id, item);
        }
      }

      const matchingItem = [...itemsById.values()].find((item) =>
        matchesGameTitle(title, item.name)
      );
      if (!matchingItem?.id) continue;

      const detailsResponse = await fetch(
        "https://store.steampowered.com/api/appdetails?appids=" +
          matchingItem.id +
          "&cc=US&l=english",
        {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(4500),
        }
      );

      if (!detailsResponse.ok) continue;

      const detailsPayload = (await detailsResponse.json()) as Record<
        string,
        {
          success?: boolean;
          data?: { genres?: Array<{ description?: string }> };
        }
      >;
      const details = detailsPayload[String(matchingItem.id)];
      if (!details?.success) continue;

      const genres = cleanGenres(
        (details.data?.genres ?? []).map((genre) => genre.description ?? "")
      );
      if (genres.length > 0) return genres;
    } catch (error) {
      console.warn("[Genres] Consulta de título na Steam falhou:", error);
    }
  }

  if (!receivedResponse) return null;
  return [];
}

type WikidataSearchItem = {
  id?: string;
  label?: string;
  title?: string;
  description?: string;
};

type WikidataEntity = {
  claims?: Record<
    string,
    Array<{
      mainsnak?: {
        datavalue?: {
          value?: { id?: string; "numeric-id"?: number; "entity-type"?: string };
        };
      };
    }>
  >;
};

function looksLikeGameDescription(value: string) {
  const description = normalizeText(value);
  return /(video game|computer game|arcade game|game franchise|game series|interactive entertainment)/.test(description);
}

async function detectWithWikidata(title: string): Promise<string[] | null> {
  let receivedResponse = false;
  const matches = new Map<string, WikidataSearchItem>();

  for (const searchTerm of getTitleSearchVariants(title)) {
    try {
      const searchUrl = new URL("https://www.wikidata.org/w/api.php");
      searchUrl.search = new URLSearchParams({
        action: "wbsearchentities",
        search: searchTerm,
        language: "en",
        uselang: "en",
        type: "item",
        limit: "8",
        format: "json",
      }).toString();

      const response = await fetch(searchUrl, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent": "RumoAConquista/1.0 (game genre lookup)",
        },
        signal: AbortSignal.timeout(4500),
      });
      if (!response.ok) continue;
      receivedResponse = true;

      const payload = (await response.json()) as { search?: WikidataSearchItem[] };
      for (const item of payload.search ?? []) {
        const label = item.label || item.title || "";
        if (!item.id || !matchesGameTitle(title, label)) continue;
        if (item.description && !looksLikeGameDescription(item.description)) continue;
        matches.set(item.id, { ...item, label });
      }
    } catch (error) {
      console.warn("[Genres] Consulta no Wikidata falhou:", error);
    }
  }

  if (matches.size === 0) return receivedResponse ? [] : null;

  const orderedMatches = [...matches.values()].sort((a, b) => {
    const aExact = normalizeText(a.label || a.title) === normalizeText(title) ? 1 : 0;
    const bExact = normalizeText(b.label || b.title) === normalizeText(title) ? 1 : 0;
    const aDescribed = a.description && looksLikeGameDescription(a.description) ? 1 : 0;
    const bDescribed = b.description && looksLikeGameDescription(b.description) ? 1 : 0;
    return bExact - aExact || Number(bDescribed) - Number(aDescribed);
  });

  for (const item of orderedMatches.slice(0, 3)) {
    if (!item.id) continue;

    try {
      const entityUrl = new URL("https://www.wikidata.org/w/api.php");
      entityUrl.search = new URLSearchParams({
        action: "wbgetentities",
        ids: item.id,
        props: "claims",
        format: "json",
      }).toString();

      const entityResponse = await fetch(entityUrl, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent": "RumoAConquista/1.0 (game genre lookup)",
        },
        signal: AbortSignal.timeout(4500),
      });
      if (!entityResponse.ok) continue;

      const entityPayload = (await entityResponse.json()) as {
        entities?: Record<string, WikidataEntity>;
      };
      const claims = entityPayload.entities?.[item.id]?.claims?.P136 ?? [];
      const genreIds = [...new Set(
        claims
          .map((claim) => {
            const value = claim.mainsnak?.datavalue?.value;
            if (value?.id) return value.id;
            if (typeof value?.["numeric-id"] === "number") return "Q" + value["numeric-id"];
            return "";
          })
          .filter((id) => /^Q\d+$/.test(id))
      )];
      if (genreIds.length === 0) continue;

      const labelsUrl = new URL("https://www.wikidata.org/w/api.php");
      labelsUrl.search = new URLSearchParams({
        action: "wbgetentities",
        ids: genreIds.join("|"),
        props: "labels",
        languages: "en|pt",
        languagefallback: "1",
        format: "json",
      }).toString();

      const labelsResponse = await fetch(labelsUrl, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent": "RumoAConquista/1.0 (game genre lookup)",
        },
        signal: AbortSignal.timeout(4500),
      });
      if (!labelsResponse.ok) continue;

      const labelsPayload = (await labelsResponse.json()) as {
        entities?: Record<string, { labels?: Record<string, { value?: string }> }>;
      };
      const genres = cleanGenres(
        genreIds.map((id) =>
          labelsPayload.entities?.[id]?.labels?.en?.value ||
          labelsPayload.entities?.[id]?.labels?.pt?.value ||
          ""
        )
      );
      if (genres.length > 0) return genres;
    } catch (error) {
      console.warn("[Genres] Não foi possível ler gêneros do Wikidata:", error);
    }
  }

  return [];
}

async function detectGenres(title: string): Promise<GenreResult> {
  const cacheKey = normalizeText(title);
  const cached = genreLookupCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  if (cached) genreLookupCache.delete(cacheKey);

  const providers: Array<{
    source: GenreResult["source"];
    lookup: (title: string) => Promise<string[] | null>;
  }> = [
    { source: "steam", lookup: detectWithSteam },
    { source: "igdb", lookup: detectWithIgdb },
    {
      source: "wikidata",
      lookup: detectWithWikidata,
    },
  ];

  for (const provider of providers) {
    try {
      const genres = await provider.lookup(title);
      if (genres && genres.length > 0) {
        const result: GenreResult = { genres, source: provider.source };
        if (genreLookupCache.size > 1500) {
          const firstKey = genreLookupCache.keys().next().value;
          if (firstKey) genreLookupCache.delete(firstKey);
        }
        genreLookupCache.set(cacheKey, {
          result,
          expiresAt: Date.now() + GENRE_CACHE_TTL_MS,
        });
        return result;
      }
    } catch (error) {
      console.warn("[Genres] Provedor " + provider.source + " falhou:", error);
    }
  }

  return { genres: [], source: "none" };
}

export async function GET() {
  try {
    const client = createAdminSupabaseClient();

    const { data, error } = await client
      .from("games")
      .select("slug, title, platform, genres")
      .eq("is_deleted", false)
      .order("title", { ascending: true });

    if (error) throw error;

    const rows = (data ?? []) as GameRow[];
    const genresBySlug: Record<string, string[]> = {};
    const sourceBySlug: Record<string, string> = {};

    const savedRows = rows.filter((game) => Array.isArray(game.genres));
    const pendingRows = rows.filter((game) => game.genres === null);

    for (const game of savedRows) {
      genresBySlug[game.slug] = game.genres!.filter(Boolean);
      sourceBySlug[game.slug] = "saved";
    }

    // Os gêneros já salvos são suficientes para montar o mapa imediatamente.
    // Os jogos sem gênero ficam para enriquecimento em segundo plano, sem bloquear
    // a resposta da Biblioteca.
    if (pendingRows.length > 0) {
      after(async () => {
        await Promise.all(
          pendingRows.map(async (game) => {
            try {
              const detected = await detectGenres(game.title);

              if (detected.genres.length > 0) {
                const { error: updateError } = await client
                  .from("games")
                  .update({ genres: detected.genres })
                  .eq("slug", game.slug);

                if (updateError) {
                  console.warn(
                    `[Genres] Não foi possível salvar ${game.slug}:`,
                    updateError
                  );
                }
              }
            } catch (error) {
              console.warn(
                `[Genres] Não foi possível identificar ${game.slug}:`,
                error
              );
            }
          })
        );
      });
    }

    return NextResponse.json(
      {
        ok: true,
        genresBySlug,
        sourceBySlug,
        pendingSlugs: pendingRows.map((game) => game.slug),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error("[Genres] Erro:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível identificar os gêneros." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { titles?: unknown };
    if (!Array.isArray(body.titles)) {
      return NextResponse.json(
        { error: "Envie uma lista de títulos para identificar os gêneros." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const titles = Array.from(
      new Set(
        body.titles
          .filter((title): title is string => typeof title === "string")
          .map((title) => title.trim().replace(/\s+/g, " "))
          .filter(Boolean)
      )
    ).slice(0, 3);

    if (titles.length === 0) {
      return NextResponse.json(
        { error: "Informe pelo menos um título válido." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const results: Array<{
      title: string;
      genres: string[];
      primaryGenre: string;
      source: GenreResult["source"];
    }> = [];

    // Cada requisição processa até três jogos, para manter a cadeia de fontes
    // externas rápida e reduzir risco de timeout ao usar o Wikidata como fallback.
    for (let index = 0; index < titles.length; index += 3) {
      const batch = titles.slice(index, index + 3);
      const detected = await Promise.all(
        batch.map(async (title) => {
          const result = await detectGenres(title);
          return {
            title,
            genres: result.genres,
            primaryGenre: inferPrimaryGenre(result.genres),
            source: result.source,
          };
        })
      );
      results.push(...detected);
    }

    return NextResponse.json(
      { ok: true, results },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[Genres] Lookup em lote falhou:", error);
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "Não foi possível buscar os gêneros neste momento.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

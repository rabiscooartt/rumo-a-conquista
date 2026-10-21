import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { inferPrimaryGenre } from "@/lib/gameGenres";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const maxDuration = 60;

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

function normalizeTitleForMatch(value: unknown) {
  return normalizeEditionTitle(value)
    .replace(/^(the|a|an)\s+/, "")
    .replace(/\s+\\((?:pc|windows|steam|playstation ?[345]|xbox(?: one| series [xs])?|nintendo switch)\\)$/, "")
    .replace(/\s*\\((?:19|20)\d{2}\\)$/, "")
    .trim();
}

function matchesGameTitle(query: string, candidate: unknown) {
  const queryExact = normalizeTitleForMatch(query);
  const candidateExact = normalizeTitleForMatch(candidate);
  return Boolean(queryExact && candidateExact && queryExact === candidateExact);
}

function getTitleSearchVariants(title: string, deepSearch = false) {
  const normalized = normalizeText(title);
  const base = normalizeEditionTitle(title);
  const variants = [title.trim(), ...(base && base !== normalized ? [base] : [])];

  if (deepSearch) {
    const withoutArticle = (value: string) => value.replace(/^(the|a|an)\s+/i, "").trim();
    const expanded = [...variants];
    for (const variant of variants) {
      const noArticle = withoutArticle(variant);
      if (noArticle && noArticle !== variant) expanded.push(noArticle);

      // Storefronts differ in subtitle separators; query the leading title too,
      // while match validation below still requires a compatible full title or alias.
      const separatorIndex = variant.search(/\s(?::|[-–—|])\s/);
      if (separatorIndex > 2) {
        const head = variant.slice(0, separatorIndex).trim();
        if (head.length >= 3) expanded.push(head);
      }

      const withoutFinalYear = variant.replace(/\s*\\((?:19|20)\d{2}\\)$/,"").trim();
      if (withoutFinalYear && withoutFinalYear !== variant) expanded.push(withoutFinalYear);
    }
    variants.push(...expanded);
  }

  return [...new Set(variants.map((variant) => variant.trim()).filter(Boolean))].slice(0, deepSearch ? 8 : 2);
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

async function detectWithIgdb(title: string, deepSearch = false): Promise<string[] | null> {
  const auth = await getIgdbToken();
  if (!auth) return null;

  let receivedResponse = false;
  const variants = getTitleSearchVariants(title, deepSearch);

  // First pass: exact/edition-compatible game title.
  for (const searchTerm of variants) {
    try {
      const response = await fetch("https://api.igdb.com/v4/games", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Client-ID": auth.clientId,
          Authorization: "Bearer " + auth.token,
        },
        body: 'search "' + searchTerm.replace(/\\/g, "\\\\").replace(/"/g, '\\"') +
          '"; fields id,name,genres.name; where version_parent = null; limit 20;',
        cache: "no-store",
        signal: AbortSignal.timeout(4500),
      });

      if (!response.ok) continue;
      receivedResponse = true;
      const results = (await response.json()) as Array<{
        id?: number;
        name?: string;
        genres?: Array<{ name?: string }>;
      }>;

      const matchingGame = results.find((game) => matchesGameTitle(title, game.name));
      if (matchingGame) {
        const genres = cleanGenres((matchingGame.genres ?? []).map((genre) => genre.name ?? ""));
        if (genres.length > 0) return genres;
      }
    } catch (error) {
      console.warn("[Genres] Consulta direta na IGDB falhou:", error);
    }
  }

  // Second pass: search IGDB's own alternative-title records.
  const matchedGameIds: number[] = [];
  for (const searchTerm of variants) {
    try {
      const response = await fetch("https://api.igdb.com/v4/alternative_names", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Client-ID": auth.clientId,
          Authorization: "Bearer " + auth.token,
        },
        body: 'search "' + searchTerm.replace(/\\/g, "\\\\").replace(/"/g, '\\"') +
          '"; fields name,game; limit 30;',
        cache: "no-store",
        signal: AbortSignal.timeout(4500),
      });

      if (!response.ok) continue;
      receivedResponse = true;
      const aliases = (await response.json()) as Array<{
        name?: string;
        game?: number | { id?: number };
      }>;

      for (const alias of aliases) {
        if (!matchesGameTitle(title, alias.name)) continue;
        const gameId = typeof alias.game === "number" ? alias.game : alias.game?.id;
        if (typeof gameId === "number" && Number.isFinite(gameId)) {
          matchedGameIds.push(gameId);
        }
      }
    } catch (error) {
      console.warn("[Genres] Busca por nome alternativo na IGDB falhou:", error);
    }
  }

  const gameIds = [...new Set(matchedGameIds)].slice(0, 8);
  if (gameIds.length > 0) {
    try {
      const response = await fetch("https://api.igdb.com/v4/games", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Client-ID": auth.clientId,
          Authorization: "Bearer " + auth.token,
        },
        body: "fields id,name,genres.name; where id = (" + gameIds.join(",") + "); limit 8;",
        cache: "no-store",
        signal: AbortSignal.timeout(4500),
      });

      if (response.ok) {
        const games = (await response.json()) as Array<{
          id?: number;
          name?: string;
          genres?: Array<{ name?: string }>;
        }>;
        for (const id of gameIds) {
          const game = games.find((item) => item.id === id);
          const genres = cleanGenres((game?.genres ?? []).map((genre) => genre.name ?? ""));
          if (genres.length > 0) return genres;
        }
      }
    } catch (error) {
      console.warn("[Genres] Não foi possível buscar o jogo via nome alternativo:", error);
    }
  }

  return receivedResponse ? [] : null;
}

function decodeSteamHtml(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

async function getSteamGenresByAppId(appId: number): Promise<string[]> {
  const detailsResponse = await fetch(
    "https://store.steampowered.com/api/appdetails?appids=" +
      appId +
      "&cc=US&l=english",
    {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(4000),
    }
  );
  if (!detailsResponse.ok) return [];

  const detailsPayload = (await detailsResponse.json()) as Record<
    string,
    {
      success?: boolean;
      data?: { genres?: Array<{ description?: string }> };
    }
  >;
  const details = detailsPayload[String(appId)];
  if (!details?.success) return [];

  return cleanGenres(
    (details.data?.genres ?? []).map((genre) => genre.description ?? "")
  );
}

async function detectWithSteam(title: string, deepSearch = false): Promise<string[] | null> {
  let receivedResponse = false;
  const variants = getTitleSearchVariants(title, deepSearch);
  const itemsById = new Map<number, { id?: number; name?: string; type?: number }>();

  // Fast Steam Store search first.
  for (const searchTerm of variants) {
    try {
      const searchUrl =
        "https://store.steampowered.com/api/storesearch/?term=" +
        encodeURIComponent(searchTerm) +
        "&l=english&cc=US";
      const searchResponse = await fetch(searchUrl, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(3500),
      });
      if (!searchResponse.ok) continue;
      receivedResponse = true;

      const payload = (await searchResponse.json()) as {
        items?: Array<{ id?: number; name?: string; type?: number }>;
      };
      for (const item of payload.items ?? []) {
        if (item.id && (item.type === undefined || item.type === 0)) {
          itemsById.set(item.id, item);
        }
      }

      const match = [...itemsById.values()].find((item) =>
        matchesGameTitle(title, item.name)
      );
      if (match?.id) {
        const genres = await getSteamGenresByAppId(match.id);
        if (genres.length > 0) return genres;
      }
    } catch (error) {
      console.warn("[Genres] Steam storesearch falhou:", error);
    }
  }

  // storesearch has a small result cap. Its public search/results endpoint can
  // return a larger list, which helps locate games hidden behind other matches.
  for (const searchTerm of variants) {
    try {
      const params = new URLSearchParams({
        json: "1",
        term: searchTerm,
        count: "50",
        start: "0",
        category1: "998",
        cc: "US",
        l: "english",
      });
      const response = await fetch(
        "https://store.steampowered.com/search/results/?" + params.toString(),
        {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(4000),
        }
      );
      if (!response.ok) continue;
      receivedResponse = true;

      const payload = (await response.json()) as {
        results_html?: string;
        total_count?: number;
        success?: number;
      };
      const html = payload.results_html || "";
      const cards = html.match(/<a\b[^>]*class="[^"]*\bsearch_result_row\b[^"]*"[^>]*>[\s\S]*?<\/a>/gi) || [];
      const matches: Array<{ id: number; name: string }> = [];

      for (const card of cards) {
        const idMatch = card.match(/\bdata-ds-appid="(\d+)"/i) ||
          card.match(/\/app\/(\d+)\//i);
        const titleMatch = card.match(/<span[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
        if (!idMatch?.[1] || !titleMatch?.[1]) continue;
        const name = decodeSteamHtml(titleMatch[1].replace(/<[^>]+>/g, "").trim());
        if (name && matchesGameTitle(title, name)) {
          matches.push({ id: Number(idMatch[1]), name });
        }
      }

      for (const match of matches.slice(0, 2)) {
        if (!Number.isFinite(match.id)) continue;
        const genres = await getSteamGenresByAppId(match.id);
        if (genres.length > 0) return genres;
      }
    } catch (error) {
      console.warn("[Genres] Steam search/results falhou:", error);
    }
  }

  return receivedResponse ? [] : null;
}

type WikidataSearchItem = {
  id?: string;
  label?: string;
  title?: string;
  description?: string;
  match?: { type?: string; text?: string; language?: string };
  aliases?: Array<{ value?: string; language?: string }>;
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
  if (/(film|movie|television|tv series|album|soundtrack|song|novel|manga|comic book|book|board game|card game|tabletop game|software company|game developer|game publisher|video game series|game franchise)/.test(description)) {
    return false;
  }
  return /(video game|computer game|arcade game|action rpg|role playing game|platform game|rpg|videogame|videojogo|jogo eletronico|jogo de computador|jogo digital|jeu video|videogioco)/.test(description);
}

function wikidataItemMatchesTitle(title: string, item: WikidataSearchItem) {
  const label = item.label || item.title || "";
  if (matchesGameTitle(title, label)) return true;
  if (item.match?.text && matchesGameTitle(title, item.match.text)) return true;
  return (item.aliases ?? []).some((alias) =>
    typeof alias.value === "string" && matchesGameTitle(title, alias.value)
  );
}

async function detectWithWikidata(title: string, deepSearch = false): Promise<string[] | null> {
  let receivedResponse = false;
  const candidates = new Map<string, { item: WikidataSearchItem; score: number }>();
  const variants = getTitleSearchVariants(title, deepSearch);
  const searches = variants.flatMap((searchTerm) =>
    ["en", "pt"].map((language) => ({ searchTerm, language }))
  );

  // Search labels and aliases in both languages concurrently to make retries faster.
  const responses = await Promise.all(
    searches.map(async ({ searchTerm, language }) => {
      try {
        const url = new URL("https://www.wikidata.org/w/api.php");
        url.search = new URLSearchParams({
          action: "wbsearchentities",
          search: searchTerm,
          language,
          uselang: language,
          type: "item",
          limit: "10",
          format: "json",
        }).toString();

        const response = await fetch(url, {
          cache: "no-store",
          headers: {
            Accept: "application/json",
            "User-Agent": "RumoAConquista/1.0 (game genre lookup)",
          },
          signal: AbortSignal.timeout(3500),
        });
        if (!response.ok) return null;
        return await response.json() as { search?: WikidataSearchItem[] };
      } catch (error) {
        console.warn("[Genres] Consulta no Wikidata falhou:", error);
        return null;
      }
    })
  );

  for (const payload of responses) {
    if (!payload) continue;
    receivedResponse = true;
    for (const item of payload.search ?? []) {
      if (!item.id || !wikidataItemMatchesTitle(title, item)) continue;
      if (item.description && !looksLikeGameDescription(item.description)) continue;

      const label = item.label || item.title || "";
      const aliasHit = Boolean(
        item.match?.text && matchesGameTitle(title, item.match.text)
      );
      const score =
        (normalizeText(label) === normalizeText(title) ? 100 : 0) +
        (aliasHit ? 40 : 0) +
        (item.description && looksLikeGameDescription(item.description) ? 25 : 0);
      const previous = candidates.get(item.id);
      if (!previous || score > previous.score) candidates.set(item.id, { item, score });
    }
  }

  if (candidates.size === 0) return receivedResponse ? [] : null;

  const ordered = [...candidates.values()].sort((a, b) => b.score - a.score);
  for (const { item } of ordered.slice(0, 3)) {
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
        signal: AbortSignal.timeout(3500),
      });
      if (!entityResponse.ok) continue;

      const entityPayload = await entityResponse.json() as {
        entities?: Record<string, WikidataEntity>;
      };
      const claims = entityPayload.entities?.[item.id]?.claims?.P136 ?? [];
      const genreIds = [...new Set(
        claims.map((claim) => {
          const value = claim.mainsnak?.datavalue?.value;
          if (value?.id) return value.id;
          if (typeof value?.["numeric-id"] === "number") return "Q" + value["numeric-id"];
          return "";
        }).filter((id) => /^Q\d+$/.test(id))
      )];
      if (!genreIds.length) continue;

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
        signal: AbortSignal.timeout(3500),
      });
      if (!labelsResponse.ok) continue;

      const labelsPayload = await labelsResponse.json() as {
        entities?: Record<string, { labels?: Record<string, { value?: string }> }>;
      };
      const genres = cleanGenres(
        genreIds.map((id) =>
          labelsPayload.entities?.[id]?.labels?.en?.value ||
          labelsPayload.entities?.[id]?.labels?.pt?.value ||
          ""
        )
      );
      if (genres.length) return genres;
    } catch (error) {
      console.warn("[Genres] Consulta de gêneros do Wikidata falhou:", error);
    }
  }

  return [];
}

async function detectGenres(title: string, deepSearch = false): Promise<GenreResult> {
  const cacheKey = normalizeText(title);
  const cached = genreLookupCache.get(cacheKey);
  if (!deepSearch && cached && cached.expiresAt > Date.now()) return cached.result;
  if (cached) genreLookupCache.delete(cacheKey);

  const standardProviders: Array<{
    source: GenreResult["source"];
    lookup: (title: string, deepSearch?: boolean) => Promise<string[] | null>;
  }> = [
    { source: "steam", lookup: detectWithSteam },
    { source: "igdb", lookup: detectWithIgdb },
    { source: "wikidata", lookup: detectWithWikidata },
  ];

  // On retry, favor richer title metadata first and ask every source to try the expanded variants.
  const providers = deepSearch
    ? [standardProviders[1], standardProviders[2], standardProviders[0]]
    : standardProviders;

  for (const provider of providers) {
    try {
      const genres = await provider.lookup(title, deepSearch);
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
      console.warn("[Genres] Provedor " + provider.source + (deepSearch ? " (busca ampliada)" : "") + " falhou:", error);
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
    const body = (await request.json()) as { titles?: unknown; mode?: unknown };
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

    const deepSearch = body.mode === "retry";
    const results: Array<{
      title: string;
      genres: string[];
      primaryGenre: string;
      source: GenreResult["source"];
    }> = [];

    for (let index = 0; index < titles.length; index += 3) {
      const batch = titles.slice(index, index + 3);
      const detected = await Promise.all(
        batch.map(async (title) => {
          const result = await detectGenres(title, deepSearch);
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

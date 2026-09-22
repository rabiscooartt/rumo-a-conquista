import { after } from "next/server";
import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

type GameRow = {
  slug: string;
  title: string;
  platform: string | null;
  genres: string[] | null;
};

type GenreResult = {
  genres: string[];
  source: "igdb" | "steam" | "none";
};

let igdbToken: { value: string; expiresAt: number } | null = null;

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

  const response = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Client-ID": auth.clientId,
      Authorization: `Bearer ${auth.token}`,
    },
    body: `search "${title.replace(/"/g, "\\\"")}"; fields name,genres.name; where version_parent = null; limit 5;`,
    cache: "no-store",
  });

  if (!response.ok) return null;

  const results = (await response.json()) as Array<{
    name?: string;
    genres?: Array<{ name?: string }>;
  }>;

  if (!results.length) return [];

  const normalizedTitle = normalizeText(title);
  const exact =
    results.find((game) => normalizeText(game.name) === normalizedTitle) ??
    results[0];

  return cleanGenres((exact.genres ?? []).map((genre) => genre.name ?? ""));
}

async function detectWithSteam(title: string): Promise<string[] | null> {
  const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&l=english&cc=US`;
  const searchResponse = await fetch(searchUrl, { cache: "no-store" });

  if (!searchResponse.ok) return null;

  const searchPayload = (await searchResponse.json()) as {
    items?: Array<{ id?: number; name?: string }>;
  };

  const items = searchPayload.items ?? [];
  if (!items.length) return [];

  const normalizedTitle = normalizeText(title);
  const exact =
    items.find((item) => normalizeText(item.name) === normalizedTitle) ??
    items[0];

  if (!exact.id) return [];

  const detailsResponse = await fetch(
    `https://store.steampowered.com/api/appdetails?appids=${exact.id}&cc=US&l=english`,
    { cache: "no-store" }
  );

  if (!detailsResponse.ok) return null;

  const detailsPayload = (await detailsResponse.json()) as Record<
    string,
    {
      success?: boolean;
      data?: { genres?: Array<{ description?: string }> };
    }
  >;

  const details = detailsPayload[String(exact.id)];
  if (!details?.success) return [];

  return cleanGenres(
    (details.data?.genres ?? []).map((genre) => genre.description ?? "")
  );
}

async function detectGenres(title: string): Promise<GenreResult> {
  try {
    const igdbGenres = await detectWithIgdb(title);
    if (igdbGenres !== null) {
      return { genres: igdbGenres, source: "igdb" };
    }
  } catch (error) {
    console.warn("[Genres] IGDB falhou:", error);
  }

  try {
    const steamGenres = await detectWithSteam(title);
    if (steamGenres !== null) {
      return { genres: steamGenres, source: "steam" };
    }
  } catch (error) {
    console.warn("[Genres] Steam Store falhou:", error);
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

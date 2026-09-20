import { NextRequest, NextResponse } from "next/server";

type Metadata = {
  genres: string[];
  platforms: string[];
  developer: string;
  releaseYear: string;
  source: "igdb" | "steam" | "none";
};

let igdbToken: { value: string; expiresAt: number } | null = null;

function normalize(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cleanList(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function translateGenre(value: string) {
  const map: Record<string, string> = {
    action: "Ação",
    adventure: "Aventura",
    "role playing rpg": "RPG",
    rpg: "RPG",
    strategy: "Estratégia",
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
  };
  return map[normalize(value)] || value.trim();
}

function translatePlatform(value: string) {
  const key = normalize(value);
  if (key.includes("playstation 5")) return "PS5";
  if (key.includes("playstation 4")) return "PS4";
  if (key.includes("playstation 3")) return "PS3";
  if (key.includes("xbox series")) return "Xbox Series";
  if (key.includes("xbox one")) return "Xbox One";
  if (key.includes("nintendo switch 2")) return "Switch 2";
  if (key.includes("nintendo switch")) return "Switch";
  if (key.includes("pc") || key.includes("windows") || key.includes("linux") || key.includes("mac")) return "PC";
  return value.trim();
}

async function getIgdbAuth() {
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

  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) return null;

  igdbToken = {
    value: payload.access_token,
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in ?? 3600)) * 1000,
  };

  return { clientId, token: payload.access_token };
}

async function fromIgdb(title: string): Promise<Metadata | null> {
  const auth = await getIgdbAuth();
  if (!auth) return null;

  const response = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Client-ID": auth.clientId,
      Authorization: `Bearer ${auth.token}`,
    },
    body:
      `search "${title.replace(/"/g, "\\\"")}"; ` +
      "fields name,genres.name,platforms.name,involved_companies.company.name,first_release_date; " +
      "where version_parent = null; limit 8;",
    cache: "no-store",
  });

  if (!response.ok) return null;

  const results = (await response.json()) as Array<{
    name?: string;
    genres?: Array<{ name?: string }>;
    platforms?: Array<{ name?: string }>;
    involved_companies?: Array<{
      company?: { name?: string };
      developer?: boolean;
    }>;
    first_release_date?: number;
  }>;

  if (!results.length) return null;

  const exact =
    results.find((game) => normalize(game.name) === normalize(title)) ??
    results[0];

  const genres = cleanList((exact.genres ?? []).map((item) => item.name ?? "")).map(translateGenre);
  const platforms = cleanList((exact.platforms ?? []).map((item) => item.name ?? "")).map(translatePlatform);
  const developer =
    exact.involved_companies?.find((item) => item.developer)?.company?.name ??
    exact.involved_companies?.[0]?.company?.name ??
    "";
  const releaseYear = exact.first_release_date
    ? String(new Date(exact.first_release_date * 1000).getUTCFullYear())
    : "";

  return {
    genres: cleanList(genres).slice(0, 6),
    platforms: cleanList(platforms).slice(0, 4),
    developer: developer.trim(),
    releaseYear,
    source: "igdb",
  };
}

async function fromSteam(title: string): Promise<Metadata | null> {
  const searchResponse = await fetch(
    `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&l=english&cc=US`,
    { cache: "no-store" }
  );
  if (!searchResponse.ok) return null;

  const search = (await searchResponse.json()) as {
    items?: Array<{ id?: number; name?: string }>;
  };
  const items = search.items ?? [];
  if (!items.length) return null;

  const exact =
    items.find((item) => normalize(item.name) === normalize(title)) ??
    items[0];
  if (!exact.id) return null;

  const response = await fetch(
    `https://store.steampowered.com/api/appdetails?appids=${exact.id}&cc=US&l=english`,
    { cache: "no-store" }
  );
  if (!response.ok) return null;

  const payload = (await response.json()) as Record<string, {
    success?: boolean;
    data?: {
      genres?: Array<{ description?: string }>;
      developers?: string[];
      platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
      release_date?: { date?: string };
    };
  }>;

  const data = payload[String(exact.id)]?.data;
  if (!data) return null;

  const genres = cleanList((data.genres ?? []).map((item) => item.description ?? "")).map(translateGenre);
  const platforms: string[] = [];
  if (data.platforms?.windows || data.platforms?.mac || data.platforms?.linux) platforms.push("PC");

  const releaseDate = data.release_date?.date ?? "";
  const yearMatch = releaseDate.match(/\b(19|20)\d{2}\b/);

  return {
    genres: cleanList(genres).slice(0, 6),
    platforms,
    developer: data.developers?.[0]?.trim() ?? "",
    releaseYear: yearMatch?.[0] ?? "",
    source: "steam",
  };
}

export async function GET(request: NextRequest) {
  const title = request.nextUrl.searchParams.get("title")?.trim() ?? "";
  if (!title) {
    return NextResponse.json({ error: "Título do jogo é obrigatório." }, { status: 400 });
  }

  try {
    const igdb = await fromIgdb(title);
    if (igdb && (igdb.genres.length || igdb.platforms.length || igdb.developer || igdb.releaseYear)) {
      return NextResponse.json({ ok: true, metadata: igdb });
    }
  } catch (error) {
    console.warn("[Game Metadata] IGDB falhou:", error);
  }

  try {
    const steam = await fromSteam(title);
    if (steam) {
      return NextResponse.json({ ok: true, metadata: steam });
    }
  } catch (error) {
    console.warn("[Game Metadata] Steam falhou:", error);
  }

  return NextResponse.json({
    ok: true,
    metadata: {
      genres: [],
      platforms: [],
      developer: "",
      releaseYear: "",
      source: "none",
    } satisfies Metadata,
  });
}

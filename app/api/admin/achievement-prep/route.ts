import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

type SteamSearch = { items?: Array<{ id?: number; name?: string }> };
type Details = {
  name?: string;
  achievements?: Array<{
    name?: string;
    displayName?: string;
    description?: string;
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

async function searchSteam(title: string) {
  const r = await fetch(
    "https://store.steampowered.com/api/storesearch/?term=" +
      encodeURIComponent(title) +
      "&l=english&cc=US",
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

async function details(id: number) {
  const r = await fetch(
    `https://store.steampowered.com/api/appdetails?appids=${id}&cc=US&l=english`,
    { cache: "no-store" }
  );

  if (!r.ok) return null;

  const p = (await r.json()) as Record<
    string,
    { success?: boolean; data?: Details }
  >;

  return p[String(id)]?.data ?? null;
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

    const [d, p] = await Promise.all([details(g.id), percentages(g.id)]);

    if (!d) {
      return NextResponse.json(
        {
          error:
            "Encontrei o jogo, mas não consegui carregar suas conquistas.",
        },
        { status: 502 }
      );
    }

    const achievements = (d.achievements ?? [])
      .map((a, i) => {
        const name = a.displayName?.trim() || a.name?.trim() || "";

        return {
          name,
          description: a.description?.trim() || "",
          rank: rank(a.name ? p.get(a.name) : undefined),
          exophase: "nao_verificado" as const,
          journey: false,
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
      },
      achievements,
      warnings: [
        "Rank Bronze/Prata/Ouro é uma sugestão automática baseada na raridade global da conquista na Steam.",
        "Exophase aparece como Não verificado nesta etapa; não marcamos uma conquista sem confirmação.",
      ],
    });
  } catch (e) {
    console.error("[Achievement Prep]", e);

    const message = e instanceof Error ? e.message : "Não foi possível preparar o jogo.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type ReferenceFile = {
  key: string;
  title: string;
  filename: string;
  sourceUrl: string;
  order: number;
};

type DbAchievement = {
  id: string;
  title: string | null;
  image: string | null;
  sort_order: number | null;
  achievement_progress?: Array<{ image_override?: string | null }> | null;
};

function cleanSlug(value: string) {
  const slug = value.trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : "";
}

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/^\d+[-_\s]*/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function displayTitleFromFilename(filename: string) {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/^\d+[-_\s]*/, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

function safeReferenceSource(value: string, slug: string, origin: string) {
  try {
    const url = new URL(value, origin);

    if (url.origin === origin) {
      return (
        url.pathname.startsWith(`/images/games/${slug}/achievements/`) &&
        !url.pathname.split("/").some((part) => part === "..")
      );
    }

    return (
      url.protocol === "https:" &&
      url.hostname.endsWith(".supabase.co") &&
      url.pathname.includes("/storage/v1/object/public/") &&
      url.pathname.includes(`/games/${slug}/achievements/`) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function safeFilename(value: string) {
  const cleaned = value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 150);
  return cleaned || "conquista.jpg";
}

async function loadReferences(gameSlug: string, origin: string): Promise<ReferenceFile[]> {
  const byKey = new Map<string, ReferenceFile>();
  let nextOrder = 0;

  // Primeiro, prioriza as imagens ativas cadastradas para as conquistas no banco.
  try {
    const client = createAdminSupabaseClient();
    const { data, error } = await client
      .from("achievements")
      .select("id,title,image,sort_order,achievement_progress(image_override)")
      .eq("game_slug", gameSlug)
      .order("sort_order", { ascending: true });

    if (error) throw error;

    for (const raw of (data ?? []) as DbAchievement[]) {
      const title = String(raw.title ?? "").trim();
      if (!title) continue;

      const override = Array.isArray(raw.achievement_progress)
        ? raw.achievement_progress.find((item) => String(item.image_override ?? "").trim())
            ?.image_override
        : "";
      const sourceUrl = String(override || raw.image || "").trim();
      if (!sourceUrl || !safeReferenceSource(sourceUrl, gameSlug, origin)) continue;

      const key = normalizeKey(title);
      if (!key || byKey.has(key)) continue;

      nextOrder += 1;
      byKey.set(key, {
        key,
        title,
        filename: `${String(nextOrder).padStart(2, "0")}-${key}.jpg`,
        sourceUrl,
        order: Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : nextOrder,
      });
    }
  } catch (error) {
    // Continue with versioned public assets if the database cannot be queried.
    console.warn("[Final Mastery References] Não foi possível listar artes do banco:", error);
  }

  // Também inclui PNG/JPG/WebP mantidos no próprio repositório, mesmo que ainda
  // não exista um registro correspondente na tabela de conquistas.
  try {
    const listingUrl =
      `https://api.github.com/repos/rabiscooartt/rumo-a-conquista/contents/public/images/games/${gameSlug}/achievements?ref=main`;
    const response = await fetch(listingUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (response.ok) {
      const entries = (await response.json()) as Array<{
        name?: string;
        type?: string;
      }>;

      for (const entry of entries) {
        const filename = String(entry.name ?? "");
        if (
          entry.type !== "file" ||
          !/\.(png|jpe?g|webp)$/i.test(filename) ||
          /maestria[-_]final/i.test(filename)
        ) {
          continue;
        }

        const title = displayTitleFromFilename(filename);
        const key = normalizeKey(filename);
        if (!key || byKey.has(key)) continue;

        const sourceUrl = `/images/games/${gameSlug}/achievements/${encodeURIComponent(filename)}`;
        if (!safeReferenceSource(sourceUrl, gameSlug, origin)) continue;

        nextOrder += 1;
        byKey.set(key, {
          key,
          title: title || key,
          filename: `${String(nextOrder).padStart(2, "0")}-${key}.jpg`,
          sourceUrl,
          order: 100000 + nextOrder,
        });
      }
    } else if (response.status !== 404) {
      console.warn("[Final Mastery References] GitHub listing returned", response.status);
    }
  } catch (error) {
    console.warn("[Final Mastery References] Não foi possível listar artes públicas:", error);
  }

  return Array.from(byKey.values()).sort((a, b) => a.order - b.order);
}

export async function GET(request: NextRequest) {
  const gameSlug = cleanSlug(request.nextUrl.searchParams.get("gameSlug") ?? "");
  if (!gameSlug) {
    return NextResponse.json({ error: "O jogo selecionado é inválido." }, { status: 400 });
  }

  const origin = request.nextUrl.origin;
  const sourceUrl = request.nextUrl.searchParams.get("source")?.trim();

  if (sourceUrl) {
    if (!safeReferenceSource(sourceUrl, gameSlug, origin)) {
      return NextResponse.json({ error: "A referência visual não pertence às artes de conquistas permitidas para este jogo." }, { status: 400 });
    }

    try {
      const response = await fetch(new URL(sourceUrl, origin), { cache: "no-store" });
      if (!response.ok) {
        return NextResponse.json({ error: "Não foi possível carregar uma das imagens de conquista." }, { status: 502 });
      }

      const contentType = response.headers.get("content-type")?.split(";")[0].trim() ?? "";
      if (!contentType.startsWith("image/")) {
        return NextResponse.json({ error: "Uma referência retornada não é uma imagem." }, { status: 502 });
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 100 || bytes.length > 12 * 1024 * 1024) {
        return NextResponse.json({ error: "Uma imagem de referência está vazia ou excede 12 MB." }, { status: 413 });
      }

      return new NextResponse(bytes, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      console.error("[Final Mastery References] Erro ao baixar imagem:", error);
      return NextResponse.json({ error: "Não foi possível baixar uma imagem de conquista." }, { status: 502 });
    }
  }

  try {
    const references = await loadReferences(gameSlug, origin);
    return NextResponse.json(
      {
        ok: true,
        gameSlug,
        count: references.length,
        references: references.map(({ title, filename, sourceUrl }) => ({
          title,
          filename,
          sourceUrl,
        })),
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "X-Achievement-Reference-Count": String(references.length),
        },
      }
    );
  } catch (error) {
    console.error("[Final Mastery References] Erro ao listar referências:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível listar as conquistas deste jogo." },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}

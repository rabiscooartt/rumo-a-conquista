import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/lib/admin-auth";
import { games } from "@/data/games";

const SLUG = "mouse-p-i-for-hire";
const DRAFT_BUCKET = "achievement-preparation-drafts";

const ACHIEVEMENTS = [
  ["Mestre dos Macetes","Desbloqueie todas as habilidades especiais.",37.34],
  ["Armas, Muitas Armas","Colete todas as armas que não estão bloqueadas pela corporação.",37.91],
  ["Taco Tudo","Colete 10 Cartas de Beisebol.",54.53],
  ["Tá tudo nas Cartas","Vença 30 partidas de Cartas de Beisebol. Home Run!",9.69],
  ["Então, quem foi?","Pendure todas as pistas em seu quadro de evidências.",37.65],
  ["Balada de Betty Borocoxô","Encontre as pistas chaves do caso da Betty Borocoxô.",34.41],
  ["Alívio Cômico","Colete 5 tirinhas.",83.42],
  ["Detetive de Romance de Banca de Jornal","Complete 5 trabalhos secundários.",43.04],
  ["Extra! Extra!","Colete todas as edições do Mouseburg Herald. Até as esquisitas.",12.43],
  ["O Martírio do Mágico Misterioso","Encontre as pistas chaves do caso do Mágico Misterioso.",23.36],
  ["Verdadeiro Detetive","Complete todos os trabalhos secundários. Coloque os pingos nos is, detetive.",11.14],
  ["Hora do B.A.N.G.","Aprimore todas as armas para o nível 3.",14.93],
  ["O Prólogo","Colete todas as tirinhas. Algumas coisas nunca mudam.",13.76],
  ["Mistérios da Míngua dos Musaranhos","Encontre as pistas chaves do caso da Míngua do Musaranhos.",31.82],
  ["Essa é a Minha Espingarda","Aprimore uma arma para o Nível 3.",66.70],
  ["A Faca e o Queijo","Mate 5 inimigos em 10 segundos.",87.02],
  ["De Capa a Capa","Colete 10 edições do Mouseburg Herald.",67.82],
  ["Romance Muito Gráfico","Colete 10 tirinhas.",62.54],
  ["Pessoal de Papel","Colete 5 edições do Mouseburg Herald.",85.62],
  ["Às de Bolso","Vença uma partida de Cartas de Beisebol.",66.42],
  ["Todo Mundo Ama Pistolas de Raio",'Desbloqueie a X1 D-Ratificador, - A "quase arma exclusiva" da Spike-D.',21.24],
  ["Baralho de Iniciante","Colete 5 Cartas de Beisebol.",73.97],
  ["Rato de Baralho","Colete todas as Cartas de Beisebol. Que pegada, né não?",10.52],
  ["Q-q-queijocíniooo!","Elimine 10 inimigos em 20 segundos. Q-q-queijocíniooo!",70.30],
  ["Queijo e Fumaça","Resolva o caso do Mágico Misterioso.",17.46],
  ["Boom-bástico","Elimine 20 inimigos em uma única partida ao jogar/chutar um barril explosivo.",27.86],
  ["Tá pegando fogo, bicho","Exploda 20 inimigos em uma única partida ao atirar em barris explosivos.",50.94],
  ["Nossos Irmãos Menores","Resolva o caso da Míngua do Musaranhos.",20.89],
  ["16 TONELADAS DE SPIKE-D","Esmague 20 inimigos com objetos pesados em uma única partida.",27.94],
  ["Tinsel Boulevard","Resolva o caso da Betty Borocoxô.",27.72],
  ["Felicidade do Quint","Chute o tubarão de Baía Pancada até que ele deixe cair a placa de carro.",20.57],
  ["Mortíssima Trindade","Mate 3 inimigos com um único tiro.",78.57],
  ["Ponta do Queijobergue","Relaxa, detetive. Caso encerrado… ou está?",36.61],
  ["Com um Estalar de Pulsos","Dê um soco bem no meio do focinho de um Baderneiro do PR.",46.41],
] as const;

function rankMap() {
  return new Map(
    [...ACHIEVEMENTS]
      .sort((a, b) => a[2] - b[2])
      .map((item, index) => [
        item[0],
        index < 5 ? "Ouro" : index < 17 ? "Prata" : "Bronze",
      ])
  );
}

function trophy(rank: string) {
  return rank === "Ouro" ? "🥇" : rank === "Prata" ? "🥈" : "🥉";
}

function getArtNumber(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/\/achievements\/(\d{2})-/i);
  if (!match) return null;
  const number = Number(match[1]);
  return number >= 1 && number <= 34 ? number : null;
}

function formatHours(minutes: number) {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  if (hours === 0 && mins === 0) return "0h";
  if (mins === 0) return hours + "h";
  if (hours === 0) return mins + "m";
  return hours + "h - " + mins + "m";
}

function filterDraftMap(value: unknown, ids: Set<string>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([id]) => ids.has(id))
      .map(([id, item]) => [id, String(item ?? "")])
  );
}

export async function POST() {
  const cookieStore = await cookies();
  const session = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!(await verifyAdminSession(session))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const client = createAdminSupabaseClient();

    const [{ data: game, error: gameError }, { data: rows, error: rowsError }, { data: progress, error: progressError }, { data: journey, error: journeyError }] =
      await Promise.all([
        client.from("games").select("*").eq("slug", SLUG).single(),
        client.from("achievements").select("*").eq("game_slug", SLUG).order("sort_order", { ascending: true }),
        client.from("achievement_progress").select("*").eq("owner_key", "default"),
        client.from("journey_entries").select("gameSlug, gameTitle, playedMinutes"),
      ]);

    if (gameError || !game) throw gameError || new Error("Mouse P.I. não encontrado.");
    if (rowsError) throw rowsError;
    if (progressError) throw progressError;
    if (journeyError) throw journeyError;

    const kept = (rows ?? [])
      .map((row) => ({ ...row, artNumber: getArtNumber(row.image) }))
      .filter((row) => row.artNumber !== null)
      .sort((a, b) => Number(a.artNumber) - Number(b.artNumber));

    if (kept.length !== 34) {
      throw new Error("Recuperação abortada: encontrei " + kept.length + " artes numeradas; esperava 34.");
    }

    const keptIds = new Set(kept.map((row) => row.id));
    const ranks = rankMap();

    const totalMinutes = (journey ?? []).reduce((sum, row) => {
      const slugMatch = String(row.gameSlug ?? "").trim() === SLUG;
      const title = String(row.gameTitle ?? "").toLowerCase();
      const titleMatch = title.includes("mouse") && title.includes("p.i.");
      return slugMatch || titleMatch
        ? sum + Math.max(0, Number(row.playedMinutes ?? 0))
        : sum;
    }, 0);

    const baseGame = (games as unknown as Record<string, any>)[SLUG] ?? {};

    const gameUpdate: Record<string, unknown> = {
      title: baseGame.title || "MOUSE - P.I. For Hire",
      subtitle: baseGame.subtitle || "",
      image: baseGame.image || "/images/games/mouse-p-i-for-hire/banner.jpg",
      card_image: baseGame.cardImage || "/images/games/mouse-p-i-for-hire/cover.jpg",
      platform: game.platform || "Steam",
    };

    if (totalMinutes > 0) {
      gameUpdate.hours = formatHours(totalMinutes);
      gameUpdate.manual_total_played_minutes = totalMinutes;
    }

    const { error: updateGameError } = await client
      .from("games")
      .update(gameUpdate)
      .eq("slug", SLUG);
    if (updateGameError) throw updateGameError;

    const progressIds = new Set((progress ?? []).map((row) => row.achievement_id));

    for (let index = 0; index < kept.length; index += 1) {
      const row = kept[index];
      const [name, description] = ACHIEVEMENTS[index];
      const rank = ranks.get(name) || "Bronze";

      const { error } = await client
        .from("achievements")
        .update({
          title: name,
          description,
          rank,
          trophy: trophy(rank),
          sort_order: index,
          is_hidden: false,
        })
        .eq("id", row.id)
        .eq("game_slug", SLUG);

      if (error) throw error;

      if (progressIds.has(row.id)) {
        const { error: progressUpdateError } = await client
          .from("achievement_progress")
          .update({ rank_override: rank })
          .eq("achievement_id", row.id)
          .eq("owner_key", "default");

        if (progressUpdateError) throw progressUpdateError;
      }
    }

    const extraIds = (rows ?? [])
      .map((row) => row.id)
      .filter((id) => !keptIds.has(id));

    if (extraIds.length > 0) {
      const { error } = await client
        .from("achievement_progress")
        .delete()
        .in("achievement_id", extraIds);
      if (error) throw error;

      const { error: deleteError } = await client
        .from("achievements")
        .delete()
        .in("id", extraIds)
        .eq("game_slug", SLUG);
      if (deleteError) throw deleteError;
    }

    const draft = await client.storage
      .from(DRAFT_BUCKET)
      .download(SLUG + ".json");

    if (draft.data) {
      try {
        const parsed = JSON.parse(await draft.data.text()) as Record<string, any>;
        const cleaned = {
          ...parsed,
          journeyIds: Array.isArray(parsed.journeyIds)
            ? parsed.journeyIds.filter((id: unknown) => keptIds.has(String(id)))
            : [],
          notDoingIds: Array.isArray(parsed.notDoingIds)
            ? parsed.notDoingIds.filter((id: unknown) => keptIds.has(String(id)))
            : [],
          visualBriefs: filterDraftMap(parsed.visualBriefs, keptIds),
          episodeById: filterDraftMap(parsed.episodeById, keptIds),
          earnedDateById: filterDraftMap(parsed.earnedDateById, keptIds),
          earnedNoteById: filterDraftMap(parsed.earnedNoteById, keptIds),
          customAchievements: Array.isArray(parsed.customAchievements)
            ? parsed.customAchievements.filter(
                (item: any) => item && keptIds.has(String(item.id ?? ""))
              )
            : [],
          updatedAt: new Date().toISOString(),
        };

        await client.storage.from(DRAFT_BUCKET).upload(
          SLUG + ".json",
          new Blob([JSON.stringify(cleaned)], { type: "application/json" }),
          { upsert: true, contentType: "application/json", cacheControl: "0" }
        );
      } catch (draftError) {
        console.error("[Recover Mouse Draft]", draftError);
      }
    }

    return NextResponse.json({
      ok: true,
      restored: {
        title: String(gameUpdate.title),
        hours: totalMinutes > 0 ? formatHours(totalMinutes) : String(game.hours || "0h"),
        achievements: 34,
        removedDuplicates: extraIds.length,
        imagesPreserved: kept.filter((row) => Boolean(row.image)).length,
      },
    });
  } catch (error) {
    console.error("[Recover Mouse]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha na recuperação." },
      { status: 500 }
    );
  }
}

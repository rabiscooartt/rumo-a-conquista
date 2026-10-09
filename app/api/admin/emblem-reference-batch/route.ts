import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type ZipFile = { name: string; data: Uint8Array };

const MAX_REFERENCE_COUNT = 10;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

type ReferenceCandidate = {
  slug: string;
  title: string;
  path: string;
  timestamp: number;
};

type LoadedReference = ReferenceCandidate & {
  data: Uint8Array;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function readText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  return "";
}

function getTimestamp(...values: unknown[]): number {
  for (const value of values) {
    const raw = readText(value);
    if (!raw) continue;
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function isSafeEmblemPath(value: string) {
  if (!value.startsWith("/images/games/") || value.startsWith("//")) return false;
  return !value.split("/").some((part) => part === "..");
}

async function loadLatestReferenceImages(origin: string): Promise<LoadedReference[]> {
  const client = createAdminSupabaseClient();
  const { data, error } = await client
    .from("games")
    .select("slug, title, emblem, updated_at, created_at")
    .eq("is_deleted", false)
    .order("updated_at", { ascending: false });

  if (error) throw error;

  const candidates: ReferenceCandidate[] = (data ?? [])
    .flatMap((game) => {
      const emblem = asRecord(game.emblem);
      const slug = readText(game.slug);
      const title = readText(game.title);
      // Legacy emblem artwork can exist on disk even if that game's
      // emblem metadata has not yet been explicitly saved in Admin.
      // Only keep the fallback if the conventional asset really responds as an image.
      const path = readText(emblem?.image) || (slug ? `/images/games/${slug}/emblem.png` : "");
      if (!slug || !title || !path || !isSafeEmblemPath(path)) return [];
      return [{
        slug,
        title,
        path,
        timestamp: getTimestamp(emblem?.updatedAt, game.updated_at, game.created_at),
      }];
    })
    .sort((a, b) => b.timestamp - a.timestamp || a.slug.localeCompare(b.slug));

  const references: LoadedReference[] = [];
  let totalBytes = 0;

  // Select the 10 most recent existing, valid emblem image files. If one is
  // missing or broken, continue to the next older saved emblem.
  for (const candidate of candidates) {
    if (references.length >= MAX_REFERENCE_COUNT) break;

    try {
      const response = await fetch(new URL(candidate.path, origin), { cache: "no-store" });
      if (!response.ok) continue;

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().startsWith("image/")) continue;

      const data = new Uint8Array(await response.arrayBuffer());
      if (data.length < 100 || data.length > MAX_IMAGE_BYTES) continue;
      if (totalBytes + data.length > MAX_TOTAL_BYTES) {
        throw new Error(
          "As 10 referências mais recentes ultrapassam 32 MiB. Otimize as imagens ou diminua o tamanho dos PNGs antes de baixar o ZIP."
        );
      }

      references.push({ ...candidate, data });
      totalBytes += data.length;
    } catch (error) {
      if (error instanceof Error && error.message.includes("ultrapassam 32 MiB")) throw error;
      // Skip a broken or missing file and continue with older saved emblems.
    }
  }

  return references;
}

function safeFilename(value: string, fallback: string) {
  const cleaned = value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
  return cleaned || fallback;
}

function writeU16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function writeU32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(files: ZipFile[]) {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = file.data;
    const checksum = crc32(data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    writeU32(localView, 0, 0x04034b50);
    writeU16(localView, 4, 20);
    writeU16(localView, 6, 0x0800);
    writeU16(localView, 8, 0);
    writeU16(localView, 10, dosTime);
    writeU16(localView, 12, dosDate);
    writeU32(localView, 14, checksum);
    writeU32(localView, 18, data.length);
    writeU32(localView, 22, data.length);
    writeU16(localView, 26, nameBytes.length);
    writeU16(localView, 28, 0);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeU32(centralView, 0, 0x02014b50);
    writeU16(centralView, 4, 20);
    writeU16(centralView, 6, 20);
    writeU16(centralView, 8, 0x0800);
    writeU16(centralView, 10, 0);
    writeU16(centralView, 12, dosTime);
    writeU16(centralView, 14, dosDate);
    writeU32(centralView, 16, checksum);
    writeU32(centralView, 20, data.length);
    writeU32(centralView, 24, data.length);
    writeU16(centralView, 28, nameBytes.length);
    writeU16(centralView, 30, 0);
    writeU16(centralView, 32, 0);
    writeU16(centralView, 34, 0);
    writeU16(centralView, 36, 0);
    writeU32(centralView, 38, 0);
    writeU32(centralView, 42, offset);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeU32(endView, 0, 0x06054b50);
  writeU16(endView, 4, 0);
  writeU16(endView, 6, 0);
  writeU16(endView, 8, files.length);
  writeU16(endView, 10, files.length);
  writeU32(endView, 12, centralSize);
  writeU32(endView, 16, offset);
  writeU16(endView, 20, 0);

  const zip = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const part of localParts) {
    zip.set(part, cursor);
    cursor += part.length;
  }
  for (const part of centralParts) {
    zip.set(part, cursor);
    cursor += part.length;
  }
  zip.set(end, cursor);
  return zip;
}

export async function GET(request: NextRequest) {
  try {
    const references = await loadLatestReferenceImages(request.nextUrl.origin);
    return NextResponse.json(
      {
        ok: true,
        references: references.map(({ slug, title, path, timestamp }) => ({
          slug,
          title,
          image: path,
          updatedAt: timestamp ? new Date(timestamp).toISOString() : "",
        })),
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "X-Emblem-Reference-Count": String(references.length),
        },
      }
    );
  } catch (error) {
    console.error("[Emblem References] Erro:", error);
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "Não foi possível carregar as referências de Emblemas.",
      },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      filename?: string;
      packageText?: string;
      gameSlug?: string;
    };
    const instructionsText = body.packageText?.trim() ?? "";
    const gameSlug = safeFilename(body.gameSlug?.trim() ?? "", "jogo");

    if (!instructionsText) {
      return NextResponse.json({ error: "As instruções de uso do Emblema V4 estão vazias." }, { status: 400 });
    }

    const encoder = new TextEncoder();
    const zipName = safeFilename(body.filename?.trim() || `${gameSlug}-referencias-emblemas.zip`, "referencias-emblemas.zip");
    const files: ZipFile[] = [
      { name: "LEIA-PRIMEIRO-instrucoes-emblema-v4.txt", data: encoder.encode(instructionsText) },
    ];
    const origin = request.nextUrl.origin;
    const references = await loadLatestReferenceImages(origin);
    if (references.length === 0) {
      return NextResponse.json({
        error: "Não encontrei Emblemas salvos com imagens válidas para usar como referência. Cadastre ou corrija pelo menos um Emblema antes de baixar o ZIP.",
      }, { status: 502 });
    }

    const referenceManifest: string[] = [];
    for (const reference of references) {
      files.push({
        name: `REFERENCIAS-EMBLEMAS/${reference.slug}-emblem.png`,
        data: reference.data,
      });
      referenceManifest.push(
        `- ${reference.title} (arquivo: ${reference.slug}-emblem.png; salvo/atualizado em: ${reference.timestamp ? new Date(reference.timestamp).toISOString() : "data desconhecida"})`
      );
    }

    files.push({
      name: "REFERENCIAS-EMBLEMAS/INDICE.txt",
      data: encoder.encode(
        "REFERÊNCIAS VISUAIS — RUMO À CONQUISTA V4\n\n" +
        "Este ZIP contém até 10 imagens válidas dos Emblemas salvos mais recentemente, ordenados pela data específica de atualização do Emblema. Emblemas históricos sem essa data usam a última atualização do jogo como alternativa até serem salvos novamente.\n\n" +
        "Arquivos incluídos:\n" +
        referenceManifest.join("\n") +
        "\n\nAnexe este ZIP à conversa junto do Prompt 01. Examine cada imagem visualmente, identifique a linguagem visual comum e diferenças entre as peças, e evite repetir molduras, silhuetas e composições existentes. Se a coleção tiver menos de 10 Emblemas com imagens válidas, o ZIP incluirá todos os disponíveis."
      ),
    });

    const zip = buildZip(files);
    return new NextResponse(zip, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipName}"`,
        "Cache-Control": "no-store",
        "X-Emblem-Reference-Count": String(references.length),
      },
    });
  } catch (error) {
    console.error("[Emblem Reference Package]", error);
    return NextResponse.json({ error: "Não foi possível montar o pacote de referências de Emblema." }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type ZipFile = { name: string; data: Uint8Array };

const REFERENCE_EMBLEMS = [
  { slug: "crisol-theater-of-idols", title: "Crisol - Theater of Idols", path: "/images/games/crisol-theater-of-idols/emblem.png" },
  { slug: "hades", title: "Hades", path: "/images/games/hades/emblem.png" },
  { slug: "hollow-knight", title: "Hollow Knight", path: "/images/games/hollow-knight/emblem.png" },
  { slug: "howgarts-legacy", title: "Hogwarts Legacy", path: "/images/games/howgarts-legacy/emblem.png" },
  { slug: "metro-last-light", title: "Metro: Last Light", path: "/images/games/metro-last-light/emblem.png" },
  { slug: "monster-hunter-world-iceborne", title: "Monster Hunter World: Iceborne", path: "/images/games/monster-hunter-world-iceborne/emblem.png" },
  { slug: "mouse-p-i-for-hire", title: "MOUSE: P.I. For Hire", path: "/images/games/mouse-p-i-for-hire/emblem.png" },
  { slug: "song-of-nunu", title: "Song of Nunu", path: "/images/games/song-of-nunu/emblem.png" },
  { slug: "the-surge", title: "The Surge", path: "/images/games/the-surge/emblem.png" },
  { slug: "tom-clancy-s-the-division", title: "Tom Clancy's The Division", path: "/images/games/tom-clancy-s-the-division/emblem.png" },
] as const;

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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      filename?: string;
      packageText?: string;
      gameSlug?: string;
    };
    const packageText = body.packageText?.trim() ?? "";
    const gameSlug = safeFilename(body.gameSlug?.trim() ?? "", "jogo");

    if (!packageText) {
      return NextResponse.json({ error: "O template do Emblema está vazio." }, { status: 400 });
    }

    const encoder = new TextEncoder();
    const zipName = safeFilename(body.filename?.trim() || `${gameSlug}-template-emblema.zip`, "template-emblema.zip");
    const files: ZipFile[] = [
      { name: "LEIA-PRIMEIRO-template-emblema.txt", data: encoder.encode(packageText) },
    ];
    const referenceManifest: string[] = [];
    let totalBytes = files[0].data.length;
    const maxTotalBytes = 18 * 1024 * 1024;
    const origin = request.nextUrl.origin;

    for (const reference of REFERENCE_EMBLEMS) {
      try {
        const response = await fetch(new URL(reference.path, origin), { cache: "no-store" });
        if (!response.ok) continue;
        const data = new Uint8Array(await response.arrayBuffer());
        if (data.length < 100 || data.length > 5 * 1024 * 1024) continue;
        if (totalBytes + data.length > maxTotalBytes) continue;

        files.push({
          name: `REFERENCIAS-EMBLEMAS/${reference.slug}-emblem.png`,
          data,
        });
        totalBytes += data.length;
        referenceManifest.push(`- ${reference.title} (arquivo: ${reference.slug}-emblem.png)`);
      } catch {
        // Se uma referência individual falhar, as demais ainda poderão ser incluídas.
      }
    }

    if (referenceManifest.length === 0) {
      return NextResponse.json({
        error: "Não consegui carregar as artes de referência do site. Tente novamente em alguns instantes.",
      }, { status: 502 });
    }

    files.push({
      name: "REFERENCIAS-EMBLEMAS/INDICE.txt",
      data: encoder.encode(
        "Emblemas atuais do Rumo à Conquista incluídos neste pacote:\n\n" +
        referenceManifest.join("\n") +
        "\n\nUse essas imagens para analisar a linguagem visual comum e para evitar repetir a mesma moldura."
      ),
    });

    const zip = buildZip(files);
    return new NextResponse(zip, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipName}"`,
        "Cache-Control": "no-store",
        "X-Emblem-Reference-Count": String(referenceManifest.length),
      },
    });
  } catch (error) {
    console.error("[Emblem Reference Package]", error);
    return NextResponse.json({ error: "Não foi possível montar o pacote de referências de Emblema." }, { status: 500 });
  }
}

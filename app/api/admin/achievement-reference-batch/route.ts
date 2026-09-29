import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function safeFilename(value: string, fallback: string) {
  const cleaned = value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);

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

function buildZip(files: { name: string; data: Uint8Array }[]) {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime =
    (now.getHours() << 11) |
    (now.getMinutes() << 5) |
    Math.floor(now.getSeconds() / 2);
  const dosDate =
    ((now.getFullYear() - 1980) << 9) |
    ((now.getMonth() + 1) << 5) |
    now.getDate();

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
      references?: { filename: string; url: string }[];
    };

    const packageText = body.packageText?.trim();
    const references = Array.isArray(body.references) ? body.references : [];

    if (!packageText) {
      return NextResponse.json(
        { error: "O conteúdo textual do lote está vazio." },
        { status: 400 }
      );
    }

    if (references.length > 100) {
      return NextResponse.json(
        { error: "Um lote pode conter no máximo 100 referências." },
        { status: 400 }
      );
    }

    const safeZipFilename = safeFilename(
      body.filename?.trim() || "Lote.zip",
      "Lote.zip"
    );

    const encoder = new TextEncoder();
    const textFileName = safeZipFilename.replace(/\.zip$/i, "") + ".txt";
    const files: { name: string; data: Uint8Array }[] = [
      {
        name: textFileName,
        data: encoder.encode(packageText),
      },
    ];

    const uniqueNames = new Set<string>();
    const validReferences = references.map((reference, index) => {
      const url = reference?.url?.trim() ?? "";
      if (!url) throw new Error(`A referência ${index + 1} está sem URL.`);

      const parsedUrl = new URL(url);
      const allowed =
        (parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:") &&
        (parsedUrl.hostname === "exophase.com" ||
          parsedUrl.hostname.endsWith(".exophase.com"));

      if (!allowed) {
        throw new Error(`A referência ${index + 1} não é uma URL válida do Exophase.`);
      }

      const cleanName = safeFilename(
        reference?.filename?.trim() || `referencia-${index + 1}.png`,
        `referencia-${index + 1}.png`
      );

      let filename = cleanName;
      let suffix = 2;
      while (uniqueNames.has(filename.toLowerCase())) {
        const dot = cleanName.lastIndexOf(".");
        const stem = dot > 0 ? cleanName.slice(0, dot) : cleanName;
        const ext = dot > 0 ? cleanName.slice(dot) : ".png";
        filename = `${stem}-${suffix}${ext}`;
        suffix += 1;
      }

      uniqueNames.add(filename.toLowerCase());
      return { filename: `referencias/${filename}`, url };
    });

    const downloaded = await Promise.allSettled(
      validReferences.map(async (reference) => {
        const response = await fetch(reference.url, {
          cache: "no-store",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; Rumo-a-Conquista/1.0; +https://www.exophase.com/)",
          },
        });

        if (!response.ok) {
          throw new Error("Falha ao baixar a referência.");
        }

        const contentType =
          response.headers.get("content-type")?.split(";")[0].trim() ?? "";

        if (!contentType.startsWith("image/")) {
          throw new Error("O Exophase não retornou uma imagem.");
        }

        return {
          ...reference,
          data: new Uint8Array(await response.arrayBuffer()),
        };
      })
    );

    const failed: string[] = [];
    downloaded.forEach((item, index) => {
      if (item.status === "fulfilled") {
        files.push({
          name: item.value.filename,
          data: item.value.data,
        });
      } else {
        failed.push(validReferences[index].filename);
      }
    });

    const totalBytes = files.reduce((sum, file) => sum + file.data.length, 0);
    if (totalBytes > 20 * 1024 * 1024) {
      return NextResponse.json(
        { error: "As referências deste lote ultrapassam o limite de 20 MB." },
        { status: 413 }
      );
    }

    if (failed.length) {
      files.push({
        name: "REFERENCIAS-COM-FALHA.txt",
        data: encoder.encode(
          [
            "Algumas referências do Exophase não puderam ser baixadas.",
            "Gere o lote novamente para tentar outra vez.",
            "",
            ...failed.map((filename) => `- ${filename}`),
          ].join("\n")
        ),
      });
    }

    const zip = buildZip(files);

    return new NextResponse(zip, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeZipFilename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[Achievement Text Batch]", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível montar o lote de texto.",
      },
      { status: 400 }
    );
  }
}

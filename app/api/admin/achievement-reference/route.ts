import { NextRequest, NextResponse } from "next/server";

function isAllowedReferenceUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      (url.hostname === "exophase.com" ||
        url.hostname.endsWith(".exophase.com"))
    );
  } catch {
    return false;
  }
}

function safeFilename(value: string) {
  const fallback = "exophase-reference.png";
  const cleaned = value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);

  return cleaned || fallback;
}

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get("url")?.trim() ?? "";
  const requestedFilename =
    req.nextUrl.searchParams.get("filename")?.trim() ||
    "exophase-reference.png";

  if (!rawUrl || !isAllowedReferenceUrl(rawUrl)) {
    return NextResponse.json(
      { error: "Referência visual do Exophase inválida." },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(rawUrl, {
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Rumo-a-Conquista/1.0; +https://www.exophase.com/)",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "O Exophase não entregou a imagem de referência." },
        { status: 502 }
      );
    }

    const contentType =
      response.headers.get("content-type")?.split(";")[0].trim() ||
      "image/png";

    if (!contentType.startsWith("image/")) {
      return NextResponse.json(
        { error: "A referência retornada pelo Exophase não é uma imagem." },
        { status: 502 }
      );
    }

    const body = await response.arrayBuffer();

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${safeFilename(
          requestedFilename
        )}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[Achievement Reference Download]", error);

    return NextResponse.json(
      { error: "Não foi possível acessar a referência visual do Exophase." },
      { status: 502 }
    );
  }
}

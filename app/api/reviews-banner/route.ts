import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PART_PATHS = Array.from(
  { length: 9 },
  (_, index) => `/images/reviews-banner-parts/part-${String(index).padStart(2, "0")}.txt`
);

export async function GET(request: NextRequest) {
  try {
    const responses = await Promise.all(
      PART_PATHS.map((partPath) =>
        fetch(new URL(partPath, request.url), { cache: "force-cache" })
      )
    );

    if (responses.some((response) => !response.ok)) {
      throw new Error("Não foi possível carregar todas as partes do banner.");
    }

    const base64 = (await Promise.all(responses.map((response) => response.text()))).join("");
    if (base64.length !== 33424) {
      throw new Error(`Comprimento inesperado para o banner: ${base64.length}.`);
    }

    const image = Buffer.from(base64, "base64");
    if (
      image.length !== 25068 ||
      image.toString("ascii", 0, 4) !== "RIFF" ||
      image.toString("ascii", 8, 12) !== "WEBP"
    ) {
      throw new Error("O arquivo reconstruído não é uma imagem WebP válida.");
    }

    return new NextResponse(new Uint8Array(image), {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(image.length),
        "Cache-Control": "public, s-maxage=31536000, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("[ReviewsBanner] Falha ao reconstruir o banner:", error);
    return NextResponse.json(
      { error: "Não foi possível carregar o banner de Reviews." },
      { status: 500 }
    );
  }
}

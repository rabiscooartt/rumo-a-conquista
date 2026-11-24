import { NextRequest, NextResponse } from "next/server";
import { loadYoutubeChannel, readYoutubeChannelParams } from "@/lib/youtubeChannel";

export async function GET(request: NextRequest) {
  const { handle, maxResults } = readYoutubeChannelParams(
    request.nextUrl.searchParams.get("handle"),
    request.nextUrl.searchParams.get("maxResults")
  );
  if (!handle) {
    return NextResponse.json({ error: "Canal não disponível." }, { status: 404 });
  }
  const result = await loadYoutubeChannel(handle, maxResults);

  if (!result.ok) {
    return NextResponse.json({ error: result.error, status: result.status }, { status: result.status });
  }

  return NextResponse.json(result.data);
}

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type TwitchTokenResponse = {
  access_token?: string;
  expires_in?: number;
};

type TwitchStream = {
  id?: string;
  title?: string;
  thumbnail_url?: string;
  game_name?: string;
};

type TwitchStreamsResponse = {
  data?: TwitchStream[];
};

let cachedToken: { value: string; expiresAt: number; clientId: string } | null = null;

function jsonNoStore(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function GET() {
  const clientId = process.env.TWITCH_CLIENT_ID?.trim();
  const clientSecret = process.env.TWITCH_CLIENT_SECRET?.trim();

  // Twitch detection is optional until the owner configures server-side app credentials.
  if (!clientId || !clientSecret) {
    return jsonNoStore({ available: false, live: null });
  }

  try {
    let token = cachedToken?.clientId === clientId && cachedToken.expiresAt > Date.now() + 60_000
      ? cachedToken.value
      : "";

    if (!token) {
      const tokenUrl = new URL("https://id.twitch.tv/oauth2/token");
      tokenUrl.searchParams.set("client_id", clientId);
      tokenUrl.searchParams.set("client_secret", clientSecret);
      tokenUrl.searchParams.set("grant_type", "client_credentials");

      const tokenResponse = await fetch(tokenUrl.toString(), {
        method: "POST",
        cache: "no-store",
      });

      if (!tokenResponse.ok) {
        return jsonNoStore({ available: false, live: null });
      }

      const tokenPayload = (await tokenResponse.json()) as TwitchTokenResponse;
      if (!tokenPayload.access_token) {
        return jsonNoStore({ available: false, live: null });
      }

      token = tokenPayload.access_token;
      cachedToken = {
        value: token,
        clientId,
        expiresAt: Date.now() + Math.max(60, tokenPayload.expires_in || 0) * 1000,
      };
    }

    const streamsUrl = new URL("https://api.twitch.tv/helix/streams");
    streamsUrl.searchParams.set("user_login", "orabiisco");
    streamsUrl.searchParams.set("first", "1");

    const streamsResponse = await fetch(streamsUrl.toString(), {
      headers: {
        "Client-Id": clientId,
        Authorization: "Bearer " + token,
      },
      cache: "no-store",
    });

    if (!streamsResponse.ok) {
      cachedToken = null;
      return jsonNoStore({ available: false, live: null });
    }

    const streamsPayload = (await streamsResponse.json()) as TwitchStreamsResponse;
    const stream = streamsPayload.data?.[0];

    if (!stream?.id) {
      return jsonNoStore({ available: true, live: null });
    }

    return jsonNoStore({
      available: true,
      live: {
        id: stream.id,
        title: stream.title || "Transmissão ao vivo",
        gameName: stream.game_name || "",
        thumbnail: (stream.thumbnail_url || "")
          .replace("{width}", "1280")
          .replace("{height}", "720"),
        url: "https://www.twitch.tv/orabiisco",
      },
    });
  } catch {
    // Fail closed: never show an "AO VIVO" badge without confirming the stream.
    return jsonNoStore({ available: false, live: null });
  }
}

import { NextRequest, NextResponse } from "next/server";

type YouTubeThumbnail = {
  url?: string;
  width?: number;
  height?: number;
};

type YouTubeThumbnails = {
  default?: YouTubeThumbnail;
  medium?: YouTubeThumbnail;
  high?: YouTubeThumbnail;
  standard?: YouTubeThumbnail;
  maxres?: YouTubeThumbnail;
};

type YouTubeChannelItem = {
  id?: string;
  snippet?: {
    title?: string;
    customUrl?: string;
    thumbnails?: YouTubeThumbnails;
  };
  contentDetails?: {
    relatedPlaylists?: {
      uploads?: string;
    };
  };
};

type YouTubeChannelResponse = {
  items?: YouTubeChannelItem[];
  error?: {
    message?: string;
    code?: number;
  };
};

type YouTubePlaylistItem = {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    resourceId?: {
      videoId?: string;
    };
    thumbnails?: YouTubeThumbnails;
  };
};

type YouTubePlaylistResponse = {
  items?: YouTubePlaylistItem[];
  error?: {
    message?: string;
    code?: number;
  };
};

type YouTubeVideo = {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnail: string;
  url: string;
  type: "video";
};

const CACHE_SECONDS = 60;

function cleanHandle(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\/(www\.)?youtube\.com\//, "")
    .replace(/\/$/, "");
}

function getBestThumbnail(thumbnails?: YouTubeThumbnails) {
  return (
    thumbnails?.maxres?.url ||
    thumbnails?.standard?.url ||
    thumbnails?.high?.url ||
    thumbnails?.medium?.url ||
    thumbnails?.default?.url ||
    ""
  );
}

function cleanDescription(description?: string) {
  if (!description) {
    return "";
  }

  return description.replace(/\s+/g, " ").trim().slice(0, 220);
}

function createYoutubeApiUrl(
  endpoint: "channels" | "playlistItems",
  params: Record<string, string>
) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url;
}

export async function GET(request: NextRequest) {
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "YOUTUBE_API_KEY não encontrada. Confira o arquivo .env.local e reinicie o servidor.",
      },
      {
        status: 500,
      }
    );
  }

  const searchParams = request.nextUrl.searchParams;

  const rawHandle = searchParams.get("handle") || "@orabiisco";
  const maxResultsParam = searchParams.get("maxResults");

  const handle = cleanHandle(rawHandle);

  const maxResults = Math.min(
    50,
    Math.max(1, Number(maxResultsParam) || 9)
  );

  const channelUrl = createYoutubeApiUrl("channels", {
    part: "snippet,contentDetails",
    forHandle: handle,
    key: apiKey,
  });

  try {
    const channelResponse = await fetch(channelUrl.toString(), {
      next: {
        revalidate: CACHE_SECONDS,
      },
    });

    const channelData =
      (await channelResponse.json()) as YouTubeChannelResponse;

    if (!channelResponse.ok) {
      return NextResponse.json(
        {
          error:
            channelData.error?.message ||
            "Erro ao buscar o canal no YouTube.",
          status: channelResponse.status,
        },
        {
          status: channelResponse.status,
        }
      );
    }

    const channel = channelData.items?.[0];

    if (!channel) {
      return NextResponse.json(
        {
          error: `Canal não encontrado para o handle: ${handle}`,
        },
        {
          status: 404,
        }
      );
    }

    const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;

    if (!uploadsPlaylistId) {
      return NextResponse.json(
        {
          error: "Playlist automática de uploads do canal não encontrada.",
        },
        {
          status: 404,
        }
      );
    }

    const playlistUrl = createYoutubeApiUrl("playlistItems", {
      part: "snippet",
      playlistId: uploadsPlaylistId,
      maxResults: String(maxResults),
      key: apiKey,
    });

    const playlistResponse = await fetch(playlistUrl.toString(), {
      next: {
        revalidate: CACHE_SECONDS,
      },
    });

    const playlistData =
      (await playlistResponse.json()) as YouTubePlaylistResponse;

    if (!playlistResponse.ok) {
      return NextResponse.json(
        {
          error:
            playlistData.error?.message ||
            "Erro ao buscar os vídeos recentes do canal.",
          status: playlistResponse.status,
        },
        {
          status: playlistResponse.status,
        }
      );
    }

    const videos: YouTubeVideo[] = (playlistData.items ?? [])
      .map((item): YouTubeVideo | null => {
        const videoId = item.snippet?.resourceId?.videoId;

        if (!videoId) {
          return null;
        }

        return {
          id: videoId,
          title: item.snippet?.title || "Vídeo sem título",
          description: cleanDescription(item.snippet?.description),
          publishedAt: item.snippet?.publishedAt || "",
          thumbnail: getBestThumbnail(item.snippet?.thumbnails),
          url: `https://www.youtube.com/watch?v=${videoId}`,
          type: "video",
        };
      })
      .filter((video): video is YouTubeVideo => Boolean(video));

    return NextResponse.json({
      channel: {
        id: channel.id || "",
        title: channel.snippet?.title || "",
        handle,
        uploadsPlaylistId,
      },
      count: videos.length,
      videos,
    });
  } catch {
    return NextResponse.json(
      {
        error: "Erro inesperado ao conectar com o YouTube.",
      },
      {
        status: 500,
      }
    );
  }
}
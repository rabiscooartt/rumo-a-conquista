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

type YouTubePlaylistItem = {
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    position?: number;
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

type YouTubeVideoDetailsItem = {
  id?: string;
  snippet?: {
    liveBroadcastContent?: "none" | "live" | "upcoming";
  };
  liveStreamingDetails?: {
    actualStartTime?: string;
    actualEndTime?: string;
  };
};

type YouTubeVideoDetailsResponse = {
  items?: YouTubeVideoDetailsItem[];
  error?: {
    message?: string;
    code?: number;
  };
};

function createYoutubeApiUrl(
  endpoint: "playlistItems" | "videos",
  params: Record<string, string>
) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url;
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

function normalizeLiveStatus(
  details?: YouTubeVideoDetailsItem
): "live" | "upcoming" | "archived" | "video" {
  if (details?.snippet?.liveBroadcastContent === "live") return "live";
  if (details?.snippet?.liveBroadcastContent === "upcoming") return "upcoming";

  if (
    details?.liveStreamingDetails?.actualStartTime ||
    details?.liveStreamingDetails?.actualEndTime
  ) {
    return "archived";
  }

  return "video";
}

export async function GET(request: NextRequest) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const playlistId = request.nextUrl.searchParams.get("playlistId")?.trim() || "";

  if (!apiKey) {
    return NextResponse.json(
      { error: "YOUTUBE_API_KEY não encontrada no servidor." },
      { status: 500 }
    );
  }

  if (!playlistId) {
    return NextResponse.json(
      { error: "O ID da playlist é obrigatório." },
      { status: 400 }
    );
  }

  const playlistItemsUrl = createYoutubeApiUrl("playlistItems", {
    part: "snippet",
    playlistId,
    maxResults: "50",
    key: apiKey,
  });

  try {
    const response = await fetch(playlistItemsUrl.toString(), {
      next: { revalidate: 60 },
    });

    const payload = (await response.json()) as YouTubePlaylistResponse;

    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            payload.error?.message ||
            "Não foi possível carregar os conteúdos da playlist.",
        },
        { status: response.status }
      );
    }

    const baseVideos = (payload.items ?? [])
      .map((item) => {
        const videoId = item.snippet?.resourceId?.videoId;
        if (!videoId) return null;

        return {
          id: videoId,
          title: item.snippet?.title || "Vídeo sem título",
          description: item.snippet?.description || "",
          publishedAt: item.snippet?.publishedAt || "",
          position: Number(item.snippet?.position ?? 0),
          thumbnail: getBestThumbnail(item.snippet?.thumbnails),
          url: `https://www.youtube.com/watch?v=${videoId}`,
        };
      })
      .filter(Boolean);

    const ids = baseVideos.map((video) => video!.id);

    let detailsById = new Map<string, YouTubeVideoDetailsItem>();

    if (ids.length > 0) {
      const detailsUrl = createYoutubeApiUrl("videos", {
        part: "snippet,liveStreamingDetails",
        id: ids.join(","),
        key: apiKey,
      });

      const detailsResponse = await fetch(detailsUrl.toString(), {
        next: { revalidate: 60 },
      });

      if (detailsResponse.ok) {
        const detailsPayload =
          (await detailsResponse.json()) as YouTubeVideoDetailsResponse;

        detailsById = new Map(
          (detailsPayload.items ?? [])
            .filter((item) => item.id)
            .map((item) => [item.id as string, item])
        );
      }
    }

    const videos = baseVideos.map((video) => {
      const details = detailsById.get(video!.id);

      return {
        ...video,
        liveStatus: normalizeLiveStatus(details),
        playlistUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
        playlistWatchUrl:
          `https://www.youtube.com/watch?v=${video!.id}&list=${playlistId}&index=${video!.position + 1}`,
      };
    });

    return NextResponse.json(
      {
        ok: true,
        playlistId,
        videos,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  } catch (error) {
    console.error("[YouTube Playlist] Erro:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível carregar a playlist.",
      },
      { status: 500 }
    );
  }
}

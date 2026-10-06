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

type YouTubeCommentThreadListResponse = {
  items?: Array<{
    snippet?: {
      topLevelComment?: {
        snippet?: {
          authorDisplayName?: string;
          authorProfileImageUrl?: string;
          textDisplay?: string;
          publishedAt?: string;
          videoId?: string;
        };
      };
    };
  }>;
  error?: {
    message?: string;
    code?: number;
  };
};

type YouTubeChannelPlaylistItem = {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    thumbnails?: YouTubeThumbnails;
  };
  contentDetails?: {
    itemCount?: number;
  };
};

type YouTubeChannelPlaylistsResponse = {
  items?: YouTubeChannelPlaylistItem[];
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
  endpoint:
    | "channels"
    | "playlistItems"
    | "playlists"
    | "videos"
    | "commentThreads",
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

    const channelPlaylistsUrl = createYoutubeApiUrl("playlists", {
      part: "snippet,contentDetails",
      channelId: channel.id || "",
      maxResults: "50",
      key: apiKey,
    });

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

    const channelPlaylistsResponse = await fetch(
      channelPlaylistsUrl.toString(),
      {
        next: {
          revalidate: CACHE_SECONDS,
        },
      }
    );

    const channelPlaylistsData =
      (await channelPlaylistsResponse.json()) as YouTubeChannelPlaylistsResponse;

    if (!channelPlaylistsResponse.ok) {
      return NextResponse.json(
        {
          error:
            channelPlaylistsData.error?.message ||
            "Erro ao buscar as playlists do canal.",
          status: channelPlaylistsResponse.status,
        },
        {
          status: channelPlaylistsResponse.status,
        }
      );
    }

    const playlists = (channelPlaylistsData.items ?? [])
      .filter((item) => Boolean(item.id))
      .map((item) => ({
        id: item.id || "",
        title: item.snippet?.title || "Playlist sem título",
        thumbnail: getBestThumbnail(item.snippet?.thumbnails),
        itemCount: Number(item.contentDetails?.itemCount || 0),
        url: item.id
          ? `https://www.youtube.com/playlist?list=${item.id}`
          : "",
      }));

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

    let liveNow: {
      id: string;
      title: string;
      thumbnail: string;
      url: string;
    } | null = null;

    const recentVideoIds = videos
      .slice(0, 10)
      .map((video) => video.id)
      .filter(Boolean);

    if (recentVideoIds.length > 0) {
      try {
        const videoDetailsUrl = createYoutubeApiUrl("videos", {
          part: "snippet,liveStreamingDetails",
          id: recentVideoIds.join(","),
          key: apiKey,
        });

        const videoDetailsResponse = await fetch(
          videoDetailsUrl.toString(),
          {
            next: {
              revalidate: 15,
            },
          }
        );

        if (videoDetailsResponse.ok) {
          const videoDetailsData =
            (await videoDetailsResponse.json()) as YouTubeVideoDetailsResponse;

          const activeIds = new Set(
            (videoDetailsData.items ?? [])
              .filter(
                (item) =>
                  item.id &&
                  item.snippet?.liveBroadcastContent === "live" &&
                  !item.liveStreamingDetails?.actualEndTime
              )
              .map((item) => item.id as string)
          );

          const activeVideo = videos.find((video) =>
            activeIds.has(video.id)
          );

          if (activeVideo) {
            liveNow = {
              id: activeVideo.id,
              title: activeVideo.title,
              thumbnail: activeVideo.thumbnail,
              url: activeVideo.url,
            };
          }
        }
      } catch {
        // A falha na detecção de LIVE não deve impedir os conteúdos.
      }
    }

    let recentComments: Array<{
      id: string;
      authorName: string;
      authorImage: string;
      text: string;
      publishedAt: string;
      videoId: string;
      videoUrl: string;
    }> = [];

    try {
      const commentsUrl = createYoutubeApiUrl("commentThreads", {
        part: "snippet",
        allThreadsRelatedToChannelId: channel.id || "",
        maxResults: "3",
        order: "time",
        textFormat: "plainText",
        key: apiKey,
      });

      const commentsResponse = await fetch(commentsUrl.toString(), {
        next: {
          revalidate: CACHE_SECONDS,
        },
      });

      if (commentsResponse.ok) {
        const commentsData =
          (await commentsResponse.json()) as YouTubeCommentThreadListResponse;

        recentComments = (commentsData.items ?? [])
          .map((item, index) => {
            const comment = item.snippet?.topLevelComment;
            const snippet = comment?.snippet;

            if (!snippet?.videoId) {
              return null;
            }

            return {
              id: `${snippet.videoId}-comment-${index}`,
              authorName: snippet.authorDisplayName || "Usuário do YouTube",
              authorImage: snippet.authorProfileImageUrl || "",
              text: snippet.textDisplay || "",
              publishedAt: snippet.publishedAt || "",
              videoId: snippet.videoId,
              videoUrl: `https://www.youtube.com/watch?v=${snippet.videoId}`,
            };
          })
          .filter(
            (
              comment
            ): comment is {
              id: string;
              authorName: string;
              authorImage: string;
              text: string;
              publishedAt: string;
              videoId: string;
              videoUrl: string;
            } => Boolean(comment)
          );
      }
    } catch {
      // Comentários são complementares: uma falha aqui não bloqueia a página.
    }

    return NextResponse.json({
      channel: {
        id: channel.id || "",
        title: channel.snippet?.title || "",
        handle,
        uploadsPlaylistId,
      },
      count: videos.length,
      videos,
      playlists,
      liveNow,
      recentComments,
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
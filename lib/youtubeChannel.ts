import "server-only";

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

export type YouTubeVideo = {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnail: string;
  /** srcset com os tamanhos disponíveis; vazio quando o YouTube não informa larguras. */
  thumbnailSet: string;
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


// Tamanhos oferecidos pelo YouTube, do menor ao maior, para o navegador escolher pelo tamanho do card.
const THUMBNAIL_SIZES = ["medium", "high", "standard", "maxres"] as const;

function getThumbnailSet(thumbnails?: YouTubeThumbnails) {
  return THUMBNAIL_SIZES.map((size) => thumbnails?.[size])
    .filter((thumbnail): thumbnail is YouTubeThumbnail => Boolean(thumbnail?.url && thumbnail.width))
    .map((thumbnail) => `${thumbnail.url} ${thumbnail.width}w`)
    .join(", ");
}

export type YoutubeChannelResult =
  | { ok: true; data: YoutubeChannelData }
  | { ok: false; status: number; error: string };

export type YoutubeChannelData = {
  channel: { id: string; title: string; handle: string; uploadsPlaylistId: string };
  count: number;
  videos: YouTubeVideo[];
  playlists: Array<{ id: string; title: string; thumbnail: string; thumbnailSet: string; itemCount: number; url: string }>;
  liveNow: { id: string; title: string; thumbnail: string; thumbnailSet: string; url: string } | null;
  recentComments: Array<{
    id: string;
    authorName: string;
    authorImage: string;
    text: string;
    publishedAt: string;
    videoId: string;
    videoUrl: string;
  }>;
};

async function readYoutube<T>(url: URL, revalidate: number) {
  const response = await fetch(url.toString(), { next: { revalidate } });
  return { response, data: (await response.json()) as T };
}

export function readYoutubeChannelParams(rawHandle: string | null, maxResultsParam: string | null) {
  return {
    handle: cleanHandle(rawHandle || "@orabiisco"),
    maxResults: Math.min(50, Math.max(1, Number(maxResultsParam) || 9)),
  };
}

/**
 * Lê canal, vídeos, playlists, comentários e LIVE do YouTube.
 * Depois do canal, vídeos, playlists e comentários seguem em paralelo; só a LIVE espera a lista de vídeos.
 * Cada consulta usa o cache de dados do Next: 60 s para conteúdo e 15 s para o status ao vivo.
 */
export async function loadYoutubeChannel(handle: string, maxResults: number): Promise<YoutubeChannelResult> {
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      status: 500,
      error: "YOUTUBE_API_KEY não encontrada. Confira o arquivo .env.local e reinicie o servidor.",
    };
  }

  try {
    const channelUrl = createYoutubeApiUrl("channels", {
      part: "snippet,contentDetails",
      forHandle: handle,
      key: apiKey,
    });
    const { response: channelResponse, data: channelData } =
      await readYoutube<YouTubeChannelResponse>(channelUrl, CACHE_SECONDS);

    if (!channelResponse.ok) {
      return {
        ok: false,
        status: channelResponse.status,
        error: channelData.error?.message || "Erro ao buscar o canal no YouTube.",
      };
    }

    const channel = channelData.items?.[0];
    if (!channel) {
      return { ok: false, status: 404, error: `Canal não encontrado para o handle: ${handle}` };
    }

    const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) {
      return { ok: false, status: 404, error: "Playlist automática de uploads do canal não encontrada." };
    }

    const playlistUrl = createYoutubeApiUrl("playlistItems", {
      part: "snippet",
      playlistId: uploadsPlaylistId,
      maxResults: String(maxResults),
      key: apiKey,
    });
    const channelPlaylistsUrl = createYoutubeApiUrl("playlists", {
      part: "snippet,contentDetails",
      channelId: channel.id || "",
      maxResults: "50",
      key: apiKey,
    });
    const commentsUrl = createYoutubeApiUrl("commentThreads", {
      part: "snippet",
      allThreadsRelatedToChannelId: channel.id || "",
      maxResults: "3",
      order: "time",
      textFormat: "plainText",
      key: apiKey,
    });

    // Comentários são complementares: uma falha aqui não bloqueia a página.
    const commentsTask = readYoutube<YouTubeCommentThreadListResponse>(commentsUrl, CACHE_SECONDS).catch(() => null);
    const [uploads, channelPlaylists] = await Promise.all([
      readYoutube<YouTubePlaylistResponse>(playlistUrl, CACHE_SECONDS),
      readYoutube<YouTubeChannelPlaylistsResponse>(channelPlaylistsUrl, CACHE_SECONDS),
    ]);

    if (!uploads.response.ok) {
      return {
        ok: false,
        status: uploads.response.status,
        error: uploads.data.error?.message || "Erro ao buscar os vídeos recentes do canal.",
      };
    }

    if (!channelPlaylists.response.ok) {
      return {
        ok: false,
        status: channelPlaylists.response.status,
        error: channelPlaylists.data.error?.message || "Erro ao buscar as playlists do canal.",
      };
    }

    const playlists = (channelPlaylists.data.items ?? [])
      .filter((item) => Boolean(item.id))
      .map((item) => ({
        id: item.id || "",
        title: item.snippet?.title || "Playlist sem título",
        thumbnail: getBestThumbnail(item.snippet?.thumbnails),
        thumbnailSet: getThumbnailSet(item.snippet?.thumbnails),
        itemCount: Number(item.contentDetails?.itemCount || 0),
        url: item.id ? `https://www.youtube.com/playlist?list=${item.id}` : "",
      }));

    const videos: YouTubeVideo[] = (uploads.data.items ?? [])
      .map((item): YouTubeVideo | null => {
        const videoId = item.snippet?.resourceId?.videoId;
        if (!videoId) return null;

        return {
          id: videoId,
          title: item.snippet?.title || "Vídeo sem título",
          description: cleanDescription(item.snippet?.description),
          publishedAt: item.snippet?.publishedAt || "",
          thumbnail: getBestThumbnail(item.snippet?.thumbnails),
          thumbnailSet: getThumbnailSet(item.snippet?.thumbnails),
          url: `https://www.youtube.com/watch?v=${videoId}`,
          type: "video",
        };
      })
      .filter((video): video is YouTubeVideo => Boolean(video));

    const recentVideoIds = videos.slice(0, 10).map((video) => video.id).filter(Boolean);
    const liveTask = recentVideoIds.length
      ? readYoutube<YouTubeVideoDetailsResponse>(
          createYoutubeApiUrl("videos", {
            part: "snippet,liveStreamingDetails",
            id: recentVideoIds.join(","),
            key: apiKey,
          }),
          15
        ).catch(() => null)
      : Promise.resolve(null);

    const [liveDetails, comments] = await Promise.all([liveTask, commentsTask]);

    let liveNow: YoutubeChannelData["liveNow"] = null;
    if (liveDetails?.response.ok) {
      const activeIds = new Set(
        (liveDetails.data.items ?? [])
          .filter(
            (item) =>
              item.id &&
              item.snippet?.liveBroadcastContent === "live" &&
              !item.liveStreamingDetails?.actualEndTime
          )
          .map((item) => item.id as string)
      );
      const activeVideo = videos.find((video) => activeIds.has(video.id));
      if (activeVideo) {
        liveNow = {
          id: activeVideo.id,
          title: activeVideo.title,
          thumbnail: activeVideo.thumbnail,
          thumbnailSet: activeVideo.thumbnailSet,
          url: activeVideo.url,
        };
      }
    }

    const recentComments: YoutubeChannelData["recentComments"] = comments?.response.ok
      ? (comments.data.items ?? []).flatMap((item, index) => {
          const snippet = item.snippet?.topLevelComment?.snippet;
          if (!snippet?.videoId) return [];

          return [
            {
              id: `${snippet.videoId}-comment-${index}`,
              authorName: snippet.authorDisplayName || "Usuário do YouTube",
              authorImage: snippet.authorProfileImageUrl || "",
              text: snippet.textDisplay || "",
              publishedAt: snippet.publishedAt || "",
              videoId: snippet.videoId,
              videoUrl: `https://www.youtube.com/watch?v=${snippet.videoId}`,
            },
          ];
        })
      : [];

    return {
      ok: true,
      data: {
        channel: { id: channel.id || "", title: channel.snippet?.title || "", handle, uploadsPlaylistId },
        count: videos.length,
        videos,
        playlists,
        liveNow,
        recentComments,
      },
    };
  } catch {
    return { ok: false, status: 500, error: "Erro inesperado ao conectar com o YouTube." };
  }
}

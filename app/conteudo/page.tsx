"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import BannerBackground from "@/components/BannerBackground";
import { games as baseGames } from "@/data/games";

type FilterType = "all" | "video" | "live" | "short" | "playlist";

type YouTubeVideo = {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnail: string;
  url: string;
  type: "video";
};

type YouTubePlaylist = {
  id: string;
  title: string;
  thumbnail: string;
  itemCount: number;
  url: string;
};

type YouTubeLiveNow = {
  id: string;
  title: string;
  thumbnail: string;
  url: string;
};

type YouTubeRecentComment = {
  id: string;
  authorName: string;
  authorImage: string;
  text: string;
  publishedAt: string;
  videoId: string;
  videoUrl: string;
};

type YouTubeChannelResponse = {
  channel?: {
    id: string;
    title: string;
    handle: string;
    uploadsPlaylistId: string;
  };
  count?: number;
  videos?: YouTubeVideo[];
  playlists?: YouTubePlaylist[];
  liveNow?: YouTubeLiveNow | null;
  recentComments?: YouTubeRecentComment[];
  error?: string;
};

type JourneyGameResponse = {
  game?: {
    title?: string;
    youtubeFirstLiveEpisode?: string;
  };
  error?: string;
};

const filters: { label: string; value: FilterType }[] = [
  {
    label: "Todos",
    value: "all",
  },
  {
    label: "Vídeos",
    value: "video",
  },
  {
    label: "Lives",
    value: "live",
  },
  {
    label: "Shorts",
    value: "short",
  },
  {
    label: "Playlists",
    value: "playlist",
  },
];

function normalizeText(value?: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeEpisode(value?: string) {
  const match = String(value ?? "").match(/\d+/);
  if (!match) return "";
  return String(Number(match[0])).padStart(2, "0");
}

function matchesEpisode(video: YouTubeVideo, episode: string) {
  const normalized = normalizeText(`${video.title} ${video.description}`);
  const ep = normalizeEpisode(episode);
  if (!ep) return true;

  const number = String(Number(ep));
  return (
    new RegExp(`(?:ep|episodio|episode)0*(?:${number})(?!\\d)`).test(normalized) ||
    new RegExp(`(?:ep|episodio|episode)[^a-z0-9]?0*(?:${number})(?!\\d)`).test(normalized)
  );
}

function normalizeDate(date?: string) {
  if (!date) return "";

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return "";
  }

  return parsedDate.toISOString();
}

function formatDate(date?: string) {
  const normalizedDate = normalizeDate(date);

  if (!normalizedDate) {
    return "Sem data";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(normalizedDate));
}

function getVideoType(video: YouTubeVideo): Exclude<FilterType, "all"> {
  const text = normalizeText(`${video.title} ${video.description}`);

  if (
    text.includes("live") ||
    text.includes("aovivo") ||
    text.includes("ao vivo")
  ) {
    return "live";
  }

  if (
    text.includes("short") ||
    text.includes("shorts") ||
    text.includes("reels") ||
    text.includes("tiktok")
  ) {
    return "short";
  }

  return "video";
}

function getVideoTypeLabel(type: Exclude<FilterType, "all">) {
  if (type === "live") return "Live";
  if (type === "short") return "Short";

  return "Vídeo";
}

function getVideoTypeStyle(type: Exclude<FilterType, "all">) {
  if (type === "live") {
    return "border-red-400/35 bg-red-500/20 text-red-100";
  }

  if (type === "short") {
    return "border-purple-400/35 bg-purple-500/20 text-purple-100";
  }

  return "border-blue-400/35 bg-blue-500/20 text-blue-100";
}

function tokenizeText(value?: string) {
  return (
    String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .match(/[a-z0-9]+/g) ?? []
  );
}

function cleanYoutubeGameName(value: string) {
  return value
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .replace(
      /^(?:rumo\s+a\s+conquista)\s*[:|\-–—]+\s*/i,
      ""
    )
    .replace(
      /\s*[-–—|]\s*(?:ep(?:isodio|isode)?|dia)\s*#?\d+.*$/i,
      ""
    )
    .replace(
      /\s*(?:#\s*)?ep(?:isodio|isode)?\s*#?\d+.*$/i,
      ""
    )
    .trim()
    .replace(/^[\s:|\-–—]+|[\s:|\-–—]+$/g, "")
    .trim();
}

function normalizeGameKey(value: string) {
  return cleanYoutubeGameName(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(
      /\b(?:rumo\s+a\s+conquista|ao\s+vivo|live|shorts?|video|vídeo|jornada)\b/gi,
      ""
    )
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^a-z0-9]/g, "");
}

function extractYoutubeGameName(video: YouTubeVideo) {
  const title = video.title.trim();
  const marker =
    /(?:#\s*)?ep(?:isodio|isode)?\s*#?\d+|\bdia\s*#?\d+/i;
  const markerIndex = title.search(marker);

  if (markerIndex < 0) {
    return "";
  }

  const beforeMarker = title.slice(0, markerIndex);
  const pipeParts = beforeMarker
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

  const candidate =
    pipeParts.length > 1 ? pipeParts[pipeParts.length - 1] : beforeMarker;

  const cleaned = cleanYoutubeGameName(candidate);
  const key = normalizeGameKey(cleaned);

  return cleaned.length >= 3 && key.length >= 3 ? cleaned : "";
}

function extractYoutubeEpisodeNumber(value: string) {
  const match = value.match(
    /(?:\bep(?:is[oó]dio|isode)?\b|\bdia\b)\s*#?\s*(\d+)\b/i
  );

  return match ? Number(match[1]) : null;
}

function cleanPlaylistGameName(value: string) {
  return cleanYoutubeGameName(
    value
      .replace(/\b(?:playlist|oficial|jornada)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function scorePlaylistForVideo(video: YouTubeVideo, playlist: YouTubePlaylist) {
  const playlistName = cleanPlaylistGameName(playlist.title);
  const playlistKey = normalizeGameKey(playlistName);

  if (!playlistKey || playlistKey.length < 3) {
    return 0;
  }

  const titleKey = normalizeGameKey(video.title);
  const descriptionKey = normalizeGameKey(video.description);

  if (titleKey.includes(playlistKey)) {
    return 1000 + playlistKey.length;
  }

  if (descriptionKey.includes(playlistKey)) {
    return 800 + playlistKey.length;
  }

  const words = tokenizeText(playlistName).filter(
    (word) =>
      word.length >= 3 &&
      ![
        "the",
        "and",
        "for",
        "with",
        "world",
        "official",
        "oficial",
        "playlist",
        "jornada",
      ].includes(word)
  );

  if (words.length < 2) {
    return 0;
  }

  const text = new Set(tokenizeText(`${video.title} ${video.description}`));
  const matched = words.filter((word) => text.has(word)).length;

  return matched / words.length >= 0.75 ? 500 + matched * 20 : 0;
}

function findPlaylistForVideo(
  video: YouTubeVideo,
  playlists: YouTubePlaylist[]
) {
  return (
    playlists
      .map((playlist) => ({
        playlist,
        score: scorePlaylistForVideo(video, playlist),
      }))
      .filter((item) => item.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          normalizeGameKey(cleanPlaylistGameName(b.playlist.title)).length -
            normalizeGameKey(cleanPlaylistGameName(a.playlist.title)).length
      )[0]?.playlist ?? null
  );
}

function resolveYoutubeGame(
  video: YouTubeVideo,
  playlists: YouTubePlaylist[]
) {
  const playlist = findPlaylistForVideo(video, playlists);

  if (playlist) {
    const gameName = cleanPlaylistGameName(playlist.title);
    const key = normalizeGameKey(gameName);

    if (key.length >= 3) {
      return {
        key,
        gameName,
        playlist,
      };
    }
  }

  const gameName = extractYoutubeGameName(video);

  if (!gameName) {
    return null;
  }

  return {
    key: normalizeGameKey(gameName),
    gameName,
    playlist: null,
  };
}

function findPlaylistForGame(
  gameName: string,
  playlists: YouTubePlaylist[]
) {
  const gameKey = normalizeGameKey(gameName);

  if (!gameKey) {
    return null;
  }

  return (
    playlists
      .map((playlist) => ({
        playlist,
        key: normalizeGameKey(cleanPlaylistGameName(playlist.title)),
      }))
      .filter(
        (item) =>
          item.key &&
          (item.key.includes(gameKey) || gameKey.includes(item.key))
      )
      .sort((a, b) => b.key.length - a.key.length)[0]?.playlist ?? null
  );
}

function findBaseGameCover(gameName: string) {
  const target = normalizeGameKey(gameName);

  if (!target) {
    return "";
  }

  const entries = Object.values(
    baseGames as Record<
      string,
      { title?: string; image?: string; cardImage?: string }
    >
  );

  const exact = entries.find(
    (game) => normalizeGameKey(game.title || "") === target
  );

  if (exact) {
    return exact.cardImage || exact.image || "";
  }

  const partial = entries.find((game) => {
    const key = normalizeGameKey(game.title || "");

    return (
      key.length >= 5 &&
      (key.includes(target) || target.includes(key))
    );
  });

  return partial?.cardImage || partial?.image || "";
}

function VideoThumbnail({
  src,
  title,
}: {
  src: string;
  title: string;
}) {
  const [hasError, setHasError] = useState(false);

  if (!src || hasError) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#0a0c10] text-[9px] font-black uppercase tracking-[0.12em] text-white/20">
        Sem capa
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={title}
      className="h-full w-full object-cover opacity-90 transition duration-700 group-hover:scale-105 group-hover:opacity-100"
      onError={() => setHasError(true)}
    />
  );
}

function StatCard({
  label,
  value,
  accent = "white",
}: {
  label: string;
  value: string | number;
  accent?: "white" | "red" | "blue" | "purple";
}) {
  const className =
    accent === "red"
      ? "border-red-400/20 bg-red-500/10"
      : accent === "blue"
      ? "border-blue-400/20 bg-blue-500/10"
      : accent === "purple"
      ? "border-purple-400/20 bg-purple-500/10"
      : "border-white/10 bg-white/[0.04]";

  return (
    <div className={`rounded-xl border px-4 py-3 ${className}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
        {label}
      </p>

      <p className="mt-1 text-2xl font-black text-white">{value}</p>
    </div>
  );
}

function TypeBadge({ type }: { type: Exclude<FilterType, "all"> }) {
  return (
    <span
      className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${getVideoTypeStyle(
        type
      )}`}
    >
      {getVideoTypeLabel(type)}
    </span>
  );
}

function FeaturedVideo({ video }: { video: YouTubeVideo }) {
  const type = getVideoType(video);

  return (
    <a
      href={video.url}
      target="_blank"
      rel="noreferrer"
      className="block"
    >
      <article className="group overflow-hidden rounded-[16px] border border-red-500/20 bg-zinc-950/85 shadow-xl transition hover:border-red-500/40 hover:shadow-[0_0_48px_rgba(239,68,68,0.16)]">
        <div className="grid lg:grid-cols-[1.35fr_0.65fr]">
          <div className="relative min-h-[270px] overflow-hidden bg-black">
            <VideoThumbnail src={video.thumbnail} title={video.title} />

            <div className="absolute inset-0 bg-gradient-to-r from-black/20 via-transparent to-black/70" />

            <div className="absolute left-5 top-5">
              <TypeBadge type={type} />
            </div>

            <div className="absolute right-5 top-5 rounded-full border border-white/10 bg-black/60 px-3 py-1 text-[10px] font-black text-white/70 backdrop-blur-md">
              {formatDate(video.publishedAt)}
            </div>
          </div>

          <div className="flex flex-col justify-center p-6">
            <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
              Último conteúdo
            </p>

            <p className="mt-4 text-sm font-black text-blue-300">
              YouTube • @orabiisco
            </p>

            <h2 className="mt-2 text-3xl font-black leading-tight text-white">
              {video.title}
            </h2>

            <p className="mt-4 line-clamp-4 text-sm leading-relaxed text-white/50">
              {video.description || "Vídeo publicado no canal do projeto."}
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <span className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs font-black text-white/55">
                {formatDate(video.publishedAt)}
              </span>

              <span className="rounded-xl border border-red-500/35 bg-red-500/15 px-5 py-3 text-xs font-black text-red-100 transition group-hover:bg-red-500/25">
                Assistir no YouTube →
              </span>
            </div>
          </div>
        </div>
      </article>
    </a>
  );
}

function VideoCard({ video }: { video: YouTubeVideo }) {
  const type = getVideoType(video);

  return (
    <a
      href={video.url}
      target="_blank"
      rel="noreferrer"
      className="block"
    >
      <article className="group overflow-hidden rounded-[28px] border border-white/10 bg-zinc-950/85 shadow-xl transition hover:-translate-y-1 hover:border-red-500/35 hover:shadow-[0_0_42px_rgba(239,68,68,0.14)]">
        <div className="relative aspect-video overflow-hidden bg-black">
          <VideoThumbnail src={video.thumbnail} title={video.title} />

          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />

          <div className="absolute left-4 top-4">
            <TypeBadge type={type} />
          </div>

          <div className="absolute right-4 top-4 rounded-full border border-white/10 bg-black/60 px-3 py-1 text-[10px] font-black text-white/70 backdrop-blur-md">
            {formatDate(video.publishedAt)}
          </div>
        </div>

        <div className="p-5">
          <p className="text-[11px] font-black text-blue-300">
            YouTube • @orabiisco
          </p>

          <h2 className="mt-2 line-clamp-2 text-2xl font-black leading-tight text-white">
            {video.title}
          </h2>

          <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-white/50">
            {video.description || "Vídeo publicado no canal do projeto."}
          </p>

          <div className="mt-5 flex items-center justify-between gap-4">
            <p className="line-clamp-1 text-xs text-white/35">
              {formatDate(video.publishedAt)}
            </p>

            <span className="shrink-0 rounded-xl border border-red-500/35 bg-red-500/15 px-4 py-2 text-xs font-black text-red-100 transition group-hover:bg-red-500/25">
              Assistir →
            </span>
          </div>
        </div>
      </article>
    </a>
  );
}


function LiveFeatured({ live }: { live: YouTubeLiveNow }) {
  return (
    <section className="mt-4 overflow-hidden rounded-[14px] border border-red-500/35 bg-[#090b0f]">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500/70" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
          </span>
          <p className="text-[12px] font-black uppercase tracking-[0.08em] text-white">
            AO VIVO AGORA
          </p>
        </div>

        <span className="rounded-md border border-red-500/25 bg-red-500/10 px-2 py-1 text-[8px] font-black uppercase tracking-[0.12em] text-red-200">
          YouTube
        </span>
      </div>

      <div className="p-3">
        <div className="aspect-video overflow-hidden rounded-[10px] bg-black">
          <iframe
            className="h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${live.id}?rel=0`}
            title={live.title}
            allow="autoplay; encrypted-media; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>

        <div className="flex items-end justify-between gap-4 px-1 pb-1 pt-3">
          <div className="min-w-0">
            <p className="line-clamp-2 text-[14px] font-black leading-[1.3] text-white">
              {live.title}
            </p>
            <p className="mt-1 text-[9px] text-white/35">
              Transmissão em andamento no YouTube.
            </p>
          </div>

          <a
            href={live.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[9px] font-black text-red-100 transition hover:bg-red-500/20"
          >
            Abrir no YouTube →
          </a>
        </div>
      </div>
    </section>
  );
}

function PlaylistCard({ playlist }: { playlist: YouTubePlaylist }) {
  return (
    <a
      href={playlist.url}
      target="_blank"
      rel="noreferrer"
      className="group block min-w-0"
    >
      <article className="overflow-hidden rounded-[12px] border border-white/[0.08] bg-[#090b0f] transition hover:-translate-y-0.5 hover:border-red-500/30 hover:bg-[#0b0e13]">
        <div className="relative aspect-[16/9] overflow-hidden bg-black">
          <VideoThumbnail
            src={playlist.thumbnail}
            title={playlist.title}
          />
          <div className="absolute left-2.5 top-2.5 rounded-md border border-white/[0.12] bg-black/70 px-2 py-1 text-[8px] font-black uppercase tracking-[0.10em] text-white">
            Playlist
          </div>
          <div className="absolute bottom-2 right-2 rounded-md bg-black/80 px-2 py-1 text-[8px] font-black text-white">
            {playlist.itemCount || 0} conteúdos
          </div>
        </div>

        <div className="p-3">
          <h3 className="line-clamp-2 text-[12px] font-black leading-[1.3] text-white group-hover:text-red-200">
            {playlist.title}
          </h3>
          <p className="mt-1.5 text-[8px] font-medium uppercase tracking-[0.10em] text-white/25">
            Abrir no YouTube →
          </p>
        </div>
      </article>
    </a>
  );
}

function RecentVideoCard({ video }: { video: YouTubeVideo }) {
  const type = getVideoType(video);

  return (
    <a
      href={video.url}
      target="_blank"
      rel="noreferrer"
      className="group block min-w-0"
    >
      <article className="overflow-hidden rounded-[12px] border border-white/[0.08] bg-[#090b0f] transition hover:-translate-y-0.5 hover:border-red-500/30">
        <div className="relative aspect-video overflow-hidden bg-black">
          <VideoThumbnail src={video.thumbnail} title={video.title} />
          <div className="absolute left-2.5 top-2.5">
            <TypeBadge type={type} />
          </div>
          <div className="absolute bottom-2 right-2 rounded-md bg-black/80 px-2 py-1 text-[8px] font-black text-white">
            {formatDate(video.publishedAt)}
          </div>
        </div>
        <div className="p-3">
          <h3 className="line-clamp-2 text-[12px] font-black leading-[1.3] text-white group-hover:text-red-200">
            {video.title}
          </h3>
        </div>
      </article>
    </a>
  );
}

function ContentListRow({ video }: { video: YouTubeVideo }) {
  const type = getVideoType(video);

  return (
    <a
      href={video.url}
      target="_blank"
      rel="noreferrer"
      className="group block"
    >
      <article className="flex gap-3 border-b border-white/[0.07] py-3.5 last:border-b-0">
        <div className="relative h-[78px] w-[138px] shrink-0 overflow-hidden rounded-[9px] bg-black sm:h-[88px] sm:w-[156px]">
          <VideoThumbnail src={video.thumbnail} title={video.title} />
          <div className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[8px] font-black text-white">
            {formatDate(video.publishedAt)}
          </div>
        </div>

        <div className="min-w-0 flex-1 py-0.5">
          <TypeBadge type={type} />
          <h3 className="mt-2 line-clamp-2 text-[13px] font-black leading-[1.3] text-white group-hover:text-red-200">
            {video.title}
          </h3>
          <p className="mt-1 line-clamp-2 text-[9px] leading-[1.45] text-white/35">
            {video.description || "Conteúdo publicado no canal do projeto."}
          </p>
        </div>
      </article>
    </a>
  );
}

function EmptyState({ error }: { error?: string }) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-8 shadow-xl">
      <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
        Nada por aqui ainda
      </p>

      <h2 className="mt-3 text-3xl font-black text-white">
        Nenhum conteúdo encontrado
      </h2>

      <p className="mt-3 max-w-[720px] text-sm leading-relaxed text-white/50">
        {error ||
          "Quando houver vídeos públicos no canal, eles aparecerão automaticamente aqui."}
      </p>

      <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-5">
        <p className="text-sm font-black text-white">
          Atualização automática
        </p>

        <p className="mt-3 text-sm leading-relaxed text-white/45">
          A página busca os últimos vídeos do canal pelo YouTube. Se um vídeo
          novo for publicado, ele aparece aqui. Se for removido ou ficar privado,
          ele também deixa de aparecer após a atualização do cache.
        </p>
      </div>
    </div>
  );
}


function ContentBannerIcon({
  type,
}: {
  type: "content" | "video" | "live";
}) {
  if (type === "video") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[24px] w-[24px]"
        aria-hidden="true"
      >
        <rect x="3" y="6" width="13" height="12" rx="2" />
        <path d="m16 10 5-3v10l-5-3" />
      </svg>
    );
  }

  if (type === "live") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[24px] w-[24px]"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
        <path d="M7.5 7.5a6.4 6.4 0 0 0 0 9" />
        <path d="M16.5 7.5a6.4 6.4 0 0 1 0 9" />
        <path d="M4.8 4.8a10.2 10.2 0 0 0 0 14.4" />
        <path d="M19.2 4.8a10.2 10.2 0 0 1 0 14.4" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[24px] w-[24px]"
      aria-hidden="true"
    >
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="m10 9 5 3-5 3V9Z" />
    </svg>
  );
}
function ContentBannerMetric({
  icon,
  label,
  value,
  divided = false,
}: {
  icon: "content" | "video" | "live";
  label: string;
  value: string | number;
  divided?: boolean;
}) {
  return (
    <div
      className={`flex min-w-0 items-center gap-2.5 ${
        divided ? "border-l border-white/10 pl-4" : ""
      }`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-red-600/15 text-red-500">
        <ContentBannerIcon type={icon} />
      </span>

      <div className="min-w-0">
        <p className="truncate text-[19px] font-black leading-none tracking-tight text-white">
          {value}
        </p>
        <p className="mt-1 truncate text-[13px] font-medium leading-[1.25] text-white/55">
          {label}
        </p>
      </div>
    </div>
  );
}

export default function ConteudoPage() {
  const [videos, setVideos] = useState<YouTubeVideo[]>([]);
  const [liveNow, setLiveNow] = useState<YouTubeLiveNow | null>(null);
  const [recentComments, setRecentComments] = useState<YouTubeRecentComment[]>([]);
  const [playlists, setPlaylists] = useState<YouTubePlaylist[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [requestedEpisode, setRequestedEpisode] = useState("");
  const [journeyStartRequested, setJourneyStartRequested] = useState(false);
  const [journeyGameTitle, setJourneyGameTitle] = useState("");
  const [journeyError, setJourneyError] = useState("");
  const [selectedRecentGameKey, setSelectedRecentGameKey] = useState("");
  const [showAllPlaylists, setShowAllPlaylists] = useState(false);
  const [playlistSearch, setPlaylistSearch] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const episode = normalizeEpisode(params.get("ep") ?? "");
    const gameSlug = params.get("game")?.trim() ?? "";
    const isJourneyStart = params.get("inicio") === "1";

    setRequestedEpisode(episode);
    setJourneyStartRequested(Boolean(gameSlug && isJourneyStart));
    setJourneyGameTitle("");
    setJourneyError("");

    const controller = new AbortController();

    async function loadJourneyGame() {
      if (!gameSlug || !isJourneyStart) return;

      try {
        const response = await fetch(
          "/api/games/data?slug=" + encodeURIComponent(gameSlug),
          {
            signal: controller.signal,
            cache: "no-store",
          }
        );

        const data = (await response.json()) as JourneyGameResponse;

        if (!response.ok || !data.game) {
          throw new Error(data.error || "Não foi possível localizar o jogo da Jornada de Estreia.");
        }

        const firstEpisode = normalizeEpisode(
          data.game.youtubeFirstLiveEpisode?.trim() || ""
        );

        setJourneyGameTitle(data.game.title?.trim() || gameSlug);
        setRequestedEpisode(firstEpisode);

        if (!firstEpisode) {
          setJourneyError("O EP de início da Jornada de Estreia ainda não foi cadastrado para este jogo.");
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setJourneyError(
          error instanceof Error
            ? error.message
            : "Não foi possível carregar o início da Jornada de Estreia."
        );
      }
    }

    void loadJourneyGame();
    
    async function loadYouTubeVideos() {
      try {
        setIsLoading(true);
        setError("");

        const response = await fetch(
          "/api/youtube/channel?handle=@orabiisco&maxResults=50",
          {
            signal: controller.signal,
          }
        );

        const data = (await response.json()) as YouTubeChannelResponse;

        if (!response.ok) {
          throw new Error(data.error || "Erro ao buscar vídeos do YouTube.");
        }

        setVideos(data.videos ?? []);
        setPlaylists(data.playlists ?? []);
        setLiveNow(data.liveNow ?? null);
        setRecentComments(data.recentComments ?? []);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setError(
          error instanceof Error
            ? error.message
            : "Erro inesperado ao buscar vídeos do YouTube."
        );
      } finally {
        setIsLoading(false);
      }
    }

    loadYouTubeVideos();

    return () => {
      controller.abort();
    };
  }, []);

  const filteredVideos = useMemo(() => {
    if (activeFilter === "playlist") {
      return [];
    }

    const byType =
      activeFilter === "all"
        ? videos
        : videos.filter((video) => getVideoType(video) === activeFilter);

    if (!requestedEpisode) {
      return byType;
    }

    return byType.filter((video) => matchesEpisode(video, requestedEpisode));
  }, [activeFilter, requestedEpisode, videos]);

  const recentGames = useMemo(() => {
    const grouped = new Map<
      string,
      {
        key: string;
        gameName: string;
        latestVideo: YouTubeVideo;
        latestTimestamp: number;
        playlist: YouTubePlaylist | null;
        gameImage: string;
        contentCount: number;
        episodeCount: number;
      }
    >();

    for (const video of videos) {
      const resolved = resolveYoutubeGame(video, playlists);

      if (!resolved) {
        continue;
      }

      const latestTimestamp = new Date(video.publishedAt).getTime();
      const existing = grouped.get(resolved.key);
      const gameImage =
        findBaseGameCover(resolved.gameName) ||
        resolved.playlist?.thumbnail ||
        "";

      if (!existing || latestTimestamp > existing.latestTimestamp) {
        grouped.set(resolved.key, {
          key: resolved.key,
          gameName: resolved.gameName,
          latestVideo: video,
          latestTimestamp,
          playlist:
            resolved.playlist ||
            findPlaylistForGame(resolved.gameName, playlists),
          gameImage,
          contentCount: 0,
          episodeCount: 0,
        });
      }
    }

    return Array.from(grouped.values())
      .map((item) => {
        const episodeNumbers = new Set<number>();
        let contentCount = 0;

        for (const video of videos) {
          const resolved = resolveYoutubeGame(video, playlists);

          if (!resolved || resolved.key !== item.key) {
            continue;
          }

          contentCount += 1;

          const episodeNumber = extractYoutubeEpisodeNumber(video.title);
          if (episodeNumber !== null) {
            episodeNumbers.add(episodeNumber);
          }
        }

        return {
          ...item,
          contentCount,
          episodeCount: episodeNumbers.size,
        };
      })
      .sort((a, b) => b.latestTimestamp - a.latestTimestamp)
      .slice(0, 3);
  }, [videos, playlists]);

  const selectedRecentGame =
    selectedRecentGameKey
      ? recentGames.find((item) => item.key === selectedRecentGameKey) ?? null
      : null;

  const selectedGameVideos = useMemo(() => {
    if (!selectedRecentGame) {
      return [];
    }

    return videos
      .filter(
        (video) =>
          resolveYoutubeGame(video, playlists)?.key === selectedRecentGame.key
      )
      .sort(
        (a, b) =>
          new Date(b.publishedAt).getTime() -
          new Date(a.publishedAt).getTime()
      )
      .slice(0, 24);
  }, [selectedRecentGame, playlists, videos]);

  const filteredPlaylists = useMemo(() => {
    const query = normalizeText(playlistSearch);

    if (!query) {
      return playlists;
    }

    return playlists.filter((playlist) =>
      normalizeText(playlist.title).includes(query)
    );
  }, [playlists, playlistSearch]);

  const journeyStartVideo = useMemo(() => {
    if (!journeyStartRequested || !requestedEpisode) {
      return null;
    }

    return filteredVideos[0] ?? null;
  }, [journeyStartRequested, requestedEpisode, filteredVideos]);

  const totalLives = videos.filter(
    (video) => getVideoType(video) === "live"
  ).length;

  const totalShorts = videos.filter(
    (video) => getVideoType(video) === "short"
  ).length;

  const totalVideos = videos.filter(
    (video) => getVideoType(video) === "video"
  ).length;

  return (
    <main className="min-h-screen bg-[#050608] text-white">
      <Navbar />

      <div className="mx-auto grid w-full max-w-[1620px] grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_320px]">
        {/* SIDEBAR ESQUERDA — estrutura-base da V2 */}
        <aside className="hidden min-h-[calc(100vh-74px)] border-r border-white/[0.10] px-4 py-5 lg:block">
          <div className="sticky top-20 flex min-h-[calc(100vh-94px)] flex-col">
            <div>
              <div className="border-b border-white/[0.08] pb-4 pt-2">
                <div className="flex items-center gap-2 text-[13px] font-black uppercase tracking-[0.12em] text-white/90">
                  <span className="text-red-400">▶</span>
                  Conteúdo
                </div>
              </div>

              <div className="mt-6 border-b border-white/[0.08] pb-6">
                <div className="flex items-center gap-2">
                  <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
                  <h2 className="text-[13px] font-black uppercase tracking-[0.12em] text-white">
                    FILTRO
                  </h2>
                </div>

                <div className="mt-3 space-y-1.5">
                  {filters.map((filter) => {
                    const isActive =
                      filter.value === "playlist"
                        ? showAllPlaylists
                        : activeFilter === filter.value;

                    return (
                      <button
                        key={filter.value}
                        type="button"
                        onClick={() => {
                          setSelectedRecentGameKey("");
                          setPlaylistSearch("");

                          if (filter.value === "playlist") {
                            setActiveFilter("playlist");
                            setShowAllPlaylists(true);
                            return;
                          }

                          setShowAllPlaylists(false);
                          setActiveFilter(filter.value);
                        }}
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[12px] font-black transition ${
                          isActive
                            ? "border border-red-500/30 bg-red-500/10 text-red-200"
                            : "border border-transparent text-white/65 hover:bg-white/[0.04] hover:text-white"
                        }`}
                      >
                        <span>{filter.label}</span>
                        <span className="text-[10px] font-black text-white/45">
                          {filter.value === "all"
                            ? videos.length
                            : filter.value === "video"
                            ? totalVideos
                            : filter.value === "live"
                            ? totalLives
                            : filter.value === "short"
                            ? totalShorts
                            : playlists.length}
                        </span>
                      </button>
                    );
                  })}
                </div>              </div>

              <div className="mt-6">
                <div className="flex items-center gap-2">
                  <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
                  <h2 className="text-[12px] font-black uppercase tracking-[0.12em] text-white">
                    JORNADA
                  </h2>
                </div>

                <div className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.15em] text-white/40">
                    {journeyStartRequested ? "Início da Jornada" : requestedEpisode ? "Episódio selecionado" : "Conteúdo geral"}
                  </p>

                  <p className="mt-1.5 text-[13px] font-black leading-tight text-white">
                    {journeyStartRequested
                      ? journeyGameTitle || "Jornada de Estreia"
                      : requestedEpisode
                      ? `EP ${requestedEpisode}`
                      : "Todos os conteúdos"}
                  </p>

                  {journeyStartRequested && requestedEpisode ? (
                    <p className="mt-1.5 text-[10px] font-bold text-emerald-300/80">
                      EP {requestedEpisode}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mt-auto space-y-2 pt-8">
              <Link
                href="/configuracoes"
                className="flex items-center gap-3 px-2.5 py-2 text-[10px] font-bold text-white/45 transition hover:text-white"
              >
                <span className="text-white/35">⚙</span>
                Configurações
              </Link>

              <a
                href="https://www.youtube.com/@orabiisco"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 px-2.5 py-2 text-[10px] font-bold text-red-400 transition hover:text-red-300"
              >
                <span>▶</span>
                Canal no YouTube
              </a>
            </div>
          </div>
        </aside>

        {/* CONTEÚDO CENTRAL */}
        <div className="min-w-0 border-r border-white/[0.10] px-4 py-5 md:px-5 lg:px-6">
          <header className="relative overflow-hidden border-b border-white/10 bg-[#050609]">
            <BannerBackground bannerKey="conteudo" imageUrl="/images/content-banner-bg.png" adminButtonClassName="" />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,6,9,0.99)_0%,rgba(5,6,9,0.96)_34%,rgba(5,6,9,0.70)_58%,rgba(5,6,9,0.42)_78%,rgba(5,6,9,0.74)_100%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(239,68,68,0.16),transparent_42%)]" />
            <div className="absolute inset-x-0 bottom-0 h-24 bg-[linear-gradient(180deg,transparent_0%,rgba(5,6,9,0.96)_100%)]" />

            <div className="relative min-h-[235px] px-7 py-7 md:px-7 md:py-7">
              <div className="max-w-[400px]">
                <p className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.22em] text-red-500">
                  <span className="text-[10px] leading-none">✣</span>
                  Sua jornada em conteúdo
                </p>

                <h1 className="mt-2 text-[38px] font-black leading-none tracking-tight text-white md:text-[40px]">
                  CONTEÚDO
                </h1>

                <p className="mt-3 max-w-[340px] text-[12px] font-medium leading-[1.35] text-white/70">
                  Acompanhe vídeos, lives e shorts publicados ao longo da sua jornada.
                </p>
              </div>

              <div className="absolute bottom-8 left-7 right-7 grid grid-cols-3">
                <ContentBannerMetric
                  icon="content"
                  label="Conteúdos"
                  value={isLoading ? "..." : videos.length}
                />

                <ContentBannerMetric
                  icon="video"
                  label="Vídeos"
                  value={isLoading ? "..." : totalVideos}
                  divided
                />

                <ContentBannerMetric
                  icon="live"
                  label="Lives"
                  value={isLoading ? "..." : totalLives}
                  divided
                />
              </div>
            </div>
          </header>          {/* Filtros para telas sem sidebar */}
          <section className="mt-4 lg:hidden">
            <div className="flex flex-wrap gap-2">
              {filters.map((filter) => {
                const isActive = activeFilter === filter.value;

                return (
                  <button
                    key={filter.value}
                    type="button"
                    onClick={() => setActiveFilter(filter.value)}
                    className={`rounded-lg border px-3 py-2 text-[10px] font-black transition ${
                      isActive
                        ? "border-red-500/35 bg-red-500/10 text-red-200"
                        : "border-white/10 bg-white/[0.02] text-white/55 hover:border-white/20 hover:text-white"
                    }`}
                  >
                    {filter.label}
                  </button>
                );
              })}
            </div>
          </section>

          {journeyStartRequested ? (
            <section className="mt-3">
              {journeyStartVideo ? (
                <FeaturedVideo video={journeyStartVideo} />
              ) : (
                <EmptyState
                  error={
                    journeyError ||
                    "A primeira live da Jornada de Estreia ainda não foi cadastrada para este jogo."
                  }
                />
              )}
            </section>
          ) : selectedRecentGame ? (
            <section className="mt-4">
              <div className="mb-4 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
                    <h2 className="truncate text-[18px] font-black text-white">
                      {selectedRecentGame.gameName}
                    </h2>
                  </div>
                  <p className="mt-1 text-[10px] text-white/35">
                    Conteúdos mais recentes deste jogo encontrados no YouTube.
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {selectedRecentGame.playlist ? (
                    <a
                      href={selectedRecentGame.playlist.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-[9px] font-black text-red-100 transition hover:bg-red-500/20"
                    >
                      Abrir playlist →
                    </a>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => setSelectedRecentGameKey("")}
                    className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-[9px] font-black text-white/45 transition hover:text-white"
                  >
                    Todos
                  </button>
                </div>
              </div>

              {selectedGameVideos.length === 0 ? (
                <EmptyState error="Nenhum conteúdo foi encontrado para este jogo." />
              ) : (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                  {selectedGameVideos.map((video) => (
                    <RecentVideoCard key={video.id} video={video} />
                  ))}
                </div>
              )}
            </section>
          ) : showAllPlaylists ? (
            <section className="mt-4">
              <div className="mb-4 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="h-[20px] w-[2px] bg-red-500" />
                    <h2 className="text-[18px] font-black text-white">
                      PLAYLISTS
                    </h2>
                  </div>
                  <p className="mt-1 text-[10px] text-white/35">
                    Todas as playlists encontradas no seu canal do YouTube.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowAllPlaylists(false);
                    setPlaylistSearch("");
                  }}
                  className="shrink-0 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-[9px] font-black text-white/45 transition hover:border-white/[0.14] hover:text-white"
                >
                  ← Mais recentes
                </button>
              </div>

              <div className="mb-4 flex items-center gap-2 rounded-[10px] border border-white/[0.08] bg-[#090b0f] px-3 py-2.5">
                <span className="text-[13px] text-white/30">⌕</span>
                <input
                  type="search"
                  value={playlistSearch}
                  onChange={(event) => setPlaylistSearch(event.target.value)}
                  placeholder="Buscar playlist..."
                  className="min-w-0 flex-1 bg-transparent text-[11px] font-medium text-white outline-none placeholder:text-white/25"
                />
                <span className="shrink-0 text-[8px] font-black uppercase tracking-[0.12em] text-white/20">
                  {filteredPlaylists.length}
                </span>
              </div>

              {isLoading ? (
                <div className="rounded-[14px] border border-white/10 bg-[#090b0f] p-8 text-[11px] text-white/40">
                  Carregando playlists do YouTube...
                </div>
              ) : filteredPlaylists.length === 0 ? (
                <EmptyState error="Nenhuma playlist encontrada." />
              ) : (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                  {filteredPlaylists.map((playlist) => (
                    <PlaylistCard key={playlist.id} playlist={playlist} />
                  ))}
                </div>
              )}
            </section>
          ) : (
            <>
              {liveNow ? <LiveFeatured live={liveNow} /> : null}

              <section className="mt-4">
                <div className="mb-3 flex items-end justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="h-[20px] w-[2px] bg-red-500" />
                      <h2 className="text-[16px] font-black text-white">
                        MAIS RECENTES
                      </h2>
                    </div>
                    <p className="mt-1 text-[10px] text-white/35">
                      Os conteúdos mais novos da sua jornada.
                    </p>
                  </div>
                </div>

                {isLoading ? (
                  <div className="rounded-[14px] border border-white/10 bg-[#090b0f] p-8 text-[11px] text-white/40">
                    Carregando conteúdos do YouTube...
                  </div>
                ) : filteredVideos.length === 0 ? (
                  <EmptyState error={error} />
                ) : (
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {filteredVideos
                      .filter((video) => video.id !== liveNow?.id)
                      .slice(0, 4)
                      .map((video) => (
                        <RecentVideoCard key={video.id} video={video} />
                      ))}
                  </div>
                )}
              </section>

              {!isLoading && filteredVideos.filter((video) => video.id !== liveNow?.id).length > 4 ? (
                <section className="mt-5 rounded-[14px] border border-white/[0.08] bg-[#090b0f] px-4 pb-3.5 pt-3.5">
                  <div className="mb-2 flex items-end justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="h-[20px] w-[2px] bg-red-500" />
                        <h2 className="text-[16px] font-black text-white">
                          TODOS OS CONTEÚDOS
                        </h2>
                      </div>
                      <p className="mt-1 text-[10px] text-white/35">
                        Explore o restante em uma única sequência.
                      </p>
                    </div>
                    <span className="shrink-0 text-[9px] font-black uppercase tracking-[0.12em] text-white/20">
                      {filteredVideos.filter((video) => video.id !== liveNow?.id).length} itens
                    </span>
                  </div>

                  {filteredVideos
                    .filter((video) => video.id !== liveNow?.id)
                    .slice(4)
                    .map((video) => (
                      <ContentListRow key={video.id} video={video} />
                    ))}
                </section>
              ) : null}
            </>
          )}
        </div>

        {/* SIDEBAR DIREITA — 3 jogos recentes detectados pelo YouTube */}
        <aside className="hidden py-5 xl:block">
          <div className="sticky top-20">
            <section className="rounded-[12px] border border-white/[0.10] bg-[#090b0f] p-3.5">
              <div className="mb-3 flex items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-2">
                  <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
                  <h2 className="text-[13px] font-black uppercase tracking-[0.08em] leading-none text-white">
                    PLAYLISTS RECENTES
                  </h2>
                </div>
                <span className="text-[8px] font-black uppercase tracking-[0.12em] text-white/20">
                  YouTube
                </span>
              </div>

              {recentGames.length === 0 ? (
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-5 text-center text-[9px] leading-relaxed text-white/30">
                  Nenhum jogo recente identificado nos conteúdos do YouTube.
                </div>
              ) : (
                <>
                  <div className="space-y-2.5">
                  {recentGames.map((item) => {
                    const active = selectedRecentGame?.key === item.key;

                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setShowAllPlaylists(false);
                          setPlaylistSearch("");
                          setSelectedRecentGameKey(active ? "" : item.key);
                        }}
                        className={`group block w-full rounded-[10px] border p-2 text-left transition ${
                          active
                            ? "border-red-500/40 bg-red-500/10"
                            : "border-white/[0.06] bg-white/[0.015] hover:border-white/[0.12] hover:bg-white/[0.03]"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="relative h-[86px] w-[64px] shrink-0 overflow-hidden rounded-[7px] bg-black">
                            <VideoThumbnail
                              src={item.gameImage}
                              title={item.gameName}
                            />
                          </div>

                          <div className="min-w-0 flex-1 self-center">
                            <p className="text-[12px] font-black leading-[1.25] text-white transition group-hover:text-red-200">
                              {item.gameName}
                            </p>

                            <p className="mt-1.5 text-[9px] font-medium leading-none text-white/35">
                              {item.episodeCount > 0
                                ? `${item.episodeCount} episódios`
                                : `${item.contentCount} conteúdos`}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  </div>

                  <button
                  type="button"
                  onClick={() => {
                    setSelectedRecentGameKey("");
                    setShowAllPlaylists(true);
                    setPlaylistSearch("");
                  }}
                  className="mt-3 w-full rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 text-center text-[9px] font-black text-white/50 transition hover:border-red-500/25 hover:bg-red-500/5 hover:text-red-200"
                >
                  Ver todas as playlists →
                  </button>
                </>
              )}
            </section>

            <section className="mt-3 rounded-[12px] border border-white/[0.10] bg-[#090b0f] p-3.5">
              <div className="mb-3 flex items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-2">
                  <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
                  <h2 className="text-[13px] font-black uppercase tracking-[0.08em] leading-none text-white">
                    COMENTÁRIOS RECENTES
                  </h2>
                </div>
                <span className="text-[8px] font-black uppercase tracking-[0.12em] text-white/20">
                  YouTube
                </span>
              </div>

              {recentComments.length === 0 ? (
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-5 text-center text-[9px] leading-relaxed text-white/30">
                  Nenhum comentário recente encontrado.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {recentComments.map((comment) => {
                    const video = videos.find((item) => item.id === comment.videoId);

                    return (
                      <a
                        key={comment.id}
                        href={comment.videoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="group block rounded-[9px] border border-white/[0.06] bg-white/[0.015] p-3.5 transition hover:border-white/[0.12] hover:bg-white/[0.03]"
                      >
                        <div className="flex items-start gap-3">
                          {comment.authorImage ? (
                            <img
                              src={comment.authorImage}
                              alt=""
                              className="mt-0.5 h-[30px] w-[30px] shrink-0 rounded-full object-cover"
                            />
                          ) : (
                            <div className="mt-0.5 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[10px] font-black text-white/40">
                              {comment.authorName.slice(0, 1).toUpperCase()}
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[10.5px] font-black text-white">
                              {comment.authorName}
                            </p>

                            <p className="mt-1.5 line-clamp-3 text-[12px] font-medium leading-[1.45] text-white/80 transition group-hover:text-white">
                              “{comment.text}”
                            </p>

                            <p className="mt-2 truncate text-[8px] font-medium text-white/30">
                              {video?.title || "Vídeo no YouTube"} · {formatDate(comment.publishedAt)}
                            </p>
                          </div>
                        </div>
                      </a>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </aside>
      </div>
    </main>
  );
}
"use client";

import { useEffect, useMemo, useState } from "react";
import Navbar from "@/components/Navbar";

type FilterType = "all" | "video" | "live" | "short";

type YouTubeVideo = {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnail: string;
  url: string;
  type: "video";
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
];

function normalizeText(value?: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
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
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-red-950/50 via-zinc-950 to-blue-950/30 text-sm font-black text-white/35">
        Sem thumbnail
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
    <div className={`rounded-2xl border px-5 py-4 ${className}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
        {label}
      </p>

      <p className="mt-1 text-3xl font-black text-white">{value}</p>
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
      <article className="group overflow-hidden rounded-[32px] border border-red-500/20 bg-zinc-950/85 shadow-xl transition hover:border-red-500/40 hover:shadow-[0_0_48px_rgba(239,68,68,0.16)]">
        <div className="grid lg:grid-cols-[1.25fr_0.75fr]">
          <div className="relative min-h-[320px] overflow-hidden bg-black">
            <VideoThumbnail src={video.thumbnail} title={video.title} />

            <div className="absolute inset-0 bg-gradient-to-r from-black/20 via-transparent to-black/70" />

            <div className="absolute left-5 top-5">
              <TypeBadge type={type} />
            </div>

            <div className="absolute right-5 top-5 rounded-full border border-white/10 bg-black/60 px-3 py-1 text-[10px] font-black text-white/70 backdrop-blur-md">
              {formatDate(video.publishedAt)}
            </div>
          </div>

          <div className="flex flex-col justify-center p-7">
            <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
              Último conteúdo
            </p>

            <p className="mt-4 text-sm font-black text-blue-300">
              YouTube • @orabiisco
            </p>

            <h2 className="mt-2 text-4xl font-black leading-tight text-white">
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

export default function ConteudoPage() {
  const [videos, setVideos] = useState<YouTubeVideo[]>([]);
  const [channelTitle, setChannelTitle] = useState("YouTube");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");

  useEffect(() => {
    const controller = new AbortController();

    async function loadYouTubeVideos() {
      try {
        setIsLoading(true);
        setError("");

        const response = await fetch(
          "/api/youtube/channel?handle=@orabiisco&maxResults=5",
          {
            signal: controller.signal,
          }
        );

        const data = (await response.json()) as YouTubeChannelResponse;

        if (!response.ok) {
          throw new Error(data.error || "Erro ao buscar vídeos do YouTube.");
        }

        setVideos(data.videos ?? []);
        setChannelTitle(data.channel?.title || "YouTube");
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
    if (activeFilter === "all") {
      return videos;
    }

    return videos.filter((video) => getVideoType(video) === activeFilter);
  }, [activeFilter, videos]);

  const featuredVideo = videos[0];

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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0b1624_0%,#050505_45%,#020202_100%)] text-white">
      <Navbar />

      <section className="mx-auto w-full max-w-[1500px] px-8 py-10">
        <header className="overflow-hidden rounded-[32px] border border-white/10 bg-zinc-950/80 shadow-xl">
          <div className="relative p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.2),transparent_36%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.14),transparent_32%)]" />
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.04),transparent_35%,rgba(255,255,255,0.02))]" />

            <div className="relative z-10 flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
                  Conteúdo
                </p>

                <h1 className="mt-3 text-5xl font-black text-white">
                  Conteúdos da Jornada
                </h1>

                <p className="mt-3 max-w-[760px] text-sm leading-relaxed text-white/50">
                  Últimos vídeos do canal {channelTitle}. Essa página puxa
                  automaticamente os conteúdos públicos do YouTube e atualiza
                  conforme novos vídeos forem publicados.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard
                  label="Total"
                  value={isLoading ? "..." : videos.length}
                />

                <StatCard
                  label="Vídeos"
                  value={isLoading ? "..." : totalVideos}
                  accent="blue"
                />

                <StatCard
                  label="Lives"
                  value={isLoading ? "..." : totalLives}
                  accent="red"
                />

                <StatCard
                  label="Shorts"
                  value={isLoading ? "..." : totalShorts}
                  accent="purple"
                />
              </div>
            </div>
          </div>
        </header>

        <section className="mt-8">
          <div className="flex flex-wrap gap-3">
            {filters.map((filter) => {
              const isActive = activeFilter === filter.value;

              return (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setActiveFilter(filter.value)}
                  className={`rounded-xl border px-5 py-3 text-sm font-black transition ${
                    isActive
                      ? "border-red-500/45 bg-red-500/15 text-red-100 shadow-[0_0_24px_rgba(239,68,68,0.12)]"
                      : "border-white/10 bg-white/[0.03] text-white/60 hover:border-red-500/30 hover:bg-red-500/10 hover:text-white"
                  }`}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
        </section>

        {featuredVideo && activeFilter === "all" ? (
          <section className="mt-8">
            <FeaturedVideo video={featuredVideo} />
          </section>
        ) : null}

        <section className="mt-8">
          {isLoading ? (
            <div className="rounded-[24px] border border-white/10 bg-zinc-950/80 p-8 text-white/50">
              Carregando vídeos do YouTube...
            </div>
          ) : filteredVideos.length === 0 ? (
            <EmptyState error={error} />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-8">
              {filteredVideos.map((video) => (
                <VideoCard key={video.id} video={video} />
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
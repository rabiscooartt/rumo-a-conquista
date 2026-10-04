"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
  const [requestedEpisode, setRequestedEpisode] = useState("");
  const [journeyStartRequested, setJourneyStartRequested] = useState(false);
  const [journeyGameTitle, setJourneyGameTitle] = useState("");
  const [journeyError, setJourneyError] = useState("");

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
    const byType =
      activeFilter === "all"
        ? videos
        : videos.filter((video) => getVideoType(video) === activeFilter);

    if (!requestedEpisode) {
      return byType;
    }

    return byType.filter((video) => matchesEpisode(video, requestedEpisode));
  }, [activeFilter, requestedEpisode, videos]);

  const featuredVideo = videos[0];

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

      <div className="mx-auto grid w-full max-w-[1620px] grid-cols-1 lg:grid-cols-[290px_minmax(0,1fr)] xl:grid-cols-[290px_minmax(0,1fr)_290px]">
        {/* SIDEBAR ESQUERDA — estrutura-base da V2 */}
        <aside className="hidden min-h-[calc(100vh-74px)] border-r border-white/[0.10] px-4 py-5 lg:block">
          <div className="sticky top-20 flex min-h-[calc(100vh-94px)] flex-col">
            <div>
              <div className="border-b border-white/[0.08] pb-4 pt-2">
                <div className="flex items-center gap-2 text-[12px] font-black uppercase tracking-[0.12em] text-white/75">
                  <span className="text-red-400">▶</span>
                  Conteúdo
                </div>
              </div>

              <div className="mt-6 border-b border-white/[0.08] pb-6">
                <div className="flex items-center gap-2">
                  <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
                  <h2 className="text-[12px] font-black uppercase tracking-[0.12em] text-white">
                    FILTRO
                  </h2>
                </div>

                <div className="mt-3 space-y-1.5">
                  {filters.map((filter) => {
                    const isActive = activeFilter === filter.value;

                    return (
                      <button
                        key={filter.value}
                        type="button"
                        onClick={() => setActiveFilter(filter.value)}
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[10px] font-black transition ${
                          isActive
                            ? "border border-red-500/30 bg-red-500/10 text-red-300"
                            : "border border-transparent text-white/45 hover:bg-white/[0.04] hover:text-white"
                        }`}
                      >
                        <span>{filter.label}</span>
                        <span className="text-[9px] text-white/25">
                          {filter.value === "all"
                            ? videos.length
                            : filter.value === "video"
                            ? totalVideos
                            : filter.value === "live"
                            ? totalLives
                            : totalShorts}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-6">
                <div className="flex items-center gap-2">
                  <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
                  <h2 className="text-[12px] font-black uppercase tracking-[0.12em] text-white">
                    JORNADA
                  </h2>
                </div>

                <div className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.15em] text-white/30">
                    {journeyStartRequested ? "Início da Jornada" : requestedEpisode ? "Episódio selecionado" : "Conteúdo geral"}
                  </p>

                  <p className="mt-1.5 text-[12px] font-black leading-tight text-white">
                    {journeyStartRequested
                      ? journeyGameTitle || "Jornada de Estreia"
                      : requestedEpisode
                      ? `EP ${requestedEpisode}`
                      : "Todos os conteúdos"}
                  </p>

                  {journeyStartRequested && requestedEpisode ? (
                    <p className="mt-1 text-[9px] font-bold text-emerald-300/80">
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
            <div
              className="absolute inset-0 bg-cover bg-right-center bg-no-repeat"
              style={{ backgroundImage: "url('/images/content-banner-bg.png')" }}
            />
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

              <div className="absolute bottom-8 left-7 right-7 grid grid-cols-2 gap-y-3 sm:grid-cols-4 sm:gap-y-0">
                <div className="min-w-0 pr-3">
                  <p className="text-[8px] font-black uppercase tracking-[0.18em] text-white/35">
                    Total
                  </p>
                  <p className="mt-1 text-[23px] font-black leading-none text-white">
                    {isLoading ? "..." : videos.length}
                  </p>
                  <p className="mt-1 text-[9px] font-medium text-white/40">
                    conteúdos
                  </p>
                </div>

                <div className="min-w-0 border-l border-white/[0.10] px-3">
                  <p className="text-[8px] font-black uppercase tracking-[0.18em] text-white/35">
                    Vídeos
                  </p>
                  <p className="mt-1 text-[23px] font-black leading-none text-blue-300">
                    {isLoading ? "..." : totalVideos}
                  </p>
                  <p className="mt-1 text-[9px] font-medium text-white/40">
                    vídeos
                  </p>
                </div>

                <div className="min-w-0 border-l border-white/[0.10] px-3">
                  <p className="text-[8px] font-black uppercase tracking-[0.18em] text-white/35">
                    Lives
                  </p>
                  <p className="mt-1 text-[23px] font-black leading-none text-red-300">
                    {isLoading ? "..." : totalLives}
                  </p>
                  <p className="mt-1 text-[9px] font-medium text-white/40">
                    transmissões
                  </p>
                </div>

                <div className="min-w-0 border-l border-white/[0.10] pl-3">
                  <p className="text-[8px] font-black uppercase tracking-[0.18em] text-white/35">
                    Shorts
                  </p>
                  <p className="mt-1 text-[23px] font-black leading-none text-purple-300">
                    {isLoading ? "..." : totalShorts}
                  </p>
                  <p className="mt-1 text-[9px] font-medium text-white/40">
                    shorts
                  </p>
                </div>
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
            <section className="mt-4 rounded-[14px] border border-emerald-400/20 bg-emerald-400/[.05] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[.2em] text-emerald-300">
                    Jornada de Estreia
                  </p>
                  <p className="mt-1 text-sm font-black text-white">
                    Início da Jornada{journeyGameTitle ? " · " + journeyGameTitle : ""}{requestedEpisode ? " · EP " + requestedEpisode : ""}
                  </p>
                  {journeyError ? (
                    <p className="mt-1 text-[10px] font-bold text-yellow-200/70">
                      {journeyError}
                    </p>
                  ) : (
                    <p className="mt-1 text-[10px] text-white/35">
                      O conteúdo do episódio de início da Jornada aparece abaixo.
                    </p>
                  )}
                </div>
                <Link
                  href="/conteudo"
                  className="rounded-lg border border-white/10 bg-white/[.03] px-3 py-2 text-[10px] font-black uppercase text-white/60 transition hover:bg-white/[.06] hover:text-white"
                >
                  Voltar
                </Link>
              </div>
            </section>
          ) : requestedEpisode ? (
            <section className="mt-4 rounded-[14px] border border-blue-400/20 bg-blue-500/[0.06] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[.2em] text-blue-300">
                    Episódio selecionado
                  </p>
                  <p className="mt-1 text-sm font-black text-white">
                    EP {requestedEpisode}
                  </p>
                </div>
                <Link
                  href="/conteudo"
                  className="rounded-lg border border-white/10 bg-white/[.03] px-3 py-2 text-[10px] font-black uppercase text-white/60 transition hover:bg-white/[.06] hover:text-white"
                >
                  Limpar filtro
                </Link>
              </div>
            </section>
          ) : null}

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
          ) : featuredVideo && activeFilter === "all" ? (
            <section className="mt-3">
              <FeaturedVideo video={featuredVideo} />
            </section>
          ) : null}

          <section className="mt-3">
            {isLoading ? (
              <div className="rounded-[14px] border border-white/10 bg-[#090b0f] p-8 text-white/50">
                Carregando vídeos do YouTube...
              </div>
            ) : filteredVideos.length === 0 ? (
              <EmptyState error={error} />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {filteredVideos.map((video) => (
                  <VideoCard key={video.id} video={video} />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* SIDEBAR DIREITA — área auxiliar da V2 */}
        <aside className="hidden px-4 py-5 xl:block">
          <div className="sticky top-20 space-y-3">
            <section className="rounded-[12px] border border-white/[0.10] bg-[#090b0f] p-3.5">
              <div className="mb-3 flex items-center gap-2 px-1">
                <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
                <h2 className="text-[13px] font-black uppercase tracking-[0.08em] leading-none text-white">
                  RESUMO
                </h2>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                  <p className="text-[8px] font-black uppercase tracking-[0.12em] text-white/30">Total</p>
                  <p className="mt-1 text-xl font-black text-white">{isLoading ? "..." : videos.length}</p>
                </div>
                <div className="rounded-xl border border-red-500/[0.12] bg-red-500/[0.05] p-3">
                  <p className="text-[8px] font-black uppercase tracking-[0.12em] text-white/30">Lives</p>
                  <p className="mt-1 text-xl font-black text-red-300">{isLoading ? "..." : totalLives}</p>
                </div>
                <div className="rounded-xl border border-blue-500/[0.12] bg-blue-500/[0.05] p-3">
                  <p className="text-[8px] font-black uppercase tracking-[0.12em] text-white/30">Vídeos</p>
                  <p className="mt-1 text-xl font-black text-blue-300">{isLoading ? "..." : totalVideos}</p>
                </div>
                <div className="rounded-xl border border-purple-500/[0.12] bg-purple-500/[0.05] p-3">
                  <p className="text-[8px] font-black uppercase tracking-[0.12em] text-white/30">Shorts</p>
                  <p className="mt-1 text-xl font-black text-purple-300">{isLoading ? "..." : totalShorts}</p>
                </div>
              </div>
            </section>

            <section className="rounded-[12px] border border-white/[0.10] bg-[#090b0f] p-3.5">
              <div className="mb-3 flex items-center gap-2 px-1">
                <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
                <h2 className="text-[13px] font-black uppercase tracking-[0.08em] leading-none text-white">
                  CONTEXTO
                </h2>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-[8px] font-black uppercase tracking-[0.12em] text-white/30">
                    Canal
                  </p>
                  <p className="mt-1 truncate text-[11px] font-black text-white">
                    {channelTitle}
                  </p>
                  <p className="mt-0.5 text-[9px] text-white/35">
                    @orabiisco
                  </p>
                </div>

                <div className="border-t border-white/[0.06] pt-3">
                  <p className="text-[8px] font-black uppercase tracking-[0.12em] text-white/30">
                    Seleção atual
                  </p>
                  <p className="mt-1 text-[11px] font-black text-white">
                    {journeyStartRequested
                      ? "Jornada de Estreia"
                      : requestedEpisode
                      ? `EP ${requestedEpisode}`
                      : activeFilter === "all"
                      ? "Todos os conteúdos"
                      : getVideoTypeLabel(activeFilter)}
                  </p>
                </div>

                {journeyStartRequested && requestedEpisode ? (
                  <div className="border-t border-white/[0.06] pt-3">
                    <p className="text-[8px] font-black uppercase tracking-[0.12em] text-white/30">
                      Jogo da Jornada
                    </p>
                    <p className="mt-1 truncate text-[11px] font-black text-emerald-300">
                      {journeyGameTitle || "Jornada de Estreia"}
                    </p>
                    <p className="mt-0.5 text-[9px] text-white/35">
                      Episódio inicial · EP {requestedEpisode}
                    </p>
                  </div>
                ) : null}
              </div>
            </section>

            {featuredVideo ? (
              <section className="rounded-[12px] border border-white/[0.10] bg-[#090b0f] p-3.5">
                <div className="mb-3 flex items-center gap-2 px-1">
                  <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
                  <h2 className="text-[13px] font-black uppercase tracking-[0.08em] leading-none text-white">
                    ÚLTIMO CONTEÚDO
                  </h2>
                </div>

                <a
                  href={featuredVideo.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group block overflow-hidden rounded-xl border border-white/[0.07] bg-black/30"
                >
                  <div className="aspect-video overflow-hidden bg-black">
                    <VideoThumbnail
                      src={featuredVideo.thumbnail}
                      title={featuredVideo.title}
                    />
                  </div>
                  <div className="p-3">
                    <p className="line-clamp-2 text-[11px] font-black leading-tight text-white group-hover:text-red-300">
                      {featuredVideo.title}
                    </p>
                    <p className="mt-2 text-[9px] font-semibold text-white/30">
                      {formatDate(featuredVideo.publishedAt)}
                    </p>
                  </div>
                </a>
              </section>
            ) : null}
          </div>
        </aside>
      </div>
    </main>
  );
}
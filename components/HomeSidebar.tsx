"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { type SiteGame, useSiteGames } from "@/lib/useSiteGames";

type Rank = "Bronze" | "Prata" | "Ouro" | "Diamante";
type AchievementStatus = "locked" | "progress" | "completed";
type BacklogStatus = "next" | "waiting" | "future";

type BacklogItem = {
  id: string;
  slug: string;
  order: number;
  status: BacklogStatus;
};

type SidebarAchievement = {
  id?: string;
  title?: string;
  description?: string;
  trophy?: string;
  icon?: string;
  difficulty?: string;
  rank?: string;
  status?: string;
  earnedDate?: string;
  image?: string;
  isCustom?: boolean;
};

type ManualAchievementState = {
  rank?: Rank;
  status?: AchievementStatus;
  date?: string;
  image?: string;
};

type ReviewData = {
  status?: string;
  nota?: string | number;
  titulo?: string;
  texto?: string;
  resumo?: string;
};

type ContentData = {
  title?: string;
  name?: string;
  description?: string;
  summary?: string;
  date?: string;
  publishedAt?: string;
  href?: string;
  url?: string;
  image?: string;
  thumbnail?: string;
  type?: string;
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

type SidebarGame = Omit<
  SiteGame,
  | "slug"
  | "title"
  | "subtitle"
  | "status"
  | "progress"
  | "hours"
  | "image"
  | "cardImage"
  | "currentObjective"
  | "objective"
  | "nextMission"
  | "achievementsList"
  | "review"
  | "finalBadge"
> & {
  slug?: string;
  title?: string;
  subtitle?: string;
  status?: string;
  progress?: number;
  hours?: string | number;
  image?: string;
  cardImage?: string;
  currentObjective?: string;
  objective?: string;
  nextMission?: string;
  isInBacklog?: boolean;
  backlogOrder?: number;
  backlogStatus?: BacklogStatus;
  order?: number;
  createdAt?: string;
  updatedAt?: string;
  achievementsList?: SidebarAchievement[];
  review?: ReviewData;
  finalBadge?: {
    title?: string;
    icon?: string;
    image?: string;
  };
  latestContent?: ContentData;
  lastContent?: ContentData;
  content?: ContentData;
  latestVideo?: ContentData;
  latestContentUrl?: string;
  latestVideoUrl?: string;
  youtubeUrl?: string;
};

type LatestContentItem = {
  gameTitle: string;
  gameSubtitle: string;
  gameSlug: string;
  title: string;
  description: string;
  date: string;
  href: string;
  image: string;
  type: string;
  isExternal?: boolean;
};

type ReviewItem = {
  slug: string;
  title: string;
  subtitle: string;
  nota: string;
  sortOrder: number;
};

type ActivityItem = {
  id: string;
  href: string;
  label: string;
  title: string;
  gameTitle: string;
  subtitle: string;
  icon: string;
  image: string;
  date: string;
  rank: Rank;
  type: "achievement" | "mastery";
  sortOrder: number;
};

const BACKLOG_STORAGE_KEY = "rumo-a-conquista-backlog";

const GAMES_UPDATED_EVENT = "rumo-a-conquista-games-updated";
const REVIEW_UPDATED_EVENT = "rumo-a-conquista-review-updated";
const ACHIEVEMENTS_UPDATED_EVENT = "rumo-a-conquista-achievements-updated";
const BACKLOG_UPDATED_EVENT = "rumo-a-conquista-backlog-updated";

const statusTheme: Record<
  BacklogStatus,
  {
    label: string;
    className: string;
  }
> = {
  next: {
    label: "Próximo",
    className: "border-red-500/30 bg-red-500/10 text-red-300",
  },
  waiting: {
    label: "Espera",
    className: "border-yellow-400/30 bg-yellow-500/10 text-yellow-200",
  },
  future: {
    label: "Futuro",
    className: "border-cyan-400/30 bg-cyan-500/10 text-cyan-200",
  },
};

const rankIcon: Record<Rank, string> = {
  Bronze: "🥉",
  Prata: "🥈",
  Ouro: "🥇",
  Diamante: "💎",
};

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readText(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function readNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return numberValue;
}

function normalizeText(text?: string) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeDate(date?: string) {
  if (!date) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }

  const isoDate = new Date(date);

  if (!Number.isNaN(isoDate.getTime())) {
    return isoDate.toISOString().slice(0, 10);
  }

  const [day, month, year] = date.split("/");

  if (!day || !month || !year) {
    return "";
  }

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function formatDate(date?: string) {
  if (!date) return "";

  const normalizedDate = normalizeDate(date);

  if (!normalizedDate) return date;

  const [year, month, day] = normalizedDate.split("-");

  return `${day}/${month}/${year}`;
}

function isExternalUrl(url: string) {
  return url.startsWith("http://") || url.startsWith("https://");
}

function readLocalJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;

  const savedData = localStorage.getItem(key);

  if (!savedData) return fallback;

  try {
    return JSON.parse(savedData) as T;
  } catch {
    return fallback;
  }
}

function normalizeGameStatus(status?: string) {
  const normalized = normalizeText(status);

  if (
    normalized === "completed" ||
    normalized === "finalizado" ||
    normalized === "concluido" ||
    normalized === "concluida"
  ) {
    return "completed";
  }

  if (
    normalized === "planned" ||
    normalized === "planejado" ||
    normalized === "backlog" ||
    normalized === "future" ||
    normalized === "futuro"
  ) {
    return "planned";
  }

  if (
    normalized === "progress" ||
    normalized === "emprogresso" ||
    normalized === "emandamento" ||
    normalized === "jogando"
  ) {
    return "progress";
  }

  return normalized || "unknown";
}

function normalizeAchievementStatus(status?: string): AchievementStatus {
  const normalized = normalizeText(status);

  if (
    normalized === "completed" ||
    normalized === "concluido" ||
    normalized === "concluida" ||
    normalized === "desbloqueado" ||
    normalized === "desbloqueada"
  ) {
    return "completed";
  }

  if (
    normalized === "progress" ||
    normalized === "emprogresso" ||
    normalized === "emandamento"
  ) {
    return "progress";
  }

  return "locked";
}

function normalizeReviewStatus(status?: string) {
  const normalized = normalizeText(status);

  if (
    normalized === "liberada" ||
    normalized === "reviewliberada" ||
    normalized === "completed" ||
    normalized === "concluida" ||
    normalized === "concluido"
  ) {
    return "liberada";
  }

  if (
    normalized === "emandamento" ||
    normalized === "progress" ||
    normalized === "emprogresso"
  ) {
    return "em-andamento";
  }

  return "bloqueada";
}

function isCompletedGame(game: SidebarGame) {
  const status = normalizeGameStatus(game.status);
  const progress = readNumber(game.progress, 0);

  return status === "completed" || progress >= 100;
}

function isBacklogGame(game: SidebarGame) {
  const status = normalizeGameStatus(game.status);

  return (
    Boolean(game.isInBacklog) ||
    status === "planned" ||
    status === "backlog" ||
    status === "future" ||
    status === "futuro"
  );
}

function getGameRecencyValue(
  game: SidebarGame,
  gameIndex: number,
  totalGames: number
) {
  const updatedAt = readText(game.updatedAt, "");
  const createdAt = readText(game.createdAt, "");

  const updatedTime = updatedAt ? new Date(updatedAt).getTime() : 0;
  const createdTime = createdAt ? new Date(createdAt).getTime() : 0;

  if (Number.isFinite(updatedTime) && updatedTime > 0) {
    return updatedTime;
  }

  if (Number.isFinite(createdTime) && createdTime > 0) {
    return createdTime;
  }

  return totalGames - gameIndex;
}

function getBacklogStatus(
  game: SidebarGame,
  savedItem?: BacklogItem
): BacklogStatus {
  if (savedItem?.status) {
    return savedItem.status;
  }

  if (
    game.backlogStatus === "next" ||
    game.backlogStatus === "waiting" ||
    game.backlogStatus === "future"
  ) {
    return game.backlogStatus;
  }

  return "future";
}

function getBacklogOrder(
  game: SidebarGame,
  savedItem?: BacklogItem,
  index = 0
) {
  if (typeof savedItem?.order === "number") {
    return savedItem.order;
  }

  if (typeof game.backlogOrder === "number") {
    return game.backlogOrder;
  }

  if (typeof game.order === "number") {
    return game.order;
  }

  return index + 1;
}

function normalizeBacklogItem(item: Partial<BacklogItem>, index: number) {
  return {
    id: item.id ?? createId(),
    slug: item.slug ?? "",
    order: Number(item.order ?? index + 1),
    status: item.status ?? "future",
  } as BacklogItem;
}

function sortBacklog(items: BacklogItem[]) {
  return [...items].sort((a, b) => {
    if (a.order !== b.order) {
      return a.order - b.order;
    }

    const statusOrder: Record<BacklogStatus, number> = {
      next: 1,
      waiting: 2,
      future: 3,
    };

    return statusOrder[a.status] - statusOrder[b.status];
  });
}

function getDefaultRank(achievement: SidebarAchievement): Rank {
  const difficulty = normalizeText(
    readText(achievement.difficulty, readText(achievement.rank, ""))
  );

  const trophy = readText(achievement.trophy || achievement.icon, "");

  if (difficulty === "extrema" || difficulty === "diamante") return "Diamante";
  if (difficulty === "dificil" || difficulty === "ouro") return "Ouro";
  if (difficulty === "media" || difficulty === "prata") return "Prata";

  if (trophy.includes("💎")) return "Diamante";
  if (trophy.includes("🥇") || trophy.includes("🏆")) return "Ouro";
  if (trophy.includes("🥈")) return "Prata";

  return "Bronze";
}

function isMasteryAchievement(achievement: SidebarAchievement, rank: Rank) {
  const title = normalizeText(readText(achievement.title, ""));

  return (
    rank === "Diamante" ||
    title.includes("maestria") ||
    title.includes("mastery")
  );
}

function getAchievementDefaultState(achievement: SidebarAchievement) {
  return {
    rank: getDefaultRank(achievement),
    status: normalizeAchievementStatus(achievement.status),
    date: normalizeDate(achievement.earnedDate),
    image: readText(achievement.image, ""),
  } as ManualAchievementState;
}

function getGameAchievementStates(game: SidebarGame) {
  const achievements = Array.isArray(game.achievementsList)
    ? game.achievementsList
    : [];

  const defaultStates = achievements.reduce<
    Record<string, ManualAchievementState>
  >((acc, achievement) => {
    const title = readText(achievement.title, "");

    if (!title) return acc;

    acc[title] = getAchievementDefaultState(achievement);
    return acc;
  }, {});

  const slug = readText(game.slug, "");

  const savedStates = slug
    ? readLocalJson<Record<string, ManualAchievementState>>(
        `rumo-a-conquista-achievements-${slug}`,
        {}
      )
    : {};

  return {
    ...defaultStates,
    ...savedStates,
  };
}

function getVisibleAchievements(game: SidebarGame) {
  const slug = readText(game.slug, "");

  const baseAchievements = Array.isArray(game.achievementsList)
    ? game.achievementsList
    : [];

  const hiddenAchievementTitles = slug
    ? readLocalJson<string[]>(
        `rumo-a-conquista-hidden-achievements-${slug}`,
        []
      )
    : [];

  const customAchievements = slug
    ? readLocalJson<SidebarAchievement[]>(
        `rumo-a-conquista-custom-achievements-${slug}`,
        []
      )
    : [];

  const visibleBaseAchievements = baseAchievements.filter((achievement) => {
    const title = readText(achievement.title, "");
    return title && !hiddenAchievementTitles.includes(title);
  });

  const visibleCustomAchievements = customAchievements.filter((achievement) => {
    const title = readText(achievement.title, "");
    return title && !hiddenAchievementTitles.includes(title);
  });

  return [...visibleBaseAchievements, ...visibleCustomAchievements];
}

function getMergedReview(game: SidebarGame) {
  const slug = readText(game.slug, "");

  const localReview = slug
    ? readLocalJson<ReviewData | null>(`rumo-a-conquista-review-${slug}`, null)
    : null;

  return {
    ...(game.review ?? {}),
    ...(localReview ?? {}),
  } as ReviewData;
}

function getReviewScore(game: SidebarGame) {
  const review = getMergedReview(game);
  return readText(review.nota, "");
}

function isReviewReleased(game: SidebarGame) {
  const review = getMergedReview(game);
  const status = normalizeReviewStatus(review.status);
  const score = readText(review.nota, "");

  return status === "liberada" || score.trim() !== "";
}

function getYoutubeVideoType(video: YouTubeVideo) {
  const text = normalizeText(`${video.title} ${video.description}`);

  if (
    text.includes("live") ||
    text.includes("aovivo") ||
    text.includes("twitch")
  ) {
    return "Live";
  }

  if (
    text.includes("short") ||
    text.includes("shorts") ||
    text.includes("reels") ||
    text.includes("tiktok")
  ) {
    return "Short";
  }

  return "Vídeo";
}

function convertYoutubeVideoToLatestContent(
  video: YouTubeVideo
): LatestContentItem {
  return {
    gameTitle: "YouTube",
    gameSubtitle: "@orabiisco",
    gameSlug: "",
    title: video.title,
    description: video.description || "Último vídeo publicado no canal.",
    date: video.publishedAt,
    href: video.url,
    image: video.thumbnail,
    type: getYoutubeVideoType(video),
    isExternal: true,
  };
}

function getLatestContentFromGame(game: SidebarGame): LatestContentItem | null {
  const rawContent =
    game.latestContent ?? game.lastContent ?? game.content ?? game.latestVideo;

  const content =
    rawContent && typeof rawContent === "object"
      ? (rawContent as ContentData)
      : null;

  const externalUrl =
    readText(game.latestContentUrl, "") ||
    readText(game.latestVideoUrl, "") ||
    readText(game.youtubeUrl, "");

  if (!content && !externalUrl) {
    return null;
  }

  const gameSlug = readText(game.slug, "");
  const gameTitle = readText(game.title, "Jogo");

  const title =
    readText(content?.title, "") ||
    readText(content?.name, "") ||
    `Último conteúdo de ${gameTitle}`;

  const description =
    readText(content?.description, "") ||
    readText(content?.summary, "") ||
    "Último conteúdo cadastrado para esta jornada.";

  const href =
    readText(content?.href, "") ||
    readText(content?.url, "") ||
    externalUrl ||
    `/games/${gameSlug}`;

  return {
    gameTitle,
    gameSubtitle: readText(game.subtitle, ""),
    gameSlug,
    title,
    description,
    date:
      readText(content?.date, "") ||
      readText(content?.publishedAt, "") ||
      "Sem data",
    href,
    image:
      readText(content?.image, "") ||
      readText(content?.thumbnail, "") ||
      readText(game.cardImage, "") ||
      readText(game.image, ""),
    type: readText(content?.type, "Conteúdo"),
    isExternal: isExternalUrl(href),
  };
}

function getActivityItems(games: SidebarGame[]) {
  const activities: ActivityItem[] = [];
  const totalGames = games.length;

  games.forEach((game, gameIndex) => {
    const slug = readText(game.slug, "");
    const gameTitle = readText(game.title, "Jogo");
    const gameSubtitle = readText(game.subtitle, "");

    if (!slug) return;

    const gameRecency = getGameRecencyValue(game, gameIndex, totalGames);
    const achievements = getVisibleAchievements(game);
    const states = getGameAchievementStates(game);

    let hasCompletedMasteryAchievement = false;
    let completedAchievementIndex = 0;

    achievements.forEach((achievement) => {
      const achievementTitle = readText(achievement.title, "");

      if (!achievementTitle) return;

      const state =
        states[achievementTitle] ?? getAchievementDefaultState(achievement);

      if (state.status !== "completed") {
        return;
      }

      const rank = state.rank ?? getDefaultRank(achievement);
      const isMastery = isMasteryAchievement(achievement, rank);

      if (isMastery) {
        hasCompletedMasteryAchievement = true;
      }

      const type: ActivityItem["type"] = isMastery ? "mastery" : "achievement";

      const activityPriority = isMastery
        ? 9000
        : 6000 - completedAchievementIndex;

      activities.push({
        id: `${slug}-${type}-${readText(achievement.id, achievementTitle)}`,
        href: `/games/${slug}`,
        label: isMastery ? "Última maestria" : "Último troféu",
        title: achievementTitle,
        gameTitle,
        subtitle: gameSubtitle,
        icon:
          readText(achievement.trophy, "") ||
          readText(achievement.icon, "") ||
          rankIcon[rank],
        image: readText(state.image, "") || readText(achievement.image, ""),
        date: readText(state.date, "") || normalizeDate(achievement.earnedDate),
        rank,
        type,
        sortOrder: gameRecency * 10000 + activityPriority,
      });

      completedAchievementIndex += 1;
    });

    if (isCompletedGame(game) && !hasCompletedMasteryAchievement) {
      activities.push({
        id: `mastery-${slug}`,
        href: `/games/${slug}`,
        label: "Última maestria",
        title: readText(game.finalBadge?.title, "Maestria Final"),
        gameTitle,
        subtitle: gameSubtitle,
        icon: readText(game.finalBadge?.icon, "💎"),
        image: readText(game.finalBadge?.image, ""),
        date: "",
        rank: "Diamante",
        type: "mastery",
        sortOrder: gameRecency * 10000 + 9000,
      });
    }
  });

  return activities.sort((a, b) => {
    if (b.sortOrder !== a.sortOrder) {
      return b.sortOrder - a.sortOrder;
    }

    const dateA = normalizeDate(a.date);
    const dateB = normalizeDate(b.date);

    if (dateA && dateB) {
      return dateB.localeCompare(dateA);
    }

    return a.title.localeCompare(b.title);
  });
}

function ActivityIcon({ image, icon }: { image?: string; icon: string }) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [image]);

  if (image && !hasError) {
    return (
      <img
        src={image}
        alt=""
        className="h-full w-full object-cover"
        onError={() => setHasError(true)}
      />
    );
  }

  return <span>{icon}</span>;
}

function LatestContentCard({ content }: { content: LatestContentItem }) {
  const card = (
    <div className="group mt-5 block rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-red-500/35 hover:bg-red-500/10">
      <div className="relative aspect-video overflow-hidden rounded-xl border border-white/10 bg-black/40">
        {content.image ? (
          <img
            src={content.image}
            alt={content.title}
            className="h-full w-full object-cover opacity-85 transition group-hover:scale-105 group-hover:opacity-100"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-red-950/70 to-zinc-950 text-sm font-black text-white/35">
            Sem thumbnail
          </div>
        )}

        <div className="absolute left-3 top-3 rounded-full border border-red-400/30 bg-red-500/25 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-red-100">
          {content.type}
        </div>

        <div className="absolute right-3 top-3 rounded-full border border-white/10 bg-black/55 px-3 py-1 text-[10px] font-black text-white/70">
          {formatDate(content.date) || "Sem data"}
        </div>
      </div>

      <p className="mt-4 text-[11px] font-black text-blue-300">
        {content.gameTitle}
        {content.gameSubtitle ? (
          <span className="text-white/35"> · {content.gameSubtitle}</span>
        ) : null}
      </p>

      <h3 className="mt-1 line-clamp-2 text-base font-black leading-tight text-white">
        {content.title}
      </h3>

      <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-white/45">
        {content.description}
      </p>
    </div>
  );

  if (content.isExternal) {
    return (
      <a href={content.href} target="_blank" rel="noreferrer">
        {card}
      </a>
    );
  }

  return <Link href={content.href}>{card}</Link>;
}

export default function HomeSidebar() {
  const { gamesList, isLoaded } = useSiteGames();

  const [storedBacklog, setStoredBacklog] = useState<Record<string, BacklogItem>>(
    {}
  );

  const [refreshKey, setRefreshKey] = useState(0);
  const [youtubeLatestContent, setYoutubeLatestContent] =
    useState<LatestContentItem | null>(null);
  const [isYoutubeContentLoading, setIsYoutubeContentLoading] = useState(true);

  const sidebarGames = useMemo(() => {
    return (gamesList || []) as unknown as SidebarGame[];
  }, [gamesList]);

  const gamesBySlug = useMemo(() => {
    return sidebarGames.reduce<Record<string, SidebarGame>>((acc, game) => {
      const slug = readText(game.slug, "");

      if (slug) {
        acc[slug] = game;
      }

      return acc;
    }, {});
  }, [sidebarGames]);

  useEffect(() => {
    function refreshSidebar() {
      const savedBacklog = readLocalJson<Partial<BacklogItem>[]>(
        BACKLOG_STORAGE_KEY,
        []
      );

      const normalizedBacklog = savedBacklog
        .map((item, index) => normalizeBacklogItem(item, index))
        .filter((item) => item.slug);

      const backlogMap = normalizedBacklog.reduce<Record<string, BacklogItem>>(
        (acc, item) => {
          acc[item.slug] = item;
          return acc;
        },
        {}
      );

      setStoredBacklog(backlogMap);
      setRefreshKey((current) => current + 1);
    }

    refreshSidebar();

    window.addEventListener(GAMES_UPDATED_EVENT, refreshSidebar);
    window.addEventListener(REVIEW_UPDATED_EVENT, refreshSidebar);
    window.addEventListener(ACHIEVEMENTS_UPDATED_EVENT, refreshSidebar);
    window.addEventListener(BACKLOG_UPDATED_EVENT, refreshSidebar);
    window.addEventListener("storage", refreshSidebar);
    window.addEventListener("focus", refreshSidebar);

    return () => {
      window.removeEventListener(GAMES_UPDATED_EVENT, refreshSidebar);
      window.removeEventListener(REVIEW_UPDATED_EVENT, refreshSidebar);
      window.removeEventListener(ACHIEVEMENTS_UPDATED_EVENT, refreshSidebar);
      window.removeEventListener(BACKLOG_UPDATED_EVENT, refreshSidebar);
      window.removeEventListener("storage", refreshSidebar);
      window.removeEventListener("focus", refreshSidebar);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadLatestYoutubeContent() {
      try {
        setIsYoutubeContentLoading(true);

        const response = await fetch(
          "/api/youtube/channel?handle=@orabiisco&maxResults=1",
          {
            signal: controller.signal,
          }
        );

        const data = (await response.json()) as YouTubeChannelResponse;

        if (!response.ok) {
          throw new Error(data.error || "Erro ao buscar último vídeo.");
        }

        const latestVideo = data.videos?.[0];

        if (!latestVideo) {
          setYoutubeLatestContent(null);
          return;
        }

        setYoutubeLatestContent(convertYoutubeVideoToLatestContent(latestVideo));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setYoutubeLatestContent(null);
      } finally {
        setIsYoutubeContentLoading(false);
      }
    }

    loadLatestYoutubeContent();

    return () => {
      controller.abort();
    };
  }, []);

  const visibleBacklogItems = useMemo(() => {
    const backlogMap = new Map<string, BacklogItem>();

    Object.values(storedBacklog).forEach((item) => {
      const game = gamesBySlug[item.slug];

      if (!game) {
        return;
      }

      backlogMap.set(item.slug, {
        ...item,
        status: getBacklogStatus(game, item),
        order: getBacklogOrder(game, item),
      });
    });

    sidebarGames.forEach((game, index) => {
      const slug = readText(game.slug, "");

      if (!slug || !isBacklogGame(game)) {
        return;
      }

      const savedItem = storedBacklog[slug];

      backlogMap.set(slug, {
        id: savedItem?.id ?? `auto-${slug}`,
        slug,
        order: getBacklogOrder(game, savedItem, index),
        status: getBacklogStatus(game, savedItem),
      });
    });

    return sortBacklog(Array.from(backlogMap.values())).slice(0, 3);
  }, [gamesBySlug, sidebarGames, storedBacklog, refreshKey]);

  const manualLatestContent = useMemo(() => {
    return sidebarGames
      .map((game) => getLatestContentFromGame(game))
      .filter((content): content is LatestContentItem => Boolean(content))
      .sort((a, b) => {
        const dateA = normalizeDate(a.date);
        const dateB = normalizeDate(b.date);

        if (dateA && dateB) {
          return dateB.localeCompare(dateA);
        }

        if (dateA) return -1;
        if (dateB) return 1;

        return 0;
      })[0];
  }, [sidebarGames, refreshKey]);

  const latestContent = youtubeLatestContent ?? manualLatestContent;

  const releasedReviews = useMemo(() => {
    return sidebarGames
      .map<ReviewItem | null>((game, gameIndex) => {
        if (!isReviewReleased(game)) {
          return null;
        }

        const slug = readText(game.slug, "");
        const nota = getReviewScore(game);

        if (!slug || !nota.trim()) {
          return null;
        }

        return {
          slug,
          title: readText(game.title, "Jogo"),
          subtitle: readText(game.subtitle, ""),
          nota,
          sortOrder: getGameRecencyValue(game, gameIndex, sidebarGames.length),
        };
      })
      .filter((review): review is ReviewItem => Boolean(review))
      .sort((a, b) => b.sortOrder - a.sortOrder)
      .slice(0, 3);
  }, [sidebarGames, refreshKey]);

  const recentActivities = useMemo(() => {
    return getActivityItems(sidebarGames).slice(0, 3);
  }, [sidebarGames, refreshKey]);

  if (!isLoaded) {
    return (
      <aside className="space-y-6">
        <section className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5 text-sm text-white/45 shadow-xl">
          Carregando lateral...
        </section>
      </aside>
    );
  }

  return (
    <aside className="space-y-6">
      <section className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
             Fila
            </p>

            <h2 className="mt-2 text-2xl font-black text-white">
              Próximas Maestrias
            </h2>
          </div>

          <Link
            href="/backlog"
            className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] font-black text-white/45 transition hover:border-red-500/35 hover:bg-red-500/10 hover:text-red-200"
          >
            Ver fila
          </Link>
        </div>

        <div className="mt-5 grid gap-3">
          {visibleBacklogItems.length > 0 ? (
            visibleBacklogItems.map((item) => {
              const game = gamesBySlug[item.slug];
              const theme = statusTheme[item.status];

              return (
                <Link
                  key={item.id}
                  href={`/games/${item.slug}`}
                  className="group flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-red-500/35 hover:bg-red-500/10"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 text-sm font-black text-red-300">
                    {String(item.order).padStart(2, "0")}
                  </span>

                  <div className="min-w-0 flex-1">
                    <span className="line-clamp-1 text-sm font-black text-white/85 transition group-hover:text-white">
                      {game?.title ?? item.slug}
                    </span>

                    <p className="mt-1 line-clamp-1 text-xs text-blue-300">
                      {game?.subtitle ?? "Jogo cadastrado"}
                    </p>
                  </div>

                  <span
                    className={`shrink-0 rounded-lg border px-2 py-1 text-[9px] font-black uppercase tracking-[0.14em] ${theme.className}`}
                  >
                    {theme.label}
                  </span>
                </Link>
              );
            })
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/40">
              Nenhum jogo no backlog ainda.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5 shadow-xl">
        <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
          Conteúdo
        </p>

        <h2 className="mt-2 text-2xl font-black text-white">
          Último Conteúdo
        </h2>

        {isYoutubeContentLoading && !latestContent ? (
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-relaxed text-white/40">
            Carregando último vídeo...
          </div>
        ) : latestContent ? (
          <LatestContentCard content={latestContent} />
        ) : (
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-relaxed text-white/40">
            Nenhum conteúdo encontrado ainda.
          </div>
        )}
      </section>

      <section className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5 shadow-xl">
        <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
          Reviews
        </p>

        <h2 className="mt-2 text-2xl font-black text-white">
          Reviews Liberadas
        </h2>

        <div className="mt-5 grid gap-3">
          {releasedReviews.length > 0 ? (
            releasedReviews.map((review) => (
              <Link
                key={review.slug}
                href={`/games/${review.slug}?review=1#review-section`}
                className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-red-500/35 hover:bg-red-500/10"
              >
                <div className="min-w-0">
                  <h3 className="line-clamp-1 text-sm font-black text-white">
                    {review.title}
                  </h3>

                  <p className="mt-1 line-clamp-1 text-xs text-white/40">
                    Review completa
                  </p>
                </div>

                <div className="shrink-0 rounded-xl border border-red-500/35 bg-red-500/15 px-4 py-2 text-sm font-black text-red-100">
                  {review.nota}
                </div>
              </Link>
            ))
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/40">
              Nenhuma review liberada ainda.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5 shadow-xl">
        <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
          Atividade
        </p>

        <h2 className="mt-2 text-2xl font-black text-white">Recente</h2>

        <div className="mt-5 grid gap-3">
          {recentActivities.length > 0 ? (
            recentActivities.map((activity) => (
              <Link
                key={activity.id}
                href={activity.href}
                className="group flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-red-500/35 hover:bg-red-500/10"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/35 text-xl">
                  <ActivityIcon image={activity.image} icon={activity.icon} />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-red-300">
                    {activity.label}
                  </p>

                  <h3 className="mt-1 line-clamp-1 text-sm font-black text-white">
                    {activity.title}
                  </h3>

                  <p className="mt-1 line-clamp-1 text-xs text-blue-300">
                    {activity.gameTitle}
                    {activity.subtitle ? (
                      <span className="text-white/35">
                        {" "}
                        · {activity.subtitle}
                      </span>
                    ) : null}
                  </p>
                </div>

                {activity.date ? (
                  <span className="shrink-0 text-[10px] font-bold text-white/35">
                    {formatDate(activity.date)}
                  </span>
                ) : null}
              </Link>
            ))
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/40">
              Nenhuma atividade recente ainda.
            </div>
          )}
        </div>
      </section>
    </aside>
  );
}
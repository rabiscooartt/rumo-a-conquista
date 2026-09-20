"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { useJourneyEntries } from "@/lib/useJourneyEntries";
import GameAchievementsPanel, {
  type AchievementInput,
  type ManualAchievementState,
} from "@/components/GameAchievementsPanel";

export type GamePageShellInput = {
  title: string;
  subtitle: string;
  image: string;
  cardImage?: string;
  achievements?: string | number;
  progress: number;
  mastery?: string;
  hours: string;
  status: string;
  currentObjective?: string;
  objective?: string;
  achievementsList: AchievementInput[];
  platform?: string;
  genres?: string[];
  developer?: string;
  releaseYear?: string;
  manualTotalPlayedMinutes?: number | null;
  emblem?: {
    title?: string;
    image?: string;
    description?: string;
    tags?: string[];
    unlockedAt?: string;
  };
};

type Props = {
  slug: string;
  game: GamePageShellInput;
};

function normalizeText(value?: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeStatus(value?: string) {
  const normalized = normalizeText(value);
  if (["completed", "finalizado", "concluido", "concluida"].includes(normalized)) {
    return "completed";
  }
  if (["planned", "planejado", "backlog", "futuro"].includes(normalized)) {
    return "planned";
  }
  return "progress";
}

function getStatusLabel(value?: string) {
  const status = normalizeStatus(value);
  if (status === "completed") return "Finalizado";
  if (status === "planned") return "Na fila";
  return "Em progresso";
}

function clamp(value: number) {
  return Math.min(100, Math.max(0, Number(value) || 0));
}

function normalizeGameKey(value?: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatDeveloperName(value?: string) {
  const name = String(value || "").trim();
  if (!name) return "—";
  return name.split(/[,/&]|\s{2,}/)[0].trim().split(/\s+/)[0] || "—";
}

function formatPlayedTime(minutes: number) {
  const safe = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;

  if (hours <= 0 && mins <= 0) return "0h";
  if (mins <= 0) return `${hours}h`;
  if (hours <= 0) return `${mins}min`;
  return `${hours}h ${mins}min`;
}

function achievementImagePath(gameSlug: string, achievement?: AchievementInput) {
  if (!achievement) return "";
  if (achievement.image?.trim()) return achievement.image.trim();

  const title = String(achievement.title || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return title
    ? "/images/games/" + gameSlug + "/achievements/" + title + ".png"
    : "";
}

type TrophyRank = "Ouro" | "Prata" | "Bronze";

function getTrophyRank(achievement: AchievementInput): TrophyRank {
  const difficulty = normalizeText(achievement.difficulty);

  if (difficulty === "extrema" || difficulty === "diamante" || difficulty === "ouro") return "Ouro";
  if (difficulty === "media" || difficulty === "prata") return "Prata";

  if (achievement.trophy?.includes("🥇") || achievement.trophy?.includes("🏆") || achievement.icon?.includes("🥇") || achievement.icon?.includes("🏆")) {
    return "Ouro";
  }
  if (achievement.trophy?.includes("🥈") || achievement.icon?.includes("🥈")) return "Prata";

  return "Bronze";
}

const TROPHY_META: Array<{
  rank: TrophyRank | "Maestria";
  label: string;
}> = [
  { rank: "Bronze", label: "Bronze" },
  { rank: "Prata", label: "Prata" },
  { rank: "Ouro", label: "Ouro" },
  { rank: "Maestria", label: "Maestria" },
];

function IconGamepad({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M7.2 8.5H16.8C19.2 8.5 20.5 10.7 20.8 13.4L21.3 17.2C21.6 19.5 18.8 20.2 17.4 18.5L15.4 16H8.6L6.6 18.5C5.2 20.2 2.4 19.5 2.7 17.2L3.2 13.4C3.5 10.7 4.8 8.5 7.2 8.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M7 11V15M5 13H9M15.5 12.5H15.51M18 15H18.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconTrophy({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M8 4.5H16V9.3C16 12.3 14.5 14.6 12 14.6C9.5 14.6 8 12.3 8 9.3V4.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8 6H5.8C4.6 6 4.2 7 4.5 8.2C4.9 10.1 6.1 11.3 8.1 11.5M16 6H18.2C19.4 6 19.8 7 19.5 8.2C19.1 10.1 17.9 11.3 15.9 11.5M12 14.6V18M8.5 19.5H15.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconClock({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.4V12L15.2 14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCalendar({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="5.5" width="16" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7.5 3.8V7.2M16.5 3.8V7.2M4.5 9.5H19.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
      <h2 className="text-[12px] font-black uppercase tracking-[0.12em] text-white">
        {children}
      </h2>
    </div>
  );
}

export default function GamePageShell({ slug, game }: Props) {
  const { entries: activityEntries } = useJourneyEntries();
  const [manualStates, setManualStates] = useState<Record<string, ManualAchievementState>>({});
  const [automaticMetadata, setAutomaticMetadata] = useState<{
    genres: string[];
    platforms: string[];
    developer: string;
    releaseYear: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAutomaticMetadata() {
      try {
        const query = new URLSearchParams({
          title: game.title,
          platform: game.platform || "",
        });

        const response = await fetch(`/api/games/metadata?${query.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) return;

        const payload = (await response.json()) as {
          metadata?: {
            genres?: string[];
            platforms?: string[];
            developer?: string;
            releaseYear?: string;
          };
        };

        if (!cancelled && payload.metadata) {
          setAutomaticMetadata({
            genres: Array.isArray(payload.metadata.genres) ? payload.metadata.genres : [],
            platforms: Array.isArray(payload.metadata.platforms) ? payload.metadata.platforms : [],
            developer: String(payload.metadata.developer || "").trim(),
            releaseYear: String(payload.metadata.releaseYear || "").trim(),
          });
        }
      } catch {
        // Mantém os dados cadastrados caso a fonte externa esteja indisponível.
      }
    }

    loadAutomaticMetadata();

    return () => {
      cancelled = true;
    };
  }, [game.title, game.platform]);

  const achievements = Array.isArray(game.achievementsList) ? game.achievementsList : [];
  const completedCount = useMemo(
    () => achievements.filter((achievement) => ["completed", "concluido", "concluida"].includes(normalizeText(achievement.status))).length,
    [achievements]
  );
  const totalCount = achievements.length;
  const progress = clamp(game.progress);
  const status = normalizeStatus(game.status);
  const statusLabel = getStatusLabel(game.status);
  const objective = game.currentObjective || game.objective || "Definir próximo objetivo";
  const cover = game.cardImage || game.image || `/images/games/${slug}/cover.jpg`;

  const objectiveKey = normalizeGameKey(objective);
  const nextAchievement =
    achievements.find(
      (achievement) =>
        objectiveKey &&
        normalizeGameKey(achievement.title) === objectiveKey
    ) ??
    achievements.find(
      (achievement) =>
        !["completed", "concluido", "concluida"].includes(
          normalizeText(achievement.status)
        )
    );
  const nextAchievementImage = achievementImagePath(slug, nextAchievement);
  const genres = automaticMetadata?.genres.length
    ? automaticMetadata.genres
    : Array.isArray(game.genres)
      ? game.genres.filter(Boolean)
      : [];
  const automaticPlatform = automaticMetadata?.platforms?.[0] || "";
  const platform = automaticPlatform || game.platform || "—";
  const developer = automaticMetadata?.developer || game.developer || "—";
  const releaseYear = automaticMetadata?.releaseYear || game.releaseYear || "—";
  const emblem = game.emblem;
  const emblemUnlocked = status === "completed" || progress >= 100 || Boolean(emblem?.unlockedAt);
  const emblemDate = emblem?.unlockedAt
    ? new Date(emblem.unlockedAt).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "";

  const activityPlayedMinutes = useMemo(() => {
    const targetSlug = normalizeGameKey(slug);
    const targetTitle = normalizeGameKey(game.title);

    return activityEntries.reduce((total, entry) => {
      const entrySlug = normalizeGameKey(entry.gameSlug);
      const entryTitle = normalizeGameKey(entry.gameTitle);

      const titleMatches =
        entryTitle === targetTitle ||
        (entryTitle.length > 0 &&
          targetTitle.length > 0 &&
          (entryTitle.includes(targetTitle) || targetTitle.includes(entryTitle)));

      const slugMatches =
        entrySlug === targetSlug && targetSlug.length > 0;

      const matches = slugMatches || titleMatches;

      return matches
        ? total + Math.max(0, Number(entry.playedMinutes) || 0)
        : total;
    }, 0);
  }, [activityEntries, game.title, slug]);

  const storedPlayedMinutes = Math.max(
    0,
    Number(game.manualTotalPlayedMinutes) || 0
  );

  const hoursText = String(game.hours ?? "").trim();
  const hoursMatch = hoursText.match(/(\d+(?:[.,]\d+)?)\s*h/i);
  const minutesMatch = hoursText.match(/(\d+(?:[.,]\d+)?)\s*(?:min|m)\b/i);

  const hoursFallbackMinutes =
    hoursMatch || minutesMatch
      ? Math.max(
          0,
          Math.round(
            (hoursMatch
              ? Number(String(hoursMatch[1]).replace(",", "."))
              : 0) *
              60 +
              (minutesMatch
                ? Number(String(minutesMatch[1]).replace(",", "."))
                : 0)
          )
        )
      : 0;

  const playedTimeMinutes =
    activityPlayedMinutes > 0
      ? activityPlayedMinutes
      : storedPlayedMinutes > 0
        ? storedPlayedMinutes
        : hoursFallbackMinutes;

  const playedTime = formatPlayedTime(playedTimeMinutes);

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <Navbar />

      <div className="mx-auto w-full max-w-[1500px] px-5 py-6 lg:px-8 lg:py-8">
        <div className="grid gap-5 lg:grid-cols-[205px_minmax(0,1fr)_260px] xl:grid-cols-[220px_minmax(0,1fr)_275px]">
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-5">
              <div className="border-b border-white/[0.08] pb-5">
                <SectionTitle>Jogo</SectionTitle>
              </div>

              <div className="border-b border-white/[0.08] pb-6">
                <div className="overflow-hidden rounded-[12px] border border-white/[0.10] bg-[#090909] shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
                  {cover ? (
                    <img src={cover} alt={game.title} className="aspect-[3/4] w-full object-cover" />
                  ) : (
                    <div className="flex aspect-[3/4] items-center justify-center text-[10px] font-black uppercase text-white/25">Sem capa</div>
                  )}
                </div>

                <p className="mt-3 line-clamp-3 text-[12px] font-black leading-tight text-white" title={game.title}>
                  {game.title}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.08em] ${status === "completed" ? "border-emerald-400/25 bg-emerald-500/[0.08] text-emerald-300" : status === "planned" ? "border-cyan-400/25 bg-cyan-500/[0.08] text-cyan-300" : "border-red-500/25 bg-red-500/[0.08] text-red-500"}`}>
                    {statusLabel}
                  </span>
                  {game.platform && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.02] px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.08em] text-white/40">
                      {normalizeText(game.platform) === "steam" ? (
                        <img
                          src="/images/platforms/steam.png"
                          alt=""
                          aria-hidden="true"
                          className="h-3 w-3 shrink-0 object-contain"
                        />
                      ) : null}
                      {game.platform}
                    </span>
                  )}
                </div>
              </div>

              <div className="border-b border-white/[0.08] pb-5">
                <div className="mb-3">
                  <SectionTitle>Troféus / Conquistas</SectionTitle>
                </div>

                <div className="grid grid-cols-4 gap-1.5">
                  {TROPHY_META.map(({ rank, label }) => {
                    const total = rank === "Maestria"
                      ? 0
                      : achievements.filter((achievement) => getTrophyRank(achievement) === rank).length;
                    const completed = rank === "Maestria"
                      ? 0
                      : achievements.filter(
                          (achievement) =>
                            getTrophyRank(achievement) === rank &&
                            ["completed", "concluido", "concluida"].includes(normalizeText(achievement.status))
                        ).length;

                    return (
                      <div
                        key={rank}
                        title={label}
                        className="flex min-w-0 flex-col items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.02] px-1 py-3"
                      >
                        <div className="flex h-10 w-full items-center justify-center">
                          <img
                            src={
                              rank === "Bronze"
                                ? "/images/trophies/bronze.png"
                                : rank === "Prata"
                                  ? "/images/trophies/prata.png"
                                  : rank === "Ouro"
                                    ? "/images/trophies/ouro.png"
                                    : "/images/trophies/maestria.png"
                            }
                            alt=""
                            aria-hidden="true"
                            className="h-11 w-11 object-contain"
                          />
                        </div>
                        <span className="mt-2 text-[14px] font-black tabular-nums leading-none text-white/95">
                          {completed}/{total}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <Link href="/biblioteca" className="inline-flex text-[9px] font-black uppercase tracking-[0.12em] text-red-500 transition hover:text-red-500">
                ← Voltar para Biblioteca
              </Link>
            </div>
          </aside>

          <section id="conquistas" className="min-w-0 scroll-mt-24">
            <GameAchievementsPanel
              slug={slug}
              achievements={achievements}
              onStatesChange={setManualStates}
            />
          </section>

          <aside className="min-w-0">
            <div className="space-y-5 lg:sticky lg:top-24">
              <section className="relative overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#090909] p-5">
                <img
                  src={cover}
                  alt=""
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-[0.24]"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#090909]/82 via-[#090909]/62 to-[#090909]/28" />
                <div className="relative">
                  <SectionTitle>Sobre o Jogo</SectionTitle>

                  <div className="mt-4 space-y-4">
                    <div className="grid grid-cols-[20px_82px_minmax(0,1fr)] items-center gap-2.5">
                      <IconGamepad className="h-5 w-5 text-white/80" />
                      <span className="whitespace-nowrap text-[12px] font-bold text-white/55">Gênero</span>
                      <span className="min-w-0 truncate text-right text-[16px] font-black leading-tight text-white/95" title={genres.length > 0 ? genres.join(", ") : "—"}>
                        {genres.length > 0 ? genres.join(", ") : "—"}
                      </span>
                    </div>

                    <div className="grid grid-cols-[20px_82px_minmax(0,1fr)] items-center gap-2.5">
                      <IconGamepad className="h-4 w-4 text-white/70" />
                      <span className="whitespace-nowrap text-[12px] font-bold text-white/55">Plataforma</span>
                      <span className="min-w-0 truncate text-right text-[16px] font-black text-white/95" title={platform}>
                        {game.platform || "—"}
                      </span>
                    </div>

                    <div className="grid grid-cols-[20px_82px_minmax(0,1fr)] items-center gap-2.5">
                      <IconClock className="h-4 w-4 text-white/70" />
                      <span className="whitespace-nowrap text-[12px] font-bold text-white/55">Tempo de jogo</span>
                      <span className="min-w-0 truncate text-right text-[16px] font-black text-white/95" title={playedTime}>{playedTime}</span>
                    </div>

                    <div className="grid grid-cols-[20px_82px_minmax(0,1fr)] items-center gap-2.5">
                      <IconTrophy className="h-4 w-4 text-white/70" />
                      <span className="whitespace-nowrap text-[12px] font-bold text-white/55">Desenvolvedora</span>
                      <span className="min-w-0 truncate text-right text-[16px] font-black text-white/95" title={game.developer || "—"}>
                        {formatDeveloperName(developer)}
                      </span>
                    </div>

                    <div className="grid grid-cols-[20px_82px_minmax(0,1fr)] items-center gap-2.5">
                      <IconCalendar className="h-4 w-4 text-white/70" />
                      <span className="whitespace-nowrap text-[12px] font-bold text-white/55">Lançamento</span>
                      <span className="min-w-0 truncate text-right text-[16px] font-black text-white/95" title={releaseYear}>
                        {releaseYear || "—"}
                      </span>
                    </div>
                  </div>
                </div>
              </section>





              <section className="overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#090909] p-5">
                <SectionTitle>Emblema</SectionTitle>

                <div className="mt-3 flex min-h-[220px] flex-col items-center justify-center p-2 text-center">
                  {emblem?.image ? (
                    <div className="relative flex h-[170px] w-[170px] items-center justify-center">
                      <img
                        src={emblem.image}
                        alt={emblem.title || "Emblema"}
                        className={`h-full w-full object-contain transition-all ${emblemUnlocked ? "" : "scale-95 blur-[7px] opacity-45 grayscale"}`}
                      />
                      {!emblemUnlocked && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.14] bg-black/70 text-lg">
                            🔒
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex h-[170px] w-[170px] items-center justify-center text-5xl opacity-45">
                      🏆
                    </div>
                  )}

                  <p className={`mt-2 text-[11px] font-black uppercase tracking-[0.12em] ${emblemUnlocked ? "text-red-500" : "text-white/40"}`}>
                    {emblemUnlocked ? "Conquistado" : "Bloqueado"}
                  </p>

                  {emblemUnlocked ? (
                    <p className="mt-1 text-[10px] font-bold text-white/45">
                      {emblemDate ? `Conquistado em ${emblemDate}` : "Conquista registrada"}
                    </p>
                  ) : (
                    <p className="mt-1 max-w-[180px] text-[9px] leading-relaxed text-white/30">
                      Conquiste a maestria para desbloquear
                    </p>
                  )}
                </div>
              </section>

              <section id="proxima-conquista" className="rounded-[14px] border border-white/[0.08] bg-[#090909] p-4">
                <div className="flex items-center gap-2">
                  <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
                  <h2 className="text-[13px] font-black uppercase tracking-[0.12em] text-white">
                    Próxima Conquista
                  </h2>
                </div>

                <div className="mt-4 flex items-center gap-3.5 rounded-[10px] border border-white/[0.08] bg-[#0b0b0b] p-3">
                  <div className="relative h-[66px] w-[66px] shrink-0 overflow-hidden rounded-[8px] border border-white/[0.08] bg-black/40">
                    {nextAchievementImage ? (
                      <img
                        src={nextAchievementImage}
                        alt={nextAchievement?.title || objective}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-2xl opacity-35">
                        🏆
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-[8px] font-black uppercase tracking-[0.14em] text-red-500">
                      Objetivo atual
                    </p>
                    <p className="mt-1 truncate text-[13px] font-black leading-tight text-white">
                      {nextAchievement?.title || objective}
                    </p>

                    {nextAchievement?.description ? (
                      <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-white/40">
                        {nextAchievement.description}
                      </p>
                    ) : null}
                  </div>
                </div>
              </section>


            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

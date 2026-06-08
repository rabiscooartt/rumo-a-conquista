"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

export type Rank = "Bronze" | "Prata" | "Ouro" | "Diamante";
export type AchievementStatus = "locked" | "progress" | "completed";
type SortMode = "rarity" | "status" | "title";
type SortDirection = "asc" | "desc";

export type AchievementInput = {
  id?: string;
  title: string;
  description: string;
  trophy: string;
  difficulty: string;
  status?: AchievementStatus | string;
  earnedDate?: string;
  icon?: string;
  image?: string;
  isCustom?: boolean;
  isHidden?: boolean;
  hidden?: boolean;
};

export type ManualAchievementState = {
  rank: Rank;
  status: AchievementStatus;
  date: string;
  image?: string;
};

type CustomAchievement = AchievementInput & {
  id: string;
  isCustom: true;
};

type GameAchievementsPanelProps = {
  slug?: string;
  gameSlug?: string;
  gameTitle?: string;
  title?: string;
  achievements?: AchievementInput[];
  achievementsList?: AchievementInput[];
  onStatesChange?: (states: Record<string, ManualAchievementState>) => void;
  game?: {
    slug?: string;
    title?: string;
    achievementsList?: AchievementInput[];
  };
  [key: string]: unknown;
};

const RANK_OPTIONS: Rank[] = ["Bronze", "Prata", "Ouro", "Diamante"];

const STATUS_OPTIONS: { label: string; value: AchievementStatus }[] = [
  { label: "Travada", value: "locked" },
  { label: "Em progresso", value: "progress" },
  { label: "Desbloqueada", value: "completed" },
];

const SORT_OPTIONS: { label: string; value: SortMode }[] = [
  { label: "Raridade", value: "rarity" },
  { label: "Status", value: "status" },
  { label: "Nome", value: "title" },
];

const ACHIEVEMENTS_UPDATED_EVENT = "rumo-a-conquista-achievements-updated";

const rankDifficulty: Record<Rank, string> = {
  Bronze: "Simples",
  Prata: "Média",
  Ouro: "Difícil",
  Diamante: "Extrema",
};

const rankTrophy: Record<Rank, string> = {
  Bronze: "🥉",
  Prata: "🥈",
  Ouro: "🥇",
  Diamante: "💎",
};

const rankOrder: Record<Rank, number> = {
  Bronze: 1,
  Prata: 2,
  Ouro: 3,
  Diamante: 4,
};

const statusOrder: Record<AchievementStatus, number> = {
  locked: 1,
  progress: 2,
  completed: 3,
};

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeText(text?: string) {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isAchievementPubliclyHidden(achievement: AchievementInput) {
  const achievementRecord = achievement as AchievementInput & {
    isHidden?: unknown;
    hidden?: unknown;
  };

  return achievementRecord.isHidden === true || achievementRecord.hidden === true;
}

function normalizeStatus(status?: string): AchievementStatus {
  const normalizedStatus = normalizeText(status).replace(/[^a-z0-9]/g, "");

  if (
    normalizedStatus === "completed" ||
    normalizedStatus === "concluido" ||
    normalizedStatus === "concluida" ||
    normalizedStatus === "desbloqueado" ||
    normalizedStatus === "desbloqueada"
  ) {
    return "completed";
  }

  if (
    normalizedStatus === "progress" ||
    normalizedStatus === "emprogresso" ||
    normalizedStatus === "emandamento"
  ) {
    return "progress";
  }

  return "locked";
}

function slugify(text: string) {
  return normalizeText(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getDefaultRank(achievement: AchievementInput): Rank {
  const difficulty = normalizeText(achievement.difficulty);

  if (difficulty === "extrema" || difficulty === "diamante") return "Diamante";

  if (
    difficulty === "dificil" ||
    difficulty === "difícil" ||
    difficulty === "ouro"
  ) {
    return "Ouro";
  }

  if (
    difficulty === "media" ||
    difficulty === "média" ||
    difficulty === "prata"
  ) {
    return "Prata";
  }

  if (achievement.trophy?.includes("💎") || achievement.icon?.includes("💎")) {
    return "Diamante";
  }

  if (
    achievement.trophy?.includes("🥇") ||
    achievement.trophy?.includes("🏆") ||
    achievement.icon?.includes("🥇") ||
    achievement.icon?.includes("🏆")
  ) {
    return "Ouro";
  }

  if (achievement.trophy?.includes("🥈") || achievement.icon?.includes("🥈")) {
    return "Prata";
  }

  return "Bronze";
}

function toInputDate(date?: string) {
  if (!date) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }

  const [day, month, year] = date.split("/");

  if (!day || !month || !year) {
    return "";
  }

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function getRankTheme(rank: Rank) {
  if (rank === "Diamante") {
    return {
      border: "border-cyan-400/35",
      rowBorder: "border-l-cyan-400/70",
      bg: "bg-cyan-500/[0.055]",
      pill: "border-cyan-300/35 bg-cyan-500/15 text-cyan-100",
      glow: "shadow-[0_0_32px_rgba(34,211,238,0.12)]",
    };
  }

  if (rank === "Ouro") {
    return {
      border: "border-yellow-400/35",
      rowBorder: "border-l-yellow-400/70",
      bg: "bg-yellow-500/[0.055]",
      pill: "border-yellow-300/35 bg-yellow-500/15 text-yellow-100",
      glow: "shadow-[0_0_32px_rgba(250,204,21,0.11)]",
    };
  }

  if (rank === "Prata") {
    return {
      border: "border-white/20",
      rowBorder: "border-l-white/35",
      bg: "bg-white/[0.045]",
      pill: "border-white/25 bg-white/10 text-white/85",
      glow: "shadow-[0_0_32px_rgba(255,255,255,0.055)]",
    };
  }

  return {
    border: "border-orange-500/35",
    rowBorder: "border-l-orange-500/70",
    bg: "bg-orange-500/[0.055]",
    pill: "border-orange-300/35 bg-orange-500/15 text-orange-100",
    glow: "shadow-[0_0_32px_rgba(249,115,22,0.12)]",
  };
}

function buildAutoImagePath(gameSlug: string, achievementTitle: string) {
  if (!gameSlug || !achievementTitle) {
    return "";
  }

  return `/images/games/${gameSlug}/achievements/${slugify(
    achievementTitle
  )}.png`;
}

function getImagePath(
  gameSlug: string,
  achievement: AchievementInput,
  state?: ManualAchievementState
) {
  return (
    state?.image?.trim() ||
    achievement.image?.trim() ||
    buildAutoImagePath(gameSlug, achievement.title)
  );
}

function createDefaultStates(achievements: AchievementInput[]) {
  return achievements.reduce<Record<string, ManualAchievementState>>(
    (acc, achievement) => {
      acc[achievement.title] = {
        rank: getDefaultRank(achievement),
        status: normalizeStatus(achievement.status),
        date: toInputDate(achievement.earnedDate),
        image: achievement.image ?? "",
      };

      return acc;
    },
    {}
  );
}

function sortAchievements(
  achievements: AchievementInput[],
  states: Record<string, ManualAchievementState>,
  sortMode: SortMode,
  sortDirection: SortDirection
) {
  const multiplier = sortDirection === "asc" ? 1 : -1;

  return [...achievements].sort((a, b) => {
    const stateA = states[a.title] ?? createDefaultStates([a])[a.title];
    const stateB = states[b.title] ?? createDefaultStates([b])[b.title];

    if (sortMode === "rarity") {
      const result = rankOrder[stateA.rank] - rankOrder[stateB.rank];

      if (result !== 0) {
        return result * multiplier;
      }
    }

    if (sortMode === "status") {
      const result = statusOrder[stateA.status] - statusOrder[stateB.status];

      if (result !== 0) {
        return result * multiplier;
      }
    }

    const result = a.title.localeCompare(b.title);
    return result * multiplier;
  });
}

function AchievementImage({
  src,
  fallback,
  locked,
}: {
  src: string;
  fallback: string;
  locked: boolean;
}) {
  const [hasError, setHasError] = useState(false);

  if (!src || hasError) {
    return (
      <div
        className={`flex h-full w-full items-center justify-center text-4xl ${
          locked ? "opacity-35 grayscale" : ""
        }`}
      >
        {fallback}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      className={`h-full w-full object-cover ${
        locked ? "opacity-35 grayscale" : ""
      }`}
      onError={() => setHasError(true)}
    />
  );
}

function SortButton({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-4 py-2 text-xs font-black uppercase tracking-[0.14em] transition ${
        active
          ? "border-red-500/35 bg-red-500/15 text-red-100 shadow-[0_0_18px_rgba(239,68,68,0.12)]"
          : "border-white/10 bg-white/[0.03] text-white/45 hover:border-white/20 hover:text-white"
      }`}
    >
      {label} {active ? (direction === "asc" ? "↑" : "↓") : ""}
    </button>
  );
}

export default function GameAchievementsPanel(
  props: GameAchievementsPanelProps
) {
  const searchParams = useSearchParams();
  const isEditMode = searchParams.get("editar") === "1";

  const gameSlug =
    props.gameSlug ?? props.slug ?? props.game?.slug ?? "jogo-sem-slug";

  const gameTitle = props.gameTitle ?? props.title ?? props.game?.title ?? "Jogo";

  const baseAchievements =
    props.achievements ??
    props.achievementsList ??
    props.game?.achievementsList ??
    [];

  const onStatesChange = props.onStatesChange;

  const statesStorageKey = `rumo-a-conquista-achievements-${gameSlug}`;
  const customStorageKey = `rumo-a-conquista-custom-achievements-${gameSlug}`;
  const hiddenStorageKey = `rumo-a-conquista-hidden-achievements-${gameSlug}`;

  const [manualStates, setManualStates] = useState<
    Record<string, ManualAchievementState>
  >({});

  const [customAchievements, setCustomAchievements] = useState<
    CustomAchievement[]
  >([]);

  const [hiddenAchievementTitles, setHiddenAchievementTitles] = useState<
    string[]
  >([]);

  const [sortMode, setSortMode] = useState<SortMode>("status");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [savedAchievementTitle, setSavedAchievementTitle] = useState("");

  const [newAchievement, setNewAchievement] = useState({
    title: "",
    description: "",
    rank: "Bronze" as Rank,
    status: "locked" as AchievementStatus,
    image: "",
  });

  const visibleBaseAchievements = useMemo(() => {
    return baseAchievements.filter((achievement) => {
      if (hiddenAchievementTitles.includes(achievement.title)) {
        return false;
      }

      if (!isEditMode && isAchievementPubliclyHidden(achievement)) {
        return false;
      }

      return true;
    });
  }, [baseAchievements, hiddenAchievementTitles, isEditMode]);

  const visibleCustomAchievements = useMemo(() => {
    if (isEditMode) {
      return customAchievements;
    }

    return customAchievements.filter(
      (achievement) => !isAchievementPubliclyHidden(achievement)
    );
  }, [customAchievements, isEditMode]);

  const allAchievements = useMemo(() => {
    return [...visibleBaseAchievements, ...visibleCustomAchievements];
  }, [visibleBaseAchievements, visibleCustomAchievements]);

  useEffect(() => {
    const defaultStates = createDefaultStates(baseAchievements);

    const savedStates = localStorage.getItem(statesStorageKey);
    const savedCustomAchievements = localStorage.getItem(customStorageKey);
    const savedHiddenAchievements = localStorage.getItem(hiddenStorageKey);

    let parsedStates: Record<string, ManualAchievementState> = {};
    let parsedCustomAchievements: CustomAchievement[] = [];
    let parsedHiddenAchievements: string[] = [];

    if (savedStates) {
      try {
        parsedStates = JSON.parse(savedStates);
      } catch {
        parsedStates = {};
      }
    }

    if (savedCustomAchievements) {
      try {
        parsedCustomAchievements = JSON.parse(savedCustomAchievements);
      } catch {
        parsedCustomAchievements = [];
      }
    }

    if (savedHiddenAchievements) {
      try {
        parsedHiddenAchievements = JSON.parse(savedHiddenAchievements);
      } catch {
        parsedHiddenAchievements = [];
      }
    }

    const customDefaultStates = createDefaultStates(parsedCustomAchievements);

    setCustomAchievements(parsedCustomAchievements);
    setHiddenAchievementTitles(parsedHiddenAchievements);

    setManualStates({
      ...defaultStates,
      ...customDefaultStates,
      ...parsedStates,
    });
  }, [baseAchievements, customStorageKey, hiddenStorageKey, statesStorageKey]);

  useEffect(() => {
    onStatesChange?.(manualStates);
  }, [manualStates, onStatesChange]);

  function updateAchievementState(
    achievementTitle: string,
    update: Partial<ManualAchievementState>
  ) {
    setManualStates((current) => {
      const currentState = current[achievementTitle] ?? {
        rank: "Bronze",
        status: "locked",
        date: "",
        image: "",
      };

      return {
        ...current,
        [achievementTitle]: {
          ...currentState,
          ...update,
        },
      };
    });
  }

  function updateCustomAchievement(
    achievementId: string,
    field: "title" | "description",
    value: string
  ) {
    setCustomAchievements((currentAchievements) => {
      const achievement = currentAchievements.find(
        (item) => item.id === achievementId
      );

      if (!achievement) {
        return currentAchievements;
      }

      const oldTitle = achievement.title;
      const nextTitle = field === "title" ? value : achievement.title;

      if (field === "title" && nextTitle.trim().length > 0) {
        setManualStates((currentStates) => {
          const oldState = currentStates[oldTitle];

          if (!oldState) {
            return currentStates;
          }

          const nextStates = { ...currentStates };
          delete nextStates[oldTitle];

          return {
            ...nextStates,
            [nextTitle]: oldState,
          };
        });
      }

      return currentAchievements.map((item) => {
        if (item.id !== achievementId) {
          return item;
        }

        return {
          ...item,
          [field]: value,
        };
      });
    });
  }

  function addAchievement() {
    const title = newAchievement.title.trim();

    if (!title) {
      alert("Digite o nome da conquista.");
      return;
    }

    const alreadyExists = [...baseAchievements, ...customAchievements].some(
      (achievement) => normalizeText(achievement.title) === normalizeText(title)
    );

    if (alreadyExists) {
      alert("Já existe uma conquista com esse nome.");
      return;
    }

    const customAchievement: CustomAchievement = {
      id: createId(),
      isCustom: true,
      title,
      description:
        newAchievement.description.trim() ||
        "Descrição da conquista ainda não definida.",
      trophy: rankTrophy[newAchievement.rank],
      difficulty: rankDifficulty[newAchievement.rank],
      status: newAchievement.status,
      earnedDate: "",
      icon: rankTrophy[newAchievement.rank],
      image: newAchievement.image.trim(),
    };

    setCustomAchievements((current) => [...current, customAchievement]);

    setManualStates((current) => ({
      ...current,
      [title]: {
        rank: newAchievement.rank,
        status: newAchievement.status,
        date: "",
        image: newAchievement.image.trim(),
      },
    }));

    setNewAchievement({
      title: "",
      description: "",
      rank: "Bronze",
      status: "locked",
      image: "",
    });
  }

  function removeAchievement(achievement: AchievementInput) {
    const isCustom = achievement.isCustom === true;

    const confirmed = window.confirm(
      isCustom
        ? `Remover a conquista "${achievement.title}"?`
        : `Ocultar a conquista "${achievement.title}"? Ela veio do data/games.ts e poderá ser restaurada depois.`
    );

    if (!confirmed) {
      return;
    }

    if (isCustom) {
      setCustomAchievements((current) =>
        current.filter((item) => item.id !== achievement.id)
      );
    } else {
      setHiddenAchievementTitles((current) => {
        if (current.includes(achievement.title)) {
          return current;
        }

        return [...current, achievement.title];
      });
    }

    setManualStates((current) => {
      const nextStates = { ...current };
      delete nextStates[achievement.title];
      return nextStates;
    });
  }

  function restoreRemovedAchievements() {
    const confirmed = window.confirm(
      "Restaurar todas as conquistas ocultadas deste jogo?"
    );

    if (!confirmed) {
      return;
    }

    const defaultStates = createDefaultStates(baseAchievements);

    setHiddenAchievementTitles([]);

    setManualStates((current) => ({
      ...defaultStates,
      ...current,
    }));
  }

  function saveChanges(showAlert = true) {
    localStorage.setItem(statesStorageKey, JSON.stringify(manualStates));
    localStorage.setItem(customStorageKey, JSON.stringify(customAchievements));
    localStorage.setItem(
      hiddenStorageKey,
      JSON.stringify(hiddenAchievementTitles)
    );

    onStatesChange?.(manualStates);
    window.dispatchEvent(new Event(ACHIEVEMENTS_UPDATED_EVENT));

    if (showAlert) {
      alert("Conquistas salvas com sucesso!");
    }
  }

  function confirmAchievement(achievementTitle: string) {
    saveChanges(false);
    setSavedAchievementTitle(achievementTitle);

    window.setTimeout(() => {
      setSavedAchievementTitle((current) =>
        current === achievementTitle ? "" : current
      );
    }, 1300);
  }

  function handleSortClick(nextSortMode: SortMode) {
    if (nextSortMode === sortMode) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortMode(nextSortMode);
    setSortDirection(nextSortMode === "title" ? "asc" : "desc");
  }

  const completedCount = allAchievements.filter((achievement) => {
    const state = manualStates[achievement.title];
    return state?.status === "completed";
  }).length;

  const progress =
    allAchievements.length > 0
      ? Math.round((completedCount / allAchievements.length) * 100)
      : 0;

  const sortedAchievements = useMemo(() => {
    return sortAchievements(
      allAchievements,
      manualStates,
      sortMode,
      sortDirection
    );
  }, [allAchievements, manualStates, sortDirection, sortMode]);

  return (
    <section className="mt-10 overflow-hidden rounded-[32px] border border-white/10 bg-zinc-950/85 shadow-[0_0_55px_rgba(0,0,0,0.45)]">
      <div className="relative border-b border-white/10 p-7">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.12),transparent_34%),radial-gradient(circle_at_top_right,rgba(34,211,238,0.08),transparent_34%)]" />

        <div className="relative z-10 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.32em] text-red-400">
              Conquistas
            </p>

            <h2 className="mt-3 text-4xl font-black text-white">
              Jornada de {gameTitle}
            </h2>

            <p className="mt-2 text-sm text-white/45">
              {completedCount}/{allAchievements.length} conquistas desbloqueadas
            </p>
          </div>

          <div className="w-full max-w-[520px]">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-white/45">Progresso geral</span>

              <span
                className={`font-black ${
                  progress >= 100 ? "text-emerald-300" : "text-red-400"
                }`}
              >
                {progress}%
              </span>
            </div>

            <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full ${
                  progress >= 100
                    ? "bg-emerald-400 shadow-[0_0_18px_rgba(16,185,129,0.65)]"
                    : "bg-red-500 shadow-[0_0_18px_rgba(239,68,68,0.55)]"
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {SORT_OPTIONS.map((option) => (
                <SortButton
                  key={option.value}
                  label={option.label}
                  active={sortMode === option.value}
                  direction={sortDirection}
                  onClick={() => handleSortClick(option.value)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {isEditMode && (
        <section className="border-b border-red-500/20 bg-red-500/[0.045] p-6">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-black uppercase tracking-[0.3em] text-red-300">
              Editor de conquistas
            </p>

            <h3 className="text-2xl font-black text-white">
              + Adicionar nova conquista
            </h3>

            <p className="text-xs leading-relaxed text-white/45">
              Para imagem automática, salve o arquivo em{" "}
              <span className="font-black text-red-200">
                public/images/games/{gameSlug}/achievements/nome-da-conquista.png
              </span>
              .
            </p>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_1.3fr_0.7fr_0.8fr_1.4fr_auto]">
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Nome
              </span>

              <input
                value={newAchievement.title}
                onChange={(event) =>
                  setNewAchievement((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder="Ex: Finalização do jogo"
                className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none transition focus:border-red-500/50"
              />
            </label>

            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Descrição
              </span>

              <input
                value={newAchievement.description}
                onChange={(event) =>
                  setNewAchievement((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Ex: Finalize a campanha principal."
                className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none transition focus:border-red-500/50"
              />
            </label>

            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Rank
              </span>

              <select
                value={newAchievement.rank}
                onChange={(event) =>
                  setNewAchievement((current) => ({
                    ...current,
                    rank: event.target.value as Rank,
                  }))
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none transition focus:border-red-500/50"
              >
                {RANK_OPTIONS.map((rank) => (
                  <option key={rank} value={rank}>
                    {rank}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Status
              </span>

              <select
                value={newAchievement.status}
                onChange={(event) =>
                  setNewAchievement((current) => ({
                    ...current,
                    status: event.target.value as AchievementStatus,
                  }))
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none transition focus:border-red-500/50"
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Imagem
              </span>

              <input
                value={newAchievement.image}
                onChange={(event) =>
                  setNewAchievement((current) => ({
                    ...current,
                    image: event.target.value,
                  }))
                }
                placeholder={`/images/games/${gameSlug}/achievements/${slugify(
                  newAchievement.title || "nome-da-conquista"
                )}.png`}
                className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none transition focus:border-red-500/50"
              />
            </label>

            <div className="flex items-end">
              <button
                type="button"
                onClick={addAchievement}
                className="w-full rounded-xl border border-red-500/35 bg-red-500/15 px-5 py-3 text-sm font-black text-red-100 transition hover:bg-red-500/25"
              >
                + Adicionar
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap justify-end gap-3">
            {hiddenAchievementTitles.length > 0 && (
              <button
                type="button"
                onClick={restoreRemovedAchievements}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-6 py-3 text-sm font-black text-white/60 transition hover:border-cyan-400/30 hover:bg-cyan-500/10 hover:text-cyan-200"
              >
                Restaurar removidas ({hiddenAchievementTitles.length})
              </button>
            )}

            <button
              type="button"
              onClick={() => saveChanges(true)}
              className="rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-6 py-3 text-sm font-black text-emerald-200 transition hover:bg-emerald-500/25"
            >
              Salvar todas
            </button>
          </div>
        </section>
      )}

      <div className="divide-y divide-white/10">
        {sortedAchievements.length > 0 ? (
          sortedAchievements.map((achievement) => {
            const state =
              manualStates[achievement.title] ??
              createDefaultStates([achievement])[achievement.title];

            const rank = state.rank;
            const status = state.status;
            const theme = getRankTheme(rank);
            const isLocked = status === "locked";
            const imagePath = getImagePath(gameSlug, achievement, state);
            const isSaved = savedAchievementTitle === achievement.title;

            return (
              <article
                key={achievement.id ?? achievement.title}
                className={`relative border-l-4 transition ${
                  isLocked
                    ? "border-l-white/10 bg-black/20 opacity-55 grayscale"
                    : `${theme.rowBorder} ${theme.bg} ${theme.glow}`
                }`}
              >
                <div className="p-6">
                  <div className="grid gap-5 md:grid-cols-[76px_1fr]">
                    <div
                      className={`h-[76px] w-[76px] overflow-hidden rounded-2xl border bg-black/45 ${
                        isLocked ? "border-white/10" : theme.border
                      }`}
                    >
                      <AchievementImage
                        src={imagePath}
                        fallback={rankTrophy[rank]}
                        locked={isLocked}
                      />
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-2xl font-black uppercase tracking-[-0.02em] text-white">
                          {achievement.title}
                        </h3>

                        <span
                          className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${
                            isLocked ? "border-white/10 text-white/35" : theme.pill
                          }`}
                        >
                          {rankTrophy[rank]} {rank}
                        </span>

                        <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white/40">
                          {rankDifficulty[rank]}
                        </span>
                      </div>

                      <p className="mt-2 max-w-[900px] text-sm leading-relaxed text-white/56">
                        {achievement.description ||
                          "Descrição ainda não definida."}
                      </p>
                    </div>
                  </div>

                  {isEditMode && (
                    <div className="mt-6 rounded-[22px] border border-white/10 bg-black/25 p-4">
                      {achievement.isCustom === true && (
                        <div className="mb-4 grid gap-4 lg:grid-cols-2">
                          <label className="block">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                              Nome da conquista
                            </span>

                            <input
                              value={achievement.title}
                              onChange={(event) =>
                                updateCustomAchievement(
                                  achievement.id ?? "",
                                  "title",
                                  event.target.value
                                )
                              }
                              className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none transition focus:border-red-500/50"
                            />
                          </label>

                          <label className="block">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                              Descrição
                            </span>

                            <input
                              value={achievement.description}
                              onChange={(event) =>
                                updateCustomAchievement(
                                  achievement.id ?? "",
                                  "description",
                                  event.target.value
                                )
                              }
                              className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none transition focus:border-red-500/50"
                            />
                          </label>
                        </div>
                      )}

                      <div className="grid gap-4 lg:grid-cols-[0.9fr_0.9fr_1.5fr_auto]">
                        <label className="block">
                          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                            Status
                          </span>

                          <select
                            value={state.status}
                            onChange={(event) =>
                              updateAchievementState(achievement.title, {
                                status: event.target.value as AchievementStatus,
                              })
                            }
                            className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none transition focus:border-red-500/50"
                          >
                            {STATUS_OPTIONS.map((statusOption) => (
                              <option
                                key={statusOption.value}
                                value={statusOption.value}
                              >
                                {statusOption.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="block">
                          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                            Rank
                          </span>

                          <select
                            value={state.rank}
                            onChange={(event) =>
                              updateAchievementState(achievement.title, {
                                rank: event.target.value as Rank,
                              })
                            }
                            className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none transition focus:border-red-500/50"
                          >
                            {RANK_OPTIONS.map((rankOption) => (
                              <option key={rankOption} value={rankOption}>
                                {rankOption}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="block">
                          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                            Imagem
                          </span>

                          <input
                            value={state.image ?? ""}
                            onChange={(event) =>
                              updateAchievementState(achievement.title, {
                                image: event.target.value,
                              })
                            }
                            placeholder={buildAutoImagePath(
                              gameSlug,
                              achievement.title
                            )}
                            className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none transition focus:border-red-500/50"
                          />
                        </label>

                        <div className="flex items-end gap-2">
                          <button
                            type="button"
                            onClick={() => confirmAchievement(achievement.title)}
                            className="rounded-xl border border-red-500/35 bg-red-500/15 px-5 py-3 text-sm font-black text-red-100 transition hover:bg-red-500/25"
                          >
                            {isSaved ? "Salvo" : "Confirmar"}
                          </button>

                          <button
                            type="button"
                            onClick={() => removeAchievement(achievement)}
                            className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-black text-white/45 transition hover:border-red-500/35 hover:bg-red-500/10 hover:text-red-200"
                          >
                            Remover
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </article>
            );
          })
        ) : (
          <div className="p-8 text-sm text-white/45">
            Nenhuma conquista cadastrada ainda.
          </div>
        )}
      </div>
    </section>
  );
}
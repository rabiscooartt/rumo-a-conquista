"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import {
  type FlexibleAchievementInput,
  type GameFormInput,
  type SiteGame,
  slugify,
  useSiteGames,
} from "@/lib/useSiteGames";

type AchievementRank = "Bronze" | "Prata" | "Ouro" | "Diamante";
type AchievementStatus = "locked" | "progress" | "completed";

type EditableAchievement = FlexibleAchievementInput & {
  id: string;
  title: string;
  description: string;
  trophy: string;
  difficulty: AchievementRank;
  status: AchievementStatus;
  image: string;
  isCustom: boolean;
  isHidden: boolean;
};

type GameEditorForm = {
  title: string;
  subtitle: string;
  status: string;
  progress: number;
  hours: string;
  currentObjective: string;
  image: string;
  cardImage: string;
  emblemTitle: string;
  emblemImage: string;
  emblemDescription: string;
  emblemTags: string;
  emblemUnlockedAt: string;
};

type ReviewStatus = "bloqueada" | "em-andamento" | "liberada";

type EditableReview = {
  status: ReviewStatus;
  nota: string;
  titulo: string;
  resumo: string;
  texto: string;
  pontosPositivos: string;
  pontosNegativos: string;
};

type AdminGameFilter = "all" | "progress" | "completed" | "planned";
type GameSortDirection = "asc" | "desc";

const emptyReviewForm: EditableReview = {
  status: "bloqueada",
  nota: "",
  titulo: "Análise da Jornada",
  resumo: "",
  texto: "",
  pontosPositivos: "",
  pontosNegativos: "",
};

const REVIEW_UPDATED_EVENT = "rumo-a-conquista-review-updated";

const emptyGameForm: GameFormInput = {
  slug: "",
  title: "",
  subtitle: "",
  status: "progress",
  progress: 0,
  hours: "0h",
  currentObjective: "",
  image: "",
  cardImage: "",
  emblemTitle: "",
  emblemImage: "",
  emblemDescription: "",
  emblemTags: "",
  emblemUnlockedAt: "",
};

const statusOptions = [
  { label: "Em progresso", value: "progress" },
  { label: "Finalizado", value: "completed" },
  { label: "Futuro / Backlog", value: "planned" },
];

const achievementStatusOptions: {
  label: string;
  value: AchievementStatus;
}[] = [
  { label: "Bloqueada", value: "locked" },
  { label: "Em progresso", value: "progress" },
  { label: "Concluída", value: "completed" },
];

const reviewStatusOptions: {
  label: string;
  value: ReviewStatus;
}[] = [
  { label: "Bloqueada", value: "bloqueada" },
  { label: "Em andamento", value: "em-andamento" },
  { label: "Liberada", value: "liberada" },
];

const rankOptions: AchievementRank[] = ["Bronze", "Prata", "Ouro", "Diamante"];

const commitMessageOptions = [
  "Atualiza dados dos jogos",
  "Adiciona novo jogo",
  "Atualiza imagens dos jogos",
  "Atualiza emblemas dos jogos",
  "Adiciona data dos emblemas",
  "Melhora painel admin",
  "Corrige login do admin",
  "Atualiza pagina de emblemas",
  "Corrige exibicao dos jogos",
  "Atualiza reviews dos jogos",
  "Atualiza conquistas dos jogos",
  "Oculta jogos incompletos",
  "Atualiza proximas maestrias",
  "Melhora organizacao do site",
  "Corrige ajustes gerais",
];

function rankToTrophy(rank: AchievementRank) {
  if (rank === "Diamante") return "💎";
  if (rank === "Ouro") return "🥇";
  if (rank === "Prata") return "🥈";
  return "🥉";
}

function normalizeRank(value?: string): AchievementRank {
  if (value === "Diamante") return "Diamante";
  if (value === "Ouro") return "Ouro";
  if (value === "Prata") return "Prata";
  return "Bronze";
}

function normalizeAchievementStatus(value?: string): AchievementStatus {
  if (value === "completed") return "completed";
  if (value === "progress") return "progress";
  return "locked";
}

function readText(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function normalizeText(value: unknown) {
  return readText(value, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function readBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;

  if (typeof value === "string") {
    const normalizedValue = value.toLowerCase().trim();

    if (["true", "1", "sim", "yes", "oculta", "hidden"].includes(normalizedValue)) {
      return true;
    }

    if (["false", "0", "nao", "não", "no", "visivel", "visível"].includes(normalizedValue)) {
      return false;
    }
  }

  return fallback;
}

function readArrayAsLines(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => readText(item, "").trim())
      .filter(Boolean)
      .join("\n");
  }

  return readText(value, "");
}

function splitLines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeGameStatusForFilter(status?: string): Exclude<AdminGameFilter, "all"> {
  const value = readText(status, "progress").toLowerCase();

  if (
    value === "completed" ||
    value === "finalizado" ||
    value === "concluido" ||
    value === "concluida"
  ) {
    return "completed";
  }

  if (
    value === "planned" ||
    value === "backlog" ||
    value === "futuro" ||
    value === "planejado"
  ) {
    return "planned";
  }

  return "progress";
}

function normalizeReviewStatus(value?: string): ReviewStatus {
  if (value === "liberada") return "liberada";
  if (value === "em-andamento") return "em-andamento";
  return "bloqueada";
}

function normalizeReview(review: unknown): EditableReview {
  if (!review || typeof review !== "object") {
    return emptyReviewForm;
  }

  const reviewRecord = review as Record<string, unknown>;

  return {
    status: normalizeReviewStatus(readText(reviewRecord.status, "bloqueada")),
    nota: readText(reviewRecord.nota, ""),
    titulo: readText(reviewRecord.titulo, "Análise da Jornada"),
    resumo:
      readText(reviewRecord.resumo, "") ||
      readText(reviewRecord.summary, "") ||
      readText(reviewRecord.label, ""),
    texto:
      readText(reviewRecord.texto, "") ||
      readText(reviewRecord.text, "") ||
      readText(reviewRecord.review, "") ||
      readText(reviewRecord.analysis, ""),
    pontosPositivos:
      readArrayAsLines(reviewRecord.positivos) ||
      readArrayAsLines(reviewRecord.pontosPositivos) ||
      readArrayAsLines(reviewRecord.pontosFortes) ||
      readArrayAsLines(reviewRecord.positivePoints) ||
      readArrayAsLines(reviewRecord.pros),
    pontosNegativos:
      readArrayAsLines(reviewRecord.negativos) ||
      readArrayAsLines(reviewRecord.pontosNegativos) ||
      readArrayAsLines(reviewRecord.pontosFracos) ||
      readArrayAsLines(reviewRecord.negativePoints) ||
      readArrayAsLines(reviewRecord.cons),
  };
}

function createReviewPayload(review: EditableReview) {
  const pontosPositivos = splitLines(review.pontosPositivos);
  const pontosNegativos = splitLines(review.pontosNegativos);

  return {
    status: review.status,
    nota: review.nota.trim(),
    titulo: review.titulo.trim() || "Análise da Jornada",
    resumo: review.resumo.trim(),
    label: review.resumo.trim(),
    summary: review.resumo.trim(),
    texto: review.texto.trim(),
    text: review.texto.trim(),
    review: review.texto.trim(),
    analysis: review.texto.trim(),
    positivos: pontosPositivos,
    negativos: pontosNegativos,
    pontosFortes: pontosPositivos,
    pontosFracos: pontosNegativos,
    pontosPositivos,
    pontosNegativos,
    positivePoints: pontosPositivos,
    negativePoints: pontosNegativos,
    pros: pontosPositivos,
    cons: pontosNegativos,
  };
}

function createEmblemPayload(
  form: Pick<
    GameEditorForm,
    "emblemTitle" | "emblemImage" | "emblemDescription" | "emblemTags" | "emblemUnlockedAt"
  >
): SiteGame["emblem"] {
  const title = form.emblemTitle.trim();
  const image = form.emblemImage.trim();
  const description = form.emblemDescription.trim();
  const tags = splitLines(form.emblemTags);
  const unlockedAt = form.emblemUnlockedAt.trim();

  if (!title && !image && !description && tags.length === 0 && !unlockedAt) {
    return undefined;
  }

  return {
    title,
    image,
    description,
    tags,
    unlockedAt,
  };
}

function hasCreatedEmblem(
  form: Pick<
    GameEditorForm,
    "emblemTitle" | "emblemImage" | "emblemDescription" | "emblemTags"
  >
) {
  const title = form.emblemTitle.trim();
  const image = form.emblemImage.trim();
  const description = form.emblemDescription.trim();
  const tags = splitLines(form.emblemTags);

  const normalizedTitle = normalizeText(title);
  const hasRealTitle =
    Boolean(title) &&
    !["emblema", "emblemadojogo", "maestriafinal"].includes(normalizedTitle);

  return Boolean(image && (hasRealTitle || description || tags.length > 0));
}

function normalizeAchievements(
  achievements: FlexibleAchievementInput[] | undefined,
  gameSlug: string
): EditableAchievement[] {
  if (!Array.isArray(achievements)) return [];

  return achievements.map((achievement, index) => {
    const achievementRecord = achievement as FlexibleAchievementInput & {
      isHidden?: unknown;
      hidden?: unknown;
    };

    const title = readText(achievement.title, `Conquista ${index + 1}`);

    const rank = normalizeRank(
      readText(achievement.difficulty, readText(achievement.rank, "Bronze"))
    );

    return {
      ...achievement,
      id:
        readText(achievement.id, "") ||
        `${gameSlug}-achievement-${index + 1}-${slugify(title)}`,
      title,
      description: readText(achievement.description, ""),
      trophy:
        readText(achievement.trophy, "") ||
        readText(achievement.icon, "") ||
        rankToTrophy(rank),
      difficulty: rank,
      status: normalizeAchievementStatus(readText(achievement.status, "locked")),
      image: readText(achievement.image, ""),
      isCustom: Boolean(achievement.isCustom ?? true),
      isHidden: readBoolean(
        achievementRecord.isHidden ?? achievementRecord.hidden,
        false
      ),
    };
  });
}

function createEmptyAchievement(
  gameSlug: string,
  index: number
): EditableAchievement {
  return {
    id: `${gameSlug}-achievement-${Date.now()}`,
    title: `Nova conquista ${index + 1}`,
    description: "",
    trophy: "🥉",
    difficulty: "Bronze",
    status: "locked",
    image: "",
    isCustom: true,
    isHidden: false,
  };
}

function getCompletedAchievements(achievements: EditableAchievement[]) {
  return achievements.filter((achievement) => achievement.status === "completed")
    .length;
}

function getImagePath(gameSlug: string, fileName: string) {
  return `/images/games/${gameSlug}/${fileName}`;
}

function GameImagePreview({
  src,
  title,
}: {
  src?: string;
  title: string;
  type?: "cover" | "banner";
}) {
  const [hasError, setHasError] = useState(false);

  if (!src || hasError) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black/50 text-sm font-black text-white/35">
        Sem imagem
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={title}
      className="h-full w-full object-cover"
      onError={() => setHasError(true)}
    />
  );
}

function AchievementImagePreview({
  achievement,
}: {
  achievement: EditableAchievement;
}) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [achievement.image]);

  if (!achievement.image || hasError) {
    return (
      <div className="flex h-full w-full items-center justify-center text-3xl">
        {achievement.trophy}
      </div>
    );
  }

  return (
    <img
      key={achievement.image}
      src={achievement.image}
      alt={achievement.title}
      className="h-full w-full object-cover"
      onError={() => setHasError(true)}
    />
  );
}

function GameEditorCard({
  game,
  onSave,
  onRemove,
  isExpanded,
  onToggleExpand,
}: {
  game: SiteGame;
  onSave: (slug: string, update: Partial<SiteGame>) => void;
  onRemove: (slug: string) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const [form, setForm] = useState<GameEditorForm>({
    title: game.title || "",
    subtitle: game.subtitle || "",
    status: game.status || "progress",
    progress: Number(game.progress) || 0,
    hours: String(game.hours || "0h"),
    currentObjective: String(game.currentObjective || game.objective || ""),
    image: String(game.image || ""),
    cardImage: String(game.cardImage || ""),
    emblemTitle: String(game.emblem?.title || ""),
    emblemImage: String(game.emblem?.image || ""),
    emblemDescription: String(game.emblem?.description || ""),
    emblemTags: readArrayAsLines(game.emblem?.tags),
    emblemUnlockedAt: String(game.emblem?.unlockedAt || ""),
  });

  const [achievements, setAchievements] = useState<EditableAchievement[]>(
    normalizeAchievements(game.achievementsList, game.slug)
  );

  const [review, setReview] = useState<EditableReview>(
    normalizeReview(game.review)
  );

  useEffect(() => {
    setForm({
      title: game.title || "",
      subtitle: game.subtitle || "",
      status: game.status || "progress",
      progress: Number(game.progress) || 0,
      hours: String(game.hours || "0h"),
      currentObjective: String(game.currentObjective || game.objective || ""),
      image: String(game.image || ""),
      cardImage: String(game.cardImage || ""),
      emblemTitle: String(game.emblem?.title || ""),
      emblemImage: String(game.emblem?.image || ""),
      emblemDescription: String(game.emblem?.description || ""),
      emblemTags: readArrayAsLines(game.emblem?.tags),
      emblemUnlockedAt: String(game.emblem?.unlockedAt || ""),
    });

    setAchievements(normalizeAchievements(game.achievementsList, game.slug));
    setReview(normalizeReview(game.review));
  }, [game]);

  const completedAchievements = getCompletedAchievements(achievements);
  const emblemCreated = hasCreatedEmblem(form);

  function handleUseImageDefaults() {
    setForm((current) => ({
      ...current,
      image: getImagePath(game.slug, "banner.jpg"),
      cardImage: getImagePath(game.slug, "cover.jpg"),
      emblemImage: getImagePath(game.slug, "emblem.png"),
    }));
  }

  function handleAddAchievement() {
    setAchievements((current) => [
      ...current,
      createEmptyAchievement(game.slug, current.length),
    ]);
  }

  function normalizeAchievementsForSave(
    nextAchievements: EditableAchievement[]
  ): FlexibleAchievementInput[] {
    return nextAchievements.map((achievement, index) => {
      const title = achievement.title.trim() || `Nova conquista ${index + 1}`;
      const description = achievement.description.trim();
      const rank = normalizeRank(achievement.difficulty);
      const trophy = achievement.trophy || rankToTrophy(rank);

      return {
        id:
          achievement.id ||
          `${game.slug}-achievement-${index + 1}-${slugify(title)}`,
        title,
        description,
        trophy,
        icon: trophy,
        difficulty: rank,
        rank,
        status: achievement.status,
        image: achievement.image.trim(),
        isCustom: true,
        isHidden: Boolean(achievement.isHidden),
      };
    });
  }

  function buildGameUpdate(
    nextAchievements: EditableAchievement[] = achievements
  ): Partial<SiteGame> {
    const progress = Math.min(100, Math.max(0, Number(form.progress) || 0));
    const normalizedReview = createReviewPayload(review);

    return {
      title: form.title.trim() || game.title,
      subtitle: form.subtitle.trim(),
      status: form.status,
      progress,
      hours: form.hours.trim() || "0h",
      currentObjective: form.currentObjective.trim(),
      objective: form.currentObjective.trim(),
      image: form.image.trim() || getImagePath(game.slug, "banner.jpg"),
      cardImage: form.cardImage.trim() || getImagePath(game.slug, "cover.jpg"),
      emblem: createEmblemPayload(form),
      achievementsList: normalizeAchievementsForSave(nextAchievements),
      review: normalizedReview,
    };
  }

  function persistReviewToLocalStorage() {
    if (typeof window === "undefined") return;

    localStorage.setItem(
      `rumo-a-conquista-review-${game.slug}`,
      JSON.stringify(createReviewPayload(review))
    );

    window.dispatchEvent(new Event(REVIEW_UPDATED_EVENT));
  }

  function removeAchievementFromLocalStorage(title: string) {
    if (typeof window === "undefined") return;

    const statesKey = `rumo-a-conquista-achievements-${game.slug}`;
    const customKey = `rumo-a-conquista-custom-achievements-${game.slug}`;
    const hiddenKey = `rumo-a-conquista-hidden-achievements-${game.slug}`;

    try {
      const savedStates = localStorage.getItem(statesKey);

      if (savedStates) {
        const parsedStates = JSON.parse(savedStates) as Record<string, unknown>;
        delete parsedStates[title];
        localStorage.setItem(statesKey, JSON.stringify(parsedStates));
      }
    } catch {
      // Ignora dados antigos quebrados no localStorage.
    }

    try {
      const savedCustom = localStorage.getItem(customKey);

      if (savedCustom) {
        const parsedCustom = JSON.parse(savedCustom) as FlexibleAchievementInput[];

        const nextCustom = parsedCustom.filter(
          (achievement) => readText(achievement.title, "") !== title
        );

        localStorage.setItem(customKey, JSON.stringify(nextCustom));
      }
    } catch {
      // Ignora dados antigos quebrados no localStorage.
    }

    try {
      const savedHidden = localStorage.getItem(hiddenKey);

      if (savedHidden) {
        const parsedHidden = JSON.parse(savedHidden) as string[];
        const nextHidden = parsedHidden.filter((item) => item !== title);

        localStorage.setItem(hiddenKey, JSON.stringify(nextHidden));
      }
    } catch {
      // Ignora dados antigos quebrados no localStorage.
    }

    window.dispatchEvent(new Event("rumo-a-conquista-achievements-updated"));
    window.dispatchEvent(new Event("rumo-a-conquista-games-updated"));
  }

  function handleRemoveAchievement(index: number) {
    const achievementToRemove = achievements[index];

    if (!achievementToRemove) return;

    const confirmed = window.confirm(
      `Remover a conquista "${achievementToRemove.title}"?`
    );

    if (!confirmed) return;

    const nextAchievements = achievements.filter(
      (_, itemIndex) => itemIndex !== index
    );

    setAchievements(nextAchievements);
    removeAchievementFromLocalStorage(achievementToRemove.title);
    persistReviewToLocalStorage();
    onSave(game.slug, buildGameUpdate(nextAchievements));

    alert("Conquista removida com sucesso.");
  }

  function updateAchievement(
    index: number,
    update: Partial<EditableAchievement>
  ) {
    setAchievements((current) =>
      current.map((achievement, itemIndex) =>
        itemIndex === index
          ? {
              ...achievement,
              ...update,
            }
          : achievement
      )
    );
  }

  function handleUseAchievementImage(
    index: number,
    achievement: EditableAchievement
  ) {
    const safeTitle = achievement.title.trim() || `conquista-${index + 1}`;
    const imageSlug = slugify(safeTitle);

    const imagePath = `/images/games/${game.slug}/achievements/${imageSlug}.png`;

    updateAchievement(index, {
      image: imagePath,
    });
  }

  function handleSaveGame() {
    persistReviewToLocalStorage();
    onSave(game.slug, buildGameUpdate(achievements));

    alert("Jogo salvo com sucesso.");
  }

  function createGameExportCode() {
    const update = buildGameUpdate(achievements);

    const exportedGame = {
      ...game,
      ...update,
      slug: game.slug,
      updatedAt: new Date().toISOString(),
    };

    return `"${game.slug}": ${JSON.stringify(exportedGame, null, 2)},`;
  }

  async function handleExportGame() {
    const exportCode = createGameExportCode();

    try {
      await navigator.clipboard.writeText(exportCode);
      alert(
        "Código oficial do jogo copiado. Use isso quando quiser transformar as alterações do Admin em dados permanentes do site. Cole/substitua este bloco dentro de data/games.ts, rode npm run build e depois faça git add, commit e push."
      );
    } catch {
      window.prompt(
        "Não consegui copiar automaticamente. Copie este bloco e cole/substitua no data/games.ts quando quiser publicar essa alteração oficialmente:",
        exportCode
      );
    }
  }

  function handleRemoveGame() {
    const confirmed = window.confirm(
      `Ocultar/remover "${game.title}" do site?`
    );

    if (!confirmed) return;

    onRemove(game.slug);
  }

  const currentStatus = normalizeGameStatusForFilter(form.status);
  const statusLabel =
    currentStatus === "completed"
      ? "Finalizado"
      : currentStatus === "planned"
      ? "Próxima Maestria"
      : "Em progresso";

  if (!isExpanded) {
    return (
      <article
        id={`admin-game-${game.slug}`}
        className="overflow-hidden rounded-[22px] border border-white/10 bg-zinc-950/75 shadow-xl transition hover:border-red-500/30 hover:bg-red-500/[0.035]"
      >
        <button
          type="button"
          onClick={onToggleExpand}
          className="grid w-full gap-4 p-4 text-left md:grid-cols-[150px_1fr_auto] md:items-center"
        >
          <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-black/40 md:h-[86px] md:aspect-auto">
            <GameImagePreview
              src={form.cardImage || form.image}
              title={form.title || game.title}
              type="cover"
            />

            <div className="absolute left-2 top-2 rounded-full border border-black/30 bg-black/70 px-2 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-white/70">
              Editor
            </div>
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-2xl font-black text-white">
                {form.title || game.title}
              </p>

              <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-red-200">
                {statusLabel}
              </span>
            </div>

            <p className="mt-1 text-xs font-black uppercase tracking-[0.2em] text-red-400">
              {game.slug}
            </p>

            <p className="mt-1 line-clamp-1 text-sm font-bold text-blue-300">
              {form.subtitle || "Sem subtítulo"}
            </p>

            <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-white/50">
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">
                🏆 {completedAchievements}/{achievements.length} conquistas
              </span>

              <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">
                ⏱️ {form.hours || "0h"}
              </span>

              <span
                className={`rounded-full border px-3 py-1 ${
                  emblemCreated
                    ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                    : "border-yellow-400/25 bg-yellow-500/10 text-yellow-200"
                }`}
              >
                {emblemCreated ? "✅ Emblema criado" : "⚠️ Emblema pendente"}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-center">
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/35">
                Abrir
              </p>

              <p className="mt-1 text-2xl font-black text-white">+</p>
            </div>
          </div>
        </button>
      </article>
    );
  }

  return (
    <article id={`admin-game-${game.slug}`} className="overflow-hidden rounded-[28px] border border-white/10 bg-zinc-950/80 shadow-xl">
      <div className="grid lg:grid-cols-[260px_1fr]">
        <div className="relative min-h-[330px] overflow-hidden bg-black/40 p-5">
          <div className="h-[300px] overflow-hidden rounded-[24px] border border-white/10 bg-black/40">
            <GameImagePreview
              src={form.cardImage || form.image}
              title={form.title}
              type="cover"
            />
          </div>

          <div className="absolute left-4 top-4 rounded-full border border-white/10 bg-black/70 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/60">
            Editor
          </div>
        </div>

        <div className="p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.25em] text-red-400">
                {game.slug}
              </p>

              <h3 className="mt-2 text-3xl font-black text-white">
                {form.title || game.title}
              </h3>

              <p className="mt-1 text-sm font-bold text-blue-300">
                {form.subtitle || "Sem subtítulo"}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onToggleExpand}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-black text-white/65 transition hover:border-white/20 hover:text-white"
              >
                Recolher
              </button>

              <button
                type="button"
                onClick={handleSaveGame}
                className="rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-3 text-sm font-black text-emerald-200 transition hover:bg-emerald-500/25"
              >
                Salvar jogo
              </button>

              <button
                type="button"
                onClick={handleExportGame}
                className="rounded-xl border border-yellow-400/30 bg-yellow-500/10 px-4 py-3 text-sm font-black text-yellow-100 transition hover:bg-yellow-500/20"
              >
                Copiar para data/games.ts
              </button>

              <button
                type="button"
                onClick={handleRemoveGame}
                className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-black text-red-200 transition hover:bg-red-500/20"
              >
                Ocultar/remover
              </button>
            </div>
          </div>

          <div className="mt-6 rounded-[22px] border border-yellow-400/20 bg-yellow-500/[0.055] p-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-yellow-200/80">
                  Quando usar “Copiar para data/games.ts”?
                </p>

                <p className="mt-2 text-sm font-bold leading-relaxed text-white/55">
                  Use esse botão apenas quando terminar uma alteração no Admin e quiser
                  transformar ela em dado oficial do projeto, para aparecer para todo
                  mundo no site online.
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-xs font-bold leading-relaxed text-white/45 xl:max-w-[520px]">
                <p>
                  <span className="font-black text-yellow-100">Fluxo:</span>{" "}
                  Salvar jogo → Copiar para data/games.ts → substituir o bloco
                  desse jogo em <span className="font-black text-white">data/games.ts</span>{" "}
                  → npm run build → git add . → commit → push.
                </p>

                <p className="mt-2">
                  Se for só testar visualmente no seu navegador, não precisa copiar
                  para o arquivo oficial.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Nome
              </span>

              <input
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
            </label>

            <label>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Subtítulo
              </span>

              <input
                value={form.subtitle}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    subtitle: event.target.value,
                  }))
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
            </label>

            <label>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Status
              </span>

              <select
                value={form.status}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    status: event.target.value,
                  }))
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              >
                {statusOptions.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Progresso
              </span>

              <input
                type="number"
                min={0}
                max={100}
                value={form.progress}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    progress: Number(event.target.value),
                  }))
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
            </label>

            <label>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Horas
              </span>

              <input
                value={form.hours}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    hours: event.target.value,
                  }))
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
            </label>

            <label className="md:col-span-2 xl:col-span-3">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Objetivo atual
              </span>

              <input
                value={form.currentObjective}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    currentObjective: event.target.value,
                  }))
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
            </label>

            <label className="md:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Banner
              </span>

              <input
                value={form.image}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    image: event.target.value,
                  }))
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
            </label>

            <label className="md:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Capa/Card
              </span>

              <input
                value={form.cardImage}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    cardImage: event.target.value,
                  }))
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
            </label>
          </div>

          <section className="mt-8 rounded-[24px] border border-violet-400/20 bg-violet-500/[0.05] p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.25em] text-violet-300">
                  Emblema do Jogo
                </p>

                <h4 className="mt-2 text-2xl font-black text-white">
                  Editor do emblema
                </h4>

                <p className="mt-1 text-sm text-white/45">
                  Cadastre o nome próprio, imagem e descrição temática do emblema colecionável.
                </p>

                <span
                  className={`mt-3 inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${
                    emblemCreated
                      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                      : "border-yellow-400/30 bg-yellow-500/10 text-yellow-200"
                  }`}
                >
                  {emblemCreated ? "✅ Emblema criado" : "⚠️ Emblema pendente"}
                </span>
              </div>

              <button
                type="button"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    emblemImage: getImagePath(game.slug, "emblem.png"),
                  }))
                }
                className="w-fit rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-5 py-3 text-sm font-black text-cyan-200 transition hover:bg-cyan-500/20"
              >
                Usar caminho padrão do emblema
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <label className="md:col-span-2">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                  Nome do emblema
                </span>

                <input
                  value={form.emblemTitle}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      emblemTitle: event.target.value,
                    }))
                  }
                  placeholder="Ex: Legado Absoluto"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-violet-400/40"
                />
              </label>

              <label className="md:col-span-2">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                  Imagem do emblema
                </span>

                <input
                  value={form.emblemImage}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      emblemImage: event.target.value,
                    }))
                  }
                  placeholder={`/images/games/${game.slug}/emblem.png`}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-violet-400/40"
                />
              </label>

              <label>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                  Data do emblema
                </span>

                <input
                  type="date"
                  value={form.emblemUnlockedAt}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      emblemUnlockedAt: event.target.value,
                    }))
                  }
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-violet-400/40"
                />
              </label>

              <label className="md:col-span-2 xl:col-span-4">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                  Descrição temática do emblema
                </span>

                <textarea
                  value={form.emblemDescription}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      emblemDescription: event.target.value,
                    }))
                  }
                  placeholder="Escreva uma descrição única para o emblema deste jogo."
                  rows={4}
                  className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold leading-relaxed text-white outline-none focus:border-violet-400/40"
                />
              </label>

              <label className="md:col-span-2 xl:col-span-4">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                  Tags do emblema
                </span>

                <textarea
                  value={form.emblemTags}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      emblemTags: event.target.value,
                    }))
                  }
                  placeholder={"Uma tag por linha\nEx: Colecionável\nEmblema Especial\nHogwarts Legacy"}
                  rows={3}
                  className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold leading-relaxed text-white outline-none focus:border-violet-400/40"
                />
              </label>
            </div>
          </section>

          <div className="mt-5 flex flex-wrap justify-end gap-3">
            <Link
              href={`/games/${game.slug}`}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-black text-white/65 transition hover:border-white/20 hover:text-white"
            >
              Abrir página →
            </Link>

            <button
              type="button"
              onClick={handleUseImageDefaults}
              className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-5 py-3 text-sm font-black text-cyan-200 transition hover:bg-cyan-500/20"
            >
              Usar imagens padrão
            </button>
          </div>

          <section className="mt-8 rounded-[24px] border border-red-500/20 bg-red-500/[0.04] p-5">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.25em] text-red-400">
                Review
              </p>

              <h4 className="mt-2 text-2xl font-black text-white">
                Editor da review
              </h4>

              <p className="mt-1 text-sm text-white/45">
                Edite a nota final, análise da jornada e os pontos positivos e negativos.
              </p>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <label>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                  Status da review
                </span>

                <select
                  value={review.status}
                  onChange={(event) =>
                    setReview((current) => ({
                      ...current,
                      status: event.target.value as ReviewStatus,
                    }))
                  }
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
                >
                  {reviewStatusOptions.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                  Nota final
                </span>

                <input
                  value={review.nota}
                  onChange={(event) =>
                    setReview((current) => ({
                      ...current,
                      nota: event.target.value,
                    }))
                  }
                  placeholder="Ex: 8"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
                />
              </label>

              <label>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                  Resumo da nota
                </span>

                <input
                  value={review.resumo}
                  onChange={(event) =>
                    setReview((current) => ({
                      ...current,
                      resumo: event.target.value,
                    }))
                  }
                  placeholder="Ex: Muito bom"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
                />
              </label>

              <label>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                  Título da análise
                </span>

                <input
                  value={review.titulo}
                  onChange={(event) =>
                    setReview((current) => ({
                      ...current,
                      titulo: event.target.value,
                    }))
                  }
                  placeholder="Ex: Análise da Jornada"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
                />
              </label>

              <label className="md:col-span-2 xl:col-span-4">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                  Análise da jornada
                </span>

                <textarea
                  value={review.texto}
                  onChange={(event) =>
                    setReview((current) => ({
                      ...current,
                      texto: event.target.value,
                    }))
                  }
                  placeholder="Escreva aqui sua review completa da jornada."
                  rows={5}
                  className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold leading-relaxed text-white outline-none focus:border-red-500/40"
                />
              </label>

              <label className="md:col-span-2">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                  Pontos positivos
                </span>

                <textarea
                  value={review.pontosPositivos}
                  onChange={(event) =>
                    setReview((current) => ({
                      ...current,
                      pontosPositivos: event.target.value,
                    }))
                  }
                  placeholder={"Um ponto positivo por linha\nEx: Atmosfera excelente"}
                  rows={4}
                  className="mt-2 w-full resize-y rounded-xl border border-emerald-400/20 bg-emerald-500/[0.04] px-4 py-3 text-sm font-bold leading-relaxed text-white outline-none focus:border-emerald-400/40"
                />
              </label>

              <label className="md:col-span-2">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                  Pontos negativos
                </span>

                <textarea
                  value={review.pontosNegativos}
                  onChange={(event) =>
                    setReview((current) => ({
                      ...current,
                      pontosNegativos: event.target.value,
                    }))
                  }
                  placeholder={"Um ponto negativo por linha\nEx: Alguns trechos repetitivos"}
                  rows={4}
                  className="mt-2 w-full resize-y rounded-xl border border-red-500/20 bg-red-500/[0.04] px-4 py-3 text-sm font-bold leading-relaxed text-white outline-none focus:border-red-500/40"
                />
              </label>
            </div>
          </section>

          <section className="mt-8 rounded-[24px] border border-white/10 bg-white/[0.03] p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.25em] text-red-400">
                  Conquistas
                </p>

                <h4 className="mt-2 text-2xl font-black text-white">
                  Editor de conquistas
                </h4>

                <p className="mt-1 text-sm text-white/45">
                  {completedAchievements}/{achievements.length} concluídas
                </p>
              </div>

              <button
                type="button"
                onClick={handleAddAchievement}
                className="rounded-xl border border-red-500/35 bg-red-500/15 px-5 py-3 text-sm font-black text-red-100 transition hover:bg-red-500/25"
              >
                + Adicionar conquista
              </button>
            </div>

            <div className="mt-5 space-y-4">
              {achievements.length > 0 ? (
                achievements.map((achievement, index) => (
                  <article
                    key={achievement.id}
                    className={`rounded-2xl border p-4 transition ${
                      achievement.isHidden
                        ? "border-yellow-400/30 bg-yellow-500/[0.045]"
                        : "border-white/10 bg-black/25"
                    }`}
                  >
                    <div className="grid gap-4 lg:grid-cols-[90px_1fr]">
                      <div className="h-[90px] overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                        <AchievementImagePreview achievement={achievement} />
                      </div>

                      <div>
                        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/35">
                              Conquista {index + 1}
                            </p>

                            <h5 className="mt-1 text-xl font-black text-white">
                              {achievement.title || "Nova conquista"}
                            </h5>

                            {achievement.isHidden && (
                              <span className="mt-2 inline-flex rounded-full border border-yellow-400/30 bg-yellow-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-yellow-200">
                                🙈 Oculta no site
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                updateAchievement(index, {
                                  isHidden: !achievement.isHidden,
                                })
                              }
                              className={`w-fit rounded-xl border px-4 py-2 text-xs font-black transition ${
                                achievement.isHidden
                                  ? "border-yellow-400/35 bg-yellow-500/15 text-yellow-100 hover:bg-yellow-500/25"
                                  : "border-cyan-400/30 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20"
                              }`}
                            >
                              {achievement.isHidden ? "🙈 Oculta" : "👁️ Visível"}
                            </button>

                              <button
                              type="button"
                              onClick={() => handleRemoveAchievement(index)}
                              className="w-fit rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-black text-red-200 transition hover:bg-red-500/20"
                            >
                              Remover conquista
                            </button>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                          <label className="xl:col-span-2">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                              Título
                            </span>

                            <input
                              value={achievement.title}
                              onChange={(event) =>
                                updateAchievement(index, {
                                  title: event.target.value,
                                })
                              }
                              className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
                            />
                          </label>

                          <label>
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                              Rank
                            </span>

                            <select
                              value={achievement.difficulty}
                              onChange={(event) => {
                                const rank = event.target
                                  .value as AchievementRank;

                                updateAchievement(index, {
                                  difficulty: rank,
                                  trophy: rankToTrophy(rank),
                                });
                              }}
                              className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
                            >
                              {rankOptions.map((rank) => (
                                <option key={rank} value={rank}>
                                  {rankToTrophy(rank)} {rank}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label>
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                              Status
                            </span>

                            <select
                              value={achievement.status}
                              onChange={(event) =>
                                updateAchievement(index, {
                                  status: event.target
                                    .value as AchievementStatus,
                                })
                              }
                              className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
                            >
                              {achievementStatusOptions.map((status) => (
                                <option key={status.value} value={status.value}>
                                  {status.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="md:col-span-2 xl:col-span-4">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                              Descrição
                            </span>

                            <input
                              value={achievement.description}
                              onChange={(event) =>
                                updateAchievement(index, {
                                  description: event.target.value,
                                })
                              }
                              className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
                            />
                          </label>

                          <label className="md:col-span-2 xl:col-span-4">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                              Imagem da conquista
                            </span>

                            <input
                              value={achievement.image}
                              onChange={(event) =>
                                updateAchievement(index, {
                                  image: event.target.value,
                                })
                              }
                              placeholder={`/images/games/${game.slug}/achievements/conquista.png`}
                              className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
                            />
                          </label>
                        </div>

                        <div className="mt-4 flex justify-end">
                          <button
                            type="button"
                            onClick={() =>
                              handleUseAchievementImage(index, achievement)
                            }
                            className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-xs font-black text-cyan-200 transition hover:bg-cyan-500/20"
                          >
                            Usar caminho automático da imagem
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                ))
              ) : (
                <div className="rounded-2xl border border-white/10 bg-black/25 p-6 text-sm text-white/45">
                  Nenhuma conquista cadastrada ainda. Clique em{" "}
                  <span className="font-black text-red-200">
                    + Adicionar conquista
                  </span>{" "}
                  para começar.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </article>
  );
}

export default function AdminJogosPage() {
  const {
    gamesList,
    hiddenBaseGames,
    addGame,
    updateGame,
    removeGame,
    restoreGame,
    restoreAllGames,
    deleteGamePermanently,
  } = useSiteGames();

  const [form, setForm] = useState<GameFormInput>(emptyGameForm);

  const [activeFilter, setActiveFilter] = useState<AdminGameFilter>("all");
  const [sortDirection, setSortDirection] = useState<GameSortDirection>("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedGameSlug, setExpandedGameSlug] = useState<string | null>(null);

  const generatedSlug = slugify(form.slug || form.title);

  const gameFilterTabs = useMemo(
    () => [
      {
        label: "Todos",
        value: "all" as AdminGameFilter,
        count: gamesList.length,
      },
      {
        label: "Em progresso",
        value: "progress" as AdminGameFilter,
        count: gamesList.filter(
          (game) => normalizeGameStatusForFilter(game.status) === "progress"
        ).length,
      },
      {
        label: "Finalizados",
        value: "completed" as AdminGameFilter,
        count: gamesList.filter(
          (game) => normalizeGameStatusForFilter(game.status) === "completed"
        ).length,
      },
      {
        label: "Próximas Maestrias",
        value: "planned" as AdminGameFilter,
        count: gamesList.filter(
          (game) => normalizeGameStatusForFilter(game.status) === "planned"
        ).length,
      },
    ],
    [gamesList]
  );

  const filteredGames = useMemo(() => {
    const visibleGames =
      activeFilter === "all"
        ? gamesList
        : gamesList.filter(
            (game) => normalizeGameStatusForFilter(game.status) === activeFilter
          );

    return [...visibleGames].sort((gameA, gameB) => {
      const titleA = readText(gameA.title, "").toLowerCase();
      const titleB = readText(gameB.title, "").toLowerCase();
      const titleComparison = titleA.localeCompare(titleB, "pt-BR", {
        sensitivity: "base",
      });

      return sortDirection === "asc" ? titleComparison : -titleComparison;
    });
  }, [activeFilter, gamesList, sortDirection]);

  const normalizedSearchQuery = normalizeText(searchQuery);

  const searchResults = useMemo(() => {
    if (!normalizedSearchQuery) {
      return [] as SiteGame[];
    }

    return [...gamesList]
      .filter((game) => {
        const searchableText = normalizeText(
          `${readText(game.title, "")} ${readText(game.subtitle, "")} ${readText(
            game.slug,
            ""
          )}`
        );

        return searchableText.includes(normalizedSearchQuery);
      })
      .sort((gameA, gameB) => {
        const titleA = readText(gameA.title, "").toLowerCase();
        const titleB = readText(gameB.title, "").toLowerCase();
        const titleComparison = titleA.localeCompare(titleB, "pt-BR", {
          sensitivity: "base",
        });

        return sortDirection === "asc" ? titleComparison : -titleComparison;
      });
  }, [gamesList, normalizedSearchQuery, sortDirection]);

  const displayedGames = normalizedSearchQuery ? searchResults : filteredGames;

  function handleOpenGame(slug: string) {
    setExpandedGameSlug((current) => (current === slug ? null : slug));

    window.setTimeout(() => {
      document.getElementById(`admin-game-${slug}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 80);
  }

  function fillImageDefaults() {
    const slug = generatedSlug;

    if (!slug) {
      alert("Digite o nome do jogo primeiro.");
      return;
    }

    setForm((current) => ({
      ...current,
      slug,
      image: `/images/games/${slug}/banner.jpg`,
      cardImage: `/images/games/${slug}/cover.jpg`,
      emblemImage: `/images/games/${slug}/emblem.png`,
    }));
  }

  function handleAddGame() {
    const slug = generatedSlug;

    if (!slug) {
      alert("Digite o nome do jogo primeiro.");
      return;
    }

    const success = addGame({
      ...form,
      slug,
      image: form.image || `/images/games/${slug}/banner.jpg`,
      cardImage: form.cardImage || `/images/games/${slug}/cover.jpg`,
      emblemImage: form.emblemImage || `/images/games/${slug}/emblem.png`,
    });

    if (!success) return;

    setExpandedGameSlug(slug);
    setSearchQuery("");
    setForm(emptyGameForm);
  }

  async function handleCopyCommitCommand(message: string) {
    const command = `git commit -m "${message}"`;

    try {
      await navigator.clipboard.writeText(command);
      alert(`Comando copiado:\n\n${command}`);
    } catch {
      window.prompt("Copie este comando:", command);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0b1624_0%,#050505_45%,#020202_100%)] text-white">
      <Navbar />

      <section className="mx-auto w-full max-w-[1500px] px-8 py-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <Link
            href="/"
            className="inline-flex w-fit rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-black text-red-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
          >
            ← Voltar para Home
          </Link>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin/sagas"
              className="inline-flex w-fit rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-black text-white/65 transition hover:border-white/20 hover:text-white"
            >
              Admin Sagas →
            </Link>

            <Link
              href="/biblioteca"
              className="inline-flex w-fit rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-black text-white/65 transition hover:border-white/20 hover:text-white"
            >
              Ver Biblioteca →
            </Link>
          </div>
        </div>

        <header className="mt-8 overflow-hidden rounded-[32px] border border-white/10 bg-zinc-950/80 shadow-xl">
          <div className="relative p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.18),transparent_35%),radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_32%)]" />

            <div className="relative z-10">
              <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
                Admin
              </p>

              <h1 className="mt-3 text-5xl font-black text-white">
                Editor de Jogos
              </h1>

              <p className="mt-3 max-w-[900px] text-sm leading-relaxed text-white/50">
                Adicione, edite, oculte, remova jogos e cadastre conquistas
                completas para cada jornada.
              </p>
            </div>
          </div>
        </header>

        <section className="mt-8 rounded-[28px] border border-cyan-400/15 bg-cyan-500/[0.035] p-6 shadow-xl">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">
                Ajuda rápida
              </p>

              <h2 className="mt-2 text-3xl font-black text-white">
                Frases prontas para Git Commit
              </h2>

              <p className="mt-2 max-w-[850px] text-sm leading-relaxed text-white/50">
                Clique em uma opção para copiar o comando completo. Depois de
                rodar <span className="font-black text-white">npm run build</span>{" "}
                e <span className="font-black text-white">git add .</span>,
                cole o comando no terminal e finalize com{" "}
                <span className="font-black text-white">git push</span>.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-xs font-bold leading-relaxed text-white/45 xl:max-w-[420px]">
              Fluxo seguro: npm run build → git status → git add . → escolher
              uma frase abaixo → colar no terminal → git push.
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {commitMessageOptions.map((message) => (
              <button
                key={message}
                type="button"
                onClick={() => handleCopyCommitCommand(message)}
                className="rounded-2xl border border-cyan-400/20 bg-cyan-500/[0.06] px-4 py-3 text-left text-xs font-black uppercase tracking-[0.12em] text-cyan-100 transition hover:border-cyan-300/40 hover:bg-cyan-500/[0.12]"
              >
                {message}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-8 rounded-[28px] border border-red-500/20 bg-red-500/5 p-6 shadow-xl">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.3em] text-red-300">
              Novo jogo
            </p>

            <h2 className="mt-2 text-3xl font-black text-white">
              + Adicionar jogo
            </h2>

            <p className="mt-2 text-xs leading-relaxed text-white/45">
              Estrutura recomendada:{" "}
              <span className="font-black text-red-200">
                public/images/games/{generatedSlug || "nome-do-jogo"}/banner.jpg
              </span>{" "}
              ,{" "}
              <span className="font-black text-red-200">
                public/images/games/{generatedSlug || "nome-do-jogo"}/cover.jpg
              </span>{" "}
              e{" "}
              <span className="font-black text-red-200">
                public/images/games/{generatedSlug || "nome-do-jogo"}/emblem.png
              </span>
              .
            </p>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Nome do jogo
              </span>

              <input
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    title: event.target.value,
                    slug: current.slug || slugify(event.target.value),
                  }))
                }
                placeholder="Ex: Crisol: Theater of Idols"
                className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
            </label>

            <label>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Slug
              </span>

              <input
                value={form.slug}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    slug: slugify(event.target.value),
                  }))
                }
                placeholder="crisol-theater-of-idols"
                className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
            </label>

            <label>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Subtítulo
              </span>

              <input
                value={form.subtitle}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    subtitle: event.target.value,
                  }))
                }
                placeholder="Ex: Survival Horror"
                className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
            </label>

            <label>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Status
              </span>

              <select
                value={form.status}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    status: event.target.value,
                  }))
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              >
                {statusOptions.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Progresso
              </span>

              <input
                type="number"
                min={0}
                max={100}
                value={form.progress}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    progress: Number(event.target.value),
                  }))
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
            </label>

            <label>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Horas
              </span>

              <input
                value={form.hours}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    hours: event.target.value,
                  }))
                }
                placeholder="27h 54m"
                className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
            </label>

            <label className="md:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Objetivo atual
              </span>

              <input
                value={form.currentObjective}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    currentObjective: event.target.value,
                  }))
                }
                placeholder="Ex: Finalizar conquistas restantes"
                className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
            </label>

            <label className="md:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Banner
              </span>

              <input
                value={form.image}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    image: event.target.value,
                  }))
                }
                placeholder={`/images/games/${generatedSlug || "nome-do-jogo"}/banner.jpg`}
                className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
            </label>

            <label className="md:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Capa/Card
              </span>

              <input
                value={form.cardImage}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    cardImage: event.target.value,
                  }))
                }
                placeholder={`/images/games/${generatedSlug || "nome-do-jogo"}/cover.jpg`}
                className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
            </label>
          </div>

          <section className="mt-6 rounded-[24px] border border-violet-400/20 bg-violet-500/[0.04] p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.25em] text-violet-300">
                  Emblema do Jogo
                </p>

                <h3 className="mt-2 text-2xl font-black text-white">
                  Recompensa colecionável
                </h3>

                <p className="mt-1 text-sm leading-relaxed text-white/45">
                  Cadastre o nome próprio, imagem e descrição temática do emblema
                  que será exibido na página individual do jogo.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  const slug = generatedSlug;

                  if (!slug) {
                    alert("Digite o nome do jogo primeiro.");
                    return;
                  }

                  setForm((current) => ({
                    ...current,
                    emblemImage: `/images/games/${slug}/emblem.png`,
                  }));
                }}
                className="w-fit rounded-xl border border-violet-400/30 bg-violet-500/10 px-5 py-3 text-sm font-black text-violet-200 transition hover:bg-violet-500/20"
              >
                Usar caminho padrão do emblema
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                  Nome do emblema
                </span>

                <input
                  value={form.emblemTitle || ""}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      emblemTitle: event.target.value,
                    }))
                  }
                  placeholder="Ex: Legado Absoluto"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-violet-400/40"
                />
              </label>

              <label>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                  Imagem do emblema
                </span>

                <input
                  value={form.emblemImage || ""}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      emblemImage: event.target.value,
                    }))
                  }
                  placeholder={`/images/games/${generatedSlug || "nome-do-jogo"}/emblem.png`}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-violet-400/40"
                />
              </label>

              <label>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                  Data do emblema
                </span>

                <input
                  type="date"
                  value={form.emblemUnlockedAt || ""}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      emblemUnlockedAt: event.target.value,
                    }))
                  }
                  className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-violet-400/40"
                />
              </label>

              <label className="md:col-span-2">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                  Descrição temática do emblema
                </span>

                <textarea
                  value={form.emblemDescription || ""}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      emblemDescription: event.target.value,
                    }))
                  }
                  placeholder="Escreva uma descrição única para o emblema deste jogo."
                  rows={4}
                  className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold leading-relaxed text-white outline-none focus:border-violet-400/40"
                />
              </label>

              <label className="md:col-span-2">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                  Tags do emblema
                </span>

                <textarea
                  value={form.emblemTags || ""}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      emblemTags: event.target.value,
                    }))
                  }
                  placeholder={"Uma tag por linha\nEx: Colecionável\nEmblema Especial\nHogwarts Legacy"}
                  rows={3}
                  className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-bold leading-relaxed text-white outline-none focus:border-violet-400/40"
                />
              </label>
            </div>
          </section>

          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={fillImageDefaults}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-black text-white/65 transition hover:border-cyan-400/30 hover:bg-cyan-500/10 hover:text-cyan-200"
            >
              Usar caminhos automáticos
            </button>

            <button
              type="button"
              onClick={handleAddGame}
              className="rounded-xl border border-red-500/35 bg-red-500/15 px-6 py-3 text-sm font-black text-red-100 transition hover:bg-red-500/25"
            >
              + Adicionar jogo
            </button>
          </div>
        </section>

        {hiddenBaseGames.length > 0 && (
          <section className="mt-8 rounded-[28px] border border-white/10 bg-zinc-950/80 p-6 shadow-xl">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-white/35">
                  Removidos
                </p>

                <h2 className="mt-2 text-2xl font-black text-white">
                  Jogos ocultados
                </h2>
              </div>

              <button
                type="button"
                onClick={restoreAllGames}
                className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-5 py-3 text-sm font-black text-cyan-200 transition hover:bg-cyan-500/20"
              >
                Restaurar todos
              </button>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              {hiddenBaseGames.map((game) => (
                <div
                  key={game.slug}
                  className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-2"
                >
                  <button
                    type="button"
                    onClick={() => restoreGame(game.slug)}
                    className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-3 text-sm font-black text-cyan-200 transition hover:bg-cyan-500/20"
                  >
                    Restaurar {game.title}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const confirmed = window.confirm(
                        `Excluir definitivamente "${game.title}"?`
                      );

                      if (!confirmed) return;

                      deleteGamePermanently(game.slug);
                    }}
                    className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-black text-red-200 transition hover:bg-red-500/20"
                  >
                    Excluir definitivo
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mt-8">
          <div className="mb-5 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
                Lista
              </p>

              <h2 className="mt-2 text-3xl font-black text-white">
                Jogos cadastrados
              </h2>

              <p className="mt-2 text-sm text-white/45">
                Filtre os jogos por categoria e organize em ordem crescente ou
                decrescente.
              </p>
            </div>

            <div className="flex w-full flex-col gap-3 xl:max-w-[760px] xl:items-end">
              <div className="relative w-full">
                <label className="relative block">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg">
                    🔍
                  </span>

                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Buscar jogo pelo nome, slug ou gênero..."
                    className="w-full rounded-2xl border border-white/10 bg-zinc-950/90 py-4 pl-12 pr-28 text-sm font-bold text-white outline-none transition placeholder:text-white/25 focus:border-red-500/45 focus:bg-black/70"
                  />

                  {searchQuery.trim() ? (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-white/50 transition hover:border-red-500/30 hover:text-red-200"
                    >
                      Limpar
                    </button>
                  ) : null}
                </label>

                {normalizedSearchQuery ? (
                  <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/98 shadow-[0_24px_80px_rgba(0,0,0,0.75)] backdrop-blur-md">
                    {searchResults.length > 0 ? (
                      <div className="max-h-[340px] overflow-y-auto p-2">
                        {searchResults.slice(0, 10).map((game) => (
                          <button
                            key={game.slug}
                            type="button"
                            onClick={() => {
                              setSearchQuery(readText(game.title, ""));
                              handleOpenGame(game.slug);
                            }}
                            className="grid w-full gap-3 rounded-xl p-3 text-left transition hover:bg-red-500/10 md:grid-cols-[76px_1fr_auto] md:items-center"
                          >
                            <div className="h-[48px] overflow-hidden rounded-xl border border-white/10 bg-black/40">
                              <GameImagePreview
                                src={game.cardImage || game.image}
                                title={game.title}
                                type="cover"
                              />
                            </div>

                            <div className="min-w-0">
                              <p className="truncate text-sm font-black text-white">
                                {game.title}
                              </p>

                              <p className="truncate text-xs font-bold text-blue-300/80">
                                {game.subtitle || game.slug}
                              </p>
                            </div>

                            <span className="rounded-full border border-red-500/25 bg-red-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-red-200">
                              Abrir
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="p-5 text-sm font-bold text-white/45">
                        Nenhum jogo encontrado com esse nome.
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                {gameFilterTabs.map((tab) => {
                  const isActive = activeFilter === tab.value;

                  return (
                    <button
                      key={tab.value}
                      type="button"
                      onClick={() => setActiveFilter(tab.value)}
                      className={`rounded-xl border px-4 py-3 text-xs font-black uppercase tracking-[0.16em] transition ${
                        isActive
                          ? "border-red-500/45 bg-red-500/18 text-red-100"
                          : "border-white/10 bg-white/[0.03] text-white/45 hover:border-white/20 hover:text-white"
                      }`}
                    >
                      {tab.label}
                      <span className="ml-2 rounded-full border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-white/60">
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSortDirection("asc")}
                  className={`rounded-xl border px-4 py-3 text-xs font-black uppercase tracking-[0.16em] transition ${
                    sortDirection === "asc"
                      ? "border-cyan-400/35 bg-cyan-500/15 text-cyan-100"
                      : "border-white/10 bg-white/[0.03] text-white/45 hover:border-white/20 hover:text-white"
                  }`}
                >
                  ↑ Crescente
                </button>

                <button
                  type="button"
                  onClick={() => setSortDirection("desc")}
                  className={`rounded-xl border px-4 py-3 text-xs font-black uppercase tracking-[0.16em] transition ${
                    sortDirection === "desc"
                      ? "border-cyan-400/35 bg-cyan-500/15 text-cyan-100"
                      : "border-white/10 bg-white/[0.03] text-white/45 hover:border-white/20 hover:text-white"
                  }`}
                >
                  ↓ Decrescente
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-5">
            {displayedGames.length > 0 ? (
              displayedGames.map((game) => (
                <GameEditorCard
                  key={game.slug}
                  game={game}
                  onSave={updateGame}
                  onRemove={removeGame}
                  isExpanded={expandedGameSlug === game.slug}
                  onToggleExpand={() => handleOpenGame(game.slug)}
                />
              ))
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-sm text-white/45">
                Nenhum jogo encontrado nesta categoria ou busca.
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
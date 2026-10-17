"use client";

// Preview: fluxo de análise visual textual das referências Exophase.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import ImportArtBatchUpload from "./ImportArtBatchUpload";
import TrophyIcon from "@/components/TrophyIcon";

type A = {
  id: string;
  name: string;
  description: string;
  rank: "Bronze" | "Prata" | "Ouro";
  online: boolean;
  momentary: boolean;
  journeySuggestion: boolean;
  journey: boolean;
  notDoing: boolean;
  episode?: string;
  earnedDate?: string;
  earnedNote?: string;
  isCustom?: boolean;
  visualReferenceUrl?: string | null;
  visualBrief?: string;
  image?: string;
  rankReason?: string;
  suggestionSource?: "ia" | "regras";
  status?: "locked" | "progress" | "completed";
};

type PreparationColor = "violet" | "red" | "green" | "blue" | "gray" | "yellow";
type PreparationFilter =
  | "all"
  | "missing-date"
  | "journey"
  | "manual"
  | "color-violet"
  | "color-red"
  | "color-green"
  | "color-blue"
  | "color-gray"
  | "color-yellow";

function getPreparationColor(achievement: A, focused: boolean): PreparationColor {
  if (focused) return "violet";
  if (achievement.notDoing) return "red";
  if (achievement.journey) return "green";

  const hasEpisode = Boolean(achievement.episode?.trim());
  const hasRecord = Boolean(achievement.earnedNote?.trim() || achievement.earnedDate?.trim());
  if ((achievement.isCustom && hasEpisode) || (hasEpisode && hasRecord)) {
    return "blue";
  }

  if (achievement.isCustom) return "gray";
  return "yellow";
}

const PREPARATION_CARD_CLASSES: Record<PreparationColor, string> = {
  violet: "w-full rounded-2xl border border-violet-300/70 bg-violet-500/[.12] p-3 shadow-[0_0_30px_rgba(167,139,250,.12)]",
  red: "w-full rounded-2xl border border-red-500/40 bg-red-500/[.07] p-3",
  green: "w-full rounded-2xl border border-emerald-400/30 bg-emerald-400/[.07] p-3",
  blue: "w-full rounded-2xl border border-blue-400/40 bg-blue-500/[.09] p-3",
  gray: "w-full rounded-2xl border border-zinc-400/25 bg-zinc-500/[.055] p-3",
  yellow: "w-full rounded-2xl border border-yellow-400/25 bg-yellow-400/[.045] p-3",
};

const PREPARATION_COLOR_FILTERS: {
  colorKey: PreparationColor;
  filter: PreparationFilter;
  color: string;
  name: string;
  detail: string;
}[] = [
  { colorKey: "green", filter: "color-green", color: "bg-emerald-400", name: "Verde · Jornada", detail: "Selecionada para a Jornada de Estreia." },
  { colorKey: "blue", filter: "color-blue", color: "bg-blue-400", name: "Azul · EP / registro", detail: "Conquista manual ou registro de obtenção vinculado a EP/data." },
  { colorKey: "gray", filter: "color-gray", color: "bg-zinc-400", name: "Cinza · Manual", detail: "Conquista adicionada manualmente, ainda sem EP vinculado." },
  { colorKey: "yellow", filter: "color-yellow", color: "bg-yellow-400", name: "Amarelo · Fora da Jornada", detail: "Filtra todas as conquistas fora da Jornada de Estreia, mantendo as cores azul e cinza dos cartões." },
  { colorKey: "red", filter: "color-red", color: "bg-red-400", name: "Vermelho · Não fazer", detail: "Fora da publicação enquanto estiver marcada como Não vou fazer." },
  { colorKey: "violet", filter: "color-violet", color: "bg-violet-400", name: "Roxo · Em foco", detail: "Conquista aberta para edição ou análise no momento." },
];

function getPreparationFilterLabel(filter: PreparationFilter) {
  const labels: Record<PreparationFilter, string> = {
    all: "Todas",
    "missing-date": "Sem data",
    journey: "Jornada de Estreia",
    manual: "Conquistas manuais",
    "color-violet": "Roxo · Em foco",
    "color-red": "Vermelho · Não fazer",
    "color-green": "Verde · Jornada",
    "color-blue": "Azul · EP / registro",
    "color-gray": "Cinza · Manual",
    "color-yellow": "Amarelo · Fora da Jornada",
  };
  return labels[filter];
}

function AchievementThumb({ gameSlug, achievement }: { gameSlug?: string; achievement: A }) {
  // Guarda o endereço exato que falhou, não um booleano global.
  // Assim, se o upload vincular uma nova URL depois da primeira falha,
  // o cartão tentará carregar essa nova imagem em vez de continuar na estrela.
  const [failedSource, setFailedSource] = useState("");
  const imageName = slugify(achievement.name || "");
  const imageSrc = achievement.image?.trim()
    ? achievement.image.trim()
    : gameSlug && imageName
      ? `/images/games/${slugify(gameSlug)}/achievements/${imageName}.png`
      : "";

  if (!imageSrc || failedSource === imageSrc) {
    return (
      <div className="flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/30 text-2xl">
        {achievement.isCustom ? "⭐" : "🏆"}
      </div>
    );
  }

  return (
    <div className="h-[68px] w-[68px] shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/30">
      <img
        src={imageSrc}
        alt={`Arte da conquista: ${achievement.name}`}
        className="h-full w-full object-cover"
        loading="lazy"
        onError={() => setFailedSource(imageSrc)}
      />
    </div>
  );
}

type R = {
  game: {
    name: string;
    source: string;
    slug?: string;
    registered?: boolean;
    youtubePlaylistUrl?: string;
    youtubeFirstLiveUrl?: string;
    youtubeFirstLiveEpisode?: string;
    finalBadge?: {
      title?: string;
      icon?: string;
      image?: string;
      description?: string;
    } | null;
    finalMasteryEpisode?: string;
    finalMasteryDate?: string;
    exophase?: {
      found: boolean;
      url: string | null;
      achievementCount?: number;
    };
  };
  achievements: A[];
  warnings?: string[];
};

type DraftListConflict = {
  draftCount: number;
  publishedCount: number;
  publishedOnlyCount: number;
  metadataToImportCount: number;
  publishedAchievements: A[];
  publishedGame: Record<string, unknown>;
};

type Prepared = A & { filename: string; visualConcept: string };

type YouTubePlaylistVideoOption = {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnail: string;
  position: number;
  liveStatus: "live" | "upcoming" | "archived" | "video";
  playlistWatchUrl: string;
};

const CHATGPT_NEW_CONVERSATION_PROMPT = `Você é o responsável pela criação das artes de conquistas do projeto Rumo à Conquista.

Vou fornecer:
1. As instruções completas do lote copiadas diretamente do site.
2. Um ZIP contendo as referências visuais correspondentes às conquistas.

PRIMEIRO, faça somente a análise do material:
- leia todas as instruções;
- analise todas as referências;
- identifique o DNA visual geral;
- transforme cada referência em uma descrição visual textual individual;
- crie um prompt final específico para cada conquista.

NÃO gere imagens durante essa primeira etapa.

Depois de concluir a análise, aguarde meu comando para gerar uma conquista específica.

Quando eu disser, por exemplo:
“GERAR #03”

gere SOMENTE a conquista #03.

REGRAS DA GERAÇÃO:
- 1 conquista = 1 imagem = 1 arquivo;
- 1024 × 1024 px;
- 1:1;
- PNG;
- legibilidade é prioridade absoluta;
- 1 elemento principal dominante;
- poucos elementos secundários;
- composição simples e imediatamente compreensível;
- sem texto, letras, números ou logos;
- sem grade, mosaico, contact sheet, painel ou múltiplas conquistas;
- usar a referência somente como fonte para a descrição visual textual;
- NÃO usar a imagem da referência como input direto para geração;
- criar uma composição nova e independente;
- respeitar rigorosamente a paleta e o DNA visual identificados nas referências;
- não adicionar cores apenas por preferência estética.

IMPORTANTE:
Não tente gerar todas as conquistas automaticamente.
Não repita uma conquista.
Quando eu pedir uma conquista específica, gere exclusivamente aquela conquista.`;

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeAchievementDateInput(value?: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dmy = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function mapPublishedAchievementsForPreparation(
  rows: unknown[],
  gameSlug: string,
  firstJourneyValue: unknown
): A[] {
  const firstJourney =
    firstJourneyValue && typeof firstJourneyValue === "object" && !Array.isArray(firstJourneyValue)
      ? firstJourneyValue as Record<string, unknown>
      : {};
  const metaValue = firstJourney.achievementMeta;
  const achievementMeta =
    metaValue && typeof metaValue === "object" && !Array.isArray(metaValue)
      ? metaValue as Record<string, unknown>
      : {};
  const journeyIds = new Set(
    Array.isArray(firstJourney.achievementIds)
      ? firstJourney.achievementIds.map((id) => String(id ?? "").trim()).filter(Boolean)
      : []
  );

  return rows.filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((raw, index) => {
      const item = raw as Record<string, unknown>;
      const id = String(item.id ?? item.legacy_id ?? `${gameSlug}-published-${index + 1}`).trim();
      const metaRaw = achievementMeta[id];
      const meta =
        metaRaw && typeof metaRaw === "object" && !Array.isArray(metaRaw)
          ? metaRaw as Record<string, unknown>
          : {};
      const rawRank = String(item.rank ?? item.difficulty ?? item.trophy ?? item.icon ?? "").toLocaleLowerCase("pt-BR");
      const rank: A["rank"] =
        rawRank.includes("ouro") || rawRank.includes("gold") || rawRank.includes("🥇")
          ? "Ouro"
          : rawRank.includes("prata") || rawRank.includes("silver") || rawRank.includes("🥈")
            ? "Prata"
            : "Bronze";
      const name = String(item.title ?? item.name ?? `Conquista ${index + 1}`).trim();
      const description = String(item.description ?? "").trim();
      const episode = String(meta.episode ?? item.episode ?? "").trim();
      const dateRaw = String(meta.date ?? "").trim() || String(item.earnedDate ?? item.earned_at ?? "").trim();
      const rawStatus = String(item.status ?? "locked").toLocaleLowerCase("pt-BR");
      const status: A["status"] =
        rawStatus === "completed" || rawStatus === "concluida" || rawStatus === "concluída"
          ? "completed"
          : rawStatus === "progress" || rawStatus === "em progresso"
            ? "progress"
            : "locked";

      return {
        id,
        name,
        description,
        rank,
        online: false,
        momentary: false,
        journeySuggestion: false,
        journey: journeyIds.has(id),
        notDoing: false,
        episode,
        earnedDate: normalizeAchievementDateInput(dateRaw),
        isCustom: Boolean(item.isCustom ?? item.is_custom ?? false),
        image: String(item.image ?? item.image_override ?? "").trim(),
        status,
      };
    })
    .filter((achievement) => Boolean(achievement.id && achievement.name));
}

function sameAchievementIdentity(left: Pick<A, "id" | "name">, right: Pick<A, "id" | "name">) {
  const leftId = String(left.id ?? "").trim();
  const rightId = String(right.id ?? "").trim();
  if (leftId && rightId && leftId === rightId) return true;
  return Boolean(slugify(left.name) && slugify(left.name) === slugify(right.name));
}

function normalizeEpisode(value?: string) {
  const match = String(value ?? "").match(/\d+/);
  if (!match) return "";
  return String(Number(match[0])).padStart(2, "0");
}

function extractYoutubePlaylistId(value?: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    return url.searchParams.get("list")?.trim() ?? "";
  } catch {
    return "";
  }
}

function titleMatchesEpisode(title: string, episode: string) {
  const number = Number(episode);
  if (!Number.isFinite(number)) return false;

  const normalized = String(title ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return (
    new RegExp(
      "(?:^|[^a-z0-9])(ep(?:isodio|isode)?|dia)\\s*#?0*" +
        number +
        "(?!\\d)"
    ).test(normalized) ||
    new RegExp(
      "(?:^|[^a-z0-9])ep0*" + number + "(?!\\d)"
    ).test(normalized)
  );
}

function prepareAchievement(a: A, index: number): Prepared {
  const visualReferenceInstruction = a.visualReferenceUrl
    ? "REFERÊNCIA EXOPHASE: usar exclusivamente como material de análise visual. A referência NÃO é um molde, NÃO deve ser enviada diretamente ao gerador, transformada, redesenhada, recortada, filtrada ou reproduzida. Extraia somente características visuais abstratas e gerais — paleta, contraste, luminosidade, tratamento de sombras, linha/traço, espessura dos contornos, acabamento, textura, atmosfera, ritmo visual, densidade de detalhes e equilíbrio entre figura e fundo — e converta essas características em um brief textual próprio. NÃO reproduza personagens específicos, criaturas reconhecíveis, poses, rostos, roupas características, objetos exclusivos ou distintivos, símbolos específicos, ícones exclusivos, logos, textos, composições reconhecíveis ou enquadramentos idênticos da referência. A arte final deve ser uma composição nova e independente, criada a partir do significado da conquista, do nome, da descrição, do contexto do jogo, do brief visual abstrato e da Matriz Visual Oficial do Rumo à Conquista. Se a referência for monocromática ou usar uma paleta muito restrita, preserve essa característica. NÃO introduza novas cores por preferência estética."
    : "SEM REFERÊNCIA EXOPHASE: criar o brief visual e a arte originalmente a partir do nome, descrição e universo visual do jogo, seguindo a Matriz Visual Oficial do Rumo à Conquista.";

  const baseOutputRules =
    "MATRIZ VISUAL OFICIAL DO RUMO À CONQUISTA: a coleção usa uma linguagem de conquista própria, mas não uma fórmula visual fixa. Cada imagem deve funcionar como um emblema/arte colecionável de leitura imediata, com um foco principal forte, hierarquia clara, acabamento gráfico consistente e composição edge-to-edge. O conteúdo visual deve alcançar os quatro limites da imagem. NUNCA deixar margem, faixa, canvas vazio ou área preta sobrando ao redor da arte. Se houver moldura, ela deve tocar diretamente as quatro bordas e funcionar como parte do desenho; não deve existir uma moldura interna cercada por um campo preto externo. O jogo define os eixos visuais variáveis — paleta, contraste, traço, textura, atmosfera, iluminação, enquadramento e densidade de detalhes — a partir do DNA visual identificado nas referências. UMA conquista = UMA imagem individual. Formato 1:1, preferencialmente 1024x1024. PNG com fundo fechado/opaco, sem transparência externa. Não inserir texto, letras, números ou nomes. Não fazer colagem, painel, mosaico, triptico, contact sheet, grade, sprite sheet ou múltiplas conquistas na mesma imagem. PRIORIDADE ABSOLUTA DE LEGIBILIDADE: a conquista precisa ser entendida à primeira vista e continuar clara quando reduzida. Um elemento principal dominante é obrigatório; usar poucos elementos secundários e somente quando ajudarem a comunicar a conquista. SIMPLIFICAÇÃO INTELIGENTE: poucos elementos bem escolhidos são preferíveis a uma composição confusa. PALETA: respeitar rigorosamente a paleta identificada nas referências; se a linguagem for preto/branco/cinza ou outra paleta restrita, preservá-la e NÃO introduzir vermelho, dourado, azul, verde ou outras cores apenas por preferência estética. ORIGINALIDADE: a referência fornece somente linguagem estética abstrata; a composição final deve ser nova e independente.";

  return {
    ...a,
    filename: `${String(index + 1).padStart(2, "0")}-${slugify(a.name) || "conquista"}.png`,
    visualConcept: a.description
      ? `Crie UMA imagem individual de conquista para "${a.name}". ${baseOutputRules} REGRA DE BORDA: a arte precisa ser desenhada como uma composição completa até os limites do canvas. Não simular uma arte menor colocada sobre um fundo preto maior. ${visualReferenceInstruction} O resultado deve ser uma arte original, específica para esta conquista e coerente com o jogo, sem transformar todas as conquistas em uma fórmula visual única.`
      : `Crie UMA imagem individual de conquista para "${a.name}". ${baseOutputRules} REGRA DE BORDA: a arte precisa ser desenhada como uma composição completa até os limites do canvas. Não simular uma arte menor colocada sobre um fundo preto maior. ${visualReferenceInstruction} O resultado deve ser uma arte original, específica para esta conquista e coerente com o jogo.`,
  };
}

function PrepararJogoPage() {
  const searchParams = useSearchParams();
  const registeredSlug = searchParams.get("slug")?.trim() ?? "";

  const [title, setTitle] = useState("");
  const [result, setResult] = useState<R | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [recoveryStatus, setRecoveryStatus] = useState<{
    state: "idle" | "running" | "success" | "failed";
    progress: number;
    message: string;
    attempts?: number;
  }>({ state: "idle", progress: 0, message: "" });
  const [clearingCompleted, setClearingCompleted] = useState(false);
  const [clearCompletedMessage, setClearCompletedMessage] = useState("");
  const [clearCompletedFailed, setClearCompletedFailed] = useState(false);
  const [batchSize, setBatchSize] = useState(10);
  const [copiedBatch, setCopiedBatch] = useState<number | null>(null);
  const [copiedNewConversationPrompt, setCopiedNewConversationPrompt] = useState(false);
  const [copiedAchievementId, setCopiedAchievementId] = useState<string | null>(null);
  const [downloadingBatch, setDownloadingBatch] = useState<number | null>(null);
  const [analyzingReferences, setAnalyzingReferences] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ done: 0, total: 0 });
  const [manualAchievement, setManualAchievement] = useState("");
  const [manualRank, setManualRank] = useState<"Bronze" | "Prata" | "Ouro">("Bronze");
  const [generatingManualAchievement, setGeneratingManualAchievement] = useState(false);
  const [manualSuggestionNotice, setManualSuggestionNotice] = useState("");
  const [rewritingAchievementId, setRewritingAchievementId] = useState<string | null>(null);
  const [achievementRewriteNotices, setAchievementRewriteNotices] = useState<Record<string, string>>({});
  const [preparationMode, setPreparationMode] = useState<"edit" | "append">("edit");
  const [preparationModeNotice, setPreparationModeNotice] = useState("");
  const [needsDraftSnapshotUpgrade, setNeedsDraftSnapshotUpgrade] = useState(false);
  const draftSnapshotUpgradeStarted = useRef(false);
  const preloadedDraftSlugRef = useRef<string | null>(null);
  const [draftListConflict, setDraftListConflict] = useState<DraftListConflict | null>(null);
  const [registeredOutsideAchievements, setRegisteredOutsideAchievements] = useState<A[]>([]);
  const [registeredRecordsDirty, setRegisteredRecordsDirty] = useState(false);
  const [registeredRecordsSaving, setRegisteredRecordsSaving] = useState(false);
  const [registeredRecordsMessage, setRegisteredRecordsMessage] = useState("");
  const [finalMasteryRecordSaving, setFinalMasteryRecordSaving] = useState(false);
  const [finalMasteryRecordMessage, setFinalMasteryRecordMessage] = useState("");
  const [similarCandidates, setSimilarCandidates] = useState<
    { achievement: A; score: number }[]
  >([]);
  const [showSimilarity, setShowSimilarity] = useState(false);
  const [mergeCandidate, setMergeCandidate] = useState<A | null>(null);
  const [mergeTitle, setMergeTitle] = useState("");
  const [mergeDescription, setMergeDescription] = useState("");
  const [journeyPreparedCount, setJourneyPreparedCount] = useState<number | null>(null);
  const [journeyAnalysisLoading, setJourneyAnalysisLoading] = useState(false);
  const [journeyStartEpisode, setJourneyStartEpisode] = useState("");
  const [journeyEpisodeSaving, setJourneyEpisodeSaving] = useState(false);
  const [journeyLiveOptions, setJourneyLiveOptions] = useState<YouTubePlaylistVideoOption[]>([]);
  const [journeyLiveLoading, setJourneyLiveLoading] = useState(false);
  const [journeyLiveError, setJourneyLiveError] = useState("");
  const [journeyLiveSelecting, setJourneyLiveSelecting] = useState(false);
  const [journeySelectedLive, setJourneySelectedLive] =
    useState<YouTubePlaylistVideoOption | null>(null);
  const [expandedRecordIds, setExpandedRecordIds] = useState<Set<string>>(new Set());
  const [realizedDescription, setRealizedDescription] = useState("");
  const [realizedEpisode, setRealizedEpisode] = useState("");
  const [realizedDate, setRealizedDate] = useState("");
  const [realizedRank, setRealizedRank] = useState<"Bronze" | "Prata" | "Ouro">("Bronze");
  const [realizedCandidates, setRealizedCandidates] = useState<
    { achievement: A; score: number }[]
  >([]);
  const [showRealizedMatches, setShowRealizedMatches] = useState(false);
  const [focusedAchievementId, setFocusedAchievementId] = useState<string | null>(null);
  const [preparationFilter, setPreparationFilter] = useState<PreparationFilter>("all");
  const [collapsedPrepItems, setCollapsedPrepItems] = useState<Record<string, boolean>>({});
  const hasConfiguredFinalMastery = Boolean(
    result?.game.finalBadge?.title?.trim() ||
    result?.game.finalBadge?.image?.trim() ||
    result?.game.finalBadge?.description?.trim()
  );
  const finalMasteryNeedsDate =
    hasConfiguredFinalMastery && !String(result?.game.finalMasteryDate ?? "").trim();
  const showFinalMasteryInPreparationList =
    hasConfiguredFinalMastery &&
    (preparationFilter === "all" ||
      (preparationFilter === "missing-date" && finalMasteryNeedsDate));

  function togglePrepItem(key: string) {
    setCollapsedPrepItems((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  const selected = useMemo(
    () =>
      result?.achievements
        .filter((a) => !a.notDoing)
        .map((a, index) => prepareAchievement(a, index)) ?? [],
    [result]
  );

  const manualSelected = useMemo(
    () =>
      selected
        .filter((achievement) => achievement.isCustom)
        .map((achievement) => ({
          ...achievement,
          filename: "manual-" + (slugify(achievement.name) || slugify(achievement.id)) + ".png",
        })),
    [selected]
  );

  const rankCounts = useMemo(() => {
    const counts = { Bronze: 0, Prata: 0, Ouro: 0 };

    for (const achievement of result?.achievements ?? []) {
      if (!achievement.notDoing) counts[achievement.rank] += 1;
    }

    return counts;
  }, [result]);

  const preparationCounts = useMemo(() => {
    const colors: Record<PreparationColor, number> = {
      violet: 0,
      red: 0,
      green: 0,
      blue: 0,
      gray: 0,
      yellow: 0,
    };
    let missingDate = 0;
    let journey = 0;
    let manual = 0;
    const achievements = result?.achievements ?? [];

    for (const achievement of achievements) {
      colors[getPreparationColor(achievement, focusedAchievementId === achievement.id)] += 1;

      // As conquistas da Jornada não precisam de uma data individual; não entram em "Sem data".
      if (
        !achievement.notDoing &&
        !achievement.journey &&
        !String(achievement.earnedDate ?? "").trim()
      ) {
        missingDate += 1;
      }
      if (!achievement.notDoing && achievement.journey) journey += 1;
      if (achievement.isCustom) manual += 1;
    }

    const outsideJourney = achievements.filter(
      (achievement) => !achievement.notDoing && !achievement.journey
    ).length;

    if (finalMasteryNeedsDate) missingDate += 1;
    return {
      colors,
      missingDate,
      journey,
      manual,
      outsideJourney,
      total: achievements.length + (hasConfiguredFinalMastery ? 1 : 0),
    };
  }, [result, focusedAchievementId, finalMasteryNeedsDate, hasConfiguredFinalMastery]);

  const filteredPreparationAchievements = useMemo(() => {
    const achievements = result?.achievements ?? [];
    return achievements
      .filter((achievement) => {
        if (preparationFilter === "all") return true;
        if (preparationFilter === "missing-date") {
          return (
            !achievement.notDoing &&
            !achievement.journey &&
            !String(achievement.earnedDate ?? "").trim()
          );
        }
        if (preparationFilter === "journey") {
          return !achievement.notDoing && Boolean(achievement.journey);
        }
        if (preparationFilter === "manual") return Boolean(achievement.isCustom);
        if (preparationFilter === "color-yellow") {
          return !achievement.notDoing && !achievement.journey;
        }

        const color = preparationFilter.replace("color-", "") as PreparationColor;
        return getPreparationColor(achievement, focusedAchievementId === achievement.id) === color;
      })
      .sort((a, b) => Number(Boolean(b.isCustom)) - Number(Boolean(a.isCustom)));
  }, [result, preparationFilter, focusedAchievementId]);

  const publicationStatus = useMemo(() => {
    if (!result) {
      return {
        ready: false,
        total: 0,
        selected: 0,
        missingDescriptions: 0,
        reason: "Carregue o jogo para iniciar a preparação.",
      };
    }

    const publishable = result.achievements.filter((a) => !a.notDoing);
    const missingDescriptions = publishable.filter((a) => !a.description.trim()).length;
    const ready =
      Boolean(result.game.slug) &&
      Boolean(result.game.exophase?.found) &&
      publishable.length > 0 &&
      missingDescriptions === 0 &&
      saved;

    return {
      ready,
      total: result.achievements.length,
      selected: publishable.length,
      missingDescriptions,
      reason: !saved
        ? "Salve o rascunho antes de publicar."
        : missingDescriptions > 0
          ? `${missingDescriptions} conquista(s) ainda estão sem descrição.`
          : "Pronto para publicar as conquistas.",
    };
  }, [result, saved]);

  async function runAutomaticPreparationRecovery(
    gameSlug: string,
    gameTitle: string,
    previousSourceUrl?: string
  ): Promise<boolean> {
    setRecoveryStatus({
      state: "running",
      progress: 0,
      message: "Falha detectada. Iniciando tentativas automáticas de correção.",
    });
    setError("");

    try {
      const query = new URLSearchParams({ autoRecover: "1" });
      if (gameSlug) query.set("slug", gameSlug);
      else query.set("title", gameTitle);
      if (previousSourceUrl) query.set("previousUrl", previousSourceUrl);

      const response = await fetch("/api/admin/achievement-prep?" + query.toString(), {
        cache: "no-store",
        headers: { Accept: "application/x-ndjson" },
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Não consegui iniciar a correção automática.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      let succeeded = false;

      const handleEvent = (event: Record<string, unknown>) => {
        const type = String(event.type || "");
        if (type === "progress") {
          setRecoveryStatus({
            state: "running",
            progress: Math.max(0, Math.min(99, Number(event.progress ?? 0))),
            message: String(event.message || "Tentando corrigir automaticamente..."),
            attempts: Number.isFinite(Number(event.attempts)) ? Number(event.attempts) : undefined,
          });
          return;
        }

        if (type === "success") {
          const recoveredResult = event.result as R | undefined;
          if (!recoveredResult || !Array.isArray(recoveredResult.achievements)) {
            setRecoveryStatus({
              state: "failed",
              progress: 95,
              message: "A leitura terminou, mas a resposta não continha uma lista válida de conquistas.",
            });
            setError("A correção automática não retornou uma lista válida. Nenhuma lista publicada foi alterada.");
            completed = true;
            return;
          }

          setResult(recoveredResult);
          setJourneyStartEpisode(
            String(recoveredResult.game?.youtubeFirstLiveEpisode ?? "").trim()
          );
          setError("");
          setRecoveryStatus({
            state: "success",
            progress: 100,
            message: String(event.message || "Erro corrigido automaticamente."),
            attempts: Number.isFinite(Number(event.attempts)) ? Number(event.attempts) : undefined,
          });
          completed = true;
          succeeded = true;
          return;
        }

        if (type === "failed") {
          const message = String(
            event.error ||
            "Todas as tentativas automáticas terminaram sem conseguir recuperar a lista."
          );
          setError(message);
          setRecoveryStatus({
            state: "failed",
            progress: Math.max(90, Math.min(95, Number(event.progress ?? 95))),
            message: String(event.message || "A recuperação automática não conseguiu resolver o problema."),
            attempts: Number.isFinite(Number(event.attempts)) ? Number(event.attempts) : undefined,
          });
          completed = true;
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            handleEvent(JSON.parse(line) as Record<string, unknown>);
          } catch {
            // Ignora apenas um pacote malformado; a próxima mensagem pode continuar a recuperação.
          }
        }
        if (completed) {
          try { await reader.cancel(); } catch { /* stream já encerrado */ }
          break;
        }
      }

      if (!completed && buffer.trim()) {
        try {
          handleEvent(JSON.parse(buffer) as Record<string, unknown>);
        } catch {
          // A resposta terminou sem um último evento legível.
        }
      }

      if (!completed) {
        setRecoveryStatus({
          state: "failed",
          progress: 95,
          message: "A conexão terminou antes de o preparador confirmar a recuperação.",
        });
        setError("A recuperação foi interrompida antes de confirmar uma lista válida. Tente novamente; os dados existentes foram preservados.");
      }

      return succeeded;
    } catch (recoveryError) {
      const message = recoveryError instanceof Error
        ? recoveryError.message
        : "Falha inesperada durante a correção automática.";
      setError(message);
      setRecoveryStatus({
        state: "failed",
        progress: 95,
        message: "Não foi possível concluir a recuperação automática nesta tentativa. Nenhuma lista publicada foi substituída.",
      });
      return false;
    }
  }

  async function search(
    gameSlug = registeredSlug,
    gameTitle = title,
    options: { forceFresh?: boolean } = {}
  ) {
    setDraftListConflict(null);
    setRegisteredOutsideAchievements([]);
    setRegisteredRecordsDirty(false);
    setRegisteredRecordsMessage("");
    setJourneyPreparedCount(null);
    setExpandedRecordIds(new Set());
    setRealizedDescription("");
    setRealizedEpisode("");
    setRealizedDate("");
    setRealizedRank("Bronze");
    setRealizedCandidates([]);
    setShowRealizedMatches(false);
    setJourneySelectedLive(null);
    setJourneyLiveOptions([]);
    setJourneyLiveSelecting(false);
    setJourneyLiveError("");
    if (!gameSlug && !gameTitle.trim()) {
      setError("Selecione um jogo cadastrado ou digite o nome de um jogo novo.");
      return;
    }

    setLoading(true);
    setError("");
    setRecoveryStatus({ state: "idle", progress: 0, message: "" });
    let automaticRecoveryAttempted = false;

    try {
      // Ao abrir um jogo já preparado, use primeiro o snapshot completo.
      // Assim não consultamos o Exophase nem substituímos a lista editada.
      if (gameSlug && !options.forceFresh) {
        let draftResponse: Response;
        let draftPayload: { found?: boolean; draft?: Record<string, unknown>; error?: string };
        try {
          draftResponse = await fetch(
            "/api/admin/achievement-prep-draft?slug=" + encodeURIComponent(gameSlug),
            { cache: "no-store" }
          );
          draftPayload = await draftResponse.json();
        } catch {
          throw new Error("Não consegui verificar o rascunho salvo. Nenhuma análise foi refeita; tente novamente.");
        }

        if (!draftResponse.ok) {
          throw new Error(draftPayload.error || "Não consegui verificar o rascunho salvo. Nenhuma análise foi refeita.");
        }

        const draft = draftPayload.found ? draftPayload.draft : undefined;
        const savedGame = draft?.preparedGame;
        const savedAchievements = draft?.preparedAchievements;
        if (
          savedGame &&
          typeof savedGame === "object" &&
          Array.isArray(savedAchievements)
        ) {
          const savedGameRecord = savedGame as R["game"];
          let liveGameRecord: Record<string, unknown> | null = null;
          try {
            const liveGamesResponse = await fetch("/api/admin/games", { cache: "no-store" });
            const liveGamesPayload = await liveGamesResponse.json().catch(() => null);
            if (liveGamesResponse.ok && Array.isArray(liveGamesPayload?.games)) {
              liveGameRecord =
                liveGamesPayload.games.find(
                  (game: { slug?: unknown }) => String(game.slug || "") === gameSlug
                ) ?? null;
            }
          } catch {
            // O rascunho continua sendo carregado mesmo se a consulta auxiliar falhar.
          }

          const liveFirstJourney =
            liveGameRecord?.firstJourney &&
            typeof liveGameRecord.firstJourney === "object"
              ? liveGameRecord.firstJourney as Record<string, unknown>
              : {};
          const liveAchievementMeta =
            liveFirstJourney.achievementMeta &&
            typeof liveFirstJourney.achievementMeta === "object"
              ? liveFirstJourney.achievementMeta as Record<string, unknown>
              : {};
          const liveMasteryMetaRaw =
            liveAchievementMeta[gameSlug + "-final-mastery"];
          const liveMasteryMeta =
            liveMasteryMetaRaw && typeof liveMasteryMetaRaw === "object"
              ? liveMasteryMetaRaw as Record<string, unknown>
              : {};
          const liveFinalBadge =
            liveGameRecord?.finalBadge ?? liveGameRecord?.final_badge;

          const publishedRows = Array.isArray(liveGameRecord?.achievementsList)
            ? liveGameRecord.achievementsList as Record<string, unknown>[]
            : null;
          const publishedAchievements = mapPublishedAchievementsForPreparation(
            publishedRows ?? [],
            gameSlug,
            liveFirstJourney
          );
          const draftAchievements = savedAchievements as A[];
          const savedRegisteredRecords = Array.isArray(draft?.registeredAchievementRecords)
            ? draft.registeredAchievementRecords as A[]
            : [];
          const hasIdentity = (left: A, right: A) => sameAchievementIdentity(left, right);
          const publishedOnlyAchievements = publishedAchievements.filter(
            (published) => !draftAchievements.some((draftAchievement) => hasIdentity(draftAchievement, published))
          );
          const metadataToImportCount = publishedAchievements.filter((published) => {
            const existing = draftAchievements.find((draftAchievement) => hasIdentity(draftAchievement, published));
            if (!existing) return false;
            return Boolean(
              (!String(existing.episode ?? "").trim() && String(published.episode ?? "").trim()) ||
              (!String(existing.earnedDate ?? "").trim() && String(published.earnedDate ?? "").trim())
            );
          }).length;
          const reconciledDraftAchievements = draftAchievements.map((draftAchievement) => {
            const published = publishedAchievements.find((item) => hasIdentity(draftAchievement, item));
            if (!published) return draftAchievement;
            return {
              ...draftAchievement,
              episode: String(draftAchievement.episode ?? "").trim()
                ? draftAchievement.episode
                : published.episode ?? "",
              earnedDate: String(draftAchievement.earnedDate ?? "").trim()
                ? draftAchievement.earnedDate
                : published.earnedDate ?? "",
              image: String(draftAchievement.image ?? "").trim()
                ? draftAchievement.image
                : published.image ?? "",
              status: draftAchievement.status ?? published.status,
            };
          });
          const registeredOutsideWithDraftValues = publishedOnlyAchievements.map((published) => {
            const savedRecord = savedRegisteredRecords.find((record) => hasIdentity(record, published));
            if (!savedRecord) return published;
            return {
              ...published,
              ...savedRecord,
              id: published.id,
              name: published.name,
              description: published.description,
              image: published.image || savedRecord.image || "",
              episode: typeof savedRecord.episode === "string" ? savedRecord.episode : published.episode ?? "",
              earnedDate: typeof savedRecord.earnedDate === "string"
                ? normalizeAchievementDateInput(savedRecord.earnedDate)
                : published.earnedDate ?? "",
            };
          });
          const listsDiffer =
            publishedRows !== null &&
            (publishedOnlyAchievements.length > 0 || metadataToImportCount > 0);

          setRegisteredOutsideAchievements(registeredOutsideWithDraftValues);
          setRegisteredRecordsDirty(false);
          setRegisteredRecordsMessage("");


          preloadedDraftSlugRef.current = gameSlug;
          setResult({
            game: {
              ...savedGameRecord,
              finalBadge: savedGameRecord.finalBadge ?? (
                liveFinalBadge && typeof liveFinalBadge === "object"
                  ? liveFinalBadge as NonNullable<R["game"]["finalBadge"]>
                  : null
              ),
              finalMasteryEpisode:
                typeof savedGameRecord.finalMasteryEpisode === "string"
                  ? savedGameRecord.finalMasteryEpisode
                  : String(liveMasteryMeta.episode ?? ""),
              finalMasteryDate:
                typeof savedGameRecord.finalMasteryDate === "string"
                  ? savedGameRecord.finalMasteryDate
                  : String(liveMasteryMeta.date ?? ""),
            },
            achievements: reconciledDraftAchievements,
            warnings: Array.isArray(draft?.preparedWarnings)
              ? draft.preparedWarnings as string[]
              : [],
          });
          setJourneyStartEpisode(
            String((savedGame as R["game"]).youtubeFirstLiveEpisode || "")
          );
          setDraftUpdatedAt(
            typeof draft?.updatedAt === "string" ? draft.updatedAt : null
          );
          setSaved(metadataToImportCount === 0);
          setPreparationMode("edit");
          setPreparationModeNotice(
            metadataToImportCount > 0
              ? `${metadataToImportCount} conquista(s) receberam EP/data que já estavam cadastrados no site. Salve o rascunho quando terminar de revisar.`
              : "Preparação existente carregada. A lista foi mantida sem refazer a análise."
          );
          if (listsDiffer && liveGameRecord && publishedRows !== null) {
            setDraftListConflict({
              draftCount: draftAchievements.length,
              publishedCount: publishedAchievements.length,
              publishedOnlyCount: publishedOnlyAchievements.length,
              metadataToImportCount,
              publishedAchievements,
              publishedGame: liveGameRecord,
            });
          } else {
            setDraftListConflict(null);
          }
          return;
        }
      }

      setSaved(false);
      setResult(null);

      const query = gameSlug
        ? "slug=" + encodeURIComponent(gameSlug)
        : "title=" + encodeURIComponent(gameTitle);

      const response = await fetch(
        "/api/admin/achievement-prep?" + query,
        { cache: "no-store" }
      );
      const payload = await response.json();

      if (response.ok) {
        setJourneyStartEpisode(
          payload.game?.youtubeFirstLiveEpisode?.trim() ?? ""
        );
        setResult(payload);
        return;
      }

      if (
        response.status >= 500 ||
        payload?.browserFallbackAvailable ||
        payload?.recoverySuggested === true
      ) {
        automaticRecoveryAttempted = true;
        await runAutomaticPreparationRecovery(
          gameSlug,
          gameTitle,
          typeof payload?.exophaseUrl === "string" ? payload.exophaseUrl : undefined
        );
        return;
      }

      throw new Error(payload.error || "Erro na busca.");
    } catch (e) {
      if (!automaticRecoveryAttempted && (gameSlug || gameTitle.trim())) {
        automaticRecoveryAttempted = true;
        await runAutomaticPreparationRecovery(gameSlug, gameTitle);
        return;
      }
      setError(e instanceof Error ? e.message : "Erro na busca.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (registeredSlug) {
      void search(registeredSlug);
    }
    // A rota usa o slug como fonte de verdade quando o jogo já está cadastrado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registeredSlug]);

  useEffect(() => {
    const slug = result?.game.slug ?? "";
    if (!slug) return;
    if (preloadedDraftSlugRef.current === slug) {
      preloadedDraftSlugRef.current = null;
      return;
    }

    let cancelled = false;

    async function loadDraft() {
      try {
        const response = await fetch(
          "/api/admin/achievement-prep-draft?slug=" + encodeURIComponent(slug),
          { cache: "no-store" }
        );
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Erro ao carregar rascunho.");

        if (!cancelled && payload.found && payload.draft) {
          const draft = payload.draft as Record<string, unknown>;

          // Versão nova do rascunho: a lista inteira é a fonte da verdade.
          // Não mesclar com Exophase, porque isso pode ressuscitar/remover itens.
          if (
            draft.preparedGame &&
            typeof draft.preparedGame === "object" &&
            Array.isArray(draft.preparedAchievements)
          ) {
            const snapshotGame = draft.preparedGame as R["game"];
            setResult((current) =>
              current
                ? {
                    ...current,
                    game: {
                      ...current.game,
                      ...snapshotGame,
                      finalBadge: snapshotGame.finalBadge ?? current.game.finalBadge,
                      finalMasteryEpisode:
                        typeof snapshotGame.finalMasteryEpisode === "string"
                          ? snapshotGame.finalMasteryEpisode
                          : current.game.finalMasteryEpisode ?? "",
                      finalMasteryDate:
                        typeof snapshotGame.finalMasteryDate === "string"
                          ? snapshotGame.finalMasteryDate
                          : current.game.finalMasteryDate ?? "",
                    },
                    achievements: draft.preparedAchievements as A[],
                    warnings: Array.isArray(draft.preparedWarnings)
                      ? draft.preparedWarnings as string[]
                      : current.warnings,
                  }
                : current
            );
            setDraftUpdatedAt(typeof draft.updatedAt === "string" ? draft.updatedAt : null);
            setSaved(true);
            return;
          }

          // Compatibilidade com os rascunhos anteriores, que guardavam apenas
          // a organização e as conquistas manuais, não a lista inteira.
          const journeyFinalized = draft.journeyFinalized === true;
          const savedJourneyIds = Array.isArray(draft.journeyIds)
            ? draft.journeyIds.map((id) => String(id))
            : [];
          const savedNotDoingIds = Array.isArray(draft.notDoingIds)
            ? draft.notDoingIds.map((id) => String(id))
            : [];
          const journeyIds = journeyFinalized
            ? new Set<string>()
            : new Set<string>(savedJourneyIds);
          const notDoingIds = new Set<string>(savedNotDoingIds);
          const visualBriefs =
            draft.visualBriefs && typeof draft.visualBriefs === "object" && !Array.isArray(draft.visualBriefs)
              ? (draft.visualBriefs as Record<string, string>)
              : {};
          const episodeById =
            draft.episodeById && typeof draft.episodeById === "object" && !Array.isArray(draft.episodeById)
              ? (draft.episodeById as Record<string, string>)
              : {};
          const earnedDateById =
            draft.earnedDateById && typeof draft.earnedDateById === "object" && !Array.isArray(draft.earnedDateById)
              ? (draft.earnedDateById as Record<string, string>)
              : {};
          const earnedNoteById =
            draft.earnedNoteById && typeof draft.earnedNoteById === "object" && !Array.isArray(draft.earnedNoteById)
              ? (draft.earnedNoteById as Record<string, string>)
              : {};
          const customAchievements: A[] = Array.isArray(draft.customAchievements)
            ? (draft.customAchievements as A[])
            : [];

          setResult((current) =>
            current
              ? {
                  ...current,
                  achievements: [
                    ...current.achievements
                      .filter((a) => !customAchievements.some((custom) => custom.id === a.id))
                      .map((a) => {
                        const isJourney =
                          journeyIds.has(a.id) && !notDoingIds.has(a.id);
                        const globalEpisode = normalizeEpisode(
                          current.game.youtubeFirstLiveEpisode
                        );

                        return {
                          ...a,
                          journey: journeyFinalized ? false : isJourney,
                          journeySuggestion: journeyFinalized
                            ? false
                            : a.journeySuggestion,
                          notDoing: notDoingIds.has(a.id),
                          visualBrief: visualBriefs[a.id] ?? a.visualBrief ?? "",
                          episode:
                            isJourney && globalEpisode
                              ? "EP " + globalEpisode
                              : episodeById[a.id] ?? a.episode ?? "",
                          earnedDate: earnedDateById[a.id] ?? a.earnedDate ?? "",
                          earnedNote: earnedNoteById[a.id] ?? a.earnedNote ?? "",
                        };
                      }),
                    ...customAchievements,
                  ],
                }
              : current
          );
          setDraftUpdatedAt(typeof draft.updatedAt === "string" ? draft.updatedAt : null);
          setSaved(true);
          // Migra automaticamente o rascunho antigo após mesclar a lista
          // Exophase com as conquistas manuais e os metadados salvos.
          setNeedsDraftSnapshotUpgrade(true);
        } else if (!cancelled) {
          // Migração de preparações antigas salvas no navegador.
          const raw = localStorage.getItem(`rumo-preparador:${slug}`);
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              const journeyIds = new Set<string>(
                Array.isArray(parsed) ? parsed : parsed.journeyIds ?? []
              );
              const notDoingIds = new Set<string>(
                Array.isArray(parsed) ? [] : parsed.notDoingIds ?? []
              );
              const customAchievements: A[] = Array.isArray(parsed)
                ? []
                : parsed.customAchievements ?? [];

              setResult((current) =>
                current
                  ? {
                      ...current,
                      achievements: [
                        ...current.achievements
                          .filter((a) => !customAchievements.some((custom) => custom.id === a.id))
                          .map((a) => ({
                            ...a,
                            journey: journeyIds.has(a.id) && !notDoingIds.has(a.id),
                            notDoing: notDoingIds.has(a.id),
                          })),
                        ...customAchievements,
                      ],
                    }
                  : current
              );
            } catch {
              localStorage.removeItem(`rumo-preparador:${slug}`);
            }
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erro ao carregar rascunho.");
      } finally {
        if (!cancelled) setDraftLoading(false);
      }
    }

    void loadDraft();
    return () => {
      cancelled = true;
    };
  }, [result?.game.slug]);

  useEffect(() => {
    const gameSlug = result?.game.slug ?? "";
    if (!gameSlug) return;

    let cancelled = false;
    async function loadPublishedAchievementsOutsidePreparation() {
      try {
        const [gamesResponse, draftResponse] = await Promise.all([
          fetch("/api/admin/games", { cache: "no-store" }),
          fetch("/api/admin/achievement-prep-draft?slug=" + encodeURIComponent(gameSlug), { cache: "no-store" }),
        ]);
        const gamesPayload = await gamesResponse.json().catch(() => null);
        const draftPayload = await draftResponse.json().catch(() => null);
        if (cancelled || !gamesResponse.ok || !Array.isArray(gamesPayload?.games)) return;

        const liveGame =
          gamesPayload.games.find((game: { slug?: unknown }) => String(game.slug ?? "") === gameSlug) as Record<string, unknown> | undefined;
        if (!liveGame || !Array.isArray(liveGame.achievementsList)) return;

        const currentDraft =
          draftPayload?.found && draftPayload?.draft && typeof draftPayload.draft === "object"
            ? draftPayload.draft as Record<string, unknown>
            : {};
        const draftAchievements = Array.isArray(currentDraft.preparedAchievements)
          ? currentDraft.preparedAchievements as A[]
          : result?.achievements ?? [];
        const published = mapPublishedAchievementsForPreparation(
          liveGame.achievementsList,
          gameSlug,
          liveGame.firstJourney
        );
        const outside = published.filter(
          (achievement) => !draftAchievements.some((draftAchievement) => sameAchievementIdentity(draftAchievement, achievement))
        );
        const savedRecords = Array.isArray(currentDraft.registeredAchievementRecords)
          ? currentDraft.registeredAchievementRecords as A[]
          : [];
        const outsideWithDraftValues = outside.map((achievement) => {
          const savedRecord = savedRecords.find((record) => sameAchievementIdentity(record, achievement));
          if (!savedRecord) return achievement;
          return {
            ...achievement,
            ...savedRecord,
            id: achievement.id,
            name: achievement.name,
            description: achievement.description,
            image: achievement.image || savedRecord.image || "",
            episode: typeof savedRecord.episode === "string" ? savedRecord.episode : achievement.episode ?? "",
            earnedDate: typeof savedRecord.earnedDate === "string"
              ? normalizeAchievementDateInput(savedRecord.earnedDate)
              : achievement.earnedDate ?? "",
          };
        });
        if (cancelled) return;
        setRegisteredOutsideAchievements(outsideWithDraftValues);

        const hasPublishedMetadataToImport = published.some((achievement) => {
          const draftAchievement = draftAchievements.find((candidate) => sameAchievementIdentity(candidate, achievement));
          if (!draftAchievement) return false;
          return Boolean(
            (!String(draftAchievement.episode ?? "").trim() && String(achievement.episode ?? "").trim()) ||
            (!String(draftAchievement.earnedDate ?? "").trim() && String(achievement.earnedDate ?? "").trim())
          );
        });
        if (hasPublishedMetadataToImport) {
          setResult((current) => {
            if (!current || current.game.slug !== gameSlug) return current;
            return {
              ...current,
              achievements: current.achievements.map((draftAchievement) => {
                const achievement = published.find((candidate) => sameAchievementIdentity(candidate, draftAchievement));
                if (!achievement) return draftAchievement;
                return {
                  ...draftAchievement,
                  episode: String(draftAchievement.episode ?? "").trim()
                    ? draftAchievement.episode
                    : achievement.episode ?? "",
                  earnedDate: String(draftAchievement.earnedDate ?? "").trim()
                    ? draftAchievement.earnedDate
                    : achievement.earnedDate ?? "",
                  image: String(draftAchievement.image ?? "").trim()
                    ? draftAchievement.image
                    : achievement.image ?? "",
                };
              }),
            };
          });
          setSaved(false);
          setPreparationModeNotice("EPs/datas já registrados no site foram recuperados onde os campos da preparação estavam vazios. Salve o rascunho após revisar.");
        }
      } catch {
        // A preparação continua disponível mesmo quando não é possível consultar a lista publicada.
      }
    }

    void loadPublishedAchievementsOutsidePreparation();
    return () => {
      cancelled = true;
    };
    // Carrega a lista pública uma vez por jogo; edições locais não devem disparar nova leitura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.game.slug]);

  useEffect(() => {
    if (
      !needsDraftSnapshotUpgrade ||
      !result?.game.slug ||
      draftSnapshotUpgradeStarted.current
    ) {
      return;
    }

    draftSnapshotUpgradeStarted.current = true;
    void persistPreparation(result.achievements)
      .then(() => {
        setNeedsDraftSnapshotUpgrade(false);
      })
      .catch((error) => {
        setError(
          error instanceof Error
            ? "O rascunho antigo foi carregado, mas não consegui migrá-lo automaticamente. Salve o rascunho para evitar uma nova análise na próxima abertura."
            : "O rascunho antigo foi carregado, mas não consegui migrá-lo automaticamente. Salve o rascunho para evitar uma nova análise na próxima abertura."
        );
        setNeedsDraftSnapshotUpgrade(false);
        draftSnapshotUpgradeStarted.current = false;
      });
    // Executa uma vez por carregamento legado; não acompanha edições posteriores.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsDraftSnapshotUpgrade, result?.game.slug]);

  useEffect(() => {
    const gameSlug = result?.game.slug;
    if (!gameSlug) return;

    const existingEpisode = normalizeEpisode(
      result.game.youtubeFirstLiveEpisode
    );
    const initialEpisode = existingEpisode
      ? "EP " + existingEpisode
      : "EP 01";

    if (journeyStartEpisode !== initialEpisode) {
      setJourneyStartEpisode(initialEpisode);
    }

    if (
      !journeyLiveLoading &&
      !journeyLiveOptions.length &&
      !journeyLiveSelecting &&
      result.game.youtubePlaylistUrl
    ) {
      void loadJourneyLiveOptions(initialEpisode);
    }
    // O objetivo é carregar automaticamente o EP inicial e sua thumb uma única vez por jogo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.game.slug, result?.game.youtubeFirstLiveEpisode, result?.game.youtubePlaylistUrl]);

  async function prepareJourneyDecision() {
    if (!result?.game.slug || journeyAnalysisLoading) return;

    setJourneyAnalysisLoading(true);
    setError("");

    try {
      // Reconsulta a análise automática do servidor para não depender do
      // estado do rascunho. O rascunho pode conter uma seleção anterior vazia
      // e isso fazia o botão "Analisar Jornada" parecer não fazer nada.
      const response = await fetch(
        "/api/admin/achievement-prep?slug=" +
          encodeURIComponent(result.game.slug),
        { cache: "no-store" }
      );
      const payload = (await response.json()) as {
        achievements?: Array<{
          name?: string;
          journey?: boolean;
        }>;
        error?: string;
      };

      if (!response.ok || !Array.isArray(payload.achievements)) {
        throw new Error(
          payload.error || "Não foi possível analisar a Jornada de Estreia."
        );
      }

      const analyzedByName = new Map(
        payload.achievements.map((achievement) => [
          slugify(achievement.name ?? ""),
          Boolean(achievement.journey),
        ])
      );

      const nextAchievements = result.achievements.map((achievement) => {
        // Conquistas customizadas continuam sob controle manual e não são
        // sobrescritas pela análise automática do Exophase.
        if (achievement.isCustom) {
          return achievement;
        }

        const key = slugify(achievement.name);
        const analyzedJourney = analyzedByName.get(key) ?? false;

        return {
          ...achievement,
          journey: achievement.notDoing ? false : analyzedJourney,
          journeySuggestion: analyzedJourney,
        };
      });

      const preparedCount = nextAchievements.filter(
        (achievement) => !achievement.notDoing && achievement.journey
      ).length;

      setSaved(false);
      setJourneyPreparedCount(preparedCount);
      setResult({
        ...result,
        achievements: nextAchievements,
      });
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível analisar a Jornada de Estreia."
      );
    } finally {
      setJourneyAnalysisLoading(false);
    }
  }

  function removeAchievementFromPreparation(id: string) {
    if (!result) return;
    const target = result.achievements.find((achievement) => achievement.id === id);
    if (!target) return;

    const confirmed = window.confirm(
      `Remover "${target.name}" desta preparação? A remoção será salva no rascunho quando você clicar em "Salvar rascunho". Se a conquista já estiver publicada, ela continuará no site até você publicar novamente a lista atualizada.`
    );
    if (!confirmed) return;

    setSaved(false);
    setJourneyPreparedCount(null);
    setResult((current) =>
      current
        ? {
            ...current,
            achievements: current.achievements.filter((achievement) => achievement.id !== id),
          }
        : current
    );
    setExpandedRecordIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    if (focusedAchievementId === id) setFocusedAchievementId(null);
  }

  function toggle(id: string) {
    setSaved(false);
    setResult((current) => {
      if (!current) return current;

      const journeyEpisode = normalizeEpisode(
        current.game.youtubeFirstLiveEpisode
      );

      return {
        ...current,
        achievements: current.achievements.map((a) => {
          if (a.id !== id || a.notDoing) return a;

          const journey = !a.journey;

          return {
            ...a,
            journey,
            episode:
              journey && journeyEpisode
                ? "EP " + journeyEpisode
                : a.episode ?? "",
          };
        }),
      };
    });
  }

  function updateJourneyStartEpisode(value: string) {
    const normalized = normalizeEpisode(value);
    const displayValue = normalized ? "EP " + normalized : value.trim();

    setJourneyStartEpisode(displayValue);
    setSaved(false);

    setResult((current) =>
      current
        ? {
            ...current,
            game: {
              ...current.game,
              youtubeFirstLiveEpisode: displayValue,
            },
            achievements: current.achievements.map((a) => ({
              ...a,
              episode:
                a.journey && !a.notDoing
                  ? normalized
                    ? "EP " + normalized
                    : ""
                  : a.episode ?? "",
            })),
          }
        : current
    );
  }

  async function loadJourneyLiveOptions(episodeOverride?: string) {
    if (!result?.game.youtubePlaylistUrl) {
      setJourneyLiveOptions([]);
      setJourneyLiveError("Este jogo ainda não possui uma playlist do YouTube cadastrada.");
      setJourneyLiveSelecting(true);
      return;
    }

    const episode = normalizeEpisode(
      episodeOverride || journeyStartEpisode
    );
    const playlistId = extractYoutubePlaylistId(result.game.youtubePlaylistUrl);

    if (!episode) {
      setJourneyLiveOptions([]);
      setJourneyLiveError("Informe primeiro o EP da Jornada.");
      setJourneyLiveSelecting(true);
      return;
    }

    if (!playlistId) {
      setJourneyLiveOptions([]);
      setJourneyLiveError("A URL da playlist cadastrada não é válida.");
      setJourneyLiveSelecting(true);
      return;
    }

    setJourneyLiveLoading(true);
    setJourneyLiveError("");
    setJourneyLiveSelecting(true);

    try {
      const response = await fetch(
        "/api/youtube/playlist?playlistId=" + encodeURIComponent(playlistId),
        { cache: "no-store" }
      );

      const payload = (await response.json()) as {
        videos?: YouTubePlaylistVideoOption[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.error || "Não foi possível carregar os conteúdos da playlist."
        );
      }

      const episodeVideos = (payload.videos ?? []).filter((video) =>
        titleMatchesEpisode(video.title, episode)
      );

      const liveVideos = episodeVideos.filter(
        (video) =>
          video.liveStatus === "archived" ||
          video.liveStatus === "live" ||
          video.liveStatus === "upcoming"
      );

      const options = liveVideos.length > 0 ? liveVideos : episodeVideos;

      setJourneyLiveOptions(options);

      const storedVideoId = (() => {
        try {
          const url = new URL(result.game.youtubeFirstLiveUrl || "");
          return url.searchParams.get("v")?.trim() || "";
        } catch {
          return "";
        }
      })();

      const matchingStoredVideo =
        options.find((video) => video.id === storedVideoId) ?? null;

      setJourneySelectedLive(matchingStoredVideo);

      if (options.length === 0) {
        setJourneyLiveError(
          "Nenhum conteúdo com EP " +
            episode +
            " foi encontrado na playlist deste jogo."
        );
      }
    } catch (error) {
      setJourneyLiveOptions([]);
      setJourneyLiveError(
        error instanceof Error
          ? error.message
          : "Não foi possível carregar as lives do EP."
      );
    } finally {
      setJourneyLiveLoading(false);
    }
  }

  async function selectJourneyLive(video: YouTubePlaylistVideoOption) {
    if (!result?.game.slug) return;

    setJourneyEpisodeSaving(true);
    setJourneyLiveError("");
    setSaved(false);

    try {
      const response = await fetch("/api/admin/games", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: result.game.slug,
          youtubeFirstLiveUrl: video.playlistWatchUrl,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          payload?.error || "Não foi possível vincular a live do EP."
        );
      }

      setResult((current) =>
        current
          ? {
              ...current,
              game: {
                ...current.game,
                youtubeFirstLiveUrl: video.playlistWatchUrl,
              },
            }
          : current
      );
      setJourneySelectedLive(video);
      setJourneyLiveSelecting(false);
    } catch (error) {
      setJourneyLiveError(
        error instanceof Error
          ? error.message
          : "Não foi possível vincular a live do EP."
      );
      setJourneyLiveSelecting(true);
    } finally {
      setJourneyEpisodeSaving(false);
    }
  }

  async function saveJourneyStartEpisode() {
    if (!result?.game.slug) return;

    const normalized = normalizeEpisode(journeyStartEpisode);
    const value = normalized
      ? "EP " + normalized
      : journeyStartEpisode.trim();

    if (value && !normalized) {
      setError("Informe um episódio válido, como EP 01.");
      return;
    }

    setJourneyEpisodeSaving(true);
    setError("");

    try {
      const response = await fetch("/api/admin/games", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: result.game.slug,
          youtubeFirstLiveEpisode: value,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            "Não foi possível salvar o EP inicial da Jornada."
        );
      }

      setJourneyStartEpisode(value);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar o EP inicial da Jornada."
      );
    } finally {
      setJourneyEpisodeSaving(false);
    }
  }

  function toggleNotDoing(id: string) {
    setSaved(false);
    setResult((current) =>
      current
        ? {
            ...current,
            achievements: current.achievements.map((a) =>
              a.id === id
                ? { ...a, notDoing: !a.notDoing, journey: false }
                : a
            ),
          }
        : current
    );
  }

  function toggleRecordPanel(id: string) {
    setExpandedRecordIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function updateAchievementRecord(
    id: string,
    field: "episode" | "earnedDate",
    value: string
  ) {
    setSaved(false);
    setResult((current) =>
      current
        ? {
            ...current,
            achievements: current.achievements.map((a) => {
              if (a.id !== id) return a;
              const nextEpisode = field === "episode" ? value : (a.episode ?? "");
              const nextDate = field === "earnedDate" ? value : (a.earnedDate ?? "");
              const hasEarnedRecord = Boolean(nextEpisode.trim() || nextDate.trim());
              return {
                ...a,
                [field]: value,
                status: hasEarnedRecord ? "completed" : "locked",
              };
            }),
          }
        : current
    );
  }

  function updateFinalMasteryRecord(
    field: "finalMasteryEpisode" | "finalMasteryDate",
    value: string
  ) {
    setSaved(false);
    setPublished(false);
    setFinalMasteryRecordMessage("");
    setResult((current) =>
      current
        ? {
            ...current,
            game: {
              ...current.game,
              [field]: value,
            },
          }
        : current
    );
  }

  function updateVisualBrief(id: string, value: string) {
    setSaved(false);
    setResult((current) =>
      current
        ? {
            ...current,
            achievements: current.achievements.map((a) =>
              a.id === id ? { ...a, visualBrief: value } : a
            ),
          }
        : current
    );
  }

  function similarityScore(left: string, right: string) {
    const stopWords = new Set([
      "a","as","o","os","um","uma","uns","umas","de","do","da","dos","das",
      "em","no","na","nos","nas","e","ou","que","com","sem","por","para",
      "ao","aos","se","sua","seu","suas","seus","the","of","and","to","in",
      "an","on","with","without","your"
    ]);

    const tokenize = (value: string) =>
      slugify(value)
        .split("-")
        .map((word) => {
          if (word.length > 5 && word.endsWith("es")) return word.slice(0, -2);
          if (word.length > 5 && word.endsWith("s")) return word.slice(0, -1);
          return word;
        })
        .filter((word) => word.length > 2 && !stopWords.has(word));

    const a=tokenize(left);
    const b=tokenize(right);
    if (!a.length || !b.length) return 0;

    const setA=new Set(a);
    const setB=new Set(b);
    const intersection=[...setA].filter((word)=>setB.has(word)).length;
    const union=new Set([...setA,...setB]).size;
    const jaccard=union ? intersection/union : 0;

    const compactA=a.join("");
    const compactB=b.join("");
    const contains=compactA.includes(compactB)||compactB.includes(compactA)?0.2:0;

    const bigrams=(tokens:string[])=>new Set(tokens.slice(0,-1).map((word,index)=>word+" "+tokens[index+1]));
    const shared=[...bigrams(a)].filter((item)=>bigrams(b).has(item)).length;
    const bigramBonus=Math.min(0.2,shared*0.08);

    return Math.min(1,jaccard*0.65+contains+bigramBonus);
  }
  function findSimilarAchievements(value: string) {
    if (!result || !value.trim()) return [];

    return result.achievements
      .filter((a) => !a.notDoing)
      .map((achievement) => ({
        achievement,
        score: similarityScore(
          value,
          achievement.name + " " + achievement.description
        ),
      }))
      .filter(({ score }) => score >= 0.35)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3);
  }

  function realizedMatchTokens(value: string) {
    const stopWords = new Set([
      "a","as","o","os","um","uma","uns","umas","de","do","da","dos","das",
      "em","no","na","nos","nas","num","numa","nuns","numas","e","ou","que",
      "com","sem","por","para","ao","aos","pelo","pela","pelos","pelas","se",
      "sua","seu","suas","seus","isso","isto","essa","esse","estas","estes",
      "the","of","and","to","in","an","on","with","without","your"
    ]);

    const concepts: Record<string, string> = {
      melhoria: "melhorar",
      melhorias: "melhorar",
      melhora: "melhorar",
      melhorar: "melhorar",
      melhore: "melhorar",
      melhorou: "melhorar",
      melhorado: "melhorar",
      melhorada: "melhorar",
      aprimorar: "melhorar",
      aprimore: "melhorar",
      aprimora: "melhorar",
      aprimoramento: "melhorar",
      aprimorou: "melhorar",
      upgrade: "melhorar",
      upgrades: "melhorar",
      arma: "arma",
      armas: "arma",
      armamento: "arma",
      armamentos: "arma",
      inimigo: "inimigo",
      inimigos: "inimigo",
      inimiga: "inimigo",
      inimigas: "inimigo",
      matar: "matar",
      mata: "matar",
      mate: "matar",
      matou: "matar",
      matando: "matar",
      eliminar: "matar",
      elimine: "matar",
      eliminou: "matar",
      derrotar: "derrotar",
      derrota: "derrotar",
      derrote: "derrotar",
      derrotou: "derrotar",
      vencer: "vencer",
      venca: "vencer",
      venceu: "vencer",
      ganhar: "ganhar",
      ganha: "ganhar",
      ganhe: "ganhar",
      ganhou: "ganhar",
      colecionar: "coletar",
      coletar: "coletar",
      colete: "coletar",
      coletou: "coletar",
      coletado: "coletar",
      encontrar: "encontrar",
      encontre: "encontrar",
      encontrou: "encontrar",
      descobrir: "descobrir",
      descubra: "descobrir",
      descobriu: "descobrir",
      explorar: "explorar",
      explore: "explorar",
      explorou: "explorar",
      ajudar: "ajudar",
      ajude: "ajudar",
      ajudou: "ajudar",
      salvar: "salvar",
      salve: "salvar",
      salvou: "salvar",
      resgatar: "resgatar",
      resgate: "resgatar",
      resgatou: "resgatar",
    };

    return slugify(value)
      .split("-")
      .map((word) => concepts[word] ?? word)
      .filter((word) => word.length > 2 && !stopWords.has(word));
  }

  function realizedSimilarityScore(left: string, right: string) {
    const base = similarityScore(left, right);
    const a = realizedMatchTokens(left);
    const b = realizedMatchTokens(right);

    if (!a.length || !b.length) return base;

    const setA = new Set(a);
    const setB = new Set(b);
    const intersection = [...setA].filter((word) => setB.has(word)).length;
    const union = new Set([...setA, ...setB]).size;
    const conceptScore = union ? intersection / union : 0;
    const overlapBonus = Math.min(0.2, intersection * 0.08);

    return Math.min(1, base * 0.55 + conceptScore * 0.45 + overlapBonus);
  }

  function realizedMatchLabel(score: number) {
    if (score >= 0.5) return "Muito provável";
    if (score >= 0.4) return "Provável";
    return "Possível";
  }

  function realizedMatchTone(score: number) {
    if (score >= 0.5) return "text-emerald-200";
    if (score >= 0.4) return "text-yellow-200";
    return "text-white/50";
  }

  function findRealizedMatches(value: string) {
    if (!result || !value.trim()) return [];

    return result.achievements
      .filter((a) => !a.notDoing)
      .map((achievement) => ({
        achievement,
        score: realizedSimilarityScore(
          value,
          achievement.name + " " + achievement.description
        ),
      }))
      .filter(({ score }) => score >= 0.28)
      .sort((left, right) => right.score - left.score)
      .slice(0, 5);
  }

  function formatRecordedEpisode(value: string) {
    const episode = normalizeEpisode(value);
    return episode ? "EP " + episode : value.trim();
  }

  function clearRealizedRegister() {
    setRealizedDescription("");
    setRealizedEpisode("");
    setRealizedDate("");
    setRealizedRank("Bronze");
    setRealizedCandidates([]);
    setShowRealizedMatches(false);
    setFocusedAchievementId(null);
  }

  function focusAchievement(achievementId: string) {
    setFocusedAchievementId(achievementId);
    setExpandedRecordIds((current) => {
      const next = new Set(current);
      next.add(achievementId);
      return next;
    });

    window.setTimeout(() => {
      document
        .getElementById("achievement-" + achievementId)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  function analyzeRealizedAchievement() {
    const value = realizedDescription.trim();
    if (!result || !value) return;

    const candidates = findRealizedMatches(value);
    setRealizedCandidates(candidates);
    setShowRealizedMatches(true);
  }

  function registerRealizedAchievement(
    achievementId: string,
    createNew = false
  ) {
    const value = realizedDescription.trim();
    if (!result || !value) return;

    const episode = formatRecordedEpisode(realizedEpisode);
    const date = realizedDate.trim();

    if (createNew) {
      const custom: A = {
        id: "custom-realized-" + Date.now(),
        name: generateManualTitle(value),
        description: value,
        rank: realizedRank,
        online: false,
        momentary: false,
        journeySuggestion: false,
        journey: false,
        notDoing: false,
        episode,
        earnedDate: date,
        earnedNote: value,
        isCustom: true,
        status: "completed",
      };

      setSaved(false);
      setResult((current) =>
        current
          ? { ...current, achievements: [...current.achievements, custom] }
          : current
      );
      clearRealizedRegister();
      return;
    }

    if (!achievementId) return;

    setSaved(false);
    setResult((current) =>
      current
        ? {
            ...current,
            achievements: current.achievements.map((achievement) =>
              achievement.id === achievementId
                ? {
                    ...achievement,
                    episode,
                    earnedDate: date,
                    earnedNote: value,
                    status: "completed",
                  }
                : achievement
            ),
          }
        : current
    );
    clearRealizedRegister();
  }

  function generateManualTitle(description: string) {
    const clean = description
      .trim()
      .replace(/^[.!?]+|[.!?]+$/g, "")
      .replace(/\s+/g, " ");

    if (!clean) return "Nova Conquista";

    const normalized = clean
      .toLocaleLowerCase("pt-BR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    // Títulos curtos e com "cara de conquista". O gerador nunca devolve
    // a descrição inteira como título.
    if (/^a primeira conquista\b/.test(normalized) || /\bprimeira conquista\b/.test(normalized)) {
      return "O Primeiro Passo";
    }

    if (/^a primeira vitoria\b/.test(normalized) || /\bprimeira vitoria\b/.test(normalized)) {
      return "Primeira Vitória";
    }

    if (/\b(um unico tiro|uma unica bala|um so tiro|uma so bala)\b/.test(normalized)) {
      const count = normalized.match(/\b(\d+)\s+inimigos?\b/)?.[1];
      if (count === "3") return "Um Tiro, Três Alvos";
      if (count === "2") return "Um Tiro, Dois Alvos";
      return "Um Tiro, Alvo Certo";
    }

    if (/\bsem (tomar|receber) dano\b|\bsem ser atingid/.test(normalized)) {
      return "Intocável";
    }

    if (/\bsem morrer\b|\bnao morra\b/.test(normalized)) {
      return "De Pé Até o Fim";
    }

    if (/\bprimeir[oa]\s+(missao|caso|capitulo|fase)\b/.test(normalized)) {
      return "O Primeiro Passo";
    }

    if (/\b(ultima|última)\s+(missao|caso|fase|batalha)\b/.test(normalized)) {
      return "Até o Último Suspiro";
    }

    if (/\bcomplete|conclua|finalize|finalizar|termine|terminar\b/.test(normalized)) {
      if (/\bcampanha|historia|historia|jogo\b/.test(normalized)) return "Até o Fim";
      return "Missão Cumprida";
    }

    if (/\bmate|elimine|derrote|abata\b/.test(normalized)) {
      if (/\bchef(e|es)|boss|batalha\b/.test(normalized)) return "Golpe Final";
      return "Precisão Mortal";
    }

    if (/\bcolet(e|ar)|encontr(e|ar)|peg(ue|ar)|recolh/.test(normalized)) {
      if (/\btodos?|todas?|100%|completo|completa\b/.test(normalized)) {
        return "Nada Ficou Para Trás";
      }
      return "Em Busca do Inesperado";
    }

    if (/\bganhe|vença|venca|ven(ç|c)a|conquiste|conquistar\b/.test(normalized)) {
      return "Vitória Merecida";
    }

    if (/\bdescubra|descobrir|revele|revelar|segredo|segredos|pista|pistas\b/.test(normalized)) {
      return "Segredos à Vista";
    }

    if (/\bajude|ajudar|salve|salvar|resgate|resgatar\b/.test(normalized)) {
      return "Uma Mão Amiga";
    }

    if (/\bexplore|explorar|visite|visitar\b/.test(normalized)) {
      return "Além do Caminho";
    }

    if (/\bsem ser visto|sem ser detectado|furtiv|stealth\b/.test(normalized)) {
      return "Nas Sombras";
    }

    if (/\btempo|segundos|minutos|rapido|rápido|rapidamente\b/.test(normalized)) {
      return "Contra o Relógio";
    }

    if (/\bperfeito|perfeita|sem erro|sem erros\b/.test(normalized)) {
      return "Sem Margem Para Erros";
    }

    // Fallback: transforma a ideia em um nome curto, mas nunca copia
    // a descrição inteira.
    const nouns = clean
      .replace(/^(mate|elimine|derrote|complete|conclua|faça|faca|encontre|colete|pegue|consiga|vença|venca|termine|termine)\s+/i, "")
      .replace(/\b(um|uma|o|a|os|as|de|do|da|dos|das|com|em|para|por)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    const words = nouns.split(" ").filter(Boolean);
    if (words.length === 1) {
      return `Além de ${words[0].charAt(0).toUpperCase() + words[0].slice(1)}`;
    }

    if (words.length >= 2) {
      const phrase = words.slice(0, 3).join(" ");
      return `O Segredo de ${phrase.charAt(0).toUpperCase() + phrase.slice(1)}`;
    }

    return "Um Novo Começo";
  }
  async function regenerateCustomAchievement(achievementId: string) {
    if (!result || rewritingAchievementId) return;

    const achievement = result.achievements.find((item) => item.id === achievementId && item.isCustom);
    if (!achievement) return;
    if (!achievement.name.trim() || !achievement.description.trim()) {
      setAchievementRewriteNotices((current) => ({
        ...current,
        [achievementId]: "Preencha o título e a descrição antes de gerar outra versão.",
      }));
      return;
    }

    setRewritingAchievementId(achievementId);
    setAchievementRewriteNotices((current) => ({ ...current, [achievementId]: "Gerando uma nova versão com o mesmo objetivo…" }));

    try {
      const gameContext = result.achievements
        .filter((item) => !item.isCustom && item.name.trim())
        .slice(0, 18)
        .map((item) => ({ title: item.name.trim(), description: (item.description || "").trim().slice(0, 200) }));
      const response = await fetch("/api/admin/achievement-prep/suggest-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          mode: "rewrite",
          gameTitle: result.game.name,
          currentTitle: achievement.name.trim(),
          note: achievement.description.trim(),
          gameContext,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || typeof payload !== "object") {
        throw new Error(payload?.error || "Não foi possível gerar outra versão. A conquista original foi mantida.");
      }

      const nextTitle = typeof payload.title === "string" ? payload.title.trim() : "";
      const nextDescription = typeof payload.description === "string" ? payload.description.trim() : "";
      if (!nextTitle || !nextDescription) {
        throw new Error("A IA não retornou um título e uma descrição válidos. A conquista original foi mantida.");
      }

      setResult((current) => current
        ? {
            ...current,
            achievements: current.achievements.map((item) =>
              item.id === achievementId
                ? { ...item, name: nextTitle, description: nextDescription }
                : item
            ),
          }
        : current
      );
      setSaved(false);
      const responseNotice = typeof payload.notice === "string" ? payload.notice.trim() : "";
      setAchievementRewriteNotices((current) => ({
        ...current,
        [achievementId]: responseNotice
          ? responseNotice + " Rank, EP, data e demais registros foram preservados."
          : "Nova versão aplicada. Rank, EP, data e demais registros foram preservados.",
      }));
    } catch (error) {
      setAchievementRewriteNotices((current) => ({
        ...current,
        [achievementId]: error instanceof Error ? error.message : "Não foi possível gerar outra versão. A conquista original foi mantida.",
      }));
    } finally {
      setRewritingAchievementId(null);
    }
  }

  async function createManualAchievementFromNote(value: string, closeSimilarity = false) {
    if (!result || !value.trim() || generatingManualAchievement) return;

    setGeneratingManualAchievement(true);
    setManualSuggestionNotice("");

    try {
      const response = await fetch("/api/admin/achievement-prep/suggest-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          gameTitle: result.game.name,
          note: value.trim(),
          gameContext: (() => {
            const noteTerms = value
              .toLocaleLowerCase("pt-BR")
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .split(/[^a-z0-9]+/)
              .filter((term) => term.length >= 4);
            return result.achievements
              .filter((achievement) => !achievement.isCustom && achievement.name.trim())
              .map((achievement, index) => {
                const title = achievement.name.trim();
                const description = (achievement.description || "").trim().slice(0, 200);
                const searchable = (title + " " + description)
                  .toLocaleLowerCase("pt-BR")
                  .normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, "");
                const relevance = noteTerms.reduce(
                  (score, term) => score + Number(searchable.includes(term)),
                  0
                );
                return { title, description, index, relevance };
              })
              .sort((a, b) => b.relevance - a.relevance || a.index - b.index)
              .slice(0, 18)
              .map(({ title, description }) => ({ title, description }));
          })(),
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload || typeof payload !== "object") {
        throw new Error(payload?.error || "Não foi possível sugerir título, descrição e rank.");
      }

      const validRank = ["Bronze", "Prata", "Ouro"].includes(String(payload.rank))
        ? (payload.rank as "Bronze" | "Prata" | "Ouro")
        : manualRank;
      const title = String(payload.title || "").trim() || generateManualTitle(value);
      const description = String(payload.description || "").trim() || value.trim();

      const custom: A = {
        id: "custom-" + crypto.randomUUID(),
        name: title,
        description,
        rank: validRank,
        online: false,
        momentary: false,
        journeySuggestion: false,
        journey: false,
        notDoing: false,
        episode: "",
        earnedDate: "",
        earnedNote: value.trim(),
        isCustom: true,
        rankReason: String(payload.rankReason || "").trim(),
        suggestionSource: payload.source === "ia" ? "ia" : "regras",
      };

      setSaved(false);
      setResult((current) =>
        current ? { ...current, achievements: [...current.achievements, custom] } : current
      );
      setManualAchievement("");
      if (closeSimilarity) {
        setShowSimilarity(false);
        setSimilarCandidates([]);
      }
      setManualSuggestionNotice(
        payload.notice
          ? String(payload.notice)
          : "Conquista criada: " + title + " · Rank " + validRank + ". Você pode revisar e editar os campos abaixo."
      );
    } catch (error) {
      setManualSuggestionNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível gerar a sugestão. Tente novamente."
      );
    } finally {
      setGeneratingManualAchievement(false);
    }
  }

  async function addManualAchievement() {
    const value = manualAchievement.trim();
    if (!result || !value || generatingManualAchievement) return;

    const candidates = findSimilarAchievements(value);
    if (candidates.length) {
      setSimilarCandidates(candidates);
      setShowSimilarity(true);
      setManualSuggestionNotice("Encontrei possíveis correspondências. Escolha uma delas ou crie uma conquista separada.");
      return;
    }

    await createManualAchievementFromNote(value);
  }

  function updateCustomAchievement(
    id: string,
    field: "name" | "description" | "rank",
    value: string
  ) {
    setSaved(false);
    setResult((current) =>
      current
        ? {
            ...current,
            achievements: current.achievements.map((a) =>
              a.id === id && a.isCustom
                ? { ...a, [field]: value }
                : a
            ),
          }
        : current
    );
  }

  async function addCustomAsSeparate() {
    const value = manualAchievement.trim();
    if (!result || !value || generatingManualAchievement) return;
    await createManualAchievementFromNote(value, true);
  }

  function useExophaseCandidate(candidate: A) {
    setSaved(false);
    setResult((current) => {
      if (!current) return current;

      const journeyEpisode = normalizeEpisode(
        current.game.youtubeFirstLiveEpisode
      );

      return {
        ...current,
        achievements: current.achievements.map((a) =>
          a.id === candidate.id
            ? {
                ...a,
                journey: true,
                notDoing: false,
                episode: journeyEpisode
                  ? "EP " + journeyEpisode
                  : a.episode ?? "",
              }
            : a
        ),
      };
    });
    setManualAchievement("");
    setShowSimilarity(false);
    setSimilarCandidates([]);
  }

  function openMergeDialog(candidate: A) {
    const value = manualAchievement.trim();
    if (!value) return;

    const exophaseDescription = candidate.description.trim();
    setMergeCandidate(candidate);
    setMergeTitle(generateManualTitle(value));
    setMergeDescription(
      exophaseDescription && exophaseDescription.toLocaleLowerCase("pt-BR") !== value.toLocaleLowerCase("pt-BR")
        ? [exophaseDescription, value].filter(Boolean).join(" ")
        : exophaseDescription || value
    );
  }

  function confirmMerge() {
    const candidate = mergeCandidate;
    if (!result || !candidate) return;

    const merged: A = {
      id: `custom-merged-${Date.now()}`,
      name: mergeTitle.trim() || generateManualTitle(manualAchievement),
      description: mergeDescription.trim() || manualAchievement.trim(),
      rank: manualRank,
      online: candidate.online,
      momentary: candidate.momentary,
      journeySuggestion: candidate.journeySuggestion,
      journey: true,
      notDoing: false,
      episode: normalizeEpisode(result.game.youtubeFirstLiveEpisode)
        ? "EP " + normalizeEpisode(result.game.youtubeFirstLiveEpisode)
        : "",
      earnedDate: "",
      isCustom: true,
    };

    setSaved(false);
    setResult((current) =>
      current
        ? {
            ...current,
            achievements: [
              ...current.achievements.filter((a) => a.id !== candidate.id),
              merged,
            ],
          }
        : current
    );
    setManualAchievement("");
    setManualRank("Bronze");
    setShowSimilarity(false);
    setSimilarCandidates([]);
    setMergeCandidate(null);
    setMergeTitle("");
    setMergeDescription("");
  }
  async function persistPreparation(
    achievements: A[],
    options: {
      journeyFinalized?: boolean;
      resultOverride?: R;
      registeredRecordsOverride?: A[];
    } = {}
  ) {
    const sourceResult = options.resultOverride ?? result;
    const sourceRegisteredRecords =
      options.registeredRecordsOverride ?? registeredOutsideAchievements;
    if (!sourceResult?.game.slug) return;

    const response = await fetch("/api/admin/achievement-prep-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: sourceResult.game.slug,
        preparation: {
          preparedGame: sourceResult.game,
          preparedAchievements: achievements,
          registeredAchievementRecords: sourceRegisteredRecords,
          preparedWarnings: sourceResult.warnings ?? [],
          journeyIds: achievements
            .filter((a) => a.journey && !a.notDoing)
            .map((a) => a.id),
          notDoingIds: achievements
            .filter((a) => a.notDoing)
            .map((a) => a.id),
          visualBriefs: Object.fromEntries(
            achievements
              .filter((a) => a.visualBrief?.trim())
              .map((a) => [a.id, a.visualBrief?.trim() ?? ""])
          ),
          episodeById: Object.fromEntries(
            achievements
              .filter((a) => a.episode?.trim())
              .map((a) => [a.id, a.episode?.trim() ?? ""])
          ),
          earnedDateById: Object.fromEntries(
            achievements
              .filter((a) => a.earnedDate?.trim())
              .map((a) => [a.id, a.earnedDate?.trim() ?? ""])
          ),
          earnedNoteById: Object.fromEntries(
            achievements
              .filter((a) => a.earnedNote?.trim())
              .map((a) => [a.id, a.earnedNote?.trim() ?? ""])
          ),
          customAchievements: achievements.filter((a) => a.isCustom),
          journeyFinalized: options.journeyFinalized === true,
        },
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Erro ao salvar rascunho.");
    }

    setDraftUpdatedAt(payload.updatedAt ?? new Date().toISOString());
    setSaved(true);
  }

  function updateRegisteredAchievementRecord(
    id: string,
    field: "episode" | "earnedDate",
    value: string
  ) {
    setRegisteredOutsideAchievements((current) =>
      current.map((achievement) =>
        achievement.id === id
          ? { ...achievement, [field]: field === "earnedDate" ? normalizeAchievementDateInput(value) : value }
          : achievement
      )
    );
    setRegisteredRecordsDirty(true);
    setRegisteredRecordsMessage("");
  }

  async function clearCompletedAchievements() {
    if (!registeredSlug || clearingCompleted) return;

    const gameName =
      result?.game.name ||
      title ||
      (registeredSlug === "monster-hunter-world-iceborne"
        ? "Monster Hunter: World - Iceborne"
        : registeredSlug.replace(/-/g, " "));
    const confirmed = window.confirm(
      `Limpar as conquistas feitas de "${gameName}"? Isso vai desmarcar as conquistas concluídas e apagar as datas/EPs associados a elas no histórico. As definições e imagens das conquistas serão preservadas.`
    );
    if (!confirmed) return;

    setClearingCompleted(true);
    setClearCompletedMessage("");
    setClearCompletedFailed(false);

    try {
      const response = await fetch("/api/admin/achievement-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          action: "clear-completed",
          slug: registeredSlug,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Não foi possível limpar as conquistas feitas.");
      }

      const shouldResetRecord = (achievement: A) =>
        achievement.status === "completed" ||
        Boolean(achievement.earnedDate?.trim() || achievement.earnedNote?.trim());

      const resetRecord = (achievement: A): A =>
        shouldResetRecord(achievement)
          ? {
              ...achievement,
              status: "locked",
              earnedDate: "",
              earnedNote: "",
              episode: "",
            }
          : achievement;

      const nextRegisteredRecords = registeredOutsideAchievements.map(resetRecord);
      const currentResult = result;
      const nextResult: R | null = currentResult
        ? {
            ...currentResult,
            game: {
              ...currentResult.game,
              finalMasteryEpisode: "",
              finalMasteryDate: "",
            },
            achievements: currentResult.achievements.map(resetRecord),
          }
        : null;

      setRegisteredOutsideAchievements(nextRegisteredRecords);
      setRegisteredRecordsDirty(false);
      setRegisteredRecordsMessage("");
      setFinalMasteryRecordMessage("");

      if (nextResult) {
        setResult(nextResult);
        try {
          await persistPreparation(nextResult.achievements, {
            resultOverride: nextResult,
            registeredRecordsOverride: nextRegisteredRecords,
            journeyFinalized: false,
          });
        } catch {
          setSaved(false);
          setClearCompletedFailed(true);
          setClearCompletedMessage(
            "As conquistas publicadas foram limpas, mas não consegui atualizar o rascunho do preparador. Salve o rascunho antes de sair desta página."
          );
          return;
        }
      }

      localStorage.removeItem(`rumo-preparador:${registeredSlug}`);
      const count = Number(payload?.clearedCount ?? 0);
      const resetCount = Number(payload?.resetCount ?? 0);
      setClearCompletedMessage(
        count > 0
          ? `${count} conquistas concluídas foram limpas; ${resetCount} registro(s) de progresso tiveram data e estado reiniciados. As definições e imagens foram preservadas.`
          : resetCount > 0
            ? `${resetCount} registro(s) de progresso foram reiniciados. As definições e imagens foram preservadas.`
            : "Não encontrei conquistas marcadas como feitas para limpar. Nenhuma definição ou imagem foi removida."
      );
      setClearCompletedFailed(false);
    } catch (error) {
      setClearCompletedFailed(true);
      setClearCompletedMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível limpar as conquistas feitas."
      );
    } finally {
      setClearingCompleted(false);
    }
  }

  async function saveRegisteredAchievementRecordsToSite() {
    if (!result?.game.slug || registeredRecordsSaving || registeredOutsideAchievements.length === 0) return;

    setRegisteredRecordsSaving(true);
    setRegisteredRecordsMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/achievement-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: result.game.slug,
          records: registeredOutsideAchievements.map((achievement) => ({
            id: achievement.id,
            name: achievement.name,
            episode: achievement.episode ?? "",
            earnedDate: normalizeAchievementDateInput(achievement.earnedDate),
            status: achievement.status ?? "completed",
          })),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Não foi possível atualizar os registros publicados.");
      }

      setRegisteredRecordsDirty(false);
      setRegisteredRecordsMessage(
        "EPs e datas das conquistas já cadastradas foram atualizados no site sem substituir a lista pública."
      );
      try {
        await persistPreparation(result.achievements);
      } catch {
        setRegisteredRecordsMessage(
          "EPs e datas atualizados no site. Não consegui salvar uma cópia desses campos no rascunho; os dados públicos já foram atualizados."
        );
      }
    } catch (error) {
      setRegisteredRecordsMessage(
        error instanceof Error ? error.message : "Não foi possível atualizar os registros publicados."
      );
    } finally {
      setRegisteredRecordsSaving(false);
    }
  }

  async function saveFinalMasteryRecordToSite() {
    if (!result?.game.slug || finalMasteryRecordSaving) return;

    setFinalMasteryRecordSaving(true);
    setFinalMasteryRecordMessage("");
    setError("");

    try {
      const response = await fetch("/api/admin/achievement-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: result.game.slug,
          records: [],
          finalMastery: {
            episode: String(result.game.finalMasteryEpisode ?? "").trim(),
            earnedDate: normalizeAchievementDateInput(result.game.finalMasteryDate),
          },
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Não foi possível salvar o registro da Maestria Final no site.");
      }

      setFinalMasteryRecordMessage("EP/data da Maestria Final salvos no site. Atualize a página pública para conferir.");
    } catch (error) {
      setFinalMasteryRecordMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar o registro da Maestria Final no site."
      );
    } finally {
      setFinalMasteryRecordSaving(false);
    }
  }

  async function savePreparation() {
    if (!result?.game.slug) return;

    setDraftLoading(true);
    setError("");
    setPublished(false);

    try {
      await persistPreparation(result.achievements);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar rascunho.");
    } finally {
      setDraftLoading(false);
    }
  }

  async function publishPreparation() {
    if (!result?.game.slug || publishing) return;

    if (registeredOutsideAchievements.length > 0) {
      const confirmed = window.confirm(
        `Existem ${registeredOutsideAchievements.length} conquista(s) já publicadas fora da lista de preparação atual. Publicar a lista principal pode remover essas conquistas do site. Para corrigir apenas EP/data, use “Atualizar registros no site” na seção de conquistas já cadastradas. Deseja substituir a lista pública mesmo assim?`
      );
      if (!confirmed) return;
    }

    const publishable = result.achievements.filter((a) => !a.notDoing);
    const selectedJourneyIds = publishable
      .filter((a) => a.journey)
      .map((a) => a.id)
      .filter(Boolean);

    if (!publishable.length) {
      setError("Nenhuma conquista está selecionada para publicação.");
      return;
    }

    if (publishable.some((a) => !a.description.trim())) {
      setError("Existem conquistas selecionadas sem descrição.");
      return;
    }

    setPublishing(true);
    setError("");
    setPublished(false);

    try {
      const gamesResponse = await fetch("/api/admin/games", {
        cache: "no-store",
      });
      const gamesPayload = await gamesResponse.json().catch(() => null);

      if (!gamesResponse.ok || !Array.isArray(gamesPayload?.games)) {
        throw new Error(
          gamesPayload?.error ||
            "Não foi possível carregar os dados atuais do jogo."
        );
      }

      const currentGame = gamesPayload.games.find(
        (game: { slug?: unknown }) =>
          String(game.slug || "") === result.game.slug
      );

      if (!currentGame) {
        throw new Error("O jogo cadastrado não foi encontrado para publicação.");
      }

      // Publicar alterações sem uma seleção nova não deve apagar uma Jornada
      // já publicada. Uma seleção nova substitui os IDs anteriores; a Jornada
      // continua opcional para jogos que ainda não têm uma configurada.
      const publishableIds = new Set(
        publishable.map((achievement) => String(achievement.id || "").trim()).filter(Boolean)
      );
      const existingJourneyIds =
        currentGame.firstJourney?.status === "completed" &&
        Array.isArray(currentGame.firstJourney.achievementIds)
          ? currentGame.firstJourney.achievementIds
              .map((id: unknown) => String(id || "").trim())
              .filter((id: string) => id && publishableIds.has(id))
          : [];
      const journeyIdsToSave =
        selectedJourneyIds.length > 0 ? selectedJourneyIds : existingJourneyIds;

      const existingAchievements: Record<string, unknown>[] =
        Array.isArray(currentGame.achievementsList)
          ? currentGame.achievementsList
          : [];

      const normalizeKey = (value: unknown) =>
        slugify(String(value || "")).trim();

      const existingById = new Map<string, Record<string, unknown>>();
      for (const achievement of existingAchievements) {
        const id = String(achievement.id || "").trim();
        if (id) existingById.set(id, achievement);
      }

      const existingByTitle = new Map<string, Record<string, unknown>>();
      for (const achievement of existingAchievements) {
        const key = normalizeKey(achievement.title);
        if (key) existingByTitle.set(key, achievement);
      }

      const rankTrophy = {
        Bronze: "🥉",
        Prata: "🥈",
        Ouro: "🥇",
      } as const;

      // Resolve os episódios registrados nas conquistas contra a playlist do jogo.
      // Assim, o EP fica clicável na página pública e abre a live correspondente.
      const episodeVideoByNumber = new Map<string, string>();
      const masteryEpisodeRaw = String(result.game.finalMasteryEpisode ?? "").trim();
      const masteryEpisode = normalizeEpisode(masteryEpisodeRaw);
      const recordedEpisodes = Array.from(new Set([
        ...publishable.map((achievement) => normalizeEpisode(achievement.episode)),
        masteryEpisode,
      ].filter(Boolean)));

      if (recordedEpisodes.length > 0 && currentGame.youtubePlaylistUrl) {
        const playlistId = extractYoutubePlaylistId(
          String(currentGame.youtubePlaylistUrl)
        );

        if (playlistId) {
          try {
            const playlistResponse = await fetch(
              "/api/youtube/playlist?playlistId=" + encodeURIComponent(playlistId),
              { cache: "no-store" }
            );
            const playlistPayload = await playlistResponse.json().catch(() => null);

            if (playlistResponse.ok && Array.isArray(playlistPayload?.videos)) {
              for (const episode of recordedEpisodes) {
                const video = playlistPayload.videos.find(
                  (item: { title?: unknown; playlistWatchUrl?: unknown }) =>
                    titleMatchesEpisode(String(item.title || ""), episode)
                );

                if (video?.playlistWatchUrl) {
                  episodeVideoByNumber.set(
                    episode,
                    String(video.playlistWatchUrl)
                  );
                }
              }
            }
          } catch {
            // A publicação não deve falhar só porque o catálogo do YouTube
            // não respondeu. A conquista continua publicada sem o link da live.
          }
        }
      }

      const firstLiveEpisode = normalizeEpisode(
        String(currentGame.youtubeFirstLiveEpisode || "")
      );
      const firstLiveUrl = String(currentGame.youtubeFirstLiveUrl || "").trim();

      const refreshedAchievementMeta = Object.fromEntries(
        publishable
          .map((achievement) => {
            const episode = achievement.episode?.trim() || "";
            const normalizedEpisode = normalizeEpisode(episode);
            const date = achievement.earnedDate?.trim() || "";
            const liveUrl =
              episodeVideoByNumber.get(normalizedEpisode) ||
              (normalizedEpisode && normalizedEpisode === firstLiveEpisode
                ? firstLiveUrl
                : "");

            if (!normalizedEpisode && !date) {
              return null;
            }

            return [
              achievement.id,
              {
                ...(episode ? { episode } : {}),
                ...(date ? { date } : {}),
                ...(liveUrl ? { liveUrl } : {}),
              },
            ] as const;
          })
          .filter(Boolean) as Array<
            [string, { episode?: string; date?: string; liveUrl?: string }]
          >
      );

      const previousJourneyMeta =
        currentGame.firstJourney?.achievementMeta &&
        typeof currentGame.firstJourney.achievementMeta === "object"
          ? currentGame.firstJourney.achievementMeta
          : {};
      const achievementMeta: Record<string, { episode?: string; date?: string; liveUrl?: string }> = {
        ...previousJourneyMeta,
        ...refreshedAchievementMeta,
      };

      // A Maestria Final tem registro próprio, separado das conquistas comuns.
      // Sua chave corresponde ao ID sintético utilizado na página pública.
      const finalMasteryKey = `${result.game.slug}-final-mastery`;
      const masteryDate = String(result.game.finalMasteryDate ?? "").trim();
      const previousMasteryMeta = achievementMeta[finalMasteryKey] ?? {};
      const nextMasteryMeta: { episode?: string; date?: string; liveUrl?: string } = {
        ...previousMasteryMeta,
      };

      if (masteryEpisodeRaw) {
        nextMasteryMeta.episode = masteryEpisodeRaw;
        const masteryLiveUrl =
          episodeVideoByNumber.get(masteryEpisode) ||
          (masteryEpisode && masteryEpisode === firstLiveEpisode ? firstLiveUrl : "");
        if (masteryLiveUrl) {
          nextMasteryMeta.liveUrl = masteryLiveUrl;
        } else {
          delete nextMasteryMeta.liveUrl;
        }
      } else {
        delete nextMasteryMeta.episode;
        delete nextMasteryMeta.liveUrl;
      }

      if (masteryDate) {
        nextMasteryMeta.date = masteryDate;
      } else {
        delete nextMasteryMeta.date;
      }

      if (nextMasteryMeta.episode || nextMasteryMeta.date || nextMasteryMeta.liveUrl) {
        achievementMeta[finalMasteryKey] = nextMasteryMeta;
      } else {
        delete achievementMeta[finalMasteryKey];
      }

      const originalIndexById = new Map(
        result.achievements.map((achievement, index) => [
          achievement.id,
          index + 1,
        ])
      );

      const achievementsList = publishable.map((achievement) => {
        const existing =
          existingById.get(achievement.id) ||
          existingByTitle.get(normalizeKey(achievement.name));

        const existingRecord = existing as Record<string, unknown> | undefined;
        const fallbackImage =
          achievement.image?.trim() ||
          String(existingRecord?.image || "").trim() ||
          "";
        const earnedDate =
          achievement.earnedDate?.trim() ||
          String(existingRecord?.earnedDate || "").trim();

        return {
          id: achievement.id,
          title: achievement.name.trim(),
          description: achievement.description.trim(),
          trophy:
            String(existingRecord?.trophy || "").trim() ||
            rankTrophy[achievement.rank],
          rank: achievement.rank,
          difficulty: achievement.rank,
          status:
            achievement.status === "completed" ||
            Boolean(achievement.episode?.trim() || earnedDate || achievement.journey)
              ? "completed"
              : String(existingRecord?.status || "").trim() === "completed"
                ? "completed"
                : "locked",
          earnedDate,
          image: fallbackImage,
          isCustom: Boolean(achievement.isCustom),
          isHidden: false,
          source:
            String(existingRecord?.source || "").trim() ||
            (achievement.isCustom ? "manual" : "Exophase"),
          externalId: existingRecord?.externalId,
          officialImage: existingRecord?.officialImage,
        };
      });

      const response = await fetch("/api/admin/games", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: currentGame.slug,
          title: currentGame.title,
          subtitle: currentGame.subtitle,
          status: currentGame.status,
          progress: currentGame.progress,
          hours: currentGame.hours,
          currentObjective: currentGame.current_objective || "",
          image: currentGame.image,
          cardImage: currentGame.card_image,
          platform: currentGame.platform,
          finalBadge: currentGame.final_badge,
          emblem: currentGame.emblem,
          trophies: currentGame.trophies,
          review: currentGame.review,
          manualTotalPlayedMinutes:
            currentGame.manual_total_played_minutes ?? null,
          firstJourney: journeyIdsToSave.length > 0
            ? {
                status: "completed",
                completedAt:
                  currentGame.firstJourney?.completedAt ||
                  new Date().toISOString(),
                achievementIds: journeyIdsToSave,
                achievementMeta,
              }
            : {
                status: "not_started",
                achievementIds: [],
                achievementMeta,
              },
          achievementsList,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          payload?.error || "Não foi possível publicar as conquistas."
        );
      }

      // Confirma que o backend persistiu o registro especial da Maestria Final.
      // Sem esta checagem, a publicação pode concluir mesmo sem EP/data públicos.
      const expectedMasteryEpisode = String(result.game.finalMasteryEpisode ?? "").trim();
      const expectedMasteryDate = String(result.game.finalMasteryDate ?? "").trim();
      if (expectedMasteryEpisode || expectedMasteryDate) {
        const publishedJourney =
          payload?.game?.firstJourney &&
          typeof payload.game.firstJourney === "object"
            ? payload.game.firstJourney as Record<string, unknown>
            : {};
        const publishedMetadata =
          publishedJourney.achievementMeta &&
          typeof publishedJourney.achievementMeta === "object"
            ? publishedJourney.achievementMeta as Record<string, unknown>
            : {};
        const publishedMasteryRaw =
          publishedMetadata[`${result.game.slug}-final-mastery`];
        const publishedMastery =
          publishedMasteryRaw && typeof publishedMasteryRaw === "object"
            ? publishedMasteryRaw as Record<string, unknown>
            : {};
        const episodeWasSaved =
          !expectedMasteryEpisode ||
          normalizeEpisode(String(publishedMastery.episode ?? "")) ===
            normalizeEpisode(expectedMasteryEpisode);
        const dateWasSaved =
          !expectedMasteryDate ||
          String(publishedMastery.date ?? "").trim() === expectedMasteryDate;

        if (!episodeWasSaved || !dateWasSaved) {
          throw new Error(
            "As conquistas foram enviadas, mas o EP/data da Maestria Final não foi confirmado no retorno do servidor. Os dados permanecem no rascunho; tente publicar novamente."
          );
        }
      }

      const clearedAchievements = result.achievements.map((achievement) => ({
        ...achievement,
        journey: false,
        journeySuggestion: false,
      }));

      await persistPreparation(clearedAchievements, {
        journeyFinalized: true,
      });
      setResult((current) =>
        current
          ? { ...current, achievements: clearedAchievements }
          : current
      );
      setJourneyPreparedCount(null);
      setPublished(true);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível publicar as conquistas."
      );
    } finally {
      setPublishing(false);
    }
  }

  async function analyzeVisualBriefs(targets: Prepared[]) {
    const pending = targets.filter(
      (achievement) =>
        Boolean(achievement.visualReferenceUrl) &&
        !achievement.visualBrief?.trim()
    );

    if (!pending.length) {
      return {} as Record<string, string>;
    }

    if (analyzingReferences) {
      return {} as Record<string, string>;
    }

    setAnalyzingReferences(true);
    setError("");
    setAnalysisProgress({ done: 0, total: pending.length });

    const collected: Record<string, string> = {};

    try {
      let latestAchievements = result?.achievements ?? [];

      for (let start = 0; start < pending.length; start += 20) {
        const chunk = pending.slice(start, start + 20);

        const response = await fetch("/api/admin/achievement-visual-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            achievements: chunk.map((achievement) => ({
              id: achievement.id,
              name: achievement.name,
              description: achievement.description,
              visualReferenceUrl: achievement.visualReferenceUrl as string,
            })),
          }),
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Não foi possível analisar as referências visuais.");
        }

        const analyses = Array.isArray(payload.analyses) ? payload.analyses : [];
        const byId = new Map<string, string>(
          analyses
            .filter(
              (analysis: { id?: unknown; brief?: unknown }) =>
                typeof analysis?.id === "string" &&
                typeof analysis?.brief === "string"
            )
            .map((analysis: { id: string; brief: string }) => [
              analysis.id,
              analysis.brief,
            ] as [string, string])
        );

        for (const achievement of chunk) {
          const brief = byId.get(achievement.id);
          if (!brief?.trim()) {
            throw new Error(
              `A análise visual da conquista "${achievement.name}" não retornou um brief válido.`
            );
          }
          collected[achievement.id] = brief.trim();
        }

        latestAchievements = latestAchievements.map((achievement) => {
          const brief = collected[achievement.id];
          return brief ? { ...achievement, visualBrief: brief } : achievement;
        });

        setResult((current) =>
          current
            ? { ...current, achievements: latestAchievements }
            : current
        );

        await persistPreparation(latestAchievements);
        setAnalysisProgress({
          done: Math.min(start + chunk.length, pending.length),
          total: pending.length,
        });
      }

      return collected;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível analisar as referências visuais."
      );
      throw e;
    } finally {
      setAnalyzingReferences(false);
    }
  }

  function buildAchievementPrompt(
    a: Prepared,
    index?: number,
    visualBriefOverride?: string
  ) {
    const numberLabel =
      index !== undefined
        ? String(index + 1).padStart(2, "0")
        : a.filename.split("-")[0];

    const brief =
      visualBriefOverride?.trim() ||
      a.visualBrief?.trim() ||
      "PENDENTE — analisar a referência Exophase antes da geração.";

    return [
      `JOGO: ${result?.game.name ?? ""}`,
      `CONQUISTA ${numberLabel}: ${a.name}`,
      `DESCRIÇÃO: ${a.description || "Sem descrição disponível."}`,
      `ARQUIVO: ${a.filename}`,
      "",
      "FASE 1 — BASE DA CONQUISTA:",
      "Crie primeiro uma direção visual ORIGINAL para esta conquista usando somente o significado do nome, da descrição e do universo do jogo.",
      "Defina o símbolo, objeto ou ação principal que comunica a conquista imediatamente.",
      "",
      "FASE 2 — AJUSTE VISUAL DA REFERÊNCIA:",
      "Depois de criar a base, aplique somente os atributos visuais amplos registrados no brief abaixo.",
      "O brief funciona como camada estética: paleta, contraste, traço, composição, atmosfera, iluminação, textura, acabamento e densidade de detalhes.",
      "O brief NÃO substitui a base e NÃO deve determinar personagens, poses, ícones, logos, textos ou desenhos reconhecíveis da referência.",
      "",
      "MATRIZ VISUAL OFICIAL DO RUMO À CONQUISTA:",
      "1. IDENTIDADE: parecer parte de uma coleção consistente sem repetir uma fórmula fixa.",
      "2. FOCO: um elemento principal forte deve comunicar a conquista à primeira vista.",
      "3. EDGE-TO-EDGE: formato 1:1 e arte ocupando 100% do canvas, tocando diretamente as quatro bordas. Não criar margem, faixa ou fundo externo preto.",
      "4. PALETA: seguir o perfil visual do brief. Se monocromática ou muito restrita, preservar essa característica.",
      "5. SEM TEXTO: não inserir texto, letras, números, nomes ou logotipos.",
      "6. ORIGINALIDADE: a referência é somente fonte de análise estética abstrata. Não copiar, recortar, filtrar, transformar, redesenhar ou reproduzir personagens, objetos exclusivos, símbolos específicos, poses, textos, logos ou composições reconhecíveis da referência. A arte final deve ser uma composição nova e independente.",
      "7. SAÍDA: exatamente UMA imagem PNG individual de 1024x1024 px.",
      "8. LEGIBILIDADE: prioridade absoluta. Usar 1 elemento principal dominante, poucos elementos secundários, silhueta clara e alto contraste; a imagem deve continuar compreensível quando reduzida para aproximadamente 150–200 px.",
      "",
      "BRIEF VISUAL TEXTUAL — AJUSTE DA REFERÊNCIA:",
      brief,
      "",
      "ORDEM FINAL: significado da conquista e base original → ajuste visual textual → Matriz Visual Oficial → detalhes complementares do jogo.",
      "FALLBACK: se a direção inicial for bloqueada, mantenha a base e torne o ajuste visual mais abstrato. Nunca usar a imagem de referência como input direto do gerador.",
    ].join("\n");
  }

  async function copyAchievementPrompt(a: Prepared) {
    try {
      let brief = a.visualBrief?.trim() ?? "";

      if (!brief && a.visualReferenceUrl) {
        const analyzed = await analyzeVisualBriefs([a]);
        brief = analyzed[a.id] ?? "";
      }

      const prompt = buildAchievementPrompt(a, undefined, brief);
      await navigator.clipboard.writeText(prompt);
      setCopiedAchievementId(a.id);
      setTimeout(() => setCopiedAchievementId(null), 2200);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível preparar e copiar o prompt da conquista."
      );
    }
  }

  async function copyNewConversationPrompt() {
    try {
      await navigator.clipboard.writeText(CHATGPT_NEW_CONVERSATION_PROMPT);
      setCopiedNewConversationPrompt(true);
      setTimeout(() => setCopiedNewConversationPrompt(false), 2200);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível copiar o prompt para nova conversa."
      );
    }
  }

  function buildBatchPackageText(batch: Prepared[], batchIndex: number) {
    const lines = [
      "RUMO À CONQUISTA — PACOTE DE ANÁLISE VISUAL + DESCRIÇÕES TEXTUAIS + PROMPTS",
      "",
      `JOGO: ${result?.game.name ?? ""}`,
      `LOTE: ${String(batchIndex + 1).padStart(2, "0")}`,
      `QUANTIDADE: ${batch.length}`,
      "",
      "OBJETIVO DESTE PACOTE:",
      "Usar este TXT junto com a pasta referencias/ para analisar visualmente as referências, transformar essa análise em descrições visuais textuais e, somente depois, criar os prompts textuais finais das artes. As imagens de referência servem apenas para análise e não são usadas como entrada direta na geração.",
      "REGRA DE SAÍDA DAS ARTES: cada conquista será gerada como um arquivo individual de 1024x1024 px, com legibilidade como prioridade absoluta. Quando a geração começar, seguir estritamente a ordem #01 → #02 → #03 → ... → última conquista, sem repetir uma conquista já concluída e sem pular números. Nunca criar uma imagem contendo várias conquistas.",
      "",
      "============================================",
      "REGRA ABSOLUTA DE GERAÇÃO — NÃO CRIAR COLAGEM",
      "O LOTE É UMA LISTA DE CONQUISTAS, NÃO UMA ÚNICA IMAGEM.",
      "CADA CONQUISTA DEVE SER GERADA EM UMA IMAGEM/ARQUIVO SEPARADO.",
      "É PROIBIDO criar uma imagem contendo várias conquistas, 10 conquistas em uma imagem, 5 conquistas em uma imagem, grade, mosaico, contact sheet, folha de recorte, painel, storyboard, sprite sheet ou qualquer composição com várias artes.",
      "NUNCA coloque duas ou mais conquistas no mesmo arquivo.",
      "FORMATO OBRIGATÓRIO: 1 conquista = 1 imagem; 1 imagem = 1 arquivo; 1024 × 1024 px; proporção 1:1; PNG.",
      "EXECUÇÃO SEQUENCIAL: quando o usuário solicitar todas as conquistas do lote, execute uma conquista por vez: #01 → gerar somente #01; #02 → gerar somente #02; #03 → gerar somente #03; e assim por diante até a última conquista.",
      "Cada geração deve conter SOMENTE a conquista correspondente ao número atual.",
      "Depois que uma conquista for concluída, marque-a internamente como CONCLUÍDA e avance imediatamente para a próxima.",
      "NUNCA reutilize uma imagem anterior para representar outra conquista.",
      "NUNCA combine duas conquistas na mesma geração.",
      "CONTROLE ANTES DE CADA GERAÇÃO: confira obrigatoriamente o número, o nome e a descrição da próxima conquista ainda não concluída; gere SOMENTE essa conquista.",
      "REGRA DE PARADA: o lote só termina quando TODAS as conquistas tiverem seu próprio arquivo individual.",
      "REGRA DE ERRO: se uma geração for bloqueada ou falhar, não transforme várias conquistas em uma única imagem e não pule para a próxima. Refaça SOMENTE a conquista que falhou usando uma composição mais simples, abstrata e independente.",
      "TESTE FINAL: antes de entregar cada imagem, confirme internamente: 'Esta imagem representa exatamente UMA conquista?'. Se a resposta não for SIM, não finalize.",
      "IMPORTANTE: 'GERAR TODAS' significa gerar TODAS AS CONQUISTAS INDIVIDUALMENTE, uma imagem por vez. NUNCA significa colocar todas as conquistas em uma única imagem.",
      "============================================",
      "",
      "FLUXO OBRIGATÓRIO:",
      "1. Analise TODAS as referências do lote em conjunto para identificar o DNA VISUAL GERAL do jogo/lote.",
      "2. Depois analise CADA referência individualmente, relacionando a imagem apenas à conquista correspondente e convertendo sua aparência em uma DESCRIÇÃO VISUAL TEXTUAL.",
      "3. Para cada conquista, crie primeiro a BASE DA CONQUISTA usando o nome, a descrição e o contexto do jogo.",
      "4. Em seguida, transforme a análise da referência daquela conquista em uma DESCRIÇÃO VISUAL TEXTUAL INDIVIDUAL, usando somente características estéticas abstratas.",
      "5. Acrescente o DNA VISUAL GERAL do lote para manter coerência entre todas as artes.",
      "6. Aplique a MATRIZ VISUAL OFICIAL DO RUMO À CONQUISTA.",
      "7. Entregue os prompts finais, um por conquista, usando somente as descrições textuais e os dados textuais da conquista.",
      "8. NÃO gerar imagens nesta fase de análise. A geração posterior deve seguir a regra de uma conquista por arquivo e a sequência numérica do lote sem repetição ou salto.",
      "",
      "ANÁLISE — REGRAS IMPORTANTES:",
      "• A pasta referencias/ contém imagens para análise visual. Não usar nenhuma referência como input direto na geração da arte.",
      "• A referência é somente uma fonte para produzir uma descrição textual de linguagem estética abstrata. Ela NÃO é um molde para transformação, edição ou reprodução.",
      "• A análise deve abstrair atributos visuais amplos: paleta, contraste, luminosidade, linha/traço, espessura dos contornos, acabamento, textura, composição geral, enquadramento, atmosfera, iluminação, ritmo visual, densidade de detalhes e equilíbrio entre figura e fundo.",
      "• NÃO reproduzir personagens específicos, criaturas reconhecíveis, poses, rostos, roupas características, objetos exclusivos, símbolos específicos, ícones exclusivos, logos, textos ou composições/enquadramentos reconhecíveis das referências.",
      "• A referência deve primeiro ser convertida em texto. Depois disso, a geração deve usar somente esse texto, o significado da conquista, o DNA visual abstrato e a Matriz Visual Oficial. A arte final deve ser uma composição nova e independente.",
      "• Não inventar detalhes que não estejam sustentados pelo nome, descrição, contexto do jogo ou pela própria referência.",
      "• Se uma referência for monocromática ou tiver uma paleta muito restrita, registrar isso e preservar rigorosamente essa característica no prompt final. Não introduzir novas cores por preferência estética.",
      "• Se uma referência estiver ausente ou ilegível, registrar a limitação e trabalhar somente com o material disponível.",
      "",
      "ETAPA 1 — DNA VISUAL GERAL DO LOTE:",
      "Produza um resumo curto e objetivo dos traços visuais que podem ser compartilhados pela coleção: paleta predominante, contraste, tratamento de luz, linguagem de traço, acabamento, textura, atmosfera, composição recorrente e densidade de detalhes.",
      "Não transforme esse DNA em uma fórmula rígida. Ele serve para coerência, enquanto cada conquista continua tendo sua própria identidade.",
      "",
      "ETAPA 2 — DESCRIÇÃO VISUAL TEXTUAL INDIVIDUAL:",
      "Para cada conquista, analise a referência correspondente e produza uma DESCRIÇÃO VISUAL TEXTUAL curta, objetiva e autossuficiente. Descreva somente características estéticas abstratas úteis para geração: paleta, contraste, iluminação, linha, contornos, textura, acabamento, atmosfera, enquadramento geral, densidade de detalhes e relação entre figura e fundo. NÃO descreva nem transporte para o texto personagens específicos, poses, rostos, roupas características, objetos exclusivos, símbolos específicos, ícones exclusivos ou composições reconhecíveis. Depois de criar essa descrição textual, considere a imagem apenas como fonte de análise e NÃO como entrada para a geração.",
      "",
      "ETAPA 3 — PROMPT FINAL:",
      "Cada prompt deve ser autossuficiente e conter, nesta ordem:",
      "A) BASE DA CONQUISTA — significado visual original derivado do nome + descrição + universo do jogo.",
      "B) DESCRIÇÃO VISUAL TEXTUAL — descrição textual abstrata criada a partir da referência específica, sem transportar elementos reconhecíveis da imagem.",
      "C) DNA VISUAL GERAL DO LOTE — características compartilhadas que mantêm a coleção coerente.",
      "D) MATRIZ VISUAL OFICIAL — regras de composição, legibilidade, edge-to-edge, originalidade e saída.",
      "E) REGRA DE GERAÇÃO — usar somente texto. NÃO anexar, enviar ou usar a imagem de referência como input direto do gerador.",
      "",
      "MATRIZ VISUAL OFICIAL DO RUMO À CONQUISTA:",
      "• Uma conquista = uma imagem individual.",
      "• Formato 1:1, preferencialmente 1024x1024, PNG.",
      "• Arte edge-to-edge, tocando diretamente os quatro limites do canvas.",
      "• Não criar margem, faixa, canvas vazio ou área preta externa ao redor da arte.",
      "• Se houver moldura, ela deve fazer parte da composição e tocar diretamente as quatro bordas.",
      "• Legibilidade é prioridade absoluta: 1 elemento principal dominante, poucos elementos secundários e simplificação agressiva de detalhes pequenos quando necessário. A conquista deve ser compreensível mesmo em aproximadamente 150–200 px.",
      "• Não inserir texto, letras, números, nomes ou logotipos.",
      "• Não fazer colagem, painel, mosaico, tríptico, contact sheet, grade, sprite sheet ou múltiplas conquistas na mesma imagem.",
      "• Não usar uma fórmula global fixa de vermelho, dourado, metal, medalha ou 3D. A linguagem deve seguir o DNA visual textual identificado no lote.",
      "• A referência do Exophase é usada apenas para criar uma descrição visual textual. Na geração, usar somente essa descrição textual; nunca a imagem da referência como input direto.",
      "• Se houver qualquer bloqueio ou conflito com a referência, afastar-se de elementos específicos e preservar somente atributos visuais amplos quando apropriado.",
      "",
      "NÃO GERAR IMAGENS NESTA ETAPA.",
      "Primeiro entregue o DNA visual geral, as descrições visuais textuais individuais e os prompts finais. A geração das imagens acontecerá separadamente, uma conquista por vez, usando apenas o prompt textual correspondente e sem usar as imagens do ZIP como input direto.",
      "REGRA DE GERAÇÃO POSTERIOR: quando todas as artes forem geradas, cada conquista deve ser um arquivo individual de 1024x1024 px. Gerar na ordem numérica recebida, sem repetir conquistas já concluídas e sem pular nenhuma. Nunca juntar várias conquistas na mesma imagem.",
      "",
    ];

    batch.forEach((a, localIndex) => {
      const numberLabel = String(batchIndex * batchSize + localIndex + 1).padStart(2, "0");
      lines.push(
        `CONQUISTA ${numberLabel}`,
        `NOME: ${a.name}`,
        `DESCRIÇÃO: ${a.description || "Sem descrição disponível."}`,
        `ARQUIVO DA ARTE FINAL: ${a.filename}`,
        `ARQUIVO DA REFERÊNCIA: referencias/${a.filename}`,
        "",
        "A referência acima corresponde especificamente a esta conquista.",
        "Analise-a individualmente depois de concluir o DNA visual geral do lote.",
        "",
        "-----",
        ""
      );
    });

    return lines.join("\n");
  }
  async function copyBatchPrompt(batch: Prepared[], batchIndex: number) {
    try {
      const packageText = buildBatchPackageText(batch, batchIndex);
      await navigator.clipboard.writeText(packageText);
      setCopiedBatch(batchIndex);
      setTimeout(() => setCopiedBatch(null), 1800);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível preparar e copiar os dados do lote."
      );
    }
  }

  async function downloadBatchPackage(batch: Prepared[], batchIndex: number) {
    setDownloadingBatch(batchIndex);
    setError("");

    try {
      const packageText = buildBatchPackageText(batch, batchIndex);
      const references = batch
        .filter((achievement) => Boolean(achievement.visualReferenceUrl))
        .map((achievement) => ({
          filename: achievement.filename,
          url: achievement.visualReferenceUrl as string,
        }));

      const response = await fetch("/api/admin/achievement-reference-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: `Lote-${String(batchIndex + 1).padStart(2, "0")}.zip`,
          packageText,
          references,
        }),
      });

      if (!response.ok) {
        let message = "Não foi possível montar o ZIP com as referências.";
        const contentType = response.headers.get("content-type") ?? "";

        if (contentType.includes("application/json")) {
          try {
            const payload = await response.json();
            if (payload?.error) message = payload.error;
          } catch {
            // Mantém a mensagem padrão.
          }
        }

        throw new Error(message);
      }

      const zipBlob = await response.blob();
      if (zipBlob.size === 0) {
        throw new Error("O arquivo do lote veio vazio.");
      }

      const url = URL.createObjectURL(zipBlob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `Lote-${String(batchIndex + 1).padStart(2, "0")}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível baixar o ZIP com as referências."
      );
    } finally {
      setDownloadingBatch(null);
    }
  }

  async function clearPreparation() {
    if (!result?.game.slug) return;
    if (
      !window.confirm(
        "Refazer a análise do zero? Isso apagará o rascunho desta preparação e descartará alterações ainda não salvas. As conquistas já publicadas continuarão intactas."
      )
    ) return;

    setDraftLoading(true);
    setError("");

    try {
      const response = await fetch(
        "/api/admin/achievement-prep-draft?slug=" +
          encodeURIComponent(result.game.slug),
        { method: "DELETE" }
      );
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Erro ao limpar rascunho.");
      }

      localStorage.removeItem(`rumo-preparador:${result.game.slug}`);
      setDraftUpdatedAt(null);
      setSaved(false);
      await search(result.game.slug);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Erro ao limpar rascunho."
      );
    } finally {
      setDraftLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <Navbar />

      <div className="mx-auto max-w-[1500px] px-5 py-8 lg:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.28em] text-red-500">
              Admin • Preparador
            </p>
            <h1 className="mt-2 text-4xl font-black">
              {registeredSlug ? "Preparar conquistas" : "Preparar novo jogo"}
            </h1>
            <p className="mt-2 max-w-[820px] text-sm text-white/40">
              {registeredSlug
                ? "Prepare as conquistas de um jogo que já está cadastrado no Rumo à Conquista."
                : "Fluxo provisório para jogos novos. Este botão será transformado no futuro em Adicionar novo jogo."}
            </p>
          </div>

          {registeredSlug && result && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[.025] px-3 py-2">
              <span className="text-[10px] font-black uppercase tracking-[.14em] text-sky-300">
                {draftLoading ? "Salvando..." : saved ? "Rascunho salvo" : "Alterações não salvas"}
              </span>
              {draftUpdatedAt && (
                <span className="text-[10px] text-white/35">
                  • {new Date(draftUpdatedAt).toLocaleString("pt-BR")}
                </span>
              )}
              <button
                type="button"
                onClick={() => void savePreparation()}
                disabled={draftLoading}
                className="rounded-lg border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-[10px] font-black uppercase text-sky-100 disabled:opacity-40"
              >
                💾 Salvar rascunho
              </button>
              <button
                type="button"
                onClick={() => void clearPreparation()}
                disabled={draftLoading}
                className="rounded-lg border border-red-400/20 bg-red-400/[.06] px-3 py-2 text-[10px] font-black uppercase text-red-200 disabled:opacity-40"
              >
                ↻ Refazer análise do zero
              </button>
              <div className="flex flex-col items-stretch gap-1">
                <button
                  type="button"
                  onClick={() => void publishPreparation()}
                  disabled={!publicationStatus.ready || draftLoading || publishing}
                  className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-[10px] font-black uppercase text-emerald-100 disabled:cursor-not-allowed disabled:opacity-35"
                  title={publicationStatus.ready ? "Publicar conquistas" : publicationStatus.reason}
                >
                  {publishing
                    ? "⏳ Publicando..."
                    : published
                      ? "✅ Publicado"
                      : "🚀 Publicar conquistas"}
                </button>
                <span className="text-[9px] text-white/25">
                  {published
                    ? `Publicado: ${publicationStatus.selected} ${publicationStatus.selected === 1 ? "conquista" : "conquistas"}.`
                    : publicationStatus.ready
                      ? "Pronto para publicar"
                      : publicationStatus.reason}
                </span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {registeredSlug && (
              <button
                type="button"
                onClick={() => void clearCompletedAchievements()}
                disabled={clearingCompleted}
                className="rounded-xl border border-red-500/35 bg-red-500/[.10] px-4 py-3 text-xs font-black uppercase text-red-100 transition-colors hover:bg-red-500/[.18] disabled:cursor-wait disabled:opacity-50"
                title="Desmarcar as conquistas concluídas deste jogo sem excluir suas definições ou imagens"
              >
                {clearingCompleted ? "Limpando conquistas..." : "Limpar conquistas feitas"}
              </button>
            )}
            <Link
              href="/admin/jogos"
              className="rounded-xl border border-white/10 bg-white/[.03] px-4 py-3 text-xs font-black uppercase text-white/55"
            >
              Voltar para Jogos
            </Link>
          </div>
        </div>

        {registeredSlug && clearCompletedMessage && (
          <p
            role="status"
            className={`mt-4 rounded-xl border p-3 text-xs font-bold ${
              clearCompletedFailed
                ? "border-red-500/25 bg-red-500/[.07] text-red-200"
                : "border-emerald-500/25 bg-emerald-500/[.07] text-emerald-200"
            }`}
          >
            {clearCompletedMessage}
          </p>
        )}

        {!registeredSlug && (
          <section className="mt-7 rounded-[20px] border border-white/[.08] bg-[#090909] p-5">
            <button type="button" onClick={() => togglePrepItem("section-01")} aria-expanded={!collapsedPrepItems["section-01"]} className="group flex w-full items-center justify-between gap-4 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-red-500/50">
              <span className="text-base font-black text-white">01 • Nome do jogo / Fluxo provisório</span>
              <span className="rounded-lg border border-white/10 bg-white/[.03] px-3 py-2 text-[9px] font-black uppercase text-white/65">{collapsedPrepItems["section-01"] ? "+ Expandir" : "− Minimizar"}</span>
            </button>
            {!collapsedPrepItems["section-01"] && (
              <div className="mt-4">
                <h2 className="text-xl font-black">Nome do jogo</h2>
                <div className="mt-5 flex flex-col gap-3 md:flex-row">
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void search("", title)}
                    placeholder="Ex.: Black Myth: Wukong"
                    className="flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-bold outline-none placeholder:text-white/20"
                  />
                  <button onClick={() => void search("", title)} disabled={loading} className="rounded-xl border border-red-500/30 bg-red-500/10 px-6 py-3 text-xs font-black uppercase text-red-100 disabled:opacity-50">
                    {loading ? "Buscando..." : "Buscar conquistas"}
                  </button>
                </div>
                <p className="mt-3 text-[10px] leading-relaxed text-white/25">Esse caminho será reaproveitado depois para o fluxo completo de adicionar novo jogo, incluindo capa e entrada na Fila.</p>
                {error && <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/[.06] p-3 text-xs font-bold text-red-200">{error}</p>}
              </div>
            )}
          </section>
        )}

        {registeredSlug && error && recoveryStatus.state !== "failed" && (
          <p className="mt-7 rounded-xl border border-red-500/20 bg-red-500/[.06] p-3 text-xs font-bold text-red-200">
            {error}
          </p>
        )}

        {recoveryStatus.state !== "idle" && (
          <section
            role="status"
            aria-live="polite"
            className={`mt-5 rounded-2xl border p-4 ${
              recoveryStatus.state === "success"
                ? "border-emerald-400/25 bg-emerald-500/[.06]"
                : recoveryStatus.state === "failed"
                  ? "border-amber-400/25 bg-amber-500/[.05]"
                  : "border-red-500/25 bg-red-500/[.045]"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className={`text-[10px] font-black uppercase tracking-[.18em] ${
                  recoveryStatus.state === "success"
                    ? "text-emerald-200"
                    : recoveryStatus.state === "failed"
                      ? "text-amber-200"
                      : "text-red-200"
                }`}>
                  {recoveryStatus.state === "success"
                    ? "Correção automática concluída"
                    : recoveryStatus.state === "failed"
                      ? "Recuperação automática encerrada"
                      : "Detectamos um erro · corrigindo automaticamente"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-white/65">{recoveryStatus.message}</p>
              </div>
              <div className="text-2xl font-black tabular-nums text-white">
                {recoveryStatus.progress}%
              </div>
            </div>
            <div
              role="progressbar"
              aria-label="Progresso da correção automática"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={recoveryStatus.progress}
              className="mt-3 h-2 overflow-hidden rounded-full bg-white/[.08]"
            >
              <div
                className={`h-full rounded-full transition-[width] duration-300 ${
                  recoveryStatus.state === "success"
                    ? "bg-emerald-400"
                    : recoveryStatus.state === "failed"
                      ? "bg-amber-400"
                      : "bg-gradient-to-r from-red-600 via-red-400 to-amber-300"
                }`}
                style={{ width: `${recoveryStatus.progress}%` }}
              />
            </div>
            {recoveryStatus.attempts !== undefined && (
              <p className="mt-2 text-[10px] text-white/35">
                Tentativas concluídas: {recoveryStatus.attempts}
              </p>
            )}
            {recoveryStatus.state === "failed" && (
              <>
                {error && (
                  <p className="mt-3 text-xs leading-relaxed text-amber-100/80">
                    Detalhe: {error}
                  </p>
                )}
                <p className="mt-3 text-xs leading-relaxed text-amber-100/75">
                  O progresso ficou em 95% porque não seria correto marcar 100% sem recuperar a lista. Nenhuma conquista publicada foi apagada ou substituída.
                </p>
              </>
            )}
          </section>
        )}

        {loading && !result && recoveryStatus.state !== "running" && (
          <section className="mt-7 rounded-[20px] border border-white/[.08] bg-[#090909] p-6 text-sm text-white/35">
            Buscando as conquistas de {registeredSlug ? "este jogo cadastrado" : "este jogo"}...
          </section>
        )}

        {result && registeredSlug && (
          <section className="mt-5 rounded-[20px] border border-white/[.08] bg-[#090909] p-5">
            <button type="button" onClick={() => togglePrepItem("section-01")} aria-expanded={!collapsedPrepItems["section-01"]} className="group flex w-full items-center justify-between gap-4 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-red-500/50">
              <span className="text-base font-black text-white">01 • Modo de trabalho</span>
              <span className="rounded-lg border border-white/10 bg-white/[.03] px-3 py-2 text-[9px] font-black uppercase text-white/65">{collapsedPrepItems["section-01"] ? "+ Expandir" : "− Minimizar"}</span>
            </button>
            {!collapsedPrepItems["section-01"] && (
              <div className="mt-4">
            <h2 className="text-lg font-black">Como deseja continuar?</h2>
            <p className="mt-1 max-w-[900px] text-xs leading-relaxed text-white/40">
              A lista existente será preservada. Só a opção “Refazer análise do zero” apaga o rascunho e consulta novamente o Exophase.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setPreparationMode("edit");
                  setPreparationModeNotice("Modo de edição ativo. Sua lista atual foi mantida e não houve nova análise.");
                }}
                className={preparationMode === "edit"
                  ? "rounded-xl border border-emerald-400/35 bg-emerald-400/[.10] px-4 py-3 text-[10px] font-black uppercase text-emerald-100"
                  : "rounded-xl border border-white/10 bg-white/[.03] px-4 py-3 text-[10px] font-black uppercase text-white/55"}
              >
                Continuar / editar lista
              </button>
              <button
                type="button"
                onClick={() => {
                  setPreparationMode("append");
                  setPreparationModeNotice("Modo de acréscimo ativo. As conquistas existentes serão mantidas; adicione somente as novas abaixo.");
                  window.setTimeout(() => {
                    document.getElementById("manual-achievement-section")?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }, 50);
                }}
                className={preparationMode === "append"
                  ? "rounded-xl border border-blue-400/35 bg-blue-500/[.10] px-4 py-3 text-[10px] font-black uppercase text-blue-100"
                  : "rounded-xl border border-white/10 bg-white/[.03] px-4 py-3 text-[10px] font-black uppercase text-white/55"}
              >
                + Adicionar conquistas à lista atual
              </button>
            </div>
            {preparationModeNotice && (
              <p className="mt-3 rounded-lg border border-white/[.07] bg-black/20 px-3 py-2 text-xs text-white/55">
                {preparationModeNotice}
              </p>
            )}
              </div>
            )}
          </section>
        )}

        {result && (
          <>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_270px] xl:items-start">
              <div className="min-w-0">
            <section className="mt-5 rounded-[20px] border border-white/[.08] bg-[#090909] p-5">
              <button type="button" onClick={() => togglePrepItem("section-02")} aria-expanded={!collapsedPrepItems["section-02"]} className="group flex w-full items-center justify-between gap-4 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-red-500/50">
                <span className="text-base font-black text-white">02 • Resultado{collapsedPrepItems["section-02"] ? " · " + result.game.name : ""}</span>
                <span className="rounded-lg border border-white/10 bg-white/[.03] px-3 py-2 text-[9px] font-black uppercase text-white/65">{collapsedPrepItems["section-02"] ? "+ Expandir" : "− Minimizar"}</span>
              </button>
              {!collapsedPrepItems["section-02"] && (
                <>
              <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-2xl font-black">{result.game.name}</h2>
                  <p className="text-xs text-white/30">
                    {result.achievements.length} conquistas encontradas • Fonte:{" "}
                    {result.game.source}
                  </p>
                </div>

                <div className="rounded-2xl border border-red-500/20 bg-red-500/[.05] px-4 py-3 text-right">
                  <p className="text-[8px] uppercase text-white/30">
                    Jornada de Estreia
                  </p>
                  <p className="text-lg font-black text-red-100">
                    {selected.length} selecionadas
                  </p>
                </div>
              </div>

              {result.warnings?.map((warning) => (
                <p key={warning} className="mt-3 text-xs text-yellow-100/60">
                  • {warning}
                </p>
              ))}

              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-violet-400/10 bg-violet-400/[.03] p-3">
                <span className="text-[10px] font-black uppercase tracking-[.12em] text-violet-200/60">
                  Exophase
                </span>
                <span
                  className={
                    result.game.exophase?.found
                      ? "rounded-full border border-emerald-400/20 bg-emerald-400/[.06] px-4 py-2 text-[10px] font-black text-emerald-200"
                      : "rounded-full border border-yellow-400/20 bg-yellow-400/[.05] px-4 py-2 text-[10px] font-black text-yellow-100/70"
                  }
                >
                  {result.game.exophase?.found
                    ? `Jogo localizado • ${result.game.exophase.achievementCount ?? result.achievements.length} conquistas`
                    : "Jogo não localizado"}
                </span>
                {result.game.exophase?.url && (
                  <a
                    href={result.game.exophase.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] font-black uppercase text-violet-200/70 underline underline-offset-4"
                  >
                    Abrir no Exophase
                  </a>
                )}
              </div>
                </>
              )}
            </section>

            <section className="mt-5 rounded-[20px] border border-white/[.08] bg-[#090909] p-5">
              <button type="button" onClick={() => togglePrepItem("section-03")} aria-expanded={!collapsedPrepItems["section-03"]} className="group mb-4 flex w-full items-center justify-between gap-4 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-red-500/50">
                <span className="text-base font-black text-white">03 • Seleção da Jornada</span>
                <span className="rounded-lg border border-white/10 bg-white/[.03] px-3 py-2 text-[9px] font-black uppercase text-white/65">{collapsedPrepItems["section-03"] ? "+ Expandir" : "− Minimizar"}</span>
              </button>
              {!collapsedPrepItems["section-03"] && (
                <>
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase">
                  {([
                    ["Bronze", rankCounts.Bronze],
                    ["Prata", rankCounts.Prata],
                    ["Ouro", rankCounts.Ouro],
                  ] as const).map(([rank, count]) => (
                    <span
                      key={rank}
                      title={rank}
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/20 px-3 py-2"
                    >
                      <TrophyIcon rank={rank} className="h-4 w-4" />
                      <span className="text-[10px] font-black">{count}</span>
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2.5 text-[10px] font-black uppercase">
                  <span className="rounded-full border border-emerald-400/25 bg-emerald-400/[.06] px-3.5 py-2 text-emerald-200">
                    Verde = análise: confirmada ou provável
                  </span>
                  <span className="rounded-full border border-yellow-400/25 bg-yellow-400/[.06] px-3.5 py-2 text-yellow-100">
                    Amarelo = fora da Jornada / revisar
                  </span>
                </div>
              </div>

              <div className="mt-3 flex flex-col gap-3 rounded-xl border border-emerald-400/[.10] bg-emerald-400/[.025] p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs leading-relaxed text-white/45">
                  <span className="font-black text-white/70">🤖 Análise da Jornada:</span> conquistas <span className="font-black text-emerald-200">confirmadas</span> e <span className="font-black text-emerald-200">provavelmente feitas</span> entram juntas como verde. O que não se encaixa fica amarelo para você revisar.
                  {journeyPreparedCount !== null && (
                    <p className="mt-1 text-[10px] font-bold text-emerald-200/80">
                      {journeyPreparedCount} {journeyPreparedCount === 1 ? "conquista preparada" : "conquistas preparadas"} para a Jornada de Estreia.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void prepareJourneyDecision()}
                  disabled={journeyAnalysisLoading}
                  className="shrink-0 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-[9px] font-black uppercase text-emerald-100 hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {journeyAnalysisLoading
                    ? "⏳ Analisando..."
                    : "⚡ Analisar Jornada"}
                </button>
              </div>


              <div className="mt-3 rounded-xl border border-blue-400/[.12] bg-blue-400/[.035] p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-[.18em] text-blue-200/80">
                      EP de início da Jornada
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-white/45">
                      O EP 01 já começa preenchido. Abaixo aparece a live correspondente da playlist do jogo para você selecionar.
                    </p>
                  </div>

                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                    <input
                      type="text"
                      value={journeyStartEpisode}
                      onChange={(e) => {
                        const value = e.target.value;
                        updateJourneyStartEpisode(value);
                        setJourneyLiveOptions([]);
                        setJourneySelectedLive(null);
                        setJourneyLiveSelecting(false);
                        setJourneyLiveError("");

                        const normalized = normalizeEpisode(value);
                        if (normalized && result?.game.youtubePlaylistUrl) {
                          void loadJourneyLiveOptions("EP " + normalized);
                        }
                      }}
                      onBlur={() => void saveJourneyStartEpisode()}
                      placeholder="Ex.: EP 01"
                      className="w-full rounded-xl border border-blue-300/20 bg-black/30 px-4 py-3 text-sm font-black text-white outline-none placeholder:text-white/20 sm:w-[150px]"
                    />

                    <button
                      type="button"
                      onClick={() => void loadJourneyLiveOptions()}
                      disabled={
                        journeyLiveLoading ||
                        journeyEpisodeSaving ||
                        !normalizeEpisode(journeyStartEpisode)
                      }
                      className="rounded-xl border border-blue-300/25 bg-blue-300/10 px-4 py-3 text-[9px] font-black uppercase tracking-[.08em] text-blue-100 transition hover:bg-blue-300/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {journeyLiveLoading
                        ? "Carregando..."
                        : journeySelectedLive
                          ? "Trocar live"
                          : "Escolher live"}
                    </button>

                    <span className="text-[9px] font-black uppercase text-blue-200/55">
                      {journeyEpisodeSaving
                        ? "Salvando..."
                        : normalizeEpisode(journeyStartEpisode)
                          ? "✓ EP aplicado"
                          : "Informe o EP inicial"}
                    </span>
                  </div>
                </div>

                {journeyLiveSelecting && (
                  <div className="mt-3 rounded-xl border border-white/[.08] bg-black/20 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-[9px] font-black uppercase tracking-[.14em] text-white/45">
                        Escolha a live do EP {normalizeEpisode(journeyStartEpisode)}
                      </p>
                      <button
                        type="button"
                        onClick={() => setJourneyLiveSelecting(false)}
                        className="text-[9px] font-black uppercase text-white/30 hover:text-white/60"
                      >
                        Fechar
                      </button>
                    </div>

                    {journeyLiveLoading ? (
                      <p className="text-xs text-white/40">
                        Procurando a live na playlist...
                      </p>
                    ) : journeyLiveOptions.length > 0 ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        {journeyLiveOptions.map((video) => (
                          <button
                            type="button"
                            key={video.id}
                            onClick={() => void selectJourneyLive(video)}
                            className="group overflow-hidden rounded-xl border border-white/[.07] bg-white/[.02] text-left transition hover:border-blue-400/35 hover:bg-blue-400/[.05]"
                          >
                            <div className="relative aspect-video overflow-hidden bg-black">
                              {video.thumbnail ? (
                                <img
                                  src={video.thumbnail}
                                  alt=""
                                  className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                                />
                              ) : null}
                              <span className="absolute left-2 top-2 rounded-md border border-red-400/30 bg-red-500/80 px-2 py-1 text-[8px] font-black uppercase tracking-[.08em] text-white">
                                {video.liveStatus === "archived"
                                  ? "LIVE"
                                  : video.liveStatus === "live"
                                    ? "AO VIVO"
                                    : "AGENDADA"}
                              </span>
                            </div>
                            <div className="p-3">
                              <p className="line-clamp-2 text-[12px] font-black leading-[1.35] text-white">
                                {video.title}
                              </p>
                              <p className="mt-1.5 text-[9px] font-black uppercase tracking-[.08em] text-blue-200/55">
                                Clique para selecionar esta live
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs leading-relaxed text-white/40">
                        {journeyLiveError ||
                          "Nenhuma live correspondente foi encontrada."}
                      </p>
                    )}
                  </div>
                )}

                {journeySelectedLive ? (
                  <div className="mt-3 overflow-hidden rounded-xl border border-emerald-400/20 bg-emerald-400/[.025]">
                    <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                      <div className="relative h-20 w-36 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black">
                        {journeySelectedLive.thumbnail ? (
                          <img
                            src={journeySelectedLive.thumbnail}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                        <span className="absolute left-2 top-2 rounded-md bg-emerald-500/80 px-2 py-1 text-[8px] font-black uppercase tracking-[.08em] text-white">
                          EP {normalizeEpisode(journeyStartEpisode)}
                        </span>
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] font-black uppercase tracking-[.14em] text-emerald-200/70">
                          Live vinculada ao EP
                        </p>
                        <p className="mt-1 line-clamp-2 text-[12px] font-black leading-[1.35] text-white">
                          {journeySelectedLive.title}
                        </p>
                      </div>

                      <a
                        href={journeySelectedLive.playlistWatchUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center justify-center rounded-lg border border-red-400/25 bg-red-500/10 px-4 py-3 text-[9px] font-black uppercase tracking-[.08em] text-red-100 transition hover:border-red-400/45 hover:bg-red-500/20"
                      >
                        ▶ Abrir link no YouTube
                      </a>
                    </div>
                  </div>
                ) : !journeyLiveSelecting && !journeyLiveLoading ? (
                  <div className="mt-3 rounded-xl border border-white/[.07] bg-black/20 p-3">
                    <p className="text-xs leading-relaxed text-white/40">
                      {journeyLiveError ||
                        "Carregando a thumb da live do EP..."}
                    </p>
                  </div>
                ) : null}

                {normalizeEpisode(journeyStartEpisode) && !journeySelectedLive && !journeyLiveSelecting ? (
                  <button
                    type="button"
                    onClick={() => void loadJourneyLiveOptions()}
                    className="mt-3 text-[9px] font-black uppercase tracking-[.1em] text-blue-200/60 transition hover:text-blue-100"
                  >
                    ↻ Procurar novamente a live do EP {normalizeEpisode(journeyStartEpisode)}
                  </button>
                ) : null}
              </div>

              <div className="mt-5 rounded-2xl border border-violet-400/30 bg-violet-500/[.06] p-5">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[.18em] text-violet-300">
                      Registro de conquista realizada
                    </p>
                    <h3 className="mt-1 text-lg font-black">O que você fez?</h3>
                    <p className="mt-1 max-w-[900px] text-xs leading-relaxed text-white/45">
                      Escreva do seu jeito. O sistema procura correspondências nas conquistas existentes antes de criar uma nova.
                    </p>
                  </div>
                  <span className="rounded-full border border-violet-300/25 bg-violet-300/10 px-3 py-2 text-[9px] font-black uppercase text-violet-100">
                    🔎 Primeiro relacionar
                  </span>
                </div>

                <textarea
                  value={realizedDescription}
                  onChange={(e) => {
                    setRealizedDescription(e.target.value);
                    setShowRealizedMatches(false);
                  }}
                  rows={3}
                  placeholder="Ex.: melhoria numa arma"
                  className="mt-4 w-full resize-y rounded-xl border border-violet-300/20 bg-black/30 px-4 py-3 text-sm font-bold outline-none placeholder:text-white/20"
                />

                <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                  <label className="min-w-0 text-[9px] font-black uppercase tracking-[.12em] text-white/35">
                    🎬 Episódio
                    <input
                      type="text"
                      value={realizedEpisode}
                      onChange={(e) => setRealizedEpisode(e.target.value)}
                      placeholder="Ex.: 3 ou EP 03"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs font-bold normal-case tracking-normal text-white outline-none placeholder:text-white/20"
                    />
                  </label>

                  <label className="min-w-0 text-[9px] font-black uppercase tracking-[.12em] text-white/35">
                    📅 Data
                    <input
                      type="date"
                      value={realizedDate}
                      onChange={(e) => setRealizedDate(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs font-bold normal-case tracking-normal text-white outline-none"
                    />
                  </label>

                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={analyzeRealizedAchievement}
                      disabled={!realizedDescription.trim()}
                      className="w-full rounded-xl border border-violet-300/30 bg-violet-300/15 px-5 py-3 text-xs font-black uppercase text-violet-50 disabled:opacity-40"
                    >
                      🔎 Encontrar conquista
                    </button>
                  </div>
                </div>

                {showRealizedMatches && (
                  <div className="mt-4 rounded-xl border border-white/[.08] bg-black/20 p-3">
                    {realizedCandidates.length > 0 ? (
                      <>
                        <p className="text-[9px] font-black uppercase tracking-[.16em] text-emerald-200/75">
                          Possíveis correspondências
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-white/40">
                          Confirme manualmente a conquista encontrada antes de registrar o EP e a data.
                        </p>

                        <div className="mt-3 space-y-2">
                          {realizedCandidates.map(({ achievement, score }) => (
                            <button
                              type="button"
                              onClick={() => focusAchievement(achievement.id)}
                              className="w-full rounded-xl border border-white/[.07] bg-white/[.02] p-3 text-left transition hover:border-violet-300/30 hover:bg-violet-400/[.05]"
                            >
                              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                                <div className="min-w-0">
                                  <p className="text-sm font-black">{achievement.name}</p>
                                  <p className="mt-1 text-xs leading-relaxed text-white/40">
                                    {achievement.description || "Sem descrição disponível."}
                                  </p>
                                  <p className={`mt-2 text-[9px] font-black uppercase tracking-[.1em] ${realizedMatchTone(score)}`}>
                                    Correspondência {realizedMatchLabel(score)} · {Math.round(score * 100)}% na busca
                                  </p>
                                  <p className="mt-2 text-[9px] font-black uppercase tracking-[.12em] text-violet-200/55">
                                    Clique para abrir a conquista e editar EP + data
                                  </p>
                                </div>
                                <div className="flex shrink-0 flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => focusAchievement(achievement.id)}
                                    className="rounded-lg border border-violet-400/30 bg-violet-400/10 px-4 py-2 text-[9px] font-black uppercase text-violet-100"
                                  >
                                    ↗ Ir para conquista
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => registerRealizedAchievement(achievement.id)}
                                    disabled={!realizedEpisode.trim() || !realizedDate.trim()}
                                    className="rounded-lg border border-emerald-400/30 bg-emerald-400/[.10] px-4 py-2 text-[9px] font-black uppercase text-emerald-100 disabled:opacity-35"
                                  >
                                    ✓ Relacionar e registrar
                                  </button>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[.02] px-3 py-2 text-[9px] font-black uppercase text-white/45">
                            Rank da nova
                            <select
                              value={realizedRank}
                              onChange={(e) =>
                                setRealizedRank(e.target.value as "Bronze" | "Prata" | "Ouro")
                              }
                              className="rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-[10px] font-black text-white outline-none"
                            >
                              <option value="Bronze">Bronze</option>
                              <option value="Prata">Prata</option>
                              <option value="Ouro">Ouro</option>
                            </select>
                          </label>
                          <button
                            type="button"
                            onClick={() => registerRealizedAchievement("", true)}
                            disabled={!realizedEpisode.trim() || !realizedDate.trim()}
                            className="rounded-lg border border-sky-400/30 bg-sky-400/10 px-4 py-2 text-[9px] font-black uppercase text-sky-100 disabled:opacity-35"
                          >
                            ➕ Nenhuma corresponde — criar nova
                          </button>
                          <button
                            type="button"
                            onClick={clearRealizedRegister}
                            className="rounded-lg border border-white/10 bg-white/[.03] px-4 py-2 text-[9px] font-black uppercase text-white/55"
                          >
                            Limpar
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="text-[9px] font-black uppercase tracking-[.16em] text-yellow-200/75">
                          Nenhuma correspondência encontrada
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-white/40">
                          Não encontramos uma correspondência forte. Você pode criar uma nova conquista e registrar o episódio e a data.
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[.02] px-3 py-2 text-[9px] font-black uppercase text-white/45">
                            Rank da nova
                            <select
                              value={realizedRank}
                              onChange={(e) =>
                                setRealizedRank(e.target.value as "Bronze" | "Prata" | "Ouro")
                              }
                              className="rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-[10px] font-black text-white outline-none"
                            >
                              <option value="Bronze">Bronze</option>
                              <option value="Prata">Prata</option>
                              <option value="Ouro">Ouro</option>
                            </select>
                          </label>
                          <button
                            type="button"
                            onClick={() => registerRealizedAchievement("", true)}
                            disabled={!realizedEpisode.trim() || !realizedDate.trim()}
                            className="rounded-lg border border-sky-400/30 bg-sky-400/10 px-4 py-2 text-[9px] font-black uppercase text-sky-100 disabled:opacity-35"
                          >
                            ➕ Criar nova conquista
                          </button>
                          <button
                            type="button"
                            onClick={clearRealizedRegister}
                            className="rounded-lg border border-white/10 bg-white/[.03] px-4 py-2 text-[9px] font-black uppercase text-white/55"
                          >
                            Limpar
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div id="manual-achievement-section" className="mt-5 rounded-2xl border border-zinc-400/25 bg-zinc-500/[.045] p-5">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[.18em] text-zinc-300">
                      Conquista manual
                    </p>
                    <h3 className="mt-1 text-lg font-black">Adicionar uma conquista sua</h3>
                    <p className="mt-1 text-xs text-white/45">
                      Escreva sua anotação do jeito que lembrar. O sistema sugere um título, uma descrição melhor e o rank automaticamente; você pode revisar tudo depois.
                      {preparationMode === "append" ? " Neste modo, as conquistas que já existem são mantidas e somente as novas são acrescentadas." : ""}
                    </p>
                  </div>
                  <span className="rounded-full border border-zinc-300/20 bg-zinc-300/[.06] px-3 py-2 text-[9px] font-black uppercase text-zinc-200">
                    ✨ Título + descrição + rank
                  </span>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
                  <input
                    value={manualAchievement}
                    maxLength={600}
                    onChange={(e) => {
                      setManualAchievement(e.target.value);
                      setManualSuggestionNotice("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addManualAchievement();
                      }
                    }}
                    placeholder="Ex.: finalizei o jogo na dificuldade normal"
                    className="min-w-0 rounded-xl border border-zinc-400/20 bg-black/30 px-4 py-3 text-sm font-bold outline-none placeholder:text-white/25"
                  />
                  <button
                    type="button"
                    onClick={() => void addManualAchievement()}
                    disabled={!manualAchievement.trim() || generatingManualAchievement}
                    className="rounded-xl border border-zinc-300/30 bg-zinc-300/[.08] px-6 py-3 text-xs font-black uppercase text-zinc-100 disabled:opacity-40"
                  >
                    {generatingManualAchievement ? "Preparando..." : "Gerar conquista"}
                  </button>
                </div>
                {manualSuggestionNotice && (
                  <p className="mt-3 rounded-lg border border-zinc-400/15 bg-black/20 px-3 py-2 text-xs text-zinc-200/75">
                    {manualSuggestionNotice}
                  </p>
                )}
              </div>

              {showSimilarity && (
                <div className="mt-4 rounded-2xl border border-yellow-400/30 bg-yellow-400/[.05] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[.18em] text-yellow-200/70">
                        ⚠️ Possíveis duplicatas
                      </p>
                      <h3 className="mt-1 text-lg font-black">
                        Encontramos conquistas parecidas
                      </h3>
                      <p className="mt-1 text-xs text-white/40">
                        Sua descrição: <span className="font-black text-white/80">{manualAchievement}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowSimilarity(false);
                        setSimilarCandidates([]);
                      }}
                      className="rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black"
                    >
                      Fechar
                    </button>
                  </div>

                  <div className="mt-4 space-y-3">
                    {similarCandidates.map(({ achievement, score }) => (
                      <div key={achievement.id} className="rounded-xl border border-white/[.08] bg-black/25 p-3">
                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <p className="text-[9px] uppercase text-violet-200/60">Sua conquista</p>
                            <p className="mt-1 text-sm font-black">{manualAchievement}</p>
                          </div>
                          <div>
                            <p className="text-[9px] uppercase text-emerald-200/60">Exophase</p>
                            <p className="mt-1 text-sm font-black">{achievement.name}</p>
                            <p className="mt-1 text-xs text-white/35">{achievement.description}</p>
                          </div>
                        </div>
                        <p className="mt-3 text-[10px] font-black text-yellow-200">
                          Similaridade: {Math.round(score * 100)}%
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openMergeDialog(achievement)}
                            className="rounded-lg border border-violet-400/30 bg-violet-400/10 px-4 py-2 text-[10px] font-black uppercase text-violet-100"
                          >
                            🔀 Mesclar em uma
                          </button>
                          <button
                            type="button"
                            onClick={() => useExophaseCandidate(achievement)}
                            className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-[10px] font-black uppercase text-emerald-100"
                          >
                            🔄 Usar Exophase
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={addCustomAsSeparate}
                    className="mt-4 rounded-lg border border-white/10 bg-white/[.03] px-4 py-2 text-[10px] font-black uppercase text-white/60"
                  >
                    Não é duplicada — adicionar minha conquista
                  </button>
                </div>
              )}

              {mergeCandidate && (
                <div className="mt-4 rounded-2xl border border-violet-400/40 bg-violet-500/[.08] p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[.2em] text-violet-300">
                        Confirmar mesclagem
                      </p>
                      <h3 className="mt-1 text-lg font-black">Transformar em uma única conquista</h3>
                      <p className="mt-1 text-xs text-white/45">
                        Revise o título e a descrição antes de confirmar. A conquista Exophase escolhida será substituída por esta versão única.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMergeCandidate(null)}
                      className="rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase text-white/60"
                    >
                      Cancelar
                    </button>
                  </div>

                  <div className="mt-4 grid gap-3">
                    <label className="text-[10px] font-black uppercase text-white/50">
                      Título final
                      <input
                        value={mergeTitle}
                        onChange={(e) => setMergeTitle(e.target.value)}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-bold text-white outline-none focus:border-violet-400/50"
                      />
                    </label>

                    <label className="text-[10px] font-black uppercase text-white/50">
                      Descrição final
                      <textarea
                        value={mergeDescription}
                        onChange={(e) => setMergeDescription(e.target.value)}
                        rows={3}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-medium text-white/80 outline-none focus:border-violet-400/50"
                      />
                    </label>

                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <label className="text-[10px] font-black uppercase text-white/50">
                        Rank
                        <select
                          value={manualRank}
                          onChange={(e) => setManualRank(e.target.value as "Bronze" | "Prata" | "Ouro")}
                          className="mt-2 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-xs font-black text-white outline-none"
                        >
                          <option value="Bronze">Bronze</option>
                          <option value="Prata">Prata</option>
                          <option value="Ouro">Ouro</option>
                        </select>
                      </label>

                      <button
                        type="button"
                        onClick={confirmMerge}
                        disabled={!mergeTitle.trim() || !mergeDescription.trim()}
                        className="rounded-xl border border-violet-300/40 bg-violet-400/15 px-5 py-3 text-[10px] font-black uppercase text-violet-100 disabled:opacity-40"
                      >
                        🔀 Confirmar mesclagem
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {preparationFilter !== "all" && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
                  <p className="text-[10px] font-bold text-white/60">
                    Filtro ativo: <span className="font-black text-white">{getPreparationFilterLabel(preparationFilter)}</span>
                    <span className="ml-2 text-white/35">
                      · Exibindo {filteredPreparationAchievements.length + (showFinalMasteryInPreparationList ? 1 : 0)} de {preparationCounts.total}
                    </span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setPreparationFilter("all")}
                    className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[9px] font-black uppercase text-white/60 transition hover:border-white/25 hover:text-white"
                  >
                    Ver todas
                  </button>
                </div>
              )}
              {registeredOutsideAchievements.length > 0 && (
                <section className="mb-4 rounded-2xl border border-sky-400/25 bg-sky-500/[.035] p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-[9px] font-black uppercase tracking-[.16em] text-sky-300/75">
                        Registros já publicados
                      </p>
                      <h3 className="mt-1 text-base font-black text-white">
                        Conquistas cadastradas fora desta preparação
                        <span className="ml-2 rounded-full border border-sky-300/20 bg-sky-300/[.08] px-2 py-0.5 text-[10px] text-sky-100">
                          {registeredOutsideAchievements.length}
                        </span>
                      </h3>
                      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-white/45">
                        Estas conquistas já existem no site, mas não fazem parte da lista de preparação atual. Edite EP e data aqui sem adicioná-las à lista que será publicada, evitando substituir a publicação por engano.
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-3 py-1.5 text-[9px] font-black uppercase ${registeredRecordsDirty ? "border-amber-400/25 bg-amber-400/[.08] text-amber-100" : "border-white/10 bg-white/[.025] text-white/35"}`}>
                      {registeredRecordsDirty ? "Alterações pendentes no site" : "Lista pública atual"}
                    </span>
                  </div>

                  <div className="mt-4 space-y-2">
                    {registeredOutsideAchievements.map((achievement) => (
                      <div key={achievement.id} className="rounded-xl border border-white/[.08] bg-black/25 p-3">
                        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
                          {achievement.image ? (
                            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/30">
                              <img src={achievement.image} alt="" className="h-full w-full object-cover" loading="lazy" />
                            </div>
                          ) : (
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/30 text-xl">🏆</div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="text-sm font-black text-white">{achievement.name}</h4>
                              <span className="rounded-full border border-sky-300/20 bg-sky-300/[.06] px-2 py-0.5 text-[9px] font-black text-sky-100">JÁ CADASTRADA</span>
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-white/45">{achievement.description}</p>
                          </div>
                        </div>

                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <label className="min-w-0 text-[9px] font-black uppercase tracking-[.12em] text-white/45">
                            🎬 EP da live
                            <input
                              type="text"
                              value={achievement.episode ?? ""}
                              onChange={(event) => updateRegisteredAchievementRecord(achievement.id, "episode", event.target.value)}
                              placeholder="Ex.: EP 10"
                              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-xs font-bold normal-case tracking-normal text-white outline-none placeholder:text-white/20 focus:border-sky-300/40"
                            />
                          </label>
                          <label className="min-w-0 text-[9px] font-black uppercase tracking-[.12em] text-white/45">
                            📅 Data correta da conquista
                            <input
                              type="date"
                              value={normalizeAchievementDateInput(achievement.earnedDate)}
                              onChange={(event) => updateRegisteredAchievementRecord(achievement.id, "earnedDate", event.target.value)}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-xs font-bold normal-case tracking-normal text-white outline-none focus:border-sky-300/40"
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[10px] leading-relaxed text-white/35">
                      Este botão atualiza apenas os EPs/datas destas conquistas existentes no site. Não publica nem remove as 29 conquistas do rascunho.
                    </p>
                    <button
                      type="button"
                      onClick={() => void saveRegisteredAchievementRecordsToSite()}
                      disabled={registeredRecordsSaving || !registeredRecordsDirty}
                      className="shrink-0 rounded-xl border border-sky-300/25 bg-sky-400/[.08] px-4 py-3 text-[10px] font-black uppercase text-sky-100 transition hover:bg-sky-400/[.14] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {registeredRecordsSaving ? "Salvando registros..." : registeredRecordsDirty ? "Atualizar EP/data no site" : "Sem alterações pendentes"}
                    </button>
                  </div>
                  {registeredRecordsMessage && (
                    <p className={`mt-3 rounded-lg border px-3 py-2 text-[10px] leading-relaxed ${registeredRecordsMessage.includes("atualizados no site") ? "border-emerald-400/20 bg-emerald-400/[.04] text-emerald-100/80" : "border-red-400/20 bg-red-400/[.04] text-red-100/80"}`}>
                      {registeredRecordsMessage}
                    </p>
                  )}
                </section>
              )}
              <div className="mt-4 space-y-0.5">
                {showFinalMasteryInPreparationList && (
                  <div className="w-full rounded-2xl border border-red-500/35 bg-red-500/[.055] p-3">
                    <div className="flex min-w-0 flex-col gap-2">
                      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          {result.game.finalBadge?.image ? (
                            <div className="h-[68px] w-[68px] shrink-0 overflow-hidden rounded-xl border border-red-400/25 bg-black/30">
                              <img src={result.game.finalBadge.image} alt="" className="h-full w-full object-contain" loading="lazy" />
                            </div>
                          ) : (
                            <div className="flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-xl border border-red-400/25 bg-black/30 text-2xl">
                              {result.game.finalBadge?.icon || "🏆"}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-[9px] font-black uppercase tracking-[.14em] text-red-300/75">Maestria Final · recompensa máxima</p>
                            <h3 className="mt-1 text-sm font-black text-white">{result.game.finalBadge?.title?.trim() || "Maestria Final"}</h3>
                            <p className="mt-0.5 text-sm leading-relaxed text-white/50">{result.game.finalBadge?.description?.trim() || "Registro da Maestria Final do jogo."}</p>
                          </div>
                        </div>
                        <span className="self-start rounded-full border border-red-400/25 bg-red-400/[.07] px-3.5 py-2 text-[10px] font-black text-red-100">🏆 MAESTRIA FINAL</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleRecordPanel("final-mastery")}
                        aria-expanded={expandedRecordIds.has("final-mastery")}
                        className="mt-1 flex w-full items-center justify-between gap-3 rounded-xl border border-red-400/[.16] bg-black/20 px-3 py-2 text-left transition hover:border-red-400/30 hover:bg-white/[.025]"
                      >
                        <div className="min-w-0">
                          <p className="text-[9px] font-black uppercase tracking-[.12em] text-white/35">Registro da Maestria Final</p>
                          {(result.game.finalMasteryEpisode?.trim() || result.game.finalMasteryDate?.trim()) ? (
                            <p className="mt-0.5 truncate text-[10px] font-black text-white/50">
                              {result.game.finalMasteryEpisode?.trim() || "EP pendente"} · {result.game.finalMasteryDate?.trim() || "Data pendente"}
                            </p>
                          ) : (
                            <p className="mt-0.5 text-[10px] font-bold text-white/30">EP + data ainda não registrados</p>
                          )}
                        </div>
                        <span className="shrink-0 rounded-lg border border-white/10 bg-white/[.03] px-2.5 py-1.5 text-[10px] font-black text-white/45">
                          {expandedRecordIds.has("final-mastery") ? "▲ Recolher" : "▼ Abrir"}
                        </span>
                      </button>
                      {expandedRecordIds.has("final-mastery") && (
                        <div className="grid w-full gap-2 rounded-xl border border-red-400/[.14] bg-black/25 p-2 lg:grid-cols-[1fr_1fr_auto]">
                          <label className="min-w-0 text-[9px] font-black uppercase tracking-[.12em] text-white/40">
                            🎬 EP da live
                            <input
                              type="text"
                              value={result.game.finalMasteryEpisode ?? ""}
                              onChange={(event) => updateFinalMasteryRecord("finalMasteryEpisode", event.target.value)}
                              placeholder="Ex.: EP 10"
                              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs font-bold normal-case tracking-normal text-white outline-none placeholder:text-white/20 focus:border-red-400/40"
                            />
                          </label>
                          <label className="min-w-0 text-[9px] font-black uppercase tracking-[.12em] text-white/40">
                            📅 Data em que conseguiu
                            <input
                              type="date"
                              value={result.game.finalMasteryDate ?? ""}
                              onChange={(event) => updateFinalMasteryRecord("finalMasteryDate", event.target.value)}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs font-bold normal-case tracking-normal text-white outline-none focus:border-red-400/40"
                            />
                          </label>
                          <div className="flex items-end gap-2">
                            {normalizeEpisode(result.game.finalMasteryEpisode) ? (
                              <Link
                                href={"/conteudo?game=" + encodeURIComponent(result.game.slug ?? "") + "&ep=" + encodeURIComponent(normalizeEpisode(result.game.finalMasteryEpisode))}
                                className="rounded-lg border border-red-400/20 bg-red-400/[.06] px-3 py-2 text-[9px] font-black uppercase text-red-100 transition hover:border-red-400/40 hover:bg-red-400/10"
                              >
                                🔗 Abrir EP {normalizeEpisode(result.game.finalMasteryEpisode)}
                              </Link>
                            ) : (
                              <span className="rounded-lg border border-white/10 bg-white/[.02] px-3 py-2 text-[9px] font-black uppercase text-white/25">Informe o EP para criar o link</span>
                            )}
                            <span className="rounded-lg border border-red-400/15 bg-red-400/[.05] px-3 py-2 text-[9px] font-black uppercase text-red-200/70">
                              {result.game.finalMasteryEpisode?.trim() && result.game.finalMasteryDate?.trim() ? "✓ Registro completo" : "Registro da Maestria"}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-col gap-2 lg:col-span-3 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-[10px] leading-relaxed text-white/40">
                              Este botão salva o EP/data público da Maestria Final sem republicar nem substituir a lista de conquistas.
                            </p>
                            <button
                              type="button"
                              onClick={() => void saveFinalMasteryRecordToSite()}
                              disabled={finalMasteryRecordSaving}
                              className="shrink-0 rounded-lg border border-red-400/25 bg-red-400/[.08] px-4 py-2.5 text-[10px] font-black uppercase text-red-100 transition hover:bg-red-400/[.14] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {finalMasteryRecordSaving ? "Salvando Maestria..." : "Salvar EP/data no site"}
                            </button>
                          </div>
                          {finalMasteryRecordMessage && (
                            <p className={`lg:col-span-3 rounded-lg border px-3 py-2 text-[10px] leading-relaxed ${finalMasteryRecordMessage.includes("salvos no site") ? "border-emerald-400/20 bg-emerald-400/[.04] text-emerald-100/80" : "border-red-400/20 bg-red-400/[.04] text-red-100/80"}`}>
                              {finalMasteryRecordMessage}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                {filteredPreparationAchievements.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-black/20 p-6 text-center text-xs font-bold text-white/40">
                    Nenhuma conquista corresponde a este filtro.
                  </div>
                ) : filteredPreparationAchievements.map((a, i) => (
                  <div
                    id={"achievement-" + a.id}
                    key={a.id}
                      className={PREPARATION_CARD_CLASSES[getPreparationColor(a, focusedAchievementId === a.id)]}
                  >
                    <div className="flex flex-col gap-2">
                      {collapsedPrepItems["result-" + a.id] ? (
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[.06] bg-black/20 p-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <AchievementThumb gameSlug={result.game.slug} achievement={a} />
                            <div className="min-w-0">
                              <p className="text-[8px] uppercase tracking-[.14em] text-white/25">Conquista {i + 1} · minimizada</p>
                              <p className="truncate text-sm font-black text-white">{a.name}</p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <TrophyIcon rank={a.rank} className="h-5 w-5" />
                            <button
                              type="button"
                              onClick={() => togglePrepItem("result-" + a.id)}
                              aria-expanded={false}
                              className="rounded-lg border border-emerald-400/30 bg-emerald-400/[.08] px-3 py-2 text-[10px] font-black text-emerald-100 transition hover:bg-emerald-400/[.15]"
                            >
                              + Expandir
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                      <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                        <AchievementThumb gameSlug={result.game.slug} achievement={a} />
                        {a.isCustom ? (
                        <div className="min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
                          <p className="text-[9px] uppercase text-sky-300/60">
                            Conquista manual
                          </p>
                          <input
                            value={a.name}
                            onChange={(e) => updateCustomAchievement(a.id, "name", e.target.value)}
                            className="mt-1 w-full rounded-lg border border-sky-300/15 bg-black/30 px-3 py-2 text-sm font-black outline-none"
                            aria-label="Título da conquista manual"
                          />
                          <textarea
                            value={a.description}
                            onChange={(e) => updateCustomAchievement(a.id, "description", e.target.value)}
                            rows={2}
                            className="mt-2 w-full resize-none rounded-lg border border-sky-300/15 bg-black/30 px-3 py-2 text-xs font-bold outline-none"
                            aria-label="Descrição da conquista manual"
                          />
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[9px] text-white/30">Mantém o objetivo original</span>
                            <button
                              type="button"
                              onClick={() => void regenerateCustomAchievement(a.id)}
                              disabled={Boolean(rewritingAchievementId)}
                              className="rounded-lg border border-zinc-300/20 bg-zinc-300/[.05] px-3 py-2 text-[9px] font-black uppercase text-zinc-200/80 transition hover:border-zinc-200/40 hover:bg-zinc-300/[.10] hover:text-white disabled:cursor-wait disabled:opacity-40"
                            >
                              {rewritingAchievementId === a.id ? "Gerando versão…" : "↻ Gerar outra versão"}
                            </button>
                          </div>
                          {achievementRewriteNotices[a.id] && (
                            <p role="status" className="mt-2 rounded-lg border border-zinc-400/10 bg-black/20 px-2.5 py-2 text-[9px] leading-relaxed text-zinc-200/65">
                              {achievementRewriteNotices[a.id]}
                            </p>
                          )}
                          <select
                            value={a.rank}
                            onChange={(e) => updateCustomAchievement(a.id, "rank", e.target.value)}
                            className="mt-2 rounded-lg border border-sky-300/15 bg-black/30 px-3 py-2 text-xs font-black outline-none"
                            aria-label="Rank da conquista manual"
                          >
                            <option value="Bronze">Bronze</option>
                            <option value="Prata">Prata</option>
                            <option value="Ouro">Ouro</option>
                          </select>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggle(a.id)}
                          disabled={a.notDoing}
                          className="min-w-0 flex-1 text-left disabled:cursor-default"
                        >
                          <p className="text-[9px] uppercase text-white/25">
                            Conquista {i + 1}
                          </p>
                          <h3 className="mt-1 text-sm font-black">{a.name}</h3>
                          <p className="mt-0.5 text-sm leading-relaxed text-white/50">
                            {a.description || "Sem descrição disponível."}
                          </p>
                        </button>
                      )}
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <span
                          title={a.rank}
                          className="inline-flex h-7 w-7 items-center justify-center"
                        >
                          <TrophyIcon rank={a.rank} className="h-5 w-5" />
                        </span>
                        {a.online && (
                          <span className="rounded-full border border-sky-400/25 bg-sky-400/[.05] px-3.5 py-2 text-[10px] font-black text-sky-200">
                            🌐 Online
                          </span>
                        )}
                        {a.momentary && (
                          <span className="rounded-full border border-orange-400/25 bg-orange-400/[.05] px-3.5 py-2 text-[10px] font-black text-orange-200">
                            ⚠️ Momentânea
                          </span>
                        )}
                        {a.notDoing ? (
                          <button
                            type="button"
                            onClick={() => toggleNotDoing(a.id)}
                            className="rounded-full border border-red-400/40 bg-red-500/15 px-3.5 py-2 text-[10px] font-black text-red-200"
                          >
                            🚫 Não vou fazer · ↩ Incluir
                          </button>
                        ) : (
                          <>
                            <span className="rounded-full border border-white/10 px-3.5 py-2 text-[10px] font-black">
                              👤 {a.journey ? "Decisão: Jornada de Estreia" : "Decisão: Fora da Jornada"}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleNotDoing(a.id)}
                              className="rounded-full border border-red-400/30 bg-red-500/[.05] px-3.5 py-2 text-[10px] font-black text-red-200 hover:bg-red-500/15"
                            >
                              ✕ Não vou fazer
                            </button>
                          </>
                        )}
                          <button
                            type="button"
                            onClick={() => removeAchievementFromPreparation(a.id)}
                            title="Excluir esta conquista da preparação"
                            aria-label={`Excluir ${a.name} da preparação`}
                            className="rounded-full border border-red-400/25 bg-red-500/[.045] px-3 py-2 text-[10px] font-black text-red-200/80 transition hover:border-red-400/50 hover:bg-red-500/15 hover:text-red-100"
                          >
                            🗑 Excluir
                          </button>
                          <button
                            type="button"
                            onClick={() => togglePrepItem("result-" + a.id)}
                            aria-expanded={true}
                            className="rounded-full border border-emerald-400/25 bg-emerald-500/[.06] px-3 py-2 text-[10px] font-black text-emerald-100 transition hover:bg-emerald-500/[.14]"
                          >
                            − Minimizar
                          </button>
                        </div>
                      </div>
                      {!a.notDoing && (
                        <>
                          <button
                            type="button"
                            onClick={() => toggleRecordPanel(a.id)}
                            className="mt-1 flex w-full items-center justify-between gap-3 rounded-xl border border-white/[.07] bg-black/15 px-3 py-2 text-left transition hover:border-white/15 hover:bg-white/[.025]"
                          >
                            <div className="min-w-0">
                              <p className="text-[9px] font-black uppercase tracking-[.12em] text-white/30">
                                Registro da conquista
                              </p>
                              {a.journey ? (
                                <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2">
                                  <p className="truncate text-[10px] font-black uppercase tracking-[.06em] text-emerald-200/80">
                                    🟢 Jornada de Estreia · adquirida nas primeiras lives
                                  </p>
                                  {result.game.youtubePlaylistUrl ? (
                                    <a
                                      href={result.game.youtubePlaylistUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="shrink-0 rounded-md border border-emerald-400/20 bg-emerald-400/[.06] px-2 py-1 text-[9px] font-black uppercase tracking-[.08em] text-emerald-100 transition hover:border-emerald-400/40 hover:bg-emerald-400/[.12]"
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      ▶ ABRIR PLAYLIST
                                    </a>
                                  ) : (
                                    <span className="shrink-0 rounded-md border border-yellow-400/15 bg-yellow-400/[.04] px-2 py-1 text-[9px] font-black uppercase tracking-[.08em] text-yellow-200/45">
                                      Playlist do jogo não cadastrada
                                    </span>
                                  )}
                                </div>
                              ) : a.episode?.trim() || a.earnedDate?.trim() ? (
                                <p className="mt-0.5 truncate text-[10px] font-black text-white/45">
                                  {a.episode?.trim() || "EP pendente"} · {a.earnedDate?.trim() || "Data pendente"}
                                </p>
                              ) : (
                                <p className="mt-0.5 text-[10px] font-bold text-white/30">
                                  EP + data ainda não registrados
                                </p>
                              )}
                            </div>
                            <span className="shrink-0 rounded-lg border border-white/10 bg-white/[.03] px-2.5 py-1.5 text-[10px] font-black text-white/45">
                              {expandedRecordIds.has(a.id) ? "▲ Recolher" : "▼ Abrir"}
                            </span>
                          </button>

                          {expandedRecordIds.has(a.id) &&
                            (a.journey ? (
                              <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/[.04] px-3 py-2.5">
                                <p className="text-[9px] font-black uppercase tracking-[.12em] text-emerald-200/75">
                                  Jornada de Estreia
                                </p>
                                <p className="mt-1 text-xs font-black text-emerald-100/80">
                                  Adquirida nas primeiras lives
                                </p>
                                <p className="mt-1 text-[10px] leading-relaxed text-white/30">
                                  Esta conquista faz parte da Jornada de Estreia, portanto não possui EP nem data individual.
                                </p>
                                {result.game.youtubePlaylistUrl ? (
                                  <a
                                    href={result.game.youtubePlaylistUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-3 inline-flex rounded-lg border border-emerald-400/20 bg-emerald-400/[.06] px-3 py-2 text-[9px] font-black uppercase tracking-[.08em] text-emerald-100 transition hover:border-emerald-400/40 hover:bg-emerald-400/[.12]"
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    ▶ ABRIR PLAYLIST NO YOUTUBE
                                  </a>
                                ) : null}
                              </div>
                            ) : (
                              <div className="grid w-full gap-2 rounded-xl border border-white/[.07] bg-black/20 p-2 lg:grid-cols-[1fr_1fr_auto]">
                                <label className="min-w-0 text-[9px] font-black uppercase tracking-[.12em] text-white/35">
                                  🎬 EP da live
                                  <input
                                    type="text"
                                    value={a.episode ?? ""}
                                    onChange={(e) =>
                                      updateAchievementRecord(a.id, "episode", e.target.value)
                                    }
                                    placeholder="Ex.: EP 04"
                                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs font-bold normal-case tracking-normal text-white outline-none placeholder:text-white/20"
                                  />
                                </label>
                                <label className="min-w-0 text-[9px] font-black uppercase tracking-[.12em] text-white/35">
                                  📅 Data em que conseguiu
                                  <input
                                    type="date"
                                    value={a.earnedDate ?? ""}
                                    onChange={(e) =>
                                      updateAchievementRecord(a.id, "earnedDate", e.target.value)
                                    }
                                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs font-bold normal-case tracking-normal text-white outline-none"
                                  />
                                </label>
                                <div className="flex items-end gap-2">
                                  {normalizeEpisode(a.episode) ? (
                                    (() => {
                                      const achievementEpisode = normalizeEpisode(a.episode);
                                      const journeyEpisode = normalizeEpisode(
                                        result.game.youtubeFirstLiveEpisode
                                      );
                                      const directJourneyLive =
                                        achievementEpisode &&
                                        journeyEpisode &&
                                        achievementEpisode === journeyEpisode &&
                                        result.game.youtubeFirstLiveUrl
                                          ? result.game.youtubeFirstLiveUrl
                                          : "";

                                      return directJourneyLive ? (
                                        <a
                                          href={directJourneyLive}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="rounded-lg border border-emerald-400/20 bg-emerald-400/[.06] px-3 py-2 text-[9px] font-black uppercase text-emerald-100 transition hover:border-emerald-400/40 hover:bg-emerald-400/10"
                                          onClick={(event) => event.stopPropagation()}
                                        >
                                          ▶ Abrir EP {achievementEpisode}
                                        </a>
                                      ) : (
                                        <Link
                                          href={
                                            "/conteudo?game=" +
                                            encodeURIComponent(result.game.slug ?? "") +
                                            "&ep=" +
                                            encodeURIComponent(achievementEpisode)
                                          }
                                          className="rounded-lg border border-blue-400/20 bg-blue-400/[.06] px-3 py-2 text-[9px] font-black uppercase text-blue-200 transition hover:border-blue-400/40 hover:bg-blue-400/10"
                                          onClick={(event) => event.stopPropagation()}
                                        >
                                          🔗 Abrir EP {achievementEpisode}
                                        </Link>
                                      );
                                    })()
                                  ) : (
                                    <span className="rounded-lg border border-white/10 bg-white/[.02] px-3 py-2 text-[9px] font-black uppercase text-white/25">
                                      Informe o EP para criar o link
                                    </span>
                                  )}
                                  <span className="rounded-lg border border-emerald-400/15 bg-emerald-400/[.05] px-3 py-2 text-[9px] font-black uppercase text-emerald-200/70">
                                    {a.episode?.trim() && a.earnedDate?.trim()
                                      ? "✓ Registro completo"
                                      : "Registro da conquista"}
                                  </span>
                                </div>
                              </div>
                            ))}
                        </>
                      )}
                      </>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex items-center justify-between gap-4 border-t border-white/[.07] pt-5">
                <p className="text-xs text-white/35">
                  A seleção será usada para montar o pacote de referências das artes.
                </p>
                <button
                  type="button"
                  onClick={() => void savePreparation()}
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-3 text-xs font-black uppercase tracking-[.12em] text-red-100"
                >
                  {saved ? "Preparação salva" : "Salvar rascunho"}
                </button>
              </div>
                </>
              )}
            </section>

            {selected.length > 0 && (
              <section className="mt-5 rounded-[20px] border border-red-500/20 bg-red-500/[.025] p-5">
                <button
                  type="button"
                  onClick={() => togglePrepItem("section-prepared")}
                  aria-expanded={!collapsedPrepItems["section-prepared"]}
                  className="group flex w-full items-start justify-between gap-4 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-red-400/50"
                >
                  <span className="min-w-0">
                    <span className="block text-[9px] uppercase tracking-[.18em] text-red-500">04 • Dados preparados</span>
                    <span className="mt-1 block text-xl font-black text-white transition-colors group-hover:text-red-100">Pacote de cada conquista</span>
                    {!collapsedPrepItems["section-prepared"] && (
                      <span className="mt-2 block text-xs text-white/35">
                        Nada precisa ser digitado manualmente. Estes dados serão a base do próximo módulo de lotes para o ChatGPT.
                      </span>
                    )}
                  </span>
                  <span aria-hidden="true" className="shrink-0 rounded-lg border border-red-400/25 bg-red-400/[.06] px-3 py-2 text-[9px] font-black uppercase text-red-100 transition-colors">
                    {collapsedPrepItems["section-prepared"] ? "+ Expandir" : "− Minimizar"}
                  </span>
                </button>
                {!collapsedPrepItems["section-prepared"] && (
                  <div className="mt-4 space-y-3">
                    {selected.map((a, i) => {
                      const itemKey = "prepared-" + a.id;
                      const itemCollapsed = Boolean(collapsedPrepItems[itemKey]);
                      return (
                    <div
                      key={a.id}
                      className="rounded-2xl border border-white/[.07] bg-black/25 p-3"
                    >
                      <button
                        type="button"
                        onClick={() => togglePrepItem(itemKey)}
                        aria-expanded={!itemCollapsed}
                        className="group flex w-full items-start justify-between gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-red-400/50"
                      >
                        <span className="min-w-0">
                          <span className="block text-[8px] uppercase tracking-[.14em] text-white/25">Conquista {String(i + 1).padStart(2, "0")}</span>
                          <span className="mt-1 block text-sm font-black text-white transition-colors group-hover:text-red-100">{a.name}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span title={a.rank} className="inline-flex items-center justify-center rounded-full border border-red-500/20 bg-red-500/[.06] px-3.5 py-2">
                            <TrophyIcon rank={a.rank} className="h-4 w-4" />
                          </span>
                          <span aria-hidden="true" className="rounded-lg border border-red-400/20 bg-red-400/[.05] px-2.5 py-1.5 text-[9px] font-black uppercase text-red-100">{itemCollapsed ? "+ Expandir" : "− Minimizar"}</span>
                        </span>
                      </button>
                      {!itemCollapsed && (
                        <>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <div>
                          <p className="text-[9px] uppercase text-white/25">Descrição</p>
                          <p className="mt-1 text-xs text-white/55">
                            {a.description || "Sem descrição disponível."}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] uppercase text-white/25">Arquivo</p>
                          <p className="mt-1 text-xs font-bold text-white/70">
                            {a.filename}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] uppercase text-white/25">Jornada de Estreia</p>
                          <p className="mt-1 text-xs font-bold text-red-100">SIM — decisão do preparador</p>
                        </div>
                      </div>

                      <div className="mt-3 rounded-xl border border-white/[.06] bg-white/[.02] p-3">
                        <p className="text-[9px] uppercase text-white/25">
                          Referência visual
                        </p>
                        <p className="mt-1 text-[10px] leading-relaxed text-white/35">
                          Esta referência será incluída no ZIP e analisada visualmente junto com as demais. O site não tenta interpretar a imagem nem envia a referência para geração.
                        </p>
                        {a.visualReferenceUrl ? (
                          <a
                            href={a.visualReferenceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-block text-red-200 underline underline-offset-2 text-[10px]"
                          >
                            abrir fonte visual
                          </a>
                        ) : (
                          <p className="mt-2 text-[10px] text-white/25">
                            Referência visual não disponível.
                          </p>
                        )}
                      </div>

                      <div className="mt-3 rounded-xl border border-white/[.06] bg-white/[.02] p-3">
                        <p className="text-[9px] uppercase text-white/25">
                          Conceito visual
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-white/50">
                          {a.visualConcept}
                        </p>
                        <p className="mt-3 text-[10px] leading-relaxed text-white/35">
                          Referência Exophase:{" "}
                          {a.visualReferenceUrl ? (
                            <a
                              href={a.visualReferenceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-red-200 underline underline-offset-2"
                            >
                              abrir referência visual
                            </a>
                          ) : (
                            "não disponível — criação própria baseada no jogo"
                          )}
                        </p>
                      </div>
                        </>
                      )}
                    </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}
            {selected.length > 0 && (
              <section className="mt-5 rounded-[20px] border border-emerald-500/20 bg-emerald-500/[.025] p-5">
                <button
                  type="button"
                  onClick={() => togglePrepItem("section-material")}
                  aria-expanded={!collapsedPrepItems["section-material"]}
                  className="group flex w-full items-start justify-between gap-4 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
                >
                  <span className="min-w-0">
                    <span className="block text-[9px] uppercase tracking-[.18em] text-emerald-400">05 • Material para ChatGPT</span>
                    <span className="mt-1 block text-xl font-black text-white transition-colors group-hover:text-emerald-100">Copiar instruções e preparar lotes</span>
                    {!collapsedPrepItems["section-material"] && (
                      <span className="mt-2 block max-w-[900px] text-xs leading-relaxed text-white/35">
                        O site prepara tudo automaticamente. Copie as instruções do lote e envie o texto junto com o ZIP + referências para o ChatGPT. A análise visual e a criação dos prompts acontecem aqui, não no site.
                      </span>
                    )}
                  </span>
                  <span aria-hidden="true" className="shrink-0 rounded-lg border border-emerald-400/25 bg-emerald-400/[.06] px-3 py-2 text-[9px] font-black uppercase text-emerald-100 transition-colors">
                    {collapsedPrepItems["section-material"] ? "+ Expandir" : "− Minimizar"}
                  </span>
                </button>
                {!collapsedPrepItems["section-material"] && (
                  <>
                <div className="mt-4 rounded-xl border border-violet-400/15 bg-violet-400/[.025] p-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[.14em] text-violet-300">
                        Prompt base para nova conversa
                      </p>
                      <p className="mt-1 max-w-[900px] text-xs leading-relaxed text-white/40">
                        Use este texto sempre que abrir uma conversa nova para criação de conquistas. Ele define o fluxo: analisar primeiro e gerar somente a conquista específica que você pedir.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyNewConversationPrompt()}
                      className="shrink-0 rounded-lg border border-violet-400/30 bg-violet-400/10 px-4 py-2 text-[9px] font-black uppercase text-violet-100"
                    >
                      {copiedNewConversationPrompt ? "Copiado" : "📋 Copiar prompt base"}
                    </button>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-emerald-400/15 bg-emerald-400/[.035] p-3">
                  <p className="text-[9px] font-black uppercase tracking-[.14em] text-emerald-300">
                    Fluxo
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-white/45">
                    1. <span className="font-black text-white/65">Copiar instruções</span> → 2. <span className="font-black text-white/65">Baixar ZIP + referências</span> → 3. <span className="font-black text-white/65">Enviar os dois juntos ao ChatGPT</span> → 4. DNA visual geral + análise individual → 5. prompts finais → 6. geração das artes, uma por vez.
                  </p>
                </div>

                <div className="mt-5 flex items-center gap-3">
                  <label
                    htmlFor="batch-size"
                    className="text-[9px] font-black uppercase text-white/30"
                  >
                    Conquistas por lote
                  </label>
                  <input
                    id="batch-size"
                    type="number"
                    min={1}
                    max={100}
                    value={batchSize}
                    onChange={(e) =>
                      setBatchSize(
                        Math.min(100, Math.max(1, Number(e.target.value) || 1))
                      )
                    }
                    className="w-20 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm font-bold"
                  />
                </div>

                <div className="mt-4 space-y-2">
                  {Array.from(
                    { length: Math.ceil(selected.length / batchSize) },
                    (_, batchIndex) => {
                      const start = batchIndex * batchSize;
                      const batch = selected.slice(start, start + batchSize);
                      const readyCount = batch.filter((a) => a.visualBrief?.trim()).length;

                      return (
                        <div
                          key={batchIndex}
                          className="rounded-xl border border-white/[.06] bg-white/[.02] p-3"
                        >
                          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <button
                              type="button"
                              onClick={() => togglePrepItem("batch-" + batchIndex)}
                              aria-expanded={!collapsedPrepItems["batch-" + batchIndex]}
                              className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
                            >
                              <span>
                                <span className="block text-xs font-black">
                                  Lote {String(batchIndex + 1).padStart(2, "0")}
                                </span>
                                <span className="block text-[9px] text-white/30">
                                  Conquistas {start + 1}–{start + batch.length} • {readyCount}/{batch.length} briefs prontos
                                </span>
                              </span>
                              <span aria-hidden="true" className="shrink-0 rounded-lg border border-emerald-400/25 bg-emerald-400/[.06] px-3 py-2 text-[9px] font-black uppercase text-emerald-100">
                                {collapsedPrepItems["batch-" + batchIndex] ? "+ Expandir" : "− Minimizar"}
                              </span>
                            </button>

                            {!collapsedPrepItems["batch-" + batchIndex] && (
                            <div className="flex flex-wrap justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => void copyBatchPrompt(batch, batchIndex)}
                                className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-[9px] font-black uppercase text-red-100"
                              >
                                {copiedBatch === batchIndex ? "Copiado" : "📋 Copiar instruções"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void downloadBatchPackage(batch, batchIndex)}
                                disabled={downloadingBatch === batchIndex}
                                className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-[9px] font-black uppercase text-emerald-100 disabled:cursor-wait disabled:opacity-40"
                              >
                                {downloadingBatch === batchIndex
                                  ? "Montando..."
                                  : "📦 Baixar ZIP + referências"}
                              </button>
                            </div>
                            )}
                          </div>

                          {!collapsedPrepItems["batch-" + batchIndex] && (
                            <div className="mt-3 rounded-lg border border-white/[.05] bg-black/20 p-3">
                              <p className="text-[9px] leading-relaxed text-white/30">
                                O texto contém as instruções completas do lote, as conquistas, as descrições, os nomes dos arquivos e o caminho de cada referência dentro do ZIP.
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    }
                  )}
                </div>

                <p className="mt-3 text-[9px] leading-relaxed text-white/25">
                  <span className="font-black text-white/45">Fluxo:</span> Exophase → ZIP + instruções → análise visual no ChatGPT → prompts finais → geração individual das artes.
                </p>
                  </>
                )}
              </section>
            )}


            {(manualSelected.length > 0 || selected.some((a) => !a.isCustom)) && (
              <section className="mt-5 rounded-[20px] border border-zinc-400/20 bg-zinc-500/[.025] p-5">
                <button type="button" onClick={() => togglePrepItem("section-06")} aria-expanded={!collapsedPrepItems["section-06"]} className="group flex w-full items-center justify-between gap-4 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-zinc-300/50">
                  <span className="text-base font-black text-white">06 • Artes e envio de imagens</span>
                  <span className="rounded-lg border border-zinc-300/20 bg-zinc-300/[.06] px-3 py-2 text-[9px] font-black uppercase text-zinc-100">{collapsedPrepItems["section-06"] ? "+ Expandir" : "− Minimizar"}</span>
                </button>
                {!collapsedPrepItems["section-06"] && (
                  <div className="mt-4 space-y-4">
                    {manualSelected.length > 0 && (
                    <div className="rounded-xl border border-zinc-400/15 bg-black/15 p-4">
                <h3 className="text-base font-black text-white">Imagens das conquistas manuais</h3>
                <p className="mt-2 text-xs leading-relaxed text-white/40">
                  Cada conquista manual tem seu próprio arquivo. Copie o prompt individual para criar a imagem e envie o PNG, JPG ou WEBP correspondente; a arte fica vinculada ao rascunho deste jogo.
                </p>

                <div className="mt-4 space-y-2">
                  {manualSelected.map((a) => (
                    <div key={a.id} className="flex flex-col gap-3 rounded-xl border border-zinc-400/15 bg-black/25 p-3 sm:flex-row sm:items-center">
                      <AchievementThumb gameSlug={result.game.slug} achievement={a} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-black text-white">{a.name}</h3>
                          <span className="rounded-full border border-zinc-400/20 bg-zinc-400/[.06] px-2 py-1 text-[9px] font-black text-zinc-200">{a.rank}</span>
                          {a.episode?.trim() && (
                            <span className="rounded-full border border-blue-400/25 bg-blue-500/[.08] px-2 py-1 text-[9px] font-black text-blue-200">
                              EP {normalizeEpisode(a.episode)}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-white/45">{a.description}</p>
                        <p className="mt-1 text-[10px] text-white/25">Arquivo: {a.filename}</p>
                        {a.rankReason && <p className="mt-1 text-[10px] text-zinc-200/55">Rank sugerido: {a.rankReason}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => void copyAchievementPrompt(a)}
                        className="shrink-0 rounded-xl border border-zinc-300/25 bg-zinc-300/[.06] px-4 py-3 text-[10px] font-black uppercase text-zinc-100 transition hover:bg-zinc-300/[.12]"
                      >
                        Copiar prompt da arte
                      </button>
                    </div>
                  ))}
                </div>

                <ImportArtBatchUpload
                  gameSlug={result.game.slug ?? ""}
                  draftMode
                  sectionEyebrow="Upload manual"
                  sectionTitle="Enviar artes das conquistas manuais"
                  sectionDescription="Selecione somente imagens com os nomes de arquivo listados acima. As imagens serão anexadas ao rascunho; clique em Salvar rascunho para persistir a preparação."
                  achievements={manualSelected.map((a) => ({
                    name: a.name,
                    filename: a.filename,
                    rank: a.rank,
                  }))}
                  onSaved={(saved) => {
                    setResult((current) =>
                      current
                        ? {
                            ...current,
                            achievements: current.achievements.map((achievement) => {
                              if (!achievement.isCustom) return achievement;
                              const match = saved.find(
                                (item) =>
                                  item.title.trim().toLocaleLowerCase("pt-BR") ===
                                  achievement.name.trim().toLocaleLowerCase("pt-BR")
                              );
                              return match ? { ...achievement, image: match.image } : achievement;
                            }),
                          }
                        : current
                    );
                    setSaved(false);
                  }}
                />
                    </div>
                    )}
                  {selected.some((a) => !a.isCustom) && (
              <ImportArtBatchUpload
                gameSlug={result.game.slug ?? ""}
                achievements={selected.filter((a) => !a.isCustom).map((a) => ({
                  name: a.name,
                  filename: a.filename,
                  rank: a.rank,
                }))}
                onSaved={(saved) => {
                  setResult((current) =>
                    current
                      ? {
                          ...current,
                          achievements: current.achievements.map((achievement) => {
                            if (achievement.isCustom) return achievement;
                            const match = saved.find(
                              (item) =>
                                item.title.trim().toLocaleLowerCase("pt-BR") ===
                                achievement.name.trim().toLocaleLowerCase("pt-BR")
                            );

                            return match
                              ? { ...achievement, image: match.image }
                              : achievement;
                          }),
                        }
                      : current
                  );
                  setSaved(false);
                }}
              />
                  )}
                  </div>
                )}
              </section>
            )}
              </div>
              <aside
                aria-label="Legenda fixa das cores das conquistas"
                className="order-first block xl:order-none xl:sticky xl:top-24 xl:self-start"
              >
                <section className="rounded-2xl border border-white/10 bg-[#0a0a0b] p-4 shadow-[0_10px_35px_rgba(0,0,0,0.28)]">
                  <p className="text-[9px] font-black uppercase tracking-[.18em] text-red-400">
                    Referência rápida
                  </p>
                  <h2 className="mt-1 text-base font-black text-white">
                    Cores das conquistas
                  </h2>
                  <p className="mt-1 text-[10px] leading-relaxed text-white/35">
                    Clique em um filtro ou em uma cor para mostrar as conquistas correspondentes. Clique novamente para limpar.
                  </p>

                  <div className="mt-4 space-y-2">
                    <p className="text-[9px] font-black uppercase tracking-[.14em] text-white/45">Filtros rápidos</p>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { value: "all", label: "Todas", count: preparationCounts.total },
                        { value: "missing-date", label: "Sem data", count: preparationCounts.missingDate },
                        { value: "journey", label: "Jornada", count: preparationCounts.journey },
                        { value: "manual", label: "Manuais", count: preparationCounts.manual },
                      ] as { value: PreparationFilter; label: string; count: number }[]).map((item) => {
                        const active = preparationFilter === item.value;
                        return (
                          <button
                            key={item.value}
                            type="button"
                            onClick={() => setPreparationFilter(item.value === "all" ? "all" : active ? "all" : item.value)}
                            aria-pressed={active}
                            className={`flex min-w-0 items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition ${active ? "border-red-400/30 bg-red-400/[.08] text-white" : "border-white/10 bg-white/[.02] text-white/60 hover:border-white/20"}`}
                          >
                            <span className="truncate text-[10px] font-black">{item.label}</span>
                            <span className="rounded-full border border-white/10 bg-black/25 px-1.5 py-0.5 text-[10px] font-black tabular-nums">{item.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <p className="text-[9px] font-black uppercase tracking-[.14em] text-white/45">Filtrar por cor</p>
                    {PREPARATION_COLOR_FILTERS.map((item) => {
                      const active = preparationFilter === item.filter;
                      return (
                        <button
                          key={item.name}
                          type="button"
                          onClick={() => setPreparationFilter(active ? "all" : item.filter)}
                          aria-pressed={active}
                          className={`flex w-full items-start gap-2.5 rounded-xl border p-2.5 text-left transition ${active ? "border-white/25 bg-white/[.06]" : "border-transparent hover:border-white/10 hover:bg-white/[.025]"}`}
                        >
                          <span className={`mt-1 h-3 w-3 shrink-0 rounded-sm ${item.color}`} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start justify-between gap-2">
                              <span className="text-[10px] font-black text-white/80">{item.name}</span>
                              <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-black tabular-nums ${active ? "bg-white/10 text-white" : "border border-white/10 bg-black/25 text-white/70"}`}>
                                {item.colorKey === "yellow" ? preparationCounts.outsideJourney : preparationCounts.colors[item.colorKey]}
                              </span>
                            </span>
                            <span className="mt-0.5 block text-[10px] leading-relaxed text-white/40">{item.detail}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-4 rounded-xl border border-red-400/15 bg-red-500/[.04] p-3">
                    <p className="text-[9px] font-black uppercase tracking-[.12em] text-red-200/80">
                      Exclusão segura
                    </p>
                    <p className="mt-1 text-[10px] leading-relaxed text-white/40">
                      O botão Excluir remove a conquista desta preparação. Se ela já estiver pública, publique a lista atualizada para removê-la do site.
                    </p>
                  </div>
                </section>
              </aside>
            </div>
          </>
        )}
      </div>
      {draftListConflict && result && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm"
          role="presentation"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="draft-list-conflict-title"
            className="my-auto w-full max-w-3xl rounded-2xl border border-amber-400/25 bg-[#0b0b0d] p-5 shadow-[0_25px_100px_rgba(0,0,0,.65)] sm:p-6"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-400/20 bg-amber-400/[.08]">
                
                <span className="text-xl" aria-hidden="true">⚠️</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[9px] font-black uppercase tracking-[.18em] text-amber-300/75">
                  Verificação de preparação
                </p>
                <h2 id="draft-list-conflict-title" className="mt-1 text-xl font-black text-white">
                  Há conquistas cadastradas fora da preparação
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-white/55">
                  O rascunho tem {draftListConflict.draftCount} conquistas e o site tem {draftListConflict.publishedCount} cadastradas.
                  {draftListConflict.publishedOnlyCount > 0
                    ? ` ${draftListConflict.publishedOnlyCount} conquista(s) publicada(s) ainda não aparecem na preparação.`
                    : ""}
                  {draftListConflict.metadataToImportCount > 0
                    ? ` ${draftListConflict.metadataToImportCount} registro(s) de EP/data podem ser recuperados do site.`
                    : ""}
                  Escolha como deseja continuar. Nada será publicado automaticamente.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-sky-400/20 bg-sky-400/[.045] p-4">
                <p className="text-[9px] font-black uppercase tracking-[.14em] text-sky-200/70">Rascunho salvo</p>
                <p className="mt-2 text-2xl font-black tabular-nums text-white">{draftListConflict.draftCount}</p>
                <p className="mt-1 text-xs leading-relaxed text-white/45">
                  Mantém o rascunho e deixa as conquistas já publicadas que faltavam disponíveis em uma seção separada para editar EP e data.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setDraftListConflict(null);
                    setPreparationModeNotice("Você continuou com o rascunho salvo. A lista publicada permaneceu intacta.");
                  }}
                  className="mt-4 w-full rounded-xl border border-sky-300/25 bg-sky-400/[.08] px-4 py-3 text-[10px] font-black uppercase text-sky-100 transition hover:bg-sky-400/[.14]"
                >
                  Continuar + mostrar cadastradas ({draftListConflict.publishedOnlyCount})
                </button>
              </div>

              <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[.035] p-4">
                <p className="text-[9px] font-black uppercase tracking-[.14em] text-emerald-200/70">Lista publicada no site</p>
                <p className="mt-2 text-2xl font-black tabular-nums text-white">{draftListConflict.publishedAchievements.length}</p>
                <p className="mt-1 text-xs leading-relaxed text-white/45">
                  Abre a lista que está no site, substituindo apenas a lista ativa do editor. O rascunho antigo continua salvo até você escolher salvar outra lista.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const conflict = draftListConflict;
                    const publishedGame = conflict.publishedGame;
                    const liveJourneyRaw = publishedGame.firstJourney;
                    const liveJourney =
                      liveJourneyRaw && typeof liveJourneyRaw === "object" && !Array.isArray(liveJourneyRaw)
                        ? liveJourneyRaw as Record<string, unknown>
                        : {};
                    const liveMetaRaw = liveJourney.achievementMeta;
                    const liveMeta =
                      liveMetaRaw && typeof liveMetaRaw === "object" && !Array.isArray(liveMetaRaw)
                        ? liveMetaRaw as Record<string, unknown>
                        : {};
                    const masteryMetaRaw = liveMeta[String(publishedGame.slug ?? result.game.slug) + "-final-mastery"];
                    const masteryMeta =
                      masteryMetaRaw && typeof masteryMetaRaw === "object" && !Array.isArray(masteryMetaRaw)
                        ? masteryMetaRaw as Record<string, unknown>
                        : {};
                    const finalBadgeRaw = publishedGame.finalBadge ?? publishedGame.final_badge;
                    const finalBadge =
                      finalBadgeRaw && typeof finalBadgeRaw === "object" && !Array.isArray(finalBadgeRaw)
                        ? finalBadgeRaw as NonNullable<R["game"]["finalBadge"]>
                        : result.game.finalBadge ?? null;

                    setResult((current) => current ? ({
                      ...current,
                      game: {
                        ...current.game,
                        name: String(publishedGame.title ?? current.game.name),
                        slug: String(publishedGame.slug ?? current.game.slug ?? ""),
                        finalBadge,
                        finalMasteryEpisode: String(masteryMeta.episode ?? current.game.finalMasteryEpisode ?? ""),
                        finalMasteryDate: String(masteryMeta.date ?? current.game.finalMasteryDate ?? ""),
                        youtubePlaylistUrl: String(publishedGame.youtubePlaylistUrl ?? current.game.youtubePlaylistUrl ?? ""),
                        youtubeFirstLiveUrl: String(publishedGame.youtubeFirstLiveUrl ?? current.game.youtubeFirstLiveUrl ?? ""),
                        youtubeFirstLiveEpisode: String(publishedGame.youtubeFirstLiveEpisode ?? current.game.youtubeFirstLiveEpisode ?? ""),
                      },
                      achievements: conflict.publishedAchievements,
                    }) : current);
                    setRegisteredOutsideAchievements([]);
                    setRegisteredRecordsDirty(false);
                    setRegisteredRecordsMessage("");
                    setSaved(false);
                    setPublished(false);
                    setDraftUpdatedAt(null);
                    setNeedsDraftSnapshotUpgrade(false);
                    draftSnapshotUpgradeStarted.current = false;
                    setPreparationMode("edit");
                    setPreparationModeNotice("Lista publicada carregada para edição. O rascunho antigo não foi apagado nem substituído; clique em Salvar rascunho somente quando quiser guardar esta lista como a nova preparação.");
                    setDraftListConflict(null);
                  }}
                  className="mt-4 w-full rounded-xl border border-emerald-300/25 bg-emerald-400/[.08] px-4 py-3 text-[10px] font-black uppercase text-emerald-100 transition hover:bg-emerald-400/[.14]"
                >
                  Carregar lista publicada ({draftListConflict.publishedAchievements.length})
                </button>
              </div>
            </div>

            <p className="mt-4 rounded-xl border border-white/10 bg-white/[.025] p-3 text-[10px] leading-relaxed text-white/45">
              Importante: esta escolha altera apenas a lista aberta no Preparador. Não apaga o rascunho antigo nem muda o site. O rascunho só será substituído se você clicar em “Salvar rascunho”; a publicação só muda se clicar em “Publicar conquistas”.
            </p>
          </section>
        </div>
      )}
    </main>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#050505] text-white">
          <Navbar />
          <div className="mx-auto max-w-[1500px] px-5 py-8 lg:px-8 text-sm text-white/35">
            Carregando preparador...
          </div>
        </main>
      }
    >
      <PrepararJogoPage />
    </Suspense>
  );
}
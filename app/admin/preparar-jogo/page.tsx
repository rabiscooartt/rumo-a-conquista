"use client";

// Preview: fluxo de análise visual textual das referências Exophase.

import { Suspense, useEffect, useMemo, useState } from "react";
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
  isCustom?: boolean;
  visualReferenceUrl?: string | null;
  visualBrief?: string;
  image?: string;
};

function AchievementThumb({ gameSlug, achievement }: { gameSlug?: string; achievement: A }) {
  const [failed, setFailed] = useState(false);
  const imageName = slugify(achievement.name || "");
  const imageSrc = achievement.image?.trim()
    ? achievement.image.trim()
    : gameSlug && imageName
      ? `/images/games/${slugify(gameSlug)}/achievements/${imageName}.png`
      : "";

  if (achievement.isCustom || !imageSrc || failed) {
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
        onError={() => setFailed(true)}
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
    exophase?: {
      found: boolean;
      url: string | null;
      achievementCount?: number;
    };
  };
  achievements: A[];
  warnings?: string[];
};

type Prepared = A & { filename: string; visualConcept: string };

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
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [batchSize, setBatchSize] = useState(10);
  const [copiedBatch, setCopiedBatch] = useState<number | null>(null);
  const [copiedNewConversationPrompt, setCopiedNewConversationPrompt] = useState(false);
  const [copiedAchievementId, setCopiedAchievementId] = useState<string | null>(null);
  const [downloadingBatch, setDownloadingBatch] = useState<number | null>(null);
  const [analyzingReferences, setAnalyzingReferences] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ done: 0, total: 0 });
  const [manualAchievement, setManualAchievement] = useState("");
  const [manualRank, setManualRank] = useState<"Bronze" | "Prata" | "Ouro">("Bronze");
  const [similarCandidates, setSimilarCandidates] = useState<
    { achievement: A; score: number }[]
  >([]);
  const [showSimilarity, setShowSimilarity] = useState(false);
  const [mergeCandidate, setMergeCandidate] = useState<A | null>(null);
  const [mergeTitle, setMergeTitle] = useState("");
  const [mergeDescription, setMergeDescription] = useState("");
  const [journeyPreparedCount, setJourneyPreparedCount] = useState<number | null>(null);

  const selected = useMemo(
    () =>
      result?.achievements
        .filter((a) => !a.notDoing)
        .map((a, index) => prepareAchievement(a, index)) ?? [],
    [result]
  );

  const rankCounts = useMemo(() => {
    const counts = { Bronze: 0, Prata: 0, Ouro: 0 };

    for (const achievement of result?.achievements ?? []) {
      if (!achievement.notDoing) counts[achievement.rank] += 1;
    }

    return counts;
  }, [result]);

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
          : "As artes ainda precisam ser validadas antes da publicação.",
    };
  }, [result, saved]);

  async function search(gameSlug = registeredSlug, gameTitle = title) {
    setJourneyPreparedCount(null);
    if (!gameSlug && !gameTitle.trim()) {
      setError("Selecione um jogo cadastrado ou digite o nome de um jogo novo.");
      return;
    }

    setLoading(true);
    setError("");
    setSaved(false);
    setResult(null);

    try {
      const query = gameSlug
        ? "slug=" + encodeURIComponent(gameSlug)
        : "title=" + encodeURIComponent(gameTitle);

      const response = await fetch(
        "/api/admin/achievement-prep?" + query,
        { cache: "no-store" }
      );
      const payload = await response.json();

      if (!response.ok) throw new Error(payload.error || "Erro na busca.");

      setResult(payload);
    } catch (e) {
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
          const draft = payload.draft;
          const journeyIds = new Set<string>(draft.journeyIds ?? []);
          const notDoingIds = new Set<string>(draft.notDoingIds ?? []);
          const visualBriefs = (draft.visualBriefs ?? {}) as Record<string, string>;
          const customAchievements: A[] = draft.customAchievements ?? [];

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
                        visualBrief: visualBriefs[a.id] ?? a.visualBrief ?? "",
                      })),
                    ...customAchievements,
                  ],
                }
              : current
          );
          setDraftUpdatedAt(draft.updatedAt ?? null);
          setSaved(true);
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
  function prepareJourneyDecision() {
    const preparedCount = result?.achievements.filter(
      (a) => !a.notDoing && a.journeySuggestion
    ).length ?? 0;

    setJourneyPreparedCount(preparedCount);
    setSaved(false);
    setResult((current) =>
      current
        ? {
            ...current,
            achievements: current.achievements.map((a) => ({
              ...a,
              journey: !a.notDoing && a.journeySuggestion,
            })),
          }
        : current
    );
  }

  function toggle(id: string) {
    setSaved(false);
    setResult((current) =>
      current
        ? {
            ...current,
            achievements: current.achievements.map((a) =>
              a.id === id && !a.notDoing
                ? { ...a, journey: !a.journey }
                : a
            ),
          }
        : current
    );
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
  function addManualAchievement() {
    const value = manualAchievement.trim();
    if (!result || !value) return;

    const candidates = findSimilarAchievements(value);

    if (candidates.length) {
      setSimilarCandidates(candidates);
      setShowSimilarity(true);
      return;
    }

    const custom: A = {
      id: `custom-${Date.now()}`,
      name: generateManualTitle(value),
      description: value,
      rank: manualRank,
      online: false,
      momentary: false,
      journeySuggestion: false,
      journey: true,
      notDoing: false,
      isCustom: true,
    };

    setSaved(false);
    setResult((current) =>
      current ? { ...current, achievements: [...current.achievements, custom] } : current
    );
    setManualAchievement("");
    setManualRank("Bronze");
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

  function addCustomAsSeparate() {
    const value = manualAchievement.trim();
    if (!result || !value) return;

    const custom: A = {
      id: `custom-${Date.now()}`,
      name: generateManualTitle(value),
      description: value,
      rank: manualRank,
      online: false,
      momentary: false,
      journeySuggestion: false,
      journey: true,
      notDoing: false,
      isCustom: true,
    };

    setSaved(false);
    setResult((current) =>
      current ? { ...current, achievements: [...current.achievements, custom] } : current
    );
    setManualAchievement("");
    setManualRank("Bronze");
    setShowSimilarity(false);
    setSimilarCandidates([]);
  }

  function useExophaseCandidate(candidate: A) {
    setSaved(false);
    setResult((current) =>
      current
        ? {
            ...current,
            achievements: current.achievements.map((a) =>
              a.id === candidate.id
                ? { ...a, journey: true, notDoing: false }
                : a
            ),
          }
        : current
    );
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
  async function persistPreparation(achievements: A[]) {
    if (!result?.game.slug) return;

    const response = await fetch("/api/admin/achievement-prep-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: result.game.slug,
        preparation: {
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
          customAchievements: achievements.filter((a) => a.isCustom),
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

  async function savePreparation() {
    if (!result?.game.slug) return;

    setDraftLoading(true);
    setError("");

    try {
      await persistPreparation(result.achievements);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar rascunho.");
    } finally {
      setDraftLoading(false);
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
        "Limpar o rascunho desta preparação? As conquistas públicas não serão alteradas."
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
                🗑️ Limpar preparação
              </button>
              <div className="flex flex-col items-stretch gap-1">
                <button
                  type="button"
                  disabled={!publicationStatus.ready || draftLoading}
                  className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-[10px] font-black uppercase text-emerald-100 disabled:cursor-not-allowed disabled:opacity-35"
                  title={publicationStatus.ready ? "Publicar conquistas" : publicationStatus.reason}
                >
                  🚀 Publicar conquistas
                </button>
                <span className="text-[9px] text-white/25">
                  {publicationStatus.ready
                    ? "Pronto para publicar"
                    : publicationStatus.reason}
                </span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/jogos"
              className="rounded-xl border border-white/10 bg-white/[.03] px-4 py-3 text-xs font-black uppercase text-white/55"
            >
              Voltar para Jogos
            </Link>
          </div>
        </div>

        {!registeredSlug && (
          <section className="mt-7 rounded-[20px] border border-white/[.08] bg-[#090909] p-5">
            <p className="text-[9px] font-black uppercase tracking-[.18em] text-white/25">
              01 • Fluxo provisório
            </p>
            <h2 className="mt-1 text-xl font-black">Nome do jogo</h2>
            <div className="mt-5 flex flex-col gap-3 md:flex-row">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && void search("", title)
                }
                placeholder="Ex.: Black Myth: Wukong"
                className="flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-bold outline-none placeholder:text-white/20"
              />
              <button
                onClick={() => void search("", title)}
                disabled={loading}
                className="rounded-xl border border-red-500/30 bg-red-500/10 px-6 py-3 text-xs font-black uppercase text-red-100 disabled:opacity-50"
              >
                {loading ? "Buscando..." : "Buscar conquistas"}
              </button>
            </div>
            <p className="mt-3 text-[10px] leading-relaxed text-white/25">
              Esse caminho será reaproveitado depois para o fluxo completo de
              adicionar novo jogo, incluindo capa e entrada na Fila.
            </p>
            {error && (
              <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/[.06] p-3 text-xs font-bold text-red-200">
                {error}
              </p>
            )}
          </section>
        )}

        {registeredSlug && error && (
          <p className="mt-7 rounded-xl border border-red-500/20 bg-red-500/[.06] p-3 text-xs font-bold text-red-200">
            {error}
          </p>
        )}

        {loading && !result && (
          <section className="mt-7 rounded-[20px] border border-white/[.08] bg-[#090909] p-6 text-sm text-white/35">
            Buscando as conquistas de {registeredSlug ? "este jogo cadastrado" : "este jogo"}...
          </section>
        )}

        {result && (
          <>
            <section className="mt-5 rounded-[20px] border border-white/[.08] bg-[#090909] p-5">
              <p className="text-[9px] font-black uppercase tracking-[.18em] text-red-500">
                02 • Resultado
              </p>

              <div className="mt-1 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
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
            </section>

            <section className="mt-5 rounded-[20px] border border-white/[.08] bg-[#090909] p-5">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <p className="text-[9px] uppercase tracking-[.18em] text-white/25">
                    03
                  </p>
                  <h2 className="text-xl font-black">Seleção da Jornada</h2>
                </div>
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
                    Verde = decisão do preparador: Jornada
                  </span>
                  <span className="rounded-full border border-yellow-400/25 bg-yellow-400/[.06] px-3.5 py-2 text-yellow-100">
                    Amarelo = decisão do preparador: Fora
                  </span>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-white/[.06] bg-white/[.02] p-3 text-xs leading-relaxed text-white/45">
                <span className="font-black text-white/70">🤖 Sugestão automática:</span> o sistema indica inicialmente quais conquistas parecem fazer parte da conclusão normal da campanha/casos. <span className="font-black text-white/70">👤 Decisão do preparador:</span> você decide se cada uma entra ou não na Jornada de Estreia.
              </div>

              <div className="mt-3 flex flex-col gap-3 rounded-xl border border-emerald-400/15 bg-emerald-400/[.03] p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[.14em] text-emerald-200/70">
                    Decisão preparada da Jornada
                  </p>
                  <p className="mt-1 text-xs text-white/45">
                    Analisa cada conquista com a regra 200%: só confirma o que tiver evidência positiva; dúvida permanece amarela.
                  </p>
                  {journeyPreparedCount !== null && (
                    <p className="mt-1 text-[10px] font-bold text-emerald-200/80">
                      {journeyPreparedCount} {journeyPreparedCount === 1 ? "conquista marcada" : "conquistas marcadas"} como Jornada de Estreia.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={prepareJourneyDecision}
                  className="shrink-0 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-[9px] font-black uppercase text-emerald-100 hover:bg-emerald-400/20"
                >
                  ⚡ Analisar e Preparar Jornada
                </button>
              </div>

              <div className="mt-5 rounded-2xl border border-sky-400/35 bg-sky-500/[.08] p-5">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[.18em] text-sky-300">
                      Conquista manual
                    </p>
                    <h3 className="mt-1 text-lg font-black">Adicionar uma conquista sua</h3>
                    <p className="mt-1 text-xs text-white/45">
                      Digite somente o que precisa ser feito. Se for nova, o sistema cria um título automaticamente.
                    </p>
                  </div>
                  <span className="rounded-full border border-sky-300/25 bg-sky-300/10 px-3 py-2 text-[9px] font-black uppercase text-sky-100">
                    🔎 Verifica duplicatas
                  </span>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
                  <input
                    value={manualAchievement}
                    onChange={(e) => setManualAchievement(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addManualAchievement();
                    }}
                    placeholder="Ex.: Mate três inimigos com um único tiro"
                    className="min-w-0 rounded-xl border border-sky-300/20 bg-black/30 px-4 py-3 text-sm font-bold outline-none placeholder:text-white/25"
                  />
                  <select
                    value={manualRank}
                    onChange={(e) =>
                      setManualRank(e.target.value as "Bronze" | "Prata" | "Ouro")
                    }
                    className="rounded-xl border border-sky-300/20 bg-black/40 px-4 py-3 text-sm font-black text-white outline-none"
                  >
                    <option value="Bronze">Bronze</option>
                    <option value="Prata">Prata</option>
                    <option value="Ouro">Ouro</option>
                  </select>
                  <button
                    type="button"
                    onClick={addManualAchievement}
                    disabled={!manualAchievement.trim()}
                    className="rounded-xl border border-sky-300/30 bg-sky-300/15 px-6 py-3 text-xs font-black uppercase text-sky-50 disabled:opacity-40"
                  >
                    Adicionar
                  </button>
                </div>
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

              <div className="mt-4 space-y-0.5">
                {[...result.achievements]
                  .sort((a, b) => Number(Boolean(b.isCustom)) - Number(Boolean(a.isCustom)))
                  .map((a, i) => (
                  <div
                    key={a.id}
                    className={
                      a.notDoing
                        ? "w-full rounded-2xl border border-red-500/40 bg-red-500/[.07] p-3"
                        : a.isCustom
                          ? "w-full rounded-2xl border border-sky-400/40 bg-sky-500/[.10] p-3"
                          : a.journey
                            ? "w-full rounded-2xl border border-emerald-400/30 bg-emerald-400/[.07] p-3"
                            : "w-full rounded-2xl border border-yellow-400/25 bg-yellow-400/[.045] p-3"
                    }
                  >
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
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
                            <span className="rounded-full border border-white/10 px-3.5 py-2 text-[10px] font-black text-white/45">
                              🤖 {a.journeySuggestion ? "Sugestão: Jornada" : "Sugestão: Fora"}
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
                      </div>
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
            </section>

            {selected.length > 0 && (
              <section className="mt-5 rounded-[20px] border border-emerald-500/20 bg-emerald-500/[.025] p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <p className="text-[9px] uppercase tracking-[.18em] text-emerald-400">
                      05 • Material para ChatGPT
                    </p>
                    <h2 className="mt-1 text-xl font-black">Copiar instruções e preparar lotes</h2>
                    <p className="mt-2 max-w-[900px] text-xs leading-relaxed text-white/35">
                      O site prepara tudo automaticamente. Copie as instruções do lote e envie o texto junto com o ZIP + referências para o ChatGPT. A análise visual e a criação dos prompts acontecem aqui, não no site.
                    </p>
                  </div>
                </div>

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
                            <div>
                              <p className="text-xs font-black">
                                Lote {String(batchIndex + 1).padStart(2, "0")}
                              </p>
                              <p className="text-[9px] text-white/30">
                                Conquistas {start + 1}–{start + batch.length} • {readyCount}/{batch.length} briefs prontos
                              </p>
                            </div>

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
                          </div>

                          <div className="mt-3 rounded-lg border border-white/[.05] bg-black/20 p-3">
                            <p className="text-[9px] leading-relaxed text-white/30">
                              O texto contém as instruções completas do lote, as conquistas, as descrições, os nomes dos arquivos e o caminho de cada referência dentro do ZIP.
                            </p>
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>

                <p className="mt-3 text-[9px] leading-relaxed text-white/25">
                  <span className="font-black text-white/45">Fluxo:</span> Exophase → ZIP + instruções → análise visual no ChatGPT → prompts finais → geração individual das artes.
                </p>
              </section>
            )}

            {selected.length > 0 && (
              <section className="mt-5 rounded-[20px] border border-red-500/20 bg-red-500/[.025] p-5">
                <p className="text-[9px] uppercase tracking-[.18em] text-red-500">
                  04 • Dados preparados
                </p>
                <h2 className="mt-1 text-xl font-black">
                  Pacote de cada conquista
                </h2>
                <p className="mt-2 text-xs text-white/35">
                  Nada precisa ser digitado manualmente. Estes dados serão a base do próximo módulo de lotes para o ChatGPT.
                </p>

                <div className="mt-4 space-y-3">
                  {selected.map((a, i) => (
                    <div
                      key={a.id}
                      className="rounded-2xl border border-white/[.07] bg-black/25 p-3"
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <p className="text-[8px] uppercase tracking-[.14em] text-white/25">
                            Conquista {String(i + 1).padStart(2, "0")}
                          </p>
                          <h3 className="mt-1 text-sm font-black">{a.name}</h3>
                        </div>
                        <span
                          title={a.rank}
                          className="inline-flex items-center justify-center rounded-full border border-red-500/20 bg-red-500/[.06] px-3.5 py-2"
                        >
                          <TrophyIcon rank={a.rank} className="h-4 w-4" />
                        </span>
                      </div>

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
                    </div>
                  ))}
                </div>
              </section>
            )}

            {selected.length > 0 && (
              <ImportArtBatchUpload
                gameSlug={result.game.slug ?? ""}
                achievements={selected.map((a) => ({
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
          </>
        )}
      </div>
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
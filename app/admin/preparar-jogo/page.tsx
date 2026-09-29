"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import ImportArtBatchUpload from "./ImportArtBatchUpload";

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
};

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
    ? "REFERÊNCIA EXOPHASE DISPONÍVEL: a referência visual individual do Exophase é a principal base da direção visual desta arte, aproximadamente 80% da direção final. A arte final DEVE manter semelhança visual clara com a arte utilizada como referência no Exophase, preservando linguagem visual, estilo gráfico, atmosfera, tratamento, formas predominantes, contraste e paleta de cores predominante. A referência deve ser usada SOMENTE COMO FONTE DE ANÁLISE VISUAL. Antes de gerar, extraia dela características abstratas como paleta, contraste, distribuição de claros e escuros, densidade de detalhes, tipos de formas, textura, iluminação, enquadramento e atmosfera. NÃO envie, anexe, transforme, edite, recorte, trace ou use a imagem da referência como entrada da geração de imagem. Converta a referência em uma direção visual textual abstrata e gere uma composição nova e independente a partir dessa direção + nome + descrição da conquista. Não reproduza composição específica, personagem, ilustração, ícone, logo ou outros elementos reconhecíveis da referência. Se houver elemento protegido, substitua por equivalente original que comunique a mesma ideia. A paleta predominante da referência deve permanecer reconhecível na arte final; não introduza cores apenas por preferência estética ou para aplicar uma fórmula fixa do Rumo à Conquista. Os aproximadamente 20% restantes devem ser interpretação original para o Rumo à Conquista. Se a geração for bloqueada, aplique os níveis de fallback definidos neste prompt, avançando do mais próximo ao mais livre sem abandonar a conquista."
    : "SEM REFERÊNCIA EXOPHASE: esta conquista não possui uma referência visual utilizável. Crie a arte originalmente a partir do nome, descrição e universo visual do jogo, mantendo uma identidade de conquista clara e específica. Não procure nem substitua a referência por artes de Steam, Xbox ou outras bases.";

  const baseOutputRules =
    "UMA conquista = UMA imagem individual. Formato 1:1, preferencialmente 1024x1024. PNG com fundo fechado/opaco, sem transparência externa. A composição deve preencher praticamente todo o quadrado. A moldura deve encostar nas bordas ou ficar o mais próxima possível delas, sem criar uma faixa preta externa desnecessária; se algum respiro técnico for inevitável, mantenha-o mínimo. Não inserir texto, letras, números ou nomes dentro da imagem. Não fazer colagem, painel, mosaico, triptico, contact sheet ou múltiplas conquistas na mesma imagem. PRIORIDADE DE LEGIBILIDADE: a conquista deve ser compreendida à primeira vista, com um elemento principal forte e hierarquia clara entre foco, secundários e fundo. Evite excesso de objetos, sobreposição e detalhes pequenos que concorram pela atenção. SIMPLIFICAÇÃO INTELIGENTE: preservar a referência não exige manter todos os elementos dela; selecione os que melhor comunicam a conquista e simplifique os demais sempre que isso aumentar a legibilidade sem perder a linguagem visual da referência.";

  return {
    ...a,
    filename: `${String(index + 1).padStart(2, "0")}-${slugify(a.name) || "conquista"}.png`,
    visualConcept: a.description
      ? `Crie UMA imagem individual de conquista para "${a.name}". ${baseOutputRules} ${visualReferenceInstruction} O resultado deve ser uma arte original, específica para esta conquista e coerente com o jogo, sem transformar todas as conquistas em uma fórmula visual única.`
      : `Crie UMA imagem individual de conquista para "${a.name}". ${baseOutputRules} ${visualReferenceInstruction} O resultado deve ser uma arte original, específica para esta conquista e coerente com o jogo.`,
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
  const [copiedAchievementId, setCopiedAchievementId] = useState<string | null>(null);
  const [downloadingBatch, setDownloadingBatch] = useState<number | null>(null);
  const [manualAchievement, setManualAchievement] = useState("");
  const [manualRank, setManualRank] = useState<"Bronze" | "Prata" | "Ouro">("Bronze");
  const [similarCandidates, setSimilarCandidates] = useState<
    { achievement: A; score: number }[]
  >([]);
  const [showSimilarity, setShowSimilarity] = useState(false);
  const [mergeCandidate, setMergeCandidate] = useState<A | null>(null);
  const [mergeTitle, setMergeTitle] = useState("");
  const [mergeDescription, setMergeDescription] = useState("");

  const selected = useMemo(
    () =>
      result?.achievements
        .filter((a) => !a.notDoing)
        .map((a, index) => prepareAchievement(a, index)) ?? [],
    [result]
  );

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
  async function savePreparation() {
    if (!result?.game.slug) return;

    setDraftLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/achievement-prep-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: result.game.slug,
          preparation: {
            journeyIds: result.achievements
              .filter((a) => a.journey && !a.notDoing)
              .map((a) => a.id),
            notDoingIds: result.achievements
              .filter((a) => a.notDoing)
              .map((a) => a.id),
            customAchievements: result.achievements.filter((a) => a.isCustom),
          },
        }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Erro ao salvar rascunho.");

      setDraftUpdatedAt(payload.updatedAt ?? new Date().toISOString());
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar rascunho.");
    } finally {
      setDraftLoading(false);
    }
  }

  async function clearPreparation() {
    if (!result?.game.slug) return;
    if (!window.confirm("Limpar o rascunho desta preparação? As conquistas públicas não serão alteradas.")) return;

    setDraftLoading(true);
    setError("");

    try {
      const response = await fetch(
        "/api/admin/achievement-prep-draft?slug=" + encodeURIComponent(result.game.slug),
        { method: "DELETE" }
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Erro ao limpar rascunho.");

      localStorage.removeItem(`rumo-preparador:${result.game.slug}`);
      setDraftUpdatedAt(null);
      setSaved(false);
      await search(result.game.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao limpar rascunho.");
    } finally {
      setDraftLoading(false);
    }
  }

  async function copyAchievementWithReference(a: Prepared) {
    const prompt = [
      `JOGO: ${result?.game.name ?? ""}`,
      `CONQUISTA: ${a.name}`,
      `DESCRIÇÃO: ${a.description || "Sem descrição disponível."}`,
      `ARQUIVO: ${a.filename}`,
      "",
      a.visualConcept,
      "",
      "REFERÊNCIA EXOPHASE INDIVIDUAL — OBRIGATÓRIA E DETERMINANTE.",
      "Esta imagem específica é a referência visual desta conquista. Use aproximadamente 80% de sua direção visual e aproximadamente 20% de interpretação original.",
      "Use a imagem somente para análise visual. NÃO use a imagem como entrada de transformação ou edição na geração.",
      "Extraia primeiro uma direção visual abstrata: paleta de cores, contraste, linguagem gráfica, formas, textura, iluminação, enquadramento, densidade de detalhes e atmosfera.",
      "A arte final precisa manter semelhança clara com essa linguagem visual e preservar a paleta predominante, mas deve ser uma criação nova e independente.",
      "Se a geração for bloqueada, use FALLBACK 1 (refinar e remover elementos específicos), depois FALLBACK 2 (abstrair ainda mais) e finalmente FALLBACK 3 (interpretação livre baseada na conquista). Nunca deixe a conquista sem arte.",
      a.visualReferenceUrl
        ? `URL DA REFERÊNCIA INDIVIDUAL: ${a.visualReferenceUrl}`
        : "Esta conquista não possui referência visual individual.",
    ].join("\n");

    try {
      if (!a.visualReferenceUrl) {
        await navigator.clipboard.writeText(prompt);
      } else {
        const response = await fetch(
          "/api/admin/achievement-reference?url=" +
            encodeURIComponent(a.visualReferenceUrl),
          { cache: "no-store" }
        );
        if (!response.ok) {
          throw new Error("Não foi possível carregar a referência visual do Exophase.");
        }

        const blob = await response.blob();
        if (!blob.type.startsWith("image/")) {
          throw new Error("A referência retornada não é uma imagem.");
        }

        const types: Record<string, Blob> = {
          "text/plain": new Blob([prompt], { type: "text/plain" }),
        };

        if (blob.type === "image/png") {
          types["image/png"] = blob;
        } else {
          const bitmap = await createImageBitmap(blob);
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Não foi possível preparar a referência.");
          context.drawImage(bitmap, 0, 0);
          bitmap.close();
          const pngBlob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob((result) =>
              result ? resolve(result) : reject(new Error("Não foi possível converter a referência.")),
              "image/png"
            )
          );
          types["image/png"] = pngBlob;
        }

        await navigator.clipboard.write([new ClipboardItem(types)]);
      }

      setCopiedAchievementId(a.id);
      setTimeout(() => setCopiedAchievementId(null), 2200);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Não foi possível copiar a conquista com a referência.");
    }
  }

  async function downloadBatchPackage(
    batch: Prepared[],
    batchIndex: number,
    packageText: string
  ) {
    setDownloadingBatch(batchIndex);
    setError("");

    try {
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
        let message = "Não foi possível montar o lote completo.";
        try {
          const payload = await response.json();
          if (payload?.error) message = payload.error;
        } catch {
          // Mantém a mensagem padrão quando a resposta não é JSON.
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      if (blob.type !== "application/zip" && blob.size === 0) {
        throw new Error("O arquivo do lote veio vazio.");
      }

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `Lote-${String(batchIndex + 1).padStart(2, "0")}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      const downloadedReferences =
        response.headers.get("X-Rumo-Downloaded-Reference-Count") ?? String(references.length);
      const totalReferences =
        response.headers.get("X-Rumo-Reference-Count") ?? String(references.length);

      if (downloadedReferences !== totalReferences) {
        setError(
          `Lote ${String(batchIndex + 1).padStart(2, "0")} baixado, mas ${totalReferences} referências foram solicitadas e ${downloadedReferences} foram incluídas. Veja o arquivo REFERENCIAS-COM-FALHA.txt dentro do ZIP.`
        );
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível baixar o lote completo."
      );
    } finally {
      setDownloadingBatch(null);
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
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[9px] uppercase tracking-[.18em] text-white/25">
                    03
                  </p>
                  <h2 className="text-xl font-black">Seleção da Jornada</h2>
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
                <div className="mt-4 rounded-2xl border border-yellow-400/30 bg-yellow-400/[.05] p-4">
                  <div className="flex items-start justify-between gap-4">
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
                      <div key={achievement.id} className="rounded-xl border border-white/[.08] bg-black/25 p-4">
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
                  <div className="flex items-start justify-between gap-4">
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

              <div className="mt-4 space-y-2">
                {[...result.achievements]
                  .sort((a, b) => Number(Boolean(b.isCustom)) - Number(Boolean(a.isCustom)))
                  .map((a, i) => (
                  <div
                    key={a.id}
                    className={
                      a.notDoing
                        ? "w-full rounded-2xl border border-red-500/40 bg-red-500/[.07] p-4"
                        : a.isCustom
                          ? "w-full rounded-2xl border border-sky-400/40 bg-sky-500/[.10] p-4"
                          : a.journey
                            ? "w-full rounded-2xl border border-emerald-400/30 bg-emerald-400/[.07] p-4"
                            : "w-full rounded-2xl border border-yellow-400/25 bg-yellow-400/[.045] p-4"
                    }
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
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
                          <p className="mt-2 text-xs text-white/35">
                            {a.description || "Sem descrição disponível."}
                          </p>
                        </button>
                      )}

                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/10 px-3.5 py-2 text-[10px] font-black">
                          {a.rank}
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
                  A seleção será usada para preparar automaticamente os dados das artes.
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
              <section className="mt-5 rounded-[20px] border border-red-500/20 bg-red-500/[.025] p-5">
                <p className="text-[9px] uppercase tracking-[.18em] text-red-500">
                  05 • Lotes para ChatGPT
                </p>
                <h2 className="mt-1 text-xl font-black">Preparar lotes</h2>
                <p className="mt-2 text-xs text-white/35">
                  10 conquistas é o padrão inicial. O tamanho é ajustável para cada jogo. Online fica separado da Jornada e conquistas momentâneas recebem alerta para você decidir como executar.
                </p>

                <div className="mt-4 flex items-center gap-3">
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

                      const lines = [
                        `JOGO: ${result?.game.name}`,
                        `LOTE: ${String(batchIndex + 1).padStart(2, "0")}`,
                        `QUANTIDADE: ${batch.length}`,
                        "",
                        "INSTRUÇÕES PARA A GERAÇÃO DAS ARTES:",
                        "REGRA ABSOLUTA DE SAÍDA: cada conquista abaixo é uma TAREFA DE GERAÇÃO INDEPENDENTE e corresponde a UMA imagem separada e a UM arquivo separado.",
                        "A QUANTIDADE deste lote é exatamente a quantidade de arquivos finais. Se QUANTIDADE = 3, o resultado obrigatório é 3 arquivos/imagens independentes.",
                        "PROCESSAMENTO OBRIGATORIAMENTE SEPARADO: execute uma geração independente para cada bloco CONQUISTA. NÃO tente gerar o lote inteiro em uma única imagem ou uma única composição.",
                        "NUNCA faça colagem, montagem, contact sheet, sprite sheet, grade, mosaico, triptico, painel ou várias conquistas dentro da mesma imagem.",
                        "NUNCA coloque duas ou mais conquistas na mesma imagem, mesmo que seja apenas para mostrar o lote completo.",
                        "Se a interface de geração produzir uma única imagem por chamada, faça uma chamada separada para cada CONQUISTA. NÃO responda com uma imagem contendo várias conquistas. Para um lote de 10, gere 10 imagens separadas; para um lote de 3, gere 3 imagens separadas. Só considere o lote concluído quando existir um arquivo individual para cada conquista.",
                        "Gere/trate cada conquista individualmente e mantenha a identidade visual consistente entre todas.",
                        "ANÁLISE INDIVIDUAL OBRIGATÓRIA: cada CONQUISTA deve ser analisada separadamente usando sua própria referência visual do Exophase, seu próprio nome e sua própria descrição. Não crie uma direção visual geral para o lote e não use a referência de outra conquista como substituta. A arte final deve manter semelhança visual clara com a referência em linguagem, estilo, atmosfera, tratamento, contraste e paleta, sempre como uma nova criação independente.",
                        "PROCESSO OBRIGATÓRIO DE GERAÇÃO: use a referência apenas para análise. NÃO passe a imagem da referência como entrada para a ferramenta de geração ou edição. Primeiro transforme a referência em uma direção visual abstrata textual (paleta, contraste, formas, textura, iluminação, enquadramento, densidade de detalhes e atmosfera). Depois gere a arte a partir dessa direção abstrata combinada com o nome e a descrição da conquista. O resultado deve ser novo e independente.",
                        "FALLBACK 1 — REFINAMENTO: se a primeira tentativa for bloqueada, simplifique os elementos específicos da direção visual e remova características potencialmente associadas a uma obra existente, preservando a paleta predominante, o contraste, a atmosfera e a ideia da conquista.",
                        "FALLBACK 2 — ABSTRAÇÃO: se continuar bloqueada, reduza a direção visual aos atributos abstratos da referência (paleta, contraste, textura, iluminação, formas e atmosfera) e crie uma composição ainda mais original baseada no nome e na descrição da conquista.",
                        "FALLBACK 3 — INTERPRETAÇÃO LIVRE: se mesmo assim não for possível gerar, abandone os elementos visuais específicos da referência e crie uma solução totalmente original baseada no significado da conquista, mantendo, sempre que possível, a paleta e a identidade visual da coleção. Nunca deixe a conquista sem arquivo.",
                        "PRIORIDADE DE LEGIBILIDADE: o significado da conquista deve ser compreendido à primeira vista. Escolha um elemento principal forte, estabeleça hierarquia clara e reduza elementos secundários que criem ruído.",
                        "SIMPLIFICAÇÃO INTELIGENTE: preserve a linguagem visual dominante da referência, mas não é necessário reproduzir todos os elementos dela. Simplifique e organize os elementos secundários quando isso aumentar a clareza.",
                        "Formato de CADA arquivo: PNG 1:1, preferencialmente 1024x1024, com fundo fechado/opaco e sem transparência externa.",
                        "FUNDO FECHADO E COMPOSIÇÃO ATÉ A BORDA: a imagem deve ser preenchida até praticamente 100% do quadrado. A moldura deve encostar nas bordas ou ficar o mais próxima possível delas. Não criar uma faixa preta externa à moldura; se algum respiro técnico for inevitável, mantê-lo mínimo. Não usar transparência externa.",
                        "COMPOSIÇÃO DE CADA ARQUIVO: quando houver referência Exophase, ela deve orientar aproximadamente 80% da direção visual — incluindo obrigatoriamente a paleta de cores predominante, contraste, atmosfera, enquadramento, composição geral, elementos visuais, iluminação, textura e tratamento gráfico. A arte final DEVE manter semelhança visual clara com a referência em sua linguagem visual e aparência geral, mas como uma criação nova e independente. Os aproximadamente 20% restantes são interpretação original para o Rumo à Conquista. Se a referência for predominantemente monocromática, mantenha uma linguagem cromática compatível e predominantemente monocromática; não introduza cores apenas por preferência estética. A paleta da referência deve permanecer reconhecível na arte final. Quando não houver referência, crie a direção visual a partir do nome, descrição e identidade do jogo.",
                        "REFERÊNCIA E SEGURANÇA: não aplique uma fórmula visual fixa de vermelho, metal, dourado, moldura ou 3D. A referência Exophase fornece aproximadamente 80% da direção visual, incluindo sua paleta predominante e sua linguagem visual, enquanto aproximadamente 20% é interpretação original. A arte final deve ser visualmente semelhante à referência em linguagem, atmosfera, tratamento e paleta, mas deve ser uma criação nova e independente. Não use a referência como imagem-base para transformação, edição, recorte, traçado ou reprodução. Não copie ou reproduza fielmente sua composição específica ou elementos reconhecíveis, personagens, ilustrações, ícones ou logos. Se necessário, substitua elementos protegidos por equivalentes originais que transmitam a mesma ideia. A prioridade é manter a identidade visual dominante da referência sem reproduzir a obra.",
                        "Não inserir texto, letras, números ou nomes dentro das imagens.",
                        "Cada conquista deve manter sua própria identidade visual. Não force todas as imagens a terem a mesma composição, personagem, objeto, enquadramento ou acabamento; a consistência deve vir da coleção e da adaptação, não da repetição de uma fórmula.",
                        "FONTE DOS DADOS: os nomes e descrições abaixo são os dados oficiais desta preparação vindos do Exophase. Não invente outras conquistas, não troque nomes e não substitua uma conquista por outra.",
                        "PRIORIDADE DA REFERÊNCIA: quando houver referência visual individual do Exophase, ela é a principal base visual, aproximadamente 80% da direção final. Isso inclui a semelhança de linguagem visual e a preservação da paleta de cores predominante da referência. Os aproximadamente 20% restantes são interpretação original. Nome e descrição validam o significado. A arte final deve ser uma criação nova e independente, visualmente semelhante à referência em linguagem e paleta, sem reproduzir a imagem, sua composição específica ou elementos reconhecíveis.",
                        "NÃO copie, recorte, filtre, redesenhe, transforme ou simplesmente reproduza a imagem do Exophase. Não substitua a referência por imagens de Steam, Xbox ou outras bases. Quando houver referência, mantenha aproximadamente 80% da direção visual derivada dela e use aproximadamente 20% para uma interpretação original. Crie uma composição nova e independente e não tente reproduzir de forma excessivamente fiel personagens, artes, ícones, logos ou outros elementos protegidos.",
                        "Quando uma conquista NÃO tiver referência visual utilizável do Exophase, crie a arte originalmente a partir SOMENTE do nome, descrição e universo visual do jogo, mantendo uma identidade de conquista clara e específica. Nesse caso, há liberdade criativa maior, pois não existe referência visual individual para adaptar.",
                        "NÃO altere os nomes dos arquivos fornecidos. Cada arquivo deve corresponder exatamente à conquista indicada logo antes dele.",
                        "REGRA 7 — FALLBACK OBRIGATÓRIO EM CASO DE BLOQUEIO: se uma conquista passar por todas as regras anteriores, mas ainda assim não for possível gerar a arte solicitada devido a direitos autorais, diretrizes de segurança, limitações do ChatGPT ou qualquer outra restrição de geração, NÃO interrompa o lote e NÃO deixe a conquista sem arquivo. Nesse caso, crie uma nova interpretação visual livre e original baseada no nome, descrição e ideia central da conquista. A nova arte deve ser suficientemente diferente da referência para permitir a geração, mas deve continuar lembrando claramente o significado da conquista e permanecer coerente com a identidade visual das demais conquistas do lote. Sempre que possível, preserve também a linguagem gráfica e a paleta predominante identificadas na referência, sem reproduzir elementos protegidos. A prioridade nesse caso é criar uma arte original, específica, reconhecível e coerente com a coleção. Nunca substituir por uma arte genérica, nunca colocar várias conquistas na mesma imagem e nunca deixar o lote incompleto.",
                        "",
                      ];

                      batch.forEach((a, localIndex) => {
                        lines.push(
                          `CONQUISTA ${String(start + localIndex + 1).padStart(2, "0")}`,
                          `Nome: ${a.name}`,
                          `Descrição: ${a.description || "Sem descrição disponível."}`,
                          `Rank: ${a.rank}`,
                          "Jornada de Estreia: SIM",
                          `Sugestão automática de Jornada: ${a.journeySuggestion ? "SIM" : "NÃO"}`,
                          `Arquivo: ${a.filename}`,
                          `Conceito visual: ${a.visualConcept}`,
                          `Referência visual Exophase: ${a.visualReferenceUrl ? "OBRIGATÓRIA E DETERMINANTE — principal base visual (aprox. 80%), com aprox. 20% de interpretação original; usar esta referência individual específica" : "Não disponível — criar a partir do jogo e da descrição."}`,
                          ...(a.visualReferenceUrl ? [`URL DA REFERÊNCIA INDIVIDUAL: ${a.visualReferenceUrl}`] : []),
                          ""
                        );
                      });

                      const packageText = lines.join("\n");

                      return (
                        <div
                          key={batchIndex}
                          className="flex items-center justify-between gap-4 rounded-xl border border-white/[.06] bg-white/[.02] p-3"
                        >
                          <div>
                            <p className="text-xs font-black">
                              Lote {String(batchIndex + 1).padStart(2, "0")}
                            </p>
                            <p className="text-[9px] text-white/30">
                              Conquistas {start + 1}–{start + batch.length}
                            </p>
                          </div>

                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                void navigator.clipboard.writeText(packageText);
                                setCopiedBatch(batchIndex);
                                setTimeout(() => setCopiedBatch(null), 1800);
                              }}
                              className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-[9px] font-black uppercase text-red-100"
                            >
                              {copiedBatch === batchIndex ? "Copiado" : "Copiar lote"}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void downloadBatchPackage(batch, batchIndex, packageText)
                              }
                              disabled={downloadingBatch === batchIndex}
                              className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-[9px] font-black uppercase text-emerald-100 disabled:cursor-wait disabled:opacity-50"
                            >
                              {downloadingBatch === batchIndex
                                ? "Montando pacote..."
                                : "📦 Baixar para ChatGPT"}
                            </button>
                          </div>
                          <details className="w-full rounded-xl border border-white/[.06] bg-white/[.015]">
                            <summary className="cursor-pointer px-3 py-2 text-[9px] font-black uppercase tracking-wider text-white/40">
                              Referências individuais
                            </summary>
                            <div className="space-y-2 border-t border-white/[.05] p-3">
                              {batch.map((a) => (
                                <div key={a.id} className="flex flex-col gap-2 rounded-lg border border-white/[.05] bg-black/20 p-3 md:flex-row md:items-center md:justify-between">
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-black">{a.name}</p>
                                    <p className="text-[9px] text-white/30">{a.filename}</p>
                                  </div>
                                  <button
                                    type="button"
                                    disabled={!a.visualReferenceUrl}
                                    onClick={() => void copyAchievementWithReference(a)}
                                    className="shrink-0 rounded-lg border border-violet-400/30 bg-violet-400/10 px-3 py-2 text-[9px] font-black uppercase text-violet-100 disabled:cursor-not-allowed disabled:opacity-35"
                                  >
                                    {copiedAchievementId === a.id ? "Copiado + imagem" : "Copiar + referência"}
                                  </button>
                                </div>
                              ))}
                            </div>
                          </details>
                        </div>
                      );
                    }
                  )}
                </div>

                <p className="mt-3 text-[9px] leading-relaxed text-white/25">
                  <span className="font-black text-white/45">Baixar para ChatGPT:</span> o ZIP já contém o texto do lote e todas as referências individuais do Exophase. <span className="font-black text-white/45">Não precisa extrair nada.</span> Baixe o pacote e anexe o ZIP diretamente nesta conversa; o texto e as imagens ficam juntos dentro do mesmo arquivo.
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
                      className="rounded-2xl border border-white/[.07] bg-black/25 p-4"
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <p className="text-[8px] uppercase tracking-[.14em] text-white/25">
                            Conquista {String(i + 1).padStart(2, "0")}
                          </p>
                          <h3 className="mt-1 text-sm font-black">{a.name}</h3>
                        </div>
                        <span className="rounded-full border border-red-500/20 bg-red-500/[.06] px-3.5 py-2 text-[10px] font-black text-red-100">
                          {a.rank}
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
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
    ? `REFERÊNCIA EXOPHASE — PRIORIDADE VISUAL: esta conquista possui uma referência visual individual do Exophase. A referência é a principal base visual desta arte. Analise e siga sua linguagem visual em aproximadamente 80% da direção final: paleta e tratamento de cor, contraste, composição e enquadramento, elementos visuais principais, atmosfera, iluminação, textura e estilo gráfico. Use o nome e a descrição da conquista para confirmar o significado dos elementos e evitar interpretações erradas. Os cerca de 20% restantes devem ser uma interpretação original para o Rumo à Conquista. Não copie, redesenhe pixel a pixel, filtre ou reproduza fielmente a imagem original. Não copie personagens, ilustrações, ícones, logos ou outros elementos protegidos. Se houver um elemento protegido na referência, substitua-o por uma representação original que transmita a mesma ideia. Preserve características importantes da referência — inclusive uma paleta monocromática, quando ela existir — em vez de aplicar uma estética genérica. A referência deve orientar a aparência; o nome e a descrição devem validar o significado; a identidade do jogo deve completar a atmosfera. Referência visual individual: ${a.visualReferenceUrl}`
    : "SEM REFERÊNCIA EXOPHASE: esta conquista não possui uma referência visual utilizável. Crie a arte originalmente a partir do nome, descrição e universo visual do jogo, mantendo uma identidade de conquista clara e específica. Não procure nem substitua a referência por artes de Steam, Xbox ou outras bases.";

  const baseOutputRules =
    "UMA conquista = UMA imagem individual. Formato 1:1, preferencialmente 1024x1024. PNG com fundo fechado/opaco, sem transparência externa. A composição deve preencher praticamente todo o quadrado. A moldura deve encostar nas bordas ou ficar o mais próxima possível delas, sem criar uma faixa preta externa desnecessária; se algum respiro técnico for inevitável, mantenha-o mínimo. Não inserir texto, letras, números ou nomes dentro da imagem. Não fazer colagem, painel, mosaico, triptico, contact sheet ou múltiplas conquistas na mesma imagem.";

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
        if (!cancelled) setError(e instanceof Error ? e.message : "Erro ao carregar rascunho.");      } finally {
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
        ? {            ...current,
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
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
  return {
    ...a,
    filename: `${String(index + 1).padStart(2, "0")}-${slugify(a.name) || "conquista"}.png`,
    visualConcept: a.description
      ? `Símbolo central inspirado no significado de "${a.name}", usando os elementos da descrição como referência. Identidade Rumo à Conquista: composição quadrada, fundo escuro, vermelho profundo, metal, dourado/bronze/preto, moldura ornamental, iluminação dramática e sem texto.`
      : `Símbolo central representando "${a.name}" de forma clara e específica. Identidade Rumo à Conquista: composição quadrada, fundo escuro, vermelho profundo, metal, dourado/bronze/preto, moldura ornamental, iluminação dramática e sem texto.`,
  };
}

function PrepararJogoPage() {
  const searchParams = useSearchParams();
  const registeredSlug = searchParams.get("slug")?.trim() ?? "";

  const [title, setTitle] = useState("");
  const [result, setResult] = useState<R | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [batchSize, setBatchSize] = useState(10);
  const [copiedBatch, setCopiedBatch] = useState<number | null>(null);
  const [manualAchievement, setManualAchievement] = useState("");
  const [similarCandidates, setSimilarCandidates] = useState<
    { achievement: A; score: number }[]
  >([]);
  const [showSimilarity, setShowSimilarity] = useState(false);

  const selected = useMemo(
    () =>
      result?.achievements
        .filter((a) => a.journey && !a.notDoing)
        .map((a, index) => prepareAchievement(a, index)) ?? [],
    [result]
  );

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
    if (!result?.game.slug) return;

    const raw = localStorage.getItem(
      `rumo-preparador:${result.game.slug}`
    );

    if (!raw) return;

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
                ...current.achievements.map((a) => ({
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
      localStorage.removeItem(
        `rumo-preparador:${result.game.slug}`
      );
    }
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
    const a = slugify(left).split("-").filter((word) => word.length > 2);
    const b = slugify(right).split("-").filter((word) => word.length > 2);
    if (!a.length || !b.length) return 0;

    const setA = new Set(a);
    const setB = new Set(b);
    const intersection = [...setA].filter((word) => setB.has(word)).length;
    const union = new Set([...setA, ...setB]).size;
    const jaccard = union ? intersection / union : 0;

    const compactA = a.join("");
    const compactB = b.join("");
    const contains =
      compactA.includes(compactB) || compactB.includes(compactA) ? 0.2 : 0;

    return Math.min(1, jaccard + contains);
  }

  function findSimilarAchievements(value: string) {
    if (!result || !value.trim()) return [];

    return result.achievements
      .filter((a) => !a.notDoing)
      .map((achievement) => ({
        achievement,
        score: similarityScore(
          value + " " + value,
          achievement.name + " " + achievement.description
        ),
      }))
      .filter(({ score }) => score >= 0.35)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3);
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
      name: value,
      description: "",
      rank: "Bronze",
      online: false,
      momentary: false,
      journeySuggestion: false,
      journey: true,
      notDoing: false,
    };

    setSaved(false);
    setResult((current) =>
      current ? { ...current, achievements: [...current.achievements, custom] } : current
    );
    setManualAchievement("");
  }

  function addCustomAsSeparate() {
    const value = manualAchievement.trim();
    if (!result || !value) return;

    const custom: A = {
      id: `custom-${Date.now()}`,
      name: value,
      description: "",
      rank: "Bronze",
      online: false,
      momentary: false,
      journeySuggestion: false,
      journey: true,
      notDoing: false,
    };

    setSaved(false);
    setResult((current) =>
      current ? { ...current, achievements: [...current.achievements, custom] } : current
    );
    setManualAchievement("");
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

  function mergeWithCandidate(candidate: A) {
    const value = manualAchievement.trim();
    if (!result || !value) return;

    const custom: A = {
      ...candidate,
      id: candidate.id,
      name: candidate.name || value,
      description: candidate.description || value,
      journey: true,
      notDoing: false,
    };

    setSaved(false);
    setResult((current) =>
      current
        ? {
            ...current,
            achievements: current.achievements.map((a) =>
              a.id === candidate.id ? custom : a
            ),
          }
        : current
    );
    setManualAchievement("");
    setShowSimilarity(false);
    setSimilarCandidates([]);
  }

  function savePreparation() {
    if (!result?.game.slug) return;

    localStorage.setItem(
      `rumo-preparador:${result.game.slug}`,
      JSON.stringify({
        journeyIds: result.achievements
          .filter((a) => a.journey && !a.notDoing)
          .map((a) => a.id),
        notDoingIds: result.achievements
          .filter((a) => a.notDoing)
          .map((a) => a.id),
        customAchievements: result.achievements.filter((a) =>
          a.id.startsWith("custom-")
        ),
      })
    );

    setSaved(true);
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

              <div className="mt-5 rounded-2xl border border-violet-400/20 bg-violet-400/[.035] p-4">
                <p className="text-[9px] font-black uppercase tracking-[.18em] text-violet-300/70">
                  Conquista manual
                </p>
                <h3 className="mt-1 text-lg font-black">Adicionar uma conquista sua</h3>
                <p className="mt-1 text-xs text-white/35">
                  Digite o título ou a descrição. Antes de adicionar, o sistema procura conquistas do Exophase parecidas para evitar duplicatas.
                </p>
                <div className="mt-4 flex flex-col gap-3 md:flex-row">
                  <input
                    value={manualAchievement}
                    onChange={(e) => setManualAchievement(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addManualAchievement();
                    }}
                    placeholder="Ex.: Mate três inimigos com um único tiro"
                    className="flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-bold outline-none placeholder:text-white/20"
                  />
                  <button
                    type="button"
                    onClick={addManualAchievement}
                    disabled={!manualAchievement.trim()}
                    className="rounded-xl border border-violet-400/30 bg-violet-400/10 px-6 py-3 text-xs font-black uppercase text-violet-100 disabled:opacity-40"
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
                        Sua conquista: <span className="font-black text-white/80">{manualAchievement}</span>
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
                            onClick={() => mergeWithCandidate(achievement)}
                            className="rounded-lg border border-violet-400/30 bg-violet-400/10 px-4 py-2 text-[10px] font-black uppercase text-violet-100"
                          >
                            🔀 Mesclar
                          </button>
                          <button
                            type="button"
                            onClick={() => useExophaseCandidate(achievement)}
                            className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-[10px] font-black uppercase text-emerald-100"
                          >
                            🔄 Substituir pela Exophase
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

              <div className="mt-4 space-y-2">
                {result.achievements.map((a, i) => (
                  <div
                    key={a.id}
                    className={
                      a.notDoing
                        ? "w-full rounded-2xl border border-red-500/40 bg-red-500/[.07] p-4"
                        : a.journey
                          ? "w-full rounded-2xl border border-emerald-400/30 bg-emerald-400/[.07] p-4"
                          : "w-full rounded-2xl border border-yellow-400/25 bg-yellow-400/[.045] p-4"
                    }
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
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
                  onClick={savePreparation}
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-3 text-xs font-black uppercase tracking-[.12em] text-red-100"
                >
                  {saved ? "Preparação salva" : "Salvar seleção"}
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
                        "Gere uma imagem para cada conquista abaixo, mantendo uma identidade visual consistente entre todas.",
                        "Formato: 1:1, preferencialmente 1024x1024.",
                        "Composição: símbolo central ocupando aproximadamente 60–75% da imagem.",
                        "Estética: fundo escuro, vermelho profundo, metal, dourado/bronze/preto, moldura ornamental e iluminação dramática.",
                        "Não inserir texto, letras, números ou nomes dentro das imagens.",
                        "Mantenha a mesma linguagem visual entre as imagens, variando o conceito central.",
                        "NÃO altere os nomes dos arquivos fornecidos.",
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
                        </div>
                      );
                    }
                  )}
                </div>

                <p className="mt-3 text-[9px] leading-relaxed text-white/25">
                  O botão copia o pacote completo. Depois abra a conversa do jogo no ChatGPT e cole.
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

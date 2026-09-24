"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";

type A = {
  id: string;
  name: string;
  description: string;
  rank: "Bronze" | "Prata" | "Ouro";
  exophase: "sim" | "nao" | "nao_verificado";
  journey: boolean;
};
type R = { game: { name: string; source: string; slug?: string }; achievements: A[]; warnings?: string[] };
type Prepared = A & { filename: string; visualConcept: string };

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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

export default function Page() {
  const [title, setTitle] = useState("");
  const [result, setResult] = useState<R | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const selected = useMemo(() => result?.achievements.filter((a) => a.journey).map((a, index) => prepareAchievement(a, index)) ?? [], [result]);

  useEffect(() => {
    if (!result?.game.slug) return;
    const raw = localStorage.getItem(`rumo-preparador:${result.game.slug}`);
    if (!raw) return;
    try {
      const ids = new Set<string>(JSON.parse(raw));
      setResult((current) => current ? { ...current, achievements: current.achievements.map((a) => ({ ...a, journey: ids.has(a.id) })) } : current);
    } catch {
      localStorage.removeItem(`rumo-preparador:${result.game.slug}`);
    }
  }, [result?.game.slug]);

  async function search() {
    if (!title.trim()) { setError("Digite o nome do jogo."); return; }
    setLoading(true); setError(""); setSaved(false); setResult(null);
    try {
      const response = await fetch("/api/admin/achievement-prep?title=" + encodeURIComponent(title), { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Erro na busca.");
      setResult(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro na busca.");
    } finally { setLoading(false); }
  }

  function toggle(id: string) {
    setSaved(false);
    setResult((current) => current ? { ...current, achievements: current.achievements.map((a) => a.id === id ? { ...a, journey: !a.journey } : a) } : current);
  }

  function savePreparation() {
    if (!result?.game.slug) return;
    localStorage.setItem(`rumo-preparador:${result.game.slug}`, JSON.stringify(result.achievements.filter((a) => a.journey).map((a) => a.id)));
    setSaved(true);
  }

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <Navbar />
      <div className="mx-auto max-w-[1500px] px-5 py-8 lg:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div><p className="text-[10px] font-black uppercase tracking-[.28em] text-red-500">Admin • Preparador</p><h1 className="mt-2 text-4xl font-black">Preparar novo jogo</h1><p className="mt-2 max-w-[820px] text-sm text-white/40">Busque as conquistas, escolha manualmente a Jornada de Estreia e deixe os dados de arte serem preparados automaticamente.</p></div>
          <Link href="/admin/jogos" className="rounded-xl border border-white/10 bg-white/[.03] px-4 py-3 text-xs font-black uppercase text-white/55">Voltar para Jogos</Link>
        </div>

        <section className="mt-7 rounded-[20px] border border-white/[.08] bg-[#090909] p-5">
          <p className="text-[9px] font-black uppercase tracking-[.18em] text-white/25">01</p><h2 className="mt-1 text-xl font-black">Nome do jogo</h2>
          <div className="mt-5 flex flex-col gap-3 md:flex-row"><input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} placeholder="Ex.: Black Myth: Wukong" className="flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-bold outline-none placeholder:text-white/20" /><button onClick={() => void search()} disabled={loading} className="rounded-xl border border-red-500/30 bg-red-500/10 px-6 py-3 text-xs font-black uppercase text-red-100 disabled:opacity-50">{loading ? "Buscando..." : "Buscar conquistas"}</button></div>
          {error && <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/[.06] p-3 text-xs font-bold text-red-200">{error}</p>}
        </section>

        {result && <>
          <section className="mt-5 rounded-[20px] border border-white/[.08] bg-[#090909] p-5">
            <p className="text-[9px] font-black uppercase tracking-[.18em] text-red-500">02 • Resultado</p>
            <div className="mt-1 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><h2 className="text-2xl font-black">{result.game.name}</h2><p className="text-xs text-white/30">{result.achievements.length} conquistas encontradas • Fonte: {result.game.source}</p></div><div className="rounded-2xl border border-red-500/20 bg-red-500/[.05] px-4 py-3 text-right"><p className="text-[8px] uppercase text-white/30">Jornada de Estreia</p><p className="text-lg font-black text-red-100">{selected.length} selecionadas</p></div></div>
            {result.warnings?.map((warning) => <p key={warning} className="mt-3 text-xs text-yellow-100/60">• {warning}</p>)}
          </section>

          <section className="mt-5 rounded-[20px] border border-white/[.08] bg-[#090909] p-5">
            <div className="flex items-center justify-between gap-4"><div><p className="text-[9px] uppercase tracking-[.18em] text-white/25">03</p><h2 className="text-xl font-black">Seleção da Jornada</h2></div><span className="text-[9px] uppercase text-white/30">Clique para selecionar</span></div>
            <div className="mt-4 space-y-2">{result.achievements.map((a, i) => <button key={a.id} onClick={() => toggle(a.id)} className={a.journey ? "w-full rounded-2xl border border-red-500/30 bg-red-500/[.06] p-4 text-left" : "w-full rounded-2xl border border-white/[.07] bg-black/20 p-4 text-left"}><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-[8px] uppercase text-white/25">Conquista {i + 1}</p><h3 className="mt-1 text-sm font-black">{a.name}</h3><p className="mt-2 text-xs text-white/35">{a.description || "Sem descrição disponível."}</p></div><div className="flex shrink-0 flex-wrap gap-2"><span className="rounded-full border border-white/10 px-3 py-1.5 text-[8px] font-black">{a.rank}</span><span className="rounded-full border border-violet-400/20 px-3 py-1.5 text-[8px] font-black text-violet-200/70">{a.exophase === "sim" ? "Exophase" : a.exophase === "nao" ? "Sem Exophase" : "Não verificado"}</span><span className="rounded-full border border-white/10 px-3 py-1.5 text-[8px] font-black">{a.journey ? "Jornada" : "Fora da Jornada"}</span></div></div></button>)}</div>
            <div className="mt-5 flex items-center justify-between gap-4 border-t border-white/[.07] pt-5"><p className="text-xs text-white/35">A seleção será usada para preparar automaticamente os dados das artes.</p><button type="button" onClick={savePreparation} className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-3 text-xs font-black uppercase tracking-[.12em] text-red-100">{saved ? "Preparação salva" : "Salvar seleção"}</button></div>
          </section>

          {selected.length > 0 && <section className="mt-5 rounded-[20px] border border-red-500/20 bg-red-500/[.025] p-5">
            <p className="text-[9px] uppercase tracking-[.18em] text-red-500">05 • Lotes para ChatGPT</p>
            <h2 className="mt-1 text-xl font-black">Preparar lotes</h2>
            <p className="mt-2 text-xs text-white/35">10 conquistas é o padrão inicial. O tamanho é ajustável para cada jogo.</p>
            <div className="mt-4 flex items-center gap-3">
              <label htmlFor="batch-size" className="text-[9px] font-black uppercase text-white/30">Conquistas por lote</label>
              <input id="batch-size" type="number" min={1} max={100} defaultValue={10} className="w-20 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm font-bold" />
            </div>
            <div className="mt-4 space-y-2">
              {Array.from({ length: Math.ceil(selected.length / 10) }, (_, batchIndex) => {
                const start = batchIndex * 10;
                const batch = selected.slice(start, start + 10);
                const packageText = [
                  `JOGO: ${result?.game.name}`,
                  "",
                  ...batch.map((a, localIndex) => `CONQUISTA ${String(start + localIndex + 1).padStart(2, "0")}
Nome: ${a.name}
Descrição: ${a.description || "Sem descrição disponível."}
Rank: ${a.rank}
Jornada de Estreia: SIM
Exophase: ${a.exophase === "sim" ? "SIM" : a.exophase === "nao" ? "NÃO" : "NÃO VERIFICADO"}
Arquivo: ${a.filename}
Conceito visual: ${a.visualConcept}`).join("\n\n"),
                ].join("\n");
                return (
                  <div key={batchIndex} className="flex items-center justify-between gap-4 rounded-xl border border-white/[.06] bg-white/[.02] p-3">
                    <div><p className="text-xs font-black">Lote {String(batchIndex + 1).padStart(2, "0")}</p><p className="text-[9px] text-white/30">Conquistas {start + 1}–{start + batch.length}</p></div>
                    <button type="button" onClick={() => navigator.clipboard.writeText(packageText)} className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-[9px] font-black uppercase text-red-100">Copiar lote</button>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[9px] leading-relaxed text-white/25">O botão copia o pacote completo. Depois abra a conversa do jogo no ChatGPT e cole.</p>
          </section>}

          {selected.length > 0 && <section className="mt-5 rounded-[20px] border border-red-500/20 bg-red-500/[.025] p-5">
            <p className="text-[9px] uppercase tracking-[.18em] text-red-500">04 • Dados preparados</p><h2 className="mt-1 text-xl font-black">Pacote de cada conquista</h2><p className="mt-2 text-xs text-white/35">Nada precisa ser digitado manualmente. Estes dados serão a base do próximo módulo de lotes para o ChatGPT.</p>
            <div className="mt-4 space-y-3">{selected.map((a, i) => <div key={a.id} className="rounded-2xl border border-white/[.07] bg-black/25 p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><p className="text-[8px] uppercase tracking-[.14em] text-white/25">Conquista {String(i + 1).padStart(2, "0")}</p><h3 className="mt-1 text-sm font-black">{a.name}</h3></div><span className="rounded-full border border-red-500/20 bg-red-500/[.06] px-3 py-1.5 text-[8px] font-black text-red-100">{a.rank}</span></div>
            <div className="mt-4 grid gap-3 md:grid-cols-2"><div><p className="text-[8px] uppercase text-white/25">Descrição</p><p className="mt-1 text-xs text-white/55">{a.description || "Sem descrição disponível."}</p></div><div><p className="text-[8px] uppercase text-white/25">Arquivo</p><p className="mt-1 text-xs font-bold text-white/70">{a.filename}</p></div><div><p className="text-[8px] uppercase text-white/25">Jornada de Estreia</p><p className="mt-1 text-xs font-bold text-red-100">SIM</p></div><div><p className="text-[8px] uppercase text-white/25">Exophase</p><p className="mt-1 text-xs font-bold text-white/70">{a.exophase === "sim" ? "SIM" : a.exophase === "nao" ? "NÃO" : "NÃO VERIFICADO"}</p></div></div>
            <div className="mt-3 rounded-xl border border-white/[.06] bg-white/[.02] p-3"><p className="text-[8px] uppercase text-white/25">Conceito visual</p><p className="mt-1 text-xs leading-relaxed text-white/50">{a.visualConcept}</p></div></div>)}</div>
          </section>}
        </>}
      </div>
    </main>
  );
}
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { useSiteGames, type SiteGame } from "@/lib/useSiteGames";

function statusLabel(status?: string) {
  const value = String(status || "").toLowerCase();
  if (["completed", "finalizado", "concluido", "concluida"].includes(value)) return "Finalizado";
  if (["planned", "backlog", "futuro", "planejado"].includes(value)) return "Próxima Maestria";
  return "Em progresso";
}

function journeyActive(game: SiteGame) {
  return game.firstJourney?.status === "in_progress";
}

export default function NewGamesAdminPage() {
  const { isLoaded, gamesList, updateGame } = useSiteGames();
  const [selectedSlug, setSelectedSlug] = useState("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);

  const filteredGames = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return gamesList;
    return gamesList.filter((game) =>
      [game.title, game.slug, game.subtitle].some((value) =>
        String(value || "").toLowerCase().includes(q)
      )
    );
  }, [gamesList, search]);

  const selectedGame = gamesList.find((game) => game.slug === selectedSlug) ?? gamesList[0];
  const values = selectedGame
    ? draft && draft.slug === selectedGame.slug
      ? draft
      : {
          slug: selectedGame.slug,
          title: selectedGame.title || "",
          subtitle: selectedGame.subtitle || "",
          status: selectedGame.status || "progress",
          platform: selectedGame.platform || "Steam",
          hours: String(selectedGame.hours || "0h"),
          objective: selectedGame.currentObjective || selectedGame.objective || "",
        }
    : null;

  async function saveBasics() {
    if (!selectedGame || !values) return;
    setSaving(true);
    try {
      await updateGame(selectedGame.slug, {
        title: values.title.trim() || selectedGame.title,
        subtitle: values.subtitle.trim(),
        status: values.status,
        platform: values.platform,
        hours: values.hours.trim() || "0h",
        currentObjective: values.objective.trim(),
        objective: values.objective.trim(),
      });
    } finally {
      setSaving(false);
    }
  }

  async function toggleJourney() {
    if (!selectedGame) return;
    setSaving(true);
    try {
      await updateGame(selectedGame.slug, {
        firstJourney: {
          status: journeyActive(selectedGame) ? "completed" : "in_progress",
        },
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <Navbar />
      <div className="mx-auto w-full max-w-[1500px] px-5 py-7 lg:px-8 lg:py-9">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-red-500">Admin • Jogos</p>
            <h1 className="mt-2 text-4xl font-black tracking-[-0.04em]">Central de Jogos</h1>
            <p className="mt-2 max-w-[780px] text-sm leading-relaxed text-white/40">
              Nova estrutura administrativa. O visual daqui para frente será a base para migrar as funções do Admin antigo.
            </p>
          </div>
          <Link href="/admin/jogos" className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-white/55 transition hover:border-white/20 hover:text-white">
            Admin antigo
          </Link>
        </div>

        <div className="mt-7 grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="rounded-[20px] border border-white/[0.08] bg-[#090909] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/30">Jogos cadastrados</p>
                <p className="mt-1 text-xl font-black">{gamesList.length}</p>
              </div>
              <span className="rounded-full border border-red-500/20 bg-red-500/[0.06] px-2.5 py-1 text-[8px] font-black uppercase tracking-[0.14em] text-red-300">NOVO</span>
            </div>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar jogo..." className="mt-4 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-xs font-bold text-white outline-none placeholder:text-white/20 focus:border-red-500/40" />
            <div className="mt-4 max-h-[680px] space-y-2 overflow-y-auto pr-1">
              {filteredGames.map((game) => {
                const active = game.slug === selectedGame?.slug;
                return (
                  <button key={game.slug} type="button" onClick={() => { setSelectedSlug(game.slug); setDraft(null); }} className={active ? "w-full rounded-xl border border-red-500/35 bg-red-500/[0.07] p-3 text-left" : "w-full rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-left hover:border-white/15"}>
                    <div className="flex items-center gap-3">
                      <div className="h-11 w-9 shrink-0 overflow-hidden rounded-md border border-white/10 bg-black">
                        <img src={game.cardImage || game.image} alt="" className="h-full w-full object-cover" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-black">{game.title}</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[7px] font-black uppercase tracking-[0.12em] text-white/35">{statusLabel(game.status)}</span>
                          <span className={journeyActive(game) ? "rounded-full border border-red-500/25 bg-red-500/[0.08] px-1.5 py-0.5 text-[7px] font-black uppercase tracking-[0.12em] text-red-300" : "rounded-full border border-white/10 bg-white/[0.02] px-1.5 py-0.5 text-[7px] font-black uppercase tracking-[0.12em] text-white/30"}>Estreia {journeyActive(game) ? "Ativa" : "Desativada"}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="space-y-5">
            {!isLoaded ? (
              <div className="rounded-[20px] border border-white/10 bg-[#090909] p-8 text-sm text-white/35">Carregando jogos...</div>
            ) : !selectedGame || !values ? (
              <div className="rounded-[20px] border border-white/10 bg-[#090909] p-8 text-sm text-white/35">Nenhum jogo encontrado.</div>
            ) : (
              <>
                <section className="rounded-[20px] border border-white/[0.08] bg-[#090909] p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-red-500">Editor do jogo</p>
                      <h2 className="mt-1 text-2xl font-black">{selectedGame.title}</h2>
                      <p className="mt-1 text-xs text-white/30">{selectedGame.slug}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[8px] font-black uppercase tracking-[0.14em] text-white/45">{statusLabel(selectedGame.status)}</span>
                      <span className={journeyActive(selectedGame) ? "rounded-full border border-red-500/20 bg-red-500/[0.06] px-3 py-1.5 text-[8px] font-black uppercase tracking-[0.14em] text-red-300" : "rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[8px] font-black uppercase tracking-[0.14em] text-white/35"}>Jornada {journeyActive(selectedGame) ? "Ativa" : "Desativada"}</span>
                    </div>
                  </div>
                </section>

                <section className="rounded-[20px] border border-white/[0.08] bg-[#090909] p-5">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/25">01</p>
                  <h3 className="mt-1 text-xl font-black">Dados do jogo</h3>
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    {(["title","subtitle","platform","hours","objective"] as const).map((key) => {
                      const label = key === "title" ? "Nome" : key === "subtitle" ? "Subtítulo" : key === "platform" ? "Plataforma" : key === "hours" ? "Horas" : "Objetivo atual";
                      return <label key={key} className={key === "objective" ? "md:col-span-2" : ""}><span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/30">{label}</span><input value={values[key]} onChange={(event) => setDraft({ ...values, [key]: event.target.value })} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40" /></label>;
                    })}
                    <label><span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/30">Status</span><select value={values.status} onChange={(event) => setDraft({ ...values, status: event.target.value })} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"><option value="progress">Em progresso</option><option value="planned">Próxima Maestria</option><option value="completed">Finalizado</option></select></label>
                  </div>
                  <div className="mt-5 flex justify-end"><button type="button" disabled={saving} onClick={saveBasics} className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-red-100 hover:bg-red-500/20 disabled:opacity-50">{saving ? "Salvando..." : "Salvar dados do jogo"}</button></div>
                </section>

                <section className="rounded-[20px] border border-red-500/20 bg-red-500/[0.035] p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.18em] text-red-500">02</p>
                      <h3 className="mt-1 text-xl font-black">Jornada de Estreia</h3>
                      <p className="mt-1 max-w-[760px] text-xs leading-relaxed text-white/40">Controla a tela exibida enquanto o jogo está sendo jogado pela primeira vez. Este é o primeiro módulo novo do Admin.</p>
                    </div>
                    <button type="button" disabled={saving} onClick={toggleJourney} aria-pressed={journeyActive(selectedGame)} className={journeyActive(selectedGame) ? "flex min-w-[230px] items-center justify-between gap-4 rounded-2xl border border-red-500/35 bg-red-500/10 px-4 py-3 disabled:opacity-50" : "flex min-w-[230px] items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 disabled:opacity-50"}>
                      <span className="text-left"><span className="block text-[8px] font-black uppercase tracking-[0.16em] text-white/30">Estado</span><span className={journeyActive(selectedGame) ? "mt-1 block text-sm font-black text-red-100" : "mt-1 block text-sm font-black text-white/60"}>{journeyActive(selectedGame) ? "Estamos jogando" : "Página normal"}</span></span>
                      <span className={journeyActive(selectedGame) ? "relative h-7 w-12 rounded-full bg-red-500/20" : "relative h-7 w-12 rounded-full bg-black/30"}><span className={journeyActive(selectedGame) ? "absolute left-6 top-1 h-5 w-5 rounded-full bg-red-400" : "absolute left-1 top-1 h-5 w-5 rounded-full bg-white/30"} /></span>
                    </button>
                  </div>
                  <div className="mt-5 grid gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-white/[0.07] bg-black/20 p-4"><p className="text-[8px] font-black uppercase tracking-[0.15em] text-white/25">Ativa</p><p className="mt-2 text-sm font-black">Mostra o aviso de Jornada de Estreia.</p></div>
                    <div className="rounded-xl border border-white/[0.07] bg-black/20 p-4"><p className="text-[8px] font-black uppercase tracking-[0.15em] text-white/25">Desativada</p><p className="mt-2 text-sm font-black">Libera a página normal do jogo.</p></div>
                    <div className="rounded-xl border border-white/[0.07] bg-black/20 p-4"><p className="text-[8px] font-black uppercase tracking-[0.15em] text-white/25">Próximo passo</p><p className="mt-2 text-sm font-black">Migrar a seleção das conquistas para cá.</p></div>
                  </div>
                </section>

                <div className="grid gap-5 md:grid-cols-2">
                  <section className="rounded-[20px] border border-white/[0.08] bg-[#090909] p-5"><p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/25">03</p><h3 className="mt-1 text-xl font-black">Conquistas</h3><p className="mt-2 text-xs text-white/35">{selectedGame.achievementsList?.length ?? 0} conquistas cadastradas. O editor completo será migrado para este módulo.</p></section>
                  <section className="rounded-[20px] border border-white/[0.08] bg-[#090909] p-5"><p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/25">04</p><h3 className="mt-1 text-xl font-black">Emblema</h3><p className="mt-2 text-xs text-white/35">{selectedGame.emblem?.image ? "Emblema configurado." : "Emblema pendente."} O editor completo será migrado para este módulo.</p></section>
                </div>

                <section className="rounded-[20px] border border-white/[0.08] bg-[#090909] p-5"><p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/25">05</p><h3 className="mt-1 text-xl font-black">Review</h3><p className="mt-2 text-xs text-white/35">Status, nota e conteúdo da review serão migrados para este módulo.</p></section>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
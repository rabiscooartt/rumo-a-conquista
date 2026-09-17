"use client";

import Link from "next/link";
import Navbar from "@/components/Navbar";
import type { SiteGame } from "@/lib/useSiteGames";

type Props = {
  slug: string;
  game: SiteGame;
};

function readText(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function normalizeStatus(status?: string) {
  const value = readText(status, "progress")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (["completed", "finalizado", "concluido", "concluida"].includes(value)) {
    return "Finalizado";
  }

  if (["planned", "planejado", "backlog", "futuro"].includes(value)) {
    return "Na fila";
  }

  return "Em progresso";
}

function normalizeAchievementStatus(status?: string) {
  const value = readText(status, "locked")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (["completed", "concluido", "concluida", "desbloqueado", "desbloqueada"].includes(value)) {
    return "completed";
  }

  return "locked";
}

function getRank(achievement: Record<string, unknown>) {
  const value = readText(achievement.rank, readText(achievement.difficulty, "Bronze"));
  const normalized = value.toLowerCase();

  if (normalized.includes("diamante") || normalized.includes("extrema")) return "Diamante";
  if (normalized.includes("ouro") || normalized.includes("difícil") || normalized.includes("dificil")) return "Ouro";
  if (normalized.includes("prata") || normalized.includes("média") || normalized.includes("media")) return "Prata";
  return "Bronze";
}

function rankIcon(rank: string) {
  if (rank === "Diamante") return "◆";
  if (rank === "Ouro") return "●";
  if (rank === "Prata") return "●";
  return "●";
}

export default function GamePageStructurePreview({ slug, game }: Props) {
  const title = readText(game.title, "Jogo sem nome");
  const subtitle = readText(game.subtitle, "");
  const status = normalizeStatus(game.status);
  const platform = readText(game.platform, "Steam");
  const progress = Math.min(100, Math.max(0, Number(game.progress) || 0));
  const hours = readText(game.hours, "0h");
  const image = readText(game.image, "") || `/images/games/${slug}/banner.jpg`;
  const cardImage = readText(game.cardImage, "") || `/images/games/${slug}/cover.jpg`;

  const achievements = Array.isArray(game.achievementsList)
    ? game.achievementsList.filter((item) => readText(item.title, "").trim())
    : [];

  const unlocked = achievements.filter(
    (achievement) => normalizeAchievementStatus(achievement.status) === "completed"
  ).length;

  const previewAchievements = achievements.slice(0, 5);

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <Navbar />

      <div className="mx-auto grid w-full max-w-[1500px] grid-cols-[210px_minmax(0,1fr)_270px] gap-4 px-6 py-6">
        <aside className="min-w-0">
          <div className="sticky top-24 space-y-4">
            <section className="border-b border-white/[0.08] pb-5">
              <div className="flex items-center gap-2">
                <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
                <h2 className="text-[12px] font-black uppercase tracking-[0.12em] text-white">JOGO</h2>
              </div>

              <div className="mt-4 overflow-hidden rounded-xl border border-white/[0.08] bg-[#090909]">
                <div className="aspect-[3/4] overflow-hidden bg-black">
                  <img src={cardImage} alt={title} className="h-full w-full object-cover" />
                </div>
                <div className="p-3">
                  <p className="text-[13px] font-black leading-tight text-white">{title}</p>
                  <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.08em] text-white/35">{platform}</p>
                </div>
              </div>
            </section>

            <section className="border-b border-white/[0.08] pb-5">
              <div className="flex items-center gap-2">
                <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
                <h2 className="text-[12px] font-black uppercase tracking-[0.12em] text-white">STATUS</h2>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="rounded-full border border-red-500/25 bg-red-500/[0.08] px-2 py-1 text-[9px] font-black uppercase tracking-[0.08em] text-red-300">
                  {status}
                </span>
                <span className="text-[10px] font-black text-white/55">{progress}%</span>
              </div>

              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div className="h-full rounded-full bg-red-500" style={{ width: `${progress}%` }} />
              </div>
            </section>

            <section>
              <div className="flex items-center gap-2">
                <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
                <h2 className="text-[12px] font-black uppercase tracking-[0.12em] text-white">NAVEGAÇÃO</h2>
              </div>

              <nav className="mt-3 space-y-1">
                {[
                  ["Visão Geral", "#visao-geral"],
                  ["Conquistas", "#conquistas"],
                  ["Primeira Run", "#primeira-run"],
                  ["Maestria", "#maestria"],
                  ["Notas", "#notas"],
                  ["Galeria", "#galeria"],
                ].map(([label, href], index) => (
                  <a
                    key={label}
                    href={href}
                    className={`block rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-[0.08em] transition ${
                      index === 1
                        ? "bg-red-500/[0.10] text-red-300"
                        : "text-white/45 hover:bg-white/[0.03] hover:text-white"
                    }`}
                  >
                    {label}
                  </a>
                ))}
              </nav>
            </section>
          </div>
        </aside>

        <section className="min-w-0 space-y-4">
          <section id="visao-geral" className="relative min-h-[250px] overflow-hidden rounded-[14px] border border-white/[0.10] bg-[#090909]">
            <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-35" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#050505] via-[#050505]/85 to-[#050505]/35" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-transparent to-black/10" />

            <div className="relative flex min-h-[250px] flex-col justify-end p-6 md:p-8">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-red-400">Sua Jornada em Jogos</p>
              <h1 className="mt-2 max-w-[760px] text-3xl font-black leading-none text-white md:text-5xl">{title}</h1>
              {subtitle && <p className="mt-3 max-w-[700px] text-[12px] font-medium leading-relaxed text-white/55">{subtitle}</p>}

              <div className="mt-5 flex flex-wrap gap-2">
                <span className="rounded-full border border-red-500/25 bg-red-500/[0.08] px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.08em] text-red-300">{status}</span>
                <span className="rounded-full border border-white/[0.08] bg-black/35 px-3 py-1.5 text-[9px] font-bold text-white/55">{platform}</span>
                <span className="rounded-full border border-white/[0.08] bg-black/35 px-3 py-1.5 text-[9px] font-bold text-white/55">{hours}</span>
              </div>

              <div className="mt-5 max-w-[680px]">
                <div className="flex items-center justify-between text-[10px] font-black">
                  <span className="text-white/40">PROGRESSO DA JORNADA</span>
                  <span className="text-white">{progress}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.08]">
                  <div className="h-full rounded-full bg-red-500" style={{ width: `${progress}%` }} />
                </div>
              </div>
            </div>
          </section>

          <section id="conquistas" className="rounded-[14px] border border-white/[0.10] bg-[#090909] p-4 md:p-5">
            <div className="flex items-center justify-between gap-4 border-b border-white/[0.07] pb-4">
              <div className="flex items-center gap-2">
                <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
                <div>
                  <h2 className="text-[13px] font-black uppercase tracking-[0.08em] text-white">Conquistas</h2>
                  <p className="mt-1 text-[9px] font-medium text-white/30">Estrutura principal da página do jogo</p>
                </div>
              </div>
              <span className="text-[11px] font-black text-white/55">{unlocked}/{achievements.length}</span>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button className="rounded-lg border border-red-500/25 bg-red-500/[0.08] px-3 py-2 text-[9px] font-black uppercase tracking-[0.08em] text-red-300">Todas</button>
              <button className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-[9px] font-black uppercase tracking-[0.08em] text-white/45">Desbloqueadas</button>
              <button className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-[9px] font-black uppercase tracking-[0.08em] text-white/45">Bloqueadas</button>
            </div>

            <div className="mt-4 space-y-2">
              {previewAchievements.length > 0 ? (
                previewAchievements.map((achievement, index) => {
                  const item = achievement as Record<string, unknown>;
                  const rank = getRank(item);
                  const completed = normalizeAchievementStatus(readText(item.status, "locked")) === "completed";
                  const icon = readText(item.image, "");

                  return (
                    <article key={readText(item.id, `${title}-${index}`)} className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-black/20 p-3">
                      <div className={`flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border ${completed ? "border-red-500/30 bg-red-500/[0.06]" : "border-white/[0.08] bg-white/[0.02]"}`}>
                        {icon ? <img src={icon} alt="" className="h-full w-full object-cover" /> : <span className={`text-sm font-black ${completed ? "text-red-400" : "text-white/20"}`}>{rankIcon(rank)}</span>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-black text-white">{readText(item.title, `Conquista ${index + 1}`)}</p>
                        <p className="mt-1 truncate text-[9px] font-medium text-white/30">{readText(item.description, "Descrição da conquista")}</p>
                      </div>
                      <span className={`shrink-0 text-[9px] font-black uppercase tracking-[0.08em] ${completed ? "text-emerald-300" : "text-white/20"}`}>{completed ? "Desbloqueada" : "Bloqueada"}</span>
                    </article>
                  );
                })
              ) : (
                <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-10 text-center text-[10px] font-bold text-white/25">As conquistas entrarão aqui na próxima etapa.</div>
              )}
            </div>
          </section>
        </section>

        <aside className="min-w-0">
          <div className="sticky top-24 space-y-4">
            <section className="rounded-[14px] border border-white/[0.10] bg-[#090909] p-4">
              <div className="flex items-center gap-2">
                <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
                <h2 className="text-[12px] font-black uppercase tracking-[0.12em] text-white">RESUMO DO JOGO</h2>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3"><p className="text-[8px] font-black uppercase tracking-[0.08em] text-white/25">Conquistas</p><p className="mt-1 text-lg font-black text-white">{unlocked}/{achievements.length}</p></div>
                <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3"><p className="text-[8px] font-black uppercase tracking-[0.08em] text-white/25">Progresso</p><p className="mt-1 text-lg font-black text-white">{progress}%</p></div>
                <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3"><p className="text-[8px] font-black uppercase tracking-[0.08em] text-white/25">Tempo</p><p className="mt-1 text-lg font-black text-white">{hours}</p></div>
                <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3"><p className="text-[8px] font-black uppercase tracking-[0.08em] text-white/25">Plataforma</p><p className="mt-1 truncate text-[11px] font-black text-white">{platform}</p></div>
              </div>
            </section>

            <section id="maestria" className="rounded-[14px] border border-white/[0.10] bg-[#090909] p-4">
              <div className="flex items-center gap-2">
                <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
                <h2 className="text-[12px] font-black uppercase tracking-[0.12em] text-white">MAESTRIA</h2>
              </div>
              <div className="mt-4 rounded-xl border border-white/[0.07] bg-black/20 p-3">
                <p className="text-[9px] font-black uppercase tracking-[0.08em] text-red-300">Próximo grande objetivo</p>
                <p className="mt-2 text-[11px] font-bold leading-relaxed text-white/65">{readText(game.currentObjective, "Definir objetivo da Maestria")}</p>
              </div>
            </section>

            <section id="primeira-run" className="rounded-[14px] border border-white/[0.10] bg-[#090909] p-4">
              <div className="flex items-center gap-2">
                <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
                <h2 className="text-[12px] font-black uppercase tracking-[0.12em] text-white">PRIMEIRA RUN</h2>
              </div>
              <div className="mt-4 space-y-2 text-[10px] font-bold text-white/45">
                <div className="flex items-center justify-between"><span>Status</span><span className="text-white/75">{status}</span></div>
                <div className="flex items-center justify-between"><span>Tempo</span><span className="text-white/75">{hours}</span></div>
                <div className="flex items-center justify-between"><span>Progresso</span><span className="text-white/75">{progress}%</span></div>
              </div>
            </section>

            <section id="notas" className="rounded-[14px] border border-white/[0.10] bg-[#090909] p-4">
              <div className="flex items-center gap-2">
                <div className="h-[20px] w-[2px] shrink-0 bg-red-500" />
                <h2 className="text-[12px] font-black uppercase tracking-[0.12em] text-white">NOTAS</h2>
              </div>
              <p className="mt-3 text-[10px] font-medium leading-relaxed text-white/30">A review e a nota entram aqui na próxima etapa.</p>
            </section>
          </div>
        </aside>
      </div>
    </main>
  );
}

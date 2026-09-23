"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type FlexibleAchievementInput,
  type SiteGame,
  slugify,
} from "@/lib/useSiteGames";

type AchievementRank = "Bronze" | "Prata" | "Ouro" | "Diamante";
type AchievementStatus = "locked" | "progress" | "completed";
type AchievementFilter = "all" | "completed" | "locked";

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
  isExophase: boolean;
};

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
    const normalized = value.toLowerCase().trim();
    if (["true", "1", "sim", "yes", "oculta", "hidden"].includes(normalized)) return true;
    if (["false", "0", "nao", "não", "no", "visivel", "visível"].includes(normalized)) return false;
  }
  return fallback;
}

function rankLabel(rank: AchievementRank) {
  return rank === "Diamante" ? "Maestria" : rank;
}

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

function normalizeStatus(value?: string): AchievementStatus {
  if (value === "completed") return "completed";
  if (value === "progress") return "progress";
  return "locked";
}

function normalizeAchievements(
  achievements: FlexibleAchievementInput[] | undefined,
  slug: string
): EditableAchievement[] {
  if (!Array.isArray(achievements)) return [];

  return achievements.map((achievement, index) => {
    const raw = achievement as FlexibleAchievementInput & {
      isHidden?: unknown;
      hidden?: unknown;
      isExophase?: unknown;
    };

    const title = readText(achievement.title, `Conquista ${index + 1}`);
    const rank = normalizeRank(
      readText(achievement.difficulty, readText(achievement.rank, "Bronze"))
    );

    return {
      ...achievement,
      id:
        readText(achievement.id, "") ||
        `${slug}-achievement-${index + 1}-${slugify(title)}`,
      title,
      description: readText(achievement.description, ""),
      trophy:
        readText(achievement.trophy, "") ||
        readText(achievement.icon, "") ||
        rankToTrophy(rank),
      difficulty: rank,
      status: normalizeStatus(readText(achievement.status, "locked")),
      image: readText(achievement.image, ""),
      isCustom: Boolean(achievement.isCustom ?? false),
      isHidden: readBoolean(raw.isHidden ?? raw.hidden, false),
      isExophase: readBoolean(raw.isExophase, false),
    };
  });
}

function toSavePayload(achievements: EditableAchievement[]): FlexibleAchievementInput[] {
  return achievements.map((achievement, index) => {
    const title = achievement.title.trim() || `Nova conquista ${index + 1}`;
    const rank = normalizeRank(achievement.difficulty);
    const trophy = achievement.trophy || rankToTrophy(rank);

    return {
      id: achievement.id || crypto.randomUUID(),
      title,
      description: achievement.description.trim(),
      trophy,
      icon: trophy,
      difficulty: rank,
      rank,
      status: achievement.status,
      image: achievement.image.trim(),
      isCustom: Boolean(achievement.isCustom),
      isHidden: Boolean(achievement.isHidden),
      isExophase: Boolean(achievement.isExophase),
    };
  });
}

function AchievementImage({
  achievement,
}: {
  achievement: EditableAchievement;
}) {
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
  }, [achievement.image]);

  if (!achievement.image || error) {
    return <span className="text-xl opacity-55">{achievement.trophy}</span>;
  }

  return (
    <img
      src={achievement.image}
      alt=""
      className="h-full w-full object-cover"
      onError={() => setError(true)}
    />
  );
}

export default function NewGameAchievementsEditor({
  game,
  onSave,
}: {
  game: SiteGame;
  onSave: (update: Partial<SiteGame>) => Promise<boolean>;
}) {
  const [achievements, setAchievements] = useState(() =>
    normalizeAchievements(game.achievementsList, game.slug)
  );
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AchievementFilter>("all");
  const [exophaseOnly, setExophaseOnly] = useState(false);
  const [minimized, setMinimized] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const next = normalizeAchievements(game.achievementsList, game.slug);
    setAchievements(next);
    setMinimized(Object.fromEntries(next.map((item) => [item.id, true])));
    setSearch("");
    setFilter("all");
    setExophaseOnly(false);
  }, [game]);

  const completedCount = achievements.filter((item) => item.status === "completed").length;

  const filteredAchievements = useMemo(() => {
    const q = normalizeText(search);

    return achievements.filter((achievement) => {
      if (q && !normalizeText(achievement.title).includes(q)) return false;
      if (exophaseOnly && !achievement.isExophase) return false;
      if (filter === "completed" && achievement.status !== "completed") return false;
      if (filter === "locked" && achievement.status !== "locked") return false;
      return true;
    });
  }, [achievements, exophaseOnly, filter, search]);

  function updateAchievement(id: string, update: Partial<EditableAchievement>) {
    setAchievements((current) =>
      current.map((achievement) =>
        achievement.id === id ? { ...achievement, ...update } : achievement
      )
    );
  }

  async function saveAchievements(next = achievements) {
    setSaving(true);
    try {
      const ok = await onSave({
        achievementsList: toSavePayload(next),
      });
      return ok;
    } finally {
      setSaving(false);
    }
  }

  function addAchievement() {
    const newAchievement: EditableAchievement = {
      id: `${game.slug}-achievement-${crypto.randomUUID()}`,
      title: "Nova conquista",
      description: "",
      trophy: "🥉",
      difficulty: "Bronze",
      status: "locked",
      image: "",
      isCustom: true,
      isHidden: false,
      isExophase: false,
    };

    const next = [newAchievement, ...achievements];
    setAchievements(next);
    setMinimized((current) => ({ ...current, [newAchievement.id]: false }));
    void saveAchievements(next);
  }

  function importAchievements() {
    const input = window.prompt("Cole a lista de conquistas, uma por linha:");
    if (!input?.trim()) return;

    const imported = input
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((title) => ({
        id: `${game.slug}-achievement-${crypto.randomUUID()}`,
        title,
        description: "",
        trophy: "🥉",
        difficulty: "Bronze" as AchievementRank,
        status: "locked" as AchievementStatus,
        image: "",
        isCustom: true,
        isHidden: false,
        isExophase: false,
      }));

    const next = [...imported, ...achievements];
    setAchievements(next);
    void saveAchievements(next);
  }

  function copyNames() {
    const names = achievements
      .map((achievement) => achievement.title.trim())
      .filter(Boolean)
      .join("\n");

    if (!names) {
      alert("Nenhuma conquista cadastrada.");
      return;
    }

    navigator.clipboard
      .writeText(names)
      .then(() => alert(`${achievements.length} nomes copiados.`))
      .catch(() => window.prompt("Copie os nomes:", names));
  }

  async function removeAchievement(id: string) {
    const target = achievements.find((item) => item.id === id);
    if (!target) return;
    if (!window.confirm(`Remover a conquista "${target.title}"?`)) return;

    const next = achievements.filter((item) => item.id !== id);
    setAchievements(next);
    const ok = await saveAchievements(next);
    if (!ok) setAchievements(achievements);
  }

  async function toggleExophase(id: string) {
    const next = achievements.map((item) =>
      item.id === id ? { ...item, isExophase: !item.isExophase } : item
    );
    setAchievements(next);
    await saveAchievements(next);
  }

  function useAutomaticImage(id: string, title: string) {
    const image = `/images/games/${game.slug}/achievements/${slugify(title || "conquista")}.png`;
    updateAchievement(id, { image });
  }

  return (
    <section className="rounded-[20px] border border-white/[0.08] bg-[#090909] p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/25">
            03
          </p>
          <h3 className="mt-1 text-xl font-black text-white">
            Conquistas
          </h3>
          <p className="mt-1 text-xs text-white/35">
            {completedCount}/{achievements.length} concluídas
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar conquista..."
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-xs font-bold text-white outline-none placeholder:text-white/20 focus:border-red-500/40 sm:w-[220px]"
          />
          <button type="button" onClick={importAchievements} className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2.5 text-xs font-black text-cyan-200">
            Importar lista
          </button>
          <button type="button" onClick={copyNames} className="rounded-xl border border-violet-400/30 bg-violet-500/10 px-4 py-2.5 text-xs font-black text-violet-200">
            Copiar nomes
          </button>
          <button type="button" onClick={addAchievement} className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs font-black text-red-100">
            + Adicionar
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {([
          ["all", "📋 Todas"],
          ["completed", "🏆 Concluídas"],
          ["locked", "🔒 Bloqueadas"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={filter === value
              ? "rounded-xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-black text-red-100"
              : "rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-black text-white/45"}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setExophaseOnly((value) => !value)}
          className={exophaseOnly
            ? "rounded-xl border border-violet-400/40 bg-violet-500/15 px-3 py-2 text-xs font-black text-violet-100"
            : "rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-black text-white/45"}
        >
          ◉ Exophase
        </button>
        <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] font-bold text-white/30">
          Exibindo {filteredAchievements.length} de {achievements.length}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {filteredAchievements.length > 0 ? filteredAchievements.map((achievement) => {
          const isMinimized = minimized[achievement.id] ?? true;
          const index = achievements.findIndex((item) => item.id === achievement.id);

          return (
            <article key={achievement.id} className={achievement.status === "locked"
              ? "rounded-2xl border border-white/5 bg-white/[0.015] opacity-60"
              : achievement.isHidden
                ? "rounded-2xl border border-yellow-400/25 bg-yellow-500/[0.035]"
                : "rounded-2xl border border-white/[0.08] bg-black/20"}
            >
              {isMinimized ? (
                <div className="flex items-center justify-between gap-4 p-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/40">
                      {achievement.status === "locked" ? "🔒" : <AchievementImage achievement={achievement} />}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-white">{achievement.title}</p>
                      <p className="mt-1 text-[8px] font-black uppercase tracking-[0.14em] text-white/25">
                        {achievement.trophy} {achievement.difficulty}
                        {achievement.isExophase ? " • Exophase" : ""}
                        {achievement.isHidden ? " • Oculta" : ""}
                      </p>
                    </div>
                  </div>
                  <button type="button" onClick={() => setMinimized((current) => ({ ...current, [achievement.id]: false }))} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-black text-white/55">
                    ＋ Expandir
                  </button>
                </div>
              ) : (
                <div className="grid gap-4 p-4 lg:grid-cols-[82px_minmax(0,1fr)]">
                  <div className="flex h-[82px] items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                    {achievement.status === "locked" ? "🔒" : <AchievementImage achievement={achievement} />}
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[8px] font-black uppercase tracking-[0.18em] text-white/25">
                          Conquista {index + 1}
                        </p>
                        <h4 className="mt-1 text-lg font-black text-white">{achievement.title}</h4>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {achievement.isHidden && <span className="rounded-full border border-yellow-400/30 bg-yellow-500/10 px-2 py-1 text-[8px] font-black uppercase tracking-[0.12em] text-yellow-200">Oculta</span>}
                          {achievement.isExophase && <span className="rounded-full border border-violet-400/30 bg-violet-500/10 px-2 py-1 text-[8px] font-black uppercase tracking-[0.12em] text-violet-200">Exophase</span>}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => setMinimized((current) => ({ ...current, [achievement.id]: true }))} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-black text-white/50">− Minimizar</button>
                        <button type="button" onClick={() => updateAchievement(achievement.id, { isHidden: !achievement.isHidden })} className="rounded-xl border border-cyan-400/25 bg-cyan-500/[0.06] px-3 py-2 text-xs font-black text-cyan-200">{achievement.isHidden ? "🙈 Oculta" : "👁️ Visível"}</button>
                        <button type="button" onClick={() => void toggleExophase(achievement.id)} className="rounded-xl border border-violet-400/25 bg-violet-500/[0.06] px-3 py-2 text-xs font-black text-violet-200">{achievement.isExophase ? "✓ Exophase" : "Exophase"}</button>
                        <button type="button" onClick={() => void removeAchievement(achievement.id)} className="rounded-xl border border-red-500/25 bg-red-500/[0.06] px-3 py-2 text-xs font-black text-red-200">Remover</button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <label className="xl:col-span-2">
                        <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/25">Título</span>
                        <input value={achievement.title} onChange={(event) => updateAchievement(achievement.id, { title: event.target.value })} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm font-bold text-white outline-none focus:border-red-500/40" />
                      </label>
                      <label>
                        <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/25">Rank</span>
                        <select value={achievement.difficulty} onChange={(event) => { const rank = event.target.value as AchievementRank; updateAchievement(achievement.id, { difficulty: rank, trophy: rankToTrophy(rank) }); }} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm font-bold text-white outline-none focus:border-red-500/40">
                          {(["Bronze", "Prata", "Ouro", "Diamante"] as const).map((rank) => <option key={rank} value={rank}>{rankToTrophy(rank)} {rankLabel(rank)}</option>)}
                        </select>
                      </label>
                      <label>
                        <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/25">Status</span>
                        <select value={achievement.status} onChange={(event) => updateAchievement(achievement.id, { status: event.target.value as AchievementStatus })} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm font-bold text-white outline-none focus:border-red-500/40">
                          <option value="locked">Bloqueada</option>
                          <option value="progress">Em progresso</option>
                          <option value="completed">Concluída</option>
                        </select>
                      </label>
                      <label className="md:col-span-2 xl:col-span-4">
                        <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/25">Descrição</span>
                        <input value={achievement.description} onChange={(event) => updateAchievement(achievement.id, { description: event.target.value })} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm font-bold text-white outline-none focus:border-red-500/40" />
                      </label>
                      <label className="md:col-span-2 xl:col-span-4">
                        <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/25">Imagem da conquista</span>
                        <input value={achievement.image} onChange={(event) => updateAchievement(achievement.id, { image: event.target.value })} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm font-bold text-white outline-none focus:border-red-500/40" />
                      </label>
                    </div>

                    <div className="mt-4 flex justify-end">
                      <button type="button" onClick={() => useAutomaticImage(achievement.id, achievement.title)} className="rounded-xl border border-cyan-400/25 bg-cyan-500/[0.06] px-4 py-2 text-xs font-black text-cyan-200">
                        Usar caminho automático da imagem
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </article>
          );
        }) : (
          <div className="rounded-2xl border border-white/10 bg-black/20 p-6 text-sm text-white/40">
            {achievements.length === 0
              ? "Nenhuma conquista cadastrada ainda."
              : `Nenhuma conquista encontrada para os filtros atuais.`}
          </div>
        )}
      </div>

      {achievements.length > 0 && (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => void saveAchievements()}
            disabled={saving}
            className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-emerald-200 disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar conquistas"}
          </button>
        </div>
      )}
    </section>
  );
}

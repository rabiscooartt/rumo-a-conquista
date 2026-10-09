"use client";

import { useState } from "react";
import type { GameEmblemInput, SiteGame } from "@/lib/useSiteGames";

type GameEmblemEditorProps = {
  game: SiteGame;
  collapsed: boolean;
  onToggle: () => void;
  onSave: (emblem: GameEmblemInput) => Promise<boolean>;
};

type LegacyEmblemFields = {
  gameEmblem?: GameEmblemInput;
  emblemTitle?: string;
  emblemImage?: string;
  emblemDescription?: string;
  emblemTags?: string[] | string;
  emblemUnlockedAt?: string;
};

function readText(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function automaticEmblemPath(slug: string) {
  // This asset kept a historical misspelling in its public folder.
  if (slug === "hogwarts-legacy") return "/images/games/howgarts-legacy/emblem.png";
  return `/images/games/${slug}/emblem.png`;
}

function readTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((tag) => readText(tag).trim()).filter(Boolean);
  }

  return readText(value)
    .split(/[\n,]/g)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function getLegacyEmblemUnlockedAt(game: SiteGame): string {
  const achievements = Array.isArray(game.achievementsList) ? game.achievementsList : [];
  const mastery = achievements.find((achievement) => {
    const title = readText(achievement.title).toLowerCase();
    const rank = readText(achievement.difficulty, readText(achievement.rank, "")).toLowerCase();
    const status = readText(achievement.status).toLowerCase();
    const completed = ["completed", "concluida", "concluido", "desbloqueado", "desbloqueada"].includes(status);
    return completed && (
      rank.includes("diamante") ||
      rank.includes("maestria") ||
      title.includes("maestria") ||
      title.includes("mastery") ||
      title.includes("final") ||
      title.includes("caso encerrado")
    );
  });

  const achievementDate = readText(mastery?.earnedDate).trim();
  if (achievementDate) return achievementDate;

  // Preserve the established dates shown for legacy emblem cards until the
  // owner explicitly saves the emblem configuration in Admin.
  if (game.slug === "crisol-theater-of-idols") return "2026-04-09";
  if (game.slug === "hogwarts-legacy" || game.slug === "howgarts-legacy") return "2026-03-17";
  return "";
}

function initialEmblem(game: SiteGame): GameEmblemInput {
  const legacy = game as SiteGame & LegacyEmblemFields;
  const saved =
    game.emblem ??
    legacy.gameEmblem ??
    (legacy.emblemTitle || legacy.emblemImage || legacy.emblemDescription || legacy.emblemTags || legacy.emblemUnlockedAt
      ? {
          title: legacy.emblemTitle,
          image: legacy.emblemImage,
          description: legacy.emblemDescription,
          tags: legacy.emblemTags,
          unlockedAt: legacy.emblemUnlockedAt,
          configured: false,
        }
      : undefined);

  if (saved) {
    return {
      title: readText(saved.title, "Emblema do Jogo"),
      image: readText(saved.image, automaticEmblemPath(game.slug)),
      description: readText(saved.description),
      tags: readTags(saved.tags),
      unlockedAt:
        readText(saved.unlockedAt).trim() ||
        (saved.configured === true ? "" : getLegacyEmblemUnlockedAt(game)),
      configured: saved.configured === true,
    };
  }

  if (game.slug === "hogwarts-legacy") {
    return {
      title: "Legado Absoluto",
      image: automaticEmblemPath(game.slug),
      description:
        "Uma relíquia simbólica concedida ao bruxo que explorou Hogwarts por completo, dominou seus desafios e revelou todos os segredos deixados pelo legado mágico. O Legado Absoluto representa a conclusão definitiva da jornada e a marca de quem se tornou um verdadeiro guardião dessa história.",
      tags: ["Colecionável", "Emblema Especial", "Hogwarts Legacy"],
      unlockedAt: getLegacyEmblemUnlockedAt(game),
      configured: false,
    };
  }

  return {
    title: "Emblema do Jogo",
    image: automaticEmblemPath(game.slug),
    description: "",
    tags: [],
    unlockedAt: getLegacyEmblemUnlockedAt(game),
    configured: false,
  };
}

export default function GameEmblemEditor({
  game,
  collapsed,
  onToggle,
  onSave,
}: GameEmblemEditorProps) {
  const [emblem, setEmblem] = useState<GameEmblemInput>(() => initialEmblem(game));
  const [tagsText, setTagsText] = useState(() => initialEmblem(game).tags?.join(", ") ?? "");
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [imageError, setImageError] = useState(false);

  function update(field: keyof GameEmblemInput, value: string) {
    setEmblem((current) => ({ ...current, [field]: value }));
    if (field === "image") setImageError(false);
    setSaveState("idle");
  }

  async function save() {
    setSaving(true);
    setSaveState("idle");

    const payload: GameEmblemInput = {
      title: readText(emblem.title).trim() || "Emblema do Jogo",
      image: readText(emblem.image).trim(),
      description: readText(emblem.description).trim(),
      tags: readTags(tagsText),
      unlockedAt: readText(emblem.unlockedAt).trim(),
      configured: true,
    };

    try {
      const ok = await onSave(payload);
      setSaveState(ok ? "saved" : "error");
    } catch {
      setSaveState("error");
    } finally {
      setSaving(false);
    }
  }

  const imageSrc = readText(emblem.image).trim();
  const hasSavedData = Boolean(
    game.emblem?.title ||
      game.emblem?.image ||
      game.emblem?.description ||
      game.emblem?.tags?.length
  );

  return (
    <section className="rounded-[20px] border border-white/[0.08] bg-[#090909] p-5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="group flex w-full items-center justify-between gap-4 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-14 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/40">
            {imageSrc && !imageError ? (
              <img
                key={imageSrc}
                src={imageSrc}
                alt=""
                className="h-full w-full object-contain"
                onError={() => setImageError(true)}
              />
            ) : (
              <span aria-hidden="true" className="text-xl text-white/30">◇</span>
            )}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[9px] font-black uppercase tracking-[0.18em] text-white/35">05</span>
            <span className="mt-1 text-xl font-black text-white transition-colors group-hover:text-red-100">Emblema</span>
            <span className="mt-1 truncate text-xs text-white/45">
              {readText(emblem.title).trim() || "Emblema do Jogo"}
              {" · "}
              {hasSavedData ? "Emblema cadastrado" : "Configure o emblema deste jogo"}
            </span>
          </span>
        </span>
        <span aria-hidden="true" className="shrink-0 text-lg font-black text-white/45 transition-colors group-hover:text-red-300">
          {collapsed ? "+" : "−"}
        </span>
      </button>

      {!collapsed && (
        <div className="mt-5 grid gap-5 border-t border-white/[0.07] pt-5 lg:grid-cols-[190px_minmax(0,1fr)]">
          <div>
            <div className="relative flex min-h-[210px] items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/30 p-3">
              {imageSrc && !imageError ? (
                <img
                  key={imageSrc}
                  src={imageSrc}
                  alt={readText(emblem.title, "Emblema do Jogo")}
                  className="max-h-[290px] w-full object-contain"
                  onError={() => setImageError(true)}
                />
              ) : (
                <div className="px-3 text-center">
                  <span className="text-4xl text-white/25">◇</span>
                  <p className="mt-2 text-xs font-bold text-white/45">A imagem ainda não foi encontrada.</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-white/25">Confira o caminho ou informe uma URL válida no campo ao lado.</p>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => update("image", automaticEmblemPath(game.slug))}
              className="mt-3 w-full rounded-xl border border-cyan-400/25 bg-cyan-500/[0.06] px-3 py-2.5 text-[9px] font-black uppercase tracking-[0.08em] text-cyan-200"
            >
              Usar caminho automático
            </button>
          </div>

          <div className="min-w-0 space-y-4">
            <label className="block">
              <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Título do emblema</span>
              <input
                value={readText(emblem.title)}
                onChange={(event) => update("title", event.target.value)}
                placeholder="Ex.: Legado Absoluto"
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
            </label>

            <label className="block">
              <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Imagem do emblema (caminho ou URL)</span>
              <input
                value={readText(emblem.image)}
                onChange={(event) => update("image", event.target.value)}
                placeholder={automaticEmblemPath(game.slug)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
              />
              <span className="mt-1 block text-[10px] leading-relaxed text-white/30">A prévia mostra a arte que será usada na página pública. Para arquivos locais, coloque a imagem em public/images/games/{game.slug}/.</span>
            </label>

            <label className="block">
              <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Descrição</span>
              <textarea
                value={readText(emblem.description)}
                onChange={(event) => update("description", event.target.value)}
                rows={3}
                placeholder="Descreva o significado deste emblema."
                className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold leading-relaxed text-white outline-none focus:border-red-500/40"
              />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Tags</span>
                <input
                  value={tagsText}
                  onChange={(event) => {
                    setTagsText(event.target.value);
                    setSaveState("idle");
                  }}
                  placeholder="Colecionável, Emblema Especial"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
                />
              </label>
              <label className="block">
                <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Data de conquista (opcional)</span>
                <input
                  value={readText(emblem.unlockedAt)}
                  onChange={(event) => update("unlockedAt", event.target.value)}
                  placeholder="AAAA-MM-DD"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
                />
                <span className="mt-1 block text-[10px] leading-relaxed text-white/30">Preencher esta data marca o emblema como conquistado na página do jogo.</span>
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/[0.07] pt-4">
              {saveState === "saved" && <span role="status" className="text-xs font-bold text-emerald-200">Emblema salvo com sucesso.</span>}
              {saveState === "error" && <span role="alert" className="text-xs font-bold text-red-200">Não foi possível salvar o emblema.</span>}
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-5 py-3 text-xs font-black uppercase tracking-[0.12em] text-emerald-100 transition hover:bg-emerald-500/15 disabled:opacity-50"
              >
                {saving ? "Salvando..." : saveState === "saved" ? "✓ Emblema salvo" : "Salvar Emblema"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

"use client";

import { useState } from "react";
import type { SiteGame } from "@/lib/useSiteGames";

type FinalMastery = {
  title: string;
  icon: string;
  image: string;
  description: string;
};

function readText(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function masteryImagePath(slug: string) {
  return "/images/games/" + slug + "/achievements/maestria-final.png";
}

function normalizeMastery(game: SiteGame): FinalMastery {
  const raw =
    game.finalBadge && typeof game.finalBadge === "object"
      ? (game.finalBadge as Record<string, unknown>)
      : {};

  return {
    title: readText(raw.title, "Maestria Final"),
    icon: readText(raw.icon, "💎"),
    image: readText(raw.image, masteryImagePath(game.slug)),
    description: readText(raw.description, ""),
  };
}

function buildMasteryPrompt(game: SiteGame, mastery: FinalMastery) {
  return [
    "RUMO À CONQUISTA — LOTE EXCLUSIVO DE MAESTRIA FINAL",
    "",
    "LOTE: MAESTRIA FINAL",
    "QUANTIDADE: 1",
    "JOGO: " + game.title,
    "",
    "OBJETIVO:",
    "Criar exclusivamente a arte da MAESTRIA FINAL deste jogo.",
    "",
    "REGRA ESPECÍFICA DA MAESTRIA FINAL:",
    "Somente nesta arte, o NOME e a DESCRIÇÃO da Maestria são o briefing principal da criação.",
    "A arte deve ser visualmente próxima do significado comunicado pelo título e pela descrição, transformando as palavras em símbolos, objetos, ações, formas, composição, atmosfera e elementos visuais que representem claramente a ideia da Maestria.",
    "Não criar uma arte genérica de troféu só porque ela é a recompensa final.",
    "Não ignorar palavras ou conceitos importantes do título e da descrição.",
    "A identidade visual deve parecer feita especificamente para esta Maestria Final e para este jogo.",
    "",
    "TÍTULO DA MAESTRIA:",
    mastery.title || "Maestria Final",
    "",
    "DESCRIÇÃO DA MAESTRIA:",
    mastery.description || "Sem descrição disponível. Criar a direção visual a partir do título e do universo do jogo.",
    "",
    "DIREÇÃO CRIATIVA:",
    "1. Extraia do título os conceitos mais importantes.",
    "2. Extraia da descrição a ação, conquista, tema, objeto, sensação ou conclusão que melhor representa a Maestria.",
    "3. Transforme esses conceitos em uma composição visual original e imediatamente compreensível.",
    "4. Dê à Maestria presença visual de recompensa máxima, sem depender de uma fórmula fixa de platina, metal ou troféu.",
    "5. Use o universo do jogo para definir os elementos visuais que fazem sentido para aquela conclusão.",
    "",
    "MATRIZ VISUAL OFICIAL:",
    "• 1 imagem individual.",
    "• 1024x1024 px.",
    "• Proporção 1:1.",
    "• PNG.",
    "• Arte edge-to-edge, ocupando 100% do canvas e tocando diretamente as quatro bordas.",
    "• Legibilidade é prioridade absoluta.",
    "• Um elemento principal dominante e poucos elementos secundários.",
    "• Silhueta e leitura claras mesmo em tamanho reduzido.",
    "• Sem texto, letras, números ou logotipos dentro da imagem.",
    "• Sem colagem, mosaico, painel, contact sheet ou múltiplas artes.",
    "• Criar uma composição nova, independente e específica para esta Maestria.",
    "",
    "REGRA DE ORIGINALIDADE:",
    "O resultado deve representar visualmente o título e a descrição, sem transformar a frase em texto dentro da imagem.",
    "Não copiar artes de referência nem reproduzir composições reconhecíveis de terceiros.",
    "",
    "ARQUIVO FINAL: " + game.slug + "-maestria-final.png",
    "",
    "RESULTADO:",
    "Somente a arte da MAESTRIA FINAL.",
    "1 MAESTRIA = 1 IMAGEM = 1 ARQUIVO.",
  ].join("\n");
}

export default function FinalMasteryEditor({
  game,
  onSave,
}: {
  game: SiteGame;
  onSave: (finalBadge: NonNullable<SiteGame["finalBadge"]>) => Promise<boolean>;
}) {
  const [mastery, setMastery] = useState<FinalMastery>(() => normalizeMastery(game));
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [imageError, setImageError] = useState(false);

  function update(field: keyof FinalMastery, value: string) {
    setMastery((current) => ({ ...current, [field]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      await onSave({
        title: mastery.title.trim() || "Maestria Final",
        icon: mastery.icon.trim() || "💎",
        image: mastery.image.trim() || masteryImagePath(game.slug),
        description: mastery.description.trim(),
      });
    } finally {
      setSaving(false);
    }
  }

  function useAutomaticImage() {
    update("image", masteryImagePath(game.slug));
    setImageError(false);
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(buildMasteryPrompt(game, mastery));
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      window.alert("Não foi possível copiar o prompt da Maestria Final.");
    }
  }

  async function downloadPackage() {
    setDownloading(true);

    try {
      const packageText = buildMasteryPrompt(game, mastery);
      const response = await fetch("/api/admin/achievement-reference-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "Lote-Maestria-Final.zip",
          packageText,
          references: [],
        }),
      });

      if (!response.ok) {
        let message = "Não foi possível montar o pacote da Maestria Final.";
        try {
          const payload = await response.json();
          if (payload?.error) message = payload.error;
        } catch {
          // Mantém a mensagem padrão.
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      if (blob.size === 0) {
        throw new Error("O pacote da Maestria Final veio vazio.");
      }

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "Lote-Maestria-Final.zip";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "Não foi possível baixar o pacote da Maestria Final."
      );
    } finally {
      setDownloading(false);
    }
  }

  const imageSrc = mastery.image.trim() || masteryImagePath(game.slug);

  return (
    <section className="rounded-[20px] border border-violet-400/20 bg-violet-500/[0.035] p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-violet-300">
            04 • Maestria Final
          </p>
          <h3 className="mt-1 text-xl font-black">Maestria Final</h3>
          <p className="mt-1 max-w-[820px] text-xs leading-relaxed text-white/40">
            Aqui fica a recompensa final do jogo. Nesta arte, o título e a descrição são usados diretamente como direção criativa para criar algo específico da Maestria.
          </p>
        </div>

        <div className="shrink-0 rounded-xl border border-violet-300/20 bg-violet-300/[0.06] px-3 py-2 text-[9px] font-black uppercase tracking-[0.12em] text-violet-100">
          1 Maestria = 1 arte
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[170px_minmax(0,1fr)]">
        <div>
          <div className="relative aspect-square overflow-hidden rounded-2xl border border-violet-300/15 bg-black/40">
            {!imageError ? (
              <img
                src={imageSrc}
                alt=""
                className="h-full w-full object-cover"
                onError={() => setImageError(true)}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-4xl opacity-50">
                {mastery.icon || "💎"}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={useAutomaticImage}
            className="mt-3 w-full rounded-xl border border-cyan-400/25 bg-cyan-500/[0.06] px-3 py-2.5 text-[9px] font-black uppercase tracking-[0.08em] text-cyan-200"
          >
            Usar caminho automático
          </button>
        </div>

        <div className="min-w-0">
          <div className="grid gap-3 md:grid-cols-[1fr_100px]">
            <label>
              <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/30">
                Título da Maestria
              </span>
              <input
                value={mastery.title}
                onChange={(event) => update("title", event.target.value)}
                placeholder="Ex.: Ídolo Absoluto"
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold text-white outline-none focus:border-violet-400/40"
              />
            </label>

            <label>
              <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/30">
                Ícone
              </span>
              <input
                value={mastery.icon}
                onChange={(event) => update("icon", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-center text-lg font-bold text-white outline-none focus:border-violet-400/40"
              />
            </label>
          </div>

          <label className="mt-3 block">
            <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/30">
              Descrição da Maestria
            </span>
            <textarea
              value={mastery.description}
              onChange={(event) => update("description", event.target.value)}
              rows={5}
              placeholder="Explique o que representa a conclusão máxima deste jogo."
              className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold leading-relaxed text-white outline-none focus:border-violet-400/40"
            />
          </label>

          <label className="mt-3 block">
            <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/30">
              Imagem da Maestria
            </span>
            <input
              value={mastery.image}
              onChange={(event) => {
                update("image", event.target.value);
                setImageError(false);
              }}
              placeholder={"/images/games/" + game.slug + "/achievements/maestria-final.png"}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold text-white outline-none focus:border-violet-400/40"
            />
          </label>

          <div className="mt-4 rounded-xl border border-violet-300/15 bg-black/20 p-3">
            <p className="text-[9px] font-black uppercase tracking-[0.14em] text-violet-200/70">
              Regra exclusiva da geração
            </p>
            <p className="mt-1 text-xs leading-relaxed text-white/45">
              O gerador deve usar <strong className="text-white/70">título + descrição</strong> como briefing principal e transformar o significado deles em uma arte original específica para a Maestria Final.
            </p>
          </div>

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => void copyPrompt()}
              className="rounded-xl border border-violet-300/30 bg-violet-400/10 px-4 py-2.5 text-[9px] font-black uppercase text-violet-100"
            >
              {copied ? "Copiado" : "📋 Copiar lote Maestria"}
            </button>
            <button
              type="button"
              onClick={() => void downloadPackage()}
              disabled={downloading}
              className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2.5 text-[9px] font-black uppercase text-emerald-100 disabled:opacity-40"
            >
              {downloading ? "Montando..." : "📦 Baixar pacote"}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-2.5 text-[9px] font-black uppercase text-red-100 disabled:opacity-40"
            >
              {saving ? "Salvando..." : "💾 Salvar Maestria"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

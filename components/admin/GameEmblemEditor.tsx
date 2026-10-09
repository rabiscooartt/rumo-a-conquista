"use client";

import { useMemo, useState } from "react";
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

type PackageState = "idle" | "downloading" | "error";

const EMBLEM_REFERENCES = [
  { title: "Crisol: Theater of Idols", slug: "crisol-theater-of-idols" },
  { title: "Hades", slug: "hades" },
  { title: "Hollow Knight", slug: "hollow-knight" },
  { title: "Hogwarts Legacy", slug: "howgarts-legacy" },
  { title: "Metro: Last Light", slug: "metro-last-light" },
  { title: "Monster Hunter World: Iceborne", slug: "monster-hunter-world-iceborne" },
  { title: "MOUSE: P.I. For Hire", slug: "mouse-p-i-for-hire" },
  { title: "Song of Nunu", slug: "song-of-nunu" },
  { title: "The Surge", slug: "the-surge" },
  { title: "Tom Clancy's The Division", slug: "tom-clancy-s-the-division" },
] as const;

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


function buildEmblemTemplate(
  game: SiteGame,
  emblem: GameEmblemInput,
  tagsText: string
) {
  const achievementLines = (game.achievementsList ?? [])
    .filter((item) => readText(item.title).trim())
    .slice(0, 12)
    .map((item, index) => {
      const title = readText(item.title, `Conquista ${index + 1}`);
      const description = readText(item.description).trim();
      return `- ${title}${description ? `: ${description}` : ""}`;
    });
  const tags = tagsText.split(",").map((tag) => tag.trim()).filter(Boolean);
  const rawEmblemTitle = readText(emblem.title).trim();
  const emblemTitle = rawEmblemTitle && rawEmblemTitle.toLowerCase() !== "emblema do jogo"
    ? rawEmblemTitle
    : `Crie um nome original para o Emblema de ${game.title}`;
  const rawDescription = readText(emblem.description).trim();
  const references = EMBLEM_REFERENCES.map(
    (item) => `- ${item.title}: REFERENCIAS-EMBLEMAS/${item.slug}-emblem.png`
  );

  return [
    "RUMO À CONQUISTA — TEMPLATE OFICIAL DE CRIAÇÃO DE EMBLEMA",
    "OBJETIVO: criar um único Emblema original e específico para o jogo indicado. Este template adapta o briefing aos dados atuais do jogo e usa os emblemas existentes do site como referências visuais reais.",
    "",
    "IDENTIFICAÇÃO DO JOGO",
    `Nome: ${game.title}`,
    `Slug: ${game.slug}`,
    `Gênero / identidade: ${readText(game.subtitle, "Não informado; use somente informações que possam ser sustentadas pelas referências e pelo universo do jogo.")}`,
    `Plataforma cadastrada: ${readText(game.platform, "Não informada")}`,
    `Objetivo atual: ${readText(game.currentObjective || game.objective, "Não informado")}`,
    `Maestria Final: ${readText(game.finalBadge?.title, "Não cadastrada")}`,
    `Descrição da Maestria: ${readText(game.finalBadge?.description, "Não cadastrada")}`,
    "",
    "BRIEFING DO EMBLEMA",
    `Título / conceito: ${emblemTitle}`,
    `Descrição fornecida: ${rawDescription || "Ainda não fornecida. Desenvolva uma interpretação visual específica baseada no jogo, sem preencher lacunas com lore inventada."}`,
    `Tags atuais: ${tags.length ? tags.join(", ") : "Não definidas; identifique temas visuais específicos a partir dos dados do jogo."}`,
    `Caminho esperado: /images/games/${game.slug}/emblem.png`,
    "",
    "CONQUISTAS QUE PODEM AJUDAR A IDENTIFICAR TEMAS",
    ...(achievementLines.length ? achievementLines : ["- Ainda não há conquistas suficientes cadastradas. Não invente detalhes narrativos específicos."]),
    "",
    "ETAPA 1 — AUDITORIA VISUAL DAS REFERÊNCIAS ANEXADAS",
    "Abra e examine visualmente TODOS os arquivos PNG da pasta REFERENCIAS-EMBLEMAS incluída neste pacote. Não se baseie apenas nos nomes dos arquivos.",
    "Compare em cada imagem: silhueta externa, geometria da moldura, ornamento superior, laterais, base ou placa inferior, símbolo central, material, pátina, textura, paleta dominante e secundária, iluminação, densidade ornamental e leitura quando reduzida.",
    "Extraia o DNA visual comum da coleção: emblemas com aparência de artefatos colecionáveis premium, símbolo central marcante, materiais trabalhados, sensação de profundidade, acabamento cuidadoso e compatibilidade com a interface escura do Rumo à Conquista.",
    "Ao mesmo tempo, registre o que torna cada moldura individual: contorno, arquitetura, material, distribuição de ornamentos, elemento central e estrutura da base. Não transforme o DNA comum em uma moldura única repetida.",
    "",
    "ÍNDICE DOS EMBLEMAS EXISTENTES A COMPARAR",
    ...references,
    "",
    "ETAPA 2 — PROJETAR UMA MOLDURA PRÓPRIA PARA ESTE JOGO",
    "Depois de analisar o conjunto, escolha uma silhueta e uma combinação de detalhes que evite repetir qualquer moldura existente. Varie de forma deliberada o contorno, o topo, as laterais, a base, o material e a maneira como o símbolo central é emoldurado.",
    "A moldura deve nascer do universo deste jogo: use símbolos, objetos, criaturas, arquitetura, tecnologia, materiais e formas que realmente combinem com sua identidade.",
    "Não copie exatamente a composição, a moldura, a coroa, o halo, as asas, a placa inferior ou o elemento central de nenhum dos emblemas de referência.",
    "A unidade da coleção vem da qualidade de acabamento, da profundidade e do tratamento de artefato premium — não de repetir o mesmo desenho.",
    "Não force a mesma paleta em todos os jogos. Use cores e materiais adequados a este universo; vermelho, bronze, ouro ou tons frios podem aparecer apenas quando fizerem sentido para a identidade do jogo.",
    "",
    "ETAPA 3 — SÍMBOLO CENTRAL E IDENTIDADE",
    `O resultado deve traduzir o conceito “${emblemTitle}” e a descrição específica do jogo em uma imagem, não em palavras.`,
    "O símbolo central precisa ser identificável em tamanho pequeno. A moldura deve reforçar o símbolo, não competir com ele.",
    "O Emblema é uma peça de coleção distinta da Maestria Final; não reutilize o desenho da Maestria, da taça de rank ou de uma conquista existente.",
    "Evite letras aleatórias, texto pequeno, logos, marcas-d'água, interface de jogo, mockups ou fundos de apresentação. Se uma placa fizer sentido como parte física do objeto, mantenha-a ornamental, sem texto ilegível.",
    "",
    "ESPECIFICAÇÕES TÉCNICAS",
    "- Um único Emblema; uma imagem; um arquivo.",
    "- PNG com canvas quadrado de 1024x1024 px.",
    "- A silhueta do próprio Emblema deve ser predominantemente vertical, adequada ao card de Emblema do site.",
    "- Centralizar e preencher cerca de 80–88% da altura do canvas, sem cortar a ponta superior, os laterais ou a base.",
    "- Preferir fundo transparente fora da silhueta, para que o Emblema se integre ao fundo escuro da interface; não criar uma placa quadrada atrás da peça.",
    "- Manter foco forte, contorno limpo, contraste controlado e leitura clara quando exibido pequeno.",
    "- Sem colagem, mosaico, painel, comparativo, múltiplas opções ou várias artes na mesma imagem.",
    "",
    "CHECKLIST DE APROVAÇÃO",
    "1. O Emblema comunica este jogo, e não apenas uma fantasia genérica?",
    "2. A moldura é claramente diferente das dez referências atuais?",
    "3. O acabamento ainda parece pertencer à coleção do Rumo à Conquista?",
    "4. O símbolo principal continua legível em tamanho pequeno?",
    "5. O desenho é diferente da Maestria Final e não copia uma referência?",
    "",
    `ARQUIVO FINAL: ${game.slug}-emblem.png`,
    "RESULTADO: entregar somente a arte final do Emblema deste jogo.",
  ].join("\n");
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
  const [packageState, setPackageState] = useState<PackageState>("idle");
  const [templateFeedback, setTemplateFeedback] = useState("");

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


  const emblemTemplate = useMemo(
    () => buildEmblemTemplate(game, emblem, tagsText),
    [game, emblem, tagsText]
  );

  async function copyTemplate() {
    try {
      await navigator.clipboard.writeText(emblemTemplate);
      setTemplateFeedback("Template copiado. Para que ele compare as molduras de verdade, anexe também o ZIP de referências.");
      setPackageState("idle");
    } catch {
      setTemplateFeedback("A cópia automática não funcionou. Baixe o pacote ZIP, que inclui o template em TXT.");
    }
  }

  async function downloadReferencePackage() {
    setPackageState("downloading");
    setTemplateFeedback("");
    try {
      const response = await fetch("/api/admin/emblem-reference-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: `${game.slug}-template-emblema.zip`,
          gameSlug: game.slug,
          packageText: emblemTemplate,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Não foi possível montar o pacote de referências.");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${game.slug}-template-emblema.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      const count = response.headers.get("X-Emblem-Reference-Count") || "10";
      setTemplateFeedback(`Pacote baixado com ${count} referências visuais e o template adaptado a ${game.title}.`);
      setPackageState("idle");
    } catch (error) {
      setPackageState("error");
      setTemplateFeedback(error instanceof Error ? error.message : "Não foi possível montar o pacote de referências.");
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

            <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-4">
              <button
                type="button"
                onClick={() => void copyTemplate()}
                className="rounded-xl border border-violet-300/30 bg-violet-400/10 px-4 py-3 text-[9px] font-black uppercase tracking-[0.08em] text-violet-100"
              >
                📋 Copiar template do Emblema
              </button>
              <button
                type="button"
                onClick={() => void downloadReferencePackage()}
                disabled={packageState === "downloading"}
                className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-[9px] font-black uppercase tracking-[0.08em] text-emerald-100 disabled:opacity-40"
              >
                {packageState === "downloading" ? "Montando pacote..." : "📦 Baixar template + referências"}
              </button>
            </div>

            {templateFeedback && (
              <p className={packageState === "error" ? "mt-3 text-xs font-bold leading-relaxed text-red-200" : "mt-3 text-xs font-bold leading-relaxed text-emerald-200"} role="status">
                {templateFeedback}
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 border-t border-white/[0.08] pt-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h4 className="text-sm font-black text-white">Emblemas existentes — referências da coleção</h4>
              <p className="mt-1 max-w-[760px] text-xs leading-relaxed text-white/45">
                O template compara silhuetas, molduras, materiais e símbolos. O ZIP contém estas artes reais para que o modelo analise as diferenças antes de criar o próximo Emblema.
              </p>
            </div>
            <span className="text-[9px] font-black uppercase tracking-[0.1em] text-white/35">10 referências</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {EMBLEM_REFERENCES.map((reference) => (
              <div key={reference.slug} className="min-w-0 rounded-xl border border-white/[0.08] bg-black/25 p-2">
                <div className="flex h-28 items-center justify-center overflow-hidden rounded-lg bg-black/40 p-1">
                  <img
                    src={`/images/games/${reference.slug}/emblem.png`}
                    alt={reference.title}
                    className="h-full w-full object-contain"
                    loading="lazy"
                  />
                </div>
                <p className="mt-2 line-clamp-2 min-h-8 text-[10px] font-bold leading-relaxed text-white/60">{reference.title}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

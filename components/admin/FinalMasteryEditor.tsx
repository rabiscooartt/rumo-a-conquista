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

type ZipEntry = { name: string; data: Uint8Array };

function zipU16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function zipU32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

function zipCrc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildReferenceZip(files: ZipEntry[]) {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const checksum = zipCrc32(file.data);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    zipU32(localView, 0, 0x04034b50);
    zipU16(localView, 4, 20);
    zipU16(localView, 6, 0x0800);
    zipU16(localView, 8, 0);
    zipU16(localView, 10, dosTime);
    zipU16(localView, 12, dosDate);
    zipU32(localView, 14, checksum);
    zipU32(localView, 18, file.data.length);
    zipU32(localView, 22, file.data.length);
    zipU16(localView, 26, nameBytes.length);
    zipU16(localView, 28, 0);
    local.set(nameBytes, 30);
    localParts.push(local, file.data);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    zipU32(centralView, 0, 0x02014b50);
    zipU16(centralView, 4, 20);
    zipU16(centralView, 6, 20);
    zipU16(centralView, 8, 0x0800);
    zipU16(centralView, 10, 0);
    zipU16(centralView, 12, dosTime);
    zipU16(centralView, 14, dosDate);
    zipU32(centralView, 16, checksum);
    zipU32(centralView, 20, file.data.length);
    zipU32(centralView, 24, file.data.length);
    zipU16(centralView, 28, nameBytes.length);
    zipU16(centralView, 30, 0);
    zipU16(centralView, 32, 0);
    zipU16(centralView, 34, 0);
    zipU16(centralView, 36, 0);
    zipU32(centralView, 38, 0);
    zipU32(centralView, 42, offset);
    central.set(nameBytes, 46);
    centralParts.push(central);
    offset += local.length + file.data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  zipU32(endView, 0, 0x06054b50);
  zipU16(endView, 4, 0);
  zipU16(endView, 6, 0);
  zipU16(endView, 8, files.length);
  zipU16(endView, 10, files.length);
  zipU32(endView, 12, centralSize);
  zipU32(endView, 16, offset);
  zipU16(endView, 20, 0);

  const zip = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const part of localParts) {
    zip.set(part, cursor);
    cursor += part.length;
  }
  for (const part of centralParts) {
    zip.set(part, cursor);
    cursor += part.length;
  }
  zip.set(end, cursor);
  return zip;
}

async function optimizeReferenceImage(source: Blob) {
  const bitmap = await createImageBitmap(source);
  const size = 768;
  const scale = Math.min(size / bitmap.width, size / bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Não foi possível preparar uma imagem de referência.");
  }

  context.fillStyle = "#181818";
  context.fillRect(0, 0, size, size);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, Math.round((size - width) / 2), Math.round((size - height) / 2), width, height);
  bitmap.close();

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Não foi possível otimizar uma imagem de referência.")),
      "image/jpeg",
      0.76
    );
  });
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

function buildVisualCohesionPrompt(game: SiteGame): string[] {
  const generalRules = [
    "",
    "FLUXO DE ORIGINALIDADE VALIDADO NO PREPARADOR DE CONQUISTAS — APLICAR TAMBÉM À MAESTRIA:",
    "FASE 1 — CONCEITO ORIGINAL: resolva primeiro o significado do título e da descrição como um símbolo novo, independente e simples. Não comece tentando reproduzir personagem oficial, arte promocional, logo, ícone proprietário ou ilustração existente.",
    "FASE 2 — COERÊNCIA DA COLEÇÃO: só depois aplique os atributos visuais amplos observados nas conquistas que NÓS CRIAMOS para este jogo: paleta, contraste, técnica, contornos, textura, acabamento, proporção entre símbolo e fundo e organização geral do ícone. Isso mantém a mesma estrutura da série sem copiar a figura central específica de outra arte.",
    "As conquistas criadas para o Rumo à Conquista são a referência prioritária da estrutura da coleção. Analise a organização do ícone, a ocupação do canvas, o fundo, o contorno discreto, a escala e centralização do símbolo e a densidade de detalhes. Não substitua essa coleção por imagens promocionais ou referências genéricas do jogo.",
    "A Maestria precisa parecer MAIS UMA IMAGEM DA MESMA SÉRIE que nós criamos — não um cartaz, pôster, brasão luxuoso, medalha, troféu ou arte de outro sistema. Mude o símbolo para representar a Maestria; preserve a arquitetura visual dos ícones da coleção.",
    "Não invente uma moldura nova, brasão, escudo, estrela, coroa, louros, medalha, troféu ou cenário elaborado quando esses recursos não fazem parte da estrutura recorrente das conquistas criadas.",
    "O título e a descrição determinam O QUE o ícone comunica; as conquistas próprias determinam COMO a imagem se organiza visualmente. A semelhança estrutural deve vir do formato e da gramática geral do ícone, não da cópia de um personagem, pose ou desenho específico.",
    "Não introduzir automaticamente vermelho, dourado, bronze, metal, efeitos 3D, fotorrealismo, iluminação cinematográfica ou cores que não existam nas conquistas do jogo.",
    "As referências próprias podem orientar a análise da linguagem visual e da estrutura geral. Não copie o símbolo central individual de uma conquista; não use artes promocionais/terceiras como entrada direta do gerador; não reproduza personagem reconhecível, rosto, roupa característica, pose, objeto distintivo, logo, texto ou composição específica de uma obra protegida.",
    "Se as imagens das conquistas que nós criamos NÃO estiverem anexadas ou acessíveis, não afirme que as analisou. Peça as referências ou use apenas características já documentadas, sem fingir que verificou as imagens.",
  ];

  if (game.slug === "mouse-p-i-for-hire") {
    return [
      ...generalRules,
      "",
      "DNA VISUAL ESPECÍFICO — MOUSE - P.I. FOR HIRE:",
      "ESTRUTURA OBSERVADA NAS CONQUISTAS QUE NÓS CRIAMOS PARA MOUSE: ícone quadrado; campo de fundo cinza-carvão escuro; contorno/margem interna discreta em tons de cinza quando presente; um único símbolo ou personagem central grande, isolado e legível; poucos elementos secundários; contraste de preto, cinza e branco; desenho 2D de quadrinhos com silhuetas fortes e textura impressa/granulada. Mantenha essa arquitetura de ícone, não a estrutura de um brasão separado.",
      "A Maestria deve usar a mesma organização visual: fundo escuro quadrado ocupando o canvas, discreto contorno integrado se ele fizer parte da referência, símbolo central ocupando aproximadamente 60–75% da área útil e elementos secundários mínimos. Não transformar a imagem em uma placa ou moldura externa nova.",
      "Preserve estritamente preto, carvão, cinza, cinza-claro e branco; traço de quadrinhos cartunesco, sombras gráficas e textura impressa conforme as conquistas criadas. Não acrescente cores cromáticas.",
      "Não desenhe uma versão reconhecível de personagem oficial do jogo, nem reproduza seu rosto, roupa, pose ou silhueta distintiva. Para o título genérico 'Emblema' e sem descrição, use um símbolo investigativo original e simples — por exemplo, uma pista gráfica, lente de aumento ou marca de pata abstrata — sem compor um brasão, distintivo de xerife ou retrato de personagem.",
      "Não invente estrela, escudo, medalha, moldura de louros, coroa, cenário detalhado ou acabamento metálico luxuoso. Não transformar a imagem em pôster, arte promocional, renderização 3D realista ou pintura cinematográfica.",
      "O resultado deve parecer um ícone adicional da mesma coleção que fizemos para MOUSE: mesma arquitetura quadrada, mesmo peso visual, mesma escala de símbolo e mesmo tratamento monocromático; o conceito central é original e não imita uma personagem ou ilustração específica.",
    ];
  }

  return [
    ...generalRules,
    "",
    "ADAPTAÇÃO PARA ESTE JOGO:",
    "Siga o DNA visual específico já estabelecido pelas conquistas normais deste jogo. Não reutilize automaticamente uma paleta, uma moldura, um material ou uma fórmula artística de outro jogo.",
  ];
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
    "REFERÊNCIAS VISUAIS INCLUÍDAS NO ZIP:",
    "O ZIP baixado pelo botão Baixar pacote contém a pasta REFERENCIAS-CONQUISTAS com as imagens de conquistas encontradas para este jogo no site/repositório e nos registros ativos do catálogo. Abra e examine visualmente TODAS as imagens dessa pasta antes de elaborar a Maestria; não se limite aos nomes dos arquivos.",
    "Use as artes do projeto para identificar a gramática visual real da coleção: arquitetura quadrada do ícone, fundo, bordas, escala e centralização do símbolo, densidade de elementos, contornos, contraste, paleta e textura. Depois crie um conceito original que pertença à mesma coleção, sem copiar exatamente o símbolo de uma conquista individual.",
    "As referências são reduzidas para JPEG de 768 × 768 px apenas para deixar o ZIP leve e facilitar a análise; os arquivos originais das conquistas no site não são alterados.",
    "",
    "REGRA ESPECÍFICA DA MAESTRIA FINAL:",
    "Somente nesta arte, o NOME e a DESCRIÇÃO da Maestria são o briefing principal da criação.",
    "A arte deve ser visualmente próxima do significado comunicado pelo título e pela descrição, transformando as palavras em símbolos, objetos, ações, formas, composição, atmosfera e elementos visuais que representem claramente a ideia da Maestria.",
    "Não criar uma arte genérica de troféu só porque ela é a recompensa final.",
    "Não ignorar palavras ou conceitos importantes do título e da descrição.",
    "A arte deve seguir o fluxo usado com sucesso nas conquistas: criar primeiro um conceito original a partir do significado; aplicar depois somente a linguagem gráfica geral da coleção. Não comece reproduzindo a ilustração de uma personagem oficial.",
    "REFERÊNCIAS VISUAIS: quando as imagens das conquistas que nós criamos estiverem anexadas, analise-as primeiro e extraia um brief textual da estrutura comum (formato, fundo, contorno, escala do símbolo, contraste, traço e textura). Use o brief textual como ajuste visual; não envie uma referência protegida diretamente ao gerador nem copie personagens, desenhos reconhecíveis ou composições específicas.",
    ...buildVisualCohesionPrompt(game),
    "",
    "RANK:",
    "MAESTRIA",
    "",
    "TÍTULO DA MAESTRIA:",
    mastery.title || "Maestria Final",
    "",
    "DESCRIÇÃO DA MAESTRIA:",
    mastery.description || "Sem descrição disponível. Criar a direção visual a partir do título e do universo do jogo.",
    "",
    "DIREÇÃO CRIATIVA — FLUXO EM DUAS FASES:",
    "1. CONSTRUA A BASE ORIGINAL: extraia do título e da descrição o conceito a comunicar e escolha um símbolo novo, simples e imediatamente compreensível. Se a descrição estiver ausente, não invente uma cena complexa.",
    "2. APLIQUE O AJUSTE VISUAL: use apenas os atributos gerais da estrutura das conquistas que criamos — proporções do ícone, fundo, contorno discreto, escala do símbolo, paleta, linha e textura. Não copie um desenho específico.",
    "3. MANTENHA UM FOCO CENTRAL dominante e poucos elementos secundários. A importância da Maestria vem da clareza do símbolo e da execução, não de novas molduras, mais ornamentos ou um cenário maior.",
    "4. Use apenas temas gerais do universo do jogo. Não reproduza a aparência específica de personagem oficial, logo, ilustração promocional ou outro design reconhecível.",
    "5. PLANO DE RECUPERAÇÃO SE HOUVER BLOQUEIO: não repita a mesma figura com pequenas alterações. Simplifique a imagem, substitua personagens/elementos específicos por um símbolo original mais abstrato e mantenha somente a atmosfera geral, a paleta e a estrutura visual do ícone. Não tente disfarçar uma cópia; mude de fato o conceito para uma alternativa independente.",
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
    "Não reproduzir nem tentar contornar bloqueios com alterações superficiais. Se uma opção resultar em semelhança excessiva com personagem ou obra de terceiros, substitua o foco por um símbolo realmente original, simples e abstrato, mantendo apenas as características gerais da coleção.",
    "Nunca copiar personagem reconhecível, rosto, figurino, pose, silhueta distintiva, logo, texto ou composição específica de terceiros. A arte final deve ser independente.",
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
  const [sectionCollapsed, setSectionCollapsed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState("");
  const [imageError, setImageError] = useState(false);

  function update(field: keyof FinalMastery, value: string) {
    setMastery((current) => ({ ...current, [field]: value }));
  }

  async function save() {
    setSaving(true);
    setSaveState("idle");

    try {
      const ok = await onSave({
        title: mastery.title.trim() || "Maestria Final",
        icon: mastery.icon.trim() || "💎",
        image: mastery.image.trim() || masteryImagePath(game.slug),
        description: mastery.description.trim(),
      });

      setSaveState(ok ? "saved" : "error");

      if (ok) {
        window.setTimeout(() => setSaveState("idle"), 2500);
      }
    } catch {
      setSaveState("error");
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
    setDownloadProgress("Buscando as conquistas do jogo...");

    try {
      const packageText = buildMasteryPrompt(game, mastery);
      const manifestResponse = await fetch(
        `/api/admin/final-mastery-references?gameSlug=${encodeURIComponent(game.slug)}`,
        { cache: "no-store" }
      );
      const manifest = await manifestResponse.json();

      if (!manifestResponse.ok) {
        throw new Error(manifest?.error || "Não foi possível buscar as referências deste jogo.");
      }

      const references = Array.isArray(manifest.references) ? manifest.references as {
        title: string;
        filename: string;
        sourceUrl: string;
      }[] : [];

      if (references.length === 0) {
        throw new Error(
          "Não encontrei imagens de conquistas para este jogo. Verifique se as artes estão salvas no catálogo ou na pasta public/images/games/" +
            game.slug +
            "/achievements."
        );
      }

      const encoder = new TextEncoder();
      const files: ZipEntry[] = [
        { name: "Lote-Maestria-Final.txt", data: encoder.encode(packageText) },
      ];
      const indexLines = [
        "REFERÊNCIAS VISUAIS — MAESTRIA FINAL",
        `Jogo: ${game.title}`,
        `Total de conquistas incluídas: ${references.length}`,
        "As imagens foram convertidas para JPEG de 768 × 768 px com qualidade otimizada para manter o pacote leve. Os arquivos originais do site não foram modificados.",
        "",
        "ARQUIVOS INCLUÍDOS:",
      ];

      for (let i = 0; i < references.length; i += 1) {
        const reference = references[i];
        setDownloadProgress(`Preparando referência ${i + 1}/${references.length}...`);

        const imageResponse = await fetch(
          `/api/admin/final-mastery-references?gameSlug=${encodeURIComponent(game.slug)}&source=${encodeURIComponent(reference.sourceUrl)}`,
          { cache: "no-store" }
        );

        if (!imageResponse.ok) {
          let message = `Não consegui carregar a imagem "${reference.title}".`;
          try {
            const payload = await imageResponse.json();
            if (payload?.error) message = payload.error;
          } catch {
            // Mantém a mensagem padrão com o nome da referência.
          }
          throw new Error(message + " O pacote não foi baixado para evitar omitir referências.");
        }

        const original = await imageResponse.blob();
        const optimized = await optimizeReferenceImage(original);
        const outputName = reference.filename.replace(/\.(png|jpe?g|webp)$/i, ".jpg");
        files.push({
          name: `REFERENCIAS-CONQUISTAS/${outputName}`,
          data: new Uint8Array(await optimized.arrayBuffer()),
        });
        indexLines.push(`- ${reference.title}: ${outputName}`);
      }

      files.push({
        name: "REFERENCIAS-CONQUISTAS/INDICE.txt",
        data: encoder.encode(indexLines.join("\n")),
      });

      setDownloadProgress(`Montando ZIP com ${references.length} referências...`);
      const zipBytes = buildReferenceZip(files);
      const zipBlob = new Blob([zipBytes.buffer as ArrayBuffer], { type: "application/zip" });

      if (zipBlob.size === 0) {
        throw new Error("O pacote da Maestria Final veio vazio.");
      }

      const url = URL.createObjectURL(zipBlob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `Lote-Maestria-Final-${game.slug}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      setDownloadProgress(`ZIP pronto: ${references.length} referências incluídas.`);
      window.setTimeout(() => setDownloadProgress(""), 4000);
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "Não foi possível baixar o pacote da Maestria Final."
      );
      setDownloadProgress("");
    } finally {
      setDownloading(false);
    }
  }

  const imageSrc = mastery.image.trim() || masteryImagePath(game.slug);

  return (
    <section className="rounded-[20px] border border-violet-400/20 bg-violet-500/[0.035] p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => setSectionCollapsed((value) => !value)}
            aria-expanded={!sectionCollapsed}
            className="group inline-flex items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-violet-300/50"
          >
            <span className="flex flex-col">
              <span className="text-[9px] font-black uppercase tracking-[0.18em] text-violet-300">04 • Maestria Final</span>
              <span className="mt-1 text-xl font-black text-white transition-colors group-hover:text-violet-100">Maestria Final</span>
            </span>
            <span aria-hidden="true" className="mt-3 text-lg font-black text-white/45 transition-colors group-hover:text-violet-200">
              {sectionCollapsed ? "+" : "−"}
            </span>
          </button>
          {!sectionCollapsed && (
            <p className="mt-1 max-w-[820px] text-xs leading-relaxed text-white/40">
              Aqui fica a recompensa final do jogo. A Maestria Final é separada das conquistas Bronze, Prata e Ouro; título, descrição e arte são definidos aqui.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-xl border border-violet-300/35 bg-violet-400/[0.10] px-3 py-2 text-[9px] font-black uppercase tracking-[0.12em] text-violet-100">
              Rank: Maestria
            </span>
            <span className="rounded-xl border border-violet-300/20 bg-violet-300/[0.06] px-3 py-2 text-[9px] font-black uppercase tracking-[0.12em] text-violet-100">
              1 Maestria = 1 arte
            </span>
          </div>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className={saveState === "saved"
              ? "rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-2.5 text-[9px] font-black uppercase tracking-[0.08em] text-emerald-100"
              : saveState === "error"
                ? "rounded-xl border border-red-400/40 bg-red-500/15 px-4 py-2.5 text-[9px] font-black uppercase tracking-[0.08em] text-red-100"
                : "rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-2.5 text-[9px] font-black uppercase tracking-[0.08em] text-red-100 hover:bg-red-500/20 disabled:opacity-40"}
          >
            {saving
              ? "Salvando..."
              : saveState === "saved"
                ? "✓ Maestria salva"
                : saveState === "error"
                  ? "⚠ Não salva"
                  : "💾 Salvar Maestria"}
          </button>
        </div>
      </div>

      {!sectionCollapsed && (
        <>
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
              O botão <strong className="text-white/70">Baixar pacote</strong> inclui o prompt e as imagens das conquistas encontradas para este jogo, otimizadas para análise. Use todas as referências para manter a mesma estrutura visual da coleção.
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            {saveState === "saved" && (
              <span className="text-[9px] font-black uppercase tracking-[0.12em] text-emerald-200">
                Maestria salva com sucesso.
              </span>
            )}
            {saveState === "error" && (
              <span className="text-[9px] font-black uppercase tracking-[0.12em] text-red-200">
                Não foi possível salvar.
              </span>
            )}
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
              {downloading ? (downloadProgress || "Preparando...") : "📦 Baixar pacote"}
            </button>
          </div>
        </div>
      </div>
        </>
      )}
    </section>
  );
}

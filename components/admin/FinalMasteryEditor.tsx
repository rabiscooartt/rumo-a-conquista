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
      "Não desenhe uma versão reconhecível de personagem oficial do jogo, nem reproduza seu rosto, roupa, pose ou silhueta distintiva. Escolha o símbolo da Maestria exclusivamente a partir do título e da descrição aprovados; um símbolo investigativo abstrato só deve ser usado se o briefing realmente indicar esse tema. Não componha um brasão, distintivo de xerife ou retrato de personagem sem que isso seja sustentado pelas referências e pelo briefing.",
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

function buildMasteryAnalysisPrompt(game: SiteGame, mastery: FinalMastery) {
  return [
    "RUMO À CONQUISTA — PROMPT 01 — ANÁLISE E PROJETO DA MAESTRIA FINAL",
    "",
    "PAPEL",
    "Você é diretor de arte da Maestria Final do projeto Rumo à Conquista. Trabalhe exclusivamente na MAESTRIA FINAL deste jogo, não no Emblema e não nas conquistas Bronze, Prata ou Ouro.",
    "",
    "OBJETIVO DESTA ETAPA",
    "Analise as referências anexadas, desenvolva um conceito individual para a Maestria Final e entregue um briefing completo para o Prompt 02. NÃO gere, desenhe, edite ou simule a imagem nesta etapa. Aguarde minha aprovação do briefing.",
    "",
    "DADOS DO JOGO",
    "Jogo: " + game.title,
    "Slug real do projeto: " + game.slug,
    "Título atualmente cadastrado (pode ser aprimorado após análise): " + (mastery.title.trim() || "Ainda não definido; propor um título exclusivo."),
    "Descrição atualmente cadastrada (pode ser aprimorada após análise): " + (mastery.description.trim() || "Ainda não definida; criar uma frase exclusiva de até 140 caracteres."),
    "Caminho esperado da imagem no projeto: public/images/games/" + game.slug + "/achievements/maestria-final.png",
    "",
    "AUDITORIA VISUAL OBRIGATÓRIA DO ZIP",
    "O ZIP anexado contém a pasta REFERENCIAS-CONQUISTAS. Examine visualmente todas as imagens dessa pasta antes de definir o conceito. Não se limite aos nomes dos arquivos.",
    "Derive a linguagem visual das conquistas normais que foram criadas para ESTE jogo: estilo de ilustração, paleta, contraste, contorno, textura, fundo, escala e centralização do símbolo, densidade visual e acabamento.",
    "A Maestria Final precisa parecer a evolução máxima da mesma coleção, mas não pode simplesmente copiar o símbolo central de uma conquista existente.",
    "Não use Mouse P.I. For Hire, outro jogo, artes promocionais ou uma fórmula genérica como referência universal. Cada jogo mantém sua própria identidade visual.",
    "Não introduza automaticamente vermelho, dourado, metal, 3D, troféu, moldura ornamentada, coroa ou efeitos cinematográficos se as imagens reais do jogo não justificarem esses elementos.",
    "Se o ZIP não estiver anexado, vazio ou ilegível, pare e peça o pacote. Não diga que analisou imagens que não conseguiu visualizar.",
    "",
    "TÍTULO EXCLUSIVO",
    "Crie ou refine um nome memorável e específico para este jogo. Deve representar a conclusão de todas as conquistas e ter relação clara com seu universo e sua jornada. Evite títulos genéricos e fórmulas repetidas automaticamente entre jogos.",
    "",
    "DESCRIÇÃO EXCLUSIVA",
    "Escreva uma única frase exclusiva para este jogo, com aproximadamente 70 caracteres (preferencialmente entre 60 e 80, incluindo espaços e pontuação). O limite absoluto é 140 caracteres. Deve definir o significado da Maestria Final, não ser apenas uma chamada genérica e não inventar fatos do jogo. Se passar de 80 caracteres, tente encurtar sem perder o significado; não force exatamente 70 se isso deixar a frase pior. Conte os caracteres antes de entregar. Esta descrição será cadastrada no Admin e NÃO deverá aparecer escrita na imagem.",
    "",
    "CONCEITO VISUAL",
    "Defina o símbolo principal, por que representa a conclusão da jornada, composição, fundo, paleta, traço, textura, iluminação e como a qualidade/complexidade aumenta em relação às conquistas normais sem criar uma linguagem visual incompatível.",
    "A imagem final deverá ser quadrada 1:1, 1024 × 1024, uma única imagem, sem texto, letras, números, logos, colagens ou múltiplas versões.",
    "",
    "FORMATO OBRIGATÓRIO DA RESPOSTA",
    "1. Resultado da análise das referências do jogo.",
    "2. Nome proposto da Maestria Final.",
    "3. Descrição de uma frase, preferencialmente entre 60 e 80 caracteres (alvo aproximado de 70), com contagem explícita; nunca ultrapassar 140.",
    "4. Conceito visual e justificativa.",
    "5. BRIEFING FINAL PARA O PROMPT 02, em bloco claramente delimitado e copiável, contendo jogo, slug, título aprovado/proposto, descrição exata, símbolo, composição, paleta, estilo das referências e restrições.",
    "",
    "Não gere a imagem agora. Termine pedindo minha aprovação ou correções ao nome, à descrição e ao conceito. Só depois da aprovação deve ser usado o Prompt 02."
  ].join("\n");
}

function buildMasteryUsageInstructions(game: SiteGame) {
  return [
    "RUMO À CONQUISTA — INSTRUÇÕES DE USO — MAESTRIA FINAL (CAIXA 04)",
    "",
    "Este fluxo pertence exclusivamente à MAESTRIA FINAL — identificada pelo troféu vermelho na hierarquia do site. Essa cor identifica a categoria do rank; não obriga a desenhar um troféu literal vermelho. A arte deve seguir as referências das conquistas deste jogo. Não é o fluxo de criação do Emblema.",
    "",
    "JOGO: " + game.title,
    "SLUG: " + game.slug,
    "",
    "SIGA ESTA ORDEM NA MESMA CONVERSA:",
    "1. Baixe o pacote ZIP pelo botão 1 do Admin e anexe esse ZIP à conversa nova. Ele contém os prompts e as imagens de referência das conquistas deste jogo.",
    "2. Cole o PROMPT 01 — Análise e projeto. Ele deve analisar todas as referências, propor o nome, escrever uma descrição de uma frase com cerca de 70 caracteres (preferencialmente entre 60 e 80; máximo absoluto de 140) e preparar o briefing. Não deve gerar imagem.",
    "3. Leia o briefing e aprove o nome, a descrição e o conceito ou peça ajustes. Depois cole estas Instruções de Uso na mesma conversa para reforçar a ordem e a precedência do briefing aprovado.",
    "4. Cole o PROMPT 02 — Gerar Maestria Final. Ele deve gerar a imagem individual e entregar novamente o título, a descrição com contagem, o nome do arquivo, o caminho e os comandos PowerShell completos para publicar somente a imagem.",
    "",
    "REGRAS DE CONTINUIDADE",
    "O briefing aprovado do Prompt 01 e eventuais correções explícitas do usuário têm precedência sobre informações preliminares que estiverem preenchidas no Admin ou no Prompt 02.",
    "Não gerar imagem antes do Prompt 02. Não inventar nome, descrição, lore ou referência visual. A descrição final deve ser exclusiva e ter cerca de 70 caracteres, preferencialmente entre 60 e 80, sem ultrapassar 140 caracteres.",
    "A imagem e os campos textuais são operações separadas: o arquivo vai para o caminho de imagem no repositório; título e descrição devem ser inseridos e salvos nos campos da Maestria Final no Admin.",
    "Nunca use o comando git add . nem git push --force e não prepare outros arquivos no commit. Envie a alteração somente para main e verifique a implantação de Production; nunca afirme que a publicação foi concluída sem confirmação.",
    "Se o briefing aprovado não estiver visível no contexto quando o Prompt 02 for usado, peça que o usuário cole o briefing aprovado antes de prosseguir."
  ].join("\n");
}

function buildMasteryPrompt(game: SiteGame, mastery: FinalMastery) {
  const imagePath = "public/images/games/" + game.slug + "/achievements/maestria-final.png";
  const webImagePath = "/images/games/" + game.slug + "/achievements/maestria-final.png";
  const exportName = game.slug + "-maestria-final.png";
  const branchPrefix = "publicar-maestria-" + game.slug + "-";

  return [
    "RUMO À CONQUISTA — PROMPT 02 — GERAÇÃO DA MAESTRIA FINAL",
    "",
    "EXECUTE A ARTE AGORA somente se o BRIEFING FINAL PARA O PROMPT 02 do Prompt 01 estiver presente nesta conversa e tiver sido aprovado pelo usuário. Se o briefing aprovado estiver ausente, peça que o usuário o cole; não invente os dados nem gere a imagem prematuramente.",
    "Este é o fluxo da MAESTRIA FINAL — a categoria identificada pelo troféu vermelho entre as conquistas Ouro e o Emblema. Esse indicador vermelho pertence à hierarquia do site; não obriga a colocar um troféu vermelho literal na arte. A imagem segue a identidade visual das conquistas deste jogo. NÃO crie um Emblema e não use os prompts de Emblema.",
    "",
    "DADOS DO JOGO — REFERÊNCIA INICIAL; O BRIEFING APROVADO TEM PRECEDÊNCIA",
    "Jogo: " + game.title,
    "Slug do projeto: " + game.slug,
    "Título atualmente cadastrado: " + (mastery.title.trim() || "Usar o título do briefing aprovado."),
    "Descrição atualmente cadastrada: " + (mastery.description.trim() || "Usar a descrição do briefing aprovado."),
    "Nome do arquivo exportado: " + exportName,
    "Caminho obrigatório dentro do projeto: " + imagePath,
    "Caminho público usado no Admin: " + webImagePath,
    "",
    "PACOTE DE REFERÊNCIAS",
    "Se houver um ZIP anexado, examine todas as imagens da pasta REFERENCIAS-CONQUISTAS. Elas representam as conquistas normais criadas para este mesmo jogo. Use-as como referência visual prioritária para a arquitetura do ícone, estilo, paleta, contornos, textura, fundo, escala do símbolo e legibilidade.",
    "Não confunda a Maestria Final com o Emblema do jogo. Não use uma placa de título, placa de plataforma ou moldura própria dos emblemas.",
    "O briefing aprovado define o conceito e os elementos visuais da Maestria; as referências das conquistas definem a linguagem gráfica do ícone. Nenhum outro jogo deve servir como modelo visual universal.",
    "",
    "INSTRUÇÃO DE GERAÇÃO",
    "Gere uma única imagem individual da Maestria Final usando o gerador de imagens, não apenas uma descrição escrita.",
    "Siga o símbolo, a composição, a paleta e as restrições do briefing aprovado. O título e a descrição determinam o significado; as referências próprias deste jogo determinam o estilo. Não copie literalmente uma conquista existente nem reproduza personagem, logo ou composição distintiva de terceiros.",
    "A Maestria deverá parecer a recompensa máxima da coleção por meio de conceito forte, silhueta, execução e acabamento. Não acrescente automaticamente troféu literal, vermelho, dourado, metal, moldura, coroa, medalha, 3D ou ornamentos quando não combinarem com as referências.",
    "",
    "ESPECIFICAÇÕES OBRIGATÓRIAS",
    "• Uma única imagem, sem colagem ou múltiplas versões.",
    "• Formato quadrado 1:1, resolução 1024 × 1024, PNG.",
    "• Imagem edge-to-edge, seguindo o fundo e a arquitetura dos ícones das conquistas do jogo.",
    "• Símbolo central forte, composição legível em tamanho pequeno e detalhes controlados.",
    "• Sem palavras, letras, números, título, descrição, logotipos ou interface dentro da imagem.",
    "",
    "ENTREGA OBRIGATÓRIA NA RESPOSTA",
    "Depois de gerar a imagem, apresentar:",
    "1. TÍTULO DA MAESTRIA FINAL: usar o nome do briefing aprovado.",
    "2. DESCRIÇÃO PARA O SITE: reproduzir exatamente a frase aprovada no briefing e informar a contagem incluindo espaços e pontuação. O Prompt 01 deve buscar cerca de 70 caracteres (preferencialmente entre 60 e 80); o limite absoluto é 140. Não reescrever uma frase já aprovada só para atingir 70. Se ultrapassar 140, encurtar preservando o sentido e informar a versão final.",
    "3. ARQUIVO GERADO: " + exportName,
    "4. CAMINHO DO ARQUIVO: " + imagePath,
    "5. CAMPOS PARA CADASTRAR NO ADMIN: título, descrição e caminho público " + webImagePath,
    "6. COMANDOS POWERSHELL COMPLETOS, preenchidos com os caminhos e o jogo atuais, para substituir somente a imagem da Maestria Final no GitHub.",
    "",
    "COMANDOS QUE DEVEM SER ENTREGUES EM BLOCOS POWERSHELL COPIÁVEIS",
    "Etapa A — Atualize a referência local:",
    "git fetch origin",
    "git switch -c " + branchPrefix + "$(Get-Date -Format 'yyyyMMdd-HHmmss') origin/main",
    "",
    "Etapa B — Copie manualmente o PNG gerado para o arquivo exato:",
    imagePath,
    "",
    "Etapa C — Confira se somente essa imagem foi alterada:",
    "git status --short",
    "git diff --name-only",
    "",
    "Etapa D — Prepare exclusivamente a imagem e confira o que será enviado:",
    "git add -- " + imagePath,
    "git diff --cached --name-only",
    "",
    "Etapa E — Crie o commit e envie para main:",
    "git commit -m \"Atualiza maestria final de " + game.title + "\"",
    "git push origin HEAD:main",
    "",
    "REGRAS DE SEGURANÇA E PUBLICAÇÃO",
    "Antes do commit, confira que git diff --name-only e git diff --cached --name-only mostram somente " + imagePath + ". Se houver outras alterações, pare e não as inclua.",
    "Nunca use o comando git add . nem git push --force. Se o push for rejeitado, pare e analise a causa antes de tentar novamente.",
    "Após o push, verifique o deployment do Vercel para o commit enviado e confirme Production = Ready antes de afirmar que a publicação foi concluída. Os comandos não salvam automaticamente título ou descrição no Admin.",
    "O arquivo de imagem deve ser copiado manualmente para o repositório antes dos comandos de git add/commit. Não diga que o arquivo já está no repositório nem que o deploy foi concluído sem evidência.",
    "",
    "RESULTADO FINAL: imagem individual da MAESTRIA FINAL + título exclusivo + descrição curta, idealmente com cerca de 70 caracteres (preferencialmente 60–80; máximo 140) + nome/caminho do arquivo + comandos PowerShell completos e específicos. Não omitir nenhum desses itens."
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
  const [copiedAction, setCopiedAction] = useState<"analysis" | "instructions" | "generation" | null>(null);
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

  async function copyText(action: "analysis" | "instructions" | "generation", content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedAction(action);
      window.setTimeout(() => setCopiedAction(null), 2200);
    } catch {
      window.alert("Não foi possível copiar o texto. Verifique a permissão de área de transferência do navegador.");
    }
  }

  async function copyAnalysisPrompt() {
    await copyText("analysis", buildMasteryAnalysisPrompt(game, mastery));
  }

  async function copyUsageInstructions() {
    await copyText("instructions", buildMasteryUsageInstructions(game));
  }

  async function copyPrompt() {
    await copyText("generation", buildMasteryPrompt(game, mastery));
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
      const analysisPrompt = buildMasteryAnalysisPrompt(game, mastery);
      const usageInstructions = buildMasteryUsageInstructions(game);
      const generationPrompt = buildMasteryPrompt(game, mastery);
      const files: ZipEntry[] = [
        { name: "PROMPT-01-ANALISE-E-PROJETO-MAESTRIA.txt", data: encoder.encode(analysisPrompt) },
        { name: "INSTRUCOES-DE-USO-MAESTRIA.txt", data: encoder.encode(usageInstructions) },
        { name: "PROMPT-02-GERAR-MAESTRIA-FINAL.txt", data: encoder.encode(generationPrompt) },
      ];
      const indexLines = [
        "REFERÊNCIAS VISUAIS — MAESTRIA FINAL",
        `Jogo: ${game.title}`,
        `Total de conquistas incluídas: ${references.length}`,
        "As imagens foram convertidas para JPEG de 768 × 768 px com qualidade otimizada para manter o pacote leve. Os arquivos originais do site não foram modificados.",
        "",
        "ARQUIVOS INCLUÍDOS:",
      ];
      indexLines.unshift(
        "PACOTE DE MAESTRIA FINAL — " + game.title,
        "Ordem: 1) anexar o ZIP; 2) colar Prompt 01 e aprovar o briefing; 3) colar as instruções; 4) colar Prompt 02 para gerar a imagem.",
        "Este fluxo pertence somente à Maestria Final. Não confundir com o fluxo de Emblema.",
        "",
        "ARQUIVOS DE INSTRUÇÃO:",
        "- PROMPT-01-ANALISE-E-PROJETO-MAESTRIA.txt",
        "- INSTRUCOES-DE-USO-MAESTRIA.txt",
        "- PROMPT-02-GERAR-MAESTRIA-FINAL.txt",
        ""
      );


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
              placeholder="Descrição exclusiva e curta, idealmente com cerca de 70 caracteres."
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

          <div className="mt-4 rounded-xl border border-violet-300/15 bg-black/20 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-100">
              Fluxo oficial — Maestria Final em 4 etapas
            </p>
            <p className="mt-1 text-xs leading-relaxed text-white/45">
              Use estes passos em uma conversa nova. O pacote inclui as referências deste jogo e os três textos de apoio. A Maestria é separada do Emblema.
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.04] p-3">
                <p className="text-xs font-black text-emerald-100">1. 📦 Baixar pacote de referências</p>
                <p className="mt-1 text-[11px] leading-relaxed text-white/45">
                  Baixe o ZIP e anexe-o à conversa nova. Ele contém as referências das conquistas, o Prompt 01, as instruções e o Prompt 02.
                </p>
                <button
                  type="button"
                  onClick={() => void downloadPackage()}
                  disabled={downloading}
                  className="mt-3 w-full rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.08em] text-emerald-100 disabled:opacity-40"
                >
                  {downloading ? "Preparando pacote..." : "1. Baixar pacote ZIP"}
                </button>
              </div>

              <div className="rounded-xl border border-violet-300/20 bg-violet-500/[0.04] p-3">
                <p className="text-xs font-black text-violet-100">2. 📋 Analisar e projetar</p>
                <p className="mt-1 text-[11px] leading-relaxed text-white/45">
                  Analisa as imagens deste jogo e prepara nome, descrição idealmente com cerca de 70 caracteres (preferencialmente 60–80; máximo 140) e conceito. Não gera imagem.
                </p>
                <button
                  type="button"
                  onClick={() => void copyAnalysisPrompt()}
                  className="mt-3 w-full rounded-xl border border-violet-300/30 bg-violet-400/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.04em] text-violet-100"
                >
                  {copiedAction === "analysis" ? "✓ Prompt 01 copiado" : "2. Copiar Prompt 01 — Análise"}
                </button>
              </div>

              <div className="rounded-xl border border-sky-400/20 bg-sky-500/[0.04] p-3">
                <p className="text-xs font-black text-sky-100">3. 📘 Instruções de uso</p>
                <p className="mt-1 text-[11px] leading-relaxed text-white/45">
                  Reforça a ordem, a aprovação do briefing e a separação entre Maestria Final e Emblema.
                </p>
                <button
                  type="button"
                  onClick={() => void copyUsageInstructions()}
                  className="mt-3 w-full rounded-xl border border-sky-400/30 bg-sky-500/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.04em] text-sky-100"
                >
                  {copiedAction === "instructions" ? "✓ Instruções copiadas" : "3. Copiar instruções de uso"}
                </button>
              </div>

              <div className="rounded-xl border border-red-400/20 bg-red-500/[0.04] p-3">
                <p className="text-xs font-black text-red-100">4. 🎨 Gerar a Maestria Final</p>
                <p className="mt-1 text-[11px] leading-relaxed text-white/45">
                  Depois de aprovar o briefing, gera uma imagem e entrega título, descrição, caminho e comandos PowerShell específicos para atualizar somente essa imagem.
                </p>
                <button
                  type="button"
                  onClick={() => void copyPrompt()}
                  className="mt-3 w-full rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.04em] text-red-100"
                >
                  {copiedAction === "generation" ? "✓ Prompt 02 copiado" : "4. Copiar Prompt 02 — Gerar arte"}
                </button>
              </div>
            </div>

            {downloadProgress && (
              <p className="mt-3 text-[10px] font-bold text-emerald-200" role="status">{downloadProgress}</p>
            )}
          </div>
        </div>
      </div>
        </>
      )}
    </section>
  );
}

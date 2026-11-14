// Busca das cópias leves (WebP no tamanho de exibição) a partir do mapa original → cópia.
// Separado de lib/homeImages.ts para poder ser testado sem o bundler.

export function createVariantLookup(variants: Record<string, string>) {
  /** Cópia leve pela URL exata; qualquer outra origem volta intacta. */
  function homeImageSrc(src: string) {
    return variants[src] ?? src;
  }

  /** Cópia maior, para imagens exibidas em destaque (capa e emblema na página do jogo). */
  function largeImageSrc(src: string) {
    return variants[src + "#large"] ?? src;
  }

  /**
   * Tentativas para uma imagem: cópia leve primeiro e o original como reserva,
   * caso a cópia não carregue. Mantém a ordem e remove repetidos e vazios.
   */
  function lightImageCandidates(sources: Array<string | null | undefined>) {
    const candidates: string[] = [];
    for (const raw of sources) {
      const source = String(raw ?? "").trim();
      if (!source) continue;
      for (const candidate of [homeImageSrc(source), source]) {
        if (!candidates.includes(candidate)) candidates.push(candidate);
      }
    }
    return candidates;
  }

  return { homeImageSrc, largeImageSrc, lightImageCandidates };
}

/**
 * Para <img> que mostram a cópia leve: se ela falhar, troca uma única vez para o original
 * e só então repassa o erro ao tratamento já existente do componente.
 */
export function fallbackToOriginal<E extends { currentTarget: HTMLImageElement }>(
  original: string | null | undefined,
  next?: (event: E) => void
) {
  return (event: E) => {
    const image = event.currentTarget;
    const source = String(original ?? "").trim();
    if (source && image.dataset.originalFallback !== "1" && image.getAttribute("src") !== source) {
      image.dataset.originalFallback = "1";
      image.src = source;
      return;
    }
    next?.(event);
  };
}

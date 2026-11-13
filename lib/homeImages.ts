import homeImageVariants from "@/data/homeImageVariants.json";
import { createVariantLookup } from "@/lib/images/variantLookup";

const lookup = createVariantLookup(homeImageVariants as Record<string, string>);

/**
 * Returns the lightweight copy of an image when one exists.
 * Any other source is returned untouched, so new or replaced images keep working.
 *
 * A busca é pela URL exata: uma arte reenviada ganha endereço novo e deixa de usar a cópia
 * antiga (que mostraria a arte anterior). Envios novos já chegam em WebP no tamanho de exibição.
 */
export const homeImageSrc = lookup.homeImageSrc;

/** Larger copy for images shown big, such as the game page cover and emblem. */
export const largeImageSrc = lookup.largeImageSrc;

/** Cópia leve primeiro, original como reserva (sem repetidos). */
export const lightImageCandidates = lookup.lightImageCandidates;

export { fallbackToOriginal } from "@/lib/images/variantLookup";

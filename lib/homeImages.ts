import homeImageVariants from "@/data/homeImageVariants.json";

const variants: Record<string, string> = homeImageVariants;

/**
 * Returns the lightweight copy of an image when one exists.
 * Any other source is returned untouched, so new or replaced images keep working.
 */
export function homeImageSrc(src: string) {
  return variants[src] ?? src;
}

/** Larger copy for images shown big, such as the game page cover and emblem. */
export function largeImageSrc(src: string) {
  return variants[src + "#large"] ?? src;
}

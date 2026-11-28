export type CatalogGame = { slug: string; title: string; platform: string | null; status: string | null };

/** Normaliza títulos para comparação: minúsculas, sem acentos, sem ™®©, só letras/números. */
export function normalizeTitle(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[™®©]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Prefixos do título cortados nos separadores de subtítulo (":", " - ", " – "). */
function separatorPrefixes(title: string) {
  const out: string[] = [];
  const pattern = /\s*(?::|\s[-–—]\s)/g;
  for (let match = pattern.exec(title); match; match = pattern.exec(title)) {
    const prefix = normalizeTitle(title.slice(0, match.index));
    if (prefix) out.push(prefix);
  }
  return out;
}

const MIN_TRUNCATED = 15;

/**
 * Casa um nome detectado (ex.: nome do jogo na Steam) com o catálogo do site.
 * Regras, em ordem, exigindo resultado único:
 *  1. títulos iguais após normalização;
 *  2. um é o outro mais um subtítulo separado por ":" ou " - " (ex.: "Monster Hunter: World"
 *     ↔ "Monster Hunter: World - Iceborne"), sem casar "Hades" com "Hades II";
 *  3. título truncado no catálogo (prefixo com 15+ caracteres).
 */
export function matchCatalog(label: string, games: CatalogGame[]): CatalogGame | null {
  const target = normalizeTitle(label);
  if (!target) return null;
  const unique = (list: CatalogGame[]) => (list.length === 1 ? list[0] : null);

  const exact = games.filter((game) => normalizeTitle(game.title) === target);
  if (exact.length) return unique(exact);

  const targetPrefixes = separatorPrefixes(label);
  const subtitle = games.filter((game) => {
    const title = normalizeTitle(game.title);
    return separatorPrefixes(game.title).includes(target) || targetPrefixes.includes(title);
  });
  if (subtitle.length) return unique(subtitle);

  const truncated = games.filter((game) => {
    const title = normalizeTitle(game.title);
    const [short, long] = title.length <= target.length ? [title, target] : [target, title];
    return short.length >= MIN_TRUNCATED && long.startsWith(short);
  });
  return unique(truncated);
}

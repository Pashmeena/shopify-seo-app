const STOPWORDS = new Set([
  // English
  "a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "is",
  "it", "of", "off", "on", "or", "our", "the", "this", "to", "with", "your",
  // German
  "der", "die", "das", "und", "oder", "für", "fuer", "mit", "von", "im",
  "eine", "ein", "auf", "zu",
]);

/** Lowercased, stopword-free word tokens. */
export function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/** Jaccard similarity between two sets, 0..1. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

/** Hard-truncate to a max length on a word boundary, no ellipsis games. */
export function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  const cut = input.slice(0, maxLength + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : input.slice(0, maxLength)).trimEnd();
}

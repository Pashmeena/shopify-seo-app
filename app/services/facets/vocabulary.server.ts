import type { IntentFacet } from "../../config/types";

/**
 * The domain vocabulary, and the phrase matcher that reads it.
 *
 * Two callers need exactly the same thing, from opposite ends of the
 * pipeline, which is why this is one module rather than two:
 *
 * - keyword parsing turns "botanische tapete wohnzimmer" into
 *   `{ style: [botanical], room: [living room] }`
 * - catalog normalization turns a collection called "Living Room" or a
 *   product titled "Emerald Palm Canopy" into the same facet values
 *
 * Canonical values are English because that is the vocabulary the whole app
 * matches on; synonyms include German so a de-DE keyword parses without
 * calling out to a model.
 */

/** One synonym mapping to a canonical facet value. */
export interface VocabularyEntry {
  facet: IntentFacet;
  value: string;
  /**
   * Safe in a search query, unsafe in product text.
   *
   * Someone typing "study wallpaper" means the room. A wallpaper called
   * "Fern Study" means a drawing, and filing it onto a home-office page
   * would be exactly the mis-match the product brief warns about. These
   * entries are matched when parsing keywords and ignored when reading
   * titles, collections and product types.
   */
  queryOnly?: boolean;
}

/** A compiled lookup table for greedy longest-phrase matching. */
export interface PhraseIndex {
  /** synonym → entry. Keys may be multi-word phrases. */
  entries: Map<string, VocabularyEntry>;
  /** Longest key length in words, so matching knows how far to look ahead. */
  maxPhraseLength: number;
  isNoise(token: string): boolean;
}

export interface FacetExtraction {
  facets: Partial<Record<IntentFacet, string[]>>;
  /** Tokens accounted for by a vocabulary match. */
  matchedTokens: number;
  /** Tokens carrying meaning, matched or not. Zero when the text is all noise. */
  significantTokens: number;
}

/** Words that carry no intent: the product noun itself, fillers, buying verbs. */
const NOISE_WORDS = new Set([
  "wallpaper", "wallpapers", "wall", "paper", "mural", "murals",
  "tapete", "tapeten", "wandtapete",
  "ideas", "idea", "best", "buy", "shop", "online", "cheap",
  "for", "the", "a", "an", "in", "with", "and",
  "für", "fuer", "der", "die", "das", "und", "mit", "im", "ins",
]);

/** synonym (lowercase) → canonical facet value. Multi-word keys allowed. */
export const FACET_SYNONYMS: Record<string, VocabularyEntry> = {
  // ── styles ─────────────────────────────────────────────────────────────
  botanical: { facet: "style", value: "botanical" },
  botanic: { facet: "style", value: "botanical" },
  leafy: { facet: "style", value: "botanical" },
  greenery: { facet: "style", value: "botanical" },
  botanische: { facet: "style", value: "botanical" },
  botanisch: { facet: "style", value: "botanical" },
  // Motif words. Unambiguous in a wallpaper name, and how untagged stores
  // actually title their products, which is what facet inference reads.
  fern: { facet: "style", value: "botanical" },
  ferns: { facet: "style", value: "botanical" },
  leaf: { facet: "style", value: "botanical" },
  leaves: { facet: "style", value: "botanical" },
  ivy: { facet: "style", value: "botanical" },
  meadow: { facet: "style", value: "botanical" },
  meadows: { facet: "style", value: "botanical" },
  eucalyptus: { facet: "style", value: "botanical" },
  floral: { facet: "style", value: "floral" },
  flower: { facet: "style", value: "floral" },
  flowers: { facet: "style", value: "floral" },
  bloom: { facet: "style", value: "floral" },
  blooms: { facet: "style", value: "floral" },
  blossom: { facet: "style", value: "floral" },
  blossoms: { facet: "style", value: "floral" },
  wildflower: { facet: "style", value: "floral" },
  wildflowers: { facet: "style", value: "floral" },
  blumen: { facet: "style", value: "floral" },
  blumentapete: { facet: "style", value: "floral" },
  florale: { facet: "style", value: "floral" },
  tropical: { facet: "style", value: "tropical" },
  jungle: { facet: "style", value: "tropical" },
  palm: { facet: "style", value: "tropical" },
  palms: { facet: "style", value: "tropical" },
  monstera: { facet: "style", value: "tropical" },
  tropische: { facet: "style", value: "tropical" },
  dschungel: { facet: "style", value: "tropical" },
  geometric: { facet: "style", value: "geometric" },
  geometrische: { facet: "style", value: "geometric" },
  "art deco": { facet: "style", value: "art deco" },
  artdeco: { facet: "style", value: "art deco" },
  deco: { facet: "style", value: "art deco" },
  chinoiserie: { facet: "style", value: "chinoiserie" },
  minimalist: { facet: "style", value: "minimalist" },
  minimal: { facet: "style", value: "minimalist" },
  minimalistische: { facet: "style", value: "minimalist" },
  vintage: { facet: "style", value: "vintage" },
  retro: { facet: "style", value: "vintage" },

  // ── rooms ──────────────────────────────────────────────────────────────
  "living room": { facet: "room", value: "living room" },
  livingroom: { facet: "room", value: "living room" },
  lounge: { facet: "room", value: "living room", queryOnly: true },
  "sitting room": { facet: "room", value: "living room" },
  wohnzimmer: { facet: "room", value: "living room" },
  bedroom: { facet: "room", value: "bedroom" },
  schlafzimmer: { facet: "room", value: "bedroom" },
  "kids room": { facet: "room", value: "kids room" },
  "kids rooms": { facet: "room", value: "kids room" },
  "childrens room": { facet: "room", value: "kids room" },
  "children's room": { facet: "room", value: "kids room" },
  nursery: { facet: "room", value: "kids room" },
  playroom: { facet: "room", value: "kids room" },
  kinderzimmer: { facet: "room", value: "kids room" },
  babyzimmer: { facet: "room", value: "kids room" },
  bathroom: { facet: "room", value: "bathroom" },
  badezimmer: { facet: "room", value: "bathroom" },
  kitchen: { facet: "room", value: "kitchen" },
  küche: { facet: "room", value: "kitchen" },
  kueche: { facet: "room", value: "kitchen" },
  hallway: { facet: "room", value: "hallway" },
  entryway: { facet: "room", value: "hallway" },
  flur: { facet: "room", value: "hallway" },
  "home office": { facet: "room", value: "home office" },
  office: { facet: "room", value: "home office", queryOnly: true },
  study: { facet: "room", value: "home office", queryOnly: true },
  arbeitszimmer: { facet: "room", value: "home office" },
  "dining room": { facet: "room", value: "dining room" },
  esszimmer: { facet: "room", value: "dining room" },

  // ── colors ─────────────────────────────────────────────────────────────
  green: { facet: "color", value: "green" },
  grün: { facet: "color", value: "green" },
  gruen: { facet: "color", value: "green" },
  "sage green": { facet: "color", value: "sage green" },
  "midnight blue": { facet: "color", value: "midnight blue" },
  navy: { facet: "color", value: "navy" },
  blue: { facet: "color", value: "blue" },
  blau: { facet: "color", value: "blue" },
  pink: { facet: "color", value: "pink" },
  rosa: { facet: "color", value: "pink" },
  grey: { facet: "color", value: "grey" },
  gray: { facet: "color", value: "grey" },
  grau: { facet: "color", value: "grey" },
  black: { facet: "color", value: "black" },
  schwarz: { facet: "color", value: "black" },
  charcoal: { facet: "color", value: "charcoal" },
  cream: { facet: "color", value: "cream" },
  white: { facet: "color", value: "white" },
  weiß: { facet: "color", value: "white" },

  // ── materials ──────────────────────────────────────────────────────────
  "peel and stick": { facet: "material", value: "peel and stick" },
  "peel-and-stick": { facet: "material", value: "peel and stick" },
  "self adhesive": { facet: "material", value: "peel and stick" },
  "self-adhesive": { facet: "material", value: "peel and stick" },
  selbstklebende: { facet: "material", value: "peel and stick" },
  selbstklebend: { facet: "material", value: "peel and stick" },
  "non-woven": { facet: "material", value: "non woven" },
  "non woven": { facet: "material", value: "non woven" },
  nonwoven: { facet: "material", value: "non woven" },
  vlies: { facet: "material", value: "non woven" },
  vliestapete: { facet: "material", value: "non woven" },
  vinyl: { facet: "material", value: "vinyl" },
  vinyltapete: { facet: "material", value: "vinyl" },

  // ── attributes ─────────────────────────────────────────────────────────
  sustainable: { facet: "attribute", value: "sustainable" },
  eco: { facet: "attribute", value: "sustainable" },
  "eco-friendly": { facet: "attribute", value: "sustainable" },
  "eco friendly": { facet: "attribute", value: "sustainable" },
  nachhaltige: { facet: "attribute", value: "sustainable" },
  nachhaltig: { facet: "attribute", value: "sustainable" },
  washable: { facet: "attribute", value: "washable" },
  scrubbable: { facet: "attribute", value: "washable" },
  wipeable: { facet: "attribute", value: "washable" },
  abwaschbare: { facet: "attribute", value: "washable" },
  abwaschbar: { facet: "attribute", value: "washable" },
  removable: { facet: "attribute", value: "removable" },
  ablösbare: { facet: "attribute", value: "removable" },
  ablösbar: { facet: "attribute", value: "removable" },
  abloesbar: { facet: "attribute", value: "removable" },
  moody: { facet: "attribute", value: "dramatic" },
  dramatic: { facet: "attribute", value: "dramatic" },
  dark: { facet: "attribute", value: "dramatic" },
  dunkle: { facet: "attribute", value: "dramatic" },

  // ── use cases ──────────────────────────────────────────────────────────
  renters: { facet: "useCase", value: "renters" },
  renter: { facet: "useCase", value: "renters" },
  rental: { facet: "useCase", value: "renters" },
  rentals: { facet: "useCase", value: "renters" },
  tenants: { facet: "useCase", value: "renters" },
  apartment: { facet: "useCase", value: "renters", queryOnly: true },
  mietwohnung: { facet: "useCase", value: "renters" },
  mietwohnungen: { facet: "useCase", value: "renters" },
  mieter: { facet: "useCase", value: "renters" },
  kids: { facet: "useCase", value: "kids" },
  children: { facet: "useCase", value: "kids" },
  kinder: { facet: "useCase", value: "kids" },
  "high traffic": { facet: "useCase", value: "high traffic" },
  "high-traffic": { facet: "useCase", value: "high traffic" },
  humid: { facet: "useCase", value: "humid rooms" },
  humidity: { facet: "useCase", value: "humid rooms" },
  steam: { facet: "useCase", value: "humid rooms", queryOnly: true },
  feuchtraum: { facet: "useCase", value: "humid rooms" },

  // ── audiences ──────────────────────────────────────────────────────────
  parents: { facet: "audience", value: "parents" },
  eltern: { facet: "audience", value: "parents" },
  families: { facet: "audience", value: "parents" },
};

/** Append a facet value if it is not already present. */
export function addFacetValue(
  facets: Partial<Record<IntentFacet, string[]>>,
  facet: IntentFacet,
  value: string,
): void {
  const values = (facets[facet] ??= []);
  if (!values.includes(value)) values.push(value);
}

export interface PhraseIndexOptions {
  /**
   * Whether to include entries flagged `queryOnly`. True when parsing what a
   * shopper typed, false when reading a merchant's product text.
   */
  includeQueryOnly: boolean;
}

/**
 * Compile the seed vocabulary, optionally extended with entries learned
 * from a specific store, into a lookup table.
 */
export function buildPhraseIndex(
  extra: Iterable<VocabularyEntry> = [],
  options: PhraseIndexOptions = { includeQueryOnly: true },
): PhraseIndex {
  const entries = new Map<string, VocabularyEntry>(
    Object.entries(FACET_SYNONYMS).filter(
      ([, entry]) => options.includeQueryOnly || !entry.queryOnly,
    ),
  );

  for (const entry of extra) {
    // The seed vocabulary wins: it carries the synonyms and the German.
    if (!entries.has(entry.value)) entries.set(entry.value, entry);
  }

  const maxPhraseLength = Math.max(
    ...[...entries.keys()].map((key) => key.split(" ").length),
  );
  return {
    entries,
    maxPhraseLength,
    isNoise: (token) => NOISE_WORDS.has(token),
  };
}

/**
 * The vocabulary used to read a merchant's product text, memoized.
 *
 * Narrower than the keyword lexicon in two ways. It excludes `queryOnly`
 * entries, and it is built from the seed vocabulary alone rather than from
 * catalog values — facets are being *derived* from product text here, so an
 * index built out of those same derived values would be circular.
 */
let memoizedProductTextIndex: PhraseIndex | null = null;
export function productTextPhraseIndex(): PhraseIndex {
  return (memoizedProductTextIndex ??= buildPhraseIndex([], {
    includeQueryOnly: false,
  }));
}

/**
 * Greedy longest-phrase-first matching of free text against the index.
 *
 * Longest-first matters: "living room" must win over "room" alone, and
 * "sage green" over "green", or a keyword resolves to a broader facet than
 * the shopper asked for.
 */
export function extractFacets(text: string, index: PhraseIndex): FacetExtraction {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s]+/)
    .filter(Boolean);

  const facets: Partial<Record<IntentFacet, string[]>> = {};
  let matchedTokens = 0;
  let significantTokens = 0;
  let position = 0;

  while (position < tokens.length) {
    let matched = false;
    const remaining = tokens.length - position;
    for (
      let length = Math.min(index.maxPhraseLength, remaining);
      length >= 1;
      length--
    ) {
      const phrase = tokens.slice(position, position + length).join(" ");
      const entry =
        index.entries.get(phrase) ?? index.entries.get(phrase.replace(/-/g, " "));
      if (entry) {
        addFacetValue(facets, entry.facet, entry.value);
        matchedTokens += length;
        significantTokens += length;
        position += length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      if (!index.isNoise(tokens[position])) significantTokens++;
      position++;
    }
  }

  return { facets, matchedTokens, significantTokens };
}

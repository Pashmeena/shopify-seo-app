import type { CatalogProduct } from "../catalog/types";
import type { LexiconEntry } from "./types";

/**
 * Keyword → facet lexicon.
 *
 * Two layers merge into one lookup table:
 * 1. A static seed vocabulary of wallpaper-domain terms with synonyms —
 *    including German ones, so de-DE keywords parse rules-only. Values are
 *    canonical English because that is the catalog's tag vocabulary.
 * 2. Facet values learned from the live catalog's namespaced tags, so any
 *    store vocabulary (e.g. "duck egg blue") is recognized without code
 *    changes.
 */

/** Words that carry no intent — the product noun itself, fillers. */
const NOISE_WORDS = new Set([
  "wallpaper", "wallpapers", "wall", "paper", "mural", "murals",
  "tapete", "tapeten", "wandtapete",
  "ideas", "idea", "best", "buy", "shop", "online", "cheap",
  "for", "the", "a", "an", "in", "with", "and",
  "für", "fuer", "der", "die", "das", "und", "mit", "im", "ins",
]);

/** synonym (lowercase) → canonical facet value. Multi-word keys allowed. */
const SEED_SYNONYMS: Record<string, { facet: LexiconEntry["facet"]; value: string }> = {
  // ── styles ─────────────────────────────────────────────────────────────
  botanical: { facet: "style", value: "botanical" },
  botanic: { facet: "style", value: "botanical" },
  leafy: { facet: "style", value: "botanical" },
  greenery: { facet: "style", value: "botanical" },
  botanische: { facet: "style", value: "botanical" },
  botanisch: { facet: "style", value: "botanical" },
  floral: { facet: "style", value: "floral" },
  flower: { facet: "style", value: "floral" },
  flowers: { facet: "style", value: "floral" },
  blumen: { facet: "style", value: "floral" },
  blumentapete: { facet: "style", value: "floral" },
  florale: { facet: "style", value: "floral" },
  tropical: { facet: "style", value: "tropical" },
  jungle: { facet: "style", value: "tropical" },
  palm: { facet: "style", value: "tropical" },
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
  lounge: { facet: "room", value: "living room" },
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
  office: { facet: "room", value: "home office" },
  study: { facet: "room", value: "home office" },
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
  apartment: { facet: "useCase", value: "renters" },
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
  steam: { facet: "useCase", value: "humid rooms" },
  feuchtraum: { facet: "useCase", value: "humid rooms" },

  // ── audiences ──────────────────────────────────────────────────────────
  parents: { facet: "audience", value: "parents" },
  eltern: { facet: "audience", value: "parents" },
  families: { facet: "audience", value: "parents" },
};

export interface Lexicon {
  /** synonym → entry; keys may be multi-word phrases. */
  entries: Map<string, LexiconEntry>;
  /** longest phrase length (in words) present among keys */
  maxPhraseLength: number;
  isNoise(token: string): boolean;
}

/** Build the lookup table from the seed vocabulary plus catalog facet values. */
export function buildLexicon(catalog: CatalogProduct[]): Lexicon {
  const entries = new Map<string, LexiconEntry>();

  for (const [synonym, entry] of Object.entries(SEED_SYNONYMS)) {
    entries.set(synonym, entry);
  }
  for (const product of catalog) {
    for (const [facet, values] of Object.entries(product.facets)) {
      for (const value of values ?? []) {
        if (!entries.has(value)) {
          entries.set(value, { facet: facet as LexiconEntry["facet"], value });
        }
      }
    }
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

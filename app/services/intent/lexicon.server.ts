import {
  buildPhraseIndex,
  type PhraseIndex,
  type VocabularyEntry,
} from "../facets/vocabulary.server";
import type { CatalogProduct } from "../catalog/types";

/**
 * The keyword-parsing lexicon: the shared domain vocabulary
 * (`services/facets/vocabulary.server.ts`) extended with facet values
 * learned from this store's own catalog.
 *
 * That second layer is what lets a store's private vocabulary ("duck egg
 * blue", a house style name) be understood in a keyword without anyone
 * editing code — the value is already in the catalog, so it is already a
 * term the app can match on.
 */

/** A compiled keyword lexicon. Same structure the catalog side matches with. */
export type Lexicon = PhraseIndex;

function* catalogEntries(catalog: CatalogProduct[]): Generator<VocabularyEntry> {
  for (const product of catalog) {
    for (const [facet, values] of Object.entries(product.facets)) {
      for (const value of values ?? []) {
        yield { facet: facet as VocabularyEntry["facet"], value };
      }
    }
  }
}

export function buildLexicon(catalog: CatalogProduct[]): Lexicon {
  return buildPhraseIndex(catalogEntries(catalog));
}

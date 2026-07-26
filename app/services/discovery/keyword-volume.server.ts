/**
 * Search-volume lookup — deliberately a stub.
 *
 * There is no real search-volume data in this build, so discovery is
 * catalog-only and supply-biased (documented in the README). This
 * interface is the plug point: swap `getVolumeProvider` to return an
 * adapter for a keyword-volume API (Ahrefs, Semrush, Keyword Planner) and
 * discovery will rank by demand with no other code changes.
 */

export interface KeywordVolumeProvider {
  name: string;
  /** phrase → monthly search volume, or null when unknown. */
  getVolumes(phrases: string[], locale: string): Promise<Map<string, number | null>>;
}

const nullVolumeProvider: KeywordVolumeProvider = {
  name: "none (catalog-only discovery)",
  async getVolumes(phrases) {
    return new Map(phrases.map((phrase) => [phrase, null]));
  },
};

export function getVolumeProvider(): KeywordVolumeProvider {
  return nullVolumeProvider;
}

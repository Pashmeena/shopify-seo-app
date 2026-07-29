/**
 * The sample file offered in the keyword manager.
 *
 * Deliberately not a `.server` module: the download is built in the browser
 * from this constant, so the format the merchant is handed and the format
 * documented in the UI can never drift apart.
 *
 * It shows the canonical shape (a `keyword` header, an optional `locale`
 * column) but the importer does not require it — see
 * `column-mapping.server.ts` for how unrecognized headers are resolved.
 */

export const KEYWORD_TEMPLATE_FILENAME = "keywords-template.csv";

export const KEYWORD_TEMPLATE_CSV =
  [
    "keyword,locale",
    "botanical wallpaper living room,en-US",
    "peel and stick wallpaper for renters,en-US",
    "sustainable wallpaper kids room,en-US",
    "art deco wallpaper dining room,en-US",
    "botanische tapete wohnzimmer,de-DE",
    "selbstklebende tapete mietwohnung,de-DE",
  ].join("\n") + "\n";

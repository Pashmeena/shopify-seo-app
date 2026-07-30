import type { IntentProfile } from "../services/intent/types";

/**
 * The fictional store the `examples/` files describe.
 *
 * One shared definition, because the examples reference each other: hreflang
 * pairs the two locale variants, and internal links are computed from the
 * whole published set. Previously each file was written by hand and they did
 * not agree — a link claimed a shared facet that the page it pointed at did
 * not have.
 */

export interface ExamplePage {
  slug: string;
  locale: string;
  title: string;
  clusterKey: string;
  status: string;
  intent: IntentProfile;
  /** Set on the files that ship as examples. */
  pageTypeId?: string;
}

function intent(
  keyword: string,
  locale: string,
  facets: IntentProfile["facets"],
  pageTypeId: string,
): IntentProfile {
  return { keyword, locale, facets, pageTypeId, confidence: 1, method: "rules" };
}

export const STYLE_ROOM_CLUSTER = "room:living room|style:botanical";
export const USE_CASE_CLUSTER = "material:peel and stick|useCase:renters";

export const EXAMPLE_STORE: ExamplePage[] = [
  {
    slug: "en-us-botanical-wallpaper-living-room",
    locale: "en-US",
    title: "Botanical Wallpaper for Living Rooms",
    clusterKey: STYLE_ROOM_CLUSTER,
    status: "published",
    pageTypeId: "style-room",
    intent: intent(
      "botanical wallpaper living room",
      "en-US",
      { style: ["botanical"], room: ["living room"] },
      "style-room",
    ),
  },
  {
    slug: "de-de-botanische-tapete-wohnzimmer",
    locale: "de-DE",
    title: "Botanische Tapete fürs Wohnzimmer",
    clusterKey: STYLE_ROOM_CLUSTER,
    status: "published",
    pageTypeId: "style-room",
    intent: intent(
      "botanische tapete wohnzimmer",
      "de-DE",
      { style: ["botanical"], room: ["living room"] },
      "style-room",
    ),
  },
  {
    slug: "en-us-peel-and-stick-wallpaper-renters",
    locale: "en-US",
    title: "Peel and Stick Wallpaper for Renters",
    clusterKey: USE_CASE_CLUSTER,
    status: "published",
    pageTypeId: "use-case",
    intent: intent(
      "peel and stick wallpaper for renters",
      "en-US",
      {
        material: ["peel and stick"],
        useCase: ["renters"],
        audience: ["renters"],
      },
      "use-case",
    ),
  },

  // Context only: these exist so hreflang and internal linking have something
  // real to resolve against, exactly as they would on a store with a dozen
  // published PLPs.
  {
    slug: "en-us-botanical-wallpaper-bedroom",
    locale: "en-US",
    title: "Botanical Wallpaper for Bedrooms",
    clusterKey: "room:bedroom|style:botanical",
    status: "published",
    intent: intent(
      "botanical wallpaper bedroom",
      "en-US",
      { style: ["botanical"], room: ["bedroom"] },
      "style-room",
    ),
  },
  {
    slug: "en-us-tropical-wallpaper-living-room",
    locale: "en-US",
    title: "Tropical Wallpaper for Living Rooms",
    clusterKey: "room:living room|style:tropical",
    status: "published",
    intent: intent(
      "tropical wallpaper living room",
      "en-US",
      { style: ["tropical"], room: ["living room"] },
      "style-room",
    ),
  },
  {
    slug: "en-us-peel-and-stick-wallpaper-kids-room",
    locale: "en-US",
    title: "Peel and Stick Wallpaper for Kids' Rooms",
    clusterKey: "material:peel and stick|room:kids room|useCase:kids",
    status: "published",
    intent: intent(
      "peel and stick wallpaper kids room",
      "en-US",
      {
        material: ["peel and stick"],
        room: ["kids room"],
        useCase: ["kids"],
        audience: ["parents"],
      },
      "style-room",
    ),
  },
];

export function examplePage(slug: string): ExamplePage {
  const page = EXAMPLE_STORE.find((candidate) => candidate.slug === slug);
  if (!page) throw new Error(`No example page "${slug}"`);
  return page;
}

/** Every page except the one being built, as the assembler expects them. */
export function siblingsOf(slug: string) {
  return EXAMPLE_STORE.filter((page) => page.slug !== slug).map((page) => ({
    slug: page.slug,
    locale: page.locale,
    title: page.title,
    clusterKey: page.clusterKey,
    status: page.status,
    intent: page.intent,
  }));
}

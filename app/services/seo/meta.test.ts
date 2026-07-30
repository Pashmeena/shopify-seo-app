import { describe, expect, it } from "vitest";
import { getLocale, getPageType } from "../../config/index.server";
import { intent } from "../../test-support/catalog";
import type { PlpContent } from "../generation/types";
import { resolveMeta } from "./meta.server";

/**
 * Meta resolution. The AI writes meta as a separate CTR objective and wins
 * when it is valid; these templates are the floor beneath it, so they have to
 * read as finished copy rather than as a template with holes in it.
 */

const styleRoom = getPageType("style-room");
const useCase = getPageType("use-case");
const rental = getPageType("rental-compliance");

const enUS = getLocale("en-US");
const deDE = getLocale("de-DE");

function content(meta?: { title: string; description: string }): PlpContent {
  return {
    h1: "H1",
    intro: "Intro",
    sections: [],
    faq: [],
    product_alt_texts: [],
    ...(meta ? { meta } : {}),
  } as PlpContent;
}

describe("the AI's meta wins when present", () => {
  it("prefers the AI title and description over the templates", () => {
    const meta = resolveMeta(
      content({
        title: "Botanical Wallpaper for Living Rooms",
        description: "Nine botanical designs chosen for living-room light.",
      }),
      styleRoom,
      intent({ style: ["botanical"], room: ["living room"] }),
      enUS,
      "Wild Palace",
      9,
    );

    expect(meta.title).toBe("Botanical Wallpaper for Living Rooms");
    expect(meta.description).toBe(
      "Nine botanical designs chosen for living-room light.",
    );
  });

  it("enforces the length limits regardless of source", () => {
    const meta = resolveMeta(
      content({ title: "x".repeat(200), description: "y".repeat(400) }),
      styleRoom,
      intent({ style: ["botanical"], room: ["living room"] }),
      enUS,
      "Wild Palace",
      9,
    );

    expect(meta.title.length).toBeLessThanOrEqual(60);
    expect(meta.description.length).toBeLessThanOrEqual(155);
  });
});

describe("template fallback", () => {
  it("capitalizes facet values for a title, since they are stored lowercase for slugs", () => {
    const meta = resolveMeta(
      content(),
      styleRoom,
      intent({ style: ["botanical"], room: ["living room"] }),
      enUS,
      "Wild Palace",
      9,
    );

    expect(meta.title).toBe("Botanical Wallpaper for Living Rooms | Wild Palace");
  });

  it("capitalizes every word of a multi-word value", () => {
    const meta = resolveMeta(
      content(),
      useCase,
      intent({ material: ["peel and stick"], useCase: ["renters"] }),
      enUS,
      "Wild Palace",
      8,
    );

    expect(meta.title).toBe("Peel And Stick Wallpaper for Renters | Wild Palace");
  });

  it("leaves no leading or doubled space when an optional token is absent", () => {
    // use-case's title template opens with {Material}, which a bare renters
    // intent does not supply.
    const meta = resolveMeta(
      content(),
      useCase,
      intent({ useCase: ["renters"] }),
      enUS,
      "Wild Palace",
      8,
    );

    expect(meta.title).toBe("Wallpaper for Renters | Wild Palace");
    expect(meta.title).not.toMatch(/^\s|\s\s/);
  });

  it("uses the locale's own term, capitalized as German requires", () => {
    const meta = resolveMeta(
      content(),
      rental,
      intent({ useCase: ["renters"] }, { locale: "de-DE" }),
      deDE,
      "Wild Palace",
      8,
    );

    expect(meta.title).toBe("Tapete für die Mietwohnung | Wild Palace");
    expect(meta.description).toContain("für die Mietwohnung");
  });

  it("localizes the description and fills in the product count", () => {
    const meta = resolveMeta(
      content(),
      styleRoom,
      intent({ style: ["botanical"], room: ["living room"] }, { locale: "de-DE" }),
      deDE,
      "Wild Palace",
      9,
    );

    expect(meta.description).toContain("9");
    expect(meta.description).toContain("botanische");
    expect(meta.description).toContain("wohnzimmer");
  });

  it("does not leave a space before punctuation", () => {
    const meta = resolveMeta(
      content(),
      useCase,
      intent({ useCase: ["renters"] }),
      enUS,
      "Wild Palace",
      8,
    );

    expect(meta.description).not.toMatch(/\s[,.:;|]/);
  });
});

describe("keywords", () => {
  it("fills every template that has values to fill", () => {
    const meta = resolveMeta(
      content(),
      styleRoom,
      intent({ style: ["botanical"], room: ["living room"] }),
      enUS,
      "Wild Palace",
      9,
    );

    expect(meta.keywords).toEqual([
      "botanical wallpaper living room",
      "botanical living room wallpaper",
      "botanical wallpaper ideas living room",
      "best botanical wallpaper for living room",
    ]);
  });

  it("stays lowercase, because keywords are how people type", () => {
    const meta = resolveMeta(
      content(),
      styleRoom,
      intent({ style: ["art deco"], room: ["dining room"] }),
      enUS,
      "Wild Palace",
      6,
    );

    expect(meta.keywords.every((keyword) => keyword === keyword.toLowerCase())).toBe(
      true,
    );
  });

  it("collapses the gaps left by absent facets", () => {
    const meta = resolveMeta(
      content(),
      useCase,
      intent({ useCase: ["renters"] }),
      enUS,
      "Wild Palace",
      8,
    );

    expect(meta.keywords).toContain("wallpaper renters");
    expect(meta.keywords.every((keyword) => !/\s\s/.test(keyword))).toBe(true);
  });
});

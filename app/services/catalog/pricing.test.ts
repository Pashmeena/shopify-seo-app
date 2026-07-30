import { describe, expect, it, vi } from "vitest";
import { product } from "../../test-support/catalog";
import type { AdminClient } from "../shopify/admin.server";
import {
  applyMarketPrices,
  fetchMarketPrices,
  type MarketPrice,
} from "./pricing.server";

/**
 * Contextual pricing is the one place the app depends on Shopify Markets
 * being configured, so the failure path matters as much as the happy one: a
 * store without the market must still publish, in shop currency.
 */

function adminReturning(payload: unknown): AdminClient {
  return {
    graphql: vi.fn(async () => new Response(JSON.stringify(payload))),
  };
}

function adminFailing(): AdminClient {
  return {
    graphql: vi.fn(async () => {
      throw new Error("Field 'contextualPricing' doesn't exist");
    }),
  };
}

function node(id: string, amount: string, currencyCode: string) {
  return {
    id,
    contextualPricing: {
      priceRange: { minVariantPrice: { amount, currencyCode } },
    },
  };
}

describe("fetchMarketPrices", () => {
  it("returns each product's price in the requested market", async () => {
    const admin = adminReturning({
      data: { nodes: [node("gid://p/1", "119.00", "EUR")] },
    });

    const prices = await fetchMarketPrices(admin, ["gid://p/1"], "DE");

    expect(prices.get("gid://p/1")).toEqual({ price: 119, currencyCode: "EUR" });
  });

  it("does not call the API for an empty product list", async () => {
    const admin = adminReturning({ data: { nodes: [] } });

    await fetchMarketPrices(admin, [], "DE");

    expect(admin.graphql).not.toHaveBeenCalled();
  });

  it("passes the ids and country through as variables", async () => {
    const admin = adminReturning({ data: { nodes: [] } });

    await fetchMarketPrices(admin, ["gid://p/1", "gid://p/2"], "AU");

    expect(admin.graphql).toHaveBeenCalledWith(expect.any(String), {
      variables: { ids: ["gid://p/1", "gid://p/2"], country: "AU" },
    });
  });

  it("returns an empty map when the market is unavailable", async () => {
    const prices = await fetchMarketPrices(adminFailing(), ["gid://p/1"], "DE");

    expect(prices.size).toBe(0);
  });

  it("skips nodes that came back null or without pricing", async () => {
    const admin = adminReturning({
      data: {
        nodes: [null, { id: "gid://p/2" }, node("gid://p/3", "89.00", "GBP")],
      },
    });

    const prices = await fetchMarketPrices(
      admin,
      ["gid://p/1", "gid://p/2", "gid://p/3"],
      "GB",
    );

    expect([...prices.keys()]).toEqual(["gid://p/3"]);
  });
});

describe("applyMarketPrices", () => {
  const products = [
    product({ handle: "a", price: 129, currencyCode: "USD" }),
    product({ handle: "b", price: 99, currencyCode: "USD" }),
  ];

  it("overlays the market price and currency", () => {
    const prices = new Map<string, MarketPrice>([
      [products[0].id, { price: 119, currencyCode: "EUR" }],
    ]);

    const [a, b] = applyMarketPrices(products, prices);

    expect(a).toMatchObject({ price: 119, currencyCode: "EUR" });
    // Untouched products keep shop pricing rather than being dropped.
    expect(b).toMatchObject({ price: 99, currencyCode: "USD" });
  });

  it("returns the same array when there is nothing to apply", () => {
    expect(applyMarketPrices(products, new Map())).toBe(products);
  });

  it("does not mutate the products it was given", () => {
    const prices = new Map<string, MarketPrice>([
      [products[0].id, { price: 119, currencyCode: "EUR" }],
    ]);

    applyMarketPrices(products, prices);

    expect(products[0]).toMatchObject({ price: 129, currencyCode: "USD" });
  });

  it("preserves every other field of the product", () => {
    const prices = new Map<string, MarketPrice>([
      [products[0].id, { price: 119, currencyCode: "EUR" }],
    ]);

    const [a] = applyMarketPrices(products, prices);

    expect(a.facets).toEqual(products[0].facets);
    expect(a.title).toBe(products[0].title);
  });
});

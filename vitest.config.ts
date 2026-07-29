import { defineConfig } from "vitest/config";

/**
 * Separate from vite.config.ts on purpose: the Remix plugin builds a router
 * and expects a browser/server environment, neither of which a unit test
 * needs. Vite's own transform pipeline is still in play, so `import.meta.glob`
 * (how the config registry discovers page types and locales) behaves exactly
 * as it does in the app.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/*.test.ts"],
    restoreMocks: true,
    unstubEnvs: true,
  },
});

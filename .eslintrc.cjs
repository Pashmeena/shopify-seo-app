/** @type {import('@types/eslint').Linter.BaseConfig} */
module.exports = {
  root: true,
  extends: [
    "@remix-run/eslint-config",
    "@remix-run/eslint-config/node",
    "prettier",
  ],
  globals: {
    shopify: "readonly"
  },
  overrides: [
    {
      // Tests run on vitest. The Remix config's jest-testing-library preset
      // was dropped above because eslint-plugin-jest refuses to load without
      // jest installed; these globals are what it was providing.
      files: ["**/*.test.ts", "**/*.test.tsx"],
      env: { node: true },
      globals: {
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        vi: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
      },
    },
  ],
};

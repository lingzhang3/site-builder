import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";

/**
 * Flat config, bridged to eslint-config-next through FlatCompat because that
 * config is still written in eslintrc form.
 *
 * Without a config file at all, `next lint` drops into an interactive setup
 * prompt, which hangs CI rather than failing it.
 */
const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "drizzle/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Unused values are a real smell; unused *type* imports and args
      // prefixed with _ are deliberate.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
];

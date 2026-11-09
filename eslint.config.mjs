import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Activity entries are written before the reply (#399): pages refresh as soon as they
    // hear back and must already list the entry. createActivity catches its own errors.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "UnaryExpression[operator='void'] > CallExpression[callee.name='createActivity']",
          message: "Await createActivity: a page refreshed right after the reply must already list the entry (#399).",
        },
        {
          selector: "ExpressionStatement > CallExpression[callee.name='createActivity']",
          message: "Await createActivity: a page refreshed right after the reply must already list the entry (#399).",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;

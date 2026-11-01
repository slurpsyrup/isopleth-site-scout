import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["public/vendor/**", "node_modules/**", ".wrangler/**", "docs/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.browser, ...globals.serviceworker, ...globals.node } },
    rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }], "no-empty": ["error", { allowEmptyCatch: true }] },
  },
  { files: ["public/analytics.js"], languageOptions: { sourceType: "script" } },
];

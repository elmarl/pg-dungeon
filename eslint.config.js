import { defineConfig, globalIgnores } from "eslint/config";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist/**"]),
  {
    files: ["**/*.{ts,js}"],
    extends: [tseslint.configs.recommended],
    plugins: {
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      curly: ["error", "all"],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          vars: "all",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "id-length": ["error", { min: 2, properties: "never" }],
    },
  },
]);

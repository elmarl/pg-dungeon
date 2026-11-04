import tseslint from "typescript-eslint";

export default tseslint.config({
  files: ["**/*.ts"],
  extends: [tseslint.configs.base],
  rules: {
    curly: ["error", "all"],
    "id-length": ["error", { min: 2, properties: "never" }],
  },
});

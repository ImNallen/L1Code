// Boundaries that keep each slice's internals private. An import that breaks them fails `pnpm build`.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "src/core/bindings.gen.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/slices/*/*"], message: "Import a slice only through its index: @/slices/<id>." },
            { group: ["../*"], message: "Use @/ imports outside your own folder." },
            { group: ["@/core/bindings.gen", "**/bindings.gen"], message: "Call Rust through @/core/ipc." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/core/ipc.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["src/core/**"],
    ignores: ["src/core/ipc.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/slices/*", "@/shell/*"], message: "core must not depend on slices or the shell." },
            { group: ["@/core/bindings.gen", "**/bindings.gen"], message: "Call Rust through @/core/ipc." },
          ],
        },
      ],
    },
  },
);

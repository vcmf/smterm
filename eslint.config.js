import js from "@eslint/js"
import tseslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import globals from "globals"

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "out/**", // electron-vite build output
      "coverage/**",
      "node_modules/**",
      "src-tauri/**", // Rust — linted by clippy, not eslint
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Application source (browser environment).
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    // Config files, Electron main/preload, and test setup run in Node.
    files: ["*.{ts,js,mjs,cjs}", "electron/**", "src/test/**"],
    languageOptions: { globals: { ...globals.node } },
  },
)

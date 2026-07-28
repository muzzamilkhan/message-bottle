import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";

// Flat config driven by the ESLint CLI directly. `next lint` is deprecated in
// Next 15 and removed in 16, and eslint-config-next 15.x still ships only
// legacy .eslintrc files (its @rushstack/eslint-patch shim crashes on ESLint
// 9.39), so the Next plugins are composed here instead of via that preset.
export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "src/generated/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@next/next": nextPlugin,
      react: reactPlugin,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactPlugin.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,

      // The App Router compiles JSX without importing React, and TypeScript
      // already covers prop types.
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",

      // Unused variables are a real signal in a codebase this small, but allow
      // the conventional underscore prefix for deliberately-ignored args (the
      // `_prev` state argument every server action takes).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);

// Lean ESLint gate (ISSUE-023). Deliberately NOT the full recommended set — on a
// large existing codebase that would flood warnings without adding a real gate.
// Instead: ERROR only on genuine bug-classes (so CI fails on real defects), and
// leave stylistic/legacy debt to tsc + SonarLint. Keeps `npm run lint` green and
// meaningful.
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

const coreBugRules = {
  "no-debugger": "error",
  "no-dupe-keys": "error",
  "no-dupe-args": "error",
  "no-dupe-class-members": "error",
  "no-dupe-else-if": "error",
  "no-unreachable": "error",
  "no-cond-assign": ["error", "always"],
  "no-constant-condition": ["error", { checkLoops: false }],
  "no-unsafe-negation": "error",
  "no-unsafe-finally": "error",
  "no-self-assign": "error",
  "no-self-compare": "error",
  "no-fallthrough": "error",
  "no-invalid-regexp": "error",
  "getter-return": "error",
  "use-isnan": "error",
  "valid-typeof": "error",
  "for-direction": "error",
  "no-async-promise-executor": "error",
  "no-compare-neg-zero": "error",
};

export default [
  {
    ignores: [
      "archive/**", "dist/**", "release/**", "node_modules/**",
      "vendor/claudian/**", "vendor/opencode/**",
      "src-tauri/**", "build/**", "public/**", "**/*.d.ts", "eslint.config.js",
    ],
  },
  {
    files: [
      "src/**/*.{ts,tsx}",
      "shared/agent-contract/**/*.ts",
      "packages/shared-ui/src/**/*.{ts,tsx}",
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2023, sourceType: "module", ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...coreBugRules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn", // legacy debt — visible, non-blocking
    },
  },
  {
    files: ["src/features/desktop-agent/ui/**/*.{ts,tsx}"],
    ignores: [
      "src/features/desktop-agent/ui/transcript/useTranscriptViewport.ts",
      "src/features/desktop-agent/ui/AgentRenderStabilitySmokeHarness.tsx",
    ],
    rules: {
      // Transcript children report geometry and user intent to the viewport
      // owner. Embedded scrollers use shared UI components with their own
      // local viewport; they cannot reach into the outer conversation.
      "no-restricted-syntax": ["error",
        {
          selector: ":matches(AssignmentExpression > MemberExpression.left, UpdateExpression > MemberExpression.argument):matches([computed=false][property.name='scrollTop'], [computed=true][property.value='scrollTop'])",
          message: "Chat scrolling belongs to useTranscriptViewport; report intent/size through its callbacks instead of writing scrollTop.",
        },
        {
          selector: "CallExpression > MemberExpression.callee:matches([computed=false][property.name=/^(scroll|scrollTo|scrollBy|scrollIntoView)$/], [computed=true][property.value=/^(scroll|scrollTo|scrollBy|scrollIntoView)$/])",
          message: "Chat scrolling belongs to useTranscriptViewport; leaf components must not move the conversation or its ancestors.",
        },
        {
          selector: "NewExpression:matches([callee.name='ResizeObserver'], [callee.type='MemberExpression'][callee.property.name='ResizeObserver'])",
          message: "Chat size observation belongs to useTranscriptViewport; report row elements through the shared measurement callbacks.",
        },
      ],
    },
  },
  {
    files: ["tests/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2023, sourceType: "module", ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...coreBugRules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["cloudflare/**/*.mjs", "electron/**/*.mjs", "local-api/**/*.mjs", "shared/**/*.{js,mjs}", "scripts/**/*.mjs", "tests/**/*.mjs"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.node } },
    rules: coreBugRules,
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { ecmaVersion: 2023, sourceType: "commonjs", globals: { ...globals.node } },
    rules: coreBugRules,
  },
];

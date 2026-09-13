// Domain denominators include production files even when no test imports them.
export const coreCoverageDomains = {
  editor: "{packages/shared-ui/src/editor,src/features/editor-workbench}/**/*.{ts,tsx,mjs}",
  agent: "{src/features/desktop-agent,electron/main/agent,shared/agent-contract}/**/*.{ts,tsx,mjs}",
  workbench: "{src/features/app-shell,src/features/desktop-terminal,electron/main/item-hosts,electron/main/native-surfaces,electron/main/workspace/project-sessions}/**/*.{ts,tsx,mjs}",
};
// Declarations have no executable behavior; development-only visual fixtures have
// independent smoke runners. User-facing runtime modules are never excluded.
export const coreCoverageExclude = ["**/*.d.ts", "**/*SmokeHarness.{ts,tsx}", "**/*PerformanceHarness.{ts,tsx}"];

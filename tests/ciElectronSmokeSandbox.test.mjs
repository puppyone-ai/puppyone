import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveInvocation } from "../scripts/release-checks/execution.mjs";

const workflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const markdownFocusFixture = readFileSync(
  new URL("../scripts/fixtures/markdown-pane-focus-continuity.tsx", import.meta.url),
  "utf8",
);

describe("CI Electron smoke sandbox boundary", () => {
  it("scopes the hosted Linux fallback and virtual display to Electron fixtures", () => {
    const check = { command: ["node", "fixture.mjs"], runtime: "electron" };
    const options = { platform: "linux", environment: { GITHUB_ACTIONS: "true" } };
    expect(workflow).not.toContain("ELECTRON_DISABLE_SANDBOX");
    expect(resolveInvocation(check, options)).toMatchObject({ command: "xvfb-run", env: { ELECTRON_DISABLE_SANDBOX: "1" } });
    expect(resolveInvocation({ ...check, runtime: "node" }, options).env).not.toHaveProperty("ELECTRON_DISABLE_SANDBOX");
    const local = resolveInvocation(check, { platform: "linux", environment: { DISPLAY: ":1" } });
    expect(local.command).toBe(process.execPath);
    expect(local.env).not.toHaveProperty("ELECTRON_DISABLE_SANDBOX");
  });

  it("keeps the smoke fixture on the current split-view input contract", () => {
    expect(markdownFocusFixture).toContain("editorTree={tree}");
    expect(markdownFocusFixture).toContain(
      "markdownEnvironment={EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT}",
    );
    expect(markdownFocusFixture).not.toContain("state={workspaceState}");
  });
});

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
const auxiliaryAppearanceSmoke = readFileSync(
  new URL("../scripts/smoke-auxiliary-appearance.mjs", import.meta.url),
  "utf8",
);
const auxiliaryAppearanceHarness = readFileSync(
  new URL("../src/features/appearance/AuxiliaryAppearanceSmokeHarness.tsx", import.meta.url),
  "utf8",
);
const workbenchHeaderMotionSmoke = readFileSync(
  new URL("../scripts/smoke-workbench-header-motion.mjs", import.meta.url),
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

  it("normalizes the auxiliary evidence directory before configuring Electron", () => {
    expect(auxiliaryAppearanceSmoke).toContain(
      "path.resolve(repo, process.env.PUPPYONE_AUXILIARY_ARTIFACT_DIR)",
    );
    expect(auxiliaryAppearanceSmoke).toContain(
      'app.setPath("userData", path.join(artifacts, "user-data"))',
    );
  });

  it("keeps the appearance fixture on its deterministic in-process terminal", () => {
    expect(auxiliaryAppearanceHarness).toContain("TerminalRuntimePool");
    expect(auxiliaryAppearanceHarness).toContain("TerminalSessionView");
    expect(auxiliaryAppearanceHarness).not.toContain("createTerminalWorkbenchContribution");
  });

  it("keeps the Header motion smoke independent of the renderer locale", () => {
    expect(workbenchHeaderMotionSmoke).not.toMatch(
      /Chat history|Search chat history|Refresh chat history|Back to Agents/,
    );
    expect(workbenchHeaderMotionSmoke).toContain(
      ".desktop-agent-history-search-slot > button",
    );
    expect(workbenchHeaderMotionSmoke).toContain(
      ".desktop-agent-history-toolbar > button:first-of-type",
    );
  });
});

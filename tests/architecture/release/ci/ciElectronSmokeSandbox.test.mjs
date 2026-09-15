import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveInvocation } from "../../../../scripts/release-checks/execution.mjs";

const workflow = readFileSync(
  new URL("../../../../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const markdownFocusFixture = readFileSync(
  new URL("../../../fixtures/workbench/focus/markdown-pane-focus-continuity.tsx", import.meta.url),
  "utf8",
);
const editorPaneFixture = readFileSync(
  new URL("../../../integration/editor/runtime/editor-pane-contracts.smoke.mjs", import.meta.url),
  "utf8",
);
const sidebarResizeFixture = readFileSync(
  new URL("../../../support/electron/sidebar-live-resize.mjs", import.meta.url),
  "utf8",
);

describe("CI Electron smoke sandbox boundary", () => {
  it("scopes the hosted Linux fallback and virtual display to Electron fixtures", () => {
    const check = { command: ["node", "fixture.mjs"], runtime: "electron" };
    const options = { platform: "linux", environment: { GITHUB_ACTIONS: "true" } };
    expect(workflow).not.toContain("ELECTRON_DISABLE_SANDBOX");
    expect(resolveInvocation(check, options)).toMatchObject({
      command: "xvfb-run",
      args: expect.arrayContaining(["--server-args=-screen 0 2560x1440x24"]),
      env: { ELECTRON_DISABLE_SANDBOX: "1" },
    });
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

  it("routes hosted pointer evidence through the surface-appropriate transport", () => {
    expect(editorPaneFixture).toContain(
      "surfaces.values().length > 0",
    );
    expect(editorPaneFixture).toContain('inputDebugger.sendCommand("Input.dispatchMouseEvent"');
    expect(editorPaneFixture).toContain("window.webContents.sendInputEvent");
    expect(editorPaneFixture).toContain("if (nativeSurfaceOwned)");
    expect(sidebarResizeFixture).toContain('"restored pane and content geometry"');
    expect(sidebarResizeFixture).toContain(
      "Math.abs(restored.content.width-restored.viewport.width) <= 1",
    );
  });
});

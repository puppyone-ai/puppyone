import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const tokens = readSource("../../../../src/styles/tokens.css");
const menus = readSource("../../../../src/styles/menus.css");
const helpLauncher = readSource("../../../../src/features/app-shell/desktop-help-launcher.css");
const fileActions = readSource("../../../../src/styles/file-actions.css");
const plugins = readSource("../../../../src/features/plugins/plugins.css");
const dataShell = readSource("../../../../src/features/data-workspace/data-shell.css");
const assetLibrary = readSource("../../../../src/styles/asset-library-home.css");
const aiEdits = readSource("../../../../src/ai-edits/ai-edits.css");
const accessMethodCard = readSource(
  "../../../../src/features/cloud/sections/access/styles/method-card.css",
);
const utilityScreens = readSource("../../../../src/styles/utility-screens.css");
const agentFilePresence = readSource(
  "../../../../src/features/desktop-agent-presence/ui/agent-file-presence.css",
);
const editorFind = readSource("../../../../packages/shared-ui/src/styles/editor/editor-find.css");
const editorChrome = readSource("../../../../packages/shared-ui/src/styles/editor/editor-chrome.css");
const csvEditor = readSource("../../../../packages/shared-ui/src/styles/editor/csv-table-editor.css");
const markdownEditor = readSource("../../../../packages/shared-ui/src/styles/editor/markdown-editor.css");
const splitView = readSource(
  "../../../../src/features/editor-workbench/layout/desktop-editor-split-view.css",
);

describe("desktop elevation architecture", () => {
  it("keeps compact controls and popovers on a two-level shared elevation scale", () => {
    expect(tokens).toContain("--po-elevation-low: 0 2px 4px -2px");
    expect(tokens).toContain("--po-elevation-popover: 0 3px 8px -4px");
    expect(tokens).toContain("--po-menu-shadow-compact: var(--po-elevation-low);");
    expect(tokens).toContain("--po-menu-shadow: var(--po-elevation-popover);");
    expect(tokens).not.toContain("--po-menu-shadow: 0 18px 44px");

    const compactMenuRule = readCssBlock(
      menus,
      '.desktop-menu-surface[data-menu-elevation="compact"]',
    );
    expect(compactMenuRule).toContain("box-shadow: var(--po-menu-shadow-compact);");
    expect(compactMenuRule).not.toContain("color-mix(");
  });

  it("does not give chrome controls their own ambient shadow", () => {
    expect(readCssBlock(helpLauncher, ".desktop-help-launcher")).toContain("box-shadow: none;");
    expect(readCssBlock(helpLauncher, ".desktop-help-launcher:hover"))
      .not.toContain("box-shadow:");
    expect(readCssBlock(accessMethodCard, ".desktop-cloud-access-method-copy-button"))
      .toContain("box-shadow: none;");
    expect(helpLauncher).not.toContain("0 2px 8px");
    expect(assetLibrary).not.toContain("6px 7px 0");
  });

  it("routes small floating UI through the shared low or popover elevations", () => {
    expect(readCssBlock(editorFind, ".editor-find-widget"))
      .toContain("box-shadow: var(--po-elevation-low);");
    expect(readCssBlock(editorChrome, ".editor-mode-toggle"))
      .toContain("box-shadow: var(--po-surface-editor-mode-shadow, var(--po-elevation-low));");
    expect(readCssBlock(plugins, ".desktop-plugin-menu > div"))
      .toContain("box-shadow: var(--po-menu-shadow-compact);");
    expect(fileActions).toContain("box-shadow: var(--po-menu-shadow-compact);");
    expect(dataShell).toContain("box-shadow: var(--po-elevation-low);");
    expect(assetLibrary).toContain("box-shadow: var(--po-menu-shadow);");
    expect(aiEdits).toContain("box-shadow: var(--po-menu-shadow);");
    expect(readCssBlock(utilityScreens, ".panic-undo"))
      .toContain("box-shadow: var(--po-elevation-low);");
    expect(readCssBlock(agentFilePresence, ".desktop-agent-file-presence"))
      .toContain("box-shadow: var(--po-elevation-low);");
    expect(csvEditor).toContain("box-shadow: var(--po-elevation-low);");
    expect(markdownEditor).toContain("box-shadow: var(--po-menu-shadow);");
    expect(readCssBlock(splitView, ".desktop-editor-pane-move-preview"))
      .toContain("box-shadow: var(--po-elevation-popover);");
  });
});

function readCssBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("}", start);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end + 1);
}

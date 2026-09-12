import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const titlebarCss = readFileSync(new URL("../../../../src/styles/titlebar.css", import.meta.url), "utf8");
const tokensCss = readFileSync(new URL("../../../../src/styles/tokens.css", import.meta.url), "utf8");
const neutralThemeCss = readFileSync(
  new URL("../../../../sub-themes/default-neutral/theme.css", import.meta.url),
  "utf8",
);
const typographyFoundationsCss = readFileSync(
  new URL("../../../../src/styles/typography/foundations.css", import.meta.url),
  "utf8",
);
const titlebarContextSource = readFileSync(
  new URL("../../../../src/features/app-shell/DesktopTitlebarContext.tsx", import.meta.url),
  "utf8",
);
const workspaceSwitcherSource = readFileSync(
  new URL("../../../../src/features/app-shell/DesktopWorkspaceSwitcher.tsx", import.meta.url),
  "utf8",
);

describe("titlebar typography architecture", () => {
  it("scopes the sky-blue titlebar surface to cloud workspaces", () => {
    const titlebarRule = readCssBlock(`\n${titlebarCss}`, ".desktop-titlebar");
    const cloudTitlebarRule = readCssBlock(
      titlebarCss,
      '.desktop-titlebar[data-workspace-kind="cloud"]',
    );

    expect(tokensCss).toContain(
      "--po-header: color-mix(in srgb, var(--po-surface-chrome) 40%, var(--po-surface-editor));",
    );
    expect(tokensCss).not.toContain("--po-cloud-titlebar-bg:");
    expect(neutralThemeCss).toContain("--po-cloud-titlebar-bg: #dbeaf1;");
    expect(neutralThemeCss).toContain("--po-cloud-titlebar-bg: #263a45;");
    expect(titlebarRule).toContain("--desktop-titlebar-bg: var(--po-header);");
    expect(titlebarRule).toContain("--po-font-size-chrome: var(--po-type-header-content);");
    expect(titlebarRule).toContain("background: var(--desktop-titlebar-bg);");
    expect(cloudTitlebarRule).toContain("--desktop-titlebar-bg: var(--po-cloud-titlebar-bg);");
    expect(cloudTitlebarRule).toContain("--desktop-titlebar-divider: var(--po-cloud-titlebar-divider);");
    expect(titlebarCss).not.toContain(".desktop-titlebar-workspace-button.cloud {");
  });

  it("keeps the titlebar divider inside the native window edge", () => {
    const titlebarRule = readCssBlock(`\n${titlebarCss}`, ".desktop-titlebar");
    const fullScreenTitlebarRule = readCssBlock(
      titlebarCss,
      '.desktop-titlebar[data-window-full-screen="true"]',
    );
    const titlebarLayoutRule = readCssBlock(titlebarCss, ".desktop-titlebar-layout");
    const dividerRule = readCssBlock(titlebarCss, ".desktop-titlebar::after");

    expect(titlebarRule).toContain("--desktop-titlebar-native-controls-inset: 80px;");
    expect(titlebarRule).toContain(
      "--desktop-titlebar-safe-area-x: var(--desktop-titlebar-native-controls-inset);",
    );
    expect(titlebarRule).toContain(
      "--desktop-titlebar-safe-area-width: calc(100% - var(--desktop-titlebar-safe-area-x));",
    );
    expect(titlebarRule).not.toContain("env(titlebar-area-");
    expect(titlebarLayoutRule).toContain("margin-left: var(--desktop-titlebar-safe-area-x);");
    expect(titlebarLayoutRule).toContain("width: var(--desktop-titlebar-safe-area-width);");
    expect(titlebarLayoutRule).toContain(
      "padding: 0 6px 0 var(--desktop-titlebar-content-start);",
    );
    expect(fullScreenTitlebarRule).toContain(
      "var(--desktop-sidebar-row-left-gap) + var(--desktop-sidebar-row-content-left)",
    );
    expect(titlebarRule).toContain("border-bottom: 0;");
    expect(dividerRule).toContain("inset-inline: 1px;");
    expect(dividerRule).toContain("inset-block-end: 0;");
    expect(dividerRule).toContain("background: var(--desktop-titlebar-divider);");
  });

  it("keeps chrome text at the shared medium-weight contract", () => {
    const typographyRoot = readCssBlock(typographyFoundationsCss, ":root");
    const layoutRoot = readCssBlock(`\n${tokensCss}`, ":root");
    const controlGeometry = readFileSync(
      new URL("../../../../packages/shared-ui/src/styles/control-geometry.css", import.meta.url),
      "utf8",
    );

    expect(typographyRoot).toContain("--po-text-weight-medium: 500;");
    expect(typographyRoot).toContain("--po-font-weight-chrome: var(--po-text-weight-medium);");
    expect(controlGeometry).toContain("--po-control-size: 32px;");
    expect(layoutRoot).toContain("--desktop-chrome-control-size: var(--po-control-size);");
    expect(layoutRoot).toContain("--desktop-toolbar-action-radius: 5px;");
    expect(layoutRoot).toContain("--desktop-titlebar-control-height: 24px;");
    expect(layoutRoot).toContain("--desktop-titlebar-tool-action-width: 34px;");
    expect(layoutRoot).toContain("--desktop-titlebar-button-gap: 3px;");
  });

  it("uses the compact titlebar height without shrinking shared sidebar controls", () => {
    const action = readCssBlock(titlebarCss, ".desktop-titlebar-action");
    const workspace = readCssBlock(titlebarCss, ".desktop-titlebar-workspace-button");
    const branch = readCssBlock(titlebarCss, ".desktop-titlebar-branch-button");

    expect(action).toContain("width: var(--desktop-chrome-control-size);");
    expect(action).toContain("height: var(--desktop-titlebar-control-height);");
    expect(action).toContain("border-radius: var(--desktop-toolbar-action-radius);");
    expect(workspace).toContain("height: var(--desktop-titlebar-control-height);");
    expect(workspace).toContain("border-radius: var(--desktop-toolbar-action-radius);");
    expect(branch).toContain("height: var(--desktop-titlebar-control-height);");
    expect(branch).toContain("border-radius: var(--desktop-toolbar-action-radius);");
  });

  it("gives the unified right-sidebar tool a wider normal-titlebar target", () => {
    const toolActions = readCssBlock(
      titlebarCss,
      ".desktop-titlebar-actions .desktop-titlebar-terminal",
    );

    expect(toolActions).toContain("width: var(--desktop-titlebar-tool-action-width);");
  });

  it("matches the collapsed explorer action to the rectangular tool target", () => {
    const explorerAction = readCssBlock(titlebarCss, ".desktop-titlebar-sidebar-expand");

    expect(explorerAction).toContain("width: var(--desktop-titlebar-tool-action-width);");
    expect(explorerAction).toContain("flex: 0 0 var(--desktop-titlebar-tool-action-width);");
  });

  it.each([
    ".desktop-titlebar-context-name",
    ".desktop-titlebar-workspace-name",
    ".desktop-titlebar-branch-button span",
  ])("binds %s to the shared chrome typography tokens", (selector) => {
    const rule = readCssBlock(titlebarCss, selector);

    expect(rule).toContain("font-size: var(--po-font-size-chrome, 13px);");
    expect(rule).toContain("font-weight: var(--po-font-weight-chrome, 500);");
    expect(rule).toContain("line-height: var(--po-type-header-line-height, 20px);");
  });

  it("keeps the project quiet and distinguishes the branch with its semantic glyph", () => {
    const context = readCssBlock(titlebarCss, ".desktop-titlebar-context");
    const projectName = readCssBlock(titlebarCss, ".desktop-titlebar-workspace-name");
    const branchButton = readCssBlock(titlebarCss, ".desktop-titlebar-branch-button");

    expect(titlebarContextSource).toContain("<GitBranch size={13}");
    expect(titlebarContextSource).not.toContain("desktop-titlebar-context-divider");
    expect(titlebarContextSource).not.toContain("VersionControlIcon");
    expect(workspaceSwitcherSource).not.toContain("desktop-titlebar-workspace-mark");
    expect(context).toContain("gap: var(--desktop-titlebar-button-gap);");
    expect(projectName).toContain("color: var(--desktop-titlebar-text-muted);");
    expect(branchButton).toContain("color: var(--desktop-titlebar-text-muted);");
  });

  it("keeps Header spacing invariant while the window crosses compact widths", () => {
    const context = readCssBlock(titlebarCss, ".desktop-titlebar-context");
    const actions = readCssBlock(titlebarCss, ".desktop-titlebar-actions");

    expect(context).toContain("gap: var(--desktop-titlebar-button-gap);");
    expect(actions).toContain("gap: var(--desktop-titlebar-button-gap);");
    expect(titlebarCss).not.toContain("@media (max-width: 720px)");
    expect(titlebarCss).not.toContain("--desktop-titlebar-button-gap: 1px;");
  });

  it("keeps branch-menu metadata quiet without introducing new type sizes", () => {
    const sectionLabel = readCssBlock(
      titlebarCss,
      ".desktop-branch-menu-group > .desktop-menu-section-label",
    );
    const currentLabel = readCssBlock(
      titlebarCss,
      ".desktop-branch-menu-row .desktop-menu-item-trailing",
    );

    expect(sectionLabel).toContain("font-size: var(--po-menu-meta-font-size);");
    expect(sectionLabel).toContain("line-height: var(--po-menu-meta-line-height);");
    expect(sectionLabel).toContain("font-weight: 600;");
    expect(sectionLabel).toContain("text-transform: none;");
    expect(currentLabel).toContain("font-weight: 500;");
    expect(currentLabel).toContain("text-transform: none;");
    expect(currentLabel).not.toContain("font-size:");
    expect(titlebarCss).not.toContain(".desktop-branch-menu-label {");
  });

  it("uses explicit Header columns and deterministic context compression", () => {
    const titlebar = readCssBlock(`\n${titlebarCss}`, ".desktop-titlebar");
    const layout = readCssBlock(titlebarCss, ".desktop-titlebar-layout");
    const context = readCssBlock(titlebarCss, ".desktop-titlebar-context");
    const project = readCssBlock(titlebarCss, ".desktop-titlebar-workspace-wrap");
    const branch = readCssBlock(titlebarCss, ".desktop-titlebar-branch-wrap");
    const branchButton = readCssBlock(titlebarCss, ".desktop-titlebar-branch-button");
    const drag = readCssBlock(titlebarCss, ".desktop-titlebar-drag-fill");
    const trailing = readCssBlock(titlebarCss, ".desktop-titlebar-trailing");

    expect(titlebar).toContain("--desktop-titlebar-drag-min-width: 32px;");
    expect(layout).toContain("display: grid;");
    expect(layout).toContain("minmax(0, max-content)");
    expect(layout).toContain("minmax(var(--desktop-titlebar-drag-min-width), 1fr)");
    expect(layout).toContain("max-content;");
    expect(context).toContain("--desktop-titlebar-workspace-max-width: 220px;");
    expect(context).toContain("--desktop-titlebar-branch-max-width: 200px;");
    expect(project).toContain("width: max-content;");
    expect(project).toContain("flex: 0 0 auto;");
    expect(branch).toContain("width: max-content;");
    expect(branch).toContain("min-width: var(--desktop-titlebar-tool-action-width);");
    expect(branch).toContain("flex: 0 1 auto;");
    expect(branchButton).toContain("width: 100%;");
    expect(drag).toContain("width: 100%;");
    expect(trailing).toContain("justify-content: end;");
  });
});

function readCssBlock(css: string, selector: string): string {
  const marker = `\n${selector} {`;
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`Missing CSS block for ${selector}`);
  const bodyStart = start + marker.length;
  const end = css.indexOf("\n}", bodyStart);
  if (end < 0) throw new Error(`Unclosed CSS block for ${selector}`);
  return css.slice(bodyStart, end);
}

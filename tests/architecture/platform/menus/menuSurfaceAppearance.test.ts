import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");

const tokens = source("src/styles/tokens.css");
const menus = source("src/styles/menus.css");
const layout = source("src/styles/layout.css");
const titlebar = source("src/styles/titlebar.css");
const fileActions = source("src/styles/file-actions.css");
const nodeActions = source("src/features/data-workspace/nodeActions.tsx");
const dataTree = source("packages/shared-ui/src/styles/data-workspace.css");
const projectSwitcher = source("src/features/app-shell/project-switcher-rail.css");
const plugins = source("src/features/plugins/plugins.css");
const agentComposer = source("src/features/desktop-agent/ui/styles/composer.css");

describe("desktop menu appearance architecture", () => {
  it("derives every popup from a chrome-emphasized Appearance surface", () => {
    const surface = readCssBlock(menus, ".desktop-titlebar-menu");

    expect(tokens).toContain(
      "--po-surface-menu: color-mix(in srgb, var(--po-header) 94%, var(--po-text) 6%);",
    );
    expect(tokens).toContain("--po-menu-bg: var(--po-surface-menu);");
    expect(tokens).toContain("--po-menu-border: var(--po-border);");
    expect(tokens.match(/--po-surface-menu:/g)).toHaveLength(1);
    expect(tokens.match(/--po-menu-bg:/g)).toHaveLength(1);
    expect(tokens.match(/--po-menu-border:/g)).toHaveLength(1);
    expect(surface).toContain("background: var(--po-menu-bg);");
    expect(surface).toContain("border: 1px solid var(--po-menu-border);");
  });

  it("keeps ordinary menu copy regular and section labels only medium", () => {
    expect(readCssBlock(menus, ".desktop-menu-section-label")).toContain(
      "font-weight: var(--po-text-weight-medium, 500);",
    );
    expect(readCssBlock(menus, ".desktop-menu-section-label")).toContain(
      "text-transform: none;",
    );

    for (const selector of [
      ".desktop-menu-item",
      ".desktop-menu-item-label",
      ".desktop-menu-item-detail",
      ".desktop-menu-item-trailing",
    ]) {
      expect(readLastCssBlock(menus, selector)).toContain(
        "font-weight: var(--po-text-weight-regular, 400);",
      );
    }
  });

  it("does not let project or create-entry menus replace shared typography or material", () => {
    expect(layout).not.toMatch(
      /\.desktop-project-menu \.desktop-menu-item(?:-label|-detail)?\s*\{[^}]*(?:font-size|font-weight):/s,
    );

    const sidebarLauncher = readCssBlock(
      fileActions,
      '.desktop-create-entry-menu.desktop-node-action-menu[data-sidebar-launcher="true"]',
    );
    expect(sidebarLauncher).not.toMatch(/(?:background|border-color|border-radius):/);
    expect(sidebarLauncher).not.toMatch(/(?:padding|box-shadow):/);
    expect(fileActions).not.toMatch(
      /\.desktop-create-entry-menu\[data-sidebar-launcher="true"\] \.desktop-menu-item\s*\{/,
    );
    expect(fileActions).not.toContain(".app-shell.dark .desktop-create-entry-menu");
    expect(fileActions).not.toContain(".desktop-overlay-root.dark .desktop-create-entry-menu");
    expect(nodeActions).toContain('elevation={sidebarLauncher ? "compact" : "default"}');
    expect(nodeActions).toContain('tone={sidebarLauncher ? "quiet" : "default"}');
    expect(nodeActions).toContain(
      'typographySurface={sidebarLauncher ? "left-sidebar" : "ui"}',
    );
  });

  it("routes richer popup implementations through the shared menu tokens", () => {
    expectSharedMenuSurface(plugins, ".desktop-plugin-menu > div");
    expectSharedMenuRow(plugins, ".desktop-plugin-menu button");
    expectSharedMenuSurface(agentComposer, ".desktop-agent-command-menu");
    expectSharedMenuRow(agentComposer, ".desktop-agent-command-menu button");
  });

  it("keeps the launcher and its owning Sidebar row active while a menu is open", () => {
    expect(tokens).toContain("--po-menu-trigger-row-open-background: var(--po-hover);");
    expect(tokens).toContain("--po-menu-trigger-open-background: var(--po-control-hover);");
    expect(nodeActions).toContain('aria-expanded={createMenuOpen}');
    expect(nodeActions).toContain('aria-expanded={nodeMenuOpen}');
    expect(dataTree).toContain(
      '.tree-row:has(.tree-row-action-button[aria-expanded="true"])',
    );
    expect(dataTree).toContain(
      "background: var(--po-menu-trigger-open-background, var(--po-control-hover));",
    );
    expect(projectSwitcher).toContain(
      '.desktop-project-switcher-rail-project-row[data-menu-open="true"]',
    );
    expect(projectSwitcher).toContain(
      "background: var(--po-menu-trigger-row-open-background, var(--desktop-project-switcher-row-hover));",
    );
  });

  it("keeps branch metadata within the shared menu weight scale", () => {
    expect(readCssBlock(
      titlebar,
      ".desktop-branch-menu-group > .desktop-menu-section-label",
    )).toContain("font-weight: var(--po-text-weight-medium, 500);");
    expect(readCssBlock(
      titlebar,
      ".desktop-branch-menu-row .desktop-menu-item-trailing",
    )).toContain("font-weight: var(--po-text-weight-regular, 400);");
  });
});

function expectSharedMenuSurface(css: string, selector: string) {
  const rule = readCssBlock(css, selector);
  expect(rule).toContain("padding: var(--po-menu-padding);");
  expect(rule).toContain("border: 1px solid var(--po-menu-border);");
  expect(rule).toContain("border-radius: var(--po-menu-radius);");
  expect(rule).toContain("background: var(--po-menu-bg);");
}

function expectSharedMenuRow(css: string, selector: string) {
  const rule = readCssBlock(css, selector);
  expect(rule).toContain("var(--po-menu-item-height)");
  expect(rule).toContain("padding: 0 var(--po-menu-item-padding-inline);");
  expect(rule).toContain("border-radius: var(--po-menu-item-radius);");
  expect(rule).toContain("font-weight: var(--po-text-weight-regular, 400);");
}

function readCssBlock(css: string, selector: string): string {
  const marker = `${selector} {`;
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`Missing CSS block for ${selector}`);
  const bodyStart = start + marker.length;
  const end = css.indexOf("}", bodyStart);
  if (end < 0) throw new Error(`Unclosed CSS block for ${selector}`);
  return css.slice(bodyStart, end);
}

function readLastCssBlock(css: string, selector: string): string {
  const marker = `${selector} {`;
  const start = css.lastIndexOf(marker);
  if (start < 0) throw new Error(`Missing CSS block for ${selector}`);
  const bodyStart = start + marker.length;
  const end = css.indexOf("}", bodyStart);
  if (end < 0) throw new Error(`Unclosed CSS block for ${selector}`);
  return css.slice(bodyStart, end);
}

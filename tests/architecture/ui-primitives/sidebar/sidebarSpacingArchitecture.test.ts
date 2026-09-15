import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tokensCss = readCss("../../../../src/styles/tokens.css");
const layoutCss = readCss("../../../../src/styles/layout.css");
const titlebarCss = readCss("../../../../src/styles/titlebar.css");
const sidebarPrimitivesCss = readCss("../../../../packages/shared-ui/src/styles/sidebar-primitives.css");
const sidebarPatternsCss = readCss("../../../../src/styles/sidebar/patterns.css");
const dataAdapterCss = readCss("../../../../src/features/data-workspace/browser.css");
const projectSwitcherCss = readCss("../../../../src/features/app-shell/project-switcher-rail.css");
const projectContextAssetMarkCss = readCss(
  "../../../../src/features/app-shell/project-context-asset-mark.css",
);
const dataShellCss = readCss("../../../../src/features/data-workspace/data-shell.css");
const dataTreeCss = readCss("../../../../packages/shared-ui/src/styles/data-workspace.css");
const dataWorkspaceSource = readFileSync(
  new URL("../../../../packages/shared-ui/src/data/DataWorkspace.tsx", import.meta.url),
  "utf8",
);
const workspaceSurfaceOutletSource = readFileSync(
  new URL("../../../../src/features/app-shell/workspace-surfaces/WorkspaceSurfaceOutlet.tsx", import.meta.url),
  "utf8",
);
const settingsSidebarSource = readFileSync(
  new URL("../../../../src/features/settings/sidebar/SettingsSidebar.tsx", import.meta.url),
  "utf8",
);
const cloudSidebarSource = readFileSync(
  new URL("../../../../src/features/cloud/CloudServiceSidebar.tsx", import.meta.url),
  "utf8",
);
const agentThemeCss = readCss("../../../../src/features/desktop-agent/ui/styles/theme.css");
const gitLayoutCss = readCss("../../../../src/features/source-control/styles/sidebar-layout.css");
const gitResourcesCss = readCss("../../../../src/features/source-control/styles/sidebar-providers.css");
const gitHistoryCss = readCss("../../../../src/features/source-control/styles/history-list.css");
const settingsCss = readCss("../../../../src/styles/settings-view.css");
const cloudSidebarCss = readCss("../../../../src/features/cloud/styles/sidebar-shell.css");
const cloudHistorySidebarCss = readCss("../../../../src/features/cloud/history/styles/sidebar.css");
const changesCss = readCss("../../../../src/features/changes/changes.css");

describe("sidebar spacing architecture", () => {
  it("keeps Workspace menu rows on the shared control geometry", () => {
    const root = compact(readCssBlock(tokensCss, ":root"));
    const workspaceMenu = compact(readCssBlock(layoutCss, ".desktop-project-menu"));

    expect(root).toContain("--desktop-sidebar-row-height: var(--po-control-size);");
    expect(root).toContain("--po-menu-item-height: var(--desktop-sidebar-row-height);");
    expect(workspaceMenu).not.toContain("--po-menu-item-height:");
  });

  it("lets Cloud History use the same full workspace rectangle as local History", () => {
    const main = compact(readCssBlock(
      cloudSidebarCss,
      ".desktop-cloud-main-view.desktop-cloud-history-main-view",
    ));
    const shell = compact(readCssBlock(
      cloudSidebarCss,
      ".desktop-cloud-history-page-shell",
    ));

    expect(main).toContain("overflow: hidden;");
    expect(main).toContain("padding: 0;");
    expect(shell).toContain("width: 100%;");
    expect(shell).toContain("height: 100%;");
    expect(shell).toContain("min-height: 0;");
    expect(shell).toContain("margin: 0;");
  });

  it("shares one visible boundary between the Explorer scrollbar and Editor", () => {
    const explorerColumn = compact(readCssBlock(dataTreeCss, ".explorer-column"));
    const explorerResizer = compact(readCssBlock(dataTreeCss, ".data-explorer-resizer"));

    const injectedSurface = compact(readCssBlock(layoutCss, ".desktop-view-surface-sidebar"));
    expect(dataWorkspaceSource).toContain("<CollapsiblePaneFrame");
    expect(dataWorkspaceSource).toContain('className="explorer-column"');
    expect(dataWorkspaceSource).toContain("renderWorkspaceSlot(explorerSlot, workspaceState)");
    expect(workspaceSurfaceOutletSource).toContain(
      'className={`desktop-view-surface desktop-view-surface-${region}`}',
    );
    expect(explorerColumn).toContain(
      "border-inline-end: 1px solid var(--po-sidebar-divider, var(--po-divider));",
    );
    expect(explorerResizer).toContain("background: transparent;");
    expect(dataTreeCss).not.toContain(".data-explorer-resizer::after");
    expect(explorerResizer).toContain("inset-inline-start: auto;");
    expect(explorerResizer).toContain(
      "inset-inline-end: calc(1px - var(--po-pane-resizer-hit-size, 8px));",
    );
    expect(injectedSurface).not.toContain("border-inline-end:");
    expect(cloudSidebarCss).not.toContain("border-inline-end:");
  });

  it("defines one visual edge contract", () => {
    const root = readCssBlock(tokensCss, ":root");
    const semanticThemeScope = readCssBlock(
      tokensCss,
      ":root,\n:where(.app-shell, .onboarding-shell, .desktop-overlay-root, .desktop-theme-preview-surface, .dark)",
    );

    expect(root).toContain("--desktop-sidebar-row-left-gap: 12px;");
    expect(root).toContain("--desktop-sidebar-row-right-gap: 12px;");
    expect(root).toContain("--desktop-sidebar-row-radius: 6px;");
    expect(root).toContain("--desktop-sidebar-row-content-left: 6px;");
    expect(root).toContain("--desktop-sidebar-row-content-right: 6px;");
    expect(root).toContain("--desktop-sidebar-list-padding-block: 8px;");
    expect(root).toContain("--desktop-sidebar-font-size: var(--po-type-left-sidebar-content);");
    expect(root).toContain("--desktop-sidebar-font-size-meta: var(--po-type-left-sidebar-meta);");
    expect(root).toContain("--desktop-sidebar-section-title-font-size: var(--po-type-left-sidebar-meta);");
    expect(root).toContain("--desktop-sidebar-section-title-font-weight: var(--po-text-weight-medium);");
    expect(root).toContain("--desktop-sidebar-section-title-line-height: var(--po-type-left-sidebar-line-height);");
    expect(semanticThemeScope).toContain(
      "--desktop-sidebar-section-title-font-size: var(--po-type-left-sidebar-meta);",
    );
    expect(semanticThemeScope).toContain(
      "--desktop-sidebar-section-title-color: var(--po-text-subtle);",
    );
    expect(semanticThemeScope).toContain(
      "--desktop-sidebar-section-title-disabled-color: var(--po-text-disabled);",
    );
    expect(semanticThemeScope).toContain(
      "--po-sidebar: color-mix(in srgb, var(--po-surface-chrome) 40%, var(--po-surface-editor));",
    );
    expect(root).toContain("--desktop-sidebar-font-weight: var(--po-text-weight-medium);");
    expect(root).toContain("--desktop-sidebar-font-weight-emphasis: 650;");
    expect(root).toContain("--desktop-sidebar-line-height: var(--po-type-left-sidebar-line-height);");
    expect(root).toContain("--desktop-sidebar-icon-label-gap: 4px;");
    expect(semanticThemeScope).toContain(
      "--po-shell-divider: color-mix(in srgb, var(--po-text) 10%, transparent);",
    );
    expect(semanticThemeScope).toContain(
      "--po-sidebar-divider: color-mix(in srgb, var(--po-text) 7.5%, transparent);",
    );
    expect(semanticThemeScope).toContain("--po-header-divider: var(--po-shell-divider);");
    expect(semanticThemeScope).toContain(
      "--po-cloud-titlebar-divider: var(--po-shell-divider);",
    );
    expect(compact(root)).toContain(compact(`
      --desktop-sidebar-scroll-right-gap: calc(
        var(--desktop-sidebar-row-right-gap) - var(--desktop-sidebar-scrollbar-width)
      );
    `));
  });

  it("uses one shared quiet divider for both sidebars", () => {
    const semanticThemeScope = readCssBlock(
      tokensCss,
      ":root,\n:where(.app-shell, .onboarding-shell, .desktop-overlay-root, .desktop-theme-preview-surface, .dark)",
    );
    const titlebar = compact(readCssBlock(titlebarCss, ".desktop-titlebar"));
    const rightSidebar = compact(readCssBlock(
      layoutCss,
      '.desktop-right-sidebar:not([data-pane-presentation="collapsed"])',
    ));
    const sharedGroupDivider = compact(readCssBlock(
      sidebarPatternsCss,
      ".po-desktop-sidebar-group + .po-desktop-sidebar-group::before",
    ));
    const sharedGroupTitle = compact(readCssBlock(
      sidebarPatternsCss,
      ".po-desktop-sidebar-group__title",
    ));
    const gitSectionTitle = compact(readCssBlock(
      gitResourcesCss,
      ".desktop-git-section-title",
    ));
    const gitSectionTitleText = compact(readCssBlock(
      gitResourcesCss,
      ".desktop-git-section-title span",
    ));
    expect(semanticThemeScope).toContain(
      "--po-shell-divider: color-mix(in srgb, var(--po-text) 10%, transparent);",
    );
    expect(semanticThemeScope).toContain(
      "--po-sidebar-divider: color-mix(in srgb, var(--po-text) 7.5%, transparent);",
    );
    expect(tokensCss.match(/--po-shell-divider:/g)).toHaveLength(1);
    expect(tokensCss.match(/--po-sidebar-divider:/g)).toHaveLength(1);
    expect(tokensCss).not.toMatch(/--po-header-divider:\s*rgba/);
    expect(titlebar).toContain("--desktop-titlebar-divider: var(--po-header-divider);");
    expect(rightSidebar).toContain(
      "border-inline-start-color: var(--po-sidebar-divider, var(--po-divider));",
    );
    expect(sharedGroupDivider).toContain(
      "background: var(--po-sidebar-divider, var(--po-divider));",
    );
    expect(sharedGroupDivider).toContain(
      "inset-inline: calc(-1 * var(--desktop-sidebar-row-left-gap)) calc(-1 * var(--desktop-sidebar-row-right-gap));",
    );
    expect(sharedGroupTitle).toContain(
      "font-size: var(--desktop-sidebar-section-title-font-size, var(--po-text-size-meta, 12px));",
    );
    expect(sharedGroupTitle).toContain(
      "font-weight: var(--desktop-sidebar-section-title-font-weight, var(--po-text-weight-medium, 500));",
    );
    expect(gitSectionTitle).toContain(
      "color: var(--desktop-sidebar-section-title-color, var(--po-text-subtle));",
    );
    expect(gitSectionTitle).toContain(
      "font-size: var(--desktop-sidebar-section-title-font-size, var(--git-font-small));",
    );
    expect(gitSectionTitle).toContain(
      "font-weight: var(--desktop-sidebar-section-title-font-weight, var(--git-weight-regular));",
    );
    expect(gitSectionTitle).toContain(
      "line-height: var(--desktop-sidebar-section-title-line-height, var(--git-line-height));",
    );
    expect(gitSectionTitleText).toContain(
      "font-size: var(--desktop-sidebar-section-title-font-size, var(--git-font-small));",
    );
    expect(cloudSidebarSource).toContain("<SidebarScrollArea>");
    expect(cloudSidebarCss).not.toContain(".desktop-cloud-sidebar-list");
    expect(cloudSidebarCss).not.toContain(".desktop-cloud-sidebar-nav-row");
    expect(cloudSidebarCss).not.toContain(".desktop-cloud-sidebar-nav-row.locked");
    expect(settingsSidebarSource).toContain("<SidebarGroup");
    expect(cloudSidebarSource).toContain("<SidebarGroup");
    expect(settingsCss).not.toContain("desktop-settings-sidebar-group");
    expect(cloudSidebarCss).not.toContain("desktop-cloud-sidebar-separator");
    expect(cloudHistorySidebarCss).not.toContain(".desktop-cloud-history-sidebar-header");
    expect(cloudHistorySidebarCss).not.toContain(".desktop-cloud-history-sidebar-footer");
  });

  it("keeps top and bottom navigation on one scroll-aware edge contract", () => {
    const sharedFooter = compact(readCssBlock(dataTreeCss, ".data-explorer-footer"));
    const bottomPlacement = compact(readCssBlock(
      dataShellCss,
      '.desktop-data-workspace-wrap[data-sidebar-navigation-placement="bottom"]',
    ));
    const sharedFadeGeometry = compact(readCssBlock(
      dataShellCss,
      '.desktop-data-workspace-wrap[data-sidebar-navigation-placement="top"] .explorer-tree-shell::before,\n.desktop-data-workspace-wrap[data-sidebar-navigation-placement="bottom"] .explorer-tree-shell::after',
    ));
    const topFade = compact(readCssBlock(
      dataShellCss,
      '.desktop-data-workspace-wrap[data-sidebar-navigation-placement="top"] .explorer-tree-shell::before',
    ));

    expect(sharedFooter).toContain(
      "border-block-start: var(--data-explorer-footer-divider-width, 1px) solid var(--po-sidebar-divider, var(--po-divider));",
    );
    expect(bottomPlacement).toContain("--data-explorer-footer-divider-width: 0px;");
    expect(dataShellCss).not.toContain(".data-explorer-footer:has(");
    expect(sharedFadeGeometry).toContain(
      "height: calc(var(--desktop-sidebar-navigation-fade-size) * var(--tree-edge-fade-top, 0));",
    );
    expect(topFade).toContain("opacity: var(--tree-edge-fade-top, 0);");
    expect(dataShellCss).toMatch(
      /\.desktop-data-workspace-wrap\[data-sidebar-navigation-placement="bottom"\] \.explorer-tree-shell::after\s*\{[^}]*height:\s*calc\(var\(--desktop-sidebar-navigation-fade-size\) \* var\(--tree-edge-fade-bottom, 0\)\);[^}]*opacity:\s*var\(--tree-edge-fade-bottom, 0\);/s,
    );
  });

  it("maps the Data tree onto the shared edge contract", () => {
    const adapter = readCssBlock(dataAdapterCss, ".desktop-data-workspace-wrap");
    const projectRail = readCssBlock(projectSwitcherCss, ".desktop-project-switcher-rail");
    const projectRailButton = readCssBlock(
      projectSwitcherCss,
      ".desktop-project-switcher-rail-button",
    );
    const projectRailList = readCssBlock(
      projectSwitcherCss,
      ".desktop-project-switcher-rail-list",
    );
    const list = compact(readCssBlock(dataTreeCss, ".explorer-tree-list"));
    const treeShell = compact(readCssBlock(dataTreeCss, ".explorer-tree-shell"));
    const treeRow = compact(readCssBlock(dataTreeCss, ".tree-row"));
    const treeRowAction = compact(readCssBlock(dataTreeCss, ".tree-row-action-button"));
    const treeRowActionIcon = compact(readCssBlock(dataTreeCss, ".tree-row-action-button > svg"));
    const workspaceGroupHeader = compact(readCssBlock(
      dataTreeCss,
      ".tree-row.workspace-folder-root.workspace-group-header",
    ));
    const workspaceGroupDivider = compact(readCssBlock(dataTreeCss, ".tree-workspace-group-divider"));

    expect(adapter).toContain("--po-tree-row-left-gap: var(--desktop-sidebar-row-left-gap);");
    expect(adapter).toContain("--po-tree-row-right-gap: var(--desktop-sidebar-row-right-gap);");
    expect(adapter).toContain("--po-tree-row-radius: var(--desktop-sidebar-row-radius);");
    expect(adapter).toContain("--po-tree-root-top-gap: var(--desktop-sidebar-row-left-gap);");
    expect(adapter).toContain("--po-tree-no-root-top-gap: var(--desktop-sidebar-row-left-gap);");
    expect(adapter).toContain("--po-tree-list-bottom-gap: var(--desktop-sidebar-list-padding-block);");
    expect(adapter).toContain("--po-tree-row-icon-label-gap: var(--desktop-sidebar-icon-label-gap);");
    expect(dataAdapterCss).toContain(`.app-shell.dark :is(
  .desktop-project-switcher-rail,
  .desktop-data-workspace-wrap .explorer-column
)`);
    expect(projectSwitcherCss).toContain("gap: 6px;");
    expect(projectRail).toContain(
      "--desktop-project-switcher-button-size: var(--desktop-sidebar-row-height);",
    );
    expect(projectRail).toContain(
      "--desktop-project-switcher-compact-inline-padding: var(--desktop-sidebar-row-left-gap);",
    );
    expect(projectRail).toContain("--desktop-project-switcher-avatar-size: 18px;");
    expect(projectRailButton).toContain("width: 100%;");
    expect(projectRailButton).toContain("height: var(--desktop-sidebar-row-height);");
    expect(projectRailButton).toContain("margin: 1px 0;");
    expect(projectRailButton).toContain("justify-content: flex-start;");
    expect(projectRailButton).toContain("gap: 6px;");
    expect(projectSwitcherCss).toMatch(
      /\.desktop-project-switcher-rail-create\s*\{[^}]*color:\s*color-mix\(in srgb, var\(--po-text-subtle\) 68%, var\(--po-sidebar\)\);[^}]*font-size:\s*var\(--po-type-ui-meta, 13px\);[^}]*font-weight:\s*var\(--desktop-sidebar-font-weight\);/s,
    );
    expect(projectRailList).toContain("justify-items: stretch;");
    expect(projectRailList).toContain("var(--desktop-sidebar-row-left-gap)");
    expect(projectRailList).toContain("var(--desktop-sidebar-scroll-right-gap);");
    expect(projectSwitcherCss).not.toContain("clip-path:");
    expect(projectSwitcherCss).toMatch(
      /\.desktop-project-switcher-rail:not\(\[data-expanded="true"\]\)[^{]+\.desktop-project-switcher-rail-list\s*\{[^}]*grid-template-columns:\s*var\(--desktop-project-switcher-button-size\);[^}]*padding-inline:\s*var\(--desktop-project-switcher-compact-inline-padding\);[^}]*scrollbar-gutter:\s*auto;/s,
    );
    expect(projectSwitcherCss).toMatch(
      /\.desktop-project-switcher-rail:not\(\[data-expanded="true"\]\)[^{]+\.desktop-project-switcher-rail-button\s*\{[^}]*width:\s*var\(--desktop-project-switcher-button-size\);[^}]*padding:\s*0;[^}]*justify-content:\s*center;/s,
    );
    expect(projectSwitcherCss).not.toContain("var(--desktop-chrome-height)");
    expect(projectSwitcherCss).not.toContain(".desktop-project-switcher-rail-button::after");
    expect(readCssBlock(
      projectSwitcherCss,
      ".desktop-project-switcher-rail-label",
    )).not.toContain("transform:");
    expect(projectSwitcherCss).toMatch(
      /\.desktop-project-switcher-rail-project\[aria-current="page"\]\s*\{[^}]*background:\s*var\(--desktop-project-switcher-row-hover\);/s,
    );
    expect(projectSwitcherCss).toMatch(
      /\.desktop-project-switcher-rail-avatar-stack\s*\{[^}]*width:\s*var\(--desktop-project-switcher-avatar-size\);[^}]*height:\s*var\(--desktop-project-switcher-avatar-size\);[^}]*overflow:\s*visible;/s,
    );
    expect(projectSwitcherCss).toMatch(
      /\.desktop-project-switcher-rail-identity-badge\s*\{[^}]*position:\s*absolute;[^}]*width:\s*14px;[^}]*height:\s*14px;[^}]*font-size:\s*var\(--po-type-ui-micro, 11px\);/s,
    );
    expect(projectSwitcherCss).toMatch(
      /\.desktop-project-switcher-rail-context-avatar,[^{]+\{[^}]*border-radius:\s*0;[^}]*overflow:\s*visible;[^}]*background:\s*transparent;/s,
    );
    expect(projectSwitcherCss).not.toContain(".desktop-project-switcher-rail-project::before");
    expect(projectSwitcherCss).toContain(
      ".desktop-project-switcher-rail-avatar:not(.desktop-project-switcher-rail-context-avatar)",
    );
    expect(projectContextAssetMarkCss).toMatch(
      /\[data-context-asset-kind="cloud"\]\s*\{[^}]*color:\s*color-mix\(in srgb, var\(--po-accent\) 76%, var\(--po-text-muted\)\);/s,
    );
    expect(compact(projectSwitcherCss)).toContain(compact(`
      .desktop-project-switcher-rail:not([data-expanded="true"])
        .desktop-project-switcher-rail-utilities.desktop-sidebar-navigation-surface {
        --desktop-project-switcher-compact-utilities-height: calc(
          2 * var(--desktop-sidebar-virtual-row-size)
          + var(--desktop-sidebar-list-padding-block)
        );

        flex: 0 0 var(--desktop-project-switcher-compact-utilities-height);
        align-items: flex-start;
        justify-content: flex-start;
        min-height: var(--desktop-project-switcher-compact-utilities-height);
        padding-block: 0 var(--desktop-sidebar-list-padding-block);
        padding-inline: var(--desktop-project-switcher-compact-inline-padding);
      }
    `));
    expect(compact(projectSwitcherCss)).toContain(compact(`
      .desktop-project-switcher-rail:not([data-expanded="true"])
        .desktop-project-switcher-rail-utilities
        .desktop-sidebar-footer-actions {
        width: var(--desktop-project-switcher-button-size);
        flex-direction: column-reverse;
        align-items: stretch;
        gap: 0;
      }
    `));
    expect(adapter).toContain("--po-tree-row-font-size: var(--po-type-left-sidebar-content);");
    expect(adapter).toContain("--po-tree-row-font-weight: var(--desktop-sidebar-font-weight);");
    expect(adapter).toContain("--po-tree-row-line-height: var(--po-type-left-sidebar-line-height);");
    expect(adapter).toContain("--po-tree-workspace-group-color: var(--desktop-sidebar-section-title-color);");
    expect(adapter).toContain("--po-tree-workspace-group-font-size: var(--po-type-left-sidebar-content);");
    expect(adapter).toContain("--po-tree-workspace-group-font-weight: var(--desktop-sidebar-section-title-font-weight);");
    expect(workspaceGroupHeader).toContain("color: var(--tree-workspace-group-color);");
    expect(workspaceGroupHeader).toContain("font-size: var(--tree-workspace-group-font-size);");
    expect(workspaceGroupHeader).toContain("font-weight: var(--tree-workspace-group-font-weight);");
    expect(workspaceGroupDivider).toContain("background: var(--tree-workspace-group-divider);");
    expect(workspaceGroupDivider).toContain("min-width: 18px;");
    expect(treeRow).toContain("font-size: var(--tree-row-font-size);");
    expect(treeRow).toContain("font-weight: var(--tree-row-font-weight);");
    expect(treeRow).toContain("line-height: var(--tree-row-line-height);");
    expect(treeShell).toContain("--tree-row-action-size: var(--po-tree-row-action-size, 24px);");
    expect(treeShell).toContain("--tree-row-action-icon-size: var(--po-tree-row-action-icon-size, 15px);");
    expect(treeRowAction).toContain("width: var(--tree-row-action-size);");
    expect(treeRowAction).toContain("height: var(--tree-row-action-size);");
    expect(treeRowActionIcon).toContain("width: var(--tree-row-action-icon-size);");
    expect(treeRowActionIcon).toContain("height: var(--tree-row-action-icon-size);");
    expect(list).toContain("padding-block: 0 var(--tree-list-bottom-gap);");
    expect(list).toContain(compact(`
      padding-inline: var(--tree-row-left-gap)
        calc(var(--tree-row-right-gap) - var(--tree-scrollbar-width));
    `));
  });

  it("reveals low-frequency tree actions only on hover or keyboard focus", () => {
    expect(dataTreeCss).toContain(
      ".tree-row:hover .tree-row-actions,\n.tree-row:focus-visible .tree-row-actions,\n.tree-row:has(.tree-row-action-button:focus-visible) .tree-row-actions",
    );
    expect(dataTreeCss).toContain(
      ".tree-row:has(.tree-row-action-button:focus-visible) .tree-row-content",
    );
    expect(dataTreeCss).not.toContain(".tree-row.active .tree-row-actions");
    expect(dataTreeCss).not.toContain(".tree-row:focus-within .tree-row-actions");
    expect(dataTreeCss).not.toContain(".tree-row.active:has(.tree-row-actions) .tree-row-content");
    expect(dataTreeCss).not.toContain(".tree-row:focus-within:has(.tree-row-actions) .tree-row-content");
  });

  it("keeps Data row colors authoritative while Agent mirrors them one way", () => {
    const treeShell = compact(readCssBlock(dataTreeCss, ".explorer-tree-shell"));
    const agentBoundary = compact(readCssBlock(
      agentThemeCss,
      ".desktop-agent-boundary,\n.desktop-agent-overlay",
    ));

    expect(treeShell).toContain(
      "--tree-row-hover-bg: var(--po-tree-row-hover-bg, color-mix(in srgb, var(--po-hover) 86%, transparent));",
    );
    expect(treeShell).toContain(
      "color-mix(in srgb, var(--po-selected) 96%, transparent) 0%",
    );
    expect(tokensCss).not.toContain("--desktop-sidebar-row-hover-bg");
    expect(tokensCss).not.toContain("--desktop-sidebar-row-selected-bg");
    expect(dataAdapterCss).not.toContain("--po-tree-row-hover-bg:");
    expect(dataAdapterCss).not.toContain("--po-tree-row-selected-bg:");
    expect(agentBoundary).toContain(
      "--agent-row-hover-surface: color-mix(in srgb, var(--po-hover) 86%, transparent);",
    );
    expect(agentBoundary).not.toContain("--po-tree-row-hover-bg:");
    expect(agentBoundary).not.toContain("--po-tree-row-selected-bg:");
  });

  it("draws every ancestor guide column with one depth-bounded layer", () => {
    const guide = compact(readCssBlock(
      dataTreeCss,
      '.explorer-tree-motion-shell:not([data-depth="0"])::before',
    ));

    expect(guide).toContain(compact(`
      left: calc(
        var(--tree-row-content-left)
        + var(--tree-icon-slot-size) / 2
      );
    `));
    expect(guide).toContain(
      "width: calc(var(--depth, 0) * var(--tree-row-indent));",
    );
    expect(guide).toContain(compact(`
      background-image: linear-gradient(
        to right,
        var(--po-tree-guide) 0 1px,
        transparent 1px
      );
    `));
    expect(guide).toContain("background-repeat: repeat-x;");
    expect(guide).toContain("background-size: var(--tree-row-indent) 100%;");
    expect(guide).not.toContain("- var(--tree-row-indent)");
  });

  it("keeps Settings on the shared scroll-list padding", () => {
    const list = compact(readCssBlock(sidebarPrimitivesCss, ".po-sidebar-scroll-area"));

    expect(list).toContain("padding-block: var(--desktop-sidebar-list-padding-block);");
    expect(list).toContain(
      "padding-inline: var(--desktop-sidebar-row-left-gap) var(--desktop-sidebar-scroll-right-gap);",
    );
    expect(settingsCss).not.toMatch(/\.desktop-settings-sidebar\s+\.po-sidebar-scroll-area\s*\{/);
  });

  it("keeps Git edges shared while nested lists own scrolling", () => {
    const wrapper = compact(readCssBlock(gitLayoutCss, ".desktop-git-sidebar-list"));
    const historyList = compact(readCssBlock(gitHistoryCss, ".desktop-history-list"));
    const historyScroll = compact(readCssBlock(gitHistoryCss, ".desktop-history-virtual-list"));

    expect(wrapper).toContain("padding-block: var(--desktop-sidebar-list-padding-block) 0;");
    expect(wrapper).toContain("padding-inline: 0;");
    expect(wrapper).toContain("scrollbar-gutter: auto;");
    expect(historyList).toContain("padding: 8px 10px 12px;");
    expect(historyScroll).toContain("overflow: auto;");
    expect(historyScroll).toContain("scrollbar-gutter: stable;");
  });

  it("keeps every remaining page-level sidebar on the shared block edge", () => {
    expect(cloudSidebarCss).not.toContain(".desktop-cloud-sidebar-list");
    expectBlockPadding(changesCss, ".review-list", "0");
  });
});

function readCss(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function readCssBlock(css: string, selector: string): string {
  const match = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(selector)}\\s*\\{`).exec(css);
  if (!match) throw new Error(`Missing CSS block for ${selector}`);
  const bodyStart = match.index + match[0].length;
  const close = /\n\s*}/.exec(css.slice(bodyStart));
  if (!close) throw new Error(`Unclosed CSS block for ${selector}`);
  return css.slice(bodyStart, bodyStart + close.index);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function expectBlockPadding(css: string, selector: string, inlinePadding: string) {
  const rule = compact(readCssBlock(css, selector));
  expect(rule).toContain("padding-block: var(--desktop-sidebar-list-padding-block);");
  expect(rule).toContain(`padding-inline: ${inlinePadding};`);
}

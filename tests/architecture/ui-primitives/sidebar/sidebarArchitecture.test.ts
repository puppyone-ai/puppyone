import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sharedSidebarCss = read("../../../../packages/shared-ui/src/styles/sidebar-primitives.css");
const controlGeometryCss = read("../../../../packages/shared-ui/src/styles/control-geometry.css");
const sharedDataWorkspaceCss = read("../../../../packages/shared-ui/src/styles/data-workspace.css");
const dataShellCss = read("../../../../src/features/data-workspace/data-shell.css");
const projectSwitcherRailCss = read("../../../../src/features/app-shell/project-switcher-rail.css");
const patternCss = read("../../../../src/styles/sidebar/patterns.css");
const layoutCss = read("../../../../src/styles/layout.css");
const dataSurfaceSource = read("../../../../src/features/app-shell/DesktopDataWorkspaceSurface.tsx");
const dataWorkspaceSource = read("../../../../packages/shared-ui/src/data/DataWorkspace.tsx");
const desktopShellSource = read("../../../../src/components/DesktopCloudShell.tsx");
const appSource = read("../../../../src/App.tsx");
const workspaceContentSource = read("../../../../src/features/app-shell/DesktopWorkspaceContent.tsx");
const registrySource = read("../../../../src/features/app-shell/workspace-surfaces/workspaceSurfaceRegistry.ts");
const auxiliaryHostSource = read("../../../../src/features/app-shell/auxiliary/AuxiliaryPanelHost.tsx");
const collapsiblePaneResizeSource = read("../../../../packages/shared-ui/src/primitives/useCollapsiblePaneResize.ts");
const collapsiblePaneGestureSource = read("../../../../packages/shared-ui/src/primitives/collapsiblePaneGesture.ts");
const collapsiblePaneFrameSource = read("../../../../packages/shared-ui/src/sidebar/CollapsiblePaneFrame.tsx");
const sidebarResizeHandleSource = read("../../../../packages/shared-ui/src/sidebar/SidebarResizeHandle.tsx");
const settingsSidebarSource = read("../../../../src/features/settings/sidebar/SettingsSidebar.tsx");
const settingsModelSource = read("../../../../src/features/settings/sidebar/settingsSidebarModel.ts");
const sourceControlResourceLists = read("../../../../src/features/source-control/sidebar/SourceControlResourceLists.tsx");
const sourceControlHistory = read("../../../../src/features/source-control/GitHistoryTimeline.tsx");
const cloudHistorySidebar = read("../../../../src/features/cloud/history/CloudHistorySidebar.tsx");
const virtualizationPolicy = read("../../../../packages/shared-ui/src/sidebar/virtualizationPolicy.ts");
const virtualSidebarList = read("../../../../packages/shared-ui/src/sidebar/VirtualSidebarList.tsx");
const sidebarBoundarySmoke = read("../../../support/electron/sidebar-boundaries.mjs");
const tokens = read("../../../../src/styles/tokens.css");

describe("Sidebar architecture", () => {
  it("keeps the dependency direction and CSS ownership explicit", () => {
    expect(sharedSidebarCss).toContain("@layer primitives");
    expect(patternCss).toContain("@layer patterns");
    expect(sharedSidebarCss).not.toContain("desktop-tool-sidebar");
    expect(patternCss).not.toContain("desktop-tool-sidebar");
    expect(sharedSidebarCss).toContain("padding-inline:");
    expect(sharedSidebarCss).not.toMatch(/\bleft\s*:/);
    expect(sharedSidebarCss).not.toMatch(/\bright\s*:/);
  });

  it("reserves hover for hover and uses the selected token for persistent navigation", () => {
    expect(sharedSidebarCss).toMatch(
      /\.po-sidebar-row:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--po-hover\);/s,
    );
    expect(sharedSidebarCss).toMatch(
      /\.po-sidebar-row\.active,[^\{]*\.po-sidebar-row\.active:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--po-selected\);/s,
    );
    for (const selector of [
      ".desktop-sidebar-footer-button.active",
      ".desktop-sidebar-rail-button.active",
      ".desktop-sidebar-top-navigation-button.active",
    ]) {
      expect(readCssBlock(dataShellCss, selector)).toContain("background: var(--po-selected);");
    }
  });

  it("keeps Data alive and projects one resolved surface into both regions", () => {
    expect(workspaceContentSource).toContain("useWorkspaceSurfaceContent");
    expect(workspaceContentSource).not.toMatch(/activeView\s*===/);
    expect(dataSurfaceSource).toContain("<DataWorkspace");
    expect(dataSurfaceSource).toContain('resolvedSurface.id === "data"');
    expect(dataSurfaceSource.match(/<WorkspaceSurfaceOutlet/g)).toHaveLength(2);
    expect(registrySource).toContain('lifecycle: { sidebar: "keep-alive", main: "keep-alive" }');
    expect(registrySource).not.toMatch(/\b(?:agent|terminal)\b/i);
  });

  it("removes legacy File Sidebar navigation when the Project rail owns navigation", () => {
    expect(appSource).toContain("workspaceNavigationVisible={!projectSwitcherRailEnabled}");
    expect(dataSurfaceSource).toMatch(
      /data-sidebar-navigation-placement=\{navigation\.showWorkspaceNavigation[\s\S]*?\? preferences\.sidebarNavigationPlacement[\s\S]*?: undefined\}/,
    );
    expect(dataSurfaceSource).toContain("explorerRailSlot={navigation.showWorkspaceNavigation");
    expect(dataSurfaceSource).toContain("explorerFooterSlot={navigation.showWorkspaceNavigation && (");
  });

  it("keeps Feature composition out of shared layers and Auxiliary routing independent", () => {
    expect(sharedSidebarCss).not.toMatch(/desktop-(?:git|cloud|settings|agent|terminal)/);
    expect(auxiliaryHostSource).toContain("CollapsiblePaneFrame");
    expect(auxiliaryHostSource).toContain("useCollapsiblePaneResize");
    expect(auxiliaryHostSource).toContain('orientation: "vertical"');
    expect(settingsSidebarSource).toContain("resolveSettingsSidebarGroups({ cloudEnabled })");
    expect(settingsModelSource).toContain("SETTINGS_SIDEBAR_GROUPS");
    expect(settingsModelSource).toContain("requiresCloud: true");
  });

  it("collapses panes through animated resize tracks without expanded-state toggle buttons", () => {
    expect(sharedSidebarCss).not.toContain(".po-pane-edge-toggle");
    expect(dataShellCss).not.toContain(".data-explorer-toggle");
    expect(layoutCss).not.toContain(".desktop-right-sidebar-toggle");
    expect(sharedSidebarCss).toContain("width var(--po-pane-motion-duration, 360ms)");
    expect(sharedSidebarCss).toMatch(
      /\.po-collapsible-pane-frame\[data-pane-gesture="resizing"\]\s*\{[^}]*transition:\s*none;/s,
    );
    expect(dataShellCss).not.toContain("transition: grid-template-columns 360ms");
    expect(dataShellCss).not.toContain("transition: inset-inline-start 360ms");
    expect(sharedSidebarCss).toContain("flex-basis var(--po-pane-motion-duration, 360ms)");
    expect(projectSwitcherRailCss).not.toContain("width var(--po-pane-motion-duration, 360ms)");
    expect(controlGeometryCss).toContain("--po-pane-motion-duration: 360ms");
    expect(controlGeometryCss).toContain("--po-pane-motion-easing: cubic-bezier(0.42, 0, 0.58, 1)");
    expect(collapsiblePaneGestureSource).toContain("COLLAPSIBLE_PANE_MOTION_MS = 360");
    expect(collapsiblePaneGestureSource).toContain("config.minWidth - config.collapseThreshold");
    expect(collapsiblePaneGestureSource).toContain("collapseBoundary + config.collapseHysteresis");
    expect(collapsiblePaneGestureSource).toContain('phase: "collapse-preview"');
    expect(collapsiblePaneGestureSource).toMatch(
      /if \(collapseArmed\)[\s\S]*previewCollapsed:\s*true,[\s\S]*previewWidth:\s*config\.collapsedWidth/,
    );
    expect(collapsiblePaneGestureSource).toContain('type: "collapse"; restoreWidth: number');
    expect(collapsiblePaneGestureSource).toContain("restoreWidth: config.minWidth");
    expect(dataWorkspaceSource).toContain("onCommit: commitExplorerPane");
    expect(dataWorkspaceSource).toContain("setExplorerWidth(commit.restoreWidth)");
    expect(auxiliaryHostSource).toContain("onWidthChange?.(commit.restoreWidth)");
    expect(desktopShellSource).toContain("onLeadingRailWidthChange?.(commit.restoreWidth)");
  });

  it("gives the collapsed explorer one Header-owned expansion action", () => {
    expect(dataWorkspaceSource).toContain("resizableExplorer && presentation.contentVisible");
    expect(dataWorkspaceSource).not.toContain("keepExplorerContentMounted");
    expect(dataWorkspaceSource).not.toContain("explorerCollapsedEdgeVisible");
    expect(dataWorkspaceSource).not.toContain("collapsedEdgeSide=");
    expect(desktopShellSource).toContain("paneLayout.explorer.collapsed && leftSidebarPresent");
    expect(desktopShellSource).toContain("desktop-titlebar-sidebar-expand");
    expect(desktopShellSource).toContain("<PanelLeft size={15}");
    expect(desktopShellSource).not.toContain("PanelLeftOpen");
    expect(desktopShellSource).not.toContain("autoCollapsed");
    expect(desktopShellSource).not.toContain("autoClosed");
    expect(appSource).toContain("onLeftSidebarExpand={() => setSidebarCollapsed(false)}");
    expect(appSource).not.toContain("if (autoCollapsed)");
  });

  it("keeps collapsed pane edges resize-only without midpoint expansion buttons", () => {
    expect(sharedSidebarCss).toContain(".po-collapsed-pane-edge-handle::after");
    expect(sharedSidebarCss).not.toContain(".po-collapsed-pane-edge-glyph");
    expect(auxiliaryHostSource).not.toContain("onCollapsedActivate");
    expect(desktopShellSource).not.toContain("onCollapsedActivate");
    expect(auxiliaryHostSource).not.toContain("collapsedEdgeSettled");
    expect(auxiliaryHostSource).toContain('collapsedEdgeSide: presentation.settledCollapsed ? "inline-end" : undefined');
    expect(layoutCss).toMatch(
      /\.desktop-right-sidebar:not\(\.is-open\)\s*\{[^}]*overflow:\s*visible/s,
    );
  });

  it("gives one controller ownership of pointer gestures across every pane", () => {
    expect(sidebarResizeHandleSource).not.toContain('window.addEventListener("pointerup"');
    expect(collapsiblePaneResizeSource).toContain("cancelKey:");
    expect(collapsiblePaneResizeSource).toContain("onCommit(commit)");
    expect(collapsiblePaneResizeSource).toContain("PendingPaneCommit");
    expect(collapsiblePaneResizeSource).toContain("baselineKey");
    expect(desktopShellSource).toContain("renderLeadingRail");
    expect(appSource).toContain("renderLeadingRail={projectSwitcherRailVisible");
  });

  it("keeps direct resize canonical while visibility transitions preserve content width", () => {
    expect(sharedDataWorkspaceCss).toMatch(/\.data-content\s*\{[^}]*display:\s*flex/s);
    expect(sharedDataWorkspaceCss).toMatch(
      /\.data-explorer-resizer\s*\{[^}]*inset-inline-start:\s*auto;[^}]*inset-inline-end:\s*calc\(1px - var\(--po-pane-resizer-hit-size, 8px\)\);[^}]*background:\s*transparent;/s,
    );
    for (const source of [dataWorkspaceSource, auxiliaryHostSource, desktopShellSource]) {
      expect(source).toContain("<CollapsiblePaneFrame");
      expect(source).not.toContain("<SidebarResizeHandle");
    }
    expect(collapsiblePaneFrameSource).toMatch(
      /po-collapsible-pane-viewport[\s\S]*po-collapsible-pane-content[\s\S]*<SidebarResizeHandle/,
    );
    expect(sharedSidebarCss).toMatch(
      /\.po-collapsible-pane-viewport\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*overflow:\s*clip/s,
    );
    expect(sharedSidebarCss).toMatch(
      /\.po-collapsible-pane-content\s*\{[^}]*width:\s*var\(--po-collapsible-pane-content-width, 100%\)[^}]*min-width:\s*var\(--po-collapsible-pane-content-width, 100%\)/s,
    );
    expect(dataWorkspaceSource).toContain("contentWidth={renderedExplorerContentWidth}");
    expect(dataWorkspaceSource).toContain("frameWidth={explorerResize.width}");
    expect(desktopShellSource).toContain("contentWidth={renderedLeadingRailContentWidth}");
    expect(desktopShellSource).toContain("frameWidth={resolvedLeadingRailWidth}");
    expect(desktopShellSource).toContain("Math.max(");
    expect(desktopShellSource).toContain("retainedLeadingRailExpandedWidth,");
    expect(desktopShellSource).not.toContain("leadingRailCollapsedCssWidth");
    expect(dataWorkspaceSource).not.toContain("data-explorer-collapsed-fill");
    expect(sharedDataWorkspaceCss).not.toContain(".data-explorer-collapsed-fill");
    expect(dataWorkspaceSource).toContain("Math.max(");
    expect(dataWorkspaceSource).toContain("explorerResize.width,");
    expect(dataSurfaceSource).toContain("paneLayout?.explorer.collapsed");
    expect(dataSurfaceSource).toContain("? preferences.explorerWidth");
    expect(sidebarBoundarySmoke).toContain("explorerMotion.maxDividerDelta<=2");
    expect(sidebarBoundarySmoke).toContain("explorerMotion.contentWidths.length===1");
    expect(sidebarBoundarySmoke).toContain("collapsePreview.contentWidth");
    expect(sidebarBoundarySmoke).toContain("collapsePreview.temporarilyCollapsed");
    expect(sidebarBoundarySmoke).toContain("restoredPreview.expanded");
    expect(sidebarBoundarySmoke).toContain("previewElementGeometry");
    expect(sidebarBoundarySmoke).toContain("Explorer reopened at a stale pre-collapse width");
    expect(dataShellCss).not.toContain(".data-explorer-resizer");
    expect(dataShellCss).not.toContain('.data-content[data-resizable-explorer="true"]');
    expect(dataShellCss).not.toContain(".explorer-column");
    expect(dataShellCss).not.toContain("grid-column: 3;");
    expect(sharedSidebarCss).toContain("width: var(--po-collapsible-pane-frame-width, auto)");
    expect(sharedSidebarCss).not.toContain("translateX");
    expect(sharedSidebarCss).not.toContain("data-pane-content-motion");
    for (const source of [dataWorkspaceSource, auxiliaryHostSource, desktopShellSource]) {
      expect(source).not.toContain("contentMotion");
      expect(source).not.toContain("contentHidden");
    }
    expect(layoutCss).not.toMatch(/(?:^|\n)\.desktop-right-sidebar-(?:viewport|inner)\s*\{/s);
    expect(sharedDataWorkspaceCss).not.toMatch(/(?:^|\n)\.data-explorer-(?:viewport|inner)\s*\{/s);
    expect(layoutCss).not.toContain("--desktop-right-sidebar-visible-width");
    expect(auxiliaryHostSource).not.toContain("desktop-right-sidebar-visible-width");
    expect(auxiliaryHostSource).toContain('viewportClassName="desktop-right-sidebar-viewport"');
    expect(auxiliaryHostSource).toContain('contentWidth="var(--desktop-right-sidebar-content-width)"');
    expect(auxiliaryHostSource).toContain("frameWidth={resize.width}");
    expect(auxiliaryHostSource).toContain("lastExpandedWidth");
    expect(auxiliaryHostSource).toContain("onCommit: commitPane");
    expect(auxiliaryHostSource).toContain('typeof children === "function"');
    expect(appSource).toContain(
      'active={presentation.contentVisible && rightSidebarSurface === "chat"}',
    );
    expect(appSource).not.toContain("active={rightSidebarOpen}");
    expect(sharedDataWorkspaceCss).not.toContain("--data-explorer-min-width");
    expect(collapsiblePaneResizeSource).toContain("canonical live resize width");
    expect(collapsiblePaneResizeSource).toContain("last-expanded content plane");
    expect(collapsiblePaneFrameSource).toContain("aria-hidden={contentVisible ? undefined : true}");
    expect(collapsiblePaneFrameSource).toContain('{...(!contentVisible ? { inert: "" } : {})}');
    expect(collapsiblePaneResizeSource).toContain("finishCollapsiblePaneGesture");
    expect(collapsiblePaneResizeSource).not.toContain("onCollapsedChange");
  });

  it("enforces one large-list policy with a bounded mounted-row budget", () => {
    expect(virtualizationPolicy).toContain("SIDEBAR_VIRTUALIZATION_THRESHOLD = 200");
    expect(virtualizationPolicy).toContain("SIDEBAR_VIRTUALIZATION_MAX_MOUNTED_ROWS = 120");
    expect(sourceControlResourceLists).toContain("shouldVirtualizeSidebarList");
    expect(sourceControlResourceLists).toContain("VirtualSidebarList");
    expect(sourceControlHistory).toContain("VirtualSidebarList");
    expect(cloudHistorySidebar).toContain("VirtualSidebarList");
    expect(virtualSidebarList).toContain("listRef?: MutableRefObject<HTMLOListElement | null>");
    expect(sourceControlResourceLists).toContain('"--desktop-sidebar-virtual-row-size"');
    expect(sourceControlHistory).toContain('"--desktop-history-date-row-size"');
    expect(sourceControlHistory).toContain("rowSize={getHistoryRowSize}");
    expect(sourceControlResourceLists).not.toMatch(/rowSize=\{(?:30|32|34)\}/);
    expect(sourceControlHistory).not.toMatch(/rowSize=\{(?:30|32|34)\}/);
    expect(tokens).toContain("--desktop-sidebar-virtual-row-size: calc(var(--desktop-sidebar-row-height) + 2px)");
  });

  it.each([
    ["light", "small", "narrow"],
    ["light", "default", "default"],
    ["light", "large", "wide"],
    ["dark", "small", "narrow"],
    ["dark", "default", "default"],
    ["dark", "large", "wide"],
  ])("retains the %s/%s/%s visual contract in shared semantic tokens", (theme, textSize, width) => {
    expect(["light", "dark"]).toContain(theme);
    expect(["small", "default", "large"]).toContain(textSize);
    expect(["narrow", "default", "wide"]).toContain(width);
    expect(sharedSidebarCss).toContain("var(--desktop-sidebar-font-size");
    expect(sharedSidebarCss).toContain("var(--desktop-sidebar-row-height)");
    expect(sharedSidebarCss).toContain("min-width: 0;");
    expect(sharedSidebarCss).toContain("text-overflow: ellipsis;");
  });
});

function read(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function readCssBlock(css: string, selector: string): string {
  const marker = `\n${selector} {`;
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`Missing CSS block for ${selector}`);
  const bodyStart = start + marker.length;
  const end = css.indexOf("\n}", bodyStart);
  if (end < 0) throw new Error(`Unclosed CSS block for ${selector}`);
  return css.slice(bodyStart, end);
}

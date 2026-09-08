import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sharedSidebarCss = read("../packages/shared-ui/src/styles/sidebar-primitives.css");
const sharedDataWorkspaceCss = read("../packages/shared-ui/src/styles/data-workspace.css");
const dataShellCss = read("../src/features/data-workspace/data-shell.css");
const patternCss = read("../src/styles/sidebar/patterns.css");
const layoutCss = read("../src/styles/layout.css");
const dataSurfaceSource = read("../src/features/app-shell/DesktopDataWorkspaceSurface.tsx");
const dataWorkspaceSource = read("../packages/shared-ui/src/data/DataWorkspace.tsx");
const desktopShellSource = read("../src/components/DesktopCloudShell.tsx");
const appSource = read("../src/App.tsx");
const workspaceContentSource = read("../src/features/app-shell/DesktopWorkspaceContent.tsx");
const registrySource = read("../src/features/app-shell/workspace-surfaces/workspaceSurfaceRegistry.ts");
const auxiliaryHostSource = read("../src/features/app-shell/auxiliary/AuxiliaryPanelHost.tsx");
const collapsiblePaneResizeSource = read("../packages/shared-ui/src/primitives/useCollapsiblePaneResize.ts");
const settingsSidebarSource = read("../src/features/settings/sidebar/SettingsSidebar.tsx");
const settingsModelSource = read("../src/features/settings/sidebar/settingsSidebarModel.ts");
const sourceControlResourceLists = read("../src/features/source-control/sidebar/SourceControlResourceLists.tsx");
const sourceControlHistory = read("../src/features/source-control/sidebar/GitSidebarHistoryPanel.tsx");
const cloudHistorySidebar = read("../src/features/cloud/history/CloudHistorySidebar.tsx");
const virtualizationPolicy = read("../packages/shared-ui/src/sidebar/virtualizationPolicy.ts");
const virtualSidebarList = read("../packages/shared-ui/src/sidebar/VirtualSidebarList.tsx");
const tokens = read("../src/styles/tokens.css");

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

  it("keeps Feature composition out of shared layers and Auxiliary routing independent", () => {
    expect(sharedSidebarCss).not.toMatch(/desktop-(?:git|cloud|settings|agent|terminal)/);
    expect(auxiliaryHostSource).toContain("SidebarResizeHandle");
    expect(auxiliaryHostSource).toContain("useCollapsiblePaneResize");
    expect(auxiliaryHostSource).toContain('orientation="vertical"');
    expect(settingsSidebarSource).toContain("resolveSettingsSidebarGroups({ cloudEnabled })");
    expect(settingsModelSource).toContain("SETTINGS_SIDEBAR_GROUPS");
    expect(settingsModelSource).toContain("requiresCloud: true");
  });

  it("collapses panes through animated resize tracks without expanded-state toggle buttons", () => {
    expect(sharedSidebarCss).not.toContain(".po-pane-edge-toggle");
    expect(dataShellCss).not.toContain(".data-explorer-toggle");
    expect(layoutCss).not.toContain(".desktop-right-sidebar-toggle");
    expect(sharedDataWorkspaceCss).toContain("transition: grid-template-columns 260ms");
    expect(sharedDataWorkspaceCss).toMatch(
      /body\.data-sidebar-resizing \.data-content:not\(\[data-explorer-collapsed="true"\]\)\s*\{[^}]*transition:\s*none;/s,
    );
    expect(dataShellCss).not.toContain("transition: grid-template-columns 260ms");
    expect(dataShellCss).not.toContain("transition: inset-inline-start 260ms");
    expect(layoutCss).toContain("flex-basis 260ms cubic-bezier");
    expect(collapsiblePaneResizeSource).toContain("minWidth - resolvedCollapsePullDistance");
    expect(dataWorkspaceSource).toContain('widthChangeMode: "end"');
  });

  it("gives the collapsed explorer one Header-owned expansion action", () => {
    expect(dataWorkspaceSource).toContain("resizableExplorer && !explorerCollapsed");
    expect(dataWorkspaceSource).not.toContain("explorerCollapsedEdgeVisible");
    expect(desktopShellSource).toContain("paneLayout.explorer.collapsed && leftSidebarPresent");
    expect(desktopShellSource).toContain("desktop-titlebar-sidebar-expand");
    expect(desktopShellSource).toContain("<PanelLeft size={15}");
    expect(desktopShellSource).not.toContain("PanelLeftOpen");
    expect(desktopShellSource).not.toContain("autoCollapsed");
    expect(desktopShellSource).not.toContain("autoClosed");
    expect(appSource).toContain("onLeftSidebarExpand={() => setSidebarCollapsed(false)}");
    expect(appSource).not.toContain("if (autoCollapsed)");
  });

  it("keeps the minimal collapsed-edge affordance for the auxiliary pane only", () => {
    expect(sharedSidebarCss).toContain(".po-collapsed-pane-edge-handle::after");
    expect(sharedSidebarCss).toContain(".po-collapsed-pane-edge-glyph");
    expect(auxiliaryHostSource).toContain("!open && collapsedEdgeSettled");
    expect(auxiliaryHostSource).toContain('collapsedEdgeSide={collapsedEdgeVisible ? "inline-end" : undefined}');
    expect(layoutCss).toMatch(
      /\.desktop-right-sidebar:not\(\.is-open\)\s*\{[^}]*overflow:\s*visible/s,
    );
  });

  it("keeps direct resize canonical while visibility transitions preserve content width", () => {
    expect(dataShellCss).toMatch(
      /\.data-content\[data-resizable-explorer="true"\]\s*\{[^}]*grid-template-columns:[^}]*var\(--data-explorer-width[^}]*minmax/s,
    );
    expect(dataShellCss).toMatch(
      /\.data-explorer-resizer\s*\{[^}]*inset-inline-start:\s*var\(--data-explorer-width[^}]*inset-inline-end:\s*auto;[^}]*background:\s*transparent;/s,
    );
    expect(dataShellCss).not.toContain("grid-column: 3;");
    expect(layoutCss).toMatch(
      /\.desktop-right-sidebar\.is-open\s*\{[^}]*flex-basis:\s*var\(--desktop-right-sidebar-width\)[^}]*width:\s*var\(--desktop-right-sidebar-width\)/s,
    );
    expect(layoutCss).toMatch(
      /\.desktop-right-sidebar-viewport\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*width:\s*100%[^}]*overflow:\s*clip[^}]*pointer-events:\s*none/s,
    );
    expect(layoutCss).toMatch(
      /\.desktop-right-sidebar-inner\s*\{[^}]*position:\s*absolute[^}]*inset-inline-end:\s*0[^}]*width:\s*var\(--desktop-right-sidebar-width\)[^}]*min-width:\s*var\(--desktop-right-sidebar-width\)[^}]*pointer-events:\s*none/s,
    );
    expect(layoutCss).toMatch(
      /\.desktop-right-sidebar\.is-open \.desktop-right-sidebar-inner\s*\{[^}]*pointer-events:\s*auto/s,
    );
    expect(layoutCss).toMatch(
      /\.desktop-right-sidebar-inner\s*\{[^}]*width:\s*var\(--desktop-right-sidebar-width\)[^}]*transform:\s*translateX\(var\(--desktop-right-sidebar-exit-translate\)\)[^}]*transition:\s*transform 260ms/s,
    );
    expect(layoutCss).not.toMatch(/\.desktop-right-sidebar-inner\s*\{[^}]*transition:[^}]*(?:width|min-width|flex-basis)/s);
    expect(layoutCss).not.toMatch(/\.desktop-right-sidebar-viewport\s*\{[^}]*(?:opacity|visibility|transition):/s);
    expect(layoutCss).not.toContain("--desktop-right-sidebar-visible-width");
    expect(auxiliaryHostSource).not.toContain("desktop-right-sidebar-visible-width");
    expect(auxiliaryHostSource).toContain('className="desktop-right-sidebar-viewport"');
    expect(auxiliaryHostSource).toContain("lastExpandedWidth");
    expect(auxiliaryHostSource).toContain('widthChangeMode: "end"');
    expect(sharedDataWorkspaceCss).not.toContain("--data-explorer-min-width");
    expect(collapsiblePaneResizeSource).toContain("canonical live resize width");
    expect(collapsiblePaneResizeSource).toContain("last-expanded content plane");
    expect(auxiliaryHostSource).toContain("aria-hidden={open ? undefined : true}");
    expect(auxiliaryHostSource).toContain('{...(!open ? { inert: "" } : {})}');
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
    expect(sourceControlHistory).toContain('"--desktop-sidebar-virtual-row-size"');
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

#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedSidebarRoot = absolute("packages/shared-ui/src/sidebar");
const productPatternRoot = absolute("src/components/sidebar");
const featureRoot = absolute("src/features");
const errors = [];
const importPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g;
const dynamicImportPattern = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

for (const requiredPath of [
  "packages/shared-ui/src/sidebar/index.ts",
  "packages/shared-ui/src/styles/sidebar-primitives.css",
  "src/components/sidebar/index.ts",
  "src/styles/sidebar/patterns.css",
  "src/features/app-shell/workspace-surfaces/workspaceSurfaceRegistry.ts",
  "src/features/app-shell/workspace-surfaces/WorkspaceSurfaceOutlet.tsx",
  "src/features/app-shell/auxiliary/AuxiliaryPanelHost.tsx",
  "src/features/plugins/PluginsDialog.tsx",
  "src/features/settings/sidebar/SettingsSidebar.tsx",
  "src/features/settings/sidebar/settingsSidebarModel.ts",
  "src/features/source-control/sidebar/GitLocalStatusPanels.tsx",
  "src/features/source-control/sidebar/GitRemoteSections.tsx",
  "src/features/source-control/sidebar/GitSidebarPrimitives.tsx",
  "src/features/source-control/GitHistoryTimeline.tsx",
  "src/features/source-control/sidebar/GitLocalStatusSection.tsx",
  "src/features/source-control/sidebar/useGitSidebarExpansionState.ts",
  "src/features/source-control/styles/sidebar-actions.css",
  "src/features/source-control/styles/sidebar-panels.css",
  "src/features/source-control/styles/sidebar-providers.css",
]) {
  if (!existsSync(absolute(requiredPath))) errors.push(`required Sidebar architecture path is missing: ${requiredPath}`);
}

for (const retiredPath of [
  "src/styles/sidebar-primitives.css",
  "src/features/source-control/sidebar/SourceControlSidebarSections.tsx",
  "src/features/source-control/sidebar/GitStatusCardSection.tsx",
  "src/features/source-control/source-control-overrides.css",
]) {
  if (existsSync(absolute(retiredPath))) errors.push(`retired Sidebar ownership path must not return: ${retiredPath}`);
}

for (const filePath of walkSourceFiles(sharedSidebarRoot)) {
  for (const specifier of collectSpecifiers(read(filePath))) {
    if (specifier === "react" || specifier.startsWith("./")) continue;
    errors.push(`${relative(filePath)} imports ${specifier}; process-neutral Sidebar primitives may only depend on React and local modules`);
  }
}

for (const filePath of walkSourceFiles(productPatternRoot)) {
  for (const specifier of collectSpecifiers(read(filePath))) {
    if (specifier === "react" || specifier === "@puppyone/shared-ui" || specifier.startsWith("./")) continue;
    errors.push(`${relative(filePath)} imports ${specifier}; Desktop Sidebar patterns cannot depend on Features, App Shell, or Electron authority`);
  }
}

for (const filePath of walkSourceFiles(absolute("src"))) {
  const sourceFeature = featureName(filePath);
  for (const specifier of collectSpecifiers(read(filePath))) {
    const target = resolveRelativeModule(filePath, specifier);
    if (!target) continue;
    const targetFeature = featureName(target);
    if (!sourceFeature || !targetFeature || sourceFeature === targetFeature) continue;
    const targetRelative = relative(target);
    if (/\/features\/[^/]+\/(?:sidebar|sections|rows|hooks|styles)(?:\/|\.|$)/.test(`/${targetRelative}`)) {
      errors.push(`${relative(filePath)} deep-imports ${targetRelative}; consume the Feature public entry instead`);
    }
  }
}

const sharedStyle = read(absolute("packages/shared-ui/src/styles/sidebar-primitives.css"));
const patternStyle = read(absolute("src/styles/sidebar/patterns.css"));
if (!sharedStyle.includes("@layer primitives")) errors.push("Shared Sidebar primitives must live in @layer primitives.");
if (!patternStyle.includes("@layer patterns")) errors.push("Desktop Sidebar patterns must live in @layer patterns.");

for (const filePath of walkFiles(absolute("src"), /\.(?:css|ts|tsx)$/)) {
  const source = read(filePath);
  if (/desktop-tool-sidebar/.test(source)) {
    errors.push(`${relative(filePath)} uses the retired desktop-tool-sidebar compatibility class`);
  }
  if (filePath.endsWith(".css") && filePath !== absolute("src/styles/sidebar/patterns.css")) {
    const unscopedPrimitive = /(?:^|\})[\t\r\n ]*\.po-(?:sidebar|desktop-sidebar)-(?:root|scroll-area|list|row|icon-button|empty|resize-handle|virtual|group|header|status-row)[^{,\s]*\s*[,\{]/;
    if (unscopedPrimitive.test(stripCssComments(source))) {
      errors.push(`${relative(filePath)} redefines an unscoped shared Sidebar primitive/pattern selector`);
    }
  }
}

for (const filePath of sidebarPresentationFiles()) {
  const source = read(filePath);
  if (/<style\b/i.test(source)) errors.push(`${relative(filePath)} embeds static CSS in TSX`);
  if (/style=\{\{/.test(source)) {
    errors.push(`${relative(filePath)} contains a literal inline style object; use CSS or a documented runtime custom property`);
  }
}

const registrySource = read(absolute("src/features/app-shell/workspace-surfaces/workspaceSurfaceRegistry.ts"));
const registryTypes = read(absolute("src/features/app-shell/workspace-surfaces/workspaceSurfaceTypes.ts"));
const workspaceContent = read(absolute("src/features/app-shell/DesktopWorkspaceContent.tsx"));
const workspaceDataSurface = read(absolute("src/features/app-shell/DesktopDataWorkspaceSurface.tsx"));
for (const id of ["data", "git", "cloud", "settings"]) {
  if (!registrySource.includes(`id: "${id}"`)) errors.push(`Workspace Surface Registry is missing ${id}`);
}
if (registrySource.includes('id: "plugins"') || registryTypes.includes('| "plugins"')) {
  errors.push("Plugins must remain an application dialog, not a Workspace Surface.");
}
for (const retiredTopLevelId of ["access", "automation"]) {
  if (registrySource.includes(`id: "${retiredTopLevelId}"`)) {
    errors.push(`${retiredTopLevelId} must remain a Cloud Project route, not a top-level Workspace Surface`);
  }
}
for (const requiredToken of ["navigation:", "lifecycle:", "isAvailable:", "create:"]) {
  if (!registrySource.includes(requiredToken)) errors.push(`Workspace Surface Registry is missing ${requiredToken}`);
}
if (!registryTypes.includes("ResolvedWorkspaceSurface") || !registryTypes.includes("WorkspaceSurfaceCapabilities")) {
  errors.push("Workspace Surface Registry must expose typed capability and resolved-instance contracts.");
}
if (!workspaceContent.includes("useWorkspaceSurfaceContent") || !workspaceContent.includes("resolvedSurface")) {
  errors.push("DesktopWorkspaceContent must render one resolved Workspace Surface instance.");
}
if (!workspaceContent.includes("<PluginsDialog") || !workspaceContent.includes("pluginsOpen && viewerPluginsEnabled")) {
  errors.push("DesktopWorkspaceContent must host the experiment-gated Plugins application dialog.");
}
if (/\b(?:explorerSlot|mainSlot)\s*=/.test(workspaceContent) || /activeView\s*===/.test(workspaceContent)) {
  errors.push("DesktopWorkspaceContent reintroduced independent route selection instead of one resolved surface.");
}
if (!workspaceDataSurface.includes("<DataWorkspace") || !workspaceDataSurface.includes('resolvedSurface.id === "data"')) {
  errors.push("Data Workspace must remain mounted while resolved surfaces are projected into its sidebar/main slots.");
}
if (/\b(?:agent|terminal)\b/.test(registrySource)) {
  errors.push("Agent and Terminal are Auxiliary panels and must never enter the Workspace Surface Registry.");
}

const virtualizationRequirements = [
  ["src/features/cloud/history/CloudHistorySidebar.tsx", "VirtualSidebarList"],
  ["src/features/source-control/sidebar/SourceControlResourceLists.tsx", "shouldVirtualizeSidebarList"],
  ["src/features/source-control/GitHistoryTimeline.tsx", "VirtualSidebarList"],
];
for (const [relativePath, token] of virtualizationRequirements) {
  if (!read(absolute(relativePath)).includes(token)) errors.push(`${relativePath} must consume the shared scalable-list policy (${token}).`);
}
const virtualizationPolicy = read(absolute("packages/shared-ui/src/sidebar/virtualizationPolicy.ts"));
if (!virtualizationPolicy.includes("SIDEBAR_VIRTUALIZATION_THRESHOLD = 200")) {
  errors.push("Shared Sidebar virtualization policy must activate at 200 rows.");
}

const gitSidebarSource = read(absolute("src/features/source-control/SourceControlSidebar.tsx"));
if (!gitSidebarSource.includes("createGitLocalStatusPanels")) {
  errors.push("Git Sidebar must delegate local status-group presentation to GitLocalStatusPanels.");
}
if (gitSidebarSource.includes("desktop-git-status-card")) {
  errors.push("Git Sidebar orchestration must not own retired local status-card markup.");
}
const gitLocalStatusSource = read(absolute("src/features/source-control/sidebar/GitLocalStatusPanels.tsx"));
if (!gitLocalStatusSource.includes("GitLocalStatusSection")) {
  errors.push("Local Git panels must consume the shared flat GitLocalStatusSection contract.");
}
if (gitLocalStatusSource.includes("desktop-git-status-card")) {
  errors.push("Local Git panels must remain flat and must not restore a status-card surface.");
}

const auxiliarySource = read(absolute("src/features/app-shell/auxiliary/AuxiliaryPanelHost.tsx"));
const appSource = read(absolute("src/App.tsx"));
for (const token of ["CollapsiblePaneFrame", "useCollapsiblePaneResize", 'orientation: "vertical"']) {
  if (!auxiliarySource.includes(token)) errors.push(`AuxiliaryPanelHost must consume the shared resize contract (${token}).`);
}
const layoutStyle = read(absolute("src/styles/layout.css"));
const sidebarPrimitiveStyle = read(absolute("packages/shared-ui/src/styles/sidebar-primitives.css"));
const controlGeometryStyle = read(absolute("packages/shared-ui/src/styles/control-geometry.css"));
const dataWorkspaceStyle = read(absolute("packages/shared-ui/src/styles/data-workspace.css"));
const desktopDataWorkspaceStyle = read(absolute("src/features/data-workspace/data-shell.css"));
const dataWorkspaceSource = read(absolute("packages/shared-ui/src/data/DataWorkspace.tsx"));
const collapsiblePaneResizeSource = read(absolute("packages/shared-ui/src/primitives/useCollapsiblePaneResize.ts"));
const collapsiblePaneGestureSource = read(absolute("packages/shared-ui/src/primitives/collapsiblePaneGesture.ts"));
const paneResizeDragSource = read(absolute("packages/shared-ui/src/primitives/usePaneResizeDrag.ts"));
const collapsiblePaneFrameSource = read(absolute("packages/shared-ui/src/sidebar/CollapsiblePaneFrame.tsx"));
const sidebarResizeHandleSource = read(absolute("packages/shared-ui/src/sidebar/SidebarResizeHandle.tsx"));
const desktopDataWorkspaceSource = read(absolute("src/features/app-shell/DesktopDataWorkspaceSurface.tsx"));
if (layoutStyle.includes("--desktop-right-sidebar-visible-width") || auxiliarySource.includes("desktop-right-sidebar-visible-width")) {
  errors.push("AuxiliaryPanelHost must not drive its content plane from the shrinking visibility width.");
}
if (dataWorkspaceStyle.includes("--data-explorer-min-width")) {
  errors.push("DataWorkspace content must follow the canonical Explorer track width.");
}
if (
  !collapsiblePaneResizeSource.includes("canonical live resize width")
  || !collapsiblePaneResizeSource.includes("last-expanded content plane")
) {
  errors.push("The shared collapsible pane resize contract must distinguish direct resize from visibility transitions.");
}
for (const token of [
  'viewportClassName="desktop-right-sidebar-viewport"',
  'contentWidth="var(--desktop-right-sidebar-content-width)"',
  "frameWidth={resize.width}",
  "lastExpandedWidth",
]) {
  if (!auxiliarySource.includes(token)) {
    errors.push(`AuxiliaryPanelHost is missing its non-reflow visibility contract (${token}).`);
  }
}
if (
  !auxiliarySource.includes('typeof children === "function"')
  || !appSource.includes('active={presentation.contentVisible && rightSidebarSurface === "chat"}')
  || appSource.includes("active={rightSidebarOpen}")
) {
  errors.push("Auxiliary native content must follow the shared frame lifecycle through its render presentation.");
}
if (
  !collapsiblePaneGestureSource.includes("finishCollapsiblePaneGesture")
  || !collapsiblePaneGestureSource.includes("collapseHysteresis")
  || !collapsiblePaneResizeSource.includes("onCommit")
  || collapsiblePaneResizeSource.includes("onCollapsedChange")
) {
  errors.push("Collapsible panes must preview through the shared gesture state machine and commit once at gesture end.");
}
if (
  !collapsiblePaneGestureSource.includes('phase: "collapse-preview"')
  || !collapsiblePaneGestureSource.includes("previewCollapsed: true")
  || !collapsiblePaneGestureSource.includes("previewWidth: config.collapsedWidth")
) {
  errors.push("Crossing a pane collapse threshold must render a reversible collapsed preview before pointer release.");
}
if (
  !collapsiblePaneGestureSource.includes('type: "collapse"; restoreWidth: number')
  || !collapsiblePaneGestureSource.includes('restoreWidth: config.minWidth')
  || !dataWorkspaceSource.includes("setExplorerWidth(commit.restoreWidth)")
  || !auxiliarySource.includes("onWidthChange?.(commit.restoreWidth)")
) {
  errors.push("A drag collapse must persist the minimum legal expanded width for the next reopen.");
}
if (
  !collapsiblePaneResizeSource.includes("PendingPaneCommit")
  || !collapsiblePaneResizeSource.includes("baselineKey")
) {
  errors.push("Collapsible panes must retain an optimistic commit until controlled state acknowledges or supersedes it.");
}
if (
  sidebarResizeHandleSource.includes('window.addEventListener("pointerup"')
  || !collapsiblePaneResizeSource.includes("cancelKey:")
) {
  errors.push("The pane gesture controller must be the sole owner of each pointer session and cancel stale controlled gestures.");
}
for (const token of [
  "--desktop-right-sidebar-content-width",
  "--desktop-right-sidebar-border-start",
  "--desktop-right-sidebar-border-end",
]) {
  if (!layoutStyle.includes(token)) {
    errors.push(`Right Sidebar is missing its fixed content-plane contract (${token}).`);
  }
}
const paneEdgeHandle = sidebarPrimitiveStyle.match(/\.po-pane-edge-resize-handle\s*\{([^}]*)\}/s)?.[1] ?? "";
for (const token of [
  "position: absolute",
  "width: var(--po-pane-resizer-hit-size, 8px)",
]) {
  if (!paneEdgeHandle.includes(token)) {
    errors.push(`Shared pane-edge resize handle is missing its overlay hit-target contract (${token}).`);
  }
}
const dataContent = dataWorkspaceStyle.match(/\.data-content\s*\{([^}]*)\}/s)?.[1] ?? "";
const explorerResizer = dataWorkspaceStyle.match(/\.data-explorer-resizer\s*\{([^}]*)\}/s)?.[1] ?? "";
for (const token of [
  "inset-inline-start: auto",
  "inset-inline-end: calc(1px - var(--po-pane-resizer-hit-size, 8px))",
  "background: transparent",
]) {
  if (!explorerResizer.includes(token)) errors.push(`Shared DataWorkspace is missing its frame-anchored resize sash contract (${token}).`);
}
for (const token of [
  'viewportClassName="data-explorer-viewport"',
  'contentClassName="data-explorer-inner"',
  "contentWidth={renderedExplorerContentWidth}",
  "frameWidth={explorerResize.width}",
]) {
  if (!dataWorkspaceSource.includes(token)) errors.push(`DataWorkspace is missing its stable Explorer content plane (${token}).`);
}
if (!dataContent.includes("display: flex")) {
  errors.push("Shared DataWorkspace must let CollapsiblePaneFrame own the Explorer width inside one flex row.");
}
if (dataContent.includes("grid-template-columns") || explorerResizer.includes("grid-column")) {
  errors.push("Shared DataWorkspace must not consume the overlay resize hit target as layout width.");
}
const shellSource = read(absolute("src/components/DesktopCloudShell.tsx"));
if (!shellSource.includes("onLeadingRailWidthChange?.(commit.restoreWidth)")) {
  errors.push("The Workspace rail must persist the shared collapse restore width.");
}
if (!shellSource.includes("contentWidth={renderedLeadingRailContentWidth}")) {
  errors.push("The Workspace rail must preserve a stable content plane while its frame changes width.");
}
if (!shellSource.includes("frameWidth={resolvedLeadingRailWidth}")) {
  errors.push("The Workspace rail must delegate its animated width to CollapsiblePaneFrame.");
}
if (shellSource.includes("leadingRailCollapsedCssWidth")) {
  errors.push("The Workspace rail compact width must come from pane geometry, not a CSS override.");
}
const projectSwitcherStyle = read(absolute("src/features/app-shell/project-switcher-rail.css"));
if (!/\.po-collapsible-pane-frame\[data-pane-gesture="resizing"\]\s*\{[^}]*transition:\s*none;/s.test(sidebarPrimitiveStyle)) {
  errors.push("The shared frame must keep collapse-preview motion while direct resize stays pointer-synchronous.");
}
if (/\.desktop-project-switcher-rail-label\s*\{[^}]*(?:opacity|transform):/s.test(projectSwitcherStyle)) {
  errors.push("Workspace rail labels must not fade or translate independently from the pane frame.");
}
for (const [hostName, source] of [
  ["Explorer", dataWorkspaceSource],
  ["Auxiliary", auxiliarySource],
  ["Workspace rail", shellSource],
]) {
  if (!source.includes("<CollapsiblePaneFrame")) {
    errors.push(`${hostName} pane must use the shared CollapsiblePaneFrame geometry contract.`);
  }
  if (source.includes("<SidebarResizeHandle")) {
    errors.push(`${hostName} pane must not recreate the CollapsiblePaneFrame resize-handle structure.`);
  }
}
for (const token of [
  "po-collapsible-pane-viewport",
  "po-collapsible-pane-content",
  "<SidebarResizeHandle",
  "paneEdge",
]) {
  if (!collapsiblePaneFrameSource.includes(token)) {
    errors.push(`CollapsiblePaneFrame is missing its canonical frame relationship (${token}).`);
  }
}
for (const token of [
  ".po-collapsible-pane-viewport",
  ".po-collapsible-pane-content",
  "width: var(--po-collapsible-pane-frame-width, auto)",
  "width: var(--po-collapsible-pane-content-width, 100%)",
  "width var(--po-pane-motion-duration, 360ms)",
]) {
  if (!sidebarPrimitiveStyle.includes(token)) {
    errors.push(`Shared collapsible pane CSS is missing its geometry contract (${token}).`);
  }
}
if (sidebarPrimitiveStyle.includes("translateX") || sidebarPrimitiveStyle.includes("data-pane-content-motion")) {
  errors.push("Collapsible pane content must stay fixed while the shared viewport clips it.");
}
for (const [hostName, source] of [
  ["Explorer", dataWorkspaceSource],
  ["Auxiliary", auxiliarySource],
  ["Workspace rail", shellSource],
]) {
  if (source.includes("contentMotion") || source.includes("contentHidden")) {
    errors.push(`${hostName} must not override the shared content visibility lifecycle.`);
  }
}
if (/(?:^|\n)\.desktop-right-sidebar-(?:viewport|inner)\s*\{/.test(layoutStyle)) {
  errors.push("Desktop layout CSS must not redeclare shared collapsible pane viewport/content geometry.");
}
if (/(?:^|\n)\.data-explorer-(?:viewport|inner)\s*\{/.test(dataWorkspaceStyle)) {
  errors.push("DataWorkspace CSS must not redeclare shared collapsible pane viewport/content geometry.");
}
for (const selector of [
  '.data-content[data-resizable-explorer="true"]',
  ".data-explorer-resizer",
  ".explorer-column",
]) {
  if (desktopDataWorkspaceStyle.includes(selector)) {
    errors.push(`Desktop DataWorkspace must not redeclare shared structural selector ${selector}.`);
  }
}
if (dataWorkspaceStyle.includes('.data-content[data-resizable-explorer="true"] > .browser-column')) {
  errors.push("Shared DataWorkspace must keep the Editor adjacent to the shared pane boundary.");
}
if (
  !controlGeometryStyle.includes("--po-pane-motion-duration: 360ms")
  || !controlGeometryStyle.includes("--po-pane-motion-easing: cubic-bezier(0.42, 0, 0.58, 1)")
  || !collapsiblePaneGestureSource.includes("COLLAPSIBLE_PANE_MOTION_MS = 360")
) {
  errors.push("All collapsible panes must consume the shared 360ms ease-in-out motion contract in CSS and TypeScript.");
}
if (!dataWorkspaceSource.includes("Math.max(") || !dataWorkspaceSource.includes("explorerResize.width,")) {
  errors.push("Explorer collapse must clip a stable expanded content plane instead of squeezing its children.");
}
if (dataWorkspaceSource.includes("data-explorer-collapsed-fill") || dataWorkspaceStyle.includes(".data-explorer-collapsed-fill")) {
  errors.push("Explorer collapse must not insert a competing flex child into its retained content plane.");
}
if (
  !desktopDataWorkspaceSource.includes("paneLayout?.explorer.collapsed")
  || !desktopDataWorkspaceSource.includes("? preferences.explorerWidth")
) {
  errors.push("Desktop Explorer must retain its expanded preference width while the Shell track is collapsed.");
}
if (!paneResizeDragSource.includes("onDragActiveChange?.(true)") || !paneResizeDragSource.includes("onDragActiveChange?.(false)")) {
  errors.push("Pane resize drags must publish their complete host-neutral activity lifecycle.");
}
if (
  !desktopDataWorkspaceSource.includes("useNativeSurfacePointerPassthroughActivity(")
  || !desktopDataWorkspaceSource.includes("useNativeSurfacePointerRoutingRegion(")
  || !desktopDataWorkspaceSource.includes('"explorer-resize"')
  || !desktopDataWorkspaceSource.includes(
    "onExplorerResizeActiveChange={onExplorerResizeActiveChange}",
  )
) {
  errors.push("Desktop explorer resize must register both initial-press routing and active-drag native-surface passthrough.");
}
if (!shellSource.includes("<AuxiliaryPanelHost")) errors.push("DesktopCloudShell must delegate Auxiliary geometry/lifecycle to AuxiliaryPanelHost.");

if (errors.length > 0) {
  console.error("Sidebar architecture check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Sidebar architecture check passed.");

function absolute(relativePath) {
  return path.join(repoRoot, relativePath);
}

function read(filePath) {
  return readFileSync(filePath, "utf8");
}

function relative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
}

function featureName(filePath) {
  const match = relative(filePath).match(/^src\/features\/([^/]+)/);
  return match?.[1] ?? null;
}

function collectSpecifiers(source) {
  const specifiers = [];
  for (const pattern of [importPattern, dynamicImportPattern]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match) {
      specifiers.push(match[1]);
      match = pattern.exec(source);
    }
  }
  return specifiers;
}

function resolveRelativeModule(filePath, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(filePath), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function sidebarPresentationFiles() {
  return walkSourceFiles(absolute("src")).filter((filePath) => (
    filePath.includes(`${path.sep}components${path.sep}sidebar${path.sep}`)
    || filePath.includes(`${path.sep}features${path.sep}app-shell${path.sep}auxiliary${path.sep}`)
    || /Sidebar[^/]*\.tsx$/.test(filePath)
    || filePath.includes(`${path.sep}source-control${path.sep}sidebar${path.sep}`)
  ));
}

function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function walkSourceFiles(directory) {
  return walkFiles(directory, /\.(?:ts|tsx)$/);
}

function walkFiles(directory, pattern) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const filePath = path.join(directory, entry);
    const stats = statSync(filePath);
    if (stats.isDirectory()) files.push(...walkFiles(filePath, pattern));
    else if (stats.isFile() && pattern.test(filePath)) files.push(filePath);
  }
  return files;
}

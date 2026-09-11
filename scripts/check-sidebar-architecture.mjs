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
  "src/features/settings/sidebar/SettingsSidebar.tsx",
  "src/features/settings/sidebar/settingsSidebarModel.ts",
  "src/features/source-control/sidebar/GitLocalStatusPanels.tsx",
  "src/features/source-control/sidebar/GitRemoteSections.tsx",
  "src/features/source-control/sidebar/GitSidebarPrimitives.tsx",
  "src/features/source-control/sidebar/GitSidebarHistoryPanel.tsx",
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
for (const id of ["data", "git", "plugins", "cloud", "settings"]) {
  if (!registrySource.includes(`id: "${id}"`)) errors.push(`Workspace Surface Registry is missing ${id}`);
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
  ["src/features/source-control/sidebar/GitSidebarHistoryPanel.tsx", "VirtualSidebarList"],
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
for (const token of ["SidebarResizeHandle", "useCollapsiblePaneResize", 'orientation="vertical"']) {
  if (!auxiliarySource.includes(token)) errors.push(`AuxiliaryPanelHost must consume the shared resize contract (${token}).`);
}
const layoutStyle = read(absolute("src/styles/layout.css"));
const sidebarPrimitiveStyle = read(absolute("packages/shared-ui/src/styles/sidebar-primitives.css"));
const dataWorkspaceStyle = read(absolute("packages/shared-ui/src/styles/data-workspace.css"));
const desktopDataWorkspaceStyle = read(absolute("src/features/data-workspace/data-shell.css"));
const collapsiblePaneResizeSource = read(absolute("packages/shared-ui/src/primitives/useCollapsiblePaneResize.ts"));
const paneResizeDragSource = read(absolute("packages/shared-ui/src/primitives/usePaneResizeDrag.ts"));
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
  'className="desktop-right-sidebar-viewport"',
  "lastExpandedWidth",
  'aria-hidden={open ? undefined : true}',
]) {
  if (!auxiliarySource.includes(token)) {
    errors.push(`AuxiliaryPanelHost is missing its non-reflow visibility contract (${token}).`);
  }
}
for (const token of [
  "width: var(--desktop-right-sidebar-width)",
  "width: var(--desktop-right-sidebar-content-width)",
  "--desktop-right-sidebar-border-start",
  "--desktop-right-sidebar-border-end",
  "min-width: var(--desktop-right-sidebar-content-width)",
  "transition: transform 260ms",
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
for (const [label, source] of [
  ["Shared DataWorkspace", dataWorkspaceStyle],
  ["Desktop DataWorkspace", desktopDataWorkspaceStyle],
]) {
  const resizableGrid = source.match(
    /\.data-content\[data-resizable-explorer="true"\]\s*\{([^}]*)\}/s,
  )?.[1] ?? "";
  const resizer = source.match(/\.data-explorer-resizer\s*\{([^}]*)\}/s)?.[1] ?? "";
  for (const token of [
    "inset-inline-start: var(--data-explorer-width",
    "inset-inline-end: auto",
    "background: transparent",
  ]) {
    if (!resizer.includes(token)) errors.push(`${label} is missing its overlay resize sash contract (${token}).`);
  }
  if (!resizableGrid.includes("grid-template-columns")) {
    errors.push(`${label} is missing its two-pane resizable grid contract.`);
  }
  if (resizableGrid.includes("--po-pane-resizer-hit-size") || resizer.includes("grid-column")) {
    errors.push(`${label} must not consume the overlay resize hit target as layout width.`);
  }
  if (source.includes('.data-content[data-resizable-explorer="true"] > .browser-column')) {
    errors.push(`${label} must keep the Editor in the second grid column at the shared pane boundary.`);
  }
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
const shellSource = read(absolute("src/components/DesktopCloudShell.tsx"));
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

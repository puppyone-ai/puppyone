#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const archiveRoot = resolve("archive/desktop-cloud-catalog");
const productionRoots = [resolve("src"), resolve("electron"), resolve("packages/shared-ui/src")];

const requiredArchiveFiles = [
  "src/features/cloud/components/ProjectBrowser.tsx",
  "src/features/cloud/components/CloudTemplateStore.tsx",
  "src/features/cloud/components/CloudProjectCreateDialog.tsx",
  "src/features/cloud/data/useCloudProjectCatalog.ts",
  "src/features/cloud/hooks/useCloudProjectHome.ts",
  "src/features/cloud/routes/CloudGlobalRouteOutlet.tsx",
  "src/features/cloud/CloudServicePanel.tsx",
  "src/components/MinimalOnboarding.tsx",
  "src/components/AssetLibraryHome.tsx",
];
for (const relativePath of requiredArchiveFiles) {
  if (!existsSync(path.join(archiveRoot, relativePath))) {
    errors.push(`retired Cloud catalog asset is missing from archive: ${relativePath}`);
  }
}

const lineBudgets = new Map([
  ["src/features/cloud/CloudServiceMainView.tsx", 260],
  ["src/features/cloud/routes/CloudRouter.tsx", 160],
  ["src/features/cloud/routes/CloudProjectRouteOutlet.tsx", 240],
  ["src/features/cloud/project/context/useCurrentRepositoryCloudContext.ts", 300],
  ["src/features/cloud/data/useDesktopCloudData.ts", 300],
  ["src/features/cloud/initialization/CloudInitializationView.tsx", 450],
  ["src/features/cloud/initialization/initialization.css", 900],
  ["src/features/cloud/organization/CloudOrganizationTeamPage.tsx", 600],
  ["src/features/cloud/organization/CloudOrganizationBillingPage.tsx", 520],
  ["src/features/cloud/organization/organization.css", 900],
  ["src/features/cloud/components/shared.tsx", 520],
  ["src/features/cloud/components/shared.css", 450],
  ["src/features/cloud/components/web-page.css", 400],
  ["src/features/cloud/sections/settings/SettingsSection.tsx", 350],
  ["src/features/cloud/sections/settings/settings.css", 700],
  ["src/features/cloud/sections/branches/BranchesSection.tsx", 500],
  ["src/features/cloud/sections/branches/branches.css", 550],
  ["src/features/cloud/auth/cloud-auth-card.css", 180],
  ["src/features/cloud/auth/cloud-sign-in.css", 120],
  ["src/features/cloud/styles/primitives.css", 250],
  ["src/features/cloud/sections/overview/OverviewDashboard.tsx", 280],
  ["src/features/cloud/sections/overview/overview.css", 10],
  ["src/features/cloud/sections/overview/styles/base.css", 180],
  ["src/features/cloud/sections/overview/styles/project-identity.css", 90],
  ["src/features/cloud/sections/overview/styles/status-cards.css", 100],
  ["src/features/cloud/sections/overview/styles/dashboard-grid.css", 180],
  ["src/features/cloud/sections/overview/styles/resource-cards.css", 170],
  ["src/features/cloud/sections/overview/styles/status-cards.css", 170],
  ["src/features/cloud/sections/overview/styles/responsive.css", 150],
]);
for (const [relativePath, maximumLines] of lineBudgets) {
  const lines = countLines(read(relativePath));
  if (lines > maximumLines) {
    errors.push(`${relativePath} has ${lines} lines; its architecture budget is ${maximumLines}`);
  }
}

const productionFiles = productionRoots.flatMap((root) => walkFiles(root));
const productionCode = productionFiles
  .filter((filePath) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(filePath))
  .map((filePath) => ({ filePath, source: readAbsolute(filePath) }));

for (const { filePath, source } of productionCode) {
  const relativePath = path.relative(repoRoot, filePath);
  if (/\b(?:from\s+|import\s*\()["'][^"']*archive\/desktop-cloud-catalog/.test(source)) {
    errors.push(`${relativePath} imports retired code from archive/desktop-cloud-catalog`);
  }
  for (const token of [
    "CloudProjectBrowser",
    "CloudTemplateStore",
    "CloudProjectCreateDialog",
    "useCloudProjectCatalog",
    "useCloudProjectHome",
    "listCloudProjects",
    "listCloudTemplates",
    "createCloudProject",
    "openCloudProjectInNewWindow",
    "cloudOnlyWorkspace",
    "cloud://",
  ]) {
    if (source.includes(token)) {
      errors.push(`${relativePath} reintroduced retired Cloud catalog token ${token}`);
    }
  }
}

const routeIds = read("src/features/cloud/routes/cloudRouteIds.ts");
for (const retiredRoute of ['"projects"', '"templates"']) {
  if (routeIds.includes(retiredRoute)) {
    errors.push(`Cloud route state reintroduced ${retiredRoute}`);
  }
}

const routeDefinitions = read("src/features/cloud/routes/cloudRoutes.ts");
for (const requiredRouteContract of [
  "surface: CloudRouteSurface",
  "resources: readonly CloudProjectDetailResource[]",
  "getCloudProjectDetailResources",
  "getCloudRouteSurface",
  "CLOUD_BOUND_PROJECT_SIDEBAR_ROUTES",
]) {
  if (!routeDefinitions.includes(requiredRouteContract)) {
    errors.push(`Cloud route descriptors are missing ${requiredRouteContract}`);
  }
}
for (const stableSection of [
  'id: "contents"',
  'id: "history"',
  'id: "automation"',
  'id: "mcp"',
  'id: "cli"',
  'id: "git-sync"',
  'id: "access"',
  'id: "settings"',
]) {
  if (!routeDefinitions.includes(stableSection)) {
    errors.push(`stable current-Project navigation is missing ${stableSection}`);
  }
}

const sidebar = read("src/features/cloud/CloudServiceSidebar.tsx");
if (!sidebar.includes("CLOUD_BOUND_PROJECT_SIDEBAR_ROUTES") || sidebar.includes("onBackToProjects")) {
  errors.push("Cloud sidebar must be stable current-Project + Organization navigation");
}

const cloudRouter = read("src/features/cloud/routes/CloudRouter.tsx");
for (const outlet of ["CloudOrganizationRouteOutlet", "CloudProjectRouteOutlet"]) {
  if (!cloudRouter.includes(outlet)) errors.push(`CloudRouter must delegate through ${outlet}`);
}
if (cloudRouter.includes("../sections/") || cloudRouter.includes("ProjectBrowser")) {
  errors.push("CloudRouter must remain an orchestration boundary");
}

const accessPointDomainFiles = [
  "src/features/cloud/access-points/model/accessPoint.ts",
  "src/features/cloud/access-points/model/accessPointAdapters.ts",
  "src/features/cloud/access-points/model/accessPointKindRegistry.ts",
  "src/features/cloud/access-points/model/accessPointSelectors.ts",
  "src/features/cloud/access-points/components/AccessPointCatalogPage.tsx",
  "src/features/cloud/access-points/components/AccessPointList.tsx",
  "src/features/cloud/access-points/components/AccessPointRow.tsx",
  "src/features/cloud/access-points/components/AccessPointStatus.tsx",
  "src/features/cloud/access-points/components/AccessPointManageDialog.tsx",
  "src/features/cloud/access-points/pages/AccessPointRoutePage.tsx",
  "src/features/cloud/access-points/pages/accessPointRoutes.ts",
  "src/features/cloud/access-points/presentation/accessPointPresentation.ts",
  "src/features/cloud/access-points/presentation/accessPointUiRegistry.tsx",
];
for (const accessPointFile of accessPointDomainFiles) read(accessPointFile);

for (const obsoleteAccessFile of [
  "src/features/cloud/accessFilters.tsx",
  "src/features/cloud/sections/access/AccessSection.tsx",
  "src/features/cloud/sections/access/accessRows.ts",
  "src/features/cloud/sections/access/accessSurfaceModel.ts",
  "src/features/cloud/sections/access/accessProviders.tsx",
]) {
  if (existsSync(resolve(obsoleteAccessFile))) {
    errors.push(`obsolete pre-domain Access implementation returned: ${obsoleteAccessFile}`);
  }
}

const accessPointRouteOutlet = read("src/features/cloud/routes/CloudProjectRouteOutlet.tsx");
for (const obsoleteRouteToken of [
  "catalogFilterLocked",
  "catalogTitle",
  "catalogDescription",
  "focusedFilter",
  'activeSection === "mcp"',
  'activeSection === "cli"',
  'activeSection === "git-sync"',
]) {
  if (accessPointRouteOutlet.includes(obsoleteRouteToken)) {
    errors.push(`Cloud Project route must delegate Access Point intent instead of branching on ${obsoleteRouteToken}`);
  }
}
if (!accessPointRouteOutlet.includes("getAccessPointCatalogKindForSection") || !accessPointRouteOutlet.includes("AccessPointRoutePage")) {
  errors.push("Cloud Project route must delegate Connections through the Access Point route registry");
}

const accessPointUi = [
  ...walkFiles(resolve("src/features/cloud/access-points/components")),
  ...walkFiles(resolve("src/features/cloud/access-points/pages")),
].filter((filePath) => /\.[jt]sx?$/.test(filePath)).map(readAbsolute).join("\n");
for (const adapterLeak of ["normalizeProviderKey", "git_remote", "mcp_endpoint", "remote_workspace"]) {
  if (accessPointUi.includes(adapterLeak)) {
    errors.push(`Access Point UI must consume normalized domain data, not provider adapter detail ${adapterLeak}`);
  }
}

const accessPointModel = read("src/features/cloud/access-points/model/accessPoint.ts");
for (const modelContract of ["AccessPointKind", "AccessPointStatusKind", "AccessPoint", "AccessPointRow"]) {
  if (!accessPointModel.includes(`type ${modelContract}`)) {
    errors.push(`Access Point domain is missing ${modelContract}`);
  }
}
const accessPointModelLayer = walkFiles(resolve("src/features/cloud/access-points/model"))
  .filter((filePath) => /\.[jt]sx?$/.test(filePath))
  .map(readAbsolute)
  .join("\n");
for (const uiDependency of ["react", "lucide-react", "@puppyone/shared-ui"]) {
  if (accessPointModelLayer.includes(`from \"${uiDependency}\"`) || accessPointModelLayer.includes(`from '${uiDependency}'`)) {
    errors.push(`Access Point model must stay UI-agnostic and cannot import ${uiDependency}`);
  }
}

const mainView = read("src/features/cloud/CloudServiceMainView.tsx");
if (!mainView.includes("getCloudProjectDetailResources") || !mainView.includes("projectId:")) {
  errors.push("CloudServiceMainView must load only the Project resolved from the current repository");
}

const cloudData = read("src/features/cloud/data/useDesktopCloudData.ts");
for (const retiredField of ["projects:", "explicitProjectId", "repositoryProjectId", "contextProjectId", "activeProjectId"]) {
  if (cloudData.includes(retiredField)) {
    errors.push(`current-Project data loader reintroduced catalog-era field ${retiredField}`);
  }
}
if (!cloudData.includes("getCloudProject(") || !cloudData.includes("projectId: string | null")) {
  errors.push("current-Project data loader must fetch exactly one explicit Project");
}

const currentContext = read("src/features/cloud/project/context/useCurrentRepositoryCloudContext.ts");
for (const requiredToken of [
  "resolveCanonicalPuppyoneRemotes",
  "getCloudRepositoryContext",
  "createWorkspaceCloudResolutionKey",
  "repositoryTargetMatchesRemote",
]) {
  if (!currentContext.includes(requiredToken)) {
    errors.push(`current repository Cloud resolver is missing ${requiredToken}`);
  }
}

const app = read("src/App.tsx");
for (const retiredToken of ["cloud://", "cloudOnly", "CloudProjectCreateDialog", "ProjectBrowser", "cloudProjects"]) {
  if (app.includes(retiredToken)) errors.push(`App shell reintroduced ${retiredToken}`);
}

const workspaceSwitcher = read("src/features/app-shell/DesktopWorkspaceSwitcher.tsx");
if (/kind:\s*["']cloud["']|Cloud Projects|createCloudProject/.test(workspaceSwitcher)) {
  errors.push("workspace switcher must remain a local repository registry");
}

const authStyles = read("src/features/cloud/auth/cloud-auth-card.css");
if (!authStyles.includes("--po-text-size-body, 13px")) {
  errors.push("Cloud auth controls must retain the canonical 13px body-size fallback");
}

const authLayoutStyles = read("src/features/cloud/auth/cloud-sign-in.css");
for (const centeringContract of [
  ".desktop-cloud-auth-page-shell",
  "display: flex",
  "flex: 1 1 auto",
  "width: 100%",
  "height: 100%",
  "min-height: 0",
]) {
  if (!authLayoutStyles.includes(centeringContract)) {
    errors.push(`Cloud sign-in must retain its full-height centering contract: ${centeringContract}`);
  }
}
if (authLayoutStyles.includes(".desktop-cloud-auth-main-view .desktop-entry-state")) {
  errors.push("Cloud auth layout must not override the shared DesktopEntryState geometry");
}
const signedOutRoute = read("src/features/cloud/auth/CloudSignedOutRoute.tsx");
if (!signedOutRoute.includes('className="desktop-cloud-auth-page-shell"')) {
  errors.push("Cloud signed-out route must render the auth-owned full-surface shell");
}

const ownedStyles = [
  ["src/features/cloud/auth/CloudAuthCard.tsx", 'import "./cloud-auth-card.css";'],
  ["src/features/cloud/auth/CloudSignInView.tsx", 'import "./cloud-sign-in.css";'],
  ["src/features/cloud/organization/CloudOrganizationTeamPage.tsx", 'import "./organization.css";'],
  ["src/features/cloud/organization/CloudOrganizationBillingPage.tsx", 'import "./organization.css";'],
  ["src/features/cloud/components/shared.tsx", 'import "./shared.css";'],
  ["src/features/cloud/components/shared.tsx", 'import "./web-page.css";'],
  ["src/features/cloud/components/shared.tsx", 'import "./command-blocks.css";'],
  ["src/features/cloud/sections/overview/OverviewSection.tsx", 'import "./overview.css";'],
  ["src/features/cloud/sections/settings/SettingsSection.tsx", 'import "./settings.css";'],
  ["src/features/cloud/access-points/components/AccessPointCatalogPage.tsx", 'import "../styles/catalog-page.css";'],
  ["src/features/cloud/access-points/components/AccessPointList.tsx", 'import "../styles/access-point-list.css";'],
  ["src/features/cloud/access-points/components/AccessPointManageDialog.tsx", 'import "../styles/manage-dialog.css";'],
  ["src/features/cloud/sections/access/ScopeAccessDetail.tsx", 'import "./access.css";'],
  ["src/features/cloud/sections/branches/BranchesSection.tsx", 'import "./branches.css";'],
  ["src/features/cloud/history/CloudHistoryView.tsx", 'import "./history.css";'],
  ["src/features/cloud/initialization/CloudInitializationView.tsx", 'import "./initialization.css";'],
];
for (const [owner, styleImport] of ownedStyles) {
  if (!read(owner).includes(styleImport)) errors.push(`${owner} must import its owned stylesheet directly`);
}

const cloudStyleEntry = read("src/features/cloud/cloud-service.css");
if (!cloudStyleEntry.includes('@import "./styles/primitives.css";')) {
  errors.push("Cloud shared presentation primitives must be loaded by cloud-service.css");
}

for (const relativePath of [
  "src/features/cloud/auth/cloud-auth-card.css",
  "src/features/cloud/auth/cloud-sign-in.css",
  "src/features/cloud/components/shared.css",
  "src/features/cloud/components/web-page.css",
  "src/features/cloud/components/command-blocks.css",
  "src/features/cloud/access-points/styles/catalog-page.css",
  "src/features/cloud/access-points/styles/access-point-list.css",
  "src/features/cloud/access-points/styles/manage-dialog.css",
  "src/features/cloud/initialization/initialization.css",
  "src/features/cloud/organization/organization.css",
  "src/features/cloud/sections/branches/branches.css",
  "src/features/cloud/sections/settings/settings.css",
]) {
  if (!read(relativePath).includes("@layer features {")) {
    errors.push(`${relativePath} must keep component-owned CSS inside the registered features layer`);
  }
}

const expectedOverviewStyleManifest = [
  '@import "./styles/base.css" layer(features);',
  '@import "./styles/project-identity.css" layer(features);',
  '@import "./styles/status-cards.css" layer(features);',
  '@import "./styles/dashboard-grid.css" layer(features);',
  '@import "./styles/resource-cards.css" layer(features);',
  '@import "./styles/responsive.css" layer(features);',
].join("\n");
if (read("src/features/cloud/sections/overview/overview.css").trim() !== expectedOverviewStyleManifest) {
  errors.push("Overview styles must keep their layered manifest in semantic render order");
}

const expectedHistoryStyleManifest = [
  "/* Cloud History stylesheet manifest. */",
  '@import "../graph/graph.css" layer(features);',
  '@import "./styles/sidebar.css" layer(features);',
  '@import "./styles/detail.css" layer(features);',
].join("\n");
if (read("src/features/cloud/history/history.css").trim() !== expectedHistoryStyleManifest) {
  errors.push("History styles must keep their layered manifest in semantic render order");
}

const accessStyleManifest = read("src/features/cloud/sections/access/access.css");
if (!accessStyleManifest.split(/\r?\n/).slice(1).every((line) => (
  line.length === 0 || /^@import "\.\/styles\/[^"]+" layer\(features\);$/.test(line)
))) {
  errors.push("Access component styles must be imported only through its layered manifest");
}

for (const filePath of walkCss(resolve("src/features/cloud/sections/access/styles"))) {
  const lines = countLines(readAbsolute(filePath));
  if (lines > 800) {
    errors.push(`${path.relative(repoRoot, filePath)} has ${lines} lines; split Access styles by component`);
  }
}

for (const filePath of walkCss(resolve("src/features/cloud/access-points/styles"))) {
  const lines = countLines(readAbsolute(filePath));
  if (lines > 800) {
    errors.push(`${path.relative(repoRoot, filePath)} has ${lines} lines; split Access Point styles by component`);
  }
}

const cloudCss = walkCss(resolve("src/features/cloud"))
  .map((filePath) => readAbsolute(filePath))
  .join("\n");
const rendererSource = productionCode
  .filter(({ filePath }) => filePath.startsWith(resolve("src")))
  .map(({ source }) => source)
  .join("\n");
const cloudClassNames = new Set(
  [...cloudCss.matchAll(/\.((?:desktop-cloud)-[a-z0-9-]+)/g)].map((match) => match[1]),
);
for (const className of cloudClassNames) {
  if (!rendererSource.includes(className)) {
    errors.push(`Cloud CSS class has no renderer owner: ${className}`);
  }
}

if (errors.length > 0) {
  console.error("Cloud frontend architecture check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Cloud frontend architecture check passed.");

function resolve(relativePath) {
  return path.join(repoRoot, relativePath);
}

function read(relativePath) {
  const filePath = resolve(relativePath);
  if (!existsSync(filePath)) {
    errors.push(`required Cloud architecture file is missing: ${relativePath}`);
    return "";
  }
  return readAbsolute(filePath);
}

function readAbsolute(filePath) {
  return readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

function countLines(source) {
  return source.length === 0 ? 0 : source.split(/\r?\n/).length;
}

function walkCss(directory) {
  return walkFiles(directory).filter((filePath) => filePath.endsWith(".css"));
}

function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(filePath) : [filePath];
  });
}

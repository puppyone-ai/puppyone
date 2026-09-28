import type { ComponentType } from "react";
import { Clock3, Cloud, CreditCard, FolderOpen, GitBranch, Grid2X2, House, Settings, ShieldCheck, SquareTerminal, Users } from "lucide-react";
import type { MessageFormatter } from "@puppyone/localization/core";
import { getCloudAutomationWebPath } from "../../automation/automationDomain";
import { McpLogoIcon } from "../components/McpLogoIcon";
import type { CloudProjectDetailResource } from "../data/cloudProjectDetails";
import type { CloudWorkspaceSection } from "./cloudRouteIds";

export type CloudRouteContext = "initialization" | "project" | "organization";
export type CloudRouteSurface = "standard" | "landing" | "history" | "automation";
export type CloudRouteNavigationGroup = "project" | "connections" | "automation" | "organization";
export type CloudRouteIcon = ComponentType<{
  className?: string;
  size?: number | string;
}>;

export type CloudRouteDescriptor = {
  id: CloudWorkspaceSection;
  labelId: string;
  titleId: string;
  descriptionId: string;
  icon: CloudRouteIcon;
  context: CloudRouteContext;
  surface: CloudRouteSurface;
  resources: readonly CloudProjectDetailResource[];
  showInSidebar: boolean;
  navigationGroup?: CloudRouteNavigationGroup;
  requiredCapability?: string;
  webPath: (projectId?: string) => string;
};

/** Every Shell Cloud entry starts from the product Homepage. */
export const CLOUD_HUB_ENTRY_SECTION = "contents" satisfies CloudWorkspaceSection;

const NO_PROJECT_RESOURCES = [] as const satisfies readonly CloudProjectDetailResource[];
const OVERVIEW_PROJECT_RESOURCES = [
  "dashboard",
  "tree",
  "history",
  "scopes",
  "connectors",
  "mcp-endpoints",
  "identity",
] as const satisfies readonly CloudProjectDetailResource[];
const ACCESS_PROJECT_RESOURCES = [
  "scopes",
  "connectors",
  "mcp-endpoints",
  "identity",
] as const satisfies readonly CloudProjectDetailResource[];
export const CLOUD_ROUTES = [
  {
    id: "initialize",
    labelId: "cloud.route.initialize.label",
    titleId: "cloud.route.initialize.title",
    descriptionId: "cloud.route.initialize.description",
    icon: Cloud,
    context: "initialization",
    surface: "standard",
    resources: NO_PROJECT_RESOURCES,
    showInSidebar: false,
    webPath: () => "/projects",
  },
  {
    id: "cloud-team",
    labelId: "cloud.route.cloud-team.label",
    titleId: "cloud.route.cloud-team.title",
    descriptionId: "cloud.route.cloud-team.description",
    icon: Users,
    context: "organization",
    surface: "standard",
    resources: NO_PROJECT_RESOURCES,
    showInSidebar: true,
    navigationGroup: "organization",
    webPath: () => "/team",
  },
  {
    id: "cloud-billing",
    labelId: "cloud.route.cloud-billing.label",
    titleId: "cloud.route.cloud-billing.title",
    descriptionId: "cloud.route.cloud-billing.description",
    icon: CreditCard,
    context: "organization",
    surface: "standard",
    resources: NO_PROJECT_RESOURCES,
    showInSidebar: true,
    navigationGroup: "organization",
    webPath: () => "/billing",
  },
  {
    id: "contents",
    labelId: "cloud.route.contents.label",
    titleId: "cloud.route.contents.title",
    descriptionId: "cloud.route.contents.description",
    icon: House,
    context: "project",
    surface: "landing",
    resources: OVERVIEW_PROJECT_RESOURCES,
    showInSidebar: true,
    navigationGroup: "project",
    webPath: (projectId?: string) => `/projects/${requireProjectId(projectId)}/data`,
  },
  {
    /**
     * Project identity, storage, and files. Under the Share experiment the
     * Homepage is Share-first and this becomes the second sidebar entry.
     */
    id: "project",
    labelId: "cloud.route.project.label",
    titleId: "cloud.route.project.title",
    descriptionId: "cloud.route.project.description",
    icon: FolderOpen,
    context: "project",
    surface: "landing",
    resources: OVERVIEW_PROJECT_RESOURCES,
    showInSidebar: false,
    navigationGroup: "project",
    webPath: (projectId?: string) => `/projects/${requireProjectId(projectId)}/data`,
  },
  {
    id: "mcp",
    labelId: "cloud.route.mcp.label",
    titleId: "cloud.route.mcp.title",
    descriptionId: "cloud.route.mcp.description",
    icon: McpLogoIcon,
    context: "project",
    surface: "landing",
    resources: ACCESS_PROJECT_RESOURCES,
    showInSidebar: true,
    navigationGroup: "connections",
    webPath: (projectId?: string) => `/projects/${requireProjectId(projectId)}/access`,
  },
  {
    id: "cli",
    labelId: "cloud.route.cli.label",
    titleId: "cloud.route.cli.title",
    descriptionId: "cloud.route.cli.description",
    icon: SquareTerminal,
    context: "project",
    surface: "landing",
    resources: ACCESS_PROJECT_RESOURCES,
    showInSidebar: true,
    navigationGroup: "connections",
    webPath: (projectId?: string) => `/projects/${requireProjectId(projectId)}/access`,
  },
  {
    id: "history",
    labelId: "cloud.route.history.label",
    titleId: "cloud.route.history.title",
    descriptionId: "cloud.route.history.description",
    icon: Clock3,
    context: "project",
    surface: "history",
    resources: NO_PROJECT_RESOURCES,
    showInSidebar: false,
    webPath: (projectId?: string) => `/projects/${requireProjectId(projectId)}/changes`,
  },
  {
    id: "branches",
    labelId: "cloud.route.branches.label",
    titleId: "cloud.route.branches.title",
    descriptionId: "cloud.route.branches.description",
    icon: GitBranch,
    context: "project",
    surface: "standard",
    resources: NO_PROJECT_RESOURCES,
    showInSidebar: false,
    webPath: (projectId?: string) => `/projects/${requireProjectId(projectId)}/changes`,
  },
  {
    id: "automation",
    labelId: "cloud.route.automation.label",
    titleId: "cloud.route.automation.title",
    descriptionId: "cloud.route.automation.description",
    icon: Grid2X2,
    context: "project",
    surface: "automation",
    resources: ACCESS_PROJECT_RESOURCES,
    showInSidebar: true,
    navigationGroup: "automation",
    webPath: (projectId?: string) => getCloudAutomationWebPath(requireProjectId(projectId)),
  },
  {
    id: "access",
    labelId: "cloud.route.access.label",
    titleId: "cloud.route.access.title",
    descriptionId: "cloud.route.access.description",
    icon: ShieldCheck,
    context: "project",
    surface: "landing",
    resources: ACCESS_PROJECT_RESOURCES,
    showInSidebar: false,
    webPath: (projectId?: string) => `/projects/${requireProjectId(projectId)}/access`,
  },
  {
    id: "git-sync",
    labelId: "cloud.route.git-sync.label",
    titleId: "cloud.route.git-sync.title",
    descriptionId: "cloud.route.git-sync.description",
    icon: GitBranch,
    context: "project",
    surface: "landing",
    resources: ACCESS_PROJECT_RESOURCES,
    showInSidebar: false,
    navigationGroup: "connections",
    webPath: (projectId?: string) => `/projects/${requireProjectId(projectId)}/access`,
  },
  {
    id: "team",
    labelId: "cloud.route.team.label",
    titleId: "cloud.route.team.title",
    descriptionId: "cloud.route.team.description",
    icon: Users,
    context: "project",
    surface: "standard",
    resources: NO_PROJECT_RESOURCES,
    showInSidebar: false,
    webPath: (projectId?: string) => `/projects/${requireProjectId(projectId)}/settings`,
    requiredCapability: "project.settings.manage",
  },
  {
    id: "settings",
    labelId: "cloud.route.settings.label",
    titleId: "cloud.route.settings.title",
    descriptionId: "cloud.route.settings.description",
    icon: Settings,
    context: "project",
    surface: "landing",
    resources: NO_PROJECT_RESOURCES,
    showInSidebar: false,
    requiredCapability: "project.settings.manage",
    webPath: (projectId?: string) => `/projects/${requireProjectId(projectId)}/settings`,
  },
] as const satisfies readonly CloudRouteDescriptor[];

const CLOUD_ROUTE_BY_ID = new Map<CloudWorkspaceSection, CloudRouteDescriptor>(
  CLOUD_ROUTES.map((route) => [route.id, route]),
);

export const CLOUD_ORGANIZATION_ROUTES = CLOUD_ROUTES.filter((route) => route.context === "organization" && route.showInSidebar);
export const CLOUD_PROJECT_ROUTES = CLOUD_ROUTES.filter((route) => route.context === "project");
const CLOUD_PROJECT_SIDEBAR_ORDER: readonly CloudWorkspaceSection[] = [
  "contents",
  "mcp",
  "cli",
  "git-sync",
  "automation",
];
export const CLOUD_PROJECT_SIDEBAR_ROUTES = CLOUD_PROJECT_ROUTES
  .filter((route) => route.showInSidebar)
  .sort((left, right) => (
    CLOUD_PROJECT_SIDEBAR_ORDER.indexOf(left.id)
    - CLOUD_PROJECT_SIDEBAR_ORDER.indexOf(right.id)
  ));
/** Stable repository-context shell: current Project sections + Organization destinations. */
export const CLOUD_BOUND_PROJECT_SIDEBAR_ROUTES = [
  ...CLOUD_PROJECT_SIDEBAR_ROUTES,
  ...CLOUD_ORGANIZATION_ROUTES,
];

/**
 * Share experiment: Homepage answers "who should read this?", so Project
 * identity and files get their own second entry right below it.
 */
export function withShareHomeSidebarRoutes(
  routes: readonly CloudRouteDescriptor[],
): CloudRouteDescriptor[] {
  const projectRoute = getCloudRoute("project");
  const homeIndex = routes.findIndex((route) => route.id === CLOUD_HUB_ENTRY_SECTION);
  if (homeIndex === -1 || routes.includes(projectRoute)) return [...routes];
  return [...routes.slice(0, homeIndex + 1), projectRoute, ...routes.slice(homeIndex + 1)];
}

export function normalizeCloudSection(
  section: CloudWorkspaceSection | string,
): CloudWorkspaceSection {
  if (section === "mcp-cli") return "mcp";
  return CLOUD_ROUTE_BY_ID.has(section as CloudWorkspaceSection)
    ? section as CloudWorkspaceSection
    : "contents";
}

export function getAvailableCloudSection(
  section: CloudWorkspaceSection | string,
  { automationEnabled }: { automationEnabled: boolean },
): CloudWorkspaceSection {
  const normalizedSection = normalizeCloudSection(section);
  return normalizedSection === "automation" && !automationEnabled
    ? "contents"
    : normalizedSection;
}

/** Use the primary product capability as the first signed-out Cloud destination. */
export function getCloudSignedOutSection(
  section: CloudWorkspaceSection | string,
): CloudWorkspaceSection {
  const normalizedSection = normalizeCloudSection(section);
  return normalizedSection === "initialize" ? "mcp" : normalizedSection;
}

/**
 * Project Settings and History are low-frequency Homepage drill-downs. Keep
 * Homepage selected while either detail surface is open.
 */
export function getCloudSidebarActiveSection(
  section: CloudWorkspaceSection | string,
): CloudWorkspaceSection {
  const normalizedSection = normalizeCloudSection(section);
  return normalizedSection === "settings" || normalizedSection === "history"
    ? "contents"
    : normalizedSection;
}

export function getCloudRoute(section: CloudWorkspaceSection): CloudRouteDescriptor {
  return CLOUD_ROUTE_BY_ID.get(section) ?? CLOUD_ROUTE_BY_ID.get("contents")!;
}

export function getCloudSectionDescriptor(section: CloudWorkspaceSection, t: MessageFormatter) {
  const route = getCloudRoute(section);
  return {
    title: t(route.titleId),
    description: t(route.descriptionId),
    icon: route.icon,
  };
}

export function getCloudRouteLabel(route: CloudRouteDescriptor, t: MessageFormatter) {
  return t(route.labelId);
}

export function getCloudRouteWebPath(section: CloudWorkspaceSection, projectId?: string): string {
  return getCloudRoute(section).webPath(projectId);
}

export function getCloudRouteSurface(section: CloudWorkspaceSection): CloudRouteSurface {
  return getCloudRoute(section).surface;
}

export function getCloudProjectDetailResources(
  section: CloudWorkspaceSection,
): readonly CloudProjectDetailResource[] {
  return getCloudRoute(section).resources;
}

export function isCloudOrganizationSection(section: CloudWorkspaceSection): boolean {
  return getCloudRoute(section).context === "organization";
}

export function isCloudProjectSection(section: CloudWorkspaceSection): boolean {
  return getCloudRoute(section).context === "project";
}

function requireProjectId(projectId: string | undefined): string {
  const normalized = projectId?.trim();
  if (!normalized) {
    throw new Error("Cloud project route requires a project id.");
  }
  return normalized;
}

import { Cloud, CreditCard, FileText, GitBranch, Settings, ShieldCheck, SquareTerminal, Users } from "lucide-react";
import type { CloudWorkspaceSection } from "./cloudRouteIds";

export type CloudRouteContext = "projects" | "project" | "account";

export type CloudRouteDescriptor = {
  id: CloudWorkspaceSection;
  label: string;
  title: string;
  description: string;
  icon: typeof Cloud;
  context: CloudRouteContext;
  showInSidebar: boolean;
  groupEnd?: boolean;
  webPath: (projectId?: string) => string;
};

export const CLOUD_ROUTES = [
  {
    id: "overview",
    label: "Cloud Projects",
    title: "Context",
    description: "Cloud context starts by mapping this local folder to a Cloud project.",
    icon: Cloud,
    context: "projects",
    showInSidebar: true,
    groupEnd: true,
    webPath: (projectId?: string) => (projectId ? `/projects/${projectId}/access` : "/projects"),
  },
  {
    id: "cloud-team",
    label: "Team",
    title: "Team",
    description: "Cloud team members and invitations are managed at the organization level.",
    icon: Users,
    context: "account",
    showInSidebar: true,
    webPath: () => "/team",
  },
  {
    id: "cloud-billing",
    label: "Billing",
    title: "Billing",
    description: "Cloud plan, seats, and invoices are managed at the organization level.",
    icon: CreditCard,
    context: "account",
    showInSidebar: true,
    webPath: () => "/billing",
  },
  {
    id: "contents",
    label: "Contents",
    title: "Contents",
    description: "Cloud contents are loaded from the mapped project tree.",
    icon: FileText,
    context: "project",
    showInSidebar: true,
    webPath: (projectId?: string) => `/projects/${requireProjectId(projectId)}/data`,
  },
  {
    id: "branches",
    label: "Branches",
    title: "Branches",
    description: "Branches show the local and remote Git refs connected to this Cloud project.",
    icon: GitBranch,
    context: "project",
    showInSidebar: true,
    webPath: (projectId?: string) => `/projects/${requireProjectId(projectId)}/changes`,
  },
  {
    id: "access",
    label: "Access",
    title: "Access",
    description: "Access surfaces, scopes, connectors, and endpoint state belong to a Cloud project.",
    icon: ShieldCheck,
    context: "project",
    showInSidebar: true,
    groupEnd: true,
    webPath: (projectId?: string) => `/projects/${requireProjectId(projectId)}/access`,
  },
  {
    id: "mcp-cli",
    label: "MCP / CLI",
    title: "MCP / CLI",
    description: "MCP endpoints and CLI commands are generated from project access keys.",
    icon: SquareTerminal,
    context: "project",
    showInSidebar: false,
    webPath: (projectId?: string) => `/projects/${requireProjectId(projectId)}/access`,
  },
  {
    id: "git-sync",
    label: "Git Sync",
    title: "Git Sync",
    description: "Desktop Git sync needs a PuppyOne Cloud remote mapped to a project.",
    icon: GitBranch,
    context: "project",
    showInSidebar: false,
    groupEnd: true,
    webPath: (projectId?: string) => `/projects/${requireProjectId(projectId)}/access`,
  },
  {
    id: "team",
    label: "Team",
    title: "Team",
    description: "Project members and roles are managed after the local folder is connected.",
    icon: Users,
    context: "project",
    showInSidebar: false,
    webPath: (projectId?: string) => `/projects/${requireProjectId(projectId)}/settings`,
  },
  {
    id: "settings",
    label: "Settings",
    title: "Settings",
    description: "Project settings are available after this workspace is connected.",
    icon: Settings,
    context: "project",
    showInSidebar: true,
    webPath: (projectId?: string) => `/projects/${requireProjectId(projectId)}/settings`,
  },
] as const satisfies readonly CloudRouteDescriptor[];

export const CLOUD_ROUTE_BY_ID = Object.fromEntries(
  CLOUD_ROUTES.map((route) => [route.id, route]),
) as Record<CloudWorkspaceSection, CloudRouteDescriptor>;

export const CLOUD_ACCOUNT_ROUTES = CLOUD_ROUTES.filter((route) => route.context === "account" && route.showInSidebar);
export const CLOUD_PROJECT_ROUTES = CLOUD_ROUTES.filter((route) => route.context === "project");
export const CLOUD_PROJECT_SIDEBAR_ROUTES = CLOUD_PROJECT_ROUTES.filter((route) => route.showInSidebar);
export const CLOUD_PROJECTS_SIDEBAR_ROUTES = CLOUD_ROUTES.filter((route) => route.context === "projects" && route.showInSidebar);
export const CLOUD_GLOBAL_SIDEBAR_ROUTES = [
  ...CLOUD_PROJECTS_SIDEBAR_ROUTES,
  ...CLOUD_ACCOUNT_ROUTES,
];

export function normalizeCloudSection(section: CloudWorkspaceSection | "cloud-settings"): CloudWorkspaceSection {
  if (section === "cloud-settings") return "overview";
  if (section === "mcp-cli" || section === "git-sync") return "access";
  return section;
}

export function getCloudRoute(section: CloudWorkspaceSection): CloudRouteDescriptor {
  return CLOUD_ROUTE_BY_ID[section] ?? CLOUD_ROUTE_BY_ID.overview;
}

export function getCloudSectionDescriptor(section: CloudWorkspaceSection): Pick<CloudRouteDescriptor, "title" | "description" | "icon"> {
  const route = getCloudRoute(section);
  return {
    title: route.title,
    description: route.description,
    icon: route.icon,
  };
}

export function getCloudRouteWebPath(section: CloudWorkspaceSection, projectId?: string): string {
  return getCloudRoute(section).webPath(projectId);
}

export function isCloudAccountSection(section: CloudWorkspaceSection): boolean {
  return getCloudRoute(section).context === "account";
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

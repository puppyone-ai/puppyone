import type { ComponentType } from "react";
import { Clock3, CreditCard, GitBranch, Settings, ShieldCheck, SquareTerminal, Users } from "lucide-react";
import type { MessageFormatter } from "@puppyone/localization/core";
import { CloudIcon, FolderIcon, HomeIcon } from "@puppyone/shared-ui";
import { McpLogoIcon } from "../components/McpLogoIcon";
import type { CloudProjectDetailResource } from "../data/cloudProjectDetails";
import type { CloudWorkspaceSection } from "./cloudRouteIds";

export type CloudRouteContext = "initialization" | "project" | "organization";
export type CloudRouteSurface = "standard" | "landing" | "history" | "automation";
export type CloudRouteIcon = ComponentType<{ className?: string; size?: number | string }>;

/** Service metadata and Web destinations, not a Desktop services navigation tree. */
export type CloudRouteDescriptor = {
  id: CloudWorkspaceSection;
  labelId: string;
  titleId: string;
  descriptionId: string;
  icon: CloudRouteIcon;
  context: CloudRouteContext;
  surface: CloudRouteSurface;
  resources: readonly CloudProjectDetailResource[];
  requiredCapability?: string;
  webPath: (projectId?: string) => string;
};

const NO_PROJECT_RESOURCES = [] as const;
const OVERVIEW_PROJECT_RESOURCES = ["dashboard", "tree", "history", "scopes", "connectors", "mcp-endpoints", "identity"] as const;
const ACCESS_PROJECT_RESOURCES = ["scopes", "connectors", "mcp-endpoints", "identity"] as const;

type RouteInput = Omit<CloudRouteDescriptor, "labelId" | "titleId" | "descriptionId">;
function route(input: RouteInput): CloudRouteDescriptor {
  return { ...input, labelId: `cloud.route.${input.id}.label`, titleId: `cloud.route.${input.id}.title`,
    descriptionId: `cloud.route.${input.id}.description` };
}
const projectPath = (page: string) => (projectId?: string) => `/projects/${requireProjectId(projectId)}/${page}`;

export const CLOUD_ROUTES: readonly CloudRouteDescriptor[] = [
  route({ id: "initialize", icon: CloudIcon, context: "initialization", surface: "standard", resources: NO_PROJECT_RESOURCES, webPath: () => "/projects" }),
  route({ id: "cloud-team", icon: Users, context: "organization", surface: "standard", resources: NO_PROJECT_RESOURCES, webPath: () => "/team" }),
  route({ id: "cloud-billing", icon: CreditCard, context: "organization", surface: "standard", resources: NO_PROJECT_RESOURCES, webPath: () => "/billing" }),
  route({ id: "contents", icon: HomeIcon, context: "project", surface: "landing", resources: OVERVIEW_PROJECT_RESOURCES, webPath: projectPath("data") }),
  route({ id: "project", icon: FolderIcon, context: "project", surface: "landing", resources: OVERVIEW_PROJECT_RESOURCES, webPath: projectPath("data") }),
  route({ id: "mcp", icon: McpLogoIcon, context: "project", surface: "landing", resources: ACCESS_PROJECT_RESOURCES, webPath: projectPath("access") }),
  route({ id: "cli", icon: SquareTerminal, context: "project", surface: "landing", resources: ACCESS_PROJECT_RESOURCES, webPath: projectPath("access") }),
  route({ id: "history", icon: Clock3, context: "project", surface: "history", resources: NO_PROJECT_RESOURCES, webPath: projectPath("changes") }),
  route({ id: "branches", icon: GitBranch, context: "project", surface: "standard", resources: NO_PROJECT_RESOURCES, webPath: projectPath("changes") }),
  route({ id: "access", icon: ShieldCheck, context: "project", surface: "landing", resources: ACCESS_PROJECT_RESOURCES, webPath: projectPath("access") }),
  route({ id: "git-sync", icon: GitBranch, context: "project", surface: "landing", resources: ACCESS_PROJECT_RESOURCES, webPath: projectPath("access") }),
  route({ id: "team", icon: Users, context: "project", surface: "standard", resources: NO_PROJECT_RESOURCES, webPath: projectPath("settings"), requiredCapability: "project.settings.manage" }),
  route({ id: "settings", icon: Settings, context: "project", surface: "landing", resources: NO_PROJECT_RESOURCES, webPath: projectPath("settings"), requiredCapability: "project.settings.manage" }),
];
const CLOUD_ROUTE_BY_ID = new Map(CLOUD_ROUTES.map(item => [item.id, item]));

export function normalizeCloudSection(section: CloudWorkspaceSection | string): CloudWorkspaceSection {
  if (section === "mcp-cli") return "mcp";
  return CLOUD_ROUTE_BY_ID.has(section as CloudWorkspaceSection) ? section as CloudWorkspaceSection : "contents";
}

/** Authentication keeps the task that requested it; publishing is never an MCP funnel. */
export function getCloudSignedOutSection(section: CloudWorkspaceSection | string): CloudWorkspaceSection {
  return normalizeCloudSection(section);
}

export function getCloudRoute(section: CloudWorkspaceSection): CloudRouteDescriptor {
  return CLOUD_ROUTE_BY_ID.get(section) ?? CLOUD_ROUTE_BY_ID.get("contents")!;
}
export function getCloudSectionDescriptor(section: CloudWorkspaceSection, t: MessageFormatter) {
  const descriptor = getCloudRoute(section);
  return { title: t(descriptor.titleId), description: t(descriptor.descriptionId), icon: descriptor.icon };
}
export function getCloudRouteLabel(descriptor: CloudRouteDescriptor, t: MessageFormatter) { return t(descriptor.labelId); }
export function getCloudRouteWebPath(section: CloudWorkspaceSection, projectId?: string): string { return getCloudRoute(section).webPath(projectId); }
export function getCloudRouteSurface(section: CloudWorkspaceSection): CloudRouteSurface { return getCloudRoute(section).surface; }
export function getCloudProjectDetailResources(section: CloudWorkspaceSection): readonly CloudProjectDetailResource[] { return getCloudRoute(section).resources; }
export function isCloudOrganizationSection(section: CloudWorkspaceSection): boolean { return getCloudRoute(section).context === "organization"; }
export function isCloudProjectSection(section: CloudWorkspaceSection): boolean { return getCloudRoute(section).context === "project"; }
function requireProjectId(projectId: string | undefined): string {
  const normalized = projectId?.trim();
  if (!normalized) throw new Error("Cloud project route requires a project id.");
  return normalized;
}

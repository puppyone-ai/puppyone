import type { DesktopCloudRepositoryView } from "../../../../lib/cloudApi";
import type { MessageFormatter } from "@puppyone/localization/core";
import type { AccessPointCatalogKind } from "../../access-points/model";
import { normalizeCloudEntryPath } from "../../utils";

export type OptionalAccessProvider = "mcp" | "sandbox";
export type CreateAccessIntent = "remote_workspace" | "git_remote" | "cli" | "ai_agent";

export const OPTIONAL_ACCESS_METHODS: Array<{
  provider: OptionalAccessProvider;
  direction: "inbound";
  descriptionId: string;
  supported: boolean;
}> = [
  {
    provider: "mcp",
    direction: "inbound",
    descriptionId: "cloud.access.create.method.mcpDescription",
    supported: true,
  },
  {
    provider: "sandbox",
    direction: "inbound",
    descriptionId: "cloud.access.create.method.sandboxDescription",
    supported: false,
  },
];

export const CREATE_ACCESS_INTENT_OPTIONS: Array<{
  id: CreateAccessIntent;
  labelId: string;
  provider: string;
  preview?: string;
  previewId?: string;
  chipIds: string[];
}> = [
  {
    id: "remote_workspace",
    labelId: "cloud.access.create.intent.editor.label",
    provider: "sandbox",
    previewId: "cloud.access.create.intent.editor.preview",
    chipIds: ["cloud.access.create.chip.editor", "cloud.access.create.chip.gitReady", "cloud.access.create.chip.noClone"],
  },
  {
    id: "git_remote",
    labelId: "cloud.access.create.intent.git.label",
    provider: "git_remote",
    preview: "git clone https://.../access.git",
    chipIds: ["cloud.access.create.chip.localFiles", "cloud.access.create.chip.gitFlow"],
  },
  {
    id: "cli",
    labelId: "cloud.access.create.intent.cli.label",
    provider: "cli",
    preview: "puppyone fs ls /company/sales",
    chipIds: ["cloud.access.create.chip.noClone", "cloud.access.create.chip.scriptable"],
  },
  {
    id: "ai_agent",
    labelId: "cloud.access.create.intent.agent.label",
    provider: "mcp",
    previewId: "cloud.access.create.intent.agent.preview",
    chipIds: ["cloud.access.create.chip.aiAgent", "cloud.access.create.chip.toolCalls"],
  },
];

export function getCreateAccessIntentForCatalogKind(
  kind: AccessPointCatalogKind,
): CreateAccessIntent {
  if (kind === "cli") return "cli";
  if (kind === "git") return "git_remote";
  return "ai_agent";
}

export function normalizeAccessPath(path: string) {
  return normalizeCloudEntryPath(path).replace(/\/+/g, "/");
}

export function formatAccessPath(path: string, t: MessageFormatter) {
  const parts = normalizeAccessPath(path).split("/").filter(Boolean);
  return parts.length === 0 ? t("cloud.common.root") : [t("cloud.common.root"), ...parts].join(" / ");
}

export function formatTreePath(path: string, t: MessageFormatter) {
  const normalized = normalizeAccessPath(path);
  return normalized ? `/${normalized}` : t("cloud.access.create.projectFiles");
}

export function defaultScopeName(path: string) {
  if (!path) return "root";
  const parts = path.split("/").filter(Boolean);
  const last = parts.length > 0 ? parts[parts.length - 1] : path;
  return last
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeAccessProviderKey(provider: string) {
  return provider.trim().toLowerCase().replace(/-/g, "_");
}

export function getAccessProviderLabel(provider: string, t: MessageFormatter) {
  const normalized = normalizeAccessProviderKey(provider);
  if (normalized === "cli") return t("cloud.access.method.cli.title");
  if (normalized === "git" || normalized === "git_remote" || normalized === "filesystem") return t("cloud.access.surface.git.title");
  if (normalized === "mcp" || normalized === "mcp_endpoint") return t("cloud.access.surface.mcp.title");
  if (normalized === "sandbox" || normalized === "vm" || normalized === "remote_workspace") return t("cloud.access.surface.vm.title");
  return provider
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

export function getCreateAccessTileProvider(provider: string) {
  const normalized = normalizeAccessProviderKey(provider);
  if (normalized === "cli") return "cli";
  if (normalized === "git" || normalized === "git_remote" || normalized === "filesystem") return "git";
  if (normalized === "mcp" || normalized === "mcp_endpoint") return "mcp";
  return "default";
}

export function getCliAccessRowId(scope: DesktopCloudRepositoryView) {
  return `${scope.id}:builtin:cli:${scope.id}`;
}

export function getGitAccessRowId(scope: DesktopCloudRepositoryView) {
  return `${scope.id}:builtin:git:${scope.id}`;
}

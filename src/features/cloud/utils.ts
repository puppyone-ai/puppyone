import { Bot, Database, GitBranch, Link, Server, SquareTerminal } from "lucide-react";
import type { LocaleFormatters, MessageFormatter } from "@puppyone/localization/core";
import {
  RENDERER_ASSET_PATHS,
  resolveRendererPublicAssetUrl,
} from "@puppyone/shared-ui";
import type {
  DesktopCloudAccessSurface,
  DesktopCloudRepoIdentity,
  DesktopCloudRepositoryView,
  DesktopCloudScope,
  DesktopCloudTreeEntry,
} from "../../lib/cloudApi";
import type { DesktopCloudHistory } from "../../lib/cloudHistoryApi";
import type { GitCommitSummary } from "../../types/electron";
import { projectRootRepositoryView, repositoryScopeView } from "./repositoryTarget";

export type CloudPresentationContext = Pick<
  LocaleFormatters,
  "formatNumber" | "formatDate" | "formatRelativeTime"
> & { t: MessageFormatter };

export function unwrapSettled<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

export function formatCloudTreeEntryDetail(entry: DesktopCloudTreeEntry, context: CloudPresentationContext) {
  if (entry.type === "folder") {
    const count = entry.children_count ?? 0;
    return context.t("cloud.tree.children", { count });
  }
  return [entry.type, formatBytes(entry.size_bytes, context)].filter(Boolean).join(" · ");
}

export function normalizeCloudEntryPath(path: string) {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

export function formatBytes(bytes: number | null | undefined, context: Pick<CloudPresentationContext, "formatNumber" | "t">) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "";
  if (bytes >= 1024 * 1024) {
    return context.t("cloud.size.megabytes", {
      value: context.formatNumber(bytes / 1024 / 1024, { maximumFractionDigits: 1 }),
    });
  }
  if (bytes >= 1024) {
    return context.t("cloud.size.kilobytes", {
      value: context.formatNumber(bytes / 1024, { maximumFractionDigits: 1 }),
    });
  }
  return context.t("cloud.size.bytes", { value: context.formatNumber(bytes) });
}

export function formatInteger(value: number, formatNumber: LocaleFormatters["formatNumber"]) {
  return formatNumber(Number.isFinite(value) ? value : 0);
}

export function formatCommitChangeCount(changes: DesktopCloudHistory["commits"][number]["changes"], t: MessageFormatter) {
  const count = changes?.length ?? 0;
  return t("cloud.history.fileChangeCount", { count });
}

export function formatGitCommitChangeCount(changes: GitCommitSummary["changes"], t: MessageFormatter) {
  const count = changes?.length ?? 0;
  return t("cloud.history.fileChangeCount", { count });
}

export function providerIcon(provider: string) {
  if (provider === "mcp" || provider === "mcp_endpoint") return Server;
  if (provider === "agent") return Bot;
  if (provider === "cli") return SquareTerminal;
  if (provider === "filesystem" || provider === "git" || provider === "git_remote") return GitBranch;
  if (provider.includes("drive") || provider.includes("notion") || provider.includes("gmail")) return Database;
  return Link;
}

export function normalizeProviderKey(provider: string) {
  return provider.trim().toLowerCase().replace(/-/g, "_");
}

export function getCloudProviderIconUrl(provider: string) {
  const integrations = RENDERER_ASSET_PATHS.icons.integrations;
  switch (normalizeProviderKey(provider)) {
    case "gmail":
      return resolveRendererPublicAssetUrl(integrations.gmail);
    case "google_calendar":
      return resolveRendererPublicAssetUrl(integrations.googleCalendar);
    case "google_docs":
      return resolveRendererPublicAssetUrl(integrations.googleDocs);
    case "google_sheets":
      return resolveRendererPublicAssetUrl(integrations.googleSheets);
    case "notion":
      return resolveRendererPublicAssetUrl(integrations.notion);
    case "airtable":
      return resolveRendererPublicAssetUrl(integrations.airtable);
    case "linear":
      return resolveRendererPublicAssetUrl(integrations.linear);
    case "supabase":
      return resolveRendererPublicAssetUrl(integrations.supabase);
    case "slack":
      return resolveRendererPublicAssetUrl(integrations.slack);
    default:
      return "";
  }
}

export function formatProviderLabel(provider: string, t: MessageFormatter) {
  const normalized = normalizeProviderKey(provider);
  if (normalized === "cli") return t("cloud.access.surface.cli.title");
  if (normalized === "filesystem" || normalized === "git" || normalized === "git_remote") {
    return t("cloud.access.surface.git.title");
  }
  if (normalized === "mcp" || normalized === "mcp_endpoint") return t("cloud.access.surface.mcp.title");
  if (normalized === "vm" || normalized === "remote_workspace" || normalized === "sandbox") {
    return t("cloud.access.surface.vm.title");
  }
  return humanizeIdentifier(provider);
}

export function formatStatusLabel(status: string | null | undefined, t: MessageFormatter) {
  const normalized = normalizeProviderKey(status ?? "");
  const known = new Set([
    "active", "added", "allowed", "blocked", "changed", "copied", "deleted", "diverged",
    "error", "incoming", "manual", "missing", "modified", "needs_key", "off", "outgoing", "paused", "ready",
    "renamed", "required", "revoked", "staged", "syncing", "synced", "unknown", "unstaged", "untracked",
  ]);
  return known.has(normalized)
    ? t(`cloud.status.${normalized.replace(/_/g, "-")}`)
    : humanizeIdentifier(status ?? "") || t("cloud.status.unknown");
}

export function statusLabel(status: string, t: MessageFormatter) {
  return formatStatusLabel(status || "changed", t);
}

export function getApiBaseFromGitUrl(gitUrl: string) {
  try {
    const url = new URL(gitUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

export function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

export function getCloudScopeRows(
  scopes: DesktopCloudScope[],
  identity: DesktopCloudRepoIdentity | null,
  canonicalProjectId?: string | null,
): DesktopCloudRepositoryView[] {
  const projectId = canonicalProjectId ?? identity?.project_id ?? scopes[0]?.project_id ?? null;
  if (!projectId) return [];
  return [
    projectRootRepositoryView(projectId),
    ...scopes.map(repositoryScopeView),
  ];
}

export function getCanonicalGitUrlForView(
  identity: DesktopCloudRepoIdentity | null,
  scope: DesktopCloudRepositoryView | null,
  apiBase = "",
): string {
  if (!identity) return "";
  if (!scope || scope.target.kind === "project_root") return identity.url ?? "";
  const identityScope = identity.scopes.find((entry) => entry.id === scope.id);
  if (identityScope?.git_url) return identityScope.git_url;
  const base = apiBase || getApiBaseFromGitUrl(identity.url);
  return base && identity.project_id
    ? `${base.replace(/\/+$/, "")}/git/${encodeURIComponent(identity.project_id)}/scopes/${encodeURIComponent(scope.id)}.git`
    : "";
}

export function getScopeDisplayName(scope: DesktopCloudRepositoryView, t: MessageFormatter) {
  if (scope.name?.trim()) return scope.name.trim();
  if (scope.target.kind === "project_root") return t("cloud.scope.workspaceRoot");
  const parts = normalizeCloudEntryPath(scope.path).split("/");
  return parts[parts.length - 1] || scope.path;
}

/** Locale-neutral value for command/profile identifiers. */
export function getScopeIdentifierName(scope: DesktopCloudRepositoryView) {
  if (scope.name?.trim()) return scope.name.trim();
  const parts = normalizeCloudEntryPath(scope.path).split("/").filter(Boolean);
  return parts[parts.length - 1] || "root";
}

export function getScopePathLabel(scope: DesktopCloudRepositoryView) {
  const path = normalizeCloudEntryPath(scope.path);
  return path ? `/${path}` : "/";
}

export function isConnectorActiveStatus(status: string | null | undefined) {
  return status === "active" || status === "syncing" || status === "ready";
}

export function isScopeActive(
  scope: DesktopCloudRepositoryView,
  connectors: DesktopCloudAccessSurface[],
  endpointCount: number,
) {
  return Boolean(
    endpointCount > 0 ||
    connectors.some((connector) => isConnectorActiveStatus(connector.status)),
  );
}

export function profileSlug(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "root";
}

export function formatGitSyncState(state: string, t: MessageFormatter) {
  const known = new Set(["synced", "incoming", "outgoing", "diverged", "publish", "no-repository", "no-branch", "no-remote"]);
  const code = known.has(state) ? state : "no-remote";
  return t(`cloud.git.state.${code}`);
}

export function shortCommit(commitId: string) {
  return commitId.slice(0, 8);
}

export function formatRelativeTime(iso: string | null | undefined, context: CloudPresentationContext) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const deltaMs = date.getTime() - Date.now();
  const absoluteMs = Math.abs(deltaMs);
  if (absoluteMs < 60_000) return context.formatRelativeTime(0, "second", { numeric: "auto" });
  if (absoluteMs < 3_600_000) return context.formatRelativeTime(Math.round(deltaMs / 60_000), "minute", { numeric: "auto" });
  if (absoluteMs < 86_400_000) return context.formatRelativeTime(Math.round(deltaMs / 3_600_000), "hour", { numeric: "auto" });
  if (absoluteMs < 604_800_000) return context.formatRelativeTime(Math.round(deltaMs / 86_400_000), "day", { numeric: "auto" });
  return context.formatDate(date, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

export function formatCloudDate(iso: string | null | undefined, formatDate: LocaleFormatters["formatDate"]) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return formatDate(date, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

export function formatFullTime(iso: string | null | undefined, formatDate: LocaleFormatters["formatDate"]) {
  if (!iso) return "";
  return formatDate(new Date(iso), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function humanizeIdentifier(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

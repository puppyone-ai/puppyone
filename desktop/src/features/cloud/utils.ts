import { Bot, Cloud, Database, GitBranch, Link, Server, SquareTerminal } from "lucide-react";
import type {
  DesktopCloudConnector,
  DesktopCloudHistory,
  DesktopCloudMcpEndpoint,
  DesktopCloudRepoIdentity,
  DesktopCloudScope,
  DesktopCloudTreeEntry,
} from "../../lib/cloudApi";
import type { GitCommitSummary } from "../../types/electron";
import type { getPuppyoneRemote } from "../source-control/remotes";

export function unwrapSettled<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

export function formatCloudTreeEntryDetail(entry: DesktopCloudTreeEntry) {
  if (entry.type === "folder") {
    const count = entry.children_count ?? 0;
    return count === 1 ? "1 child" : `${count} children`;
  }
  return [entry.type, formatBytes(entry.size_bytes)].filter(Boolean).join(" - ");
}

export function normalizeCloudEntryPath(path: string) {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

export function formatBytes(bytes: number | null | undefined) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function formatInteger(value: number) {
  return Number.isFinite(value) ? value.toLocaleString() : "0";
}

export function formatPlural(count: number, singular: string) {
  return `${formatInteger(count)} ${singular}${count === 1 ? "" : "s"}`;
}

export function formatCommitChangeCount(changes: DesktopCloudHistory["commits"][number]["changes"]) {
  const count = changes?.length ?? 0;
  return count === 0 ? "No file changes recorded" : `${count} file${count === 1 ? "" : "s"} changed`;
}

export function formatGitCommitChangeCount(changes: GitCommitSummary["changes"]) {
  const count = changes?.length ?? 0;
  return count === 0 ? "No file changes recorded" : `${count} file${count === 1 ? "" : "s"} changed`;
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

export function isCloudIntegrationConnector(connector: DesktopCloudConnector) {
  const provider = normalizeProviderKey(connector.provider);
  return ![
    "",
    "agent",
    "cli",
    "filesystem",
    "git",
    "git_remote",
    "mcp",
    "mcp_endpoint",
    "sandbox",
    "sandbox_endpoint",
    "sync",
  ].includes(provider);
}

export function getCloudProviderIconUrl(provider: string) {
  switch (normalizeProviderKey(provider)) {
    case "gmail":
      return "/icons/gmail.svg";
    case "google_calendar":
      return "/icons/google_calendar.svg";
    case "google_docs":
      return "/icons/google_doc.svg";
    case "google_sheets":
      return "/icons/google_sheet.svg";
    case "notion":
      return "/icons/notion.svg";
    case "airtable":
      return "/icons/airtable.png";
    case "linear":
      return "/icons/linear.svg";
    case "supabase":
      return "/icons/supabase-icon.png";
    default:
      return "";
  }
}

export function formatProviderLabel(provider: string) {
  return provider
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part: string) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

export function formatStatusLabel(status: string) {
  return status
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ") || "Unknown";
}

export function statusLabel(status: string) {
  if (status === "untracked") return "Untracked";
  if (status === "added") return "Added";
  if (status === "deleted") return "Deleted";
  if (status === "renamed") return "Renamed";
  if (status === "copied") return "Copied";
  if (status === "modified") return "Modified";
  return "Changed";
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
): DesktopCloudScope[] {
  if (scopes.length > 0) return scopes;
  return (identity?.scopes ?? []).map((scope) => ({
    id: scope.id,
    project_id: identity?.project_id ?? "",
    name: scope.name,
    path: scope.path,
    exclude: [],
    mode: "rw",
    is_root: scope.is_root,
    access_key: scope.access_key,
  }));
}

export function buildCloudAccessPointScope(accessKey: string): DesktopCloudScope {
  return {
    id: `access-point:${accessKey}`,
    project_id: "",
    name: "Cloud source",
    path: "",
    exclude: [],
    mode: "rw",
    is_root: true,
    access_key: accessKey,
  };
}

export function buildCloudAccessPointIdentity(
  cloudRemote: NonNullable<ReturnType<typeof getPuppyoneRemote>>,
): DesktopCloudRepoIdentity {
  const accessKey = cloudRemote.info.kind === "access-point" ? cloudRemote.info.accessKey : null;
  const scope = accessKey ? buildCloudAccessPointScope(accessKey) : null;
  return {
    project_id: "",
    url: cloudRemote.rawUrl,
    content_initialized: true,
    scopes: scope
      ? [{
          id: scope.id,
          name: scope.name,
          path: scope.path,
          is_root: scope.is_root,
          access_key: scope.access_key,
        }]
      : [],
  };
}

export function getScopeDisplayName(scope: DesktopCloudScope) {
  if (scope.name?.trim()) return scope.name.trim();
  if (scope.is_root || !normalizeCloudEntryPath(scope.path)) return "Workspace root";
  const parts = normalizeCloudEntryPath(scope.path).split("/");
  return parts[parts.length - 1] || scope.path;
}

export function getScopePathLabel(scope: DesktopCloudScope) {
  const path = normalizeCloudEntryPath(scope.path);
  return path ? `/${path}` : "/";
}

export function isConnectorActiveStatus(status: string | null | undefined) {
  return status === "active" || status === "syncing" || status === "ready";
}

export function isScopeActive(
  scope: DesktopCloudScope,
  connectors: DesktopCloudConnector[],
  endpointCount: number,
) {
  return Boolean(
    (scope.access_key && !scope.access_key_revoked) ||
    endpointCount > 0 ||
    connectors.some((connector) => isConnectorActiveStatus(connector.status)),
  );
}

export function countScopeAccessSurfaces(
  scope: DesktopCloudScope,
  connectors: DesktopCloudConnector[],
  endpointCount: number,
) {
  const cliConnector = connectors.find((connector) => connector.provider === "cli");
  const gitConnector = connectors.find((connector) => (
    connector.provider === "filesystem" ||
    connector.provider === "git" ||
    connector.provider === "git_remote"
  ));
  const thirdPartyCount = connectors.filter((connector) => connector !== cliConnector && connector !== gitConnector).length;
  return 2 + endpointCount + thirdPartyCount;
}

export function scopeMatchesMcpEndpoint(scope: DesktopCloudScope, endpoint: DesktopCloudMcpEndpoint) {
  const scopePath = normalizeCloudEntryPath(scope.path);
  const endpointAccesses = endpoint.accesses ?? [];
  if (endpointAccesses.length > 0) {
    return endpointAccesses.some((access) => {
      const accessPath = normalizeCloudEntryPath(access.path || "");
      return scope.is_root ? accessPath === "" || accessPath === scopePath : accessPath === scopePath;
    });
  }
  const endpointPath = normalizeCloudEntryPath(endpoint.path ?? "");
  if (scope.is_root && !endpointPath) return true;
  return endpointPath === scopePath;
}

export function profileSlug(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "root";
}

export function formatGitSyncState(state: string) {
  switch (state) {
    case "synced":
      return "Synced";
    case "incoming":
      return "Incoming";
    case "outgoing":
      return "Outgoing";
    case "diverged":
      return "Diverged";
    case "publish":
      return "Publish";
    case "no-repository":
      return "No repository";
    case "no-branch":
      return "No branch";
    case "no-remote":
    default:
      return "No remote";
  }
}

export function getAccountInitial(email: string | null) {
  const value = email?.trim();
  if (!value) return "P";
  return value[0]?.toUpperCase() ?? "P";
}

export function formatSidebarAccount(email: string | null) {
  if (!email) return "Not signed in";
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  const shortName = name.length > 12 ? `${name.slice(0, 10)}...` : name;
  return `${shortName}@${domain}`;
}

export function shortCommit(commitId: string) {
  return commitId.slice(0, 8);
}

export function formatRelativeTime(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

export function formatCloudDate(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

export function formatFullTime(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

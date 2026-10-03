import type {
  DesktopCloudAccessSurface,
  DesktopCloudMcpEndpoint,
  DesktopCloudRepositoryView,
} from "../../../../lib/cloudApi";
import { isConnectorActiveStatus } from "../../utils";

export const ACCESS_POINT_KINDS = ["cli", "git", "mcp", "vm", "custom"] as const;

export type AccessPointKind = (typeof ACCESS_POINT_KINDS)[number];
export type AccessPointCatalogKind = "all" | Extract<AccessPointKind, "cli" | "git" | "mcp">;
export type AccessPointStatusKind = "ready" | "syncing" | "missing" | "error";
export type AccessPointCommandId = "login" | "explore" | "existing-folder" | "clone" | "server-url";

export type AccessPointStatus = Readonly<{
  kind: AccessPointStatusKind;
  /** The server/provider status retained for localized presentation and diagnostics. */
  code: string;
}>;

export type AccessPointCommand = Readonly<{
  id: AccessPointCommandId;
  value: string;
  disabled?: boolean;
}>;

export type AccessPoint = Readonly<{
  id: string;
  kind: AccessPointKind;
  /** Raw provider identity is adapter-owned and never used to branch in UI components. */
  sourceProvider: string;
  /** Provider-owned/user-authored name only. First-party names are localized at presentation time. */
  title: string;
  /** Provider-owned/path detail only. First-party subtitles are localized at presentation time. */
  subtitle: string;
  status: AccessPointStatus;
  /** Provider-owned prompt only. Built-in instructions are localized at presentation time. */
  prompt?: string;
  commands?: readonly AccessPointCommand[];
  endpoint?: DesktopCloudMcpEndpoint;
  connector?: DesktopCloudAccessSurface;
  placeholder?: boolean;
}>;

export type AccessPointRow = Readonly<{
  id: string;
  scope: DesktopCloudRepositoryView;
  accessPoint: AccessPoint;
}>;

export type AccessPointAggregate = Readonly<{
  code: "error" | "syncing" | "active" | "mixed" | "paused";
  tone: "ready" | "warning" | "";
}>;

export function normalizeAccessPointStatus(code: string | null | undefined): AccessPointStatus {
  const normalized = code?.trim().toLowerCase() || "missing";
  if (normalized === "error" || normalized === "failed") {
    return { kind: "error", code: normalized };
  }
  if (normalized === "syncing" || normalized === "pending" || normalized === "connecting") {
    return { kind: "syncing", code: normalized };
  }
  if (isConnectorActiveStatus(normalized)) {
    return { kind: "ready", code: normalized };
  }
  return { kind: "missing", code: normalized };
}

export function isAccessPointReady(accessPoint: AccessPoint): boolean {
  return accessPoint.status.kind === "ready";
}

export function getAccessPointAggregate(accessPoints: readonly AccessPoint[]): AccessPointAggregate {
  if (accessPoints.some((accessPoint) => accessPoint.status.kind === "error")) {
    return { code: "error", tone: "warning" };
  }
  if (accessPoints.some((accessPoint) => accessPoint.status.kind === "syncing")) {
    return { code: "syncing", tone: "ready" };
  }
  if (accessPoints.length > 0 && accessPoints.every(isAccessPointReady)) {
    return { code: "active", tone: "ready" };
  }
  if (accessPoints.some(isAccessPointReady)) {
    return { code: "mixed", tone: "warning" };
  }
  return { code: "paused", tone: "" };
}

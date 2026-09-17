import type { MessageFormatter } from "@puppyone/localization";
import type { DesktopView } from "../../../components/DesktopCloudShell";
import type { GitStatusEntry, GitStatusSnapshot } from "../../../types/electron";
import { VersionControlIcon } from "../../source-control";
import type {
  DesktopNavigationAvailability,
  DesktopNavigationItem,
} from "./types";

const DESKTOP_NAV_ITEMS: readonly DesktopNavigationItem[] = [
  { view: "git", labelId: "shell.navigation.changes", icon: VersionControlIcon, iconSize: 18 },
] as const;

export function resolveNavigationItems({
  availableSurfaceIds,
  gitEnabled = true,
}: DesktopNavigationAvailability) {
  if (availableSurfaceIds) {
    const available = new Set(availableSurfaceIds);
    return {
      localItems: DESKTOP_NAV_ITEMS.filter(({ view }) => available.has(view)),
    };
  }

  return {
    localItems: DESKTOP_NAV_ITEMS
      .filter((item) => gitEnabled || item.view !== "git"),
  };
}

export type DesktopNavigationBadge =
  | { count: 0; tone: "remote"; kind: "none" }
  | { count: 0; tone: "workspace"; kind: "workspace" }
  | { count: number; tone: "remote"; kind: "remote" };

export function getDesktopNavigationBadge(
  view: DesktopView,
  gitIncomingCount: number,
  workspaceChangeCount: number,
): DesktopNavigationBadge {
  if (view !== "git") return { count: 0, tone: "remote", kind: "none" };
  if (gitIncomingCount > 0) {
    return { count: gitIncomingCount, tone: "remote", kind: "remote" };
  }
  if (workspaceChangeCount > 0) {
    return { count: 0, tone: "workspace", kind: "workspace" };
  }
  return { count: 0, tone: "remote", kind: "none" };
}

export function getDesktopNavigationLabel(
  t: MessageFormatter,
  label: string,
  view: DesktopView,
  badge: DesktopNavigationBadge,
  workspaceChangeCount: number,
) {
  if (view === "data" && workspaceChangeCount > 0) {
    return t("shell.navigation.workspaceChangesDetected", { label });
  }
  if (badge.kind === "workspace") {
    return t("shell.navigation.workspaceChangesDetected", { label });
  }
  if (badge.kind === "remote") {
    return t("shell.navigation.remoteChangeCount", { label, count: badge.count });
  }
  return label;
}

export type DesktopGitNavSummary = {
  active: boolean;
  snapshotReady: boolean;
  changeCount: number;
  conflicts: number;
  unstaged: number;
  staged: number;
  committed: number;
  remoteIncoming: number;
  operationActive: boolean;
};

export function getDesktopGitNavSummary(
  status: GitStatusSnapshot | null,
  gitIncomingCount: number,
  operationLoading: string | null,
): DesktopGitNavSummary {
  const summary: DesktopGitNavSummary = {
    active: gitIncomingCount > 0,
    snapshotReady: Boolean(status),
    changeCount: 0,
    conflicts: 0,
    unstaged: 0,
    staged: 0,
    committed: 0,
    remoteIncoming: gitIncomingCount,
    operationActive: Boolean(operationLoading),
  };

  for (const entry of status?.entries ?? []) {
    if (getDesktopGitEntryKind(entry) === "conflict") summary.conflicts += 1;
  }
  summary.unstaged = (status?.unstagedEntries.length ?? 0) + (status?.untrackedEntries.length ?? 0);
  summary.staged = status?.stagedEntries.length ?? 0;
  summary.committed = Math.max(0, status?.sourceControl.remote.ahead ?? 0);
  summary.remoteIncoming = Math.max(summary.remoteIncoming, status?.sourceControl.remote.behind ?? 0);
  summary.active = summary.active
    || summary.unstaged > 0
    || summary.staged > 0
    || summary.committed > 0
    || summary.remoteIncoming > 0
    || summary.conflicts > 0;
  summary.changeCount = summary.unstaged
    + summary.staged
    + summary.committed
    + summary.conflicts
    + summary.remoteIncoming;
  return summary;
}

function getDesktopGitEntryKind(
  entry: GitStatusEntry,
): "added" | "modified" | "deleted" | "renamed" | "conflict" {
  const status = entry.status.toLowerCase();
  if (entry.conflict || status === "conflict") return "conflict";
  if (status === "untracked" || status === "added" || entry.staged === "A" || entry.unstaged === "A") {
    return "added";
  }
  if (status === "deleted" || entry.staged === "D" || entry.unstaged === "D") return "deleted";
  if (status === "renamed" || status === "copied" || entry.staged === "R" || entry.unstaged === "R") {
    return "renamed";
  }
  return "modified";
}

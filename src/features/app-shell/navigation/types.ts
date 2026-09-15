import type { ReactNode } from "react";
import type { DesktopView } from "../../../components/DesktopCloudShell";
import type { GitStatusSnapshot } from "../../../types/electron";
import type { WorkspaceSurfaceId } from "../workspace-surfaces";

export type DesktopSidebarIconComponent = (props: {
  size?: number;
  className?: string;
}) => ReactNode;

export type DesktopNavigationItem = {
  view: Extract<DesktopView, "git" | "plugins">;
  labelId: string;
  icon: DesktopSidebarIconComponent;
  iconSize?: number;
};

export type DesktopNavigationAvailability = {
  availableSurfaceIds?: readonly WorkspaceSurfaceId[];
  gitEnabled?: boolean;
  pluginsEnabled?: boolean;
};

export type DesktopNavigationRuntime = {
  activeView: DesktopView;
  gitIncomingCount: number;
  gitOperationLoading: string | null;
  gitStatus: GitStatusSnapshot | null;
  workspaceChangeCount: number;
  onNavigate: (view: DesktopView) => void;
};

export type DesktopNavigationProps = DesktopNavigationAvailability & DesktopNavigationRuntime & {
  onOpenSettings: () => void;
  settingsOpen?: boolean;
  showSettings?: boolean;
  utilitySlot?: ReactNode;
};

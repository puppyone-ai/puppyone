import type { Workspace } from "@puppyone/shared-ui";
import type { DesktopCloudSession } from "../../lib/cloudApi";
import type { GitStatusSnapshot, PuppyoneWorkspaceConfig } from "../../types/electron";
import type { CloudWorkspaceSection } from "./routes/cloudRouteIds";

export type { CloudWorkspaceSection } from "./routes/cloudRouteIds";

export type CloudServiceSidebarProps = {
  status: GitStatusSnapshot | null;
  cloudSession: DesktopCloudSession | null;
  activeSection: CloudWorkspaceSection;
  onSelectSection: (section: CloudWorkspaceSection) => void;
};

export type CloudServicePanelProps = {
  open: boolean;
  status: GitStatusSnapshot | null;
  accountEmail: string | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onSignedIn: (session: DesktopCloudSession) => void;
  onEnterCloud: () => void;
  onOpenGitSettings: () => void;
};

export type CloudServiceMainViewProps = {
  workspace: Workspace;
  status: GitStatusSnapshot | null;
  puppyoneConfig: PuppyoneWorkspaceConfig | null;
  cloudSession: DesktopCloudSession | null;
  sessionRestoring?: boolean;
  onCloudSessionChange: (session: DesktopCloudSession | null) => void;
  activeSection: CloudWorkspaceSection;
  loading: boolean;
  error: string | null;
  cloudBackupLoading: boolean;
  cloudBackupError: string | null;
  onStartPuppyoneBackup: () => void;
  onConfigureCloudRemote: (remoteUrl: string) => Promise<GitStatusSnapshot | null>;
  onSelectSection: (section: CloudWorkspaceSection) => void;
  onRefresh: () => void;
  onOpenDetails: () => void;
  onOpenGitSettings: () => void;
};

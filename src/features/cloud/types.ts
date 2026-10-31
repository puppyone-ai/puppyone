import type { Workspace } from "@puppyone/shared-ui";
import type { DesktopCloudSession } from "../../lib/cloudApi";
import type {
  CloudPublishErrorCode,
  CloudPublishProgress,
  CloudPublishState,
  GitStatusSnapshot,
} from "../../types/electron";
import type { CloudAuthState } from "./auth";
import type { CloudEnvironment } from "./environment";
import type { ProjectCloudContext } from "./project/context";
import type { RepositoryTarget } from "./repositoryTarget";
import type { CloudWorkspaceSection } from "./routes/cloudRouteIds";

export type { CloudWorkspaceSection } from "./routes/cloudRouteIds";

export type CloudGitRemoteOptions = {
  target?: RepositoryTarget;
  /** HEAD observed by the caller before an asynchronous Initialize operation began. */
  expectedHeadCommitId?: string;
  /** Attached branch observed by the caller before an asynchronous Initialize operation began. */
  expectedBranch?: string;
  /** Skip reading and writing the workspace-owned `.puppyone/config.json`. */
  persistWorkspacePreferences?: boolean;
  /** Require a write-capable Project and an `rw` credential. */
  requireWrite?: boolean;
  /** Leave status/context publication to the operation that consumes the configured remote. */
  deferStatusPublication?: boolean;
  /** Fail instead of replacing an existing canonical `puppyone` remote. */
  rejectRemoteNameCollision?: boolean;
};

export type CloudServiceSidebarProps = {
  cloudAuthState: CloudAuthState;
  activeSection: CloudWorkspaceSection;
  /** True only when the current repository's canonical remote is authorized. */
  projectAvailable?: boolean;
  projectCapabilities?: readonly string[];
  onSelectSection: (section: CloudWorkspaceSection) => void;
};

export type CloudServiceMainViewProps = {
  workspace: Workspace;
  status: GitStatusSnapshot | null;
  cloudEnvironment: CloudEnvironment;
  cloudAuthState: CloudAuthState;
  projectContext?: ProjectCloudContext | null;
  onCloudSessionChange: (session: DesktopCloudSession | null) => void;
  activeSection: CloudWorkspaceSection;
  loading: boolean;
  error: string | null;
  cloudBackupLoading: boolean;
  cloudBackupPending: boolean;
  cloudPublishError: { code: CloudPublishErrorCode; retryable: boolean } | null;
  cloudPublishNotice: "cleanup-completed" | null;
  cloudPublishProgress?: CloudPublishProgress | null;
  cloudPublishState: CloudPublishState | null;
  cloudPublishStateLoading: boolean;
  onAbandonPuppyoneBackup: () => void;
  onStartPuppyoneBackup: (organizationId?: string) => void;
  onRemoveCloudRemote?: () => Promise<void>;
  onSelectSection: (section: CloudWorkspaceSection) => void;
  onRefresh: () => void;
  onOpenGitSettings: () => void;
  onOpenSourceControl?: () => void;
};

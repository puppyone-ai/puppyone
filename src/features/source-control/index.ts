export { GitSidebar } from "./SourceControlSidebar";
export { GitChangesSidebar } from "./GitChangesSidebar";
export { GitOperationButton } from "./sidebar/GitSidebarPrimitives";
export { VersionControlIcon } from "./VersionControlIcon";
export { GitStatusView } from "./GitStatusView";
export { createSourceControlWorkspaceSurface } from "./SourceControlWorkspaceSurface";
export type { SourceControlWorkspaceSurfaceProps } from "./SourceControlWorkspaceSurface";
export type { GitWorkingSelection } from "./types";
export type { DesktopGitController } from "./useDesktopGitController";
export { getGitHostingMode } from "./viewModel";
export {
  EMPTY_GIT_TITLEBAR_STATUS,
  getGitTitlebarStatus,
  type GitTitlebarStatus,
} from "./gitTitlebarStatus";
export {
  getCanonicalPuppyoneRemote,
  getPuppyoneRemote,
  maskRemoteUrl,
  parsePuppyoneRemote,
} from "./remotes";

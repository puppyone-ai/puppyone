import { GitStatusView } from "./GitStatusView";
import type { DesktopGitController } from "./useDesktopGitController";

export type SourceControlWorkspaceSurfaceProps = {
  controller: DesktopGitController;
  onOpenFile: (path: string) => void;
};

export function createSourceControlWorkspaceSurface({
  controller,
  onOpenFile,
}: SourceControlWorkspaceSurfaceProps) {
  return {
    sidebar: null,
    main: (
      <GitStatusView
        status={controller.activeGitStatus}
        selectedWorkingFile={controller.selectedGitWorkingFile}
        workingFileDiff={controller.gitWorkingFileDiff}
        workingFileDiffLoading={controller.gitWorkingFileDiffLoading}
        workingFileDiffError={controller.gitWorkingFileDiffError}
        operationLoading={controller.gitOperationLoading}
        operationError={null}
        loading={controller.gitStatusLoading}
        error={controller.gitStatusError}
        onRefresh={controller.refreshGitStatus}
        onStagePaths={controller.handleStageGitPaths}
        onUnstagePaths={controller.handleUnstageGitPaths}
        onDiscardPaths={controller.handleDiscardGitPaths}
        onOpenWorkingFile={onOpenFile}
        onInitializeRepository={controller.handleInitializeGitRepository}
      />
    ),
  } as const;
}

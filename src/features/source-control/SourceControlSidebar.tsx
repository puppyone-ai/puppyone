import {
  SidebarEmptyState,
  SidebarRoot,
  SidebarScrollArea,
} from "@puppyone/shared-ui";
import { MoreHorizontal } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { useLocalization } from "@puppyone/localization";
import {
  buildSourceControlSidebarModel,
  getGitHostingMode,
  getSourceControlPrimaryActionSlot,
  getGitSyncState,
} from "./viewModel";
import { createGitLocalStatusPanels } from "./sidebar/GitLocalStatusPanels";
import {
  GitSidebarLoadingState,
  GitSidebarSectionResizer,
} from "./sidebar/GitSidebarPrimitives";
import { GitIncomingUpdateNotice } from "./sidebar/GitIncomingUpdateNotice";
import { GitRemotePrompt } from "./sidebar/GitRemoteSections";
import { GitRepositorySetupAction } from "./GitRepositorySetupAction";
import type {
  GitSidebarProps,
  GitSidebarRenderPanel,
} from "./sidebar/sourceControlSidebarTypes";
import { useGitSidebarExpansionState } from "./sidebar/useGitSidebarExpansionState";
import {
  getGitSidebarPanelBodyRows,
  useGitSidebarPanelLayout,
} from "./sidebar/useGitSidebarPanelLayout";

export type { GitSidebarProps } from "./sidebar/sourceControlSidebarTypes";

export function GitSidebar({ repository, view, actions, cloudBackup }: GitSidebarProps) {
  const { status, puppyoneConfig, gitDisplayMode, fileIconTheme } = repository;
  const {
    selectedWorkingFile,
    operationLoading,
    operationError,
    loading,
    error,
  } = view;
  const { t, formatNumber } = useLocalization();
  const [backupCardDismissed, setBackupCardDismissed] = useState(false);
  const { expanded, toggle } = useGitSidebarExpansionState();
  const sourceControl = status?.sourceControl ?? null;
  const currentBranch = status?.branches.find((branch) => branch.current) ?? null;
  const syncState = getGitSyncState(status, currentBranch, puppyoneConfig, t);
  const hostingMode = getGitHostingMode(status, puppyoneConfig);
  const professionalDisplayMode = hostingMode === "github" || hostingMode === "puppyone-cloud";
  const disabled = Boolean(operationLoading) || loading || !status?.isRepo;
  const sidebarModel = buildSourceControlSidebarModel({
    status,
    syncState,
    displayMode: professionalDisplayMode ? "professional" : gitDisplayMode,
    canCommit: sourceControl?.actions.canCommit === true,
    t,
  });
  const primaryActionSlot = getSourceControlPrimaryActionSlot({
    hasConflicts: sidebarModel.hasConflicts,
    hasOperationAction: Boolean(sidebarModel.operationPrimaryAction),
    hasStagedAction: Boolean(
      sidebarModel.stagedPrimaryAction && !sidebarModel.stagedPrimaryAction.disabled,
    ),
    hasSyncAction: syncState.behind > 0 && !syncState.pullDisabled,
    hasCommittedAction: Boolean(
      sidebarModel.committedPrimaryAction && !sidebarModel.committedPrimaryAction.disabled,
    ),
    hasStageAndCommitAction: sidebarModel.showStageAndCommitAction,
  });
  const scrollableContentRevision = useMemo(
    () => ({ expanded, loading, status }),
    [expanded, loading, status],
  );
  const {
    activeResizeSplit,
    beginPanelResize,
    getPanelStyle,
    resizePanelsByKeyboard,
    setPanelRef,
    sidebarListRef,
  } = useGitSidebarPanelLayout(scrollableContentRevision);
  const panels: GitSidebarRenderPanel[] = createGitLocalStatusPanels({
    model: sidebarModel,
    expanded,
    disabled,
    operationLoading,
    fileIconTheme,
    selectedWorkingFile,
    primaryActionSlot,
    syncPushLabel: syncState.pushLabel,
    actions,
    t,
    onToggle: toggle,
  });
  const hasStashableChanges = sidebarModel.stagedResources.length > 0
    || sidebarModel.workingResources.length > 0;
  const hasDiscardableChanges = sidebarModel.mergeResources.length > 0
    || sidebarModel.workingResources.length > 0;
  const showSecondaryActions = hasStashableChanges || hasDiscardableChanges;
  const repositorySetupVisible = Boolean(status && !status.isRepo);
  const closeSecondaryActions = (target: HTMLElement) => {
    target.closest("details")?.removeAttribute("open");
  };

  return (
    <SidebarRoot className="desktop-git-sidebar">
      <SidebarScrollArea
        ref={sidebarListRef}
        className="desktop-git-sidebar-list"
        data-repository-setup={repositorySetupVisible ? "true" : undefined}
      >
        {error ? (
          <SidebarEmptyState tone="danger">{error}</SidebarEmptyState>
        ) : !status && loading ? (
          <GitSidebarLoadingState
            className="desktop-git-status-loading"
            label={t("source-control.status.readingGit")}
          />
        ) : status && !status.isRepo ? (
          <GitRepositorySetupAction
            title={t("source-control.history.inactive")}
            label={t("source-control.setup.enable")}
            pendingLabel={t("source-control.setup.enabling")}
            pending={operationLoading === "init"}
            error={operationError}
            onEnable={actions.initialize}
          />
        ) : (
          <div className="desktop-git-changes-pane">
              {syncState.behind > 0 && (
                <div className="desktop-git-sync-priority-region">
                  <GitIncomingUpdateNotice
                    count={syncState.behind}
                    diverged={syncState.ahead > 0}
                    title={syncState.pullTitle}
                    disabled={disabled || syncState.pullDisabled}
                    operationLoading={operationLoading}
                    primary={primaryActionSlot === "sync"}
                    onPull={actions.pull}
                  />
                </div>
              )}
              <div className="desktop-git-resizable-stack">
                {panels.map((panel, index) => (
                  <Fragment key={panel.id}>
                    {index > 0 && (
                      <GitSidebarSectionResizer
                        previous={panels[index - 1].id}
                        next={panel.id}
                        active={activeResizeSplit === `${panels[index - 1].id}:${panel.id}`}
                        onPointerDown={beginPanelResize}
                        onKeyboardResize={resizePanelsByKeyboard}
                      />
                    )}
                    <div
                      ref={(node) => setPanelRef(panel.id, node)}
                      className={`desktop-git-resizable-section desktop-git-resizable-section-${panel.className} ${panel.expanded ? "expanded" : "collapsed"}`}
                      style={getPanelStyle(panel)}
                    >
                      {panel.content}
                    </div>
                  </Fragment>
                ))}
              </div>

              <div className="desktop-git-fixed-region">
                {showSecondaryActions && (
                  <div className="desktop-git-secondary-actions">
                    {(hasStashableChanges || hasDiscardableChanges) && (
                      <details className="desktop-git-more-actions">
                        <summary
                          title={t("source-control.action.more")}
                          aria-label={t("source-control.action.more")}
                        >
                          <MoreHorizontal size={15} aria-hidden="true" />
                        </summary>
                        <div className="desktop-git-more-actions-menu">
                          {hasStashableChanges && (
                            <button
                              type="button"
                              disabled={disabled || sidebarModel.hasConflicts || Boolean(sidebarModel.repositoryOperation)}
                              onClick={(event) => {
                                closeSecondaryActions(event.currentTarget);
                                void actions.stash();
                              }}
                            >
                              {operationLoading === "stash"
                                ? t("source-control.action.stashing")
                                : t("source-control.action.stash")}
                            </button>
                          )}
                          {hasDiscardableChanges && (
                            <button
                              className="danger"
                              type="button"
                              disabled={disabled}
                              onClick={(event) => {
                                closeSecondaryActions(event.currentTarget);
                                void actions.discardAll();
                              }}
                            >
                              {t("source-control.action.discardAll")}
                            </button>
                          )}
                        </div>
                      </details>
                    )}
                  </div>
                )}
                {status && (
                  <GitRemotePrompt
                    state={syncState}
                    disabled={disabled}
                    cloudBackupLoading={cloudBackup.loading}
                    cloudBackupError={cloudBackup.error}
                    dismissed={backupCardDismissed}
                    cloudEnabled={cloudBackup.enabled ?? true}
                    onDismiss={() => setBackupCardDismissed(true)}
                    onStartPuppyoneBackup={cloudBackup.start}
                  />
                )}
                {operationError && (
                  <div className="desktop-git-operation-error" role="alert">{operationError}</div>
                )}
                {status?.didHitStatusLimit && (
                  <div className="desktop-git-status-limit-warning" role="status">
                    {t("source-control.status.limit", { count: formatNumber(status.statusLimit) })}
                  </div>
                )}
              </div>
          </div>
        )}
      </SidebarScrollArea>
    </SidebarRoot>
  );
}

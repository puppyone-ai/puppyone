import { Undo2 } from "lucide-react";
import {
  SidebarEmptyState,
  SidebarIconButton,
  type FileIconThemeId,
} from "@puppyone/shared-ui";
import type { MessageFormatter } from "@puppyone/localization";
import { SourceControlPreviewResourceList } from "../components";
import type {
  GitSidebarPrimaryActionKind,
  GitWorkingSelection,
  SourceControlSidebarModel,
} from "../types";
import {
  getCommittedSummary,
  type SourceControlPrimaryActionSlot,
} from "../viewModel";
import type { GitSidebarActions, GitSidebarRenderPanel } from "./sourceControlSidebarTypes";
import { SourceControlWorkingResourceList } from "./SourceControlResourceLists";
import { GitOperationButton } from "./GitSidebarPrimitives";
import { GitLocalStatusSection } from "./GitLocalStatusSection";
import { getGitSidebarPanelBodyRows } from "./useGitSidebarPanelLayout";
import type { GitSidebarExpansionState } from "./useGitSidebarExpansionState";

type LocalPanelActions = Pick<
  GitSidebarActions,
  | "selectWorkingFile"
  | "stagePaths"
  | "stageAll"
  | "unstagePaths"
  | "discardPaths"
  | "discardAll"
  | "stageAndCommit"
  | "commit"
  | "commitAndPush"
  | "continueOperation"
  | "abortOperation"
  | "push"
  | "publish"
>;

/** Builds only local/committed status panels; provider and remote policy stay in the sidebar orchestrator. */
export function createGitLocalStatusPanels({
  model,
  expanded,
  disabled,
  operationLoading,
  fileIconTheme,
  selectedWorkingFile,
  primaryActionSlot,
  syncPushLabel,
  actions,
  t,
  onToggle,
}: {
  model: SourceControlSidebarModel;
  expanded: GitSidebarExpansionState;
  disabled: boolean;
  operationLoading: string | null;
  fileIconTheme: FileIconThemeId;
  selectedWorkingFile: GitWorkingSelection | null;
  primaryActionSlot: SourceControlPrimaryActionSlot;
  syncPushLabel: string;
  actions: LocalPanelActions;
  t: MessageFormatter;
  onToggle: (panel: "merge" | "committed" | "staged" | "unstaged") => void;
}): GitSidebarRenderPanel[] {
  const panels: GitSidebarRenderPanel[] = [];
  const primaryActionHandlers: Record<GitSidebarPrimaryActionKind, () => Promise<boolean>> = {
    commit: actions.commit,
    "commit-push": actions.commitAndPush,
    continue: actions.continueOperation,
    push: actions.push,
    publish: actions.publish,
  };

  if (model.hasConflicts || model.repositoryOperation) {
    const operationAction = model.operationPrimaryAction;
    panels.push({
      id: "merge",
      className: "merge",
      grow: 0.9,
      expanded: expanded.merge,
      bodyRows: getGitSidebarPanelBodyRows(model.mergeResources.length),
      content: (
        <GitLocalStatusSection
          title={t(model.repositoryOperation ? "source-control.section.operation" : "source-control.section.merge")}
          count={model.mergeResources.length}
          expanded={expanded.merge}
          onToggle={() => onToggle("merge")}
          action={model.repositoryOperation ? (
            <div className="desktop-git-section-actions">
              {model.repositoryOperation.canAbort && (
                <SidebarIconButton
                  className="desktop-git-abort-operation-action"
                  tone="danger"
                  label={t("source-control.sync.abort")}
                  disabled={disabled}
                  onClick={() => {
                    if (window.confirm(t("source-control.dialog.abortOperation"))) {
                      void actions.abortOperation();
                    }
                  }}
                  icon={<Undo2 size={13} />}
                />
              )}
              {operationAction && (
                <GitOperationButton
                  className="desktop-git-continue-operation-action"
                  tooltip={operationAction.title}
                  disabled={disabled || operationAction.disabled}
                  icon={operationAction.icon}
                  label={operationAction.label}
                  loadingKey={operationAction.loadingKey}
                  loadingLabel={operationAction.loadingLabel}
                  operationLoading={operationLoading}
                  primary={primaryActionSlot === "operation"}
                  onClick={() => void primaryActionHandlers[operationAction.kind]()}
                />
              )}
            </div>
          ) : undefined}
        >
          {model.mergeResources.length > 0 ? (
            <SourceControlWorkingResourceList
              resources={model.mergeResources}
              selectedWorkingFile={selectedWorkingFile}
              operationLoading={operationLoading}
              fileIconTheme={fileIconTheme}
              onSelectWorkingFile={actions.selectWorkingFile}
              onStagePaths={actions.stagePaths}
              onUnstagePaths={actions.unstagePaths}
              onDiscardPaths={actions.discardPaths}
            />
          ) : null}
        </GitLocalStatusSection>
      ),
    });
  }

  if (model.showCommittedSection) {
    const action = model.committedPrimaryAction;
    panels.push({
      id: "committed",
      className: "committed",
      grow: 1.05,
      expanded: expanded.committed,
      bodyRows: getGitSidebarPanelBodyRows(model.committedResources.length, true),
      content: (
        <GitLocalStatusSection
          title={t("source-control.section.committed")}
          count={model.committedCount}
          expanded={expanded.committed}
          onToggle={() => onToggle("committed")}
          action={action ? (
            <GitOperationButton
              className="desktop-git-commit-push-action"
              tooltip={action.title}
              disabled={disabled || action.disabled}
              icon={action.icon}
              label={action.label}
              loadingKey={action.loadingKey}
              loadingLabel={action.loadingLabel}
              operationLoading={operationLoading}
              primary={primaryActionSlot === "committed"}
              onClick={() => void primaryActionHandlers[action.kind]()}
            />
          ) : undefined}
        >
          {model.committedCount === 0 ? (
            <SidebarEmptyState compact className="desktop-git-section-empty">
              {t("source-control.status.empty")}
            </SidebarEmptyState>
          ) : model.committedResources.length > 0 ? (
            <SourceControlPreviewResourceList
              resources={model.committedResources}
              fileIconTheme={fileIconTheme}
              selectedWorkingFile={selectedWorkingFile}
              origin="committed"
              ariaLabel={t("source-control.preview.committed")}
              onSelectWorkingFile={actions.selectWorkingFile}
            />
          ) : (
            <div className="desktop-git-committed-summary" data-po-scrollbar="sidebar">
              {getCommittedSummary(model.committedCount, action?.label ?? syncPushLabel, t)}
            </div>
          )}
        </GitLocalStatusSection>
      ),
    });
  }

  if (model.showStagedSection) {
    const action = model.stagedPrimaryAction;
    panels.push({
      id: "staged",
      className: "staged",
      grow: 0.9,
      expanded: expanded.staged,
      bodyRows: getGitSidebarPanelBodyRows(model.stagedResources.length),
      content: (
        <GitLocalStatusSection
          title={t("source-control.section.staged")}
          count={model.stagedResources.length}
          expanded={expanded.staged}
          onToggle={() => onToggle("staged")}
          action={(
            <div className="desktop-git-section-actions">
              <GitOperationButton
                className="desktop-git-commit-staged-action"
                tooltip={action?.title ?? t("source-control.sync.commitStaged")}
                disabled={disabled || !action || action.disabled}
                icon={action?.icon ?? "plus"}
                label={action?.label ?? t("source-control.sync.commit")}
                loadingKey={action?.loadingKey ?? "commit"}
                loadingLabel={action?.loadingLabel ?? t("source-control.action.committing")}
                operationLoading={operationLoading}
                primary={primaryActionSlot === "staged"}
                onClick={() => void actions.commit()}
              />
            </div>
          )}
        >
          <SourceControlWorkingResourceList
            resources={model.stagedResources}
            selectedWorkingFile={selectedWorkingFile}
            operationLoading={operationLoading}
            fileIconTheme={fileIconTheme}
            onSelectWorkingFile={actions.selectWorkingFile}
            onStagePaths={actions.stagePaths}
            onUnstagePaths={actions.unstagePaths}
            onDiscardPaths={actions.discardPaths}
          />
        </GitLocalStatusSection>
      ),
    });
  }

  if (model.showUnstagedSection) {
    panels.push({
      id: "unstaged",
      className: "unstaged",
      grow: 1.15,
      expanded: expanded.unstaged,
      bodyRows: getGitSidebarPanelBodyRows(model.localChangeResources.length, true),
      content: (
        <GitLocalStatusSection
          title={t("source-control.section.unstaged")}
          count={model.localChangeResources.length}
          expanded={expanded.unstaged}
          onToggle={() => onToggle("unstaged")}
          action={createUnstagedActions({ model, disabled, operationLoading, primaryActionSlot, actions, t })}
        >
          <SourceControlWorkingResourceList
            resources={model.localChangeResources}
            selectedWorkingFile={selectedWorkingFile}
            operationLoading={operationLoading}
            fileIconTheme={fileIconTheme}
            onSelectWorkingFile={actions.selectWorkingFile}
            onStagePaths={actions.stagePaths}
            onUnstagePaths={actions.unstagePaths}
            onDiscardPaths={actions.discardPaths}
          />
        </GitLocalStatusSection>
      ),
    });
  }

  if (model.showCleanSection) {
    panels.push({
      id: "unstaged",
      className: "changes",
      grow: 1,
      expanded: expanded.unstaged,
      bodyRows: getGitSidebarPanelBodyRows(0, true),
      content: (
        <GitLocalStatusSection
          title={t("source-control.label.changes")}
          count={0}
          showCount={false}
          expanded={expanded.unstaged}
          onToggle={() => onToggle("unstaged")}
        >
          <SidebarEmptyState compact className="desktop-git-section-empty">
            {t("source-control.status.noLocalChanges")}
          </SidebarEmptyState>
        </GitLocalStatusSection>
      ),
    });
  }

  const panelOrder = { merge: 0, committed: 1, staged: 2, unstaged: 3 } as const;
  return panels.sort((left, right) => panelOrder[left.id] - panelOrder[right.id]);
}

function createUnstagedActions({
  model,
  disabled,
  operationLoading,
  primaryActionSlot,
  actions,
  t,
}: {
  model: SourceControlSidebarModel;
  disabled: boolean;
  operationLoading: string | null;
  primaryActionSlot: SourceControlPrimaryActionSlot;
  actions: LocalPanelActions;
  t: MessageFormatter;
}) {
  if (model.workingResources.length === 0) return undefined;

  return (
    <div className="desktop-git-section-actions">
      <GitOperationButton
        className="desktop-git-stage-commit-action"
        tooltip={model.showStageAndCommitAction
          ? t("source-control.action.stageCommitTitle")
          : t("source-control.sync.resolveBeforeSync")}
        disabled={disabled || !model.showStageAndCommitAction}
        icon="plus"
        label={t("source-control.action.stageCommit")}
        loadingKey="stage-commit"
        loadingLabel={t("source-control.action.committing")}
        operationLoading={operationLoading}
        primary={primaryActionSlot === "stage-and-commit"}
        onClick={() => void actions.stageAndCommit()}
      />
    </div>
  );
}

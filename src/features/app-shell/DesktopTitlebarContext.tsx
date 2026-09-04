import type { RefObject } from "react";
import type { Workspace, WorkspaceFolder } from "@puppyone/shared-ui";
import { GitBranch } from "lucide-react";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { DesktopMenuItem } from "../../components/DesktopMenu";
import type { GitBranchSummary, GitStatusSnapshot } from "../../types/electron";
import { BranchMenuGroup } from "../source-control/operationDialogs";
import { DesktopTitlebarMenuLayer } from "./DesktopTitlebarMenuLayer";
import { DesktopWorkspaceSwitcher } from "./DesktopWorkspaceSwitcher";

export function DesktopTitlebarContext({
  activeGitStatus,
  branchSwitcherOpen,
  branchSwitcherRef,
  gitStatusLoading,
  gitOperationLoading,
  localBranches,
  remoteBranches,
  workspace,
  workspaceFolders,
  multiRootWorkspacesEnabled,
  workspaceSwitcherOpen,
  workspaceSwitcherRef,
  onCheckoutBranch,
  onCloseBranchSwitcher,
  onCloseWorkspaceSwitcher,
  onGoHome,
  onAddProject,
  onAddExistingProject,
  availableProjects,
  onToggleBranchSwitcher,
  onToggleWorkspaceSwitcher,
}: DesktopTitlebarContextProps) {
  const { t } = useLocalization();
  const workspaceTitlebarLabel = workspace.name.trim() || workspace.name;
  const branchReady = activeGitStatus?.isRepo === true;
  const branchPending = activeGitStatus === null && gitStatusLoading;
  const branchLabel = branchReady
    ? (activeGitStatus.branch ?? t("shell.branch.detached"))
    : branchPending
      ? t("shell.branch.loading")
      : t("shell.branch.noGit");
  const branchTitlebarLabel = branchPending ? "" : branchLabel.trim() || branchLabel;

  return (
    <div className="desktop-titlebar-context">
      <DesktopWorkspaceSwitcher
        open={workspaceSwitcherOpen}
        refObject={workspaceSwitcherRef}
        titlebarLabel={workspaceTitlebarLabel}
        workspace={workspace}
        workspaceFolders={workspaceFolders}
        multiRootWorkspacesEnabled={multiRootWorkspacesEnabled}
        availableProjects={availableProjects}
        onAddExistingProject={multiRootWorkspacesEnabled ? onAddExistingProject : undefined}
        onOpenFolder={multiRootWorkspacesEnabled ? onAddProject : undefined}
        onClose={onCloseWorkspaceSwitcher}
        onGoHome={onGoHome}
        onToggle={onToggleWorkspaceSwitcher}
      />
      <DesktopBranchSwitcher
        open={branchSwitcherOpen}
        refObject={branchSwitcherRef}
        titlebarLabel={branchTitlebarLabel}
        branchLabel={branchLabel}
        disabled={!branchReady}
        loading={gitStatusLoading}
        localBranches={localBranches}
        remoteBranches={remoteBranches}
        operationLoading={gitOperationLoading}
        onCheckout={onCheckoutBranch}
        onDone={onCloseBranchSwitcher}
        onToggle={onToggleBranchSwitcher}
      />
    </div>
  );
}

type DesktopTitlebarContextProps = {
  activeGitStatus: GitStatusSnapshot | null;
  branchSwitcherOpen: boolean;
  branchSwitcherRef: RefObject<HTMLDivElement>;
  gitStatusLoading: boolean;
  gitOperationLoading: string | null;
  localBranches: GitBranchSummary[];
  remoteBranches: GitBranchSummary[];
  workspace: Workspace;
  workspaceFolders: readonly WorkspaceFolder[];
  multiRootWorkspacesEnabled: boolean;
  availableProjects: readonly Workspace[];
  workspaceSwitcherOpen: boolean;
  workspaceSwitcherRef: RefObject<HTMLDivElement>;
  onCheckoutBranch: (branchName: string, remote: boolean) => Promise<boolean>;
  onCloseBranchSwitcher: () => void;
  onCloseWorkspaceSwitcher: () => void;
  onGoHome: () => void;
  onAddProject: () => void;
  onAddExistingProject: (folderPath: string) => void;
  onToggleBranchSwitcher: () => void;
  onToggleWorkspaceSwitcher: () => void;
};

function DesktopBranchSwitcher({
  branchLabel,
  disabled,
  loading,
  localBranches,
  open,
  operationLoading,
  refObject,
  remoteBranches,
  titlebarLabel,
  onCheckout,
  onDone,
  onToggle,
}: {
  branchLabel: string;
  disabled: boolean;
  loading: boolean;
  localBranches: GitBranchSummary[];
  open: boolean;
  operationLoading: string | null;
  refObject: RefObject<HTMLDivElement>;
  remoteBranches: GitBranchSummary[];
  titlebarLabel: string;
  onCheckout: (branchName: string, remote: boolean) => Promise<boolean>;
  onDone: () => void;
  onToggle: () => void;
}) {
  const { t } = useLocalization();
  const hasBranches = localBranches.length > 0 || remoteBranches.length > 0;

  return (
    <div className="desktop-titlebar-branch-wrap" ref={refObject}>
      <button
        className="desktop-titlebar-branch-button"
        type="button"
        aria-label={t("shell.branch.switch", { branch: bidiIsolate(branchLabel) })}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        title={disabled
          ? loading ? undefined : branchLabel
          : t("shell.branch.title", { branch: bidiIsolate(branchLabel) })}
        onClick={onToggle}
      >
        <GitBranch size={13} strokeWidth={1.8} aria-hidden="true" />
        <span
          className="desktop-titlebar-branch-label"
          data-loading={loading && !titlebarLabel ? "true" : undefined}
        >
          {titlebarLabel || (loading ? (
            <span className="desktop-titlebar-branch-placeholder" aria-hidden="true" />
          ) : null)}
        </span>
      </button>

      <DesktopTitlebarMenuLayer
        anchorRef={refObject}
        className="desktop-branch-menu"
        gap={4}
        onDismiss={onDone}
        open={open && !disabled}
        preferredMaxHeight={440}
      >
        {hasBranches ? (
          <>
            <BranchMenuGroup
              title={t("shell.branch.localBranches")}
              branches={localBranches}
              operationLoading={operationLoading}
              onCheckout={onCheckout}
              onDone={onDone}
            />
            <BranchMenuGroup
              title={t("shell.branch.remoteBranches")}
              branches={remoteBranches}
              operationLoading={operationLoading}
              onCheckout={onCheckout}
              onDone={onDone}
            />
          </>
        ) : loading ? null : (
          <DesktopMenuItem
            className="desktop-branch-menu-row"
            disabled
            icon={<GitBranch size={13} strokeWidth={1.8} />}
            label={t("shell.branch.noBranches")}
          />
        )}
      </DesktopTitlebarMenuLayer>
    </div>
  );
}

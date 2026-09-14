import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Workspace } from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import {
  abortWorkspaceGitOperation,
  checkoutWorkspaceGitBranch,
  cancelWorkspaceGitFileDiff,
  commitAndCheckoutWorkspaceGitBranch,
  commitWorkspaceGit,
  continueWorkspaceGitOperation,
  discardAllWorkspaceGitChanges,
  discardWorkspaceGitPaths,
  getWorkspaceGitBranchGraph,
  cancelWorkspaceGitBranchGraph,
  getWorkspaceGitCommitDetail,
  getWorkspaceGitFileDiff,
  initializeWorkspaceGitRepository,
  publishWorkspaceGitBranch,
  pullWorkspaceGit,
  pushWorkspaceGit,
  stageAllWorkspaceGitChanges,
  stageWorkspaceGitPaths,
  stashWorkspaceGitChanges,
  stashAndCheckoutWorkspaceGitBranch,
  unstageAllWorkspaceGitChanges,
  unstageWorkspaceGitPaths,
} from "../../lib/localFiles";
import type { GitCommitDetail, GitStatusSnapshot } from "../../types/electron";
import {
  createGitOperationErrorState,
  createGitOperationMessageState,
  classifyGitOperationError,
  formatGitOperationErrorState,
  formatGitPreviewError,
  getGitChangeCount,
  isBranchOverwriteErrorCode,
  type GitOperationErrorState,
} from "./operationDialogs";
import { createRepositoryRefreshReason } from "./repositoryRefreshPolicy";
import type { GitWorkingSelection } from "./types";
import { clearFormatAwareDiffCaches } from "./diff/core/cacheControl";
import { useGitRepositoryLifecycle } from "./useGitRepositoryLifecycle";

export type PendingBranchSwitch = {
  branchName: string;
  remote: boolean;
  changeCount: number;
  error: string | null;
};

type UseDesktopGitControllerOptions = {
  workspace: Workspace | null;
  gitChangesActive: boolean;
  gitHistoryActive: boolean;
  onWorkspaceContentChanged: (presentation?: "incremental" | "atomic") => void;
};

export function useDesktopGitController({
  workspace,
  gitChangesActive,
  gitHistoryActive,
  onWorkspaceContentChanged,
}: UseDesktopGitControllerOptions) {
  const { t } = useLocalization();
  const {
    activeGitStatus,
    gitStatus,
    gitStatusError,
    gitStatusLoading,
    gitStatusPath,
    applyGitHistory,
    applyGitStatus,
    captureGitRepositoryContext,
    historyEpoch,
    invalidateGitStatus,
    isGitRepositoryContextCurrent,
    refreshGitStatus,
    refreshGitStatusWithFetch,
    reportGitStatusError,
  } = useGitRepositoryLifecycle({
    workspace,
    remoteUpdatesActive: gitChangesActive || gitHistoryActive,
  });
  const historyRequestRef = useRef(0);
  const workingDiffRequestRef = useRef(0);
  const branchSwitcherRef = useRef<HTMLDivElement>(null);
  const [selectedGitCommitId, setSelectedGitCommitId] = useState<string | null>(null);
  const [selectedGitWorkingFile, setSelectedGitWorkingFile] = useState<GitWorkingSelection | null>(null);
  const [gitHistoryLoading, setGitHistoryLoading] = useState(false);
  const [gitCommitDetail, setGitCommitDetail] = useState<GitCommitDetail | null>(null);
  const [gitCommitDetailLoading, setGitCommitDetailLoading] = useState(false);
  const [gitCommitDetailError, setGitCommitDetailError] = useState<string | null>(null);
  const [gitWorkingFileDiff, setGitWorkingFileDiff] = useState<GitCommitDetail | null>(null);
  const [gitWorkingFileDiffLoading, setGitWorkingFileDiffLoading] = useState(false);
  const [gitWorkingFileDiffError, setGitWorkingFileDiffError] = useState<string | null>(null);
  const [gitOperationLoading, setGitOperationLoading] = useState<string | null>(null);
  const [gitOperationError, setGitOperationError] = useState<GitOperationErrorState | null>(null);
  const [branchSwitcherOpen, setBranchSwitcherOpen] = useState(false);
  const [pendingBranchSwitch, setPendingBranchSwitch] = useState<PendingBranchSwitch | null>(null);

  const gitIncomingCount = activeGitStatus?.isRepo === true
    ? Math.max(0, activeGitStatus.sourceControl.remote.behind)
    : 0;

  const localBranches = useMemo(
    () => activeGitStatus?.branches.filter((branch) => !branch.remote) ?? [],
    [activeGitStatus],
  );
  const remoteBranches = useMemo(
    () => activeGitStatus?.branches.filter((branch) => branch.remote) ?? [],
    [activeGitStatus],
  );

  const clearGitSelection = useCallback(() => {
    setSelectedGitCommitId(null);
    setSelectedGitWorkingFile(null);
  }, []);

  useEffect(() => {
    clearFormatAwareDiffCaches();
    setSelectedGitCommitId(null);
    setSelectedGitWorkingFile(null);
    setGitHistoryLoading(false);
    setGitCommitDetail(null);
    setGitCommitDetailError(null);
    setGitCommitDetailLoading(false);
    setGitWorkingFileDiff(null);
    setGitWorkingFileDiffError(null);
    setGitWorkingFileDiffLoading(false);
    setGitOperationError(null);
    setGitOperationLoading(null);
    setBranchSwitcherOpen(false);
    setPendingBranchSwitch(null);
  }, [workspace?.path]);

  // Watchers keep repository state live while the sidebar is closed. Opening
  // Changes still performs an immediate reconciliation so a missed/coalesced native
  // event can never leave the first visible frame stale.
  useEffect(() => {
    if (!gitChangesActive || !workspace?.path) return;
    void refreshGitStatus("working-tree");
  }, [gitChangesActive, refreshGitStatus, workspace?.path]);

  // History is a lazy auxiliary-workbench contribution. Load its graph only
  // while that contribution is actually presented in the right sidebar.
  useEffect(() => {
    if (!gitHistoryActive || !workspace || !activeGitStatus?.isRepo) {
      setGitHistoryLoading(false);
      return undefined;
    }

    const context = captureGitRepositoryContext(workspace.path);
    if (!context) return undefined;
    const headCommitId = activeGitStatus.headCommitId;
    const requestHistoryEpoch = historyEpoch;
    const alreadyLoaded = (activeGitStatus.allCommits?.length ?? 0) > 0
      || (activeGitStatus.commits?.length ?? 0) > 0;
    // If we already have history for this HEAD + history epoch, keep it.
    if (alreadyLoaded || activeGitStatus.totalCommits === 0) {
      setGitHistoryLoading(false);
      return undefined;
    }

    const requestId = `history-${++historyRequestRef.current}`;
    let cancelled = false;
    setGitHistoryLoading(true);
    void getWorkspaceGitBranchGraph(context.rootPath, { requestId })
      .then((graph) => {
        if (cancelled) return;
        applyGitHistory(context, headCommitId, requestHistoryEpoch, graph);
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        if (/cancelled|ABORT_ERR/i.test(message)) return;
        reportGitStatusError(context, error);
      })
      .finally(() => {
        if (!cancelled) setGitHistoryLoading(false);
      });

    return () => {
      cancelled = true;
      setGitHistoryLoading(false);
      void cancelWorkspaceGitBranchGraph(requestId);
    };
  }, [
    activeGitStatus?.allCommits?.length,
    activeGitStatus?.branch,
    activeGitStatus?.commits?.length,
    activeGitStatus?.headCommitId,
    activeGitStatus?.isRepo,
    activeGitStatus?.totalCommits,
    applyGitHistory,
    captureGitRepositoryContext,
    gitHistoryActive,
    historyEpoch,
    reportGitStatusError,
    workspace,
  ]);

  useEffect(() => {
    if (!activeGitStatus?.isRepo) return;

    const historyCommits = activeGitStatus.allCommits ?? activeGitStatus.commits;
    const selectedCommitExists = selectedGitCommitId
      ? historyCommits.some((commit) => commit.commit_id === selectedGitCommitId)
      : false;

    if (selectedGitCommitId && !selectedCommitExists) {
      setSelectedGitCommitId(null);
    }

    if (selectedGitWorkingFile) {
      const source = selectedGitWorkingFile.origin === "remote"
        ? activeGitStatus.sourceControl.remote.incomingPreview
        : selectedGitWorkingFile.origin === "committed"
          ? activeGitStatus.sourceControl.remote.outgoingPreview
          : selectedGitWorkingFile.staged ? activeGitStatus.stagedEntries : [
            ...activeGitStatus.unstagedEntries,
            ...activeGitStatus.untrackedEntries,
          ];
      if (!source.some((entry) => entry.path === selectedGitWorkingFile.path)) {
        setSelectedGitWorkingFile(null);
      }
    }
  }, [activeGitStatus, selectedGitCommitId, selectedGitWorkingFile]);

  useEffect(() => {
    if (!gitHistoryActive || !workspace || !selectedGitCommitId) {
      setGitCommitDetail(null);
      setGitCommitDetailError(null);
      setGitCommitDetailLoading(false);
      return undefined;
    }

    let cancelled = false;
    setGitCommitDetailLoading(true);
    setGitCommitDetailError(null);
    getWorkspaceGitCommitDetail(workspace.path, selectedGitCommitId)
      .then((detail) => {
        if (!cancelled) setGitCommitDetail(detail);
      })
      .catch((error) => {
        if (!cancelled) {
          setGitCommitDetail(null);
          setGitCommitDetailError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setGitCommitDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [gitHistoryActive, selectedGitCommitId, workspace]);

  useEffect(() => {
    if (!gitChangesActive || !workspace || !selectedGitWorkingFile) {
      setGitWorkingFileDiff(null);
      setGitWorkingFileDiffError(null);
      setGitWorkingFileDiffLoading(false);
      return undefined;
    }

    let cancelled = false;
    const sequence = ++workingDiffRequestRef.current;
    const requestId = `git-file-diff:${Date.now().toString(36)}:${sequence}`;
    const sessionId = `git-diff-session:${Date.now().toString(36)}:${sequence}`;
    const scope = selectedGitWorkingFile.origin === "remote"
      ? "remote"
      : selectedGitWorkingFile.origin === "committed"
        ? "committed"
        : selectedGitWorkingFile.staged
          ? "staged"
          : selectedGitWorkingFile.status === "untracked"
            ? "untracked"
            : "unstaged";

    setGitWorkingFileDiffLoading(true);
    setGitWorkingFileDiffError(null);
    getWorkspaceGitFileDiff(workspace.path, selectedGitWorkingFile.path, scope, {
      requestId,
      sessionId,
    })
      .then((detail) => {
        if (!cancelled) setGitWorkingFileDiff(detail);
      })
      .catch((error) => {
        if (!cancelled) {
          setGitWorkingFileDiff(null);
          setGitWorkingFileDiffError(formatGitPreviewError(error, t));
        }
      })
      .finally(() => {
        if (!cancelled) setGitWorkingFileDiffLoading(false);
      });

    return () => {
      cancelled = true;
      void cancelWorkspaceGitFileDiff(requestId, sessionId).catch(() => undefined);
    };
  }, [gitChangesActive, selectedGitWorkingFile, t, workspace]);

  const runGitOperation = useCallback(async (
    label: string,
    operation: (rootPath: string) => Promise<GitStatusSnapshot>,
    options: {
      showRendererError?: boolean;
      refreshPresentation?: "incremental" | "atomic";
    } = {},
  ) => {
    if (!workspace) return false;
    const context = captureGitRepositoryContext(workspace.path);
    if (!context) return false;

    setGitOperationLoading(label);
    setGitOperationError(null);
    try {
      const nextStatus = await operation(context.rootPath);
      const applied = applyGitStatus(
        nextStatus,
        context,
        createRepositoryRefreshReason(label, "mutation"),
      );
      if (!applied) return false;
      onWorkspaceContentChanged(options.refreshPresentation);
      return true;
    } catch (error) {
      if (isGitRepositoryContextCurrent(context) && options.showRendererError !== false) {
        setGitOperationError(createGitOperationErrorState(error, label, context.rootPath));
      }
      if (isGitRepositoryContextCurrent(context)) {
        if (label === "push" || label === "publish") {
          await refreshGitStatusWithFetch({ silent: true, detail: `${label}-failed` });
        } else {
          void refreshGitStatus(`${label}-failed`);
        }
      }
      return false;
    } finally {
      if (isGitRepositoryContextCurrent(context)) setGitOperationLoading(null);
    }
  }, [
    applyGitStatus,
    captureGitRepositoryContext,
    isGitRepositoryContextCurrent,
    onWorkspaceContentChanged,
    refreshGitStatus,
    refreshGitStatusWithFetch,
    workspace,
  ]);

  const selectGitCommit = useCallback((commitId: string) => {
    setSelectedGitCommitId(commitId);
  }, []);

  const selectGitWorkingFile = useCallback((selection: GitWorkingSelection | null) => {
    setSelectedGitWorkingFile(selection);
  }, []);

  const handleStageGitPaths = useCallback((paths: string[]) => {
    return runGitOperation("stage", (rootPath) => stageWorkspaceGitPaths(rootPath, paths));
  }, [runGitOperation]);

  const handleStageAllGitChanges = useCallback(() => {
    return runGitOperation("stage", (rootPath) => stageAllWorkspaceGitChanges(rootPath));
  }, [runGitOperation]);

  const handleStageAndCommitGit = useCallback(async (message = "") => {
    if (!workspace) return false;
    const context = captureGitRepositoryContext(workspace.path);
    if (!context) return false;

    setGitOperationLoading("stage-commit");
    setGitOperationError(null);
    try {
      let nextStatus = await stageAllWorkspaceGitChanges(context.rootPath);
      if (nextStatus.stagedEntries.length === 0) {
        if (!applyGitStatus(
          nextStatus,
          context,
          createRepositoryRefreshReason("stage", "mutation"),
        )) return false;
        onWorkspaceContentChanged();
        return false;
      }

      nextStatus = await commitWorkspaceGit(context.rootPath, message);
      if (!applyGitStatus(
        nextStatus,
        context,
        createRepositoryRefreshReason("commit", "mutation"),
      )) return false;
      clearGitSelection();
      onWorkspaceContentChanged();
      return true;
    } catch (error) {
      if (isGitRepositoryContextCurrent(context)) {
        setGitOperationError(createGitOperationErrorState(error, "stage-commit", context.rootPath));
      }
      return false;
    } finally {
      if (isGitRepositoryContextCurrent(context)) setGitOperationLoading(null);
    }
  }, [
    applyGitStatus,
    captureGitRepositoryContext,
    clearGitSelection,
    isGitRepositoryContextCurrent,
    onWorkspaceContentChanged,
    workspace,
  ]);

  const handleUnstageGitPaths = useCallback((paths: string[]) => {
    return runGitOperation("unstage", (rootPath) => unstageWorkspaceGitPaths(rootPath, paths));
  }, [runGitOperation]);

  const handleUnstageAllGitChanges = useCallback(() => {
    return runGitOperation("unstage", (rootPath) => unstageAllWorkspaceGitChanges(rootPath));
  }, [runGitOperation]);

  const handleDiscardGitPaths = useCallback((paths: string[]) => {
    if (paths.length === 0) {
      setGitOperationError(createGitOperationMessageState("discard-selection", "discard", workspace?.path ?? null));
      return Promise.resolve(false);
    }
    const confirmed = paths.length === 1
      ? window.confirm(t("source-control.dialog.discard.path", { path: bidiIsolate(paths[0]) }))
      : window.confirm(t("source-control.dialog.discard.count", { count: paths.length }));
    if (!confirmed) {
      return Promise.resolve(false);
    }
    return runGitOperation("discard", (rootPath) => discardWorkspaceGitPaths(rootPath, paths));
  }, [runGitOperation, t, workspace]);

  const handleDiscardAllGitChanges = useCallback(() => {
    const discardableCount = activeGitStatus?.sourceControl.groups
      .filter((group) => group.id === "workingTree" || group.id === "untracked" || group.id === "merge")
      .reduce((total, group) => total + group.resources.length, 0) ?? 0;
    if (discardableCount === 0) {
      setGitOperationError(null);
      return Promise.resolve(false);
    }
    if (!window.confirm(t("source-control.dialog.discard.count", { count: discardableCount }))) {
      return Promise.resolve(false);
    }
    return runGitOperation("discard", (rootPath) => discardAllWorkspaceGitChanges(rootPath));
  }, [activeGitStatus, runGitOperation, t]);

  const handleCommitGit = useCallback(async (message = "") => {
    if (!workspace) return false;
    const context = captureGitRepositoryContext(workspace.path);
    if (!context) return false;

    setGitOperationLoading("commit");
    setGitOperationError(null);
    try {
      const nextStatus = await commitWorkspaceGit(context.rootPath, message);
      if (!applyGitStatus(
        nextStatus,
        context,
        createRepositoryRefreshReason("commit", "mutation"),
      )) return false;
      clearGitSelection();
      onWorkspaceContentChanged();
      return true;
    } catch (error) {
      if (isGitRepositoryContextCurrent(context)) {
        setGitOperationError(createGitOperationErrorState(error, "commit", context.rootPath));
      }
      return false;
    } finally {
      if (isGitRepositoryContextCurrent(context)) setGitOperationLoading(null);
    }
  }, [
    applyGitStatus,
    captureGitRepositoryContext,
    clearGitSelection,
    isGitRepositoryContextCurrent,
    onWorkspaceContentChanged,
    workspace,
  ]);

  const handleCommitAndPushGit = useCallback(async (message = "") => {
    if (!workspace) return false;
    const context = captureGitRepositoryContext(workspace.path);
    if (!context) return false;

    const remote = activeGitStatus?.sourceControl.remote;
    if (!remote?.target && !remote?.upstream) {
      setGitOperationError(createGitOperationMessageState("commit-push-no-remote", "commit-push", workspace.path));
      return false;
    }
    if (remote.behind > 0) {
      setGitOperationError(createGitOperationMessageState("commit-push-needs-pull", "commit-push", workspace.path));
      return false;
    }

    setGitOperationLoading("commit-push");
    setGitOperationError(null);
    try {
      let nextStatus = await commitWorkspaceGit(context.rootPath, message);
      if (nextStatus.sourceControl.remote.canPublish) {
        nextStatus = await publishWorkspaceGitBranch(context.rootPath);
      } else {
        nextStatus = await pushWorkspaceGit(context.rootPath);
      }
      if (!applyGitStatus(
        nextStatus,
        context,
        createRepositoryRefreshReason("push", "mutation"),
      )) return false;
      clearGitSelection();
      onWorkspaceContentChanged();
      return true;
    } catch (error) {
      if (isGitRepositoryContextCurrent(context)) {
        setGitOperationError(createGitOperationErrorState(error, "commit-push", context.rootPath));
        await refreshGitStatusWithFetch({ silent: true, detail: "commit-push-failed" });
      }
      return false;
    } finally {
      if (isGitRepositoryContextCurrent(context)) setGitOperationLoading(null);
    }
  }, [
    activeGitStatus,
    applyGitStatus,
    captureGitRepositoryContext,
    clearGitSelection,
    isGitRepositoryContextCurrent,
    onWorkspaceContentChanged,
    refreshGitStatusWithFetch,
    workspace,
  ]);

  const handlePullGit = useCallback(() => {
    return runGitOperation(
      "pull",
      (rootPath) => pullWorkspaceGit(rootPath),
      { refreshPresentation: "atomic" },
    );
  }, [runGitOperation]);

  const handlePushGit = useCallback(() => {
    return runGitOperation("push", (rootPath) => pushWorkspaceGit(rootPath));
  }, [runGitOperation]);

  const handlePublishGitBranch = useCallback(() => {
    return runGitOperation("publish", (rootPath) => publishWorkspaceGitBranch(rootPath));
  }, [runGitOperation]);

  const handleStashGitChanges = useCallback(() => {
    return runGitOperation("stash", (rootPath) => stashWorkspaceGitChanges(rootPath));
  }, [runGitOperation]);

  const handleContinueGitOperation = useCallback(() => {
    return runGitOperation(
      "continue",
      (rootPath) => continueWorkspaceGitOperation(rootPath),
      { refreshPresentation: "atomic" },
    );
  }, [runGitOperation]);

  const handleAbortGitOperation = useCallback(() => {
    return runGitOperation(
      "abort",
      (rootPath) => abortWorkspaceGitOperation(rootPath),
      { refreshPresentation: "atomic" },
    );
  }, [runGitOperation]);

  const handleCheckoutGitBranch = useCallback(async (branchName: string, remote: boolean) => {
    if (!workspace || gitStatusPath !== workspace.path || !activeGitStatus?.isRepo) {
      setGitOperationError(createGitOperationMessageState("workspace-not-repository", "checkout", workspace?.path ?? null));
      return false;
    }
    const context = captureGitRepositoryContext(workspace.path);
    if (!context) return false;

    setGitOperationLoading("checkout");
    setGitOperationError(null);
    setPendingBranchSwitch(null);
    try {
      const nextStatus = await checkoutWorkspaceGitBranch(context.rootPath, branchName, remote);
      if (!applyGitStatus(
        nextStatus,
        context,
        createRepositoryRefreshReason("checkout", "mutation"),
      )) return false;
      onWorkspaceContentChanged("atomic");
      clearGitSelection();
      return true;
    } catch (error) {
      if (!isGitRepositoryContextCurrent(context)) return false;
      const classified = classifyGitOperationError(error, "checkout");
      if (isBranchOverwriteErrorCode(classified.code)) {
        setPendingBranchSwitch({
          branchName,
          remote,
          changeCount: getGitChangeCount(activeGitStatus),
          error: null,
        });
        setBranchSwitcherOpen(false);
      } else {
        setGitOperationError(createGitOperationErrorState(error, "checkout", context.rootPath));
      }
      return false;
    } finally {
      if (isGitRepositoryContextCurrent(context)) setGitOperationLoading(null);
    }
  }, [
    activeGitStatus,
    applyGitStatus,
    captureGitRepositoryContext,
    clearGitSelection,
    gitStatusPath,
    isGitRepositoryContextCurrent,
    onWorkspaceContentChanged,
    workspace,
  ]);

  const handleStashAndCheckoutBranch = useCallback(async () => {
    if (!workspace || !pendingBranchSwitch) return false;
    const context = captureGitRepositoryContext(workspace.path);
    if (!context) return false;

    setGitOperationLoading("stash");
    setGitOperationError(null);
    try {
      const nextStatus = await stashAndCheckoutWorkspaceGitBranch(
        context.rootPath,
        pendingBranchSwitch.branchName,
        pendingBranchSwitch.remote,
      );
      if (!applyGitStatus(
        nextStatus,
        context,
        createRepositoryRefreshReason("stash-checkout", "mutation"),
      )) return false;
      onWorkspaceContentChanged("atomic");
      clearGitSelection();
      setPendingBranchSwitch(null);
      return true;
    } catch (error) {
      if (isGitRepositoryContextCurrent(context)) {
        setGitOperationError(createGitOperationErrorState(error, "checkout", context.rootPath));
        setPendingBranchSwitch((current) => current
          ? { ...current, error: t("source-control.dialog.switch.stashFailed") }
          : current);
      }
      return false;
    } finally {
      if (isGitRepositoryContextCurrent(context)) setGitOperationLoading(null);
    }
  }, [
    applyGitStatus,
    captureGitRepositoryContext,
    clearGitSelection,
    isGitRepositoryContextCurrent,
    onWorkspaceContentChanged,
    pendingBranchSwitch,
    t,
    workspace,
  ]);

  const handleCommitAndCheckoutBranch = useCallback(async () => {
    if (!workspace || !pendingBranchSwitch) return false;
    const context = captureGitRepositoryContext(workspace.path);
    if (!context) return false;

    setGitOperationLoading("commit-switch");
    setGitOperationError(null);
    try {
      const nextStatus = await commitAndCheckoutWorkspaceGitBranch(
        context.rootPath,
        pendingBranchSwitch.branchName,
        pendingBranchSwitch.remote,
      );
      if (!applyGitStatus(
        nextStatus,
        context,
        createRepositoryRefreshReason("commit-checkout", "mutation"),
      )) return false;
      onWorkspaceContentChanged("atomic");
      clearGitSelection();
      setPendingBranchSwitch(null);
      return true;
    } catch (error) {
      if (!isGitRepositoryContextCurrent(context)) return false;
      const errorState = createGitOperationErrorState(error, "commit-switch", context.rootPath);
      setGitOperationError(errorState);
      setPendingBranchSwitch((current) => current
        ? { ...current, error: formatGitOperationErrorState(errorState, t) }
        : current);
      return false;
    } finally {
      if (isGitRepositoryContextCurrent(context)) setGitOperationLoading(null);
    }
  }, [
    applyGitStatus,
    captureGitRepositoryContext,
    clearGitSelection,
    isGitRepositoryContextCurrent,
    onWorkspaceContentChanged,
    pendingBranchSwitch,
    t,
    workspace,
  ]);

  const handleInitializeGitRepository = useCallback(async () => {
    const initialized = await runGitOperation("init", (rootPath) => initializeWorkspaceGitRepository(rootPath));
    if (initialized) clearGitSelection();
    return initialized;
  }, [clearGitSelection, runGitOperation]);

  return {
    activeGitStatus,
    branchSwitcherOpen,
    branchSwitcherRef,
    gitCommitDetail,
    gitCommitDetailError,
    gitCommitDetailLoading,
    gitHistoryLoading,
    gitIncomingCount,
    gitOperationError,
    gitOperationLoading,
    gitStatus,
    gitStatusError,
    gitStatusLoading,
    gitStatusPath,
    gitWorkingFileDiff,
    gitWorkingFileDiffError,
    gitWorkingFileDiffLoading,
    localBranches,
    pendingBranchSwitch,
    remoteBranches,
    selectedGitCommitId,
    selectedGitWorkingFile,
    applyGitStatus,
    captureGitRepositoryContext,
    clearGitSelection,
    dismissGitOperationError: () => setGitOperationError(null),
    handleCheckoutGitBranch,
    handleContinueGitOperation,
    handleAbortGitOperation,
    handleCommitAndCheckoutBranch,
    handleCommitAndPushGit,
    handleCommitGit,
    handleDiscardAllGitChanges,
    handleDiscardGitPaths,
    handleInitializeGitRepository,
    handlePublishGitBranch,
    handlePullGit,
    handlePushGit,
    handleStageAllGitChanges,
    handleStageAndCommitGit,
    handleStageGitPaths,
    handleStashGitChanges,
    handleStashAndCheckoutBranch,
    handleUnstageAllGitChanges,
    handleUnstageGitPaths,
    invalidateGitStatus,
    isGitRepositoryContextCurrent,
    refreshGitStatus,
    refreshGitStatusWithFetch,
    selectGitCommit,
    selectGitWorkingFile,
    setBranchSwitcherOpen,
    setGitOperationError,
    setGitOperationLoading,
    setPendingBranchSwitch,
  };
}

export type DesktopGitController = ReturnType<typeof useDesktopGitController>;

import { useCallback, useEffect, useRef, useState } from "react";
import type { Workspace } from "@puppyone/shared-ui";
import {
  cleanupWorkspaceCloudInitialization,
  commitWorkspaceGit,
  createWorkspaceGitBranch,
  getWorkspaceCloudInitializationState,
  getWorkspaceGitStatus,
  initializeWorkspaceGitRepository,
  stageAllWorkspaceGitChanges,
  startWorkspaceCloudInitialization,
  subscribeWorkspaceCloudInitializationProgress,
} from "../../../lib/localFiles";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type {
  CloudInitializationAction,
  CloudInitializationErrorCode,
  CloudInitializationProgress,
  CloudInitializationResult,
  CloudInitializationState,
  GitStatusSnapshot,
} from "../../../types/electron";
import type { DesktopView } from "../../../components/DesktopCloudShell";
import type { CloudWorkspaceSection } from "../types";
import { createRepositoryRefreshReason } from "../../source-control/repositoryRefreshPolicy";
import type { GitRefreshReason, GitRepositoryContext } from "../../source-control/gitRefreshScheduler";

export type CloudInitializationFailure = {
  code: CloudInitializationErrorCode;
  retryable: boolean;
};

export type CloudInitializationNotice = "cleanup-completed" | null;

export type CloudInitializationStartOptions = {
  /** Set to false to stay on the current surface after a successful publish. */
  navigateToCloud?: boolean;
};

export function useCloudInitialization({
  activeCloudSession,
  applyGitStatus,
  captureGitRepositoryContext,
  clearGitSelection,
  cloudEnabled,
  desktopCloudApiBaseUrl,
  isGitRepositoryContextCurrent,
  refreshWorkspaceContent,
  setActiveCloudSection,
  setActiveView,
  setSidebarCollapsed,
  setSwitcherOpen,
  workspace,
}: {
  activeCloudSession: DesktopCloudSession | null;
  applyGitStatus: (
    status: GitStatusSnapshot,
    context: GitRepositoryContext,
    reason?: GitRefreshReason,
  ) => boolean;
  captureGitRepositoryContext: (expectedRootPath?: string) => GitRepositoryContext | null;
  clearGitSelection: () => void;
  cloudEnabled: boolean;
  desktopCloudApiBaseUrl: string | null;
  isGitRepositoryContextCurrent: (context: GitRepositoryContext) => boolean;
  refreshWorkspaceContent: () => void;
  setActiveCloudSection: (section: CloudWorkspaceSection) => void;
  setActiveView: (view: DesktopView) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSwitcherOpen: (open: boolean) => void;
  workspace: Workspace | null;
}) {
  const [state, setState] = useState<CloudInitializationState | null>(null);
  const [progress, setProgress] = useState<CloudInitializationProgress | null>(null);
  const [error, setError] = useState<CloudInitializationFailure | null>(null);
  const [notice, setNotice] = useState<CloudInitializationNotice>(null);
  const [stateLoading, setStateLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const actionRef = useRef<symbol | null>(null);
  const stateRequestRef = useRef<symbol | null>(null);

  const identity = getInitializationIdentity({
    session: activeCloudSession,
    apiBaseUrl: desktopCloudApiBaseUrl,
    workspace,
    cloudEnabled,
  });
  const identityKey = identity
    ? [
        identity.rootPath,
        identity.apiBaseUrl,
        identity.userId,
        activeCloudSession?.session_generation ?? "",
      ].join("\n")
    : null;

  const reconcileGitStatus = useCallback((
    status: GitStatusSnapshot | undefined,
    context: GitRepositoryContext,
  ) => {
    if (!status || !isGitRepositoryContextCurrent(context)) return false;
    if (!applyGitStatus(
      status,
      context,
      createRepositoryRefreshReason("cloud-initialization", "mutation"),
    )) return false;
    refreshWorkspaceContent();
    return true;
  }, [applyGitStatus, isGitRepositoryContextCurrent, refreshWorkspaceContent]);

  const finishPublished = useCallback((
    result: Extract<CloudInitializationResult, { ok: true }>,
    context: GitRepositoryContext,
    options: CloudInitializationStartOptions,
  ) => {
    if (result.gitStatus && !reconcileGitStatus(result.gitStatus, context)) return false;
    const published = isPublished(result.state);
    setState(published ? null : result.state);
    setProgress(null);
    setError(null);
    setNotice(null);
    if (!published) return true;
    clearGitSelection();
    // Inline callers (for example the Share wizard) own their own follow-up
    // surface; only the Cloud hub entry navigates into the Cloud panel.
    if (options.navigateToCloud === false) return true;
    setActiveCloudSection("contents");
    setActiveView("cloud");
    setSidebarCollapsed(false);
    setSwitcherOpen(false);
    return true;
  }, [clearGitSelection, reconcileGitStatus, setActiveCloudSection, setActiveView, setSidebarCollapsed, setSwitcherOpen]);

  useEffect(() => {
    stateRequestRef.current = null;
    actionRef.current = null;
    setState(null);
    setProgress(null);
    setError(null);
    setNotice(null);
    setActionLoading(false);
    if (!identity || !identityKey) {
      setStateLoading(false);
      return undefined;
    }

    const request = Symbol("load-cloud-initialization-state");
    stateRequestRef.current = request;
    setStateLoading(true);
    const context = captureGitRepositoryContext(identity.rootPath);
    void getWorkspaceCloudInitializationState(identity)
      .then((result) => {
        if (stateRequestRef.current !== request) return;
        const published = isPublished(result.state);
        setState(published ? null : result.state);
        if (!result.ok) {
          const failure = toPublicFailure(result);
          setError(isLocalPreparationRequirement(failure.code) ? null : failure);
          return;
        }
        setError(null);
        if (context && result.gitStatus) reconcileGitStatus(result.gitStatus, context);
        if (published) {
          clearGitSelection();
          setActiveCloudSection("contents");
        }
      })
      .catch(() => {
        if (stateRequestRef.current === request) setError({ code: "UNKNOWN", retryable: true });
      })
      .finally(() => {
        if (stateRequestRef.current === request) {
          stateRequestRef.current = null;
          setStateLoading(false);
        }
      });
    return () => {
      if (stateRequestRef.current === request) stateRequestRef.current = null;
    };
  // The normalized string is the complete authority boundary for recovery reads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey]);

  useEffect(() => {
    const rootPath = identity?.rootPath;
    if (!rootPath) return undefined;
    return subscribeWorkspaceCloudInitializationProgress((event) => {
      if (event.rootPath !== rootPath || !actionRef.current) return;
      setProgress(event);
      if (event.state) setState(isPublished(event.state) ? null : event.state);
    });
  // The normalized identity key owns this subscription's authority and lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey]);

  const start = useCallback(async (
    organizationId?: string,
    options: CloudInitializationStartOptions = {},
  ) => {
    if (!cloudEnabled || !workspace || actionRef.current) return;
    if (!activeCloudSession) {
      setError({ code: "SESSION_REQUIRED", retryable: true });
      return;
    }

    const currentIdentity = getInitializationIdentity({
      session: activeCloudSession,
      apiBaseUrl: desktopCloudApiBaseUrl,
      workspace,
      cloudEnabled,
    });
    const context = captureGitRepositoryContext(workspace.path);
    if (!currentIdentity || !context) {
      setError({ code: "REPOSITORY_REQUIRED", retryable: false });
      return;
    }

    const request = Symbol("start-cloud-initialization");
    stateRequestRef.current = null;
    setStateLoading(false);
    actionRef.current = request;
    setActionLoading(true);
    setProgress({
      rootPath: currentIdentity.rootPath,
      operationId: state?.operationId ?? null,
      stage: "validating",
      state,
      updatedAt: new Date().toISOString(),
    });
    setError(null);
    setNotice(null);
    try {
      const pending = state;
      const choosingSource = pending?.availableActions.includes("choose-source") === true;
      const selectedOrganizationId = pending?.organizationId ?? organizationId?.trim() ?? "";
      if (!selectedOrganizationId) {
        setError({ code: "ORGANIZATION_REQUIRED", retryable: false });
        return;
      }
      const action = pending ? selectPushAction(pending.availableActions) : "initialize";
      if (!action) {
        setError({
          code: pending?.local === "source-missing" ? "SOURCE_MISSING" : "REMOTE_REF_CONFLICT",
          retryable: false,
        });
        return;
      }
      let freshStatus = !pending || choosingSource
        ? await getWorkspaceGitStatus(workspace.path)
        : null;
      if (!pending && freshStatus) {
        let preparationFailure: CloudInitializationErrorCode = "REPOSITORY_REQUIRED";
        const reportLocalProgress = (stage: CloudInitializationProgress["stage"]) => {
          setProgress({
            rootPath: currentIdentity.rootPath,
            operationId: null,
            stage,
            state: null,
            updatedAt: new Date().toISOString(),
          });
        };
        try {
          if (!freshStatus.isRepo) {
            preparationFailure = "REPOSITORY_REQUIRED";
            reportLocalProgress("enabling-version-control");
            freshStatus = await initializeWorkspaceGitRepository(workspace.path);
          }
          if (!freshStatus.headCommitId || freshStatus.totalCommits < 1) {
            preparationFailure = "COMMIT_REQUIRED";
            reportLocalProgress("creating-snapshot");
            freshStatus = await stageAllWorkspaceGitChanges(workspace.path);
            freshStatus = await commitWorkspaceGit(
              workspace.path,
              "Initial snapshot",
              {
                allowEmpty: true,
                authorName: activeCloudSession.user_email,
                authorEmail: activeCloudSession.user_email,
              },
            );
          }
          if (!normalizeBranch(freshStatus.branch)) {
            preparationFailure = "BRANCH_REQUIRED";
            reportLocalProgress("creating-branch");
            freshStatus = await createWorkspaceGitBranch(
              workspace.path,
              resolveCloudPublishBranchName(freshStatus),
            );
          }
        } catch {
          setError({ code: preparationFailure, retryable: true });
          return;
        }
        reportLocalProgress("validating");
      }
      const sourceBranch = choosingSource
        ? normalizeBranch(freshStatus?.branch)
        : pending?.selectedSourceBranch ?? normalizeBranch(freshStatus?.branch);
      const result = await startWorkspaceCloudInitialization({
        ...currentIdentity,
        organizationId: selectedOrganizationId,
        projectName: pending?.projectName ?? workspace.name,
        sourceBranch,
        operationId: pending?.operationId ?? null,
        action,
      });
      if (actionRef.current !== request || !isGitRepositoryContextCurrent(context)) return;
      setState(result.state);
      if (!result.ok) {
        setError(toPublicFailure(result));
        return;
      }
      finishPublished(result, context, options);
    } catch {
      if (actionRef.current === request) setError({ code: "UNKNOWN", retryable: true });
    } finally {
      if (actionRef.current === request) {
        actionRef.current = null;
        setActionLoading(false);
        setProgress(null);
      }
    }
  }, [
    activeCloudSession,
    captureGitRepositoryContext,
    cloudEnabled,
    desktopCloudApiBaseUrl,
    finishPublished,
    isGitRepositoryContextCurrent,
    state,
    workspace,
  ]);

  const cleanup = useCallback(async () => {
    if (
      !identity
      || !state
      || !state.availableActions.some((action) => ["delete-empty-project", "finish-cleanup"].includes(action))
      || actionRef.current
    ) return;
    const context = captureGitRepositoryContext(identity.rootPath);
    if (!context) return;
    const request = Symbol("cleanup-cloud-initialization");
    actionRef.current = request;
    setActionLoading(true);
    setProgress(null);
    setError(null);
    setNotice(null);
    try {
      const result = await cleanupWorkspaceCloudInitialization({
        ...identity,
        operationId: state.operationId,
      });
      if (actionRef.current !== request || !isGitRepositoryContextCurrent(context)) return;
      setState(result.state);
      if (!result.ok) {
        setError(toPublicFailure(result));
        return;
      }
      reconcileGitStatus(result.gitStatus, context);
      setState(null);
      setNotice("cleanup-completed");
      setActiveCloudSection("initialize");
      setActiveView("cloud");
    } catch {
      if (actionRef.current === request) setError({ code: "UNKNOWN", retryable: true });
    } finally {
      if (actionRef.current === request) {
        actionRef.current = null;
        setActionLoading(false);
      }
    }
  }, [
    captureGitRepositoryContext,
    identity,
    isGitRepositoryContextCurrent,
    reconcileGitStatus,
    setActiveCloudSection,
    setActiveView,
    state,
  ]);

  return {
    cloudInitializationError: error,
    cloudInitializationLoading: actionLoading,
    cloudInitializationNotice: notice,
    cloudInitializationPending: false,
    cloudInitializationProgress: progress,
    cloudInitializationState: state,
    cloudInitializationStateLoading: stateLoading,
    handleCleanupCloudInitialization: cleanup,
    handleStartCloudInitialization: start,
  };
}

function getInitializationIdentity({
  session,
  apiBaseUrl,
  workspace,
  cloudEnabled,
}: {
  session: DesktopCloudSession | null;
  apiBaseUrl: string | null;
  workspace: Workspace | null;
  cloudEnabled: boolean;
}) {
  if (!session || !workspace || !cloudEnabled) return null;
  const resolvedApiBaseUrl = (apiBaseUrl ?? session.api_base_url).trim().replace(/\/+$/, "");
  const userId = session.user_id.trim();
  if (!resolvedApiBaseUrl || !userId) return null;
  return { rootPath: workspace.path, apiBaseUrl: resolvedApiBaseUrl, userId };
}

function normalizeBranch(value: string | null | undefined): string {
  const normalized = value?.trim() ?? "";
  return ["head", "detached"].includes(normalized.toLowerCase()) ? "" : normalized;
}

function resolveCloudPublishBranchName(status: GitStatusSnapshot): string {
  const existing = new Set(
    status.branches
      .filter((branch) => !branch.remote)
      .map((branch) => branch.name),
  );
  for (const candidate of ["main", "puppyone-publish"]) {
    if (!existing.has(candidate)) return candidate;
  }
  let suffix = 2;
  while (existing.has(`puppyone-publish-${suffix}`)) suffix += 1;
  return `puppyone-publish-${suffix}`;
}

function isLocalPreparationRequirement(code: CloudInitializationErrorCode): boolean {
  return code === "REPOSITORY_REQUIRED"
    || code === "COMMIT_REQUIRED"
    || code === "BRANCH_REQUIRED";
}

function selectPushAction(
  actions: readonly CloudInitializationAction[],
): "retry-push" | "push-latest" | "choose-source" | "reconcile" | null {
  if (actions.includes("reconcile")) return "reconcile";
  if (actions.includes("choose-source")) return "choose-source";
  if (actions.includes("push-latest")) return "push-latest";
  if (actions.includes("retry-push")) return "retry-push";
  return null;
}

function isPublished(state: CloudInitializationState | null | undefined): boolean {
  return state?.push === "accepted" || state?.project === "published" && state.push !== "conflict";
}

function toPublicFailure(
  result: Extract<CloudInitializationResult, { ok: false }>,
): CloudInitializationFailure {
  return { code: result.error.code, retryable: result.error.retryable };
}

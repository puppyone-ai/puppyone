import path from "node:path";
import {
  abortWorkspaceGitOperation,
  checkoutWorkspaceGitBranch,
  commitAndCheckoutWorkspaceGitBranch,
  commitWorkspaceGit,
  continueWorkspaceGitOperation,
  createWorkspaceGitBranch,
  discardAllWorkspaceGitChanges,
  discardWorkspaceGitPaths,
  fetchWorkspaceGit,
  getWorkspaceGitBranchGraph,
  getWorkspaceGitCommitDetail,
  getWorkspaceGitFileDiff,
  getWorkspaceGitStatus,
  initializeWorkspaceGitRepository,
  pullWorkspaceGit,
  publishWorkspaceGitBranch,
  pushWorkspaceGit,
  pushWorkspaceGitCommitToRemote,
  readPuppyoneWorkspaceConfig,
  removeWorkspaceGitRemote,
  resolveGitRepositoryIdentity,
  stageAllWorkspaceGitChanges,
  stageWorkspaceGitPaths,
  stashWorkspaceGitChanges,
  stashAndCheckoutWorkspaceGitBranch,
  syncWorkspaceGit,
  unstageAllWorkspaceGitChanges,
  unstageWorkspaceGitPaths,
  writePuppyoneWorkspaceConfig,
} from "../../../local-api/workspace.mjs";
import {
  createGitOperationCoordinator,
  repositoryLockKey,
  worktreeLockKey,
} from "../git-operation-coordinator.mjs";
import { createGitDiffResourceBroker } from "../git-diff-resource-broker.mjs";
import { createCloudGitOperationLease } from "../cloud-git-operation-lease.mjs";
import { createCloudPublishGitCredentialManager } from "../cloud-publish-git-credentials.mjs";
import { inspectCloudRemote } from "../cloud-publish-git.mjs";

export function registerWorkspaceGitIpcHandlers({
  ipcMain,
  BrowserWindow,
  dialog,
  authorizeWorkspaceRoot,
  cloudGitCredentialManager = createCloudPublishGitCredentialManager(),
  cloudGitOperationLease = createCloudGitOperationLease(),
  gitOperationCoordinator = createGitOperationCoordinator(),
  gitDiffResourceBroker = createGitDiffResourceBroker(),
  t = defaultTranslate,
}) {
  const statusControllers = new Map();
  const cancelledStatusRequests = new Set();
  const graphControllers = new Map();
  const cancelledGraphRequests = new Set();
  const diffControllers = new Map();
  const cancelledDiffRequests = new Set();
  const observedDiffSenders = new WeakSet();

  const withAuthorizedRoot = (handler) => async (event, request) => {
    const rootPath = await authorizeWorkspaceRoot(event, request?.rootPath);
    return handler(rootPath, request, event);
  };

  const resolveLockKeys = async (rootPath) => {
    const worktreeKey = worktreeLockKey(path.resolve(rootPath));
    const identity = await resolveGitRepositoryIdentity(rootPath).catch(() => null);
    const shared = identity?.commonDir || identity?.topLevel || path.resolve(rootPath);
    const repoKey = repositoryLockKey(shared);
    return { worktreeKey, repoKey };
  };

  const withAuthorizedWorktreeMutation = (handler) => withAuthorizedRoot(async (rootPath, request, event) => {
    const { worktreeKey } = await resolveLockKeys(rootPath);
    return gitOperationCoordinator.run(worktreeKey, () => handler(rootPath, request, event));
  });

  const withAuthorizedRepositoryMutation = (handler) => withAuthorizedRoot(async (rootPath, request, event) => {
    const { repoKey } = await resolveLockKeys(rootPath);
    return gitOperationCoordinator.run(repoKey, () => handler(rootPath, request, event));
  });

  const withAuthorizedWorktreeAndRepositoryMutation = (handler) => withAuthorizedRoot(async (
    rootPath,
    request,
    event,
  ) => {
    const { worktreeKey, repoKey } = await resolveLockKeys(rootPath);
    return gitOperationCoordinator.runAll(
      [worktreeKey, repoKey],
      () => handler(rootPath, request, event),
    );
  });

  const withAuthorizedIdleRead = (handler) => withAuthorizedRoot(async (rootPath, request, event) => {
    const { worktreeKey, repoKey } = await resolveLockKeys(rootPath);
    await gitOperationCoordinator.whenIdleAll([worktreeKey, repoKey]);
    return handler(rootPath, request, event);
  });

  ipcMain.handle("workspace:git-status", withAuthorizedRoot(async (rootPath, request, event) => {
    const requestId = normalizeGitStatusRequestId(request?.requestId);
    const key = requestId ? `${event.sender.id}:${requestId}` : null;
    const controller = new AbortController();
    const onDestroyed = () => controller.abort();

    if (key) {
      statusControllers.get(key)?.abort();
      statusControllers.set(key, controller);
      if (cancelledStatusRequests.delete(key)) controller.abort();
    }
    event.sender.once?.("destroyed", onDestroyed);

    try {
      const { worktreeKey, repoKey } = await resolveLockKeys(rootPath);
      await gitOperationCoordinator.whenIdleAll([worktreeKey, repoKey], {
        signal: controller.signal,
      });
      return await getWorkspaceGitStatus(rootPath, { signal: controller.signal });
    } finally {
      if (key && statusControllers.get(key) === controller) statusControllers.delete(key);
      event.sender.removeListener?.("destroyed", onDestroyed);
    }
  }));

  ipcMain.handle("workspace:git-status-cancel", async (event, request) => {
    const requestId = normalizeGitStatusRequestId(request?.requestId);
    if (!requestId) return { ok: true };
    const key = `${event.sender.id}:${requestId}`;
    const controller = statusControllers.get(key);
    if (controller) {
      controller.abort();
    } else {
      cancelledStatusRequests.add(key);
      const cleanup = setTimeout(() => cancelledStatusRequests.delete(key), 30_000);
      cleanup.unref?.();
    }
    return { ok: true };
  });

  ipcMain.handle("workspace:git-branch-graph", withAuthorizedRoot(async (rootPath, request, event) => {
    const requestId = normalizeGitStatusRequestId(request?.requestId);
    const key = requestId ? `${event.sender.id}:graph:${requestId}` : null;
    const controller = new AbortController();
    const onDestroyed = () => controller.abort();

    if (key) {
      graphControllers.get(key)?.abort();
      graphControllers.set(key, controller);
      if (cancelledGraphRequests.delete(key)) controller.abort();
    }
    event.sender.once?.("destroyed", onDestroyed);

    try {
      const { worktreeKey, repoKey } = await resolveLockKeys(rootPath);
      await gitOperationCoordinator.whenIdleAll([worktreeKey, repoKey], {
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        const error = new Error("Git branch graph request was cancelled.");
        error.name = "AbortError";
        error.code = "ABORT_ERR";
        throw error;
      }
      return await getWorkspaceGitBranchGraph(rootPath);
    } finally {
      if (key && graphControllers.get(key) === controller) graphControllers.delete(key);
      event.sender.removeListener?.("destroyed", onDestroyed);
    }
  }));

  ipcMain.handle("workspace:git-branch-graph-cancel", async (event, request) => {
    const requestId = normalizeGitStatusRequestId(request?.requestId);
    if (!requestId) return { ok: true };
    const key = `${event.sender.id}:graph:${requestId}`;
    const controller = graphControllers.get(key);
    if (controller) {
      controller.abort();
    } else {
      cancelledGraphRequests.add(key);
      const cleanup = setTimeout(() => cancelledGraphRequests.delete(key), 30_000);
      cleanup.unref?.();
    }
    return { ok: true };
  });

  ipcMain.handle("workspace:git-init", withAuthorizedWorktreeAndRepositoryMutation((rootPath) => (
    initializeWorkspaceGitRepository(rootPath)
  )));

  ipcMain.handle("workspace:git-remove-remote", withAuthorizedRepositoryMutation(async (rootPath, request) => {
    const remoteName = request?.remoteName ?? "puppyone";
    if (remoteName !== "puppyone") return removeWorkspaceGitRemote(rootPath, remoteName);
    const lease = await cloudGitOperationLease.acquire(rootPath);
    try {
      const remote = await inspectCloudRemote(rootPath);
      if (remote.kind === "exact") {
        await cloudGitCredentialManager.detachManaged(rootPath, remote.url);
      } else if (remote.kind === "conflict") {
        throw new Error(
          "The PuppyOne Git remote is ambiguous. Repair its fetch/push URLs before detaching it.",
        );
      }
      return await removeWorkspaceGitRemote(rootPath, remoteName);
    } finally {
      await lease.release();
    }
  }));

  ipcMain.handle("workspace:puppyone-config-read", withAuthorizedRoot((rootPath) => (
    readPuppyoneWorkspaceConfig(rootPath)
  )));

  ipcMain.handle("workspace:puppyone-config-write", withAuthorizedWorktreeMutation((rootPath, request) => (
    writePuppyoneWorkspaceConfig(rootPath, request?.config)
  )));

  ipcMain.handle("workspace:git-commit-detail", withAuthorizedIdleRead((rootPath, request) => {
    const commitId = request?.commitId;
    if (typeof commitId !== "string" || commitId.trim().length === 0) {
      throw new Error("Commit id is required.");
    }
    return getWorkspaceGitCommitDetail(rootPath, commitId);
  }));

  ipcMain.handle("workspace:git-file-diff", withAuthorizedRoot(async (rootPath, request, event) => {
    const filePath = request?.path;
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      throw new Error("File path is required.");
    }
    const requestId = normalizeGitStatusRequestId(request?.requestId);
    const sessionId = normalizeGitDiffSessionId(request?.sessionId)
      ?? gitDiffResourceBroker.createSessionId();
    const key = requestId ? `${event.sender.id}:diff:${requestId}` : null;
    const controller = new AbortController();
    const onDestroyed = () => controller.abort();

    if (!observedDiffSenders.has(event.sender)) {
      observedDiffSenders.add(event.sender);
      event.sender.once?.("destroyed", () => gitDiffResourceBroker.revokeOwner(event.sender.id));
    }
    if (key) {
      diffControllers.get(key)?.abort();
      diffControllers.set(key, controller);
      if (cancelledDiffRequests.delete(key)) controller.abort();
    }
    event.sender.once?.("destroyed", onDestroyed);

    try {
      const { worktreeKey, repoKey } = await resolveLockKeys(rootPath);
      await gitOperationCoordinator.whenIdleAll([worktreeKey, repoKey], { signal: controller.signal });
      const detail = await getWorkspaceGitFileDiff(rootPath, filePath, request?.scope, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) throw createGitDiffAbortError();
      return gitDiffResourceBroker.issueDetail(detail, {
        ownerWebContentsId: event.sender.id,
        sessionId,
      });
    } finally {
      if (key && diffControllers.get(key) === controller) diffControllers.delete(key);
      event.sender.removeListener?.("destroyed", onDestroyed);
    }
  }));

  ipcMain.handle("workspace:git-file-diff-cancel", async (event, request) => {
    const requestId = normalizeGitStatusRequestId(request?.requestId);
    const sessionId = normalizeGitDiffSessionId(request?.sessionId);
    if (requestId) {
      const key = `${event.sender.id}:diff:${requestId}`;
      const controller = diffControllers.get(key);
      if (controller) {
        controller.abort();
      } else {
        cancelledDiffRequests.add(key);
        const cleanup = setTimeout(() => cancelledDiffRequests.delete(key), 30_000);
        cleanup.unref?.();
      }
    }
    if (sessionId) {
      gitDiffResourceBroker.revokeSession(sessionId, {
        ownerWebContentsId: event.sender.id,
        ignoreMissing: true,
      });
    }
    return { ok: true };
  });

  ipcMain.handle("workspace:git-diff-resource-read", async (event, request) => (
    gitDiffResourceBroker.read({
      handle: request?.handle,
      ownerWebContentsId: event.sender.id,
      sessionId: request?.sessionId,
      selectionIdentity: request?.selectionIdentity,
      revisionIdentity: request?.revisionIdentity,
      offset: request?.offset,
      length: request?.length,
    })
  ));

  ipcMain.handle("workspace:git-diff-resource-release", async (event, request) => ({
    ok: gitDiffResourceBroker.revokeSession(request?.sessionId, {
      ownerWebContentsId: event.sender.id,
      ignoreMissing: true,
    }),
  }));

  ipcMain.handle("workspace:git-stage", withAuthorizedWorktreeMutation((rootPath, request) => (
    stageWorkspaceGitPaths(rootPath, request?.paths)
  )));

  ipcMain.handle("workspace:git-stage-all", withAuthorizedWorktreeMutation((rootPath) => (
    stageAllWorkspaceGitChanges(rootPath)
  )));

  ipcMain.handle("workspace:git-unstage", withAuthorizedWorktreeMutation((rootPath, request) => (
    unstageWorkspaceGitPaths(rootPath, request?.paths)
  )));

  ipcMain.handle("workspace:git-unstage-all", withAuthorizedWorktreeMutation((rootPath) => (
    unstageAllWorkspaceGitChanges(rootPath)
  )));

  ipcMain.handle("workspace:git-discard", withAuthorizedWorktreeMutation((rootPath, request) => (
    discardWorkspaceGitPaths(rootPath, request?.paths)
  )));

  ipcMain.handle("workspace:git-discard-all", withAuthorizedWorktreeMutation((rootPath) => (
    discardAllWorkspaceGitChanges(rootPath)
  )));

  ipcMain.handle("workspace:git-commit", withAuthorizedWorktreeAndRepositoryMutation((rootPath, request) => (
    commitWorkspaceGit(rootPath, request?.message, {
      allowEmpty: request?.allowEmpty === true,
      authorName: request?.authorName,
      authorEmail: request?.authorEmail,
    })
  )));

  ipcMain.handle("workspace:git-stash", withAuthorizedWorktreeAndRepositoryMutation((rootPath) => (
    stashWorkspaceGitChanges(rootPath)
  )));

  ipcMain.handle("workspace:git-operation-continue", withAuthorizedWorktreeAndRepositoryMutation((rootPath) => (
    continueWorkspaceGitOperation(rootPath)
  )));

  ipcMain.handle("workspace:git-operation-abort", withAuthorizedWorktreeAndRepositoryMutation((rootPath) => (
    abortWorkspaceGitOperation(rootPath)
  )));

  ipcMain.handle("workspace:git-checkout-branch", withAuthorizedWorktreeAndRepositoryMutation((rootPath, request) => (
    checkoutWorkspaceGitBranch(rootPath, request?.branchName, {
      remote: Boolean(request?.remote),
    })
  )));

  ipcMain.handle("workspace:git-stash-checkout-branch", withAuthorizedWorktreeAndRepositoryMutation((rootPath, request) => (
    stashAndCheckoutWorkspaceGitBranch(rootPath, request?.branchName, {
      remote: Boolean(request?.remote),
    })
  )));

  ipcMain.handle("workspace:git-commit-checkout-branch", withAuthorizedWorktreeAndRepositoryMutation((rootPath, request) => (
    commitAndCheckoutWorkspaceGitBranch(rootPath, request?.branchName, {
      remote: Boolean(request?.remote),
    })
  )));

  ipcMain.handle("workspace:git-create-branch", withAuthorizedRepositoryMutation((rootPath, request) => (
    createWorkspaceGitBranch(rootPath, request?.branchName)
  )));

  ipcMain.handle("workspace:git-fetch", withAuthorizedRepositoryMutation((rootPath, request) => (
    fetchWorkspaceGit(rootPath, { remoteName: request?.remoteName })
  )));

  ipcMain.handle("workspace:git-pull", withAuthorizedWorktreeAndRepositoryMutation((rootPath, request, event) => (
    runWorkspaceGitIpcOperation({ BrowserWindow, dialog, t }, event, request, "pull", () => (
      pullWorkspaceGit(rootPath)
    ))
  )));

  ipcMain.handle("workspace:git-push", withAuthorizedRepositoryMutation((rootPath, request, event) => (
    runWorkspaceGitIpcOperation({ BrowserWindow, dialog, t }, event, request, "push", () => (
      pushWorkspaceGit(rootPath)
    ))
  )));

  ipcMain.handle("workspace:git-push-commit-to-remote", withAuthorizedRepositoryMutation((rootPath, request) => (
    pushWorkspaceGitCommitToRemote(rootPath, {
      remoteName: request?.remoteName,
      destinationBranch: request?.destinationBranch,
      expectedHeadCommitId: request?.expectedHeadCommitId,
      expectedBranch: request?.expectedBranch,
    })
  )));

  ipcMain.handle("workspace:git-publish-branch", withAuthorizedRepositoryMutation((rootPath, request) => (
    publishWorkspaceGitBranch(rootPath, request?.remoteName)
  )));

  ipcMain.handle("workspace:git-sync", withAuthorizedWorktreeAndRepositoryMutation((rootPath) => (
    syncWorkspaceGit(rootPath)
  )));
}

function normalizeGitStatusRequestId(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(normalized)) return null;
  return normalized;
}

function normalizeGitDiffSessionId(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9._:-]{8,256}$/.test(normalized)) return null;
  return normalized;
}

function createGitDiffAbortError() {
  const error = new Error("Git diff request was aborted.");
  error.name = "AbortError";
  return error;
}

async function runWorkspaceGitIpcOperation(electron, event, request, operation, handler) {
  try {
    return await handler();
  } catch (error) {
    if (request?.showNativeErrorDialog === true) {
      void showWorkspaceGitErrorDialog(electron, event.sender, operation, error);
    }
    throw error;
  }
}

async function showWorkspaceGitErrorDialog({ BrowserWindow, dialog, t }, sender, operation, error) {
  const owner = BrowserWindow.fromWebContents(sender);
  const detail = error instanceof Error ? error.message : String(error);
  const titleId = operation === "pull"
    ? "native.git.pull.error.title"
    : operation === "push"
      ? "native.git.push.error.title"
      : "native.git.operation.error.title";
  const messageId = operation === "pull"
    ? "native.git.pull.error.message"
    : operation === "push"
      ? "native.git.push.error.message"
      : "native.git.operation.error.message";

  try {
    const options = {
      type: "error",
      buttons: [t("native.git.error.ok")],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: t(titleId),
      message: t(messageId),
      detail: detail.trim() || t("native.git.error.noOutput"),
    };
    if (owner && !owner.isDestroyed()) {
      await dialog.showMessageBox(owner, options);
    } else {
      await dialog.showMessageBox(options);
    }
  } catch (dialogError) {
    console.warn("Unable to show Git operation error dialog:", dialogError);
  }
}

function defaultTranslate(messageId) {
  const messages = {
    "native.git.error.ok": "OK",
    "native.git.pull.error.title": "Pull Failed",
    "native.git.push.error.title": "Push Failed",
    "native.git.operation.error.title": "Git Operation Failed",
    "native.git.pull.error.message": "Cannot pull remote changes.",
    "native.git.push.error.message": "Cannot push local commits.",
    "native.git.operation.error.message": "Git operation failed.",
    "native.git.error.noOutput": "No Git error output was captured.",
  };
  return messages[messageId] ?? "";
}

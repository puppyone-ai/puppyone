/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitRepositoryContext } from "../../../../src/features/source-control/gitRefreshScheduler";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import type {
  CloudInitializationResult,
  CloudInitializationState,
  GitStatusSnapshot,
} from "../../../../src/types/electron";

const localFiles = vi.hoisted(() => ({
  cleanupWorkspaceCloudInitialization: vi.fn(),
  commitWorkspaceGit: vi.fn(),
  createWorkspaceGitBranch: vi.fn(),
  getWorkspaceCloudInitializationState: vi.fn(),
  getWorkspaceGitStatus: vi.fn(),
  initializeWorkspaceGitRepository: vi.fn(),
  stageAllWorkspaceGitChanges: vi.fn(),
  startWorkspaceCloudInitialization: vi.fn(),
  subscribeWorkspaceCloudInitializationProgress: vi.fn<typeof import("../../../../src/lib/localFiles").subscribeWorkspaceCloudInitializationProgress>(() => () => {}),
}));

vi.mock("../../../../src/lib/localFiles", () => localFiles);

import { useCloudInitialization } from "../../../../src/features/cloud/initialization/useCloudInitialization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const session = {
  user_id: "user-1",
  user_email: "dev@example.com",
  api_base_url: "https://cloud.example/api/v1",
  session_generation: "generation-1",
  status: "authenticated",
  expires_at: 4_102_444_800,
  expires_in: 3_600,
} as DesktopCloudSession;

const initialStatus = {
  isRepo: true,
  branch: "main",
  totalCommits: 1,
  entries: [],
  branches: [],
  stagedEntries: [],
  unstagedEntries: [],
  untrackedEntries: [],
  remotes: [],
  headCommitId: "head-before-publish",
} as unknown as GitStatusSnapshot;

const publishedStatus = {
  ...initialStatus,
  remotes: [{
    name: "puppyone",
    fetchUrl: "https://cloud.example/git/project-1.git",
    pushUrl: "https://cloud.example/git/project-1.git",
    branches: [],
  }],
} as GitStatusSnapshot;

const localFolderStatus = {
  ...initialStatus,
  isRepo: false,
  branch: null,
  totalCommits: 0,
  headCommitId: null,
  branches: [],
} as unknown as GitStatusSnapshot;

const emptyRepositoryStatus = {
  ...localFolderStatus,
  isRepo: true,
  branch: "main",
} as GitStatusSnapshot;

const repositoryContext = { rootPath: "/tmp/local-notes" } as GitRepositoryContext;

const interruptedState = createInitializationState({
  project: "empty",
  push: "failed",
  projectId: "project-1",
  organizationId: "org-from-journal",
  projectName: "Name from journal",
  selectedSourceBranch: "journal-branch",
  selectedSourceRef: "refs/heads/journal-branch",
  attemptCommitOid: "journal-head",
  latestSourceCommitOid: "journal-head",
  availableActions: ["retry-push", "delete-empty-project"],
});

const uploadingState = createInitializationState({
  project: "empty",
  push: "uploading",
  projectId: "project-1",
  availableActions: [],
});

const completedState = createInitializationState({
  project: "published",
  push: "accepted",
  projectId: "project-1",
  availableActions: [],
});

const actions = {
  applyGitStatus: vi.fn(() => true),
  captureGitRepositoryContext: vi.fn(() => repositoryContext),
  clearGitSelection: vi.fn(),
  isGitRepositoryContextCurrent: vi.fn(() => true),
  refreshWorkspaceContent: vi.fn(),
  setActiveCloudSection: vi.fn(),
  setActiveView: vi.fn(),
  setSidebarCollapsed: vi.fn(),
  setSwitcherOpen: vi.fn(),
};

function InitializationHarness({ activeSession }: { activeSession: DesktopCloudSession | null }) {
  const initialization = useCloudInitialization({
    activeCloudSession: activeSession,
    applyGitStatus: actions.applyGitStatus,
    captureGitRepositoryContext: actions.captureGitRepositoryContext,
    clearGitSelection: actions.clearGitSelection,
    cloudEnabled: true,
    desktopCloudApiBaseUrl: "https://cloud.example/api/v1",
    isGitRepositoryContextCurrent: actions.isGitRepositoryContextCurrent,
    refreshWorkspaceContent: actions.refreshWorkspaceContent,
    setActiveCloudSection: actions.setActiveCloudSection,
    setActiveView: actions.setActiveView,
    setSidebarCollapsed: actions.setSidebarCollapsed,
    setSwitcherOpen: actions.setSwitcherOpen,
    workspace: {
      status: "recording",
      id: "local-notes",
      name: "Local Notes",
      path: repositoryContext.rootPath,
    },
  });

  return (
    <>
      <button type="button" data-action="start" onClick={() => void initialization.handleStartCloudInitialization("org-1")}>
        Start
      </button>
      <button type="button" data-action="retry" onClick={() => void initialization.handleStartCloudInitialization()}>
        Retry
      </button>
      <button type="button" data-action="cleanup" onClick={() => void initialization.handleCleanupCloudInitialization()}>
        Cleanup
      </button>
      <output
        data-pending={String(initialization.cloudInitializationPending)}
        data-loading={String(initialization.cloudInitializationLoading)}
        data-state-loading={String(initialization.cloudInitializationStateLoading)}
        data-error={initialization.cloudInitializationError?.code ?? ""}
        data-retryable={String(initialization.cloudInitializationError?.retryable ?? false)}
        data-project-state={initialization.cloudInitializationState?.project ?? ""}
        data-push={initialization.cloudInitializationState?.push ?? ""}
        data-cleanup={initialization.cloudInitializationState?.cleanup ?? ""}
        data-progress={initialization.cloudInitializationProgress?.stage ?? ""}
        data-project={initialization.cloudInitializationState?.projectId ?? ""}
        data-notice={initialization.cloudInitializationNotice ?? ""}
      />
    </>
  );
}

describe("durable PuppyOne Cloud initialization renderer flow", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    localFiles.getWorkspaceCloudInitializationState.mockResolvedValue(okResult(null));
    localFiles.getWorkspaceGitStatus.mockResolvedValue(initialStatus);
    localFiles.initializeWorkspaceGitRepository.mockResolvedValue(emptyRepositoryStatus);
    localFiles.stageAllWorkspaceGitChanges.mockResolvedValue(emptyRepositoryStatus);
    localFiles.commitWorkspaceGit.mockResolvedValue(initialStatus);
    localFiles.createWorkspaceGitBranch.mockResolvedValue(initialStatus);
    localFiles.startWorkspaceCloudInitialization.mockResolvedValue(okResult(completedState, publishedStatus));
    localFiles.subscribeWorkspaceCloudInitializationProgress.mockImplementation(() => () => {});
    localFiles.cleanupWorkspaceCloudInitialization.mockResolvedValue(okResult(null, initialStatus));
    actions.applyGitStatus.mockReturnValue(true);
    actions.captureGitRepositoryContext.mockReturnValue(repositoryContext);
    actions.isGitRepositoryContextCurrent.mockReturnValue(true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps signed-out initialization passive and owned by the auth state", async () => {
    await render(<InitializationHarness activeSession={null} />);
    expect(localFiles.getWorkspaceCloudInitializationState).not.toHaveBeenCalled();
    expect(localFiles.startWorkspaceCloudInitialization).not.toHaveBeenCalled();

    await click("start");
    expect(readOutput().dataset.pending).toBe("false");
    expect(readOutput().dataset.error).toBe("SESSION_REQUIRED");
    expect(localFiles.startWorkspaceCloudInitialization).not.toHaveBeenCalled();
  });

  it("starts from a named source branch without snapshotting dirty worktree state", async () => {
    await render(<InitializationHarness activeSession={session} />);
    await flushPromises();

    await click("start");
    await flushPromises();

    expect(localFiles.getWorkspaceGitStatus).toHaveBeenCalledOnce();
    expect(localFiles.startWorkspaceCloudInitialization).toHaveBeenCalledWith({
      rootPath: repositoryContext.rootPath,
      apiBaseUrl: session.api_base_url,
      userId: session.user_id,
      organizationId: "org-1",
      projectName: "Local Notes",
      sourceBranch: "main",
      operationId: null,
      action: "initialize",
    });
    expect(actions.applyGitStatus).toHaveBeenCalledWith(
      publishedStatus,
      repositoryContext,
      expect.objectContaining({ detail: "cloud-initialization", source: "mutation" }),
    );
    expect(actions.clearGitSelection).toHaveBeenCalledOnce();
    expect(actions.setActiveCloudSection).toHaveBeenCalledWith("contents");
    expect(actions.setActiveView).toHaveBeenCalledWith("cloud");
    expect(readOutput().dataset.push).toBe("");
    expect(readOutput().dataset.error).toBe("");
  });

  it("turns a local folder into one committed branch before starting the Cloud publish", async () => {
    localFiles.getWorkspaceGitStatus.mockResolvedValue(localFolderStatus);
    await render(<InitializationHarness activeSession={session} />);
    await flushPromises();

    await click("start");
    await flushPromises();

    expect(localFiles.initializeWorkspaceGitRepository).toHaveBeenCalledWith(repositoryContext.rootPath);
    expect(localFiles.stageAllWorkspaceGitChanges).toHaveBeenCalledWith(repositoryContext.rootPath);
    expect(localFiles.commitWorkspaceGit).toHaveBeenCalledWith(
      repositoryContext.rootPath,
      "Initial snapshot",
      {
        allowEmpty: true,
        authorName: session.user_email,
        authorEmail: session.user_email,
      },
    );
    expect(localFiles.startWorkspaceCloudInitialization).toHaveBeenCalledWith(
      expect.objectContaining({
        rootPath: repositoryContext.rootPath,
        sourceBranch: "main",
        action: "initialize",
      }),
    );
    expect(localFiles.initializeWorkspaceGitRepository.mock.invocationCallOrder[0])
      .toBeLessThan(localFiles.startWorkspaceCloudInitialization.mock.invocationCallOrder[0]);
    expect(localFiles.commitWorkspaceGit.mock.invocationCallOrder[0])
      .toBeLessThan(localFiles.startWorkspaceCloudInitialization.mock.invocationCallOrder[0]);
  });

  it("applies main-process progress while the durable operation is running", async () => {
    let finish!: (result: CloudInitializationResult) => void;
    localFiles.startWorkspaceCloudInitialization.mockReturnValue(new Promise((resolve) => {
      finish = resolve;
    }));
    await render(<InitializationHarness activeSession={session} />);
    await flushPromises();

    await click("start");
    expect(readOutput().dataset.progress).toBe("validating");
    const progressListener = localFiles.subscribeWorkspaceCloudInitializationProgress.mock.calls.at(-1)?.[0];
    expect(progressListener).toBeTypeOf("function");
    await act(async () => {
      progressListener?.({
        rootPath: repositoryContext.rootPath,
        operationId: uploadingState.operationId,
        stage: "uploading",
        state: uploadingState,
        updatedAt: "2026-07-17T00:00:00.000Z",
      });
      await Promise.resolve();
    });

    expect(readOutput().dataset.progress).toBe("uploading");
    expect(readOutput().dataset.push).toBe("uploading");

    finish(okResult(completedState, publishedStatus));
    await flushPromises();
    expect(readOutput().dataset.progress).toBe("");
  });

  it("retries the exact durable Project and selected source branch after a branch switch", async () => {
    localFiles.getWorkspaceCloudInitializationState.mockResolvedValue(okResult(interruptedState));
    await render(<InitializationHarness activeSession={session} />);
    await flushPromises();

    expect(readOutput().dataset.projectState).toBe("empty");
    expect(readOutput().dataset.push).toBe("failed");
    expect(readOutput().dataset.project).toBe("project-1");

    await click("retry");
    await flushPromises();

    expect(localFiles.getWorkspaceGitStatus).not.toHaveBeenCalled();
    expect(localFiles.startWorkspaceCloudInitialization).toHaveBeenCalledWith({
      rootPath: repositoryContext.rootPath,
      apiBaseUrl: session.api_base_url,
      userId: session.user_id,
      organizationId: interruptedState.organizationId,
      projectName: interruptedState.projectName,
      sourceBranch: interruptedState.selectedSourceBranch,
      operationId: interruptedState.operationId,
      action: "retry-push",
    });
  });

  it("uses the checked-out branch only after the user chooses it for a missing source", async () => {
    const sourceMissing = createInitializationState({
      project: "empty",
      push: "failed",
      local: "source-missing",
      projectId: "project-1",
      selectedSourceBranch: "deleted-branch",
      selectedSourceRef: "refs/heads/deleted-branch",
      latestSourceCommitOid: null,
      currentBranch: "main",
      availableActions: ["choose-source", "delete-empty-project"],
    });
    localFiles.getWorkspaceCloudInitializationState.mockResolvedValue(okResult(sourceMissing));
    await render(<InitializationHarness activeSession={session} />);
    await flushPromises();

    await click("retry");
    await flushPromises();

    expect(localFiles.getWorkspaceGitStatus).toHaveBeenCalledOnce();
    expect(localFiles.startWorkspaceCloudInitialization).toHaveBeenCalledWith({
      rootPath: repositoryContext.rootPath,
      apiBaseUrl: session.api_base_url,
      userId: session.user_id,
      organizationId: sourceMissing.organizationId,
      projectName: sourceMissing.projectName,
      sourceBranch: "main",
      operationId: sourceMissing.operationId,
      action: "choose-source",
    });
  });

  it("keeps typed coordinator failure state for an explicit retry", async () => {
    const failedState = createInitializationState({
      project: "empty",
      push: "failed",
      projectId: "project-1",
      availableActions: ["retry-push", "delete-empty-project"],
    });
    localFiles.startWorkspaceCloudInitialization.mockResolvedValue({
      ok: false,
      state: failedState,
      error: { code: "REMOTE_CONFIG_FAILED", retryable: true, message: "private diagnostic" },
    } satisfies CloudInitializationResult);
    await render(<InitializationHarness activeSession={session} />);
    await flushPromises();

    await click("start");
    await flushPromises();

    expect(readOutput().dataset.projectState).toBe("empty");
    expect(readOutput().dataset.push).toBe("failed");
    expect(readOutput().dataset.error).toBe("REMOTE_CONFIG_FAILED");
    expect(readOutput().dataset.retryable).toBe("true");
    expect(container.textContent).not.toContain("private diagnostic");
  });

  it("finishes cleanup for the exact durable operation", async () => {
    localFiles.getWorkspaceCloudInitializationState.mockResolvedValue(okResult(interruptedState));
    await render(<InitializationHarness activeSession={session} />);
    await flushPromises();

    await click("cleanup");
    await flushPromises();

    expect(localFiles.cleanupWorkspaceCloudInitialization).toHaveBeenCalledWith({
      rootPath: repositoryContext.rootPath,
      apiBaseUrl: session.api_base_url,
      userId: session.user_id,
      operationId: interruptedState.operationId,
    });
    expect(actions.applyGitStatus).toHaveBeenCalledWith(
      initialStatus,
      repositoryContext,
      expect.objectContaining({ detail: "cloud-initialization", source: "mutation" }),
    );
    expect(actions.setActiveCloudSection).toHaveBeenCalledWith("initialize");
    expect(readOutput().dataset.projectState).toBe("");
    expect(readOutput().dataset.notice).toBe("cleanup-completed");
  });

  it("clears the signed-out body error when an authenticated identity arrives", async () => {
    await render(<InitializationHarness activeSession={null} />);
    await click("start");
    expect(readOutput().dataset.error).toBe("SESSION_REQUIRED");

    await render(<InitializationHarness activeSession={session} />);
    await flushPromises();

    expect(readOutput().dataset.pending).toBe("false");
    expect(readOutput().dataset.error).toBe("");
    expect(localFiles.getWorkspaceCloudInitializationState).toHaveBeenCalledWith({
      rootPath: repositoryContext.rootPath,
      apiBaseUrl: session.api_base_url,
      userId: session.user_id,
    });
  });

  async function render(element: React.ReactNode) {
    await act(async () => {
      root.render(element);
      await Promise.resolve();
    });
  }

  async function click(action: "start" | "retry" | "cleanup") {
    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.click();
      await Promise.resolve();
    });
  }

  async function flushPromises() {
    for (let index = 0; index < 6; index += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  function readOutput() {
    const output = container.querySelector<HTMLOutputElement>("output");
    if (!output) throw new Error("Initialization state output was not rendered.");
    return output;
  }
});

function createInitializationState(
  overrides: Partial<CloudInitializationState>,
): CloudInitializationState {
  return {
    operationId: "11111111-1111-4111-8111-111111111111",
    session: "signed-in",
    project: "absent",
    push: "preparing",
    local: "clean",
    cleanup: "none",
    projectId: null,
    projectName: "Local Notes",
    organizationId: "org-1",
    selectedSourceBranch: "main",
    selectedSourceRef: "refs/heads/main",
    latestSourceCommitOid: "head-before-publish",
    attemptId: "22222222-2222-4222-8222-222222222222",
    attemptCommitOid: "head-before-publish",
    attemptCount: 1,
    destinationBranch: "main",
    hasUncommittedChanges: false,
    currentBranch: "main",
    lastError: null,
    availableActions: ["retry-push"],
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:01.000Z",
    ...overrides,
  };
}

function okResult(
  state: CloudInitializationState | null,
  gitStatus?: GitStatusSnapshot,
): Extract<CloudInitializationResult, { ok: true }> {
  return { ok: true, state, ...(gitStatus ? { gitStatus } : {}) };
}

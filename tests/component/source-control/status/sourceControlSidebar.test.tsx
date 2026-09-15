/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitSidebar } from "../../../../src/features/source-control/SourceControlSidebar";
import type { GitSourceControlResource, GitStatusSnapshot } from "../../../../src/types/electron";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
});

describe("Git sidebar status groups", () => {
  it("reduces an uninitialized repository to one centered enable action", async () => {
    const status = createGitStatus();
    status.isRepo = false;
    const onInitialize = vi.fn(async () => true);
    const surface = renderSidebar({ onInitialize, status });

    expect(surface.textContent).not.toContain("No repository");
    expect(surface.textContent).toContain("Version history isn’t enabled yet");
    const buttons = surface.querySelectorAll<HTMLButtonElement>("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe("Enable Version Control");
    expect(buttons[0]?.classList.contains("desktop-version-control-enable-button")).toBe(true);
    expect(surface.querySelector(".desktop-git-sidebar-list")?.getAttribute("data-repository-setup"))
      .toBe("true");

    await act(async () => buttons[0]?.click());
    expect(onInitialize).toHaveBeenCalledOnce();
  });

  it("restores the established section-level commit workflow inside Changes", async () => {
    const onCommit = vi.fn(async () => true);
    const onPush = vi.fn(async () => true);
    const onStageAndCommit = vi.fn(async () => true);
    const surface = renderSidebar({ onCommit, onPush, onStageAndCommit });

    expect(surface.querySelector(".desktop-git-status-card")).toBeNull();
    expect(surface.querySelectorAll(".desktop-git-local-section-body.expanded")).toHaveLength(3);
    expect(surface.textContent).toContain("Committed");
    const localCounts = Array.from(surface.querySelectorAll(".desktop-git-section-title small"))
      .map((node) => node.textContent);
    expect(localCounts).toEqual(expect.arrayContaining(["2", "1", "1"]));

    const commitButton = surface.querySelector<HTMLButtonElement>(".desktop-git-commit-staged-action");
    const stageAndCommitButton = surface.querySelector<HTMLButtonElement>(".desktop-git-stage-commit-action");
    const pushButton = surface.querySelector<HTMLButtonElement>('button[aria-label="Push"]');
    const panelOrder = Array.from(surface.querySelectorAll<HTMLElement>(".desktop-git-resizable-section"))
      .map((section) => section.className.match(/desktop-git-resizable-section-(committed|staged|unstaged)/)?.[1])
      .filter(Boolean);

    expect(panelOrder).toEqual(["committed", "staged", "unstaged"]);
    expect(surface.querySelectorAll(".desktop-git-section-resizer")).toHaveLength(2);
    expect(commitButton?.closest(".desktop-git-resizable-section-staged")).not.toBeNull();
    expect(commitButton?.closest(".desktop-git-section-row")).not.toBeNull();
    expect(commitButton?.querySelector(".lucide-plus")).not.toBeNull();
    expect(commitButton?.querySelector(".desktop-git-operation-label")?.textContent).toBe("Commit");
    expect(stageAndCommitButton?.closest(".desktop-git-resizable-section-unstaged")).not.toBeNull();
    expect(stageAndCommitButton?.querySelector(".desktop-git-operation-label")?.textContent)
      .toBe("Stage and Commit");
    expect(surface.querySelector(".desktop-git-commit-composer")).toBeNull();
    expect(pushButton?.closest(".desktop-git-section-row")).not.toBeNull();

    await act(async () => {
      commitButton?.click();
      stageAndCommitButton?.click();
      pushButton?.click();
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onStageAndCommit).toHaveBeenCalledTimes(1);
    expect(onPush).toHaveBeenCalledTimes(1);
  });

  it("keeps every local group on the same collapsible flat-section contract", () => {
    const surface = renderSidebar();
    const committedSection = surface.querySelector<HTMLElement>(".desktop-git-resizable-section-committed");
    const stagedSection = surface.querySelector<HTMLElement>(".desktop-git-resizable-section-staged");
    const committedToggle = Array.from(surface.querySelectorAll<HTMLButtonElement>(".desktop-git-section-title"))
      .find((button) => button.textContent?.includes("Committed"));
    const stagedToggle = Array.from(surface.querySelectorAll<HTMLButtonElement>(".desktop-git-section-title"))
      .find((button) => button.textContent?.includes("Staged"));

    expect(committedSection?.classList.contains("expanded")).toBe(true);
    expect(committedSection?.querySelector(".desktop-git-status-card")).toBeNull();
    expect(committedSection?.querySelector(".desktop-git-local-section-body")?.classList.contains("expanded"))
      .toBe(true);
    expect(committedToggle?.querySelector("small")?.textContent).toBe("2");
    expect(committedToggle?.getAttribute("aria-expanded")).toBe("true");
    expect(stagedToggle?.getAttribute("aria-expanded")).toBe("true");

    act(() => stagedToggle?.click());

    expect(committedSection?.classList.contains("expanded")).toBe(true);
    expect(committedToggle?.getAttribute("aria-expanded")).toBe("true");
    expect(stagedSection?.classList.contains("collapsed")).toBe(true);
    expect(stagedToggle?.getAttribute("aria-expanded")).toBe("false");
    expect(surface.querySelector(".desktop-git-resizable-section-unstaged")?.classList.contains("expanded")).toBe(true);
  });

  it("hides Staged Changes until files are actually staged", () => {
    const status = createGitStatus();
    status.sourceControl.groups = status.sourceControl.groups.filter((group) => group.id !== "index");
    status.sourceControl.actions.canCommit = false;
    const surface = renderSidebar({ gitDisplayMode: "simple", status });

    expect(surface.textContent).toContain("Unstaged");
    const unstagedToggle = Array.from(surface.querySelectorAll<HTMLButtonElement>(".desktop-git-section-title"))
      .find((button) => button.textContent?.includes("Unstaged"));
    expect(unstagedToggle?.querySelector("small")?.textContent).toBe("1");
    const commit = surface.querySelector<HTMLButtonElement>(".desktop-git-commit-staged-action");
    const stageAndCommit = surface.querySelector<HTMLButtonElement>(".desktop-git-stage-commit-action");
    expect(surface.querySelector(".desktop-git-resizable-section-staged")).toBeNull();
    expect(commit).toBeNull();
    expect(stageAndCommit?.closest(".desktop-git-resizable-section-unstaged")).not.toBeNull();
  });

  it("keeps local groups flat without rendering a remote provider surface", () => {
    const surface = renderSidebar({
      gitSidebarLayout: "dividers",
      status: createDivergedGitHubStatus(),
    });
    const committedSection = surface.querySelector<HTMLElement>(".desktop-git-resizable-section-committed");

    expect(surface.querySelector(".desktop-git-github-provider-section")).toBeNull();
    expect(surface.querySelector(".desktop-git-github-change-card")).toBeNull();
    expect(surface.querySelector(".desktop-git-incoming-notice")).not.toBeNull();
    expect(surface.querySelector('button[aria-label="Pull"]')).not.toBeNull();
    const committedToggle = committedSection?.querySelector<HTMLButtonElement>(
      ".desktop-git-section-row .desktop-git-section-title",
    );
    expect(committedToggle?.querySelector("span")?.textContent).toBe("Committed");
    expect(committedToggle?.querySelector(".po-disclosure-icon")).not.toBeNull();
    expect(committedToggle?.querySelectorAll("svg")).toHaveLength(1);
    expect(committedToggle?.getAttribute("aria-expanded")).toBe("true");
    expect(committedToggle?.querySelector("small")?.textContent).toBe("1");
    expect(committedSection?.querySelector(".desktop-git-status-card")).toBeNull();
    expect(committedSection?.querySelector('.desktop-git-section-row button[aria-label="Push"]')).not.toBeNull();

    act(() => committedToggle?.click());

    expect(committedToggle?.getAttribute("aria-expanded")).toBe("false");
    expect(committedSection?.classList.contains("collapsed")).toBe(true);
  });

  it("keeps low-frequency History out of the changes sidebar", () => {
    const surface = renderSidebar();

    expect(surface.querySelector(".desktop-git-history-pane")).toBeNull();
    expect(surface.querySelector(".desktop-git-history-resizer")).toBeNull();
    expect(surface.querySelector(".desktop-history-row")).toBeNull();
  });

  it("keeps stash and destructive cleanup in a restrained secondary menu", async () => {
    const onStash = vi.fn(async () => true);
    const onDiscardAll = vi.fn(async () => true);
    const surface = renderSidebar({ onDiscardAll, onStash });
    const menu = surface.querySelector<HTMLDetailsElement>(".desktop-git-more-actions");
    const stash = Array.from(menu?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent === "Stash changes");
    const discard = Array.from(menu?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent === "Discard all");

    expect(menu?.querySelector("summary")?.getAttribute("aria-label")).toBe("More Git actions");
    expect(stash).not.toBeNull();
    expect(discard?.classList.contains("danger")).toBe(true);

    await act(async () => stash?.click());
    expect(onStash).toHaveBeenCalledOnce();
  });

  it("presents incoming commits with the established compact sidebar notice", async () => {
    const onPull = vi.fn(async () => true);
    const status = createGitStatus();
    status.branches[0] = {
      ...status.branches[0],
      ahead: 0,
      behind: 4,
    };
    status.sourceControl.remote = {
      ...status.sourceControl.remote,
      ahead: 0,
      behind: 4,
      canPull: true,
      state: "incoming",
    };
    status.sourceControl.groups = [];
    status.sourceControl.actions.canCommit = false;
    const surface = renderSidebar({ onPull, status });
    const notice = surface.querySelector<HTMLElement>(".desktop-git-incoming-notice");
    const pull = notice?.querySelector<HTMLButtonElement>(
      ".desktop-git-incoming-notice-pull",
    );

    expect(notice?.querySelector(".desktop-git-incoming-notice-summary")?.textContent)
      .toBe("4 commits");
    expect(pull?.getAttribute("aria-label")).toBe("Pull");
    expect(pull?.classList.contains("is-primary")).toBe(true);
    expect(notice?.parentElement?.classList.contains("desktop-git-sync-priority-region"))
      .toBe(true);
    expect(notice?.parentElement?.nextElementSibling?.classList.contains("desktop-git-resizable-stack"))
      .toBe(true);

    await act(async () => pull?.click());
    expect(onPull).toHaveBeenCalledOnce();
  });

  it("renders one quiet Changes section when the working tree is clean", () => {
    const status = createGitStatus();
    status.entries = [];
    status.stagedEntries = [];
    status.unstagedEntries = [];
    status.untrackedEntries = [];
    status.sourceControl.groups = [];
    status.sourceControl.actions.canCommit = false;
    status.sourceControl.remote = {
      ...status.sourceControl.remote,
      ahead: 0,
      outgoingPreview: [],
      canPush: false,
      canSync: false,
      state: "synced",
    };
    status.syncTarget = status.syncTarget ? {
      ...status.syncTarget,
      ahead: 0,
      outgoingPreview: [],
    } : null;
    status.branches = status.branches.map((branch) => ({ ...branch, ahead: 0 }));

    const surface = renderSidebar({ status });
    const commitButton = surface.querySelector<HTMLButtonElement>(".desktop-git-commit-staged-action");
    const cleanSection = surface.querySelector<HTMLElement>(".desktop-git-resizable-section-changes");
    const cleanToggle = cleanSection?.querySelector<HTMLButtonElement>(".desktop-git-section-title");

    expect(surface.querySelector(".desktop-git-resizable-section-staged")).toBeNull();
    expect(surface.querySelector(".desktop-git-resizable-section-unstaged")).toBeNull();
    expect(cleanToggle?.querySelector("span")?.textContent).toBe("Changes");
    expect(cleanToggle?.querySelector("small")).toBeNull();
    expect(cleanSection?.textContent).toContain("No local changes");
    expect(commitButton).toBeNull();
    expect(surface.textContent).not.toContain("Clean working tree");

    act(() => cleanToggle?.click());

    expect(cleanSection?.classList.contains("collapsed")).toBe(true);
    expect(cleanToggle?.getAttribute("aria-expanded")).toBe("false");
  });

  it.each([
    "generic-git",
    "puppyone-cloud",
    "github",
  ] as const)("omits the %s remote region from the Git sidebar", (kind) => {
    const status = createDivergedGitHubStatus();
    status.effectiveHosting = {
      ...status.effectiveHosting,
      kind,
      identity: kind === "github" ? status.effectiveHosting.identity : null,
    };
    const surface = renderSidebar({ status });

    expect(surface.textContent).not.toContain("remote.md");
    expect(surface.querySelector(".desktop-git-resizable-section-remote")).toBeNull();
    expect(surface.querySelector(".desktop-git-cloud-provider-section")).toBeNull();
    expect(surface.querySelector(".desktop-git-github-provider-section")).toBeNull();
    expect(surface.querySelector(".desktop-git-incoming-notice")).not.toBeNull();
    expect(surface.querySelector('button[aria-label="Pull"]')).not.toBeNull();
    expect(surface.querySelector('button[aria-label="Download"]')).toBeNull();
  });

  it("renders merge conflicts through the same default-expanded flat contract", () => {
    const status = createGitStatus();
    status.sourceControl.groups.unshift({
      id: "merge",
      label: "Merge Changes",
      resources: [resource("merge", "conflicted.md", "conflict", "!")],
    });
    status.sourceControl.actions.canCommit = false;
    const surface = renderSidebar({ status });
    const mergeSection = surface.querySelector<HTMLElement>(".desktop-git-resizable-section-merge");

    expect(mergeSection?.textContent).toContain("Merge Changes");
    expect(mergeSection?.querySelector(".desktop-git-section-title small")?.textContent).toBe("1");
    expect(mergeSection?.querySelector(".desktop-git-status-card")).toBeNull();
    expect(mergeSection?.querySelector(".desktop-git-local-section-body")?.classList.contains("expanded")).toBe(true);
  });

  it("makes the compact Pull notice actionable and blocks Push while the branch is diverged", async () => {
    const onPull = vi.fn(async () => true);
    const onPush = vi.fn(async () => true);
    const status = createDivergedGitHubStatus();
    const surface = renderSidebar({ onPull, onPush, status });
    const pullButton = surface.querySelector<HTMLButtonElement>('button[aria-label="Pull"]');
    const pushButton = surface.querySelector<HTMLButtonElement>('button[aria-label="Push"]');

    expect(pullButton?.disabled).toBe(false);
    expect(pullButton?.classList.contains("is-primary")).toBe(true);
    expect(pushButton?.disabled).toBe(true);
    expect(pushButton?.classList.contains("is-primary")).toBe(false);

    await act(async () => {
      pullButton?.click();
      pushButton?.click();
    });

    expect(onPull).toHaveBeenCalledOnce();
    expect(onPush).not.toHaveBeenCalled();
  });

  it("keeps Pull as a visible CTA when incoming commits and staged files exist together", () => {
    const status = createDivergedGitHubStatus();
    status.sourceControl.groups = [{
      id: "index",
      label: "Staged Changes",
      resources: [resource("index", "staged.md", "modified", "M")],
    }];
    status.sourceControl.actions.canCommit = true;
    const surface = renderSidebar({ status });
    const pullButton = surface.querySelector<HTMLButtonElement>('button[aria-label="Pull"]');
    const commitButton = surface.querySelector<HTMLButtonElement>(".desktop-git-commit-staged-action");

    expect(pullButton?.disabled).toBe(false);
    expect(pullButton?.classList.contains("is-primary")).toBe(true);
    expect(commitButton?.disabled).toBe(false);
    expect(commitButton?.classList.contains("is-primary")).toBe(false);
  });

  it("blocks sync actions until working-tree conflicts are resolved", async () => {
    const onPush = vi.fn(async () => true);
    const status = createGitStatus();
    status.sourceControl.groups.unshift({
      id: "merge",
      label: "Merge Changes",
      resources: [resource("merge", "conflicted.md", "conflict", "!")],
    });
    status.sourceControl.actions.canCommit = false;
    const surface = renderSidebar({ onPush, status });
    const pushButton = surface.querySelector<HTMLButtonElement>('button[aria-label="Push"]');

    expect(pushButton?.disabled).toBe(true);
    expect(pushButton?.classList.contains("is-primary")).toBe(false);
    await act(async () => pushButton?.click());
    expect(onPush).not.toHaveBeenCalled();
  });

  it("makes Continue the only primary action after rebase conflicts are staged", async () => {
    const onContinue = vi.fn(async () => true);
    const onPush = vi.fn(async () => true);
    const status = createGitStatus();
    status.sourceControl.operation = { kind: "rebase", canContinue: true, canAbort: true };
    status.sourceControl.actions.canCommit = false;
    const surface = renderSidebar({ onContinue, onPush, status });
    const continueButton = surface.querySelector<HTMLButtonElement>('button[aria-label="Continue"]');
    const abortButton = surface.querySelector<HTMLButtonElement>('button[aria-label="Abort"]');
    const pushButton = surface.querySelector<HTMLButtonElement>('button[aria-label="Push"]');

    expect(surface.textContent).toContain("Git Operation");
    expect(continueButton?.disabled).toBe(false);
    expect(continueButton?.classList.contains("is-primary")).toBe(true);
    expect(abortButton?.disabled).toBe(false);
    expect(pushButton?.disabled).toBe(true);
    expect(pushButton?.classList.contains("is-primary")).toBe(false);

    await act(async () => continueButton?.click());
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onPush).not.toHaveBeenCalled();
  });
});

function renderSidebar(options: Partial<{
  gitDisplayMode: "simple" | "professional";
  gitSidebarLayout: "cards" | "dividers";
  onCommit: (message?: string) => Promise<boolean>;
  onContinue: () => Promise<boolean>;
  onDiscardAll: () => Promise<boolean>;
  onInitialize: () => Promise<boolean>;
  onPull: () => Promise<boolean>;
  onPush: () => Promise<boolean>;
  onStageAll: () => Promise<boolean>;
  onStageAndCommit: (message?: string) => Promise<boolean>;
  onStash: () => Promise<boolean>;
  status: GitStatusSnapshot;
}> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const succeed = async () => true;

  act(() => root.render(withTestLocalization(
    <GitSidebar
      repository={{
        status: options.status ?? createGitStatus(),
        puppyoneConfig: null,
        gitDisplayMode: options.gitDisplayMode ?? "professional",
        gitSidebarLayout: options.gitSidebarLayout ?? "cards",
        fileIconTheme: "default",
      }}
      view={{
        selectedWorkingFile: null,
        operationLoading: null,
        operationError: null,
        loading: false,
        error: null,
      }}
      actions={{
        initialize: options.onInitialize ?? succeed,
        selectWorkingFile: vi.fn(),
        stagePaths: succeed,
        stageAll: options.onStageAll ?? succeed,
        unstagePaths: succeed,
        discardPaths: succeed,
        discardAll: options.onDiscardAll ?? succeed,
        stageAndCommit: options.onStageAndCommit ?? succeed,
        stash: options.onStash ?? succeed,
        commit: options.onCommit ?? succeed,
        commitAndPush: succeed,
        continueOperation: options.onContinue ?? succeed,
        abortOperation: succeed,
        pull: options.onPull ?? succeed,
        push: options.onPush ?? succeed,
        publish: succeed,
      }}
      cloudBackup={{ loading: false, error: null, enabled: false, start: vi.fn() }}
    />,
  )));
  return container;
}

function createGitStatus(): GitStatusSnapshot {
  const staged = resource("index", "staged.md", "added", "A");
  const unstaged = resource("workingTree", "working.md", "modified", "M");
  const committed = resource("workingTree", "committed.md", "modified", "M");
  const target = {
    remote: "origin",
    branch: "main",
    ref: "origin/main",
    exists: true,
    ahead: 2,
    behind: 0,
    incomingPreview: [],
    outgoingPreview: [committed],
  } satisfies NonNullable<GitStatusSnapshot["syncTarget"]>;

  return {
    isRepo: true,
    branch: "main",
    headCommitId: "head",
    totalCommits: 8,
    entries: [],
    stagedEntries: [],
    unstagedEntries: [],
    untrackedEntries: [],
    branches: [{
      name: "main",
      current: true,
      remote: false,
      upstream: "origin/main",
      ahead: 2,
      behind: 0,
      lastCommitId: "head",
      lastCommitMessage: "Test commit",
      lastCommitDate: "2026-08-22T08:00:00.000Z",
    }],
    remotes: [{ name: "origin", fetchUrl: "https://example.com/repo.git", pushUrl: "https://example.com/repo.git", branches: ["main"] }],
    syncTarget: target,
    effectiveHosting: {
      kind: "generic-git",
      remoteName: "origin",
      branchName: "main",
      ref: "origin/main",
      ready: true,
      reason: "remote-detected",
      identity: null,
    },
    sourceControl: {
      input: { placeholder: "", defaultMessage: "" },
      groups: [
        { id: "index", label: "Staged Changes", resources: [staged] },
        { id: "workingTree", label: "Changes", resources: [unstaged] },
      ],
      remote: {
        target,
        currentBranch: "main",
        upstream: "origin/main",
        ahead: 2,
        behind: 0,
        incomingPreview: [],
        outgoingPreview: [committed],
        canPull: false,
        canPush: true,
        canSync: true,
        canPublish: false,
        state: "outgoing",
      },
      actions: {
        canStageAll: true,
        canUnstageAll: true,
        canDiscardAll: true,
        canCommit: true,
      },
    },
    commits: [],
    allCommits: [],
    statusLimit: 10_000,
    didHitStatusLimit: false,
  };
}

function createDivergedGitHubStatus(): GitStatusSnapshot {
  const status = createGitStatus();
  const incoming = resource("workingTree", "remote.md", "added", "A");
  const outgoing = resource("workingTree", "committed.md", "modified", "M");
  const target = {
    remote: "origin",
    branch: "main",
    ref: "origin/main",
    exists: true,
    ahead: 1,
    behind: 1,
    incomingPreview: [incoming],
    outgoingPreview: [outgoing],
  } satisfies NonNullable<GitStatusSnapshot["syncTarget"]>;

  status.syncTarget = target;
  status.effectiveHosting = {
    kind: "github",
    remoteName: "origin",
    branchName: "main",
    ref: "origin/main",
    ready: true,
    reason: "remote-detected",
    identity: {
      provider: "github",
      label: "puppyone-ai/X-influencer",
      href: "https://github.com/puppyone-ai/X-influencer",
    },
  };
  status.branches = [
    {
      ...status.branches[0],
      ahead: 1,
      behind: 1,
    },
    {
      name: "origin/main",
      current: false,
      remote: true,
      upstream: null,
      ahead: 0,
      behind: 0,
      lastCommitId: "remote-head",
      lastCommitMessage: "Remote update",
      lastCommitDate: "2026-08-20T08:00:00.000Z",
    },
  ];
  status.sourceControl.groups = [];
  status.sourceControl.remote = {
    ...status.sourceControl.remote,
    target,
    ahead: 1,
    behind: 1,
    incomingFileSummary: {
      total: 1,
      added: 1,
      modified: 0,
      deleted: 0,
      renamed: 0,
      copied: 0,
      changed: 0,
    },
    incomingPreview: [incoming],
    outgoingPreview: [outgoing],
    canPull: true,
    canPush: true,
    canSync: true,
    canPublish: false,
    state: "diverged",
  };
  return status;
}

function resource(
  group: GitSourceControlResource["group"],
  path: string,
  status: GitSourceControlResource["status"],
  letter: string,
): GitSourceControlResource {
  return {
    id: `${group}:${path}`,
    group,
    path,
    oldPath: null,
    status,
    staged: group === "index",
    conflict: false,
    letter,
  };
}

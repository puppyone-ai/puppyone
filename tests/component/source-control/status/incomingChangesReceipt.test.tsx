/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitSidebar } from "../../../../src/features/source-control/SourceControlSidebar";
import { INCOMING_REVIEW_STORAGE_KEY } from "../../../../src/features/changes";
import {
  desktopPreferencesStore as store,
  initializeDesktopPreferences,
} from "../../../../src/preferencesStore";
import type {
  GitBranchSummary,
  GitSourceControlResource,
  GitStatusSnapshot,
  GitWorkingDiffScope,
} from "../../../../src/types/electron";
import { withTestLocalization } from "../../../support/react/localization";
import { gitResource, gitStatus } from "../../../support/source-control/gitFixtures";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

beforeEach(() => {
  localStorage.clear();
  initializeDesktopPreferences();
});

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
});

function enableProjectReach() {
  act(() => store.getState().setExperimentalSettings({
    ...store.getState().experimentalSettings,
    enableProjectReach: true,
  }));
}

describe("changes made elsewhere arrive as a receipt", () => {
  it("states who changed how much, promises the files are untouched, and lists the scope", async () => {
    enableProjectReach();
    const onPull = vi.fn(async () => true);
    const onSelect = vi.fn();
    const surface = renderSidebar({ onPull, onSelect, status: incomingStatus() });
    const receipt = surface.querySelector<HTMLElement>(".desktop-incoming-changes");

    expect(receipt?.getAttribute("role")).toBe("status");
    expect(receipt?.getAttribute("aria-live")).toBe("polite");
    expect(receipt?.getAttribute("aria-label")).toBe("Changes made elsewhere");
    expect(receipt?.querySelector(".desktop-incoming-changes-summary")?.textContent)
      .toBe("Dana Rivera made 4 changes");
    expect(receipt?.querySelector(".desktop-incoming-changes-promise")?.textContent)
      .toBe("Nothing on this Mac has changed yet.");
    expect(receipt?.querySelector("time")?.getAttribute("dateTime")).toBe("2026-10-12T09:30:00.000Z");
    expect(receipt?.querySelector("time")?.textContent).toBeTruthy();
    expect(fileRows(surface)).toEqual(["Mdocs/intro.md", "Asrc/app.ts"]);
    expect(receipt?.querySelector(".desktop-incoming-changes-more")?.textContent).toBe("2 more files");
    expect(receipt?.closest(".desktop-git-sync-priority-region")).not.toBeNull();
    expect(surface.querySelector(".desktop-git-incoming-notice")).toBeNull();

    await act(async () => applyButton(surface)?.click());
    expect(onPull).toHaveBeenCalledOnce();

    act(() => surface.querySelector<HTMLButtonElement>(".desktop-incoming-changes-file")?.click());
    expect(onSelect).toHaveBeenCalledWith({
      path: "docs/intro.md",
      status: "modified",
      letter: "M",
      staged: false,
      origin: "remote" satisfies GitWorkingDiffScope,
    });
  });

  it("says nothing at all when no changes were made elsewhere", () => {
    enableProjectReach();
    const surface = renderSidebar({ status: gitStatus({ branches: [] }) });

    expect(surface.querySelector(".desktop-incoming-changes")).toBeNull();
    expect(surface.querySelector(".desktop-git-sync-priority-region")).toBeNull();
    expect(surface.querySelector(".desktop-git-incoming-notice")).toBeNull();
  });

  it("keeps the receipt and admits the outcome when applying does not finish", async () => {
    enableProjectReach();
    const onPull = vi.fn(async () => false);
    const surface = renderSidebar({ onPull, status: incomingStatus() });

    await act(async () => applyButton(surface)?.click());

    expect(surface.querySelector(".desktop-incoming-changes-failure")?.textContent)
      .toBe("Applying did not finish. Try again, or review the files above.");
    expect(surface.querySelector(".desktop-incoming-changes-summary")?.textContent)
      .toBe("Dana Rivera made 4 changes");
    expect(applyButton(surface)?.disabled).toBe(false);

    await act(async () => applyButton(surface)?.click());
    expect(onPull).toHaveBeenCalledTimes(2);
  });

  it("stops offering to apply while files need a decision, and keeps resolution in the Git view", async () => {
    enableProjectReach();
    const onPull = vi.fn(async () => true);
    const status = incomingStatus();
    status.sourceControl.groups = [{
      id: "merge",
      label: "Merge Changes",
      resources: [{ ...gitResource("docs/intro.md"), group: "merge", conflict: true }],
    }];
    const surface = renderSidebar({ onPull, status });

    expect(surface.querySelector(".desktop-incoming-changes")?.getAttribute("data-blocked")).toBe("true");
    expect(surface.querySelector(".desktop-incoming-changes-decision")?.textContent)
      .toBe(
        "Some files need your decision before these changes can land."
        + " Settle them in the Changes list below, then continue.",
      );
    expect(applyButton(surface)?.disabled).toBe(true);
    // The disabled action still explains itself, without a browser-native title bubble.
    expect(applyButton(surface)?.getAttribute("aria-description"))
      .toBe("Settle the files that need a decision first.");
    expect(surface.querySelector(".desktop-git-resizable-section-merge")?.textContent)
      .toContain("Merge Changes");

    await act(async () => applyButton(surface)?.click());
    expect(onPull).not.toHaveBeenCalled();
  });

  it("mentions the user's own saved work instead of folding it into the count", () => {
    enableProjectReach();
    const status = incomingStatus();
    status.sourceControl.remote = { ...status.sourceControl.remote, ahead: 2, state: "diverged" };
    const surface = renderSidebar({ status });

    expect(surface.querySelector(".desktop-incoming-changes-local")?.textContent)
      .toBe("Your own saved work stays as it is.");
    expect(surface.querySelector(".desktop-incoming-changes-summary")?.textContent)
      .toBe("Dana Rivera made 4 changes");
  });
});

describe("setting a receipt aside is a decision, not a deletion", () => {
  it("survives a restart and can be restored without touching the changes", () => {
    enableProjectReach();
    const status = incomingStatus();
    const surface = renderSidebar({ status });

    act(() => surface.querySelector<HTMLButtonElement>(".desktop-incoming-changes-set-aside")?.click());

    expect(surface.querySelector(".desktop-incoming-changes-summary")?.textContent)
      .toBe("4 changes made elsewhere are set aside.");
    expect(surface.querySelector(".desktop-incoming-changes-apply")).toBeNull();
    expect(JSON.parse(localStorage.getItem(INCOMING_REVIEW_STORAGE_KEY) ?? "[]"))
      .toEqual([{ id: "origin/main@9f1c2ab", at: expect.any(String) }]);

    // A second window, and a later launch, read the same local ledger.
    const relaunched = renderSidebar({ status });
    expect(relaunched.querySelector(".desktop-incoming-changes-apply")).toBeNull();
    expect(relaunched.querySelector(".desktop-incoming-changes-restore")?.textContent)
      .toBe("Review again");

    act(() => relaunched.querySelector<HTMLButtonElement>(".desktop-incoming-changes-restore")?.click());

    expect(relaunched.querySelector(".desktop-incoming-changes-summary")?.textContent)
      .toBe("Dana Rivera made 4 changes");
    expect(JSON.parse(localStorage.getItem(INCOMING_REVIEW_STORAGE_KEY) ?? "[]")).toEqual([]);
  });

  it("asks again when the other side changes something new", () => {
    enableProjectReach();
    const surface = renderSidebar({ status: incomingStatus() });

    act(() => surface.querySelector<HTMLButtonElement>(".desktop-incoming-changes-set-aside")?.click());
    expect(surface.querySelector(".desktop-incoming-changes-apply")).toBeNull();

    const later = renderSidebar({ status: incomingStatus({ lastCommitId: "ab77e01" }) });
    expect(later.querySelector(".desktop-incoming-changes-apply")).not.toBeNull();
  });
});

describe("the Git view keeps its primitives and loses the system wording", () => {
  it("describes sending saved work by its consequence", () => {
    enableProjectReach();
    const status = incomingStatus();
    status.sourceControl.remote = {
      ...status.sourceControl.remote,
      behind: 0,
      ahead: 2,
      state: "outgoing",
      canPull: false,
      canPush: true,
      outgoingPreview: [gitResource("src/app.ts")],
    };
    status.branches = [localBranch({ ahead: 2 }), remoteTip()];
    const surface = renderSidebar({ status });
    const send = surface.querySelector<HTMLButtonElement>(".desktop-git-commit-push-action");

    expect(send?.getAttribute("aria-label")).toBe("Let others see it");
    expect(send?.querySelector(".desktop-git-operation-label")?.textContent).toBe("Let others see it");
    expect(send?.closest(".desktop-git-resizable-section-committed")).not.toBeNull();
    expect(visibleCopy(surface)).not.toMatch(/Push|Publish|Pull|Diverged|commit waiting/);
  });

  it("never shows a direction counter or a Git verb while the receipt is pending", () => {
    enableProjectReach();
    const surface = renderSidebar({ status: incomingStatus() });

    expect(visibleCopy(surface)).not.toMatch(/Pull|Diverged|commit waiting|4 commits/);
    expect(surface.querySelector('button[aria-label="Pull"]')).toBeNull();
  });
});

describe("the established path is untouched while the experience is off", () => {
  it("keeps the compact notice, its Pull action and an unused ledger", async () => {
    const onPull = vi.fn(async () => true);
    const surface = renderSidebar({ onPull, status: incomingStatus() });
    const notice = surface.querySelector<HTMLElement>(".desktop-git-incoming-notice");

    expect(notice?.querySelector(".desktop-git-incoming-notice-summary")?.textContent).toBe("3 commits");
    expect(surface.querySelector('button[aria-label="Pull"]')).not.toBeNull();
    expect(surface.querySelector(".desktop-incoming-changes")).toBeNull();
    expect(localStorage.getItem(INCOMING_REVIEW_STORAGE_KEY)).toBeNull();

    await act(async () => surface.querySelector<HTMLButtonElement>(".desktop-git-incoming-notice-pull")?.click());
    expect(onPull).toHaveBeenCalledOnce();
  });
});

function applyButton(surface: HTMLElement) {
  return surface.querySelector<HTMLButtonElement>(".desktop-incoming-changes-apply");
}

function fileRows(surface: HTMLElement) {
  return Array.from(surface.querySelectorAll(".desktop-incoming-changes-file"))
    .map((row) => row.textContent ?? "");
}

function visibleCopy(surface: HTMLElement) {
  const labels = Array.from(surface.querySelectorAll("[aria-label],[title]"))
    .map((node) => `${node.getAttribute("aria-label") ?? ""} ${node.getAttribute("title") ?? ""}`);
  return `${surface.textContent ?? ""} ${labels.join(" ")}`;
}

function renderSidebar(options: Partial<{
  onPull: () => Promise<boolean>;
  onSelect: (selection: unknown) => void;
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
        status: options.status ?? incomingStatus(),
        puppyoneConfig: null,
        gitDisplayMode: "professional",
        gitSidebarLayout: "cards",
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
        initialize: succeed,
        selectWorkingFile: options.onSelect ?? vi.fn(),
        stagePaths: succeed,
        stageAll: succeed,
        unstagePaths: succeed,
        discardPaths: succeed,
        stageAndCommit: succeed,
        commit: succeed,
        commitAndPush: succeed,
        continueOperation: succeed,
        abortOperation: succeed,
        pull: options.onPull ?? succeed,
        push: succeed,
        publish: succeed,
      }}
      cloudBackup={{ loading: false, error: null, enabled: false, start: vi.fn() }}
    />,
  )));
  return container;
}

function localBranch(overrides: Partial<GitBranchSummary> = {}): GitBranchSummary {
  return {
    name: "main",
    current: true,
    remote: false,
    upstream: "origin/main",
    ahead: 0,
    behind: 3,
    lastCommitId: "local01",
    lastCommitMessage: "Local commit",
    lastCommitDate: "2026-10-12T08:00:00.000Z",
    lastCommitAuthorName: "You",
    ...overrides,
  };
}

function remoteTip(overrides: Partial<GitBranchSummary> = {}): GitBranchSummary {
  return {
    name: "origin/main",
    current: false,
    remote: true,
    upstream: null,
    ahead: 0,
    behind: 0,
    lastCommitId: "9f1c2ab",
    lastCommitMessage: "Rewrite the onboarding copy",
    lastCommitDate: "2026-10-12T09:30:00.000Z",
    lastCommitAuthorName: "Dana Rivera",
    ...overrides,
  };
}

function incomingStatus({ lastCommitId }: { lastCommitId?: string } = {}): GitStatusSnapshot {
  const incoming: GitSourceControlResource[] = [
    gitResource("docs/intro.md"),
    gitResource("src/app.ts", "added"),
  ];
  const target = {
    remote: "origin", branch: "main", ref: "origin/main", exists: true,
    ahead: 0, behind: 3, incomingPreview: incoming, outgoingPreview: [],
  } satisfies NonNullable<GitStatusSnapshot["syncTarget"]>;
  const base = gitStatus({
    branch: "main",
    headCommitId: "local01",
    branches: [localBranch(), remoteTip(lastCommitId ? { lastCommitId } : {})],
    remotes: [{
      name: "origin",
      fetchUrl: "https://example.test/repo.git",
      pushUrl: "https://example.test/repo.git",
      branches: ["main"],
    }],
    syncTarget: target,
    effectiveHosting: {
      kind: "generic-git", remoteName: "origin", branchName: "main",
      ref: "origin/main", ready: true, reason: "remote-detected", identity: null,
    },
  });

  return {
    ...base,
    sourceControl: {
      ...base.sourceControl,
      remote: {
        ...base.sourceControl.remote,
        target,
        upstream: "origin/main",
        behind: 3,
        canPull: true,
        state: "incoming",
        incomingPreview: incoming,
        incomingFileSummary: {
          total: 4, added: 1, modified: 3, deleted: 0, renamed: 0, copied: 0, changed: 0,
        },
      },
    },
  };
}

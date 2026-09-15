/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GitHistorySidebar,
  type GitHistorySidebarProps,
} from "../../../../src/features/source-control/GitHistorySidebar";
import type { GitCommitSummary } from "../../../../src/types/electron";
import { gitStatus } from "../../../support/source-control/gitFixtures";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
});

describe("Git History right-sidebar surface", () => {
  it("offers one version-history action before Git is initialized", async () => {
    const onInitialize = vi.fn(async () => true);
    const surface = renderHistory({
      ...model(),
      status: gitStatus({ isRepo: false, totalCommits: 0, commits: [], allCommits: [] }),
      onInitialize,
    });

    expect(surface.textContent).not.toContain("No repository");
    const buttons = surface.querySelectorAll<HTMLButtonElement>("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe("Create Version History");
    expect(buttons[0]?.classList.contains("desktop-version-control-enable-button")).toBe(true);

    await act(async () => buttons[0]?.click());
    expect(onInitialize).toHaveBeenCalledOnce();
  });

  it("drills into a commit without introducing workbench tabs", () => {
    const commit = createCommit();
    const onSelectCommit = vi.fn();
    const surface = renderHistory({
      ...model(),
      status: gitStatus({
        branch: "main",
        headCommitId: commit.commit_id,
        totalCommits: 1,
        commits: [commit],
        allCommits: [commit],
      }),
      selectedCommitId: commit.commit_id,
      onSelectCommit,
    });

    expect(surface.querySelector(".desktop-git-history-sidebar")).not.toBeNull();
    expect(surface.querySelector(".desktop-git-history-sidebar-header")).toBeNull();
    expect(surface.querySelector('[role="tab"]')).toBeNull();
    const row = surface.querySelector<HTMLButtonElement>(".desktop-history-row");
    expect(row?.textContent).toContain("Keep history in its own sidebar");
    expect(row?.querySelector(".desktop-history-row-stat")?.textContent).toBe("+8.3K-3.1K");
    expect(row?.querySelector(".desktop-history-dot")).toBeNull();
    expect(row?.textContent).not.toContain("12345678");
    expect(row?.textContent).toContain("README.md");
    expect(row?.textContent).not.toContain("PuppyOne");
    expect(surface.querySelectorAll(".desktop-history-date-group")).toHaveLength(1);
    const virtualRows = surface.querySelectorAll<HTMLElement>(".po-sidebar-virtual-row");
    expect(virtualRows[0]?.style.getPropertyValue("--po-sidebar-virtual-row-size")).toBe("36px");
    expect(virtualRows[1]?.style.getPropertyValue("--po-sidebar-virtual-row-size")).toBe("46px");

    act(() => row?.click());

    expect(onSelectCommit).toHaveBeenCalledWith(commit.commit_id);
    expect(surface.querySelector(".desktop-commit-detail")?.textContent)
      .toContain("Keep history in its own sidebar");
    expect(surface.querySelector(".desktop-commit-detail")?.textContent)
      .not.toContain("PuppyOne");
    expect(surface.querySelector<HTMLButtonElement>('button[aria-label="Back"]')).not.toBeNull();

    act(() => surface.querySelector<HTMLButtonElement>('button[aria-label="Back"]')?.click());
    expect(surface.querySelector(".desktop-history-row")).not.toBeNull();
  });

  it("keeps loading feedback inside the History surface", () => {
    const surface = renderHistory({
      ...model(),
      status: gitStatus({ totalCommits: 4 }),
      historyLoading: true,
    });

    expect(surface.textContent).toContain("Reading Git history");
    expect(surface.querySelector(".desktop-git-sidebar-empty-history")).toBeNull();
    expect(surface.querySelector(".desktop-git-history-loading.desktop-git-loading-state"))
      .not.toBeNull();
    expect(surface.querySelector(".desktop-git-history-loading")?.getAttribute("role"))
      .toBe("status");
    expect(surface.querySelector('[data-puppy-loader="dots"]')).not.toBeNull();
  });

  it("groups commits by local date in descending date order", () => {
    const olderCommit = createCommit({
      commit_id: "aaaaaaaaaaaaaaaa",
      created_at: "2026-08-27T12:00:00.000Z",
      message: "Older commit",
    });
    const newerCommit = createCommit({
      commit_id: "bbbbbbbbbbbbbbbb",
      created_at: "2026-08-28T12:00:00.000Z",
      message: "Newer commit",
    });
    const surface = renderHistory({
      ...model(),
      status: gitStatus({
        totalCommits: 2,
        commits: [olderCommit, newerCommit],
        allCommits: [olderCommit, newerCommit],
      }),
    });

    expect(Array.from(surface.querySelectorAll<HTMLTimeElement>(
      ".desktop-history-date-group time",
    )).map((time) => time.dateTime)).toEqual(["2026-08-28", "2026-08-27"]);
    expect(Array.from(surface.querySelectorAll(".desktop-history-row-message")).map(
      (message) => message.textContent,
    )).toEqual(["Newer commit", "Older commit"]);
  });

  it("previews four changed files before summarizing the remainder", () => {
    const commit = createCommit({
      changes: [
        {
          path: "added.md",
          oldPath: null,
          status: "added",
          additions: 12,
          deletions: 0,
        },
        {
          path: "deleted.md",
          oldPath: null,
          status: "deleted",
          additions: 0,
          deletions: 8,
        },
        {
          path: "renamed.md",
          oldPath: "old-name.md",
          status: "renamed",
          additions: 1,
          deletions: 1,
        },
        {
          path: "modified.md",
          oldPath: null,
          status: "modified",
          additions: 4,
          deletions: 2,
        },
        {
          path: "remaining.md",
          oldPath: null,
          status: "modified",
          additions: 2,
          deletions: 1,
        },
      ],
    });
    const surface = renderHistory({
      ...model(),
      status: gitStatus({ commits: [commit], allCommits: [commit] }),
    });
    const previews = surface.querySelectorAll<HTMLElement>(".desktop-history-row-file");

    expect(previews).toHaveLength(4);
    expect(previews[0]?.dataset.status).toBe("added");
    expect(previews[0]?.textContent).toBe("+added.md");
    expect(previews[1]?.dataset.status).toBe("deleted");
    expect(previews[1]?.textContent).toBe("−deleted.md");
    expect(previews[1]?.querySelector(".desktop-history-row-file-icon")).not.toBeNull();
    expect(previews[2]?.textContent).toContain("old-name.md → renamed.md");
    expect(previews[3]?.textContent).toBe("modified.md");
    expect(surface.querySelector(".desktop-history-row-file-count")?.textContent).toBe("+1 file");
    expect(surface.querySelector(".desktop-history-row-file-count")?.parentElement?.classList.contains(
      "desktop-history-row-files",
    )).toBe(true);
  });

  it("collapses and expands a calendar day", async () => {
    const firstCommit = createCommit();
    const secondCommit = createCommit({
      commit_id: "bbbbbbbbbbbbbbbb",
      message: "Second commit",
    });
    const surface = renderHistory({
      ...model(),
      status: gitStatus({
        totalCommits: 2,
        commits: [firstCommit, secondCommit],
        allCommits: [firstCommit, secondCommit],
      }),
    });
    const dateToggle = surface.querySelector<HTMLButtonElement>(
      ".desktop-history-date-group button",
    );

    expect(dateToggle?.getAttribute("aria-expanded")).toBe("true");
    expect(surface.querySelectorAll(".desktop-history-row")).toHaveLength(2);

    await act(async () => {
      dateToggle?.click();
      await Promise.resolve();
    });
    expect(dateToggle?.getAttribute("aria-expanded")).toBe("false");
    expect(surface.querySelectorAll(".desktop-history-row")).toHaveLength(0);

    await act(async () => {
      dateToggle?.click();
      await Promise.resolve();
    });
    expect(dateToggle?.getAttribute("aria-expanded")).toBe("true");
    expect(surface.querySelectorAll(".desktop-history-row")).toHaveLength(2);
  });
});

function renderHistory(props: GitHistorySidebarProps) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  act(() => root.render(withTestLocalization(<GitHistorySidebar {...props} />)));
  return container;
}

function model(): GitHistorySidebarProps {
  return {
    status: gitStatus(),
    statusLoading: false,
    statusError: null,
    selectedCommitId: null,
    commitDetail: null,
    commitDetailLoading: false,
    commitDetailError: null,
    historyLoading: false,
    fileIconTheme: "default",
    initializing: false,
    onInitialize: vi.fn(),
    onSelectCommit: vi.fn(),
  };
}

function createCommit(overrides: Partial<GitCommitSummary> = {}): GitCommitSummary {
  return {
    commit_id: "1234567890abcdef",
    parent_ids: [],
    author_name: "PuppyOne",
    author_email: "hello@puppyone.ai",
    created_at: "2026-08-27T00:00:00.000Z",
    message: "Keep history in its own sidebar",
    changes: [{
      path: "README.md",
      oldPath: null,
      status: "modified",
      additions: 8_254,
      deletions: 3_075,
    }],
    ...overrides,
  };
}

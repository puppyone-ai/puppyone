/**
 * @vitest-environment happy-dom
 */
import React, { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopSidebarRailNavigation } from "../../../../src/features/app-shell/navigation";
import {
  CloudProjectHistorySidebar,
  CloudProjectHistoryView,
} from "../../../../src/features/cloud/history";
import { mergeCloudHistoryPages } from "../../../../src/features/cloud/history/pagination";
import { buildCloudBranchGraphRows } from "../../../../src/features/cloud/graph/model";
import type { DesktopCloudHistory } from "../../../../src/lib/cloudHistoryApi";
import { renderWithTestLocalization, testT } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("Cloud project history", () => {
  it("keeps local Changes in the app shell instead of creating a Cloud workspace shell", () => {
    const onNavigate = vi.fn();
    const container = render(
      <DesktopSidebarRailNavigation
        activeView="data"
        gitEnabled
        gitIncomingCount={0}
        gitOperationLoading={null}
        gitStatus={null}
        workspaceChangeCount={0}
        onNavigate={onNavigate}
        onOpenSettings={vi.fn()}
      />,
    );

    const changesButton = container.querySelector<HTMLButtonElement>('button[aria-label="Changes"]');
    expect(changesButton).not.toBeNull();
    expect(container.querySelector('button[aria-label="History"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Cloud"]')).toBeNull();

    act(() => changesButton?.click());
    expect(onNavigate).toHaveBeenCalledWith("git");
  });

  it("keeps the full Cloud timeline instead of truncating it to the first 20 commits", () => {
    const history = createHistory(27);
    expect(buildCloudBranchGraphRows({ history })).toHaveLength(27);
  });

  it("gives the initial sidebar loader the full available sidebar height", () => {
    const container = render(
      <CloudProjectHistorySidebar
        rows={[]}
        selectedCommitId={null}
        loading
        loadingMore={false}
        hasMore={false}
        error={null}
        warning={null}
        onSelectCommit={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );

    expect(container.querySelector(".desktop-cloud-history-sidebar-state-list")).not.toBeNull();
    expect(container.querySelector(".desktop-cloud-history-sidebar-state > .desktop-cloud-history-sidebar-loading"))
      .not.toBeNull();
  });

  it("selects graph commits and presents them with the canonical local History hierarchy", () => {
    const history = createHistory(2);
    const rows = buildCloudBranchGraphRows({ history });
    const container = render(<HistoryHarness history={history} />);

    expect(container.querySelector('ol[aria-label="Commit history"]')).not.toBeNull();
    expect(container.querySelectorAll('button[data-commit-id]')).toHaveLength(2);
    expect(container.querySelector(".desktop-cloud-history-graph-svg")).not.toBeNull();
    expect(container.querySelector(".desktop-cloud-history-sidebar-row-stat")?.textContent).toBe("+0-0");
    expect(container.querySelector(".desktop-commit-detail.desktop-cloud-commit-detail")).not.toBeNull();
    expect(container.querySelector(".desktop-commit-summary > p")?.textContent).toBe("Commit 1");
    expect(container.textContent).toContain("Author 1");
    expect(container.querySelector(".desktop-file-diff-identity")?.getAttribute("title")).toBe("src/file-1.ts");
    expect(container.querySelector('.desktop-file-diff[data-change-kind="modified"]')).not.toBeNull();
    expect(container.querySelector('.desktop-file-diff[data-content-mode="metadata"]')).not.toBeNull();
    expect(container.querySelector(".desktop-format-diff")).toBeNull();
    expect(container.textContent).toContain("HEAD");
    expect(container.querySelector(".desktop-cloud-history-inline-ref")).not.toBeNull();
    expect(container.querySelector(".desktop-cloud-history-graph-continuation")).toBeNull();
    expect(container.querySelector(".desktop-cloud-history-sidebar-header")).toBeNull();
    expect(container.querySelector(".desktop-cloud-history-sidebar-footer")).toBeNull();
    expect(container.querySelector(".desktop-cloud-project-history-header")).toBeNull();
    expect(container.querySelectorAll(".desktop-cloud-commit-actions button")).toHaveLength(2);
    expect(container.querySelector(".desktop-cloud-commit-technical-meta")).toBeNull();

    const olderCommit = Array.from(container.querySelectorAll<HTMLButtonElement>('button[data-commit-id]'))
      .find((button) => button.textContent?.includes("Commit 2"));
    if (!olderCommit) throw new Error("Older commit row is missing.");

    act(() => olderCommit.click());

    expect(container.querySelector(".desktop-commit-summary > p")?.textContent).toBe("Commit 2");
    expect(container.textContent).toContain("Author 2");
    expect(container.querySelector(".desktop-file-diff-identity")?.getAttribute("title")).toBe("src/file-2.ts");
    expect(container.querySelector('.desktop-file-diff[data-change-kind="deleted"]')).not.toBeNull();
  });

  it("maps merge parents and named refs into stable multi-lane Cloud rows", () => {
    const history = createMergeHistory();
    const rows = buildCloudBranchGraphRows({ history });
    const commits = rows.filter((row) => row.kind === "commit");
    const merge = commits.find((row) => row.id === id("d"));
    const main = commits.find((row) => row.id === id("b"));
    const feature = commits.find((row) => row.id === id("c"));

    expect(merge?.segments.filter((segment) => segment.from === "middle" && segment.to === "bottom"))
      .toHaveLength(2);
    expect(commits.some((row) => row.nodeLane > 0)).toBe(true);
    expect(feature?.nodeColor).not.toBe(main?.nodeColor);
    expect(main?.labels).toContainEqual(expect.objectContaining({ name: "v1", kind: "tag" }));
    expect(rows).toContainEqual(expect.objectContaining({ kind: "ref", authorName: id("e").slice(0, 8) }));
  });

  it("keeps rendered commit rows stable when an older cursor page is appended", () => {
    const full = createMergeHistory();
    const firstPage: DesktopCloudHistory = {
      ...full,
      commits: full.commits.slice(0, 3),
      next_cursor: full.commits[2]?.commit_id,
      has_more: true,
    };
    const nextPage: DesktopCloudHistory = {
      ...full,
      commits: full.commits.slice(3),
      next_cursor: null,
      has_more: false,
    };
    const before = buildCloudBranchGraphRows({ history: firstPage })
      .filter((row) => row.kind === "commit");
    const merged = mergeCloudHistoryPages(firstPage, nextPage);
    const after = buildCloudBranchGraphRows({ history: merged })
      .filter((row) => row.kind === "commit")
      .slice(0, before.length);

    expect(after).toEqual(before);
    expect(merged.commits.map((commit) => commit.commit_id)).toEqual(
      full.commits.map((commit) => commit.commit_id),
    );
    expect(merged.has_more).toBe(false);
  });

  it("assigns a new path color when a closed lane is reused by another branch", () => {
    const firstHead = id("1");
    const firstRoot = id("2");
    const secondHead = id("3");
    const secondRoot = id("4");
    const history: DesktopCloudHistory = {
      ...historyEnvelope("lane-reuse", 4),
      project_id: "project-1",
      head_commit_id: firstHead,
      refs: [
        { ref_name: "refs/heads/main", ref_type: "branch", commit_id: firstHead },
        { ref_name: "refs/heads/second", ref_type: "branch", commit_id: secondHead },
      ],
      commits: [
        cloudCommit(firstHead, [firstRoot], "First head"),
        cloudCommit(firstRoot, [], "First root"),
        cloudCommit(secondHead, [secondRoot], "Second head"),
        cloudCommit(secondRoot, [], "Second root"),
      ],
    };
    const rows = buildCloudBranchGraphRows({ history });
    const first = rows.find((row) => row.id === firstHead);
    const second = rows.find((row) => row.id === secondHead);

    expect(first?.nodeLane).toBe(0);
    expect(second?.nodeLane).toBe(0);
    expect(second?.nodeColor).not.toBe(first?.nodeColor);
  });

  it("offers incremental loading without adding write actions", () => {
    const history = createHistory(2);
    const rows = buildCloudBranchGraphRows({ history });
    const onLoadMore = vi.fn();
    const container = render(
      <CloudProjectHistorySidebar
        rows={rows}
        selectedCommitId={history.head_commit_id ?? null}
        loading={false}
        loadingMore={false}
        hasMore
        error={null}
        warning={null}
        onSelectCommit={vi.fn()}
        onLoadMore={onLoadMore}
      />,
    );

    const loadMore = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("Load more"));
    expect(loadMore).toBeDefined();
    act(() => loadMore?.click());
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain(testT("cloud.scope.readOnly"));
    expect(container.querySelector(".desktop-cloud-history-sidebar-load-more")).not.toBeNull();
    expect(container.textContent).not.toMatch(/checkout|revert|cherry-pick/i);
  });

  it("uses native button-list semantics and keeps ref-only rows non-interactive", () => {
    const history = createMergeHistory();
    const rows = buildCloudBranchGraphRows({ history });
    const container = render(
      <CloudProjectHistorySidebar
        rows={rows}
        selectedCommitId={history.head_commit_id}
        loading={false}
        loadingMore={false}
        hasMore={false}
        error={null}
        warning={null}
        onSelectCommit={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );

    expect(container.querySelector('ol[aria-label="Commit history"]')).not.toBeNull();
    expect(container.querySelectorAll('button[data-commit-id]')).toHaveLength(4);
    const refOnlyItem = container.querySelector('[data-history-row-kind="ref"]');
    expect(refOnlyItem).not.toBeNull();
    expect(refOnlyItem?.querySelector("button")).toBeNull();
  });
});

function HistoryHarness({ history }: { history: DesktopCloudHistory }) {
  const rows = buildCloudBranchGraphRows({ history });
  const [selectedCommitId, setSelectedCommitId] = useState(history.head_commit_id ?? rows[0]?.id ?? null);
  const sidebarProps = {
    rows,
    selectedCommitId,
    loading: false,
    loadingMore: false,
    hasMore: false,
    error: null,
    warning: null,
    onSelectCommit: setSelectedCommitId,
    onLoadMore: vi.fn(),
  };

  return (
    <div>
      <CloudProjectHistorySidebar {...sidebarProps} />
      <CloudProjectHistoryView
        {...sidebarProps}
        projectId="project-1"
        projectName="Cloud Atlas"
        history={history}
        onRefresh={vi.fn()}
      />
    </div>
  );
}

function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => renderWithTestLocalization(root, node));
  return container;
}

function createHistory(count: number): DesktopCloudHistory {
  const commits = Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const deleted = number % 2 === 0;
    return {
      commit_id: number.toString(16).padStart(40, String(number % 10)),
      who: `Author ${number}`,
      message: `Commit ${number}`,
      created_at: `2026-07-${String(Math.max(1, 11 - index)).padStart(2, "0")}T10:00:00.000Z`,
      changes: [{
        path: `src/file-${number}.ts`,
        action: deleted ? "delete" as const : "update" as const,
        op: deleted ? "deleted" as const : "modified" as const,
      }],
      conflicts: [],
      root_hash: `root-${number}`,
      scope_hash: "",
      scope_path: "",
      audit_detail: null,
    };
  });
  const commitsWithParents = commits.map((commit, index) => ({
    ...commit,
    parent_ids: commits[index + 1] ? [commits[index + 1].commit_id] : [],
  }));
  return {
    project_id: "project-1",
    ...historyEnvelope("linear-history", commitsWithParents.length),
    commits: commitsWithParents,
    head_commit_id: commitsWithParents[0]?.commit_id ?? null,
    refs: commitsWithParents[0]
      ? [{ ref_name: "refs/heads/main", ref_type: "branch", commit_id: commitsWithParents[0].commit_id }]
      : [],
  };
}

function createMergeHistory(): DesktopCloudHistory {
  return {
    ...historyEnvelope("merge-history", 4),
    project_id: "project-1",
    head_commit_id: id("d"),
    refs: [
      { ref_name: "refs/heads/main", ref_type: "branch", commit_id: id("d") },
      { ref_name: "refs/heads/feature", ref_type: "branch", commit_id: id("c") },
      { ref_name: "refs/tags/v1", ref_type: "tag", commit_id: id("b") },
      { ref_name: "refs/heads/archive", ref_type: "branch", commit_id: id("e") },
    ],
    commits: [
      cloudCommit(id("d"), [id("b"), id("c")], "Merge feature"),
      cloudCommit(id("c"), [id("a")], "Feature work"),
      cloudCommit(id("b"), [id("a")], "Main work"),
      cloudCommit(id("a"), [], "Base"),
    ],
  };
}

function cloudCommit(commitId: string, parentIds: string[], message: string) {
  return {
    commit_id: commitId,
    parent_ids: parentIds,
    who: "Cloud Author",
    message,
    created_at: "2026-07-12T10:00:00.000Z",
    changes: [],
    conflicts: [],
    root_hash: "",
    scope_hash: "",
    scope_path: "",
    audit_detail: null,
  };
}

function historyEnvelope(snapshotSeed: string, total: number) {
  return {
    topology_available: true,
    refs_included: true,
    snapshot_id: snapshotSeed.padEnd(64, "0").slice(0, 64),
    next_cursor: null,
    has_more: false,
    total,
    graph_health: "complete" as const,
    unreadable_commit_ids: [],
  };
}

function id(character: string): string {
  return character.repeat(40);
}

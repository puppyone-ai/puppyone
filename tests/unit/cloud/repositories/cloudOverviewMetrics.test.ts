import { describe, expect, it } from "vitest";
import type { DesktopCloudDashboard, DesktopCloudTree } from "../../../../src/lib/cloudApi";
import {
  getCloudOverviewEntryUpdatedAt,
  getCloudOverviewMetrics,
  getCloudOverviewRootEntries,
  getCloudOverviewStorageUsage,
} from "../../../../src/features/cloud/sections/overview/overviewMetrics";

describe("Cloud Overview metrics", () => {
  it("separates active connections from the total access-point inventory", () => {
    const metrics = getCloudOverviewMetrics({
      scopes: [],
      connectors: [],
      mcpEndpoints: [],
      identity: {
        project_id: "project-1",
        url: "https://cloud.example/git/project-1.git",
        scopes: [],
      },
    });

    expect(metrics.accessPointCount).toBe(2);
    expect(metrics.activeAccessPointCount).toBe(1);
  });

  it("keeps only direct children and orders product folders before files", () => {
    const tree: DesktopCloudTree = {
      path: "docs",
      entries: [{
        name: "zeta.md",
        path: "docs/zeta.md",
        type: "markdown",
      }, {
        name: "assets",
        path: "docs/assets",
        type: "folder",
      }, {
        name: "nested.md",
        path: "docs/assets/nested.md",
        type: "markdown",
      }],
    };

    expect(getCloudOverviewRootEntries(tree).map((entry) => entry.name)).toEqual([
      "assets",
      "zeta.md",
    ]);
  });

  it("uses authoritative project storage and quota when the dashboard provides them", () => {
    expect(getCloudOverviewStorageUsage(createDashboard({
      storage_bytes: 125,
      storage_limit_bytes: 500,
    }), null)).toEqual({
      bytes: 125,
      limitBytes: 500,
      percent: 25,
      isLowerBound: false,
    });
  });

  it("derives each row's modified time from history paths, including folder descendants", () => {
    const history = {
      project_id: "project-1",
      commits: [{
        commit_id: "a".repeat(40),
        parent_ids: [],
        who: "Ada",
        message: "Update docs",
        changes: [{ path: "docs/guide.md", op: "modified" as const }],
        conflicts: [],
        root_hash: "root",
        scope_hash: "scope",
        scope_path: "",
        created_at: "2026-07-18T12:00:00.000Z",
        audit_detail: null,
      }],
      topology_available: true,
      head_commit_id: "a".repeat(40),
      refs: [],
      refs_included: true,
      snapshot_id: "b".repeat(64),
      next_cursor: null,
      has_more: false,
      total: 1,
      graph_health: "complete" as const,
      unreadable_commit_ids: [],
    };

    expect(getCloudOverviewEntryUpdatedAt({
      name: "docs",
      path: "docs",
      type: "folder",
    }, history)).toBe("2026-07-18T12:00:00.000Z");
    expect(getCloudOverviewEntryUpdatedAt({
      name: "README.md",
      path: "README.md",
      type: "markdown",
    }, history)).toBeNull();
  });

  it("marks a root-tree storage sum as a lower bound when folders can contain more data", () => {
    const usage = getCloudOverviewStorageUsage(null, {
      path: "",
      entries: [{ name: "docs", path: "docs", type: "folder" }, {
        name: "README.md",
        path: "README.md",
        type: "markdown",
        size_bytes: 256,
      }],
    });

    expect(usage).toEqual({
      bytes: 256,
      limitBytes: null,
      percent: null,
      isLowerBound: true,
    });
  });

  it("does not invent storage usage when the tree contains no measurable files", () => {
    expect(getCloudOverviewStorageUsage(null, {
      path: "",
      entries: [{ name: "docs", path: "docs", type: "folder" }],
    }).bytes).toBeNull();
  });
});

function createDashboard(nodes: Partial<DesktopCloudDashboard["nodes"]>): DesktopCloudDashboard {
  return {
    project: { id: "project-1", name: "Atlas" },
    nodes: { total: 0, folders: 0, files: 0, ...nodes },
    connections: [],
    tools: [],
    uploads: [],
  };
}

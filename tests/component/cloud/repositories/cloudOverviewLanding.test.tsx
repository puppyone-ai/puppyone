/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@puppyone/shared-ui";
import { CloudRepositoryOverview } from "../../../../src/features/cloud/sections/overview";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("CloudRepositoryOverview landing page", () => {
  it("renders the Homepage shell immediately and replaces inline skeletons in place", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const renderOverview = (loading: boolean, tree: null | { path: string; entries: [] }) => withTestLocalization(
      <CloudRepositoryOverview
        workspace={WORKSPACE}
        project={null}
        dashboard={null}
        tree={tree}
        history={null}
        scopes={[]}
        connectors={[]}
        mcpEndpoints={[]}
        identity={null}
        loading={loading}
        onSelectSection={vi.fn()}
        onRefresh={vi.fn(async () => undefined)}
      />,
    );

    act(() => root?.render(renderOverview(true, null)));

    const title = container.querySelector(".desktop-cloud-overview-landing-copy h1");
    expect(title?.textContent).toBe("Atlas");
    expect(container.querySelector(".desktop-cloud-loading-state")).toBeNull();
    expect(container.querySelector(".desktop-cloud-overview-project-storage.is-loading")).not.toBeNull();
    expect(container.querySelectorAll(".desktop-cloud-overview-value-skeleton")).toHaveLength(3);
    expect(container.querySelectorAll(".desktop-cloud-overview-file-row.skeleton")).toHaveLength(4);
    expect(container.querySelector(".desktop-cloud-overview-dashboard")?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector(".desktop-cloud-overview-refresh-button .spin")).not.toBeNull();

    act(() => root?.render(renderOverview(false, { path: "", entries: [] })));

    expect(container.querySelector(".desktop-cloud-overview-landing-copy h1")).toBe(title);
    expect(container.querySelector(".desktop-cloud-overview-project-storage.is-loading")).toBeNull();
    expect(container.querySelectorAll(".desktop-cloud-overview-value-skeleton")).toHaveLength(0);
    expect(container.querySelectorAll(".desktop-cloud-overview-file-row.skeleton")).toHaveLength(0);
    expect(container.textContent).toContain("No files stored yet");
  });

  it("uses an in-app action dashboard without promoting the web route", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00.000Z"));
    const onRefresh = vi.fn(async () => undefined);
    const onSelectSection = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(withTestLocalization(
      <CloudRepositoryOverview
        workspace={WORKSPACE}
        project={{
          id: "project-1",
          name: "Atlas",
          description: "Shared product research",
          visibility: "private",
          bound_git_branch: "release",
          updated_at: "2026-07-19T11:00:00.000Z",
          access_point_count: 0,
        }}
        dashboard={{
          project: {
            id: "project-1",
            name: "Atlas",
            description: "Shared product research",
          },
          nodes: {
            total: 8,
            folders: 3,
            files: 5,
            storage_bytes: 104_857_600,
            storage_limit_bytes: 524_288_000,
          },
          connections: [],
          tools: [],
          uploads: [],
        }}
        tree={{
          path: "",
          entries: [{
            name: "docs",
            path: "docs",
            type: "folder",
            children_count: 2,
          }, {
            name: "assets",
            path: "assets",
            type: "folder",
            children_count: 4,
          }, {
            name: "README.md",
            path: "README.md",
            type: "markdown",
            size_bytes: 1_024,
          }, {
            name: "users.csv",
            path: "users.csv",
            type: "csv",
            size_bytes: 2_048,
          }, {
            name: "app.ts",
            path: "app.ts",
            type: "typescript",
            size_bytes: 4_096,
          }]}}
        history={{
          project_id: "project-1",
          commits: [{
            commit_id: HEAD_COMMIT_ID,
            parent_ids: [PARENT_COMMIT_ID],
            who: "Ada",
            message: "Ship the project dashboard",
            changes: [{ path: "users.csv", op: "modified" }],
            conflicts: [],
            root_hash: "root-1",
            scope_hash: "scope-1",
            scope_path: "",
            created_at: "2026-07-18T12:00:00.000Z",
            audit_detail: null,
          }, {
            commit_id: PARENT_COMMIT_ID,
            parent_ids: [],
            who: "Grace",
            message: "Create the Cloud project",
            changes: [{ path: "README.md", op: "added" }],
            conflicts: [],
            root_hash: "root-0",
            scope_hash: "scope-0",
            scope_path: "",
            created_at: "2026-07-17T12:00:00.000Z",
            audit_detail: null,
          }],
          topology_available: true,
          head_commit_id: HEAD_COMMIT_ID,
          refs: [{
            ref_name: "refs/heads/main",
            ref_type: "branch",
            commit_id: HEAD_COMMIT_ID,
          }, {
            ref_name: "refs/heads/project-setup",
            ref_type: "branch",
            commit_id: PARENT_COMMIT_ID,
          }],
          refs_included: true,
          snapshot_id: "a".repeat(64),
          next_cursor: null,
          has_more: false,
          total: 12,
          graph_health: "complete",
          unreadable_commit_ids: [],
        }}
        scopes={[{
          id: "scope-docs",
          project_id: "project-1",
          name: "Documentation",
          path: "docs",
          exclude: [],
          max_mode: "rw",
        }]}
        connectors={[{
          id: "notion-root",
          target: { kind: "project_root", project_id: "project-1" },
          provider: "notion",
          name: "Notion knowledge",
          direction: "inbound",
          status: "active",
        }, {
          id: "orphan-automation",
          target: { kind: "scope", project_id: "project-1", scope_id: "missing-scope" },
          provider: "google_docs",
          name: "Detached docs",
          direction: "inbound",
          status: "active",
        }]}
        mcpEndpoints={[{
          id: "mcp-docs",
          project_id: "project-1",
          path: "docs",
          name: "Docs MCP",
          status: "active",
          accesses: [{ path: "docs", readonly: true }],
        }]}
        identity={{
          project_id: "project-1",
          url: "https://cloud.example/git/project-1.git",
          scopes: [{
            id: "scope-docs",
            name: "Documentation",
            path: "docs",
            git_url: "https://cloud.example/git/project-1/scopes/scope-docs.git",
          }],
        }}
        loading={false}
        onSelectSection={onSelectSection}
        onRefresh={onRefresh}
      />,
    )));

    expect(container.querySelector(".desktop-cloud-overview-catalog")).not.toBeNull();
    const dashboard = container.querySelector(".desktop-cloud-overview-dashboard");
    const headerFacts = container.querySelectorAll(".desktop-cloud-overview-header-fact");
    const fileRows = dashboard?.querySelectorAll(".desktop-cloud-overview-file-row");
    expect(dashboard).not.toBeNull();
    expect(headerFacts).toHaveLength(3);
    expect(headerFacts[0]?.textContent).toContain("Last updated");
    expect(headerFacts[0]?.textContent).toContain("1 hour ago");
    expect(headerFacts[1]?.textContent).toContain("Active connections");
    expect(headerFacts[1]?.textContent).toContain("3");
    expect(headerFacts[2]?.textContent).toContain("Path");
    expect(headerFacts[2]?.textContent).toContain("https://cloud.example/git/project-1.git");
    expect(dashboard?.textContent).not.toContain("Automation");
    expect(dashboard?.querySelector(".desktop-cloud-overview-files-header")).toBeNull();
    expect(dashboard?.querySelector(".desktop-cloud-overview-file-column-labels")).toBeNull();
    expect(dashboard?.querySelector(".desktop-cloud-overview-file-toolbar")).toBeNull();
    expect(dashboard?.querySelector("[role='list']")).not.toBeNull();
    expect(dashboard?.querySelector(".desktop-cloud-overview-file-activity-header")).toBeNull();
    expect(fileRows).toHaveLength(5);
    expect(fileRows?.[0]?.textContent).toContain("assets");
    expect(fileRows?.[1]?.textContent).toContain("docs");
    const usersRow = Array.from(fileRows ?? []).find((row) => row.textContent?.includes("users.csv"));
    expect(usersRow?.textContent).toContain("yesterday");
    expect(usersRow?.textContent).not.toContain("2 KB");
    expect(dashboard?.querySelectorAll(".desktop-cloud-overview-file-icon svg")).toHaveLength(5);
    expect(container.querySelector(".desktop-cloud-source-pill")).toBeNull();
    expect(container.querySelector(".desktop-cloud-overview-landing-mark")).toBeNull();
    expect(container.querySelector(".desktop-cloud-overview-deployment-board")).toBeNull();
    const pathFact = container.querySelector<HTMLElement>(".desktop-cloud-overview-path-fact");
    expect(pathFact?.querySelector("code")?.textContent).toBe("https://cloud.example/git/project-1.git");
    expect(pathFact?.title).toBe("https://cloud.example/git/project-1.git");
    expect(dashboard?.textContent).not.toContain("https://cloud.example/git/project-1.git");
    expect(dashboard?.textContent).not.toContain("release");
    expect(dashboard?.textContent).not.toContain("Private");
    expect(container.textContent).not.toContain("Shared product research");
    const storage = container.querySelector<HTMLElement>(".desktop-cloud-overview-project-storage");
    expect(storage?.textContent).toBe("");
    expect(storage?.title).toBe("100 MB of 500 MB");
    expect(storage?.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("20");
    expect(storage?.querySelector('[role="progressbar"]')?.getAttribute("aria-valuetext")).toBe("100 MB of 500 MB");
    expect(storage?.parentElement?.classList.contains("desktop-cloud-overview-landing-header")).toBe(true);
    expect(storage?.querySelector(".desktop-cloud-overview-project-storage-summary")).toBeNull();
    expect(container.querySelector(".desktop-cloud-overview-header-facts .desktop-cloud-overview-project-storage")).toBeNull();
    expect(dashboard?.querySelector(".desktop-cloud-overview-project-storage")).toBeNull();
    expect(findButton(container, "Open on web")).toBeUndefined();
    expect(container.querySelector(".desktop-project-folder-card")).toBeNull();

    act(() => findButton(container, "Refresh")?.click());
    expect(onRefresh).toHaveBeenCalledOnce();

    act(() => findButton(container, "View history")?.click());
    act(() => findButton(container, "Manage access points")?.click());
    expect(onSelectSection.mock.calls).toEqual([["history"], ["access"]]);
  });
});

function findButton(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.includes(label) || button.getAttribute("aria-label") === label);
}

const WORKSPACE = {
  id: "workspace-1",
  name: "Atlas",
  path: "/work/atlas",
  status: "protected",
} satisfies Workspace;

const HEAD_COMMIT_ID = "1".repeat(40);
const PARENT_COMMIT_ID = "2".repeat(40);

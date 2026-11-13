/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendWorkspaceContentChange,
  createResourceUri,
  createWorkspaceResourceUri,
  type DataNode,
  type DataPort,
  type Workspace,
  type WorkspaceContentChange,
} from "@puppyone/shared-ui";
import { DataWorkspace } from "../../../../src/shared-ui/data/DataWorkspace";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rootUri = createResourceUri({ scheme: "puppyone-cloud", authority: "api.example", path: "https/api/v1/owner/project/root" });
const uri = (path: string) => createWorkspaceResourceUri(rootUri, path);
const workspace: Workspace = { id: "cloud", workspaceInstanceId: "cloud", name: "Cloud", path: rootUri, status: "recording" };
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.restoreAllMocks(); });

/** A provider over an in-memory folder map that returns fresh node objects on every listing. */
function provider(cachedListings: boolean) {
  const entries = new Map<string, string[]>([
    ["", ["docs/", "other/", "readme.md"]],
    ["docs", ["a.md", "b.md"]],
    ["other", ["keep.md"]],
  ]);
  const nodes = (folder: string): DataNode[] => (entries.get(folder) ?? []).map((entry) => {
    const name = entry.replace(/\/$/, "");
    const path = uri(folder ? `${folder}/${name}` : name);
    return entry.endsWith("/")
      ? { id: path, path, name, type: "folder", hasChildren: true, resourceUri: path }
      : { id: path, path, name, type: "markdown", resourceUri: path };
  });
  const folderOf = (path: string | null) => (path ? path.slice(rootUri.length + 1) : "");
  const overrides = new Map<string, Promise<DataNode[]>>();
  const listChildren = vi.fn(async (path: string | null) => overrides.get(folderOf(path)) ?? nodes(folderOf(path)));
  const dataPort: DataPort = { listChildren, ...(cachedListings ? { getCachedChildren: (path) => nodes(folderOf(path)) } : {}) };
  return { dataPort, listChildren, entries, overrides, folderOf };
}

async function mountExplorer(cachedListings = true) {
  const source = provider(cachedListings);
  const sessions = vi.fn();
  let journal: WorkspaceContentChange = { sequence: 0, entries: [] };
  // The host keeps its restored session stable across renders, as the workbench does.
  const restored = { tree: [], rootLoaded: false, expandedPaths: [uri("docs"), uri("other")] };
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const render = () => root!.render(withTestLocalization(<DataWorkspace workspace={workspace} dataPort={source.dataPort}
    initialExplorerSession={restored}
    folderExpansionStrategy={cachedListings ? "optimistic" : "load-before-expand"} refreshKey={journal}
    onExplorerSessionChange={sessions} />));
  await act(async () => render());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(host.querySelector(`[data-explorer-path="${uri("docs/a.md")}"]`)).not.toBeNull();
  expect(host.querySelector(`[data-explorer-path="${uri("other/keep.md")}"]`)).not.toBeNull();
  source.listChildren.mockClear(); sessions.mockClear();
  return {
    ...source, host, sessions,
    async change(paths: readonly string[] | null) {
      journal = appendWorkspaceContentChange(journal, { rootUri, paths });
      await act(async () => render());
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    },
    listed: () => source.listChildren.mock.calls.map(([path]) => source.folderOf(path as string | null)),
    row: (path: string) => host.querySelector(`[data-explorer-path="${uri(path)}"]`),
  };
}

describe.each([
  ["Cloud listings with cached snapshots", true],
  ["local listings read from disk", false],
])("Explorer refresh after a named change (%s)", (_label, cachedListings) => {
  it("re-lists only the folder holding the changed file", async () => {
    const explorer = await mountExplorer(cachedListings);
    await explorer.change(["docs/a.md"]);
    expect(explorer.listed()).toEqual(["docs"]);
  });

  it("re-lists the root for a top-level change and nothing else", async () => {
    const explorer = await mountExplorer(cachedListings);
    await explorer.change(["readme.md"]);
    expect(explorer.listed()).toEqual([""]);
  });

  it("shows an entry another writer added, leaving other rows untouched", async () => {
    const explorer = await mountExplorer(cachedListings);
    const keep = explorer.row("other/keep.md");
    explorer.entries.set("docs", ["a.md", "b.md", "agent.md"]);
    await explorer.change(["docs/agent.md"]);
    expect(explorer.row("docs/agent.md")).not.toBeNull();
    expect(explorer.row("other/keep.md")).toBe(keep);
  });

  it("removes an entry another writer deleted", async () => {
    const explorer = await mountExplorer(cachedListings);
    explorer.entries.set("docs", ["a.md"]);
    await explorer.change(["docs/b.md"]);
    expect(explorer.row("docs/b.md")).toBeNull();
    expect(explorer.row("docs/a.md")).not.toBeNull();
  });

  it("still revalidates every loaded folder when the change cannot be named", async () => {
    const explorer = await mountExplorer(cachedListings);
    await explorer.change(null);
    expect(new Set(explorer.listed())).toEqual(new Set(["", "docs", "other"]));
  });
});

describe("Explorer refresh stability", () => {
  it("does not produce a new tree when a re-listed folder did not change", async () => {
    const explorer = await mountExplorer();
    const before = explorer.row("docs/a.md");
    await explorer.change(["docs/a.md"]);
    await explorer.change(["docs/b.md"]);
    expect(explorer.listed()).toEqual(["docs", "docs"]);
    expect(explorer.sessions).not.toHaveBeenCalled();
    expect(explorer.row("docs/a.md")).toBe(before);
  });

  it("keeps the newest listing of a folder when an older one returns last", async () => {
    const explorer = await mountExplorer();
    let resolveOld!: (nodes: DataNode[]) => void;
    explorer.overrides.set("docs", new Promise((resolve) => { resolveOld = resolve; }));
    await explorer.change(["docs/a.md"]);
    explorer.overrides.delete("docs");
    explorer.entries.set("docs", ["a.md", "b.md", "fresh.md"]);
    await explorer.change(["docs/fresh.md"]);
    expect(explorer.row("docs/fresh.md")).not.toBeNull();

    await act(async () => resolveOld([{ id: uri("docs/stale.md"), path: uri("docs/stale.md"), name: "stale.md", type: "markdown" }]));
    expect(explorer.row("docs/stale.md")).toBeNull();
    expect(explorer.row("docs/fresh.md")).not.toBeNull();
  });

  it("does not cancel another folder's load when one folder is re-listed", async () => {
    const explorer = await mountExplorer();
    let resolveOther!: (nodes: DataNode[]) => void;
    explorer.overrides.set("other", new Promise((resolve) => { resolveOther = resolve; }));
    await explorer.change(["other/keep.md"]);
    await explorer.change(["docs/a.md"]);
    expect(explorer.listed()).toEqual(["other", "docs"]);

    await act(async () => resolveOther([
      { id: uri("other/keep.md"), path: uri("other/keep.md"), name: "keep.md", type: "markdown" },
      { id: uri("other/late.md"), path: uri("other/late.md"), name: "late.md", type: "markdown" },
    ]));
    expect(explorer.row("other/late.md")).not.toBeNull();
  });
});

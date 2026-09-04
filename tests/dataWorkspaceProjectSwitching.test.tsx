/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataNode, DataPort, Workspace } from "../packages/shared-ui/src/core/types";
import {
  DataWorkspace,
  type DataWorkspaceExplorerSession,
} from "../packages/shared-ui/src/data/DataWorkspace";
import { reconcileDataNodeLists } from "../packages/shared-ui/src/data/explorer/explorerTreeReconciliation";
import { withTestLocalization } from "./testLocalization";
import { createProjectExplorerSessionKey } from "../src/features/data-workspace/useProjectExplorerSession";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("DataWorkspace Project switching", () => {
  it("keys UI sessions by stable Project identity rather than runtime composition identity", () => {
    const first = workspace();
    const reopened = { ...first, id: "runtime-reopened" };

    expect(createProjectExplorerSessionKey(first, [])).toBe(
      createProjectExplorerSessionKey(reopened, []),
    );
  });

  it("preserves descendants when a later parent listing omits nested children", () => {
    const loadedTree: DataNode[] = [{
      id: "folder",
      name: "folder",
      path: "folder",
      type: "folder",
      children: [{
        id: "folder/file.md",
        name: "file.md",
        path: "folder/file.md",
        type: "markdown",
      }],
    }];
    const laterRootListing: DataNode[] = [{
      id: "folder",
      name: "folder",
      path: "folder",
      type: "folder",
    }];

    expect(reconcileDataNodeLists(loadedTree, laterRootListing)[0]?.children).toEqual(
      loadedTree[0]?.children,
    );
  });

  it("deduplicates root hydration shared by the explorer and restored active path", async () => {
    const rootListing = deferred<DataNode[]>();
    const listChildren = vi.fn((folderPath: string | null) => {
      if (folderPath === null) return rootListing.promise;
      return Promise.resolve<DataNode[]>([{
        id: "folder/file.md",
        name: "file.md",
        path: "folder/file.md",
        type: "markdown",
      }]);
    });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(withTestLocalization(
        <DataWorkspace
          workspace={workspace()}
          dataPort={{ listChildren }}
          activePath="folder/file.md"
          showHeader={false}
          showPreviewHeader={false}
          enableMarkdownLinkContentIndexing={false}
        />,
      ));
      await Promise.resolve();
    });

    expect(listChildren.mock.calls.filter(([path]) => path === null)).toHaveLength(1);

    await act(async () => {
      rootListing.resolve([{
        id: "folder",
        name: "folder",
        path: "folder",
        type: "folder",
      }]);
      await flushMicrotasks();
    });

    expect(listChildren.mock.calls.filter(([path]) => path === null)).toHaveLength(1);
    expect(host.querySelector('[data-explorer-path="folder/file.md"]')).not.toBeNull();
  });

  it("renders a cached Project tree immediately while revalidating without visible Loading copy", async () => {
    const rootListing = deferred<DataNode[]>();
    const cachedTree: DataNode[] = [{
      id: "folder",
      name: "folder",
      path: "folder",
      type: "folder",
      children: [{
        id: "folder/file.md",
        name: "file.md",
        path: "folder/file.md",
        type: "markdown",
      }],
    }];
    const session: DataWorkspaceExplorerSession = {
      tree: cachedTree,
      rootLoaded: true,
      expandedPaths: ["folder"],
    };
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(withTestLocalization(
        <DataWorkspace
          workspace={workspace()}
          dataPort={{ listChildren: () => rootListing.promise }}
          initialExplorerSession={session}
          showHeader={false}
          showPreviewHeader={false}
          enableMarkdownLinkContentIndexing={false}
        />,
      ));
      await Promise.resolve();
    });

    expect(host.querySelector('[data-explorer-path="folder/file.md"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Loading");

    await act(async () => {
      rootListing.resolve(cachedTree);
      await flushMicrotasks();
    });
  });

  it("waits for cached root revalidation before restoring an active file absent from stale data", async () => {
    const rootListing = deferred<DataNode[]>();
    const listChildren = vi.fn((folderPath: string | null) => {
      if (folderPath === null) return rootListing.promise;
      return Promise.resolve<DataNode[]>([{
        id: "fresh/file.md",
        name: "file.md",
        path: "fresh/file.md",
        type: "markdown",
      }]);
    });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(withTestLocalization(
        <DataWorkspace
          workspace={workspace()}
          dataPort={{ listChildren }}
          activePath="fresh/file.md"
          initialExplorerSession={{
            tree: [],
            rootLoaded: true,
            expandedPaths: [],
          }}
          loadActiveFileSource={false}
          showHeader={false}
          showPreviewHeader={false}
          enableMarkdownLinkContentIndexing={false}
        />,
      ));
      await Promise.resolve();
    });

    expect(listChildren.mock.calls.filter(([path]) => path === null)).toHaveLength(1);
    expect(listChildren.mock.calls.filter(([path]) => path === "fresh")).toHaveLength(0);

    await act(async () => {
      rootListing.resolve([{
        id: "fresh",
        name: "fresh",
        path: "fresh",
        type: "folder",
      }]);
      await flushMicrotasks();
    });

    expect(listChildren.mock.calls.filter(([path]) => path === null)).toHaveLength(1);
    expect(listChildren.mock.calls.filter(([path]) => path === "fresh")).toHaveLength(1);
    expect(host.querySelector('[data-explorer-path="fresh/file.md"]')).not.toBeNull();
  });

  it("does not spin on an expanded folder whose refresh failed", async () => {
    const cachedFolder: DataNode = {
      id: "folder",
      name: "folder",
      path: "folder",
      type: "folder",
    };
    const listChildren = vi.fn((folderPath: string | null) => (
      folderPath === null
        ? Promise.resolve([cachedFolder])
        : Promise.reject(new Error("Folder is temporarily unavailable"))
    ));
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(withTestLocalization(
        <DataWorkspace
          workspace={workspace()}
          dataPort={{ listChildren }}
          initialExplorerSession={{
            tree: [cachedFolder],
            rootLoaded: true,
            expandedPaths: ["folder"],
          }}
          showHeader={false}
          showPreviewHeader={false}
          enableMarkdownLinkContentIndexing={false}
        />,
      ));
      await flushMicrotasks(16);
    });

    expect(listChildren.mock.calls.filter(([path]) => path === "folder")).toHaveLength(1);
  });

  it("revalidates cached expanded folders once and only after their root", async () => {
    const rootListing = deferred<DataNode[]>();
    const cachedFolder: DataNode = {
      id: "folder",
      name: "folder",
      path: "folder",
      type: "folder",
    };
    const listChildren = vi.fn((folderPath: string | null) => (
      folderPath === null ? rootListing.promise : Promise.resolve<DataNode[]>([])
    ));
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(withTestLocalization(
        <DataWorkspace
          workspace={workspace()}
          dataPort={{ listChildren }}
          initialExplorerSession={{
            tree: [cachedFolder],
            rootLoaded: true,
            expandedPaths: ["folder"],
          }}
          showHeader={false}
          showPreviewHeader={false}
          enableMarkdownLinkContentIndexing={false}
        />,
      ));
      await flushMicrotasks();
    });

    expect(listChildren.mock.calls.filter(([path]) => path === "folder")).toHaveLength(0);

    await act(async () => {
      rootListing.resolve([cachedFolder]);
      await flushMicrotasks();
    });

    expect(listChildren.mock.calls.filter(([path]) => path === "folder")).toHaveLength(1);
  });
});

function workspace(): Workspace {
  return {
    id: "workspace",
    workspaceInstanceId: "workspace-instance",
    name: "Workspace",
    path: "/workspace",
    status: "recording",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function flushMicrotasks(times = 8) {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

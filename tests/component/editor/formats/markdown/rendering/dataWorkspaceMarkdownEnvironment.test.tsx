/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DataWorkspace,
  type DataNode,
  type DataPort,
  type DataWorkspaceState,
  type MarkdownWorkspaceEnvironment,
} from "@puppyone/shared-ui";
import { withTestLocalization } from "../../../../../support/react/localization";
import { MarkdownCodeMirrorEditor } from "../../../../../../packages/shared-ui/src/editor/markdown/MarkdownCodeMirrorEditor";
import { requireEditorView } from "../../../../../support/editor/editorView";
import { markdownLinkGraphFacet } from "../../../../../../packages/shared-ui/src/editor/markdown/core/editor/markdownLivePreviewContext";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("DataWorkspace Markdown environment", () => {
  it("retains the open Markdown table when an unloaded parent folder first loads children", async () => {
    const folder: DataNode = { id: "notes", path: "notes", name: "notes", type: "folder", source: "local" };
    const file: DataNode = { id: "notes/open.md", path: "notes/open.md", name: "open.md", type: "markdown", source: "local" };
    const children = [file, { ...file, id: "notes/other.md", path: "notes/other.md", name: "other.md" }];
    let resolveChildren!: (nodes: DataNode[]) => void;
    const childRequest = new Promise<DataNode[]>((resolve) => { resolveChildren = resolve; });
    const dataPort: DataPort = { listChildren: vi.fn(async (path) => path === "notes" ? childRequest : [folder]) };
    const source = "| Name | Value |\n| --- | --- |\n| one | unchanged<br />value |\n\nParagraph **below** the table.";
    let latestState: DataWorkspaceState | null = null;
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(withTestLocalization(
      <DataWorkspace
        dataPort={dataPort}
        enableMarkdownLinkContentIndexing={false}
        loadActiveFileSource={false}
        showHeader={false}
        workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
        mainSlot={(state) => {
          latestState = state;
          return <MarkdownCodeMirrorEditor
            value={source} readOnly={false} livePreview documentPath="notes/open.md"
            markdownLinkGraph={state.markdownEnvironment.linkGraph}
            markdownLinkCommands={state.markdownEnvironment.linkCommands}
            markdownAssetUrlResolver={state.markdownEnvironment.assetUrlResolver}
            markdownAssetResolverRevision={state.markdownEnvironment.assetResolverRevision}
          />;
        }}
      />,
    )));
    await waitForCondition(() => !!container.querySelector('.cm-md-table-widget') && latestState?.tree.length === 1);
    const view = requireEditorView(container.querySelector<HTMLElement>(".cm-editor")!);
    await waitForCondition(() => view.state.facet(markdownLinkGraphFacet) === latestState!.markdownEnvironment.linkGraph);
    const table = container.querySelector(".cm-md-table-widget");
    const initialGraph = latestState!.markdownEnvironment.linkGraph;
    const row = container.querySelector<HTMLElement>('[data-explorer-path="notes"]')!;
    expect(row).not.toBeNull();
    await act(async () => row.click());
    expect(latestState!.markdownEnvironment.linkGraph).toBe(initialGraph);
    expect(container.querySelector(".cm-md-table-widget")).toBe(table);
    expect(view.state.doc.toString()).toBe(source);
    await act(async () => resolveChildren(children));
    await waitForCondition(() => latestState!.tree[0]?.children?.length === 2);
    await waitForCondition(() => view.state.facet(markdownLinkGraphFacet) === latestState!.markdownEnvironment.linkGraph);
    expect(latestState!.markdownEnvironment.linkGraph).not.toBe(initialGraph);
    expect(container.querySelector(".cm-md-table-widget")).toBe(table);
    expect(requireEditorView(container.querySelector<HTMLElement>(".cm-editor")!)).toBe(view);
    expect(view.state.doc.toString()).toBe(source);
    const loadedGraph = latestState!.markdownEnvironment.linkGraph;
    await act(async () => row.click());
    await act(async () => row.click());
    expect(latestState!.markdownEnvironment.linkGraph).toBe(loadedGraph);
    expect(container.querySelector(".cm-md-table-widget")).toBe(table);
    expect(dataPort.listChildren).toHaveBeenCalledTimes(2);
  });

  it("keeps semantic query and command ports stable across controlled active-pane routing", async () => {
    const nodes: DataNode[] = ["a.md", "b.md", "c.md"].map((path) => ({
      id: path,
      name: path,
      path,
      type: "markdown",
      mimeType: "text/markdown",
      source: "local",
    }));
    const dataPort: DataPort = {
      listChildren: vi.fn(async () => nodes),
    };
    const activePathChanges: string[] = [];
    const readyEnvironments: MarkdownWorkspaceEnvironment[] = [];
    let latestState: DataWorkspaceState | null = null;
    let setActivePath!: React.Dispatch<React.SetStateAction<string | null>>;
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    function Harness() {
      const [activePath, updateActivePath] = React.useState<string | null>("a.md");
      setActivePath = updateActivePath;
      // This closure intentionally changes with activePath. The environment
      // must expose a stable command port rather than its render identity.
      const handleActivePathChange = async (path: string | null) => {
        activePathChanges.push(`${activePath}->${path ?? "null"}`);
        updateActivePath(path);
      };
      return withTestLocalization(
        <DataWorkspace
          activePath={activePath}
          dataPort={dataPort}
          enableMarkdownLinkContentIndexing={false}
          loadActiveFileSource={false}
          showHeader={false}
          workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
          mainSlot={(state) => {
            latestState = state;
            if (state.tree.length === nodes.length) readyEnvironments.push(state.markdownEnvironment);
            return <div data-active-path={state.activePath ?? ""} />;
          }}
          onActivePathChange={handleActivePathChange}
        />,
      );
    }

    await act(async () => root?.render(<Harness />));
    await waitForCondition(() => latestState?.tree.length === nodes.length);
    const initialEnvironment = latestState!.markdownEnvironment;
    const initialDocumentNavigation = latestState!.documentNavigation;
    const initialRevision = initialEnvironment.linkGraph?.revision;

    await act(async () => setActivePath("b.md"));
    await act(async () => setActivePath("c.md"));

    expect(latestState!.markdownEnvironment).toBe(initialEnvironment);
    expect(latestState!.documentNavigation).toBe(initialDocumentNavigation);
    expect(latestState!.markdownEnvironment.linkGraph?.revision).toBe(initialRevision);
    expect(new Set(readyEnvironments)).toEqual(new Set([initialEnvironment]));

    const workspaceReference = initialDocumentNavigation.resolveReference("a.md", "[[b]]");
    expect(workspaceReference).toMatchObject({
      kind: "workspace",
      status: "resolved",
      path: "b.md",
    });
    if (!workspaceReference) throw new Error("Workspace reference did not resolve.");
    await act(async () => {
      await initialDocumentNavigation.openReference(workspaceReference);
      await Promise.resolve();
    });
    expect(activePathChanges.at(-1)).toBe("c.md->b.md");

    await act(async () => {
      latestState!.markdownEnvironment.linkCommands.openPath?.("a.md");
      await Promise.resolve();
    });
    expect(activePathChanges.at(-1)).toBe("b.md->a.md");
  });
});

async function waitForCondition(condition: () => boolean, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (condition()) return;
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 5)));
  }
  throw new Error("Timed out waiting for DataWorkspace state.");
}

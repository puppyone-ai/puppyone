/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataNode } from "../packages/shared-ui/src/core/types";
import { ExplorerTree } from "../packages/shared-ui/src/data/ExplorerTree";
import {
  buildExplorerVisibleModel,
} from "../packages/shared-ui/src/data/explorer/explorerVisibleModel";
import { createExplorerMotionPlan } from "../packages/shared-ui/src/data/explorer/explorerMotionPlan";
import { EXPLORER_VIRTUAL_MAX_MOUNTED_ROWS } from "../packages/shared-ui/src/data/explorer/useExplorerVirtualWindow";
import { withTestLocalization } from "./testLocalization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const originalAnimate = HTMLElement.prototype.animate;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: originalAnimate,
  });
});

describe("Explorer bounded rendering", () => {
  it("builds a stable flattened navigation model independent of selection", () => {
    const nodes: DataNode[] = [{
      id: "folder",
      name: "folder",
      path: "folder",
      type: "folder",
      children: [
        { id: "a", name: "a.md", path: "folder/a.md", type: "markdown" },
        { id: "b", name: "b.md", path: "folder/b.md", type: "markdown" },
      ],
    }];
    const model = buildExplorerVisibleModel(nodes, {
      expandedPaths: new Set(["folder"]),
      loadingLabel: "loading",
    });

    expect(model.rows.map((row) => row.kind === "node" ? row.path : row.key)).toEqual([
      "folder",
      "folder/a.md",
      "folder/b.md",
    ]);
    expect(model.pathToIndex.get("folder/b.md")).toBe(2);
    expect(model.pathToNode.get("folder/a.md")?.name).toBe("a.md");
  });

  it("keeps expanded empty folders structural while retaining explicit loading rows", () => {
    const emptyFolder: DataNode = {
      id: "empty-folder",
      name: "empty-folder",
      path: "empty-folder",
      type: "folder",
      children: [],
    };
    const tail: DataNode = { id: "tail", name: "tail.md", path: "tail.md", type: "markdown" };
    const expanded = buildExplorerVisibleModel([emptyFolder, tail], {
      expandedPaths: new Set([emptyFolder.path]),
      loadingLabel: "loading",
    });
    const loading = buildExplorerVisibleModel([emptyFolder, tail], {
      expandedPaths: new Set([emptyFolder.path]),
      loadingPaths: new Set([emptyFolder.path]),
      loadingLabel: "loading",
    });

    expect(expanded.rows.map((row) => row.kind === "node" ? row.path : row.key)).toEqual([
      emptyFolder.path,
      tail.path,
    ]);
    expect(expanded.pathToIndex.get(tail.path)).toBe(1);
    expect(loading.rows.map((row) => row.kind === "node" ? row.path : row.key)).toEqual([
      emptyFolder.path,
      `${emptyFolder.path}:loading`,
      tail.path,
    ]);
  });

  it("mounts at most the hard row limit for 1,000 visible nodes", () => {
    const nodes = makeNodes(1_000);
    const container = renderExplorer({ nodes, activePath: nodes[0]?.path ?? null });
    const canvas = container.querySelector<HTMLElement>(".explorer-tree-virtual-canvas");

    expect(canvas?.dataset.visibleRowCount).toBe("1000");
    expect(Number(canvas?.dataset.mountedRowCount)).toBeLessThanOrEqual(EXPLORER_VIRTUAL_MAX_MOUNTED_ROWS);
    expect(container.querySelectorAll("[role=treeitem]").length).toBeLessThanOrEqual(
      EXPLORER_VIRTUAL_MAX_MOUNTED_ROWS,
    );
  });

  it("keeps virtual row geometry synchronized with the resolved application scale", () => {
    const nodes = makeNodes(2);
    const container = renderExplorer({ nodes, activePath: nodes[0]?.path ?? null });
    const scroll = container.querySelector<HTMLElement>(".explorer-tree-scroll")!;

    act(() => {
      scroll.style.setProperty("--tree-row-height", "36px");
      document.dispatchEvent(new CustomEvent("puppyone:typography-change", {
        detail: { generation: 1, phase: "applied" },
      }));
    });

    const rows = container.querySelectorAll<HTMLElement>(".explorer-tree-virtual-row");
    expect(rows[1]?.style.transform).toBe("translateY(38px)");
    expect(container.querySelector<HTMLElement>(".explorer-tree-virtual-canvas")?.style.height)
      .toBe("76px");
  });

  it("builds bounded FLIP enter, move and exit instructions without measuring a subtree", () => {
    const folder: DataNode = {
      id: "folder",
      name: "folder",
      path: "folder",
      type: "folder",
      children: [
        { id: "child-a", name: "a.md", path: "folder/a.md", type: "markdown" },
        { id: "child-b", name: "b.md", path: "folder/b.md", type: "markdown" },
      ],
    };
    const tail: DataNode = { id: "tail", name: "tail.md", path: "tail.md", type: "markdown" };
    const collapsed = buildExplorerVisibleModel([folder, tail], {
      expandedPaths: new Set(),
      loadingLabel: "loading",
    });
    const expanded = buildExplorerVisibleModel([folder, tail], {
      expandedPaths: new Set([folder.path]),
      loadingLabel: "loading",
    });
    const enterPlan = createExplorerMotionPlan({
      previousRows: collapsed.rows,
      nextRows: expanded.rows,
      previousMountedRows: collapsed.rows,
      nextMountedRows: expanded.rows,
      rowSize: 32,
      maxMountedRows: EXPLORER_VIRTUAL_MAX_MOUNTED_ROWS,
    });

    expect(enterPlan.instructions.get("folder/a.md")?.kind).toBe("enter");
    expect(enterPlan.instructions.get("tail.md")).toEqual({ kind: "move", offsetY: -64 });
    expect(enterPlan.ghosts).toHaveLength(0);

    const exitPlan = createExplorerMotionPlan({
      previousRows: expanded.rows,
      nextRows: collapsed.rows,
      previousMountedRows: expanded.rows,
      nextMountedRows: collapsed.rows,
      rowSize: 32,
      maxMountedRows: EXPLORER_VIRTUAL_MAX_MOUNTED_ROWS,
    });
    expect(exitPlan.instructions.get("tail.md")).toEqual({ kind: "move", offsetY: 64 });
    expect(exitPlan.ghosts.map((ghost) => ghost.row.key)).toEqual(["folder/a.md", "folder/b.md"]);
    expect(collapsed.rows.length + exitPlan.ghosts.length).toBeLessThanOrEqual(
      EXPLORER_VIRTUAL_MAX_MOUNTED_ROWS,
    );
  });

  it("animates virtualized folder expansion and collapse using transform/opacity only", () => {
    const animate = vi.fn(() => ({ cancel: vi.fn() }));
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: animate,
    });
    const folder: DataNode = {
      id: "folder",
      name: "folder",
      path: "folder",
      type: "folder",
      children: makeNodes(8).map((node) => ({ ...node, path: `folder/${node.path}` })),
    };
    const container = document.createElement("div");
    Object.assign(container.style, { width: "320px", height: "640px" });
    document.body.appendChild(container);
    root = createRoot(container);

    function ControlledExplorer() {
      const [expanded, setExpanded] = React.useState(false);
      return (
        <ExplorerTree
          nodes={[folder]}
          activePath={folder.path}
          selectedPaths={new Set([folder.path])}
          expandedPaths={expanded ? new Set([folder.path]) : new Set()}
          showRoot={false}
          onSelectNode={() => undefined}
          onToggleFolder={(_node, nextExpanded) => setExpanded(nextExpanded)}
        />
      );
    }

    act(() => root?.render(withTestLocalization(<ControlledExplorer />)));
    const folderRow = container.querySelector<HTMLButtonElement>(`[data-explorer-path="${folder.path}"]`)!;
    act(() => folderRow.click());
    expect(container.querySelectorAll('[data-explorer-motion="enter"]').length).toBeGreaterThan(0);
    expect(animate).toHaveBeenCalled();
    expect(Number(container.querySelector<HTMLElement>(".explorer-tree-virtual-canvas")?.dataset.mountedRowCount))
      .toBeLessThanOrEqual(EXPLORER_VIRTUAL_MAX_MOUNTED_ROWS);

    act(() => folderRow.click());
    expect(container.querySelectorAll('[data-explorer-motion="exit"]').length).toBeGreaterThan(0);
    expect(Number(container.querySelector<HTMLElement>(".explorer-tree-virtual-canvas")?.dataset.mountedRowCount))
      .toBeLessThanOrEqual(EXPLORER_VIRTUAL_MAX_MOUNTED_ROWS);
  });

  it("windows to an offscreen active row without mounting the intervening 1,000 rows", async () => {
    const nodes = makeNodes(1_000);
    const container = renderExplorer({ nodes, activePath: nodes[900]?.path ?? null });
    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });

    expect(container.querySelector(`[data-explorer-path="${nodes[900]?.path}"]`)).not.toBeNull();
    expect(container.querySelectorAll("[role=treeitem]").length)
      .toBeLessThanOrEqual(EXPLORER_VIRTUAL_MAX_MOUNTED_ROWS);
  });

  it("re-renders only the old and new mounted rows for an ordinary selection", () => {
    const nodes = makeNodes(100);
    const expandedPaths = new Set<string>();
    const renderNodeActions = vi.fn(() => null);
    const onSelectNode = vi.fn();
    const container = document.createElement("div");
    Object.assign(container.style, { width: "320px", height: "640px" });
    document.body.appendChild(container);
    root = createRoot(container);

    const renderSelection = (index: number) => root?.render(withTestLocalization(
      <ExplorerTree
        nodes={nodes}
        activePath={nodes[index]?.path ?? null}
        selectedPaths={new Set([nodes[index]?.path ?? ""])}
        expandedPaths={expandedPaths}
        showRoot={false}
        onSelectNode={onSelectNode}
        renderNodeActions={renderNodeActions}
      />,
    ));

    act(() => renderSelection(0));
    expect(renderNodeActions.mock.calls.length).toBeGreaterThan(2);
    renderNodeActions.mockClear();
    act(() => renderSelection(1));

    expect(renderNodeActions).toHaveBeenCalledTimes(2);
    expect(renderNodeActions.mock.calls.map(([node]) => node.path).sort()).toEqual([
      nodes[0]?.path,
      nodes[1]?.path,
    ].sort());
  });

  it("keeps keyboard navigation and additive/range selection on the full model", () => {
    const nodes = makeNodes(200);
    const onSelectNode = vi.fn();
    const container = renderExplorer({ nodes, activePath: nodes[0]?.path ?? null, onSelectNode });
    const first = container.querySelector<HTMLButtonElement>(`[data-explorer-path="${nodes[0]?.path}"]`)!;

    act(() => first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(onSelectNode).toHaveBeenCalledWith(nodes[1], undefined);

    act(() => first.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true })));
    expect(onSelectNode).toHaveBeenLastCalledWith(nodes[0], expect.objectContaining({ additive: true }));

    act(() => first.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })));
    expect(onSelectNode).toHaveBeenLastCalledWith(nodes[0], expect.objectContaining({ range: true }));
  });

  it("preserves folder drag/drop behavior with virtualized rows", () => {
    const source: DataNode = { id: "source", name: "source.md", path: "source.md", type: "markdown" };
    const target: DataNode = { id: "target", name: "target", path: "target", type: "folder", children: [] };
    const onMoveNode = vi.fn(async () => undefined);
    const container = renderExplorer({
      nodes: [source, target],
      activePath: source.path,
      canMoveNodes: true,
      onMoveNode,
    });
    const sourceRow = container.querySelector<HTMLButtonElement>(`[data-explorer-path="${source.path}"]`)!;
    const targetRow = container.querySelector<HTMLButtonElement>(`[data-explorer-path="${target.path}"]`)!;
    Object.defineProperty(targetRow, "getBoundingClientRect", {
      value: () => ({ top: 0, bottom: 30, left: 0, right: 240, width: 240, height: 30, x: 0, y: 0, toJSON() {} }),
    });
    const dataTransfer = new DataTransfer();
    const dragEvent = (type: string) => {
      const event = new MouseEvent(type, { bubbles: true, clientY: 5 });
      Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
      return event;
    };

    act(() => sourceRow.dispatchEvent(dragEvent("dragstart")));
    act(() => targetRow.dispatchEvent(dragEvent("dragenter")));
    act(() => targetRow.dispatchEvent(dragEvent("dragover")));
    expect(targetRow.classList.contains("drop-target")).toBe(true);

    act(() => targetRow.dispatchEvent(dragEvent("dragleave")));
    expect(targetRow.classList.contains("drop-target")).toBe(false);
    expect(container.querySelector(".explorer-tree-shell")?.classList.contains("is-dragging-node")).toBe(true);

    act(() => targetRow.dispatchEvent(dragEvent("dragenter")));
    act(() => targetRow.dispatchEvent(dragEvent("dragover")));
    act(() => targetRow.dispatchEvent(dragEvent("drop")));

    expect(onMoveNode).toHaveBeenCalledWith(source, target.path);
    expect(targetRow.classList.contains("drop-target")).toBe(false);
    expect(container.querySelector(".explorer-tree-shell")?.classList.contains("is-dragging-node")).toBe(false);
  });
});

function renderExplorer({
  nodes,
  activePath,
  onSelectNode = vi.fn(),
  canMoveNodes = false,
  onMoveNode,
}: {
  nodes: DataNode[];
  activePath: string | null;
  onSelectNode?: (node: DataNode | null, intent?: { additive?: boolean; range?: boolean }) => void;
  canMoveNodes?: boolean;
  onMoveNode?: (node: DataNode, targetFolderPath: string | null) => void | Promise<void>;
}) {
  const container = document.createElement("div");
  Object.assign(container.style, { width: "320px", height: "640px" });
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(
    <ExplorerTree
      nodes={nodes}
      activePath={activePath}
      selectedPaths={activePath ? new Set([activePath]) : new Set()}
      expandedPaths={new Set()}
      showRoot={false}
      canMoveNodes={canMoveNodes}
      onMoveNode={onMoveNode}
      onSelectNode={onSelectNode}
    />,
  )));
  return container;
}

function makeNodes(count: number): DataNode[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `node-${index}`,
    name: `document-${index}.md`,
    path: `document-${index}.md`,
    type: "markdown" as const,
  }));
}

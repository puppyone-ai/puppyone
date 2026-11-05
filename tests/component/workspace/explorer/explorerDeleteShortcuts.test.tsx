/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExplorerTree, type DataNode } from "@puppyone/shared-ui";
import { renderWithTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const nodes: DataNode[] = [
  { id: "a.png", name: "a.png", path: "a.png", type: "image" },
  { id: "b.png", name: "b.png", path: "b.png", type: "image" },
  { id: "docs", name: "docs", path: "docs", type: "folder", children: null },
];

function mount({
  selectedPaths = new Set(["a.png"]),
  onDeleteNodes = vi.fn(),
  deleteWithMetaBackspace = true,
  hidden = false,
  renderNodeActions,
}: {
  selectedPaths?: ReadonlySet<string>;
  onDeleteNodes?: (nodes: DataNode[], rect: DOMRect) => void | Promise<void>;
  deleteWithMetaBackspace?: boolean;
  hidden?: boolean;
  renderNodeActions?: () => React.ReactNode;
} = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const treeProps = {
    nodes,
    activePath: null,
    expandedPaths: new Set<string>(),
    showRoot: false,
    selectedPaths,
    onSelectNode: vi.fn(),
    onDeleteNodes,
    deleteWithMetaBackspace,
    ...(renderNodeActions ? { renderNodeActions } : {}),
  };
  act(() => renderWithTestLocalization(root!, hidden
    ? <div aria-hidden="true"><ExplorerTree {...treeProps} /></div>
    : <ExplorerTree {...treeProps} />));
  const row = (path: string) => container.querySelector<HTMLElement>(`[data-explorer-path="${path}"]`)!;
  return { container, row, onDeleteNodes };
}

function keydown(target: HTMLElement, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(event); });
  return event;
}

describe("Explorer delete shortcuts", () => {
  it("deletes the selection with Meta+Backspace when the host enables the chord", () => {
    const { row, onDeleteNodes } = mount();
    row("a.png").focus();
    const event = keydown(row("a.png"), { key: "Backspace", metaKey: true });
    expect(onDeleteNodes).toHaveBeenCalledTimes(1);
    const [called, anchor] = (onDeleteNodes as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(called.map((node: DataNode) => node.path)).toEqual(["a.png"]);
    expect(anchor).toBeInstanceOf(DOMRect);
    expect(event.defaultPrevented).toBe(true);
  });

  it("deletes with an unmodified Delete", () => {
    const { row, onDeleteNodes } = mount();
    row("a.png").focus();
    expect(keydown(row("a.png"), { key: "Delete" }).defaultPrevented).toBe(true);
    expect(onDeleteNodes).toHaveBeenCalledTimes(1);
  });

  it("ignores the chord when the host has not enabled it", () => {
    const { row, onDeleteNodes } = mount({ deleteWithMetaBackspace: false });
    row("a.png").focus();
    const event = keydown(row("a.png"), { key: "Backspace", metaKey: true });
    expect(onDeleteNodes).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores plain Backspace and other modifier combinations", () => {
    const { row, onDeleteNodes } = mount();
    row("a.png").focus();
    for (const init of [
      { key: "Backspace" },
      { key: "Delete", shiftKey: true },
      { key: "Delete", ctrlKey: true },
      { key: "Delete", altKey: true },
      { key: "Delete", metaKey: true },
    ]) {
      keydown(row("a.png"), init);
    }
    expect(onDeleteNodes).not.toHaveBeenCalled();
  });

  it("refuses when the focused row is not part of the selection", () => {
    const { row, onDeleteNodes } = mount();
    row("b.png").focus();
    keydown(row("b.png"), { key: "Delete" });
    expect(onDeleteNodes).not.toHaveBeenCalled();
  });

  it("refuses the whole request when a protected workspace root is selected", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onDeleteNodes = vi.fn();
    act(() => renderWithTestLocalization(root!,
      <ExplorerTree
        nodes={[{ id: "root", name: "Root", path: "root", type: "folder", workspaceFolderRoot: true, children: null }, ...nodes]}
        activePath={null}
        expandedPaths={new Set()}
        showRoot={false}
        selectedPaths={new Set(["root", "a.png"])}
        onSelectNode={vi.fn()}
        onDeleteNodes={onDeleteNodes}
        deleteWithMetaBackspace
      />,
    ));
    const row = container.querySelector<HTMLElement>('[data-explorer-path="root"]')!;
    row.focus();
    keydown(row, { key: "Delete" });
    expect(onDeleteNodes).not.toHaveBeenCalled();
  });

  it("stays inert while the tree is hidden behind another view", () => {
    const { row, onDeleteNodes } = mount({ hidden: true });
    row("a.png").focus();
    keydown(row("a.png"), { key: "Delete" });
    expect(onDeleteNodes).not.toHaveBeenCalled();
  });

  it("leaves keys pressed on a row control to that control", () => {
    const { container, onDeleteNodes } = mount({
      renderNodeActions: () => <button type="button">More</button>,
    });
    const button = container.querySelector<HTMLButtonElement>(".tree-row-actions button")!;
    button.focus();
    keydown(button, { key: "Delete" });
    expect(onDeleteNodes).not.toHaveBeenCalled();
  });

  it("focuses the row when its body is clicked", () => {
    const { row } = mount();
    const label = row("b.png").querySelector<HTMLElement>(".tree-label")!;
    act(() => { label.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(document.activeElement).toBe(row("b.png"));
  });

  it("does nothing without a host callback", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => renderWithTestLocalization(root!,
      <ExplorerTree
        nodes={nodes}
        activePath={null}
        expandedPaths={new Set()}
        showRoot={false}
        selectedPaths={new Set(["a.png"])}
        onSelectNode={vi.fn()}
      />,
    ));
    const row = container.querySelector<HTMLElement>('[data-explorer-path="a.png"]')!;
    row.focus();
    expect(keydown(row, { key: "Delete" }).defaultPrevented).toBe(false);
  });
});

/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataWorkspace, type DataCapabilities, type DataPort, type Workspace } from "../../../../src/shared-ui";
import { renderWithTestLocalization, withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const workspace: Workspace = { id: "w1", name: "w1", path: "/w1", status: "recording" } as Workspace;

function port(deleteNode?: NonNullable<DataPort["deleteNode"]>): DataPort {
  return {
    listChildren: vi.fn<NonNullable<DataPort["listChildren"]>>(async () => [
      { id: "a.png", name: "a.png", path: "a.png", type: "image" },
      { id: "b.png", name: "b.png", path: "b.png", type: "image" },
    ]),
    resolveNode: vi.fn<NonNullable<DataPort["resolveNode"]>>(async (path) => ({ id: path, name: path, path, type: "image" })),
    readFile: vi.fn<NonNullable<DataPort["readFile"]>>(async (path) => ({ path, name: path, type: "image", content: "" })),
    ...(deleteNode ? { deleteNode } : {}),
  };
}

async function mount({
  deleteNode,
  deleteCapability = true,
  onDeleteNodes = vi.fn(),
}: {
  deleteNode?: NonNullable<DataPort["deleteNode"]>;
  deleteCapability?: boolean;
  onDeleteNodes?: ((nodes: { path: string }[], rect: DOMRect) => void | Promise<void>) | null;
} = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(withTestLocalization(
      <DataWorkspace
        workspace={workspace}
        dataPort={port(deleteNode ?? vi.fn(async () => {}))}
        capabilities={{ delete: deleteCapability } as DataCapabilities}
        showHeader={false}
        showExplorerRoot={false}
        showPreviewHeader={false}
        enableMarkdownLinkContentIndexing={false}
        onDeleteNodes={onDeleteNodes ?? undefined}
        deleteWithMetaBackspace
      />,
    ));
    await Promise.resolve();
    await Promise.resolve();
  });
  const row = container.querySelector<HTMLElement>('[data-explorer-path="a.png"]')!;
  return { container, row, onDeleteNodes };
}

async function selectRow(row: HTMLElement) {
  await act(async () => {
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    for (let tick = 0; tick < 4; tick += 1) await Promise.resolve();
  });
}

describe("explorer delete bindings", () => {
  it("forwards a Delete to the host when deletion is available", async () => {
    const { row, onDeleteNodes } = await mount();
    await selectRow(row);
    row.focus();
    await act(async () => {
      row.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    });
    expect(onDeleteNodes).toHaveBeenCalledTimes(1);
  });

  it("stays inert when the workspace declares no delete capability", async () => {
    const { row, onDeleteNodes } = await mount({ deleteCapability: false });
    await selectRow(row);
    row.focus();
    await act(async () => {
      row.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    });
    expect(onDeleteNodes).not.toHaveBeenCalled();
  });

  it("stays inert without a host callback", async () => {
    const { row } = await mount({ onDeleteNodes: null });
    await selectRow(row);
    row.focus();
    const event = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
    await act(async () => { row.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
  });
});

/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DataWorkspace,
  createWorkbenchWorkspace,
  createWorkspaceResourceUri,
  type DataPort,
  type Workspace,
} from "../../../../packages/shared-ui/src";
import { createWorkbenchDataService } from "../../../../src/features/data-workspace/workbenchDataPort";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("multi-root Explorer", () => {
  it("shows every attached Project as one expandable root in a shared Sidebar", async () => {
    const workbench = createWorkbenchWorkspace([
      workspace("todo", "To-Do-List", "/todo"),
      workspace("notes", "Notes", "/notes"),
    ]);
    const service = createWorkbenchDataService(workbench, {
      createProvider: (folder) => provider(folder.name),
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(withTestLocalization(
        <DataWorkspace
          workspace={workbench.folders[0]!.workspace}
          dataPort={service.dataPort}
          defaultExpandedPaths={service.rootResourcePaths}
          showHeader={false}
          showExplorerRoot={false}
          showPreviewHeader={false}
          enableMarkdownLinkContentIndexing={false}
        />,
      ));
      await Promise.resolve();
      await Promise.resolve();
    });

    const rootRows = [...container.querySelectorAll<HTMLElement>(".workspace-folder-root")];
    expect(rootRows.map((row) => row.textContent)).toEqual(["To-Do-List", "Notes"]);
    expect(rootRows.every((row) => row.getAttribute("aria-expanded") === "true")).toBe(true);
    expect(rootRows.every((row) => row.getAttribute("draggable") !== "true")).toBe(true);
    expect(container.querySelector(".explorer-tree-shell")?.getAttribute("data-workspace-grouping")).toBe("soft");
    expect(rootRows.every((row) => row.classList.contains("workspace-group-header"))).toBe(true);
    expect(container.querySelectorAll(".tree-workspace-group-divider")).toHaveLength(2);
    const documentRows = [...container.querySelectorAll<HTMLElement>('[data-explorer-path$="document.md"]')];
    expect(documentRows.every((row) => row.style.getPropertyValue("--depth") === "0")).toBe(true);
    expect(documentRows.every((row) => (
      row.closest(".explorer-tree-motion-shell")?.getAttribute("data-depth") === "0"
    ))).toBe(true);
    expect(documentRows.every((row) => row.getAttribute("aria-level") === "2")).toBe(true);
    expect(container.textContent).toContain("To-Do-List document");
    expect(container.textContent).toContain("Notes document");
  });

  it("keeps a single Project flat without workspace group decoration", async () => {
    const workbench = createWorkbenchWorkspace([
      workspace("todo", "To-Do-List", "/todo"),
    ]);
    const service = createWorkbenchDataService(workbench, {
      createProvider: (folder) => provider(folder.name),
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(withTestLocalization(
        <DataWorkspace
          workspace={workbench.folders[0]!.workspace}
          dataPort={service.dataPort}
          showHeader={false}
          showExplorerRoot={false}
          showPreviewHeader={false}
          enableMarkdownLinkContentIndexing={false}
        />,
      ));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector(".explorer-tree-shell")?.hasAttribute("data-workspace-grouping")).toBe(false);
    expect(container.querySelector(".workspace-group-header")).toBeNull();
    expect(container.querySelector(".tree-workspace-group-divider")).toBeNull();
    const documentRow = container.querySelector<HTMLElement>('[data-explorer-path$="document.md"]');
    expect(documentRow?.style.getPropertyValue("--depth")).toBe("0");
    expect(documentRow?.getAttribute("aria-level")).toBe("1");
  });

  it("opens same-named documents through distinct Resource URIs", async () => {
    const workbench = createWorkbenchWorkspace([
      workspace("todo", "To-Do-List", "/todo"),
      workspace("notes", "Notes", "/notes"),
    ]);
    const service = createWorkbenchDataService(workbench, {
      createProvider: (folder) => provider(folder.name),
    });
    const first = createWorkspaceResourceUri(workbench.folders[0]!.uri, "document.md");
    const second = createWorkspaceResourceUri(workbench.folders[1]!.uri, "document.md");

    expect(first).not.toBe(second);
    await expect(service.dataPort.readFile?.(first)).resolves.toMatchObject({ content: "To-Do-List" });
    await expect(service.dataPort.readFile?.(second)).resolves.toMatchObject({ content: "Notes" });
  });
});

function workspace(id: string, name: string, path: string): Workspace {
  return {
    id,
    workspaceInstanceId: `instance-${id}`,
    name,
    path,
    status: "recording",
  };
}

function provider(name: string): DataPort {
  return {
    listChildren: vi.fn(async () => [{
      id: "document.md",
      name: `${name} document.md`,
      path: "document.md",
      type: "markdown",
    }]),
    resolveNode: vi.fn(async (path) => ({
      id: path,
      name: path,
      path,
      type: "markdown",
    })),
    readFile: vi.fn(async (path) => ({
      path,
      name: path,
      type: "markdown",
      content: name,
    })),
  };
}

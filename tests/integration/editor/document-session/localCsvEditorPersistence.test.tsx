/**
 * @vitest-environment happy-dom
 */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataNode, FileContent } from "../../../../packages/shared-ui/src/core/types";
import { DataWorkspace } from "../../../../packages/shared-ui/src/data/DataWorkspace";
import { flushActiveDocumentSessions } from "../../../../packages/shared-ui/src/editor/document-session/activeDocumentSessions";
import { createLocalDataPort } from "../../../../src/lib/localFiles";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let temporaryWorkspace: string | null = null;
let originalDesktopBridge: Window["puppyoneDesktop"];

afterEach(async () => {
  act(() => root?.unmount());
  root = null;
  await act(async () => Promise.resolve());
  await flushActiveDocumentSessions("app-close").catch(() => undefined);
  document.body.innerHTML = "";
  window.puppyoneDesktop = originalDesktopBridge;
  if (temporaryWorkspace) await rm(temporaryWorkspace, { recursive: true, force: true });
  temporaryWorkspace = null;
  vi.restoreAllMocks();
});

describe("local CSV editor persistence", () => {
  it("edits a spreadsheet-classified CSV and persists its serialized snapshot", async () => {
    const source = "Column 1,Column 2";
    const workspaceRoot = await mkdtemp(join(tmpdir(), "puppyone-local-csv-editor-"));
    temporaryWorkspace = workspaceRoot;
    await writeFile(join(workspaceRoot, "Untitled.csv"), source, "utf8");

    const nodes: DataNode[] = [{
      id: "Untitled.csv",
      path: "Untitled.csv",
      name: "Untitled.csv",
      type: "spreadsheet",
      mimeType: "text/csv; charset=utf-8",
    }];
    const bridge = createFilesystemBridge(workspaceRoot, nodes);
    originalDesktopBridge = window.puppyoneDesktop;
    window.puppyoneDesktop = bridge as Window["puppyoneDesktop"];

    const container = await renderWorkspace(workspaceRoot, "Untitled.csv");
    await waitFor(() => container.querySelector(".csv-table-editor") !== null);

    const editor = container.querySelector<HTMLElement>(".csv-table-editor");
    const firstCell = container.querySelector<HTMLInputElement>(".csv-table-editor__body-cell input");
    if (!editor || !firstCell) throw new Error(`CSV editor did not mount: ${container.textContent ?? ""}`);

    expect(editor.getAttribute("data-readonly")).toBeNull();
    expect(firstCell.readOnly).toBe(false);
    expect(container.querySelector(".csv-table-editor__table")).toBeInstanceOf(HTMLTableElement);
    expect(container.querySelectorAll(".csv-table-editor__structure-button")).toHaveLength(2);
    expect(container.querySelector(".csv-table-editor__settings-button")).toBeInstanceOf(
      HTMLButtonElement,
    );
    expect(container.querySelector(".csv-table-editor__settings-popover")).toBeNull();
    expect(container.querySelector(".csv-table-editor__toolbar")).toBeNull();

    act(() => {
      setInputValue(firstCell, "Updated");
      firstCell.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await waitFor(async () => (
      await readFile(join(workspaceRoot, "Untitled.csv"), "utf8")
    ) === "Updated,Column 2");

    expect(bridge.writeFile).toHaveBeenCalledWith(expect.objectContaining({
      rootPath: workspaceRoot,
      path: "Untitled.csv",
      content: "Updated,Column 2",
      expectedVersion: fingerprint(source),
    }));

    const addColumn = container.querySelector<HTMLButtonElement>(".csv-table-editor__add-column");
    if (!addColumn) throw new Error("CSV add-column affordance did not mount.");
    act(() => addColumn.click());
    await waitFor(async () => (
      await readFile(join(workspaceRoot, "Untitled.csv"), "utf8")
    ) === "Updated,Column 2,");

    const addRow = container.querySelector<HTMLButtonElement>(".csv-table-editor__add-row");
    if (!addRow) throw new Error("CSV add-row affordance did not mount.");
    act(() => addRow.click());
    await waitFor(async () => (
      await readFile(join(workspaceRoot, "Untitled.csv"), "utf8")
    ) === "Updated,Column 2,\n,,");

    const resizeHandle = container.querySelector<HTMLButtonElement>(".csv-table-editor__resize-handle");
    if (!resizeHandle) throw new Error("CSV resize handle did not mount.");
    act(() => resizeHandle.click());
    const expansionTarget = document.querySelector<HTMLButtonElement>(
      ".csv-table-editor__resize-picker-cell[data-added-rows='2'][data-added-columns='2']",
    );
    if (!expansionTarget) throw new Error("CSV expansion target did not mount.");
    act(() => expansionTarget.click());

    const expandedSnapshot = "Updated,Column 2,,,\n,,,,\n,,,,\n,,,,";
    await waitFor(async () => (
      await readFile(join(workspaceRoot, "Untitled.csv"), "utf8")
    ) === expandedSnapshot);

    act(() => {
      setInputValue(firstCell, "Persisted");
      firstCell.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const editedExpandedSnapshot = "Persisted,Column 2,,,\n,,,,\n,,,,\n,,,,";
    await waitFor(async () => (
      await readFile(join(workspaceRoot, "Untitled.csv"), "utf8")
    ) === editedExpandedSnapshot);

    expect(container.querySelectorAll(".csv-table-editor__table tbody tr")).toHaveLength(4);
    expect(container.querySelectorAll(
      ".csv-table-editor__table tbody tr:first-child td[data-csv-column]",
    )).toHaveLength(5);
  });
});

function createFilesystemBridge(rootPath: string, nodes: DataNode[]) {
  const listFolderChildren = vi.fn(async (request: { rootPath: string; folderPath: string | null }) => {
    expect(request.rootPath).toBe(rootPath);
    return request.folderPath === null ? nodes : [];
  });
  const readWorkspaceFile = vi.fn(async (request: { rootPath: string; path: string }): Promise<FileContent> => {
    expect(request.rootPath).toBe(rootPath);
    const content = await readFile(join(rootPath, request.path), "utf8");
    return {
      path: request.path,
      name: request.path,
      type: "spreadsheet",
      content,
      mimeType: "text/csv; charset=utf-8",
      version: fingerprint(content),
    };
  });
  const writeWorkspaceFile = vi.fn(async (request: {
    rootPath: string;
    path: string;
    content: string;
    expectedVersion?: string | null;
  }) => {
    expect(request.rootPath).toBe(rootPath);
    const absolutePath = join(rootPath, request.path);
    const currentContent = await readFile(absolutePath, "utf8");
    if (request.expectedVersion && request.expectedVersion !== fingerprint(currentContent)) {
      throw new Error("local file version conflict");
    }
    await writeFile(absolutePath, request.content, "utf8");
    return { ok: true as const, version: fingerprint(request.content) };
  });
  return {
    listFolderChildren,
    readFile: readWorkspaceFile,
    writeFile: writeWorkspaceFile,
  };
}

async function renderWorkspace(rootPath: string, activePath: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(withTestLocalization(
      <DataWorkspace
        workspace={{ id: rootPath, name: "Local", path: rootPath, status: "recording" }}
        dataPort={createLocalDataPort(rootPath)}
        defaultActivePath={activePath}
        editorSaveMode="auto"
        showHeader={false}
        showPreviewHeader={false}
        hidePreviewSourceView
        enableMarkdownLinkContentIndexing={false}
      />,
    ));
  });
  return container;
}

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
}

async function waitFor(assertion: () => boolean | Promise<boolean>, attempts = 200): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await assertion()) return;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 5));
    });
  }
  throw new Error("Timed out waiting for local CSV editor state.");
}

function fingerprint(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

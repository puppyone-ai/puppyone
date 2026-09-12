/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkbenchWorkspace,
  createWorkspaceResourceUri,
  EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT,
  type DataNode,
  type DataPort,
  type FileContent,
  type Workspace,
  type WorkspaceContentChange,
} from "@puppyone/shared-ui";
import { closeAllDocumentWorkingCopies } from "../../../../packages/shared-ui/src/editor/document-session/documentWorkingCopies";
import { appendWorkbenchWorkspaceContentChange } from "../../../../src/features/data-workspace/workbenchWorkspaceContentChange";
import { EditorPaneDocumentRuntime } from "../../../../src/features/editor-workbench/runtime/EditorPaneDocumentRuntime";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(async () => {
  act(() => root?.unmount());
  root = null;
  await closeAllDocumentWorkingCopies("test-cleanup").catch(() => undefined);
  document.body.innerHTML = "";
});

describe("P0 multi-root open-editor mutation delivery", () => {
  it("reloads both same-name open files when two root events are React-batched into one render", async () => {
    const workbench = createWorkbenchWorkspace([
      workspace("alpha", "/workspaces/alpha"),
      workspace("beta", "/workspaces/beta"),
    ]);
    const [alpha, beta] = workbench.folders;
    const alphaResource = createWorkspaceResourceUri(alpha!.uri, "README.md");
    const betaResource = createWorkspaceResourceUri(beta!.uri, "README.md");
    const storage = new Map<string, FileContent>([
      [alphaResource, content(alphaResource, "alpha v1", "alpha-v1")],
      [betaResource, content(betaResource, "beta v1", "beta-v1")],
    ]);
    const persist = vi.fn(async () => ({ ok: true as const, version: "unexpected" }));
    const readFile = vi.fn(async (path: string) => storage.get(path)!);
    const dataPort: DataPort = {
      listChildren: vi.fn(async () => []),
      readFile,
      documentPersistence: {
        kind: "local-fs",
        storageIdentity: "test:multi-root-mutation",
        persist,
      },
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const render = (refreshKey: WorkspaceContentChange) => root!.render(withTestLocalization(
      <>
        {pane(alphaResource, alpha!.workspace, dataPort, refreshKey)}
        {pane(betaResource, beta!.workspace, dataPort, refreshKey)}
      </>,
    ));
    let journal: WorkspaceContentChange = { sequence: 0, entries: [] };

    await act(async () => render(journal));
    await waitFor(
      () => editorContents(container).join("|") === "alpha v1|beta v1",
      () => `Initial editors failed: ${container.innerHTML}`,
    );

    storage.set(alphaResource, content(alphaResource, "alpha from Terminal", "alpha-v2"));
    storage.set(betaResource, content(betaResource, "beta from sidebar Agent", "beta-v2"));
    // These functional state updates may be batched by React. The final token
    // must retain both roots even though the UI renders only once.
    journal = appendWorkbenchWorkspaceContentChange(journal, workbench, {
      workspaceFolderId: alpha!.id,
      paths: ["README.md"],
    });
    journal = appendWorkbenchWorkspaceContentChange(journal, workbench, {
      workspaceFolderId: beta!.id,
      paths: ["README.md"],
    });
    await act(async () => render(journal));

    await waitFor(
      () => editorContents(container).join("|")
        === "alpha from Terminal|beta from sidebar Agent",
      () => `Batched multi-root update failed: ${container.innerHTML}`,
    );
    expect(readFile.mock.calls.filter(([path]) => path === alphaResource)).toHaveLength(2);
    expect(readFile.mock.calls.filter(([path]) => path === betaResource)).toHaveLength(2);
    expect(persist).not.toHaveBeenCalled();

    journal = appendWorkbenchWorkspaceContentChange(journal, workbench, {
      workspaceFolderId: alpha!.id,
      paths: ["unrelated.md"],
    });
    await act(async () => render(journal));
    await act(async () => Promise.resolve());
    expect(readFile).toHaveBeenCalledTimes(4);
  });
});

function pane(
  resource: string,
  workspaceValue: Workspace,
  dataPort: DataPort,
  refreshKey: WorkspaceContentChange,
) {
  const node: DataNode = {
    id: resource,
    path: resource,
    name: "README.md",
    type: "markdown",
  };
  return (
    <EditorPaneDocumentRuntime
      key={resource}
      aiEditFile={null}
      dataPort={dataPort}
      editor={{ id: resource, resource, label: "README.md" }}
      editorInteractionPreferences={{
        showSaveStatus: false,
        markdownBlockDragEnabled: false,
      }}
      fileIconTheme="default"
      markdownEnvironment={EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT}
      refreshKey={refreshKey}
      treeNode={node}
      workspaceId={workspaceValue.id}
      workspaceRoot={workspaceValue.path}
      markdownDialect="puppy-gfm"
    />
  );
}

function content(path: string, value: string, version: string): FileContent {
  return {
    path,
    name: "README.md",
    type: "markdown",
    content: value,
    version,
  };
}

function editorContents(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>(".cm-editor")]
    .map((editor) => EditorView.findFromDOM(editor).state.doc.toString());
}

function workspace(id: string, path: string): Workspace {
  return {
    id,
    workspaceInstanceId: id,
    name: id,
    path,
    status: "recording",
  };
}

async function waitFor(
  assertion: () => boolean,
  failure: () => string,
  attempts = 400,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (assertion()) return;
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 5)));
  }
  throw new Error(failure());
}

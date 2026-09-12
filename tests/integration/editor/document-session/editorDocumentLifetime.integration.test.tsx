import { requireEditorView } from "../../../support/editor/editorView";
/** @vitest-environment happy-dom */
import { isolateHistory, redo, undo, undoDepth } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataPort, DocumentDataNode, DocumentPersistencePort } from "../../../../packages/shared-ui/src/core/types";
import { createWorkspaceContentChange } from "../../../../packages/shared-ui/src/core/workspaceContentChange";
import { CodeMirrorDocumentModel } from "../../../../packages/shared-ui/src/editor/document-session/CodeMirrorDocumentModel";
import { DocumentSessionBoundary } from "../../../../packages/shared-ui/src/editor/document-session/DocumentSessionBoundary";
import { closeAllDocumentWorkingCopies, getOrCreateDocumentWorkingCopy } from "../../../../packages/shared-ui/src/editor/document-session/documentWorkingCopies";
import { MarkdownCodeMirrorEditor } from "../../../../packages/shared-ui/src/editor/markdown/MarkdownCodeMirrorEditor";
import { getDocumentInputRuntime, invalidateDocumentInputs, retireAllDocumentInputs } from "../../../../packages/shared-ui/src/editor/resource/DocumentInputRuntime";
import { EditorTaskBoundary, useEditorTaskOwner } from "../../../../packages/shared-ui/src/editor/runtime/EditorTaskContext";
import { holdEditorRuntimeAdmission } from "../../../../packages/shared-ui/src/editor/runtime/editorRuntimeAdmission";
import { CodeMirrorCodeEditor } from "../../../../packages/shared-ui/src/editor/viewers/code/CodeMirrorCodeEditor";
import { TextEditorFrame } from "../../../../packages/shared-ui/src/editor/viewers/shared/TextEditorFrame";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
it("restarts visible runtime owners after a cancelled window close without remounting the document", async () => {
  const owners: unknown[] = [];
  function Probe() { owners.push(useEditorTaskOwner()); return null; }
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<EditorTaskBoundary storageIdentity="close-cancel" resource="note.pdf"><Probe /></EditorTaskBoundary>));
  const original = owners.at(-1);
  const release = holdEditorRuntimeAdmission();
  expect(owners.at(-1)).toBe(original);
  await act(async () => release());
  expect(owners.at(-1)).not.toBe(original);
  expect(owners.at(-1)).toMatchObject({ scope: "close-cancel", instance: "note.pdf" });
});

it("bounds active history while preserving the newest edits and retained redo", () => {
  const model = new CodeMirrorDocumentModel("");
  const first = new EditorView({ state: model.createViewState([]),
    dispatchTransactions: (transactions, view) => model.acceptTransactions(transactions, view) });
  model.attachView(first);
  for (let index = 0; index < 220; index++) first.dispatch({ changes: { from: first.state.doc.length, insert: "x" }, annotations: isolateHistory.of("full") });
  expect(undoDepth(first.state)).toBe(200);
  expect(undo(first)).toBe(true);
  model.detachView(first); first.destroy();
  const second = new EditorView({ state: model.createViewState([]),
    dispatchTransactions: (transactions, view) => model.acceptTransactions(transactions, view) });
  model.attachView(second);
  expect(redo(second)).toBe(true);
  expect(model.readSnapshot().content).toHaveLength(220);
  model.detachView(second); second.destroy(); model.dispose();
});
afterEach(async () => {
  await act(async () => { root?.unmount(); root = null; await closeAllDocumentWorkingCopies("app-close"); });
  retireAllDocumentInputs(); document.body.innerHTML = "";
});

describe.each(["code", "markdown"] as const)("%s document lifetime", (kind) => {
  it("retains undo/redo across view destruction without writing on reattach", async () => {
    let disk = "alpha";
    const persist = vi.fn<NonNullable<DataPort["documentPersistence"]>["persist"]>(async (request) => { disk = request.content; return { ok: true as const, version: disk }; });
    const persistence: DocumentPersistencePort = { kind: "local-fs", storageIdentity: `retention:${kind}`, persist };
    const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    const render = (visible: boolean) => root!.render(withTestLocalization(visible ? <DocumentSessionBoundary
      documentId={`a.${kind === "markdown" ? "md" : "txt"}`} initialContent={disk} initialVersion={disk} saveMode="auto" persistence={persistence}>
      <TextEditorFrame nodeName="a" defaultMode="live" documentId="a" content={disk} canEdit hideSourceView sourceSnapshotMode renderLive={(content, controls) => kind === "code"
        ? <CodeMirrorCodeEditor content={content} readOnly={false} onSnapshotPortChange={controls.onSnapshotPortChange} onSourceRevisionChange={controls.onSourceRevisionChange} />
        : <MarkdownCodeMirrorEditor value={content} readOnly={false} livePreview={false} onSnapshotPortChange={controls.onSnapshotPortChange} onSourceRevisionChange={controls.onSourceRevisionChange} />
      } />
    </DocumentSessionBoundary> : <div>Another document</div>));
    await act(async () => render(true));
    const original = view(container);
    await act(async () => original.dispatch({ changes: { from: 5, insert: " edited" }, userEvent: "input.type" }));
    expect(disk).toBe("alpha edited");
    await act(async () => render(false));
    const saves = persist.mock.calls.length;
    await act(async () => render(true));
    const restored = view(container);
    expect(restored).not.toBe(original);
    expect(restored.state.doc.toString()).toBe("alpha edited");
    expect(persist).toHaveBeenCalledTimes(saves);
    await act(async () => { expect(undo(restored)).toBe(true); });
    expect(disk).toBe("alpha");
    await act(async () => { expect(redo(restored)).toBe(true); });
    expect(disk).toBe("alpha edited");
  });

  it("adopts Agent writes while hidden and starts a fresh undo history", async () => {
    const path = kind === "markdown" ? "a.md" : "a.txt";
    let disk = "alpha";
    const port: DataPort = {
      listChildren: async () => [],
      readFile: async () => ({ path, name: path, type: kind === "markdown" ? "markdown" : "file", content: disk, version: disk }),
      documentPersistence: { kind: "local-fs", storageIdentity: `hidden:${kind}`, persist: vi.fn<NonNullable<DataPort["documentPersistence"]>["persist"]>(async (request) => { disk = request.content; return { ok: true as const, version: disk }; }) },
    };
    const node: DocumentDataNode = { path, id: path, name: path, type: kind === "markdown" ? "markdown" : "file" };
    const input = getDocumentInputRuntime(port, node); input.start(); await ticks();
    const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    const render = (visible: boolean) => root!.render(withTestLocalization(visible ? <DocumentSessionBoundary documentId={path}
      initialContent={input.getSnapshot().content?.content ?? ""} initialVersion={disk} saveMode="auto" persistence={port.documentPersistence!}>
      <TextEditorFrame nodeName="a" defaultMode="live" documentId={path} content={disk} canEdit hideSourceView sourceSnapshotMode renderLive={(content, controls) => kind === "code"
        ? <CodeMirrorCodeEditor content={content} readOnly={false} onSnapshotPortChange={controls.onSnapshotPortChange} onSourceRevisionChange={controls.onSourceRevisionChange} />
        : <MarkdownCodeMirrorEditor value={content} readOnly={false} livePreview={false} onSnapshotPortChange={controls.onSnapshotPortChange} onSourceRevisionChange={controls.onSourceRevisionChange} />
      } />
    </DocumentSessionBoundary> : null));
    await act(async () => render(true));
    await act(async () => view(container).dispatch({ changes: { from: 5, insert: " local" }, userEvent: "input.type" }));
    await act(async () => render(false));
    disk = "Agent version";
    invalidateDocumentInputs(port.documentPersistence!.storageIdentity, createWorkspaceContentChange({ sequence: 1, rootUri: null, paths: [path] }));
    await ticks();
    const binding = getOrCreateDocumentWorkingCopy({ documentId: path, initialContent: disk, saveMode: "auto", persistence: port.documentPersistence! });
    expect(binding.session.getState().status).toBe("clean");
    await act(async () => render(true));
    expect(view(container).state.doc.toString()).toBe("Agent version");
    expect(undoDepth(view(container).state)).toBe(0);
    expect(port.documentPersistence!.persist).toHaveBeenCalledTimes(1);
  });
});

function view(container: HTMLElement): EditorView {
  const element = container.querySelector<HTMLElement>(".cm-editor");
  if (!element) throw new Error("Editor failed to mount.");
  return requireEditorView(element);
}
async function ticks() { for (let count = 0; count < 12; count++) await Promise.resolve(); }

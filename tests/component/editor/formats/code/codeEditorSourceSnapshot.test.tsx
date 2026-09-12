/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeMirrorCodeEditor } from "../../../../../packages/shared-ui/src/editor/viewers/code/CodeMirrorCodeEditor";
import { DocumentSessionBoundary } from "../../../../../packages/shared-ui/src/editor/document-session/DocumentSessionBoundary";
import type { EditorSourceSnapshotPort } from "../../../../../packages/shared-ui/src/editor/sourceSnapshot";
import { TextEditorFrame } from "../../../../../packages/shared-ui/src/editor/viewers/shared/TextEditorFrame";
import { withTestLocalization } from "../../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("code editor source snapshot boundary", () => {
  it("does not stringify the complete file during an ordinary edit transaction", async () => {
    let snapshotPort: EditorSourceSnapshotPort | null = null;
    const onRevision = vi.fn();
    const container = await renderEditor(
      <CodeMirrorCodeEditor
        content={makeLargeSource(10_000)}
        nodeName="large.py"
        language="python"
        readOnly={false}
        onSourceRevisionChange={onRevision}
        onSnapshotPortChange={(port) => { snapshotPort = port; }}
      />,
    );
    const view = getEditorView(container);
    const toStringSpy = vi.spyOn(Object.getPrototypeOf(view.state.doc), "toString");

    act(() => view.dispatch({ changes: { from: 5, to: 6, insert: "x" }, userEvent: "input.type" }));

    expect(toStringSpy).not.toHaveBeenCalled();
    expect(onRevision).toHaveBeenLastCalledWith(expect.objectContaining({ origin: "local-edit" }));
    expect(snapshotPort).not.toBeNull();
    expect(snapshotPort!.readSnapshot().content[5]).toBe("x");
    expect(toStringSpy).toHaveBeenCalledTimes(1);
  });

  it("persists the latest CodeMirror snapshot through the shared document session", async () => {
    const persist = vi.fn(async () => ({ ok: true as const, version: "v2" }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(withTestLocalization(
        <DocumentSessionBoundary
          documentId="worker.py"
          initialContent="answer = 41"
          initialVersion="v1"
          saveMode="auto"
          persistence={{ kind: "local-fs", storageIdentity: "test:code-source", persist }}
        >
          <TextEditorFrame
            documentId="worker.py"
            content="answer = 41"
            nodeName="worker.py"
            defaultMode="source"
            canEdit
            hideSourceView
            sourceSnapshotMode
            renderLive={(value, controls) => (
              <CodeMirrorCodeEditor
                content={value}
                nodeName="worker.py"
                language="python"
                readOnly={false}
                onSourceRevisionChange={controls.onSourceRevisionChange}
                onSnapshotPortChange={controls.onSnapshotPortChange}
              />
            )}
          />
        </DocumentSessionBoundary>,
      ));
    });
    const view = getEditorView(container);

    act(() => view.dispatch({ changes: { from: 9, to: 11, insert: "42" }, userEvent: "input.type" }));
    expect(persist).not.toHaveBeenCalled();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      path: "worker.py",
      content: "answer = 42",
      reason: "edit",
    }));
  });
});

async function renderEditor(editor: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(withTestLocalization(editor)));
  return container;
}

function getEditorView(container: HTMLElement): EditorView {
  const editor = container.querySelector<HTMLElement>(".cm-editor");
  const view = editor ? EditorView.findFromDOM(editor) : null;
  if (!view) throw new Error("CodeMirror editor did not mount.");
  return view;
}

function makeLargeSource(lines: number) {
  return Array.from({ length: lines }, (_, index) => `value_${index} = ${index}`).join("\n");
}

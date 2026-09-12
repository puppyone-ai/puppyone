/**
 * @vitest-environment happy-dom
 */
import React, { useLayoutEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceResourceUri,
  createWorkspaceRootUri,
} from "../../../../packages/shared-ui/src/core/resourceUri";
import { DocumentSessionBoundary } from "../../../../packages/shared-ui/src/editor/document-session/DocumentSessionBoundary";
import { useEditableDocumentSource } from "../../../../packages/shared-ui/src/editor/document-session/EditableDocumentSourceContext";
import type { DocumentPersistedCommit } from "../../../../packages/shared-ui/src/editor/document-session/types";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("DocumentSessionBoundary", () => {
  it("passes an intact Workspace Resource URI across the save boundary", async () => {
    const documentId = createWorkspaceResourceUri(
      createWorkspaceRootUri("folder-b"),
      "shared/README.md",
    );
    const persistence = {
      kind: "local-fs" as const,
      storageIdentity: "test:document-boundary:workspace-uri",
      persist: vi.fn(async () => ({ ok: true as const, version: "v2" })),
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    let edit: (() => void) | null = null;

    await act(async () => {
      root?.render(withTestLocalization(
        <DocumentSessionBoundary
          documentId={documentId}
          initialContent="base"
          initialVersion="v1"
          saveMode="auto"
          persistence={persistence}
        >
          <SourceProbe documentId={documentId} onEditReady={(nextEdit) => { edit = nextEdit; }} />
        </DocumentSessionBoundary>,
      ));
      await Promise.resolve();
    });

    await act(async () => {
      edit?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(persistence.persist).toHaveBeenCalledWith(expect.objectContaining({
      path: documentId,
      content: `updated ${documentId}`,
    }));
  });

  it("hides save chrome by default and only renders it when explicitly enabled", () => {
    const persistence = {
      kind: "local-fs" as const,
      storageIdentity: "test:document-boundary:hidden",
      persist: vi.fn(async () => ({ ok: true as const, version: "v2" })),
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    let edit: (() => void) | null = null;
    const captureEdit = (nextEdit: () => void) => {
      edit = nextEdit;
    };

    const renderBoundary = (showSaveStatus?: boolean) => withTestLocalization(
      <DocumentSessionBoundary
        documentId="visibility.md"
        initialContent="base"
        saveMode="manual"
        persistence={persistence}
        showSaveStatus={showSaveStatus}
      >
        <SourceProbe documentId="visibility.md" onEditReady={captureEdit} />
      </DocumentSessionBoundary>,
    );

    act(() => root?.render(renderBoundary()));
    act(() => edit?.());
    expect(container.querySelector(".editor-save-overlay")).toBeNull();

    act(() => root?.render(renderBoundary(true)));
    expect(container.querySelector(".editor-save-overlay")).not.toBeNull();
    expect(container.querySelector(".editor-save-chip")).not.toBeNull();
  });

  it("remains writable after React StrictMode's cleanup/setup probe", async () => {
    const persistence = {
      kind: "local-fs" as const,
      storageIdentity: "test:document-boundary:strict",
      persist: vi.fn(async () => ({ ok: true as const, version: "v2" })),
    };
    let edit: (() => void) | null = null;
    const captureEdit = (nextEdit: () => void) => {
      edit = nextEdit;
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(withTestLocalization(
        <React.StrictMode>
          <DocumentSessionBoundary
            documentId="strict.md"
            initialContent="base"
            initialVersion="v1"
            saveMode="auto"
            persistence={persistence}
          >
            <SourceProbe documentId="strict.md" onEditReady={captureEdit} />
          </DocumentSessionBoundary>
        </React.StrictMode>,
      ));
      await Promise.resolve();
    });

    await act(async () => {
      edit?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(persistence.persist).toHaveBeenCalledWith(expect.objectContaining({
      path: "strict.md",
      content: "updated strict.md",
    }));
  });

  it("routes a late acknowledgement to the callback owned by the original document", async () => {
    const write = deferred<{ ok: true; version: string }>();
    const persistence = {
      kind: "local-fs" as const,
      storageIdentity: "test:document-boundary:pending",
      persist: vi.fn(() => write.promise),
    };
    const onPersistedA = vi.fn<(commit: DocumentPersistedCommit) => void>();
    const onPersistedB = vi.fn<(commit: DocumentPersistedCommit) => void>();
    let editA: (() => void) | null = null;
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const renderDocument = (
      documentId: string,
      onPersisted: (commit: DocumentPersistedCommit) => void,
      onEditReady?: (edit: () => void) => void,
    ) => {
      root?.render(withTestLocalization(
        <DocumentSessionBoundary
          documentId={documentId}
          initialContent="base"
          initialVersion="v1"
          saveMode="auto"
          persistence={persistence}
          onPersisted={onPersisted}
        >
          <SourceProbe documentId={documentId} onEditReady={onEditReady} />
        </DocumentSessionBoundary>,
      ));
    };

    act(() => renderDocument("a.md", onPersistedA, (edit) => { editA = edit; }));
    act(() => editA?.());
    await act(async () => Promise.resolve());
    expect(persistence.persist).toHaveBeenCalledWith(expect.objectContaining({
      path: "a.md",
      content: "updated a.md",
    }));

    act(() => renderDocument("b.md", onPersistedB));
    write.resolve({ ok: true, version: "v2" });
    await act(async () => write.promise);

    expect(onPersistedA).toHaveBeenCalledWith(expect.objectContaining({
      documentId: "a.md",
      content: "updated a.md",
      version: "v2",
    }));
    expect(onPersistedB).not.toHaveBeenCalled();
  });
});

function SourceProbe({
  documentId,
  onEditReady,
}: {
  documentId: string;
  onEditReady?: (edit: () => void) => void;
}) {
  const editingSource = useEditableDocumentSource();

  useLayoutEffect(() => {
    if (!editingSource) return undefined;
    let snapshot = { revision: `${documentId}:r1`, content: "base" };
    const detach = editingSource.attachSource({
      readSnapshot: () => snapshot,
      replaceContent: (content) => {
        snapshot = { revision: `${documentId}:external`, content };
        return snapshot;
      },
    });
    editingSource.reportRevision({ revision: snapshot.revision, origin: "model-initialization" });
    onEditReady?.(() => {
      snapshot = { revision: `${documentId}:r2`, content: `updated ${documentId}` };
      editingSource.reportRevision({ revision: snapshot.revision, origin: "local-edit" });
    });
    return detach;
  }, [documentId, editingSource, onEditReady]);

  return <div>{documentId}</div>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

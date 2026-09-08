/** @vitest-environment happy-dom */
import React, { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceContentChange, type DataNode, type DataPort, type DocumentPersistedCommit, type FileContent } from "@puppyone/shared-ui";
import { useEditorPaneSource } from "../src/features/editor-workbench/runtime/useEditorPaneSource";
import { DocumentEditingSession } from "../packages/shared-ui/src/editor/document-session/DocumentEditingSession";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("editor pane source switching", () => {
  it("keeps a late watcher read from replacing a saved pane baseline or conflicting with newer typing", async () => {
    const markdown = node("notes.md", "markdown", "text/markdown");
    const base = { ...fileContent(markdown), content: "one", version: "v1" };
    const stale = deferred<FileContent>();
    const readFile = vi.fn()
      .mockResolvedValueOnce(base)
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValue({ ...base, content: "two", version: "v2" });
    const persistence = {
      kind: "local-fs" as const, storageIdentity: "test:pane-source-save-order",
      persist: vi.fn(async () => ({ ok: true as const, version: "v2" })),
    };
    const dataPort = { ...createDataPort(readFile), documentPersistence: persistence };
    let applyPersisted: ((commit: DocumentPersistedCommit) => void) | undefined;
    const session = new DocumentEditingSession({
      documentId: markdown.path, initialContent: "one", initialVersion: "v1", saveMode: "manual",
      persistence, onPersisted: (commit) => applyPersisted?.(commit),
    });
    let snapshot = { content: "one", revision: "r1" };
    session.attachSource({
      readSnapshot: () => snapshot,
      replaceContent: (content) => (snapshot = { content, revision: `${snapshot.revision}:external` }),
    });
    session.reportRevision({ revision: "r1", origin: "model-initialization" });
    const refresh = createWorkspaceContentChange({ sequence: 1, rootUri: null, paths: [markdown.path] });
    function Probe({ changed = false }: { changed?: boolean }) {
      const source = useEditorPaneSource(markdown, dataPort, changed ? refresh : undefined);
      useLayoutEffect(() => { applyPersisted = source.applyPersistedCommit; }, [source.applyPersistedCommit]);
      useLayoutEffect(() => {
        if (source.content) session.reconcileExternalBaseline(source.content.content!, source.content.version);
      }, [source.content]);
      return <output data-content={source.content?.content} />;
    }
    const container = createContainer();
    await act(async () => root?.render(<Probe />));
    await act(async () => root?.render(<Probe changed />));
    expect(readFile).toHaveBeenCalledTimes(2);
    await act(async () => {
      snapshot = { content: "two", revision: "r2" };
      session.reportRevision({ revision: "r2", origin: "local-edit" });
      await session.requestSave();
    });
    snapshot = { content: "three", revision: "r3" };
    session.reportRevision({ revision: "r3", origin: "local-edit" });
    await act(async () => stale.resolve(base));

    expect(readFile).toHaveBeenCalledTimes(3);
    expect(container.querySelector("output")?.dataset.content).toBe("two");
    expect(snapshot.content).toBe("three");
    expect(session.getState()).toMatchObject({ status: "dirty", error: null, storageVersion: "v2" });
    await act(async () => session.requestSave());
    expect(persistence.persist).toHaveBeenLastCalledWith(expect.objectContaining({ content: "three", baseVersion: "v2" }));
    session.dispose();
  });

  it.each([
    {
      label: "spreadsheet -> image -> spreadsheet",
      contentNode: node("style-list.csv", "spreadsheet", "text/csv"),
      resourceNode: node("styles.png", "image", "image/png"),
    },
    {
      label: "markdown -> PDF -> markdown",
      contentNode: node("notes.md", "markdown", "text/markdown"),
      resourceNode: node("reference.pdf", "document", "application/pdf"),
    },
    {
      label: "code -> video -> code",
      contentNode: node("worker.ts", "code", "text/typescript"),
      resourceNode: node("demo.mp4", "video", "video/mp4"),
    },
  ])("re-reads the same content source across $label", async ({ contentNode, resourceNode }) => {
    const readFile = createReadFile();
    const dataPort = createDataPort(readFile);
    const container = createContainer();

    await renderSinglePane(container, contentNode, dataPort);
    await waitFor(() => paneState(container).contentPath === contentNode.path);
    expect(readFile).toHaveBeenCalledTimes(1);

    await renderSinglePane(container, resourceNode, dataPort);
    await waitFor(() => (
      paneState(container).contentPath === ""
      && paneState(container).fileUrl === `blob:${resourceNode.path}`
    ));

    await renderSinglePane(container, contentNode, dataPort);
    await waitFor(() => paneState(container).contentPath === contentNode.path);
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(paneState(container).loading).toBe("false");
  });

  it("re-reads a document after its pane becomes empty", async () => {
    const readFile = createReadFile();
    const dataPort = createDataPort(readFile);
    const contentNode = node("style-list.csv", "spreadsheet", "text/csv");
    const container = createContainer();

    await renderSinglePane(container, contentNode, dataPort);
    await waitFor(() => paneState(container).contentPath === contentNode.path);

    await renderSinglePane(container, null, dataPort);
    await waitFor(() => paneState(container).contentPath === "");

    await renderSinglePane(container, contentNode, dataPort);
    await waitFor(() => paneState(container).contentPath === contentNode.path);
    expect(readFile).toHaveBeenCalledTimes(2);
  });

  it("keeps three pane source lifecycles isolated across mixed viewer transitions", async () => {
    const readFile = createReadFile();
    const dataPort = createDataPort(readFile);
    const csv = node("report.csv", "spreadsheet", "text/csv");
    const image = node("diagram.png", "image", "image/png");
    const markdown = node("notes.md", "markdown", "text/markdown");
    const photo = node("photo.jpg", "image", "image/jpeg");
    const code = node("script.ts", "code", "text/typescript");
    const container = createContainer();

    await renderPanes(container, { left: csv, upperRight: image, lowerRight: markdown }, dataPort);
    await waitFor(() => (
      paneState(container, "left").contentPath === csv.path
      && paneState(container, "upperRight").fileUrl === `blob:${image.path}`
      && paneState(container, "lowerRight").contentPath === markdown.path
    ));

    await renderPanes(container, { left: photo, upperRight: code, lowerRight: markdown }, dataPort);
    await waitFor(() => (
      paneState(container, "left").fileUrl === `blob:${photo.path}`
      && paneState(container, "upperRight").contentPath === code.path
      && paneState(container, "lowerRight").contentPath === markdown.path
    ));

    await renderPanes(container, { left: csv, upperRight: code, lowerRight: markdown }, dataPort);
    await waitFor(() => paneState(container, "left").contentPath === csv.path);

    expect(readCount(readFile, csv.path)).toBe(2);
    expect(readCount(readFile, code.path)).toBe(1);
    expect(readCount(readFile, markdown.path)).toBe(1);
    expect(readCount(readFile, image.path)).toBe(0);
    expect(readCount(readFile, photo.path)).toBe(0);
    expect(paneState(container, "left").loading).toBe("false");
    expect(paneState(container, "upperRight").contentPath).toBe(code.path);
    expect(paneState(container, "lowerRight").contentPath).toBe(markdown.path);
  });

  it("commits concurrent pane reads to the pane that requested them regardless of completion order", async () => {
    const pending = new Map<string, ReturnType<typeof deferred<FileContent>>>();
    const readFile = vi.fn((path: string) => {
      const request = deferred<FileContent>();
      pending.set(path, request);
      return request.promise;
    });
    const dataPort = createDataPort(readFile);
    const nodes = {
      left: node("a.csv", "spreadsheet", "text/csv"),
      upperRight: node("b.md", "markdown", "text/markdown"),
      lowerRight: node("c.ts", "code", "text/typescript"),
    };
    const container = createContainer();

    await renderPanes(container, nodes, dataPort);
    await waitFor(() => pending.size === 3);

    await resolveRead(pending, nodes.lowerRight);
    expect(paneState(container, "lowerRight").contentPath).toBe(nodes.lowerRight.path);
    expect(paneState(container, "left").contentPath).toBe("");

    await resolveRead(pending, nodes.left);
    await resolveRead(pending, nodes.upperRight);
    expect(paneState(container, "left").contentPath).toBe(nodes.left.path);
    expect(paneState(container, "upperRight").contentPath).toBe(nodes.upperRight.path);
    expect(paneState(container, "lowerRight").contentPath).toBe(nodes.lowerRight.path);
  });

  it("cancels only the pane that changes while sibling pane reads remain active", async () => {
    const requests = new Map<string, {
      signal: AbortSignal | undefined;
      request: ReturnType<typeof deferred<FileContent>>;
    }>();
    const readFile = vi.fn((path: string, options?: { signal?: AbortSignal }) => {
      const request = deferred<FileContent>();
      requests.set(path, { signal: options?.signal, request });
      return request.promise;
    });
    const dataPort = createDataPort(readFile);
    const first = {
      left: node("a.csv", "spreadsheet", "text/csv"),
      upperRight: node("b.md", "markdown", "text/markdown"),
      lowerRight: node("c.ts", "code", "text/typescript"),
    };
    const replacement = node("d.json", "code", "application/json");
    const container = createContainer();

    await renderPanes(container, first, dataPort);
    await waitFor(() => requests.size === 3);
    await renderPanes(container, { ...first, left: replacement }, dataPort);
    await waitFor(() => requests.size === 4);

    expect(requests.get(first.left.path)?.signal?.aborted).toBe(true);
    expect(requests.get(first.upperRight.path)?.signal?.aborted).toBe(false);
    expect(requests.get(first.lowerRight.path)?.signal?.aborted).toBe(false);
    expect(requests.get(replacement.path)?.signal?.aborted).toBe(false);

    await act(async () => {
      requests.get(first.left.path)!.request.resolve(fileContent(first.left));
      requests.get(first.upperRight.path)!.request.resolve(fileContent(first.upperRight));
      requests.get(first.lowerRight.path)!.request.resolve(fileContent(first.lowerRight));
      requests.get(replacement.path)!.request.resolve(fileContent(replacement));
    });
    await waitFor(() => (
      paneState(container, "left").contentPath === replacement.path
      && paneState(container, "upperRight").contentPath === first.upperRight.path
      && paneState(container, "lowerRight").contentPath === first.lowerRight.path
    ));
  });

  it("aborts and ignores a stale read when one pane switches rapidly", async () => {
    const requests: Array<{
      path: string;
      signal: AbortSignal | undefined;
      request: ReturnType<typeof deferred<FileContent>>;
    }> = [];
    const readFile = vi.fn((path: string, options?: { signal?: AbortSignal }) => {
      const request = deferred<FileContent>();
      requests.push({ path, signal: options?.signal, request });
      return request.promise;
    });
    const dataPort = createDataPort(readFile);
    const first = node("first.csv", "spreadsheet", "text/csv");
    const second = node("second.md", "markdown", "text/markdown");
    const container = createContainer();

    await renderSinglePane(container, first, dataPort);
    await waitFor(() => requests.length === 1);
    await renderSinglePane(container, second, dataPort);
    await waitFor(() => requests.length === 2);
    expect(requests[0]!.signal?.aborted).toBe(true);

    await act(async () => requests[1]!.request.resolve(fileContent(second)));
    await waitFor(() => paneState(container).contentPath === second.path);
    await act(async () => requests[0]!.request.resolve(fileContent(first)));

    expect(paneState(container).contentPath).toBe(second.path);
    expect(paneState(container).loading).toBe("false");
  });
});

function SourceProbe({ paneId, node: activeNode, dataPort }: {
  paneId: string;
  node: DataNode | null;
  dataPort: DataPort;
}) {
  const source = useEditorPaneSource(activeNode, dataPort);
  return (
    <output
      data-pane-id={paneId}
      data-content-path={source.content?.path ?? ""}
      data-file-url={source.fileUrl ?? ""}
      data-loading={String(source.loading || source.fileUrlLoading)}
      data-error={source.error ?? source.fileUrlError ?? ""}
    />
  );
}

function node(path: string, type: DataNode["type"], mimeType: string): DataNode {
  return {
    id: path,
    path,
    name: path,
    type,
    mimeType,
    source: "local",
  };
}

function fileContent(source: DataNode): FileContent {
  return {
    path: source.path,
    name: source.name,
    type: source.type,
    mimeType: source.mimeType,
    content: `content:${source.path}`,
    version: `version:${source.path}`,
  };
}

function createReadFile() {
  const readFile = vi.fn(async (path: string) => ({
    path,
    name: path,
    type: path.endsWith(".csv") ? "spreadsheet" as const : "text" as const,
    content: `content:${path}`,
    version: `version:${path}:${readFile.mock.calls.length}`,
  }));
  return readFile;
}

function createDataPort(readFile: NonNullable<DataPort["readFile"]>): DataPort {
  return {
    readFile,
    getFileUrl: vi.fn(async (path: string) => `blob:${path}`),
    revokeFileUrl: vi.fn(async () => undefined),
    listChildren: vi.fn(async () => []),
  };
}

function createContainer() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  return container;
}

async function renderSinglePane(
  container: HTMLElement,
  activeNode: DataNode | null,
  dataPort: DataPort,
) {
  await renderPanes(container, { pane: activeNode }, dataPort);
}

async function renderPanes(
  _container: HTMLElement,
  panes: Readonly<Record<string, DataNode | null>>,
  dataPort: DataPort,
) {
  await act(async () => root?.render(
    <>
      {Object.entries(panes).map(([paneId, activeNode]) => (
        <SourceProbe key={paneId} paneId={paneId} node={activeNode} dataPort={dataPort} />
      ))}
    </>,
  ));
}

function paneState(container: HTMLElement, paneId = "pane") {
  const output = container.querySelector<HTMLOutputElement>(`[data-pane-id="${paneId}"]`);
  if (!output) throw new Error(`Missing source probe for pane: ${paneId}`);
  return {
    contentPath: output.dataset.contentPath ?? "",
    fileUrl: output.dataset.fileUrl ?? "",
    loading: output.dataset.loading ?? "",
    error: output.dataset.error ?? "",
  };
}

function readCount(readFile: ReturnType<typeof createReadFile>, path: string) {
  return readFile.mock.calls.filter(([readPath]) => readPath === path).length;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function resolveRead(
  pending: ReadonlyMap<string, ReturnType<typeof deferred<FileContent>>>,
  source: DataNode,
) {
  const request = pending.get(source.path);
  if (!request) throw new Error(`Missing read request for: ${source.path}`);
  await act(async () => request.resolve(fileContent(source)));
}

async function waitFor(assertion: () => boolean, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (assertion()) return;
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 2)));
  }
  throw new Error("Timed out waiting for editor source state.");
}

import { undo, redo } from "@codemirror/commands";
/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceContentChange,
  EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT,
  type DataNode,
  type DataPort,
  type DocumentPersistenceRequest,
  type EditorDocument,
  type FileContent,
  type WorkspaceContentChange,
} from "@puppyone/shared-ui";
import { closeAllDocumentWorkingCopies } from "../packages/shared-ui/src/editor/document-session/documentWorkingCopies";
import { EditorDocumentHost } from "../packages/shared-ui/src/editor/host/EditorDocumentHost";
import { preloadPresetViewer } from "../packages/shared-ui/src/editor/host/PresetViewerRenderer";
import {
  PRESET_VIEWERS,
  resolveEditorViewer,
} from "../packages/shared-ui/src/editor/registry/viewerRegistry";
import { EditorPaneDocumentRuntime } from "../src/features/editor-workbench/runtime/EditorPaneDocumentRuntime";
import { withTestLocalization } from "./testLocalization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type FormatCase = Readonly<{
  label: string;
  viewerId: string;
  path: string;
  type: DataNode["type"];
  mimeType?: string;
  initial: string;
  external: string;
  local: string;
  readRuntimeMarker: (container: HTMLElement) => string | null;
  readEditorMarker: (container: HTMLElement) => string | null;
  applyLocalEdit: (container: HTMLElement) => void;
}>;

const MARKERS = ["alpha", "agent", "human"] as const;

const FORMAT_CASES: readonly FormatCase[] = [
  {
    label: "Context Map",
    viewerId: "context-map",
    path: "matrix-map.contextmap",
    type: "context-map",
    mimeType: "application/vnd.puppyone.context-map+json",
    initial: contextMapContent("alpha"),
    external: contextMapContent("agent"),
    local: contextMapContent("human"),
    readRuntimeMarker: readContextMapMarker,
    readEditorMarker: readContextMapMarker,
    applyLocalEdit: (container) => {
      const collapse = container.querySelector<HTMLButtonElement>(
        '.folder-relationship-group:is([data-node-path="alpha"], [data-node-path="agent"]) .folder-relationship-collapse',
      ) ?? container.querySelector<HTMLButtonElement>(
        'button.folder-relationship-card:is([data-node-path="alpha"], [data-node-path="agent"])[data-expanded="true"]',
      );
      const expand = container.querySelector<HTMLButtonElement>(
        'button.folder-relationship-card[data-node-path="human"]',
      );
      if (!collapse || !expand) throw new Error("Context Map disclosure controls are unavailable.");
      collapse.click();
      expand.click();
    },
  },
  codeMirrorCase({
    label: "Markdown",
    viewerId: "markdown",
    path: "matrix-note.md",
    type: "markdown",
    initial: "# alpha",
    external: "# agent",
    local: "# human",
  }),
  codeMirrorCase({
    label: "plain text",
    viewerId: "text",
    path: "matrix-note.txt",
    type: "text",
    initial: "alpha",
    external: "agent",
    local: "human",
  }),
  codeMirrorCase({
    label: "source code",
    viewerId: "text",
    path: "matrix-worker.py",
    type: "code",
    initial: "value = 'alpha'",
    external: "value = 'agent'",
    local: "value = 'human'",
  }),
  codeMirrorCase({
    label: "JSON",
    viewerId: "json",
    path: "matrix-config.json",
    type: "json",
    mimeType: "application/json",
    initial: jsonContent("alpha"),
    external: jsonContent("agent"),
    local: jsonContent("human"),
  }),
  delimitedCase({
    label: "CSV",
    path: "matrix-table.csv",
    mimeType: "text/csv",
    delimiter: ",",
  }),
  delimitedCase({
    label: "TSV",
    path: "matrix-table.tsv",
    mimeType: "text/tab-separated-values",
    delimiter: "\t",
  }),
  {
    ...codeMirrorCase({
      label: "HTML",
      viewerId: "html-artifact",
      path: "matrix-page.html",
      type: "html",
      mimeType: "text/html",
      initial: "<!doctype html><h1>alpha</h1>",
      external: "<!doctype html><h1>agent</h1>",
      local: "<!doctype html><h1>human</h1>",
    }),
    readRuntimeMarker: (container) => markerFromText(
      container.querySelector<HTMLIFrameElement>(".native-preview-frame")?.srcdoc ?? "",
    ),
  },
  {
    label: "PuppyFlow",
    viewerId: "puppyflow",
    path: "matrix-workflow.puppyflow",
    type: "workflow",
    mimeType: "application/vnd.puppyone.puppyflow+json",
    initial: puppyFlowContent("alpha"),
    external: puppyFlowContent("agent"),
    local: puppyFlowContent("human"),
    readRuntimeMarker: readPuppyFlowMarker,
    readEditorMarker: readPuppyFlowMarker,
    applyLocalEdit: (container) => {
      const textarea = container.querySelector<HTMLTextAreaElement>(".puppyflow-prompt-cell textarea");
      if (!textarea) throw new Error("PuppyFlow prompt editor is unavailable.");
      setNativeValue(textarea, "human");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    },
  },
];

let roots: Root[] = [];

afterEach(async () => {
  for (const root of roots) act(() => root.unmount());
  roots = [];
  await closeAllDocumentWorkingCopies("app-close").catch(() => undefined);
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("P0 editor external-consistency matrix", () => {
  it("requires every editable preset Viewer family to have a P0 consistency fixture", () => {
    const registeredEditableViewers = PRESET_VIEWERS
      .filter(({ capability }) => capability === "edit")
      .map(({ id }) => id)
      .sort();
    const coveredViewers = [...new Set(FORMAT_CASES.map(({ viewerId }) => viewerId))].sort();

    expect(coveredViewers).toEqual(registeredEditableViewers);
  });

  it.each(FORMAT_CASES)(
    "$label: adopts a clean Agent update in the open Pane with zero writeback",
    async (formatCase) => {
      const harness = createRuntimeHarness(formatCase);

      await harness.render(refresh(0, null));
      await waitForMarker(formatCase.readRuntimeMarker, harness.container, "alpha");

      harness.setStorage(formatCase.external, "v2");
      await harness.render(refresh(1, [formatCase.path]));
      await waitForMarker(formatCase.readRuntimeMarker, harness.container, "agent");

      expect(harness.readFile).toHaveBeenCalledTimes(2);
      expect(harness.persist).not.toHaveBeenCalled();
      expect(harness.container.querySelector(".editor-inline-error")).toBeNull();

      await harness.render(refresh(2, ["unrelated/other.md"]));
      await settleReact();
      expect(harness.readFile).toHaveBeenCalledTimes(2);
    },
  );

  it.each(FORMAT_CASES)(
    "$label: restores the Agent version after the complete Pane tree remounts without saving",
    async (formatCase) => {
      const harness = createRuntimeHarness(formatCase);

      await harness.render(refresh(0, null));
      await waitForMarker(formatCase.readRuntimeMarker, harness.container, "alpha");
      await harness.hide();

      harness.setStorage(formatCase.external, "v2");
      await harness.render(refresh(1, [formatCase.path]));
      await waitForMarker(formatCase.readRuntimeMarker, harness.container, "agent");

      expect(harness.persist).not.toHaveBeenCalled();
      expect(harness.container.querySelector(".editor-inline-error")).toBeNull();
    },
  );

  it.each(FORMAT_CASES)(
    "$label: retains edits and undo/redo after destroying and recreating its view",
    async (formatCase) => {
      const harness = await createEditorHarness(formatCase);
      await harness.render(formatCase.initial, "v1");
      await waitForMarker(formatCase.readEditorMarker, harness.container, "alpha");
      act(() => formatCase.applyLocalEdit(harness.container));
      await waitForMarker(formatCase.readEditorMarker, harness.container, "human");
      await harness.save();
      const saved = harness.persist.mock.calls.length;
      await harness.hide();
      await harness.render(formatCase.local, "v3");
      await waitForMarker(formatCase.readEditorMarker, harness.container, "human");
      expect(harness.persist).toHaveBeenCalledTimes(saved);
      const steps = formatCase.viewerId === "context-map" ? 2 : 1;
      for (let i = 0; i < steps; i++) act(() => historyCommand(harness.container, false));
      await waitForMarker(formatCase.readEditorMarker, harness.container, "alpha");
      for (let i = 0; i < steps; i++) act(() => historyCommand(harness.container, true));
      await waitForMarker(formatCase.readEditorMarker, harness.container, "human");
    },
  );

  it.each(FORMAT_CASES)(
    "$label: adopts disk updates over dirty local content without a conflict prompt",
    async (formatCase) => {
      const harness = await createEditorHarness(formatCase);

      await harness.render(formatCase.initial, "v1");
      await waitForMarker(formatCase.readEditorMarker, harness.container, "alpha");
      act(() => formatCase.applyLocalEdit(harness.container));
      await waitForMarker(formatCase.readEditorMarker, harness.container, "human");

      await harness.render(formatCase.external, "v2");
      await waitForMarker(formatCase.readEditorMarker, harness.container, "agent");
      expect(harness.container.querySelector(".editor-inline-error")).toBeNull();
      expect(harness.persist).not.toHaveBeenCalled();
    },
  );

  it.each(FORMAT_CASES)(
    "$label: saves subsequent edits against the adopted disk version",
    async (formatCase) => {
      const harness = await createEditorHarness(formatCase);

      await harness.render(formatCase.initial, "v1");
      await waitForMarker(formatCase.readEditorMarker, harness.container, "alpha");
      act(() => formatCase.applyLocalEdit(harness.container));
      await waitForMarker(formatCase.readEditorMarker, harness.container, "human");
      await harness.render(formatCase.external, "v2");
      await waitForMarker(formatCase.readEditorMarker, harness.container, "agent");
      act(() => formatCase.applyLocalEdit(harness.container));
      await waitForMarker(formatCase.readEditorMarker, harness.container, "human");
      await act(async () => harness.save());
      await waitFor(() => harness.persist.mock.calls.length === 1);

      expect(harness.persist).toHaveBeenCalledWith(expect.objectContaining({
        path: formatCase.path,
        content: formatCase.local,
        baseVersion: "v2",
        reason: "manual",
      }));
      expect(formatCase.readEditorMarker(harness.container)).toBe("human");
      expect(harness.container.querySelector(".editor-inline-error")).toBeNull();
    },
  );

  it("updates different format Panes from one watcher batch without cross-reading or writeback", async () => {
    const markdown = FORMAT_CASES.find(({ label }) => label === "Markdown")!;
    const csv = FORMAT_CASES.find(({ label }) => label === "CSV")!;
    const storage = new Map<string, FileContent>([
      [markdown.path, fileContent(markdown, markdown.initial, "v1")],
      [csv.path, fileContent(csv, csv.initial, "v1")],
    ]);
    const persist = vi.fn(async () => ({ ok: true as const, version: "unexpected" }));
    const readFile = vi.fn(async (path: string) => {
      const content = storage.get(path);
      if (!content) throw new Error(`Missing storage fixture: ${path}`);
      return content;
    });
    const dataPort: DataPort = {
      listChildren: vi.fn(contextMapListChildren),
      readFile,
      documentPersistence: {
        kind: "local-fs",
        storageIdentity: "test:editor-consistency-multi-pane",
        persist,
      },
    };
    const firstContainer = document.createElement("div");
    const secondContainer = document.createElement("div");
    document.body.append(firstContainer, secondContainer);
    const firstRoot = createRoot(firstContainer);
    const secondRoot = createRoot(secondContainer);
    roots.push(firstRoot, secondRoot);

    await act(async () => {
      firstRoot.render(withTestLocalization(
        runtimeElement(markdown, dataPort, refresh(0, null)),
      ));
      secondRoot.render(withTestLocalization(
        runtimeElement(csv, dataPort, refresh(0, null)),
      ));
    });
    await waitForMarker(markdown.readRuntimeMarker, firstContainer, "alpha");
    await waitForMarker(csv.readRuntimeMarker, secondContainer, "alpha");

    storage.set(markdown.path, fileContent(markdown, markdown.external, "v2"));
    storage.set(csv.path, fileContent(csv, csv.external, "v2"));
    const batch = refresh(1, [markdown.path, csv.path]);
    await act(async () => {
      firstRoot.render(withTestLocalization(runtimeElement(markdown, dataPort, batch)));
      secondRoot.render(withTestLocalization(runtimeElement(csv, dataPort, batch)));
    });
    await waitForMarker(markdown.readRuntimeMarker, firstContainer, "agent");
    await waitForMarker(csv.readRuntimeMarker, secondContainer, "agent");

    expect(readFile.mock.calls.map(([path]) => path)).toEqual([
      markdown.path,
      csv.path,
      markdown.path,
      csv.path,
    ]);
    expect(persist).not.toHaveBeenCalled();
  });

  it("discards an obsolete read that resolves after a newer matching watcher event", async () => {
    const markdown = FORMAT_CASES.find(({ label }) => label === "Markdown")!;
    const harness = createRuntimeHarness(markdown);
    await harness.render(refresh(0, null));
    await waitForMarker(markdown.readRuntimeMarker, harness.container, "alpha");

    const obsoleteRead = deferred<FileContent>();
    const newestRead = deferred<FileContent>();
    harness.readFile
      .mockImplementationOnce(() => obsoleteRead.promise)
      .mockImplementationOnce(() => newestRead.promise);

    await harness.render(refresh(1, [markdown.path]));
    await harness.render(refresh(2, [markdown.path]));
    newestRead.resolve(fileContent(markdown, markdown.external, "v3"));
    await waitForMarker(markdown.readRuntimeMarker, harness.container, "agent");

    obsoleteRead.resolve(fileContent(markdown, markdown.initial, "v2"));
    await settleReact();
    expect(markdown.readRuntimeMarker(harness.container)).toBe("agent");
    expect(harness.readFile).toHaveBeenCalledTimes(3);
    expect(harness.persist).not.toHaveBeenCalled();
  });

  it("keeps the last stable editor model when an external refresh read fails", async () => {
    const markdown = FORMAT_CASES.find(({ label }) => label === "Markdown")!;
    const harness = createRuntimeHarness(markdown);
    await harness.render(refresh(0, null));
    await waitForMarker(markdown.readRuntimeMarker, harness.container, "alpha");

    harness.readFile.mockRejectedValueOnce(new Error("temporary read failure"));
    await harness.render(refresh(1, [markdown.path]));
    await waitFor(() => harness.readFile.mock.calls.length === 2);
    await settleReact();

    expect(markdown.readRuntimeMarker(harness.container)).toBe("alpha");
    expect(harness.persist).not.toHaveBeenCalled();
  });

  it("treats a null path list as an intentional bulk refresh", async () => {
    const markdown = FORMAT_CASES.find(({ label }) => label === "Markdown")!;
    const harness = createRuntimeHarness(markdown);
    await harness.render(refresh(0, null));
    await waitForMarker(markdown.readRuntimeMarker, harness.container, "alpha");

    harness.setStorage(markdown.external, "v2");
    await harness.render(refresh(1, null));
    await waitForMarker(markdown.readRuntimeMarker, harness.container, "agent");

    expect(harness.readFile).toHaveBeenCalledTimes(2);
    expect(harness.persist).not.toHaveBeenCalled();
  });
});

function codeMirrorCase(
  input: Omit<FormatCase, "readRuntimeMarker" | "readEditorMarker" | "applyLocalEdit">,
): FormatCase {
  return {
    ...input,
    readRuntimeMarker: readCodeMirrorMarker,
    readEditorMarker: readCodeMirrorMarker,
    applyLocalEdit: (container) => replaceCodeMirrorContent(container, input.local),
  };
}

function delimitedCase({
  label,
  path,
  mimeType,
  delimiter,
}: {
  label: string;
  path: string;
  mimeType: string;
  delimiter: "," | "\t";
}): FormatCase {
  const content = (marker: string) => `Name${delimiter}Value\nitem${delimiter}${marker}`;
  return {
    label,
    viewerId: "csv-table",
    path,
    type: "spreadsheet",
    mimeType,
    initial: content("alpha"),
    external: content("agent"),
    local: content("human"),
    readRuntimeMarker: readDelimitedMarker,
    readEditorMarker: readDelimitedMarker,
    applyLocalEdit: (container) => {
      const input = container.querySelector<HTMLInputElement>(
        '.csv-table-editor input[data-csv-row="1"][data-csv-column="1"]',
      );
      if (!input) throw new Error(`${label} editable data cell is unavailable.`);
      setNativeValue(input, "human");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
  };
}

function createRuntimeHarness(formatCase: FormatCase) {
  let storage = fileContent(formatCase, formatCase.initial, "v1");
  const persist = vi.fn(async () => ({ ok: true as const, version: "unexpected" }));
  const readFile = vi.fn(async () => storage);
  const dataPort: DataPort = {
    listChildren: vi.fn(contextMapListChildren),
    readFile,
    documentPersistence: {
      kind: "local-fs",
      storageIdentity: "test:editor-consistency-runtime",
      persist,
    },
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);

  return {
    container,
    persist,
    readFile,
    setStorage(content: string, version: string) {
      storage = fileContent(formatCase, content, version);
    },
    async render(refreshKey: WorkspaceContentChange) {
      await act(async () => root.render(withTestLocalization(
        runtimeElement(formatCase, dataPort, refreshKey),
      )));
    },
    async hide() {
      await act(async () => root.render(<></>));
    },
  };
}

async function createEditorHarness(formatCase: FormatCase) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const persist = vi.fn(async (_request: DocumentPersistenceRequest) => ({
    ok: true as const,
    version: "v3",
  }));
  const persistence = {
    kind: "local-fs" as const,
    storageIdentity: `test:editor-consistency:${formatCase.viewerId}`,
    persist,
  };
  await preloadPresetViewer(resolveEditorViewer(editorDocument(formatCase, formatCase.initial, "v1")).viewer);

  return {
    container,
    persist,
    async hide() { await act(async () => root.render(<></>)); },
    async render(content: string, version: string) {
      await act(async () => root.render(withTestLocalization(
        <EditorDocumentHost
          document={editorDocument(formatCase, content, version)}
          contextMapEnvironment={{
            revision: 1,
            listChildren: contextMapListChildren,
          }}
          documentPersistence={persistence}
          saveMode="manual"
        />,
      )));
    },
    save() {
      container.querySelector(".editor-document-session-boundary")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    },
  };
}

function runtimeElement(
  formatCase: FormatCase,
  dataPort: DataPort,
  refreshKey: WorkspaceContentChange,
) {
  const node = dataNode(formatCase);
  return (
    <EditorPaneDocumentRuntime
      aiEditFile={null}
      dataPort={dataPort}
      editor={{ id: formatCase.path, resource: formatCase.path, label: formatCase.path }}
      editorInteractionPreferences={{
        showSaveStatus: false,
        markdownBlockDragEnabled: false,
      }}
      fileIconTheme="default"
      markdownEnvironment={EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT}
      refreshKey={refreshKey}
      treeNode={node}
      workspaceId="workspace"
      workspaceRoot="/workspace"
      markdownDialect="puppy-gfm"
    />
  );
}

function refresh(
  sequence: number,
  paths: readonly string[] | null,
): WorkspaceContentChange {
  return createWorkspaceContentChange({ sequence, rootUri: null, paths });
}

function dataNode(formatCase: FormatCase): DataNode {
  return {
    id: formatCase.path,
    path: formatCase.path,
    name: formatCase.path,
    type: formatCase.type,
    mimeType: formatCase.mimeType,
  };
}

function fileContent(formatCase: FormatCase, content: string, version: string): FileContent {
  return {
    ...dataNode(formatCase),
    content,
    version,
  };
}

function editorDocument(
  formatCase: FormatCase,
  content: string,
  version: string,
): EditorDocument {
  return {
    path: formatCase.path,
    name: formatCase.path,
    type: formatCase.type,
    mimeType: formatCase.mimeType,
    sourceKind: "local",
    content,
    version,
  };
}

function readCodeMirrorMarker(container: HTMLElement): string | null {
  const editor = container.querySelector<HTMLElement>(".cm-editor");
  if (!editor) return null;
  return markerFromText(EditorView.findFromDOM(editor).state.doc.toString());
}

function replaceCodeMirrorContent(container: HTMLElement, content: string): void {
  const editor = container.querySelector<HTMLElement>(".cm-editor");
  if (!editor) throw new Error("CodeMirror editor is unavailable.");
  const view = EditorView.findFromDOM(editor);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
    userEvent: "input.type",
  });
}

function readDelimitedMarker(container: HTMLElement): string | null {
  const input = container.querySelector<HTMLInputElement>(
    '.csv-table-editor input[data-csv-row="1"][data-csv-column="1"]',
  );
  return input ? markerFromText(input.value) : null;
}

function readPuppyFlowMarker(container: HTMLElement): string | null {
  const textarea = container.querySelector<HTMLTextAreaElement>(".puppyflow-prompt-cell textarea");
  return textarea ? markerFromText(textarea.value) : null;
}

function readContextMapMarker(container: HTMLElement): string | null {
  const expanded = container.querySelector<HTMLElement>(
    ".folder-relationship-group[data-node-path]",
  ) ?? container.querySelector<HTMLElement>(
    '.folder-relationship-card[data-node-path][data-expanded="true"]',
  );
  return expanded ? markerFromText(expanded.dataset.nodePath ?? "") : null;
}

function markerFromText(content: string): string | null {
  return MARKERS.find((marker) => content.includes(marker)) ?? null;
}

function setNativeValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = input instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
}

function jsonContent(marker: string): string {
  return JSON.stringify({ value: marker }, null, 2);
}

function puppyFlowContent(marker: string): string {
  return `${JSON.stringify({
    kind: "puppyflow",
    version: 1,
    title: "Matrix",
    description: "",
    steps: [{ id: "step_matrix", agent: "codex", prompt: marker, enabled: true }],
  }, null, 2)}\n`;
}

function contextMapContent(marker: string): string {
  return `${JSON.stringify({
    version: 1,
    scope: ".",
    layout: { expanded: [marker], offsets: {} },
  }, null, 2)}\n`;
}

async function contextMapListChildren(path: string | null): Promise<DataNode[]> {
  if (path !== null) return [];
  return MARKERS.map((marker) => ({
    id: marker,
    name: marker,
    path: marker,
    source: "local" as const,
    type: "folder" as const,
  }));
}

async function waitForMarker(
  read: (container: HTMLElement) => string | null,
  container: HTMLElement,
  marker: string,
): Promise<void> {
  await waitFor(() => read(container) === marker, () => (
    `Expected ${marker}, received ${read(container) ?? "<unmounted>"}: ${container.textContent ?? ""}`
  ));
}

async function settleReact(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function waitFor(
  assertion: () => boolean | Promise<boolean>,
  failure: () => string = () => "Timed out waiting for editor consistency state.",
  attempts = 200,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await assertion()) return;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 5));
    });
  }
  throw new Error(failure());
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

function historyCommand(container: HTMLElement, forward: boolean) {
  const cm = container.querySelector<HTMLElement>(".cm-editor");
  if (cm) {
    const view = EditorView.findFromDOM(cm);
    expect(forward ? redo(view) : undo(view)).toBe(true);
    return;
  }
  const target = container.querySelector('.csv-table-editor input[data-csv-row="1"][data-csv-column="1"]')
    ?? container.querySelector(".puppyflow-prompt-cell textarea")
    ?? container.querySelector(".folder-relationship-view");
  if (!target) throw new Error("History input is unavailable.");
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: forward, bubbles: true, cancelable: true }));
}

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { undo, redo, undoDepth } from "@codemirror/commands";
import { TestLocalizationProvider } from "@puppyone/localization/testing";
import { FilePreview, useDocumentInput, createWorkspaceContentChange, invalidateDocumentInputs,
  withEditorDocumentOperations, type DataPort, type DocumentDataNode, type DocumentPersistenceRequest,
  type DocumentPersistenceResult, type FileContent } from "@puppyone/shared-ui";
import { closeAllDocumentWorkingCopies, closeDocumentWorkingCopy, getDocumentWorkingCopiesUnderResource } from "../../../../packages/shared-ui/src/editor/document-session/documentWorkingCopies";
import { parseSpreadsheetInWorker } from "../../../../packages/shared-ui/src/editor/viewers/office/spreadsheetPreviewClient";
import { editorTaskScheduler } from "../../../../packages/shared-ui/src/editor/runtime/EditorTaskScheduler";
import englishCatalog from "../../../../src/localization/catalog-loaders/en";
import "../../../../src/styles/cascade.css";
import "../../../../src/cloud-globals.css";
import "@puppyone/shared-ui/shared-ui.css";
import "../../../../src/styles.css";

declare global {
  interface Window {
    editorRuntimeDisk: {
      read(path: string): Promise<FileContent>;
      persist(request: DocumentPersistenceRequest): Promise<DocumentPersistenceResult>;
      rename(path: string, name: string): Promise<void>;
      agentWrite(path: string, content: string): Promise<void>;
      onChange(listener: (path: string) => void): () => void;
    };
    editorRuntimeLifecycleFixture?: { run(): Promise<unknown> };
  }
}

const storageIdentity = "editor-runtime-smoke";
const port: DataPort = withEditorDocumentOperations({
  listChildren: async () => [],
  readFile: (path) => window.editorRuntimeDisk.read(path),
  renameNode: (path, name) => window.editorRuntimeDisk.rename(path, name),
  documentPersistence: { kind: "local-fs", storageIdentity, persist: (request) => window.editorRuntimeDisk.persist(request) },
});
let sequence = 0;
window.editorRuntimeDisk.onChange((path) => invalidateDocumentInputs(storageIdentity,
  createWorkspaceContentChange({ sequence: ++sequence, paths: [path], rootUri: null }), "watch"));
let select!: (path: string | null) => void;

function Fixture() {
  const [path, setPath] = useState<string | null>("note.md");
  select = setPath;
  const node: DocumentDataNode | null = path ? { id: path, path, name: path, type: "markdown", mimeType: "text/markdown" } : null;
  const input = useDocumentInput(node, port);
  return <TestLocalizationProvider catalog={englishCatalog}><FilePreview node={node} fileContent={input.content}
    loading={input.loading} error={input.error} documentPersistence={port.documentPersistence}
    onDocumentPersisted={input.applyPersistedCommit} editorSaveMode="auto" showHeader={false} hideSourceView />
  </TestLocalizationProvider>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
const wait = (ms = 30) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 200; attempt++) { if (await check()) return; await wait(); }
  throw new Error(`Editor runtime smoke timed out: ${document.body.textContent?.slice(0, 300)}`);
}
function currentView() {
  const element = document.querySelector<HTMLElement>(".cm-editor");
  return element ? EditorView.findFromDOM(element) : null;
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

window.editorRuntimeLifecycleFixture = { async run() {
  const checks: string[] = [];
  await until(() => Boolean(currentView()));
  const original = currentView()!;
  const initial = original.state.doc.toString();
  original.dispatch({ changes: { from: initial.length, insert: "\nlocal edit" }, userEvent: "input.type" });
  await until(async () => (await window.editorRuntimeDisk.read("note.md")).content === `${initial}\nlocal edit`);
  checks.push("edit persisted through native conditional-write IPC");
  original.scrollDOM.scrollTop = 600;
  await wait(100);
  const scrollBefore = original.scrollDOM.scrollTop;
  select(null); await until(() => !currentView());
  select("note.md"); await until(() => Boolean(currentView()) && currentView() !== original);
  await wait(150);
  const restored = currentView()!;
  const scrollAfter = restored.scrollDOM.scrollTop;
  assert(undoDepth(restored.state) > 0, "View detach discarded undo history");
  assert(Math.abs(scrollAfter - scrollBefore) < 2, `Scroll was lost across detach: ${scrollBefore} -> ${scrollAfter}`);
  assert(undo(restored), "Undo failed after reattach");
  await until(async () => (await window.editorRuntimeDisk.read("note.md")).content === initial);
  assert(redo(restored), "Redo failed after reattach");
  await until(async () => (await window.editorRuntimeDisk.read("note.md")).content === `${initial}\nlocal edit`);
  checks.push("model, scroll, undo and redo survived view destruction");

  select(null); await until(() => !currentView());
  for (let index = 0; index < 10; index++) await window.editorRuntimeDisk.agentWrite("note.md", `# Agent version ${index}`);
  await wait(100);
  select("note.md"); await until(() => currentView()?.state.doc.toString() === "# Agent version 9");
  assert(undoDepth(currentView()!.state) === 0, "External disk replacement retained stale undo");
  checks.push("hidden document accepted the latest of ten Agent writes without stale history");

  const beforeMove = getDocumentWorkingCopiesUnderResource(storageIdentity, "note.md")[0];
  currentView()!.dispatch({ changes: { from: 17, insert: " after" }, userEvent: "input.type" });
  await port.renameNode!("note.md", "renamed.md");
  assert(getDocumentWorkingCopiesUnderResource(storageIdentity, "renamed.md")[0] === beforeMove, "Rename replaced the document model owner");
  select("renamed.md"); await until(() => currentView()?.state.doc.toString().includes(" after") === true);
  assert(undo(currentView()!), "Rename discarded undo");
  await until(async () => (await window.editorRuntimeDisk.read("renamed.md")).content === "# Agent version 9");
  await closeDocumentWorkingCopy({ storageIdentity, resourcePath: "renamed.md" });
  select(null); await until(() => !currentView());
  checks.push("rename drained the edit, retained its model and redirected subsequent undo writes");

  const bytes = await (await fetch("/tests/fixtures/editor/formats/samples/sample_spreadsheet.xlsx")).arrayBuffer();
  const parsed = await Promise.all(Array.from({ length: 4 }, () => parseSpreadsheetInWorker(bytes.slice(0), { archiveKind: "ooxml" })));
  assert(parsed.every((result) => result.kind === "spreadsheet"), "A scheduled spreadsheet Worker failed");
  assert(editorTaskScheduler.snapshot().length === 0, "Completed Worker leases were not released");
  await closeAllDocumentWorkingCopies("app-close");
  checks.push("four real spreadsheet Workers respected admission and exited without remaining leases");
  return { passed: true, checks, scrollBefore, scrollAfter };
} };

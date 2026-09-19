import { useState } from "react";
import { createRoot } from "react-dom/client";
import { TestLocalizationProvider } from "@puppyone/localization/testing";
import { FilePreview, createDocumentAssetImportPort, type DocumentPersistenceRequest, type DocumentPersistenceResult, type FileContent } from "@puppyone/shared-ui";
import { closeDocumentWorkingCopy } from "../../../../packages/shared-ui/src/editor/document-session/documentWorkingCopies";
import { editorTaskScheduler } from "../../../../packages/shared-ui/src/editor/runtime/EditorTaskScheduler";
import { requireEditorView } from "../../../support/editor/editorView";
import englishCatalog from "../../../../src/localization/catalog-loaders/en";
import "@puppyone/shared-ui/shared-ui.css";
import "@puppyone/shared-ui/editor.css";

declare global {
  interface Window {
    htmlTestDisk: { read(): Promise<FileContent>; persist(request: DocumentPersistenceRequest): Promise<DocumentPersistenceResult>;
      projection(content: string): Promise<{ url: string }>; revoke(url: string): Promise<void>;
      importImage(file: File, folder: string | null, name?: string): Promise<{ paths: string[] }>; agentWrite(content: string): Promise<void> };
    htmlFixture: { refresh(): Promise<void>; close(): Promise<void>; source(): string | null; tasks(): number; reopen(): Promise<void> };
  }
}
let update!: (value: FileContent | null) => void;
const initial = await window.htmlTestDisk.read();
const assets = createDocumentAssetImportPort(async (files, folder, options) => window.htmlTestDisk.importImage(files[0]!, folder, options?.preferredName));
const persistence = { kind: "local-fs" as const, storageIdentity: "html-native-smoke", persist: window.htmlTestDisk.persist };
const previewServices = { documentProjection: { async create(_path: string, content: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const { url } = await window.htmlTestDisk.projection(content);
  return { url, close: () => window.htmlTestDisk.revoke(url) };
} } };
function Fixture() {
  const [content, setContent] = useState<FileContent | null>(initial);
  update = setContent;
  return <TestLocalizationProvider messages={englishCatalog}><FilePreview
    node={content ? { id: "page.html", path: "page.html", name: "page.html", type: "html" } : null}
    fileContent={content} documentPersistence={persistence} editorAssets={assets} previewServices={previewServices} editorSaveMode="auto"
    fileUrl="puppyone-local://html-test/page.html"
    showHeader={false} hideSourceView={false} htmlTrustMode="safe" /></TestLocalizationProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
window.htmlFixture = {
  async refresh() { update(await window.htmlTestDisk.read()); },
  async close() { await closeDocumentWorkingCopy({ storageIdentity: "html-native-smoke", resourcePath: "page.html" }); update(null); },
  async reopen() { update(await window.htmlTestDisk.read()); },
  source() { const host = document.querySelector<HTMLElement>(".cm-editor"); return host ? requireEditorView(host).state.doc.toString() : null; },
  tasks() { return editorTaskScheduler.snapshot().length; },
};

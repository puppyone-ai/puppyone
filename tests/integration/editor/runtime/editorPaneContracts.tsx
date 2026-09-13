import { redo, undo, undoDepth } from "@codemirror/commands";
import { TestLocalizationProvider } from "@puppyone/localization/testing";
import { EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT, getEditorPanes, PresetViewerRuntimeHostProvider, withEditorDocumentOperations,
  type DataPort, type DocumentDataNode, type DocumentPersistenceRequest, type DocumentPersistenceResult, type EditorSplitDirection, type FileContent } from "@puppyone/shared-ui";
import "@puppyone/shared-ui/shared-ui.css";
import { useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { closeAllDocumentWorkingCopies } from "../../../../packages/shared-ui/src/editor/document-session/documentWorkingCopies";
import { editorTaskScheduler } from "../../../../packages/shared-ui/src/editor/runtime/EditorTaskScheduler";
import { useDesktopEditorWorkbench } from "../../../../src/features/editor-workbench/controller/useDesktopEditorWorkbench";
import { DesktopEditorSplitView } from "../../../../src/features/editor-workbench/layout/DesktopEditorSplitView";
import { desktopPresetViewerRuntimeHost } from "../../../../src/features/editor-surfaces";
import { isNativeSurfaceLayoutStable } from "../../../../src/features/native-surfaces";
import "../../../../src/cloud-globals.css";
import englishCatalog from "../../../../src/localization/catalog-loaders/en";
import "../../../../src/styles.css";
import "../../../../src/styles/cascade.css";
import { unavailableDocumentNavigation } from "../../../support/editor/documentFixtures";
import { requireEditorView } from "../../../support/editor/editorView";
import { EDITOR_PANE_CASES, paneCaseNode, type EditorPaneCase } from "../../../fixtures/editor/runtime/editorPaneCases";

type Point = { x: number; y: number };
type NativeState = { sessions: { id: string; bounds: { x: number; y: number; width: number; height: number }; ready: boolean }[]; destroyed: number };
declare global {
  interface Window {
    paneContracts: {
      config(): Promise<{ appUrl: string; caseId: string | null }>;
      capture(id: string): Promise<void>;
      verifyClosed(id: string): Promise<void>;
      seed(files: Record<string, string>): Promise<void>;
      read(path: string): Promise<FileContent>;
      persist(request: DocumentPersistenceRequest): Promise<DocumentPersistenceResult>;
      input(request: { kind: "click"; point: Point } | { kind: "drag"; from: Point; to: Point }): Promise<void>;
      nativeState(): Promise<NativeState>;
      record(result: unknown): Promise<void>;
    };
    editorPaneContracts?: { run(): Promise<unknown> };
  }
}

const sibling: DocumentDataNode = { id: "sibling.md", path: "sibling.md", name: "sibling.md", type: "markdown" };
const originalText = "# Companion\n\nKeep this editing history.";
const workspace = { id: "pane-contracts", name: "Pane contracts", path: "/pane-contracts", status: "recording" as const };
let controller: ReturnType<typeof useDesktopEditorWorkbench>;
let root: Root | null = null;
let appSubscriptions = 0;
let appUrl: string;
const wait = (ms = 25) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
async function until(check: () => unknown | Promise<unknown>, label: string) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) { if (await check()) return; await wait(); }
  throw new Error(`${label}: ${document.body.textContent?.slice(0, 500)}`);
}
function pane(id: string) {
  const element = document.querySelector<HTMLElement>(`[data-editor-pane-id="${id}"]`);
  assert(element, `Missing pane ${id}`); return element;
}
function paneFor(path: string) {
  const entry = getEditorPanes(controller.paneLayout).find(({ editorId }) => editorId === path);
  assert(entry, `Missing pane owner for ${path}`); return pane(entry.id);
}
async function click(element: Element) {
  const rect = element.getBoundingClientRect();
  assert(rect.width > 0 && rect.height > 0, "Cannot click a hidden control");
  await window.paneContracts.input({ kind: "click", point: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } });
  await wait();
}
function Harness({ subject, port }: { subject: DocumentDataNode; port: DataPort }) {
  const editor = useDesktopEditorWorkbench(workspace, null);
  controller = editor;
  const initialized = useRef(false);
  useEffect(() => { if (!initialized.current) { initialized.current = true; editor.openDocument(subject); } }, [editor, subject]);
  return <section style={{ height: "100vh", width: "100vw", position: "relative", minHeight: 0, minWidth: 0 }}>
    <DesktopEditorSplitView aiEditRequest={null} dataPort={port} editorGroup={editor.state} layout={editor.paneLayout}
      editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }} fileIconTheme="default"
      editorTree={[subject, sibling]} markdownEnvironment={EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT}
      documentNavigation={unavailableDocumentNavigation} workspace={workspace} externalOpen={{ open: () => {} }}
      onClosePane={editor.closePane} onFocusPane={editor.focusPane} onResizeSplit={editor.resizeSplit}
      onMovePane={editor.movePane} onOpenAtPaneEdge={editor.openDocumentAtPaneEdge} onSplitPane={editor.splitPane} />
  </section>;
}

async function mount(testCase: EditorPaneCase) {
  const subject = paneCaseNode(testCase);
  await window.paneContracts.seed({ [subject.path]: testCase.content ?? "", [sibling.path]: originalText });
  window.localStorage.clear();
  const port = withEditorDocumentOperations({
    listChildren: async (path) => path == null ? [{ id: "docs", name: "docs", path: "docs", type: "folder", source: "local" }] : [],
    readFile: (path) => window.paneContracts.read(path),
    getFileUrl: async () => testCase.id === "pdf" ? "puppyone-local://file/pane-contracts/sample_document.pdf"
      : testCase.id === "html" ? "puppyone-local://file/pane-contracts/page.html"
      : testCase.resource ? `/tests/fixtures/editor/formats/samples/${testCase.resource}` : "",
    documentPersistence: { kind: "local-fs", storageIdentity: `pane-contracts:${testCase.id}`, persist: (request) => window.paneContracts.persist(request) },
    appPreview: {
      start: async (path) => ({ runtimeId: "pane-app", appId: "pane-app", name: "Pane app", status: "running", path, url: appUrl }),
      subscribeRuntime: () => { appSubscriptions++; return () => { appSubscriptions--; }; },
    },
  } satisfies DataPort);
  root = createRoot(document.getElementById("root")!);
  root.render(<TestLocalizationProvider messages={englishCatalog}><PresetViewerRuntimeHostProvider adapter={desktopPresetViewerRuntimeHost}>
    <Harness subject={subject} port={port} />
  </PresetViewerRuntimeHostProvider></TestLocalizationProvider>);
  await until(() => document.querySelector(testCase.selector), `${testCase.id} did not render`);
  await until(() => ready(testCase, paneFor(subject.path)), `${testCase.id} content not ready`);
  assert(paneFor(subject.path).querySelector("[data-viewer-id]")?.getAttribute("data-viewer-id") === testCase.viewerId, "The source pipeline selected an unexpected Viewer");
  return subject;
}

async function ready(testCase: EditorPaneCase, owner: HTMLElement) {
  const element = owner.querySelector(testCase.selector);
  if (!element) return false;
  if (element instanceof HTMLMediaElement) return element.readyState >= (element instanceof HTMLVideoElement ? 2 : 1) && !element.error;
  if (element instanceof HTMLImageElement) return element.complete && element.naturalWidth > 0;
  if (testCase.id === "pdf") return (await window.paneContracts.nativeState()).sessions.some(({ ready }) => ready);
  if (testCase.id === "word") return (element.shadowRoot?.querySelectorAll("section.office-docx").length ?? 0) > 0
    && Boolean(element.shadowRoot?.textContent?.includes("PuppyOne DOCX Preview")) && !owner.querySelector('[aria-busy="true"]');
  if (testCase.id === "presentation") {
    const slide = element.firstElementChild?.getBoundingClientRect();
    const host = element.getBoundingClientRect();
    return slide && slide.width > 0 && slide.height > 0 && slide.width <= host.width + 2 && slide.height <= host.height + 2
      && element.textContent?.includes("让演示文稿") && !owner.querySelector('[aria-busy="true"]');
  }
  if (testCase.viewerId === "csv-table") return owner.querySelector('[data-document-surface-ready="true"]')
    && Number(owner.querySelector("table")?.getAttribute("data-csv-mounted-rows")) < 200;
  if (testCase.viewerId === "office-preview") return !owner.querySelector('[aria-busy="true"]');
  return true;
}

async function resize(direction: EditorSplitDirection, ratio: number) {
  const handle = document.querySelector<HTMLElement>('.desktop-editor-splitter');
  assert(handle, "Missing real split handle");
  const rect = handle.getBoundingClientRect();
  const parent = handle.parentElement!.getBoundingClientRect();
  const from = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const to = direction === "horizontal" ? { x: parent.x + parent.width * ratio, y: from.y }
    : { x: from.x, y: parent.y + parent.height * ratio };
  await window.paneContracts.input({ kind: "drag", from, to });
  await until(() => {
    const split = controller.paneLayout.root;
    return split.kind === "split" && Math.abs(split.ratio - ratio) < 0.01 && isNativeSurfaceLayoutStable();
  }, "Resize did not commit its ratio or release its native lease");
  await wait(100);
}

async function closeThroughMenu(owner: HTMLElement) {
  const handle = owner.querySelector<HTMLButtonElement>(".desktop-editor-pane-handle");
  assert(handle, "Missing pane menu handle");
  await click(handle);
  await until(() => document.querySelector('[aria-label="Close editor pane"]'), "Pane menu failed to open");
  await click(document.querySelector('[aria-label="Close editor pane"]')!);
  await until(() => !document.querySelector(".desktop-editor-pane-menu"), "Pane menu was left mounted");
}

async function runCase(testCase: EditorPaneCase, direction: EditorSplitDirection) {
  const subject = await mount(testCase);
  const subjectPane = paneFor(subject.path);
  const subjectId = subjectPane.dataset.editorPaneId!;
  const surface = subjectPane.querySelector(testCase.selector)!;
  const subjectView = surface.classList.contains("cm-editor") ? requireEditorView(surface as HTMLElement) : null;
  if (subjectView) subjectView.dispatch({ selection: { anchor: 1, head: Math.min(4, subjectView.state.doc.length) } });
  const selection = subjectView?.state.selection.toJSON();
  const subjectModel = subjectView?.state.doc.toString();
  const wordPage = surface.shadowRoot?.querySelector("section.office-docx");
  if (surface instanceof HTMLMediaElement) {
    surface.currentTime = Math.min(0.2, surface.duration / 2);
    await until(() => !surface.seeking, "Media seek did not finish");
  }
  const mediaTime = surface instanceof HTMLMediaElement ? surface.currentTime : null;
  const checkSubjectState = () => {
    if (subjectView) {
      assert(requireEditorView(subjectPane.querySelector<HTMLElement>(".cm-editor")!) === subjectView, "Resize replaced the subject editing view");
      assert(JSON.stringify(subjectView.state.selection.toJSON()) === JSON.stringify(selection), "Pane operations lost the subject selection");
      assert(subjectView.state.doc.toString() === subjectModel, "Pane operations changed the subject model");
    }
    if (wordPage) assert(surface.shadowRoot?.querySelector("section.office-docx") === wordPage, "Resize reparsed the Word document");
    if (surface instanceof HTMLMediaElement) assert(Math.abs(surface.currentTime - mediaTime!) < 0.05 && surface.paused, "Pane operations reset or started media playback");
  };
  controller.openDocumentAtPaneEdge(sibling, subjectId, direction, "second");
  await until(() => document.querySelectorAll(".desktop-editor-pane").length === 2 && paneFor(sibling.path).querySelector(".cm-editor"), "Split did not attach the companion editor");
  const companion = paneFor(sibling.path);
  const companionId = companion.dataset.editorPaneId!;
  const view = requireEditorView(companion.querySelector<HTMLElement>(".cm-editor")!);
  view.dispatch({ changes: { from: view.state.doc.length, insert: "\nUser edit" }, userEvent: "input.type" });
  await until(async () => (await window.paneContracts.read(sibling.path)).content?.endsWith("User edit"), "Companion edit did not reach disk");
  const widthBefore = subjectPane.getBoundingClientRect().width;
  const heightBefore = subjectPane.getBoundingClientRect().height;
  await resize(direction, 0.35);
  const rect = subjectPane.getBoundingClientRect();
  assert(direction === "horizontal" ? rect.width < widthBefore - 40 : rect.height < heightBefore - 40, "Subject geometry did not shrink");
  assert(subjectPane.querySelector(testCase.selector) === surface, "Resize replaced the Viewer surface");
  assert(requireEditorView(companion.querySelector<HTMLElement>(".cm-editor")!) === view, "Resize replaced the companion editing view");
  assert(undoDepth(view.state) > 0, "Resize lost the companion undo history");
  await until(() => ready(testCase, subjectPane), "Resize lost rendered content");
  checkSubjectState();
  if (testCase.id === "pdf") {
    await until(async () => {
      const entry = (await window.paneContracts.nativeState()).sessions[0];
      return entry && Math.abs(entry.bounds.width - rect.width) < 3 && entry.bounds.height <= rect.height && entry.bounds.height > 0;
    }, "Native PDF bounds did not follow the pane");
  }
  await window.paneContracts.capture(`${testCase.id}-${direction}`);
  await resize(direction, 0.65);
  controller.movePane(subjectId, companionId, direction === "horizontal" ? "vertical" : "horizontal", "first");
  await until(() => controller.paneLayout.root.kind === "split" && controller.paneLayout.root.direction !== direction, "Pane move did not change split topology");
  assert(paneFor(subject.path).querySelector(testCase.selector) === surface, "Moving the pane remounted its Viewer");
  await until(() => ready(testCase, subjectPane), "Moved Viewer did not render again");
  checkSubjectState();
  assert(paneFor(sibling.path).querySelector(".cm-editor") === view.dom, "Moving another pane discarded the companion view");
  controller.focusPane(companionId);
  await until(() => companion.dataset.active === "true", "Companion did not activate");
  await closeThroughMenu(paneFor(subject.path));
  await until(() => !subjectPane.isConnected && document.querySelectorAll(".desktop-editor-pane").length === 1, "Close did not remove exactly the selected pane");
  assert(controller.paneLayout.activePaneId === companionId && companion.dataset.active === "true", "Close activated the wrong remaining pane");
  assert(paneFor(sibling.path).querySelector(".cm-editor") === view.dom, "Close remounted the surviving editor");
  assert(document.activeElement === companion.querySelector(".desktop-editor-pane-handle"), "Menu close lost keyboard focus");
  assert(undo(view), "Close lost the surviving editor's undo");
  await until(async () => (await window.paneContracts.read(sibling.path)).content === originalText, "Undo did not persist after closing the other pane");
  assert(redo(view), "Close lost redo");
  await until(async () => (await window.paneContracts.read(sibling.path)).content?.endsWith("User edit"), "Redo did not persist");
  await until(async () => (await window.paneContracts.nativeState()).sessions.length === 0 && appSubscriptions === 0 && editorTaskScheduler.snapshot().length === 0, "Closed Viewer retained native sessions, subscriptions or Worker tasks");
  if (testCase.id === "pdf") await window.paneContracts.verifyClosed(`pdf-${direction}`);
  assert((await window.paneContracts.read(subject.path)).content === (testCase.content ?? ""), "Pane operations wrote to the unrelated subject document");
  await closeThroughMenu(companion);
  await until(() => document.querySelector('[data-empty="true"]'), "Closing the final pane did not show an empty pane");
  assert(!view.dom.isConnected, "Last closed editing view is still attached");
  root!.unmount(); root = null;
  await closeAllDocumentWorkingCopies("app-close");
  assert(isNativeSurfaceLayoutStable(), "Resize lease leaked after unmount");
  return { id: testCase.id, viewerId: testCase.viewerId, direction, passed: true, checks: ["render", "split", "shrink", "expand", "move", "menu-close-target", "active-owner", "sibling-model", "undo-redo-disk", "resource-release", "last-pane"] };
}

window.editorPaneContracts = { async run() {
  const results = [];
  const config = await window.paneContracts.config();
  appUrl = config.appUrl;
  const cases = config.caseId ? EDITOR_PANE_CASES.filter(testCase => testCase.id === config.caseId) : EDITOR_PANE_CASES;
  assert(cases.length > 0, "Unknown selected pane fixture");
  try {
    for (const testCase of cases) for (const direction of ["horizontal", "vertical"] as const) {
      const result = await runCase(testCase, direction); results.push(result); await window.paneContracts.record(result);
    }
    assert(results.length === cases.length * 2, "An expected matrix row was omitted");
    return { passed: true, results };
  } catch (error) {
    await window.paneContracts.capture("failure-horizontal");
    throw error;
  } finally { root?.unmount(); root = null; await closeAllDocumentWorkingCopies("app-close"); }
} };

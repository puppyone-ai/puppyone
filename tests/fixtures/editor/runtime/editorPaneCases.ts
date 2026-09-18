import type { DocumentDataNode } from "@puppyone/shared-ui";

export type EditorPaneCase = Readonly<{
  id: string;
  viewerId: string;
  name: string;
  type: DocumentDataNode["type"];
  mimeType?: string;
  content?: string;
  resource?: string;
  selector: string;
}>;

/** Shared by the registry guard and the real Chromium interaction matrix. */
export const EDITOR_PANE_CASES: readonly EditorPaneCase[] = [
  { id: "context-map", viewerId: "context-map", name: "map.contextmap", type: "context-map",
    content: JSON.stringify({ version: 1, scope: ".", layout: { expanded: [], offsets: {} } }), selector: ".folder-relationship-canvas" },
  { id: "app", viewerId: "app-preview", name: "demo.puppyoneapp", type: "app",
    content: JSON.stringify({ type: "puppyone.app", version: 1, name: "Pane app", launch: { kind: "static-file", path: "page.html" } }),
    selector: '.app-preview-shell[aria-busy="false"] iframe' },
  { id: "markdown", viewerId: "markdown", name: "note.md", type: "markdown", content: "# Pane document\n\nA stable editing session.", selector: ".cm-editor" },
  { id: "puppyflow", viewerId: "puppyflow", name: "flow.puppyflow", type: "workflow",
    content: JSON.stringify({ kind: "puppyflow", version: 1, title: "Pane flow", description: "", steps: [{ id: "step_pane", agent: "codex", prompt: "Keep this prompt", enabled: true }] }), selector: ".puppyflow-prompt-cell textarea" },
  { id: "json", viewerId: "json", name: "settings.json", type: "json", content: '{"pane":"retained"}', selector: ".cm-editor" },
  ...([",", "\t"] as const).map((delimiter) => ({
    id: delimiter === "," ? "csv" : "tsv", viewerId: "csv-table", name: delimiter === "," ? "table.csv" : "table.tsv", type: "spreadsheet" as const,
    mimeType: delimiter === "," ? "text/csv" : "text/tab-separated-values",
    content: ["Name" + delimiter + "Value", ...Array.from({ length: 200 }, (_, index) => `Row ${index}${delimiter}${index}`)].join("\n"),
    selector: ".csv-table-editor__table tbody td",
  })),
  { id: "html", viewerId: "html-artifact", name: "page.html", type: "html", content: "<!doctype html><h1>Pane preview</h1>", selector: "iframe.native-preview-frame" },
  { id: "image", viewerId: "image-preview", name: "image.png", type: "image", resource: "sample_image.png", selector: '.native-image-preview-shell[data-preview-state="ready"] img' },
  { id: "pdf", viewerId: "pdf-preview", name: "document.pdf", type: "pdf", resource: "sample_document.pdf", selector: '.pdf-preview-shell[data-preview-state="ready"] iframe' },
  { id: "word", viewerId: "office-preview", name: "document.docx", type: "document", resource: "puppyone-preview-sample.docx", selector: ".office-docx-host" },
  { id: "spreadsheet", viewerId: "office-preview", name: "workbook.xlsx", type: "spreadsheet", resource: "puppyone-preview-sample.xlsx", selector: ".office-spreadsheet-grid tbody td" },
  { id: "presentation", viewerId: "office-preview", name: "slides.pptx", type: "presentation", resource: "puppyone-presentation-fidelity.pptx", selector: ".office-pptx-render-host" },
  { id: "audio", viewerId: "audio-preview", name: "tone.wav", type: "audio", resource: "notification_tone.wav", selector: "audio" },
  { id: "video", viewerId: "video-preview", name: "clip.webm", type: "video", resource: "pane-contract.webm", selector: "video" },
  { id: "text", viewerId: "text", name: "plain.txt", type: "text", content: "Plain text pane", selector: ".cm-editor" },
  { id: "code", viewerId: "text", name: "worker.py", type: "code", content: "value = 'pane'", selector: ".cm-editor" },
  { id: "fallback", viewerId: "document-placeholder", name: "unknown.pane-binary", type: "file", selector: ".document-preview__name" },
];

export function paneCaseNode(testCase: EditorPaneCase): DocumentDataNode {
  return { id: testCase.name, path: testCase.name, name: testCase.name, type: testCase.type, mimeType: testCase.mimeType, source: "local" };
}

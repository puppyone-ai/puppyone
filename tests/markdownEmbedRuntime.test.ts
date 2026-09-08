/**
 * @vitest-environment happy-dom
 */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmbeddedEditSessionStore } from "../packages/shared-ui/src/editor/markdown/platform/codemirror/embeddedEditSession";
import {
  disposeMarkdownEmbedHost,
  getMarkdownEmbedHost,
} from "../packages/shared-ui/src/editor/markdown/platform/codemirror/embedHost";
import { getMarkdownTableBlock } from "../packages/shared-ui/src/editor/markdown/features/table/tableModel";
import {
  createTransactionBroker,
  getDocRevision,
} from "../packages/shared-ui/src/editor/markdown/platform/brokers/transactionBroker";
import { CodeBlockWidget } from "../packages/shared-ui/src/editor/markdown/features/code-block/codeBlockWidget";
import { MermaidBlockWidget } from "../packages/shared-ui/src/editor/markdown/features/mermaid/mermaidBlockWidget";
import {
  markdownCodeMirrorBaseExtensions,
  markdownLivePreviewExtension,
} from "../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";
import {
  createTableCellEditor,
  disposeTableCellEditor,
} from "../packages/shared-ui/src/editor/markdown/features/table/tableCellEditor";
import type { MarkdownInlinePreviewRenderer } from "../packages/shared-ui/src/editor/markdown/shared/preview/markdownInlinePreviewPort";

const mermaidMocks = vi.hoisted(() => ({
  render: vi.fn(async () => ({
    svg: "<svg><text>diagram</text></svg>",
    cacheKey: "test-cache",
    themeKey: "test-theme",
  })),
  subscribe: vi.fn(() => () => undefined),
}));

vi.mock("../packages/shared-ui/src/editor/markdown/features/mermaid/mermaidRenderer", () => ({
  getMermaidThemeSnapshot: () => ({ key: "test-theme", config: {} }),
  mountSanitizedMermaidSvg: (host: HTMLElement) => {
    const element = document.createElement("span");
    host.replaceChildren(element);
    return { element, dispose: () => element.remove() };
  },
  renderMermaidDiagram: mermaidMocks.render,
  subscribeMermaidThemeChanges: mermaidMocks.subscribe,
}));

const views: EditorView[] = [];
const renderInlinePreview: MarkdownInlinePreviewRenderer = (target, source) => {
  target.textContent = source;
};

afterEach(() => {
  while (views.length > 0) {
    const view = views.pop();
    if (!view) continue;
    disposeMarkdownEmbedHost(view);
    view.destroy();
  }
  document.body.replaceChildren();
  vi.clearAllMocks();
});

function createView(source: string): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: source }),
  });
  views.push(view);
  return view;
}

function createProjectedView(source: string): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: source,
      extensions: [
        ...markdownCodeMirrorBaseExtensions(false),
        markdownLivePreviewExtension("safe", null, "note.md", null, "", null),
      ],
    }),
  });
  views.push(view);
  return view;
}

describe("Markdown embedded runtime", () => {
  it("uses exact immutable document identities for same-sized revisions", () => {
    const first = EditorState.create({ doc: "alpha\nbeta" });
    const second = first.update({ changes: { from: 0, to: 5, insert: "omega" } }).state;

    expect(first.doc.length).toBe(second.doc.length);
    expect(first.doc.lines).toBe(second.doc.lines);
    expect(getDocRevision(first.doc)).toBe(getDocRevision(first.doc));
    expect(getDocRevision(first.doc)).not.toBe(getDocRevision(second.doc));
  });

  it("rebases an explicitly opted-in draft across a non-overlapping edit in one transaction", () => {
    const source = "before\n```ts\nold\n```\nafter";
    const view = createView(source);
    const broker = createTransactionBroker();
    const blockFrom = source.indexOf("```ts");
    const blockTo = source.indexOf("```", blockFrom + 3) + 3;
    const baseSource = source.slice(blockFrom, blockTo);
    const baseRevision = getDocRevision(view.state.doc);
    let dispatched = 0;
    const originalDispatch = view.dispatch.bind(view);
    view.dispatch = ((...specs: Parameters<EditorView["dispatch"]>) => {
      dispatched += 1;
      originalDispatch(...specs);
    }) as EditorView["dispatch"];

    view.dispatch({ changes: { from: 0, to: 0, insert: "x" } });
    dispatched = 0;
    const mappedFrom = blockFrom + 1;
    const mappedTo = blockTo + 1;
    const replacement = "```ts\nnew\n```";
    const result = broker.commit(view, {
      mappedRange: { from: mappedFrom, to: mappedTo },
      baseSource,
      baseRevision,
      nextSource: replacement,
      rebase: "if-source-unchanged",
      selection: { from: mappedFrom, to: mappedFrom },
    });

    expect(result.ok).toBe(true);
    expect(dispatched).toBe(1);
    expect(view.state.doc.sliceString(mappedFrom, mappedFrom + replacement.length)).toBe(replacement);
    expect(view.state.selection.main.head).toBe(mappedFrom);
  });

  it("rejects an overlapping edit even when explicit rebase is enabled", () => {
    const view = createView("prefix old suffix");
    const broker = createTransactionBroker();
    const baseRevision = getDocRevision(view.state.doc);
    view.dispatch({ changes: { from: 7, to: 10, insert: "NEW" } });

    expect(broker.commit(view, {
      mappedRange: { from: 7, to: 10 },
      baseSource: "old",
      baseRevision,
      nextSource: "draft",
      rebase: "if-source-unchanged",
    })).toEqual({ ok: false, mappedTo: null });
    expect(view.state.doc.toString()).toBe("prefix NEW suffix");
  });

  it("keeps a stable edit-session id and draft across detach + range mapping", () => {
    const store = createEmbeddedEditSessionStore();
    const first = store.acquire({
      featureId: "codeBlock",
      mappedRange: { from: 10, to: 20 },
      baseSource: "base",
      baseRevision: "revision-1",
      draft: { code: "draft" },
      mode: "editing",
    });
    store.update(first.elementId, { draft: { code: "recover me" } });
    store.mapRanges((position) => position + 5);
    store.detach(first.elementId);

    const recovered = store.acquire({
      featureId: "codeBlock",
      mappedRange: { from: 15, to: 25 },
      baseSource: "base",
      baseRevision: "revision-2",
      draft: { code: "default" },
      mode: "editing",
    });
    expect(recovered.elementId).toBe(first.elementId);
    expect(recovered.draft).toEqual({ code: "recover me" });
    expect(recovered.lifecycle).toBe("mounted");

    store.complete(recovered.elementId);
    expect(store.values()).toHaveLength(0);
  });

  it("mirrors code input into the store and restores it after a DOM remount", () => {
    const source = "```ts\nold\n```";
    const view = createView(source);
    const host = getMarkdownEmbedHost(view);
    const firstWidget = new CodeBlockWidget("old", "ts", 0, source.length);
    const firstDom = firstWidget.toDOM(view);
    view.dom.appendChild(firstDom);
    const language = firstDom.querySelector<HTMLInputElement>(".cm-md-code-language")!;
    const editor = firstDom.querySelector<HTMLTextAreaElement>(".cm-md-code-textarea")!;
    expect(editor.wrap).toBe("off");
    language.value = "tsx";
    language.dispatchEvent(new InputEvent("input", { bubbles: true }));
    editor.value = "recover me";
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const originalSession = host.editSessions.values()[0];

    view.dispatch({ changes: { from: 0, to: 0, insert: "xxx" } });
    host.editSessions.mapRanges((position) => position + 3);
    firstWidget.destroy(firstDom);
    expect(host.editSessions.get(originalSession.elementId)?.lifecycle).toBe("detached");

    const secondWidget = new CodeBlockWidget("old", "ts", 3, source.length + 3);
    const secondDom = secondWidget.toDOM(view);
    view.dom.appendChild(secondDom);
    expect(secondDom.querySelector<HTMLInputElement>(".cm-md-code-language")?.value).toBe("tsx");
    expect(secondDom.querySelector<HTMLTextAreaElement>(".cm-md-code-textarea")?.value).toBe("recover me");
    expect(host.editSessions.values()[0]?.elementId).toBe(originalSession.elementId);
    secondWidget.destroy(secondDom);
  });

  it("keeps a mounted code block anchored after an edit before its widget", () => {
    const source = "Intro\n\n```ts\nold\n```";
    const view = createProjectedView(source);
    const widgetBefore = view.dom.querySelector<HTMLElement>(".cm-md-code-widget");
    if (!widgetBefore) throw new Error("Code block did not mount");

    view.dispatch({ changes: { from: 0, insert: "Shifted\n" } });

    const widgetAfter = view.dom.querySelector<HTMLElement>(".cm-md-code-widget");
    expect(widgetAfter).toBe(widgetBefore);
    const editor = widgetAfter?.querySelector<HTMLTextAreaElement>(".cm-md-code-textarea");
    if (!editor) throw new Error("Code block editor did not mount");
    editor.value = "new";
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
    editor.dispatchEvent(new FocusEvent("blur"));

    expect(view.state.doc.toString()).toBe("Shifted\nIntro\n\n```ts\nnew\n```");
  });

  it("uses the exact code-fence slice and commits only when focus leaves the composite widget", () => {
    const source = "~~~js\nold\n~~~";
    const view = createView(source);
    const widget = new CodeBlockWidget("old", "js", 0, source.length);
    const dom = widget.toDOM(view);
    view.dom.appendChild(dom);
    const language = dom.querySelector<HTMLInputElement>(".cm-md-code-language")!;
    const editor = dom.querySelector<HTMLTextAreaElement>(".cm-md-code-textarea")!;

    language.value = "ts";
    language.dispatchEvent(new InputEvent("input", { bubbles: true }));
    language.dispatchEvent(new FocusEvent("blur", { relatedTarget: editor }));
    expect(view.state.doc.toString()).toBe(source);

    editor.value = "new";
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
    editor.dispatchEvent(new FocusEvent("blur"));
    expect(view.state.doc.toString()).toBe("```ts\nnew\n```");
  });

  it("separates legacy source metadata from language and preserves it on commit", () => {
    const source = "```83:99:package.json\n{\"private\": false}\n```";
    const view = createView(source);
    const widget = new CodeBlockWidget(
      '{"private": false}',
      "json",
      0,
      source.length,
      { path: "package.json", startLine: 83, endLine: 99 },
    );
    const dom = widget.toDOM(view);
    view.dom.appendChild(dom);
    const language = dom.querySelector<HTMLInputElement>(".cm-md-code-language")!;
    const reference = dom.querySelector<HTMLElement>(".cm-md-code-source-reference")!;
    const editor = dom.querySelector<HTMLTextAreaElement>(".cm-md-code-textarea")!;

    expect(language.value).toBe("json");
    expect(reference.textContent).toBe("package.json · L83–99");

    editor.value = '{"private": true}';
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
    editor.dispatchEvent(new FocusEvent("blur"));

    expect(view.state.doc.toString()).toBe([
      '```json file="package.json" lines="83-99"',
      '{"private": true}',
      "```",
    ].join("\n"));
  });

  it("restores and explicitly rebases a table-cell draft after its range moves", () => {
    const source = "intro\n| old |\n| --- |";
    const view = createView(source);
    const firstTable = getMarkdownTableBlock(view.state, 2, {
      from: view.state.doc.line(2).from,
      to: view.state.doc.length,
    })!;
    const firstCell = firstTable.rows[0].cells[0];
    const firstEditor = createTableCellEditor({
      alignments: firstTable.alignments,
      cell: firstCell,
      columnCount: 1,
      columnIndex: 0,
      documentPath: "note.md",
      markdownLinkGraph: null,
      rowCount: firstTable.rows.length,
      rowIndex: 0,
      rows: firstTable.rows,
      renderInlinePreview,
      getTableRange: () => ({ from: firstTable.from, to: firstTable.to }),
      tableFrom: firstTable.from,
      tableTo: firstTable.to,
      view,
    });
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-table-widget-wrap";
    wrapper.appendChild(firstEditor);
    view.dom.appendChild(wrapper);
    firstEditor.focus();
    firstEditor.textContent = "draft";
    firstEditor.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const host = getMarkdownEmbedHost(view);
    const originalSession = host.editSessions.values().find((session) => session.featureId === "table-cell")!;

    view.dispatch({ changes: { from: 0, to: 0, insert: "xx" } });
    host.editSessions.mapRanges((position) => position + 2);
    disposeTableCellEditor(firstEditor);
    wrapper.remove();
    const movedTable = getMarkdownTableBlock(view.state, 2, {
      from: view.state.doc.line(2).from,
      to: view.state.doc.length,
    })!;
    const movedCell = movedTable.rows[0].cells[0];
    const recoveredEditor = createTableCellEditor({
      alignments: movedTable.alignments,
      cell: movedCell,
      columnCount: 1,
      columnIndex: 0,
      documentPath: "note.md",
      markdownLinkGraph: null,
      rowCount: movedTable.rows.length,
      rowIndex: 0,
      rows: movedTable.rows,
      renderInlinePreview,
      getTableRange: () => ({ from: movedTable.from, to: movedTable.to }),
      tableFrom: movedTable.from,
      tableTo: movedTable.to,
      view,
    });
    const recoveredWrapper = document.createElement("div");
    recoveredWrapper.className = "cm-md-table-widget-wrap";
    recoveredWrapper.appendChild(recoveredEditor);
    view.dom.appendChild(recoveredWrapper);

    expect(recoveredEditor.textContent).toBe("draft");
    expect(host.editSessions.values().find((session) => session.featureId === "table-cell")?.elementId)
      .toBe(originalSession.elementId);
    recoveredEditor.dispatchEvent(new FocusEvent("blur"));
    expect(view.state.doc.toString()).toContain("| draft |");
    expect(host.editSessions.values().filter((session) => session.featureId === "table-cell")).toHaveLength(0);
  });

  it("commits an escaped table cell against the exact Markdown source slice", () => {
    const source = "| a\\|b |\n| --- |";
    const view = createView(source);
    const table = getMarkdownTableBlock(view.state, 1, {
      from: 0,
      to: view.state.doc.length,
    })!;
    const cell = table.rows[0].cells[0];
    const editor = createTableCellEditor({
      alignments: table.alignments,
      cell,
      columnCount: 1,
      columnIndex: 0,
      documentPath: "note.md",
      markdownLinkGraph: null,
      rowCount: table.rows.length,
      rowIndex: 0,
      rows: table.rows,
      renderInlinePreview,
      getTableRange: () => ({ from: table.from, to: table.to }),
      tableFrom: table.from,
      tableTo: table.to,
      view,
    });
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-table-widget-wrap";
    wrapper.appendChild(editor);
    view.dom.appendChild(wrapper);
    editor.focus();
    editor.textContent = "a|c";
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
    editor.dispatchEvent(new FocusEvent("blur"));

    expect(view.state.doc.toString()).toContain("| a\\|c |");
    expect(getMarkdownEmbedHost(view).editSessions.values()).toHaveLength(0);
  });

  it("binds Mermaid async work to a real revision-scoped execution session", async () => {
    const source = "```mermaid\ngraph TD; A-->B\n```";
    const view = createView(source);
    const widget = new MermaidBlockWidget("graph TD; A-->B", "mermaid", 0, source.length);
    const dom = widget.toDOM(view);
    view.dom.appendChild(dom);
    const host = getMarkdownEmbedHost(view);
    const session = host.executionSessions.values()[0];

    expect(session).toBeDefined();
    expect(session.featureId).toBe("mermaid-render");
    expect(session.principal.executionSessionId).toBe(session.id);
    expect(session.documentRevision).toBe(getDocRevision(view.state.doc));

    const previousRevision = getDocRevision(view.state.doc);
    view.dispatch({ changes: { from: source.indexOf("A"), to: source.indexOf("A") + 1, insert: "X" } });
    const nextRevision = getDocRevision(view.state.doc);
    host.executionSessions.destroyForRevisionChange(previousRevision, nextRevision);
    expect(host.executionSessions.values()).toHaveLength(0);

    await Promise.resolve();
    await Promise.resolve();
    widget.destroy(dom);
  });

  it("creates a delayed Mermaid edit session from the widget's mapped range", () => {
    const source = "Intro\n\n```mermaid\ngraph TD; A-->B\n```";
    const view = createProjectedView(source);
    const widgetBefore = view.dom.querySelector<HTMLElement>(".cm-md-mermaid-widget");
    if (!widgetBefore) throw new Error("Mermaid block did not mount");

    view.dispatch({ changes: { from: 0, insert: "Shifted\n" } });

    const widgetAfter = view.dom.querySelector<HTMLElement>(".cm-md-mermaid-widget");
    expect(widgetAfter).toBe(widgetBefore);
    widgetAfter?.querySelector<HTMLButtonElement>(".cm-md-mermaid-action")?.click();
    const editor = widgetAfter?.querySelector<HTMLTextAreaElement>(".cm-md-mermaid-source");
    if (!editor) throw new Error("Mermaid editor did not open");
    editor.value = "graph TD; A-->C";
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
    widgetAfter?.querySelector<HTMLButtonElement>(".cm-md-mermaid-action")?.click();

    expect(view.state.doc.toString()).toBe(
      "Shifted\nIntro\n\n```mermaid\ngraph TD; A-->C\n```",
    );
  });
});

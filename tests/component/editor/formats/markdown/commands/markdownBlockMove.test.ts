/**
 * @vitest-environment happy-dom
 */
import { history, redo, undo } from "@codemirror/commands";
import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildMarkdownBlockMoveTransaction,
  markdownBlockRelocationAnnotation,
  moveMarkdownBlock,
} from "../../../../../../packages/shared-ui/src/editor/markdown/core/commands/markdownBlockMove";
import { markdownBlockDragExtension } from "../../../../../../packages/shared-ui/src/editor/markdown/core/interaction/markdownBlockDrag";
import {
  getMarkdownMovableBlockAt,
  getMarkdownMovableBlockGroup,
} from "../../../../../../packages/shared-ui/src/editor/markdown/core/syntax/markdownBlockBoundaries";
import {
  markdownCodeMirrorLanguageExtension,
  markdownLivePreviewExtension,
} from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";
import { getMarkdownEmbedHost } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/codemirror/embedHost";
import { createEmbeddedEditSessionStore } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/codemirror/embeddedEditSession";

const mountedViews: EditorView[] = [];

afterEach(() => {
  for (const view of mountedViews.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
});

describe("Markdown block movement", () => {
  it("moves a root block downward without normalizing source or trailing newline", () => {
    const sourceText = "Alpha\n\nBravo\n\nCharlie\n";
    const state = createState(sourceText, sourceText.indexOf("avo"));
    const source = getMarkdownMovableBlockAt(state, state.selection.main.head)!;
    const group = getMarkdownMovableBlockGroup(state, source)!;
    const spec = buildMarkdownBlockMoveTransaction(state, source, group.blocks.length)!;
    const transaction = state.update(spec);

    expect(transaction.newDoc.toString()).toBe("Alpha\n\nCharlie\n\nBravo\n");
    expect(transaction.newSelection.main.head).toBe(18);
    expect(transaction.annotation(markdownBlockRelocationAnnotation)).toEqual({
      oldRange: { from: 7, to: 12 },
      newRange: { from: 16, to: 21 },
    });
  });

  it("moves a root block upward and preserves selection direction", () => {
    const sourceText = "Alpha\n\nBravo\n\nCharlie";
    const anchor = sourceText.indexOf("lie");
    const state = EditorState.create({
      doc: sourceText,
      selection: EditorSelection.single(anchor + 2, anchor),
      extensions: [markdownCodeMirrorLanguageExtension()],
    });
    const source = getMarkdownMovableBlockAt(state, anchor)!;
    const transaction = state.update(buildMarkdownBlockMoveTransaction(state, source, 0)!);

    expect(transaction.newDoc.toString()).toBe("Charlie\n\nAlpha\n\nBravo");
    expect(transaction.newSelection.main.anchor).toBe(6);
    expect(transaction.newSelection.main.head).toBe(4);
  });

  it("keeps distinct separators on both sides of an interior drop boundary", () => {
    const sourceText = "# A\n\nB\n\n\n# C\n\nD";
    const state = createState(sourceText, sourceText.indexOf("B"));
    const source = getMarkdownMovableBlockAt(state, state.selection.main.head)!;
    const transaction = state.update(buildMarkdownBlockMoveTransaction(state, source, 3)!);

    expect(transaction.newDoc.toString()).toBe("# A\n\n# C\n\n\nB\n\nD");
  });

  it("moves a list item with nested children only among sibling items", () => {
    const sourceText = "- first\n  - nested\n- second\n- third";
    const state = createState(sourceText, sourceText.indexOf("first") + 1);
    const source = getMarkdownMovableBlockAt(state, state.selection.main.head)!;
    const group = getMarkdownMovableBlockGroup(state, source)!;

    expect(source.kind).toBe("list-item");
    expect(group.blocks).toHaveLength(3);
    const transaction = state.update(
      buildMarkdownBlockMoveTransaction(state, source, group.blocks.length)!,
    );
    expect(transaction.newDoc.toString()).toBe("- second\n- third\n- first\n  - nested");
  });

  it("rejects adjacent/no-op moves and read-only state", () => {
    const state = createState("One\n\nTwo", 1);
    const source = getMarkdownMovableBlockAt(state, 1)!;
    const group = getMarkdownMovableBlockGroup(state, source)!;
    expect(buildMarkdownBlockMoveTransaction(state, source, group.sourceIndex)).toBeNull();
    expect(buildMarkdownBlockMoveTransaction(state, source, group.sourceIndex + 1)).toBeNull();

    const readOnly = EditorState.create({
      doc: "One\n\nTwo",
      extensions: [EditorState.readOnly.of(true), markdownCodeMirrorLanguageExtension()],
    });
    const lockedSource = getMarkdownMovableBlockAt(readOnly, 1)!;
    expect(buildMarkdownBlockMoveTransaction(readOnly, lockedSource, 2)).toBeNull();
  });

  it("records one history event for keyboard movement", () => {
    const view = createView("One\n\nTwo\n\nThree\n\nFour", "Two", [history()]);
    expect(moveMarkdownBlock(view, "down")).toBe(true);
    expect(view.state.doc.toString()).toBe("One\n\nThree\n\nTwo\n\nFour");
    expect(moveMarkdownBlock(view, "down")).toBe(true);
    expect(view.state.doc.toString()).toBe("One\n\nThree\n\nFour\n\nTwo");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("One\n\nThree\n\nTwo\n\nFour");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("One\n\nTwo\n\nThree\n\nFour");
    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("One\n\nThree\n\nTwo\n\nFour");
  });

  it("moves a fenced block byte-for-byte and relocates its live embedded session", () => {
    const fenced = "```js\nx()\n```";
    const sourceText = `Intro\n\n${fenced}\n\nOutro`;
    const view = createView(sourceText, "x()", [
      history(),
      markdownLivePreviewExtension("safe", null, "blocks.md", null),
    ]);
    const source = getMarkdownMovableBlockAt(view.state, sourceText.indexOf("x()"))!;
    const host = getMarkdownEmbedHost(view);
    host.editSessions.set(createSession("fence", { from: source.from, to: source.to }));

    expect(moveMarkdownBlock(view, "down")).toBe(true);
    expect(view.state.doc.toString()).toBe(`Intro\n\nOutro\n\n${fenced}`);
    expect(host.editSessions.get("fence")?.mappedRange).toEqual({
      from: 14,
      to: 14 + fenced.length,
    });
    expect(host.editSessions.get("fence")?.draft).toEqual({ code: "fence" });
  });

  it("renumbers ordered siblings atomically and reverses draft mapping on undo/redo", () => {
    const sourceText = "9. nine\n10. ten\n11. eleven";
    const blockDrag = new Compartment();
    const view = createView(sourceText, "ten", [
      history(),
      markdownLivePreviewExtension("safe", null, "ordered.md", null),
      blockDrag.of(markdownBlockDragExtension()),
    ]);
    const tenFrom = sourceText.indexOf("ten");
    const host = getMarkdownEmbedHost(view);
    host.editSessions.set(createSession("ordered-draft", { from: tenFrom, to: tenFrom + 3 }));

    expect(moveMarkdownBlock(view, "up")).toBe(true);
    expect(view.state.doc.toString()).toBe("1. ten\n2. nine\n3. eleven");
    expect(view.state.selection.main.head).toBe(4);
    expect(host.editSessions.get("ordered-draft")?.mappedRange).toEqual({ from: 3, to: 6 });

    view.dispatch({ effects: blockDrag.reconfigure([]) });
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(sourceText);
    expect(host.editSessions.get("ordered-draft")?.mappedRange).toEqual({
      from: tenFrom,
      to: tenFrom + 3,
    });

    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("1. ten\n2. nine\n3. eleven");
    expect(host.editSessions.get("ordered-draft")?.mappedRange).toEqual({ from: 3, to: 6 });
  });

  it("fully removes the overlay and keymap extension when reconfigured off", () => {
    const blockDrag = new Compartment();
    const view = createView("One\n\nTwo", "One", [blockDrag.of(markdownBlockDragExtension())]);
    expect(view.dom.querySelectorAll(".cm-md-block-drag-layer")).toHaveLength(1);

    view.dispatch({ effects: blockDrag.reconfigure([]) });
    expect(view.dom.querySelectorAll(".cm-md-block-drag-layer")).toHaveLength(0);
    expect(view.dom.classList.contains("cm-md-block-drag-enabled")).toBe(false);
  });
});

describe("embedded draft relocation", () => {
  it("relocates contained drafts, maps disjoint drafts, and conflicts partial overlap", () => {
    const store = createEmbeddedEditSessionStore();
    store.set(createSession("inside", { from: 12, to: 18 }));
    store.set(createSession("outside", { from: 40, to: 45 }));
    store.set(createSession("overlap", { from: 8, to: 14 }));

    store.mapRangesWithRelocation(
      { oldRange: { from: 10, to: 30 }, newRange: { from: 60, to: 80 } },
      (position) => position + 5,
    );

    expect(store.get("inside")?.mappedRange).toEqual({ from: 62, to: 68 });
    expect(store.get("inside")?.lifecycle).toBe("mounted");
    expect(store.get("outside")?.mappedRange).toEqual({ from: 45, to: 50 });
    expect(store.get("outside")?.lifecycle).toBe("mounted");
    expect(store.get("overlap")?.mappedRange).toEqual({ from: 13, to: 19 });
    expect(store.get("overlap")?.lifecycle).toBe("conflicted");
  });
});

function createState(source: string, selection: number): EditorState {
  return EditorState.create({
    doc: source,
    selection: { anchor: selection },
    extensions: [markdownCodeMirrorLanguageExtension()],
  });
}

function createView(source: string, selectionText: string, extensions: readonly Extension[]): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const selection = source.indexOf(selectionText) + 1;
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: source,
      selection: { anchor: selection },
      extensions: [markdownCodeMirrorLanguageExtension(), ...extensions],
    }),
  });
  mountedViews.push(view);
  return view;
}

function createSession(elementId: string, mappedRange: { from: number; to: number }) {
  return {
    elementId,
    featureId: "codeBlock",
    mappedRange,
    baseSource: "base",
    baseRevision: "revision-1",
    draft: { code: elementId },
    mode: "editing" as const,
    lifecycle: "mounted" as const,
  };
}

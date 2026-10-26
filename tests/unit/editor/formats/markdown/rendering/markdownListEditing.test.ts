import { EditorSelection, EditorState, RangeSet, Transaction, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { undo, redo } from "@codemirror/commands";
import { describe, expect, it } from "vitest";
import { markdownCodeMirrorBaseExtensions, markdownLivePreviewExtension } from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";
import { markdownLivePreviewDecorations, requestMarkdownProjectionRange } from "../../../../../../packages/shared-ui/src/editor/markdown/core/decorations/livePreviewDecorations";
import { markdownLivePreviewFocusEffect } from "../../../../../../packages/shared-ui/src/editor/markdown/core/state/livePreviewFocus";
import { getMarkdownListItemAt, getMarkdownTaskLine } from "../../../../../../packages/shared-ui/src/editor/markdown/core/syntax/markdownListStructure";
import { getMarkdownElements } from "../../../../../../packages/shared-ui/src/editor/markdown/core/syntax/markdownElements";
import { markdownEditingKeymap } from "../../../../../../packages/shared-ui/src/editor/markdown/core/commands/markdownEditingKeymap";
import { toggleMarkdownTaskCheckboxAt } from "../../../../../../packages/shared-ui/src/editor/markdown/core/commands/markdownTaskCommands";

const create = (doc: string, head = doc.length) => EditorState.create({ doc, selection: EditorSelection.cursor(head),
  extensions: [markdownCodeMirrorBaseExtensions(false), markdownLivePreviewExtension()] });
const projection = (state: EditorState) => state.field(markdownLivePreviewDecorations).decorations;
function attributes(state: EditorState, number: number) {
  const line = state.doc.line(number);
  const result: { class: string; style: string }[] = [];
  projection(state).between(line.from, line.from, (_from, _to, decoration) => {
    if (decoration.spec.class) result.push({ class: decoration.spec.class, style: decoration.spec.attributes?.style ?? "" });
  });
  return result[0];
}
function equivalent(state: EditorState) {
  const rebuilt = state.update({ effects: requestMarkdownProjectionRange(state, 0, state.doc.length) }).state;
  expect(RangeSet.eq([projection(state)], [projection(rebuilt)])).toBe(true);
}
function commandView(doc: string, head = doc.length) {
  const view = { state: create(doc, head), dispatch: (spec: TransactionSpec | Transaction) => { view.state = spec instanceof Transaction ? spec.state : view.state.update(spec).state; } };
  return view as unknown as EditorView;
}
const run = (view: EditorView, key: string) => markdownEditingKeymap.find(binding => binding.key === key)!.run!(view);

// Exercise real parser, composing field, selection normalization, plans and
// incremental projection together. No alternate regex/parser in the test.
describe("Markdown list editing through one structural model", () => {
  it.each(["", "- parent\n  ", "- parent\n    ", "10. parent\n    "])("types a task without duplicate markers or lost parent geometry: %j", initial => {
    let state = create(initial);
    for (const character of "- [ ] task") {
      const head = state.selection.main.head;
      state = state.update({ changes: { from: head, insert: character }, selection: EditorSelection.cursor(head + 1),
        annotations: Transaction.userEvent.of("input.type") }).state;
      const line = attributes(state, state.doc.lines);
      expect(line.class).toContain("cm-md-list-source-line");
      // A bare dash can still be a Setext underline. Until the parser
      // recognizes a child, keep the parent continuation rail.
      const depth = initial.startsWith("10.") && state.doc.line(state.doc.lines).text.trim() === "-" ? 0 : initial ? 1 : 0;
      expect(line.style).toContain(`--md-list-depth:${depth};`);
      expect(state.selection.main.head).toBe(state.doc.length);
      equivalent(state);
    }
    state = state.update({ effects: markdownLivePreviewFocusEffect.of(false) }).state;
    expect(attributes(state, state.doc.lines).class).toContain("cm-md-task-line");
    expect(getMarkdownTaskLine(state, state.doc.length)?.depth).toBe(initial ? 1 : 0);
    equivalent(state);
  });

  it.each(["- parent\n    - child", "- parent\n    - [ ] task", "- parent\n    - # heading"])("shares nesting for every list item text block: %j", doc => {
    const state = create(doc);
    expect(attributes(state, 2).style).toContain("--md-list-depth:1;");
    expect(attributes(state, 2).class).toContain("cm-md-nested-list-line");
  });

  it.each(["    - [ ] code", "- [ ]task", "```md\n- [ ] code\n```", "text\n2. literal"])("does not invent list/task semantics in literal content: %j", doc => {
    const state = create(doc);
    expect(getMarkdownElements(state).some(element => element.kind === "task")).toBe(false);
    expect(getMarkdownTaskLine(state, Math.max(0, doc.indexOf("[")))).toBeNull();
  });

  it("keeps a lazy continuation's literal number visible", () => {
    const state = create("- parent\n2. continuation");
    const line = state.doc.line(2);
    expect(attributes(state, 2).class).toContain("cm-md-list-continuation");
    const hidden: string[] = [];
    projection(state).between(line.from, line.to, (from, to, decoration) => {
      if (decoration.spec.widget || decoration.spec.class?.includes("hidden")) hidden.push(state.sliceDoc(from, to));
    });
    expect(hidden.some(source => source.includes("2."))).toBe(false);
  });

  it("keeps both typed markers visible when the parser recognizes compact nested lists", () => {
    let state = create("- parent\n  ");
    for (const character of "- - [ ] task") {
      const head = state.selection.main.head;
      state = state.update({ changes: { from: head, insert: character }, selection: EditorSelection.cursor(head + 1),
        annotations: Transaction.userEvent.of("input.type") }).state;
      const line = state.doc.line(2);
      expect(attributes(state, 2).class).toContain("cm-md-list-source-line");
      projection(state).between(line.from, line.to, (from, to, decoration) => {
        if (decoration.spec.widget) expect(state.sliceDoc(from, to).trim()).toBe("");
      });
      equivalent(state);
    }
  });

  const longItem = "- root\n  one\n  two\n  three\n  four\n  five\n- last";
  it.each([false, true])("reprojects the whole item on a task transition, reverse=%s", reverse => {
    let state = create(reverse ? longItem.replace("- root", "- [ ] root") : longItem);
    state = state.update({ changes: { from: 2, to: reverse ? 6 : 2, insert: reverse ? "" : "[ ] " },
      annotations: Transaction.userEvent.of("input.paste") }).state;
    for (let number = 2; number <= 6; number++) {
      expect(attributes(state, number).class).toContain("cm-md-list-continuation");
      expect(attributes(state, number).class.includes("cm-md-task-line")).toBe(!reverse);
    }
    equivalent(state);
  });

  it.each(["-   [ ] task", "-\t[ ] task", "- parent\n    - [ ] task"])("toggles the parser's exact checkbox span: %j", doc => {
    const view = commandView(doc);
    expect(toggleMarkdownTaskCheckboxAt(view, doc.length)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc.replace("[ ]", "[x]"));
    expect(toggleMarkdownTaskCheckboxAt(view, doc.length)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
    equivalent(view.state);
  });

  it("indents below a two-digit parent using its content column and restores with Shift-Tab", () => {
    const view = commandView("9. nine\n10. ten\n- child\n  continued\n  - grandchild", 25);
    expect(run(view, "Tab")).toBe(true);
    expect(view.state.doc.toString()).toBe("9. nine\n10. ten\n    - child\n      continued\n      - grandchild");
    expect(getMarkdownListItemAt(view.state, view.state.selection.main.head)?.parents).toHaveLength(1);
    expect(run(view, "Shift-Tab")).toBe(true);
    expect(view.state.doc.toString()).toBe("9. nine\n10. ten\n- child\n  continued\n  - grandchild");
    equivalent(view.state);
  });

  it("does not turn a first nested child into a continuation on Tab", () => {
    const doc = "- parent\n    - [ ] child";
    const view = commandView(doc);
    expect(run(view, "Tab")).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("moves a selected sibling group and its children once", () => {
    const view = commandView("- parent\n- one\n  - nested\n- two");
    view.dispatch({ selection: EditorSelection.range(9, view.state.doc.length) });
    expect(run(view, "Tab")).toBe(true);
    expect(view.state.doc.toString()).toBe("- parent\n  - one\n    - nested\n  - two");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- parent\n- one\n  - nested\n- two");
    expect(redo(view)).toBe(true);
    equivalent(view.state);
  });

  it("continues ordered tasks locally in one undo transaction", () => {
    const doc = "9. [x] first\n10. [ ] second\n\n100. unrelated";
    const view = commandView(doc, doc.indexOf("\n"));
    expect(run(view, "Enter")).toBe(true);
    expect(view.state.doc.toString()).toBe("9. [x] first\n10. [ ] \n11. [ ] second\n\n100. unrelated");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
    expect(redo(view)).toBe(true);
    equivalent(view.state);
  });

  it("continues a source continuation without inventing another list item", () => {
    const view = commandView("- item\n  continued");
    expect(run(view, "Enter")).toBe(true);
    expect(view.state.doc.toString()).toBe("- item\n  continued\n  ");
  });

  it("allows deleting a task prefix character by character without a hidden checkbox", () => {
    let state = create("- parent\n    - [ ] task", 19);
    for (let i = 0; i < 4; i++) {
      const head = state.selection.main.head;
      state = state.update({ changes: { from: head - 1, to: head }, selection: EditorSelection.cursor(head - 1),
        annotations: Transaction.userEvent.of("delete.backward") }).state;
      expect(attributes(state, 2).class).toContain("cm-md-list-source-line");
      expect(attributes(state, 2).style).toContain("--md-list-depth:1;");
      equivalent(state);
    }
  });
});

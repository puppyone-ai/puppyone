/** @vitest-environment happy-dom */
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { afterEach, describe, expect, it } from "vitest";
import { markdownCodeMirrorLanguageExtension } from "../../../../../../src/shared-ui/editor/markdown/markdownCodeMirrorExtensions";
import { createMarkdownInlineFragment } from "../../../../../../src/shared-ui/editor/markdown/composition/preview/markdownInlineRenderer";
import {
  clearMarkdownFormatting,
  insertMarkdownCodeBlock,
  insertMarkdownMathBlock,
  insertMarkdownTable,
  insertMarkdownRule,
  insertMarkdownFootnote,
  insertMarkdownReferenceLink,
  adjustMarkdownHeading,
  insertMarkdownParagraph,
  insertMarkdownFrontMatter,
  insertMarkdownCallout,
} from "../../../../../../src/shared-ui/editor/markdown/core/commands/markdownInsertCommands";

const views: EditorView[] = [];
afterEach(() => { views.splice(0).forEach(view => view.destroy()); document.body.replaceChildren(); });
function editor(doc: string, from = 0, to = from, readOnly = false) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc,
    selection: EditorSelection.single(from, to),
    extensions: [history(), markdownCodeMirrorLanguageExtension(), EditorState.readOnly.of(readOnly)],
  }) });
  views.push(view);
  return view;
}

describe("Markdown insertion commands", () => {
  it("wraps selected code with a fence longer than embedded backticks and undoes atomically", () => {
    const text = "intro\n\nconst code = ```;\n\nafter";
    const from = text.indexOf("const");
    const view = editor(text, from, text.indexOf(";", from) + 1);
    expect(insertMarkdownCodeBlock(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("intro\n\n````\nconst code = ```;\n````\n\nafter");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(text);
  });
  it("separates a math block from surrounding prose and places the caret inside", () => {
    const view = editor("beforeafter", 6);
    expect(insertMarkdownMathBlock(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("before\n\n$$\n\n$$\n\nafter");
    expect(view.state.selection.main.head).toBe(11);
  });
  it("inserts a chosen table shape, escapes selected cell text, and places the caret in the first cell", () => {
    const view = editor("a|b", 0, 3);
    expect(insertMarkdownTable(view, { rows: 3, columns: 2 })).toBe(true);
    expect(view.state.doc.toString()).toBe("| a\\|b |  |\n| --- | --- |\n|  |  |\n|  |  |");
    expect(view.state.selection.main.head).toBe(2);
  });
  it("rejects invalid or unbounded table sizes without changing text", () => {
    for (const shape of [{ rows: 0, columns: 2 }, { rows: 2, columns: 0 }, { rows: 500, columns: 2 }, { rows: 2.5, columns: 2 }]) {
      const view = editor("keep");
      expect(insertMarkdownTable(view, shape)).toBe(false);
      expect(view.state.doc.toString()).toBe("keep");
    }
  });
  it("creates a unique footnote and moves selected prose into its definition", () => {
    const source = "hello note\n\n[^1]: existing";
    const view = editor(source, 6, 10);
    expect(insertMarkdownFootnote(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("hello [^2]\n\n[^1]: existing\n\n[^2]: note");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });
  it("creates a reference link and focuses its definition URL", () => {
    const view = editor("hello", 0, 5);
    expect(insertMarkdownReferenceLink(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("[hello][link-1]\n\n[link-1]: ");
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });
  it("inserts a separator on its own paragraph", () => {
    const view = editor("ab", 1);
    expect(insertMarkdownRule(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("a\n\n---\n\nb");
  });
  it("clears nested inline formatting while preserving prose, links, and code contents", () => {
    const source = "**bold *italic*** and ~~gone~~ and <u>under</u> and `a*b` and [link](https://example.com)";
    const view = editor(source, 0, source.length);
    expect(clearMarkdownFormatting(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("bold italic and gone and under and a\\*b and [link](https://example.com)");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });
  it("does not clear formatting outside a partial selection", () => {
    const view = editor("**bold** tail", 9, 13);
    expect(clearMarkdownFormatting(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("**bold** tail");
  });
  it("clears only selected letters while retaining formatting on the rest", () => {
    const view = editor("**bold**", 3, 5);
    expect(clearMarkdownFormatting(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("<strong>b</strong>ol<strong>d</strong>");
  });
  it.each([
    ["**foo bar baz**", 6, 9, "<strong>foo </strong>bar<strong> baz</strong>"],
    ["**foo bar**", 2, 5, "foo<strong> bar</strong>"],
    ["**foo bar**", 6, 9, "<strong>foo </strong>bar"],
    ["`a*b c*d`", 3, 4, "<code>a\\*</code>b<code> c\\*d</code>"],
  ])("retains unselected formatting at whitespace boundaries in %s", (source, from, to, expected) => {
    const view = editor(source, from, to);
    expect(clearMarkdownFormatting(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(expected);
  });
  it("keeps literal image and HTML syntax literal when clearing inline code", () => {
    const source = "`![alt](path.png) <u>text</u>`";
    const view = editor(source, 0, source.length);
    expect(clearMarkdownFormatting(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("\\!\\[alt\\]\\(path\\.png\\) \\<u\\>text\\<\\/u\\>");
  });
  it("renders partial clear literally and can clear its remaining HTML code formatting again", () => {
    const view = editor("`a*b c*d`", 3, 4);
    clearMarkdownFormatting(view);
    const first = createMarkdownInlineFragment(view.state.doc.toString());
    expect(first.textContent).toBe("a*b c*d");
    expect([...first.querySelectorAll("code")].map(node => node.textContent)).toEqual(["a*", " c*d"]);
    const end = view.state.doc.toString().indexOf("</code>") + 7;
    view.dispatch({ selection: EditorSelection.range(0, end) });
    expect(clearMarkdownFormatting(view)).toBe(true);
    const second = createMarkdownInlineFragment(view.state.doc.toString());
    expect(second.textContent).toBe("a*b c*d");
    expect(second.querySelectorAll("code")).toHaveLength(1);
  });
  it("rejects reference definitions inside an unfinished code or HTML tail", () => {
    for (const tail of ["```\nunclosed", "<script>\nunclosed", "<!-- unclosed"]) {
      for (const command of [insertMarkdownFootnote, insertMarkdownReferenceLink]) {
        const source = `hello\n\n${tail}`;
        const view = editor(source, 5);
        expect(command(view)).toBe(false);
        expect(view.state.doc.toString()).toBe(source);
      }
    }
  });
  it("handles many backtick runs without spreading them onto the call stack", () => {
    const source = "x`".repeat(140000);
    const view = editor(source, 0, source.length);
    expect(insertMarkdownCodeBlock(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(`\`\`\`\n${source}\n\`\`\``);
  });
  it("rejects an embedded math-block delimiter without corrupting selected text", () => {
    const source = "abc\n$$\ndef";
    const view = editor(source, 0, source.length);
    expect(insertMarkdownMathBlock(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(source);
  });
  it("converts Setext headings atomically and leaves code and metadata intact", () => {
    const view = editor("Heading\n=======", 2);
    expect(adjustMarkdownHeading(view, 1)).toBe(true);
    expect(view.state.doc.toString()).toBe("## Heading");
    for (const source of ["```\n# literal\n```", "---\ntitle: value\n---"]) {
      const protectedView = editor(source, 7);
      expect(adjustMarkdownHeading(protectedView, 1)).toBe(false);
      expect(protectedView.state.doc.toString()).toBe(source);
    }
  });
  it("adjusts selected heading levels within paragraph to H6 boundaries", () => {
    const view = editor("# One\n### Three\nplain", 0, 20);
    expect(adjustMarkdownHeading(view, 1)).toBe(true);
    expect(view.state.doc.toString()).toBe("## One\n#### Three\n# plain");
    const boundary = editor("###### Max");
    adjustMarkdownHeading(boundary, 1);
    expect(boundary.state.doc.toString()).toBe("###### Max");
  });
  it("adds a paragraph after the entire fenced block, not inside it", () => {
    const view = editor("```js\nlet a = 1\n```\n\nnext", 10);
    expect(insertMarkdownParagraph(view, "after")).toBe(true);
    expect(view.state.doc.toString()).toBe("```js\nlet a = 1\n```\n\n\n\nnext");
    expect(view.state.selection.main.head).toBe(21);
  });
  it("inserts front matter only at the start and selects existing front matter without duplicating it", () => {
    const view = editor("# Title", 5);
    expect(insertMarkdownFrontMatter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("---\n\n---\n\n# Title");
    insertMarkdownFrontMatter(view);
    expect(view.state.doc.toString()).toBe("---\n\n---\n\n# Title");
  });
  it("wraps selected multiline content in a note callout", () => {
    const view = editor("one\ntwo", 0, 7);
    expect(insertMarkdownCallout(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("> [!NOTE]\n> one\n> two");
  });
  it("does not insert structural markup in the middle of code or YAML metadata", () => {
    const commands = [insertMarkdownCodeBlock, insertMarkdownMathBlock, insertMarkdownRule,
      insertMarkdownFootnote, insertMarkdownReferenceLink, insertMarkdownCallout,
      (view: EditorView) => insertMarkdownTable(view, { rows: 2, columns: 2 })];
    for (const source of ["```\nconst a = 1;\n```", "---\ntitle: value\n---\n\nbody"]) {
      for (const command of commands) {
        const view = editor(source, 10);
        expect(command(view)).toBe(false);
        expect(view.state.doc.toString()).toBe(source);
      }
    }
  });
  it("leaves read-only documents unchanged for every insertion and formatting command", () => {
    const commands = [insertMarkdownCodeBlock, insertMarkdownMathBlock, insertMarkdownRule,
      insertMarkdownFootnote, insertMarkdownReferenceLink, clearMarkdownFormatting,
      insertMarkdownFrontMatter, insertMarkdownCallout,
      (view: EditorView) => insertMarkdownTable(view, { rows: 2, columns: 2 }),
      (view: EditorView) => adjustMarkdownHeading(view, 1),
      (view: EditorView) => insertMarkdownParagraph(view, "before")];
    for (const command of commands) {
      const view = editor("**keep**", 0, 8, true);
      expect(command(view)).toBe(false);
      expect(view.state.doc.toString()).toBe("**keep**");
    }
  });
});

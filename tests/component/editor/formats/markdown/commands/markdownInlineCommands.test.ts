/**
 * @vitest-environment happy-dom
 */
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { toggleMarkdownHtmlTag, toggleMarkdownInline } from "../../../../../../packages/shared-ui/src/editor/markdown/core/commands/markdownInlineCommands";
import { getMarkdownElements } from "../../../../../../packages/shared-ui/src/editor/markdown/core/syntax/markdownElements";
import {
  puppyMarkdownFeatureCompositionExtension,
  puppyMarkdownParserExtensions,
} from "../../../../../../packages/shared-ui/src/editor/markdown/composition/markdownFeatureComposition";

const views: EditorView[] = [];

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
});

describe("Markdown inline toggle commands", () => {
  it("unwraps bold when selecting the full wrapped token", () => {
    const view = createView("**hello**");
    view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) });

    expect(toggleMarkdownInline("**")(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("hello");
  });

  it("unwraps italic when selecting the full wrapped token", () => {
    const view = createView("*hello*");
    view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) });

    expect(toggleMarkdownInline("*")(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("hello");
  });

  it("unwraps strikethrough when selecting the full wrapped token", () => {
    const view = createView("~~hello~~");
    view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) });

    expect(toggleMarkdownInline("~~")(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("hello");
  });

  it("unwraps underline tag when selecting the full wrapped token", () => {
    const view = createView("<u>hello</u>");
    view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) });

    expect(toggleMarkdownHtmlTag("u")(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("hello");
  });

  it("unwraps bold when the caret is inside the formatted word", () => {
    const view = createView("**hello**");
    view.dispatch({ selection: EditorSelection.cursor(4) });

    expect(toggleMarkdownInline("**")(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("hello");
  });

  it("unwraps bold when the inner visible text is selected", () => {
    const view = createView("**hello**");
    view.dispatch({ selection: EditorSelection.range(2, 7) });

    expect(toggleMarkdownInline("**")(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("hello");
  });

  it("keeps the visible text selected after wrapping, then unwraps without selecting markers", () => {
    const view = createView("hello");
    view.dispatch({ selection: EditorSelection.range(0, 5) });

    expect(toggleMarkdownInline("**")(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("**hello**");
    expect(view.state.selection.main.from).toBe(2);
    expect(view.state.selection.main.to).toBe(7);
    expect(view.state.sliceDoc(2, 7)).toBe("hello");

    expect(toggleMarkdownInline("**")(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("hello");
  });

  it("inserts empty bold markers and places the caret between them", () => {
    const view = createView("");
    view.dispatch({ selection: EditorSelection.cursor(0) });

    expect(toggleMarkdownInline("**")(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("****");
    expect(view.state.selection.main.from).toBe(2);
    expect(view.state.selection.main.empty).toBe(true);
  });

  it("keeps Markdown ** for long CJK text by leaving a trailing punctuator outside the markers", () => {
    const prefix = "长段落测试下面要进行长段的测试，主要是为了进行长段的测试。没有进行长段的测试的话，这个根本就不可能。就是进行长段落的测试。";
    const suffix = "如果没有进行长段落的测试，这个功能就实现得不够完善";
    const inner = prefix.slice(0, -1);
    const view = createView(prefix + suffix);
    view.dispatch({ selection: EditorSelection.range(0, prefix.length) });

    expect(toggleMarkdownInline("**")(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(`**${inner}**。${suffix}`);
    expect(view.state.doc.toString().includes("<strong>")).toBe(false);

    const bold = findBoldElement(view);
    expect(bold?.kind).toBe("strong");
    expect(view.state.sliceDoc(bold!.contentRange!.from, bold!.contentRange!.to)).toBe(inner);

    expect(toggleMarkdownInline("**")(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(prefix + suffix);
  });

  it("still wraps with ** when a CJK paragraph ends at the document boundary", () => {
    const text = "就是进行长段落的测试。";
    const view = createView(text);
    view.dispatch({ selection: EditorSelection.range(0, text.length) });

    expect(toggleMarkdownInline("**")(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(`**${text}**`);
    expect(findBoldElement(view)?.kind).toBe("strong");
  });
});

function findBoldElement(view: EditorView) {
  return getMarkdownElements(view.state).find((element) => (
    (element.kind === "strong" || (element.kind === "inlineHtml" && element.inlineHtml?.tagName === "strong"))
    && element.contentRange
  )) ?? null;
}

function createView(content: string): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: content,
      extensions: [
        puppyMarkdownFeatureCompositionExtension,
        markdown({ base: markdownLanguage, extensions: puppyMarkdownParserExtensions }),
      ],
    }),
  });
  views.push(view);
  return view;
}

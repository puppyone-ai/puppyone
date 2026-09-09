/**
 * @vitest-environment happy-dom
 */
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyMarkdownEditorCommand,
  isMarkdownEditorCommand,
} from "../packages/shared-ui/src/editor/markdown/core/commands/markdownEditorCommands";
import {
  bindMarkdownFormatHotkeys,
  MARKDOWN_FORMAT_ACTIVE_EVENT,
  MARKDOWN_EDITOR_COMMAND_EVENT,
  matchMarkdownFormatHotkey,
  syncMarkdownEditorCommandAvailability,
} from "../packages/shared-ui/src/editor/markdown/core/commands/markdownFormatHotkeys";
import {
  puppyMarkdownFeatureCompositionExtension,
  puppyMarkdownParserExtensions,
} from "../packages/shared-ui/src/editor/markdown/composition/markdownFeatureComposition";

const views: EditorView[] = [];

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
});

describe("Markdown editor commands", () => {
  it("recognizes the complete native menu command contract", () => {
    expect([
      "paragraph",
      "heading-1",
      "heading-6",
      "bullet-list",
      "ordered-list",
      "task-list",
      "quote",
      "code-block",
      "math-block",
      "indent",
      "outdent",
      "strong",
      "emphasis",
      "underline",
      "strike",
      "highlight",
      "inline-code",
      "inline-math",
      "link",
      "clear-format",
    ].every(isMarkdownEditorCommand)).toBe(true);
    expect(isMarkdownEditorCommand("unknown-command")).toBe(false);
  });

  it("applies paragraph, heading, list, and quote commands through one dispatcher", () => {
    const view = createView("alpha\nbeta");
    view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) });

    expect(applyMarkdownEditorCommand(view, "heading-2")).toBe(true);
    expect(view.state.doc.toString()).toBe("## alpha\n## beta");
    expect(applyMarkdownEditorCommand(view, "paragraph")).toBe(true);
    expect(view.state.doc.toString()).toBe("alpha\nbeta");
    expect(applyMarkdownEditorCommand(view, "bullet-list")).toBe(true);
    expect(view.state.doc.toString()).toBe("- alpha\n- beta");
    expect(applyMarkdownEditorCommand(view, "quote")).toBe(true);
    expect(view.state.doc.toString()).toBe("> - alpha\n> - beta");
  });

  it("wraps selected content as code and math blocks", () => {
    const code = createView("const answer = 42;");
    code.dispatch({ selection: EditorSelection.range(0, code.state.doc.length) });
    expect(applyMarkdownEditorCommand(code, "code-block")).toBe(true);
    expect(code.state.doc.toString()).toBe("```\nconst answer = 42;\n```");

    const math = createView("E = mc^2");
    math.dispatch({ selection: EditorSelection.range(0, math.state.doc.length) });
    expect(applyMarkdownEditorCommand(math, "math-block")).toBe(true);
    expect(math.state.doc.toString()).toBe("$$\nE = mc^2\n$$");
  });

  it("toggles a block fence off when the inner content remains selected", () => {
    const view = createView("E = mc^2");
    view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) });
    expect(applyMarkdownEditorCommand(view, "math-block")).toBe(true);

    expect(applyMarkdownEditorCommand(view, "math-block")).toBe(true);
    expect(view.state.doc.toString()).toBe("E = mc^2");
    expect(view.state.sliceDoc(
      view.state.selection.main.from,
      view.state.selection.main.to,
    )).toBe("E = mc^2");
  });

  it("removes a language-qualified code fence from selected inner content", () => {
    const source = "```ts\nconst answer = 42;\n```";
    const view = createView(source);
    const innerFrom = source.indexOf("const");
    const innerTo = innerFrom + "const answer = 42;".length;
    view.dispatch({ selection: EditorSelection.range(innerFrom, innerTo) });

    expect(applyMarkdownEditorCommand(view, "code-block")).toBe(true);
    expect(view.state.doc.toString()).toBe("const answer = 42;");
  });

  it.each([
    ["math-block", "$$\nE = mc^2\n$$", 5, "E = mc^2"],
    ["code-block", "```ts\nconst answer = 42;\n```", 12, "const answer = 42;"],
  ] as const)("toggles %s off when the caret is inside its content", (command, source, caret, expected) => {
    const view = createView(source);
    view.dispatch({ selection: EditorSelection.cursor(caret) });

    expect(applyMarkdownEditorCommand(view, command)).toBe(true);
    expect(view.state.doc.toString()).toBe(expected);
  });

  it("unwraps a canonical math block whose delimiters include Markdown indentation and trailing space", () => {
    const source = "  $$  \nE = mc^2\n   $$ ";
    const view = createView(source);
    view.dispatch({ selection: EditorSelection.cursor(source.indexOf("E")) });

    expect(applyMarkdownEditorCommand(view, "math-block")).toBe(true);
    expect(view.state.doc.toString()).toBe("E = mc^2");
  });

  it.each([
    ["~~~js\nconsole.log('ok');\n~~~", "console.log('ok');"],
    ["````ts\nconst value = `code`;\n````", "const value = `code`;"],
  ])("unwraps canonical non-triple code fences", (source, expected) => {
    const view = createView(source);
    view.dispatch({ selection: EditorSelection.cursor(source.indexOf("\n") + 2) });

    expect(applyMarkdownEditorCommand(view, "code-block")).toBe(true);
    expect(view.state.doc.toString()).toBe(expected);
  });

  it("chooses a safe code fence longer than fence runs in selected content", () => {
    const source = "before\n```\nafter";
    const view = createView(source);
    view.dispatch({ selection: EditorSelection.range(0, source.length) });

    expect(applyMarkdownEditorCommand(view, "code-block")).toBe(true);
    expect(view.state.doc.toString()).toBe("````\nbefore\n```\nafter\n````");
  });

  it("applies inline code, math, and link commands", () => {
    const code = createView("value");
    code.dispatch({ selection: EditorSelection.range(0, 5) });
    expect(applyMarkdownEditorCommand(code, "inline-code")).toBe(true);
    expect(code.state.doc.toString()).toBe("`value`");

    const math = createView("value");
    math.dispatch({ selection: EditorSelection.range(0, 5) });
    expect(applyMarkdownEditorCommand(math, "inline-math")).toBe(true);
    expect(math.state.doc.toString()).toBe("$value$");

    const link = createView("PuppyOne");
    link.dispatch({ selection: EditorSelection.range(0, 8) });
    expect(applyMarkdownEditorCommand(link, "link")).toBe(true);
    expect(link.state.doc.toString()).toBe("[PuppyOne]()");
    expect(link.state.selection.main.from).toBe(11);
    expect(link.state.selection.main.empty).toBe(true);
  });

  it("toggles highlighted text with a portable inline mark", () => {
    const view = createView("important");
    view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) });

    expect(applyMarkdownEditorCommand(view, "highlight")).toBe(true);
    expect(view.state.doc.toString()).toBe("<mark>important</mark>");
    expect(applyMarkdownEditorCommand(view, "highlight")).toBe(true);
    expect(view.state.doc.toString()).toBe("important");
  });

  it("matches Command+Shift+H as the renderer highlight fallback", () => {
    expect(matchMarkdownFormatHotkey(new KeyboardEvent("keydown", {
      key: "H",
      metaKey: true,
      shiftKey: true,
    }))).toBe("highlight");
  });

  it("clears supported inline formatting while preserving visible text", () => {
    const source = "**bold** *italic* <u>under</u> ~~gone~~ <mark>bright</mark> `code` $math$ [link](https://example.com)";
    const view = createView(source);
    view.dispatch({ selection: EditorSelection.range(0, source.length) });

    expect(applyMarkdownEditorCommand(view, "clear-format")).toBe(true);
    expect(view.state.doc.toString()).toBe("bold italic under gone bright code math link");
  });

  it("does not mistake a compact currency range for inline math when clearing formatting", () => {
    const source = "The price moved from $5 to $10.";
    const view = createView(source);
    view.dispatch({ selection: EditorSelection.range(0, source.length) });

    expect(applyMarkdownEditorCommand(view, "clear-format")).toBe(false);
    expect(view.state.doc.toString()).toBe(source);
  });

  it("clears nested formatting and a link destination without leaving URL punctuation", () => {
    const source = "[**PuppyOne**](https://example.com/a_(b))";
    const view = createView(source);
    view.dispatch({ selection: EditorSelection.range(0, source.length) });

    expect(applyMarkdownEditorCommand(view, "clear-format")).toBe(true);
    expect(view.state.doc.toString()).toBe("PuppyOne");
  });

  it("does not mutate a read-only editor", () => {
    const view = createView("text", true);
    view.dispatch({ selection: EditorSelection.range(0, 4) });

    expect(applyMarkdownEditorCommand(view, "strong")).toBe(false);
    expect(view.state.doc.toString()).toBe("text");
  });

  it("routes a native menu event to the focused editor", () => {
    const view = createView("E = mc^2");
    view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) });
    const unbind = bindMarkdownFormatHotkeys(view);
    view.contentDOM.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    window.dispatchEvent(new CustomEvent(MARKDOWN_EDITOR_COMMAND_EVENT, {
      detail: { type: "math-block" },
    }));

    expect(view.state.doc.toString()).toBe("$$\nE = mc^2\n$$");
    unbind();
  });

  it("keeps native editing menus inactive for a read-only Markdown surface", () => {
    const states: boolean[] = [];
    const onActive = (event: Event) => {
      if (event instanceof CustomEvent) states.push(event.detail?.active === true);
    };
    window.addEventListener(MARKDOWN_FORMAT_ACTIVE_EVENT, onActive);
    const view = createView("read only", true);
    const unbind = bindMarkdownFormatHotkeys(view);

    view.contentDOM.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    expect(states.at(-1)).toBe(false);
    unbind();
    window.removeEventListener(MARKDOWN_FORMAT_ACTIVE_EVENT, onActive);
  });

  it("does not let a background read-only surface clear the focused editor", () => {
    const focused = createView("value");
    focused.dispatch({ selection: EditorSelection.range(0, 5) });
    const unbindFocused = bindMarkdownFormatHotkeys(focused);
    focused.contentDOM.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    const background = createView("preview", true);
    const unbindBackground = bindMarkdownFormatHotkeys(background);
    syncMarkdownEditorCommandAvailability(background);
    window.dispatchEvent(new CustomEvent(MARKDOWN_EDITOR_COMMAND_EVENT, {
      detail: { type: "strong" },
    }));

    expect(focused.state.doc.toString()).toBe("**value**");
    unbindBackground();
    unbindFocused();
  });

  it("deactivates native editing commands when an embedded control receives focus", () => {
    const view = createView("value");
    view.dispatch({ selection: EditorSelection.range(0, 5) });
    const unbind = bindMarkdownFormatHotkeys(view);
    view.contentDOM.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    const embeddedButton = document.createElement("button");
    view.contentDOM.appendChild(embeddedButton);

    embeddedButton.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    window.dispatchEvent(new CustomEvent(MARKDOWN_EDITOR_COMMAND_EVENT, {
      detail: { type: "strong" },
    }));

    expect(view.state.doc.toString()).toBe("value");
    unbind();
  });
});

function createView(content: string, readOnly = false): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: content,
      extensions: [
        puppyMarkdownFeatureCompositionExtension,
        markdown({ base: markdownLanguage, extensions: puppyMarkdownParserExtensions }),
        ...(readOnly ? [EditorState.readOnly.of(true)] : []),
      ],
    }),
  });
  views.push(view);
  return view;
}

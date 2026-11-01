/**
 * @vitest-environment happy-dom
 */
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  markdownCodeMirrorBaseExtensions,
  markdownLivePreviewExtension,
} from "../../../../../../src/shared-ui/editor/markdown/markdownCodeMirrorExtensions";
import { getMarkdownPlanIndex } from "../../../../../../src/shared-ui/editor/markdown/core/plans/markdownPlanIndex";
import { renderMarkdownInlineFromSharedPolicy } from "../../../../../../src/shared-ui/editor/markdown/composition/preview/markdownInlinePlanAdapter";
import {
  renderMarkdownBlocksToHtml,
  renderMarkdownInlineToHtml,
} from "../../../../../../src/shared-ui/editor/markdown/features/html/markdownHtmlRenderer";

const mountedViews: EditorView[] = [];

afterEach(() => {
  for (const view of mountedViews.splice(0)) view.destroy();
  document.body.replaceChildren();
});

function mount(source: string, readOnly = true) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: source,
      extensions: [
        ...markdownCodeMirrorBaseExtensions(readOnly),
        markdownLivePreviewExtension("safe", null, "note.md", async () => "https://example.com/a.png"),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ],
    }),
  });
  mountedViews.push(view);
  return view;
}

async function focus(view: EditorView) {
  view.focus();
  await new Promise((resolve) => window.setTimeout(resolve, 20));
}

describe("Markdown callouts", () => {
  it.each([
    ["> [!NOTE]\n> body", "note", "Note"],
    ["> [!tip]\n> body", "tip", "Tip"],
    ["> [!IMPORTANT]\n> body", "important", "Important"],
    ["> [!WARNING]\n> body", "warning", "Warning"],
    ["> [!CAUTION]\n> body", "caution", "Caution"],
    ["> [!done]\n> body", "success", "Done"],
    ["> [!unknown]\n> body", "note", "Unknown"],
  ])("renders %s", (source, appearance, title) => {
    const view = mount(source);
    expect(view.contentDOM.querySelector(`.cm-md-callout-${appearance}.is-title`)).not.toBeNull();
    expect(view.contentDOM.querySelector(".cm-md-callout-header")?.textContent).toBe(title);
    expect(view.contentDOM.textContent).not.toContain("[!");
    expect(view.state.doc.toString()).toBe(source);
  });

  it("uses an authored title in place of the default", () => {
    const view = mount("> [!warning] Mind the gap\n> body");
    expect(view.contentDOM.querySelector(".cm-md-callout-header")?.textContent).toBe("");
    expect(view.contentDOM.textContent).toContain("Mind the gap");
  });

  it("keeps the body as editable Markdown lines", () => {
    const view = mount("> [!note]\n> **bold** body");
    expect(view.contentDOM.querySelector(".cm-md-callout .cm-md-syntax-strong")?.textContent).toBe("bold");
    expect(view.contentDOM.querySelectorAll(".cm-line.cm-md-callout")).toHaveLength(2);
  });

  it("shows the marker while the caret is on the title line", async () => {
    const source = "> [!note] Title\n> body\n\nafter";
    const view = mount(source, false);
    await focus(view);
    view.dispatch({ selection: EditorSelection.cursor(5) });
    expect(view.contentDOM.textContent).toContain("[!note]");
    view.dispatch({ selection: EditorSelection.cursor(source.length) });
    expect(view.contentDOM.textContent).not.toContain("[!note]");
  });

  it("starts folded with a minus marker and never rewrites the source to toggle", () => {
    const source = "> [!tip]- Folded\n> hidden body";
    const view = mount(source);
    expect(view.contentDOM.textContent).not.toContain("hidden body");
    const toggle = view.contentDOM.querySelector<HTMLElement>(".cm-md-callout-fold");
    expect(toggle?.classList.contains("is-folded")).toBe(true);
    toggle?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(view.contentDOM.textContent).toContain("hidden body");
    expect(view.state.doc.toString()).toBe(source);
  });

  it("starts open with a plus marker", () => {
    const view = mount("> [!tip]+ Open\n> body");
    expect(view.contentDOM.textContent).toContain("body");
    expect(view.contentDOM.querySelector(".cm-md-callout-fold.is-folded")).toBeNull();
  });

  it("leaves an ordinary quote alone", () => {
    const view = mount("> plain quote");
    expect(view.contentDOM.querySelector(".cm-md-callout")).toBeNull();
  });
});

describe("Markdown footnotes", () => {
  it("numbers references by first use and shows the definition marker", () => {
    const view = mount("One[^b] two[^a] three[^b]\n\n[^a]: first note\n\n[^b]: second note");
    const references = Array.from(view.contentDOM.querySelectorAll(".cm-md-footnote-reference"));
    expect(references.map((node) => node.textContent)).toEqual(["1", "2", "1"]);
    const definitions = Array.from(view.contentDOM.querySelectorAll(".cm-md-footnote-definition"));
    expect(definitions.map((node) => node.textContent)).toEqual(["2", "1"]);
    expect(view.contentDOM.textContent).toContain("first note");
    expect(view.contentDOM.textContent).not.toContain("[^");
  });

  it("jumps from a reference to its definition and back", async () => {
    const source = "Text[^1]\n\n[^1]: the note";
    const view = mount(source, false);
    await focus(view);
    view.contentDOM.querySelector(".cm-md-footnote-reference")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(view.state.selection.main.head).toBe(source.indexOf("[^1]:"));
    view.dispatch({ selection: EditorSelection.cursor(source.length) });
    view.contentDOM.querySelector(".cm-md-footnote-definition")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(view.state.selection.main.head).toBe(source.indexOf("[^1]"));
  });

  it("leaves a reference without a definition as text", () => {
    const view = mount("Text[^missing]");
    expect(view.contentDOM.textContent).toBe("Text[^missing]");
  });

  it("shows the reference source when the caret touches it", async () => {
    const source = "Text[^1] tail\n\n[^1]: the note";
    const view = mount(source, false);
    await focus(view);
    view.dispatch({ selection: EditorSelection.cursor(4) });
    expect(view.contentDOM.textContent).toContain("Text[^1] tail");
  });
});

describe("Markdown front matter", () => {
  const source = '---\ntitle: "Hello"\ntags:\n  - a\n  - b\n---\n\n# Body';

  it("reads as a table and keeps the document untouched", () => {
    const view = mount(source);
    const table = view.dom.querySelector(".cm-md-front-matter-table");
    expect(Array.from(table?.querySelectorAll("dt") ?? []).map((node) => node.textContent)).toEqual(["title", "tags"]);
    expect(Array.from(table?.querySelectorAll("dd") ?? []).map((node) => node.textContent)).toEqual(["Hello", "a, b"]);
    expect(view.contentDOM.textContent).not.toContain("---");
    expect(view.state.doc.toString()).toBe(source);
  });

  it("opens its source from the widget", async () => {
    const view = mount(source, false);
    await focus(view);
    view.dom.querySelector<HTMLElement>(".cm-md-front-matter .cm-md-html-source-toggle")?.click();
    expect(view.contentDOM.textContent).toContain('title: "Hello"');
  });

  it.each([
    ["a rule that is not at the top", "text\n\n---\n\ntitle: x\n---"],
    ["an unclosed block", "---\ntitle: x\n\nno closing rule"],
    ["an empty block", "---\n---\n\nbody"],
  ])("ignores %s", (_name, text) => {
    expect(mount(text).dom.querySelector(".cm-md-front-matter")).toBeNull();
  });
});

describe("Markdown inside HTML", () => {
  it.each([
    ["details", "<details>\n<summary>Title</summary>\n\n- one\n- **two**\n\n</details>\n\nafter", "details li strong", "two"],
    ["a centered div", '<div align="center">\n\n**Bold** and [link](https://example.com)\n\n</div>', "div strong", "Bold"],
    ["a table cell", "<table>\n<tr>\n<td>\n\n**Bold**\n\n</td>\n</tr>\n</table>", "td strong", "Bold"],
  ])("renders the Markdown in %s", (_name, source, selector, text) => {
    const view = mount(source);
    const surface = view.dom.querySelector(".cm-md-html-rendered-surface");
    expect(surface?.querySelector(selector)?.textContent).toBe(text);
    expect(view.contentDOM.textContent).not.toContain("</");
    expect(view.dom.querySelectorAll(".cm-md-html-widget")).toHaveLength(1);
  });

  it("projects the same block when a range starts inside it", () => {
    const source = "<details>\n<summary>T</summary>\n\nbody\n\n</details>";
    const state = EditorState.create({
      doc: source,
      extensions: [...markdownCodeMirrorBaseExtensions(false)],
    });
    const blocks = getMarkdownPlanIndex(state).filter(({ plan }) => plan.presentation === "blockAtom");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.plan.sourceRange).toEqual({ from: 0, to: source.length });
  });

  it("reveals the whole authored source from the widget", async () => {
    const source = "<details>\n<summary>T</summary>\n\n**body**\n\n</details>\n\nafter";
    const view = mount(source, false);
    await focus(view);
    view.dom.querySelector<HTMLElement>(".cm-md-html-source-toggle")?.click();
    expect(view.contentDOM.textContent).toContain("<summary>T</summary>");
    expect(view.state.doc.toString()).toBe(source);
  });

  it("runs Markdown images through the media path", async () => {
    const view = mount("<div>\n\n![alt](a.png)\n\n</div>");
    expect(view.dom.querySelector(".cm-md-html-rendered-surface img")).not.toBeNull();
  });

  it("keeps script out of a Markdown flow", () => {
    const view = mount("<div>\n\ntext\n\n<script>alert(1)</script>\n\n</div>");
    expect(view.dom.querySelector("script")).toBeNull();
  });
});

describe("Markdown HTML renderer", () => {
  it.each([
    ["**b** *i* ~~s~~ `c`", "<strong>b</strong> <em>i</em> <del>s</del> <code>c</code>"],
    ["[x](https://example.com)", '<a href="https://example.com">x</a>'],
    ["![a](b.png)", '<img src="b.png" alt="a">'],
    ["[![a](b.png)](https://e.com)", '<a href="https://e.com"><img src="b.png" alt="a"></a>'],
    ["a <b>raw</b> c", "a <b>raw</b> c"],
    ["a &copy; b", "a &copy; b"],
    ["1 < 2 & 3", "1 &lt; 2 &amp; 3"],
    ["\\*x\\*", "*x*"],
    ["# not a heading", "# not a heading"],
    ["- not a list", "- not a list"],
    ["`<b>`", "<code>&lt;b&gt;</code>"],
  ])("renders inline %s", (source, html) => {
    expect(renderMarkdownInlineToHtml(source)).toBe(html);
  });

  it("quotes an attribute value", () => {
    expect(renderMarkdownInlineToHtml('[x](a"b)')).not.toContain('a"b');
  });

  it.each([
    ["# H", "<h1>H</h1>"],
    ["- a\n- b", "<ul>\n<li>a</li>\n<li>b</li>\n</ul>"],
    ["3. a", '<ol start="3">\n<li>a</li>\n</ol>'],
    ["> q", "<blockquote>\n<p>q</p>\n</blockquote>"],
    ["```\n<b>\n```", "<pre><code>&lt;b&gt;</code></pre>"],
    ["---", "<hr>"],
    ["| a |\n| - |\n| b |", "<table>\n<tr><th>a</th></tr>\n<tr><td>b</td></tr>\n</table>"],
    ["<div>x</div>", "<div>x</div>"],
  ])("renders the block %s", (source, html) => {
    expect(renderMarkdownBlocksToHtml(source).trim()).toBe(html);
  });

  it("resolves a reference through its host", () => {
    expect(renderMarkdownInlineToHtml("[x][r]", { resolveReference: () => "https://e.com" }))
      .toBe('<a href="https://e.com">x</a>');
    expect(renderMarkdownInlineToHtml("[x][r]")).toBe("[x][r]");
  });
});

describe("Markdown table cells use the page pipeline", () => {
  function render(source: string) {
    const target = document.createElement("div");
    document.body.appendChild(target);
    renderMarkdownInlineFromSharedPolicy(target, source, { openHref: () => undefined });
    return target;
  }

  it("handles nesting a scanner could not", () => {
    const target = render("**bold *and italic***");
    expect(target.querySelector("strong em")?.textContent).toBe("and italic");
  });

  it("keeps a wiki link inside plain text", () => {
    const target = render("see [[Note]] now");
    expect(target.textContent).toBe("see Note now");
  });

  it("links a bare URL", () => {
    expect(render("see https://example.com").querySelector("[data-md-href]")?.textContent).toBe("https://example.com");
  });

  it("decodes an entity", () => {
    expect(render("a &copy; b").textContent).toBe("a © b");
  });

  it("keeps a long pathological source linear", () => {
    const started = performance.now();
    render("[".repeat(20_000));
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

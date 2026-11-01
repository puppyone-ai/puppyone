/**
 * @vitest-environment happy-dom
 */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  markdownCodeMirrorBaseExtensions,
  markdownLivePreviewExtension,
} from "../../../../../../src/shared-ui/editor/markdown/markdownCodeMirrorExtensions";
import { getMarkdownPlanIndex } from "../../../../../../src/shared-ui/editor/markdown/core/plans/markdownPlanIndex";
import { markdownAssetUrlResolverFacet } from "../../../../../../src/shared-ui/editor/markdown/core/editor/markdownLivePreviewContext";

const IMAGE = "https://example.com/a.png";
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
        markdownLivePreviewExtension("safe", null, "note.md", async () => IMAGE),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ],
    }),
  });
  mountedViews.push(view);
  return view;
}

const hrefs = (view: EditorView) => Array.from(view.contentDOM.querySelectorAll<HTMLElement>("[data-md-href]"))
  .map((element) => element.dataset.mdHref);

describe("Markdown bare links", () => {
  it.each([
    ["a URL", "see https://example.com/a now", "https://example.com/a"],
    ["a www host", "see www.example.com now", "https://www.example.com"],
    ["an email", "ask a@example.com now", "mailto:a@example.com"],
  ])("links %s without changing its text", (_name, source, href) => {
    const view = mount(source);
    expect(hrefs(view)).toEqual([href]);
    expect(view.contentDOM.textContent).toBe(source);
  });

  it("leaves a URL inside code alone", () => {
    expect(hrefs(mount("`https://example.com`"))).toEqual([]);
  });

  it("does not double-link an explicit link destination", () => {
    expect(hrefs(mount("[x](https://example.com)"))).toEqual(["https://example.com"]);
  });
});

describe("Markdown reference links", () => {
  const definition = "\n\n[Ref]: https://example.com/r \"T\"";

  it.each([
    ["full", `[text][ref]${definition}`, "text"],
    ["collapsed", `[ref][]${definition}`, "ref"],
    ["shortcut", `[ref]${definition}`, "ref"],
  ])("resolves the %s form case-insensitively", (_name, source, text) => {
    const view = mount(source);
    const label = view.contentDOM.querySelector<HTMLElement>(".cm-md-link-label");
    expect(label?.dataset.mdHref).toBe("https://example.com/r");
    expect(label?.textContent).toBe(text);
    expect(view.contentDOM.querySelector(".cm-line")?.textContent).toBe(text);
  });

  it("keeps the definition visible and linked", () => {
    const view = mount(`[x][r]\n\n[r]: https://example.com/r`);
    expect(view.contentDOM.textContent).toContain("[r]: https://example.com/r");
    expect(hrefs(view)).toContain("https://example.com/r");
  });

  it("leaves an undefined label as text", () => {
    const view = mount("[x][missing]");
    expect(view.contentDOM.textContent).toBe("[x][missing]");
    expect(hrefs(view)).toEqual([]);
  });

  it.each([
    ["full", `![alt][r]\n\n[r]: ${IMAGE}`],
    ["collapsed", `![r][]\n\n[r]: ${IMAGE}`],
    ["shortcut", `![r]\n\n[r]: ${IMAGE}`],
  ])("renders the %s image form", (_name, source) => {
    const view = mount(source);
    expect(view.contentDOM.querySelectorAll(".cm-md-image-widget")).toHaveLength(1);
    expect(view.contentDOM.textContent).not.toContain("![");
  });
});

describe("Markdown text atoms", () => {
  it.each([
    ["a named entity", "a &copy; b", "a © b"],
    ["a decimal entity", "a &#35; b", "a # b"],
    ["a hex entity", "a &#x1F600; b", "a 😀 b"],
    ["an emoji", "a :smile: b", "a 😄 b"],
    ["a signed emoji", "a :+1: b", "a 👍 b"],
  ])("renders %s", (_name, source, text) => {
    const view = mount(source);
    expect(view.contentDOM.textContent).toBe(text);
    expect(view.state.doc.toString()).toBe(source);
  });

  it.each([
    ["an unknown shortcode", "12:30:45 :not_an_emoji:"],
    ["an entity in code", "`&copy;`"],
    ["a shortcode in code", "`:smile:`"],
  ])("leaves %s literal", (_name, source) => {
    expect(mount(source).contentDOM.textContent).toBe(source.replaceAll("`", ""));
  });

  it("shows the source when the caret touches an entity", async () => {
    const source = "a &copy; b";
    const view = mount(source, false);
    view.focus();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    view.dispatch({ selection: { anchor: 2 } });
    expect(view.contentDOM.textContent).toBe(source);
    view.dispatch({ selection: { anchor: 0 } });
    expect(view.contentDOM.textContent).toBe("a © b");
  });
});

describe("Markdown inline marks", () => {
  it("hides a backslash line break but keeps the break", () => {
    const view = mount("a\\\nb");
    expect(view.contentDOM.textContent).toBe("ab");
    expect(view.contentDOM.querySelectorAll(".cm-line")).toHaveLength(2);
    expect(view.state.doc.toString()).toBe("a\\\nb");
  });

  it("strikes single-tilde text", () => {
    const view = mount("a ~b~ c");
    expect(view.contentDOM.querySelector(".cm-md-syntax-strikethrough")?.textContent).toBe("b");
    expect(view.contentDOM.textContent).toBe("a b c");
  });

  it("highlights double-equals text and leaves a heading underline alone", () => {
    const view = mount("a ==b== c\n\nTitle\n===");
    expect(view.contentDOM.querySelector(".cm-md-syntax-highlight")?.textContent).toBe("b");
    expect(view.contentDOM.textContent).toContain("a b c");
  });

  it("does not highlight spaced equals", () => {
    expect(mount("a == b == c").contentDOM.querySelector(".cm-md-syntax-highlight")).toBeNull();
  });

  it.each([
    ["an HTML block comment", "<!-- hidden -->\n\nVisible", "<!-- hidden -->"],
    ["a multi-line HTML comment", "<!--\nhidden\n-->\n\nVisible", "hidden"],
    ["an inline HTML comment", "a <!-- hidden --> b", "<!-- hidden -->"],
    ["a percent comment", "a %%hidden%% b", "%%hidden%%"],
  ])("dims %s and keeps it visible", (_name, source, text) => {
    const view = mount(source);
    const dimmed = Array.from(view.contentDOM.querySelectorAll(".cm-md-comment")).map((node) => node.textContent).join("");
    expect(dimmed).toContain(text);
    expect(view.contentDOM.textContent).toContain(text);
  });
});

describe("Markdown math forms", () => {
  function kinds(source: string) {
    const state = EditorState.create({
      doc: source,
      extensions: [...markdownCodeMirrorBaseExtensions(false), markdownAssetUrlResolverFacet.of(null)],
    });
    return getMarkdownPlanIndex(state).map(({ element }) => element.kind);
  }

  it("treats backtick math as inline math", () => {
    expect(kinds("a $`x^2`$ b")).toContain("mathInline");
  });

  it("treats a math fence as block math", () => {
    const fence = "```math\nx^2\n```";
    expect(kinds(fence)).toContain("mathBlock");
    expect(kinds(fence)).not.toContain("fence");
  });

  it("keeps other fences as code", () => {
    expect(kinds("```js\nx\n```")).toContain("fence");
  });
});

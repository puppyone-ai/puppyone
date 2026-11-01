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
import { renderMarkdownInlineFromSharedPolicy } from "../../../../../../src/shared-ui/editor/markdown/composition/preview/markdownInlinePlanAdapter";
import { markdownAssetUrlResolverFacet } from "../../../../../../src/shared-ui/editor/markdown/core/editor/markdownLivePreviewContext";
import {
  getCollapsedMarkerDeletionUnit,
  getMarkdownPlanIndex,
} from "../../../../../../src/shared-ui/editor/markdown/core/plans/markdownPlanIndex";
import type { MarkdownInlineAtomPlan } from "../../../../../../src/shared-ui/editor/markdown/core/plans/markdownPlanTypes";
import { getInlineRevealElement } from "../../../../../../src/shared-ui/editor/markdown/core/syntax/markdownElements";
import { compileMarkdownHtmlBlockPolicy } from "../../../../../../src/shared-ui/editor/markdown/features/html/htmlBlockPolicy";
import { HtmlRunWidget } from "../../../../../../src/shared-ui/editor/markdown/features/html/htmlRunWidget";
import { getMarkdownInlineHtmlInRange } from "../../../../../../src/shared-ui/editor/markdown/features/html/inlineHtmlModel";
import { createSanitizedBlockHtmlFragment } from "../../../../../../src/shared-ui/editor/markdown/features/html/sanitizeHtml";
import type { MarkdownAssetUrlResolver } from "../../../../../../src/shared-ui/editor/registry/viewerTypes";

const LINK = "https://example.com/download";
const PICTURE = '<picture><source media="(prefers-color-scheme: dark)" srcset="assets/dark.svg"><img src="assets/light.svg" alt="Download" width="196"></picture>';
const LINKED_PICTURE = `<a href="${LINK}">${PICTURE}</a>`;
const BROKERED_ROOT = "puppyone-local://file/token/markdown-asset/root/";

const brokerAll: MarkdownAssetUrlResolver = async (_documentPath, href) => `${BROKERED_ROOT}${href}`;
const mountedViews: EditorView[] = [];

afterEach(() => {
  for (const view of mountedViews.splice(0)) view.destroy();
  document.body.replaceChildren();
});

function mount(
  source: string,
  { readOnly = true, resolver = brokerAll }: {
    readOnly?: boolean;
    resolver?: MarkdownAssetUrlResolver | null;
  } = {},
) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: source,
      extensions: [
        ...markdownCodeMirrorBaseExtensions(readOnly),
        markdownLivePreviewExtension("safe", null, "README.md", resolver),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ],
    }),
  });
  mountedViews.push(view);
  return view;
}

function createState(source: string, resolver: MarkdownAssetUrlResolver | null = brokerAll) {
  return EditorState.create({
    doc: source,
    extensions: [
      ...markdownCodeMirrorBaseExtensions(false),
      markdownAssetUrlResolverFacet.of(resolver),
    ],
  });
}

function getRunPlans(state: EditorState): MarkdownInlineAtomPlan<"htmlRun">[] {
  return getMarkdownPlanIndex(state).flatMap(({ plan }) => (
    plan.presentation === "inlineAtom" && plan.atom.kind === "htmlRun"
      ? [plan as MarkdownInlineAtomPlan<"htmlRun">]
      : []
  ));
}

function runs(view: EditorView) {
  return Array.from(view.contentDOM.querySelectorAll<HTMLElement>(".cm-md-html-run"));
}

async function waitFor(assertion: () => boolean, attempts = 200): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (assertion()) return;
    await new Promise((resolve) => window.setTimeout(resolve, 2));
  }
  throw new Error("Timed out waiting for Markdown HTML run state.");
}

async function focusEditor(view: EditorView) {
  view.focus();
  await new Promise((resolve) => window.setTimeout(resolve, 20));
}

describe("Markdown HTML run projection", () => {
  it("renders the linked theme-aware download cards of a README list item", async () => {
    const source = `1. **Get it.**\n\n   ${LINKED_PICTURE}\n   ${LINKED_PICTURE}\n\n2. Open a folder.`;
    const view = mount(source);

    expect(runs(view)).toHaveLength(2);
    expect(view.contentDOM.textContent).not.toContain("<");
    expect(view.state.doc.toString()).toBe(source);

    const [first] = runs(view);
    const link = first?.querySelector<HTMLElement>('[data-md-href]');
    expect(link?.dataset.mdHref).toBe(LINK);
    expect(link?.hasAttribute("href")).toBe(false);
    expect(link?.querySelector("picture > source")?.getAttribute("media"))
      .toBe("(prefers-color-scheme: dark)");

    await waitFor(() => first?.querySelector<HTMLImageElement>("img")?.hasAttribute("src") === true);
    expect(first?.querySelector("source")?.getAttribute("srcset")).toBe(`${BROKERED_ROOT}assets/dark.svg`);
    expect(first?.querySelector("img")?.getAttribute("src")).toBe(`${BROKERED_ROOT}assets/light.svg`);
    expect(first?.querySelector("img")?.getAttribute("width")).toBe("196");
  });

  it("keeps the list continuation indent out of the replaced range", () => {
    const source = `1. Item\n\n   ${LINKED_PICTURE}`;
    const [plan] = getRunPlans(createState(source));
    expect(plan?.sourceRange).toEqual({ from: source.indexOf("<a"), to: source.length });
  });

  it.each([
    ["a linked image", `<a href="${LINK}"><img src="a.png" alt="i"></a>`, 1],
    ["two images on one line", '<img src="a.png" alt="a"> <img src="b.png" alt="b">', 2],
    ["a span around an image", '<span><img src="a.png" alt="i"></span>', 1],
    ["a heading image", '# Title <img src="a.png" alt="i" width="20">', 1],
    ["a list marker image", '- <img src="a.png" alt="i">', 1],
    ["a quote marker image", '> <img src="a.png" alt="i">', 1],
    ["a theme picture", PICTURE, 1],
  ])("renders %s without exposing tags", (_name, source, count) => {
    const view = mount(source);
    expect(runs(view)).toHaveLength(count);
    expect(view.contentDOM.textContent).not.toContain("<");
  });

  it("keeps the text around a run as ordinary document text", () => {
    const view = mount('before <img src="a.png" alt="i"> **after**');
    expect(runs(view)).toHaveLength(1);
    expect(view.contentDOM.textContent).toBe("before  after");
    expect(view.contentDOM.querySelector(".cm-md-syntax-strong")?.textContent).toBe("after");
  });

  it("renders Markdown inside an inline run but never re-reads escaped text as HTML", () => {
    const view = mount("head <center>**bold** &lt;b&gt;plain&lt;/b&gt;</center> tail");
    const [run] = runs(view);
    expect(run?.querySelector("strong")?.textContent).toBe("bold");
    expect(run?.querySelector("b")).toBeNull();
    expect(run?.textContent).toContain("<b>plain</b>");
  });

  it.each([
    ["a list marker", '- <div align="center">hi</div>', "hi"],
    ["an ordered list marker", "1. <details><summary>S</summary>Body</details>", "SBody"],
    ["a quote marker", "> <details><summary>S</summary>Body</details>", "SBody"],
  ])("projects an HTML block sharing its line with %s", (_name, source, text) => {
    const view = mount(source);
    const [run] = runs(view);
    expect(run?.classList.contains("is-block")).toBe(true);
    expect(run?.textContent).toBe(text);
    expect(view.contentDOM.textContent).not.toContain("<");
  });

  it("keeps one classification however a range query slices a multi-line run", () => {
    const source = `Click <a href="${LINK}">\n<img src="a.png" alt="i">\n</a> now`;
    const state = createState(source);
    const firstLine = state.doc.line(1);
    const [owner] = getMarkdownInlineHtmlInRange(state, firstLine.from, firstLine.to);
    expect(owner).toMatchObject({ tagName: "a", runRole: "owner" });
    expect(getRunPlans(state)).toHaveLength(1);
    expect(runs(mount(source))).toHaveLength(1);
  });

  it("strips quote prefixes from the source of a multi-line run", () => {
    const source = `> Click <a href="${LINK}">\n> <img src="a.png" alt="i">\n> </a> now`;
    const [plan] = getRunPlans(createState(source));
    expect(plan?.atom.source).toBe(`<a href="${LINK}">\n<img src="a.png" alt="i">\n</a>`);
  });

  it("gives a standalone media line to the block widget alone", () => {
    const state = createState('<img src="a.png" alt="i">');
    expect(getRunPlans(state)).toHaveLength(0);
    expect(getMarkdownPlanIndex(state).filter(({ plan }) => plan.presentation === "blockAtom")).toHaveLength(1);
  });

  it("keeps editable inline marks for text-only HTML", () => {
    const source = "<kbd>K</kbd> <ins>a</ins> <samp>b</samp> <strike>c</strike> <tt>d</tt> <var>e</var>";
    const view = mount(source);
    expect(runs(view)).toHaveLength(0);
    expect(view.contentDOM.textContent).toBe("K a b c d e");
    expect(view.contentDOM.querySelector("kbd")?.textContent).toBe("K");
    expect(view.contentDOM.querySelector("strike")?.textContent).toBe("c");
  });

  it("hides an empty element while keeping its source", () => {
    const source = "<span></span>\n\nBody";
    const view = mount(source);
    expect(view.contentDOM.textContent).toBe("Body");
    expect(view.state.doc.toString()).toBe(source);
  });

  it("treats a legacy named anchor as an in-page target", () => {
    const view = mount('<a name="top"></a>\n\nBody');
    expect(view.contentDOM.textContent).toBe("Body");
  });
});

describe("Markdown HTML run source fallbacks", () => {
  it.each([
    ["a blocked root", "before <script>alert(1)</script> after"],
    ["an incomplete run", '<a href="https://example.com"><img src="a.png"> after'],
    ["a mismatched run", '<span><img src="a.png"></b></span>'],
    ["an unsafe link", '<a href="javascript:alert(1)"><img src="a.png"></a>'],
  ])("keeps %s visible", (_name, source) => {
    const view = mount(source);
    expect(runs(view)).toHaveLength(0);
    expect(view.contentDOM.textContent).toContain("<");
  });

  it("removes a nested blocked element and keeps the rest of the run", () => {
    const view = mount("<span><script>alert(1)</script>safe</span> tail");
    const [run] = runs(view);
    expect(run?.textContent).toBe("safe");
    expect(run?.querySelector("script")).toBeNull();
  });

  it("does not render media on a surface without an asset broker", () => {
    const source = `<a href="${LINK}"><img src="a.png" alt="i"></a>`;
    const view = mount(source, { resolver: null });
    expect(runs(view)).toHaveLength(0);
    expect(getMarkdownPlanIndex(createState(source, null)).map(({ plan }) => plan.diagnostics[0]?.code))
      .toContain("htmlBlock.asset-broker-unavailable");
  });
});

describe("Markdown HTML run editing", () => {
  const source = 'before <img src="a.png" alt="i"> after';
  const from = source.indexOf("<img");
  const to = source.indexOf(" after");

  it.each([
    ["its opening edge", from],
    ["its closing edge", to],
    ["its interior", from + 4],
  ])("shows the exact source for a caret at %s", async (_name, caret) => {
    const view = mount(source, { readOnly: false });
    await focusEditor(view);
    view.dispatch({ selection: { anchor: caret } });
    expect(runs(view)).toHaveLength(0);
    expect(view.contentDOM.textContent).toBe(source);
  });

  it("folds the run again when the caret leaves, without touching the document", async () => {
    const view = mount(source, { readOnly: false });
    await focusEditor(view);
    view.dispatch({ selection: { anchor: from } });
    expect(runs(view)).toHaveLength(0);
    view.dispatch({ selection: { anchor: 0 } });
    expect(runs(view)).toHaveLength(1);
    expect(view.state.doc.toString()).toBe(source);
  });

  it("does not let Markdown nested in a revealed run steal the reveal", async () => {
    const nested = "a <center>x **bold** y</center> b";
    const view = mount(nested, { readOnly: false });
    await focusEditor(view);
    view.dispatch({ selection: { anchor: nested.indexOf("bold") + 1 } });
    expect(runs(view)).toHaveLength(0);
    expect(view.contentDOM.textContent).toBe(nested);
  });

  it("never reveals on a read-only surface", () => {
    const view = mount(source);
    view.dispatch({ selection: { anchor: from } });
    expect(runs(view)).toHaveLength(1);
  });

  it("keeps a selection across the run in one projection", async () => {
    const view = mount(source, { readOnly: false });
    await focusEditor(view);
    view.dispatch({ selection: EditorSelection.range(0, source.length) });
    expect(runs(view)).toHaveLength(1);
  });

  it("deletes source text one character at a time at the run edges", () => {
    const state = createState(source);
    expect(getCollapsedMarkerDeletionUnit(state, to, "backward")).toBeNull();
    expect(getCollapsedMarkerDeletionUnit(state, from, "forward")).toBeNull();
  });

  it("reports the run as the reveal element for a caret on either edge", () => {
    const state = createState(source);
    for (const caret of [from, to]) {
      expect(getInlineRevealElement(state, caret)).toMatchObject({ kind: "inlineHtml", from, to });
    }
    expect(getInlineRevealElement(state, from - 1)).toBeNull();
    expect(getInlineRevealElement(state, to + 1)).toBeNull();
  });

  it("lets links and disclosure controls keep their pointer gestures", () => {
    const widget = new HtmlRunWidget(
      { source: "<b>x</b>", rootIsBlock: false, profileVersion: "test" },
      "README.md",
      null,
      renderMarkdownInlineFromSharedPolicy,
    );
    const link = document.createElement("a");
    link.dataset.mdHref = LINK;
    const image = link.appendChild(document.createElement("img"));
    const summary = document.createElement("summary");
    const plain = document.createElement("span");

    const event = (target: Element) => {
      const created = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(created, "target", { value: target });
      return created;
    };
    expect(widget.ignoreEvent(event(image))).toBe(true);
    expect(widget.ignoreEvent(event(summary))).toBe(true);
    expect(widget.ignoreEvent(event(plain))).toBe(false);
  });
});

describe("Markdown theme-aware picture media", () => {
  it("waits for picture candidates before giving the fallback image a URL", async () => {
    let releaseDark: (url: string) => void = () => undefined;
    const resolver: MarkdownAssetUrlResolver = (_documentPath, href) => (
      href === "assets/dark.svg"
        ? new Promise<string>((resolve) => { releaseDark = resolve; })
        : Promise.resolve(`${BROKERED_ROOT}${href}`)
    );
    const view = mount(PICTURE, { resolver });
    const image = runs(view)[0]?.querySelector("img");

    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(image?.hasAttribute("src")).toBe(false);

    releaseDark(`${BROKERED_ROOT}assets/dark.svg`);
    await waitFor(() => image?.hasAttribute("src") === true);
    expect(runs(view)[0]?.querySelector("source")?.getAttribute("srcset"))
      .toBe(`${BROKERED_ROOT}assets/dark.svg`);
  });

  it("removes an unauthorized candidate so the fallback image still shows", async () => {
    const resolver: MarkdownAssetUrlResolver = async (_documentPath, href) => (
      href === "assets/dark.svg" ? null : `${BROKERED_ROOT}${href}`
    );
    const view = mount(PICTURE, { resolver });
    const [run] = runs(view);
    await waitFor(() => run?.querySelector("img")?.hasAttribute("src") === true);
    expect(run?.querySelector("source")).toBeNull();
  });

  it("falls back to alt text when no picture candidate is authorized", async () => {
    const view = mount(PICTURE, { resolver: () => null });
    await waitFor(() => view.contentDOM.querySelector(".cm-md-html-image-fallback") !== null);
    expect(view.contentDOM.querySelector(".cm-md-html-image-fallback")?.textContent).toBe("Download");
  });

  it("never leaves an authored source URL on a live browser sink", () => {
    const { fragment, supported } = createSanitizedBlockHtmlFragment(PICTURE, { deferredMedia: true });
    expect(supported).toBe(true);
    const source = fragment.querySelector("source");
    expect(source?.hasAttribute("srcset")).toBe(false);
    expect(source?.dataset.mdAssetSrcset).toBe("assets/dark.svg");
    expect(fragment.querySelector("img")?.hasAttribute("src")).toBe(false);
  });

  it("renders a picture block through the shared block widget", async () => {
    const view = mount(`<div align="center">\n  ${PICTURE}\n</div>`);
    const surface = view.dom.querySelector<HTMLElement>(".cm-md-html-rendered-surface");
    expect(surface?.querySelector("picture source")).not.toBeNull();
    await waitFor(() => surface?.querySelector("source")?.hasAttribute("srcset") === true);
  });
});

describe("Markdown HTML reduction", () => {
  function sanitized(source: string) {
    const result = createSanitizedBlockHtmlFragment(source, { deferredMedia: true });
    const box = document.createElement("div");
    box.appendChild(result.fragment);
    return { box, supported: result.supported };
  }

  function policy(source: string) {
    return compileMarkdownHtmlBlockPolicy({
      source,
      status: "complete",
      diagnostic: null,
      assetBrokerAvailable: true,
    });
  }

  it.each([
    ["an unknown tag", "<div><foo>hello</foo></div>", "<div>hello</div>"],
    ["a presentational tag", "<div><center>hello</center></div>", "<div>hello</div>"],
    ["a form wrapper", "<div><form>hello</form></div>", "<div>hello</div>"],
    ["a script payload", '<div onclick="evil()"><script>alert(1)</script>hello</div>', "<div>hello</div>"],
    ["a style payload", "<div><style>p{color:red}</style>hello</div>", "<div>hello</div>"],
  ])("reduces only %s", (_name, source, html) => {
    const { box, supported } = sanitized(source);
    expect(supported).toBe(true);
    expect(box.innerHTML).toBe(html);
    expect(policy(source).supported).toBe(true);
  });

  it("keeps a table whose unknown column group is dropped", () => {
    const source = '<table><colgroup><col width="50"></colgroup><tr><td>c</td></tr></table>';
    const { box, supported } = sanitized(source);
    expect(supported).toBe(true);
    expect(box.querySelector("td")?.textContent).toBe("c");
    expect(box.querySelector("colgroup")).toBeNull();
  });

  it.each([
    ["img width percent", '<div><img src="a.png" alt="i" width="50%"></div>', "img", "width", "50%"],
    ["img width pixels", '<div><img src="a.png" alt="i" width="200px"></div>', "img", "width", "200px"],
    ["img placement", '<div><img src="a.png" alt="i" align="right"></div>', "img", "align", "right"],
    ["table alignment", '<table align="center"><tr><td>c</td></tr></table>', "table", "align", "center"],
    ["table width", '<table width="100%"><tr><td>c</td></tr></table>', "table", "width", "100%"],
    ["cell width", '<table><tr><td width="50%">c</td></tr></table>', "td", "width", "50%"],
    ["cell vertical alignment", '<table><tr><td valign="top">c</td></tr></table>', "td", "valign", "top"],
    ["list start", '<ol start="3"><li>x</li></ol>', "ol", "start", "3"],
    ["list type", '<ol type="a"><li>x</li></ol>', "ol", "type", "a"],
    ["anchor name", '<div><a name="top">x</a></div>', "a", "id", "md-doc-top"],
  ])("keeps %s", (_name, source, selector, attribute, value) => {
    expect(sanitized(source).box.querySelector(selector)?.getAttribute(attribute)).toBe(value);
  });

  it.each([
    ["an img width expression", '<div><img src="a.png" alt="i" width="calc(1px)"></div>', "img", "width"],
    ["an img placement", '<div><img src="a.png" alt="i" align="javascript"></div>', "img", "align"],
    ["a cell alignment", '<table><tr><td valign="sideways">c</td></tr></table>', "td", "valign"],
    ["a list start", '<ol start="1e9"><li>x</li></ol>', "ol", "start"],
    ["a list type", '<ol type="disc"><li>x</li></ol>', "ol", "type"],
    ["a source condition", `<picture><source media="a{}" srcset="d.svg"><img src="l.svg" alt="p"></picture>`, "source", "media"],
  ])("omits an invalid value for %s", (_name, source, selector, attribute) => {
    expect(sanitized(source).box.querySelector(selector)?.hasAttribute(attribute)).toBe(false);
  });

  it("prefers an explicit id over a legacy anchor name", () => {
    const { box } = sanitized('<div><a id="real" name="legacy">x</a></div>');
    expect(box.querySelector("a")?.id).toBe("md-doc-real");
  });

  it("records a reduction diagnostic without losing the block", () => {
    expect(policy("<div><foo>x</foo></div>")).toMatchObject({
      supported: true,
      diagnostics: [{ code: "htmlBlock.tag-reduced" }],
    });
  });

  it("still refuses a blocked root in any position", () => {
    expect(policy("<div>a</div><script>alert(1)</script>")).toMatchObject({
      supported: false,
      diagnostic: { code: "htmlBlock.blocked-tag" },
    });
  });
});

describe("Markdown HTML in isolated table-cell previews", () => {
  it("hydrates a picture through the same media path", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    renderMarkdownInlineFromSharedPolicy(target, PICTURE, {
      resolveAssetUrl: async (_documentPath, href) => `${BROKERED_ROOT}${href}`,
      sourcePath: "README.md",
    });
    await waitFor(() => target.querySelector("img")?.hasAttribute("src") === true);
    expect(target.querySelector("source")?.getAttribute("srcset")).toBe(`${BROKERED_ROOT}assets/dark.svg`);
    expect(target.textContent).toBe("");
  });

  it("renders a linked image inside a table cell", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    renderMarkdownInlineFromSharedPolicy(target, `<a href="${LINK}"><img src="a.png" alt="i"></a>`, {
      resolveAssetUrl: async (_documentPath, href) => `${BROKERED_ROOT}${href}`,
      openHref: () => undefined,
    });
    await waitFor(() => target.querySelector("img")?.hasAttribute("src") === true);
    expect(target.querySelector('[data-md-href]')?.querySelector("img")).not.toBeNull();
  });

  it("keeps the whole label of a badge link", () => {
    const target = document.createElement("div");
    renderMarkdownInlineFromSharedPolicy(target, `[![b](a.png)](${LINK})`, { openHref: () => undefined });
    expect(target.querySelector("[data-md-href]")?.getAttribute("data-md-href")).toBe(LINK);
    expect(target.textContent).not.toContain("![");
    expect(target.textContent).not.toContain("](");
  });

  it("keeps media as visible source without an asset broker", () => {
    const target = document.createElement("div");
    renderMarkdownInlineFromSharedPolicy(target, PICTURE);
    expect(target.textContent).toBe(PICTURE);
  });
});

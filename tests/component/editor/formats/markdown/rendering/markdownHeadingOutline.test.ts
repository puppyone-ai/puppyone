/**
 * @vitest-environment happy-dom
 */
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  puppyMarkdownFeatureCompositionExtension,
  puppyMarkdownParserExtensions,
} from "../../../../../../packages/shared-ui/src/editor/markdown/composition/markdownFeatureComposition";
import {
  collectMarkdownHeadingOutlineEntries,
  markdownHeadingOutlineExtension,
} from "../../../../../../packages/shared-ui/src/editor/markdown/core/interaction/markdownHeadingOutline";
import {
  markdownCodeMirrorBaseExtensions,
  markdownLivePreviewExtension,
} from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";

const mountedViews: Array<{ parent: HTMLElement; view: EditorView }> = [];

afterEach(() => {
  for (const { parent, view } of mountedViews.splice(0)) {
    view.destroy();
    parent.remove();
  }
});

describe("Markdown heading outline", () => {
  it("collects ATX headings with visible titles", () => {
    const state = createMarkdownState([
      "# Company",
      "",
      "## Design",
      "",
      "### Frontend",
    ].join("\n"));

    expect(collectMarkdownHeadingOutlineEntries(state)).toEqual([
      { from: 2, level: 1, title: "Company" },
      { from: 14, level: 2, title: "Design" },
      { from: 26, level: 3, title: "Frontend" },
    ]);
  });

  it("collects headings across a long document without treating fenced code as headings", () => {
    const state = createMarkdownState([
      "# H1 title",
      ...Array.from({ length: 12 }, (_, index) => `Paragraph ${index + 1}. ${"content ".repeat(12)}`),
      "## H2 title",
      ...Array.from({ length: 12 }, (_, index) => `Paragraph ${index + 13}. ${"content ".repeat(12)}`),
      "### H3 title",
      ...Array.from({ length: 12 }, (_, index) => `Paragraph ${index + 25}. ${"content ".repeat(12)}`),
      "```md",
      "# Not a heading",
      "```",
      "## Later title",
      ...Array.from({ length: 12 }, (_, index) => `Paragraph ${index + 37}. ${"content ".repeat(12)}`),
      "### Final title",
    ].join("\n\n"));

    expect(collectMarkdownHeadingOutlineEntries(state).map(({ level, title }) => ({ level, title }))).toEqual([
      { level: 1, title: "H1 title" },
      { level: 2, title: "H2 title" },
      { level: 3, title: "H3 title" },
      { level: 2, title: "Later title" },
      { level: 3, title: "Final title" },
    ]);
  });

  it("mounts a compact ChatGPT-style navigation rail for long live preview documents", async () => {
    const source = [
      "# One",
      "",
      "## Two",
      "",
      "### Three",
      "",
      ...Array.from({ length: 80 }, (_, index) => `Paragraph ${index + 1}.`),
    ].join("\n");
    const view = mountMarkdown(source);
    Object.defineProperty(view.scrollDOM, "clientHeight", { configurable: true, value: 120 });
    Object.defineProperty(view.scrollDOM, "scrollHeight", { configurable: true, value: 2400 });
    view.dispatch({});
    await flushMeasures();

    const layer = view.dom.querySelector<HTMLElement>(".cm-md-heading-outline-layer");
    expect(layer?.classList.contains("is-visible")).toBe(true);
    expect(layer?.classList.contains("is-expanded")).toBe(false);
    expect(layer?.hasAttribute("aria-hidden")).toBe(false);
    expect(view.dom.querySelector(".cm-md-heading-outline-panel")).toBeNull();
    expect(view.dom.querySelector(".cm-md-heading-outline-grip")).toBeNull();
    expect(view.dom.querySelector(".cm-md-heading-outline-spine")).toBeNull();

    const rail = view.dom.querySelector<HTMLElement>(".cm-md-heading-outline-rail");
    expect(rail?.getAttribute("role")).toBe("navigation");
    expect(rail?.getAttribute("aria-label")).toBe("Document outline");
    expect(rail?.style.width).toBe("");
    expect(rail?.style.top).toBe("34px");
    expect(rail?.style.height).toBe("52px");

    const ticks = [...view.dom.querySelectorAll<HTMLButtonElement>(".cm-md-heading-outline-tick")];
    expect(ticks).toHaveLength(3);
    expect(ticks.map((tick) => tick.style.top)).toEqual(["7px", "26px", "45px"]);
    expect(ticks.map((tick) => tick.style.width)).toEqual(["", "", ""]);
    expect(ticks.map((tick) => tick.dataset.level)).toEqual([undefined, undefined, undefined]);
    expect(ticks.filter((tick) => tick.tabIndex === 0)).toHaveLength(1);
    expect(ticks.filter((tick) => tick.tabIndex === -1)).toHaveLength(2);

    rail?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    expect(layer?.classList.contains("is-expanded")).toBe(false);
  });

  it("moves keyboard focus between heading dashes without opening a panel", async () => {
    const view = mountMarkdown([
      "# One",
      "",
      "## Two",
      "",
      "### Three",
      "",
      ...Array.from({ length: 80 }, (_, index) => `Paragraph ${index + 1}.`),
    ].join("\n"));
    Object.defineProperty(view.scrollDOM, "clientHeight", { configurable: true, value: 120 });
    Object.defineProperty(view.scrollDOM, "scrollHeight", { configurable: true, value: 2400 });
    view.dispatch({});
    await flushMeasures();

    const ticks = [...view.dom.querySelectorAll<HTMLButtonElement>(".cm-md-heading-outline-tick")];
    ticks[0].focus();
    ticks[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));

    expect(document.activeElement).toBe(ticks[1]);
    expect(ticks[0].tabIndex).toBe(-1);
    expect(ticks[1].tabIndex).toBe(0);
    expect(view.dom.querySelector(".cm-md-heading-outline-panel")).toBeNull();
  });

  it("reveals a compact heading list when a directory dash is hovered", async () => {
    const view = mountLongOutline();
    await flushMeasures();

    const layer = view.dom.querySelector<HTMLElement>(".cm-md-heading-outline-layer");
    const popover = view.dom.querySelector<HTMLElement>(".cm-md-heading-outline-popover");
    const ticks = [...view.dom.querySelectorAll<HTMLButtonElement>(".cm-md-heading-outline-tick")];
    expect(popover?.getAttribute("aria-hidden")).toBe("true");
    expect(popover?.getAttribute("role")).toBe("group");
    expect(popover?.getAttribute("aria-label")).toBe("Document headings");
    expect(popover?.style.maxHeight).toBe("88px");

    ticks[1].dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));

    expect(layer?.classList.contains("is-popover-open")).toBe(true);
    expect(popover?.getAttribute("aria-hidden")).toBe("false");
    const items = [...view.dom.querySelectorAll<HTMLButtonElement>(".cm-md-heading-outline-item")];
    expect(items.map((item) => item.textContent)).toEqual(["One", "Two", "Three"]);
    expect(items[0].getAttribute("aria-current")).toBe("location");
    expect(items[1].classList.contains("is-previewed")).toBe(true);
    expect(ticks.map((tick) => tick.getAttribute("aria-expanded"))).toEqual(["false", "true", "false"]);
  });

  it("keeps the heading list open while the pointer crosses into it, then closes after leaving", async () => {
    const view = mountLongOutline();
    await flushMeasures();

    const layer = view.dom.querySelector<HTMLElement>(".cm-md-heading-outline-layer");
    const popover = view.dom.querySelector<HTMLElement>(".cm-md-heading-outline-popover");
    const tick = view.dom.querySelector<HTMLButtonElement>('.cm-md-heading-outline-tick[data-index="1"]');
    tick?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    tick?.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    popover?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));

    await wait(180);
    expect(layer?.classList.contains("is-popover-open")).toBe(true);

    popover?.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    await wait(180);
    expect(layer?.classList.contains("is-popover-open")).toBe(false);
    expect(popover?.getAttribute("aria-hidden")).toBe("true");
    expect(tick?.getAttribute("aria-expanded")).toBe("false");
  });

  it("mirrors the hover disclosure for keyboard focus and closes it with Escape", async () => {
    const view = mountLongOutline();
    await flushMeasures();

    const layer = view.dom.querySelector<HTMLElement>(".cm-md-heading-outline-layer");
    const popover = view.dom.querySelector<HTMLElement>(".cm-md-heading-outline-popover");
    const tick = view.dom.querySelector<HTMLButtonElement>('.cm-md-heading-outline-tick[data-index="1"]');
    tick?.focus();

    expect(layer?.classList.contains("is-popover-open")).toBe(true);
    expect(popover?.getAttribute("aria-hidden")).toBe("false");

    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    tick?.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(layer?.classList.contains("is-popover-open")).toBe(false);
    expect(popover?.getAttribute("aria-hidden")).toBe("true");
  });

  it("jumps from a heading-list item and returns focus to the editor", async () => {
    const view = mountLongOutline();
    await flushMeasures();

    const layer = view.dom.querySelector<HTMLElement>(".cm-md-heading-outline-layer");
    const tick = view.dom.querySelector<HTMLButtonElement>('.cm-md-heading-outline-tick[data-index="1"]');
    tick?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    const item = view.dom.querySelector<HTMLButtonElement>('.cm-md-heading-outline-item[data-index="2"]');
    item?.focus();
    item?.click();

    expect(view.hasFocus).toBe(true);
    expect(layer?.classList.contains("is-popover-open")).toBe(false);
  });

  it("preserves a focused heading-list item while scroll state is measured", async () => {
    const view = mountLongOutline();
    await flushMeasures();

    const tick = view.dom.querySelector<HTMLButtonElement>('.cm-md-heading-outline-tick[data-index="1"]');
    tick?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    const item = view.dom.querySelector<HTMLButtonElement>('.cm-md-heading-outline-item[data-index="1"]');
    item?.focus();
    view.scrollDOM.dispatchEvent(new Event("scroll"));
    await flushMeasures();

    expect(document.activeElement).toBe(item);
    expect(view.dom.querySelector('.cm-md-heading-outline-item[data-index="1"]')).toBe(item);
  });

  it("preserves a focused directory dash while scroll state is measured", async () => {
    const view = mountLongOutline();
    await flushMeasures();

    const tick = view.dom.querySelector<HTMLButtonElement>('.cm-md-heading-outline-tick[data-index="1"]');
    tick?.focus();
    view.scrollDOM.dispatchEvent(new Event("scroll"));
    await flushMeasures();

    expect(document.activeElement).toBe(tick);
    expect(view.dom.querySelector('.cm-md-heading-outline-tick[data-index="1"]')).toBe(tick);
  });

  it("keeps the visible dash separate from its pointer target without expandable chrome", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/shared-ui/src/styles/editor/markdown-editor.css"),
      "utf8",
    );
    expect(css).toContain(".cm-md-heading-outline-layer");
    expect(css).toContain(".cm-md-heading-outline-tick::before");
    expect(css).toContain(".cm-md-heading-outline-tick.is-active::before");
    expect(css).toContain(".cm-md-heading-outline-popover");
    expect(css).toContain(".cm-md-heading-outline-item");
    expect(css).toContain(".cm-md-heading-outline-layer.is-popover-open");
    expect(css).not.toContain(".cm-md-heading-outline-panel");
    expect(css).not.toContain(".cm-md-heading-outline-grip");
    expect(css).not.toContain(".cm-md-heading-outline-spine");
    expect(css).not.toContain(".cm-md-heading-outline-layer.is-expanded");
    expect(css).not.toContain("font-family: revert");
  });
});

function createMarkdownState(source: string): EditorState {
  return EditorState.create({
    doc: source,
    extensions: [
      puppyMarkdownFeatureCompositionExtension,
      markdown({ base: markdownLanguage, extensions: puppyMarkdownParserExtensions }),
    ],
  });
}

function mountLongOutline(): EditorView {
  const view = mountMarkdown([
    "# One",
    "",
    "## Two",
    "",
    "### Three",
    "",
    ...Array.from({ length: 80 }, (_, index) => `Paragraph ${index + 1}.`),
  ].join("\n"));
  Object.defineProperty(view.scrollDOM, "clientHeight", { configurable: true, value: 120 });
  Object.defineProperty(view.scrollDOM, "scrollHeight", { configurable: true, value: 2400 });
  view.dispatch({});
  return view;
}

function mountMarkdown(source: string): EditorView {
  const parent = document.createElement("div");
  parent.style.height = "120px";
  parent.style.width = "960px";
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: source,
      extensions: [
        ...markdownCodeMirrorBaseExtensions(false),
        markdownLivePreviewExtension("safe", null, "outline.md", null),
        markdownHeadingOutlineExtension(),
      ],
    }),
  });
  mountedViews.push({ parent, view });
  return view;
}

async function flushMeasures(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

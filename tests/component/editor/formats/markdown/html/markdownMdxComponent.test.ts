/**
 * @vitest-environment happy-dom
 */
import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { getMarkdownPlanIndex } from "../../../../../../packages/shared-ui/src/editor/markdown/core/plans/markdownPlanIndex";
import { markdownRevealedSourceField } from "../../../../../../packages/shared-ui/src/editor/markdown/core/state/revealedSource";
import { getMarkdownElements } from "../../../../../../packages/shared-ui/src/editor/markdown/core/syntax/markdownElements";
import { parseMarkdownMdxComponent } from "../../../../../../packages/shared-ui/src/editor/markdown/features/mdx-component/mdxComponentModel";
import {
  markdownCodeMirrorBaseExtensions,
  markdownCodeMirrorLanguageExtension,
  markdownLivePreviewExtension,
} from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";

const views: EditorView[] = [];

const TABS_SOURCE = [
  "<Tabs>",
  '  <Tab label="Tab 1">',
  "",
  "  First **panel**",
  "  </Tab>",
  "",
  "  <Tab label='Tab 2'>",
  "",
  "  Second panel",
  "  </Tab>",
  "</Tabs>",
].join("\n");

const REAL_WORLD_REGRESSION_SOURCE = [
  "/",
  "",
  "# Hello man what can I say bro?",
  "",
  "| 我靠兄弟，你在搞我啊<br />hello man |  |  |  |",
  "| - | - | - | - |",
  "|  |  |  |  |",
  "|  |  |  |  |",
  "|  |  |  |  |",
  "|  |  |  |  |",
  "",
  "你好哈哈\\",
  "",
  "",
  "<Tabs>",
  '  <Tab label="Tab 1">',
  "",
  "  </Tab>",
  "",
  '  <Tab label="Tab 2">',
  "",
  "  </Tab>",
  "</Tabs>",
  "",
].join("\n");

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
  document.body.replaceChildren();
});

function createMdxState(source: string) {
  return EditorState.create({
    doc: source,
    extensions: [markdownCodeMirrorLanguageExtension("openknowledge-mdx")],
  });
}

function createView(source: string, dialect: "puppy-gfm" | "openknowledge-mdx") {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: source,
      extensions: [
        ...markdownCodeMirrorBaseExtensions(false, dialect),
        markdownLivePreviewExtension("safe", null, "Untitled.md", null, "", null, dialect),
      ],
    }),
  });
  views.push(view);
  return view;
}

describe("declarative OpenKnowledge MDX components", () => {
  it("parses Tabs across CommonMark blank-line boundaries without evaluating code", () => {
    const component = parseMarkdownMdxComponent(TABS_SOURCE);

    expect(component).toMatchObject({
      kind: "tabs",
      name: "Tabs",
      status: "complete",
      tabs: [
        { label: "Tab 1" },
        { label: "Tab 2" },
      ],
    });
    expect(component.tabs[0]?.content).toContain("First **panel**");
    expect(component.tabs[1]?.content).toContain("Second panel");
  });

  it.each([
    ["unknown component", "<Widget>content</Widget>"],
    ["root props", '<Tabs className="unsafe"><Tab label="x">x</Tab></Tabs>'],
    ["expression prop", "<Tabs><Tab label={window.alert(1)}>x</Tab></Tabs>"],
    ["spread prop", '<Tabs><Tab {...props} label="x">x</Tab></Tabs>'],
    ["extra prop", '<Tabs><Tab label="x" onClick="run">x</Tab></Tabs>'],
    ["duplicate prop", '<Tabs><Tab label="x" label="y">x</Tab></Tabs>'],
    ["unquoted prop", "<Tabs><Tab label=x>x</Tab></Tabs>"],
    ["self-closing child", '<Tabs><Tab label="x" /></Tabs>'],
    ["non-Tab direct child", "<Tabs><Panel>content</Panel></Tabs>"],
    ["plain direct text", '<Tabs>unexpected<Tab label="x">x</Tab></Tabs>'],
    ["empty Tabs", "<Tabs></Tabs>"],
    ["mismatched close", '<Tabs><Tab label="x">x</Tabs></Tab>'],
    ["content after close", '<Tabs><Tab label="x">x</Tab></Tabs> trailing'],
    ["unclosed component", '<Tabs><Tab label="x">x</Tab>'],
  ])("keeps %s as visible source", (_label, source) => {
    const state = createMdxState(source);
    const plans = getMarkdownPlanIndex(state);

    expect(plans.some(({ plan }) => plan.presentation === "blockAtom")).toBe(false);
    expect(plans.some(({ plan }) => plan.presentation === "visibleSource")).toBe(true);
    expect(state.doc.toString()).toBe(source);
  });

  it("bounds the declarative registry before creating a large tab widget", () => {
    const source = [
      "<Tabs>",
      ...Array.from({ length: 65 }, (_, index) => (
        `<Tab label="${index}">content</Tab>`
      )),
      "</Tabs>",
    ].join("\n");
    const plans = getMarkdownPlanIndex(createMdxState(source));

    expect(plans.some(({ plan }) => plan.presentation === "blockAtom")).toBe(false);
    expect(plans.some(({ plan }) => (
      plan.presentation === "visibleSource"
      && plan.diagnostics.some((diagnostic) => diagnostic.code === "mdx-component.unsupported")
    ))).toBe(true);
  });

  it("owns one syntax node, one semantic element, and one plan", () => {
    const state = createMdxState(TABS_SOURCE);
    const cursor = syntaxTree(state).cursor();
    const names: string[] = [];
    do names.push(cursor.name); while (cursor.next());
    const elements = getMarkdownElements(state).filter((element) => element.kind === "mdxComponent");
    const plans = getMarkdownPlanIndex(state).filter(({ plan }) => (
      plan.presentation === "blockAtom" && plan.embed.kind === "mdxComponent"
    ));

    expect(names.filter((name) => name === "MdxComponentBlock")).toHaveLength(1);
    expect(elements).toHaveLength(1);
    expect(elements[0]?.blockData).toMatchObject({
      kind: "mdxComponent",
      component: { status: "complete", name: "Tabs" },
    });
    expect(plans).toHaveLength(1);
  });

  it("ends the component node at the root close and leaves following Markdown independent", () => {
    const source = `${TABS_SOURCE}\n\n## After\n\nfollowing paragraph`;
    const state = createMdxState(source);
    const component = getMarkdownElements(state).find((element) => element.kind === "mdxComponent");
    expect(component).toMatchObject({ from: 0, to: TABS_SOURCE.length });
    expect(state.sliceDoc(component?.to ?? 0)).toBe("\n\n## After\n\nfollowing paragraph");
    expect(getMarkdownPlanIndex(state).filter(({ plan }) => (
      plan.presentation === "blockAtom" && plan.embed.kind === "mdxComponent"
    ))).toHaveLength(1);
  });

  it("does not let component-like text in a fenced Tab body close the parser block", () => {
    const source = [
      "<Tabs>",
      '<Tab label="Code">',
      "```mdx",
      "</Tabs>",
      "<Unknown />",
      "```",
      "</Tab>",
      "</Tabs>",
      "",
      "after",
    ].join("\n");
    const state = createMdxState(source);
    const component = getMarkdownElements(state).find((element) => element.kind === "mdxComponent");
    expect(component?.blockData).toMatchObject({
      kind: "mdxComponent",
      component: { status: "complete", tabs: [{ label: "Code" }] },
    });
    expect(component?.to).toBe(source.indexOf("\n\nafter"));
    expect(getMarkdownPlanIndex(state).some(({ plan }) => (
      plan.presentation === "blockAtom" && plan.embed.kind === "mdxComponent"
    ))).toBe(true);
  });

  it("keeps lowercase HTML on the HTML grammar path", () => {
    const source = "<tabs><tab>ordinary HTML</tab></tabs>";
    const state = createMdxState(source);
    const names: string[] = [];
    const cursor = syntaxTree(state).cursor();
    do names.push(cursor.name); while (cursor.next());

    expect(names).not.toContain("MdxComponentBlock");
    expect(getMarkdownElements(state).some((element) => element.kind === "mdxComponent"))
      .toBe(false);
  });

  it("keeps adjacent component blocks independent", () => {
    const second = TABS_SOURCE.replaceAll("Tab 1", "Other 1").replaceAll("Tab 2", "Other 2");
    const source = `${TABS_SOURCE}\n\nbetween\n\n${second}`;
    const state = createMdxState(source);

    expect(getMarkdownElements(state).filter((element) => element.kind === "mdxComponent"))
      .toHaveLength(2);
    expect(getMarkdownPlanIndex(state).filter(({ plan }) => (
      plan.presentation === "blockAtom" && plan.embed.kind === "mdxComponent"
    ))).toHaveLength(2);
  });

  it("renders accessible tabs and switches panels without changing source", () => {
    const view = createView(TABS_SOURCE, "openknowledge-mdx");
    const widget = view.dom.querySelector<HTMLElement>(".cm-md-mdx-tabs-widget");
    const tabs = Array.from(view.dom.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const panels = Array.from(view.dom.querySelectorAll<HTMLElement>('[role="tabpanel"]'));

    expect(widget?.dataset.mdMdxComponent).toBe("Tabs");
    expect(tabs).toHaveLength(2);
    expect(panels).toHaveLength(2);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(panels[0]?.hidden).toBe(false);
    expect(panels[1]?.hidden).toBe(true);

    tabs[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
    expect(panels[0]?.hidden).toBe(true);
    expect(panels[1]?.hidden).toBe(false);
    expect(view.state.doc.toString()).toBe(TABS_SOURCE);
  });

  it("supports roving tabindex and the standard tab-list keyboard contract", () => {
    const view = createView(TABS_SOURCE, "openknowledge-mdx");
    const tabs = Array.from(view.dom.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const press = (index: number, key: string) => tabs[index]?.dispatchEvent(new KeyboardEvent(
      "keydown",
      { key, bubbles: true, cancelable: true },
    ));

    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1]);
    press(0, "ArrowRight");
    expect(tabs.map((tab) => [tab.getAttribute("aria-selected"), tab.tabIndex]))
      .toEqual([["false", -1], ["true", 0]]);
    press(1, "Home");
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    press(0, "End");
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
    press(1, "ArrowLeft");
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(view.state.doc.toString()).toBe(TABS_SOURCE);
  });

  it("renders authored labels as text rather than executable markup", () => {
    const source = '<Tabs><Tab label="<img src=x onerror=alert(1)>">safe</Tab></Tabs>';
    const view = createView(source, "openknowledge-mdx");
    const tab = view.dom.querySelector<HTMLButtonElement>('[role="tab"]');

    expect(tab?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(tab?.querySelector("img")).toBeNull();
  });

  it("reveals the mapped canonical source after edits before the widget", async () => {
    const initialSource = `intro\n\n${TABS_SOURCE}`;
    const view = createView(initialSource, "openknowledge-mdx");
    const widgetBefore = view.dom.querySelector<HTMLElement>(".cm-md-mdx-tabs-widget");
    expect(widgetBefore).not.toBeNull();

    view.dispatch({ changes: { from: 0, insert: "shifted\n" } });
    const sourceButton = view.dom.querySelector<HTMLButtonElement>(".cm-md-mdx-source-toggle");
    sourceButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();

    const componentFrom = view.state.doc.toString().indexOf("<Tabs>");
    expect(view.state.field(markdownRevealedSourceField)).toEqual({
      from: componentFrom,
      to: componentFrom + TABS_SOURCE.length,
      presentation: "block",
    });
    expect(view.dom.querySelector(".cm-md-mdx-tabs-widget")).toBeNull();
    expect(view.state.doc.sliceString(componentFrom, componentFrom + TABS_SOURCE.length))
      .toBe(TABS_SOURCE);
  });

  it("does not turn component-like text into a widget in ordinary Puppy GFM", () => {
    const view = createView(TABS_SOURCE, "puppy-gfm");

    expect(view.dom.querySelector(".cm-md-mdx-tabs-widget")).toBeNull();
    expect(view.dom.querySelector(".cm-md-html-widget")).toBeNull();
    expect(view.state.doc.toString()).toBe(TABS_SOURCE);
  });

  it("projects the exact real-world regression shape as a table and a Tabs block", () => {
    const state = createMdxState(REAL_WORLD_REGRESSION_SOURCE);
    const plans = getMarkdownPlanIndex(state);

    expect(plans.some(({ plan }) => (
      plan.presentation === "blockAtom" && plan.embed.kind === "table"
    ))).toBe(true);
    expect(plans.some(({ plan }) => (
      plan.presentation === "blockAtom" && plan.embed.kind === "mdxComponent"
    ))).toBe(true);
    expect(plans.some(({ plan }) => (
      plan.presentation === "blockAtom" && plan.embed.kind === "htmlBlock"
    ))).toBe(false);
    expect(state.doc.toString()).toBe(REAL_WORLD_REGRESSION_SOURCE);
  });

  it("mounts the exact regression shape without legacy HTML warning widgets", () => {
    const view = createView(REAL_WORLD_REGRESSION_SOURCE, "openknowledge-mdx");

    expect(view.dom.querySelector(".cm-md-table-widget-wrap")).not.toBeNull();
    expect(view.dom.querySelector(".cm-md-mdx-tabs-widget")).not.toBeNull();
    expect(view.dom.querySelector(".cm-md-html-widget")).toBeNull();
    expect(view.dom.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(view.state.doc.toString()).toBe(REAL_WORLD_REGRESSION_SOURCE);
  });
});

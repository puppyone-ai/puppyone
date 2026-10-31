import "../../../../../src/styles/cascade.css";
import "../../../../../src/styles.css";
import { TestLocalizationProvider } from "@puppyone/localization/testing";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { MarkdownCodeMirrorEditor } from "../../../../../packages/shared-ui/src/editor/markdown/MarkdownCodeMirrorEditor";
import { resolveAppearance } from "../../../../../src/features/appearance/resolveAppearance";
import { applySurfaceAppearanceToElement, resolveSurfaceAppearance, SurfaceAppearanceProvider } from "../../../../../src/features/appearance/AppearanceRuntime";
import { createSubThemeCatalogSnapshot } from "../../../../../src/features/themes/builtinSubThemes";
import { DEFAULT_TYPOGRAPHY_PREFERENCES, resolveTypography } from "../../../../../src/features/typography";
import { DEFAULT_MARKDOWN_PRESENTATION_SETTINGS } from "../../../../../src/features/markdown/markdownPresentation";
import englishCatalog from "../../../../../src/localization/catalog-loaders/en";

const section = (index: number) => [
  `# Heading ${index}`, "",
  `Short paragraph ${index}.`, "",
  `Long paragraph ${index}: ${"The quick brown fox jumps over the lazy dog and keeps on running. ".repeat(6).trim()}`, "",
  `- item a${index}`, `- item b${index}`, "  - nested b1", "  - nested b2", `- item c${index}`, "",
  `> quote one ${index}`, `> quote two ${index}`, "",
  "```js", `const a${index} = 1;`, `const b${index} = 2;`, "```", "",
  "| Col A | Col B |", "| --- | --- |", `| a${index} | b${index} |`, `| c${index} | d${index} |`, "",
  "---", "",
  `## Sub heading ${index}`, "",
  `Closing paragraph ${index}.`, "", "",
].join("\n");

const documents: Record<string, () => string> = {
  mixed: () => `- only item in its list\n\n${section(1)}${section(2)}`,
  long: () => Array.from({ length: 600 }, (_, index) => section(index + 1)).join(""),
  rtl: () => "שלום עולם\n\nפסקה שנייה\n\nפסקה שלישית\n",
  frontmatter: () => "---\ntitle: Hello\n---\n\nFirst paragraph.\n\nSecond paragraph.\n",
};

const parameters = new URLSearchParams(location.search);
const themeMode = parameters.get("theme") === "dark" ? "dark" : "light";
const initial = documents[parameters.get("doc") ?? "mixed"]();
let setEnabled: (enabled: boolean) => void;

function Harness() {
  const [enabled, updateEnabled] = useState(true);
  setEnabled = next => flushSync(() => updateEnabled(next));
  const [catalog] = useState(() => createSubThemeCatalogSnapshot({ themes: [], diagnostics: [] }));
  const appearance = resolveAppearance({ interfaceStyle: "default", themeMode,
    requestedSubThemeIds: { light: "default.neutral", dark: "default.dark" }, subThemeCatalog: catalog,
    sidebarNavigationLayout: "bottom-horizontal", fileIconTheme: "default" });
  const surface = resolveSurfaceAppearance({ appearance, typography: resolveTypography(DEFAULT_TYPOGRAPHY_PREFERENCES),
    markdownPresentation: DEFAULT_MARKDOWN_PRESENTATION_SETTINGS, lightThemePreset: "neutral", darkThemePreset: "default",
    pointerCursors: false, diffMarkers: "color" });
  useLayoutEffect(() => applySurfaceAppearanceToElement(document.documentElement, surface), [surface]);
  return <TestLocalizationProvider messages={englishCatalog}><SurfaceAppearanceProvider value={surface}>
    <div {...surface.rootProps} className={themeMode === "dark" ? "dark" : ""} style={{ ...surface.rootProps.style, background: "var(--po-editor-bg)", color: "var(--po-text)", width: "100vw", height: "100vh" }}>
      <section id="markdown" style={{ height: "100%" }}>
        <MarkdownCodeMirrorEditor value={initial} livePreview readOnly={false} blockDragEnabled={enabled} />
      </section>
    </div>
  </SurfaceAppearanceProvider></TestLocalizationProvider>;
}
createRoot(document.getElementById("root")!).render(<Harness />);

const view = () => EditorView.findFromDOM(document.querySelector<HTMLElement>("#markdown .cm-editor")!)!;
const box = (element: Element | null) => {
  if (!element) return null;
  const { left, right, top, bottom } = element.getBoundingClientRect();
  return { left, right, top, bottom };
};
const part = (name: string) => document.querySelector<HTMLElement>(`.cm-md-block-${name}`);
const shown = (name: string) => {
  const element = part(name);
  return element?.classList.contains("is-visible") ? box(element) : null;
};
const counters = { measures: 0 };
let instrumented = false;

const fixture = {
  async ready() {
    for (let attempt = 0; attempt < 3000; attempt += 1) {
      if (document.querySelector(".markdown-codemirror-editor[data-preview-state='ready'] .cm-content")) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    await document.fonts.ready;
    await new Promise(resolve => setTimeout(resolve, 200));
  },
  rail() {
    const content = view().contentDOM;
    const style = getComputedStyle(content), rect = content.getBoundingClientRect();
    return { left: rect.left + parseFloat(style.paddingLeft), right: rect.right - parseFloat(style.paddingRight) };
  },
  row: (text: string) => box([...view().contentDOM.querySelectorAll(".cm-line")].find(line => line.textContent?.includes(text)) ?? null),
  scrollToRow(text: string) {
    const target = view();
    target.scrollDOM.scrollTop = target.lineBlockAt(target.state.doc.toString().indexOf(text)).top - 160;
  },
  widget: (selector: string) => box(view().contentDOM.querySelector(selector)),
  handle: () => {
    const rect = shown("drag-handle");
    if (!rect) return null;
    return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2, kind: part("drag-handle")!.dataset.blockKind };
  },
  handleTransform: () => part("drag-handle")?.style.transform ?? null,
  source: () => shown("drag-source"),
  indicator: () => shown("drop-indicator"),
  ghost: () => {
    const rect = shown("drag-ghost");
    return rect && { ...rect, text: part("drag-ghost")!.textContent };
  },
  ghostAudit() {
    const ghost = part("drag-ghost")!;
    return { width: box(ghost)!.right - box(ghost)!.left, height: box(ghost)!.bottom - box(ghost)!.top, tables: ghost.querySelectorAll("table").length,
      editable: ghost.querySelectorAll("[contenteditable]").length, ids: ghost.querySelectorAll("[id]").length,
      focusable: ghost.querySelectorAll("[tabindex]").length };
  },
  doc: () => view().state.doc.toString(),
  scrollTop: () => view().scrollDOM.scrollTop,
  setScrollTop(top: number) { view().scrollDOM.scrollTop = top; },
  setCaret(position: number) { view().focus(); view().dispatch({ selection: { anchor: position } }); },
  activeIsEditor: () => document.activeElement === view().contentDOM,
  parsedTo: () => syntaxTree(view().state).length,
  length: () => view().state.doc.length,
  scrollerContainsHandle: () => view().scrollDOM.contains(part("drag-handle")),
  dragDomCount: () => document.querySelectorAll("[class*='cm-md-block-dr']").length,
  setEnabled(enabled: boolean) { setEnabled(enabled); },
  measureCount: () => counters.measures,
  instrument() {
    counters.measures = 0;
    if (instrumented) return;
    instrumented = true;
    // measure() is private to CodeMirror; this counts the calls the gate limits.
    const target = view() as unknown as { measure(flush?: boolean): void };
    const measure = target.measure.bind(target);
    target.measure = flush => { counters.measures += 1; measure(flush); };
  },
};

Object.assign(window, { blockDragFixture: fixture });

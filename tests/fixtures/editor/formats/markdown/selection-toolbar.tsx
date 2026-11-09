import "../../../../../src/styles/cascade.css";
import "../../../../../src/styles.css";
import { TestLocalizationProvider } from "@puppyone/localization/testing";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { undo } from "@codemirror/commands";
import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MarkdownCodeMirrorEditor } from "../../../../../src/shared-ui/editor/markdown/MarkdownCodeMirrorEditor";
import { resolveAppearance } from "../../../../../src/features/appearance/resolveAppearance";
import { applySurfaceAppearanceToElement, resolveSurfaceAppearance, SurfaceAppearanceProvider } from "../../../../../src/features/appearance/AppearanceRuntime";
import { createSubThemeCatalogSnapshot } from "../../../../../src/features/themes/builtinSubThemes";
import { DEFAULT_TYPOGRAPHY_PREFERENCES, resolveTypography } from "../../../../../src/features/typography";
import { DEFAULT_MARKDOWN_PRESENTATION_SETTINGS } from "../../../../../src/features/markdown/markdownPresentation";
import englishCatalog from "../../../../../src/localization/catalog-loaders/en";

const query = new URLSearchParams(location.search);
const themeMode = query.get("theme") === "dark" ? "dark" : "light";
const initial = "# Select text to format\n\n选中这段文字，试试浮动工具栏。\n\nDifferent teams bring AI into the real world.\n\n- A bullet list item\n- Another item\n\n**Already bold** and normal text.\n\n" + "A paragraph for scrolling.\n\n".repeat(35);
function Harness() {
  const [catalog] = useState(() => createSubThemeCatalogSnapshot({ themes: [], diagnostics: [] }));
  const appearance = resolveAppearance({ interfaceStyle: "default", themeMode,
    requestedSubThemeIds: { light: "default.neutral", dark: "default.dark" }, subThemeCatalog: catalog,
    sidebarNavigationLayout: "bottom-horizontal", fileIconTheme: "default" });
  const surface = resolveSurfaceAppearance({ appearance, typography: resolveTypography(DEFAULT_TYPOGRAPHY_PREFERENCES),
    markdownPresentation: DEFAULT_MARKDOWN_PRESENTATION_SETTINGS, lightThemePreset: "neutral", darkThemePreset: "default",
    pointerCursors: false, diffMarkers: "color" });
  useLayoutEffect(() => applySurfaceAppearanceToElement(document.documentElement, surface), [surface]);
  return <TestLocalizationProvider messages={englishCatalog}><SurfaceAppearanceProvider value={surface}>
    <div {...surface.rootProps} className={themeMode === "dark" ? "dark" : ""} style={{ ...surface.rootProps.style, background: "var(--po-editor-bg)", color: "var(--po-text)", height: "100vh" }}>
      <button id="outside" style={{ position: "absolute", left: 0, top: 0 }}>Outside</button>
      <section id="markdown" style={{ position: "absolute", left: 80, top: 50, right: 30, bottom: 30 }}>
        <MarkdownCodeMirrorEditor value={initial} livePreview={query.get("source") !== "1"} readOnly={query.get("readonly") === "1"} documentPath="selection.md" />
      </section>
    </div>
  </SurfaceAppearanceProvider></TestLocalizationProvider>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
const view = () => EditorView.findFromDOM(document.querySelector<HTMLElement>("#markdown .cm-editor")!)!;
const toolbar = () => view().dom.querySelector<HTMLElement>(".cm-md-selection-toolbar")!;
const fixture = {
  async ready() {
    for (let attempt = 0; attempt < 500; attempt++) {
      const host = document.querySelector<HTMLElement>(".markdown-codemirror-editor");
      if (host?.dataset.previewState === (query.get("source") === "1" ? "source" : "ready")) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error("Editor did not become ready");
  },
  select(text: string) {
    const v = view(), from = v.state.doc.toString().indexOf(text);
    if (from < 0) throw new Error(`Missing sample text: ${text}`);
    v.focus(); v.dispatch({ selection: EditorSelection.range(from, from + text.length) });
  },
  coords(text: string) {
    const v = view(), from = v.state.doc.toString().indexOf(text);
    const a = v.coordsAtPos(from)!, b = v.coordsAtPos(from + text.length)!;
    return { from: { x: a.left, y: (a.top + a.bottom) / 2 }, to: { x: b.left, y: (b.top + b.bottom) / 2 } };
  },
  state() {
    const v = view(), t = toolbar();
    return { position: getComputedStyle(t).position, iconWidth: t.querySelector("svg")?.getBoundingClientRect().width, focused: v.hasFocus, hidden: t.hidden, visibility: t.style.visibility, documentFocus: document.hasFocus(), activeElement: document.activeElement?.tagName, visible: !t.hidden && t.style.visibility === "visible", toolbar: t.getBoundingClientRect().toJSON(), pane: v.dom.getBoundingClientRect().toJSON(),
      text: v.state.doc.toString(), selected: v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to),
      active: [...t.querySelectorAll('[aria-pressed="true"]')].map(button => (button as HTMLElement).dataset.markdownCommand) };
  },
  button(id: string) { const r = toolbar().querySelector<HTMLElement>(`[data-markdown-command="${id}"]`)!.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; },
  collapse() { const v = view(); v.dispatch({ selection: EditorSelection.cursor(v.state.selection.main.head) }); },
  block(type: string) { const select = toolbar().querySelector("select")!; select.value = type; select.dispatchEvent(new Event("change", { bubbles: true })); },
  undo() { undo(view()); },
  scroll(top: number) { view().scrollDOM.scrollTop = top; },
  outside() { document.getElementById("outside")!.focus(); },
};
Object.assign(window, { selectionToolbarFixture: fixture });

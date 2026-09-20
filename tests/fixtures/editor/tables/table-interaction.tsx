import "../../../../src/styles/cascade.css";
import "../../../../src/styles.css";
import { TestLocalizationProvider } from "@puppyone/localization/testing";
import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { EditorSourceSnapshotPort } from "../../../../packages/shared-ui/src/editor/sourceSnapshot";
import { EditorView } from "@codemirror/view";
import { MarkdownCodeMirrorEditor } from "../../../../packages/shared-ui/src/editor/markdown/MarkdownCodeMirrorEditor";
import { CsvTableEditor } from "../../../../packages/shared-ui/src/editor/viewers/csv/CsvTableEditor";
import { resolveAppearance } from "../../../../src/features/appearance/resolveAppearance";
import { applySurfaceAppearanceToElement, resolveSurfaceAppearance, SurfaceAppearanceProvider } from "../../../../src/features/appearance/AppearanceRuntime";
import { BUILTIN_SUB_THEMES } from "../../../../src/features/themes/builtinSubThemes";
import { DEFAULT_TYPOGRAPHY_PREFERENCES, resolveTypography } from "../../../../src/features/typography";
import { DEFAULT_MARKDOWN_PRESENTATION_SETTINGS } from "../../../../src/features/markdown/markdownPresentation";
import englishCatalog from "../../../../src/localization/catalog-loaders/en";

const rows = [
  ["Order", "Area", "English copy", "中文释义"],
  ["1", "Project files", "Your project files", "你的项目文件"],
  ["2", "Workspace", "Your workspace", "你的工作空间"],
  ["3", "Changes", "Keep track of your changes", "掌握文件修改"],
  ["4", "Upload history", "Review your upload history", "查看历史上传记录"],
  ["5", "Local agents", "Work with your local AI agents", "使用本地 AI Agent 协作"],
];
const initialMarkdown = "Before the table\n\n" + [rows[0], rows[0].map(() => "---"), ...rows.slice(1)].map(row => `| ${row.join(" | ")} |`).join("\n") + "\n\nAfter the table";
const csv = rows.map(row => row.join(",")).join("\n");
let setMode: (mode: "light" | "dark") => void;
let markdown = initialMarkdown;
let csvPort: EditorSourceSnapshotPort | null = null;
const onMarkdown = (value: string) => { markdown = value; };
const onCsvSnapshot = (port: EditorSourceSnapshotPort | null) => { csvPort = port; };
function Harness() {
  const [mode, updateMode] = useState<"light" | "dark">("light");
  setMode = mode => flushSync(() => updateMode(mode));
  const appearance = resolveAppearance({ interfaceStyle: "default", themeMode: mode,
    requestedSubThemeIds: { light: "default.neutral", dark: "default.dark" },
    subThemeCatalog: { subThemes: [...BUILTIN_SUB_THEMES], diagnostics: [] },
    sidebarNavigationLayout: "bottom-horizontal", fileIconTheme: "default" });
  const surface = resolveSurfaceAppearance({ appearance, typography: resolveTypography(DEFAULT_TYPOGRAPHY_PREFERENCES),
    markdownPresentation: DEFAULT_MARKDOWN_PRESENTATION_SETTINGS, loadingAnimationPreset: "ikun",
    lightThemePreset: "neutral", darkThemePreset: "default", pointerCursors: false, diffMarkers: "color" });
  useLayoutEffect(() => applySurfaceAppearanceToElement(document.documentElement, surface), [surface]);
  return <TestLocalizationProvider messages={englishCatalog}><SurfaceAppearanceProvider value={surface}>
    <div {...surface.rootProps} id="surface" className={mode === "dark" ? "dark" : ""}
      style={{ ...surface.rootProps.style, background: "var(--po-editor-bg)", color: "var(--po-text)", padding: 24, width: "100%", flexShrink: 0, minHeight: "100vh" }}>
      <h2 style={{ margin: 0, font: "600 16px system-ui" }}>Markdown</h2>
      <section id="markdown" style={{ height: 400 }}><MarkdownCodeMirrorEditor value={initialMarkdown} livePreview readOnly={false} onChange={onMarkdown} /></section>
      <h2 style={{ margin: 0, font: "600 16px system-ui" }}>CSV</h2>
      <section id="csv" style={{ height: 340 }}><CsvTableEditor content={csv} documentId="table-style-fixture" readOnly={false}
        onSnapshotPortChange={onCsvSnapshot}
        onSourceRevisionChange={() => {}} /></section>
    </div>
  </SurfaceAppearanceProvider></TestLocalizationProvider>;
}
createRoot(document.getElementById("root")!).render(<Harness />);

const table = (kind: string) => document.querySelector<HTMLTableElement>(kind === "markdown" ? ".cm-md-table-widget" : ".csv-table-editor__table")!;
const cell = (kind: string) => table(kind).querySelector<HTMLElement>(kind === "markdown" ? "tbody td" : "tbody td[data-csv-column]")!;
const input = (kind: string) => cell(kind).querySelector<HTMLElement>(kind === "markdown" ? "[contenteditable]" : "input")!;
const boxes = (element: Element) => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; };
const wait = () => new Promise(resolve => setTimeout(resolve, 150));
const api = {
  async ready() {
    for (let i = 0; i < 300 && (!table("markdown") || !table("csv")); i++) await new Promise(resolve => setTimeout(resolve, 20));
    if (!table("markdown") || !table("csv")) throw new Error("Missing production tables");
    await document.fonts.ready; await wait();
    if (!CSS.supports("anchor-scope", "--table")) throw new Error("Runtime lacks scoped CSS anchor positioning");
  },
  async mode(mode: "light" | "dark") { setMode(mode); await wait(); },
  point(kind: string, selector = "cell") {
    const target = selector === "cell" ? input(kind) : document.querySelector<HTMLElement>(`#${kind} ${selector}`)!;
    const rect = target.getBoundingClientRect(); return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  },
  metrics(kind: string) {
    const element = table(kind), style = getComputedStyle(element), c = cell(kind), focus = getComputedStyle(c);
    const grip = document.querySelector<HTMLElement>(`#${kind} .po-editable-table-column-handle .po-editable-table-drag-handle-visual`)!;
    const outline = document.querySelector<HTMLElement>(`#${kind} .po-editable-table-selection-outline`)!;
    const target = element.querySelector<HTMLElement>(".po-editable-table-selection-target");
    return { table: boxes(element), radius: style.borderRadius, border: style.borderTopWidth, borderColor: style.borderTopColor,
      backgrounds: [...element.querySelectorAll("th, td")].map(item => { const css = getComputedStyle(item); return [css.backgroundColor, css.backgroundImage]; }),
      textSelectionBackground: getComputedStyle(input(kind), "::selection").backgroundColor,
      cell: boxes(c), cellBorder: focus.borderRightWidth, cellFocus: focus.boxShadow,
      grip: boxes(grip), gripShadow: getComputedStyle(grip).boxShadow, gripColor: getComputedStyle(grip).backgroundColor,
      outline: outline.hidden ? null : boxes(outline), outlineBorder: getComputedStyle(outline).borderTopWidth, blockSelected: element.closest(".cm-md-table-widget-wrap")?.classList.contains("is-doc-selected") ?? false,
      tableShadow: style.boxShadow,
      editorSelection: kind === "markdown" ? { focused: EditorView.findFromDOM(document.querySelector("#markdown .cm-editor")!)!.hasFocus, selection: EditorView.findFromDOM(document.querySelector("#markdown .cm-editor")!)!.state.selection.toJSON(), active: document.activeElement?.className } : null,
      target: target ? boxes(target) : null, axis: outline.dataset.axis, markdown, csvSource: csvPort?.readSnapshot().content };
  },
  selectText(kind: string) {
    const element = input(kind); element.focus();
    if (element instanceof HTMLInputElement) element.setSelectionRange(0, 1);
    else { const range = document.createRange(); range.selectNodeContents(element); const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range); }
  },
  async selectMarkdownTable() {
    (document.activeElement as HTMLElement | null)?.blur();
    await wait();
    const view = EditorView.findFromDOM(document.querySelector("#markdown .cm-editor")!)!;
    view.focus();
    await wait();
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
  },
  async layoutFrames(kind: string) {
    const samples = [];
    const surface = document.getElementById("surface")!;
    const scroller = document.querySelector<HTMLElement>(kind === "markdown" ? "#markdown .cm-md-table-scrollport" : "#csv .csv-table-editor__scroll")!;
    if (!scroller) throw new Error(`Missing ${kind} scroll owner`);
    for (const width of [640, 420, 610, 450, 670, 400]) {
      surface.style.width = `${width}px`;
      scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth;
      await new Promise(requestAnimationFrame);
      samples.push({ ...api.metrics(kind), scrollLeft: scroller.scrollLeft });
    }
    surface.style.width = "100%";
    scroller.scrollLeft = 0;
    await wait();
    return samples;
  },
};
Object.assign(window, { tableFixture: api });

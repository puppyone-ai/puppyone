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
import { DesktopTooltipLayer } from "../../../../src/components/DesktopTooltipLayer";
import { installNativeTitleSuppression } from "../../../../src/lib/nativeTitleSuppression";

installNativeTitleSuppression();

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
let setTheme: (theme: string | null) => void;
let markdown = initialMarkdown;
let csvPort: EditorSourceSnapshotPort | null = null;
const onMarkdown = (value: string) => { markdown = value; };
const onCsvSnapshot = (port: EditorSourceSnapshotPort | null) => { csvPort = port; };
function Harness() {
  const [mode, updateMode] = useState<"light" | "dark">("light");
  const [theme, updateTheme] = useState<string | null>(null);
  setMode = mode => flushSync(() => updateMode(mode));
  setTheme = theme => flushSync(() => updateTheme(theme));
  const appearance = resolveAppearance({ interfaceStyle: "default", themeMode: mode,
    requestedSubThemeIds: { light: theme ?? "default.neutral", dark: theme ?? "default.dark" },
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
    <DesktopTooltipLayer />
  </SurfaceAppearanceProvider></TestLocalizationProvider>;
}
createRoot(document.getElementById("root")!).render(<Harness />);

const table = (kind: string) => document.querySelector<HTMLTableElement>(kind === "markdown" ? ".cm-md-table-widget" : ".csv-table-editor__table")!;
const cell = (kind: string) => table(kind).querySelector<HTMLElement>(kind === "markdown" ? "tbody td" : "tbody td[data-csv-column]")!;
const input = (kind: string) => cell(kind).querySelector<HTMLElement>(kind === "markdown" ? "[contenteditable]" : "input")!;
const boxes = (element: Element) => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; };
const wait = () => new Promise(resolve => setTimeout(resolve, 150));
const colorCanvas = document.createElement("canvas");
colorCanvas.width = colorCanvas.height = 1;
const colorContext = colorCanvas.getContext("2d", { willReadFrequently: true })!;
const colorAlpha = (color: string) => {
  colorContext.clearRect(0, 0, 1, 1);
  colorContext.fillStyle = color;
  colorContext.fillRect(0, 0, 1, 1);
  return colorContext.getImageData(0, 0, 1, 1).data[3];
};
const api = {
  async ready() {
    for (let i = 0; i < 300 && (!table("markdown") || !table("csv")); i++) await new Promise(resolve => setTimeout(resolve, 20));
    if (!table("markdown") || !table("csv")) throw new Error("Missing production tables");
    await document.fonts.ready; await wait();
    if (!CSS.supports("anchor-scope", "--table")) throw new Error("Runtime lacks scoped CSS anchor positioning");
  },
  async mode(mode: "light" | "dark") { setMode(mode); await wait(); },
  async theme(theme: string | null) { setTheme(theme); await wait(); },
  async setMarkdownSource(source: string) {
    (document.activeElement as HTMLElement | null)?.blur();
    const view = EditorView.findFromDOM(document.querySelector("#markdown .cm-editor")!)!;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source },
      selection: { anchor: source.length } });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  },
  point(kind: string, selector = "cell") {
    const target = selector === "cell" ? input(kind) : document.querySelector<HTMLElement>(`#${kind} ${selector}`)!;
    const rect = target.getBoundingClientRect(); return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  },
  cellPoint(kind: string, row: number, column: number) {
    const cells = table(kind).tBodies[0].rows[row].querySelectorAll<HTMLElement>(kind === "markdown" ? "td" : "td[data-csv-column]");
    const rect = cells[column].getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  },
  async drag(kind: string, axis: "column" | "row", targetRow: number, targetColumn: number) {
    const sourceCell = table(kind).tBodies[0].rows[0].querySelectorAll<HTMLElement>(
      kind === "markdown" ? "td" : "td[data-csv-column]",
    )[0];
    sourceCell.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerId: 71 }));
    await new Promise(requestAnimationFrame);
    const handle = document.querySelector<HTMLElement>(`#${kind} .po-editable-table-${axis}-handle`)!;
    const grip = handle.querySelector<HTMLElement>(".po-editable-table-drag-handle-visual")!;
    const start = grip.getBoundingClientRect();
    const targetCells = table(kind).tBodies[0].rows[targetRow].querySelectorAll<HTMLElement>(
      kind === "markdown" ? "td" : "td[data-csv-column]",
    );
    const target = targetCells[targetColumn].getBoundingClientRect();
    let capturedPointer: number | null = null;
    Object.defineProperties(handle, {
      setPointerCapture: { configurable: true, value: (pointerId: number) => { capturedPointer = pointerId; } },
      hasPointerCapture: { configurable: true, value: (pointerId: number) => capturedPointer === pointerId },
      releasePointerCapture: { configurable: true, value: (pointerId: number) => {
        if (capturedPointer === pointerId) capturedPointer = null;
      } },
    });
    try {
      handle.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true, button: 0, clientX: start.x + start.width / 2,
        clientY: start.y + start.height / 2, pointerId: 71,
      }));
      handle.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true, button: 0, clientX: target.x + target.width / 2,
        clientY: target.y + target.height / 2, pointerId: 71,
      }));
      handle.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true, button: 0, clientX: target.x + target.width / 2,
        clientY: target.y + target.height / 2, pointerId: 71,
      }));
      await wait();
    } finally {
      delete (handle as { setPointerCapture?: unknown }).setPointerCapture;
      delete (handle as { hasPointerCapture?: unknown }).hasPointerCapture;
      delete (handle as { releasePointerCapture?: unknown }).releasePointerCapture;
    }
    return api.metrics(kind);
  },
  async captureHandleMotion(kind: string, hold = false) {
    await new Promise(requestAnimationFrame);
    const handles = ["column", "row"].map(axis => document.querySelector<HTMLElement>(`#${kind} .po-editable-table-${axis}-handle`)!);
    const transitions = handles.flatMap(handle => handle.getAnimations()).filter((animation): animation is CSSTransition =>
      animation instanceof CSSTransition && ["left", "top"].includes(animation.transitionProperty));
    for (const transition of transitions) transition.pause();
    const frames = [0, 40, 160].map(time => {
      for (const transition of transitions) transition.currentTime = time;
      return { time, handles: handles.map(handle => boxes(handle)) };
    });
    for (const transition of transitions) {
      if (hold) transition.currentTime = 40;
      else transition.finish();
    }
    return { properties: transitions.map(transition => transition.transitionProperty), frames,
      held: hold ? handles.map(handle => boxes(handle)) : null };
  },
  metrics(kind: string) {
    const element = table(kind), style = getComputedStyle(element), c = cell(kind), focus = getComputedStyle(c);
    const grip = document.querySelector<HTMLElement>(`#${kind} .po-editable-table-column-handle .po-editable-table-drag-handle-visual`)!;
    const outline = document.querySelector<HTMLElement>(`#${kind} .po-editable-table-selection-outline`)!;
    const target = element.querySelector<HTMLElement>(".po-editable-table-selection-target");
    const targetInputs = target?.querySelectorAll<HTMLInputElement>("input") ?? [];
    const activeElement = document.activeElement;
    const activeTableCell = activeElement instanceof Element && element.contains(activeElement)
      ? activeElement.closest("th, td")
      : null;
    return { table: boxes(element), subThemeId: element.closest("[data-po-appearance-root]")?.getAttribute("data-sub-theme-id"),
      dark: element.closest(".dark") !== null,
      radius: style.borderRadius, border: style.borderTopWidth, borderColor: style.borderTopColor,
      backgrounds: [...element.querySelectorAll("th, td")].map(item => { const css = getComputedStyle(item); return [css.backgroundColor, css.backgroundImage]; }),
      textSelectionBackground: getComputedStyle(input(kind), "::selection").backgroundColor,
      cell: boxes(c), cellBorder: focus.borderRightWidth, cellFocus: focus.boxShadow,
      dots: { width: getComputedStyle(grip, "::before").width, height: getComputedStyle(grip, "::before").height },
      grip: boxes(grip), gripShadow: getComputedStyle(grip).boxShadow, gripColor: getComputedStyle(grip).backgroundColor,
      gripStyles: [...document.querySelectorAll(`#${kind} .po-editable-table-drag-handle-visual`)].map(handle => {
        const css = getComputedStyle(handle);
        return { radius: css.borderRadius, border: css.borderTopWidth, borderColor: css.borderTopColor,
          backgroundColor: css.backgroundColor, backgroundImage: css.backgroundImage,
          backgroundAlpha: colorAlpha(css.backgroundColor), backgroundClip: css.backgroundClip };
      }),
      handleStates: [...document.querySelectorAll<HTMLElement>(`#${kind} .po-editable-table-drag-handle`)].map(handle => {
        const css = getComputedStyle(handle.querySelector(".po-editable-table-drag-handle-visual")!);
        return { axis: handle.classList.contains("po-editable-table-column-handle") ? "column" : "row",
          pressed: handle.classList.contains("is-pressed"), dragging: handle.classList.contains("is-dragging"),
          menuActive: handle.classList.contains("is-menu-active"), background: css.backgroundColor,
          border: css.borderTopColor, color: css.color, backgroundAlpha: colorAlpha(css.backgroundColor),
          transitionDuration: css.transitionDuration };
      }),
      outline: outline.hidden ? null : boxes(outline), outlineBorder: getComputedStyle(outline).borderTopWidth,
      outlineColor: getComputedStyle(outline).borderTopColor, blockSelected: element.closest(".cm-md-table-widget-wrap")?.classList.contains("is-doc-selected") ?? false,
      tableShadow: style.boxShadow,
      editorSelection: kind === "markdown" ? { focused: EditorView.findFromDOM(document.querySelector("#markdown .cm-editor")!)!.hasFocus, selection: EditorView.findFromDOM(document.querySelector("#markdown .cm-editor")!)!.state.selection.toJSON(), active: document.activeElement?.className } : null,
      target: target ? boxes(target) : null,
      structuralTarget: target ? {
        column: target.dataset.csvColumn ?? target.getAttribute("aria-colindex"),
        row: target.dataset.csvRow ?? target.dataset.mdTableRow,
        text: targetInputs.length > 0
          ? [...targetInputs].map(item => item.value).join("|")
          : target.textContent,
      } : null,
      activeTableCell: activeTableCell ? boxes(activeTableCell) : null,
      focusedTableCellCount: element.querySelectorAll("th:focus-within, td:focus-within").length,
      axis: outline.dataset.axis, markdown, csvSource: csvPort?.readSnapshot().content };
  },
  menuPlacement(kind: string, axis: string) {
    const menu = document.querySelector<HTMLElement>(kind === "markdown"
      ? ".cm-md-table-context-menu"
      : ".csv-table-editor__context-menu")!;
    const grip = document.querySelector<HTMLElement>(`#${kind} .po-editable-table-${axis}-handle .po-editable-table-drag-handle-visual`)!;
    return { menu: boxes(menu), grip: boxes(grip) };
  },
  menuMetrics() {
    const menu = document.querySelector<HTMLElement>(".cm-md-table-context-menu")!;
    const css = getComputedStyle(menu);
    const rowWidths = [...menu.querySelectorAll(".desktop-menu-section-list")].map(row => {
      const buttons = row.querySelectorAll("button");
      return buttons[buttons.length - 1].getBoundingClientRect().right - buttons[0].getBoundingClientRect().left;
    });
    return { bounds: boxes(menu), viewport: { width: innerWidth, height: innerHeight },
      requiredWidth: Math.max(...rowWidths) + parseFloat(css.paddingLeft) + parseFloat(css.paddingRight)
        + parseFloat(css.borderLeftWidth) + parseFloat(css.borderRightWidth),
      headings: menu.querySelectorAll(".desktop-menu-section-label").length,
      buttons: menu.querySelectorAll("button").length,
      groups: [...menu.querySelectorAll('[role="group"]')].map(group => group.getAttribute("aria-label")),
      radios: [...menu.querySelectorAll('[role="menuitemradio"]')].map(button => ({
        label: button.getAttribute("aria-label"), checked: button.getAttribute("aria-checked"),
      })) };
  },
  openMenuAtEdge() {
    input("markdown").dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, clientX: innerWidth - 1, clientY: innerHeight - 1,
    }));
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

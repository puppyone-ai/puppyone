import "../../../../src/styles/cascade.css";
import "../../../../src/styles.css";
import "@xterm/xterm/css/xterm.css";
import { TestLocalizationProvider } from "@puppyone/localization/testing";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { undoDepth } from "@codemirror/commands";
import { Terminal } from "@xterm/xterm";
import englishCatalog from "../../../../src/localization/catalog-loaders/en";
import { MarkdownCodeMirrorEditor } from "../../../../packages/shared-ui/src/editor/markdown/MarkdownCodeMirrorEditor";
import { CodeMirrorCodeEditor } from "../../../../packages/shared-ui/src/editor/viewers/code/CodeMirrorCodeEditor";
import { CsvTableEditor } from "../../../../packages/shared-ui/src/editor/viewers/csv/CsvTableEditor";
import { CsvSourceEditor } from "../../../../packages/shared-ui/src/editor/viewers/csv/CsvSourceEditor";
import { AgentPromptEditor } from "../../../../src/features/desktop-agent/ui/composer/AgentPromptEditor";
import { resolveAppearance } from "../../../../src/features/appearance/resolveAppearance";
import { resolveSurfaceAppearance, SurfaceAppearanceProvider } from "../../../../src/features/appearance/AppearanceRuntime";
import { BUILTIN_SUB_THEMES } from "../../../../src/features/themes/builtinSubThemes";
import type { SubThemeDefinition } from "../../../../src/features/themes/themeTypes";
import { DEFAULT_TYPOGRAPHY_PREFERENCES, resolveTypography } from "../../../../src/features/typography";
import { DEFAULT_MARKDOWN_PRESENTATION_SETTINGS } from "../../../../src/features/markdown/markdownPresentation";
import { applyTerminalAppearance, readTerminalAppearance } from "../../../../src/features/desktop-terminal/runtime/terminalAppearance";
import { useTerminalAppearanceSync } from "../../../../src/features/desktop-terminal/runtime/useTerminalAppearanceSync";
import type { TerminalRuntimeHandle } from "../../../../src/features/desktop-terminal/runtime/terminalRuntime";

const markdown = "Select themed text 中文 العربية\n\n# Heading\n\nA [link](https://example.com) and `code`.\n\n| Name | Value |\n| --- | --- |\n| Table text | Cell text |\n";
const noop = () => {};
let changes = 0;
const changed = () => { changes += 1; };
let terminal: Terminal;
let selectTheme: (theme: SubThemeDefinition, mode: "light" | "dark") => void;
const frames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function element(selector: string) {
  const result = document.querySelector<HTMLElement>(selector);
  check(result, `Missing ${selector}`); return result;
}
function view(id: string) {
  const result = EditorView.findFromDOM(element(`#${id} .cm-editor`));
  check(result, `Missing view ${id}`); return result;
}
function color(owner: HTMLElement, value: string) {
  // Replaced controls do not style child probes; their parent shares the domain.
  if (owner.matches("input, textarea")) owner = owner.parentElement!;
  const probe = document.createElement("span");
  probe.style.color = value; owner.append(probe);
  const result = getComputedStyle(probe).color; probe.remove(); return result;
}
function selectionColor(owner: HTMLElement) { return getComputedStyle(owner, "::selection").backgroundColor; }

function TerminalFixture() {
  const host = useRef<HTMLDivElement>(null);
  const [runtime] = useState(() => ({ applyAppearance: (appearance: ReturnType<typeof readTerminalAppearance>) => {
    if (terminal) applyTerminalAppearance(terminal, appearance);
  } }) as TerminalRuntimeHandle);
  const read = useCallback(() => readTerminalAppearance(host.current!), []);
  useLayoutEffect(() => {
    terminal = new Terminal({ cols: 45, rows: 3 });
    terminal.open(host.current!);
    terminal.write("ANSI \x1b[31mred\x1b[0m text stays intact\r\n");
    return () => terminal.dispose();
  }, []);
  useTerminalAppearanceSync(runtime, read);
  return <div id="terminal" ref={host} />;
}
function Harness() {
  const [{ theme, mode }, setTheme] = useState({ theme: BUILTIN_SUB_THEMES[0], mode: "light" as "light" | "dark" });
  selectTheme = (theme, mode) => flushSync(() => setTheme({ theme, mode }));
  const appearance = resolveAppearance({
    interfaceStyle: theme.compatibleRootThemeIds.includes("windows-xp") ? "windows-xp" : "default",
    themeMode: mode, requestedSubThemeIds: { [mode]: theme.id },
    subThemeCatalog: { subThemes: [...BUILTIN_SUB_THEMES.filter(item => item.id !== theme.id), theme], diagnostics: [] },
    sidebarNavigationLayout: "bottom-horizontal", fileIconTheme: "default",
  });
  const surface = resolveSurfaceAppearance({ appearance,
    typography: resolveTypography(DEFAULT_TYPOGRAPHY_PREFERENCES),
    markdownPresentation: DEFAULT_MARKDOWN_PRESENTATION_SETTINGS,
    loadingAnimationPreset: "ikun", lightThemePreset: "neutral", darkThemePreset: "default", pointerCursors: false, diffMarkers: "color",
  });
  return <TestLocalizationProvider messages={englishCatalog}><SurfaceAppearanceProvider value={surface}>
    <div id="surface" {...surface.rootProps} className={mode === "dark" ? "dark" : ""} style={{ ...surface.rootProps.style, padding: 16, background: "var(--po-canvas)", color: "var(--po-text)" }}>
      <h2>Text selection · {theme.name} · {mode}</h2>
      <p id="reading">Read-only selection <strong>keeps its foreground</strong>.</p>
      <input id="input" defaultValue="Native input selection" /><button id="blur">Focus elsewhere</button>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <section id="markdown" style={{ height: 250 }}><MarkdownCodeMirrorEditor value={markdown} readOnly={false} livePreview onChange={changed} /></section>
        <section id="source" style={{ height: 250 }}><MarkdownCodeMirrorEditor value={markdown} readOnly={false} livePreview={false} onChange={changed} /></section>
        <section id="code" style={{ height: 130 }}><CodeMirrorCodeEditor content={'const color = "preserved";\n'} language="javascript" readOnly={false} onChange={changed} /></section>
        <section id="agent"><AgentPromptEditor value="Agent draft selection" mentions={[]} references={[]} disabled={false} placeholder="Draft" ariaLabel="Draft" onChange={changed} onSubmit={noop} /></section>
        <section id="csv" style={{ height: 130 }}><CsvTableEditor content={"Name,Value\nCell text,123"} readOnly={false} /></section>
        <section id="csv-source" style={{ height: 130 }}><CsvSourceEditor content={"Name,Value\nCell text,123"} nodeName="fixture.csv" readOnly={false} onSourceRevisionChange={noop} onSnapshotPortChange={noop} /></section>
      </div>
      <TerminalFixture />
    </div>
    <div id="portal" {...surface.rootProps} className={mode === "dark" ? "dark" : ""}>Portal text</div>
  </SurfaceAppearanceProvider></TestLocalizationProvider>;
}
createRoot(element("#root")).render(<Harness />);

async function verifyTheme(theme: SubThemeDefinition, mode: "light" | "dark") {
  const retained = ["markdown", "source", "code", "agent"].map(id => {
    const editor = view(id);
    return { id, editor, doc: editor.state.doc, selection: editor.state.selection.toJSON(), undo: undoDepth(editor.state) };
  });
  const beforeChanges = changes;
  const buffer = terminal.buffer.active;
  selectTheme(theme, mode); await frames();
  for (const { id, editor, doc, selection, undo } of retained) {
    check(view(id) === editor && editor.state.doc === doc, `${id}: theme recreated view or document`);
    check(JSON.stringify(editor.state.selection.toJSON()) === JSON.stringify(selection), `${id}: theme changed selection`);
    check(undoDepth(editor.state) === undo, `${id}: theme changed undo`);
  }
  check(changes === beforeChanges && terminal.buffer.active === buffer, "Theme changed source or terminal buffer");
  const root = element("#surface");
  const active = color(root, "var(--po-text-selection-bg)");
  const inactive = color(root, "var(--po-text-selection-inactive-bg)");
  check(active !== inactive, "Selection states are indistinguishable");
  check(selectionColor(element("#portal")) === active, "Portal selection differs from root");
  const preview = document.createElement("div");
  preview.dataset.poAppearanceRoot = "true"; preview.textContent = "Independent preview";
  element("#markdown .markdown-codemirror-editor").append(preview);
  check(selectionColor(preview) === color(preview, "var(--po-text-selection-bg)"), "Nested appearance root inherited the enclosing Markdown override");
  preview.remove();
  const input = element("#input") as HTMLInputElement;
  input.focus(); input.select();
  check(selectionColor(input) === active, "Native input active color");
  element("#blur").focus();
  check(selectionColor(input) === inactive, "Native input inactive color");
  for (const id of ["markdown", "source", "agent", "code"]) {
    const editor = view(id);
    editor.focus(); editor.dispatch({ selection: { anchor: 0, head: 10 } }); await frames();
    const expected = color(editor.dom, "var(--po-selection-background, var(--po-text-selection-bg))");
    const expectedInactive = color(editor.dom, "var(--po-selection-inactive-background, var(--po-text-selection-inactive-bg))");
    // CodeMirror can replace its painted rectangles during focus/layout updates.
    const actual = () => id === "code"
      ? getComputedStyle(element("#code .cm-selectionBackground")).backgroundColor
      : selectionColor(editor.contentDOM);
    check(actual() === expected, `${id}: active selection mismatch: ${actual()} vs ${expected}`);
    element("#blur").focus(); await frames();
    check(actual() === expectedInactive, `${id}: inactive selection mismatch: ${actual()} vs ${expectedInactive}`);
  }
  const csvInput = element("#csv-source textarea") as HTMLTextAreaElement;
  csvInput.focus(); csvInput.select();
  check(selectionColor(csvInput) === color(csvInput, "var(--po-selection-background)"), `CSV source selection mismatch: ${selectionColor(csvInput)} vs ${color(csvInput, "var(--po-selection-background)")}`);
  const csvCell = element("#csv input[data-csv-row]") as HTMLInputElement;
  csvCell.focus(); csvCell.select();
  check(selectionColor(csvCell) === color(csvCell, "var(--po-selection-background)"), "CSV cell selection mismatch");
  const tableCell = element('#markdown .cm-content [contenteditable="true"]');
  tableCell.focus();
  const range = document.createRange(); range.selectNodeContents(tableCell);
  document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
  await frames();
  check(selectionColor(tableCell) === color(tableCell, "var(--po-selection-background)"), "Markdown table leaked system selection");
  element("#blur").focus();
  check(selectionColor(tableCell) === color(tableCell, "var(--po-selection-inactive-background)"), "Markdown table inactive selection mismatch");
  terminal.focus(); terminal.select(0, 0, 8); await frames();
  check(terminal.options.theme?.selectionBackground === color(root, "var(--po-terminal-selection, var(--po-text-selection-bg))"), "Terminal active selection mismatch");
  check(terminal.options.theme?.selectionInactiveBackground === color(root, "var(--po-terminal-selection-inactive, var(--po-text-selection-inactive-bg))"), "Terminal inactive selection mismatch");
  check(terminal.options.theme?.selectionForeground === undefined, "Terminal overwrote ANSI foreground");
  return { theme: theme.id, mode, active, inactive, changes };
}

Object.assign(window, { selectionFixture: {
  ready: () => Boolean(document.querySelector("#markdown [data-preview-state=ready]")) && Boolean(terminal),
  async matrix(custom: SubThemeDefinition) {
    const results = [];
    for (const theme of BUILTIN_SUB_THEMES) {
      for (const mode of Object.keys(theme.variants) as ("light" | "dark")[]) results.push(await verifyTheme(theme, mode));
    }
    results.push(await verifyTheme(custom, "light"));
    // Same ID and version, different file contents: imperative xterm must repaint.
    const edited = { ...custom, variants: { light: { compiledCss: Object.fromEntries(Object.entries(custom.variants.light!.compiledCss).map(([key, css]) => [key, css.replaceAll("20, 130, 80", "180, 70, 110")])) } } };
    results.push(await verifyTheme(edited, "light"));
    results.push(await verifyTheme(custom, "light"));
    return results;
  },
  async forced() {
    const editor = view("code"); editor.focus(); editor.dispatch({ selection: { anchor: 0, head: 10 } }); await frames();
    check(selectionColor(editor.contentDOM) === color(editor.dom, "Highlight"), "Forced colors did not restore native selection");
    check(getComputedStyle(editor.contentDOM, "::selection").color === color(editor.dom, "HighlightText"), "Forced selection foreground mismatch");
    check(terminal.options.theme?.selectionForeground === color(element("#terminal"), "HighlightText"), "Terminal forced foreground mismatch");
    return { selection: selectionColor(editor.contentDOM), terminal: terminal.options.theme?.selectionBackground };
  },
  prepareDrag() {
    const editor = view("source"); editor.focus(); editor.dispatch({ selection: { anchor: 0 } });
    const from = editor.coordsAtPos(0)!; const to = editor.coordsAtPos(12)!;
    return { from: { x: from.left + 1, y: (from.top + from.bottom) / 2 }, to: { x: to.left, y: (to.top + to.bottom) / 2 } };
  },
  dragResult() {
    const editor = view("source");
    const text = editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to);
    const clipboardData = new DataTransfer();
    editor.contentDOM.dispatchEvent(new ClipboardEvent("copy", { clipboardData, bubbles: true, cancelable: true }));
    check(clipboardData.getData("text/plain") === text, "Copy changed selected source text");
    return { text, changes };
  },
} });

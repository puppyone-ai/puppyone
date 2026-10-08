import "../../../../src/styles/cascade.css";
import "../../../../src/styles.css";
import { TestLocalizationProvider } from "@puppyone/localization/testing";
import { StrictMode, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { CsvTableEditor } from "../../../../packages/shared-ui/src/editor/viewers/csv/CsvTableEditor";
import { DocumentModelOwner, DocumentModelProvider } from "../../../../packages/shared-ui/src/editor/document-session/DocumentModelOwner";
import type { EditorSourceSnapshotPort } from "../../../../packages/shared-ui/src/editor/sourceSnapshot";
import { resolveAppearance } from "../../../../src/features/appearance/resolveAppearance";
import { applySurfaceAppearanceToElement, resolveSurfaceAppearance, SurfaceAppearanceProvider } from "../../../../src/features/appearance/AppearanceRuntime";
import { BUILTIN_SUB_THEMES } from "../../../../src/features/themes/builtinSubThemes";
import { DEFAULT_TYPOGRAPHY_PREFERENCES, resolveTypography } from "../../../../src/features/typography";
import { DEFAULT_MARKDOWN_PRESENTATION_SETTINGS } from "../../../../src/features/markdown/markdownPresentation";
import englishCatalog from "../../../../src/localization/catalog-loaders/en";

let sequence = 0;
const makeDocument = (columns = 2) => ({ owner: new DocumentModelOwner(), id: `expansion-${++sequence}.csv`,
  content: [Array.from({ length: columns }, (_, i) => `Column ${i + 1}`).join(","),
    Array.from({ length: columns }, () => "1").join(","), Array.from({ length: columns }, () => "2").join(",")].join("\n") });
let port: EditorSourceSnapshotPort | null = null;
let localEdits = 0;
let reset: (mode: "light" | "dark", columns?: number) => void;
let show: (visible: boolean) => void;
const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function Harness() {
  const [documentState, setDocument] = useState(makeDocument);
  const [mode, setMode] = useState<"light" | "dark">("light");
  const [visible, setVisible] = useState(true);
  reset = (nextMode, columns) => {
    documentState.owner.dispose();
    localEdits = 0;
    flushSync(() => { setDocument(makeDocument(columns)); setMode(nextMode); setVisible(true); });
  };
  show = value => flushSync(() => setVisible(value));
  const appearance = resolveAppearance({ interfaceStyle: "default", themeMode: mode,
    requestedSubThemeIds: { light: "default.neutral", dark: "default.dark" },
    subThemeCatalog: { subThemes: [...BUILTIN_SUB_THEMES], diagnostics: [] },
    sidebarNavigationLayout: "bottom-horizontal", fileIconTheme: "default" });
  const surface = resolveSurfaceAppearance({ appearance, typography: resolveTypography(DEFAULT_TYPOGRAPHY_PREFERENCES),
    markdownPresentation: DEFAULT_MARKDOWN_PRESENTATION_SETTINGS, loadingAnimationPreset: "ikun",
    lightThemePreset: "neutral", darkThemePreset: "default", pointerCursors: false, diffMarkers: "color" });
  useLayoutEffect(() => applySurfaceAppearanceToElement(document.documentElement, surface), [surface]);
  return <TestLocalizationProvider messages={englishCatalog}><SurfaceAppearanceProvider value={surface}>
    <div {...surface.rootProps} className={mode === "dark" ? "dark" : ""}
      style={{ ...surface.rootProps.style, background: "var(--po-editor-bg)", color: "var(--po-text)",
        padding: 32, minHeight: "100vh", width: "100%", flexShrink: 0, boxSizing: "border-box" }}>
      <section style={{ height: 560 }}>
        <DocumentModelProvider owner={documentState.owner}>
          {visible && <CsvTableEditor key={documentState.id} content={documentState.content} documentId={documentState.id}
            nodeName={documentState.id} readOnly={false} onSnapshotPortChange={next => { port = next; }}
            onSourceRevisionChange={revision => { if (revision.origin === "local-edit") localEdits++; }} />}
        </DocumentModelProvider>
      </section>
    </div>
  </SurfaceAppearanceProvider></TestLocalizationProvider>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>);

const table = () => document.querySelector<HTMLTableElement>(".csv-table-editor__table")!;
const api = {
  async ready() {
    for (let i = 0; i < 500 && (!port || !table()); i++) await new Promise(resolve => setTimeout(resolve, 10));
    if (!port || !table()) throw new Error("CSV did not mount");
    await document.fonts.ready;
    await settle();
  },
  async reset(mode: "light" | "dark", columns = 2) { reset(mode, columns); await api.ready(); },
  async visitAwayAndBack() { show(false); await settle(); show(true); await api.ready(); },
  async corner() {
    const scroll = document.querySelector<HTMLDivElement>(".csv-table-editor__scroll")!;
    scroll.scrollLeft = scroll.scrollWidth - scroll.clientWidth;
    await settle();
    const rect = document.querySelector(".csv-table-editor__resize-handle")!.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  },
  metrics() {
    const preview = table().querySelector(".csv-table-editor__expansion-row");
    const scroll = document.querySelector<HTMLDivElement>(".csv-table-editor__scroll")!;
    const firstInput = table().querySelector<HTMLInputElement>('input[data-csv-row="1"][data-csv-column="0"]');
    const source = port?.readSnapshot().content ?? "";
    const bounds = (element: Element) => {
      const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
      return { left, top, right, bottom, width, height };
    };
    return { source, localEdits, rows: table().querySelectorAll("tbody tr[data-csv-row]").length,
      columns: table().querySelectorAll("thead th[data-csv-column]").length,
      modelRows: source.split("\n").length - 1, modelColumns: source.split("\n")[0].split(",").length,
      tracks: table().querySelectorAll("colgroup col").length,
      width: table().getBoundingClientRect().width, scrollWidth: scroll.scrollWidth,
      previewTracks: preview?.children.length ?? 0, previewCells: preview?.querySelectorAll("td").length ?? 0,
      previews: table().querySelectorAll(".csv-table-editor__expansion-cell").length,
      mountedCells: Number(table().dataset.csvMountedCells), firstInputValue: firstInput?.value,
      scroll: bounds(scroll), surface: bounds(document.querySelector(".csv-table-editor__surface")!),
      status: document.querySelector(".csv-table-editor__resize-status")?.textContent };
  },
  async history(redo: boolean) {
    const input = table().querySelector<HTMLInputElement>('input[data-csv-row="1"][data-csv-column="0"]')!;
    input.focus();
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "z", metaKey: true, shiftKey: redo }));
    await settle();
  },
  settle,
};
Object.assign(window, { csvExpansionFixture: api });

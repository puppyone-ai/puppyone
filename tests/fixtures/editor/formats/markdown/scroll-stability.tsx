import "../../../../../src/styles/cascade.css";
import "../../../../../src/styles.css";
import { TestLocalizationProvider } from "@puppyone/localization/testing";
import { EditorView } from "@codemirror/view";
import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MarkdownCodeMirrorEditor } from "../../../../../src/shared-ui/editor/markdown/MarkdownCodeMirrorEditor";
import { resolveAppearance } from "../../../../../src/features/appearance/resolveAppearance";
import { applySurfaceAppearanceToElement, resolveSurfaceAppearance, SurfaceAppearanceProvider } from "../../../../../src/features/appearance/AppearanceRuntime";
import { createSubThemeCatalogSnapshot } from "../../../../../src/features/themes/builtinSubThemes";
import { DEFAULT_TYPOGRAPHY_PREFERENCES, resolveTypography } from "../../../../../src/features/typography";
import { DEFAULT_MARKDOWN_PRESENTATION_SETTINGS } from "../../../../../src/features/markdown/markdownPresentation";
import englishCatalog from "../../../../../src/localization/catalog-loaders/en";

const parameters = new URLSearchParams(location.search);
const delay = parameters.get("slow") === "1" ? 450 : 0;
const dimensions = [[1080, 1620], [1080, 1620], [1620, 1080], [1080, 1620], [1080, 1512]];
const note = [
  ...Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1}. ${"A long note with photographs should preserve its reading position. ".repeat(3)}`),
  ...dimensions.map((_, i) => `![photo-${i + 1}](photo-${i + 1}.svg)`), "",
].join("\n\n");
let failImages = false;
let realAssets: Record<string, { mime: string; base64: string }> | null = null;
const resolver = async (_documentPath: string, href: string, signal?: AbortSignal) => {
  if (delay) await new Promise<void>(resolve => setTimeout(resolve, delay));
  if (signal?.aborted || failImages || href.includes("broken")) return null;
  const realAsset = realAssets?.[href.split("/").at(-1) ?? href];
  if (realAsset) {
    const bytes = Uint8Array.from(atob(realAsset.base64), c => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: realAsset.mime }));
    return { url, revoke: () => URL.revokeObjectURL(url) };
  }
  const [width, height] = dimensions[Number(/photo-(\d)/.exec(href)?.[1] ?? 1) - 1];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#c8d8c0"/></svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  return { url, revoke: () => URL.revokeObjectURL(url) };
};
let configure!: (next: { documentPath?: string; value?: string; second?: boolean; failed?: boolean; revision?: number }) => void;
function Harness() {
  const [documentPath, setPath] = useState("note.md");
  const [value, setValue] = useState(note);
  const [second, setSecond] = useState(false);
  const [revision, setRevision] = useState(0);
  configure = next => {
    if (next.failed !== undefined) failImages = next.failed;
    if (next.documentPath !== undefined) setPath(next.documentPath);
    if (next.value !== undefined) setValue(next.value);
    if (next.second !== undefined) setSecond(next.second);
    if (next.revision !== undefined) setRevision(next.revision);
  };
  const [catalog] = useState(() => createSubThemeCatalogSnapshot({ themes: [], diagnostics: [] }));
  const appearance = resolveAppearance({ interfaceStyle: "default", themeMode: "light", requestedSubThemeIds: { light: "default.neutral", dark: "default.dark" }, subThemeCatalog: catalog, sidebarNavigationLayout: "bottom-horizontal", fileIconTheme: "default" });
  const surface = resolveSurfaceAppearance({ appearance, typography: resolveTypography(DEFAULT_TYPOGRAPHY_PREFERENCES), markdownPresentation: DEFAULT_MARKDOWN_PRESENTATION_SETTINGS, lightThemePreset: "neutral", darkThemePreset: "default", pointerCursors: false, diffMarkers: "color" });
  useLayoutEffect(() => applySurfaceAppearanceToElement(document.documentElement, surface), [surface]);
  return <TestLocalizationProvider messages={englishCatalog}><SurfaceAppearanceProvider value={surface}>
    <main {...surface.rootProps} style={{ ...surface.rootProps.style, background: "var(--po-editor-bg)", color: "var(--po-text)", display: "flex", width: "100vw", height: "100vh" }}>
      <section id="primary" style={{ width: second ? "65%" : "100%", minWidth: 0 }}>
        <MarkdownCodeMirrorEditor value={value} livePreview readOnly documentPath={documentPath} markdownAssetUrlResolver={resolver} markdownAssetResolverRevision={revision} />
      </section>
      {second && <section id="secondary" style={{ width: "35%", minWidth: 0 }}>
        <MarkdownCodeMirrorEditor value={value} livePreview readOnly documentPath={documentPath} markdownAssetUrlResolver={resolver} markdownAssetResolverRevision={revision} />
      </section>}
    </main>
  </SurfaceAppearanceProvider></TestLocalizationProvider>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
const view = (pane = "primary") => EditorView.findFromDOM(document.querySelector<HTMLElement>(`#${pane} .cm-editor`)!)!;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type Sample = { frame: number; scrollTop: number; scrollHeight: number; clientHeight: number; images: number; placeholders: number; widgets: { top: number; height: number; width: number; loading: boolean }[] };
let samples: Sample[] | null = null;
let frameId = 0;
const scrollWrites: { before: number; after: number; stack: string }[] = [];
const instrumented = new WeakSet<HTMLElement>();
Object.assign(window, { scrollFixture: {
  async ready() {
    for (let i = 0; i < 800; i++) {
      if (document.querySelector("#primary [data-preview-state=ready] .cm-content")) { await document.fonts.ready; await wait(100); return; }
      await wait(10);
    }
    throw new Error("Scroll fixture did not initialize");
  },
  configure(next: Parameters<typeof configure>[0]) { configure(next); },
  originalNote: note,
  realAssets(assets: NonNullable<typeof realAssets>) { realAssets = assets; },
  geometry(pane = "primary") { const s = view(pane).scrollDOM; return { scrollTop: s.scrollTop, scrollHeight: s.scrollHeight, clientHeight: s.clientHeight, maxScroll: s.scrollHeight - s.clientHeight }; },
  setScrollTop(top: number, pane = "primary") { view(pane).scrollDOM.scrollTop = top; },
  startSampling(pane = "primary") {
    samples = [];
    scrollWrites.length = 0;
    const scroll = view(pane).scrollDOM;
    if (parameters.get("trace") === "1" && !instrumented.has(scroll)) {
      const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")!;
      Object.defineProperty(scroll, "scrollTop", { configurable: true,
        get() { return descriptor.get!.call(scroll); },
        set(value: number) {
          if (samples) scrollWrites.push({ before: descriptor.get!.call(scroll), after: value, stack: new Error().stack ?? "" });
          descriptor.set!.call(scroll, value);
        },
      });
      instrumented.add(scroll);
    }
    const record = () => {
      if (!samples) return;
      const v = view(pane), s = v.scrollDOM;
      samples.push({ frame: samples.length, scrollTop: s.scrollTop, scrollHeight: s.scrollHeight, clientHeight: s.clientHeight, images: v.dom.querySelectorAll("img[data-preview-state=ready]").length, placeholders: v.dom.querySelectorAll(".cm-md-image-placeholder.is-loading").length,
        widgets: [...v.dom.querySelectorAll<HTMLElement>(".cm-md-image-widget")].map(w => { const r = w.getBoundingClientRect(); return { top: r.top, height: r.height, width: r.width, loading: !!w.querySelector(".is-loading") }; }) });
      frameId = requestAnimationFrame(record);
    };
    frameId = requestAnimationFrame(record);
  },
  stopSampling() { const result = samples ?? []; samples = null; cancelAnimationFrame(frameId); return result; },
  scrollWrites() { return scrollWrites; },
  visitImage(index: number, pane = "primary") {
    const v = view(pane); const positions: number[] = [];
    for (let n = 1; n <= v.state.doc.lines; n++) { const l = v.state.doc.line(n); if (/^!\[/.test(l.text)) positions.push(l.from); }
    v.dispatch({ effects: EditorView.scrollIntoView(positions[index], { y: "center" }) });
  },
  lineHeights(pane = "primary") {
    const v = view(pane); const rows = [];
    for (let n = 1; n <= v.state.doc.lines; n++) { const l = v.state.doc.line(n); if (l.text.startsWith("![")) rows.push({ line: n, inMap: v.lineBlockAt(l.from).height }); }
    return rows;
  },
  images(pane = "primary") { return [...view(pane).dom.querySelectorAll<HTMLImageElement>("img[data-preview-state=ready]")].map(img => ({ alt: img.alt, width: img.getBoundingClientRect().width, height: img.getBoundingClientRect().height, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight })); },
} });

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

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="196" height="56"><rect width="196" height="56" rx="12" fill="#39BC66"/></svg>';
// AssetBroker revokes a blob URL with its widget, so each request needs its own.
const resolver = async () => URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
const linkCommands = { openExternalUrl: () => undefined, openPath: () => undefined };
const FENCE = "```";

const gallery = [
  "---", "title: Syntax gallery", "tags:", "  - a", "  - b", "---", "",
  "## HTML", "",
  "Text with <kbd>K</kbd> and <font color=\"red\">red</font> and <img src=\"a.svg\" alt=\"inline\" width=\"60\"> inside.", "",
  "<details>", "<summary>Open me</summary>", "", "- one", "- **two** with `code`", "", "</details>", "",
  "<div align=\"center\">", "", "**Centered** [link](https://example.com)", "", "</div>", "",
  "<svg width=\"60\" height=\"20\"><rect width=\"60\" height=\"20\" rx=\"4\" fill=\"#39BC66\"/></svg> drawing", "",
  "## Callouts", "",
  "> [!NOTE]", "> Plain **note** body", "",
  "> [!WARNING] Custom title", "> Warning body", "",
  "> [!tip]- Folded by default", "> Hidden body", "",
  "## Syntax", "",
  "Bare https://example.com and &copy; and :smile: and ==mark== and ~gone~ and %%note%%.", "",
  "A [reference][ref] and a note[^1].", "",
  "[ref]: https://example.com \"Title\"", "",
  "[^1]: The footnote body.", "",
  `${FENCE}math`, "x^2", FENCE, "",
  "Inline $\\`y\\`$ end.".replaceAll("\\", ""), "",
  "| Badge | Image |", "| --- | --- |", "| [![b](b.svg)](https://example.com) | <img src=\"a.svg\" alt=\"c\" width=\"60\"> |", "",
  "<!-- a comment -->", "",
  "End",
].join("\n");

function Harness() {
  const [catalog] = useState(() => createSubThemeCatalogSnapshot({ themes: [], diagnostics: [] }));
  const appearance = resolveAppearance({ interfaceStyle: "default", themeMode: "dark",
    requestedSubThemeIds: { light: "default.neutral", dark: "default.dark" }, subThemeCatalog: catalog,
    sidebarNavigationLayout: "bottom-horizontal", fileIconTheme: "default" });
  const surface = resolveSurfaceAppearance({ appearance, typography: resolveTypography(DEFAULT_TYPOGRAPHY_PREFERENCES),
    markdownPresentation: DEFAULT_MARKDOWN_PRESENTATION_SETTINGS, lightThemePreset: "neutral", darkThemePreset: "default",
    pointerCursors: false, diffMarkers: "color" });
  useLayoutEffect(() => applySurfaceAppearanceToElement(document.documentElement, surface), [surface]);
  return <TestLocalizationProvider messages={englishCatalog}><SurfaceAppearanceProvider value={surface}>
    <div {...surface.rootProps} className="dark" style={{ ...surface.rootProps.style, background: "var(--po-editor-bg)", width: "100%", flexShrink: 0, height: "100vh" }}>
      <section id="markdown" style={{ height: "100%" }}>
        <MarkdownCodeMirrorEditor value={gallery} livePreview readOnly={false} documentPath="gallery.md"
          markdownAssetUrlResolver={resolver} markdownLinkCommands={linkCommands} />
      </section>
    </div>
  </SurfaceAppearanceProvider></TestLocalizationProvider>;
}
createRoot(document.getElementById("root")!).render(<Harness />);

const view = () => EditorView.findFromDOM(document.querySelector<HTMLElement>("#markdown .cm-editor")!)!;
Object.assign(window, { syntaxGallery: {
  source: gallery,
  view,
  async setSource(source: string) {
    const editor = view();
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: source } });
    editor.contentDOM.blur();
    await new Promise((resolve) => window.setTimeout(resolve, 160));
  },
} });

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

const card = (label: string, fill: string, text: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="56" viewBox="0 0 196 56"><rect width="196" height="56" rx="12" fill="${fill}"/><text x="98" y="34" text-anchor="middle" font-family="sans-serif" font-size="15" fill="${text}">${label}</text></svg>`;
const blobUrl = (svg: string) => URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
const assets: Record<string, string> = {
  "assets/card-dark.svg": blobUrl(card("Dark card", "#f2f2f2", "#111111")),
  "assets/card-light.svg": blobUrl(card("Light card", "#111111", "#f2f2f2")),
  "assets/badge.svg": blobUrl('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="20"><rect width="80" height="20" rx="4" fill="#39BC66"/></svg>'),
};
const picture = (alt: string) => `<picture><source media="(prefers-color-scheme: dark)" srcset="assets/card-dark.svg"><img src="assets/card-light.svg" alt="${alt}" width="196"></picture>`;

const source = [
  "## Get started", "",
  "1. **Get puppyone.**", "",
  `   <a href="https://www.puppyone.ai/download">${picture("Download for macOS")}</a>`,
  `   <a href="https://www.puppyone.ai/download">${picture("Download for Windows")}</a>`, "",
  "2. **Open a folder and start.** Your files stay on your computer.", "",
  'Text before <img src="assets/badge.svg" alt="Inline badge"> text after.', "",
  "[![Linked badge](assets/badge.svg)](https://example.com/badge)", "",
  '- <div align="center">Centered in a list</div>', "- Plain item", "",
  '<div id="percent-host"><img src="assets/badge.svg" alt="Half width" width="50%"></div>', "",
  '<div><img src="assets/badge.svg" alt="Floated" align="right" width="40"><span>Floated sibling</span></div>', "",
  '<ol start="3"><li>Third</li></ol>', "",
  '<table align="center"><tr><td width="200" valign="top">Cell</td></tr></table>', "",
  "End",
].join("\n");

const opened: string[] = [];
const parameters = new URLSearchParams(location.search);
const themeMode = parameters.get("theme") === "dark" ? "dark" : "light";
const linkCommands = { openExternalUrl: (href: string) => { opened.push(href); } };
const resolver = async (_documentPath: string, href: string) => assets[href] ?? null;

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
    <div {...surface.rootProps} className={themeMode === "dark" ? "dark" : ""} style={{ ...surface.rootProps.style, background: "var(--po-editor-bg)", width: "100%", flexShrink: 0, height: "100vh" }}>
      <section id="markdown" style={{ height: "100%" }}>
        <MarkdownCodeMirrorEditor value={source} livePreview readOnly={false} documentPath="README.md"
          markdownAssetUrlResolver={resolver} markdownLinkCommands={linkCommands} />
      </section>
    </div>
  </SurfaceAppearanceProvider></TestLocalizationProvider>;
}
createRoot(document.getElementById("root")!).render(<Harness />);

Object.assign(window, { htmlRunFixture: {
  source,
  opened,
  assets,
  view: () => EditorView.findFromDOM(document.querySelector<HTMLElement>("#markdown .cm-editor")!)!,
} });

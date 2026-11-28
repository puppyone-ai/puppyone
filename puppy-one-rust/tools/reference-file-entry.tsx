// File Mode pixel references (`tools/file-scenarios.json`): the real product
// `FileModeApp` (one file in a window of its own, `#file-mode`) over an
// offline bridge that serves the scenario's fixture file, as main.tsx mounts
// it. The native side is a real file window on the same fixture
// (`PUPPYONE_FILE_MODE`, `tools/capture-workbench.py --suite file`).
//
// - `md` / `csv`: the file as it opens; `-view-menu` / `-settings-menu` with
//   the title bar's view switch or settings menu open.
// - `md-edited`: a space typed at the end of the first line, so the manual
//   Save chip shows.
// - `md-legacy`: a GB18030 file, read-only behind the encoding notice.
// - `loading`: the file is still being read; `unavailable`: it cannot be
//   read; `too-large`: it is over the editor's 1 MB limit.
import React from "react";
import { createRoot } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { LocalizationProvider } from "@puppyone/localization/react";
import { desktopPreferencesStore, initializeDesktopPreferences } from "PRODUCT/src/features/settings";
import { TypographyCatalogProvider } from "PRODUCT/src/features/typography";
import { FeatureFlagsProvider } from "PRODUCT/src/features/flags";
import { FileModeApp } from "PRODUCT/src/app/FileModeApp";
import { getFileSemanticKind } from "PRODUCT/src/shared-ui/core/fileFormats";

declare global {
  interface Window {
    fixture: { id: string; mode: "light" | "dark"; locale: string; width: number; height: number };
    __catalogs: Record<string, Record<string, string>>;
    __fixtureData: string | null;
    __fixtureFile: { name: string; encoding: string | null; state: string | null; edit: boolean };
    __referenceReady?: boolean;
  }
}

const fixture = window.fixture;
const file = window.__fixtureFile;
const noop = () => {};
const ROOT = "/reference/files";
const MAX_EDITOR_BYTES = 1024 * 1024;
document.documentElement.dataset.desktopPlatform = "macos";
document.documentElement.dataset.poScrollbarMode = "product";

/** The file's text as `readWorkspaceTextFile` decodes it. */
function decoded(): string {
  const data = window.__fixtureData ?? "";
  if (!file.encoding) return data;
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return new TextDecoder(file.encoding, { fatal: true }).decode(bytes);
}
const content = decoded();
const node = { id: file.name, name: file.name, path: file.name, type: getFileSemanticKind(file.name, "file"),
  size: String(content.length) };
const never = () => new Promise<never>(noop);
Object.defineProperty(window, "puppyoneDesktop", { configurable: true, value: {
  getPlatformCapabilities: async () => ({ platform: "macos", windowChrome: { mode: "overlay", supportsDockIcon: true } }),
  getInitialWorkspace: file.state === "loading" ? never : async () => ({
    workspaceId: null, path: null, workspace: null, workspaces: [], error: null,
    initialFile: { path: `${ROOT}/${file.name}`, rootPath: ROOT, name: file.name,
      tooLarge: file.state === "too-large", sizeLimit: MAX_EDITOR_BYTES },
  }),
  resolveNode: async () => {
    if (file.state === "unavailable") throw new Error("ENOENT");
    return node;
  },
  readFile: async () => ({ ...node, content, version: "reference-1",
    encoding: file.encoding ? file.encoding : "utf-8" }),
  writeFile: async () => ({ ok: true, version: "reference-2" }),
  getFileUrl: async () => ({ url: "about:blank" }),
  revokeFileUrl: async () => ({ revoked: true }),
  setFileEdited: noop,
  openExternalUrl: async () => ({ ok: true }),
  setWindowBackground: async () => {},
  setWindowChromeProfile: async () => {},
} });

initializeDesktopPreferences({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
desktopPreferencesStore.getState().setThemeMode(fixture.mode);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
void (async () => {
  // The document mounts once the bridge answers; settle its first layout.
  for (let i = 0; i < 100 && !document.querySelector(file.state ? ".file-mode-window__document > *" : ".cm-editor, .csv-editor, [role=grid]"); i++) await wait(20);
  await wait(600);
  if (file.edit) {
    const editor = document.querySelector<HTMLElement>(".cm-editor");
    const view = editor && EditorView.findFromDOM(editor);
    if (!view) throw new Error("Missing the Markdown editor");
    view.dispatch({ changes: { from: view.state.doc.line(1).to, insert: " " } });
    await wait(400);
  }
  window.__referenceReady = true;
})();

const catalogs = window.__catalogs;
const initialState = { locale: fixture.locale, preference: "system", direction: "ltr", systemLanguages: ["en-US"] };
const localization = { initialState, initialCatalog: catalogs[fixture.locale], fallbackCatalog: catalogs.en,
  loadCatalog: async (locale: string) => ({ catalog: catalogs[locale], fallbackCatalog: catalogs.en }),
  client: { onLocaleChanged: () => () => {}, setLanguagePreference: async (preference: string) => ({ ...initialState, preference, locale: preference }) } };
createRoot(document.getElementById("root")!).render(
  <LocalizationProvider {...(localization as never)}>
    <TypographyCatalogProvider><FeatureFlagsProvider><FileModeApp /></FeatureFlagsProvider></TypographyCatalogProvider>
  </LocalizationProvider>,
);

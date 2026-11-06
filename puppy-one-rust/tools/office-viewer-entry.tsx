// The product's Office preview (OfficeViewer: Word through docx-preview with
// its zoom, spreadsheets through the SheetJS worker and the virtualized grid,
// presentations through pptx-renderer with thumbnails and navigation, the
// OpenDocument and legacy text fallbacks, package preflight and validation)
// running in the native viewer's WebView. Bundled against the product
// sources by tools/import-office-viewer.mjs.
//
// The native side serves the file (and, for .doc / .rtf, the DOCX textutil
// made of it) and owns everything outside the page: opening the file or a
// link in another application and re-reading the input on Retry.
import { createRoot } from "react-dom/client";
import { useCallback, useMemo } from "react";
import { LocalizationProvider } from "@puppyone/localization/react";
import { OfficeViewer } from "./src/shared-ui/editor/viewers/office/OfficeViewer";
import { getPresetViewerDefinition } from "./src/shared-ui/editor/registry/presetViewerManifest";
import { DesktopTooltipLayer } from "./src/components/DesktopTooltipLayer";

type Boot = Readonly<{
  name: string; path: string; extension: string; fileUrl: string | null; fileError: string | null;
  convertedUrl: string | null; conversionError: string | null; conversionWarnings: string[];
  canOpenExternal: boolean; locale: string; direction: "ltr" | "rtl"; messages: Record<string, string>;
}>;

declare global {
  interface Window {
    __PUPPYONE_OFFICE: Boot;
    ipc?: { postMessage: (message: string) => void };
  }
}

const boot = window.__PUPPYONE_OFFICE;
const post = (message: object) => window.ipc?.postMessage(JSON.stringify(message));

// `convertOfficeDocumentToDocx`: textutil ran before the page loaded.
async function convertOfficeDocumentToDocx(_path: string, options?: { signal?: AbortSignal }) {
  options?.signal?.throwIfAborted();
  if (!boot.convertedUrl) throw new Error(boot.conversionError ?? "Office conversion is unavailable for this provider.");
  const response = await fetch(boot.convertedUrl, { signal: options?.signal, cache: "no-store" });
  if (!response.ok) throw new Error("Office conversion did not produce a DOCX file.");
  return { arrayBuffer: await response.arrayBuffer(), warnings: boot.conversionWarnings };
}

function App() {
  const resourcePolicy = useMemo(() => getPresetViewerDefinition("office-preview").resourcePolicy, []);
  const document = useMemo(() => ({ name: boot.name, path: boot.path, type: "office" }) as never, []);
  const openExternalFile = useCallback(async () => post({ type: "openExternal" }), []);
  const markdownEnvironment = useMemo(() => ({
    linkCommands: { openExternalUrl: (url: string) => post({ type: "openUrl", url }) },
  }) as never, []);
  return <section className="editor-host office-document-host">
    <OfficeViewer
      document={document}
      resolvedExtension={boot.extension}
      resourcePolicy={resourcePolicy}
      fileUrl={boot.fileUrl}
      fileUrlLoading={false}
      fileUrlError={boot.fileError}
      onRetryInput={() => post({ type: "retry" })}
      openExternalFile={boot.canOpenExternal ? openExternalFile : undefined}
      convertOfficeDocumentToDocx={boot.convertedUrl || boot.conversionError ? convertOfficeDocumentToDocx : undefined}
      markdownEnvironment={markdownEnvironment}
    />
  </section>;
}

function Root() {
  const state = useMemo(() => ({ preference: boot.locale, locale: boot.locale, direction: boot.direction,
    systemLanguages: [boot.locale] }) as never, []);
  const client = useMemo(() => ({
    setLanguagePreference: async () => state,
    onLocaleChanged: () => () => undefined,
  }), [state]);
  const loadCatalog = useCallback(async () => ({ catalog: boot.messages, fallbackCatalog: boot.messages }), []);
  return <LocalizationProvider initialState={state} initialCatalog={boot.messages} fallbackCatalog={boot.messages}
    loadCatalog={loadCatalog} client={client} onDiagnostic={() => undefined}>
    <App />
    <DesktopTooltipLayer />
  </LocalizationProvider>;
}

document.documentElement.lang = boot.locale;
document.documentElement.dir = boot.direction;
createRoot(document.getElementById("root")!).render(<Root />);

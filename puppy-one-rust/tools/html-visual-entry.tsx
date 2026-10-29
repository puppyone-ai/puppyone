// The product's HTML visual editor (HtmlVisualSurface: source index, edit
// compiler, sanitized projection, frame bridge, floating toolbar, block
// action rail, text input) running in the native viewer's WebView. Bundled
// against the product sources by tools/import-html-visual.mjs.
//
// The Rust code editor owns the text, its undo history and saves. This page
// keeps a CodeMirrorDocumentModel mirror (the product's own model) so the
// visual session's revision and mapping rules are unchanged:
//   - local visual edits are forwarded as UTF-16 change lists against the
//     generation they were made on;
//   - undo/redo go to the native history, which answers with a reset;
//   - a reset (source edits, disk reloads, history) replaces the mirror as an
//     external update, which retires the visual session exactly as in the
//     product.
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LocalizationProvider } from "@puppyone/localization/react";
import { CodeMirrorDocumentModel, externalDocumentUpdate } from "./packages/shared-ui/src/editor/document-session/CodeMirrorDocumentModel";
import { HtmlVisualSurface } from "./packages/shared-ui/src/editor/viewers/html/HtmlVisualSurface";
import { DocumentAssetImportBoundary, type DocumentAssetImportPort } from "./packages/shared-ui/src/editor/resource/DocumentAssetImport";
import { DesktopTooltipLayer } from "./src/components/DesktopTooltipLayer";

type Boot = Readonly<{
  text: string; name: string; fileUrl: string; canEdit: boolean; canImport: boolean;
  generation: number; locale: string; direction: "ltr" | "rtl"; messages: Record<string, string>;
}>;
type Inbound = { type: "reset"; text: string; generation: number }
  | { type: "enabled"; value: boolean }
  | { type: "imported"; request: string; path: string }
  | { type: "importFailed"; request: string };

declare global {
  interface Window {
    __PUPPYONE_HTML_VISUAL: Boot;
    __puppyoneHtmlVisual?: (message: Inbound) => void;
    ipc?: { postMessage: (message: string) => void };
  }
}

// WebKit exposes crypto.randomUUID only to secure contexts; a custom-scheme
// page may not be one. The surface needs it for session ids and gestures.
if (typeof crypto.randomUUID !== "function") {
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    value: () => {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6]! & 0x0f) | 0x40;
      bytes[8] = (bytes[8]! & 0x3f) | 0x80;
      const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  });
}

const boot = window.__PUPPYONE_HTML_VISUAL;
const post = (message: object) => window.ipc?.postMessage(JSON.stringify(message));
let generation = boot.generation;
const model = new CodeMirrorDocumentModel(boot.text, undefined, true);
// The single document history lives in the native editor.
(model as { moveHistory: (direction: "undo" | "redo") => boolean }).moveHistory = (direction) => {
  post({ type: "history", direction });
  return true;
};
model.subscribeTransactions((transaction) => {
  if (!transaction.docChanged || transaction.annotation(externalDocumentUpdate)) return;
  const edits: { from: number; to: number; insert: string }[] = [];
  transaction.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    edits.push({ from, to, insert: inserted.toString() });
  });
  post({ type: "edit", generation, edits });
});

const pendingImports = new Map<string, { resolve: (path: string) => void; reject: (error: Error) => void }>();
function imageExtension(bytes: Uint8Array): string | null {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) return "png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpg";
  const text = String.fromCharCode(...bytes.slice(0, 16));
  if (/^GIF8[79]a/.test(text)) return "gif";
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return "webp";
  return null;
}
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
// `createDocumentAssetImportPort`: the image lands beside the document as
// image-<uuid>.<ext>; the native side writes it without replacing anything.
const assets: DocumentAssetImportPort = {
  importImage: async (_documentPath, file) => {
    if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("invalid-image");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = imageExtension(bytes);
    if (!extension) throw new Error("invalid-image");
    const request = crypto.randomUUID();
    const name = `image-${crypto.randomUUID()}.${extension}`;
    const path = await new Promise<string>((resolve, reject) => {
      pendingImports.set(request, { resolve, reject });
      post({ type: "import", request, name, data: base64(bytes) });
    });
    if (path !== name) throw new Error("invalid-image-result");
    return { path };
  },
};

function App() {
  const [canEdit, setCanEdit] = useState(boot.canEdit);
  const [, setPrepare] = useState<unknown>(null);
  const registerPrepare = useCallback((prepare: unknown) => setPrepare(() => prepare), []);
  useEffect(() => {
    window.__puppyoneHtmlVisual = (message) => {
      if (message.type === "reset") {
        generation = message.generation;
        model.replaceContent(message.text);
      } else if (message.type === "enabled") {
        model.setInputEnabled(message.value);
        setCanEdit(message.value);
      } else if (message.type === "imported" || message.type === "importFailed") {
        const pending = pendingImports.get(message.request);
        pendingImports.delete(message.request);
        if (message.type === "imported") pending?.resolve(message.path);
        else pending?.reject(new Error("import-failed"));
      }
    };
    model.setInputEnabled(boot.canEdit);
    post({ type: "ready" });
    return () => { window.__puppyoneHtmlVisual = undefined; };
  }, []);
  const unavailable = useCallback(() => post({ type: "unavailable" }), []);
  const surface = <HtmlVisualSurface model={model} path={boot.name} title={boot.name} fileUrl={boot.fileUrl}
    canEdit={canEdit} registerPrepare={registerPrepare} onUnavailable={unavailable} />;
  return <section className="editor-host html-document-editor">
    {boot.canImport ? <DocumentAssetImportBoundary port={assets}>{surface}</DocumentAssetImportBoundary> : surface}
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

// The product's Excalidraw whiteboard (ExcalidrawViewer over its
// ExcalidrawDocumentModel) running in the native viewer's WebView. Bundled
// against the product sources by tools/import-excalidraw.mjs.
//
// The viewer keeps the product's model: the SDK's first normalized scene is
// only the baseline, so opening a board never rewrites it. This page is the
// model's persistence boundary (EditableDocumentSource): every local edit
// sends the serialized board to the native host, which owns the file text,
// dirty state and saves. A reset (disk reload, external edit) replaces the
// model's content, which remounts the board, as the product's Working Copy
// does. Excalidraw owns its undo history while mounted; the native Undo and
// Redo reach it as its own shortcuts. A text element being typed is part of
// the scene on every keystroke, so the host's copy never lags behind it.
//
// Links on elements resolve natively (`documentNavigation`): the page names
// the link, the host opens the workspace document or the browser.
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LocalizationProvider } from "@puppyone/localization/react";
import { EditableDocumentSourceProvider } from "./src/shared-ui/editor/document-session/EditableDocumentSourceContext";
import type { EditableDocumentSource } from "./src/shared-ui/editor/document-session/types";
import type { DocumentNavigationPort, DocumentReference } from "./src/shared-ui/editor/navigation/documentNavigation";
import { ExcalidrawViewer } from "./src/shared-ui/editor/viewers/excalidraw/ExcalidrawViewer";
import { DesktopTooltipLayer } from "./src/components/DesktopTooltipLayer";

type Boot = Readonly<{
  text: string; name: string; path: string; canEdit: boolean; workspaceRoot: string | null;
  locale: string; direction: "ltr" | "rtl"; messages: Record<string, string>;
}>;
type Inbound = { type: "reset"; text: string }
  | { type: "enabled"; value: boolean }
  | { type: "history"; direction: "undo" | "redo" };
type Port = Parameters<EditableDocumentSource["attachSource"]>[0];

declare global {
  interface Window {
    __PUPPYONE_WHITEBOARD: Boot;
    __puppyoneWhiteboard?: (message: Inbound) => void;
    ipc?: { postMessage: (message: string) => void };
  }
}

const boot = window.__PUPPYONE_WHITEBOARD;
const post = (message: object) => window.ipc?.postMessage(JSON.stringify(message));
let port: Port | null = null;
let sent = boot.text;
const publish = () => {
  const text = port?.readSnapshot().content;
  if (text === undefined || text === sent) return;
  sent = text;
  post({ type: "content", text });
};
const source: EditableDocumentSource = {
  attachSource: (next) => {
    port = next;
    return () => { if (port === next) port = null; };
  },
  reportRevision: (revision) => { if (revision.origin !== "model-initialization") publish(); },
};

// Every link is the host's to resolve and open; the page only names it.
const references = new WeakSet<object>();
const documentNavigation: DocumentNavigationPort = {
  resolveReference: (_path, raw) => {
    const reference = Object.freeze({ kind: "denied", syntax: "url", raw, label: raw, reason: "host" }) as unknown as DocumentReference;
    references.add(reference);
    return reference;
  },
  canOpenReference: (reference) => references.has(reference),
  openReference: (reference) => { post({ type: "link", link: reference.raw }); },
};

// `Mod+Z` / `Mod+Shift+Z` on the board's own keyboard target.
function history(redo: boolean) {
  const target = document.querySelector(".whiteboard-editor .excalidraw");
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  target?.dispatchEvent(new KeyboardEvent("keydown", {
    key: redo ? "Z" : "z", code: "KeyZ", shiftKey: redo, metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true,
  }));
}

function App() {
  const [canEdit, setCanEdit] = useState(boot.canEdit);
  const [content, setContent] = useState(boot.text);
  useEffect(() => {
    window.__puppyoneWhiteboard = (message) => {
      if (message.type === "reset") {
        sent = message.text;
        port?.replaceContent(message.text);
        setContent(message.text);
      } else if (message.type === "enabled") {
        port?.setInputEnabled?.(message.value);
        setCanEdit(message.value);
      } else if (message.type === "history") {
        history(message.direction === "redo");
      }
    };
    post({ type: "ready" });
    return () => { window.__puppyoneWhiteboard = undefined; };
  }, []);
  const document = useMemo(() => ({ name: boot.name, path: boot.path, type: "excalidraw" }) as never, []);
  return <EditableDocumentSourceProvider source={source}>
    <section className="editor-host whiteboard-host">
      <ExcalidrawViewer {...{ document, content, canEdit, documentNavigation,
        workspaceRoot: boot.workspaceRoot ?? undefined } as never} />
    </section>
  </EditableDocumentSourceProvider>;
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

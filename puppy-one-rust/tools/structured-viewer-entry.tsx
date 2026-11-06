// The product's structured document viewers (PuppyFlowViewer) running in the
// native viewer's WebView. Bundled against the product sources by
// tools/import-structured-viewers.mjs.
//
// The viewer keeps the product's StructuredDocumentModel and its bounded
// history. This page is its persistence boundary (EditableDocumentSource):
// every local edit, undo or redo sends the serialized document to the
// native host, which owns the file text, dirty state and saves. A reset
// (disk reload, external edit) replaces the model's content as an external
// update, exactly like the product's Working Copy does.
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LocalizationProvider } from "@puppyone/localization/react";
import { EditableDocumentSourceProvider } from "./src/shared-ui/editor/document-session/EditableDocumentSourceContext";
import type { EditableDocumentSource } from "./src/shared-ui/editor/document-session/types";
import { PuppyFlowViewer } from "./src/shared-ui/editor/viewers/puppyflow/PuppyFlowViewer";
import { DesktopTooltipLayer } from "./src/components/DesktopTooltipLayer";

type Boot = Readonly<{
  kind: "puppyflow"; text: string; name: string; path: string; canEdit: boolean;
  workspaceRoot: string | null; locale: string; direction: "ltr" | "rtl"; messages: Record<string, string>;
}>;
type Inbound = { type: "reset"; text: string }
  | { type: "enabled"; value: boolean }
  | { type: "history"; direction: "undo" | "redo" };
type Port = Parameters<EditableDocumentSource["attachSource"]>[0] & {
  undo?: () => boolean; redo?: () => boolean;
};

declare global {
  interface Window {
    __PUPPYONE_STRUCTURED: Boot;
    __puppyoneStructured?: (message: Inbound) => void;
    ipc?: { postMessage: (message: string) => void };
  }
}

const boot = window.__PUPPYONE_STRUCTURED;
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
    port = next as Port;
    return () => { if (port === next) port = null; };
  },
  reportRevision: (revision) => { if (revision.origin !== "model-initialization") publish(); },
};

function App() {
  const [canEdit, setCanEdit] = useState(boot.canEdit);
  const [content, setContent] = useState(boot.text);
  useEffect(() => {
    window.__puppyoneStructured = (message) => {
      if (message.type === "reset") {
        sent = message.text;
        port?.replaceContent(message.text);
        setContent(message.text);
      } else if (message.type === "enabled") {
        port?.setInputEnabled?.(message.value);
        setCanEdit(message.value);
      } else if (message.type === "history") {
        const moved = message.direction === "undo" ? port?.undo?.() : port?.redo?.();
        if (moved) publish();
      }
    };
    post({ type: "ready" });
    return () => { window.__puppyoneStructured = undefined; };
  }, []);
  const document = useMemo(() => ({ name: boot.name, path: boot.path, type: boot.kind }) as never, []);
  return <EditableDocumentSourceProvider source={source}>
    <section className="editor-host structured-document-host">
      <PuppyFlowViewer document={document} content={content} canEdit={canEdit} workspaceRoot={boot.workspaceRoot ?? undefined} />
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

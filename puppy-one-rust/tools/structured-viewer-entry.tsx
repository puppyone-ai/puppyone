// The product's structured document viewers (PuppyFlowViewer and
// ContextMapViewer) running in the native viewer's WebView. Bundled against
// the product sources by tools/import-structured-viewers.mjs.
//
// The viewer keeps the product's StructuredDocumentModel and its bounded
// history. This page is its persistence boundary (EditableDocumentSource):
// every local edit, undo or redo sends the serialized document to the
// native host, which owns the file text, dirty state and saves. A reset
// (disk reload, external edit) replaces the model's content as an external
// update, exactly like the product's Working Copy does.
//
// The Context Map reads the workspace through the native host
// (`contextMapEnvironment`) and publishes its layout and line filters to the
// native pane menu (`EditorPaneMenuContribution`).
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LocalizationProvider } from "@puppyone/localization/react";
import { EditableDocumentSourceProvider } from "./src/shared-ui/editor/document-session/EditableDocumentSourceContext";
import type { EditableDocumentSource } from "./src/shared-ui/editor/document-session/types";
import {
  EditorPaneMenuContributionProvider,
  type EditorPaneMenuContribution,
} from "./src/shared-ui/editor/editorPaneMenuContribution";
import { PuppyFlowViewer } from "./src/shared-ui/editor/viewers/puppyflow/PuppyFlowViewer";
import { ContextMapViewer } from "./src/shared-ui/editor/viewers/context-map/ContextMapViewer";
import type { DataNode, FileContent } from "./src/shared-ui/core/types";
import { DesktopTooltipLayer } from "./src/components/DesktopTooltipLayer";

type Boot = Readonly<{
  kind: "puppyflow" | "context-map"; text: string; name: string; path: string; canEdit: boolean;
  workspaceRoot: string | null; hasWorkspace: boolean;
  locale: string; direction: "ltr" | "rtl"; messages: Record<string, string>;
}>;
type Inbound = { type: "reset"; text: string }
  | { type: "enabled"; value: boolean }
  | { type: "history"; direction: "undo" | "redo" }
  | { type: "reply"; request: number; ok: boolean; value?: unknown; error?: string }
  | { type: "revision"; value: number }
  | { type: "paneSegment"; id: string; value: string }
  | { type: "paneToggle"; id: string; checked: boolean }
  | { type: "paneCommand"; id: string };
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

// Workspace reads answered by the native host.
let nextRequest = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
function request<T>(method: "list" | "read", path: string | null, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const id = ++nextRequest;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    signal?.addEventListener("abort", () => {
      pending.delete(id);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    }, { once: true });
    post({ type: method, request: id, path });
  });
}

// The pane menu as the native host renders it; actions come back by id.
let contribution: EditorPaneMenuContribution | null = null;
function publishPane(next: EditorPaneMenuContribution | null) {
  contribution = next;
  post({
    type: "pane",
    items: (next?.viewItems ?? []).map((item) => item.kind === "segmented"
      ? { kind: item.kind, id: item.id, label: item.label, value: item.value, options: item.options.map(({ id, label }) => ({ id, label })) }
      : item.kind === "toggle"
        ? { kind: item.kind, id: item.id, label: item.label, checked: item.checked }
        : { kind: item.kind, id: item.id, label: item.label, disabled: Boolean(item.disabled) }),
  });
}
function paneItem(id: string) {
  return contribution?.viewItems.find((item) => item.id === id);
}

function App() {
  const [canEdit, setCanEdit] = useState(boot.canEdit);
  const [content, setContent] = useState(boot.text);
  const [revision, setRevision] = useState(0);
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
      } else if (message.type === "reply") {
        const waiting = pending.get(message.request);
        pending.delete(message.request);
        if (message.ok) waiting?.resolve(message.value);
        else waiting?.reject(new Error(message.error ?? "The workspace could not be read."));
      } else if (message.type === "revision") {
        setRevision(message.value);
      } else if (message.type === "paneSegment") {
        const item = paneItem(message.id);
        if (item?.kind === "segmented") item.setValue(message.value);
      } else if (message.type === "paneToggle") {
        const item = paneItem(message.id);
        if (item?.kind === "toggle") item.setChecked(message.checked);
      } else if (message.type === "paneCommand") {
        const item = paneItem(message.id);
        if (item?.kind === "command" && !item.disabled) item.run();
      }
    };
    post({ type: "ready" });
    return () => { window.__puppyoneStructured = undefined; };
  }, []);
  const document = useMemo(() => ({ name: boot.name, path: boot.path, type: boot.kind }) as never, []);
  const contextMapEnvironment = useMemo(() => boot.hasWorkspace ? {
    revision,
    listChildren: (path: string | null) => request<DataNode[]>("list", path),
    readFile: (path: string, options?: { signal?: AbortSignal }) => request<FileContent>("read", path, options?.signal),
  } : null, [revision]);
  const viewer = boot.kind === "context-map"
    ? <ContextMapViewer document={document} content={content} canEdit={canEdit} fileIconTheme="default"
      contextMapEnvironment={contextMapEnvironment} />
    : <PuppyFlowViewer document={document} content={content} canEdit={canEdit} workspaceRoot={boot.workspaceRoot ?? undefined} />;
  return <EditableDocumentSourceProvider source={source}>
    <EditorPaneMenuContributionProvider onContributionChange={publishPane}>
      <section className="editor-host structured-document-host">{viewer}</section>
    </EditorPaneMenuContributionProvider>
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

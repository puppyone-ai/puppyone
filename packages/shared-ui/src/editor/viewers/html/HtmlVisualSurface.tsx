import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useLocalization } from "@puppyone/localization/react";
import type { CodeMirrorDocumentModel } from "../../document-session/CodeMirrorDocumentModel";
import { useDocumentAssetImport } from "../../resource/DocumentAssetImport";
import { useEditorTaskController, useEditorTaskOwner } from "../../runtime/EditorTaskContext";
import { editorTaskScheduler } from "../../runtime/EditorTaskScheduler";
import { HtmlVisualSession, type HtmlPreviewPatch } from "./HtmlVisualSession";
import { buildHtmlEditingProjection, resolveHtmlBase } from "./htmlPreviewProjection";
import { decodeHtmlBridgeMessage, type HtmlSelectionMessage } from "./htmlBridgeProtocol";
import { HTML_VISUAL_MAX_CHARS } from "./htmlSourceIndex";
import { HtmlInspector } from "./HtmlInspector";
import { HtmlTextInput } from "./HtmlTextInput";
import type { HtmlEditOperation } from "./htmlEditCompiler";
import { imageSourceReference } from "./htmlImageReference";

export function HtmlVisualSurface({ model, path, title, fileUrl, canEdit, registerPrepare }: {
  model: CodeMirrorDocumentModel; path: string; title: string; fileUrl?: string | null; canEdit: boolean;
  registerPrepare: (prepare: (() => void | Promise<void>) | null) => void;
}) {
  const { t } = useLocalization();
  const assets = useDocumentAssetImport();
  const owner = useEditorTaskOwner();
  const createController = useEditorTaskController();
  const [generation, setGeneration] = useState(0);
  const [projection, setProjection] = useState<{ session: HtmlVisualSession; source: string } | null>(null);
  const [selection, setSelection] = useState<HtmlSelectionMessage | null>(null);
  const [textInput, setTextInput] = useState<{ id: string; initial: string; gesture: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const port = useRef<MessagePort | null>(null);
  const prepareText = useRef<(() => void) | null>(null);
  const pendingImport = useRef<Promise<void> | null>(null);
  const bridgeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStyle = useRef<{ request: string; target: string; revision: string; operation: HtmlEditOperation;
    gesture: string; timeout: ReturnType<typeof setTimeout>; finished: Promise<void>; finish: () => void } | null>(null);
  const mounted = useRef(true);
  const enabled = useRef(canEdit); enabled.current = canEdit;
  const resourceUrl = useRef(fileUrl); resourceUrl.current = fileUrl;
  const selected = useRef(selection); selected.current = selection;
  const registerTextPrepare = useCallback((prepare: (() => void) | null) => { prepareText.current = prepare; }, []);

  useLayoutEffect(() => {
    mounted.current = true;
    registerPrepare(async () => { prepareText.current?.(); await pendingImport.current; await pendingStyle.current?.finished; });
    return () => { mounted.current = false; registerPrepare(null); };
  }, [registerPrepare]);

  useEffect(() => {
    const abort = createController();
    let session: HtmlVisualSession | null = null;
    setProjection(null); setSelection(null); setTextInput(null); setReady(false); setError(null);
    port.current?.close(); port.current = null;
    const baseRevision = model.revision;
    const timer = setTimeout(() => {
      if (model.editorState.doc.length > HTML_VISUAL_MAX_CHARS) { setError(t("editor.html.unsupported")); return; }
      void editorTaskScheduler.acquire({ owner: owner ?? { scope: "standalone", instance: path, generation },
        kind: "html-projection", inputBytes: model.editorState.doc.length * 2, maxInputBytes: HTML_VISUAL_MAX_CHARS * 2,
        priority: "interactive", signal: abort.signal }, () => {
        if (baseRevision !== model.revision) throw new Error("stale");
        session = new HtmlVisualSession(model, path, () => {
          port.current?.close(); port.current = null;
          setGeneration((value) => value + 1);
        });
        if (!session.valid) throw new Error("unsupported");
        const source = buildHtmlEditingProjection(session.index, resourceUrl.current, session.id);
        return { value: { session, source }, stop: () => undefined };
      }).then(async (lease) => {
        if (!abort.signal.aborted) setProjection(lease.value);
        await lease.close();
      }).catch(() => { if (!abort.signal.aborted) setError(t("editor.html.unsupported")); });
    }, 0);
    return () => {
      clearTimeout(timer); abort.abort(); session?.dispose(); port.current?.close(); port.current = null;
      if (bridgeTimeout.current) clearTimeout(bridgeTimeout.current);
      if (pendingStyle.current) { clearTimeout(pendingStyle.current.timeout); pendingStyle.current.finish(); }
      pendingStyle.current = null;
    };
  }, [model, path, generation, owner, createController, t]);

  useEffect(() => {
    if (projection?.session.valid) port.current?.postMessage({ type: "base", value: resolveHtmlBase(fileUrl, projection.session.index.baseHref) });
  }, [fileUrl, projection]);

  useEffect(() => {
    port.current?.postMessage({ type: "enabled", value: canEdit });
    if (!canEdit) { setSelection(null); setTextInput(null); }
  }, [canEdit]);

  const patch = (patches: HtmlPreviewPatch[]) => { if (patches.length) port.current?.postMessage({ type: "patch", patches }); };
  const apply = (operation: HtmlEditOperation, gesture: string = crypto.randomUUID()): boolean => {
    const current = selected.current;
    if (!projection?.session.valid || !current || !enabled.current || !ready || importing) return false;
    try {
      if (operation.kind === "style" && operation.value !== "") {
        projection.session.validate(current.id, operation);
        if (pendingStyle.current) { clearTimeout(pendingStyle.current.timeout); pendingStyle.current.finish(); }
        const request = crypto.randomUUID();
        let finish!: () => void;
        const finished = new Promise<void>((resolve) => { finish = resolve; });
        pendingStyle.current = { request, target: current.id, revision: model.revision, operation, gesture,
          finished, finish,
          timeout: setTimeout(() => { pendingStyle.current = null; setError(t("editor.html.editFailed")); finish(); }, 3000) };
        port.current?.postMessage({ type: "check-style", request, id: current.id, property: operation.property, value: operation.value });
        return true;
      }
      patch(projection.session.apply(current.id, model.revision, operation, gesture));
      setError(null); return true;
    } catch { setError(t("editor.html.editFailed")); return false; }
  };
  const startText = (current: HtmlSelectionMessage) => {
    if (!projection?.session.valid || !enabled.current || current.styles.transformed) return;
    const target = projection.session.read(current.id);
    if (target.textEditable) setTextInput({ id: current.id, initial: target.text, gesture: crypto.randomUUID() });
  };
  const connect = () => {
    const session = projection?.session;
    if (!session?.valid || !frame.current?.contentWindow) return;
    port.current?.close();
    const channel = new MessageChannel();
    port.current = channel.port1;
    let acknowledged = false;
    if (bridgeTimeout.current) clearTimeout(bridgeTimeout.current);
    bridgeTimeout.current = setTimeout(() => { if (!acknowledged && session.valid) setError(t("editor.html.bridgeFailed")); }, 5000);
    channel.port1.onmessage = (event) => {
      if (port.current !== channel.port1 || !session.valid) return;
      const message = decodeHtmlBridgeMessage(event.data);
      if (!message) return;
      if (message.type === "ready") {
        if (acknowledged || new Set(message.ids).size !== session.index.targets.size
          || message.ids.length !== session.index.targets.size || message.ids.some((id) => !session.index.targets.has(id))) return;
        acknowledged = true; if (bridgeTimeout.current) clearTimeout(bridgeTimeout.current); setReady(true);
        channel.port1.postMessage({ type: "enabled", value: enabled.current });
        channel.port1.postMessage({ type: "base", value: resolveHtmlBase(resourceUrl.current, session.index.baseHref) });
      } else if (acknowledged && enabled.current) {
        if (message.type === "style-check") {
          const pending = pendingStyle.current;
          if (!pending || pending.request !== message.request) return;
          clearTimeout(pending.timeout); pendingStyle.current = null;
          try {
            if (!message.supported) throw new Error("unsupported");
            patch(session.apply(pending.target, pending.revision, pending.operation, pending.gesture)); setError(null);
          } catch { setError(t("editor.html.editFailed")); }
          finally { pending.finish(); }
        }
        else if (message.type === "clear") { setSelection(null); setTextInput(null); }
        else if (message.type === "history") model.moveHistory(message.direction);
        else if (message.type === "selection" && session.index.targets.has(message.id)) {
          if (selected.current?.id !== message.id) setTextInput(null);
          selected.current = message; setSelection(message);
          if (message.edit) startText(message);
        }
      }
    };
    channel.port1.start();
    // An opaque srcdoc origin cannot be named as targetOrigin. The transferred port is bound to this frame and session.
    frame.current.contentWindow.postMessage({ type: "puppyone-html-connect", session: session.id }, "*", [channel.port2]);
  };
  const importImage = (file: File) => {
    const session = projection?.session;
    const targetId = selection?.id;
    if (!assets || !session?.valid || !targetId || !enabled.current || pendingImport.current) return;
    const baseRevision = model.revision;
    try { imageSourceReference(path, path, session.index.baseHref); } catch { setError(t("editor.html.unsupportedBase")); return; }
    setImporting(true); setError(null);
    const task = (async () => {
      let importedPath: string | null = null;
      try {
        importedPath = (await assets.importImage(path, file)).path;
        if (!mounted.current || !enabled.current || !session.valid || model.revision !== baseRevision) throw new Error("stale");
        const value = imageSourceReference(path, importedPath, session.index.baseHref);
        patch(session.apply(targetId, baseRevision, { kind: "attribute", name: "src", value }, crypto.randomUUID()));
      } catch {
        if (mounted.current) setError(importedPath ? t("editor.html.importUnattached", { path: importedPath }) : t("editor.html.importFailed"));
      } finally { if (mounted.current) setImporting(false); pendingImport.current = null; }
    })();
    pendingImport.current = task;
  };
  const target = selection && projection?.session.valid ? projection.session.read(selection.id) : null;
  const rect = selection?.rect;
  const clip = selection?.clip;
  const overlayStyle: CSSProperties = rect ? { left: rect.x, top: rect.y, width: Math.max(32, rect.width), height: Math.max(24, rect.height),
    clipPath: clip ? `inset(${clip.top}px ${clip.right}px ${clip.bottom}px ${clip.left}px)` : undefined } : {};
  const textStyle: CSSProperties = { ...overlayStyle,
    fontFamily: String(selection?.styles.fontFamily ?? "inherit"), fontSize: String(selection?.styles.fontSize ?? "16px"),
    fontWeight: String(selection?.styles.fontWeight ?? "normal"), lineHeight: String(selection?.styles.lineHeight ?? "normal"),
    textAlign: selection?.styles.textAlign as CSSProperties["textAlign"],
    padding: String(selection?.styles.padding ?? "0"),
  };
  return <div className="html-visual-editor" onKeyDown={(event) => {
    if (!event.nativeEvent.isComposing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault(); setTextInput(null); model.moveHistory(event.shiftKey ? "redo" : "undo");
    }
  }}>
    <div className="html-visual-editor__status" role="status">{error ?? (importing ? t("editor.html.importing") : ready ? t("editor.html.selectHint") : t("editor.html.preparing"))}</div>
    <div className="html-visual-editor__body">
      <div className="html-visual-editor__viewport">
        {projection && <iframe key={projection.session.id} ref={frame} className="native-preview-frame"
          title={title} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={projection.source} onLoad={connect} aria-busy={!ready} />}
        {rect && <div className="html-editor-selection" style={{ ...overlayStyle, height: Math.max(24, rect.height) }} />}
        {textInput && selection?.id === textInput.id && <HtmlTextInput key={textInput.gesture} initial={textInput.initial}
          style={textStyle} registerPrepare={registerTextPrepare} finish={() => setTextInput(null)}
          apply={(value) => apply({ kind: "text", value }, textInput.gesture)} />}
      </div>
      {target && <HtmlInspector key={`${projection?.session.id}:${target.id}`} tag={target.tag} text={target.textEditable && selection?.styles.transformed !== true}
        image={target.image} alt={target.attrs.get("alt") ?? ""} styles={selection?.styles ?? {}} disabled={!ready || !canEdit || importing} canImport={!!assets}
        apply={apply} startText={() => { if (selection) startText(selection); }} importImage={importImage} />}
    </div>
  </div>;
}

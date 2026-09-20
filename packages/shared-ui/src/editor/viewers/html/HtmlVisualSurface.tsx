import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useLocalization } from "@puppyone/localization/react";
import type { CodeMirrorDocumentModel } from "../../document-session/CodeMirrorDocumentModel";
import { useDocumentAssetImport } from "../../resource/DocumentAssetImport";
import { useEditorPreviewServices } from "../../preview-services/EditorPreviewServices";
import type { DocumentProjectionLease } from "../../preview-services/types";
import { useEditorTaskController, useEditorTaskOwner } from "../../runtime/EditorTaskContext";
import { editorTaskScheduler } from "../../runtime/EditorTaskScheduler";
import { HtmlVisualSession, type HtmlPreviewPatch } from "./HtmlVisualSession";
import { buildHtmlEditingProjection, resolveHtmlBase } from "./htmlPreviewProjection";
import { decodeHtmlBridgeMessage, type HtmlSelectionMessage } from "./htmlBridgeProtocol";
import { HTML_VISUAL_MAX_CHARS } from "./htmlSourceIndex";
import { HtmlFloatingToolbar } from "./HtmlFloatingToolbar";
import { HtmlTextInput } from "./HtmlTextInput";
import type { HtmlEditOperation } from "./htmlEditCompiler";
import { imageSourceReference } from "./htmlImageReference";
import { useHtmlEditPresence } from "./useHtmlEditPresence";
import { HtmlEditHandle, type HtmlHandleBounds } from "./HtmlEditHandle";

export function HtmlVisualSurface({ model, path, title, fileUrl, canEdit, registerPrepare, onUnavailable }: {
  model: CodeMirrorDocumentModel; path: string; title: string; fileUrl?: string | null; canEdit: boolean;
  onUnavailable: () => void;
  registerPrepare: (prepare: (() => void | Promise<void>) | null) => void;
}) {
  const { t } = useLocalization();
  const assets = useDocumentAssetImport();
  const projectionPort = useEditorPreviewServices().services?.documentProjection;
  const owner = useEditorTaskOwner();
  const createController = useEditorTaskController();
  const [generation, setGeneration] = useState(0);
  const [projection, setProjection] = useState<{ session: HtmlVisualSession; source: string; url?: string } | null>(null);
  const [selection, setSelection] = useState<HtmlSelectionMessage | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [textInput, setTextInput] = useState<{ id: string; initial: string; gesture: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const pencil = useRef<HTMLButtonElement>(null);
  const handleBounds = useRef<HtmlHandleBounds | null>(null);
  const focusPencil = useRef(false);
  const active = useRef<string | null>(null);
  const composing = useRef(false);
  const nativeControl = useRef(false);
  const scroll = useRef({ x: 0, y: 0 });
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
  const setComposing = useCallback((value: boolean) => { composing.current = value; }, []);
  const setNativeControl = useCallback((value: boolean) => { nativeControl.current = value; }, []);
  const setActive = useCallback((id: string | null) => { active.current = id; setEditing(id); }, []);
  useLayoutEffect(() => {
    if (focusPencil.current && pencil.current) { focusPencil.current = false; pencil.current.focus({ preventScroll: true }); }
  });

  useLayoutEffect(() => {
    mounted.current = true;
    registerPrepare(async () => {
      if (composing.current) throw new Error(t("editor.html.finishComposition"));
      prepareText.current?.(); await pendingImport.current; await pendingStyle.current?.finished;
    });
    return () => { mounted.current = false; registerPrepare(null); };
  }, [registerPrepare, t]);

  useEffect(() => {
    const abort = createController();
    let session: HtmlVisualSession | null = null;
    let documentLease: DocumentProjectionLease | null = null;
    setProjection(null); setSelection(null); selected.current = null; setActive(null); setTextInput(null); setReady(false); setError(null);
    port.current?.close(); port.current = null;
    const baseRevision = model.revision;
    const timer = setTimeout(() => {
      if (model.editorState.doc.length > HTML_VISUAL_MAX_CHARS) { onUnavailable(); return; }
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
        await lease.close();
        if (abort.signal.aborted) return;
        if (projectionPort) {
          documentLease = await projectionPort.create(path, lease.value.source, abort.signal);
          if (abort.signal.aborted) { await documentLease.close(); documentLease = null; return; }
        }
        if (!abort.signal.aborted && lease.value.session.valid) setProjection({ ...lease.value, url: documentLease?.url });
      }).catch(() => { if (!abort.signal.aborted) onUnavailable(); });
    }, 0);
    return () => {
      clearTimeout(timer); abort.abort(); session?.dispose(); port.current?.close(); port.current = null;
      void documentLease?.close().catch(() => undefined);
      if (bridgeTimeout.current) clearTimeout(bridgeTimeout.current);
      if (pendingStyle.current) { clearTimeout(pendingStyle.current.timeout); pendingStyle.current.finish(); }
      pendingStyle.current = null;
    };
  }, [model, path, generation, owner, createController, t, projectionPort, onUnavailable, setActive]);

  useEffect(() => {
    if (projection?.session.valid) port.current?.postMessage({ type: "base", value: resolveHtmlBase(fileUrl, projection.session.index.baseHref) });
  }, [fileUrl, projection]);

  useEffect(() => {
    port.current?.postMessage({ type: "enabled", value: canEdit });
    if (!canEdit) { setSelection(null); setTextInput(null); setActive(null); }
  }, [canEdit, setActive]);

  useEffect(() => {
    port.current?.postMessage({ type: "typing", id: textInput?.id ?? null });
  }, [textInput]);
  const dismiss = useCallback(() => {
    try { prepareText.current?.(); } catch { setError(t("editor.html.finishComposition")); return; }
    setTextInput(null); setSelection(null); selected.current = null; setActive(null); focusPencil.current = false;
    port.current?.postMessage({ type: "clear" });
  }, [t, setActive]);
  const presence = useHtmlEditPresence({ viewport, selection: selected, handleBounds, leave: dismiss,
    busy: () => composing.current || nativeControl.current || !!pendingImport.current || !!pendingStyle.current });
  const leaveRegion = presence.away;
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || viewport.current?.contains(event.target)) return;
      leaveRegion();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [leaveRegion]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".html-editor-text-input")) return;
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      port.current?.postMessage({ type: "scroll", x: event.deltaX * unit, y: event.deltaY * unit });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);

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
    if (target.textEditable && textInput?.id !== current.id) setTextInput({ id: current.id, initial: target.text, gesture: crypto.randomUUID() });
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
      if (message.type === "viewport") { scroll.current = { x: message.x, y: message.y }; return; }
      if (message.type === "pointer") { presence.move(message.x, message.y); return; }
      if (message.type === "ready") {
        if (acknowledged || new Set(message.ids).size !== session.index.targets.size
          || message.ids.length !== session.index.targets.size || message.ids.some((id) => !session.index.targets.has(id))) return;
        acknowledged = true; if (bridgeTimeout.current) clearTimeout(bridgeTimeout.current); setReady(true);
        channel.port1.postMessage({ type: "restore-scroll", ...scroll.current });
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
        else if (message.type === "clear") dismiss();
        else if (message.type === "history") model.moveHistory(message.direction);
        else if (message.type === "selection" && session.index.targets.has(message.id)) {
          // A queued layout measurement cannot resurrect dismissed UI or change the active target.
          if (message.reason === "measure" && selected.current?.id !== message.id) return;
          if (message.reason === "hover" && active.current) return;
          const continueEditing = !!active.current && message.edit;
          if (selected.current?.id !== message.id) {
            try { prepareText.current?.(); } catch { setError(t("editor.html.finishComposition")); return; }
            setTextInput(null); setActive(continueEditing ? message.id : null);
            presence.keep();
          }
          selected.current = message; setSelection(message);
          if (continueEditing) startText(message);
          else if (message.edit) focusPencil.current = true;
        }
      }
    };
    channel.port1.start();
    // A sandboxed projection has an opaque origin. The transferred port is bound to this frame and session.
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
    borderRadius: String(selection?.styles.borderRadius ?? "0"),
    clipPath: clip ? `inset(${clip.top}px ${clip.right}px ${clip.bottom}px ${clip.left}px)` : undefined } : {};
  const textStyle: CSSProperties = { ...overlayStyle,
    fontFamily: String(selection?.styles.fontFamily ?? "inherit"), fontSize: String(selection?.styles.fontSize ?? "16px"),
    fontWeight: String(selection?.styles.fontWeight ?? "normal"), lineHeight: String(selection?.styles.lineHeight ?? "normal"),
    textAlign: selection?.styles.textAlign as CSSProperties["textAlign"],
    padding: String(selection?.styles.padding ?? "0"),
    color: String(selection?.styles.color ?? "inherit"),
    letterSpacing: String(selection?.styles.letterSpacing ?? "normal"),
    fontStyle: String(selection?.styles.fontStyle ?? "normal"),
    textTransform: selection?.styles.textTransform as CSSProperties["textTransform"],
    textDecoration: String(selection?.styles.textDecoration ?? "none"),
  };
  return <div className="html-visual-editor" onKeyDown={(event) => {
    if (event.nativeEvent.isComposing) return;
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && (key === "z" || event.ctrlKey && key === "y")) {
      event.preventDefault();
      try { prepareText.current?.(); } catch { setError(t("editor.html.finishComposition")); return; }
      setTextInput(null); model.moveHistory(key === "y" || event.shiftKey ? "redo" : "undo");
    } else if (event.key === "Escape") { event.preventDefault(); dismiss(); frame.current?.focus(); }
  }}>
    {(error || importing || !ready) && <div className="html-visual-editor__status" role={error ? "alert" : "status"}>
      {error ?? (importing ? t("editor.html.importing") : t("editor.html.preparing"))}</div>}
    <div className="html-visual-editor__body">
      <div className="html-visual-editor__viewport" ref={viewport} onPointerMove={presence.pointerMove} onPointerLeave={presence.away}>
        {projection && <iframe key={projection.session.id} ref={frame} className="native-preview-frame"
          title={title} sandbox="allow-scripts" referrerPolicy="no-referrer" src={projection.url}
          srcDoc={projection.url ? undefined : projection.source} onLoad={connect} aria-busy={!ready} />}
        {rect && <div className="html-editor-selection" data-editing={!!editing} style={overlayStyle} />}
        {selection && !editing && ready && canEdit && <HtmlEditHandle selection={selection} viewport={viewport}
          handle={pencil} bounds={handleBounds} keep={presence.keep} activate={() => {
            presence.keep(); setActive(selection.id); port.current?.postMessage({ type: "active", id: selection.id }); startText(selection);
          }} />}
        {textInput && selection?.id === textInput.id && <HtmlTextInput key={textInput.gesture} initial={textInput.initial}
          style={textStyle} registerPrepare={registerTextPrepare} finish={() => setTextInput(null)} onCompositionChange={setComposing}
          apply={(value) => apply({ kind: "text", value }, textInput.gesture)} />}
        {target && selection && editing && <HtmlFloatingToolbar key={`${projection?.session.id}:${target.id}`} selection={selection} viewport={viewport}
          text={!target.image} image={target.image} alt={target.attrs.get("alt") ?? ""}
          disabled={!ready || !canEdit || importing} canImport={!!assets} apply={apply} importImage={importImage} dismiss={dismiss}
          onNativeControl={setNativeControl} onCompositionChange={setComposing} />}
      </div>
    </div>
  </div>;
}

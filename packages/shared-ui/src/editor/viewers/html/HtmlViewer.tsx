"use client";

import { lazy, Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { CodeMirrorCodeEditor } from "../code/CodeMirrorCodeEditor";
import { DocumentSurfacePending } from "../../host/DocumentSurfaceHost";
import type { PresetViewerRenderContext } from "../../registry/viewerTypes";
import { CodeMirrorDocumentModel, externalDocumentUpdate } from "../../document-session/CodeMirrorDocumentModel";
import { useDocumentModelOwner } from "../../document-session/DocumentModelOwner";
import { useEditableDocumentSource } from "../../document-session/EditableDocumentSourceContext";
const HtmlPreviewFrame = lazy(() => import("./HtmlPreviewFrame").then((module) => ({ default: module.HtmlPreviewFrame })));
const HtmlVisualSurface = lazy(() => import("./HtmlVisualSurface").then((module) => ({ default: module.HtmlVisualSurface })));

type HtmlViewerProps = Pick<PresetViewerRenderContext, "document" | "content" | "fileUrl" | "fileUrlLoading"
  | "fileUrlError" | "loading" | "error" | "htmlTrustMode" | "canEdit" | "hideSourceView">;
type Mode = "preview" | "edit" | "source";

export function HtmlViewer(props: HtmlViewerProps) {
  const { t } = useLocalization();
  if ((props.loading || props.fileUrlLoading) && props.content === "" && !props.fileUrl) return <DocumentSurfacePending label={t("editor.html.loading")} />;
  if ((props.error || props.fileUrlError) && props.content === "" && !props.fileUrl) return <div className="editor-state danger" dir="auto">{props.error ?? props.fileUrlError}</div>;
  return <HtmlDocumentEditor key={props.document.path} {...props} />;
}

function HtmlDocumentEditor({ document, content, fileUrl, htmlTrustMode, canEdit, hideSourceView }: HtmlViewerProps) {
  const { t } = useLocalization();
  const owner = useDocumentModelOwner();
  const editingSource = useEditableDocumentSource();
  const initialContent = useRef(content);
  initialContent.current = content;
  const model = useMemo(() => owner?.getOrCreate("html-text", () => new CodeMirrorDocumentModel(initialContent.current, undefined, true))
    ?? new CodeMirrorDocumentModel(initialContent.current, undefined, true), [owner]);
  const [mode, setMode] = useState<Mode>("preview");
  const [preview, setPreview] = useState(() => model.readSnapshot().content);
  const [error, setError] = useState<string | null>(null);
  const prepare = useRef<(() => void | Promise<void>) | null>(null);
  const registerPrepare = useCallback((callback: (() => void | Promise<void>) | null) => { prepare.current = callback; }, []);
  const lifecycle = useRef(0);
  const canEditRef = useRef(canEdit); canEditRef.current = canEdit;
  const currentMode = useRef(mode); currentMode.current = mode;
  const workingCopyEnabled = useRef(true);
  const setInputEnabled = useCallback((enabled: boolean) => {
    workingCopyEnabled.current = enabled;
    model.setInputEnabled(enabled && canEditRef.current);
  }, [model]);

  useLayoutEffect(() => {
    const lifetime = lifecycle;
    const generation = ++lifetime.current;
    owner?.activate(model);
    model.setInputEnabled(workingCopyEnabled.current && canEditRef.current);
    const unsubscribe = model.subscribeTransactions((transaction) => {
      if (transaction.annotation(externalDocumentUpdate)) {
        if (currentMode.current === "preview") setPreview(model.readSnapshot().content);
      } else editingSource?.reportRevision({ revision: model.revision, origin: "local-edit" });
    });
    const detach = editingSource?.attachSource({ retainedSource: model, readSnapshot: model.readSnapshot,
      replaceContent: model.replaceContent, setInputEnabled,
      prepareDetach: async () => { await prepare.current?.(); model.prepareDetach(); },
    });
    editingSource?.reportRevision({ revision: model.revision, origin: "model-initialization" });
    if (currentMode.current === "preview") setPreview(model.readSnapshot().content);
    return () => {
      unsubscribe(); detach?.();
      if (!owner) queueMicrotask(() => { if (lifetime.current === generation) model.dispose(); });
    };
  }, [model, owner, editingSource, setInputEnabled]);

  const external = useRef(content);
  useLayoutEffect(() => {
    if (!editingSource && external.current !== content) model.replaceContent(content);
    external.current = content;
  }, [content, model, editingSource]);
  useLayoutEffect(() => {
    model.setInputEnabled(canEdit && workingCopyEnabled.current);
    if (!canEdit && currentMode.current === "edit") { setPreview(model.readSnapshot().content); setMode("preview"); }
  }, [canEdit, model]);

  const switchMode = async (next: Mode) => {
    if (next === mode) return;
    try {
      await prepare.current?.(); model.prepareDetach();
      if (next === "edit" && !canEditRef.current) return;
      if (next === "preview") setPreview(model.readSnapshot().content);
      setError(null); setMode(next);
    } catch { setError(t("editor.html.finishComposition")); }
  };
  const moveHistory = async (direction: "undo" | "redo") => {
    try { await prepare.current?.(); model.prepareDetach(); model.moveHistory(direction); setError(null); }
    catch { setError(t("editor.html.finishComposition")); }
  };
  return <section className="editor-host html-document-editor">
    <div className="html-editor-toolbar" role="toolbar" aria-label={t("editor.mode.label")}>
      <button type="button" aria-label={t("editor.html.preview")} aria-pressed={mode === "preview"} onClick={() => void switchMode("preview")}>{t("editor.html.preview")}</button>
      {canEdit && <button type="button" aria-pressed={mode === "edit"} onClick={() => void switchMode("edit")}>{t("editor.html.editPage")}</button>}
      {!hideSourceView && <button type="button" aria-label={t("editor.html.source")} aria-pressed={mode === "source"} onClick={() => void switchMode("source")}>{t("editor.html.source")}</button>}
      {mode === "edit" && <>
        <button type="button" onClick={() => void moveHistory("undo")}>{t("editor.html.undo")}</button>
        <button type="button" onClick={() => void moveHistory("redo")}>{t("editor.html.redo")}</button>
      </>}
    </div>
    {error && <div className="html-visual-editor__status" role="alert">{error}</div>}
    {mode === "source" ? <CodeMirrorCodeEditor model={model} content={content} nodeName={document.name} language="html" readOnly={!canEdit} />
      : mode === "edit" ? <Suspense fallback={<DocumentSurfacePending label={t("editor.html.preparing")} />}><HtmlVisualSurface model={model} path={document.path} title={document.name} fileUrl={fileUrl} canEdit={canEdit} registerPrepare={registerPrepare} /></Suspense>
        : <div className="native-preview native-preview-framed"><Suspense fallback={<DocumentSurfacePending label={t("editor.html.loading")} />}><HtmlPreviewFrame path={document.path} title={document.name} content={preview} fileUrl={fileUrl} htmlTrustMode={htmlTrustMode} /></Suspense></div>}
  </section>;
}

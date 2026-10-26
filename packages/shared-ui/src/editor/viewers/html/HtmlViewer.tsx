"use client";

import { lazy, Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Code2, MousePointer2, Pencil } from "lucide-react";
import { FloatingNotice, FloatingNoticeStack } from "../../../primitives/FloatingNotice";
import { type EditorPaneMenuSegmentedControl, useEditorPaneMenuContributionPublisher } from "../../editorPaneMenuContribution";
import { useLocalization } from "@puppyone/localization/react";
import { CodeMirrorCodeEditor } from "../code/CodeMirrorCodeEditor";
import { DocumentSurfacePending } from "../../host/DocumentSurfaceHost";
import type { PresetViewerRenderContext } from "../../registry/viewerTypes";
import { CodeMirrorDocumentModel, externalDocumentUpdate } from "../../document-session/CodeMirrorDocumentModel";
import { useDocumentModelOwner } from "../../document-session/DocumentModelOwner";
import { useEditableDocumentSource } from "../../document-session/EditableDocumentSourceContext";
import { useEditorPreviewServices } from "../../preview-services/EditorPreviewServices";
import { HtmlViewMenu } from "./HtmlViewMenu";
import { isHtmlDocumentEmpty } from "./htmlDocumentEmpty";
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
  const publishMenu = useEditorPaneMenuContributionPublisher();
  const editingSource = useEditableDocumentSource();
  const projection = useEditorPreviewServices().services?.documentProjection;
  // Cloud can read/write HTML text without a native interactive projection
  // service. Present the interactive page and source editor instead of starting an
  // editing bridge the provider cannot support.
  const canVisualEdit = canEdit && (document.sourceKind !== "cloud" || Boolean(projection));
  const initialContent = useRef(content);
  initialContent.current = content;
  const model = useMemo(() => owner?.getOrCreate("html-text", () => new CodeMirrorDocumentModel(initialContent.current, undefined, true))
    ?? new CodeMirrorDocumentModel(initialContent.current, undefined, true), [owner]);
  const [mode, setMode] = useState<Mode>("preview");
  const viewport = useRef({ x: 0, y: 0 });
  const modeRequest = useRef(0);
  const [preview, setPreview] = useState(() => model.readSnapshot().content);
  const emptyPage = useMemo(() => isHtmlDocumentEmpty(preview), [preview]);
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
    const pendingModeRequest = modeRequest;
    const generation = ++lifetime.current;
    owner?.activate(model);
    model.setInputEnabled(workingCopyEnabled.current && canEditRef.current);
    const unsubscribe = model.subscribeTransactions((transaction) => {
      if (transaction.annotation(externalDocumentUpdate)) {
        if (currentMode.current !== "source") setPreview(model.readSnapshot().content);
      } else editingSource?.reportRevision({ revision: model.revision, origin: "local-edit" });
    });
    const detach = editingSource?.attachSource({ retainedSource: model, readSnapshot: model.readSnapshot,
      replaceContent: model.replaceContent, setInputEnabled,
      prepareDetach: async () => { await prepare.current?.(); model.prepareDetach(); },
    });
    editingSource?.reportRevision({ revision: model.revision, origin: "model-initialization" });
    if (currentMode.current === "preview") setPreview(model.readSnapshot().content);
    return () => {
      pendingModeRequest.current++; unsubscribe(); detach?.();
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
    if (!canVisualEdit && currentMode.current === "edit") { setPreview(model.readSnapshot().content); setMode("preview"); }
  }, [canEdit, canVisualEdit, model]);

  const switchMode = useCallback(async (next: Mode) => {
    const request = ++modeRequest.current;
    if (next === mode) return;
    try {
      await prepare.current?.(); model.prepareDetach();
      if (request !== modeRequest.current) return;
      if (next === "edit" && (!canEditRef.current || !canVisualEdit)) return;
      if (next !== "source") setPreview(model.readSnapshot().content);
      setError(null); setMode(next);
    } catch { if (request === modeRequest.current) setError(t("editor.html.finishComposition")); }
  }, [mode, model, canVisualEdit, t]);
  const viewMenu = useMemo<EditorPaneMenuSegmentedControl>(() => ({
    kind: "segmented", id: "html-view-mode", label: t("editor.html.mode"), value: mode,
    options: [
      { id: "preview", label: t("editor.html.interact"), icon: <MousePointer2 size={16} /> },
      ...(canVisualEdit ? [{ id: "edit", label: t("editor.html.edit"), icon: <Pencil size={16} /> }] : []),
      ...(!hideSourceView ? [{ id: "source", label: t("editor.mode.source"), icon: <Code2 size={16} /> }] : []),
    ],
    setValue: (value) => {
      if (value === "preview" || value === "edit" || value === "source" && !hideSourceView) void switchMode(value);
    },
  }), [mode, canVisualEdit, hideSourceView, switchMode, t]);
  useLayoutEffect(() => {
    if (!publishMenu) return;
    publishMenu({ documentId: document.path, viewItems: viewMenu.options.length > 1 ? [viewMenu] : [] });
    return () => publishMenu(null);
  }, [document.path, publishMenu, viewMenu]);
  const unavailable = useCallback(() => {
    setPreview(model.readSnapshot().content); setMode("preview"); setError(t("editor.html.unsupported"));
  }, [model, t]);
  const showEmptyPage = mode !== "source" && emptyPage;
  return <section className="editor-host html-document-editor">
    {!publishMenu && viewMenu.options.length > 1 && <HtmlViewMenu item={viewMenu} />}
    {error && <FloatingNoticeStack
      className={!publishMenu && viewMenu.options.length > 1 ? "html-editor-notice-stack is-below-options" : "html-editor-notice-stack"}>
      <FloatingNotice className="html-visual-editor__status" tone="danger" onDismiss={() => setError(null)}>{error}</FloatingNotice>
    </FloatingNoticeStack>}
    {showEmptyPage && <div className="html-empty-page editor-state editor-state--stacked">
        <strong>{t("editor.html.emptyTitle")}</strong>
        <span>{t("editor.html.emptyDescription")}</span>
        {!hideSourceView && <button type="button" onClick={() => { void switchMode("source"); }}>
          {t("editor.html.showCode")}
        </button>}
      </div>}
    {!showEmptyPage && (mode === "source" ? <CodeMirrorCodeEditor model={model} content={content} nodeName={document.name} language="html" readOnly={!canEdit} />
      : mode === "edit" ? <Suspense fallback={<DocumentSurfacePending label={t("editor.html.preparing")} />}><HtmlVisualSurface model={model} path={document.path} title={document.name} fileUrl={fileUrl} canEdit={canEdit} viewportState={viewport} registerPrepare={registerPrepare} onUnavailable={unavailable} /></Suspense>
        : <div className="native-preview native-preview-framed"><Suspense fallback={<DocumentSurfacePending label={t("editor.html.loading")} />}><HtmlPreviewFrame path={document.path} title={document.name} content={preview} fileUrl={fileUrl} htmlTrustMode={htmlTrustMode} interactive viewportState={viewport} /></Suspense></div>)}
  </section>;
}

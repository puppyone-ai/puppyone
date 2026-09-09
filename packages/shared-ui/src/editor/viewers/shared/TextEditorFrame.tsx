"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocalization } from "@puppyone/localization/react";
import { PlainTextEditor } from "../code/PlainTextEditor";
import type { EditorMode } from "../../registry/viewerTypes";
import type {
  EditorSourceRevision,
  EditorSourceSnapshotPort,
} from "../../sourceSnapshot";
import { useEditableDocumentSource } from "../../document-session/EditableDocumentSourceContext";
import type { EditableDocumentSource } from "../../document-session/types";
import { useEditorPaneMenuContributionPublisher } from "../../editorPaneMenuContribution";

export type TextEditorControls = {
  canEdit: boolean;
  onChange: (content: string) => void;
  onSourceRevisionChange: (revision: EditorSourceRevision) => void;
  onSnapshotPortChange: (port: EditorSourceSnapshotPort | null) => void;
};

export type TextEditorFrameProps = {
  documentId: string;
  documentVersion?: string | null;
  content: string;
  nodeName: string;
  defaultMode: EditorMode;
  canEdit: boolean;
  hideSourceView: boolean;
  enableModeToggleShortcut?: boolean;
  modeControlPlacement?: "inline" | "pane-menu";
  liveModeLabel?: string;
  sourceModeLabel?: string;
  liveModeIcon?: "edit" | "preview";
  /**
   * The frame scrolls ordinary document surfaces. Structured viewers that
   * coordinate both axes and sticky panes must explicitly own their viewport.
   */
  liveScrollOwner?: "frame" | "viewer";
  /** Keep the editor document canonical and read full source only at save boundaries. */
  sourceSnapshotMode?: boolean;
  renderLive: (content: string, controls: TextEditorControls) => ReactNode;
  renderSource?: (content: string, controls: TextEditorControls) => ReactNode;
};

export function TextEditorFrame({
  documentId,
  documentVersion = null,
  content,
  nodeName,
  defaultMode,
  canEdit,
  hideSourceView,
  enableModeToggleShortcut = false,
  modeControlPlacement = "inline",
  liveModeLabel,
  sourceModeLabel,
  liveModeIcon = "edit",
  liveScrollOwner = "frame",
  sourceSnapshotMode = false,
  renderLive,
  renderSource,
}: TextEditorFrameProps) {
  const { t } = useLocalization();
  const editingSource = useEditableDocumentSource();
  const publishPaneMenuContribution = useEditorPaneMenuContributionPublisher();
  const [mode, setMode] = useState<EditorMode>(hideSourceView ? "live" : defaultMode);
  const [draft, setDraft] = useState(content);
  const [editorValue, setEditorValue] = useState(content);
  const documentIdRef = useRef(documentId);
  const draftRef = useRef(draft);
  const draftRevisionCounterRef = useRef(0);
  const draftRevisionRef = useRef(createDraftRevision(documentId, 0));
  const contentPropRef = useRef(content);
  const hostRef = useRef<HTMLElement | null>(null);
  const snapshotPortRef = useRef<EditorSourceSnapshotPort | null>(null);
  const fallbackSourceRequestedRef = useRef(false);
  const sourceSnapshotRef = useRef({
    content,
    revision: createDraftRevision(documentId, 0),
  });
  const detachSourceRef = useRef<(() => void) | null>(null);
  const editingSourceRef = useRef<EditableDocumentSource | null>(editingSource);

  useLayoutEffect(() => {
    const sourceChanged = editingSourceRef.current !== editingSource;
    const documentChanged = documentIdRef.current !== documentId;
    if (!sourceChanged && !documentChanged) return;

    detachSourceRef.current?.();
    detachSourceRef.current = null;
    snapshotPortRef.current = null;
    fallbackSourceRequestedRef.current = false;

    documentIdRef.current = documentId;
    editingSourceRef.current = editingSource;
    draftRef.current = content;
    contentPropRef.current = content;
    draftRevisionCounterRef.current = 0;
    draftRevisionRef.current = createDraftRevision(documentId, 0);
    sourceSnapshotRef.current = { content, revision: draftRevisionRef.current };
    setMode(hideSourceView ? "live" : defaultMode);
    setDraft(content);
    setEditorValue(content);
  }, [
    content,
    defaultMode,
    documentId,
    documentVersion,
    editingSource,
    hideSourceView,
  ]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useLayoutEffect(() => {
    // Read-only previews do not have a Working Copy/model port, so their
    // stable content projection follows host reads directly. Editable models
    // are replaced exclusively by the Working Copy boundary.
    if (editingSource || documentIdRef.current !== documentId || contentPropRef.current === content) {
      return;
    }
    contentPropRef.current = content;
    draftRef.current = content;
    draftRevisionCounterRef.current = 0;
    draftRevisionRef.current = createDraftRevision(documentId, 0);
    if (sourceSnapshotMode) setEditorValue(content);
    else setDraft(content);
  }, [content, documentId, editingSource, sourceSnapshotMode]);

  useLayoutEffect(() => {
    if (!editingSource || sourceSnapshotMode) return undefined;
    const source: EditorSourceSnapshotPort = {
      readSnapshot: () => ({
        content: draftRef.current,
        revision: draftRevisionRef.current,
      }),
      replaceContent: (nextContent) => {
        draftRevisionCounterRef.current += 1;
        draftRevisionRef.current = createDraftRevision(
          documentIdRef.current,
          draftRevisionCounterRef.current,
        );
        draftRef.current = nextContent;
        setDraft(nextContent);
        return {
          content: nextContent,
          revision: draftRevisionRef.current,
        };
      },
    };
    detachSourceRef.current?.();
    detachSourceRef.current = editingSource.attachSource(source);
    editingSource.reportRevision({
      revision: draftRevisionRef.current,
      origin: "model-initialization",
    });
    return () => {
      detachSourceRef.current?.();
      detachSourceRef.current = null;
    };
  }, [documentId, editingSource, sourceSnapshotMode]);

  useLayoutEffect(() => {
    if (!editingSource || !sourceSnapshotMode || snapshotPortRef.current) return undefined;

    // A source-snapshot Viewer can open directly on a projection that does not
    // mount its heavyweight editor model (HTML preview is the canonical case).
    // The Working Copy must still have a model port so an accepted storage
    // snapshot can update that projection without remounting or writeback.
    const fallbackSource: EditorSourceSnapshotPort = {
      readSnapshot: () => sourceSnapshotRef.current,
      replaceContent: (nextContent) => {
        draftRevisionCounterRef.current += 1;
        const snapshot = {
          content: nextContent,
          revision: createDraftRevision(documentIdRef.current, draftRevisionCounterRef.current),
        };
        sourceSnapshotRef.current = snapshot;
        setEditorValue(nextContent);
        return snapshot;
      },
    };
    const detach = editingSource.attachSource(fallbackSource);
    detachSourceRef.current = detach;
    editingSource.reportRevision({
      revision: sourceSnapshotRef.current.revision,
      origin: "model-initialization",
    });

    return () => {
      detach();
      if (detachSourceRef.current === detach) detachSourceRef.current = null;
    };
  }, [documentId, editingSource, sourceSnapshotMode]);

  useEffect(() => {
    if (hideSourceView) {
      setMode("live");
    }
  }, [hideSourceView]);

  const handleDraftChange = useCallback((nextContent: string) => {
    draftRef.current = nextContent;
    setDraft(nextContent);
    draftRevisionCounterRef.current += 1;
    draftRevisionRef.current = createDraftRevision(documentIdRef.current, draftRevisionCounterRef.current);
    editingSourceRef.current?.reportRevision({
      revision: draftRevisionRef.current,
      origin: "local-edit",
    });
  }, []);

  const handleSourceRevisionChange = (revision: EditorSourceRevision) => {
    sourceSnapshotRef.current = { ...sourceSnapshotRef.current, revision: revision.revision };
    editingSourceRef.current?.reportRevision(revision);
  };

  const handleSnapshotPortChange = (port: EditorSourceSnapshotPort | null) => {
    detachSourceRef.current?.();
    detachSourceRef.current = null;
    snapshotPortRef.current = port;
    if (port && editingSourceRef.current) {
      fallbackSourceRequestedRef.current = false;
      detachSourceRef.current = editingSourceRef.current.attachSource({
        retainedSource: port.retainedSource,
        prepareDetach: port.prepareDetach,
        setInputEnabled: port.setInputEnabled,
        readSnapshot: port.readSnapshot,
        replaceContent: (nextContent) => {
          const snapshot = port.replaceContent(nextContent);
          setEditorValue(nextContent);
          return snapshot;
        },
      });
    } else if (sourceSnapshotMode && fallbackSourceRequestedRef.current && editingSourceRef.current) {
      fallbackSourceRequestedRef.current = false;
      detachSourceRef.current = editingSourceRef.current.attachSource({
        readSnapshot: () => sourceSnapshotRef.current,
        replaceContent: (nextContent) => {
          draftRevisionCounterRef.current += 1;
          const snapshot = {
            content: nextContent,
            revision: createDraftRevision(documentIdRef.current, draftRevisionCounterRef.current),
          };
          sourceSnapshotRef.current = snapshot;
          setEditorValue(nextContent);
          return snapshot;
        },
      });
    }
  };

  const controls: TextEditorControls = {
    canEdit,
    onChange: handleDraftChange,
    onSourceRevisionChange: handleSourceRevisionChange,
    onSnapshotPortChange: handleSnapshotPortChange,
  };

  const switchMode = useCallback((nextMode: EditorMode) => {
    if (nextMode === mode) return;
    if (sourceSnapshotMode) {
      const snapshot = snapshotPortRef.current?.readSnapshot();
      if (snapshot) {
        sourceSnapshotRef.current = snapshot;
        setEditorValue(snapshot.content);
        fallbackSourceRequestedRef.current = nextMode === "live";
      }
    }
    setMode(nextMode);
  }, [mode, sourceSnapshotMode]);

  const setPaneMenuMode = useCallback((nextMode: string) => {
    if (nextMode === "live" || nextMode === "source") switchMode(nextMode);
  }, [switchMode]);

  useLayoutEffect(() => {
    if (
      hideSourceView
      || modeControlPlacement !== "pane-menu"
      || !publishPaneMenuContribution
    ) return undefined;

    publishPaneMenuContribution({
      documentId,
      viewItems: [
        {
          kind: "segmented",
          id: "editor-view-mode",
          label: t("editor.mode.label"),
          value: mode,
          options: [
            {
              id: "live",
              label: liveModeLabel ?? t("editor.mode.live"),
              icon: liveModeIcon === "preview" ? <PreviewIcon /> : <PencilIcon />,
            },
            {
              id: "source",
              label: sourceModeLabel ?? t("editor.mode.source"),
              icon: <CodeIcon />,
            },
          ],
          setValue: setPaneMenuMode,
        },
      ],
    });

    return () => publishPaneMenuContribution(null);
  }, [
    documentId,
    hideSourceView,
    liveModeIcon,
    liveModeLabel,
    mode,
    modeControlPlacement,
    publishPaneMenuContribution,
    setPaneMenuMode,
    sourceModeLabel,
    t,
  ]);

  useEffect(() => {
    if (hideSourceView || !enableModeToggleShortcut) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isModeToggleShortcut(event) || event.defaultPrevented) return;
      const host = hostRef.current;
      const eventTarget = event.target;
      if (
        !host
        || !(eventTarget instanceof Node)
        || !host.contains(eventTarget)
      ) return;
      event.preventDefault();
      switchMode(mode === "live" ? "source" : "live");
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [enableModeToggleShortcut, hideSourceView, mode, switchMode]);

  return (
    <section className="editor-host" ref={hostRef}>
      {mode === "live" ? (
        <div
          className="editor-live-surface"
          data-scroll-owner={liveScrollOwner}
          data-po-scrollbar={liveScrollOwner === "frame" ? "content" : undefined}
        >
          {renderLive(sourceSnapshotMode ? editorValue : draft, controls)}
        </div>
      ) : renderSource ? (
        <div
          className="editor-live-surface"
          data-scroll-owner={liveScrollOwner}
          data-po-scrollbar={liveScrollOwner === "frame" ? "content" : undefined}
        >
          {renderSource(sourceSnapshotMode ? editorValue : draft, controls)}
        </div>
      ) : (
        <PlainTextEditor
          content={draft}
          nodeName={nodeName}
          readOnly={!canEdit}
          onChange={canEdit ? handleDraftChange : undefined}
        />
      )}

      {!hideSourceView && (
        modeControlPlacement === "inline" || !publishPaneMenuContribution
      ) && (
        <div className="editor-mode-toggle" aria-label={t("editor.mode.label")}>
          <button
            className={mode === "live" ? "active" : ""}
            type="button"
            onClick={() => switchMode("live")}
            title={liveModeLabel ?? t("editor.mode.live")}
            aria-label={liveModeLabel ?? t("editor.mode.live")}
          >
            {liveModeIcon === "preview" ? <PreviewIcon /> : <PencilIcon />}
          </button>
          <button
            className={mode === "source" ? "active" : ""}
            type="button"
            onClick={() => switchMode("source")}
            title={sourceModeLabel ?? t("editor.mode.source")}
            aria-label={sourceModeLabel ?? t("editor.mode.source")}
          >
            <CodeIcon />
          </button>
        </div>
      )}
    </section>
  );
}

function isModeToggleShortcut(event: KeyboardEvent): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return false;
  const key = event.key.toLowerCase();
  if (key === "/" && !event.shiftKey) return true;
  if (key === "m" && event.shiftKey) return true;
  return false;
}

function createDraftRevision(documentId: string, sequence: number): string {
  return `draft:${documentId}:${sequence}`;
}

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function PreviewIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

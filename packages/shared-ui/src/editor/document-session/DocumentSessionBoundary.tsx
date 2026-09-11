"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useLocalization } from "@puppyone/localization/react";
import type { DocumentPersistencePort } from "../../core/types";
import { EditorSaveButton } from "../EditorSaveButton";
import type { EditorSaveMode } from "../registry/viewerTypes";
import { getOrCreateDocumentWorkingCopy } from "./documentWorkingCopies";
import { EditableDocumentSourceProvider } from "./EditableDocumentSourceContext";
import { formatDocumentSessionError } from "./formatDocumentSessionError";
import type { DocumentPersistedCommit } from "./types";
import { useDocumentSessionState } from "./useDocumentSessionState";
import { DocumentModelProvider } from "./DocumentModelOwner";

export type DocumentSessionBoundaryProps = {
  documentId: string;
  initialContent: string;
  initialVersion?: string | null;
  saveMode: EditorSaveMode;
  persistence: DocumentPersistencePort;
  onPersisted?: (commit: DocumentPersistedCommit) => void;
  showSaveStatus?: boolean;
  children: ReactNode;
};

/** Trusted composition boundary between routing and a concrete editor. */
export function DocumentSessionBoundary({
  documentId,
  initialContent,
  initialVersion = null,
  saveMode,
  persistence,
  onPersisted,
  showSaveStatus = false,
  children,
}: DocumentSessionBoundaryProps) {
  const { t } = useLocalization();
  // Baseline, callback, and policy changes reconcile into this document's
  // existing session. Only document/storage identity creates a new queue.
  const binding = useMemo(() => {
    return getOrCreateDocumentWorkingCopy({
      documentId,
      initialContent,
      initialVersion,
      saveMode,
      persistence,
      onPersisted,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, persistence]);
  binding.onPersistedRef.current = onPersisted;
  const { session } = binding;
  const element = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  useLayoutEffect(() => session.registerView({
    prepare: () => {
      if (!composing.current) return;
      const active = element.current?.ownerDocument.activeElement;
      if (active instanceof HTMLElement && element.current?.contains(active)) active.blur();
      if (composing.current) throw new Error("Finish the current text composition before closing this document.");
    },
    setInputEnabled: (enabled) => element.current?.toggleAttribute("inert", !enabled),
  }), [session]);
  const sessionState = useDocumentSessionState(session);
  const sessionError = formatDocumentSessionError(sessionState.error, t);

  useLayoutEffect(() => {
    // Every read result is an explicit storage event. This is deliberately
    // independent from Viewer mount state: the Working Copy decides whether
    // to adopt it or acknowledge an own-write echo without replacing typing.
    session.reconcileExternalBaseline(initialContent, initialVersion);
  }, [initialContent, initialVersion, session]);

  useEffect(() => {
    session.setSaveMode(saveMode);
  }, [saveMode, session]);

  const showSaveChrome = showSaveStatus || sessionState.status === "error";
  const save = useCallback(() => {
    observeSessionOperation(session.requestSave(), "manual save");
  }, [session]);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (
      event.key.toLowerCase() !== "s"
      || (!event.metaKey && !event.ctrlKey)
      || event.altKey
      || event.shiftKey
    ) return;
    event.preventDefault();
    save();
  }, [save]);

  return (
    <DocumentModelProvider owner={binding.models}>
    <EditableDocumentSourceProvider source={session}>
      <div ref={element} className="editor-document-session-boundary" onKeyDownCapture={handleKeyDown}
        onCompositionStartCapture={() => { composing.current = true; }}
        onCompositionEndCapture={() => { composing.current = false; }}>
        {showSaveChrome && (
          <div className="editor-save-overlay">
            <EditorSaveButton
              status={sessionState.status}
              manual={saveMode === "manual"}
              onSave={save}
            />
          </div>
        )}
        {sessionError && (
          <div className="editor-inline-error" role="alert" dir="auto">
            <span>{sessionError}</span>
          </div>
        )}
        {children}
      </div>
    </EditableDocumentSourceProvider>
    </DocumentModelProvider>
  );
}

function observeSessionOperation(operation: Promise<void>, label: string): void {
  void operation.catch((error) => {
    // The Session has already published the failure to the boundary and close
    // registry. Keep diagnostics without creating an unhandled rejection.
    console.warn(`Document Session ${label} failed:`, error);
  });
}

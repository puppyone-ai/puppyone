"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { DocumentEditingSessionHandle, DocumentSessionState } from "./types";

const EMPTY_DOCUMENT_SESSION_STATE: DocumentSessionState = Object.freeze({
  documentId: "",
  status: "clean",
  error: null,
  currentRevision: null,
  persistedRevision: null,
  storageVersion: null,
});

export function useDocumentSessionState(
  session: DocumentEditingSessionHandle | null | undefined,
): DocumentSessionState {
  const subscribe = useCallback(
    (listener: () => void) => session?.subscribe(listener) ?? (() => undefined),
    [session],
  );
  const getSnapshot = useCallback(
    () => session?.getState() ?? EMPTY_DOCUMENT_SESSION_STATE,
    [session],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

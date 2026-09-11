import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { DataPort, DocumentDataNode, WorkspaceContentChange } from "../../core/types";
import { getDocumentInputRuntime, type DocumentInputState } from "./DocumentInputRuntime";

const EMPTY: DocumentInputState = Object.freeze({ content: null, loading: false, error: null,
  fileUrl: null, fileUrlLoading: false, fileUrlError: null, generation: 0 });
const subscribeEmpty = () => () => undefined;
const getEmpty = () => EMPTY;
const ignoreCommit = () => undefined;

export function useDocumentInput(node: DocumentDataNode | null, port: DataPort, refresh?: WorkspaceContentChange) {
  const runtime = useMemo(() => node ? getDocumentInputRuntime(port, node) : null,
    // Descriptors may be rebuilt for unrelated tree changes; identity is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node?.path, port]);
  const state = useSyncExternalStore(runtime?.subscribe ?? subscribeEmpty, runtime?.getSnapshot ?? getEmpty, getEmpty);
  useEffect(() => { if (refresh) runtime?.invalidate(refresh); }, [refresh, runtime]);
  return useMemo(() => ({ ...state, applyPersistedCommit: runtime?.applyPersistedCommit ?? ignoreCommit }), [runtime, state]);
}

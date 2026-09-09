import { DocumentDependencyIndex, getDocumentDependencyIndex } from "../resource/DocumentDependencyIndex";
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { createDocumentIdentity } from "../document-session/documentIdentity";
import { bindEditorTaskSignal } from "./BrowserEditorWorkerHost";
import { type EditorTaskOwner } from "./EditorTaskScheduler";
import { getEditorRuntimeGeneration, subscribeEditorRuntimeGeneration } from "./editorRuntimeAdmission";

const TaskContext = createContext<EditorTaskOwner | null>(null);
export function useEditorTaskOwner(): EditorTaskOwner | null { return useContext(TaskContext); }
let generation = 0;

export function EditorTaskBoundary({ storageIdentity, resource, children }: {
  storageIdentity: string; resource: string; children: ReactNode;
}) {
  const runtimeGeneration = useSyncExternalStore(subscribeEditorRuntimeGeneration, getEditorRuntimeGeneration, getEditorRuntimeGeneration);
  const owner = useMemo(() => ({ scope: storageIdentity,
    instance: createDocumentIdentity({ storageIdentity }, resource).resourcePath,
    generation: ++generation, runtimeGeneration }), [storageIdentity, resource, runtimeGeneration]);
  return <TaskContext.Provider value={owner}>{children}</TaskContext.Provider>;
}

/** The view controls cancellation; the document owner remains visible to close/root barriers. */
export function useEditorTaskController(): () => AbortController {
  const owner = useContext(TaskContext);
  return useCallback(() => {
    const controller = new AbortController();
    if (owner) bindEditorTaskSignal(controller.signal, owner);
    return controller;
  }, [owner]);
}

export function useEditorDependencies() {
  const owner = useContext(TaskContext);
  const index = useMemo(() => owner ? getDocumentDependencyIndex(owner.scope, owner.instance)
    : new DocumentDependencyIndex("standalone"), [owner]);
  const revision = useSyncExternalStore(index.subscribe, index.getSnapshot, index.getSnapshot);
  return { index, revision };
}

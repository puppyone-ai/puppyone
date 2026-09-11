import { useEffect, useState } from "react";
import type { DataPort, WorkspaceContentChange } from "../../core/types";
import { acquireFileResource, invalidateFileResources, type FileResourceHandle } from "./FileResourcePool";
import { getEditorStorageIdentity } from "./editorStorageIdentity";

export type FileResourceLeaseState = Readonly<{
  fileUrl: string | null;
  fileUrlLoading: boolean;
  fileUrlError: string | null;
}>;

export function useFileResourceLease({ dataPort, enabled, path, refresh }: Readonly<{
  dataPort: DataPort; enabled: boolean; path: string | null; refresh?: WorkspaceContentChange;
}>): FileResourceLeaseState {
  const identity = getEditorStorageIdentity(dataPort);
  const [state, setState] = useState<FileResourceLeaseState & { key: string | null }>({
    key: null, fileUrl: null, fileUrlLoading: false, fileUrlError: null,
  });
  const key = enabled && path ? JSON.stringify([identity, path]) : null;
  useEffect(() => { if (refresh) invalidateFileResources(identity, refresh); }, [identity, refresh]);
  useEffect(() => {
    if (!key || !path || !dataPort.getFileUrl) return;
    const controller = new AbortController();
    let handle: FileResourceHandle | null = null;
    let unsubscribe: (() => void) | null = null;
    setState((current) => ({ ...current, key, fileUrl: current.key === key ? current.fileUrl : null, fileUrlLoading: true, fileUrlError: null }));
    void acquireFileResource(dataPort, path, {}, controller.signal).then((resource) => {
      if (controller.signal.aborted) { resource.revoke(); return; }
      handle = resource;
      const publish = (url: string | null) => setState({ key, fileUrl: url, fileUrlLoading: false, fileUrlError: url ? null : "The resource is no longer available." });
      unsubscribe = resource.subscribe(publish);
      publish(resource.url);
    }).catch((error) => {
      if (!controller.signal.aborted) setState((current) => ({ ...current, key, fileUrlLoading: false, fileUrlError: error instanceof Error ? error.message : String(error) }));
    });
    return () => { controller.abort(); unsubscribe?.(); handle?.revoke(); };
  }, [dataPort, key, path]);
  return state.key === key && key ? state : { fileUrl: null, fileUrlLoading: Boolean(key), fileUrlError: null };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getEditorSourceRequirement,
  readDocumentStorageSnapshot,
  shouldReadEditorContent,
  useFileResourceLease,
  workspaceContentChangeMatchesResource,
  type DataPort,
  type DocumentDataNode,
  type DocumentPersistedCommit,
  type FileContent,
  type WorkspaceContentChange,
} from "@puppyone/shared-ui";

export function useEditorPaneSource(
  node: DocumentDataNode | null,
  dataPort: DataPort,
  refreshKey?: WorkspaceContentChange,
) {
  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadSequence, setReloadSequence] = useState(0);
  const lastRefreshSequenceRef = useRef(refreshKey?.sequence ?? Number.NEGATIVE_INFINITY);
  const nodePath = node?.path ?? null;
  const readFile = dataPort.readFile;
  const documentPersistence = dataPort.documentPersistence;
  const needsContent = Boolean(node && readFile && shouldReadEditorContent(node));
  const sourceRequirement = node ? getEditorSourceRequirement(node) : "none";
  const needsResource = Boolean(
    node
    && dataPort.getFileUrl
    && (sourceRequirement === "resource" || sourceRequirement === "content-and-resource"),
  );

  useEffect(() => {
    setContent((current) => current?.path === nodePath ? current : null);
    setError(null);
  }, [nodePath]);

  // Convert scoped workspace invalidations into a stable read dependency.
  // Keeping the path guard inside the read effect is unsafe: React Strict Mode
  // cleans up and replays effects, while refs survive that replay. The replay
  // can then mistake an aborted first read for a completed read and skip the
  // only live request, leaving the pane pending forever.
  useEffect(() => {
    const previousRefreshSequence = lastRefreshSequenceRef.current;
    lastRefreshSequenceRef.current = refreshKey?.sequence ?? previousRefreshSequence;
    if (workspaceContentChangeMatchesResource(refreshKey, nodePath, previousRefreshSequence)) {
      setReloadSequence((current) => current + 1);
    }
  }, [nodePath, refreshKey]);

  useEffect(() => {
    if (!nodePath || !needsContent || !readFile) {
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setError(null);
    setLoading(true);
    readDocumentStorageSnapshot({ readFile, documentPersistence }, nodePath, {
      signal: controller.signal,
      accept: setContent,
    })
      .catch((nextError) => {
        if (!controller.signal.aborted) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [documentPersistence, needsContent, nodePath, readFile, reloadSequence]);

  const resource = useFileResourceLease({
    dataPort,
    enabled: needsResource,
    path: nodePath,
    refresh: refreshKey,
  });

  const applyPersistedCommit = useCallback((commit: DocumentPersistedCommit) => {
    setContent((current) => {
      if (!node || commit.documentId !== node.path) return current;
      return current
        ? { ...current, content: commit.content, version: commit.version }
        : {
            path: node.path,
            name: node.name,
            type: node.type,
            content: commit.content,
            version: commit.version,
          };
    });
  }, [node]);

  const visibleContent = content?.path === nodePath ? content : null;

  return useMemo(() => ({
    content: visibleContent,
    loading: loading || (needsContent && !visibleContent && !error),
    error,
    fileUrl: resource.fileUrl,
    fileUrlLoading: resource.fileUrlLoading,
    fileUrlError: resource.fileUrlError,
    applyPersistedCommit,
  }), [
    applyPersistedCommit,
    visibleContent,
    error,
    resource.fileUrl,
    resource.fileUrlError,
    resource.fileUrlLoading,
    loading,
    needsContent,
  ]);
}

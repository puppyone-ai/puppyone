import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  closeDocumentWorkingCopy,
  appendWorkspaceContentChange,
  isDocumentDataNode,
  withEditorDocumentOperations,
  type DataNode,
  type WorkspaceContentChange,
} from "@puppyone/shared-ui";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { FilesVisibilitySettings } from "../../../preferences";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
import { createExplorerDataPort } from "../../data-workspace/explorer";
import { useProjectExplorerSelection } from "../../data-workspace/useProjectExplorerSession";
import { useDesktopEditorWorkbench } from "../../editor-workbench/controller/useDesktopEditorWorkbench";
import { useDataNodeActions } from "../../data-workspace/useDataNodeActions";
import { createCloudDataService } from "../files/cloudDataPort";
import { createPendingCloudDataService } from "./pendingCloudDataService";

const noop = () => undefined;

export function useNativeCloudWorkbench({ context, session, apiBaseUrl, active, filesVisibilitySettings }: {
  context: ProjectCloudContext;
  session: DesktopCloudSession | null;
  apiBaseUrl: string | null;
  active: boolean;
  filesVisibilitySettings: FilesVisibilitySettings;
}) {
  const resolved = context.status === "resolved" ? context : null;
  const serviceKey = resolved && session && apiBaseUrl
    ? JSON.stringify([apiBaseUrl, session.user_id, session.session_generation,
      resolved.projectId, resolved.target, resolved.scopePath, resolved.projectName, resolved.capabilities])
    : null;
  const lease = useMemo(() => ({ key: serviceKey }), [serviceKey]);
  const currentLeaseRef = useRef<typeof lease | null>(lease);
  currentLeaseRef.current = lease;
  useEffect(() => {
    currentLeaseRef.current = lease;
    return () => { if (currentLeaseRef.current === lease) currentLeaseRef.current = null; };
  }, [lease]);
  const { service, error } = useMemo(() => {
    if (!resolved || !session || !apiBaseUrl) return { service: null, error: null };
    try {
      return { service: createCloudDataService({ context: resolved, session, apiBaseUrl,
        isCurrent: () => currentLeaseRef.current === lease }), error: null };
    } catch (cause) {
      return { service: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
    // The key is the complete authority/scope/session contract. Object identity
    // from an auth snapshot or a context render must not rebuild the provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceKey]);
  const dataPort = useMemo(() => service
    ? withEditorDocumentOperations(createExplorerDataPort(service.dataPort, filesVisibilitySettings))
    : null, [service, filesVisibilitySettings]);
  const pendingService = useMemo(() => createPendingCloudDataService(apiBaseUrl, "Puppyone Cloud"), [apiBaseUrl]);
  const surfaceService = service ?? pendingService;
  const [surfaceVisitedKey, setSurfaceVisitedKey] = useState<string | null>(null);
  useEffect(() => { if (active) setSurfaceVisitedKey(pendingService.workspace.id); }, [active, pendingService]);
  const surfaceVisited = active || surfaceVisitedKey === pendingService.workspace.id;
  const [visitedKey, setVisitedKey] = useState<string | null>(null);
  useEffect(() => { if (active && service) setVisitedKey(service.workspace.id); }, [active, service]);
  const visited = Boolean(service && (active || visitedKey === service.workspace.id));
  const resolveEditorResource = useCallback((path: string) => {
    const resource = service?.resolveResource(path);
    return resource?.providerPath ? {
      rootUri: resource.folder.uri, resourcePath: resource.providerPath, hostPath: resource.resourceUri,
    } : null;
  }, [service]);
  const editorWorkbench = useDesktopEditorWorkbench(visited ? service?.workspace ?? null : null,
    dataPort?.resolveNode ?? null, service?.folder.uri ?? null, resolveEditorResource, service?.workspace.id ?? null);
  const [activeNode, setActiveNode] = useProjectExplorerSelection(service?.workspace ?? null);
  // A tab/pane switch owns the current document; do not retain a prior folder
  // selection as the Share target after the visible document changes.
  useEffect(() => { setActiveNode(null); }, [editorWorkbench.activePath, setActiveNode]);
  const selectionAwareEditorWorkbench = useMemo(() => ({ ...editorWorkbench,
    activate: (editorId: string) => { setActiveNode(null); editorWorkbench.activate(editorId); },
    focusPane: (paneId: string) => { setActiveNode(null); editorWorkbench.focusPane(paneId); },
  }), [editorWorkbench, setActiveNode]);
  const [refreshToken, setRefreshToken] = useState<WorkspaceContentChange>({ sequence: 0, entries: [] });
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const navigationRequest = useRef(0);
  const revalidate = useCallback(() => {
    if (service) setRefreshToken(current => appendWorkspaceContentChange(current, { rootUri: service.folder.uri, paths: null }));
  }, [service]);
  const refresh = useCallback(() => { service?.invalidateReads(); revalidate(); }, [service, revalidate]);
  const activateNode = useCallback((node: DataNode) => {
    if (!service?.resolveResource(node.path)) return;
    setActiveNode(node);
    if (isDocumentDataNode(node)) editorWorkbench.openDocument(node);
  }, [editorWorkbench, service, setActiveNode]);
  const onActivePathChange = useCallback(async (path: string | null, node?: DataNode | null) => {
    const requestId = ++navigationRequest.current;
    try {
      if (!path) { setActiveNode(null); return; }
      const target = node ?? await dataPort?.resolveNode?.(path);
      if (requestId !== navigationRequest.current) return;
      if (target) activateNode(target);
      setNavigationError(null);
    } catch (cause) {
      if (requestId === navigationRequest.current) setNavigationError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [activateNode, dataPort, setActiveNode]);
  const actions = useDataNodeActions({
    dataPort, getPathForCopy: service?.getPathForCopy, workspace: service?.workspace ?? null, setActiveExplorerNode: setActiveNode,
    onEnterDataView: noop, onLocalWorkspaceContentChanged: noop,
    onWorkspaceContentChanged: refresh, onActivateNode: activateNode,
    onResourceMoved: editorWorkbench.rebaseResource, onResourceDeleted: editorWorkbench.closeUnderResource,
  });
  const closeEditor = useCallback(async (editorId: string) => {
    try {
      const resourcePath = editorWorkbench.state.editors.find((editor) => editor.id === editorId)?.resource;
      if (!resourcePath) return;
      const storageIdentity = dataPort?.documentPersistence?.storageIdentity;
      if (storageIdentity) await closeDocumentWorkingCopy({ storageIdentity, resourcePath });
      editorWorkbench.close(editorId);
      setNavigationError(null);
    } catch (cause) { setNavigationError(cause instanceof Error ? cause.message : String(cause)); }
  }, [dataPort, editorWorkbench]);
  const resetActions = actions.resetDataNodeActions;
  useEffect(() => {
    if (!active) { navigationRequest.current++; resetActions(); }
  }, [active, resetActions]);
  useEffect(() => {
    navigationRequest.current++;
    resetActions();
    setNavigationError(null);
  }, [serviceKey, resetActions]);
  const lastRevalidation = useRef<{ key: string | null; at: number }>({ key: null, at: 0 });
  useEffect(() => {
    if (!active || !service) return;
    if (lastRevalidation.current.key !== serviceKey) lastRevalidation.current = { key: serviceKey, at: Date.now() };
    const onFocus = () => {
      if (document.visibilityState === "hidden" || Date.now() - lastRevalidation.current.at < 30_000) return;
      lastRevalidation.current.at = Date.now();
      revalidate();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const timer = window.setInterval(onFocus, 30_000);
    onFocus();
    return () => {
      window.clearInterval(timer); window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [active, service, serviceKey, revalidate]);
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "w" && editorWorkbench.activeEditorId) {
        event.preventDefault(); void closeEditor(editorWorkbench.activeEditorId);
      } else if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === "Tab") {
        const editors = editorWorkbench.state.editors;
        if (!editors.length) return;
        event.preventDefault();
        const index = editors.findIndex(({ id }) => id === editorWorkbench.activeEditorId);
        editorWorkbench.activate(editors[(index + (event.shiftKey ? -1 : 1) + editors.length) % editors.length]!.id);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, closeEditor, editorWorkbench]);
  return { service, surfaceService, surfaceVisited, dataPort, visited, editorWorkbench: selectionAwareEditorWorkbench, activeNode, actions, refreshToken, refresh,
    onActivePathChange, setActiveNode, closeEditor, error: navigationError ?? error };
}

export type NativeCloudWorkbench = ReturnType<typeof useNativeCloudWorkbench>;

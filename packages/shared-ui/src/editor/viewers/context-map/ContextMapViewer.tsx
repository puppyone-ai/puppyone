import { useEditorDependencies } from "../../runtime/EditorTaskContext";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefCallback,
  type RefObject,
  type SetStateAction,
} from "react";
import { ChevronUp, LoaderCircle } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import type { DataNode, DataPort } from "../../../core/types";
import { FileGlyphIcon } from "../../../file/fileIcons";
import type { FileIconThemeId } from "../../../file/fileIconTypes";
import { useStructuredDocumentModel } from "../../document-session/useStructuredDocumentModel";
import { useRetainedEditorViewState } from "../../document-session/useRetainedEditorViewState";
import { useEditorPaneMenuContributionPublisher } from "../../editorPaneMenuContribution";
import type { PresetViewerRenderContext } from "../../registry/viewerTypes";
import {
  createDefaultContextMapDocument,
  fromContextMapRelativePath,
  getContextMapScopePath,
  parseContextMapDocument,
  serializeContextMapDocument,
  toContextMapRelativePath,
  type ContextMapDocument,
} from "./contextMapDocument";
import {
  DEFAULT_CONTEXT_MAP_LINE_FILTERS,
  isContextMapReferenceVisible,
  updateContextMapLineFilter,
  type ContextMapLineFilterKey,
  type ContextMapLineFilterState,
} from "./contextMapFilters";
import {
  buildFolderRelationshipProjection,
  loadFolderRelationshipGraph,
  type FolderRelationshipEdge,
  type FolderRelationshipGraph,
} from "./contextMapGraph";
import {
  buildFolderRelationshipLayoutZones,
  buildFolderRelationshipSceneLayout,
  buildLayeredRelationshipSceneLayout,
  buildRadialRelationshipSceneLayout,
  getExpandedFolderPreferredWidth,
  getDraggedRelationshipOffset,
  getFolderRelationshipLayoutOffset,
  getZoomedRelationshipViewport,
  type RelationshipDragLimits,
  type RelationshipLayoutOffset,
  type RelationshipSceneLayout,
  type RelationshipViewportTransform,
} from "./contextMapLayout";
import {
  routeLayeredHierarchyRelationships,
  routeLayeredReferenceRelationship,
  routeRadialHierarchyRelationships,
  routeRadialReferenceRelationship,
  routeStraightRelationships,
  type RelationshipRouteRect,
} from "./contextMapRouting";
import {
  EMPTY_CONTEXT_MAP_WHEEL_GESTURE_STATE,
  resolveContextMapWheelGesture,
} from "./contextMapWheelNavigation";

type RelationshipLine = FolderRelationshipEdge & Readonly<{
  path: string;
}>;

type ContextMapLayoutMode = "canvas" | "layered" | "radial";

type RadialHierarchyLine = Readonly<{
  path: string;
  sourceId: string;
  targetId: string;
}>;

type RelationshipDragSession = {
  captureElement: HTMLElement;
  latestOffset: RelationshipLayoutOffset;
  limits: RelationshipDragLimits | null;
  moved: boolean;
  nodePath: string;
  origin: RelationshipLayoutOffset;
  pointerId: number;
  slotElement: HTMLElement;
  startX: number;
  startY: number;
};

type RelationshipPanSession = Readonly<{
  captureElement: HTMLElement;
  origin: RelationshipLayoutOffset;
  pointerId: number;
  startX: number;
  startY: number;
}>;

type RelationshipDragController = Readonly<{
  consumeClick: (nodePath: string) => boolean;
  draggingNodePath: string | null;
  finish: (event: ReactPointerEvent<HTMLElement>) => void;
  move: (event: ReactPointerEvent<HTMLElement>) => void;
  offsets: ReadonlyMap<string, RelationshipLayoutOffset>;
  start: (nodePath: string, event: ReactPointerEvent<HTMLElement>) => void;
}>;

type ContextMapViewerProps = Pick<
  PresetViewerRenderContext,
  "document" | "content" | "canEdit" | "fileIconTheme" | "contextMapEnvironment"
>;

export function ContextMapViewer({
  document: sourceDocument,
  content: sourceContent,
  canEdit,
  fileIconTheme,
  contextMapEnvironment,
}: ContextMapViewerProps) {
  const { t } = useLocalization();
  const { model, state, edit: applyDocumentEdit, onHistoryKeyDown } = useStructuredDocumentModel({
    kind: "context-map",
    documentId: sourceDocument.path,
    content: sourceContent,
    canEdit,
    parse: parseContextMapDocument,
    serialize: serializeContextMapDocument,
  });
  const mapDocument = state.document;
  const parseError = state.error;
  const updateDocument = useCallback((update: (current: ContextMapDocument) => ContextMapDocument) => {
    applyDocumentEdit(update(model.getSnapshot().document));
  }, [applyDocumentEdit, model]);

  const scopePath = useMemo(
    () => getContextMapScopePath(sourceDocument.path),
    [sourceDocument.path],
  );
  const expandedFolderPaths = useMemo(() => new Set(
    mapDocument.layout.expanded.flatMap((path) => {
      const absolutePath = fromContextMapRelativePath(scopePath, path);
      return absolutePath ? [absolutePath] : [];
    }),
  ), [mapDocument.layout.expanded, scopePath]);
  const manualOffsetsByNode = useMemo(() => new Map(
    Object.entries(mapDocument.layout.offsets).flatMap(([path, offset]) => {
      const absolutePath = fromContextMapRelativePath(scopePath, path);
      return absolutePath ? [[absolutePath, offset] as const] : [];
    }),
  ), [mapDocument.layout.offsets, scopePath]);

  const toggleFolder = useCallback((node: DataNode) => {
    const relativePath = toContextMapRelativePath(scopePath, node.path);
    if (!relativePath || relativePath === ".") return;
    updateDocument((current) => {
      const expanded = new Set(current.layout.expanded);
      if (expanded.has(relativePath)) expanded.delete(relativePath);
      else expanded.add(relativePath);
      return {
        ...current,
        layout: { ...current.layout, expanded: [...expanded] },
      };
    });
  }, [scopePath, updateDocument]);

  const updateManualOffsets = useCallback((
    offsetsByAbsolutePath: ReadonlyMap<string, RelationshipLayoutOffset>,
  ) => {
    updateDocument((current) => {
      const offsets: Record<string, RelationshipLayoutOffset> = {};
      for (const [absolutePath, offset] of offsetsByAbsolutePath) {
        const relativePath = toContextMapRelativePath(scopePath, absolutePath);
        if (!relativePath || relativePath === ".") continue;
        offsets[relativePath] = offset;
      }
      return { ...current, layout: { ...current.layout, offsets } };
    });
  }, [scopePath, updateDocument]);

  const resetInvalidFile = useCallback(() => {
    applyDocumentEdit(createDefaultContextMapDocument());
  }, [applyDocumentEdit]);
  const dataPort = useMemo<DataPort | null>(() => contextMapEnvironment ? ({
    listChildren: contextMapEnvironment.listChildren,
    readFile: contextMapEnvironment.readFile,
  }) : null, [contextMapEnvironment]);
  const initialFolder = useMemo<DataNode>(() => ({
    id: `context-map-scope:${scopePath ?? ""}`,
    name: getScopeName(scopePath),
    path: scopePath ?? "",
    source: "local",
    type: "folder",
  }), [scopePath]);

  if (!contextMapEnvironment || !dataPort) {
    return (
      <section className="folder-relationship-view">
        <div className="folder-relationship-state is-error" role="alert">
          <strong>{t("workspace.relationships.failed")}</strong>
          <span>{t("workspace.relationships.unavailable")}</span>
        </div>
      </section>
    );
  }

  return (
    <div className="context-map-viewer-shell" onKeyDownCapture={onHistoryKeyDown}>
      {parseError && (
        <div className="context-map-parse-error" role="alert">
          <span>{t("workspace.relationships.invalidFile", { detail: parseError })}</span>
          {canEdit && (
            <button type="button" onClick={resetInvalidFile}>
              {t("workspace.relationships.resetFile")}
            </button>
          )}
        </div>
      )}
      <ContextMapSurface
        dataPort={dataPort}
        documentId={sourceDocument.path}
        expandedFolderPaths={expandedFolderPaths}
        fileIconTheme={fileIconTheme}
        initialFolder={initialFolder}
        manualOffsetsByNode={manualOffsetsByNode}
        refreshSequence={contextMapEnvironment.revision}
        onManualOffsetsChange={updateManualOffsets}
        onToggleFolder={toggleFolder}
      />
    </div>
  );
}

function ContextMapSurface({
  dataPort,
  documentId,
  expandedFolderPaths,
  fileIconTheme,
  initialFolder,
  manualOffsetsByNode,
  refreshSequence,
  onManualOffsetsChange,
  onToggleFolder,
}: {
  dataPort: DataPort;
  documentId: string;
  expandedFolderPaths: ReadonlySet<string>;
  fileIconTheme: FileIconThemeId;
  initialFolder: DataNode;
  manualOffsetsByNode: ReadonlyMap<string, RelationshipLayoutOffset>;
  refreshSequence: number;
  onManualOffsetsChange: (
    offsets: ReadonlyMap<string, RelationshipLayoutOffset>,
  ) => void;
  onToggleFolder: (node: DataNode) => void;
}) {
  const { t } = useLocalization();
  const { index: dependencyIndex, revision: dependencyRevision } = useEditorDependencies();
  const publishPaneMenuContribution = useEditorPaneMenuContributionPublisher();
  const [graph, setGraph] = useState<FolderRelationshipGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useRetainedEditorViewState<ContextMapLayoutMode>("context-map:layout", "radial");
  const [lineFilters, setLineFilters] = useState<ContextMapLineFilterState>(
    DEFAULT_CONTEXT_MAP_LINE_FILTERS,
  );

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const dependencies = dependencyIndex.begin();
    setGraph(null);
    setError(null);
    void loadFolderRelationshipGraph({
      dataPort: {
        ...dataPort,
        listChildren: async (path) => {
          dependencies.track("directory", path ?? "");
          return dataPort.listChildren(path);
        },
        ...(dataPort.readFile ? { readFile: async (path: string, options?: { signal?: AbortSignal }) => {
          dependencies.track("resource", path);
          return dataPort.readFile!(path, options);
        } } : {}),
      },
      folder: initialFolder,
      signal: controller.signal,
    })
      .then((nextGraph) => {
        if (active && dependencies.commit()) setGraph(nextGraph);
      })
      .catch((reason: unknown) => {
        if (!active || isAbortError(reason)) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
      dependencies.abort();
      controller.abort();
    };
  }, [dataPort, initialFolder, refreshSequence, dependencyIndex, dependencyRevision]);

  const setPaneMenuLayoutMode = useCallback((mode: string) => {
    if (mode === "radial" || mode === "canvas" || mode === "layered") {
      setLayoutMode(mode);
    }
  }, [setLayoutMode]);

  const setLineFilterVisibility = useCallback((
    key: ContextMapLineFilterKey,
    visible: boolean,
  ) => {
    setLineFilters((current) => updateContextMapLineFilter(current, key, visible));
  }, []);

  useLayoutEffect(() => {
    if (!publishPaneMenuContribution) return undefined;
    publishPaneMenuContribution({
      documentId,
      viewItems: [
        {
          kind: "segmented",
          id: "context-map-layout",
          label: t("workspace.relationships.layoutSwitcher"),
          value: layoutMode,
          options: [
            {
              id: "radial",
              label: t("workspace.relationships.layout.radial"),
              icon: <RadialLayoutIcon size={12} />,
            },
            {
              id: "canvas",
              label: t("workspace.relationships.layout.canvas"),
              icon: <CanvasLayoutIcon size={12} />,
            },
            {
              id: "layered",
              label: t("workspace.relationships.layout.layered"),
              icon: <LayeredLayoutIcon size={12} />,
            },
          ],
          setValue: setPaneMenuLayoutMode,
        },
        {
          kind: "toggle",
          id: "context-map-filter-one-way-links",
          label: t("workspace.relationships.filter.oneWayLinks"),
          checked: lineFilters.oneWayLinks,
          setChecked: (visible) => setLineFilterVisibility("oneWayLinks", visible),
        },
        {
          kind: "toggle",
          id: "context-map-filter-bidirectional-links",
          label: t("workspace.relationships.filter.bidirectionalLinks"),
          checked: lineFilters.bidirectionalLinks,
          setChecked: (visible) => setLineFilterVisibility("bidirectionalLinks", visible),
        },
      ],
    });
    return () => publishPaneMenuContribution(null);
  }, [
    documentId,
    layoutMode,
    lineFilters,
    publishPaneMenuContribution,
    setLineFilterVisibility,
    setPaneMenuLayoutMode,
    t,
  ]);

  const projection = useMemo(
    () => graph ? buildFolderRelationshipProjection(graph, expandedFolderPaths) : null,
    [expandedFolderPaths, graph],
  );
  return (
    <section className="folder-relationship-view" aria-label={t("workspace.relationships.title")}>
      <div className="folder-relationship-body" data-po-scrollbar="content">
        {!graph && !error && (
          <div className="folder-relationship-state" role="status">
            <LoaderCircle className="folder-relationship-spinner" size={18} aria-hidden="true" />
            <span>{t("workspace.relationships.loading")}</span>
          </div>
        )}
        {error && (
          <div className="folder-relationship-state is-error" role="alert">
            <strong>{t("workspace.relationships.failed")}</strong>
            <span>{error}</span>
          </div>
        )}
        {graph && graph.rootNodes.length === 0 && (
          <div className="folder-relationship-state" role="status">
            <FileGlyphIcon name="folder" type="folder" size={24} theme={fileIconTheme} />
            <strong>{t("workspace.relationships.empty")}</strong>
            <span>{t("workspace.relationships.emptyDetail")}</span>
          </div>
        )}
        {graph && graph.rootNodes.length > 0 && projection && (
          layoutMode === "canvas" ? (
            <RelationshipCanvas
              edges={projection.edges}
              expandedFolderPaths={expandedFolderPaths}
              fileIconTheme={fileIconTheme}
              graph={graph}
              lineFilters={lineFilters}
              manualOffsetsByNode={manualOffsetsByNode}
              relationshipCountByNode={projection.relationshipCountByNode}
              onManualOffsetsChange={onManualOffsetsChange}
              onToggleFolder={onToggleFolder}
            />
          ) : layoutMode === "radial" ? (
            <RadialRelationshipCanvas
              edges={projection.edges}
              expandedFolderPaths={expandedFolderPaths}
              fileIconTheme={fileIconTheme}
              graph={graph}
              lineFilters={lineFilters}
              onToggleFolder={onToggleFolder}
            />
          ) : (
            <LayeredRelationshipCanvas
              edges={projection.edges}
              expandedFolderPaths={expandedFolderPaths}
              fileIconTheme={fileIconTheme}
              graph={graph}
              lineFilters={lineFilters}
              onToggleFolder={onToggleFolder}
            />
          )
        )}
        {graph?.truncated && (
          <div className="folder-relationship-limit-note" role="status">
            {t("workspace.relationships.truncated", { count: graph.scannedFileCount })}
          </div>
        )}
      </div>
    </section>
  );
}

function ContextMapReferenceArrowMarker({ id }: Readonly<{ id: string }>) {
  return (
    <marker
      id={id}
      markerHeight="8"
      markerUnits="userSpaceOnUse"
      markerWidth="8"
      orient="auto-start-reverse"
      refX="7"
      refY="4"
      viewBox="0 0 8 8"
    >
      <path className="folder-relationship-reference-arrow" d="M 0.75 0.75 L 7 4 L 0.75 7.25 Z" />
    </marker>
  );
}

function useContextMapWheelNavigation({
  canvasRef,
  centeredFocalPoint,
  minimumScale,
  setViewportTransform,
}: Readonly<{
  canvasRef: RefObject<HTMLDivElement | null>;
  centeredFocalPoint: boolean;
  minimumScale: number;
  setViewportTransform: Dispatch<SetStateAction<RelationshipViewportTransform>>;
}>) {
  const gestureStateRef = useRef(EMPTY_CONTEXT_MAP_WHEEL_GESTURE_STATE);
  const handleWheel = useCallback((event: WheelEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const legacyEvent = event as WheelEvent & { wheelDeltaY?: number };
    const result = resolveContextMapWheelGesture({
      ctrlKey: event.ctrlKey,
      deltaMode: event.deltaMode,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      legacyWheelDeltaY: legacyEvent.wheelDeltaY,
      pageHeight: bounds.height,
      pageWidth: bounds.width,
      shiftKey: event.shiftKey,
      timestamp: event.timeStamp,
    }, gestureStateRef.current);
    gestureStateRef.current = result.state;

    setViewportTransform((current) => {
      if (result.gesture.kind === "pan") {
        return {
          ...current,
          x: current.x + result.gesture.x,
          y: current.y + result.gesture.y,
        };
      }
      const focalPoint = {
        x: event.clientX - bounds.left - (centeredFocalPoint ? bounds.width / 2 : 0),
        y: event.clientY - bounds.top - (centeredFocalPoint ? bounds.height / 2 : 0),
      };
      return getZoomedRelationshipViewport(
        current,
        focalPoint,
        current.scale * result.gesture.factor,
        minimumScale,
      );
    });
    event.preventDefault();
  }, [canvasRef, centeredFocalPoint, minimumScale, setViewportTransform]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [canvasRef, handleWheel]);
}

function RadialRelationshipCanvas({
  edges,
  expandedFolderPaths,
  fileIconTheme,
  graph,
  lineFilters,
  onToggleFolder,
}: Readonly<{
  edges: readonly FolderRelationshipEdge[];
  expandedFolderPaths: ReadonlySet<string>;
  fileIconTheme: FileIconThemeId;
  graph: FolderRelationshipGraph;
  lineFilters: ContextMapLineFilterState;
  onToggleFolder: (node: DataNode) => void;
}>) {
  const referenceArrowId = `context-map-radial-reference-arrow-${useId().replaceAll(":", "")}`;
  const referenceArrowUrl = `url(#${referenceArrowId})`;
  const canvasRef = useRef<HTMLDivElement>(null);
  const panSessionRef = useRef<RelationshipPanSession | null>(null);
  const [focusedNodePath, setFocusedNodePath] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [viewportTransform, setViewportTransform, restoredViewport] = useRetainedEditorViewState<RelationshipViewportTransform>("context-map:radial", {
    x: 0,
    y: 0,
    scale: 1,
  });
  useContextMapWheelNavigation({
    canvasRef,
    centeredFocalPoint: true,
    minimumScale: 0.08,
    setViewportTransform,
  });
  const layout = useMemo(() => buildRadialRelationshipSceneLayout({
    childrenByFolderPath: graph.childrenByFolderPath,
    expandedFolderPaths,
    root: graph.folder,
    rootNodes: graph.rootNodes,
  }), [expandedFolderPaths, graph.childrenByFolderPath, graph.folder, graph.rootNodes]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const previousLayoutRef = useRef(layout);
  const hierarchyLines = useMemo<readonly RadialHierarchyLine[]>(() => {
    const routableEdges = layout.hierarchyEdges.flatMap((edge) => {
      const source = layout.positions.get(edge.sourceId);
      const target = layout.positions.get(edge.targetId);
      if (!source || !target) return [];
      return [{
        edge,
        input: {
          center: layout.center,
          id: `${edge.sourceId}\u0000${edge.targetId}`,
          source: { angle: source.angle, radius: source.radius },
          target: { angle: target.angle, radius: target.radius },
        },
      }];
    });
    const routes = routeRadialHierarchyRelationships(routableEdges.map(({ input }) => input));
    return routes.map((route, index) => ({
      ...routableEdges[index].edge,
      path: route.path,
    }));
  }, [layout]);
  const referenceLines = useMemo<readonly RelationshipLine[]>(() => edges.flatMap((edge) => {
    if (!isContextMapReferenceVisible(edge, lineFilters)) return [];
    const source = layout.positions.get(edge.sourceId);
    const target = layout.positions.get(edge.targetId);
    if (!source || !target) return [];
    return [{
      ...edge,
      path: routeRadialReferenceRelationship(source, target, layout.center),
    }];
  }), [edges, layout, lineFilters]);
  const connectedNodePaths = useMemo(() => {
    const connected = new Set<string>();
    if (!focusedNodePath) return connected;
    connected.add(focusedNodePath);
    for (const edge of [...hierarchyLines, ...referenceLines]) {
      if (edge.sourceId !== focusedNodePath && edge.targetId !== focusedNodePath) continue;
      connected.add(edge.sourceId);
      connected.add(edge.targetId);
    }
    return connected;
  }, [focusedNodePath, hierarchyLines, referenceLines]);

  const fitCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setViewportTransform(getRadialFitViewport(canvas, layoutRef.current));
  }, [setViewportTransform]);

  useLayoutEffect(() => {
    if (!restoredViewport) fitCanvas();
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let initialObservation = true;
    const observer = new ResizeObserver(() => {
      if (initialObservation) { initialObservation = false; return; }
      fitCanvas();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [fitCanvas, restoredViewport]);

  useLayoutEffect(() => {
    if (previousLayoutRef.current === layout) return;
    previousLayoutRef.current = layout;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fittedViewport = getRadialFitViewport(canvas, layout);
    setViewportTransform((current) => ({
      ...current,
      scale: fittedViewport.scale,
    }));
  }, [layout, setViewportTransform]);

  const startCanvasPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || panSessionRef.current) return;
    const target = event.target;
    if (target instanceof Element && target.closest(".folder-relationship-radial-node")) return;
    const captureElement = event.currentTarget;
    panSessionRef.current = {
      captureElement,
      origin: { x: viewportTransform.x, y: viewportTransform.y },
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    try {
      captureElement.setPointerCapture(event.pointerId);
    } catch {
      panSessionRef.current = null;
      return;
    }
    setPanning(true);
    setFocusedNodePath(null);
    event.preventDefault();
  }, [viewportTransform.x, viewportTransform.y]);

  const moveCanvasPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const session = panSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    setViewportTransform((current) => ({
      ...current,
      x: session.origin.x + event.clientX - session.startX,
      y: session.origin.y + event.clientY - session.startY,
    }));
    event.preventDefault();
  }, [setViewportTransform]);

  const finishCanvasPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const session = panSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    try {
      if (session.captureElement.hasPointerCapture(event.pointerId)) {
        session.captureElement.releasePointerCapture(event.pointerId);
      }
    } catch {
      // The pointer may already have been released by the browser.
    }
    panSessionRef.current = null;
    setPanning(false);
  }, []);

  return (
    <div
      className="folder-relationship-canvas folder-relationship-radial-canvas"
      data-panning={panning ? "true" : undefined}
      ref={canvasRef}
      style={{
        "--relationship-grid-offset-x": `${viewportTransform.x + 4}px`,
        "--relationship-grid-offset-y": `${viewportTransform.y + 4}px`,
        "--relationship-grid-size": `${22 * viewportTransform.scale}px`,
      } as CSSProperties}
      onDoubleClick={(event) => {
        const target = event.target;
        if (!(target instanceof Element) || !target.closest(".folder-relationship-radial-node")) {
          fitCanvas();
        }
      }}
      onPointerCancel={finishCanvasPan}
      onPointerDown={startCanvasPan}
      onPointerLeave={() => {
        if (!panning) setFocusedNodePath(null);
      }}
      onPointerMove={moveCanvasPan}
      onPointerUp={finishCanvasPan}
    >
      <div
        className="folder-relationship-radial-world"
        style={{
          height: `${layout.height}px`,
          left: "50%",
          top: "50%",
          transform: `translate3d(${viewportTransform.x - layout.width / 2}px, ${viewportTransform.y - layout.height / 2}px, 0) scale(${viewportTransform.scale})`,
          transformOrigin: `${layout.center.x}px ${layout.center.y}px`,
          width: `${layout.width}px`,
        }}
      >
        <svg
          aria-hidden="true"
          className="folder-relationship-radial-lines"
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width}
        >
          <defs>
            <ContextMapReferenceArrowMarker id={referenceArrowId} />
          </defs>
          <g className="folder-relationship-radial-references">
            {referenceLines.map((line) => {
              const focused = Boolean(focusedNodePath && (
                  line.sourceId === focusedNodePath || line.targetId === focusedNodePath
              ));
              return (
                <path
                  d={line.path}
                  data-bidirectional={line.bidirectional ? "true" : undefined}
                  data-focused={focused ? "true" : undefined}
                  key={`${line.sourceId}:${line.targetId}`}
                  markerEnd={focused ? referenceArrowUrl : undefined}
                  markerStart={focused && line.bidirectional ? referenceArrowUrl : undefined}
                />
              );
            })}
          </g>
          <g className="folder-relationship-radial-hierarchy">
            {hierarchyLines.map((line) => (
              <path
                d={line.path}
                data-focused={focusedNodePath && (
                  line.sourceId === focusedNodePath || line.targetId === focusedNodePath
                ) ? "true" : undefined}
                key={`${line.sourceId}:${line.targetId}`}
              />
            ))}
          </g>
        </svg>
        {layout.nodes.map((entry) => (
          <RadialRelationshipNode
            connectedNodePaths={connectedNodePaths}
            entry={entry}
            expandedFolderPaths={expandedFolderPaths}
            fileIconTheme={fileIconTheme}
            focusedNodePath={focusedNodePath}
            key={entry.node.path || graph.folder.id}
            onFocusNode={setFocusedNodePath}
            onToggleFolder={onToggleFolder}
          />
        ))}
      </div>
    </div>
  );
}

function getRadialVisibleBounds(
  nodes: ReturnType<typeof buildRadialRelationshipSceneLayout>["nodes"],
  fallbackCenter: Readonly<{ x: number; y: number }>,
): Readonly<{
  center: Readonly<{ x: number; y: number }>;
  height: number;
  width: number;
}> {
  if (nodes.length === 0) {
    return { center: fallbackCenter, height: 240, width: 240 };
  }
  const padding = 118;
  const minimumX = Math.min(...nodes.map((entry) => entry.x)) - padding;
  const maximumX = Math.max(...nodes.map((entry) => entry.x)) + padding;
  const minimumY = Math.min(...nodes.map((entry) => entry.y)) - padding;
  const maximumY = Math.max(...nodes.map((entry) => entry.y)) + padding;
  return {
    center: {
      x: (minimumX + maximumX) / 2,
      y: (minimumY + maximumY) / 2,
    },
    height: Math.max(240, maximumY - minimumY),
    width: Math.max(240, maximumX - minimumX),
  };
}

function getRadialFitViewport(
  canvas: HTMLDivElement,
  layout: ReturnType<typeof buildRadialRelationshipSceneLayout>,
): RelationshipViewportTransform {
  const bounds = canvas.getBoundingClientRect();
  const availableWidth = Math.max(1, bounds.width - 80);
  const availableHeight = Math.max(1, bounds.height - 80);
  const visibleBounds = getRadialVisibleBounds(layout.nodes, layout.center);
  const scale = Math.min(1, Math.max(
    0.08,
    Math.min(
      availableWidth / visibleBounds.width,
      availableHeight / visibleBounds.height,
    ),
  ));
  return {
    x: (layout.center.x - visibleBounds.center.x) * scale,
    y: (layout.center.y - visibleBounds.center.y) * scale,
    scale,
  };
}

function RadialRelationshipNode({
  connectedNodePaths,
  entry,
  expandedFolderPaths,
  fileIconTheme,
  focusedNodePath,
  onFocusNode,
  onToggleFolder,
}: Readonly<{
  connectedNodePaths: ReadonlySet<string>;
  entry: ReturnType<typeof buildRadialRelationshipSceneLayout>["nodes"][number];
  expandedFolderPaths: ReadonlySet<string>;
  fileIconTheme: FileIconThemeId;
  focusedNodePath: string | null;
  onFocusNode: (path: string | null) => void;
  onToggleFolder: (node: DataNode) => void;
}>) {
  const { t } = useLocalization();
  const isRoot = entry.depth === 0;
  const isFolder = entry.node.type === "folder";
  const expanded = isFolder && expandedFolderPaths.has(entry.node.path);
  const content = (
    <span className="folder-relationship-card-hitarea">
      <span className="folder-relationship-card-icon" aria-hidden="true">
        <FileGlyphIcon
          name={entry.node.name}
          type={entry.node.type}
          size={isRoot ? 30 : 24}
          theme={fileIconTheme}
        />
      </span>
      <span className="folder-relationship-card-copy">
        <strong>{entry.node.name}</strong>
      </span>
    </span>
  );
  const interactionProps = {
    "data-expanded": expanded ? "true" : undefined,
    "data-focused": focusedNodePath === entry.node.path ? "true" : undefined,
    "data-folder": isFolder ? "true" : undefined,
    "data-node-path": entry.node.path,
    "data-related": focusedNodePath && focusedNodePath !== entry.node.path
      && connectedNodePaths.has(entry.node.path) ? "true" : undefined,
    "data-root": isRoot ? "true" : undefined,
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => event.stopPropagation(),
    onPointerEnter: () => onFocusNode(entry.node.path),
    onPointerLeave: () => onFocusNode(null),
    style: { left: `${entry.x}px`, top: `${entry.y}px` },
  } as const;

  if (isFolder && !isRoot) {
    return (
      <button
        className="folder-relationship-card folder-relationship-radial-node"
        {...interactionProps}
        title={t(expanded
          ? "workspace.relationships.collapseFolder"
          : "workspace.relationships.expandFolder", { name: entry.node.name })}
        type="button"
        onClick={() => onToggleFolder(entry.node)}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className="folder-relationship-card folder-relationship-radial-node"
      {...interactionProps}
      title={entry.node.name}
    >
      {content}
    </div>
  );
}

function LayeredRelationshipCanvas({
  edges,
  expandedFolderPaths,
  fileIconTheme,
  graph,
  lineFilters,
  onToggleFolder,
}: Readonly<{
  edges: readonly FolderRelationshipEdge[];
  expandedFolderPaths: ReadonlySet<string>;
  fileIconTheme: FileIconThemeId;
  graph: FolderRelationshipGraph;
  lineFilters: ContextMapLineFilterState;
  onToggleFolder: (node: DataNode) => void;
}>) {
  const referenceArrowId = `context-map-layered-reference-arrow-${useId().replaceAll(":", "")}`;
  const referenceArrowUrl = `url(#${referenceArrowId})`;
  const canvasRef = useRef<HTMLDivElement>(null);
  const panSessionRef = useRef<RelationshipPanSession | null>(null);
  const [focusedNodePath, setFocusedNodePath] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [viewportTransform, setViewportTransform, restoredViewport] = useRetainedEditorViewState<RelationshipViewportTransform>("context-map:layered", {
    x: 0,
    y: 0,
    scale: 1,
  });
  useContextMapWheelNavigation({
    canvasRef,
    centeredFocalPoint: true,
    minimumScale: 0.08,
    setViewportTransform,
  });
  const layout = useMemo(() => buildLayeredRelationshipSceneLayout({
    childrenByFolderPath: graph.childrenByFolderPath,
    expandedFolderPaths,
    root: graph.folder,
    rootNodes: graph.rootNodes,
  }), [expandedFolderPaths, graph.childrenByFolderPath, graph.folder, graph.rootNodes]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const previousLayoutRef = useRef(layout);
  const hierarchyLines = useMemo<readonly RadialHierarchyLine[]>(() => {
    const routableEdges = layout.hierarchyEdges.flatMap((edge) => {
      const source = layout.positions.get(edge.sourceId);
      const target = layout.positions.get(edge.targetId);
      if (!source || !target) return [];
      return [{
        edge,
        input: {
          id: `${edge.sourceId}\u0000${edge.targetId}`,
          source: {
            inset: source.depth === 0 ? 38 : 18,
            x: source.x,
            y: source.y,
          },
          target: { inset: 18, x: target.x, y: target.y },
        },
      }];
    });
    const routes = routeLayeredHierarchyRelationships(routableEdges.map(({ input }) => input));
    return routes.map((route, index) => ({
      ...routableEdges[index].edge,
      path: route.path,
    }));
  }, [layout]);
  const referenceLines = useMemo<readonly RelationshipLine[]>(() => edges.flatMap((edge) => {
    if (!isContextMapReferenceVisible(edge, lineFilters)) return [];
    const source = layout.positions.get(edge.sourceId);
    const target = layout.positions.get(edge.targetId);
    if (!source || !target) return [];
    return [{
      ...edge,
      path: routeLayeredReferenceRelationship(source, target),
    }];
  }), [edges, layout, lineFilters]);
  const connectedNodePaths = useMemo(() => {
    const connected = new Set<string>();
    if (!focusedNodePath) return connected;
    connected.add(focusedNodePath);
    for (const edge of [...hierarchyLines, ...referenceLines]) {
      if (edge.sourceId !== focusedNodePath && edge.targetId !== focusedNodePath) continue;
      connected.add(edge.sourceId);
      connected.add(edge.targetId);
    }
    return connected;
  }, [focusedNodePath, hierarchyLines, referenceLines]);

  const fitCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setViewportTransform(getLayeredFitViewport(canvas, layoutRef.current));
  }, [setViewportTransform]);

  useLayoutEffect(() => {
    if (!restoredViewport) fitCanvas();
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let initialObservation = true;
    const observer = new ResizeObserver(() => {
      if (initialObservation) { initialObservation = false; return; }
      fitCanvas();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [fitCanvas, restoredViewport]);

  useLayoutEffect(() => {
    if (previousLayoutRef.current === layout) return;
    previousLayoutRef.current = layout;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fittedViewport = getLayeredFitViewport(canvas, layout);
    setViewportTransform((current) => ({
      ...current,
      scale: fittedViewport.scale,
    }));
  }, [layout, setViewportTransform]);

  const startCanvasPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || panSessionRef.current) return;
    const target = event.target;
    if (target instanceof Element && target.closest(".folder-relationship-layered-node")) return;
    const captureElement = event.currentTarget;
    panSessionRef.current = {
      captureElement,
      origin: { x: viewportTransform.x, y: viewportTransform.y },
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    try {
      captureElement.setPointerCapture(event.pointerId);
    } catch {
      panSessionRef.current = null;
      return;
    }
    setPanning(true);
    setFocusedNodePath(null);
    event.preventDefault();
  }, [viewportTransform.x, viewportTransform.y]);

  const moveCanvasPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const session = panSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    setViewportTransform((current) => ({
      ...current,
      x: session.origin.x + event.clientX - session.startX,
      y: session.origin.y + event.clientY - session.startY,
    }));
    event.preventDefault();
  }, [setViewportTransform]);

  const finishCanvasPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const session = panSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    try {
      if (session.captureElement.hasPointerCapture(event.pointerId)) {
        session.captureElement.releasePointerCapture(event.pointerId);
      }
    } catch {
      // The pointer may already have been released by the browser.
    }
    panSessionRef.current = null;
    setPanning(false);
  }, []);

  return (
    <div
      className="folder-relationship-canvas folder-relationship-layered-canvas"
      data-panning={panning ? "true" : undefined}
      ref={canvasRef}
      style={{
        "--relationship-grid-offset-x": `${viewportTransform.x + 4}px`,
        "--relationship-grid-offset-y": `${viewportTransform.y + 4}px`,
        "--relationship-grid-size": `${22 * viewportTransform.scale}px`,
      } as CSSProperties}
      onDoubleClick={(event) => {
        const target = event.target;
        if (!(target instanceof Element) || !target.closest(".folder-relationship-layered-node")) {
          fitCanvas();
        }
      }}
      onPointerCancel={finishCanvasPan}
      onPointerDown={startCanvasPan}
      onPointerLeave={() => {
        if (!panning) setFocusedNodePath(null);
      }}
      onPointerMove={moveCanvasPan}
      onPointerUp={finishCanvasPan}
    >
      <div
        className="folder-relationship-layered-world"
        style={{
          height: `${layout.height}px`,
          left: "50%",
          top: "50%",
          transform: `translate3d(${viewportTransform.x - layout.anchor.x}px, ${viewportTransform.y - layout.anchor.y}px, 0) scale(${viewportTransform.scale})`,
          transformOrigin: `${layout.anchor.x}px ${layout.anchor.y}px`,
          width: `${layout.width}px`,
        }}
      >
        <svg
          aria-hidden="true"
          className="folder-relationship-layered-lines"
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width}
        >
          <defs>
            <ContextMapReferenceArrowMarker id={referenceArrowId} />
          </defs>
          <g className="folder-relationship-layered-references">
            {referenceLines.map((line) => {
              const focused = Boolean(focusedNodePath && (
                  line.sourceId === focusedNodePath || line.targetId === focusedNodePath
              ));
              return (
                <path
                  d={line.path}
                  data-bidirectional={line.bidirectional ? "true" : undefined}
                  data-focused={focused ? "true" : undefined}
                  key={`${line.sourceId}:${line.targetId}`}
                  markerEnd={focused ? referenceArrowUrl : undefined}
                  markerStart={focused && line.bidirectional ? referenceArrowUrl : undefined}
                />
              );
            })}
          </g>
          <g className="folder-relationship-layered-hierarchy">
            {hierarchyLines.map((line) => (
              <path
                d={line.path}
                data-focused={focusedNodePath && (
                  line.sourceId === focusedNodePath || line.targetId === focusedNodePath
                ) ? "true" : undefined}
                key={`${line.sourceId}:${line.targetId}`}
              />
            ))}
          </g>
        </svg>
        {layout.nodes.map((entry) => (
          <LayeredRelationshipNode
            connectedNodePaths={connectedNodePaths}
            entry={entry}
            expandedFolderPaths={expandedFolderPaths}
            fileIconTheme={fileIconTheme}
            focusedNodePath={focusedNodePath}
            key={entry.node.path || graph.folder.id}
            onFocusNode={setFocusedNodePath}
            onToggleFolder={onToggleFolder}
          />
        ))}
      </div>
    </div>
  );
}

function getLayeredVisibleBounds(
  nodes: ReturnType<typeof buildLayeredRelationshipSceneLayout>["nodes"],
  fallbackAnchor: Readonly<{ x: number; y: number }>,
): Readonly<{
  center: Readonly<{ x: number; y: number }>;
  height: number;
  width: number;
}> {
  if (nodes.length === 0) {
    return { center: fallbackAnchor, height: 240, width: 240 };
  }
  const horizontalPadding = 118;
  const verticalPadding = 88;
  const minimumX = Math.min(...nodes.map((entry) => entry.x)) - horizontalPadding;
  const maximumX = Math.max(...nodes.map((entry) => entry.x)) + horizontalPadding;
  const minimumY = Math.min(...nodes.map((entry) => entry.y)) - verticalPadding;
  const maximumY = Math.max(...nodes.map((entry) => entry.y)) + verticalPadding;
  return {
    center: {
      x: (minimumX + maximumX) / 2,
      y: (minimumY + maximumY) / 2,
    },
    height: Math.max(240, maximumY - minimumY),
    width: Math.max(240, maximumX - minimumX),
  };
}

function getLayeredFitViewport(
  canvas: HTMLDivElement,
  layout: ReturnType<typeof buildLayeredRelationshipSceneLayout>,
): RelationshipViewportTransform {
  const bounds = canvas.getBoundingClientRect();
  const availableWidth = Math.max(1, bounds.width - 80);
  const availableHeight = Math.max(1, bounds.height - 80);
  const visibleBounds = getLayeredVisibleBounds(layout.nodes, layout.anchor);
  const scale = Math.min(1, Math.max(
    0.08,
    Math.min(
      availableWidth / visibleBounds.width,
      availableHeight / visibleBounds.height,
    ),
  ));
  return {
    x: (layout.anchor.x - visibleBounds.center.x) * scale,
    y: (layout.anchor.y - visibleBounds.center.y) * scale,
    scale,
  };
}

function LayeredRelationshipNode({
  connectedNodePaths,
  entry,
  expandedFolderPaths,
  fileIconTheme,
  focusedNodePath,
  onFocusNode,
  onToggleFolder,
}: Readonly<{
  connectedNodePaths: ReadonlySet<string>;
  entry: ReturnType<typeof buildLayeredRelationshipSceneLayout>["nodes"][number];
  expandedFolderPaths: ReadonlySet<string>;
  fileIconTheme: FileIconThemeId;
  focusedNodePath: string | null;
  onFocusNode: (path: string | null) => void;
  onToggleFolder: (node: DataNode) => void;
}>) {
  const { t } = useLocalization();
  const isRoot = entry.depth === 0;
  const isFolder = entry.node.type === "folder";
  const expanded = isFolder && expandedFolderPaths.has(entry.node.path);
  const content = (
    <span className="folder-relationship-card-hitarea">
      <span className="folder-relationship-card-icon" aria-hidden="true">
        <FileGlyphIcon
          name={entry.node.name}
          type={entry.node.type}
          size={isRoot ? 30 : 24}
          theme={fileIconTheme}
        />
      </span>
      <span className="folder-relationship-card-copy">
        <strong>{entry.node.name}</strong>
      </span>
    </span>
  );
  const interactionProps = {
    "data-expanded": expanded ? "true" : undefined,
    "data-focused": focusedNodePath === entry.node.path ? "true" : undefined,
    "data-folder": isFolder ? "true" : undefined,
    "data-node-path": entry.node.path,
    "data-related": focusedNodePath && focusedNodePath !== entry.node.path
      && connectedNodePaths.has(entry.node.path) ? "true" : undefined,
    "data-root": isRoot ? "true" : undefined,
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => event.stopPropagation(),
    onPointerEnter: () => onFocusNode(entry.node.path),
    onPointerLeave: () => onFocusNode(null),
    style: { left: `${entry.x}px`, top: `${entry.y}px` },
  } as const;

  if (isFolder && !isRoot) {
    return (
      <button
        className="folder-relationship-card folder-relationship-layered-node"
        {...interactionProps}
        title={t(expanded
          ? "workspace.relationships.collapseFolder"
          : "workspace.relationships.expandFolder", { name: entry.node.name })}
        type="button"
        onClick={() => onToggleFolder(entry.node)}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className="folder-relationship-card folder-relationship-layered-node"
      {...interactionProps}
      title={entry.node.name}
    >
      {content}
    </div>
  );
}

function RelationshipCanvas({
  edges,
  expandedFolderPaths,
  fileIconTheme,
  graph,
  lineFilters,
  manualOffsetsByNode,
  relationshipCountByNode,
  onManualOffsetsChange,
  onToggleFolder,
}: {
  edges: readonly FolderRelationshipEdge[];
  expandedFolderPaths: ReadonlySet<string>;
  fileIconTheme: FileIconThemeId;
  graph: FolderRelationshipGraph;
  lineFilters: ContextMapLineFilterState;
  manualOffsetsByNode: ReadonlyMap<string, RelationshipLayoutOffset>;
  relationshipCountByNode: ReadonlyMap<string, number>;
  onManualOffsetsChange: (
    offsets: ReadonlyMap<string, RelationshipLayoutOffset>,
  ) => void;
  onToggleFolder: (node: DataNode) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const cardElementsRef = useRef(new Map<string, HTMLElement>());
  const dragSessionRef = useRef<RelationshipDragSession | null>(null);
  const geometryFrameRef = useRef<number | null>(null);
  const layoutAnimationFrameRef = useRef<number | null>(null);
  const panSessionRef = useRef<RelationshipPanSession | null>(null);
  const suppressedClickPathRef = useRef<string | null>(null);
  const [lines, setLines] = useState<RelationshipLine[]>([]);
  const [focusedNodePath, setFocusedNodePath] = useState<string | null>(null);
  const [draggingNodePath, setDraggingNodePath] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [viewportTransform, setViewportTransform] = useRetainedEditorViewState<RelationshipViewportTransform>("context-map:canvas", {
    x: 0,
    y: 0,
    scale: 1,
  });
  useContextMapWheelNavigation({
    canvasRef,
    centeredFocalPoint: false,
    minimumScale: 0.35,
    setViewportTransform,
  });
  const [rootSceneLayout, setRootSceneLayout] = useState<RelationshipSceneLayout>(() => (
    buildFolderRelationshipSceneLayout({
      childrenByFolderPath: graph.childrenByFolderPath,
      edges,
      expandedFolderPaths,
      nodes: graph.rootNodes,
      relationshipCountByNode,
    })
  ));
  const manualOffsetsRef = useRef(manualOffsetsByNode);
  manualOffsetsRef.current = manualOffsetsByNode;
  const viewportScaleRef = useRef(viewportTransform.scale);
  viewportScaleRef.current = viewportTransform.scale;
  const visibleEdges = useMemo(
    () => edges.filter((edge) => isContextMapReferenceVisible(edge, lineFilters)),
    [edges, lineFilters],
  );
  const connectedNodePaths = useMemo(() => {
    const connected = new Set<string>();
    if (!focusedNodePath) return connected;
    connected.add(focusedNodePath);
    for (const edge of visibleEdges) {
      if (edge.sourceId !== focusedNodePath && edge.targetId !== focusedNodePath) continue;
      connected.add(edge.sourceId);
      connected.add(edge.targetId);
    }
    return connected;
  }, [focusedNodePath, visibleEdges]);

  const updateSceneGeometry = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const worldBounds = world.getBoundingClientRect();
    const activeNodePath = dragSessionRef.current?.nodePath ?? null;
    const edgesToRoute = activeNodePath
      ? visibleEdges.filter((edge) => isRelationshipEdgeAffectedByNode(edge, activeNodePath))
      : visibleEdges;
    const routableEdges = edgesToRoute.flatMap((edge) => {
      const source = cardElementsRef.current.get(edge.sourceId);
      const target = cardElementsRef.current.get(edge.targetId);
      if (!source || !target) return [];
      const sourceGlyph = source.querySelector<SVGGraphicsElement>(
        ".folder-relationship-card-icon svg > :first-child",
      ) ?? source.querySelector<SVGSVGElement>(".folder-relationship-card-icon svg");
      const targetGlyph = target.querySelector<SVGGraphicsElement>(
        ".folder-relationship-card-icon svg > :first-child",
      ) ?? target.querySelector<SVGSVGElement>(".folder-relationship-card-icon svg");
      return [{
        edge,
        input: {
          id: `${edge.sourceId}\u0000${edge.targetId}`,
          source: toRelationshipRouteRect(
            sourceGlyph?.getBoundingClientRect() ?? source.getBoundingClientRect(),
            worldBounds,
            viewportScaleRef.current,
          ),
          sourceId: edge.sourceId,
          target: toRelationshipRouteRect(
            targetGlyph?.getBoundingClientRect() ?? target.getBoundingClientRect(),
            worldBounds,
            viewportScaleRef.current,
          ),
          targetId: edge.targetId,
        },
      }];
    });
    const routes = routeStraightRelationships(routableEdges.map(({ input }) => input));
    const nextLines = routes.map((route, index) => ({
      ...routableEdges[index].edge,
      path: route.path,
    }));
    if (activeNodePath) {
      const pathByEdge = new Map(nextLines.map((line) => [
        `${line.sourceId}\u0000${line.targetId}`,
        line.path,
      ] as const));
      for (const edgeElement of world.querySelectorAll<SVGGElement>(
        ".folder-relationship-edge",
      )) {
        const path = pathByEdge.get(
          `${edgeElement.dataset.sourceId ?? ""}\u0000${edgeElement.dataset.targetId ?? ""}`,
        );
        if (path) edgeElement.querySelector("path")?.setAttribute("d", path);
      }
      return;
    }
    setLines(nextLines);
  }, [visibleEdges]);

  const scheduleSceneGeometryUpdate = useCallback(() => {
    if (geometryFrameRef.current !== null) return;
    geometryFrameRef.current = window.requestAnimationFrame(() => {
      geometryFrameRef.current = null;
      updateSceneGeometry();
    });
  }, [updateSceneGeometry]);

  useEffect(() => () => {
    if (geometryFrameRef.current !== null) {
      window.cancelAnimationFrame(geometryFrameRef.current);
    }
    if (layoutAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(layoutAnimationFrameRef.current);
    }
  }, []);

  useLayoutEffect(() => {
    updateSceneGeometry();
    const observer = new ResizeObserver(updateSceneGeometry);
    if (worldRef.current) observer.observe(worldRef.current);
    for (const element of cardElementsRef.current.values()) observer.observe(element);
    for (const element of worldRef.current?.querySelectorAll<HTMLElement>(
      ".folder-relationship-group",
    ) ?? []) observer.observe(element);
    return () => observer.disconnect();
  }, [expandedFolderPaths, graph.rootNodes, updateSceneGeometry]);

  useLayoutEffect(() => {
    updateSceneGeometry();
  }, [draggingNodePath, manualOffsetsByNode, rootSceneLayout, updateSceneGeometry]);

  useLayoutEffect(() => {
    if (visibleEdges.length > 250) return undefined;
    const startTime = performance.now();
    const updateDuringLayoutTransition = (time: number): void => {
      updateSceneGeometry();
      if (time - startTime < 240) {
        layoutAnimationFrameRef.current = window.requestAnimationFrame(
          updateDuringLayoutTransition,
        );
      } else {
        layoutAnimationFrameRef.current = null;
      }
    };
    layoutAnimationFrameRef.current = window.requestAnimationFrame(updateDuringLayoutTransition);
    return () => {
      if (layoutAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(layoutAnimationFrameRef.current);
        layoutAnimationFrameRef.current = null;
      }
    };
  }, [rootSceneLayout, updateSceneGeometry, visibleEdges.length]);

  useLayoutEffect(() => {
    setRootSceneLayout((current) => buildFolderRelationshipSceneLayout({
      childrenByFolderPath: graph.childrenByFolderPath,
      edges,
      expandedFolderPaths,
      manualOffsetsByNode: manualOffsetsRef.current,
      nodes: graph.rootNodes,
      pinnedNodePaths: new Set(manualOffsetsRef.current.keys()),
      previousPositions: current.positions,
      relationshipCountByNode,
    }));
  }, [
    edges,
    expandedFolderPaths,
    graph.childrenByFolderPath,
    graph.rootNodes,
    relationshipCountByNode,
  ]);

  const startNodeDrag = useCallback((
    nodePath: string,
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (
      event.button !== 0
      || !event.isPrimary
      || dragSessionRef.current
      || panSessionRef.current
    ) return;
    const world = worldRef.current;
    const captureElement = event.currentTarget;
    const slot = captureElement.closest<HTMLElement>(".folder-relationship-layout-slot");
    if (!world || !slot) return;
    const containingGroup = slot.parentElement?.closest<HTMLElement>(
      ".folder-relationship-group",
    ) ?? null;
    const origin = manualOffsetsByNode.get(nodePath) ?? { x: 0, y: 0 };
    dragSessionRef.current = {
      captureElement,
      latestOffset: origin,
      limits: containingGroup
        ? createRelationshipDragLimits(
          slot.getBoundingClientRect(),
          containingGroup.getBoundingClientRect(),
          origin,
          44,
          viewportScaleRef.current,
        )
        : null,
      moved: false,
      nodePath,
      origin,
      pointerId: event.pointerId,
      slotElement: slot,
      startX: event.clientX,
      startY: event.clientY,
    };
    try {
      captureElement.setPointerCapture(event.pointerId);
    } catch {
      dragSessionRef.current = null;
      return;
    }
    setDraggingNodePath(nodePath);
    setFocusedNodePath(null);
  }, [manualOffsetsByNode]);

  const moveNodeDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const session = dragSessionRef.current;
    if (
      !session
      || session.pointerId !== event.pointerId
      || session.captureElement !== event.currentTarget
    ) return;
    const delta = {
      x: (event.clientX - session.startX) / viewportScaleRef.current,
      y: (event.clientY - session.startY) / viewportScaleRef.current,
    };
    if (!session.moved && Math.hypot(delta.x, delta.y) < 3) return;
    session.moved = true;
    const nextOffset = getDraggedRelationshipOffset(session.origin, delta, session.limits);
    session.latestOffset = nextOffset;
    session.slotElement.style.setProperty("--relationship-manual-x", `${nextOffset.x}px`);
    session.slotElement.style.setProperty("--relationship-manual-y", `${nextOffset.y}px`);
    scheduleSceneGeometryUpdate();
    event.preventDefault();
  }, [scheduleSceneGeometryUpdate]);

  const finishNodeDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const session = dragSessionRef.current;
    if (
      !session
      || session.pointerId !== event.pointerId
      || session.captureElement !== event.currentTarget
    ) return;
    if (session.moved) {
      suppressedClickPathRef.current = session.nodePath;
      window.setTimeout(() => {
        if (suppressedClickPathRef.current === session.nodePath) {
          suppressedClickPathRef.current = null;
        }
      }, 0);
      event.preventDefault();
    }
    try {
      if (session.captureElement.hasPointerCapture(event.pointerId)) {
        session.captureElement.releasePointerCapture(event.pointerId);
      }
    } catch {
      // The pointer may already have been released by the browser.
    }
    dragSessionRef.current = null;
    if (session.moved) {
      const next = new Map(manualOffsetsRef.current);
      next.set(session.nodePath, session.latestOffset);
      onManualOffsetsChange(next);
    }
    setDraggingNodePath(null);
    const hoveredCard = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(
      ".folder-relationship-card",
    );
    setFocusedNodePath(hoveredCard?.dataset.nodePath ?? null);
  }, [onManualOffsetsChange]);

  const consumeDraggedNodeClick = useCallback((nodePath: string) => {
    if (suppressedClickPathRef.current !== nodePath) return false;
    suppressedClickPathRef.current = null;
    return true;
  }, []);

  const dragController = useMemo<RelationshipDragController>(() => ({
    consumeClick: consumeDraggedNodeClick,
    draggingNodePath,
    finish: finishNodeDrag,
    move: moveNodeDrag,
    offsets: manualOffsetsByNode,
    start: startNodeDrag,
  }), [
    consumeDraggedNodeClick,
    draggingNodePath,
    finishNodeDrag,
    manualOffsetsByNode,
    moveNodeDrag,
    startNodeDrag,
  ]);

  const startCanvasPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      event.button !== 0
      || !event.isPrimary
      || dragSessionRef.current
      || panSessionRef.current
    ) return;
    const captureElement = event.currentTarget;
    panSessionRef.current = {
      captureElement,
      origin: { x: viewportTransform.x, y: viewportTransform.y },
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    try {
      captureElement.setPointerCapture(event.pointerId);
    } catch {
      panSessionRef.current = null;
      return;
    }
    setPanning(true);
    setFocusedNodePath(null);
    event.preventDefault();
  }, [viewportTransform.x, viewportTransform.y]);

  const moveCanvasPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const session = panSessionRef.current;
    if (
      !session
      || session.pointerId !== event.pointerId
      || session.captureElement !== event.currentTarget
    ) return;
    setViewportTransform((current) => ({
      ...current,
      x: session.origin.x + event.clientX - session.startX,
      y: session.origin.y + event.clientY - session.startY,
    }));
    event.preventDefault();
  }, [setViewportTransform]);

  const finishCanvasPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const session = panSessionRef.current;
    if (
      !session
      || session.pointerId !== event.pointerId
      || session.captureElement !== event.currentTarget
    ) return;
    try {
      if (session.captureElement.hasPointerCapture(event.pointerId)) {
        session.captureElement.releasePointerCapture(event.pointerId);
      }
    } catch {
      // The pointer may already have been released by the browser.
    }
    panSessionRef.current = null;
    setPanning(false);
  }, []);

  const resetCanvasViewport = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof Element && target.closest(
      ".folder-relationship-card, .folder-relationship-group",
    )) return;
    setViewportTransform({ x: 0, y: 0, scale: 1 });
  }, [setViewportTransform]);

  const registerCard = useCallback((nodePath: string): RefCallback<HTMLElement> => (
    element,
  ) => {
    if (element) cardElementsRef.current.set(nodePath, element);
    else cardElementsRef.current.delete(nodePath);
  }, []);

  const focusNode = useCallback((nodePath: string | null) => {
    if (!dragSessionRef.current) setFocusedNodePath(nodePath);
  }, []);

  return (
    <div
      className="folder-relationship-canvas"
      data-panning={panning ? "true" : undefined}
      ref={canvasRef}
      style={{
        "--relationship-grid-offset-x": `${viewportTransform.x + 4}px`,
        "--relationship-grid-offset-y": `${viewportTransform.y + 4}px`,
        "--relationship-grid-size": `${22 * viewportTransform.scale}px`,
      } as CSSProperties}
      onDoubleClick={resetCanvasViewport}
      onPointerCancel={finishCanvasPan}
      onPointerDown={startCanvasPan}
      onPointerLeave={() => {
        if (!panning && !draggingNodePath) setFocusedNodePath(null);
      }}
      onPointerMove={moveCanvasPan}
      onPointerUp={finishCanvasPan}
    >
      <div
        className="folder-relationship-world"
        ref={worldRef}
        style={{
          transform: `translate3d(${viewportTransform.x}px, ${viewportTransform.y}px, 0) scale(${viewportTransform.scale})`,
        }}
      >
        <svg className="folder-relationship-lines" aria-hidden="true">
          {lines.map((line) => (
            <g
              key={`${line.sourceId}:${line.targetId}`}
              className="folder-relationship-edge"
              data-source-id={line.sourceId}
              data-target-id={line.targetId}
              data-focused={focusedNodePath && (
                line.sourceId === focusedNodePath || line.targetId === focusedNodePath
              ) ? "true" : undefined}
              data-bidirectional={line.bidirectional ? "true" : undefined}
              style={{ "--relationship-strength": Math.min(3, 1 + Math.log2(line.count)) } as CSSProperties}
            >
              <path
                className="folder-relationship-line-core"
                d={line.path}
              />
            </g>
          ))}
        </svg>
        <RelationshipNodeLayout
          className="folder-relationship-grid"
          connectedNodePaths={connectedNodePaths}
          depth={0}
          dragController={dragController}
          edges={edges}
          expandedFolderPaths={expandedFolderPaths}
          fileIconTheme={fileIconTheme}
          focusedNodePath={focusedNodePath}
          graph={graph}
          nodes={graph.rootNodes}
          relationshipCountByNode={relationshipCountByNode}
          registerCard={registerCard}
          sceneLayout={rootSceneLayout}
          onFocusNode={focusNode}
          onToggleFolder={onToggleFolder}
        />
      </div>
    </div>
  );
}

type RelationshipNodeLayoutProps = Readonly<{
  className?: string;
  connectedNodePaths: ReadonlySet<string>;
  depth: number;
  dragController: RelationshipDragController;
  edges: readonly FolderRelationshipEdge[];
  expandedFolderPaths: ReadonlySet<string>;
  fileIconTheme: FileIconThemeId;
  focusedNodePath: string | null;
  graph: FolderRelationshipGraph;
  nodes: readonly DataNode[];
  relationshipCountByNode: ReadonlyMap<string, number>;
  registerCard: (nodePath: string) => RefCallback<HTMLElement>;
  sceneLayout?: RelationshipSceneLayout | null;
  onFocusNode: (nodePath: string | null) => void;
  onToggleFolder: (node: DataNode) => void;
}>;

function RelationshipNodeLayout({
  className = "",
  connectedNodePaths,
  depth,
  dragController,
  edges,
  expandedFolderPaths,
  fileIconTheme,
  focusedNodePath,
  graph,
  nodes,
  relationshipCountByNode,
  registerCard,
  sceneLayout = null,
  onFocusNode,
  onToggleFolder,
}: RelationshipNodeLayoutProps) {
  const zones = useMemo(
    () => buildFolderRelationshipLayoutZones(nodes, edges, relationshipCountByNode),
    [edges, nodes, relationshipCountByNode],
  );

  return (
    <div
      className={`folder-relationship-layout ${className}`.trim()}
      data-depth={depth}
      data-layout-animated={sceneLayout && edges.length <= 250 ? "true" : undefined}
      data-scene={sceneLayout ? "true" : undefined}
      style={sceneLayout ? {
        height: `${sceneLayout.height}px`,
        width: `${sceneLayout.width}px`,
      } : undefined}
    >
      {zones.map((zone) => (
        <div
          className="folder-relationship-layout-zone"
          data-layout-zone={zone.role}
          key={zone.role}
        >
          {zone.nodes.map((entry, index) => {
            const expanded = entry.node.type === "folder"
              && expandedFolderPaths.has(entry.node.path);
            const expandedChildCount = expanded
              ? graph.childrenByFolderPath.get(normalizePath(entry.node.path))?.length ?? 0
              : 0;
            const manualOffset = dragController.offsets.get(entry.node.path) ?? { x: 0, y: 0 };
            const scenePosition = sceneLayout?.positions.get(entry.node.path) ?? null;
            return (
              <div
                className="folder-relationship-layout-slot"
                data-dragging={dragController.draggingNodePath === entry.node.path
                  ? "true"
                  : undefined}
                data-expanded={expanded ? "true" : undefined}
                data-layout-role={zone.role}
                data-node-path={entry.node.path}
                key={entry.node.path}
                style={{
                  "--relationship-expanded-width": expanded
                    ? `${getExpandedFolderPreferredWidth(expandedChildCount)}px`
                    : undefined,
                  "--relationship-manual-x": `${manualOffset.x}px`,
                  "--relationship-manual-y": `${manualOffset.y}px`,
                  "--relationship-scene-x": scenePosition ? `${scenePosition.x}px` : undefined,
                  "--relationship-scene-y": scenePosition ? `${scenePosition.y}px` : undefined,
                  "--relationship-layout-offset": `${getFolderRelationshipLayoutOffset(
                    index,
                    zone.nodes.length,
                    zone.role,
                  )}px`,
                } as CSSProperties}
              >
                <RelationshipNode
                  connectedNodePaths={connectedNodePaths}
                  depth={depth}
                  dragController={dragController}
                  edges={edges}
                  expandedFolderPaths={expandedFolderPaths}
                  fileIconTheme={fileIconTheme}
                  focusedNodePath={focusedNodePath}
                  graph={graph}
                  node={entry.node}
                  relationshipCountByNode={relationshipCountByNode}
                  registerCard={registerCard}
                  onFocusNode={onFocusNode}
                  onToggleFolder={onToggleFolder}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function RelationshipNode({
  connectedNodePaths,
  depth,
  dragController,
  edges,
  expandedFolderPaths,
  fileIconTheme,
  focusedNodePath,
  graph,
  node,
  relationshipCountByNode,
  registerCard,
  onFocusNode,
  onToggleFolder,
}: {
  connectedNodePaths: ReadonlySet<string>;
  depth: number;
  dragController: RelationshipDragController;
  edges: readonly FolderRelationshipEdge[];
  expandedFolderPaths: ReadonlySet<string>;
  fileIconTheme: FileIconThemeId;
  focusedNodePath: string | null;
  graph: FolderRelationshipGraph;
  node: DataNode;
  relationshipCountByNode: ReadonlyMap<string, number>;
  registerCard: (nodePath: string) => RefCallback<HTMLElement>;
  onFocusNode: (nodePath: string | null) => void;
  onToggleFolder: (node: DataNode) => void;
}) {
  const { t } = useLocalization();
  const expanded = node.type === "folder" && expandedFolderPaths.has(node.path);
  const children = node.type === "folder"
    ? graph.childrenByFolderPath.get(normalizePath(node.path)) ?? []
    : [];

  if (expanded) {
    return (
      <section
        className="folder-relationship-group"
        data-depth={depth}
        data-folder-path={node.path}
        data-node-path={node.path}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="folder-relationship-group-header">
          <span
            className="folder-relationship-group-icon"
            aria-hidden="true"
          >
            <FileGlyphIcon name={node.name} type="folder" size={24} theme={fileIconTheme} />
          </span>
          <strong className="folder-relationship-group-name">
            {node.name}
          </strong>
        </div>
        <div
          aria-hidden="true"
          className="folder-relationship-group-drag-surface"
          onPointerCancel={dragController.finish}
          onPointerDown={(event) => dragController.start(node.path, event)}
          onPointerMove={dragController.move}
          onPointerUp={dragController.finish}
        />
        <button
          aria-label={t("workspace.relationships.collapseFolder", { name: node.name })}
          className="folder-relationship-collapse"
          type="button"
          title={t("workspace.relationships.collapseFolder", { name: node.name })}
          onClick={() => onToggleFolder(node)}
        >
          <ChevronUp size={14} aria-hidden="true" />
        </button>
        {children.length > 0 ? (
          <RelationshipNodeLayout
            className="folder-relationship-group-children"
            connectedNodePaths={connectedNodePaths}
            depth={depth + 1}
            dragController={dragController}
            edges={edges}
            expandedFolderPaths={expandedFolderPaths}
            fileIconTheme={fileIconTheme}
            focusedNodePath={focusedNodePath}
            graph={graph}
            nodes={children}
            relationshipCountByNode={relationshipCountByNode}
            registerCard={registerCard}
            onFocusNode={onFocusNode}
            onToggleFolder={onToggleFolder}
          />
        ) : (
          <div className="folder-relationship-group-empty">{t("workspace.relationships.empty")}</div>
        )}
      </section>
    );
  }

  const content = (
    <span className="folder-relationship-card-hitarea">
      <span
        className="folder-relationship-card-icon"
        aria-hidden="true"
      >
        <FileGlyphIcon name={node.name} type={node.type} size={24} theme={fileIconTheme} />
      </span>
      <span className="folder-relationship-card-copy">
        <strong>{node.name}</strong>
      </span>
    </span>
  );

  const interactionProps = {
    "data-depth": depth,
    "data-folder": node.type === "folder" ? "true" : undefined,
    "data-focused": focusedNodePath === node.path ? "true" : undefined,
    "data-node-path": node.path,
    "data-related": focusedNodePath && focusedNodePath !== node.path
      && connectedNodePaths.has(node.path) ? "true" : undefined,
    onPointerCancel: dragController.finish,
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => dragController.start(node.path, event),
    onPointerEnter: () => onFocusNode(node.path),
    onPointerLeave: () => onFocusNode(null),
    onPointerMove: dragController.move,
    onPointerUp: dragController.finish,
  } as const;

  if (node.type === "folder") return (
    <button
      className="folder-relationship-card"
      {...interactionProps}
      ref={registerCard(node.path)}
      type="button"
      title={t("workspace.relationships.expandFolder", { name: node.name })}
      onClick={() => {
        if (!dragController.consumeClick(node.path)) onToggleFolder(node);
      }}
    >
      {content}
    </button>
  );

  return (
    <div
      className="folder-relationship-card"
      {...interactionProps}
      ref={registerCard(node.path)}
      title={node.name}
    >
      {content}
    </div>
  );
}

function createRelationshipDragLimits(
  node: DOMRect,
  boundary: DOMRect,
  origin: RelationshipLayoutOffset,
  topInset: number,
  scale: number,
): RelationshipDragLimits {
  const horizontalInset = 12;
  const bottomInset = 12;
  return {
    minX: origin.x + (boundary.left + horizontalInset * scale - node.left) / scale,
    maxX: origin.x + (boundary.right - horizontalInset * scale - node.right) / scale,
    minY: origin.y + (boundary.top + topInset * scale - node.top) / scale,
    maxY: origin.y + (boundary.bottom - bottomInset * scale - node.bottom) / scale,
  };
}

function toRelationshipRouteRect(
  rect: DOMRect,
  world: DOMRect,
  scale: number,
): RelationshipRouteRect {
  return {
    height: rect.height / scale,
    left: (rect.left - world.left) / scale,
    top: (rect.top - world.top) / scale,
    width: rect.width / scale,
  };
}

function isRelationshipEdgeAffectedByNode(
  edge: FolderRelationshipEdge,
  nodePath: string,
): boolean {
  const descendantPrefix = `${normalizePath(nodePath)}/`;
  const sourceId = normalizePath(edge.sourceId);
  const targetId = normalizePath(edge.targetId);
  return sourceId === normalizePath(nodePath)
    || targetId === normalizePath(nodePath)
    || sourceId.startsWith(descendantPrefix)
    || targetId.startsWith(descendantPrefix);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function isAbortError(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "AbortError";
}



function getScopeName(scopePath: string | null): string {
  if (!scopePath) return "Workspace";
  const normalized = normalizePath(scopePath);
  return normalized.slice(normalized.lastIndexOf("/") + 1) || "Workspace";
}

function RadialLayoutIcon({ size }: Readonly<{ size: number }>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 16 16"
      width={size}
    >
      <circle cx="8" cy="8" r="1.45" />
      <path d="M8 6.55V3.7M9.28 8.72l2.5 1.45M6.72 8.72l-2.5 1.45" />
      <circle cx="8" cy="2.45" r="1.15" />
      <circle cx="13" cy="10.9" r="1.15" />
      <circle cx="3" cy="10.9" r="1.15" />
    </svg>
  );
}

function CanvasLayoutIcon({ size }: Readonly<{ size: number }>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 16 16"
      width={size}
    >
      <rect x="2" y="2" width="4.5" height="4.5" rx="0.8" />
      <rect x="9.5" y="2" width="4.5" height="4.5" rx="0.8" />
      <rect x="2" y="9.5" width="4.5" height="4.5" rx="0.8" />
      <rect x="9.5" y="9.5" width="4.5" height="4.5" rx="0.8" />
    </svg>
  );
}

function LayeredLayoutIcon({ size }: Readonly<{ size: number }>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 16 16"
      width={size}
    >
      <rect x="6.25" y="1.5" width="3.5" height="3" rx="0.7" />
      <path d="M8 4.5v3H3.5v2.25M8 7.5h4.5v2.25" />
      <rect x="1.75" y="9.75" width="3.5" height="3" rx="0.7" />
      <rect x="10.75" y="9.75" width="3.5" height="3" rx="0.7" />
    </svg>
  );
}

'use client';

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { useRouter } from 'next/navigation';

import { T } from '../lib/tokens';
import { PROVIDER_LABELS, getApDirection } from '../lib/constants';
import type { DashboardConnection, TreeNode as TN } from '../lib/types';
import { ROW_HEIGHT, TreeRows, type RowVariant } from './TreeRows';
import { ProviderAvatar } from './ProviderAvatar';

// ConnectionsCanvas — a wiring board that surfaces THE relationship
// the GitHub-style header / cards above CAN'T: which access points
// are pinned to which slice of the file tree.  The Data card answers
// "what files exist?" (top level only), this canvas answers "and
// which external systems care about which folders / files?".
//
// Inheriting the OLD TopologyCanvas's bones intentionally:
//   ─ The file tree renders INSIDE the canvas as one big block (a
//     single xyflow node), the same way the old TopologyCanvas
//     embedded TreeRows.  The block is the spine of the diagram —
//     APs hang off its rows.
//   ─ Each AP is an individual draggable card on the right.
//   ─ Every edge lands on the EXACT row of the tree the AP is
//     scoped to (or the tree's header band for project-root APs),
//     so the user can read off "this AP touches this folder" at a
//     glance instead of inferring it from a path string.
//
// The tree shown here is NOT the full project tree — it's pruned
// to the chain of folders / files leading to AP-attached rows.
// Non-primary siblings are NEVER rendered by name; instead each
// level gets a single "X more files / folders / items" placeholder
// summarizing what's hidden.  This keeps the canvas focused on
// RELATIONSHIPS — the user reads "this AP touches that path" — and
// avoids leaking content (specific filenames) into a view whose
// job is structural.  An earlier version sampled one sibling by
// name per level; that pulled the eye onto irrelevant filenames
// (cloud-test-XXX.md, e2e-test-YYY.md) competing with the AP-
// attached path the canvas exists to surface.
//
// What @xyflow/react adds over the old hand-rolled SVG version:
//   ─ Pan + scroll-zoom out of the box → graphs scale past the
//     fixed viewport without us building zoom UI.
//   ─ AP nodes are draggable for free, with positions persisted
//     across SWR refreshes so the user's mental layout sticks.
//   ─ Dotted background → reads as "this is a canvas you can
//     manipulate" without needing copy.
//   ─ smoothstep edges with auto-routed orthogonal segments give
//     the old "Manhattan path" feel without us computing geometry.
//
// The trick that makes per-row edges work: TreeRows accepts a
// `renderRowExtras` slot that we use to drop a hidden xyflow
// `<Handle>` into every row's container (which is `position:
// relative`).  xyflow measures the handle's DOM position and
// routes the edge to it — so even though the entire tree is one
// xyflow node, individual rows act as edge endpoints.

// ── Layout constants ───────────────────────────────────────────
//
// Initial seed positions only — once placed, drag positions
// override these and stick across re-renders.

const DATA_NODE_X = 24;
const DATA_NODE_Y = 24;
const DATA_NODE_W = 380;       // Tree node fixed width — wide enough
                               // for ~30-char paths at 13px without
                               // ellipsis becoming the dominant
                               // visual.

const AP_GAP = 120;            // Horizontal gap between the data
                               // tree's right edge and the AP rail.
                               // Wide enough that smoothstep edges
                               // get a clean horizontal run before
                               // the orthogonal step.
const AP_X = DATA_NODE_X + DATA_NODE_W + AP_GAP;

// Vertical spacing between AP node Y positions in the seed layout.
// Bumped from 56 → 64 when APNode padding grew (6/10 → 9/13) — at
// the smaller spacing the cards' borders nearly kissed and the
// rail read as a "stack of buttons" rather than discrete chips.
const AP_ROW_H = 64;

// Solid surface colors used INSIDE the canvas viewport — the
// canvas can't lean on the page-bg-tinted-through-rgba scheme the
// rest of the page uses, because the dotted Background sits BELOW
// node panels and any transparency lets dots bleed THROUGH the
// panel's body, which reads as "broken / leaky".  These solids
// override `T.cardBg` (rgba 2% white, basically transparent) for
// canvas-internal use so panels are crisp cutouts on the dot grid.
const CANVAS_BG = 'var(--po-inset)';        // Viewport floor — dots paint on
                                    // top of this.  Slightly darker
                                    // than the surrounding section
                                    // card's effective color so the
                                    // canvas reads as recessed.
const CANVAS_PANEL_BG = 'var(--po-panel)';  // Node body — solid so the dots
                                    // don't show through.  Lighter
                                    // than CANVAS_BG so panels read
                                    // as raised plates on the grid.

// ── Tree pruning ───────────────────────────────────────────────
//
// `buildCanvasView` walks the raw project tree and returns:
//   ─ a pruned tree containing only the chain of folders / files
//     leading to AP-attached rows, with all non-primary siblings
//     collapsed into a single per-level "X more files" placeholder;
//   ─ a `variants` map that tags each placeholder path so TreeRows
//     can render it italic-dim and suppress the click handler.
//
// The placeholder text is type-aware:
//   ─ all hidden are files     → "X more files"
//   ─ all hidden are folders   → "X more folders"
//   ─ mixed                    → "X more items"
// Singular collapses to "1 more file".  This wording ("X more
// <type>") is the format the user explicitly asked for over the
// older "… and N more" — concrete enough that the user reads off
// "this folder contains 4 more files I'm not showing" rather than
// having to wonder "more what?".
//
// Variants live in a path-keyed Map (not inline on the entry)
// because TreeEntry is the API response shape — adding fields would
// either fork the type or sneak undocumented state through the
// boundary.

interface CanvasView {
  tree: TN[];
  variants: Map<string, RowVariant>;
}

function makePlaceholderLabel(hidden: TN[]): string {
  const fileCount = hidden.filter((n) => n.entry.type === 'file').length;
  const folderCount = hidden.length - fileCount;
  const total = hidden.length;
  const plural = total === 1 ? '' : 's';
  if (folderCount === 0) return `${total} more file${plural}`;
  if (fileCount === 0) return `${total} more folder${plural}`;
  return `${total} more item${plural}`;
}

function buildCanvasView(
  rawNodes: TN[],
  accessByPath: Map<string, DashboardConnection[]>,
): CanvasView {
  const variants = new Map<string, RowVariant>();

  // `parentIsApAttached`: when true, even if there's no primary
  // descendant at this level, we still surface a "X more items"
  // placeholder so the user can read off "this AP-attached folder
  // contains N things".  When false (a non-AP waypoint folder),
  // hidden items are dropped silently — they're pure noise that
  // doesn't connect to any AP and would just compete with the path
  // we DO want to show.
  function walk(nodes: TN[], parentPath: string, parentIsApAttached: boolean): TN[] {
    const primaries: TN[] = [];
    const hidden: TN[] = [];

    for (const n of nodes) {
      const hasOwnAP = accessByPath.has(n.entry.path);
      const prunedChildren = walk(n.children, n.entry.path, hasOwnAP);
      const isPrimary = hasOwnAP || prunedChildren.length > 0;

      if (isPrimary) {
        primaries.push({
          // children_count cleared because the count would refer to
          // the ORIGINAL tree's child total, which would mislead the
          // user into thinking the canvas hides more than it does.
          // (We do hide things, but per-level via the placeholder —
          // not silently behind a folder count chip.)
          entry: { ...n.entry, children_count: null },
          children: prunedChildren,
        });
      } else {
        hidden.push(n);
      }
    }

    // Show the placeholder for hidden items when:
    //   ─ there's at least one primary at this level (the placeholder
    //     adds context to the path the user CAN see), or
    //   ─ the parent itself is AP-attached (the placeholder tells the
    //     user "the AP target folder contains N things").
    // Otherwise hidden items are dropped — no AP to anchor them to.
    const shouldShow = primaries.length > 0 || (parentIsApAttached && hidden.length > 0);
    if (!shouldShow) return [];

    const result = [...primaries];
    if (hidden.length > 0) {
      // Sentinel path scoped to the parent so it's unique across the
      // whole tree (multiple levels can have placeholders) without
      // colliding with any real path (which always starts with a
      // non-`__` segment).  type='file' keeps the icon neutral —
      // folder icons would visually shout "another folder" when the
      // placeholder counts a mix of files and folders.
      const placeholderPath = `__more__:${parentPath || '__root__'}`;
      variants.set(placeholderPath, 'placeholder');
      result.push({
        entry: {
          name: makePlaceholderLabel(hidden),
          path: placeholderPath,
          type: 'file',
          content_hash: null,
          size_bytes: 0,
          mime_type: null,
          children_count: null,
        },
        children: [],
      });
    }

    return result;
  }

  // The "parent" of the top-level walk IS the project root, so its
  // AP-attached status is `accessByPath.has('')` — a root-attached AP
  // (filesystem at "/", path='' or null) means the project as a
  // whole has external wiring, even when no individual top-level
  // node carries its own AP.  Without this, projects whose ONLY AP
  // is root-attached end up with primaries=[] AND no placeholder
  // (because parentIsApAttached was hardcoded false), producing an
  // empty tree body — the canvas degenerates to a header-only chip
  // that gives the user no hint of what "39 files" the AP is wired
  // to.  Threading the real value through surfaces the standard
  // "X more files" placeholder so the user reads "filesystem AP →
  // 39 more files" instead of "filesystem AP → ???".
  const rootAttached = accessByPath.has('');
  const tree = walk(rawNodes, '', rootAttached);
  return { tree, variants };
}

// ── Hover context ──────────────────────────────────────────────
//
// Cross-node hover sync — APs and the data tree live as separate
// xyflow nodes, but the ORIGINAL TopologyCanvas linked them with a
// shared "hovered AP" state so hovering an AP card cyan-banded the
// matching tree rows + dimmed other APs.  We restore that here via
// a context that wraps the ReactFlow tree, so any node renderer
// can read / write the hover without re-running buildGraph.
//
// Putting hover in `nodes[].data` would have been the more
// "xyflow native" approach, but every hover would force a setNodes
// → measurable jank with 20+ nodes.  Context gives us O(1) re-
// renders of just the nodes that consume it.

interface HoverState {
  hoveredApId: string | null;
  setHovered: (id: string | null) => void;
}

const HoverContext = createContext<HoverState>({
  hoveredApId: null,
  setHovered: () => {},
});

// ── Node renderers ─────────────────────────────────────────────

// DataTreeNode — the project's file tree (pruned + sibling-sampled
// upstream by buildCanvasView) as a single xyflow node.  Embeds
// TreeRows verbatim so the visual is consistent with the Data card
// above; tree-style fixes (guides, highlights, muted variants)
// automatically apply here too.
//
// Two kinds of `<Handle>` live inside this node:
//   ─ Per-row handle (id = row's path)  → injected via TreeRows'
//     `renderRowExtras` slot.  Only rendered for rows that ACTUALLY
//     have at least one AP attached, since handles for muted /
//     placeholder rows would just be wasted xyflow measurement.
//   ─ Root handle  (id = "__root__")     → on the header band, so
//     project-root APs (filesystem at "/") connect to the tree as a
//     WHOLE rather than to whatever happens to be the first row.
//
// `nodrag nowheel` on the body lets users click rows + scroll
// inside the tree without xyflow swallowing the events as a node
// drag / canvas pan.  The header band is still drag-active so
// the whole tree can be repositioned by dragging there.
const DataTreeNode = memo(function DataTreeNode({
  data,
}: {
  data: {
    tree: TN[];
    variants: Map<string, RowVariant>;
    accessByPath: Map<string, DashboardConnection[]>;
    projectId: string;
    router: ReturnType<typeof useRouter>;
    rootAttached: boolean;
    nodesTotal: number | null;
  };
}) {
  const {
    tree,
    variants,
    accessByPath,
    projectId,
    router,
    rootAttached,
    nodesTotal,
  } = data;
  const { hoveredApId } = useContext(HoverContext);

  // Hover-driven cyan band on the tree.  When the user mouses an AP
  // card, we resolve the AP's scope path → the set of tree paths
  // that fall under it → TreeRows paints them with `T.rowHighlight`.
  // Whole-tree APs (path = "") get every path; scoped APs get their
  // path + descendants.  Computed lazily so the no-hover path stays
  // O(1) — only the matching AP's hover triggers a tree walk.
  const { highlightedPaths, anchorDepth, rootDepth } = useMemo(() => {
    if (!hoveredApId) {
      return { highlightedPaths: null, anchorDepth: -1, rootDepth: 0 };
    }
    const conns = Array.from(accessByPath.values()).flat();
    const ap = conns.find((c) => c.id === hoveredApId);
    if (!ap) {
      return { highlightedPaths: null, anchorDepth: -1, rootDepth: 0 };
    }
    const apPath = ap.path || '';
    const paths = new Set<string>();

    if (apPath === '') {
      const collectAll = (nodes: TN[]) => {
        for (const n of nodes) {
          paths.add(n.entry.path);
          collectAll(n.children);
        }
      };
      collectAll(tree);
      return { highlightedPaths: paths, anchorDepth: -1, rootDepth: 0 };
    }

    let foundDepth = 0;
    const collectScoped = (nodes: TN[], depth: number) => {
      for (const n of nodes) {
        const p = n.entry.path;
        if (p === apPath) {
          foundDepth = depth;
          paths.add(p);
          const collectDesc = (cs: TN[]) => {
            for (const c of cs) {
              paths.add(c.entry.path);
              collectDesc(c.children);
            }
          };
          collectDesc(n.children);
        } else {
          collectScoped(n.children, depth + 1);
        }
      }
    };
    collectScoped(tree, 0);

    return {
      highlightedPaths: paths,
      anchorDepth: foundDepth,
      rootDepth: foundDepth,
    };
  }, [hoveredApId, tree, accessByPath]);

  return (
    <div
      style={{
        // Solid panel (NOT T.cardBg's 2% white) so the dot grid
        // doesn't show through the tree body.  Slightly lighter
        // than the canvas floor so the tree reads as a raised
        // plate sitting on the grid.
        background: CANVAS_PANEL_BG,
        border: `1px solid ${T.cardBorderH}`,
        borderRadius: 10,
        width: DATA_NODE_W,
        overflow: 'hidden',
      }}
    >
      {/* Header — light-touch label + count chip + root handle.
          Same rhythm as the parent Data card's header but at one
          step smaller (11px label vs 13px) so the user reads it
          as "this is the same data, viewed structurally" rather
          than two competing primary headings. */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          borderBottom: `1px solid ${T.cardBorderH}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: T.text2,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            Data
          </span>
          {nodesTotal != null && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 18,
                height: 16,
                padding: '0 5px',
                borderRadius: 8,
                background: 'var(--po-border-subtle)',
                fontSize: 10,
                fontWeight: 600,
                color: T.text3,
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1,
              }}
            >
              {nodesTotal}
            </span>
          )}
        </div>

        {/* Root scope chip — the visible anchor for root-attached
            AP edges (filesystem at "/", path='' or null).

            Why a labeled chip + embedded invisible Handle instead
            of a visible Handle:
              1. xyflow uses `getBoundingClientRect` on the Handle
                 element to compute the edge endpoint.  A Handle
                 styled to "half overhang" the panel via tricks
                 like `right: -3` with `overflow: hidden` decouples
                 the visual position (clipped by CSS) from the
                 measurement position (un-clipped DOM rect),
                 producing edges that snap to coordinates the user
                 can't see.  The chip-with-handle pattern keeps
                 visual and measurement positions identical.
              2. xyflow ships its own `.react-flow__handle*` CSS.
                 Trying to make a Handle the visible UI fights this
                 CSS for control of size/border/background.  Wrap-
                 ping in a container we own sidesteps that.
              3. Standard wiring-graph idiom (n8n, Airflow, Blender
                 Shader Editor): edges that target "the whole
                 scope" land on a clearly-labeled scope indicator,
                 not an anonymous edge of a panel.  "/" here is the
                 universally-understood filesystem-root symbol.

            Visual treatment is a faint cyan tint (NOT the full
            T.live cyan that direction-bearing edges use) so the
            chip reads as "connection anchor" without claiming to
            indicate direction — direction stays the edge's job. */}
        {rootAttached && (
          <div
            style={{
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 20,
              height: 18,
              padding: '0 6px',
              borderRadius: 4,
              background: 'color-mix(in srgb, var(--po-success) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--po-success) 30%, transparent)',
              fontFamily: T.fontMono,
              fontSize: 11,
              fontWeight: 600,
              color: T.text2,
              lineHeight: 1,
            }}
            title="Project root — APs attached here cover the entire tree"
          >
            /
            <Handle
              type="source"
              id="__root__"
              position={Position.Right}
              style={{
                opacity: 0,
                pointerEvents: 'none',
                width: 6,
                height: 6,
                background: 'transparent',
                border: 'none',
              }}
            />
          </div>
        )}
      </div>

      {/* Tree body — `nodrag nowheel` so a row click navigates and
          mouse-wheel scrolls the page (when the tree overflows the
          viewport's vertical room), instead of xyflow interpreting
          the gestures as canvas drag / zoom.  The whole node is
          still draggable from the header band above. */}
      <div className="nodrag nowheel" style={{ padding: '4px 0' }}>
        <TreeRows
          nodes={tree}
          depth={0}
          projectId={projectId}
          router={router}
          accessByPath={accessByPath}
          highlightedPaths={highlightedPaths}
          highlightAnchorDepth={anchorDepth}
          highlightRootDepth={rootDepth}
          rowVariants={variants}
          renderRowExtras={(path) =>
            // Only render handles for rows with at least one AP
            // attached.  Placeholder rows have synthetic `__more__:`
            // paths that never appear in accessByPath (by
            // construction), so we skip them — handles there would
            // still be measured by xyflow (perf cost) but never
            // used (no edge ever resolves to them).
            accessByPath.has(path) ? (
              <Handle
                key={`h-${path}`}
                type="source"
                id={path}
                position={Position.Right}
                style={{
                  opacity: 0,
                  pointerEvents: 'none',
                  width: 6,
                  height: 6,
                  background: 'transparent',
                  border: 'none',
                  // Center on the row vertically.  xyflow uses
                  // this DOM position to decide where the edge
                  // enters / exits the node.  Locked to TreeRows'
                  // exported ROW_HEIGHT so the two stay in sync if
                  // the tree row height ever changes again.
                  top: ROW_HEIGHT / 2,
                }}
              />
            ) : null
          }
        />
      </div>
    </div>
  );
});

// APNode — a draggable provider chip.  Carries the visual weight
// because "which AP" is the relational signal this canvas exists
// to surface.  Hover on any AP card → the data tree highlights
// the matching scope (via HoverContext) AND every other AP in the
// canvas dims, so the user gets a momentary "just this one" view
// without any clicking.
const APNode = memo(function APNode({
  data,
}: {
  data: { conn: DashboardConnection };
}) {
  const { conn } = data;
  const { hoveredApId, setHovered } = useContext(HoverContext);

  const isHovered = hoveredApId === conn.id;
  const isDimmed = hoveredApId !== null && !isHovered;

  const label = conn.name || PROVIDER_LABELS[conn.provider] || conn.provider;
  const isError = conn.status === 'error';
  const statusColor = isError
    ? T.err
    : conn.status === 'paused'
      ? T.warn
      : T.live;

  return (
    <div
      onMouseEnter={() => setHovered(conn.id)}
      onMouseLeave={() => setHovered(null)}
      style={{
        // Solid panel for the same reason as DataTreeNode — dots
        // bleeding through an "AP card" reads as broken.
        background: CANVAS_PANEL_BG,
        border: `1px solid ${isHovered ? T.text3 : T.cardBorderH}`,
        borderRadius: 9,
        padding: '9px 13px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        minWidth: 180,
        maxWidth: 240,
        opacity: isDimmed ? 0.35 : 1,
        transition: `opacity 200ms ${T.ease}, border-color 200ms ${T.ease}`,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{
          opacity: 0,
          pointerEvents: 'none',
          width: 6,
          height: 6,
          background: 'transparent',
          border: 'none',
        }}
      />
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--po-hover)',
          flexShrink: 0,
        }}
      >
        <ProviderAvatar
          provider={conn.provider}
          size={16}
          icon={(conn as { icon?: string }).icon}
        />
      </div>
      <span
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: T.text2,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
          flex: 1,
        }}
      >
        {label}
      </span>
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: statusColor,
          boxShadow: isError ? 'none' : `0 0 0 2px ${T.liveSoft}`,
          flexShrink: 0,
        }}
      />
    </div>
  );
});

// `nodeTypes` declared OUTSIDE the component so xyflow doesn't
// warn about a fresh identity each render (would force the renderer
// to remount every time, losing focus / DOM state).
const nodeTypes: NodeTypes = { ap: APNode, dataTree: DataTreeNode };

// ── Graph build ────────────────────────────────────────────────
//
// Pure function over (connections, view, …) → (nodes, edges).  Kept
// pure so the seed layout and edge wiring are deterministic given
// a snapshot of the data, which makes the position-preservation
// effect below trivial — we just diff old positions against fresh
// node ids.

function buildGraph(
  connections: DashboardConnection[],
  view: CanvasView,
  accessByPath: Map<string, DashboardConnection[]>,
  projectId: string,
  router: ReturnType<typeof useRouter>,
  nodesTotal: number | null,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const rootAttached = connections.some((c) => !c.path || c.path === '');

  nodes.push({
    id: 'data-tree',
    type: 'dataTree',
    position: { x: DATA_NODE_X, y: DATA_NODE_Y },
    data: {
      tree: view.tree,
      variants: view.variants,
      accessByPath,
      projectId,
      router,
      rootAttached,
      nodesTotal,
    },
    // Tree IS draggable — users sometimes want to slide it left to
    // make room for APs, or down to align with a specific AP.  The
    // `nodrag` class on the body restricts the drag-activate area
    // to the header band so row clicks still navigate.
    draggable: true,
    selectable: false,
    // Sit BEHIND AP nodes in the z-stack so dragging an AP over
    // the tree doesn't get visually swallowed by the tree's
    // background.  xyflow respects `zIndex` for paint order.
    zIndex: 0,
  });

  connections.forEach((conn, idx) => {
    const apY = DATA_NODE_Y + idx * AP_ROW_H;
    nodes.push({
      id: `ap-${conn.id}`,
      type: 'ap',
      position: { x: AP_X, y: apY },
      data: { conn },
      draggable: true,
      zIndex: 1,
    });

    const handleId = conn.path || '__root__';
    const direction = getApDirection(conn);
    const isCyan =
      direction === 'outbound' || direction === 'bidirectional';
    const stroke = isCyan ? T.live : T.text3;

    edges.push({
      id: `e-${conn.id}`,
      source: 'data-tree',
      sourceHandle: handleId,
      target: `ap-${conn.id}`,
      // smoothstep ≈ orthogonal segments with rounded corners —
      // closest visual match to the old Manhattan SVG paths
      // without us hand-routing every edge.  bezier was tried
      // first; the curves felt too "social-graph", not "wiring
      // diagram".
      type: 'smoothstep',
      style: {
        stroke,
        strokeWidth: 1.25,
        opacity: 0.7,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: stroke,
        width: 12,
        height: 12,
      },
      // Bidirectional connections (filesystem MUT, etc.) get an
      // arrow on BOTH ends so the data-flow shape is visible at
      // a glance — otherwise the line reads as one-way.
      ...(direction === 'bidirectional' && {
        markerStart: {
          type: MarkerType.ArrowClosed,
          color: stroke,
          width: 12,
          height: 12,
        },
      }),
      data: { connId: conn.id },
    });
  });

  return { nodes, edges };
}

// ── Component ──────────────────────────────────────────────────

export function ConnectionsCanvas({
  connections,
  tree,
  accessByPath,
  projectId,
  router,
  nodesTotal,
}: {
  connections: DashboardConnection[];
  // Raw project tree (NOT pre-pruned) — pruning + sibling sampling
  // happens INSIDE this component because the variant map produced
  // by pruning has to travel alongside the tree to TreeRows.  Keeping
  // the two derived together avoids drift between page.tsx's pruned
  // tree and the variant map.
  tree: TN[];
  accessByPath: Map<string, DashboardConnection[]>;
  projectId: string;
  router: ReturnType<typeof useRouter>;
  nodesTotal: number | null;
}) {
  const [hoveredApId, setHoveredApId] = useState<string | null>(null);
  const setHovered = useCallback((id: string | null) => {
    setHoveredApId(id);
  }, []);

  // Collapsed by default.  The Data card above now renders an inline
  // ApChip on every AP-attached row, so for the common case (a project
  // with 1-3 root- or top-level APs) a user already sees "what's
  // wired to what" without needing the graph view.  The graph still
  // earns its keep for complex wiring (multi-AP fan-out, mixed
  // providers, deeply-scoped APs) and for "I want to see edge
  // direction" — both unlocked by clicking the header to expand.
  // Initial-collapsed also keeps first paint lighter on dense
  // projects: ReactFlow + xyflow's layout engine don't run until the
  // user opts in.
  const [collapsed, setCollapsed] = useState(true);

  // Pruned view of the tree — primary chains (path-to-AP) + a
  // single per-level "X more files" placeholder summarizing what's
  // hidden.  Drives both what the tree renders AND which paths get
  // edge handles (only AP-attached paths — placeholders are visual
  // context, never edge endpoints).
  const view = useMemo(
    () => buildCanvasView(tree, accessByPath),
    [tree, accessByPath],
  );

  const built = useMemo(
    () =>
      buildGraph(
        connections,
        view,
        accessByPath,
        projectId,
        router,
        nodesTotal,
      ),
    [connections, view, accessByPath, projectId, router, nodesTotal],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(built.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(built.edges);

  // Re-derive nodes / edges when the underlying data changes (SWR
  // refresh, AP added / removed, tree updated), but PRESERVE drag
  // positions by id so a 30s poll doesn't yank user-rearranged APs
  // back to the seed layout.  Status / metadata updates flow
  // through naturally because we always overwrite `data` from the
  // latest build.
  useEffect(() => {
    setNodes((prev: Node[]) => {
      const prevPositions = new Map(prev.map((n) => [n.id, n.position]));
      return built.nodes.map((n) => ({
        ...n,
        position: prevPositions.get(n.id) ?? n.position,
      }));
    });
    setEdges(built.edges);
  }, [built, setNodes, setEdges]);

  // Edge-fade overlay on hover — re-style edges in place so the
  // hovered AP's edge stays at full opacity and every other edge
  // dims.  Keeps `setEdges` cheap by only touching `style.opacity`,
  // not re-creating edge objects.
  const styledEdges = useMemo(() => {
    if (!hoveredApId) return edges;
    return edges.map((e) => {
      const isHoveredEdge =
        (e.data as { connId?: string } | undefined)?.connId === hoveredApId;
      return {
        ...e,
        style: {
          ...(e.style ?? {}),
          opacity: isHoveredEdge ? 1 : 0.15,
        },
      };
    });
  }, [edges, hoveredApId]);

  const hoverValue = useMemo(
    () => ({ hoveredApId, setHovered }),
    [hoveredApId, setHovered],
  );

  return (
    <div
      style={{
        background: T.sectionBg,
        border: `2px solid ${T.sectionBorder}`,
        borderRadius: T.sectionRadius,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header — same rhythm as the Data / History / APs cards.
          Now a TOGGLE: clicking anywhere on the header flips the
          collapsed state.  When collapsed the right-side text reads
          as a "expand to view" cue; when expanded it surfaces the
          two interactive affordances (hover, drag) the dotted
          background can't communicate on its own. */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        aria-controls="connections-canvas-body"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: T.sectionHeaderBg,
          borderBottom: collapsed ? 'none' : `1px solid ${T.sectionDivider}`,
          // Reset native button styling so the header still reads as
          // a section header, not a CTA pill.  Cursor flips to
          // pointer to communicate "this is interactive" — the only
          // affordance change vs. the previous static header.
          border: 'none',
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          fontFamily: 'inherit',
          color: 'inherit',
          transition: `background 200ms ${T.ease}`,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--po-hover)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = T.sectionHeaderBg;
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{ fontSize: 13, fontWeight: 500, color: T.text2 }}
          >
            Connections
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 20,
              height: 18,
              padding: '0 6px',
              borderRadius: 9,
              background: 'var(--po-border)',
              fontSize: 11,
              fontWeight: 600,
              color: connections.length > 0 ? T.text2 : T.text3,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
            }}
          >
            {connections.length}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: T.text3 }}>
            {collapsed
              ? connections.length === 0
                ? 'No access points yet'
                : 'View as graph'
              : 'Hover an access point to highlight · Drag to rearrange'}
          </span>
          {/* Caret — flips down when expanded.  Slow rotation
              transitions read as "panel opening" instead of an
              instant snap.  aria-hidden because the button itself
              already exposes aria-expanded for AT users. */}
          <svg
            aria-hidden
            width="10"
            height="10"
            viewBox="0 0 12 12"
            fill="none"
            style={{
              color: T.text3,
              flexShrink: 0,
              transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)',
              transition: `transform 200ms ${T.ease}`,
            }}
          >
            <path
              d="M3 4.5l3 3 3-3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </button>

      {/* xyflow Controls dark-theme override.  The default Controls
          ship with white panel + dark glyph styling (built for
          light backgrounds) which would punch a glaring white
          rectangle into our dark canvas.  Scoped via the
          `cb-controls` className so we don't accidentally restyle
          any other Controls instance that might appear on this
          page later.  Colors line up with `T.cardBg` / `T.text2`
          tokens (kept as literal hex here because the rule lives
          in CSS land, not JS — keeping them in sync with tokens.ts
          is a one-line update if the tokens ever change). */}
      <style>{`
        .cb-controls.react-flow__controls {
          box-shadow: none;
          background: var(--po-shadow);
          border: 1px solid var(--po-border);
          border-radius: 6px;
          overflow: hidden;
        }
        .cb-controls .react-flow__controls-button {
          background: transparent;
          border: none;
          border-bottom: 1px solid var(--po-border-subtle);
          color: var(--po-text-muted);
          width: 22px;
          height: 22px;
          padding: 0;
        }
        .cb-controls .react-flow__controls-button:last-child {
          border-bottom: none;
        }
        .cb-controls .react-flow__controls-button:hover {
          background: var(--po-border-subtle);
          color: var(--po-text);
        }
        .cb-controls .react-flow__controls-button svg {
          fill: currentColor;
          width: 11px;
          height: 11px;
          max-width: 11px;
          max-height: 11px;
        }
      `}</style>

      {/* Canvas body — fixed height capped UNDER the Data card's
          minHeight so the relationship view stays a supplementary
          band beneath the primary content cards, not something that
          competes with them.  Bumped to 300 alongside the Data
          minHeight bump (280 → 320) — the Connections body still
          sits below the Data card's body floor (320), and the
          extra 60px gives fitView at 0.75 enough viewport room to
          seat a slightly bigger tree + AP rail without crunching
          everything tight against the dot grid edges.

          Conditionally rendered (defaults collapsed): when collapsed
          we don't mount ReactFlow at all, so the xyflow layout pass
          never runs on a freshly-loaded /home — initial render is
          just the section header strip.  Expanding flips
          `collapsed` to false and ReactFlow mounts inline; the
          drag-position memory in the `setNodes` effect above will
          honour any positions the user previously dragged within
          the same session, so collapse → expand isn't destructive. */}
      {!collapsed && (
      <div id="connections-canvas-body" style={{ height: 300, position: 'relative' }}>
        <HoverContext.Provider value={hoverValue}>
          <ReactFlow
            nodes={nodes}
            edges={styledEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            fitView
            // padding 0.22 (was 0.15) gives the tree + AP rail
            // breathing room against the canvas frame so the dot
            // grid is clearly visible around the content — the
            // grid IS the "this is a canvas" affordance, hiding
            // it under a tight-fitting graph defeats the cue.
            //
            // maxZoom 0.75 (was 1.1) is the more important knob:
            // when the natural-scale graph would FIT inside the
            // viewport at 100% (which is the common case at this
            // 240px height with 1 tree + a few APs), fitView used
            // to honor that and render everything at full size,
            // making the tree node + AP cards look oversized for
            // a "supplementary band" — competing visually with
            // the primary Data card above instead of reading as
            // an annotation.  Capping at 0.75 forces a "small,
            // dense schematic" look that matches the canvas's
            // role.  User can still zoom in via the controls if
            // they want to read details.
            fitViewOptions={{ padding: 0.22, maxZoom: 0.75 }}
            minZoom={0.4}
            maxZoom={1.8}
            // Read-only relationship view; the backend doesn't
            // accept "user dragged a new edge into existence" as a
            // wiring change.  Disabling connect / edge focus
            // removes affordances we'd have to fight to support.
            nodesConnectable={false}
            edgesFocusable={false}
            // Hide the xyflow watermark; we own the canvas frame.
            proOptions={{ hideAttribution: true }}
            // Solid CANVAS_BG (NOT transparent → section bg → page
            // bg layered translucency) so the dot grid paints onto
            // a single deterministic color and no page-bg tint
            // leaks through behind the dots.  Without this the
            // dots looked like they were "showing through" the
            // canvas frame to whatever was beneath the page.
            style={{ background: CANVAS_BG }}
          >
            {/* Dot grid — the canvas's primary "this is interactive"
                affordance.  After dropping the default zoom to 0.75
                the dots became too faint to register as a grid (the
                screen-space density doesn't change with zoom, but
                with smaller content + more padding around it the
                user reads MORE empty space, making faint dots feel
                even more faded).  Bumped to size=2 / tokenized grid
                color to push them back to "clearly a grid" without
                becoming a foreground texture. */}
            <Background
              variant={BackgroundVariant.Dots}
              gap={22}
              size={2}
              color="var(--po-border)"
            />
            {/* Zoom in / out + fit-view controls. showInteractive is off
                because this is a read-only relational graph, not an
                editable wiring canvas. */}
            <Controls
              showInteractive={false}
              position="bottom-left"
              className="cb-controls"
            />
          </ReactFlow>
        </HoverContext.Provider>
        {connections.length === 0 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              color: T.text3,
              fontSize: 12,
            }}
          >
            No access points to graph yet.
          </div>
        )}
      </div>
      )}
    </div>
  );
}

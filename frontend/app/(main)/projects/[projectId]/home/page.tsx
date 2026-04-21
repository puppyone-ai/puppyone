'use client';

import { use, useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Reorder } from 'framer-motion';
import { get } from '@/lib/apiClient';
import useSWR from 'swr';
import { treeList, getProjectHistory } from '@/lib/contentTreeApi';

import { T } from './lib/tokens';
import { getApDirection } from './lib/constants';
import { formatRelative } from './lib/format';
import type {
  ProjectDashboard,
  DashboardConnection,
  ApDirection,
  TreeNode,
} from './lib/types';

import { HeaderSparkline } from './components/HeaderSparkline';
import { APCard } from './components/APCard';
import { TreeRows } from './components/TreeRows';

// localStorage-backed manual ordering for the AP column.  Kept inline (vs a
// real hook file) because (a) it's only ~30 lines and (b) it's coupled to
// the page's input/output split — moving it would invent a generality that
// doesn't pay off until a second consumer exists.
type APOrder = { input: string[]; output: string[] };
const EMPTY_ORDER: APOrder = { input: [], output: [] };

function readApOrder(projectId: string): APOrder {
  if (typeof window === 'undefined') return EMPTY_ORDER;
  try {
    const raw = window.localStorage.getItem(`home-ap-order:${projectId}`);
    if (!raw) return EMPTY_ORDER;
    const parsed = JSON.parse(raw);
    return {
      input: Array.isArray(parsed?.input) ? parsed.input.filter((x: unknown) => typeof x === 'string') : [],
      output: Array.isArray(parsed?.output) ? parsed.output.filter((x: unknown) => typeof x === 'string') : [],
    };
  } catch {
    return EMPTY_ORDER;
  }
}

function writeApOrder(projectId: string, order: APOrder) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`home-ap-order:${projectId}`, JSON.stringify(order));
  } catch {
    /* QuotaExceeded etc — silent, ordering is non-critical */
  }
}

// Apply a saved ID order on top of a fresh server list.  IDs in `order` get
// their items first (in that order); items not in `order` (newly created
// APs) are appended at the end so they don't disappear; IDs in `order` that
// no longer exist (deleted APs) are silently dropped.
function applyOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
  const remaining = new Map(items.map(i => [i.id, i]));
  const out: T[] = [];
  for (const id of order) {
    const item = remaining.get(id);
    if (item) {
      out.push(item);
      remaining.delete(id);
    }
  }
  remaining.forEach(item => out.push(item));
  return out;
}

// One TS line per drawn manhattan curve.  `(x1,y1)` is the AP card's
// left edge midpoint; `(x2,y2)` is the file row's right edge midpoint.
// `d` is a pre-baked SVG `d` attribute for an HVH path with rounded
// (12px) corners.  Lines render as a single neutral hairline at rest;
// provider color is intentionally NOT carried — hover lifts the entire
// line to `T.live` cyan, and that's the only chromatic state.
//
// `direction` drives the flow pellet (only mounted on hover):
//   • `inbound`        — pellet runs AP → vault   (path 0 → 1)
//   • `outbound`       — pellet runs vault → AP   (path 1 → 0)
//   • `bidirectional`  — two pellets, opposing, half-cycle phase shift
type LineSpec = {
  id: string;
  d: string;
  x1: number; y1: number;
  x2: number; y2: number;
  direction: ApDirection;
};

// Build an HVH manhattan path with rounded corners.  Two corners
// (`midX,y1` and `midX,y2`) get a quadratic-bezier `Q` shoulder of
// radius `r`, clamped so the curve never overruns its straight runs.
//
// Geometry note: in this layout `x1` is the AP card on the right and
// `x2` is the vault box on the left, so `midX < x1` and `x2 < midX`
// (both horizontal segments travel leftward).  `sx*` capture that
// direction so the same code handles future right-flowing layouts.
function buildLinePath(
  x1: number, y1: number,
  midX: number, y2: number,
  x2: number,
  radius = 12,
): string {
  // Degenerate: AP roughly on the same y as the row → skip the corners,
  // just one straight line.  Avoids a path that visually buckles into a
  // tiny S-curve when |dy| ≈ 0.
  const dy = y2 - y1;
  if (Math.abs(dy) < 1) {
    return `M ${x1.toFixed(1)} ${y1.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }

  const sx1 = Math.sign(midX - x1);    // AP-side horizontal direction
  const sx2 = Math.sign(x2 - midX);    // vault-side horizontal direction
  const sy = Math.sign(dy);

  const r = Math.min(
    radius,
    Math.abs(midX - x1) / 2,
    Math.abs(dy) / 2,
    Math.abs(x2 - midX) / 2,
  );

  return [
    `M ${x1.toFixed(1)} ${y1.toFixed(1)}`,
    `L ${(midX - sx1 * r).toFixed(1)} ${y1.toFixed(1)}`,
    `Q ${midX.toFixed(1)} ${y1.toFixed(1)} ${midX.toFixed(1)} ${(y1 + sy * r).toFixed(1)}`,
    `L ${midX.toFixed(1)} ${(y2 - sy * r).toFixed(1)}`,
    `Q ${midX.toFixed(1)} ${y2.toFixed(1)} ${(midX + sx2 * r).toFixed(1)} ${y2.toFixed(1)}`,
    `L ${x2.toFixed(1)} ${y2.toFixed(1)}`,
  ].join(' ');
}

export default function HomePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const router = useRouter();

  // ---------- Data ----------

  const { data: dashboard } = useSWR<ProjectDashboard>(
    projectId ? `/api/v1/projects/${projectId}/dashboard` : null,
    (url: string) => get<ProjectDashboard>(url),
    { refreshInterval: 30000 }
  );

  const { data: treeEntries } = useSWR(
    projectId ? ['home-tree', projectId] : null,
    () => treeList(projectId, '', 3)
  );

  const { data: historyData } = useSWR(
    projectId ? ['project-history-overview', projectId] : null,
    () => getProjectHistory(projectId, 50)
  );

  const commits = historyData?.commits || [];
  const latestCommit = commits.length > 0 ? commits[commits.length - 1] : null;

  // 30-day commit timeline for the header sparkline.
  const commitBuckets = useMemo(() => {
    const buckets: { date: string; count: number }[] = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      buckets.push({ date: d.toISOString().slice(0, 10), count: 0 });
    }
    commits.forEach(c => {
      if (!c.created_at) return;
      const day = c.created_at.slice(0, 10);
      const bucket = buckets.find(b => b.date === day);
      if (bucket) bucket.count++;
    });
    return buckets;
  }, [commits]);

  const connections = dashboard?.access_points || [];

  // No project-level "Connect" affordance: connecting always happens against
  // a specific access point (each AP card carries its own commands), never
  // the project root. Surfacing one here mis-trains users into thinking the
  // project itself has a generic ingest endpoint.

  // ---------- Tree + access path index ----------

  const tree = useMemo<TreeNode[]>(() => {
    const entries = treeEntries || [];
    const sorted = [...entries].sort((a, b) => {
      if (a.type === 'folder' && b.type !== 'folder') return -1;
      if (a.type !== 'folder' && b.type === 'folder') return 1;
      return a.name.localeCompare(b.name);
    });

    const nodeMap = new Map<string, TreeNode>();
    const roots: TreeNode[] = [];

    for (const entry of sorted) {
      nodeMap.set(entry.path, { entry, children: [] });
    }

    for (const entry of sorted) {
      const node = nodeMap.get(entry.path)!;
      const slashIdx = entry.path.lastIndexOf('/');
      if (slashIdx === -1) {
        roots.push(node);
      } else {
        const parentPath = entry.path.substring(0, slashIdx);
        const parent = nodeMap.get(parentPath);
        if (parent) {
          parent.children.push(node);
        } else {
          roots.push(node);
        }
      }
    }
    return roots;
  }, [treeEntries]);

  // path → APs that target it.  Used by TreeRows to flag attached rows
  // with the soft `T.rowAttached` tint.
  const accessByPath = useMemo(() => {
    const map = new Map<string, DashboardConnection[]>();
    for (const conn of connections) {
      const key = conn.path || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(conn);
    }
    return map;
  }, [connections]);

  // ---------- Floating canvas layout ----------
  // Inputs flow IN from the right column → Vault on the left.
  // Outputs flow OUT from the same column. Each AP renders as a card; an
  // SVG overlay paints a fan-out HVH manhattan line from the card's left
  // edge to its scope target row's right edge.

  // Group by backend `direction`. Bidirectional APs (filesystem MUT) join the
  // input column at the top — they're functionally a primary data source.
  // Within each group, user-defined order from localStorage takes priority;
  // new APs (never reordered) drop in at the end of their group.
  const [apOrder, setApOrder] = useState<APOrder>(EMPTY_ORDER);
  useEffect(() => {
    if (projectId) setApOrder(readApOrder(projectId));
  }, [projectId]);

  const inputAPs = useMemo(
    () => applyOrder(connections.filter(c => getApDirection(c) !== 'outbound'), apOrder.input),
    [connections, apOrder.input]
  );
  const outputAPs = useMemo(
    () => applyOrder(connections.filter(c => getApDirection(c) === 'outbound'), apOrder.output),
    [connections, apOrder.output]
  );
  const inputCount = inputAPs.length;
  const outputCount = outputAPs.length;

  const reorderInputs = useCallback((next: DashboardConnection[]) => {
    const nextOrder = { ...apOrder, input: next.map(c => c.id) };
    setApOrder(nextOrder);
    writeApOrder(projectId, nextOrder);
  }, [apOrder, projectId]);

  const reorderOutputs = useCallback((next: DashboardConnection[]) => {
    const nextOrder = { ...apOrder, output: next.map(c => c.id) };
    setApOrder(nextOrder);
    writeApOrder(projectId, nextOrder);
  }, [apOrder, projectId]);

  const canvasRef = useRef<HTMLDivElement>(null);
  const dataBoxRef = useRef<HTMLDivElement>(null);
  const apRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const setApRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) apRefs.current.set(id, el);
    else apRefs.current.delete(id);
  };

  const [lines, setLines] = useState<LineSpec[]>([]);
  // When an AP card is hovered, brighten its line + endpoint with the cyan
  // "live" accent. Tracked here at the page level because the SVG overlay
  // is a sibling of both the AP cards and the data box.
  const [hoveredAp, setHoveredAp] = useState<string | null>(null);

  // When an AP is hovered, the scope payload TreeRows needs to render the
  // unified highlight band:
  //   - paths:       every row inside the AP's scope (path + all descendants)
  //   - anchorDepth: depth of the scope's root row in the tree.  TreeRows
  //                  uses this to align all highlighted rows' cyan band to
  //                  ONE shared left edge (the scope-root's content column
  //                  start), instead of staircase-stepping by per-row depth
  //                  — the staircase is what makes the highlight read
  //                  ragged.
  // `anchorDepth: -1` means "whole-tree scope" (filesystem at root): the
  // band starts flush at row x=0, since there is no scope-root row to
  // align to.
  // Empty/`/`/`.` sentinels mean "whole tree".  Walk-up fallback handles
  // APs pointing at paths that aren't currently rendered (depth pruning).
  const hoveredApScope = useMemo<{ paths: Set<string>; anchorDepth: number } | null>(() => {
    if (!hoveredAp) return null;
    const conn = connections.find(c => c.id === hoveredAp);
    if (!conn) return null;

    const result = new Set<string>();
    const collectSubtree = (n: TreeNode) => {
      result.add(n.entry.path);
      n.children.forEach(collectSubtree);
    };

    const apPath = conn.path ?? '';
    if (!apPath || apPath === '/' || apPath === '.') {
      tree.forEach(collectSubtree);
      return { paths: result, anchorDepth: -1 };
    }

    let p = apPath;
    while (p) {
      const findIn = (nodes: TreeNode[]): TreeNode | null => {
        for (const n of nodes) {
          if (n.entry.path === p) return n;
          const c = findIn(n.children);
          if (c) return c;
        }
        return null;
      };
      const found = findIn(tree);
      if (found) {
        collectSubtree(found);
        // Depth of `p` in the tree, zero-indexed at root level: a path like
        // "New Folder/2026-4-7" has 2 segments → depth 1 (root entries are
        // depth 0).  This is the depth of the visible scope root — possibly
        // `apPath` itself, or the closest rendered ancestor if `apPath`'s
        // descendants were pruned by tree depth.
        const anchorDepth = p.split('/').filter(Boolean).length - 1;
        return { paths: result, anchorDepth };
      }
      const idx = p.lastIndexOf('/');
      if (idx === -1) break;
      p = p.substring(0, idx);
    }

    return { paths: result, anchorDepth: -1 };
  }, [hoveredAp, connections, tree]);

  // True for the entire "card is moving" window — both while the user is
  // actively dragging AND for the ~700ms FLIP/spring animation framer-motion
  // runs after release to slot the card into its new home.  We can't watch
  // just the dragging window because framer-motion drives the post-release
  // motion via CSS `transform`, which neither React nor ResizeObserver sees;
  // if we stopped the RAF loop on `onDragEnd`, the line would freeze the
  // moment your finger lifted while the card kept gliding underneath.
  const [animActive, setAnimActive] = useState(false);
  const settleTimerRef = useRef<number | null>(null);

  const handleDragStart = useCallback(() => {
    if (settleTimerRef.current != null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    setAnimActive(true);
  }, []);

  const handleDragEnd = useCallback(() => {
    if (settleTimerRef.current != null) {
      window.clearTimeout(settleTimerRef.current);
    }
    // 700ms = framer-motion's default layout spring (~300-500ms) + buffer.
    // Erring long is cheap (RAF idle when nothing is moving still costs
    // ~one boundingClientRect read per card per frame); erring short
    // brings back the "line lags behind card" tearing the user reported.
    settleTimerRef.current = window.setTimeout(() => {
      setAnimActive(false);
      settleTimerRef.current = null;
    }, 700);
  }, []);

  useEffect(() => () => {
    if (settleTimerRef.current != null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  // Position-of-AP-cards is read fresh inside `update`; we re-run on layout
  // changes (ResizeObserver) and on AP order changes (orderedConnections in
  // the deps).  Wrapped in useCallback so the drag RAF loop can call it
  // without creating a stale closure.
  const orderedConnections = useMemo(
    () => [...inputAPs, ...outputAPs],
    [inputAPs, outputAPs]
  );

  const updateLines = useCallback(() => {
    const canvas = canvasRef.current;
    const dataBox = dataBoxRef.current;
    if (!canvas || !dataBox) return;
    const cb = canvas.getBoundingClientRect();
    const dbRect = dataBox.getBoundingClientRect();

    const next: LineSpec[] = [];
    const total = orderedConnections.length;
    for (let idx = 0; idx < total; idx++) {
      const conn = orderedConnections[idx];
      const apEl = apRefs.current.get(conn.id);
      if (!apEl) continue;
      const apRect = apEl.getBoundingClientRect();
      const x1 = apRect.left - cb.left;
      const y1 = apRect.top + apRect.height / 2 - cb.top;

      // Walk up the path until we find a row that exists in the DOM.
      let targetEl: HTMLElement | null = null;
      let p = conn.path || '';
      while (p && !targetEl) {
        try {
          targetEl = dataBox.querySelector(`[data-row-path="${CSS.escape(p)}"]`) as HTMLElement | null;
        } catch { /* ignore selector errors for exotic paths */ }
        const i = p.lastIndexOf('/');
        if (i === -1) break;
        p = p.substring(0, i);
      }

      const fallbackY = dbRect.top + dbRect.height / 2 - cb.top;
      const tRect = targetEl?.getBoundingClientRect();
      const x2 = dbRect.right - cb.left;
      const y2 = tRect ? tRect.top + tRect.height / 2 - cb.top : fallbackY;

      // Fan-out: distribute turn-X across [0.40, 0.78] of the corridor.
      // Earlier APs in the stack turn closer to the data box (left), later
      // APs turn closer to the card column (right). Visual result: lines
      // splay rather than running parallel.
      const t = total > 1 ? idx / (total - 1) : 0.5;
      const ratio = 0.40 + t * 0.38;
      const midX = x2 + (x1 - x2) * ratio;

      const d = buildLinePath(x1, y1, midX, y2, x2);
      next.push({ id: conn.id, d, x1, y1, x2, y2, direction: getApDirection(conn) });
    }
    setLines(next);
  }, [orderedConnections]);

  useLayoutEffect(() => {
    updateLines();
    const ro = new ResizeObserver(() => updateLines());
    if (canvasRef.current) ro.observe(canvasRef.current);
    if (dataBoxRef.current) ro.observe(dataBoxRef.current);
    window.addEventListener('resize', updateLines);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateLines);
    };
  }, [updateLines, tree]);

  // RAF loop for the "card is moving" window.  Mount path is intentionally
  // `if (!animActive) return;` rather than starting a one-shot — initial
  // line layout is handled by the ResizeObserver useLayoutEffect above, no
  // need to spin RAF on every page load.
  useEffect(() => {
    if (!animActive) return;
    let raf = requestAnimationFrame(function tick() {
      updateLines();
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [animActive, updateLines]);

  // ---------- Render ----------

  if (!dashboard) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: T.text3, fontSize: 13,
        fontFamily: T.fontSans,
      }}>
        Loading…
      </div>
    );
  }

  const hasErr = connections.some(c => c.status === 'error');

  return (
    // No `background` on this root — `(main)/layout.tsx` already paints
    // the rounded `#0e0e0e` pane.  Painting again here would (a) break the
    // 12px corner radius, (b) drift visually if layout ever changes its
    // surface color.
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      color: T.text2, fontFamily: T.fontSans,
    }}>

      {/* Top bar — kept minimal, hairline divider only */}
      <div style={{
        height: 40, minHeight: 40, flexShrink: 0,
        display: 'flex', alignItems: 'center', padding: '0 20px',
        borderBottom: `1px solid ${T.border}`,
        fontSize: 12, fontWeight: 500, color: T.text2,
        letterSpacing: '0.01em',
      }}>
        Home
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{
          display: 'flex', flexDirection: 'column',
          maxWidth: 1080, margin: '0 auto', width: '100%',
          padding: '64px 32px 96px',
        }}>

          {/* ============================================================
              HEADER — single column. Title row, then a meta row of status
              chips, then the project ID on its own faint line below.
              No project-level Connect button: connecting is always done
              from a specific AP card.
              ============================================================ */}

          <div style={{
            display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0,
          }}>
            {/* Title row */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, minWidth: 0 }}>
              <h1 style={{
                fontSize: 36, fontWeight: 600,
                letterSpacing: '-0.022em',
                color: T.text1, margin: 0, lineHeight: 1.1,
                flexShrink: 0,
              }}>
                {dashboard.project.name}
              </h1>
              {/* Header history sparkline — temporarily hidden while we
                  reconsider the visual.  Component, data plumbing, and
                  `commitBuckets` useMemo are intentionally kept so we can
                  drop it back in by uncommenting this block.
              <HeaderSparkline
                buckets={commitBuckets}
                hasHistory={commits.length > 0}
                onClick={() => router.push(`/projects/${projectId}/history`)}
              />
              */}
            </div>

            {/* Meta row — wide gaps replace `·`. Only ONE line. */}
            <div style={{
              display: 'flex', alignItems: 'center', flexWrap: 'wrap',
              rowGap: 8, columnGap: 28,
              fontSize: 13, color: T.text2,
            }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: hasErr ? T.err : T.live,
                  boxShadow: hasErr ? 'none' : `0 0 0 4px ${T.liveSoft}`,
                }} />
                {hasErr ? 'Unhealthy' : 'Active'}
              </span>

              {/* AP count — single number.  We used to break it down as
                  "N in / M out", but the AP column on the right already
                  separates the two visually, so calling it out here is
                  noise.  One word, one number. */}
              <span
                style={{ cursor: 'pointer', color: T.text2 }}
                onClick={() => router.push(`/projects/${projectId}/access`)}
              >
                <span style={{ color: T.text1, fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                  {connections.length}
                </span>
                <span style={{ color: T.text3, marginLeft: 6 }}>
                  access {connections.length === 1 ? 'point' : 'points'}
                </span>
              </span>

              {latestCommit && (
                <span style={{ color: T.text2 }}>
                  Updated <span style={{ color: T.text1 }}>{formatRelative(latestCommit.created_at)}</span>
                </span>
              )}
            </div>

            {/* Project ID — lives on its own muted line below the meta row.
                Used to be tucked into the meta row's right edge, which
                competed with the status chips for attention; pushing it
                down a level lets the eye skip past it unless you want it. */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontFamily: T.fontMono, fontSize: 12, color: T.text3,
              alignSelf: 'flex-start',
            }}>
              {projectId.slice(0, 8)}…{projectId.slice(-4)}
              <button
                onClick={() => navigator.clipboard.writeText(projectId)}
                style={{
                  background: 'none', border: 'none', color: T.text3,
                  cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center',
                  transition: `color 200ms ${T.ease}`,
                }}
                onMouseEnter={e => { e.currentTarget.style.color = T.text1; }}
                onMouseLeave={e => { e.currentTarget.style.color = T.text3; }}
                title="Copy project ID"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25v-7.5Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25v-7.5Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25h-7.5Z"></path></svg>
              </button>
            </div>
          </div>

          {/* ============================================================
              CANVAS — Vault on the LEFT, AP cards on the RIGHT, SVG
              overlay between them paints fan-out manhattan lines.
              Section sits 80px below header.
              ============================================================ */}

          <div
            ref={canvasRef}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 0,
              width: '100%',
              marginTop: 80,
            }}
          >
            {/* LEFT: Vault — wrapped in the same card frame as APCard /
                ProviderRow (cardBg + 1px cardBorder + radius 8) so visual
                weight stays balanced with the AP cards on the right.
                Width 500 (down from 600) so the AP column on the right
                gets more breathing room for drag-to-reorder. */}
            <div
              ref={dataBoxRef}
              style={{
                width: 500, flexShrink: 0, position: 'relative', zIndex: 2,
                background: T.cardBg,
                border: `1px solid ${T.cardBorder}`,
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              {/* Section header — uppercase letter-spaced label.  Hairline
                  below separates header from tree, mirroring how AP cards
                  separate their icon row from any subordinate content. */}
              <div style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                padding: '10px 14px',
                borderBottom: `1px solid ${T.cardBorder}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 500, color: T.text3,
                    letterSpacing: '0.10em', textTransform: 'uppercase',
                  }}>
                    Data
                  </span>
                  {dashboard?.nodes?.total != null && (
                    <span style={{
                      fontSize: 13, color: T.text1, fontWeight: 500,
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {dashboard.nodes.total}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => router.push(`/projects/${projectId}/data`)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    fontSize: 12, color: T.text2, fontFamily: T.fontSans,
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    transition: `color 200ms ${T.ease}`,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = T.text1; }}
                  onMouseLeave={e => { e.currentTarget.style.color = T.text2; }}
                >
                  Browse
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>

              {/* File tree */}
              <div style={{ padding: '6px 0' }}>
                {tree.length === 0 ? (
                  <div style={{
                    padding: '64px 0', textAlign: 'center',
                    color: T.text3, fontSize: 13,
                  }}>
                    Empty project
                  </div>
                ) : (
                  <TreeRows
                    nodes={tree} depth={0}
                    projectId={projectId} router={router}
                    accessByPath={accessByPath}
                    highlightedPaths={hoveredApScope?.paths ?? null}
                    highlightAnchorDepth={hoveredApScope?.anchorDepth ?? -1}
                  />
                )}
              </div>
            </div>

            {/* RIGHT: AP column — drag-to-reorder via framer-motion's
                `<Reorder.Group>`. Two independent vertical lists (input
                then output) with an 8px divider, so dragging stays within
                a semantic group (mixing inbound/outbound across the gap
                would visually contradict the direction the line pellets
                announce on hover).  Width tuned to 320: cards stay
                readable while the middle corridor gets ~60px back for
                the topology lines to splay into. */}
            <div style={{
              width: 320, flexShrink: 0,
              display: 'flex', flexDirection: 'column', gap: 12,
              paddingTop: 0, paddingBottom: 24,
              alignItems: 'stretch',
              position: 'relative', zIndex: 2,
            }}>
              {connections.length === 0 ? (
                <button
                  onClick={() => router.push(`/projects/${projectId}/access`)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 10,
                    background: 'transparent',
                    border: `1px dashed ${T.border}`,
                    borderRadius: 6,
                    color: T.text3, fontSize: 12, fontFamily: T.fontSans,
                    cursor: 'pointer', padding: '10px 14px',
                    transition: `border-color 200ms ${T.ease}, color 200ms ${T.ease}`,
                  }}
                  title="Add access point"
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = T.borderH;
                    e.currentTarget.style.color = T.text1;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = T.border;
                    e.currentTarget.style.color = T.text3;
                  }}
                >
                  <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
                  Add access point
                </button>
              ) : (
                <>
                  {inputCount > 0 && (
                    <Reorder.Group
                      axis="y"
                      values={inputAPs}
                      onReorder={reorderInputs}
                      style={{
                        listStyle: 'none', margin: 0, padding: 0,
                        display: 'flex', flexDirection: 'column', gap: 12,
                      }}
                    >
                      {inputAPs.map(conn => (
                        <Reorder.Item
                          key={conn.id}
                          value={conn}
                          onDragStart={handleDragStart}
                          onDragEnd={handleDragEnd}
                          // Reorder.Item defaults to <li>; <div> avoids
                          // accidental list semantics inside a flex column.
                          as="div"
                          style={{
                            listStyle: 'none', cursor: 'grab',
                          }}
                          whileDrag={{
                            cursor: 'grabbing',
                            scale: 1.02,
                            zIndex: 5,
                            boxShadow: '0 12px 28px rgba(0,0,0,0.45)',
                          }}
                        >
                          <APCard
                            conn={conn}
                            registerRef={setApRef(conn.id)}
                            onHoverChange={(h) => setHoveredAp(h ? conn.id : null)}
                            onClick={() => router.push(`/projects/${projectId}/access?ap=${conn.id}`)}
                          />
                        </Reorder.Item>
                      ))}
                    </Reorder.Group>
                  )}
                  {inputCount > 0 && outputCount > 0 && (
                    <div style={{ height: 8 }} />
                  )}
                  {outputCount > 0 && (
                    <Reorder.Group
                      axis="y"
                      values={outputAPs}
                      onReorder={reorderOutputs}
                      style={{
                        listStyle: 'none', margin: 0, padding: 0,
                        display: 'flex', flexDirection: 'column', gap: 12,
                      }}
                    >
                      {outputAPs.map(conn => (
                        <Reorder.Item
                          key={conn.id}
                          value={conn}
                          onDragStart={handleDragStart}
                          onDragEnd={handleDragEnd}
                          as="div"
                          style={{
                            listStyle: 'none', cursor: 'grab',
                          }}
                          whileDrag={{
                            cursor: 'grabbing',
                            scale: 1.02,
                            zIndex: 5,
                            boxShadow: '0 12px 28px rgba(0,0,0,0.45)',
                          }}
                        >
                          <APCard
                            conn={conn}
                            registerRef={setApRef(conn.id)}
                            onHoverChange={(h) => setHoveredAp(h ? conn.id : null)}
                            onClick={() => router.push(`/projects/${projectId}/access?ap=${conn.id}`)}
                          />
                        </Reorder.Item>
                      ))}
                    </Reorder.Group>
                  )}
                </>
              )}
            </div>

            {/* SVG overlay — manhattan lines with rounded corners.
                Three layers, gated by `active` (hover state):
                ─ Base path: ALWAYS rendered.  Rest = T.borderH (a faint
                  white hairline that just barely registers); hover = T.live
                  cyan, slightly thicker.  A slow `<animate>` drifts the
                  dashoffset so the dash pattern crawls toward the data
                  sink (or AP for outbound) — visually a whisper, but
                  enough to say "this line is alive" even at rest.
                ─ Endpoint at the vault row: ALWAYS rendered.  Rest is a
                  hollow 2.5px ring (stroke = T.borderH, fill = T.bg so it
                  reads as empty); hover swells into a solid cyan dot
                  (r=4) with a r=8 cyan halo behind it.  All transitions
                  are CSS so the swap is smooth.
                ─ Flow pellet: ONLY mounted on hover.  Single circle on
                  unidirectional lines, two phase-shifted circles on
                  bidirectional.  When hover ends the circles unmount
                  cleanly so the rest state is genuinely silent. */}
            <svg
              style={{
                position: 'absolute',
                top: 0, left: 0,
                width: '100%', height: '100%',
                pointerEvents: 'none',
                zIndex: 1,
                overflow: 'visible',
              }}
              aria-hidden="true"
            >
              {lines.map(line => {
                const active = hoveredAp === line.id;
                const pathId = `home-line-${line.id}`;
                const isOut = line.direction === 'outbound';
                const isBoth = line.direction === 'bidirectional';

                return (
                  <g key={line.id}>
                    {/* Base rounded-corner path */}
                    <path
                      id={pathId}
                      d={line.d}
                      stroke={active ? T.live : T.borderH}
                      strokeWidth={active ? 1.5 : 1}
                      strokeDasharray="2 6"
                      strokeLinecap="round"
                      fill="none"
                      opacity={active ? 0.95 : 1}
                      style={{ transition: `stroke 200ms ${T.ease}, stroke-width 200ms ${T.ease}, opacity 200ms ${T.ease}` }}
                    >
                      {!isBoth && (
                        <animate
                          attributeName="stroke-dashoffset"
                          from="0"
                          to={isOut ? '8' : '-8'}
                          dur="6s"
                          repeatCount="indefinite"
                        />
                      )}
                    </path>

                    {/* Halo behind the vault endpoint, hover only.
                        Always-mounted so opacity transition fades smoothly. */}
                    <circle
                      cx={line.x2} cy={line.y2} r={8}
                      fill={T.live}
                      opacity={active ? 0.22 : 0}
                      style={{ transition: `opacity 240ms ${T.ease}` }}
                    />
                    {/* Endpoint dot — hollow ring at rest, solid on hover.
                        `fill={T.bg}` (matches page surface) gives the empty
                        center its illusion-of-emptiness while keeping `fill`
                        a real color so it can transition. */}
                    <circle
                      cx={line.x2} cy={line.y2}
                      r={active ? 4 : 2.5}
                      fill={active ? T.live : T.bg}
                      stroke={active ? T.live : T.borderH}
                      strokeWidth={1}
                      style={{ transition: `r 200ms ${T.ease}, fill 200ms ${T.ease}, stroke 200ms ${T.ease}` }}
                    />

                    {/* Flow pellet(s) — hover only. Direction carried by
                        `keyPoints`, color always cyan. */}
                    {active && !isBoth && (
                      <circle r={2.5} fill={T.live}>
                        <animateMotion
                          dur="3s"
                          repeatCount="indefinite"
                          keyPoints={isOut ? '1;0' : '0;1'}
                          keyTimes="0;1"
                          calcMode="linear"
                        >
                          <mpath href={`#${pathId}`} />
                        </animateMotion>
                      </circle>
                    )}
                    {active && isBoth && (
                      <>
                        <circle r={2.5} fill={T.live}>
                          <animateMotion
                            dur="3s"
                            repeatCount="indefinite"
                            keyPoints="0;1"
                            keyTimes="0;1"
                            calcMode="linear"
                          >
                            <mpath href={`#${pathId}`} />
                          </animateMotion>
                        </circle>
                        <circle r={2.5} fill={T.live}>
                          <animateMotion
                            dur="3s"
                            begin="-1.5s"
                            repeatCount="indefinite"
                            keyPoints="1;0"
                            keyTimes="0;1"
                            calcMode="linear"
                          >
                            <mpath href={`#${pathId}`} />
                          </animateMotion>
                        </circle>
                      </>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

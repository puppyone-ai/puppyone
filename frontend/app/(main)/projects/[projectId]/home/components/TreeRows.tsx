import React from 'react';
import type { useRouter } from 'next/navigation';
import { T } from '../lib/tokens';
import type { TreeNode, DashboardConnection } from '../lib/types';
import { FileIcon } from './FileIcon';

// Recursive file tree.  Two visual layers, kept in strict separation so
// they don't fight over the same pixels:
//
//   ─ Tree guide layer (always GREY, T.text4):
//       Every elbow stub, every ╰─ hook, every parent-drawn delegate
//       line.  Pure structure — nesting + sibling continuation.
//
//   ─ Scope layer (cyan when in active AP scope):
//       Rendered as a single absolute-positioned band per row, anchored
//       to the SCOPE ROOT's content-column start (= `highlightAnchorDepth`).
//       This is the key trick: every highlighted row's cyan band shares
//       the same `left`, so vertically-adjacent highlighted rows visually
//       merge into one continuous rectangular block. An earlier version
//       set the bg per-row at the row's own depth, which created a
//       staircase along the band's left edge — visually ragged.
//
//   Rest-state passive tint: rows targeted by ANY access point (`hasAP`)
//   keep `T.rowAttached` (a near-imperceptible whisper) on the right
//   content column.  Hover paints `T.rowHover` on the right column too.
//   Both of these stay per-row because they're not scope-anchored
//   affordances — they belong to the row itself, not to a parent's scope.

export function TreeRows({
  nodes, depth, projectId, router, accessByPath,
  highlightedPaths, highlightAnchorDepth,
}: {
  nodes: TreeNode[];
  depth: number;
  projectId: string;
  router: ReturnType<typeof useRouter>;
  accessByPath: Map<string, DashboardConnection[]>;
  highlightedPaths: Set<string> | null;
  // Depth of the hovered AP's scope-root row.  -1 means "whole tree
  // scope" (filesystem at root) — band starts flush at row x=0.
  highlightAnchorDepth: number;
}) {
  // Single shared left edge for every highlighted row's cyan band.
  // Computed once per render outside the row loop because it's identical
  // for every row in this depth-recursion (and indeed every row across
  // the whole tree under one hovered AP).
  //
  // Three anchor cases:
  //   ─ whole-tree (-1):  band is flush left (no anchor row exists).
  //   ─ root-level (0):   anchor row has no elbow; sit the band 8px in
  //                       from the data box edge for breathing room.
  //   ─ nested  (≥1):     anchor row's elbow stub sits at row x =
  //                       16 + (depth-1)*20 + 10. We park the band 8px
  //                       to the RIGHT of that stub — close enough to
  //                       feel anchored to the elbow, far enough to
  //                       leave a visible gap between the stub and the
  //                       cyan accent stripe so they don't visually
  //                       fuse into one chunky bar.  The 8px is
  //                       narrower than the icon's leading margin, so
  //                       the band's accent stripe still lands left of
  //                       the icon's bounding box rather than slicing
  //                       into it.
  const highlightLeft =
    highlightAnchorDepth < 0
      ? 0
      : highlightAnchorDepth === 0
        ? 8
        : 16 + (highlightAnchorDepth - 1) * 20 + 10 + 8;

  return (
    <>
      {nodes.map((node, idx) => {
        const { entry, children } = node;
        const isFolder = entry.type === 'folder';
        const isLast = idx === nodes.length - 1;
        const attachedAccess = accessByPath.get(entry.path) || [];
        const encodedPath = entry.path.split('/').map(s => encodeURIComponent(s)).join('/');

        const hasAP = attachedAccess.length > 0;
        const isHighlighted = highlightedPaths?.has(entry.path) ?? false;
        // Right-column rest bg: passive `attached` whisper, or transparent.
        // The cyan scope highlight does NOT live here — it's painted by the
        // absolute layer below so the band's left edge can be anchored.
        const rightColRestBg = hasAP ? T.rowAttached : 'transparent';

        return (
          <React.Fragment key={entry.path}>
            <div
              data-row-path={entry.path}
              className="flex items-center cursor-pointer"
              style={{
                height: 36,
                position: 'relative',
              }}
              onClick={() => router.push(
                `/projects/${projectId}/data/${encodedPath}${entry.type ? `?type=${encodeURIComponent(entry.type)}` : ''}`
              )}
            >
              {/* Scope-highlight band — absolute, anchored to the scope
                  root's content-col start.  Shared `left` across every
                  highlighted row makes the band read as one continuous
                  rectangle (no per-row staircase).  z=0: sits behind
                  both indent and content columns.
                  
                  No left accent stripe: an earlier version painted an
                  inset 2px cyan border, but full-saturation cyan against
                  the 6%-cyan fill read as too loud — the eye snapped to
                  the stripe before reading the row content.  The bg
                  fill alone gives a soft but unambiguous boundary, which
                  is plenty given that the highlighted rows are also
                  visually distinguished by name color lifted to text1. */}
              {isHighlighted && (
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    left: highlightLeft, top: 0, bottom: 0, right: 0,
                    background: T.rowHighlight,
                    pointerEvents: 'none',
                    zIndex: 0,
                  }}
                />
              )}

              {/* Indent / elbow column — transparent, neutral grey guides.
                  Sits above the highlight band via z=1 so the elbow
                  stays visible if depth > anchorDepth (i.e., when this
                  row is below the scope-root's left edge). */}
              <div style={{
                width: 16 + depth * 20, flexShrink: 0, height: '100%',
                position: 'relative', zIndex: 1,
                display: 'flex',
                alignItems: 'center', justifyContent: 'flex-end',
              }}>
                {depth > 0 && (
                  // <rect> not <line>: SVG `<line stroke-width="1">` paints
                  // a CENTER stroke that straddles two pixels (here x ∈
                  // [25.5, 26.5] in row coords). Adjacent absolute <div>
                  // delegate-lines below use INTEGER pixel boundaries
                  // (`left: 26, width: 1` → x ∈ [26, 27]). Center-stroke
                  // vs integer-edge means the two lines sit a half-pixel
                  // apart and read as a noticeable misalignment on retina.
                  // <rect> respects integer pixel coords, lining up
                  // perfectly with the absolute delegate-line below.
                  <svg
                    width={20} height={36}
                    style={{ position: 'absolute', right: 0, top: 0 }}
                    viewBox="0 0 20 36"
                    shapeRendering="crispEdges"
                  >
                    <rect
                      x={10} y={0} width={1} height={isLast ? 18 : 36}
                      fill={T.text4}
                    />
                    <rect
                      x={10} y={18} width={10} height={1}
                      fill={T.text4}
                    />
                  </svg>
                )}
              </div>

              {/* Content column — icon + name + count + spacer.  Carries
                  the row's own bg (rest-attached whisper or hover wash);
                  the cyan scope highlight is the absolute layer above.
                  z=1 keeps content above the scope band. */}
              <div
                className="group/row flex items-center"
                style={{
                  flex: 1, height: '100%',
                  paddingRight: 4,
                  position: 'relative', zIndex: 1,
                  background: rightColRestBg,
                  transition: `background-color 200ms ${T.ease}`,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = T.rowHover; }}
                onMouseLeave={e => { e.currentTarget.style.background = rightColRestBg; }}
              >
                {/* Icon */}
                <div style={{
                  width: 20, height: 20, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, marginRight: 8,
                }}>
                  <FileIcon type={entry.type} />
                </div>

                {/* Name. Highlighted rows lift to text1 regardless of file
                    vs folder — when an AP scope is on, the whole subtree
                    should read as "fully present", not muted. */}
                <span
                  style={{
                    fontSize: 13, fontFamily: T.fontSans,
                    color: isHighlighted ? T.text1 : (isFolder ? T.text1 : T.text2),
                    fontWeight: isFolder ? 500 : 400,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    transition: `color 200ms ${T.ease}`,
                  }}
                  className="group-hover/row:!text-[#fafafa]"
                >
                  {entry.name}
                </span>

                {/* Folder item count — tabular for vertical alignment */}
                {isFolder && entry.children_count != null && entry.children_count > 0 && (
                  <span style={{
                    fontSize: 11, marginLeft: 8, flexShrink: 0,
                    color: T.text3, fontVariantNumeric: 'tabular-nums',
                  }}>
                    {entry.children_count}
                  </span>
                )}

                {/* Spacer — the SVG overlay's vault endpoint dot lands in
                    this empty area to the right of the name. */}
                <div style={{ flex: 1 }} />
              </div>
            </div>

            {/* Children — the absolute 1px column is a STRUCTURAL guide
                threading the parent's next sibling through the children
                block.  Always neutral grey: it's part of the structure
                layer, never the scope layer. */}
            {children.length > 0 && (
              <div style={{ position: 'relative' }}>
                {depth > 0 && !isLast && (
                  <div style={{
                    position: 'absolute',
                    left: 16 + (depth - 1) * 20 + 10,
                    top: 0, bottom: 0, width: 1,
                    background: T.text4,
                  }} />
                )}
                <TreeRows
                  nodes={children} depth={depth + 1}
                  projectId={projectId} router={router}
                  accessByPath={accessByPath}
                  highlightedPaths={highlightedPaths}
                  highlightAnchorDepth={highlightAnchorDepth}
                />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

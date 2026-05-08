'use client';

import type { CSSProperties } from 'react';

/**
 * `Skeleton` — placeholder boxes for content that's loading.
 *
 * Skeletons beat spinners when the layout is predictable (lists,
 * cards, tables, editor surfaces), because the user sees the eventual
 * shape immediately and the loaded content slots in without re-flow.
 * Reach for `<PulseGrid />` only when the loaded shape is unknown
 * (one-off operations, partial updates).
 *
 * All skeleton primitives share `puppy-shimmer` via CSS variables —
 * one keyframe definition lives in `globals.css`. Variants composed
 * from primitives live as named exports below.
 */

const SHIMMER_BG = 'rgba(255,255,255,0.06)';
const SHIMMER_HIGHLIGHT = 'rgba(255,255,255,0.15)';

const baseBlockStyle: CSSProperties = {
  position: 'relative',
  background: SHIMMER_BG,
  borderRadius: 4,
  overflow: 'hidden',
};

interface BlockProps {
  width?: number | string;
  height?: number | string;
  radius?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * `<SkeletonBlock />` — single shimmering rectangle. The atomic unit
 * for every other variant in this file. Use directly when none of the
 * preset shapes (`Text`, `Card`, `List`, …) fit your layout.
 */
export function SkeletonBlock({
  width = '100%',
  height = 12,
  radius = 4,
  className,
  style,
}: BlockProps) {
  return (
    <div
      data-puppy-loader="skeleton"
      aria-hidden
      className={className}
      style={{ ...baseBlockStyle, width, height, borderRadius: radius, ...style }}
    >
      <span
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(90deg, transparent, ${SHIMMER_HIGHLIGHT}, transparent)`,
          transform: 'translateX(-100%)',
          animation: 'puppy-shimmer 1.5s infinite',
        }}
      />
    </div>
  );
}

/** Single line of "fake text". `lines > 1` stacks them with the
 *  conventional newspaper-style varying widths so the result reads as
 *  paragraph-shaped, not a uniform brick. */
interface TextProps {
  lines?: number;
  width?: number | string;
  className?: string;
  style?: CSSProperties;
}

const PARAGRAPH_WIDTHS = ['100%', '92%', '96%', '78%'];

export function SkeletonText({
  lines = 1,
  width,
  className,
  style,
}: TextProps) {
  return (
    <div
      className={className}
      style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}
    >
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBlock
          key={i}
          width={width ?? PARAGRAPH_WIDTHS[i % PARAGRAPH_WIDTHS.length]}
          height={10}
          radius={3}
        />
      ))}
    </div>
  );
}

/**
 * `<SkeletonList rows={n} />` — repeating row pattern (icon + label).
 * Mirrors the sidebar / tree / table-list pattern used in /data and
 * /access. `indent` shifts every other row right to suggest a tree.
 */
interface ListProps {
  rows?: number;
  indent?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function SkeletonList({
  rows = 5,
  indent = false,
  className,
  style,
}: ListProps) {
  return (
    <div
      className={className}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, ...style }}
    >
      {Array.from({ length: rows }).map((_, i) => {
        // Vary widths with a small repeating pattern so the list
        // reads as "real entries with different name lengths" rather
        // than a uniform striped placeholder.
        const labelWidth = ['45%', '60%', '38%', '52%', '48%'][i % 5];
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              height: 28,
              paddingLeft: indent && i % 2 === 1 ? 20 : 0,
            }}
          >
            <SkeletonBlock width={14} height={14} radius={3} />
            <SkeletonBlock width={labelWidth} height={10} radius={3} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * `<SkeletonCard />` — bordered card placeholder used inside grids
 * (project dashboard, AP list cards, etc.). Renders header line +
 * body lines with the same border / radius as the loaded card so
 * the visual weight matches.
 */
interface CardProps {
  className?: string;
  style?: CSSProperties;
}

export function SkeletonCard({ className, style }: CardProps) {
  return (
    <div
      className={className}
      style={{
        padding: 16,
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <SkeletonBlock width={28} height={28} radius={6} />
        <SkeletonBlock width="40%" height={12} />
      </div>
      <SkeletonText lines={2} />
    </div>
  );
}

/**
 * `<SkeletonEditor />` — the original editor-area shimmer. Six rows
 * of indented "tree-like" lines that visually echo the JSON / table
 * structure that's about to load in. Used by the `dynamic` import
 * fallback for `TableDiscreteEditor` and `MonacoJsonEditor`.
 *
 * Replaces the legacy `EditorSkeleton` from `components/Skeleton.tsx`
 * — that file now re-exports this for backward compatibility.
 */
export function SkeletonEditor() {
  return (
    <div
      style={{
        flex: 1,
        padding: '32px 40px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {[
        { width: '30%', indent: 0 },
        { width: '45%', indent: 24 },
        { width: '50%', indent: 48 },
        { width: '35%', indent: 48 },
        { width: '25%', indent: 0 },
        { width: '40%', indent: 24 },
      ].map((row, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            height: 32,
            paddingLeft: row.indent,
          }}
        >
          <SkeletonBlock width={14} height={14} radius={3} />
          <SkeletonBlock width={row.width} height={10} radius={3} />
        </div>
      ))}
    </div>
  );
}

/**
 * `<SkeletonDashboard />` — title + metric strip + one big content
 * block. Matches the shape of /home and /projects/[id]/home so the
 * loader reads as "the dashboard is on its way" rather than "an
 * unrelated grey screen".
 */
export function SkeletonDashboard() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#0e0e0e',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: 46,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, padding: '32px 40px', overflow: 'hidden' }}>
        <SkeletonBlock
          width="28%"
          height={22}
          radius={4}
          style={{ marginBottom: 10 }}
        />
        <SkeletonBlock
          width="45%"
          height={13}
          radius={3}
          style={{ marginBottom: 40 }}
        />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 16,
            marginBottom: 24,
          }}
        >
          {[0, 1, 2].map(i => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <SkeletonBlock width="100%" height={300} radius={8} />
      </div>
    </div>
  );
}

/**
 * `Skeleton` — convenience namespace so consumers can write
 * `<Skeleton.Editor />` / `<Skeleton.List rows={6} />` instead of
 * importing each variant separately. The named exports above stay
 * available for tree-shaking-conscious consumers.
 */
export const Skeleton = {
  Block: SkeletonBlock,
  Text: SkeletonText,
  List: SkeletonList,
  Card: SkeletonCard,
  Editor: SkeletonEditor,
  Dashboard: SkeletonDashboard,
};

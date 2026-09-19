import type { ReactNode } from "react";
import { Database, Workflow } from "lucide-react";
import type { FileIconRenderContext } from "../iconThemeTypes";

export function AppGlyph({ color, size }: FileIconRenderContext): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M5.15 11.25h7.7c.7 0 1.25.5 1.37 1.18l.34 2.02H3.44l.34-2.02c.12-.68.67-1.18 1.37-1.18Z"
        fill="color-mix(in srgb, var(--po-file-icon-body) 72%, transparent)"
        stroke={color}
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path d="M9.65 11.25 8.75 6.8" stroke={color} strokeWidth="1.35" strokeLinecap="round" />
      <circle cx="8.45" cy="4.9" r="2" fill="color-mix(in srgb, var(--po-file-icon-body) 72%, transparent)" stroke={color} strokeWidth="1.35" />
      <circle cx="12.2" cy="13.05" r="0.62" fill={color} opacity="0.76" />
      <circle cx="6.15" cy="13.05" r="0.46" fill={color} opacity="0.55" />
    </svg>
  );
}

export function WorkflowGlyph({ color, size }: FileIconRenderContext): ReactNode {
  return <Workflow size={size} color={color} strokeWidth={1.9} aria-hidden="true" />;
}

/** Database family identity, independent of the detected storage engine. */
export function DatabaseGlyph({ color, size }: FileIconRenderContext): ReactNode {
  // Inset the 24-unit Lucide artwork by 20% without changing the shared icon slot.
  return (
    <Database
      size={size}
      viewBox="-3 -3 30 30"
      color={color}
      strokeWidth={1.65}
      aria-hidden="true"
      data-file-icon-shape="database-cylinder"
    />
  );
}

/** Product mark for Context Map documents: a folded game-style treasure map
 * with a dotted trail and destination cross, kept legible at explorer size. */
export function TreasureMapGlyph({ color, size }: FileIconRenderContext): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden
      data-file-icon-complexity="minimal"
      data-file-icon-product="context-map"
      data-file-icon-shape="treasure-map"
    >
      <path
        d="M2.9 4.6 6.7 3l4.6 1.6L15.1 3v10.4L11.3 15l-4.6-1.6L2.9 15V4.6Z"
        stroke={color}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M4.8 11.8c1.15-2.8 3.35.65 4.55-1.75.55-1.1 1.1-1.65 2.05-1.85"
        stroke={color}
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeDasharray="1 1.55"
        data-file-icon-route="treasure-trail"
      />
      <path
        d="m11.7 5.5 1.9 1.9m0-1.9-1.9 1.9"
        stroke={color}
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SpreadsheetGridGlyph({
  color,
  fill,
  size,
  strokeWidth = 1.2,
}: Readonly<{
  color: string;
  fill: string;
  size: number;
  strokeWidth?: number;
}>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden
      data-file-icon-shape="table-grid"
      data-file-icon-grid="2x2"
    >
      <rect
        x="3.5"
        y="3.5"
        width="11"
        height="11"
        rx="1.25"
        fill={fill}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <path
        d="M3.8 9h10.4M9 3.8v10.4"
        stroke={color}
        strokeWidth={strokeWidth * 0.78}
        opacity="0.82"
      />
    </svg>
  );
}

/**
 * A compact Word-family mark. The overlapping W tile carries the product
 * identity while the paper and text strokes keep it readable as a document
 * at the 16–18px sizes used by the explorer.
 */
export function WordDocumentGlyph({
  color,
  fill,
  size,
  strokeWidth = 1.1,
}: Readonly<{
  color: string;
  fill: string;
  size: number;
  strokeWidth?: number;
}>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden
      data-file-icon-office="word"
      data-file-icon-shape="word-document"
    >
      <path
        d="M5.35 2.7h5.25l2.55 2.55v9.05c0 .55-.45 1-1 1h-6.8c-.55 0-1-.45-1-1V3.7c0-.55.45-1 1-1Z"
        fill={fill}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <path
        d="M10.6 2.9v2.35h2.35"
        stroke={color}
        strokeWidth={strokeWidth * 0.82}
        strokeLinejoin="round"
        opacity="0.82"
      />
      <path
        d="M9.7 8.15h2.15M9.7 10.15h2.15M9.7 12.15h1.55"
        stroke={color}
        strokeWidth={strokeWidth * 0.84}
        strokeLinecap="round"
        opacity="0.72"
      />
      <rect x="2.1" y="5.15" width="7.25" height="8.35" rx="1.15" fill={color} />
      <path
        d="m3.55 7.45.9 3.75 1.15-2.75 1.15 2.75.9-3.75"
        stroke="#fff"
        strokeWidth=".78"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * A compact Excel-family mark using the same badge-plus-content construction
 * as Word and PowerPoint. CSV and OpenDocument sheets intentionally keep the
 * neutral table glyph; only Microsoft Excel formats receive the X identity.
 */
export function ExcelSpreadsheetGlyph({
  color,
  fill,
  size,
  strokeWidth = 1.1,
}: Readonly<{
  color: string;
  fill: string;
  size: number;
  strokeWidth?: number;
}>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden
      data-file-icon-office="excel"
      data-file-icon-shape="excel-spreadsheet"
    >
      <rect
        x="5.05"
        y="3"
        width="9.85"
        height="12"
        rx="1.2"
        fill={fill}
        stroke={color}
        strokeWidth={strokeWidth}
      />
      <path
        d="M9.55 5.85h4M9.55 8.95h4M9.55 12.05h4M10.9 4.15v9.7M12.55 4.15v9.7"
        stroke={color}
        strokeWidth={strokeWidth * 0.68}
        opacity="0.72"
      />
      <rect x="2.1" y="5.15" width="7.25" height="8.35" rx="1.15" fill={color} />
      <path
        d="m4.15 7.45 3.15 3.75M7.3 7.45 4.15 11.2"
        stroke="#fff"
        strokeWidth=".88"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * A compact PowerPoint-family mark. The P tile, slide frame, and pie-chart
 * motif remain distinguishable when filenames are truncated in the explorer.
 */
export function PresentationDocumentGlyph({
  color,
  fill,
  size,
  strokeWidth = 1.1,
}: Readonly<{
  color: string;
  fill: string;
  size: number;
  strokeWidth?: number;
}>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden
      data-file-icon-office="presentation"
      data-file-icon-shape="presentation-slide"
    >
      <rect
        x="4.45"
        y="3.15"
        width="10.65"
        height="11.1"
        rx="1.25"
        fill={fill}
        stroke={color}
        strokeWidth={strokeWidth}
      />
      <circle
        cx="11.45"
        cy="7.45"
        r="2.15"
        fill={`color-mix(in srgb, ${color} 20%, transparent)`}
        stroke={color}
        strokeWidth={strokeWidth * 0.72}
      />
      <path
        d="M11.45 5.3v2.15h2.15"
        fill={color}
        stroke={color}
        strokeWidth={strokeWidth * 0.72}
        strokeLinejoin="round"
      />
      <path
        d="M10.25 11.15h2.85"
        stroke={color}
        strokeWidth={strokeWidth * 0.86}
        strokeLinecap="round"
        opacity="0.72"
      />
      <rect x="2.1" y="5.15" width="7.25" height="8.35" rx="1.15" fill={color} />
      <path
        d="M4.45 11.25v-3.8h1.3c1.18 0 1.88.57 1.88 1.55s-.7 1.55-1.88 1.55h-1.3M4.45 7.45v3.8"
        stroke="#fff"
        strokeWidth=".82"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DocumentLinesSymbol({ color }: { color: string }) {
  return (
    <path
      d="M5.4 7.55h6.25M5.4 9.55h6.25M5.4 11.55h4.3"
      stroke={color}
      strokeWidth="1.05"
      strokeLinecap="round"
      opacity="0.9"
    />
  );
}

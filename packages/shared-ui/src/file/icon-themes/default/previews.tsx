import type { ReactNode } from "react";
import type {
  FileIconPreviewContext,
  FileIconRenderContext,
  FileIconRendererMap,
} from "../iconThemeTypes";
import {
  DocShell,
  renderCenteredIcon,
  renderDocShellPreview,
  renderFolderPreview,
  SNIPPET_PREVIEW_KINDS,
} from "../shared/PreviewShell";
import { DatabaseGlyph } from "../shared/semanticGlyphs";
import { renderDefaultFolderPreviewGlyph } from "./glyphs";

const DEFAULT_PREVIEW_GLYPH_RENDERERS = {
  folder: renderDefaultFolderPreviewGlyph,
  app: renderDefaultAppPreviewGlyph,
  "context-map": renderDefaultWorkflowPreviewGlyph,
  workflow: renderDefaultWorkflowPreviewGlyph,
  markdown: renderDefaultDocumentPreviewGlyph,
  json: renderDefaultDocumentPreviewGlyph,
  html: renderDefaultCodePreviewGlyph,
  image: renderDefaultImagePreviewGlyph,
  audio: renderDefaultAudioPreviewGlyph,
  pdf: renderDefaultDocumentPreviewGlyph,
  video: renderDefaultVideoPreviewGlyph,
  word: renderDefaultWordPreviewGlyph,
  excel: renderDefaultExcelPreviewGlyph,
  spreadsheet: renderDefaultSpreadsheetPreviewGlyph,
  database: DatabaseGlyph,
  presentation: renderDefaultPresentationPreviewGlyph,
  archive: renderDefaultArchivePreviewGlyph,
  document: renderDefaultDocumentPreviewGlyph,
  binary: renderDefaultDocumentPreviewGlyph,
  code: renderDefaultCodePreviewGlyph,
  text: renderDefaultDocumentPreviewGlyph,
  file: renderDefaultDocumentPreviewGlyph,
} satisfies FileIconRendererMap<FileIconRenderContext>;

export function renderDefaultPreview(
  context: FileIconPreviewContext,
): ReactNode {
  if (context.kind === "folder") {
    return renderFolderPreview(
      context,
      DEFAULT_PREVIEW_GLYPH_RENDERERS.folder(context),
    );
  }

  if (context.kind === "database") {
    return renderCenteredIcon(
      context.size,
      renderDefaultPreviewGlyph({ ...context, size: Math.round(context.size * 0.78) }),
    );
  }

  if (SNIPPET_PREVIEW_KINDS.has(context.kind) && context.snippet) {
    return (
      <DocShell size={context.size}>
        <div
          style={{
            height: "100%",
            overflow: "hidden",
            color: context.kind === "json" ? "var(--po-file-accent-json)" : "var(--po-text-muted)",
            fontFamily: "var(--po-font-sans)",
            fontSize: Math.round(Math.max(4, context.size * 0.078)),
            lineHeight: 1.45,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {context.snippet}
        </div>
      </DocShell>
    );
  }

  return renderDocShellPreview(context, renderDefaultPreviewGlyph(context));
}

function renderDefaultPreviewGlyph(context: FileIconRenderContext): ReactNode {
  return DEFAULT_PREVIEW_GLYPH_RENDERERS[context.kind](context);
}

function renderDefaultImagePreviewGlyph({
  color,
}: FileIconRenderContext): ReactNode {
  return (
    <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden>
      <rect x="5.5" y="7" width="21" height="17.5" rx="2.4" stroke={color} strokeWidth="2" />
      <path d="M7.5 22.5 13 16.9l4.2 4.1 3.7-5 4.1 6.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="21.7" cy="11.8" r="1.85" fill={color} />
    </svg>
  );
}

function renderDefaultAppPreviewGlyph({
  color,
}: FileIconRenderContext): ReactNode {
  return (
    <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden>
      <path
        d="M9.25 20.35h13.5c1.22 0 2.18.84 2.39 2.04l.6 3.43H6.26l.6-3.43c.21-1.2 1.17-2.04 2.39-2.04Z"
        fill="color-mix(in srgb, var(--po-file-icon-body) 68%, transparent)"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M16.9 20.35 15.35 12.1" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx="14.95" cy="8.7" r="3.55" fill="color-mix(in srgb, var(--po-file-icon-body) 68%, transparent)" stroke={color} strokeWidth="2" />
      <circle cx="21.5" cy="23.6" r="1.15" fill={color} opacity="0.78" />
      <circle cx="10.65" cy="23.6" r="0.9" fill={color} opacity="0.56" />
    </svg>
  );
}

function renderDefaultWorkflowPreviewGlyph({
  color,
}: FileIconRenderContext): ReactNode {
  return (
    <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden>
      <rect x="6" y="6" width="9" height="9" rx="2.4" stroke={color} strokeWidth="2" />
      <path d="M10.5 15v4.4c0 1.55 1.25 2.8 2.8 2.8H17" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="17" y="17" width="9" height="9" rx="2.4" stroke={color} strokeWidth="2" />
    </svg>
  );
}

function renderDefaultAudioPreviewGlyph({
  color,
}: FileIconRenderContext): ReactNode {
  return (
    <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden>
      <path d="M6.5 19.5v-7h4.4l7.1-4.7v16.4l-7.1-4.7H6.5Z" fill={color} />
      <path d="M21.1 11.4c2.1 2.35 2.1 6.85 0 9.2" stroke={color} strokeWidth="2.1" strokeLinecap="round" />
      <path d="M24.8 8.7c3.5 3.95 3.5 10.65 0 14.6" stroke={color} strokeWidth="1.8" strokeLinecap="round" opacity="0.72" />
    </svg>
  );
}

function renderDefaultVideoPreviewGlyph({
  color,
}: FileIconRenderContext): ReactNode {
  return (
    <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden>
      <rect x="5.5" y="8" width="21" height="16" rx="2.4" stroke={color} strokeWidth="2" />
      <path d="m14 12.4 7 3.6-7 3.6v-7.2Z" fill={color} />
    </svg>
  );
}

function renderDefaultCodePreviewGlyph({
  color,
  kind,
}: FileIconRenderContext): ReactNode {
  return (
    <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden>
      <path d="m13.2 10.2-5.1 5.9 5.1 5.8" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m18.8 10.2 5.1 5.9-5.1 5.8" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      {kind === "html" && <path d="m17.9 9.7-3.8 12.6" stroke={color} strokeWidth="1.85" strokeLinecap="round" opacity="0.78" />}
    </svg>
  );
}

function renderDefaultSpreadsheetPreviewGlyph({
  color,
}: FileIconRenderContext): ReactNode {
  return (
    <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden>
      <rect x="6.5" y="7" width="19" height="18" rx="2" stroke={color} strokeWidth="2" />
      <path d="M6.5 13h19M6.5 19h19M13 7v18M19.5 7v18" stroke={color} strokeWidth="1.4" opacity="0.84" />
    </svg>
  );
}

function renderDefaultWordPreviewGlyph({
  color,
}: FileIconRenderContext): ReactNode {
  return (
    <svg
      viewBox="0 0 32 32"
      width="100%"
      height="100%"
      fill="none"
      aria-hidden
      data-file-icon-office="word"
    >
      <rect x="4" y="6" width="11.5" height="20" rx="2.2" fill={color} />
      <path
        d="m6.45 11.15 1.35 9 2-5.9 2 5.9 1.35-9"
        stroke="#fff"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18.5 10h9M18.5 14.5h9M18.5 19h7M18.5 23.5h5"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity="0.82"
      />
    </svg>
  );
}

function renderDefaultExcelPreviewGlyph({
  color,
}: FileIconRenderContext): ReactNode {
  return (
    <svg
      viewBox="0 0 32 32"
      width="100%"
      height="100%"
      fill="none"
      aria-hidden
      data-file-icon-office="excel"
    >
      <rect x="7" y="5" width="21" height="22" rx="2.2" stroke={color} strokeWidth="1.8" />
      <path
        d="M7 11h21M7 17h21M7 23h21M14 5v22M21 5v22"
        stroke={color}
        strokeWidth="1.25"
        opacity="0.76"
      />
      <rect x="3.5" y="9.5" width="10.5" height="15" rx="2" fill={color} />
      <path
        d="m6.7 14 4.1 6M10.8 14l-4.1 6"
        stroke="#fff"
        strokeWidth="1.55"
        strokeLinecap="round"
      />
    </svg>
  );
}

function renderDefaultPresentationPreviewGlyph({
  color,
}: FileIconRenderContext): ReactNode {
  return (
    <svg
      viewBox="0 0 32 32"
      width="100%"
      height="100%"
      fill="none"
      aria-hidden
      data-file-icon-office="presentation"
    >
      <rect x="7" y="6.5" width="20.5" height="18.5" rx="2.2" stroke={color} strokeWidth="1.8" />
      <circle cx="21" cy="13" r="4.1" fill={`color-mix(in srgb, ${color} 20%, transparent)`} stroke={color} strokeWidth="1.45" />
      <path d="M21 8.9V13h4.1" fill={color} stroke={color} strokeWidth="1.45" strokeLinejoin="round" />
      <path d="M17.5 21h7" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity="0.75" />
      <rect x="3.5" y="10" width="10.5" height="15" rx="2" fill={color} />
      <path
        d="M7 21v-7h2c2 0 3 .95 3 2.55S11 19 9 19H7"
        stroke="#fff"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function renderDefaultArchivePreviewGlyph({
  color,
}: FileIconRenderContext): ReactNode {
  return (
    <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden>
      <path d="M7.5 11 16 6.5l8.5 4.5v10L16 25.5 7.5 21V11Z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      <path d="M7.8 11.2 16 15.6l8.2-4.4M16 15.6v9.4" stroke={color} strokeWidth="1.6" strokeLinejoin="round" opacity="0.8" />
    </svg>
  );
}

function renderDefaultDocumentPreviewGlyph({
  color,
  size,
}: FileIconRenderContext): ReactNode {
  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: Math.max(1.4, Math.min(3, size * 0.055)) }}>
      {[82, 92, 62, 72].map((width, index) => (
        <span
          key={`${width}-${index}`}
          style={{
            width: `${width}%`,
            height: Math.max(1, Math.min(2, size * 0.035)),
            borderRadius: 999,
            background: color,
            opacity: 0.64 - index * 0.08,
          }}
        />
      ))}
    </div>
  );
}

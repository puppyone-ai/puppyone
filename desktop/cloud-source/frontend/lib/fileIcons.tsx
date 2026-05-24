import React from 'react';

export type FileVisualKind =
  | 'folder'
  | 'json'
  | 'markdown'
  | 'html'
  | 'pdf'
  | 'image'
  | 'audio'
  | 'video'
  | 'spreadsheet'
  | 'archive'
  | 'code'
  | 'text'
  | 'file';

const EXTENSION_KIND: Record<string, FileVisualKind> = {
  json: 'json',
  jsonl: 'json',
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  pdf: 'pdf',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  avif: 'image',
  heic: 'image',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  aac: 'audio',
  flac: 'audio',
  ogg: 'audio',
  opus: 'audio',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  avi: 'video',
  mkv: 'video',
  csv: 'spreadsheet',
  tsv: 'spreadsheet',
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  tar: 'archive',
  gz: 'archive',
  tgz: 'archive',
  js: 'code',
  jsx: 'code',
  ts: 'code',
  tsx: 'code',
  css: 'code',
  scss: 'code',
  py: 'code',
  rb: 'code',
  go: 'code',
  rs: 'code',
  java: 'code',
  c: 'code',
  cpp: 'code',
  h: 'code',
  sh: 'code',
  yml: 'code',
  yaml: 'code',
  xml: 'code',
  toml: 'code',
  txt: 'text',
  log: 'text',
};

const KIND_ACCENT: Record<FileVisualKind, string> = {
  folder: 'var(--po-accent)',
  json: 'var(--po-file-accent-json)',
  markdown: 'var(--po-file-accent-markdown)',
  html: 'var(--po-file-accent-html)',
  pdf: 'var(--po-file-accent-pdf)',
  image: 'var(--po-file-accent-image)',
  audio: 'var(--po-file-accent-audio)',
  video: 'var(--po-file-accent-video)',
  spreadsheet: 'var(--po-file-accent-sheet)',
  archive: 'var(--po-file-accent-pdf)',
  code: 'var(--po-file-accent-code)',
  text: 'var(--po-file-accent-default)',
  file: 'var(--po-file-accent-default)',
};

export function getFileExtension(name: string): string | null {
  const match = /\.([^./]{1,12})$/.exec(name.trim());
  return match ? match[1].toLowerCase() : null;
}

export function getFileVisualKind(name: string, type?: string | null): FileVisualKind {
  if (type === 'folder') return 'folder';
  if (type === 'json') return 'json';
  if (type === 'markdown') return 'markdown';
  if (type === 'html') return 'html';
  if (type === 'pdf') return 'pdf';
  if (type === 'image') return 'image';
  if (type === 'audio') return 'audio';
  if (type === 'video') return 'video';

  const ext = getFileExtension(name);
  return ext && EXTENSION_KIND[ext] ? EXTENSION_KIND[ext] : 'file';
}

export function getFileAccent(kind: FileVisualKind): string {
  return KIND_ACCENT[kind];
}

function DocShell({
  size,
  children,
}: Readonly<{
  size: number;
  children?: React.ReactNode;
}>) {
  const width = Math.round(size * 0.74);
  const height = Math.round(size * 0.9);
  const scale = width / 44;

  return (
    <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          position: 'relative',
          width,
          height,
          filter: 'drop-shadow(0 1px 1.5px var(--po-file-icon-shadow))',
        }}
      >
        <svg
          width={width}
          height={height}
          viewBox="0 0 44 54"
          fill="none"
          style={{ position: 'absolute', inset: 0 }}
          aria-hidden
        >
          <path
            d="M5.5 2.5H28.5L39.5 13.5V51.5H5.5V2.5Z"
            fill="var(--po-file-icon-body)"
            stroke="var(--po-file-icon-stroke)"
            strokeWidth="1.35"
            strokeLinejoin="round"
          />
          <path
            d="M28.5 2.5V13.5H39.5"
            stroke="var(--po-file-icon-stroke)"
            strokeWidth="1.35"
            strokeLinejoin="round"
          />
          <path d="M28.5 2.5V13.5H39.5L28.5 2.5Z" fill="var(--po-file-icon-fold)" />
        </svg>
        <div
          style={{
            position: 'absolute',
            top: 16 * scale,
            left: 8 * scale,
            right: 7 * scale,
            bottom: 6 * scale,
            overflow: 'hidden',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function LineSkeleton({
  color,
  size,
  widths = [72, 92, 58],
}: Readonly<{
  color: string;
  size: number;
  widths?: number[];
}>) {
  const lineHeight = Math.max(1, Math.min(2, size * 0.035));
  const gap = Math.max(1.4, Math.min(3, size * 0.055));

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap }}>
      {widths.map((width, index) => (
        <span
          key={`${width}-${index}`}
          style={{
            width: `${width}%`,
            height: lineHeight,
            borderRadius: 999,
            background: color,
            opacity: 0.64 - index * 0.08,
          }}
        />
      ))}
    </div>
  );
}

function DefaultGlyph({
  kind,
  label,
  size,
}: Readonly<{
  kind: FileVisualKind;
  label: string;
  size: number;
}>) {
  const color = getFileAccent(kind);

  if (kind === 'image') {
    return (
      <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden>
        <rect x="5.5" y="7" width="21" height="17.5" rx="2.4" stroke={color} strokeWidth="2" />
        <path d="M7.5 22.5 13 16.9l4.2 4.1 3.7-5 4.1 6.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="21.7" cy="11.8" r="1.85" fill={color} />
      </svg>
    );
  }

  if (kind === 'audio') {
    return (
      <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden>
        <path d="M6.5 19.5v-7h4.4l7.1-4.7v16.4l-7.1-4.7H6.5Z" fill={color} />
        <path d="M21.1 11.4c2.1 2.35 2.1 6.85 0 9.2" stroke={color} strokeWidth="2.1" strokeLinecap="round" />
        <path d="M24.8 8.7c3.5 3.95 3.5 10.65 0 14.6" stroke={color} strokeWidth="1.8" strokeLinecap="round" opacity="0.72" />
      </svg>
    );
  }

  if (kind === 'video') {
    return (
      <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden>
        <rect x="5.5" y="8" width="21" height="16" rx="2.4" stroke={color} strokeWidth="2" />
        <path d="m14 12.4 7 3.6-7 3.6v-7.2Z" fill={color} />
      </svg>
    );
  }

  if (kind === 'html' || kind === 'code') {
    return (
      <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden>
        <path d="m13.2 10.2-5.1 5.9 5.1 5.8" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m18.8 10.2 5.1 5.9-5.1 5.8" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        {kind === 'html' && <path d="m17.9 9.7-3.8 12.6" stroke={color} strokeWidth="1.85" strokeLinecap="round" opacity="0.78" />}
      </svg>
    );
  }

  if (kind === 'pdf') {
    return (
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: Math.max(2, Math.min(4, size * 0.075)) }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: Math.max(18, size * 0.36),
            height: Math.max(10, size * 0.18),
            borderRadius: 3,
            background: 'color-mix(in srgb, var(--po-file-accent-pdf) 14%, transparent)',
            color,
            fontSize: Math.max(6, Math.min(9.5, size * 0.17)),
            fontWeight: 800,
            letterSpacing: 0,
            lineHeight: 1,
          }}
        >
          PDF
        </span>
        <LineSkeleton color={color} size={size} widths={[86, 64, 74]} />
      </div>
    );
  }

  if (kind === 'markdown' || kind === 'text' || kind === 'file') {
    return <LineSkeleton color={color} size={size} widths={kind === 'markdown' ? [86, 68, 78, 48] : [82, 92, 62, 72]} />;
  }

  if (kind === 'spreadsheet') {
    return (
      <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden>
        <rect x="6.5" y="7" width="19" height="18" rx="2" stroke={color} strokeWidth="2" />
        <path d="M6.5 13h19M6.5 19h19M13 7v18M19.5 7v18" stroke={color} strokeWidth="1.4" opacity="0.84" />
      </svg>
    );
  }

  if (kind === 'archive') {
    return (
      <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden>
        <path d="M7.5 11 16 6.5l8.5 4.5v10L16 25.5 7.5 21V11Z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        <path d="M7.8 11.2 16 15.6l8.2-4.4M16 15.6v9.4" stroke={color} strokeWidth="1.6" strokeLinejoin="round" opacity="0.8" />
      </svg>
    );
  }

  return (
    <span
      style={{
        color,
        fontFamily: 'var(--po-font-sans)',
        fontSize: Math.max(6, Math.min(10, size * 0.18)),
        fontWeight: 800,
        letterSpacing: 0,
        textTransform: 'uppercase',
      }}
    >
      {label}
    </span>
  );
}

function getLabel(kind: FileVisualKind, name: string): string {
  if (kind === 'json') return '{}';
  if (kind === 'pdf') return 'PDF';
  if (kind === 'html') return 'HTML';
  if (kind === 'audio') return 'MP3';
  if (kind === 'image') return getFileExtension(name)?.toUpperCase().slice(0, 4) || 'IMG';
  if (kind === 'markdown') return 'M';
  return getFileExtension(name)?.toUpperCase().slice(0, 4) || 'FILE';
}

export function FilePreviewIcon({
  name,
  type,
  size = 56,
  snippet,
  childrenCount,
}: Readonly<{
  name: string;
  type?: string | null;
  size?: number;
  snippet?: string | null;
  childrenCount?: number | null;
}>) {
  const kind = getFileVisualKind(name, type);

  if (kind === 'folder') {
    return (
      <div style={{ position: 'relative', width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img src="/icons/folder.svg" alt="" width={size} height={size} style={{ display: 'block' }} />
        {childrenCount != null && childrenCount > 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              right: -4,
              minWidth: 18,
              padding: '1px 5px',
              borderRadius: 8,
              border: '1px solid var(--po-border)',
              background: 'var(--po-panel-raised)',
              color: 'var(--po-text-muted)',
              fontSize: 10,
              fontWeight: 600,
              lineHeight: '14px',
              textAlign: 'center',
            }}
          >
            {childrenCount}
          </div>
        )}
      </div>
    );
  }

  if ((kind === 'markdown' || kind === 'json') && snippet) {
    return (
      <DocShell size={size}>
        <div
          style={{
            height: '100%',
            overflow: 'hidden',
            color: kind === 'json' ? 'var(--po-file-accent-json)' : 'var(--po-text-muted)',
            fontFamily: kind === 'json' ? 'var(--po-font-sans)' : 'var(--po-font-sans)',
            fontSize: Math.max(4, size * 0.078),
            lineHeight: 1.45,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {snippet}
        </div>
      </DocShell>
    );
  }

  return (
    <DocShell size={size}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', minWidth: 0 }}>
        <DefaultGlyph kind={kind} label={getLabel(kind, name)} size={size} />
      </div>
    </DocShell>
  );
}

export function FileGlyphIcon({
  name,
  type,
  size = 18,
}: Readonly<{
  name: string;
  type?: string | null;
  size?: number;
}>) {
  const kind = getFileVisualKind(name, type);
  const color = getFileAccent(kind);

  if (kind === 'folder') {
    return <img src="/icons/folder.svg" alt="" width={size} height={size} style={{ display: 'block' }} />;
  }

  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden>
      {kind === 'audio' ? (
        <>
          <path d="M2.6 10.9V7.1h2.25L8.7 4.35v9.3L4.85 10.9H2.6Z" fill={color} />
          <path d="M10.8 6.55c1.05 1.1 1.05 2.8 0 3.9" stroke={color} strokeWidth="1.45" strokeLinecap="round" />
          <path d="M12.95 5.05c1.8 1.95 1.8 5.9 0 7.9" stroke={color} strokeWidth="1.25" strokeLinecap="round" opacity="0.78" />
        </>
      ) : kind === 'image' ? (
        <>
          <rect x="2.75" y="3.75" width="12.5" height="10.5" rx="1.25" stroke={color} strokeWidth="1.45" />
          <path d="M3.8 12.5 6.35 9.65l2.05 2.1 2.35-3.05 3.35 3.8" stroke={color} strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="10.85" y="5.6" width="2" height="2" rx="0.35" fill={color} />
        </>
      ) : kind === 'html' || kind === 'code' ? (
        <>
          <path d="m7.05 5.15-3.5 3.75 3.5 3.75" stroke={color} strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
          <path d="m10.95 5.15 3.5 3.75-3.5 3.75" stroke={color} strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
          {kind === 'html' && <path d="M9.95 4.95 8.05 12.9" stroke={color} strokeWidth="1.35" strokeLinecap="round" opacity="0.86" />}
        </>
      ) : kind === 'json' ? (
        <text
          x="9"
          y="12.35"
          textAnchor="middle"
          fontSize="9.5"
          fontWeight="800"
          fontFamily="var(--po-font-sans)"
          fill={color}
        >
          {'{}'}
        </text>
      ) : (
        <>
          <path
            d="M5.1 2.75h5.65l2.6 2.65v8.5c0 .5-.4.9-.9.9h-7.35c-.5 0-.9-.4-.9-.9V3.65c0-.5.4-.9.9-.9Z"
            fill="color-mix(in srgb, var(--po-file-icon-body) 65%, transparent)"
            stroke={color}
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <path d="M10.75 2.95v2.45h2.4" stroke={color} strokeWidth="1" strokeLinejoin="round" />
          {kind === 'markdown' ? (
            <text
              x="8.8"
              y="12.3"
              textAnchor="middle"
              fontSize="7.6"
              fontWeight="780"
              fontFamily="var(--po-font-sans)"
              fill={color}
            >
              M
            </text>
          ) : null}
          {(kind === 'pdf' || kind === 'text' || kind === 'file' || kind === 'spreadsheet' || kind === 'archive') && (
            <path d="M5.85 8.25h5.2M5.85 10.25h5.2M5.85 12.25h3.65" stroke={color} strokeWidth="1.05" strokeLinecap="round" opacity="0.9" />
          )}
        </>
      )}
    </svg>
  );
}

export function getFileIcon(filename: string, size = 48): React.ReactNode {
  return <FilePreviewIcon name={filename} size={size} />;
}

export const FILE_TYPE_ICONS = {
  folder: <FileGlyphIcon name="folder" type="folder" size={14} />,
  table: <FileGlyphIcon name="data.json" type="json" size={14} />,
  markdown: <FileGlyphIcon name="document.md" type="markdown" size={14} />,
};

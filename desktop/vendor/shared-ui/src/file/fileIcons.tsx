import type { ReactNode } from "react";
import {
  File as LucideFile,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder as LucideFolder,
  type LucideIcon,
} from "lucide-react";
import { getFileSemanticKind, getMatchedExtension } from "../core/fileFormats";

export type FileVisualKind =
  | "folder"
  | "json"
  | "markdown"
  | "html"
  | "pdf"
  | "image"
  | "audio"
  | "video"
  | "spreadsheet"
  | "archive"
  | "document"
  | "binary"
  | "code"
  | "text"
  | "file";

export const FILE_ICON_THEMES = [
  {
    id: "default",
    label: "Default",
    description: "PuppyOne classic file icons.",
  },
  {
    id: "vscode",
    label: "VS Code",
    description: "VS Code-style semantic file icons.",
  },
  {
    id: "material",
    label: "Material",
    description: "Filled, colorful document icons.",
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Thin outline icons.",
  },
] as const;

export type FileIconThemeId = (typeof FILE_ICON_THEMES)[number]["id"];

const KIND_ACCENT: Record<FileVisualKind, string> = {
  folder: "var(--po-file-accent-default)",
  json: "var(--po-file-accent-json)",
  markdown: "var(--po-file-accent-markdown)",
  html: "var(--po-file-accent-html)",
  pdf: "var(--po-file-accent-pdf)",
  image: "var(--po-file-accent-image)",
  audio: "var(--po-file-accent-audio)",
  video: "var(--po-file-accent-video)",
  spreadsheet: "var(--po-file-accent-sheet)",
  archive: "var(--po-file-accent-pdf)",
  document: "var(--po-file-accent-default)",
  binary: "var(--po-file-accent-default)",
  code: "var(--po-file-accent-code)",
  text: "var(--po-file-accent-default)",
  file: "var(--po-file-accent-default)",
};

const FILE_ICON_THEME_IDS = new Set<string>(FILE_ICON_THEMES.map((theme) => theme.id));

export function getFileExtension(name: string): string | null {
  return getMatchedExtension(name.trim());
}

export function getFileVisualKind(name: string, type?: string | null): FileVisualKind {
  return getFileSemanticKind(name, type);
}

export function getFileAccent(kind: FileVisualKind): string {
  return KIND_ACCENT[kind];
}

export function isFileIconThemeId(value: string | null | undefined): value is FileIconThemeId {
  return typeof value === "string" && FILE_ICON_THEME_IDS.has(value);
}

export function FilePreviewIcon({
  name,
  type,
  size = 56,
  snippet,
  childrenCount,
  theme,
}: Readonly<{
  name: string;
  type?: string | null;
  size?: number;
  snippet?: string | null;
  childrenCount?: number | null;
  theme?: FileIconThemeId | null;
}>) {
  const kind = getFileVisualKind(name, type);
  const iconTheme = resolveFileIconTheme(theme);

  if (kind === "folder") {
    return (
      <div
        style={{
          position: "relative",
          width: size,
          height: size,
          display: "grid",
          placeItems: "center",
        }}
      >
        <FolderGlyph size={size} theme={iconTheme} />
        {childrenCount != null && childrenCount > 0 && (
          <span
            style={{
              position: "absolute",
              right: -4,
              bottom: -1,
              minWidth: 18,
              height: 18,
              padding: "0 5px",
              borderRadius: 999,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--po-panel-raised)",
              border: "1px solid var(--po-border)",
              color: "var(--po-text-muted)",
              fontSize: 10,
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            {childrenCount}
          </span>
        )}
      </div>
    );
  }

  if (iconTheme !== "default" && (kind === "markdown" || kind === "json") && snippet) {
    return (
      <div style={{ width: size, height: size, display: "grid", placeItems: "center" }}>
        <FileGlyphIcon name={name} type={type} size={Math.round(size * 0.78)} theme={iconTheme} />
      </div>
    );
  }

  if ((kind === "markdown" || kind === "json") && snippet) {
    return (
      <DocShell size={size}>
        <div
          style={{
            height: "100%",
            overflow: "hidden",
            color: kind === "json" ? "var(--po-file-accent-json)" : "var(--po-text-muted)",
            fontFamily: "var(--po-font-sans)",
            fontSize: Math.max(4, size * 0.078),
            lineHeight: 1.45,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {snippet}
        </div>
      </DocShell>
    );
  }

  return (
    <DocShell size={size}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          minWidth: 0,
        }}
      >
        <DefaultGlyph kind={kind} label={getLabel(kind, name)} size={size} theme={iconTheme} />
      </div>
    </DocShell>
  );
}

export function FileGlyphIcon({
  name,
  type,
  size = 18,
  theme,
}: Readonly<{
  name: string;
  type?: string | null;
  size?: number;
  theme?: FileIconThemeId | null;
}>) {
  const kind = getFileVisualKind(name, type);
  const color = getFileAccent(kind);
  const iconTheme = resolveFileIconTheme(theme);

  if (iconTheme === "vscode") return <VsCodeFileGlyph kind={kind} size={size} />;
  if (iconTheme === "material") return <MaterialFileGlyph kind={kind} size={size} />;
  if (iconTheme === "minimal") return <MinimalFileGlyph kind={kind} size={size} />;

  if (kind === "folder") return <FolderGlyph size={size} compact />;

  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden>
      {kind === "audio" ? (
        <>
          <path d="M2.6 10.9V7.1h2.25L8.7 4.35v9.3L4.85 10.9H2.6Z" fill={color} />
          <path d="M10.8 6.55c1.05 1.1 1.05 2.8 0 3.9" stroke={color} strokeWidth="1.45" strokeLinecap="round" />
          <path d="M12.95 5.05c1.8 1.95 1.8 5.9 0 7.9" stroke={color} strokeWidth="1.25" strokeLinecap="round" opacity="0.78" />
        </>
      ) : kind === "image" ? (
        <>
          <rect x="2.75" y="3.75" width="12.5" height="10.5" rx="1.25" stroke={color} strokeWidth="1.45" />
          <path d="M3.8 12.5 6.35 9.65l2.05 2.1 2.35-3.05 3.35 3.8" stroke={color} strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="10.85" y="5.6" width="2" height="2" rx="0.35" fill={color} />
        </>
      ) : kind === "html" || kind === "code" ? (
        <>
          <path d="m7.05 5.15-3.5 3.75 3.5 3.75" stroke={color} strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
          <path d="m10.95 5.15 3.5 3.75-3.5 3.75" stroke={color} strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
          {kind === "html" && <path d="M9.95 4.95 8.05 12.9" stroke={color} strokeWidth="1.35" strokeLinecap="round" opacity="0.86" />}
        </>
      ) : kind === "json" ? (
        <text
          x="9"
          y="12.35"
          textAnchor="middle"
          fontSize="9.5"
          fontWeight="800"
          fontFamily="var(--po-font-sans)"
          fill={color}
        >
          {"{}"}
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
          {kind === "markdown" ? (
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
          {(kind === "pdf" || kind === "text" || kind === "file" || kind === "spreadsheet" || kind === "archive" || kind === "document" || kind === "binary") && (
            <path d="M5.85 8.25h5.2M5.85 10.25h5.2M5.85 12.25h3.65" stroke={color} strokeWidth="1.05" strokeLinecap="round" opacity="0.9" />
          )}
        </>
      )}
    </svg>
  );
}

export function getFileIcon(filename: string, size = 48, theme?: FileIconThemeId | null): ReactNode {
  return <FilePreviewIcon name={filename} size={size} theme={theme} />;
}

export const FILE_TYPE_ICONS = {
  folder: <FileGlyphIcon name="folder" type="folder" size={14} />,
  table: <FileGlyphIcon name="data.json" type="json" size={14} />,
  markdown: <FileGlyphIcon name="document.md" type="markdown" size={14} />,
};

function DocShell({
  size,
  children,
}: Readonly<{
  size: number;
  children?: ReactNode;
}>) {
  const width = Math.round(size * 0.74);
  const height = Math.round(size * 0.9);
  const scale = width / 44;

  return (
    <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          position: "relative",
          width,
          height,
          filter: "drop-shadow(0 1px 1.5px var(--po-file-icon-shadow))",
        }}
      >
        <svg width={width} height={height} viewBox="0 0 44 54" fill="none" style={{ position: "absolute", inset: 0 }} aria-hidden>
          <path
            d="M5.5 2.5H28.5L39.5 13.5V51.5H5.5V2.5Z"
            fill="var(--po-file-icon-body)"
            stroke="var(--po-file-icon-stroke)"
            strokeWidth="1.35"
            strokeLinejoin="round"
          />
          <path d="M28.5 2.5V13.5H39.5" stroke="var(--po-file-icon-stroke)" strokeWidth="1.35" strokeLinejoin="round" />
          <path d="M28.5 2.5V13.5H39.5L28.5 2.5Z" fill="var(--po-file-icon-fold)" />
        </svg>
        <div
          style={{
            position: "absolute",
            top: 16 * scale,
            left: 8 * scale,
            right: 7 * scale,
            bottom: 6 * scale,
            overflow: "hidden",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function DefaultGlyph({
  kind,
  label,
  size,
  theme = "default",
}: Readonly<{
  kind: FileVisualKind;
  label: string;
  size: number;
  theme?: FileIconThemeId;
}>) {
  const color = getFileAccent(kind);

  if (theme !== "default") {
    return <ThemedPreviewGlyph kind={kind} label={label} size={size} theme={theme} />;
  }

  if (kind === "image") {
    return (
      <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden>
        <rect x="5.5" y="7" width="21" height="17.5" rx="2.4" stroke={color} strokeWidth="2" />
        <path d="M7.5 22.5 13 16.9l4.2 4.1 3.7-5 4.1 6.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="21.7" cy="11.8" r="1.85" fill={color} />
      </svg>
    );
  }

  if (kind === "audio") {
    return (
      <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden>
        <path d="M6.5 19.5v-7h4.4l7.1-4.7v16.4l-7.1-4.7H6.5Z" fill={color} />
        <path d="M21.1 11.4c2.1 2.35 2.1 6.85 0 9.2" stroke={color} strokeWidth="2.1" strokeLinecap="round" />
        <path d="M24.8 8.7c3.5 3.95 3.5 10.65 0 14.6" stroke={color} strokeWidth="1.8" strokeLinecap="round" opacity="0.72" />
      </svg>
    );
  }

  if (kind === "video") {
    return (
      <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden>
        <rect x="5.5" y="8" width="21" height="16" rx="2.4" stroke={color} strokeWidth="2" />
        <path d="m14 12.4 7 3.6-7 3.6v-7.2Z" fill={color} />
      </svg>
    );
  }

  if (kind === "html" || kind === "code") {
    return (
      <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden>
        <path d="m13.2 10.2-5.1 5.9 5.1 5.8" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m18.8 10.2 5.1 5.9-5.1 5.8" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        {kind === "html" && <path d="m17.9 9.7-3.8 12.6" stroke={color} strokeWidth="1.85" strokeLinecap="round" opacity="0.78" />}
      </svg>
    );
  }

  if (kind === "spreadsheet") {
    return (
      <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden>
        <rect x="6.5" y="7" width="19" height="18" rx="2" stroke={color} strokeWidth="2" />
        <path d="M6.5 13h19M6.5 19h19M13 7v18M19.5 7v18" stroke={color} strokeWidth="1.4" opacity="0.84" />
      </svg>
    );
  }

  if (kind === "archive") {
    return (
      <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden>
        <path d="M7.5 11 16 6.5l8.5 4.5v10L16 25.5 7.5 21V11Z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        <path d="M7.8 11.2 16 15.6l8.2-4.4M16 15.6v9.4" stroke={color} strokeWidth="1.6" strokeLinejoin="round" opacity="0.8" />
      </svg>
    );
  }

  if (kind === "markdown" || kind === "text" || kind === "file" || kind === "pdf" || kind === "json" || kind === "document" || kind === "binary") {
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

  return (
    <span
      style={{
        color,
        fontFamily: "var(--po-font-sans)",
        fontSize: Math.max(6, Math.min(10, size * 0.18)),
        fontWeight: 800,
        letterSpacing: 0,
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
  );
}

function ThemedPreviewGlyph({
  kind,
  label,
  size,
  theme,
}: Readonly<{
  kind: FileVisualKind;
  label: string;
  size: number;
  theme: FileIconThemeId;
}>) {
  const glyphSize = Math.max(18, Math.round(size * 0.5));

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "grid",
        placeItems: "center",
      }}
    >
      {theme === "vscode" ? (
        <VsCodeFileGlyph kind={kind} size={glyphSize} label={label} />
      ) : theme === "material" ? (
        <MaterialFileGlyph kind={kind} size={glyphSize} />
      ) : (
        <MinimalFileGlyph kind={kind} size={glyphSize} />
      )}
    </div>
  );
}

function VsCodeFileGlyph({
  kind,
  size,
  label,
}: {
  kind: FileVisualKind;
  size: number;
  label?: string;
}) {
  const color = getVsCodeAccent(kind);
  const fill = getVsCodeFill(kind);
  const foldFill = getVsCodeFoldFill(kind);

  if (kind === "folder") return <VsCodeFolderGlyph size={size} />;

  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M4.35 2.25h6.35l3.05 3.05v9.3c0 .62-.5 1.12-1.12 1.12H4.35c-.62 0-1.12-.5-1.12-1.12V3.37c0-.62.5-1.12 1.12-1.12Z"
        fill={fill}
      />
      <path d="M10.7 2.25V5.3h3.05" fill={foldFill} />
      <VsCodeSymbol kind={kind} color={color} label={label} />
    </svg>
  );
}

function VsCodeFolderGlyph({ size }: { size: number }) {
  const tabFill = "color-mix(in srgb, #dcb67a 70%, var(--po-file-icon-body))";
  const bodyFill = "color-mix(in srgb, #c99646 76%, var(--po-file-icon-body))";

  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M1.85 5.2c0-.72.58-1.3 1.3-1.3h4.2l1.35 1.45h6.15c.72 0 1.3.58 1.3 1.3v6.25c0 .72-.58 1.3-1.3 1.3H3.15c-.72 0-1.3-.58-1.3-1.3V5.2Z"
        fill={tabFill}
      />
      <path d="M2.05 7h13.9v5.95c0 .7-.57 1.25-1.25 1.25H3.3c-.68 0-1.25-.55-1.25-1.25V7Z" fill={bodyFill} />
    </svg>
  );
}

function VsCodeSymbol({
  kind,
  color,
  label,
}: {
  kind: FileVisualKind;
  color: string;
  label?: string;
}) {
  if (kind === "markdown") return <MarkdownMark color={color} />;
  if (kind === "json") {
    return (
      <text x="8.75" y="12.15" textAnchor="middle" fontSize="8.2" fontWeight="850" fontFamily="var(--po-font-sans)" fill={color}>
        {"{}"}
      </text>
    );
  }
  if (kind === "html" || kind === "code") {
    return (
      <>
        <path d="m7.1 6.05-2.6 2.85 2.6 2.85" stroke={color} strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m10.9 6.05 2.6 2.85-2.6 2.85" stroke={color} strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
        {kind === "html" && <path d="M9.95 5.75 8.05 12.25" stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.82" />}
      </>
    );
  }
  if (kind === "image") {
    return (
      <>
        <rect x="5" y="6.15" width="8" height="6.3" rx="0.75" stroke={color} strokeWidth="1" />
        <path d="m5.55 11.85 1.65-1.75 1.35 1.15 1.6-2.05 2.3 2.65" stroke={color} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="11.45" cy="7.65" r="0.58" fill={color} />
      </>
    );
  }
  if (kind === "audio") {
    return (
      <>
        <path d="M5.15 10.55v-3.1h1.75l2.4-1.75v6.6l-2.4-1.75H5.15Z" fill={color} />
        <path d="M11.25 7.1c.85.9.85 2.9 0 3.8" stroke={color} strokeWidth="1.05" strokeLinecap="round" />
      </>
    );
  }
  if (kind === "video") {
    return (
      <>
        <rect x="4.95" y="5.95" width="8.1" height="6.6" rx="0.85" stroke={color} strokeWidth="1" />
        <path d="m8.1 7.55 3.05 1.7-3.05 1.7v-3.4Z" fill={color} />
      </>
    );
  }
  if (kind === "spreadsheet") {
    return (
      <>
        <rect x="5" y="5.7" width="8" height="7.2" rx="0.6" stroke={color} strokeWidth="1" />
        <path d="M5.1 8.1h7.8M5.1 10.55h7.8M7.7 5.8v7M10.3 5.8v7" stroke={color} strokeWidth="0.65" opacity="0.86" />
      </>
    );
  }
  if (kind === "archive") {
    return (
      <>
        <path d="M5.15 7.15 9 5.1l3.85 2.05v4.15L9 13.35 5.15 11.3V7.15Z" stroke={color} strokeWidth="1" strokeLinejoin="round" />
        <path d="M5.35 7.25 9 9.2l3.65-1.95M9 9.2v3.8" stroke={color} strokeWidth="0.8" opacity="0.86" />
      </>
    );
  }

  return (
    <text
      x="8.75"
      y="11.55"
      textAnchor="middle"
      fontSize={kind === "pdf" ? "4.2" : "5.5"}
      fontWeight="850"
      fontFamily="var(--po-font-sans)"
      fill={color}
    >
      {kind === "pdf" ? "PDF" : label ?? getVsCodeLabel(kind)}
    </text>
  );
}

function getVsCodeAccent(kind: FileVisualKind): string {
  switch (kind) {
    case "markdown":
      return "var(--po-file-accent-markdown)";
    case "json":
      return "var(--po-file-accent-json)";
    case "html":
      return "var(--po-file-accent-html)";
    case "pdf":
      return "var(--po-file-accent-pdf)";
    case "image":
      return "var(--po-file-accent-image)";
    case "audio":
      return "var(--po-file-accent-audio)";
    case "video":
      return "var(--po-file-accent-video)";
    case "spreadsheet":
      return "var(--po-file-accent-sheet)";
    case "archive":
      return "var(--po-warning)";
    case "code":
      return "var(--po-file-accent-code)";
    case "document":
      return "var(--po-info)";
    case "binary":
      return "var(--po-file-accent-sheet)";
    case "text":
    case "file":
    default:
      return "var(--po-file-accent-default)";
  }
}

function getVsCodeFill(kind: FileVisualKind): string {
  const accent = getVsCodeAccent(kind);
  return `color-mix(in srgb, ${accent} 16%, var(--po-file-icon-body))`;
}

function getVsCodeFoldFill(kind: FileVisualKind): string {
  const accent = getVsCodeAccent(kind);
  return `color-mix(in srgb, ${accent} 13%, var(--po-file-icon-fold))`;
}

function getVsCodeLabel(kind: FileVisualKind): string {
  if (kind === "document") return "DOC";
  if (kind === "binary") return "BIN";
  if (kind === "text") return "TXT";
  return "FILE";
}

function MaterialFileGlyph({ kind, size }: { kind: FileVisualKind; size: number }) {
  const color = getFileAccent(kind);
  const tint = `color-mix(in srgb, ${color} 16%, var(--po-panel-raised))`;

  if (kind === "folder") return <FolderGlyph size={size} compact theme="material" />;

  if (kind === "audio") {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden>
        <path d="M2.7 10.75v-3.5h2.15l3.65-2.5v8.5l-3.65-2.5H2.7Z" fill={color} />
        <path d="M10.6 6.45c1.2 1.1 1.2 4 0 5.1" stroke={color} strokeWidth="1.55" strokeLinecap="round" />
        <path d="M12.8 5.2c1.85 2 1.85 5.6 0 7.6" stroke={color} strokeWidth="1.25" strokeLinecap="round" opacity="0.72" />
      </svg>
    );
  }

  if (kind === "image") {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden>
        <rect x="2.75" y="3.35" width="12.5" height="11" rx="1.8" fill={tint} stroke={color} strokeWidth="1.35" />
        <path d="M3.85 12.7 6.2 9.9l1.95 1.9 2.25-3 3.75 4" stroke={color} strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="11.95" cy="6.25" r="1.05" fill={color} />
      </svg>
    );
  }

  if (kind === "video") {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden>
        <rect x="2.75" y="4" width="12.5" height="10" rx="1.8" fill={tint} stroke={color} strokeWidth="1.35" />
        <path d="m7.25 6.6 4.7 2.4-4.7 2.4V6.6Z" fill={color} />
      </svg>
    );
  }

  if (kind === "html" || kind === "code") {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden>
        <rect x="2.55" y="3.15" width="12.9" height="11.7" rx="2.05" fill={tint} />
        <path d="m7 5.9-3 3.1 3 3.1" stroke={color} strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m11 5.9 3 3.1-3 3.1" stroke={color} strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
        {kind === "html" && <path d="M9.95 5.6 8.05 12.4" stroke={color} strokeWidth="1.2" strokeLinecap="round" opacity="0.82" />}
      </svg>
    );
  }

  if (kind === "spreadsheet") {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden>
        <rect x="3.5" y="2.9" width="11" height="12.2" rx="1.6" fill={tint} stroke={color} strokeWidth="1.25" />
        <path d="M3.6 6.8h10.8M3.6 10h10.8M7.15 3.1v11.8M10.85 3.1v11.8" stroke={color} strokeWidth="0.85" opacity="0.8" />
      </svg>
    );
  }

  if (kind === "archive") {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden>
        <path d="M3.4 6.1 9 3.05l5.6 3.05v5.8L9 14.95 3.4 11.9V6.1Z" fill={tint} stroke={color} strokeWidth="1.25" strokeLinejoin="round" />
        <path d="M3.65 6.25 9 9.15l5.35-2.9M9 9.15v5.45" stroke={color} strokeWidth="1.05" strokeLinejoin="round" opacity="0.8" />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M4.6 2.6h6.05l2.75 2.8v9c0 .55-.45 1-1 1H4.6c-.55 0-1-.45-1-1V3.6c0-.55.45-1 1-1Z"
        fill={tint}
        stroke={color}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M10.65 2.8v2.6h2.55" stroke={color} strokeWidth="0.95" strokeLinejoin="round" />
      {kind === "markdown" ? (
        <MarkdownMark color={color} />
      ) : kind === "json" ? (
        <text x="8.8" y="12.2" textAnchor="middle" fontSize="8.3" fontWeight="850" fontFamily="var(--po-font-sans)" fill={color}>
          {"{}"}
        </text>
      ) : kind === "pdf" ? (
        <text x="8.75" y="11.65" textAnchor="middle" fontSize="4.4" fontWeight="850" fontFamily="var(--po-font-sans)" fill={color}>
          PDF
        </text>
      ) : (
        <path d="M5.5 8.25h6M5.5 10.25h6M5.5 12.25h4.25" stroke={color} strokeWidth="1.05" strokeLinecap="round" opacity="0.85" />
      )}
    </svg>
  );
}

function MinimalFileGlyph({ kind, size }: { kind: FileVisualKind; size: number }) {
  const color = getFileAccent(kind);

  if (kind === "markdown") {
    return <MarkdownDocumentGlyph color={color} width={size} height={size} compact />;
  }

  const Icon = getMinimalLucideIcon(kind);
  return <Icon size={size} color={color} strokeWidth={1.85} aria-hidden="true" />;
}

function MarkdownDocumentGlyph({
  color,
  width,
  height,
  compact = false,
}: {
  color: string;
  width: number | string;
  height: number | string;
  compact?: boolean;
}) {
  return (
    <svg width={width} height={height} viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M4.9 2.75h5.85l2.6 2.65v8.55c0 .5-.4.9-.9.9H4.9c-.5 0-.9-.4-.9-.9V3.65c0-.5.4-.9.9-.9Z"
        stroke={color}
        strokeWidth={compact ? 1.35 : 1.2}
        strokeLinejoin="round"
      />
      <path d="M10.75 2.95v2.45h2.4" stroke={color} strokeWidth="1" strokeLinejoin="round" />
      <MarkdownMark color={color} />
    </svg>
  );
}

function MarkdownMark({ color }: { color: string }) {
  return (
    <>
      <path d="M5.55 8.25h1.05l1 1.55 1-1.55h1.05v3.95H8.7v-2.25l-1.1 1.55-1.1-1.55v2.25h-.95V8.25Z" fill={color} />
      <path d="M11.75 8.25v2.7m0 0-1.15-1.15m1.15 1.15 1.15-1.15" stroke={color} strokeWidth="1.05" strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

function getMinimalLucideIcon(kind: FileVisualKind): LucideIcon {
  if (kind === "folder") return LucideFolder;
  if (kind === "json") return FileJson;
  if (kind === "html" || kind === "code") return FileCode;
  if (kind === "image") return FileImage;
  if (kind === "audio") return FileAudio;
  if (kind === "video") return FileVideo;
  if (kind === "spreadsheet") return FileSpreadsheet;
  if (kind === "archive") return FileArchive;
  if (kind === "text" || kind === "document" || kind === "pdf") return FileText;
  return LucideFile;
}

function resolveFileIconTheme(theme?: FileIconThemeId | null): FileIconThemeId {
  return isFileIconThemeId(theme) ? theme : "default";
}

function FolderGlyph({
  size,
  compact = false,
  theme = "default",
}: {
  size: number;
  compact?: boolean;
  theme?: FileIconThemeId;
}) {
  const strokeWidth = compact ? 1.7 : 1.45;

  if (theme === "vscode") {
    return <VsCodeFolderGlyph size={size} />;
  }

  if (theme === "minimal") {
    return <LucideFolder size={size} color="var(--po-file-accent-default)" strokeWidth={compact ? 1.85 : 1.65} aria-hidden="true" />;
  }

  if (theme === "material") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M3 7.15c0-1.1.9-2 2-2h4.25l2 2H19c1.1 0 2 .9 2 2v7.55c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V7.15Z"
          fill="color-mix(in srgb, var(--po-file-accent-default) 24%, var(--po-panel-raised))"
          stroke="var(--po-file-accent-default)"
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
        <path
          d="M3.25 9.15h17.5"
          stroke="var(--po-file-accent-default)"
          strokeWidth={compact ? 1.35 : 1.15}
          strokeLinecap="round"
          opacity="0.56"
        />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3.5 6.5c0-1.1.9-2 2-2h4.1l2 2h6.9c1.1 0 2 .9 2 2v8.5c0 1.1-.9 2-2 2h-13c-1.1 0-2-.9-2-2V6.5Z"
        fill="color-mix(in srgb, var(--po-file-icon-body) 68%, transparent)"
        stroke="var(--po-file-accent-default)"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function getLabel(kind: FileVisualKind, name: string): string {
  if (kind === "json") return "{}";
  if (kind === "pdf") return "PDF";
  if (kind === "html") return "HTML";
  if (kind === "audio") return "MP3";
  if (kind === "image") return getFileExtension(name)?.toUpperCase().slice(0, 4) || "IMG";
  if (kind === "markdown") return "M";
  return getFileExtension(name)?.toUpperCase().slice(0, 4) || "FILE";
}

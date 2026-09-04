import type { ReactNode } from "react";
import type { FileVisualKind } from "../../fileIconTypes";
import type {
  FileIconPreviewContext,
  FileIconRenderContext,
  FileIconRenderer,
} from "../iconThemeTypes";

export const SNIPPET_PREVIEW_KINDS = new Set<FileVisualKind>(["markdown", "json"]);

export function renderIconThemePreview(
  context: FileIconPreviewContext,
  renderGlyph: FileIconRenderer<FileIconRenderContext>,
  renderFolderPreviewGlyph: FileIconRenderer<FileIconRenderContext>,
): ReactNode {
  if (context.kind === "folder") {
    return renderFolderPreview(context, renderFolderPreviewGlyph(context));
  }

  if (SNIPPET_PREVIEW_KINDS.has(context.kind) && context.snippet) {
    return renderCenteredIcon(
      context.size,
      renderGlyph({ ...context, size: Math.round(context.size * 0.78) }),
    );
  }

  return renderDocShellPreview(
    context,
    renderCenteredIcon(
      "100%",
      renderGlyph({ ...context, size: Math.max(18, Math.round(context.size * 0.5)) }),
    ),
  );
}

export function renderFolderPreview(
  context: FileIconPreviewContext,
  glyph: ReactNode,
): ReactNode {
  return (
    <div
      style={{
        position: "relative",
        width: context.size,
        height: context.size,
        display: "grid",
        placeItems: "center",
      }}
    >
      {glyph}
      {context.childrenCount != null && context.childrenCount > 0 && (
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
            fontSize: "var(--po-type-ui-micro, 11px)",
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          {context.childrenCount}
        </span>
      )}
    </div>
  );
}

export function renderDocShellPreview(
  context: FileIconRenderContext,
  children: ReactNode,
): ReactNode {
  return (
    <DocShell size={context.size}>
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
        {children}
      </div>
    </DocShell>
  );
}

export function renderCenteredIcon(size: number | string, children: ReactNode): ReactNode {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "grid",
        placeItems: "center",
      }}
    >
      {children}
    </div>
  );
}

export function DocShell({
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

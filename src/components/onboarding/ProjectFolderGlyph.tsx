import type { ProjectAssetPreview, ProjectAssetPreviewKind } from "../../types/electron";

export type ProjectFolderGlyphProps = {
  /** Up to three top-level assets shown peeking from between the folder's back and front. */
  previews?: readonly ProjectAssetPreview[];
  /** Compact miniature folder for List rows (`.fga.sm`). */
  size?: "md" | "sm";
};

const BADGE_LABEL: Partial<Record<ProjectAssetPreviewKind, string>> = {
  html: "HTML",
  md: "MD",
  csv: "CSV",
};

function renderPreviewContent(kind: ProjectAssetPreviewKind) {
  if (kind === "html") {
    return (
      <span className="project-folder-preview-bars">
        <i className="is-low" />
        <i className="is-mid" />
        <i className="is-high" />
      </span>
    );
  }
  if (kind === "csv") {
    return (
      <span className="project-folder-preview-grid">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
    );
  }
  return (
    <>
      <i className="project-folder-preview-line" />
      <i className="project-folder-preview-line is-short" />
    </>
  );
}

function ProjectPreviewSheet({
  preview,
  compact,
}: {
  preview: ProjectAssetPreview;
  compact: boolean;
}) {
  const badge = !compact ? BADGE_LABEL[preview.kind] ?? null : null;
  return (
    <span
      className="project-folder-preview"
      data-preview-kind={preview.kind}
      data-preview-name={preview.name}
      data-preview-snippet={preview.snippet ?? undefined}
    >
      <i className={`project-folder-preview-title ${preview.kind === "csv" ? "is-short" : ""}`} />
      {renderPreviewContent(preview.kind)}
      {badge && (
        <span className="project-folder-preview-badge" data-badge-kind={preview.kind}>
          {badge}
        </span>
      )}
    </span>
  );
}

/**
 * Every project's folder on Home and in the switcher rail. When `previews` are present,
 * up to three top-level assets peek out between the monochrome back and front; when empty
 * or omitted, it renders the calm empty folder without motion.
 */
export function ProjectFolderGlyph({
  previews,
  size = "md",
}: ProjectFolderGlyphProps = {}) {
  const sheets = previews?.slice(0, 3) ?? [];
  if (sheets.length > 0) {
    const compact = size === "sm";
    return (
      <span
        className={`project-folder-stage ${compact ? "is-compact" : ""}`}
        data-preview-count={sheets.length}
        aria-hidden="true"
      >
        <span className="project-folder-stage-back project-folder-back" />
        {sheets.map((preview, index) => (
          <ProjectPreviewSheet
            key={`${index}:${preview.name}`}
            preview={preview}
            compact={compact}
          />
        ))}
        <span className="project-folder-stage-front project-folder-front" />
      </span>
    );
  }

  return (
    <svg className="project-folder-glyph" viewBox="0 0 48 38" aria-hidden="true" focusable="false">
      <path
        className="project-folder-back"
        d="M4 6.5A3.5 3.5 0 0 1 7.5 3h10.3c.9 0 1.8.4 2.4 1.1L22.7 7h17.8A3.5 3.5 0 0 1 44 10.5V15H4z"
      />
      <path
        className="project-folder-front"
        d="M4 14.5A3.5 3.5 0 0 1 7.5 11h33a3.5 3.5 0 0 1 3.5 3.5v17a3.5 3.5 0 0 1-3.5 3.5h-33A3.5 3.5 0 0 1 4 31.5z"
      />
    </svg>
  );
}

import type { ProjectAssetPreview, ProjectAssetPreviewKind } from "../../types/electron";

export type ProjectFolderGlyphProps = {
  /** Up to three top-level assets shown peeking from between the folder's back and front. */
  previews?: readonly ProjectAssetPreview[];
  /** Compact miniature folder for List rows (`.fga.sm`). */
  size?: "md" | "sm";
};

const FOLDER_VIEWBOX = "0 0 104 78";
const FOLDER_BACK_PATH =
  "M6 12A6 6 0 0 1 12 6h23c2.1 0 4.1.9 5.5 2.5L45.2 14H92a6 6 0 0 1 6 6v50a6 6 0 0 1-6 6H12a6 6 0 0 1-6-6Z";
const FOLDER_FRONT_PATH =
  "M6 34a6 6 0 0 1 6-6h80a6 6 0 0 1 6 6v36a6 6 0 0 1-6 6H12a6 6 0 0 1-6-6Z";

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
 * Every project's folder on Home and in the switcher rail. Both empty and asset-bearing
 * folders share one SVG silhouette and baseline so adjacent projects align identically;
 * when `previews` exist, up to three calm preview sheets sit between the back and front.
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
        <svg className="project-folder-stage-back" viewBox={FOLDER_VIEWBOX} aria-hidden="true" focusable="false">
          <path className="project-folder-back" d={FOLDER_BACK_PATH} />
        </svg>
        {sheets.map((preview, index) => (
          <ProjectPreviewSheet
            key={`${index}:${preview.name}`}
            preview={preview}
            compact={compact}
          />
        ))}
        <svg className="project-folder-stage-front" viewBox={FOLDER_VIEWBOX} aria-hidden="true" focusable="false">
          <path className="project-folder-front" d={FOLDER_FRONT_PATH} />
        </svg>
      </span>
    );
  }

  return (
    <svg className="project-folder-glyph" viewBox={FOLDER_VIEWBOX} aria-hidden="true" focusable="false">
      <path className="project-folder-back" d={FOLDER_BACK_PATH} />
      <path className="project-folder-front" d={FOLDER_FRONT_PATH} />
    </svg>
  );
}

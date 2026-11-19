import type { ProjectAssetPreview, ProjectAssetPreviewKind } from "../../types/electron";

export type ComputerVisualPowerState = "running" | "provisioning" | "asleep";

export type ProjectComputerGlyphProps = Readonly<{
  kind?: "cloud" | "on-device";
  power?: ComputerVisualPowerState;
  previews?: readonly ProjectAssetPreview[];
  size?: "md" | "sm";
}>;

const MONITOR_VIEWBOX = "0 0 104 78";
const BADGE_LABEL: Partial<Record<ProjectAssetPreviewKind, string>> = {
  html: "HTML",
  md: "MD",
  csv: "CSV",
};

function renderPreviewBody(kind: ProjectAssetPreviewKind) {
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

function ScreenPreviewSheet({
  preview,
  compact,
}: {
  preview: ProjectAssetPreview;
  compact: boolean;
}) {
  const badge = !compact ? BADGE_LABEL[preview.kind] ?? null : null;
  const titleClass = preview.kind === "csv"
    ? "project-folder-preview-title is-short"
    : "project-folder-preview-title";
  return (
    <span
      className="project-computer-preview"
      data-preview-kind={preview.kind}
      data-preview-name={preview.name}
    >
      <i className={titleClass} />
      {renderPreviewBody(preview.kind)}
      {badge && (
        <span className="project-folder-preview-badge" data-badge-kind={preview.kind}>
          {badge}
        </span>
      )}
    </span>
  );
}

/**
 * Miniature computer monitor matching ProjectFolderGlyph's exact 104x78 (grid)
 * and 34x26 (list) stage geometry so cards, Agent badges, and labels align cleanly.
 */
export function ProjectComputerGlyph({
  kind = "on-device",
  power = "running",
  previews,
  size = "md",
}: ProjectComputerGlyphProps = {}) {
  const compact = size === "sm";
  const sheets = previews?.slice(0, 3) ?? [];
  const stageClass = compact
    ? "project-computer-stage is-compact"
    : "project-computer-stage";

  return (
    <span
      className={stageClass}
      data-computer-kind={kind}
      data-computer-power={power}
      data-preview-count={sheets.length}
      aria-hidden="true"
    >
      <svg className="project-computer-svg" viewBox={MONITOR_VIEWBOX} aria-hidden="true" focusable="false">
        <path
          className="project-computer-stand-neck"
          d="M45 62h14l2.5 8.5H42.5L45 62Z"
        />
        <rect
          className="project-computer-stand-base"
          x="33"
          y="70"
          width="38"
          height="3.5"
          rx="1.75"
        />
        <rect
          className="project-computer-chassis"
          x="8"
          y="6"
          width="88"
          height="57"
          rx="7"
        />
        <rect
          className="project-computer-viewport"
          x="12.5"
          y="10.5"
          width="79"
          height="43"
          rx="3.5"
        />
        <line
          className="project-computer-chin-rule"
          x1="9"
          y1="55.5"
          x2="95"
          y2="55.5"
        />
        {sheets.length === 0 && (
          <g className="project-computer-desktop-chrome">
            <rect x="17" y="15" width="24" height="3.2" rx="1.6" />
            <rect x="17" y="21" width="46" height="19" rx="2.5" />
            <rect x="66" y="21" width="20" height="11" rx="2" />
            <rect x="34" y="46.5" width="36" height="3.5" rx="1.75" />
          </g>
        )}
        <circle
          className="project-computer-led"
          cx="86.5"
          cy="59.2"
          r={compact ? "2.1" : "1.8"}
        />
      </svg>
      {sheets.length > 0 && (
        <span className="project-computer-preview-deck">
          {sheets.map((preview, index) => (
            <ScreenPreviewSheet
              key={`${index}:${preview.name}`}
              preview={preview}
              compact={compact}
            />
          ))}
        </span>
      )}
    </span>
  );
}

import { CLOUD_ICON_PATH } from "@puppyone/shared-ui";

/**
 * The website's folder in its monochrome form, the same soft folder as the Puppy
 * mark: a back with its tall tab and a lighter front, both mixed from the page and
 * drawn in fill alone. The back stops behind the front so that only the front's edge
 * meets the page: where two fills share an edge, the darker one shows through the
 * anti-aliasing as a faint outline. A Cloud project is the same folder with the
 * product's cloud outlined on its front, the way macOS marks Documents and Downloads.
 * The mark says where it lives. A sheet waits behind the front.
 */
export function ProjectFolderGlyph({ cloud = false }: { cloud?: boolean }) {
  return (
    <svg className="project-folder-glyph" viewBox="0 0 48 38" aria-hidden="true" focusable="false">
      <path
        className="project-folder-back"
        d="M4 6.5A3.5 3.5 0 0 1 7.5 3h10.3c.9 0 1.8.4 2.4 1.1L22.7 7h17.8A3.5 3.5 0 0 1 44 10.5V15H4z"
      />
      <g className="project-folder-sheet">
        <rect x="10" y="12" width="28" height="16" rx="1.8" />
        <rect x="13" y="14" width="22" height="1" rx="0.5" />
        <rect x="13" y="16.2" width="14" height="1" rx="0.5" />
      </g>
      <path
        className="project-folder-front"
        d="M4 14.5A3.5 3.5 0 0 1 7.5 11h33a3.5 3.5 0 0 1 3.5 3.5v17a3.5 3.5 0 0 1-3.5 3.5h-33A3.5 3.5 0 0 1 4 31.5z"
      />
      {cloud && <path className="project-folder-cloud" d={CLOUD_ICON_PATH} transform="translate(13.92 12.42) scale(0.84)" />}
    </svg>
  );
}

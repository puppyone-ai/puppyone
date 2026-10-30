import { CLOUD_ICON_PATH } from "@puppyone/shared-ui";

/**
 * The website's folder in its monochrome form: a back with its tab and a lighter
 * front, both mixed from the page. A Cloud project is the same folder with the
 * cloud pressed into its front, the way macOS marks Documents and Downloads, so
 * its shape says where it lives and nothing has to be learned from a colour.
 */
export function ProjectFolderGlyph({ cloud = false }: { cloud?: boolean }) {
  return (
    <svg className="project-folder-glyph" viewBox="0 0 48 38" aria-hidden="true" focusable="false">
      <path
        className="project-folder-back"
        d="M4 6.5A3.5 3.5 0 0 1 7.5 3h10.3c.9 0 1.8.4 2.4 1.1L22.7 7h17.8A3.5 3.5 0 0 1 44 10.5v21a3.5 3.5 0 0 1-3.5 3.5h-33A3.5 3.5 0 0 1 4 31.5z"
      />
      <path
        className="project-folder-front"
        d="M4 14.5A3.5 3.5 0 0 1 7.5 11h33a3.5 3.5 0 0 1 3.5 3.5v17a3.5 3.5 0 0 1-3.5 3.5h-33A3.5 3.5 0 0 1 4 31.5z"
      />
      {cloud && <path className="project-folder-cloud" d={CLOUD_ICON_PATH} transform="translate(15 14) scale(0.75)" />}
    </svg>
  );
}

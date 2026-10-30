import { CLOUD_ICON_PATH } from "@puppyone/shared-ui";

const CLOUD_MARK = {
  cloud: { className: "project-folder-cloud", transform: "translate(13.2 12.2) scale(0.9)" },
  linked: { className: "project-folder-cloud is-corner", transform: "translate(31 23) scale(0.5)" },
} as const;

/**
 * The website's folder in its monochrome form: a back with its tab and a lighter
 * front, both mixed from the page. The viewBox is the drawing's own bounds, so the
 * folder stands exactly on the edge it is aligned to.
 *
 * Every folder keeps this one outline; the product's solid cloud says where a
 * project lives from inside it. On the front, the way macOS marks Documents and
 * Downloads, the project is in the Cloud. In the corner, it is a local folder with
 * its own Cloud project. The mark is solid and blue so that it still reads at a
 * glance across a full page of folders.
 */
export function ProjectFolderGlyph({ mark }: { mark?: keyof typeof CLOUD_MARK }) {
  return (
    <svg className="project-folder-glyph" viewBox="4 3 40 32" aria-hidden="true" focusable="false">
      <path
        className="project-folder-back"
        d="M4 6.5A3.5 3.5 0 0 1 7.5 3h10.3c.9 0 1.8.4 2.4 1.1L22.7 7h17.8A3.5 3.5 0 0 1 44 10.5v21a3.5 3.5 0 0 1-3.5 3.5h-33A3.5 3.5 0 0 1 4 31.5z"
      />
      <path
        className="project-folder-front"
        d="M4 14.5A3.5 3.5 0 0 1 7.5 11h33a3.5 3.5 0 0 1 3.5 3.5v17a3.5 3.5 0 0 1-3.5 3.5h-33A3.5 3.5 0 0 1 4 31.5z"
      />
      {mark && <path {...CLOUD_MARK[mark]} d={CLOUD_ICON_PATH} />}
    </svg>
  );
}

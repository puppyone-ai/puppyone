import { CLOUD_ICON_PATH } from "@puppyone/shared-ui";

/**
 * One hairline folder, drawn 1:1 so its line lands on the pixel grid. With `cloud`
 * it carries the product's solid cloud. The stylesheet inverts the pair for a Cloud
 * project, so ink alone says where a project lives.
 */
export function ProjectFolderGlyph({ cloud = false }: { cloud?: boolean }) {
  return (
    <svg className="project-folder-glyph" width="30" height="24" viewBox="0 0 30 24" aria-hidden="true" focusable="false">
      <path
        className="project-folder-outline"
        d="M3.5.5h6.4c.8 0 1.6.4 2.1 1l1.4 1.9c.5.6 1.2 1 2 1h11.1a3 3 0 0 1 3 3v13.1a3 3 0 0 1-3 3h-23a3 3 0 0 1-3-3v-17a3 3 0 0 1 3-3z"
      />
      {cloud && <path className="project-folder-cloud" d={CLOUD_ICON_PATH} transform="translate(6.6 6.1) scale(0.7)" />}
    </svg>
  );
}

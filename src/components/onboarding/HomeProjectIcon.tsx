import { CloudIcon, LocalIcon } from "@puppyone/shared-ui";
import type { ProjectHomeItem } from "../../lib/workspaceHomeModel";
import { ProjectFolderGlyph } from "./ProjectFolderGlyph";

function projectIconLocation(item: ProjectHomeItem) {
  if (!item.localPath) return "cloud";
  return item.linkedCloudProject ? "linked" : "local";
}

/**
 * A local folder, a local folder that has its own Cloud project (a small
 * Cloud badge on the folder's own mark), or a Cloud project. `filled` draws the
 * folder in the Homepage's fill; a Cloud project stays its cloud, since a mark
 * on a folder this small could not be read.
 */
export function HomeProjectIcon({ item, filled = false }: { item: ProjectHomeItem; filled?: boolean }) {
  const location = projectIconLocation(item);
  const folder = filled ? <ProjectFolderGlyph /> : <LocalIcon size={14} strokeWidth={1.85} />;
  return (
    <span className={`onboarding-project-icon is-${location}`} data-project-location={location} aria-hidden="true">
      {item.localPath ? folder : <CloudIcon size={14} strokeWidth={1.85} />}
      {location === "linked" && <CloudIcon className="onboarding-project-cloud-badge" size={9} backplate />}
    </span>
  );
}

/** The same three places as a whole folder, told apart by shape alone. */
export function ProjectFolder({ item }: { item: ProjectHomeItem }) {
  const location = projectIconLocation(item);
  return (
    <span className={`onboarding-project-folder is-${location}`} data-project-location={location} aria-hidden="true">
      <ProjectFolderGlyph cloud={location === "cloud"} />
      {location === "linked" && <CloudIcon className="onboarding-project-cloud-badge" size={16} backplate />}
    </span>
  );
}

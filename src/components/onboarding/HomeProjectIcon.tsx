import { CloudIcon, LocalIcon } from "@puppyone/shared-ui";
import type { ProjectHomeItem } from "../../lib/workspaceHomeModel";
import { ProjectFolderGlyph } from "./ProjectFolderGlyph";

function projectIconLocation(item: ProjectHomeItem) {
  if (!item.localPath) return "cloud";
  return item.linkedCloudProject ? "linked" : "local";
}

/**
 * A local folder, a local folder that has its own Cloud project (a small
 * Cloud badge on the folder's own mark), or a Cloud project.
 */
export function HomeProjectIcon({ item }: { item: ProjectHomeItem }) {
  const location = projectIconLocation(item);
  return (
    <span className={`onboarding-project-icon is-${location}`} data-project-location={location} aria-hidden="true">
      {item.localPath ? <LocalIcon size={14} strokeWidth={1.85} /> : <CloudIcon size={14} strokeWidth={1.85} />}
      {location === "linked" && <CloudIcon className="onboarding-project-cloud-badge" size={9} backplate />}
    </span>
  );
}

/** The same three places in ink alone: hollow, hollow with a cloud, or solid. */
export function ProjectFolder({ item }: { item: ProjectHomeItem }) {
  const location = projectIconLocation(item);
  return (
    <span className={`onboarding-project-folder is-${location}`} data-project-location={location} aria-hidden="true">
      <ProjectFolderGlyph cloud={location !== "local"} />
    </span>
  );
}

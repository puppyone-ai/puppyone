import { CloudIcon, FolderIcon, LocalIcon } from "@puppyone/shared-ui";
import type { ProjectHomeItem } from "../../lib/workspaceHomeModel";

/**
 * A local folder, a local folder that has its own Cloud project (a small
 * Cloud badge on the folder's own mark), or a Cloud project. The Icons layout
 * draws a local project as the folder it is, not as where it lives.
 */
export function HomeProjectIcon({ item, size = 14, strokeWidth = 1.85, folder = false }: {
  item: ProjectHomeItem;
  size?: number;
  strokeWidth?: number;
  folder?: boolean;
}) {
  const Local = folder ? FolderIcon : LocalIcon;
  const location = item.localPath ? item.linkedCloudProject ? "linked" : "local" : "cloud";
  return (
    <span className={`onboarding-project-icon is-${location}`} data-project-location={location} aria-hidden="true">
      {item.localPath ? <Local size={size} strokeWidth={strokeWidth} /> : <CloudIcon size={size} strokeWidth={strokeWidth} />}
      {location === "linked" && <CloudIcon className="onboarding-project-cloud-badge" size={Math.max(9, Math.round(size * 0.4))} backplate />}
    </span>
  );
}

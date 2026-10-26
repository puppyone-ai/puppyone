import { CloudIcon, LocalIcon } from "@puppyone/shared-ui";
import type { ProjectHomeItem } from "../../features/app-shell/workspaceHomeModel";

export function HomeProjectIcon({ item }: { item: ProjectHomeItem }) {
  const location = item.localPath ? item.cloudProjectId ? "linked" : "local" : "cloud";
  return (
    <span className={`onboarding-project-icon is-${location}`} data-project-location={location} aria-hidden="true">
      {item.localPath ? <LocalIcon size={14} strokeWidth={1.85} /> : <CloudIcon size={14} strokeWidth={1.85} />}
      {location === "linked" && <CloudIcon className="onboarding-project-cloud-badge" size={9} backplate />}
    </span>
  );
}

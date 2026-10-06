import { Folder } from "lucide-react";
import { CloudIcon as Cloud } from "../icons/CloudIcon";
import type { ProjectHomeItem } from "../../features/app-shell/workspaceHomeModel";

export function HomeProjectIcon({ item }: { item: ProjectHomeItem }) {
  const location = item.localPath ? item.cloudProjectId ? "linked" : "local" : "cloud";
  return (
    <span className={`onboarding-project-icon is-${location}`} data-project-location={location} aria-hidden="true">
      {item.localPath ? <Folder size={14} strokeWidth={1.85} /> : <Cloud size={14} />}
      {location === "linked" && <Cloud className="onboarding-project-cloud-badge" size={9} backplate />}
    </span>
  );
}

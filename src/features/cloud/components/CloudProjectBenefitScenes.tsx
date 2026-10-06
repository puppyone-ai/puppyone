import { ArrowLeftRight, Laptop, Link2 } from "lucide-react";
import { CloudIcon } from "../../../components/icons/CloudIcon";
import { CloudProjectCollaboratorAvatar } from "./CloudProjectCollaboratorAvatar";

const SCENE_STROKE_WIDTH = 1.5;
const BACKUP_ICON_PROPS = { strokeWidth: SCENE_STROKE_WIDTH, absoluteStrokeWidth: true } as const;

/** Decorative examples explain the handoffs without implying live project state. */
export function CloudProjectSharingScene() {
  return <svg className="desktop-cloud-project-benefit-scene" viewBox="0 0 220 96"
    fill="none" strokeWidth={SCENE_STROKE_WIDTH} aria-hidden="true" focusable="false">
    <rect className="desktop-cloud-project-scene-url-frame" x="32" y="31" width="156" height="34" rx="6" />
    <Link2 strokeWidth={SCENE_STROKE_WIDTH} absoluteStrokeWidth x={48} y={39} size={18} />
    <text className="desktop-cloud-project-scene-url" x="74" y="54">puppyone.ai/…</text>
    <CloudProjectCollaboratorAvatar person={0} x={18} y={58} />
    <CloudProjectCollaboratorAvatar person={1} x={174} y={10} />
  </svg>;
}

export function CloudProjectBackupScene() {
  return <div className="desktop-cloud-project-backup-marks" aria-hidden="true">
    <Laptop {...BACKUP_ICON_PROPS} size={24} />
    <ArrowLeftRight {...BACKUP_ICON_PROPS} size={16} />
    <CloudIcon size={24} />
  </div>;
}

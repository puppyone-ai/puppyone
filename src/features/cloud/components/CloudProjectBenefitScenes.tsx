import { ArrowRight, Laptop, Link2 } from "lucide-react";
import { CloudIcon } from "../../../components/icons/CloudIcon";

const SCENE_STROKE_WIDTH = 1.5;
// Match the original CloudIcon outline at 48px without redrawing the brand mark.
const BACKUP_ICON_PROPS = { strokeWidth: 3.5, absoluteStrokeWidth: true } as const;

function SharingMember({ x }: { x: number }) {
  return <g className="desktop-cloud-project-scene-member" transform={`translate(${x} 50)`}>
    <circle cx="14" cy="8" r="6" />
    <path d="M2 29c0-7 5.4-12 12-12s12 5 12 12c0 1.7-1.3 3-3 3H5c-1.7 0-3-1.3-3-3Z" />
  </g>;
}

/** Decorative examples explain the handoffs without implying live project state. */
export function CloudProjectSharingScene() {
  return <svg className="desktop-cloud-project-benefit-scene" viewBox="0 0 220 96"
    fill="none" strokeWidth={SCENE_STROKE_WIDTH} aria-hidden="true" focusable="false">
    <rect className="desktop-cloud-project-scene-url-frame" x="32" y="6" width="156" height="34" rx="6" />
    <Link2 strokeWidth={SCENE_STROKE_WIDTH} absoluteStrokeWidth x={48} y={14} size={18} />
    <text className="desktop-cloud-project-scene-url" x="74" y="29">puppyone.ai/…</text>
    <SharingMember x={34} />
    <SharingMember x={158} />
  </svg>;
}

export function CloudProjectBackupScene() {
  return <svg className="desktop-cloud-project-benefit-scene" viewBox="0 0 220 96"
    fill="none" strokeWidth={SCENE_STROKE_WIDTH} aria-hidden="true" focusable="false">
    <Laptop {...BACKUP_ICON_PROPS} x={28} y={24} size={48} />
    <ArrowRight {...BACKUP_ICON_PROPS} x={98} y={36} size={24} />
    <CloudIcon x={144} y={24} size={48} />
  </svg>;
}

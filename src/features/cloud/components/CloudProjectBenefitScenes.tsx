import { ArrowRight, Cloud, Laptop, Link2, UserRound } from "lucide-react";

// Diagram glyphs share one outline family and the same rendered stroke width.
const SCENE_STROKE_WIDTH = 1.5;
const SCENE_ICON_PROPS = { strokeWidth: SCENE_STROKE_WIDTH, absoluteStrokeWidth: true } as const;

/** Decorative examples explain the handoffs without implying live project state. */
export function CloudProjectSharingScene() {
  return <svg className="desktop-cloud-project-benefit-scene" viewBox="0 0 220 96"
    fill="none" strokeWidth={SCENE_STROKE_WIDTH} aria-hidden="true" focusable="false">
    <path d="M48 40v15m124-15v15" stroke="currentColor" />
    <rect className="desktop-cloud-project-scene-url-frame" x="32" y="6" width="156" height="34" rx="6" />
    <Link2 {...SCENE_ICON_PROPS} x={48} y={14} size={18} />
    <text className="desktop-cloud-project-scene-url" x="74" y="29">puppyone.ai/…</text>
    <circle className="desktop-cloud-project-scene-member" cx="48" cy="70" r="15" />
    <UserRound {...SCENE_ICON_PROPS} x={38} y={60} size={20} />
    <circle className="desktop-cloud-project-scene-member" cx="172" cy="70" r="15" />
    <UserRound {...SCENE_ICON_PROPS} x={162} y={60} size={20} />
  </svg>;
}

export function CloudProjectBackupScene() {
  return <svg className="desktop-cloud-project-benefit-scene" viewBox="0 0 220 96"
    fill="none" strokeWidth={SCENE_STROKE_WIDTH} aria-hidden="true" focusable="false">
    <Laptop {...SCENE_ICON_PROPS} x={28} y={24} size={48} />
    <ArrowRight {...SCENE_ICON_PROPS} x={98} y={36} size={24} />
    <Cloud {...SCENE_ICON_PROPS} x={144} y={24} size={48} />
  </svg>;
}

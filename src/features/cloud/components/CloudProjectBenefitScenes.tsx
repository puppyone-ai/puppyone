import { Link2, UserRound } from "lucide-react";
import { CloudIcon } from "../../../components/icons/CloudIcon";

/** Decorative examples explain the handoffs without implying live project state. */
export function CloudProjectSharingScene() {
  return <svg className="desktop-cloud-project-benefit-scene" viewBox="0 0 160 40"
    fill="none" aria-hidden="true" focusable="false">
    <rect className="desktop-cloud-project-scene-url-frame" x="4" y="9" width="108" height="22" rx="5" />
    <Link2 x={10} y={14} width={12} height={12} strokeWidth={1.6} />
    <text className="desktop-cloud-project-scene-url" x="27" y="23">puppyone.ai/…</text>
    {[124, 144].map((x) => <g key={x}>
      <circle className="desktop-cloud-project-scene-member" cx={x} cy="20" r="11" />
      <UserRound x={x - 7} y={13} width={14} height={14} strokeWidth={1.6} />
    </g>)}
  </svg>;
}

export function CloudProjectAvailabilityScene() {
  return <svg className="desktop-cloud-project-benefit-scene desktop-cloud-project-scene-online" viewBox="0 0 160 40"
    fill="none" aria-hidden="true" focusable="false">
    <CloudIcon x={35} y={8} size={24} />
    <text className="desktop-cloud-project-scene-hours" x="65" y="29">24×7</text>
  </svg>;
}

import { Check, Laptop, Link2, Power, UserRound } from "lucide-react";
import { CloudIcon } from "../../../components/icons/CloudIcon";

/** Decorative examples explain the handoffs without implying live project state. */
export function CloudProjectSharingScene() {
  return <svg className="desktop-cloud-project-benefit-scene" viewBox="0 0 200 72"
    fill="none" aria-hidden="true" focusable="false">
    <rect className="desktop-cloud-project-scene-url-frame" x="32" y="4" width="136" height="28" rx="6" />
    <Link2 x={42} y={11} width={14} height={14} strokeWidth={1.6} />
    <text className="desktop-cloud-project-scene-url" x="63" y="22">puppyone.ai/…</text>
    {[85, 115].map((x) => <g key={x}>
      <circle className="desktop-cloud-project-scene-member" cx={x} cy="54" r="12" />
      <UserRound x={x - 8} y={46} width={16} height={16} strokeWidth={1.6} />
    </g>)}
  </svg>;
}

export function CloudProjectAvailabilityScene() {
  return <svg className="desktop-cloud-project-benefit-scene" viewBox="0 0 200 72"
    fill="none" aria-hidden="true" focusable="false">
    <Laptop x={35} y={19} width={44} height={44} strokeWidth={1.5} />
    <Power x={51} y={28} width={12} height={12} strokeWidth={1.5} />
    <CloudIcon x={115} y={12} size={48} />
    <circle className="desktop-cloud-project-scene-member" cx="157" cy="49" r="10" />
    <Check x={150} y={42} width={14} height={14} strokeWidth={1.8} />
  </svg>;
}

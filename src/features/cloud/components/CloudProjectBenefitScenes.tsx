import { Link2, Moon, UserRound } from "lucide-react";
import { CloudIcon } from "../../../components/icons/CloudIcon";

/** Decorative examples explain the handoffs without implying live project state. */
export function CloudProjectSharingScene() {
  return <svg className="desktop-cloud-project-benefit-scene" viewBox="0 0 160 96"
    fill="none" aria-hidden="true" focusable="false">
    <rect className="desktop-cloud-project-scene-surface" x="16" y="12" width="128" height="26" rx="6" />
    <Link2 x={23} y={18} width={14} height={14} className="desktop-cloud-project-scene-accent" strokeWidth={1.8} />
    <text className="desktop-cloud-project-scene-url" x="43" y="29">puppyone.ai/…</text>
    <path className="desktop-cloud-project-scene-connector" d="M80 38v9M44 55v-4a4 4 0 0 1 4-4h64a4 4 0 0 1 4 4v4" />
    {[44, 116].map((x) => <g key={x}>
      <circle className="desktop-cloud-project-scene-member" cx={x} cy="71" r="15" />
      <UserRound x={x - 9} y={62} width={18} height={18} strokeWidth={1.7} />
    </g>)}
  </svg>;
}

export function CloudProjectAvailabilityScene() {
  return <svg className="desktop-cloud-project-benefit-scene" viewBox="0 0 160 96"
    fill="none" aria-hidden="true" focusable="false">
    <g className="desktop-cloud-project-scene-device">
      <rect className="desktop-cloud-project-scene-surface" x="15" y="34" width="43" height="29" rx="4" />
      <path d="M11 67h51" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <Moon x={29} y={41} width={15} height={15} strokeWidth={1.6} />
    </g>
    <path className="desktop-cloud-project-scene-connector" d="M64 49h15" strokeDasharray="2 4" />
    <g className="desktop-cloud-project-scene-online">
      <path d="M98 52h29a10 10 0 0 0 1-20 16 16 0 0 0-30-4 12 12 0 0 0 0 24Z"
        className="desktop-cloud-project-scene-cloud" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="132" cy="49" r="4" fill="currentColor" />
      <text className="desktop-cloud-project-scene-hours" x="113" y="80" textAnchor="middle">24×7</text>
    </g>
  </svg>;
}

export function CloudProjectAgentConnections() {
  return <svg className="desktop-cloud-project-benefit-scene desktop-cloud-project-agent-connections"
    viewBox="0 0 160 96" fill="none" aria-hidden="true" focusable="false">
    <rect className="desktop-cloud-project-scene-surface" x="63" y="10" width="34" height="28" rx="5" />
    <CloudIcon x={70} y={14} size={20} />
    <path className="desktop-cloud-project-scene-connector"
      d="M80 38v9M26 58v-7a4 4 0 0 1 4-4h100a4 4 0 0 1 4 4v7M62 47v11M98 47v11" />
  </svg>;
}

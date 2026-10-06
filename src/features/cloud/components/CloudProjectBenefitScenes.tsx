import { ArrowRight, Check, FolderClosed, Link2, UserRound } from "lucide-react";
import { CloudIcon } from "../../../components/icons/CloudIcon";

/** Decorative examples explain the handoffs without implying live project state. */
export function CloudProjectSharingScene() {
  return <svg className="desktop-cloud-project-benefit-scene" viewBox="0 0 200 72"
    fill="none" aria-hidden="true" focusable="false">
    <path d="M32 36h8m120 0h8" stroke="currentColor" strokeWidth="1.2" />
    <rect className="desktop-cloud-project-scene-url-frame" x="40" y="23" width="120" height="26" rx="6" />
    <Link2 x={48} y={29} width={14} height={14} strokeWidth={1.6} />
    <text className="desktop-cloud-project-scene-url" x="68" y="40">puppyone.ai/…</text>
    <circle className="desktop-cloud-project-scene-member" cx="18" cy="36" r="14" />
    <UserRound x={10} y={28} width={16} height={16} strokeWidth={1.6} />
    <circle className="desktop-cloud-project-scene-member" cx="182" cy="36" r="14" />
    <UserRound x={174} y={28} width={16} height={16} strokeWidth={1.6} />
  </svg>;
}

export function CloudProjectBackupScene() {
  return <svg className="desktop-cloud-project-benefit-scene" viewBox="0 0 200 72"
    fill="none" aria-hidden="true" focusable="false">
    <FolderClosed className="desktop-cloud-project-scene-folder" x={28} y={18} width={36} height={36} strokeWidth={1.5} />
    <ArrowRight className="desktop-cloud-project-scene-link" x={86} y={27} width={18} height={18} strokeWidth={1.5} />
    <CloudIcon className="desktop-cloud-project-scene-link" x={124} y={10} size={48} />
    <g className="desktop-cloud-project-scene-backup-check">
      <circle className="desktop-cloud-project-scene-member" cx="165" cy="49" r="9" />
      <Check x={159} y={43} width={12} height={12} strokeWidth={1.8} />
    </g>
  </svg>;
}

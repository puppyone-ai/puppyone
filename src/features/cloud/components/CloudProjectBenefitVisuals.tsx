import { FileText } from "lucide-react";
import { CloudIcon } from "../../../components/icons/CloudIcon";

/** Static, compact adaptations of the marketing site's collaboration/online scenes. */
export function CloudProjectSharingVisual() {
  return <div className="desktop-cloud-project-benefit-visual desktop-cloud-project-sharing-visual" aria-hidden="true">
    <div className="desktop-cloud-project-sharing-file">
      <div className="desktop-cloud-project-sharing-file-heading"><FileText size={10} /><span /></div>
      <div className="desktop-cloud-project-sharing-file-lines"><span /><span /><span /></div>
    </div>
    <CollaboratorAvatar person={0} />
    <CollaboratorAvatar person={1} />
    <CollaboratorAvatar person={2} />
  </div>;
}

export function CloudProjectAvailabilityVisual() {
  return <div className="desktop-cloud-project-benefit-visual desktop-cloud-project-availability-visual" aria-hidden="true">
    <CloudIcon size={20} />
    <span>24×7</span>
  </div>;
}

// Reuse the site's illustrated people; no member identities or presence are implied.
// puppyone-web@afe8662f:src/app/components/home-page/DesktopCloudSection.tsx
function CollaboratorAvatar({ person }: { person: 0 | 1 | 2 }) {
  const palettes = [
    { background: "#eadbc8", skin: "#c88960", hair: "#332b27", shirt: "#315f4a" },
    { background: "#dce3dc", skin: "#e1b28f", hair: "#4a3129", shirt: "#b85f42" },
    { background: "#e5d3b8", skin: "#754b34", hair: "#252321", shirt: "#3f6a55" },
  ] as const;
  const palette = palettes[person];
  return <span className="desktop-cloud-project-collaborator" data-person={person}>
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" fill={palette.background} />
      <path d="M8 64c1.6-11.8 10.1-18 24-18s22.4 6.2 24 18H8Z" fill={palette.shirt} />
      <path d="M27 40h10v11H27z" fill={palette.skin} />
      {person === 0 && <>
        <circle cx="32" cy="28" r="14" fill={palette.skin} />
        <path d="M18 29c0-12.5 5.7-19 15.2-19 10.2 0 15 7.5 14.5 20.8-4.9-2.8-7.5-8.6-7.5-8.6-7 4.6-13.6 5.9-22.2 6.8Z" fill={palette.hair} />
      </>}
      {person === 1 && <>
        <circle cx="32" cy="29" r="14" fill={palette.skin} />
        <path d="M18 27.5c.4-11 5.8-17.5 14.8-17.5 8.8 0 14.1 6.3 14.8 16.4-4.4-1-7.3-3.9-9.1-7.5-5.2 5.1-11.9 7.9-20.5 8.6Z" fill={palette.hair} />
        <circle cx="44.5" cy="14.5" r="5.5" fill={palette.hair} />
      </>}
      {person === 2 && <>
        <circle cx="32" cy="29.5" r="14" fill={palette.skin} />
        <circle cx="22" cy="18" r="7.5" fill={palette.hair} />
        <circle cx="31" cy="14.5" r="8.5" fill={palette.hair} />
        <circle cx="40.5" cy="18" r="7.5" fill={palette.hair} />
        <path d="M18 28c1-8 5.8-13 14-13 8.5 0 13.2 5.5 14 13-5.3-1.4-9.7-4.6-13.2-8.4-3.2 4-8.5 7.1-14.8 8.4Z" fill={palette.hair} />
      </>}
      <circle cx="27" cy="31" r="1.25" fill={palette.hair} />
      <circle cx="37" cy="31" r="1.25" fill={palette.hair} />
      <path d="M28.5 37c2.2 1.5 4.8 1.5 7 0" fill="none" stroke={palette.hair} strokeLinecap="round" strokeWidth="1.4" />
    </svg>
  </span>;
}

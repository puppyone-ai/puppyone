import { useId } from "react";

const PALETTES = [
  { background: "#eadbc8", skin: "#c88960", hair: "#332b27", shirt: "#315f4a" },
  { background: "#dce3dc", skin: "#e1b28f", hair: "#4a3129", shirt: "#b85f42" },
] as const;

/** Decorative portraits adapted from the website's CollaborationVisual artwork. */
export function CloudProjectCollaboratorAvatar({ person, x, y }: { person: 0 | 1; x: number; y: number }) {
  const clipId = useId();
  const palette = PALETTES[person];
  return <svg x={x} y={y} width={28} height={28} viewBox="0 0 64 64"
    aria-hidden="true" focusable="false">
    <defs><clipPath id={clipId}><circle cx="32" cy="32" r="30" /></clipPath></defs>
    <g clipPath={`url(#${clipId})`}>
      <rect width="64" height="64" fill={palette.background} />
      <path d="M8 64c1.6-11.8 10.1-18 24-18s22.4 6.2 24 18H8Z" fill={palette.shirt} />
      <path d="M27 40h10v11H27z" fill={palette.skin} />
      <circle cx="32" cy={person === 0 ? 28 : 29} r="14" fill={palette.skin} />
      {person === 0
        ? <path d="M18 29c0-12.5 5.7-19 15.2-19 10.2 0 15 7.5 14.5 20.8-4.9-2.8-7.5-8.6-7.5-8.6-7 4.6-13.6 5.9-22.2 6.8Z" fill={palette.hair} />
        : <>
          <path d="M18 27.5c.4-11 5.8-17.5 14.8-17.5 8.8 0 14.1 6.3 14.8 16.4-4.4-1-7.3-3.9-9.1-7.5-5.2 5.1-11.9 7.9-20.5 8.6Z" fill={palette.hair} />
          <circle cx="44.5" cy="14.5" r="5.5" fill={palette.hair} />
        </>}
      <circle cx="27" cy="31" r="1.25" fill={palette.hair} />
      <circle cx="37" cy="31" r="1.25" fill={palette.hair} />
      <path d="M28.5 37c2.2 1.5 4.8 1.5 7 0" fill="none" stroke={palette.hair}
        strokeLinecap="round" strokeWidth="1.4" />
    </g>
    <circle cx="32" cy="32" r="30" fill="none" stroke="var(--po-border-strong)" strokeWidth="3" />
  </svg>;
}

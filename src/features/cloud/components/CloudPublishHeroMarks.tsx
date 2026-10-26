import { useId } from "react";

/**
 * Soft-dimensional marks: filled silhouettes with restrained depth.
 * Not Aqua gloss / toy 3D, and not stroke-only line art.
 */

/** Finder-style yellow folder — clipped highlights, stacked paper edges, flush silhouette. */
export function CloudPublishFolderMark({ className }: { className?: string }) {
  const uid = useId().replace(/:/g, "");
  const back = `po-publish-folder-back-${uid}`;
  const front = `po-publish-folder-front-${uid}`;
  const tabHi = `po-publish-folder-tab-hi-${uid}`;
  const rimHi = `po-publish-folder-rim-hi-${uid}`;
  const frontClip = `po-publish-folder-front-clip-${uid}`;
  const tabClip = `po-publish-folder-tab-clip-${uid}`;

  // Front uses real corner radii so rim highlight can be clipped flush (no wing overflow).
  const backPath =
    "M14 25.5c0-2.6 2.1-4.7 4.7-4.7h14.6c1.15 0 2.2.55 2.85 1.45L40.2 29.5H65c2.9 0 5.2 2.25 5.2 5.1v4.8H14V25.5Z";
  const frontPath =
    "M14 39.8c0-2.9 2.3-5.1 5.2-5.1h41.6c2.9 0 5.2 2.2 5.2 5.1v17.8c0 3.2-2.6 5.8-5.8 5.8H19.8c-3.2 0-5.8-2.6-5.8-5.8V39.8Z";

  return (
    <svg className={className} viewBox="0 0 80 72" focusable="false" aria-hidden="true">
      <defs>
        <linearGradient id={back} x1="40" y1="18" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f6de96" />
          <stop offset="100%" stopColor="#e4b851" />
        </linearGradient>
        <linearGradient id={front} x1="40" y1="34" x2="40" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f0cb66" />
          <stop offset="48%" stopColor="#e2b24d" />
          <stop offset="100%" stopColor="#cc9634" />
        </linearGradient>
        <linearGradient id={tabHi} x1="24" y1="20" x2="24" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="rgba(255,255,255,0.5)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        <linearGradient id={rimHi} x1="40" y1="34.5" x2="40" y2="41" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="rgba(255,255,255,0.45)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        <clipPath id={tabClip}>
          <path d={backPath} />
        </clipPath>
        <clipPath id={frontClip}>
          <path d={frontPath} />
        </clipPath>
      </defs>

      {/* Full back body (behind front) for solid Finder mass */}
      <path
        d="M14 25.5c0-2.6 2.1-4.7 4.7-4.7h14.6c1.15 0 2.2.55 2.85 1.45L40.2 29.5H65c2.9 0 5.2 2.25 5.2 5.1v23.1c0 3.2-2.6 5.8-5.8 5.8H19.8c-3.2 0-5.8-2.6-5.8-5.8V25.5Z"
        fill={`url(#${back})`}
      />

      <g clipPath={`url(#${tabClip})`}>
        <path d="M14 20.5h28v10H14Z" fill={`url(#${tabHi})`} />
      </g>

      {/* Stacked paper edges in the pocket — short, centered, no text lines */}
      <g>
        <rect x="20" y="31.6" width="44" height="3.4" rx="0.9" fill="#e8ebf0" />
        <rect x="21" y="30.4" width="43" height="3.2" rx="0.9" fill="#f4f6f8" />
        <rect x="22" y="29.3" width="41.5" height="3" rx="0.85" fill="#ffffff" />
      </g>

      {/* Front flap */}
      <path d={frontPath} fill={`url(#${front})`} />
      <g clipPath={`url(#${frontClip})`}>
        <rect x="14" y="34.5" width="53" height="7" fill={`url(#${rimHi})`} />
        <path
          d="M14 34.7h52.4"
          fill="none"
          stroke="rgba(255,255,255,0.35)"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
        <path
          d="M16 37.4h48"
          fill="none"
          stroke="rgba(150,105,28,0.16)"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

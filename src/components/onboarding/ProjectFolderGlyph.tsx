import { useId } from "react";

/**
 * The folder the website sets on its paintings: a back with its tab and a
 * brighter front. Colours come from --folder-* on an ancestor, so a Cloud
 * project can take the blue while a local one stays white.
 */
export function ProjectFolderGlyph() {
  const front = `project-folder-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg className="project-folder-glyph" viewBox="0 0 48 38" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={front} x1="0" y1="0" x2="0" y2="1">
          <stop className="project-folder-front-top" offset="0" />
          <stop className="project-folder-front-bottom" offset="1" />
        </linearGradient>
      </defs>
      <path
        className="project-folder-back"
        d="M4 6.5A3.5 3.5 0 0 1 7.5 3h10.3c.9 0 1.8.4 2.4 1.1L22.7 7h17.8A3.5 3.5 0 0 1 44 10.5v21a3.5 3.5 0 0 1-3.5 3.5h-33A3.5 3.5 0 0 1 4 31.5z"
      />
      <path
        d="M4 14.5A3.5 3.5 0 0 1 7.5 11h33a3.5 3.5 0 0 1 3.5 3.5v17a3.5 3.5 0 0 1-3.5 3.5h-33A3.5 3.5 0 0 1 4 31.5z"
        fill={`url(#${front})`}
      />
    </svg>
  );
}

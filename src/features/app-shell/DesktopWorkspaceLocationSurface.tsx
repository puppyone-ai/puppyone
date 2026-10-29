import type { ReactNode } from "react";

/** Keep document hosts alive; both locations use the same native file surface. */
export function DesktopWorkspaceLocationSurface({ location, local, cloud }: {
  location: "local" | "cloud";
  local: ReactNode;
  cloud: ReactNode;
}) {
  return <>
    <div className="desktop-workspace-location-surface" data-workspace-location="local"
      hidden={location === "cloud"} aria-hidden={location === "cloud" || undefined}>
      {local}
    </div>
    <div className="desktop-workspace-location-surface" data-workspace-location="cloud"
      hidden={location !== "cloud"} aria-hidden={location !== "cloud" || undefined}>
      {cloud}
    </div>
  </>;
}

import type { ReactNode } from "react";

/** Keep document hosts alive; both locations use the same native file surface. */
export function DesktopWorkspaceLocationSurface({ location, local, cloud, preparation }: {
  location: "local" | "cloud";
  local: ReactNode;
  cloud: ReactNode;
  preparation?: ReactNode;
}) {
  return <>
    <div className="desktop-workspace-location-surface" data-workspace-location="local"
      hidden={location === "cloud"} aria-hidden={location === "cloud" || Boolean(preparation) || undefined}
      {...(preparation ? { inert: "" } : {})}>
      {local}
    </div>
    <div className="desktop-workspace-location-surface" data-workspace-location="cloud"
      hidden={location !== "cloud"} aria-hidden={location !== "cloud" || undefined}>
      {cloud}
    </div>
    {preparation}
  </>;
}

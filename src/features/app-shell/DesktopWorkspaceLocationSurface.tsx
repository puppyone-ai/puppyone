import type { ReactNode } from "react";
import type { WorkspaceSurfaceContent } from "./workspace-surfaces/workspaceSurfaceTypes";

/** Keep each provider's document hosts alive across a device/Cloud switch. */
export function DesktopWorkspaceLocationSurface({ location, local, nativeCloud, cloudServices, cloudError }: {
  location: "local" | "cloud";
  local: ReactNode;
  nativeCloud?: ReactNode;
  cloudServices: WorkspaceSurfaceContent;
  cloudError?: string | null;
}) {
  return <>
    <div className="desktop-workspace-location-surface" data-workspace-location="local"
      hidden={location === "cloud"} aria-hidden={location === "cloud" || undefined}>
      {local}
    </div>
    <div className="desktop-workspace-location-surface" data-workspace-location="cloud"
      hidden={location !== "cloud"} aria-hidden={location !== "cloud" || undefined}>
      {nativeCloud ?? (location === "cloud" ? (
        <div className="desktop-cloud-inline-workspace">
          {cloudError ? <div className="desktop-workspace-surface-alert" role="alert">{cloudError}</div>
            : <><aside className="desktop-cloud-inline-navigation">{cloudServices.sidebar}</aside>
              <main className="desktop-cloud-inline-content">{cloudServices.main}</main></>}
        </div>
      ) : null)}
    </div>
  </>;
}

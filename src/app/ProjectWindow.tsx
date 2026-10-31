import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { ProjectShell } from "../components/ProjectShell";
import type { ResolvedSurfaceAppearance } from "../features/appearance/AppearanceRuntime";
import { useDesktopPreference } from "../features/settings";

type ProjectShellProps = ComponentProps<typeof ProjectShell>;

/** Another project on its way into this window. */
export type ProjectWindowOpening = Readonly<{ location: "local" | "cloud"; content: ReactNode }>;

type ProjectWindowProps = Omit<ProjectShellProps,
  "active" | "workspaceLocation" | "leftSidebarCollapsed" | "leftSidebarWidth" | "onLeftSidebarExpand"> & {
  appearance: ResolvedSurfaceAppearance;
  location: "local" | "cloud";
  /** A Cloud project with no folders open, which hosts itself. */
  hosted?: boolean;
  active?: boolean;
  opening?: ProjectWindowOpening | null;
  rootAttributes?: HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | undefined>;
};

/**
 * One window showing one project, however it got there. While another project
 * is on its way in, the window states that project's location and the wait, and
 * what belongs to the project on screen steps out of the Header; the project's
 * name and menu are the caller's, because the rail may own them.
 */
export function ProjectWindow({
  appearance, location, hosted = false, active = true, opening, rootAttributes,
  titlebarActions, titlebarTabs, children, ...shell
}: ProjectWindowProps) {
  const sidebarCollapsed = useDesktopPreference(s => s.sidebarCollapsed);
  const explorerWidth = useDesktopPreference(s => s.explorerWidth);
  const setSidebarCollapsed = useDesktopPreference(s => s.setSidebarCollapsed);
  const runtimeClass = hosted ? "app-shell cloud-runtime desktop-account-cloud-workspace" : "app-shell cloud-runtime";
  return <div className={`${runtimeClass} ${appearance.appearance.effectiveColorMode === "dark" ? "dark" : ""}`}
    {...appearance.rootProps} {...rootAttributes}
    style={{ ...appearance.rootProps.style, ...rootAttributes?.style }}>
    <ProjectShell {...shell} active={active} workspaceLocation={opening?.location ?? location}
      leftSidebarCollapsed={sidebarCollapsed} leftSidebarWidth={explorerWidth}
      onLeftSidebarExpand={() => setSidebarCollapsed(false)}
      titlebarActions={opening ? undefined : titlebarActions}
      titlebarTabs={opening ? undefined : titlebarTabs}>
      {children}
      {opening?.content}
    </ProjectShell>
  </div>;
}

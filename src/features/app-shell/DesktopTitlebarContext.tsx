import type { DesktopProjectCloudCopy, DesktopProjectLocation } from "./DesktopProjectLocationSwitcher";
import { DesktopProjectLocationSwitcher } from "./DesktopProjectLocationSwitcher";
import { DesktopWorkspaceSwitcher, type DesktopWorkspaceSwitcherProps } from "./DesktopWorkspaceSwitcher";

/** Project navigation and provider selection are independent Header controls. */
export function DesktopTitlebarContext({ projectLocation, cloudProject, onViewLocal, onViewCloud, ...project }: DesktopTitlebarContextProps) {
  return <div className="desktop-titlebar-context">
    <DesktopWorkspaceSwitcher {...project} />
    <DesktopProjectLocationSwitcher projectLocation={projectLocation} cloudProject={cloudProject}
      onViewLocal={onViewLocal} onViewCloud={onViewCloud}
      projectMenuOpen={project.projectMenuEnabled !== false && project.open} onOpen={project.onClose} />
  </div>;
}

export type DesktopTitlebarContextProps = DesktopWorkspaceSwitcherProps & {
  projectLocation?: DesktopProjectLocation;
  cloudProject?: DesktopProjectCloudCopy;
  onViewLocal?: () => void;
  onViewCloud?: () => void;
};

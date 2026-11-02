import { CloudIcon, Tooltip } from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { projectHomeItemLocation, type ProjectHomeItem } from "../../lib/workspaceHomeModel";
import { useDesktopPlatformCapabilities } from "../../platform/useDesktopPlatformCapabilities";

/**
 * A local folder's link to its own Cloud project. The two are separate
 * projects (puppy-issues ADR-001): this opens the other one, it never chooses
 * where the folder itself opens.
 */
export function LinkedCloudProjectButton({ project, busy, className, onOpen }: {
  project: NonNullable<ProjectHomeItem["linkedCloudProject"]>;
  busy: boolean;
  className: string;
  onOpen: () => void;
}) {
  const { t } = useLocalization();
  const name = bidiIsolate(project.name);
  return <Tooltip content={t("cloud.home.linkedCloudProjectHint", { project: name })}>
    <button type="button" className={`project-cloud-link-button ${className}`} disabled={busy}
      data-linked-cloud-project-id={project.id}
      aria-label={t("cloud.home.openLinkedCloudProject", { project: name })}
      onClick={onOpen}>
      <CloudIcon size={12} aria-hidden="true" />
      <span>{t("cloud.home.location.cloud")}</span>
    </button>
  </Tooltip>;
}

export function ProjectHomeItemCaption({ item }: { item: ProjectHomeItem }) {
  return <>{useProjectHomeItemCaption(item)}</>;
}

/** Where an entry's project is: this computer, or the Cloud. */
export function useProjectHomeItemCaption(item: ProjectHomeItem): string {
  const { t } = useLocalization();
  const platform = useDesktopPlatformCapabilities();
  if (projectHomeItemLocation(item) === "cloud") return t("cloud.home.location.cloud");
  return t(platform?.platform === "macos"
    ? "shell.workspaceSwitcher.location.thisMac"
    : "shell.workspaceSwitcher.location.thisComputer");
}

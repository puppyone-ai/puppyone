import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { CloudIcon, FolderIcon, Tooltip } from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { DesktopMenuIconButton, DesktopMenuItem } from "../../components/DesktopMenu";
import { writeClipboardText } from "../../lib/clipboard";
import { getProjectName, projectHomeItemLocation, type ProjectHomeItem } from "../../lib/workspaceHomeModel";

/**
 * Every row is a folder: the menu lists one place's folders, so the place is
 * not repeated on each. A small cloud says a local folder has a Cloud copy.
 */
function ProjectFolderMark({ project }: { project: ProjectHomeItem }) {
  const linked = Boolean(project.localPath && project.linkedCloudProject);
  return <span className="onboarding-project-icon" data-project-location={linked ? "linked" : undefined} aria-hidden="true">
    <FolderIcon size={14} strokeWidth={1.85} />
    {linked && <CloudIcon className="onboarding-project-cloud-badge" size={9} backplate />}
  </span>;
}

export function DesktopProjectMenuItem({ project, selected, pending = false, onSelect }: {
  project: ProjectHomeItem;
  selected: boolean;
  pending?: boolean;
  onSelect: () => void;
}) {
  const { t } = useLocalization();
  const name = getProjectName(project, t("onboarding.projects.untitled"));
  const path = project.localPath;
  const [copyState, setCopyState] = useState<"idle" | "pending" | "copied" | "failed">("idle");
  const copyLabel = t(copyState === "copied" ? "common.action.copied" : "shell.workspaceSwitcher.copyPath");
  const copyError = t("shell.workspaceSwitcher.copyPathFailed");
  useEffect(() => {
    if (copyState !== "copied") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 1600);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const copyPath = async () => {
    if (!path || copyState === "pending") return;
    setCopyState("pending");
    try {
      await writeClipboardText(path);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return <div>
    <div className="desktop-project-switcher-row" data-has-local-path={Boolean(path) || undefined}
      data-project-location={projectHomeItemLocation(project)}
      data-linked-cloud-project-id={project.linkedCloudProject?.id}>
      <DesktopMenuItem
        icon={<ProjectFolderMark project={project} />}
        label={<bdi>{name}</bdi>}
        selected={selected}
        aria-current={selected ? "page" : undefined}
        aria-busy={pending || undefined}
        trailing={selected ? <Check size={14} /> : undefined}
        onClick={onSelect}
      />
      {path && <Tooltip content={`${copyState === "failed" ? copyError : copyLabel}\n${bidiIsolate(path)}`}>
        <DesktopMenuIconButton
          className="desktop-project-switcher-copy"
          role="menuitem"
          label={`${copyLabel}: ${bidiIsolate(name)}`}
          disabled={copyState === "pending"}
          icon={copyState === "copied" ? <Check size={14} /> : <Copy size={14} />}
          onClick={() => void copyPath()}
        />
      </Tooltip>}
      <span className="desktop-project-switcher-copy-status" role="status">
        {copyState === "copied" ? t("common.action.copied") : null}
      </span>
    </div>
    {copyState === "failed" && <div className="desktop-project-switcher-copy-error" role="alert">{copyError}</div>}
  </div>;
}

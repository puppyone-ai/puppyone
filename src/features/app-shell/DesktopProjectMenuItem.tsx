import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Tooltip } from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { DesktopMenuIconButton, DesktopMenuItem } from "../../components/DesktopMenu";
import { HomeProjectIcon } from "../../components/onboarding/HomeProjectIcon";
import { writeClipboardText } from "../../lib/clipboard";
import { getProjectName, type ProjectHomeItem } from "./workspaceHomeModel";

export function DesktopProjectMenuItem({ project, selected, onSelect }: {
  project: ProjectHomeItem;
  selected: boolean;
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
    <div className="desktop-project-switcher-row" data-has-local-path={Boolean(path) || undefined}>
      <DesktopMenuItem
        icon={<HomeProjectIcon item={project} />}
        label={<bdi>{name}</bdi>}
        selected={selected}
        aria-current={selected ? "page" : undefined}
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

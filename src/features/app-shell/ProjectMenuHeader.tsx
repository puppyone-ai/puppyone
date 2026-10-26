import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { DesktopMenuIconButton, DesktopMenuSeparator } from "../../components/DesktopMenu";
import { writeClipboardText } from "../../lib/clipboard";

/** Project identity stays readable; copying is a secondary menu action. */
export function ProjectMenuHeader({ name, path }: { name: string; path: string }) {
  const { t } = useLocalization();
  const [copyState, setCopyState] = useState<"idle" | "pending" | "copied" | "failed">("idle");
  const copyLabel = t(copyState === "copied" ? "common.action.copied" : "shell.workspaceSwitcher.copyPath");
  const copyPath = async () => {
    if (copyState === "pending") return;
    setCopyState("pending");
    try {
      await writeClipboardText(path);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  if (path.startsWith("puppyone-cloud:")) return null;

  return (<>
    <div className="desktop-project-menu-header">
      <bdi className="desktop-project-menu-header-name">{name}</bdi>
      <div className="desktop-project-menu-header-location">
        <bdi className="desktop-project-menu-header-path" dir="ltr">{path}</bdi>
        <Tooltip content={copyLabel}>
          <DesktopMenuIconButton
            className="desktop-project-menu-header-copy"
            role="menuitem"
            label={copyLabel}
            disabled={copyState === "pending"}
            icon={copyState === "copied" ? <Check size={14} /> : <Copy size={14} />}
            onClick={() => void copyPath()}
          />
        </Tooltip>
      </div>
      <span className="desktop-project-menu-header-status" role="status">
        {copyState === "copied" ? t("common.action.copied") : null}
      </span>
      {copyState === "failed" && (
        <div className="desktop-project-menu-header-error" role="alert">
          {t("shell.workspaceSwitcher.copyPathFailed")}
        </div>
      )}
    </div>
    <DesktopMenuSeparator />
  </>);
}

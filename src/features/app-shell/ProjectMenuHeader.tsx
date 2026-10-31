import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import { DesktopMenuItem } from "../../components/DesktopMenu";
import { writeClipboardText } from "../../lib/clipboard";
import { getWorkspacePathForDisplay } from "../../lib/workspaceHomeModel";

/**
 * The name is already on the row that opened this menu, so it only says where the
 * folder is, on one quiet line, and leads with copying the full path.
 */
export function ProjectMenuHeader({ path }: { path: string }) {
  const { t } = useLocalization();
  const [copyState, setCopyState] = useState<"idle" | "pending" | "copied" | "failed">("idle");
  const copied = copyState === "copied";
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
    <bdi className="desktop-project-menu-header-path" dir="ltr">{getWorkspacePathForDisplay(path)}</bdi>
    <DesktopMenuItem
      icon={copied ? <Check size={14} /> : <Copy size={14} />}
      label={t(copied ? "common.action.copied" : "shell.workspaceSwitcher.copyPath")}
      onClick={() => void copyPath()}
    />
    <span className="desktop-project-menu-header-status" role="status">
      {copied ? t("common.action.copied") : null}
    </span>
    {copyState === "failed" && (
      <div className="desktop-project-menu-header-error" role="alert">
        {t("shell.workspaceSwitcher.copyPathFailed")}
      </div>
    )}
  </>);
}

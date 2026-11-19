import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import { DesktopMenuItem } from "./DesktopMenu";
import { writeClipboardText } from "../lib/clipboard";

/**
 * Copying the folder's full path, first in its menu. The path itself is not printed:
 * a raw path reads as a title the menu does not need, and copying is what it is for.
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

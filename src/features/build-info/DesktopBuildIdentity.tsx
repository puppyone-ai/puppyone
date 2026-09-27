import { Tooltip } from "@puppyone/shared-ui";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import type { DesktopBuildChannel, DesktopBuildInfo } from "../../types/electron";
import { useDesktopBuildInfo } from "./useDesktopBuildInfo";

const CHANNEL_MESSAGE_IDS: Record<DesktopBuildChannel, string> = {
  dev: "shell.build.channel.dev",
  internal: "shell.build.channel.internal",
  stable: "shell.build.channel.stable",
};

export function DesktopBuildVersionSettingsRow() {
  const { t } = useLocalization();
  const buildInfo = useDesktopBuildInfo();
  const [copied, setCopied] = useState(false);
  if (!buildInfo) return null;
  const channel = t(CHANNEL_MESSAGE_IDS[buildInfo.channel]);
  const copyVersionInformation = async () => {
    await copyTextToClipboard(formatDesktopBuildDiagnostics(buildInfo));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <div className="desktop-settings-row desktop-settings-row-control desktop-build-version-row">
      <span>{t("settings.general.version")}</span>
      <div className="desktop-build-version-value">
        <span
          className="desktop-build-version-text"
          data-build-channel={buildInfo.channel}
          dir="ltr"
        >
          <span dir="auto">{channel}</span>
          <span aria-hidden="true"> · </span>
          {buildInfo.version}
        </span>
        <Tooltip content={t(copied ? "shell.build.copy.copied" : "shell.build.copy.action")}><button
          className="desktop-settings-action desktop-build-version-copy"
          type="button"
          aria-label={t(copied ? "shell.build.copy.copied" : "shell.build.copy.action")}
          onClick={() => void copyVersionInformation()}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button></Tooltip>
      </div>
    </div>
  );
}

export function formatDesktopBuildDiagnostics(buildInfo: DesktopBuildInfo): string {
  return [
    "PuppyOne Desktop",
    `Channel: ${buildInfo.channel}`,
    `Version: ${buildInfo.version}`,
    `Build ID: ${buildInfo.buildId}`,
    `Commit: ${buildInfo.commitSha}`,
    `Built at: ${buildInfo.builtAt}`,
    `Source dirty: ${buildInfo.sourceDirty}`,
  ].join("\n");
}

async function copyTextToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("The version information could not be copied.");
}

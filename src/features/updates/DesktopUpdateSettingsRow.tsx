import { AlertTriangle, CheckCircle2, Download, Info, RefreshCw, RotateCw } from "lucide-react";
import { useLocalization, type MessageFormatter } from "@puppyone/localization";
import type { DesktopUpdateState, DesktopUpdateStatus } from "../../types/electron";

export function DesktopUpdateSettingsRow({
  state,
  onCheckForUpdates,
  onUpdateNow,
}: {
  state: DesktopUpdateState;
  onCheckForUpdates: () => void;
  onUpdateNow: () => void;
}) {
  const { t, formatNumber } = useLocalization();
  const action = getSettingsAction(state, t, formatNumber);
  const Icon = getUpdateIcon(state.status);
  const detail = state.error
    ?? state.blockers[0]?.detail
    ?? state.blockers[0]?.label
    ?? getUpdateDetail(state, t, formatNumber);

  return (
    <div className="desktop-settings-row desktop-settings-row-control">
      <span>{t("updates.settings.title")}</span>
      <button
        className={`desktop-settings-action ${action.primary ? "primary" : ""}`}
        type="button"
        title={detail}
        aria-label={`${action.label}. ${detail}`}
        disabled={action.disabled}
        onClick={action.kind === "check" ? onCheckForUpdates : onUpdateNow}
      >
        <Icon size={14} className={action.spinning ? "spin" : undefined} />
        <span>{action.label}</span>
      </button>
    </div>
  );
}

function getUpdateIcon(status: DesktopUpdateStatus) {
  if (status === "disabled") return Info;
  if (status === "downloaded" || status === "installing") return RotateCw;
  if (status === "idle" || status === "checking" || status === "downloading") return RefreshCw;
  if (status === "error" || status === "blocked") return AlertTriangle;
  if (status === "not-available") return CheckCircle2;
  return Download;
}

function getSettingsAction(
  state: DesktopUpdateState,
  t: MessageFormatter,
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string,
): {
  kind: "check" | "update";
  label: string;
  disabled: boolean;
  spinning: boolean;
  primary: boolean;
} {
  if (state.status === "disabled") {
    return {
      kind: "check",
      label: t(state.channel === "dev" ? "updates.action.developmentBuild" : "updates.action.unavailable"),
      disabled: true,
      spinning: false,
      primary: false,
    };
  }
  if (state.status === "checking") {
    return { kind: "check", label: t("updates.action.checking"), disabled: true, spinning: true, primary: false };
  }
  if (state.status === "not-available") {
    return { kind: "check", label: t("updates.action.upToDate"), disabled: true, spinning: false, primary: false };
  }
  if (state.status === "downloading") {
    return {
      kind: "update",
      label: formatDownloadProgress(state, formatNumber),
      disabled: true,
      spinning: true,
      primary: true,
    };
  }
  if (state.status === "installing") {
    return { kind: "update", label: t("updates.action.restarting"), disabled: true, spinning: true, primary: true };
  }
  if (state.status === "downloaded" || state.status === "blocked") {
    return { kind: "update", label: t("updates.action.restart"), disabled: false, spinning: false, primary: true };
  }
  if (state.status === "available") {
    return { kind: "update", label: t("updates.action.download"), disabled: false, spinning: false, primary: true };
  }
  if (state.status === "error") {
    return { kind: "update", label: t("updates.action.tryAgain"), disabled: false, spinning: false, primary: false };
  }
  return { kind: "check", label: t("updates.action.check"), disabled: false, spinning: false, primary: false };
}

function getUpdateDetail(
  state: DesktopUpdateState,
  t: MessageFormatter,
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string,
): string {
  if (state.status === "disabled") return state.reason ?? t("updates.detail.disabled");
  if (state.status === "idle") return t("updates.detail.idle", { version: state.currentVersion, channel: state.channel });
  if (state.status === "checking") return t("updates.detail.checking");
  if (state.status === "not-available") return t("updates.detail.current", { version: state.currentVersion });
  if (state.status === "available") return t("updates.detail.available", { version: state.availableVersion ?? t("updates.version.new") });
  if (state.status === "downloading") return t("updates.detail.downloading", { progress: formatDownloadProgress(state, formatNumber) });
  if (state.status === "downloaded") return t("updates.detail.downloaded", { version: state.availableVersion ?? t("updates.version.new") });
  if (state.status === "installing") return t("updates.detail.installing");
  if (state.status === "blocked") return t("updates.detail.blocked");
  if (state.status === "error") return t("updates.detail.error");
  return t("updates.detail.unknown");
}

function formatDownloadProgress(
  state: DesktopUpdateState,
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string,
): string {
  const percent = Math.max(0, Math.min(100, Math.round(state.progress?.percent ?? 0)));
  return formatNumber(percent / 100, { style: "percent", maximumFractionDigits: 0 });
}

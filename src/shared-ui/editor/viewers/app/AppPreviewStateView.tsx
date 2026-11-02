import { AlertCircle, Play } from "lucide-react";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import type { AppPreviewViewState } from "./types";

export function AppPreviewStateView({
  appName,
  state,
  canRun,
  onRun,
  onEditSetup,
  onViewLogs,
  onCancel,
}: {
  appName: string;
  state: AppPreviewViewState;
  canRun: boolean;
  onRun: () => void;
  onEditSetup: () => void;
  onViewLogs: () => void;
  onCancel: () => void;
}) {
  const { t } = useLocalization();
  const runtime = state.runtime;

  if (state.status === "error") {
    const detail = getFriendlyFailure(state.error?.detail, runtime?.reason, t);
    const lastOutput = getLastOutput(runtime?.logs);
    return (
      <div className="app-preview-state app-preview-attention">
        <AlertCircle size={23} strokeWidth={1.8} aria-hidden="true" />
        <strong>{t("editor.app.setup.failureTitle")}</strong>
        <span>{detail}</span>
        <dl className="app-preview-runtime-summary">
          {runtime?.command?.length ? <><dt>{t("editor.app.setup.command")}</dt><dd><code>{runtime.command.join(" ")}</code></dd></> : null}
          {runtime?.cwd ? <><dt>{t("editor.app.setup.folder")}</dt><dd><code>{runtime.cwd}</code></dd></> : null}
          {runtime?.exitCode != null ? <><dt>{t("editor.app.setup.exitCode")}</dt><dd><code>{runtime.exitCode}</code></dd></> : null}
          {lastOutput ? <><dt>{t("editor.app.setup.lastOutput")}</dt><dd><code>{lastOutput}</code></dd></> : null}
        </dl>
        <div className="app-preview-state-actions">
          <button type="button" onClick={onEditSetup}>{t("editor.app.setup.edit")}</button>
          <button type="button" onClick={onViewLogs}>{t("editor.app.setup.viewLogs")}</button>
          <button className="primary" type="button" disabled={!canRun} onClick={onRun}>{t("editor.app.setup.tryAgain")}</button>
        </div>
      </div>
    );
  }

  if (state.status === "stopped") {
    return (
      <div className="app-preview-state">
        <strong>{t("editor.app.stoppedName", { name: bidiIsolate(appName) })}</strong>
        <span>{t("editor.app.stoppedHint")}</span>
        <button type="button" disabled={!canRun} onClick={onRun}>
          <Play size={13} aria-hidden="true" />
          {t("editor.app.run")}
        </button>
      </div>
    );
  }

  return (
    <div className="app-preview-state app-preview-starting">
      <div className="app-preview-spinner" aria-hidden="true" />
      <strong>{t("editor.app.setup.startingTitle")}</strong>
      <span>{t("editor.app.setup.startingDetail")}</span>
      {runtime ? (
        <dl className="app-preview-runtime-summary">
          {runtime.command?.length ? <><dt>{t("editor.app.setup.command")}</dt><dd><code>{runtime.command.join(" ")}</code></dd></> : null}
          {runtime.cwd ? <><dt>{t("editor.app.setup.folder")}</dt><dd><code>{runtime.cwd}</code></dd></> : null}
          {runtime.url ? <><dt>{t("editor.app.setup.waitingFor")}</dt><dd><code>{runtime.url}</code></dd></> : null}
        </dl>
      ) : null}
      {state.status === "starting" ? <button type="button" onClick={onCancel}>{t("common.action.cancel")}</button> : null}
    </div>
  );
}

function getFriendlyFailure(
  detail: string | null | undefined,
  reason: string | null | undefined,
  t: ReturnType<typeof useLocalization>["t"],
): string {
  if (reason === "process-exit" || /process exited/i.test(detail ?? "")) {
    return t("editor.app.setup.failureProcess");
  }
  if (reason === "health-timeout" || /become ready|health/i.test(detail ?? "")) {
    return t("editor.app.setup.failureTimeout");
  }
  if (reason === "preflight" || /not found|missing|no such file/i.test(detail ?? "")) {
    return t("editor.app.setup.failurePreflight");
  }
  if (/cancel/i.test(detail ?? "")) return t("editor.app.setup.failureCancelled");
  return t("editor.app.setup.failureGeneric");
}

function getLastOutput(logs: string | null | undefined): string | null {
  if (!logs) return null;
  const lines = logs.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const line = [...lines].reverse().find((candidate) => !candidate.startsWith("[puppyone]"));
  return line?.slice(0, 220) ?? null;
}

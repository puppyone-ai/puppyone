import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { DesktopDialogCloseButton, DesktopDialogRoot } from "../../components/DesktopDialog";
import { DesktopMenuItem, DesktopMenuSection } from "../../components/DesktopMenu";
import type { GitBranchSummary, GitStatusSnapshot } from "../../types/electron";
import { VersionControlIcon } from "./VersionControlIcon";
import { bidiIsolate, useLocalization, type MessageFormatter } from "@puppyone/localization";

export type GitOperationErrorCode =
  | "checkout-overwrite"
  | "checkout-worktree"
  | "checkout-not-found"
  | "checkout"
  | "init"
  | "pull-diverged"
  | "pull-conflict"
  | "pull"
  | "push-rejected"
  | "push"
  | "commit-push-rejected"
  | "commit-push"
  | "cloud-backup"
  | "commit"
  | "discard-selection"
  | "commit-push-no-remote"
  | "commit-push-needs-pull"
  | "workspace-not-repository"
  | "generic";

export type GitOperationErrorState = {
  operation: string;
  code: GitOperationErrorCode;
  detail: string | null;
  raw: string | null;
  workspacePath: string | null;
};

export function createGitOperationErrorState(
  error: unknown,
  operation: string,
  workspacePath: string | null,
): GitOperationErrorState {
  const raw = error instanceof Error ? error.message : String(error);
  const descriptor = classifyGitOperationError(error, operation);
  return {
    operation,
    ...descriptor,
    raw: raw.trim() || null,
    workspacePath,
  };
}

export function createGitOperationMessageState(
  code: Extract<GitOperationErrorCode,
    "discard-selection" | "commit-push-no-remote" | "commit-push-needs-pull" | "workspace-not-repository">,
  operation: string,
  workspacePath: string | null,
): GitOperationErrorState {
  return {
    operation,
    code,
    detail: null,
    raw: null,
    workspacePath,
  };
}

export function classifyGitOperationError(
  error: unknown,
  operation: string,
): Pick<GitOperationErrorState, "code" | "detail"> {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = cleanGitOperationError(rawMessage);

  if (operation === "checkout") {
    if (/local changes.*overwritten|would be overwritten|commit or stash|commit your changes or stash/i.test(message)) {
      return { code: "checkout-overwrite", detail: null };
    }
    if (/already checked out|already used by worktree/i.test(message)) {
      return { code: "checkout-worktree", detail: null };
    }
    if (/pathspec .* did not match|invalid reference|not a commit|cannot find that branch/i.test(message)) {
      return { code: "checkout-not-found", detail: null };
    }
    return { code: "checkout", detail: message || null };
  }

  if (operation === "init") {
    return { code: "init", detail: message || null };
  }

  if (operation === "pull") {
    if (/\bconflict\b|could not apply|resolve all conflicts manually/i.test(message)) {
      return { code: "pull-conflict", detail: null };
    }
    if (/not possible to fast-forward|diverging branches|diverged|non-fast-forward/i.test(message)) {
      return { code: "pull-diverged", detail: null };
    }
    return { code: "pull", detail: message || null };
  }

  if (operation === "push" || operation === "publish") {
    if (/non-fast-forward|fetch first|rejected/i.test(message)) {
      return { code: "push-rejected", detail: null };
    }
    return { code: "push", detail: message || null };
  }

  if (operation === "commit-push") {
    if (/non-fast-forward|fetch first|rejected/i.test(message)) {
      return { code: "commit-push-rejected", detail: null };
    }
    return { code: "commit-push", detail: message || null };
  }

  if (operation === "cloud-backup") {
    return { code: "cloud-backup", detail: message || null };
  }

  if (operation === "commit" || operation === "commit-switch") {
    return { code: "commit", detail: message || null };
  }

  return { code: "generic", detail: message || null };
}

export function formatGitOperationErrorState(error: GitOperationErrorState, t: MessageFormatter): string {
  const summary = t(`source-control.error.${error.code}`);
  return error.detail ? t("source-control.error.withDetail", { summary, detail: error.detail }) : summary;
}

function cleanGitOperationError(value: string): string {
  const withoutIpcPrefix = value
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "");
  const withoutOperationPrefix = withoutIpcPrefix
    .replace(/^Unable to checkout branch:\s*/i, "")
    .replace(/^Unable to initialize repository:\s*/i, "")
    .replace(/^Unable to stage changes:\s*/i, "")
    .replace(/^Unable to commit changes:\s*/i, "")
    .replace(/^Unable to pull changes:\s*/i, "")
    .replace(/^Unable to fetch cloud changes:\s*/i, "")
    .replace(/^Unable to pull cloud changes:\s*/i, "")
    .replace(/^Unable to push changes:\s*/i, "")
    .replace(/^Unable to stash changes:\s*/i, "")
    .replace(/^Unable to preview remote change:\s*/i, "")
    .replace(/^Unable to preview committed change:\s*/i, "")
    .replace(/^Unable to read remote file diff:\s*/i, "")
    .replace(/^Unable to read committed file diff:\s*/i, "");
  const lines = withoutOperationPrefix
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^Command failed:/i.test(line))
    .filter((line) => !/^git -C\s/i.test(line))
    .filter((line) => !line.includes(" git -C "));

  return lines.join(" ").replace(/^Error:\s*/i, "").trim();
}

export function formatGitPreviewError(error: unknown, t: MessageFormatter): string {
  const message = cleanGitOperationError(error instanceof Error ? error.message : String(error));
  if (/no merge base|no common history|do not share a common history/i.test(message)) {
    return t("source-control.error.previewNoCommonHistory");
  }
  if (/remote branch is not available|branch is not available locally|bad revision|unknown revision|ambiguous argument/i.test(message)) {
    return t("source-control.error.previewBranchUnavailable");
  }
  return message
    ? t("source-control.error.previewWithDetail", { detail: message })
    : t("source-control.error.preview");
}

export function isBranchOverwriteErrorCode(code: GitOperationErrorCode): boolean {
  return code === "checkout-overwrite";
}

export function getGitChangeCount(status: GitStatusSnapshot): number {
  return status.stagedEntries.length + status.unstagedEntries.length + status.untrackedEntries.length;
}

export function BranchSwitchConflictDialog({
  branchName,
  changeCount,
  error,
  loading,
  operationLoading,
  onCancel,
  onStashAndSwitch,
  onCommitAndSwitch,
}: {
  branchName: string;
  changeCount: number;
  error: string | null;
  loading: boolean;
  operationLoading: string | null;
  onCancel: () => void;
  onStashAndSwitch: () => void;
  onCommitAndSwitch: () => void;
}) {
  const { t, formatNumber } = useLocalization();
  return (
    <DesktopDialogRoot
      onClose={onCancel}
      dismissOnBackdrop={!loading}
    >
      <section
        className="desktop-dialog-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="branch-switch-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="desktop-dialog-header">
          <div className="desktop-dialog-title-row">
            <span className="desktop-dialog-leading warning" aria-hidden="true">
              <AlertTriangle size={17} />
            </span>
            <div>
              <h2 id="branch-switch-dialog-title">{t("source-control.dialog.switch.title")}</h2>
              <p>{t("source-control.dialog.switch.detail", { branch: bidiIsolate(branchName) })}</p>
            </div>
          </div>
          <DesktopDialogCloseButton disabled={loading} onClick={onCancel} />
        </header>

        <div className="desktop-dialog-body" data-po-scrollbar="content">
          <div className="desktop-dialog-callout">
            <strong>{formatNumber(changeCount)}</strong>
            <span>{t("source-control.dialog.switch.changeCount", { count: changeCount })}</span>
          </div>
          <p className="desktop-dialog-note">{t("source-control.dialog.switch.note")}</p>
          {error && <p className="desktop-dialog-error">{error}</p>}
        </div>

        <footer className="desktop-dialog-footer two-action">
          <button className="desktop-dialog-button" type="button" disabled={loading} onClick={onStashAndSwitch}>
            {t(operationLoading === "stash" ? "source-control.dialog.switch.stashing" : "source-control.dialog.switch.stashAction")}
          </button>
          <button className="desktop-dialog-button primary" type="button" disabled={loading} onClick={onCommitAndSwitch}>
            {t(operationLoading === "commit-switch" ? "source-control.action.committing" : "source-control.dialog.switch.commitAction")}
          </button>
        </footer>
      </section>
    </DesktopDialogRoot>
  );
}

export function GitOperationErrorDialog({
  error,
  onClose,
  onPull,
}: {
  error: GitOperationErrorState;
  onClose: () => void;
  onPull?: () => void;
}) {
  const { t } = useLocalization();
  const [copied, setCopied] = useState(false);
  const message = formatGitOperationErrorState(error, t);
  const prompt = buildGitFixPrompt(error, message, t);
  const recommendsPull = [
    "push-rejected",
    "commit-push-rejected",
    "commit-push-needs-pull",
  ].includes(error.code) && Boolean(onPull);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <DesktopDialogRoot onClose={onClose}>
      <section
        className="desktop-dialog-surface desktop-git-error-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="git-operation-error-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="desktop-dialog-header">
          <div className="desktop-dialog-title-row">
            <span className="desktop-dialog-leading warning" aria-hidden="true">
              <AlertTriangle size={17} />
            </span>
            <div>
              <h2 id="git-operation-error-title">{t("source-control.dialog.error.title")}</h2>
              <p>{t("source-control.dialog.error.detail")}</p>
            </div>
          </div>
          <DesktopDialogCloseButton onClick={onClose} />
        </header>

        <div className="desktop-dialog-body" data-po-scrollbar="content">
          <p className="desktop-git-error-dialog-message">{message}</p>
          {error.raw && (
            <div className="desktop-git-error-dialog-raw">
              <span>{t("source-control.dialog.error.rawOutput")}</span>
              <pre dir="ltr" data-po-scrollbar="content">{error.raw}</pre>
            </div>
          )}
        </div>

        <footer className="desktop-dialog-footer">
          <button className="desktop-dialog-button" type="button" onClick={() => void copyPrompt()}>
            {t(copied ? "common.action.copied" : "source-control.dialog.error.copyPrompt")}
          </button>
          {recommendsPull ? (
            <button className="desktop-dialog-button primary" type="button" onClick={onPull}>
              {t("source-control.sync.pull")}
            </button>
          ) : (
            <button className="desktop-dialog-button" type="button" onClick={onClose}>
              {t("common.action.close")}
            </button>
          )}
        </footer>
      </section>
    </DesktopDialogRoot>
  );
}

function buildGitFixPrompt(error: GitOperationErrorState, summary: string, t: MessageFormatter): string {
  return [
    t("source-control.prompt.intro"),
    "",
    t("source-control.prompt.operation", { operation: error.operation }),
    t("source-control.prompt.workspace", { workspace: error.workspacePath ?? t("source-control.prompt.unknown") }),
    "",
    t("source-control.prompt.summary"),
    summary,
    ...(error.raw ? ["", t("source-control.prompt.rawOutput"), "```text", error.raw, "```"] : []),
    "",
    t("source-control.prompt.request"),
  ].join("\n");
}

export function BranchMenuGroup({
  title,
  branches,
  operationLoading,
  onCheckout,
  onDone,
}: {
  title: string;
  branches: GitBranchSummary[];
  operationLoading: string | null;
  onCheckout: (branchName: string, remote: boolean) => Promise<boolean>;
  onDone: () => void;
}) {
  const { t } = useLocalization();
  if (branches.length === 0) return null;

  return (
    <DesktopMenuSection className="desktop-branch-menu-group" label={title}>
      {branches.map((branch) => (
        <DesktopMenuItem
          key={`${branch.remote ? "remote" : "local"}:${branch.name}`}
          className="desktop-branch-menu-row"
          tooltip={branch.lastCommitMessage ?? branch.name}
          selected={branch.current}
          disabled={Boolean(operationLoading) || branch.current}
          icon={<VersionControlIcon size={13} />}
          label={branch.name}
          trailing={branch.current ? t("source-control.branch.current") : undefined}
          onClick={() => {
            void (async () => {
              const checkedOut = await onCheckout(branch.name, branch.remote);
              if (checkedOut) onDone();
            })();
          }}
        />
      ))}
    </DesktopMenuSection>
  );
}

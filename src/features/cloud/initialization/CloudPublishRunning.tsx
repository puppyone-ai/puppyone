import type { ReactNode } from "react";
import { bidiIsolate } from "@puppyone/localization";
import { useLocalization } from "@puppyone/localization/react";
import type { CloudPublishProgressStage, CloudPublishTransfer } from "../../../types/electron";
import {
  CloudProjectActivationFrame,
  useCloudProjectActivationScope,
} from "../components/CloudProjectActivation";
import { CloudPublishProgressIndicator } from "./CloudPublishProgressIndicator";
import "./initialization.css";

/**
 * The first publish, shown as the activation banner in motion.
 *
 * The user just pressed the action on that banner, so the run keeps its
 * picture — the folder, the wire, Cloud — and only replaces the pitch with
 * the progress. Closing the dialog does not stop anything; the Header keeps
 * stating the run and reopens this view.
 *
 * A run that stopped before it finished is the same picture, standing still
 * at the step where it stopped, with the one action that continues it. There
 * is no separate recovery page: from the user's side it is the same task.
 *
 * Discarding is not that task. Once the user has chosen to discard, the send
 * steps describe nothing that will happen again, so a discard that did not
 * finish passes `steps={false}` and keeps only the picture, the words and the
 * one action that finishes it.
 */
export function CloudPublishRunning({
  projectName, stage, transfer = null, paused = false, steps = true, title, lead, action, secondary, notice,
}: {
  projectName: string;
  stage: CloudPublishProgressStage;
  /** How far the send has got, while uploading. */
  transfer?: CloudPublishTransfer | null;
  /** Stopped at `stage`; `action` continues it. */
  paused?: boolean;
  /** Draw the send steps. Off while finishing a discard, which sends nothing. */
  steps?: boolean;
  title?: string;
  lead?: string;
  action?: ReactNode;
  /** Replaces the default secondary action: "Continue in background" while running. */
  secondary?: ReactNode;
  /** Errors and confirmations, beneath the progress. */
  notice?: ReactNode;
}) {
  const { t } = useLocalization();
  const { onDismiss } = useCloudProjectActivationScope();
  const name = projectName.trim();
  const runningTitle = name
    ? t("cloud.initialize.progress.title", { project: bidiIsolate(name) })
    : t("cloud.initialize.progress.titleFallback");
  // Running: nothing to decline, the only way out is to let it continue
  // without the dialog. Paused: the caller names its own choices.
  const hide = onDismiss ? (
    <button
      type="button"
      className="desktop-dialog-button desktop-cloud-publish-running-hide"
      data-desktop-dialog-initial-focus="true"
      onClick={onDismiss}
    >
      {t("cloud.initialize.progress.hide")}
    </button>
  ) : false;
  return (
    <section
      className="desktop-cloud-publish-running"
      data-paused={paused || undefined}
      aria-label={t("cloud.initialize.progress.stepsLabel")}
    >
      <CloudProjectActivationFrame
        busy={!paused}
        projectName={name || null}
        title={title ?? runningTitle}
        lead={lead ?? t("cloud.initialize.progress.lead")}
        secondary={secondary !== undefined ? secondary : hide}
        action={action}
      >
        {/* The lead already says the run needs PuppyOne open. */}
        {steps && <CloudPublishProgressIndicator stage={stage} transfer={transfer} t={t} keepOpenNote={false}
          paused={paused} />}
        {notice && <div className="desktop-cloud-publish-running-notice">{notice}</div>}
      </CloudProjectActivationFrame>
    </section>
  );
}

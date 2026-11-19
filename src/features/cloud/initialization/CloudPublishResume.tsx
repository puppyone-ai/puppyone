import { useEffect, useRef, useState } from "react";
import { bidiIsolate } from "@puppyone/localization";
import { useLocalization } from "@puppyone/localization/react";
import type { MessageFormatter } from "@puppyone/localization/core";
import type { CloudPublishProgressStage, CloudPublishState } from "../../../types/electron";
import { getCloudInitializationDescription, getCloudPushAction } from "./cloudInitializationModel";
import { CloudPublishRunning } from "./CloudPublishRunning";

/** Interrupted publish: Retry checks the outcome, then resends if needed.
 * Project/access/remote setup is retained; byte-level upload resume is not promised.
 *
 * Discard deletes the empty cloud project. If that deletion does not finish,
 * the screen is no longer about sending: it says the discard did not finish
 * and offers Discard again, the same word the user already chose, rather than
 * a "cleanup" they never asked for beside a send that is not coming back.
 */
export function CloudPublishResume({ projectName, state, busy, error, onContinue, onAbandon }: {
  projectName: string;
  state: CloudPublishState;
  busy: boolean;
  error: string | null;
  onContinue: () => void;
  onAbandon?: () => void;
}) {
  const { t } = useLocalization();
  const [confirmingAbandon, setConfirmingAbandon] = useState(false);
  const { discarding, startDiscard } = useDiscardInFlight(busy);
  const confirmation = useRef<HTMLDivElement>(null);
  const cancelAbandon = useRef<HTMLButtonElement>(null);
  const pushAction = getCloudPushAction(state.availableActions);
  const cleaningUp = isCleanupRequested(state);
  const finishCleanup = state.availableActions.includes("finish-cleanup") ? onAbandon : undefined;
  // Giving up is only possible while the Cloud project is still empty.
  const abandon = state.availableActions.includes("delete-empty-project") ? onAbandon : undefined;
  const discardLabel = t(discarding
    ? "cloud.initialize.resume.discarding"
    : "cloud.initialize.resume.abandon");

  // The question appears beneath the progress; bring it into view and put
  // focus on the safe answer, so Enter never gives up by accident.
  useEffect(() => {
    if (!confirmingAbandon) return;
    confirmation.current?.scrollIntoView?.({ block: "nearest" });
    cancelAbandon.current?.focus();
  }, [confirmingAbandon]);

  const { title, lead } = resolveResumeCopy({ projectName, state, cleaningUp, pushAction, t });

  let action = null;
  if (finishCleanup) {
    // Already confirmed once, when the user first chose Discard.
    action = <button type="button" className="desktop-dialog-button primary desktop-cloud-publish-primary"
      data-desktop-dialog-initial-focus="true" aria-busy={discarding || undefined} disabled={busy}
      onClick={() => startDiscard(finishCleanup)}>
      {discardLabel}
    </button>;
  } else if (pushAction) {
    action = <button type="button" className="desktop-dialog-button primary desktop-cloud-publish-primary"
      data-desktop-dialog-initial-focus="true" aria-busy={busy || undefined} disabled={busy || confirmingAbandon}
      onClick={onContinue}>
      {t("cloud.initialize.resume.continue")}
    </button>;
  }
  const secondary = abandon && !confirmingAbandon ? (
    <button type="button" className="desktop-dialog-button desktop-cloud-publish-resume-abandon" disabled={busy}
      aria-busy={discarding || undefined} onClick={() => setConfirmingAbandon(true)}>
      {discardLabel}
    </button>
  ) : false;

  const notice = <>
    {error && <p className="desktop-cloud-publish-resume-error" role="alert">{error}</p>}
    {abandon && confirmingAbandon && (
      <div ref={confirmation} className="desktop-cloud-publish-resume-confirm" role="alertdialog"
        aria-label={t("cloud.initialize.resume.abandonTitle")}>
        <strong>{t("cloud.initialize.resume.abandonTitle")}</strong>
        <p>{t("cloud.initialize.resume.abandonDescription", { project: bidiIsolate(state.projectName) })}</p>
        <div className="desktop-cloud-publish-resume-confirm-actions">
          <button ref={cancelAbandon} type="button" className="desktop-dialog-button"
            onClick={() => setConfirmingAbandon(false)}>
            {t("cloud.common.cancel")}
          </button>
          <button type="button" className="desktop-dialog-button primary desktop-cloud-publish-resume-confirm-abandon"
            disabled={busy} onClick={() => {
              setConfirmingAbandon(false);
              startDiscard(abandon);
            }}>
            {t("cloud.initialize.resume.abandonConfirm")}
          </button>
        </div>
      </div>
    )}
  </>;

  return <CloudPublishRunning projectName={projectName} stage={resolvePausedStage(state)} paused
    steps={!cleaningUp} title={title} lead={lead} action={action} secondary={secondary} notice={notice} />;
}

/**
 * Whether a Discard this view started is still running, so its button can say
 * so. `busy` alone cannot tell: reading the saved state is busy too. The
 * discard is over when the work it started ends, busy going back to idle.
 */
function useDiscardInFlight(busy: boolean) {
  const [started, setStarted] = useState(false);
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) setStarted(false);
    wasBusy.current = busy;
  }, [busy]);
  return {
    discarding: started && busy,
    startDiscard: (run: () => void) => {
      setStarted(true);
      run();
    },
  };
}

function resolveResumeCopy({ projectName, state, cleaningUp, pushAction, t }: {
  projectName: string;
  state: CloudPublishState;
  cleaningUp: boolean;
  pushAction: ReturnType<typeof getCloudPushAction>;
  t: MessageFormatter;
}): { title: string; lead: string } {
  const name = projectName.trim();
  let title: string;
  if (cleaningUp) title = t("cloud.initialize.resume.cleanupTitle");
  else if (name) title = t("cloud.initialize.resume.title", { project: bidiIsolate(name) });
  else title = t("cloud.initialize.resume.titleFallback");
  const lead = cleaningUp || !pushAction
    ? getCloudInitializationDescription(state, t)
    : t("cloud.initialize.resume.lead");
  return { title, lead };
}

/** The user chose Discard and deleting the empty cloud project has not finished. */
export function isCleanupRequested(state: CloudPublishState): boolean {
  return state.cleanup === "requested" || state.cleanup === "deleting" || state.cleanup === "failed";
}

/** Where the run stood when it stopped, in the steps the progress list shows. */
export function resolvePausedStage(state: CloudPublishState): CloudPublishProgressStage {
  if (state.project === "absent" || state.project === "creating") return "creating-project";
  if (state.push === "uncertain" || state.push === "confirming") return "confirming";
  return "uploading";
}

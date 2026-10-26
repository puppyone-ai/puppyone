import type { CSSProperties } from "react";
import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import type { MessageFormatter } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import type { CloudPublishProgressStage, CloudPublishTransfer } from "../../../types/electron";
// The list is shown by surfaces outside this folder, so it carries its own
// appearance instead of depending on who else happens to be mounted.
import "./initialization.css";

const CLOUD_PUBLISH_PROGRESS_STEPS = [
  "project",
  "access",
  "remote",
  "upload",
  "finish",
] as const;

/**
 * Signing in, as a step of this same list rather than a gate in front of it.
 *
 * `pending` means the work that needs no account is still running, `active`
 * means the list is waiting for the user to sign in, and `done` means the rest
 * of the list may proceed. Surfaces that have an account before they start
 * omit it and the list renders exactly as it always has.
 */
export type CloudPublishAccountStep = "pending" | "active" | "done";

const ACCOUNT_STEP = "account";
/** After the local project work, because that part needs nobody's identity. */
const ACCOUNT_STEP_INDEX = 1;

export function CloudPublishProgressIndicator({
  stage,
  t,
  account,
  keepOpenNote = true,
  paused = false,
  transfer = null,
}: {
  stage: CloudPublishProgressStage;
  t: MessageFormatter;
  account?: CloudPublishAccountStep;
  /** Off when the surrounding surface already states that PuppyOne must stay open. */
  keepOpenNote?: boolean;
  /** The run stopped at the current step and waits for the user to continue it. */
  paused?: boolean;
  /** How far the send has got, while uploading. Drawn on the Upload row only. */
  transfer?: CloudPublishTransfer | null;
}) {
  const steps = resolveCloudPublishProgressSteps(account);
  const activeIndex = resolveCloudPublishProgressActiveIndex(stage, account);
  const completed = stage === "completed" && (!account || account === "done");
  const currentLabel = resolveCurrentLabel({ step: steps[activeIndex], stage, paused, t });
  const sending = stage === "uploading" && !paused && transfer ? transfer : null;
  // The current step counts as half done, so the bar moves as soon as a step
  // starts instead of sitting still through the longest one.
  const fraction = completed ? 1 : Math.min(1, (activeIndex + 0.5) / steps.length);
  return (
    <div className="desktop-cloud-publish-progress" data-stage={stage} data-complete={completed || undefined}
      data-paused={paused && !completed ? true : undefined}>
      <div
        className="desktop-cloud-publish-progress-meter"
        role="progressbar"
        aria-label={t("cloud.initialize.progress.stepsLabel")}
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={completed ? steps.length : activeIndex}
        aria-valuetext={currentLabel}
        style={{ "--desktop-cloud-publish-progress": fraction } as CSSProperties}
      >
        <span className="desktop-cloud-publish-progress-meter-fill" />
      </div>
      <ol aria-label={t("cloud.initialize.progress.stepsLabel")}>
        {steps.map((step, index) => {
          const state = resolveStepState(index, activeIndex, completed);
          const isCurrent = state === "current";
          return (
            <li
              className={state === "pending" ? undefined : state}
              data-step-state={state}
              aria-current={isCurrent ? "step" : undefined}
              key={step}
            >
              <span className="desktop-cloud-publish-progress-marker" data-step-state={state} aria-hidden="true">
                <CloudPublishStepMark state={state} paused={paused} />
              </span>
              <span className="desktop-cloud-publish-progress-task">
                <strong>{t(`cloud.initialize.progress.step.${step}`)}</strong>
                {isCurrent && !sending && (
                  <small role={paused ? undefined : "status"} aria-live={paused ? undefined : "polite"} aria-atomic="true">
                    <span>{currentLabel}</span>
                  </small>
                )}
                {isCurrent && sending && <CloudPublishTransferReading transfer={sending} />}
              </span>
              {isCurrent && sending && <CloudPublishTransferMeter transfer={sending} label={currentLabel} />}
            </li>
          );
        })}
      </ol>
      {/* Nothing is being sent until the account step is behind us, so the
          constraint about staying open would not be true yet. */}
      {keepOpenNote && (!account || account === "done") && <p>{t("cloud.initialize.progress.keepOpen")}</p>}
    </div>
  );
}

/**
 * The upload's own numbers: share sent, bytes sent, current rate. No time
 * remaining and no total, because Git does not know the total size until it
 * has finished, and an estimate built on the share of files would jump about.
 *
 * Not a live region: these change several times a second, and the meter
 * beside them carries the same reading for assistive technology on request.
 */
function CloudPublishTransferReading({ transfer }: { transfer: CloudPublishTransfer }) {
  const { formatNumber } = useLocalization();
  return <small className="desktop-cloud-publish-transfer-reading">
    {formatCloudPublishTransfer(transfer, formatNumber)}
  </small>;
}

/** The same slim meter as the run's, scoped to the upload. */
function CloudPublishTransferMeter({ transfer, label }: { transfer: CloudPublishTransfer; label: string }) {
  const { formatNumber } = useLocalization();
  return <div
    className="desktop-cloud-publish-progress-meter desktop-cloud-publish-transfer"
    role="progressbar"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={transfer.percent}
    aria-valuetext={formatCloudPublishTransfer(transfer, formatNumber)}
    style={{ "--desktop-cloud-publish-progress": transfer.percent / 100 } as CSSProperties}
  >
    <span className="desktop-cloud-publish-progress-meter-fill" />
  </div>;
}

type NumberFormatter = (value: number, options?: Intl.NumberFormatOptions) => string;

/** "45% · 12.3 MB · 1.1 MB/s", leaving out what Git has not measured yet. */
export function formatCloudPublishTransfer(transfer: CloudPublishTransfer, formatNumber: NumberFormatter): string {
  const parts = [formatNumber(transfer.percent / 100, { style: "percent", maximumFractionDigits: 0 })];
  if (transfer.sentBytes !== null) parts.push(formatTransferBytes(transfer.sentBytes, formatNumber, false));
  if (transfer.bytesPerSecond !== null && transfer.percent < 100) {
    parts.push(formatTransferBytes(transfer.bytesPerSecond, formatNumber, true));
  }
  return parts.join(" · ");
}

const TRANSFER_UNITS = [
  ["gigabyte", 1000 ** 3],
  ["megabyte", 1000 ** 2],
  ["kilobyte", 1000],
] as const;

/** Decimal units, as network speeds are quoted; the locale picks the symbols. */
function formatTransferBytes(bytes: number, formatNumber: NumberFormatter, perSecond: boolean): string {
  const safe = Math.max(0, bytes);
  const [unit, size] = TRANSFER_UNITS.find(([, scale]) => safe >= scale) ?? ["byte", 1];
  const amount = safe / size;
  return formatNumber(amount, {
    style: "unit",
    unit: perSecond ? `${unit}-per-second` : unit,
    unitDisplay: "short",
    maximumFractionDigits: unit === "byte" || amount >= 100 ? 0 : 1,
  });
}

type CloudPublishStepState = "done" | "current" | "pending";

function resolveStepState(index: number, activeIndex: number, completed: boolean): CloudPublishStepState {
  if (completed || index < activeIndex) return "done";
  return index === activeIndex ? "current" : "pending";
}

/**
 * A check, a spinner, a warning or an empty ring: the state of a step, never
 * its number. A step that stopped is a warning rather than a pause, because
 * nobody paused it: it was interrupted and is waiting on the user.
 */
function CloudPublishStepMark({ state, paused }: { state: CloudPublishStepState; paused: boolean }) {
  if (state === "done") return <Check size={11} strokeWidth={2.6} />;
  if (state !== "current") return null;
  if (paused) return <TriangleAlert size={11} strokeWidth={2.4} />;
  return <LoaderCircle size={14} strokeWidth={2.2} className="animate-spin" />;
}

function resolveCurrentLabel({ step, stage, paused, t }: {
  step: string | undefined;
  stage: CloudPublishProgressStage;
  paused: boolean;
  t: MessageFormatter;
}): string {
  if (paused) return t("cloud.initialize.progress.paused");
  if (step === ACCOUNT_STEP) return t("cloud.initialize.progress.signing-in");
  return getCloudPublishProgressLabel(stage, t);
}

export function getCloudPublishProgressLabel(
  stage: CloudPublishProgressStage,
  t: MessageFormatter,
): string {
  return t(`cloud.initialize.progress.${stage}`);
}

function resolveCloudPublishProgressSteps(account?: CloudPublishAccountStep): readonly string[] {
  if (!account) return CLOUD_PUBLISH_PROGRESS_STEPS;
  return [
    ...CLOUD_PUBLISH_PROGRESS_STEPS.slice(0, ACCOUNT_STEP_INDEX),
    ACCOUNT_STEP,
    ...CLOUD_PUBLISH_PROGRESS_STEPS.slice(ACCOUNT_STEP_INDEX),
  ];
}

function resolveCloudPublishProgressActiveIndex(
  stage: CloudPublishProgressStage,
  account?: CloudPublishAccountStep,
): number {
  const base = getCloudPublishProgressStepIndex(stage);
  if (!account) return base;
  if (account === "active") return ACCOUNT_STEP_INDEX;
  if (account === "pending") return Math.min(base, ACCOUNT_STEP_INDEX - 1);
  return base < ACCOUNT_STEP_INDEX ? base : base + 1;
}

function getCloudPublishProgressStepIndex(stage: CloudPublishProgressStage): number {
  if (
    stage === "enabling-version-control"
    || stage === "creating-snapshot"
    || stage === "creating-branch"
    || stage === "validating"
    || stage === "creating-project"
  ) return 0;
  if (stage === "securing-credential") return 1;
  if (stage === "configuring-remote" || stage === "checking-remote") return 2;
  if (stage === "uploading" || stage === "confirming") return 3;
  return 4;
}

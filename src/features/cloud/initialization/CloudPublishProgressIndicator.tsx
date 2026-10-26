import { LoaderCircle } from "lucide-react";
import type { MessageFormatter } from "@puppyone/localization/core";
import type { CloudPublishProgressStage } from "../../../types/electron";
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
}: {
  stage: CloudPublishProgressStage;
  t: MessageFormatter;
  account?: CloudPublishAccountStep;
}) {
  const steps = resolveCloudPublishProgressSteps(account);
  const activeIndex = resolveCloudPublishProgressActiveIndex(stage, account);
  const completed = stage === "completed" && (!account || account === "done");
  return (
    <div className="desktop-cloud-publish-progress" data-stage={stage}>
      <ol aria-label={t("cloud.initialize.progress.stepsLabel")}>
        {steps.map((step, index) => {
          const isDone = completed || index < activeIndex;
          const isCurrent = !completed && index === activeIndex;
          return (
            <li
              className={isDone ? "done" : isCurrent ? "current" : undefined}
              aria-current={isCurrent ? "step" : undefined}
              key={step}
            >
              <span className="desktop-cloud-publish-progress-marker" aria-hidden="true">
                {index + 1}
              </span>
              <span className="desktop-cloud-publish-progress-task">
                <strong>{t(`cloud.initialize.progress.step.${step}`)}</strong>
                {isCurrent && (
                  <small role="status" aria-live="polite" aria-atomic="true">
                    <LoaderCircle size={12} strokeWidth={2} className="animate-spin" aria-hidden="true" />
                    <span>{step === ACCOUNT_STEP
                      ? t("cloud.initialize.progress.signing-in")
                      : getCloudPublishProgressLabel(stage, t)}</span>
                  </small>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {/* Nothing is being sent until the account step is behind us, so the
          constraint about staying open would not be true yet. */}
      {(!account || account === "done") && <p>{t("cloud.initialize.progress.keepOpen")}</p>}
    </div>
  );
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

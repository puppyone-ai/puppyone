import { createPublishError } from "./cloud-publish-contract.mjs";

// The first Cloud push can quarantine a pack, publish immutable objects to
// external storage, and commit Version Engine state before receive-pack can
// answer. It therefore needs a separate budget from interactive Git traffic.
export const CLOUD_INITIAL_PUSH_TIMEOUT_MS = 30 * 60_000;
export const CLOUD_PUSH_RECONCILE_DELAYS_MS = Object.freeze([
  2_000,
  5_000,
  10_000,
  20_000,
  30_000,
]);

export async function reconcileExpectedRemoteHead({
  expectedHeadCommitId,
  readRemoteHead,
  wait,
}) {
  for (const delayMs of CLOUD_PUSH_RECONCILE_DELAYS_MS) {
    await wait(delayMs);
    const remoteHead = await readRemoteHead().catch(() => null);
    if (remoteHead === expectedHeadCommitId) return remoteHead;
    if (remoteHead) {
      throw createPublishError(
        "PUSH_FAILED",
        "The Cloud Project main branch changed while confirming an interrupted initial push.",
        false,
      );
    }
  }
  return null;
}

export function isUncertainPushFailure(error) {
  if (error?.killed || error?.code === "ETIMEDOUT") return true;
  if (["ECONNABORTED", "ECONNRESET", "EPIPE"].includes(error?.code)) return true;
  const diagnostic = [error?.stderr, error?.stdout, error?.message]
    .filter((value) => typeof value === "string" || Buffer.isBuffer(value))
    .map(String)
    .join(" ");
  return /timed? out|timeout|connection reset|unexpected disconnect|remote end hung up|empty reply|operation was cancelled/i
    .test(diagnostic);
}

export function reportCloudPublishProgress(listener, stage) {
  try {
    listener?.(stage);
  } catch {
    // Progress reporting cannot participate in the Git transaction.
  }
}

export function waitForCloudPublishReconciliation(delayMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    timer.unref?.();
  });
}

export function remoteConfigFailureMessage(stage, error) {
  return withSafeGitDiagnostic(
    `Unable to configure the canonical Puppyone Cloud Git remote while ${stage}.`,
    error,
  );
}

export function pushFailureMessage(error) {
  return withSafeGitDiagnostic(
    "Unable to push the initial commit to Puppyone Cloud.",
    error,
  );
}

function withSafeGitDiagnostic(message, error) {
  const diagnostic = safeGitDiagnostic(error);
  return [message, diagnostic].filter(Boolean).join(" ");
}

/** Preserve useful Git context without returning credential material to UI. */
function safeGitDiagnostic(error) {
  const source = [error?.stderr, error?.stdout, error?.message].find((value) => (
    (typeof value === "string" || Buffer.isBuffer(value)) && String(value).trim()
  ));
  if (source === undefined) return "";
  return String(source)
    .replace(/pwg_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/\b(authorization:\s*(?:basic|bearer))\s+\S+/gi, "$1 [redacted]")
    .replace(/\b(password|token|access_token)=\S+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

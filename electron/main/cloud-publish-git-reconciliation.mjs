// The first Cloud push can quarantine a pack, publish immutable objects to
// external storage, and commit Version Engine state before receive-pack can
// answer. It therefore needs a separate budget from interactive Git traffic.
export const CLOUD_INITIAL_PUSH_TIMEOUT_MS = 30 * 60_000;
// Checking a failed push must not start another minute-long network wait.
export const CLOUD_PUSH_STATUS_TIMEOUT_MS = 10_000;

// Processing budgets the server reports when a push is too large to accept.
// Retrying the same content cannot succeed, so these are size refusals, not
// transient failures. The native Version Engine wording comes first; the
// `incoming ... budget` forms are what servers before it reported.
const PROCESSING_LIMIT_DIAGNOSTICS = [
  /Git (?:single-object|graph|object count|temporary disk|output) budget exceeded/i,
  /published object count budget exceeded/i,
  /completed Git pack exceeds the storage processing budget/i,
  /incoming (?:pack (?:expansion|byte)|expanded pack) budget exceeded/i,
];

export function isPushLimitFailure(error) {
  const diagnostic = [error?.stderr, error?.stdout, error?.message]
    .filter((value) => typeof value === "string" || Buffer.isBuffer(value))
    .map(String).join(" ");
  return isPushPackLimitFailure(error)
    || PROCESSING_LIMIT_DIAGNOSTICS.some((pattern) => pattern.test(diagnostic));
}

export function isPushPackLimitFailure(error) {
  const diagnostic = [error?.stderr, error?.stdout, error?.message]
    .filter((value) => typeof value === "string" || Buffer.isBuffer(value))
    .map(String).join(" ");
  return /Git pack exceeds the \d+-byte limit|pack exceeds maximum allowed size|HTTP (?:code )?413\b|returned error: 413\b|Git request body (?:is|exceeds)/i.test(diagnostic);
}

export function pushLimitFailureMessage(error) {
  return withSafeGitDiagnostic(
    isPushPackLimitFailure(error)
      ? "This upload exceeds the allowed size. A single Cloud push can be at most 2 GiB. Reduce the upload size before trying again."
      : "This upload exceeds a Cloud processing limit. Reduce its size before trying again.",
    error,
  );
}

export function isUncertainPushFailure(error) {
  if (error?.killed || error?.code === "ETIMEDOUT") return true;
  if (["ECONNABORTED", "ECONNRESET", "EPIPE"].includes(error?.code)) return true;
  const diagnostic = [error?.stderr, error?.stdout, error?.message]
    .filter((value) => typeof value === "string" || Buffer.isBuffer(value))
    .map(String)
    .join(" ");
  return /timed? out|timeout|connection reset|unexpected disconnect|remote end hung up|empty reply|operation was cancelled|HTTP (?:code )?5\d\d|error: 5\d\d/i
    .test(diagnostic);
}

/** `transfer` is how far the send has got, present only while uploading. */
export function reportCloudPublishProgress(listener, stage, transfer = undefined) {
  try {
    if (transfer === undefined) listener?.(stage);
    else listener?.(stage, transfer);
  } catch {
    // Progress reporting cannot participate in the Git transaction.
  }
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

import { cloudMessage, type CloudMessageDescriptor } from "./cloudPresentation";

export type CloudOpeningFailure = Readonly<{
  message: CloudMessageDescriptor;
  action: "retry" | "account" | "none";
  /**
   * The workspace moved while it was opening (replaced, paused, fenced, or the
   * authorization revision changed). Opening it again is the remedy, so the
   * window does that once by itself before saying anything.
   */
  reopen?: boolean;
}>;
type FailureInput = { status?: unknown; code?: unknown; retryable?: unknown; requestId?: unknown };
type FailureSpec = readonly [CloudMessageDescriptor["code"], CloudOpeningFailure["action"], boolean?];

/** Carries the failed opening stage through the shared project navigation queue. */
export class CloudOpeningError extends Error {
  constructor(readonly failure: CloudOpeningFailure) {
    super(failure.message.code);
    this.name = "CloudOpeningError";
  }
}

const connectionReasons = new Map<string, CloudMessageDescriptor["code"]>([
  ["CLOUD_TRANSPORT_UNAVAILABLE", "connection-unreachable"],
  ["CLOUD_REQUEST_TIMEOUT", "connection-timeout"],
  ["project_authorization_unreachable", "access-check-unreachable"],
  ["project_authorization_timeout", "access-check-timeout"],
  ["project_authorization_unavailable", "access-check-unavailable"],
  ["database_schema_outdated", "service-updating"],
  ["workbench_connection_unavailable", "workspace-connection-unavailable"],
]);
const statusReasons = new Map<number, CloudMessageDescriptor["code"]>([
  [408, "connection-timeout"], [504, "connection-timeout"],
  [426, "app-update-required"], [429, "service-busy"],
]);
const openingReasons = new Map<string, FailureSpec>([
  ["workbench_plan_required", ["workspace-plan-required", "account"]],
  ["repository_target_mismatch", ["project-response-mismatch", "none"]],
  ["workbench_provider_not_configured", ["workspace-not-configured", "none"]],
  ["workbench_provider_authentication", ["workspace-not-configured", "none"]],
  ["workbench_protocol_mismatch", ["workspace-service-unavailable", "none"]],
  ["workbench_access_denied", ["workspace-access-denied", "none"]],
  ["workbench_requires_recovery", ["workspace-recovery-required", "none"]],
  ["workbench_preparing", ["workspace-preparing", "retry"]],
  ["workbench_start_timeout", ["workspace-start-timeout", "retry"]],
  ["workbench_connection_timeout", ["workspace-start-timeout", "retry"]],
  ["workbench_disk_lost", ["workspace-disk-lost", "retry"]],
  ["workbench_unavailable", ["project-unavailable", "none"]],
  ["workbench_generation_changed", ["workspace-changed", "retry", true]],
  ["workbench_not_running", ["workspace-changed", "retry", true]],
  ["workbench_not_ready", ["workspace-changed", "retry", true]],
  ["workbench_operation_replaced", ["workspace-changed", "retry", true]],
  ["workbench_context_changed", ["workspace-changed", "retry", true]],
]);
const failure = ([code, action, reopen]: FailureSpec): CloudOpeningFailure => (
  { message: cloudMessage(code), action, ...(reopen ? { reopen } : {}) });
function input(cause: unknown): FailureInput {
  return cause && typeof cause === "object" ? cause as FailureInput : {};
}
function responseStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599 ? value : undefined;
}

/** Copy describes the observed boundary, never guesses a network root cause. */
export function describeCloudConnectionFailure(cause: unknown): CloudMessageDescriptor | null {
  const error = input(cause);
  const status = responseStatus(error.status);
  const code = typeof error.code === "string" && connectionReasons.has(error.code) ? error.code : undefined;
  // A server's explicit access decision always wins over a dependency hint.
  if ([401, 403, 404].includes(status ?? 0)) return null;
  const message = connectionReasons.get(code ?? "") ?? statusReasons.get(status ?? 0)
    ?? (status && status >= 500 ? "service-unavailable" : undefined);
  return message ? { ...cloudMessage(message), diagnostic: { status, code } } : null;
}

export function cloudFailureTitle(message: CloudMessageDescriptor): string | undefined {
  if (message.code === "connection-unreachable") return "cloud.recovery.connectionTitle";
  if (message.code === "connection-timeout") return "cloud.recovery.timeoutTitle";
  if (message.code.startsWith("access-check-")) return "cloud.recovery.accessCheckTitle";
  if (message.code === "service-updating") return "cloud.recovery.updatingTitle";
  if (message.code === "app-update-required") return "cloud.recovery.updateAppTitle";
  return undefined;
}

function accessFailure(status: unknown, stage: "project" | "workspace"): CloudOpeningFailure | null {
  if (status === 401) return failure(["project-sign-in-required", "account"]);
  if (status === 403) return failure([stage === "workspace" ? "workspace-access-denied" : "project-access-denied", "none"]);
  if (status === 402) return failure(["workspace-plan-required", "account"]);
  return null;
}

/**
 * What a report of this failure needs to be found in the server's log. Shown
 * beside the message, never instead of it.
 */
function openingDiagnostic(error: FailureInput): CloudMessageDescriptor["diagnostic"] | undefined {
  const status = responseStatus(error.status);
  // Only codes this app knows, or the server's own workspace namespace (the
  // same pattern the server enforces); an arbitrary server string stays out.
  const code = typeof error.code === "string" && (connectionReasons.has(error.code) || openingReasons.has(error.code)
    || /^workbench_[a-z_]{1,80}$/.test(error.code)) ? error.code : undefined;
  const requestId = typeof error.requestId === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(error.requestId)
    ? error.requestId : undefined;
  return status || code || requestId ? { status, code, requestId } : undefined;
}

/** Project authorization and runtime availability are independent facts. */
export function describeCloudOpeningFailure(cause: unknown, stage: "project" | "workspace" = "project"): CloudOpeningFailure {
  if (cause instanceof CloudOpeningError) return cause.failure;
  const described = classifyCloudOpeningFailure(cause, stage);
  const diagnostic = openingDiagnostic(input(cause));
  return diagnostic ? { ...described, message: { ...described.message, diagnostic } } : described;
}

function classifyCloudOpeningFailure(cause: unknown, stage: "project" | "workspace"): CloudOpeningFailure {
  const error = input(cause);
  const access = accessFailure(error.status, stage);
  if (access) return access;
  const specified = openingReasons.get(String(error.code));
  if (specified) return failure(specified);
  if (stage === "workspace" && [404, 405, 501].includes(Number(error.status))) return failure(["workspace-service-unavailable", "none"]);
  if (error.status === 404) return failure(["project-unavailable", "none"]);
  const connection = describeCloudConnectionFailure(error);
  if (connection && (stage === "project" || connection.code !== "service-unavailable")) {
    return { message: connection, action: error.status === 426 || error.retryable === false ? "none" : "retry" };
  }
  return failure([stage === "workspace" ? "workspace-open-failed" : "project-open-failed", error.retryable === false ? "none" : "retry"]);
}

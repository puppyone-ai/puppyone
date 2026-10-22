import { cloudMessage, type CloudMessageDescriptor } from "./cloudPresentation";

export type CloudOpeningFailure = Readonly<{
  message: CloudMessageDescriptor;
  action: "retry" | "account" | "none";
}>;

/** Carries the failed opening stage through the shared project navigation queue. */
export class CloudOpeningError extends Error {
  constructor(readonly failure: CloudOpeningFailure) {
    super(failure.message.code);
    this.name = "CloudOpeningError";
  }
}

/** Project authorization and runtime availability are independent facts. */
export function describeCloudOpeningFailure(cause: unknown, stage: "project" | "workspace" = "project"): CloudOpeningFailure {
  if (cause instanceof CloudOpeningError) return cause.failure;
  const error = cause && typeof cause === "object" ? cause as { status?: unknown; code?: unknown; retryable?: unknown } : {};
  const status = typeof error.status === "number" ? error.status : null;
  const failure = (code: CloudMessageDescriptor["code"], action: CloudOpeningFailure["action"]): CloudOpeningFailure => ({ message: cloudMessage(code), action });
  if (status === 401) return failure("project-sign-in-required", "account");
  if (status === 403) return failure(stage === "workspace" ? "workspace-access-denied" : "project-access-denied", "none");
  if (status === 402) return failure("workspace-plan-required", "account");
  if (error.code === "workbench_plan_required") return failure("workspace-plan-required", "account");
  if (error.code === "repository_target_mismatch") return failure("project-response-mismatch", "none");
  if (["workbench_provider_not_configured", "workbench_provider_authentication"].includes(String(error.code))) return failure("workspace-not-configured", "none");
  if (error.code === "workbench_protocol_mismatch") return failure("workspace-service-unavailable", "none");
  if (error.code === "workbench_access_denied") return failure("workspace-access-denied", "none");
  if (error.code === "workbench_requires_recovery") return failure("workspace-recovery-required", "none");
  if (error.code === "workbench_preparing") return failure("workspace-preparing", "retry");
  if (stage === "workspace" && (status === 404 || status === 405 || status === 501)) {
    return failure("workspace-service-unavailable", "none");
  }
  if (status === 404) return failure("project-unavailable", "none");
  return failure(stage === "workspace" ? "workspace-open-failed" : "project-open-failed", error.retryable === false ? "none" : "retry");
}

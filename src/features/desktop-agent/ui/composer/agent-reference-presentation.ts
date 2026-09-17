import type { MessageFormatter } from "@puppyone/localization/core";
import type { AgentDraftReference } from "../../domain/agent-contract";

const LOCALIZED_REFERENCE_ERROR_CODES = new Set([
  "capability-unreported",
  "reference-size",
  "workspace-directory-unsupported",
  "workspace-file-unsupported",
  "image-unsupported",
  "file-unsupported",
  "mime-unsupported",
  "reference-limit",
  "reference-total-size",
  "workspace-resolution-failed",
]);

export function localizedReferenceError(reference: AgentDraftReference, t: MessageFormatter) {
  const code = reference.error?.code;
  if (code && LOCALIZED_REFERENCE_ERROR_CODES.has(code)) return t(`agent.reference.error.${code}`);
  return reference.error?.message || t("agent.reference.failed");
}

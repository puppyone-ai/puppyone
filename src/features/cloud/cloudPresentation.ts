import { bidiIsolate, type MessageFormatter } from "@puppyone/localization/core";
import type {
  CloudBranchGraphDiagnostics,
  CloudBranchGraphLabel,
  CloudBranchGraphRow,
} from "./graph/model";
import type { CloudPublishErrorCode } from "../../types/electron";

export type CloudMessageCode =
  | "project-linked"
  | "clone-command-copied"
  | "cloud-remote-removed"
  | "workspace-unavailable"
  | "connect-failed"
  | "copy-clone-failed"
  | "remove-remote-failed"
  | "save-scope-failed"
  | "rotate-key-failed"
  | "delete-access-failed"
  | "create-mcp-failed"
  | "update-config-failed"
  | "cli-unavailable"
  | "mcp-unavailable"
  | "organization-partial"
  | "organization-load-failed"
  | "create-access-failed"
  | "cloud-data-load-failed"
  | "project-details-partial"
  | "access-load-failed"
  | "access-partial"
  | "history-load-failed"
  | "history-load-more-failed"
  | "history-degraded-count"
  | "history-degraded"
  | "git-topology-load-failed"
  | "auth-start-failed"
  | "remote-sign-in"
  | "remote-wrong-host"
  | "remote-response-mismatch"
  | "remote-not-authorized"
  | "remote-unresolvable"
  | "remote-network-failed"
  | "remote-locator-conflict"
  | "remote-not-found"
  | "project-publish-failed"
  | "project-publish-commit-required"
  | "project-publish-branch-required"
  | "project-list-load-failed"
  | "project-open-failed";

export type CloudMessageDescriptor = Readonly<{
  code: CloudMessageCode;
  values?: Readonly<Record<string, string | number>>;
  /** Sanitized server/provider detail. It is preserved, not presented as translated product copy. */
  detail?: string;
}>;

export function cloudMessage(
  code: CloudMessageCode,
  values?: CloudMessageDescriptor["values"],
  detail?: string,
): CloudMessageDescriptor {
  return { code, values, detail };
}

export function formatCloudMessage(message: CloudMessageDescriptor, t: MessageFormatter) {
  const values = message.values
    ? Object.fromEntries(Object.entries(message.values).map(([key, value]) => [
        key,
        typeof value === "string" ? bidiIsolate(value) : value,
      ]))
    : undefined;
  const productMessage = t(`cloud.message.${message.code}`, values);
  return message.detail ? `${productMessage} ${bidiIsolate(message.detail)}` : productMessage;
}

export function formatCloudPublishFailure(
  error: { code: CloudPublishErrorCode; retryable: boolean },
  t: MessageFormatter,
): string {
  if (error.code === "SESSION_REQUIRED") return t("cloud.initialize.signInNote");
  if (error.code === "ORGANIZATION_REQUIRED") return t("cloud.initialize.organizationRequired");
  if (error.code === "REPOSITORY_REQUIRED" || error.code === "COMMIT_REQUIRED") {
    return t("cloud.message.project-publish-commit-required");
  }
  if (error.code === "BRANCH_REQUIRED") return t("cloud.message.project-publish-branch-required");
  if (error.code === "SOURCE_MISSING") return t("cloud.initialize.sourceMissing");
  if (error.code === "IDENTITY_MISMATCH") return t("cloud.initialize.repositoryIdentityMismatch");
  if (error.code === "REMOTE_CONFLICT") return t("cloud.initialize.remoteConflict");
  if (error.code === "REMOTE_REF_CONFLICT") return t("cloud.initialize.pushConflictDescription");
  if (error.code === "PUSH_UNCERTAIN") return t("cloud.initialize.pushUncertainDescription");
  if (error.code === "CLEANUP_FAILED") {
    return t("cloud.initialize.cleanupFailed");
  }
  if (error.code === "PROJECT_UNAVAILABLE") return t("cloud.initialize.projectUnavailable");
  if (error.code === "PERMISSION_DENIED") return t("cloud.initialize.permissionDenied");
  if (error.code === "SERVICE_UPGRADE_REQUIRED") {
    return t("cloud.message.project-publish-service-upgrade");
  }
  if (error.code === "PROJECT_CREATE_FAILED") return t("cloud.message.project-publish-create-failed");
  if (error.code === "CREDENTIAL_FAILED") return t("cloud.message.project-publish-credential-failed");
  if (error.code === "REMOTE_CONFIG_FAILED") return t("cloud.message.project-publish-remote-failed");
  if (error.code === "PUSH_FAILED") return t("cloud.message.project-publish-push-failed");
  if (error.code === "COMPENSATION_FAILED") {
    return t("cloud.message.project-publish-compensation-failed");
  }
  if (error.code === "JOURNAL_CORRUPT" || error.code === "JOURNAL_IO_FAILED") {
    return t("cloud.initialize.localRecoveryFailed");
  }
  return t("cloud.message.project-publish-failed");
}

export function formatCloudGraphRowMessage(row: CloudBranchGraphRow, t: MessageFormatter) {
  return row.message || (row.messageCode ? t(`cloud.graph.message.${row.messageCode}`) : t("cloud.history.updateWorkspace"));
}

export function formatCloudGraphAuthor(row: CloudBranchGraphRow, t: MessageFormatter) {
  return row.authorName || (row.authorCode ? t(`cloud.graph.author.${row.authorCode}`) : t("cloud.status.unknown"));
}

export function formatCloudGraphLabel(label: CloudBranchGraphLabel, t: MessageFormatter) {
  return label.name || (label.nameCode ? t(`cloud.graph.label.${label.nameCode}`) : "");
}

export function formatCloudGraphWarning(
  diagnostics: CloudBranchGraphDiagnostics,
  t: MessageFormatter,
) {
  return diagnostics.warningCode
    ? t(`cloud.graph.warning.${diagnostics.warningCode}`)
    : diagnostics.warning;
}

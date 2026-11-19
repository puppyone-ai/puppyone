import type { MessageFormatter } from "@puppyone/localization/core";
import type { CloudPublishState } from "../../../types/electron";

export type CloudPushAction = "retry-push" | "push-latest" | "choose-source" | "reconcile";

export function getCloudInitializationDescription(
  state: CloudPublishState,
  t: MessageFormatter,
): string {
  if (["requested", "deleting", "failed"].includes(state.cleanup)) {
    return t("cloud.initialize.cleanupPendingDescription", { project: state.projectName });
  }
  if (state.push === "uncertain") return t("cloud.initialize.pushUncertainDescription");
  if (state.push === "conflict") return t("cloud.initialize.pushConflictDescription");
  if (state.project === "unavailable") return t("cloud.initialize.projectUnavailable");
  if (state.local === "source-missing") {
    return t("cloud.initialize.sourceMissingDescription", { branch: state.selectedSourceBranch });
  }
  if (state.local === "source-advanced") {
    return t("cloud.initialize.sourceAdvancedDescription", { branch: state.selectedSourceBranch });
  }
  return t("cloud.initialize.emptyProjectDescription", { project: state.projectName });
}

export function getCloudPushAction(
  actions: CloudPublishState["availableActions"],
): CloudPushAction | null {
  if (actions.includes("reconcile")) return "reconcile";
  if (actions.includes("choose-source")) return "choose-source";
  if (actions.includes("push-latest")) return "push-latest";
  if (actions.includes("retry-push")) return "retry-push";
  return null;
}

import type { MessageFormatter } from "@puppyone/localization/core";
import type { GitSidebarPrimaryAction, GitSyncState, SourceControlSidebarModel } from "../types";

/**
 * The Source Control view keeps every Git primitive — commit, branches,
 * conflict resolution — but under the Project Reach experience its default copy
 * states the consequence instead of the direction of a repository.
 *
 * The wording is applied by rewriting the view model at the sidebar's entry
 * point, so the established copy stays byte-identical when the experience is
 * off and neither path can drift into describing the same facts differently.
 */
export function getReachSyncWording(state: GitSyncState, t: MessageFormatter): GitSyncState {
  return {
    ...state,
    pullLabel: t("source-control.reach.incoming.apply"),
    pullTitle: describeIncoming(state.behind, t),
    pullDetail: describeIncoming(state.behind, t),
    pushLabel: t("source-control.reach.outgoing.action"),
    pushTitle: state.behind > 0
      ? t("source-control.reach.outgoing.actionBlocked")
      : t("source-control.reach.outgoing.actionTitle"),
    pushDetail: state.ahead > 0
      ? t("source-control.reach.outgoing.waiting", { count: state.ahead })
      : t("source-control.reach.outgoing.settled"),
  };
}

export function getReachSidebarModelWording(
  model: SourceControlSidebarModel,
  t: MessageFormatter,
): SourceControlSidebarModel {
  if (!model.committedPrimaryAction) return model;
  return { ...model, committedPrimaryAction: rewriteSendAction(model.committedPrimaryAction, t) };
}

/**
 * Sending saved work keeps its primitive, including the publish variant, and
 * loses the system-view verb: what the user gets is other people seeing the
 * version already saved here.
 */
function rewriteSendAction(
  action: GitSidebarPrimaryAction,
  t: MessageFormatter,
): GitSidebarPrimaryAction {
  if (action.kind !== "push" && action.kind !== "publish") return action;
  return {
    ...action,
    label: t("source-control.reach.outgoing.action"),
    title: action.disabled
      ? t("source-control.reach.outgoing.actionBlocked")
      : t("source-control.reach.outgoing.actionTitle"),
    loadingLabel: t("source-control.reach.outgoing.sending"),
  };
}

/**
 * Deliberately without a number: the count that matters is the one the receipt
 * shows, and the repository's commit distance is not the same quantity.
 */
function describeIncoming(behind: number, t: MessageFormatter): string {
  return t(behind > 0 ? "source-control.reach.incoming.waiting" : "source-control.reach.incoming.none");
}

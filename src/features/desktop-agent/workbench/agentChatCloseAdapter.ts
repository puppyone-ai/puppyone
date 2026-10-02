import type { MessageFormatter } from "@puppyone/localization/core";
import type { AuxiliaryWorkbenchCloseAdapter } from "../../app-shell/auxiliary-workbench/types";

/** Lightweight contribution metadata; the commit port may load the Chat implementation lazily. */
export function createAgentChatCloseAdapter(
  t: MessageFormatter,
  commit: AuxiliaryWorkbenchCloseAdapter["commit"],
): AuxiliaryWorkbenchCloseAdapter {
  return Object.freeze<AuxiliaryWorkbenchCloseAdapter>({
    executionKind: "agent",
    decide: ({ snapshot }) => snapshot.running
      ? Object.freeze({
          kind: "confirm" as const,
          tone: "danger" as const,
          dialog: Object.freeze({
            title: t("agent.closeDialog.activeTitle", { title: snapshot.title }),
            detail: t("agent.closeDialog.activeDetail"),
            actionLabel: t("common.action.close"),
          }),
        })
      : Object.freeze({ kind: "close" as const }),
    commit,
  });
}

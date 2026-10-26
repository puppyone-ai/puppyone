import { useLocalization } from "@puppyone/localization/react";
import type { AgentActivity } from "../../domain/agent-projection-types";

/** Only context compaction belongs in the transcript; live status uses the dock. */
export function AgentSystemActivity({ activity }: { activity: AgentActivity<"system"> }) {
  const { t } = useLocalization();
  if (activity.detail.category !== "compaction") return null;
  let status = "unknown";
  if (activity.status === "failed") status = "failed";
  if (["cancelled", "interrupted"].includes(activity.status)) status = "stopped";
  let label = `${t("agent.header.compactContext")}: ${t(`agent.status.${status}`)}`;
  if (activity.status === "completed" || activity.status === "succeeded") label = t("agent.activity.contextCompacted");
  if (["running", "queued", "pending", "in-progress"].includes(activity.status)) label = t("agent.activity.compactingContext");
  return <div className="desktop-agent-context-divider" role="status">
    <span aria-hidden="true" /><small>{label}</small><span aria-hidden="true" />
  </div>;
}

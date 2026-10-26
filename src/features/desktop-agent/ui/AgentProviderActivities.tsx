import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import type { AgentActivity } from "../domain/agent-projection-types";

/** Quiet, bounded live notices. No timers, toasts, transcript rows or tool glyphs. */
export function AgentProviderActivities({ activities }: { activities: readonly AgentActivity[] }) {
  const { t, formatNumber } = useLocalization();
  const notices = activities.filter(activity => activity.label && (
    activity.kind === "notification"
    || (activity.kind === "system" && activity.detail.category !== "compaction"
      && !(activity.detail.category === "authentication" && ["completed", "succeeded"].includes(activity.status)))
  ));
  if (!notices.length) return null;
  const prominent = notices.filter(activity => ["running", "failed", "warning"].includes(activity.status));
  const quiet = notices.filter(activity => !prominent.includes(activity));
  return <div className="desktop-agent-provider-activities">
    {prominent.map(activity => <p key={activity.id} className={`is-${activity.status}`}
      role={activity.status === "failed" ? "alert" : "status"} dir="auto">{activity.label}</p>)}
    {quiet.length > 0 && <details>
      <summary>{t("agent.activity.notifications")} <span>{formatNumber(quiet.length)}</span></summary>
      <div className="desktop-agent-provider-notices">
        {quiet.map(activity => <Tooltip key={activity.id} content={typeof activity.detail.source === "string" ? activity.detail.source : undefined}>
          <p dir="auto">{activity.label}</p>
        </Tooltip>)}
      </div>
    </details>}
  </div>;
}

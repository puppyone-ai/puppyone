import { Brain } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import { commandMetadata, formatAgentDuration, outputForActivity } from "../../domain/agent-activity-presentation";
import type { AgentActivity } from "../../domain/agent-projection-types";
import { AgentActivityShell } from "./AgentActivityShell";
import { AgentToolTextEvidence } from "./AgentToolTextEvidence";

export function AgentReasoningActivity({ activity }: { activity: AgentActivity }) {
  const { t, formatNumber } = useLocalization();
  const reasoning = typeof activity.detail.delta === "string" ? activity.detail.delta : outputForActivity(activity);
  const durationMs = commandMetadata(activity).durationMs;
  const duration = durationMs === null ? null : formatAgentDuration(durationMs, t, formatNumber);
  const running = ["running", "pending", "in-progress"].includes(activity.status);
  // The live tail is the single authority for in-progress feedback. A durable
  // reasoning row appears only when a Harness has supplied a public summary
  // and that summary has settled; empty native reasoning boundaries stay out
  // of the transcript entirely.
  if (running || !reasoning.trim()) return null;
  return (
    <AgentActivityShell
      title={duration ? t("agent.activity.thoughtFor", { duration }) : t("agent.activity.thoughtBriefly")}
      status={activity.status}
      icon={<Brain size={13} />}
      className="desktop-agent-reasoning"
    >
      {reasoning && (
        <AgentToolTextEvidence text={reasoning} className="desktop-agent-reasoning-copy" />
      )}
    </AgentActivityShell>
  );
}

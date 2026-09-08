import { ListTodo } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import type { AgentActivity } from "../../domain/agent-projection-types";
import { AgentPlanItem } from "../AgentPlanItem";
import { AgentActivityShell } from "./AgentActivityShell";
import { AgentToolTextEvidence } from "./AgentToolTextEvidence";

export function AgentPlanActivity({ activity }: { activity: AgentActivity }) {
  const { t } = useLocalization();
  const steps = Array.isArray(activity.detail.steps) ? activity.detail.steps.slice(0, 100).map((step) => {
    const value = step && typeof step === "object" ? step as Record<string, unknown> : {};
    return { step: String(value.step ?? "").slice(0, 2_000), status: String(value.status ?? "pending") };
  }).filter((step) => step.step) : [];
  const planText = (typeof activity.detail.text === "string"
    ? activity.detail.text
    : typeof activity.detail.explanation === "string" ? activity.detail.explanation : "").slice(0, 64 * 1024);
  return (
    <AgentActivityShell
      title={t("agent.tool.plan")}
      status={activity.status}
      icon={<ListTodo size={13} />}
      className="desktop-agent-plan"
      defaultExpanded={activity.status === "running"}
    >
      {planText && <AgentToolTextEvidence text={planText} className="desktop-agent-plan-text" />}
      {steps.length > 0 && <AgentPlanItem steps={steps} />}
    </AgentActivityShell>
  );
}

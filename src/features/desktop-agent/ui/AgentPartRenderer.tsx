import { useLocalization } from "@puppyone/localization/react";
import { AgentActivityRenderBoundary } from "./AgentActivityRenderBoundary";
import { AgentMessagePart } from "./AgentMessagePart";
import {
  type AgentPartRendererProps,
  registerAgentPartRenderer,
  resolveAgentPartRenderer,
} from "./AgentPartRendererRegistry";
import { AgentToolRenderer } from "./AgentToolRendererRegistry";
import { AgentTurnSummary } from "./AgentTurnSummary";
import {
  AgentNoticeActivity,
  AgentPlanActivity,
  AgentReasoningActivity,
} from "./activity";

export function AgentPartRenderer(props: AgentPartRendererProps) {
  const Renderer = resolveAgentPartRenderer(props.part.kind);
  if (!Renderer) return <UnregisteredPart {...props} />;
  return <Renderer {...props} />;
}

function MessagePart({ part, runtimeLabel }: AgentPartRendererProps<"user" | "assistant">) {
  return <AgentMessagePart part={part} runtimeLabel={runtimeLabel} />;
}

function ReasoningPart({ part }: AgentPartRendererProps<"reasoning">) {
  return (
    <AgentActivityRenderBoundary activityId={part.id} resetKey={`${part.id}:${part.updatedSequence ?? part.sequence}`}>
      <AgentReasoningActivity activity={part} />
    </AgentActivityRenderBoundary>
  );
}

function PlanPart({ part }: AgentPartRendererProps<"plan">) {
  return (
    <AgentActivityRenderBoundary activityId={part.id} resetKey={`${part.id}:${part.updatedSequence ?? part.sequence}`}>
      <AgentPlanActivity activity={part} />
    </AgentActivityRenderBoundary>
  );
}

function NoticePart({ part }: AgentPartRendererProps<"warning" | "error">) {
  return (
    <AgentActivityRenderBoundary activityId={part.id} resetKey={`${part.id}:${part.updatedSequence ?? part.sequence}`}>
      <AgentNoticeActivity activity={part} />
    </AgentActivityRenderBoundary>
  );
}

function ToolPart({ part, onOpenFile }: AgentPartRendererProps<"tool" | "command" | "file-change">) {
  return (
    <AgentActivityRenderBoundary activityId={part.id} resetKey={`${part.id}:${part.updatedSequence ?? part.sequence}`}>
      <AgentToolRenderer part={part} onOpenFile={onOpenFile} />
    </AgentActivityRenderBoundary>
  );
}

// These kinds remain available to session controls and metadata consumers.
// Even standalone rendering must not reintroduce duplicate transcript labels.
function StatusPart() { return null; }

function TurnSummaryPart({ part }: AgentPartRendererProps<"turn-summary">) {
  return <AgentTurnSummary durationMs={part.durationMs} status={part.status} />;
}

function UnknownPart({ part }: AgentPartRendererProps<"unknown">) {
  return <UnregisteredPart part={part} runtimeLabel="" />;
}

function UnregisteredPart({ part }: AgentPartRendererProps) {
  const { t } = useLocalization();
  const label = "eventType" in part
    ? part.label || t(`agent.part.${part.labelCode ?? "unsupported-event"}`)
    : t("agent.part.update");
  return <div className="desktop-agent-inline-part is-muted" dir="auto">{label}</div>;
}

registerAgentPartRenderer("user", (props) => <MessagePart {...props} />);
registerAgentPartRenderer("assistant", (props) => <MessagePart {...props} />);
registerAgentPartRenderer("turn-summary", TurnSummaryPart);
registerAgentPartRenderer("reasoning", ReasoningPart);
registerAgentPartRenderer("plan", PlanPart);
registerAgentPartRenderer("tool", (props) => <ToolPart {...props} />);
registerAgentPartRenderer("command", (props) => <ToolPart {...props} />);
registerAgentPartRenderer("file-change", (props) => <ToolPart {...props} />);
registerAgentPartRenderer("warning", (props) => <NoticePart {...props} />);
registerAgentPartRenderer("error", (props) => <NoticePart {...props} />);
registerAgentPartRenderer("usage", StatusPart);
registerAgentPartRenderer("permission", StatusPart);
registerAgentPartRenderer("question", StatusPart);
registerAgentPartRenderer("unknown", UnknownPart);

export { registerAgentPartRenderer } from "./AgentPartRendererRegistry";

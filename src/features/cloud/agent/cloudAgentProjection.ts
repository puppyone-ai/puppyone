import type { AgentActivity, AgentApproval, AgentProjection, AgentTranscriptMessage } from "../../../../shared/agent-contract/display-types";
import type { AgentTurnTerminalState } from "../../../../shared/agent-contract/types";
import { cloudRunActive, type CloudAgentRun, type CloudAgentTool } from "./cloudAgentClient";

export function projectCloudAgentRuns(runs: CloudAgentRun[]): AgentProjection {
  const messages: AgentTranscriptMessage[] = [];
  const activities: AgentActivity[] = [];
  const approvals: AgentApproval[] = [];
  const current = runs[runs.length - 1];
  const active = cloudRunActive(current);
  for (const [index, run] of runs.entries()) {
    const sequence = index * 1000;
    const base = { turnId: run.id, itemId: null, updatedSequence: sequence + run.sequence };
    messages.push({ ...base, id: `${run.id}:user`, role: "user", submissionId: run.request_id,
      text: run.prompt, streaming: false, terminalState: null, sequence: sequence + 1 });
    for (const [toolIndex, tool] of (run.tools ?? []).entries()) {
      const output = (tool.result?.content ?? []).filter(part => part.type === "text").map(part => part.text ?? "").join("\n");
      const status = toolStatus(tool);
      const kind = toolKind(tool);
      activities.push({ ...base, id: `${run.id}:${tool.call_id}`, kind, label: tool.name, status,
        detail: { ...tool.input, tool: tool.name }, output, sequence: sequence + 2 + toolIndex });
      if (run.id === current?.id && cloudRunActive(run) && tool.state === "waiting") approvals.push({
        requestId: tool.call_id, turnId: run.id, itemId: tool.call_id, kind: tool.name === "bash" ? "command" : "file-change",
        title: tool.name, command: typeof tool.input.command === "string" ? tool.input.command : null,
        cwd: null, commandActions: [], networkApprovalContext: null,
        grantRoot: typeof tool.input.path === "string" ? tool.input.path : null, policyChangeRequested: false,
        reason: null, availableDecisions: ["accept", "decline"], sequence: sequence + 2 + toolIndex,
      });
    }
    addReply(messages, run, sequence);
  }
  return {
    schemaVersion: 1, sessionState: current ? "active" : "empty",
    lastSequence: runs.reduce((value, run) => value + run.sequence, 0),
    history: { coverage: runs.length === 100 ? "partial" : "complete", reason: runs.length === 100 ? "read-limit" : null },
    displayWindow: { truncated: runs.length === 100 }, missingRanges: [], messages, activities, approvals,
    questions: [], turns: [], parts: [], rows: [], connectionStatus: null,
    runningTurnId: active ? current.id : null, terminalState: current ? terminalState(current) : null, usage: null,
    presentation: { phase: runPhase(current), terminalState: presentationState(current),
      pendingPrompt: null, submitting: false, stopping: current?.stop_requested ?? false },
  };
}
function terminalState(run: CloudAgentRun): AgentTurnTerminalState | null {
  if (run.state === "succeeded") return "completed";
  if (run.state === "stopped") return "interrupted";
  if (run.state === "failed") return "failed";
  return null;
}
function runPhase(run: CloudAgentRun | undefined): AgentProjection["presentation"]["phase"] {
  if (run?.state === "waiting_approval") return "waiting";
  return cloudRunActive(run) ? "running" : "ready";
}
function presentationState(run: CloudAgentRun | undefined): AgentProjection["presentation"]["terminalState"] {
  if (!run) return "idle";
  if (run.state === "outcome_unknown") return "outcome-unknown";
  if (cloudRunActive(run)) return "running";
  return terminalState(run) ?? "idle";
}
function toolKind(tool: CloudAgentTool): AgentActivity["kind"] {
  if (tool.name === "bash") return "command";
  if (["write", "edit"].includes(tool.name)) return "file-change";
  return "tool";
}
function toolStatus(tool: CloudAgentTool): AgentActivity["status"] {
  if (tool.state === "completed") return "completed";
  if (tool.state === "rejected") return "cancelled";
  if (tool.state === "waiting") return "waiting-for-user";
  return "running";
}
function addReply(messages: AgentTranscriptMessage[], run: CloudAgentRun, sequence: number) {
  if (!run.snapshot.text) return;
  messages.push({ turnId: run.id, itemId: null, updatedSequence: sequence + run.sequence,
    id: `${run.id}:assistant`, role: "assistant", text: run.snapshot.text, streaming: cloudRunActive(run),
    terminalState: terminalState(run), sequence: sequence + 999 });
}

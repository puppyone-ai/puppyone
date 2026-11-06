import { isAgentToolActivity } from "../../../../../shared/agent-contract/activity-semantics.mjs";
import {
  agentActivityToolId,
  commandPresentationForActivity,
  pathForActivity,
} from "../../domain/agent-activity-presentation";
import type { AgentActivity, AgentActivityStatus, AgentPart } from "../../domain/agent-projection-types";

/**
 * What a tool call did, in user terms. Provider tool ids and conservative
 * read-only shell commands collapse into the same small vocabulary so every
 * Harness reads the same way in the transcript.
 */
export type AgentToolStepKind =
  | "command"
  | "edit"
  | "fetch"
  | "generic"
  | "list"
  | "read"
  | "search"
  | "write";

type AgentToolActivity = Extract<AgentPart, { kind: "tool" | "command" | "file-change" }>;

export type AgentToolStepSegment =
  | Readonly<{ type: "step"; id: string; part: AgentPart }>
  | Readonly<{ type: "working"; id: string; parts: readonly AgentToolActivity[] }>
  | Readonly<{ type: "explored"; id: string; parts: readonly AgentToolActivity[]; files: number; searches: number }>
  | Readonly<{ type: "settled"; id: string; parts: readonly AgentToolActivity[]; steps: number }>;

/** Settled exploration runs longer than three steps read as one "Explored" line. */
export const AGENT_TOOL_EXPLORATION_FOLD_MIN = 4;

/** Two settled steps already read better as one count than as two lines. */
export const AGENT_TOOL_SETTLED_FOLD_MIN = 2;

const ACTIVE_STATUSES = new Set<AgentActivityStatus>(["queued", "running", "pending", "in-progress", "waiting-for-user"]);
const FAILED_STATUSES = new Set<AgentActivityStatus>(["failed", "warning", "blocked", "waiting-for-user"]);

export function isActiveToolStatus(status: AgentActivityStatus) {
  return ACTIVE_STATUSES.has(status);
}

export function agentToolStepKind(activity: AgentActivity): AgentToolStepKind {
  const tool = agentActivityToolId(activity);
  if (activity.kind === "command" || tool === "bash") {
    const shellTool = commandPresentationForActivity(activity).tool;
    if (shellTool === "grep" || shellTool === "glob") return "search";
    if (shellTool === "read" || shellTool === "list") return shellTool;
    return "command";
  }
  if (activity.kind === "file-change") return tool === "write" ? "write" : "edit";
  if (tool === "grep" || tool === "glob" || tool === "search") return "search";
  if (tool === "read" || tool === "list" || tool === "edit" || tool === "write" || tool === "fetch") return tool;
  return "generic";
}

export function isExplorationStep(kind: AgentToolStepKind) {
  return kind === "search" || kind === "read" || kind === "list";
}

/**
 * Splits one tool group into visible lines. Every settled, successful step is
 * folded once it stops being current: a finished run reads as one "Explored"
 * or "N steps done" line. Older unfinished tools share a Working disclosure; only the latest active
 * step stays visible. Failures and user waits always keep their own line.
 * Folding is presentation only and never infers successful completion.
 */
export function agentToolStepSegments(parts: readonly AgentPart[]): AgentToolStepSegment[] {
  const segments: AgentToolStepSegment[] = [];
  const latestActive = parts.findLast(part => isAgentToolActivity(part) && ACTIVE_STATUSES.has(part.status));
  let run: AgentToolActivity[] = [];
  const flush = () => {
    if (run.length === 0) return;
    if (run.some(part => ACTIVE_STATUSES.has(part.status))) {
      segments.push({ type: "working", id: `working:${run[0].id}`, parts: run });
    } else if (run.length >= AGENT_TOOL_EXPLORATION_FOLD_MIN && run.every(isExploration)) {
      segments.push({ type: "explored", id: `explored:${run[0].id}`, parts: run, ...explorationCounts(run) });
    } else if (run.length >= AGENT_TOOL_SETTLED_FOLD_MIN) {
      segments.push({ type: "settled", id: `settled:${run[0].id}`, parts: run, steps: run.length });
    } else {
      for (const part of run) segments.push({ type: "step", id: part.id, part });
    }
    run = [];
  };
  for (const part of parts) {
    if (isAgentToolActivity(part) && part !== latestActive && !FAILED_STATUSES.has(part.status)) {
      run.push(part);
      continue;
    }
    flush();
    segments.push({ type: "step", id: part.id, part });
  }
  flush();
  return segments;
}

function isExploration(part: AgentToolActivity) {
  return isExplorationStep(agentToolStepKind(part));
}

function explorationCounts(parts: readonly AgentToolActivity[]) {
  const paths = new Set<string>();
  let unnamedReads = 0;
  let searches = 0;
  for (const part of parts) {
    if (agentToolStepKind(part) !== "read") {
      searches += 1;
      continue;
    }
    const path = part.kind === "command" ? "" : pathForActivity(part);
    if (path) paths.add(path);
    else unnamedReads += 1;
  }
  return { files: paths.size + unnamedReads, searches };
}

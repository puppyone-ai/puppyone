import type { AgentActivity, AgentProjection } from "../../../shared/agent-contract/display-types";
import type { AgentChangedFilesStore } from "./agentChangedFilesStore";
import { toWorkspaceRelativePath } from "./agentActivity";

type ChangeSource = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => {
    session: { id: string } | null;
    control: { execution: { activeTurnId: string | null }; sessionEpoch?: string; terminalTurns?: string[];
      commands?: Array<{ commandId: string; kind: string; targetTurnId: string | null }> } | null;
    pendingIntent?: { id: string } | null;
    projection: AgentProjection;
  };
};

/** Observe Main's confirmed live execution, never mark historical replay as new work. */
export function observeAgentChangedFiles(root: string, source: ChangeSource, store: AgentChangedFilesStore) {
  const liveTurns = new Map<string, { paths: Set<string>; removed: Set<string> }>();
  const finished = new Set<string>();
  const localSubmissions = new Set<string>();
  let identity = "";
  let terminalBaseline = new Set<string>();
  const watch = (turn: string) => {
    if (!finished.has(turn) && !liveTurns.has(turn)) liveTurns.set(turn, { paths: new Set(), removed: new Set() });
  };
  const observe = () => {
    const { session, control, projection, pendingIntent } = source.getSnapshot();
    if (pendingIntent) localSubmissions.add(pendingIntent.id);
    if (!session || !control) return;
    const nextIdentity = JSON.stringify([session.id, control.sessionEpoch ?? ""]);
    const firstSnapshot = identity !== nextIdentity;
    if (firstSnapshot) {
      identity = nextIdentity;
      liveTurns.clear(); finished.clear();
      terminalBaseline = new Set(control.terminalTurns ?? []);
    }
    const active = control?.execution.activeTurnId;
    if (active) watch(active);
    // Main may coalesce a complete short turn into one frame. New confirmed
    // terminal IDs and locally submitted commands cover that case without
    // treating an initial history snapshot as work performed now.
    for (const turn of control.terminalTurns ?? []) {
      if (!firstSnapshot && !terminalBaseline.has(turn)) watch(turn);
      terminalBaseline.add(turn);
    }
    for (const command of control.commands ?? []) {
      if (command.kind === "start" && command.targetTurnId && localSubmissions.delete(command.commandId)) watch(command.targetTurnId);
    }
    for (const turn of projection.turns) {
      const pending = liveTurns.get(turn.id);
      if (!pending) continue;
      for (const activity of [...projection.activities].sort((a, b) => a.sequence - b.sequence)) {
        if (activity.turnId !== turn.id) continue;
        for (const change of successfulChanges(activity)) {
          const path = toWorkspaceRelativePath(root, change.path);
          if (!path) continue;
          if (change.deleted) {
            pending.paths.delete(path);
            const deletion = `${activity.id}:${path}`;
            if (!pending.removed.has(deletion)) store.acknowledge(root, path);
            pending.removed.add(deletion);
          } else pending.paths.add(path);
        }
      }
      if (["completed", "failed", "interrupted"].includes(turn.status)) {
        liveTurns.delete(turn.id);
        finished.add(turn.id);
        store.mark(root, [...pending.paths]);
      }
    }
  };
  const unsubscribe = source.subscribe(observe);
  observe();
  return () => { unsubscribe(); liveTurns.clear(); };
}

function successfulChanges(activity: AgentActivity): { path: string; deleted: boolean }[] {
  if (!["completed", "succeeded"].includes(activity.status)) return [];
  if (Array.isArray(activity.detail.changes) && activity.detail.changes.length) return activity.detail.changes.flatMap<{ path: string; deleted: boolean }>(change => {
    if (!change || typeof change !== "object" || typeof change.path !== "string") return [];
    if (["delete", "remove"].includes(change.kind)) return [{ path: change.path, deleted: true }];
    if (change.additions === 0 && change.deletions === 0 && !change.truncated
      && !["add", "create", "move", "rename"].includes(change.kind)) return [];
    return [{ path: change.path, deleted: false }];
  });
  // Only an explicitly classified successful write may fall back to its path.
  if (activity.kind !== "file-change" || typeof activity.detail.path !== "string") return [];
  return [{ path: activity.detail.path, deleted: false }];
}

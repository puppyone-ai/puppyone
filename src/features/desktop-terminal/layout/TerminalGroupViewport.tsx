import {
  useCallback,
  useMemo,
  type CSSProperties,
  type ReactNode,
} from "react";
import { isWorkbenchSplit, type WorkbenchSplitDropEdge } from "@puppyone/shared-ui";
import type { TerminalTabMoveDragController } from "../interactions/useTerminalTabMoveDrag";
import {
  partitionTerminalGroupDropIntent,
  type TerminalTabMoveDropIntent,
} from "../model/terminalTabMove";
import {
  terminalLeafMinimumSize,
  terminalSplitChildMinimumSizes,
  type TerminalSplitMinimumSize,
} from "../model/terminalSplitConstraints";
import type {
  DesktopTerminalGroup,
  DesktopTerminalLayoutNode,
  DesktopTerminalLayoutSplit,
  DesktopTerminalSession,
} from "../model/terminalSessions";
import type { TerminalRuntimeLookup } from "../runtime/TerminalRuntimeLookup";
import { TerminalSessionHeader } from "../ui/session-header/TerminalSessionHeader";
import {
  terminalPanelId,
  terminalTabId,
} from "../ui/session-header/terminalSessionHeaderIds";
import { TerminalGroupMoveHandle } from "./TerminalGroupMoveHandle";
import { TerminalGroupPane } from "./TerminalGroupPane";
import { TerminalSplitResizeHandle } from "./TerminalSplitResizeHandle";
import { TerminalSessionHostSlot } from "./session-host/TerminalSessionHostSlot";
import type {
  PersistentTerminalSessionHosts,
} from "./session-host/usePersistentTerminalSessionHosts";

export type TerminalGroupViewportProps = Readonly<{
  activeGroupId: string | null;
  dropIntent: TerminalTabMoveDropIntent | null;
  groups: readonly DesktopTerminalGroup[];
  hosts: PersistentTerminalSessionHosts;
  root: DesktopTerminalLayoutNode;
  runtimeRegistry: TerminalRuntimeLookup;
  sessions: readonly DesktopTerminalSession[];
  sessionMove: TerminalTabMoveDragController;
  workspacePath: string;
  onActivateSession: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onCreateSession: (groupId: string) => void;
  onMoveByKeyboard: (
    sessionId: string,
    targetGroupId: string,
    edge: WorkbenchSplitDropEdge,
  ) => void;
  onResizeSplit: (splitId: string, ratio: number) => void;
}>;

/** Projects the Sidebar split tree; every leaf owns a complete local Tab Group. */
export function TerminalGroupViewport({
  activeGroupId,
  dropIntent,
  groups,
  hosts,
  root,
  runtimeRegistry,
  sessions,
  sessionMove,
  workspacePath,
  onActivateSession,
  onCloseSession,
  onCreateSession,
  onMoveByKeyboard,
  onResizeSplit,
}: TerminalGroupViewportProps) {
  const groupById = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups],
  );
  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );
  const getLeafMinimum = useCallback((groupId: string) => {
    const group = groupById.get(groupId);
    return terminalLeafMinimumSize(
      group ? runtimeRegistry.get(group.activeSessionId)?.getMinimumViewportSize() : null,
    );
  }, [groupById, runtimeRegistry]);

  return (
    <div className="desktop-terminal-group-viewport">
      <TerminalLayoutNode
        activeGroupId={activeGroupId}
        dropIntent={dropIntent}
        getLeafMinimum={getLeafMinimum}
        groupById={groupById}
        hosts={hosts}
        node={root}
        runtimeRegistry={runtimeRegistry}
        sessionById={sessionById}
        sessionMove={sessionMove}
        workspacePath={workspacePath}
        onActivateSession={onActivateSession}
        onCloseSession={onCloseSession}
        onCreateSession={onCreateSession}
        onMoveByKeyboard={onMoveByKeyboard}
        onResizeSplit={onResizeSplit}
      />
    </div>
  );
}

type TerminalLayoutNodeProps = Readonly<{
  activeGroupId: string | null;
  dropIntent: TerminalTabMoveDropIntent | null;
  getLeafMinimum: (groupId: string) => TerminalSplitMinimumSize;
  groupById: ReadonlyMap<string, DesktopTerminalGroup>;
  hosts: PersistentTerminalSessionHosts;
  node: DesktopTerminalLayoutNode;
  runtimeRegistry: TerminalGroupViewportProps["runtimeRegistry"];
  sessionById: ReadonlyMap<string, DesktopTerminalSession>;
  sessionMove: TerminalTabMoveDragController;
  workspacePath: string;
  onActivateSession: TerminalGroupViewportProps["onActivateSession"];
  onCloseSession: TerminalGroupViewportProps["onCloseSession"];
  onCreateSession: TerminalGroupViewportProps["onCreateSession"];
  onMoveByKeyboard: TerminalGroupViewportProps["onMoveByKeyboard"];
  onResizeSplit: TerminalGroupViewportProps["onResizeSplit"];
}>;

function TerminalLayoutNode(props: TerminalLayoutNodeProps): ReactNode {
  if (!isWorkbenchSplit(props.node)) {
    const group = props.groupById.get(props.node.groupId);
    if (!group) return null;
    return <TerminalTabGroupLeaf {...props} group={group} />;
  }
  return <TerminalSplit {...props} split={props.node} />;
}

function TerminalTabGroupLeaf({
  activeGroupId,
  dropIntent,
  group,
  hosts,
  runtimeRegistry,
  sessionById,
  sessionMove,
  workspacePath,
  onActivateSession,
  onCloseSession,
  onCreateSession,
  onMoveByKeyboard,
}: TerminalLayoutNodeProps & { group: DesktopTerminalGroup }) {
  const sessions = group.sessionIds
    .map((sessionId) => sessionById.get(sessionId))
    .filter((session): session is DesktopTerminalSession => Boolean(session));
  const dropZones = partitionTerminalGroupDropIntent(dropIntent, group.id);
  const activeSession = sessionById.get(group.activeSessionId);
  const host = hosts.get(group.activeSessionId);

  return (
    <TerminalGroupPane
      contentDropIntent={dropZones.content}
      focused={activeGroupId === group.id}
      groupId={group.id}
      header={<TerminalSessionHeader
        activeSessionId={group.activeSessionId}
        dropInsertion={dropZones.tabBar}
        groupId={group.id}
        onActivate={onActivateSession}
        onClose={onCloseSession}
        onCreate={() => onCreateSession(group.id)}
        onMoveByKeyboard={(sessionId, edge) => onMoveByKeyboard(sessionId, group.id, edge)}
        presentedSessionIds={[group.activeSessionId]}
        runtimeRegistry={runtimeRegistry}
        sessions={sessions}
        tabMove={sessionMove}
        workspacePath={workspacePath}
      />}
      moveHandle={activeSession ? (
        <TerminalGroupMoveHandle
          groupId={group.id}
          session={activeSession}
          sessionIds={group.sessionIds}
          sessionMove={sessionMove}
          onActivate={onActivateSession}
        />
      ) : null}
    >
      {activeSession && host && (
        <TerminalSessionHostSlot
          focused={activeGroupId === group.id}
          host={host}
          labelledBy={terminalTabId(activeSession.id)}
          panelId={terminalPanelId(activeSession.id)}
          sessionId={activeSession.id}
        />
      )}
    </TerminalGroupPane>
  );
}

function TerminalSplit({
  node: _node,
  split,
  ...props
}: TerminalLayoutNodeProps & { split: DesktopTerminalLayoutSplit }) {
  const minimums = terminalSplitChildMinimumSizes(split, props.getLeafMinimum);
  const style = {
    "--desktop-terminal-first-track": `${split.ratio}fr`,
    "--desktop-terminal-second-track": `${1 - split.ratio}fr`,
  } as CSSProperties;

  return (
    <div
      className="desktop-terminal-split"
      data-direction={split.direction}
      data-terminal-split-id={split.id}
      style={style}
    >
      <TerminalLayoutNode key={split.first.id} {...props} node={split.first} />
      <TerminalSplitResizeHandle
        key={split.id}
        direction={split.direction}
        firstMinimum={minimums.first}
        secondMinimum={minimums.second}
        ratio={split.ratio}
        splitId={split.id}
        onCommit={props.onResizeSplit}
      />
      <TerminalLayoutNode key={split.second.id} {...props} node={split.second} />
    </div>
  );
}

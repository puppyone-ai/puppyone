import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalizationContextValue } from "@puppyone/localization/react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { formatRelativeTime } from "../utils";
import { listAgentLinks, listAgentSessions, type AgentSession, type ConnectedAgent } from "./agentLinks";

/** Soon enough after an Agent is allowed, and gentle enough for a Header that never closes. */
const REFRESH_MS = 10_000;
/**
 * An Agent follows its instructions by opening one connection per command, so
 * a session usually lasts about a second. "Connected at this instant" would be
 * false for nearly the whole of a busy task, so a recent session still counts.
 */
const ACTIVE_GRACE_MS = 120_000;
const NO_AGENTS: readonly WorkspaceAgent[] = [];

export type WorkspaceAgent = ConnectedAgent & Readonly<{
  active: boolean;
  lastActiveAt: string | null;
  /** False when the sessions could not be read, which is not the same as there being none. */
  activityKnown: boolean;
}>;

export function resolveWorkspaceAgents(connections: readonly ConnectedAgent[],
  sessions: readonly AgentSession[] | null, now: number): WorkspaceAgent[] {
  return connections.map(agent => {
    if (!sessions) return { ...agent, active: false, lastActiveAt: null, activityKnown: false };
    let lastActiveAt: string | null = null;
    let active = false;
    for (const session of sessions) {
      if (session.grant_id !== agent.grant_id) continue;
      const last = session.closed_at ?? session.created_at;
      if (!lastActiveAt || Date.parse(last) > Date.parse(lastActiveAt)) lastActiveAt = last;
      // A lapsed lease is a connection nobody closed, not one still in use.
      if (session.state !== "closed" && Date.parse(session.lease_until) > now) active = true;
    }
    if (lastActiveAt && now - Date.parse(lastActiveAt) < ACTIVE_GRACE_MS) active = true;
    return { ...agent, active, lastActiveAt, activityKnown: true };
  });
}

/** The server lists recent sessions only, so an empty history means "nothing recent", never "never". */
export function workspaceAgentStatus(agent: WorkspaceAgent, localization: LocalizationContextValue) {
  const { t } = localization;
  if (agent.active) return t("cloud.share.agent.status.active");
  if (!agent.activityKnown) return null;
  return agent.lastActiveAt
    ? t("cloud.share.agent.status.lastActive", { time: formatRelativeTime(agent.lastActiveAt, localization) })
    : t("cloud.share.agent.status.none");
}

export function useWorkspaceAgents(target: Readonly<{
  session: DesktopCloudSession;
  projectId: string;
  apiBaseUrl: string;
}> | null) {
  const session = target?.session;
  const projectId = target?.projectId;
  const apiBaseUrl = target?.apiBaseUrl;
  const [agents, setAgents] = useState(NO_AGENTS);
  const latest = useRef(0);
  const denied = useRef(false);
  const refresh = useCallback(async () => {
    if (!session || !projectId || !apiBaseUrl || denied.current) return;
    const request = ++latest.current;
    const [inventory, sessions] = await Promise.allSettled([
      listAgentLinks(session, projectId, apiBaseUrl),
      listAgentSessions(session, projectId, apiBaseUrl),
    ]);
    if (request !== latest.current) return;
    if (inventory.status === "rejected") {
      // Only the owner may read this. Anyone else has nothing to show and never
      // will; a bad network keeps what is known instead of emptying the Header.
      if ((inventory.reason as { status?: number }).status === 403) {
        denied.current = true;
        setAgents(NO_AGENTS);
      }
      return;
    }
    setAgents(resolveWorkspaceAgents(inventory.value.connections,
      sessions.status === "fulfilled" ? sessions.value : null, Date.now()));
  }, [apiBaseUrl, projectId, session]);
  useEffect(() => {
    if (!session || !projectId || !apiBaseUrl) return undefined;
    const whenVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    void refresh();
    const timer = setInterval(whenVisible, REFRESH_MS);
    document.addEventListener("visibilitychange", whenVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", whenVisible);
      latest.current += 1;
    };
  }, [apiBaseUrl, projectId, refresh, session]);
  return { agents: target ? agents : NO_AGENTS, refresh };
}

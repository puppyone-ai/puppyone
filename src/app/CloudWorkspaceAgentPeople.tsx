import { useMemo } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { ProjectReachPeople, ReachMemberMark, resolveProjectReachState } from "../features/app-shell/project-reach";
import type { CloudWorkspacePeople } from "../features/cloud/workbench/CloudWorkspaceHeaderTools";
import type { ShareAgentMark } from "../features/cloud/share/CloudWorkspaceAgentShare";
import { workspaceAgentStatus } from "../features/cloud/share/useWorkspaceAgents";

/**
 * Who is in a hosted workspace, in the Header's own marks: the Agents, then the
 * person looking. Share already owns the list and the Remove action, so the
 * marks open it rather than a second list that could disagree with it.
 */
export function CloudWorkspaceAgentPeople({ agents, viewer, onOpen }: CloudWorkspacePeople) {
  const localization = useLocalization();
  const state = useMemo(() => resolveProjectReachState({
    share: "shared",
    place: "cloud",
    // Every member here is an Agent, and an unrecognized name is a machine.
    destinations: [],
    shares: agents.map(agent => ({ id: agent.id, name: agent.name, lastSeenAt: agent.lastActiveAt })),
    activity: Object.fromEntries(agents.filter(agent => agent.active)
      .map(agent => [agent.id, { kind: "working" as const, label: agent.name }])),
  }), [agents]);
  const statement = localization.formatList([
    ...[...agents].sort((left, right) => Number(right.active) - Number(left.active)).map(agent =>
      [agent.name, workspaceAgentStatus(agent, localization)].filter(Boolean).join(" · ")),
    `${localization.t("agent.message.you")} · ${viewer}`,
  ], { type: "unit" });
  return <ProjectReachPeople state={state} statement={statement} viewer={viewer} onOpen={onOpen} />;
}

/** The same mark in Share's list as in the Header, so an Agent looks like itself in both. */
export function CloudWorkspaceAgentMark({ id, name, active }: ShareAgentMark) {
  return <ReachMemberMark size={22} member={{ id, name, audience: "machine", lastSeenAt: null,
    activity: active ? { kind: "working", label: name } : null }} />;
}

import { useMemo } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { ProjectReachPeople, resolveProjectReachState } from "../features/app-shell/project-reach";
import type { CloudWorkspacePeople } from "../features/cloud/workbench/CloudWorkspaceHeaderTools";
import { workspaceAgentStatus } from "../features/cloud/share/useWorkspaceAgents";

/**
 * Who is in a hosted workspace, in the Header's own marks. Share already owns
 * the list and the Remove action, so the marks open it rather than a second
 * list that could disagree with it.
 */
export function CloudWorkspaceAgentPeople({ agents, onOpen }: CloudWorkspacePeople) {
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
  const statement = localization.formatList(
    [...agents].sort((left, right) => Number(right.active) - Number(left.active)).map(agent =>
      [agent.name, workspaceAgentStatus(agent, localization)].filter(Boolean).join(" · ")),
    { type: "unit" });
  return <ProjectReachPeople state={state} statement={statement} onOpen={onOpen} />;
}
